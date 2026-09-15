import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createContext } from "../../api/context";
import { JasimWebSocketServer } from "../../api/core/websocket";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function openSocket(
  url: string,
  authorization?: string,
): Promise<{ socket: WebSocket; messages: Array<Record<string, unknown>> }> {
  const socket = new WebSocket(url, {
    headers: authorization ? { authorization } : undefined,
  });
  const messages: Array<Record<string, unknown>> = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, messages };
}

describe("Block 0 identity boundaries", () => {
  it("keeps a context anonymous when credentials are missing or invalid", async () => {
    const absent = await createContext({
      req: new Request("https://jasim.test/api/trpc/runtime.overview"),
      resHeaders: new Headers(),
    } as never);
    const invalid = await createContext({
      req: new Request("https://jasim.test/api/trpc/runtime.overview", {
        headers: { authorization: "Bearer not-a-jwt" },
      }),
      resHeaders: new Headers(),
    } as never);

    expect(absent.user).toBeUndefined();
    expect(invalid.user).toBeUndefined();
  });

  it("binds a WebSocket principal at handshake and rejects client identity messages", async () => {
    const server = createServer();
    servers.push(server);
    new JasimWebSocketServer(server, {
      authenticate: async (headers) => {
        if (headers.get("authorization") !== "Bearer canonical-a") {
          throw new Error("invalid credential");
        }
        return { userId: "user-a" };
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    const url = `ws://127.0.0.1:${address.port}`;

    const valid = await openSocket(url, "Bearer canonical-a");
    await new Promise((resolve) => setTimeout(resolve, 20));
    valid.socket.send(JSON.stringify({ type: "auth", userId: "user-b" }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(valid.messages).toContainEqual({ type: "connected" });
    expect(valid.messages).toContainEqual({
      type: "error",
      code: "UNSUPPORTED_SOCKET_ACTION",
    });

    const rejected = new WebSocket(url, {
      headers: { authorization: "Bearer forged-user-a" },
    });
    const status = await new Promise<number>((resolve) => {
      rejected.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      rejected.once("error", () => resolve(0));
    });
    expect(status).toBe(401);

    valid.socket.close();
    rejected.terminate();
  });

  it("authorizes Bubble and Run subscriptions with the handshake principal", async () => {
    const server = createServer();
    servers.push(server);
    new JasimWebSocketServer(server, {
      authenticate: async (headers) => {
        const token = headers.get("authorization");
        if (token === "Bearer canonical-a") return { userId: "user-a" };
        if (token === "Bearer canonical-b") return { userId: "user-b" };
        throw new Error("invalid credential");
      },
      authorizeSubscription: async (principal, target) =>
        principal.userId === "user-a" &&
        ((target.resource === "bubble" && target.resourceId === "bubble-a") ||
          (target.resource === "run" && target.resourceId === "run-a")),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    const url = `ws://127.0.0.1:${address.port}`;

    const owner = await openSocket(url, "Bearer canonical-a");
    owner.socket.send(JSON.stringify({ type: "subscribe", resource: "bubble", resourceId: "bubble-a" }));
    owner.socket.send(JSON.stringify({ type: "subscribe", resource: "run", resourceId: "run-a" }));

    const other = await openSocket(url, "Bearer canonical-b");
    other.socket.send(JSON.stringify({ type: "subscribe", resource: "bubble", resourceId: "bubble-a" }));
    other.socket.send(JSON.stringify({ type: "subscribe", resource: "run", resourceId: "run-a" }));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(owner.messages).toContainEqual({
      type: "subscribed",
      resource: "bubble",
      resourceId: "bubble-a",
    });
    expect(owner.messages).toContainEqual({
      type: "subscribed",
      resource: "run",
      resourceId: "run-a",
    });
    expect(other.messages.filter((message) => message.code === "SUBSCRIPTION_FORBIDDEN")).toHaveLength(2);

    owner.socket.close();
    other.socket.close();
  });
});