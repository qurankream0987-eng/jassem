import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { canonicalResultDigest } from "../../../api/runtime/execution-verifier";

export const MCP_TEST_RECEIPT_SECRET = "test-receipt-secret";

type Task = {
  id: string;
  status: "running" | "completed" | "cancelled";
  polls: number;
  result?: {
    content: Array<{ type: "text"; text: string }>;
    receipt: { algorithm: "hmac-sha256"; signature: string };
  };
};

export type McpTestServer = {
  baseUrl: string;
  malformedUrl: string;
  deliveryUrl: string;
  privateRedirectUrl: string;
  loopbackRedirectUrl: string;
  close(): Promise<void>;
};

async function readJson(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, any>;
}

function receiptFor(content: unknown): {
  algorithm: "hmac-sha256";
  signature: string;
} {
  const digest = canonicalResultDigest({ content });
  return {
    algorithm: "hmac-sha256",
    signature: createHmac("sha256", MCP_TEST_RECEIPT_SECRET).update(digest).digest("hex"),
  };
}

export async function startMcpTestServer(options?: {
  pollsToComplete?: number;
}): Promise<McpTestServer> {
  const tasks = new Map<string, Task>();
  const deliveries = new Map<string, unknown>();
  const pollsToComplete = options?.pollsToComplete ?? 2;

  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/redirect/private") {
      response.statusCode = 302;
      response.setHeader("location", "http://169.254.169.254/");
      response.end();
      return;
    }
    if (request.url === "/redirect/loopback") {
      response.statusCode = 302;
      response.setHeader("location", `http://${request.headers.host}/`);
      response.end();
      return;
    }
    if (request.url === "/malformed") {
      response.end("{ definitely-not-json");
      return;
    }
    if (request.url === "/deliveries") {
      const body = await readJson(request);
      const callbackId = String(body.callbackId ?? "");
      const prior = deliveries.get(callbackId);
      if (prior !== undefined) {
        response.end(JSON.stringify({ duplicate: true, state: prior }));
      } else {
        deliveries.set(callbackId, body.state);
        response.end(JSON.stringify({ duplicate: false, state: body.state }));
      }
      return;
    }

    let message: Record<string, any>;
    try {
      message = await readJson(request);
    } catch {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "invalid JSON" }));
      return;
    }
    const reply = (result: unknown) =>
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    const rpcError = (code: number, errorMessage: string) =>
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code, message: errorMessage },
        }),
      );

    if (message.method === "initialize") {
      reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, tasks: {} },
        serverInfo: { name: "block2-test", version: "1" },
      });
      return;
    }
    if (message.method === "tools/list") {
      reply({
        tools: [
          {
            name: "echo",
            description: "Echo input over the real transport",
            inputSchema: { type: "object" },
          },
        ],
      });
      return;
    }
    if (message.method === "tools/call") {
      const { name, arguments: args } = message.params ?? {};
      if (name === "echo") {
        const content = [{ type: "text" as const, text: JSON.stringify(args) }];
        reply({
          content,
          isError: false,
          receipt: receiptFor(content),
        });
        return;
      }
      if (name === "slow") {
        const id = `task_${randomUUID()}`;
        tasks.set(id, { id, status: "running", polls: 0 });
        reply({ task: { id, status: "running" }, isError: false });
        return;
      }
      rpcError(-32602, `unknown tool: ${String(name)}`);
      return;
    }
    if (message.method === "tasks/get") {
      const task = tasks.get(String(message.params?.taskId));
      if (!task) {
        rpcError(-32001, "task not found");
        return;
      }
      if (task.status === "running") {
        task.polls += 1;
        if (task.polls >= pollsToComplete) {
          task.status = "completed";
          const content = [{ type: "text" as const, text: "slow complete" }];
          task.result = { content, receipt: receiptFor(content) };
        }
      }
      reply(task);
      return;
    }
    if (message.method === "tasks/cancel") {
      const task = tasks.get(String(message.params?.taskId));
      if (!task) {
        reply({ confirmed: false });
        return;
      }
      task.status = "cancelled";
      reply({ confirmed: true, task });
      return;
    }
    rpcError(-32601, "method not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("MCP test server did not bind a TCP port");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl: origin,
    malformedUrl: `${origin}/malformed`,
    deliveryUrl: `${origin}/deliveries`,
    privateRedirectUrl: `${origin}/redirect/private`,
    loopbackRedirectUrl: `${origin}/redirect/loopback`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}