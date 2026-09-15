import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMcpClient, McpClientError, type McpClient } from "../../api/runtime/block2/mcp-client";
import {
  attachRemoteReference,
  createRemoteExecution,
  recordProviderCallback,
  transitionRemoteExecution,
} from "../../api/runtime/block2/remote-execution";
import { getTestDb, resetBlock2, type TestDbHandle } from "./helpers/pg";
import { startMcpTestServer, type McpTestServer } from "./helpers/mcp-test-server";
import { MCP_TEST_RECEIPT_SECRET } from "./helpers/mcp-test-server";
import {
  canonicalResultDigest,
  verifyExecutionAttempt,
} from "../../api/runtime/execution-verifier";

describe("MCP real HTTP transport", () => {
  let server: McpTestServer;
  let database: TestDbHandle;

  beforeAll(async () => {
    [server, database] = await Promise.all([startMcpTestServer(), getTestDb()]);
  });

  beforeEach(async () => {
    await resetBlock2(database.db);
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  it("performs initialize and tools/list handshakes", async () => {
    const client = createMcpClient({ baseUrl: server.baseUrl });
    await expect(client.initialize()).resolves.toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "block2-test" },
    });
    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: "echo" }],
    });
  });

  it("round-trips a synchronous tool call with real JSON serialization", async () => {
    const client = createMcpClient({ baseUrl: server.baseUrl });
    const input = { arabic: "جاسم", nested: { count: 3 }, enabled: true };
    const result = await client.callTool("echo", input);
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(input) }]);
    expect(result.receiptSignature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a tampered authenticated provider receipt", async () => {
    const client = createMcpClient({ baseUrl: server.baseUrl });
    const called = await client.callTool("echo", { proof: true });
    const normalized = {
      result: { content: called.content },
      metadata: { capabilityId: "echo" },
    };
    const verification = verifyExecutionAttempt({
      attemptId: "attempt-tampered",
      runId: "run-tampered",
      nodeId: "node-tampered",
      capabilityId: "echo",
      executionStatus: "COMPLETED",
      normalizedResult: normalized,
      normalizedError: null,
      idempotencyKey: "tampered",
      remoteEvidence: {
        resultDigest: canonicalResultDigest(normalized.result),
        receiptSignature: `${called.receiptSignature!.slice(0, -1)}0`,
      },
      providerReceiptSecret: MCP_TEST_RECEIPT_SECRET,
    });
    expect(verification.status).toBe("INCONCLUSIVE");
    expect(verification.notes.join(" ")).toMatch(/receipt/i);
  });

  it("returns a task reference and polls it to provider completion", async () => {
    const client = createMcpClient({ baseUrl: server.baseUrl });
    const called = await client.callTool("slow", { work: "proof" });
    expect(called.taskReference).toMatchObject({ status: "running" });

    let task: any;
    for (let poll = 0; poll < 3; poll += 1) {
      task = await client.getTask(called.taskReference!.id);
      if (task.status === "completed") break;
    }
    expect(task).toMatchObject({
      status: "completed",
      result: { content: [{ type: "text", text: "slow complete" }] },
    });
  });

  it("requires real provider confirmation before CANCEL_CONFIRMED", async () => {
    const client = createMcpClient({ baseUrl: server.baseUrl });
    const called = await client.callTool("slow", {});
    const taskId = called.taskReference!.id;
    const execution = await createExecution(database, "cancel");
    const running = await attachRemoteReference(database.db, {
      id: execution.id,
      ownerId: execution.ownerId,
      remoteReference: taskId,
      expectedVersion: execution.version,
    });
    const requested = await transitionRemoteExecution(database.db, {
      id: running.id,
      ownerId: running.ownerId,
      to: "CANCEL_REQUESTED",
      expectedVersion: running.version,
    });

    const confirmed = await confirmCancellation(client, taskId);
    expect(confirmed).toBe(true);
    const cancelled = await transitionRemoteExecution(database.db, {
      id: requested.id,
      ownerId: requested.ownerId,
      to: "CANCEL_CONFIRMED",
      expectedVersion: requested.version,
      evidence: { cancelledBy: "provider", reference: taskId },
    });
    expect(cancelled.state).toBe("CANCEL_CONFIRMED");
  });

  it("deduplicates provider callbacks and rejects stale versions", async () => {
    const execution = await createExecution(database, "callbacks");
    const running = await attachRemoteReference(database.db, {
      id: execution.id,
      ownerId: execution.ownerId,
      remoteReference: "provider-task-callback",
      expectedVersion: execution.version,
    });
    const callback = {
      providerId: running.providerId,
      remoteReference: running.remoteReference!,
      callbackId: "callback-1",
      state: "COMPLETED" as const,
      evidence: { resultDigest: "sha256:result" },
      observedVersion: running.version,
    };
    const first = await recordProviderCallback(database.db, callback);
    const replay = await recordProviderCallback(database.db, callback);
    expect(first.applied).toBe(true);
    expect(replay).toMatchObject({ applied: false, duplicate: true });
    expect(replay.execution.version).toBe(first.execution.version);
    expect(replay.execution.state).toBe(first.execution.state);

    await expect(
      recordProviderCallback(database.db, {
        ...callback,
        callbackId: "callback-stale",
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });

  it("records duplicate HTTP deliveries without changing their state", async () => {
    const body = { callbackId: "delivery-1", state: { status: "completed", version: 4 } };
    const first = await postJson(server.deliveryUrl, body);
    const second = await postJson(server.deliveryUrl, {
      callbackId: body.callbackId,
      state: { status: "failed", version: 5 },
    });
    expect(first).toEqual({ duplicate: false, state: body.state });
    expect(second).toEqual({ duplicate: true, state: body.state });
  });

  it("classifies unreachable servers as TRANSPORT and malformed JSON as PROTOCOL", async () => {
    await expect(
      createMcpClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 1_000 }).initialize(),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof McpClientError && error.code === "TRANSPORT",
    );
    await expect(
      createMcpClient({ baseUrl: server.malformedUrl }).initialize(),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof McpClientError && error.code === "PROTOCOL",
    );
  });

  it("rejects literal IPv6 ULA and mapped private IPv4 endpoints", () => {
    expect(() => createMcpClient({ baseUrl: "https://[fc00::1]/" })).toThrowError(
      McpClientError,
    );
    expect(() => createMcpClient({ baseUrl: "https://[::ffff:10.0.0.1]/" })).toThrowError(
      McpClientError,
    );
  });

  it("guards redirect targets and permits an explicit loopback redirect", async () => {
    await expect(
      createMcpClient({ baseUrl: server.privateRedirectUrl }).initialize(),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof McpClientError && error.code === "TRANSPORT",
    );
    await expect(
      createMcpClient({ baseUrl: server.loopbackRedirectUrl }).initialize(),
    ).resolves.toMatchObject({
      protocolVersion: "2025-06-18",
    });
  });
});

async function createExecution(database: TestDbHandle, suffix: string) {
  return createRemoteExecution(database.db, {
    ownerId: "owner-1",
    runId: randomUUID(),
    nodeId: randomUUID(),
    providerId: "mcp-test-provider",
    protocolKind: "MCP",
    requestDigest: `digest-${suffix}`,
    idempotencyKey: `execution-${suffix}`,
  });
}

async function confirmCancellation(client: McpClient, taskId: string): Promise<boolean> {
  return (await client.cancelTask(taskId)).confirmed;
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}