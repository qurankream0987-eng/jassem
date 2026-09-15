import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DurableJobConflictError, DurableJobQueue, MemoryDurableJobRepository } from "../../api/core/durable-job-queue";
import { DurableJobWorker } from "../../api/core/durable-job-worker";
import { FilesystemImmutableArtifactStore, MemoryImmutableArtifactStore } from "../../api/core/immutable-artifact-store";
import { S3ImmutableArtifactStore } from "../../api/core/s3-immutable-artifact-store";

async function fixture(now: () => Date = () => new Date("2026-01-01T00:00:00.000Z")) {
  const repository = new MemoryDurableJobRepository();
  const queue = new DurableJobQueue({ repository, now, defaultLeaseMs: 5_000, baseRetryDelayMs: 100 });
  const artifacts = new MemoryImmutableArtifactStore();
  const payload = await artifacts.put(Buffer.from("{}"), { mediaType: "application/json" });
  return { repository, queue, artifacts, payload };
}

describe("domain-neutral durable runtime jobs", () => {
  it("accepts unseen future kinds and enforces semantic idempotency", async () => {
    const { queue, payload, artifacts } = await fixture();
    const input = { kind: "future_anything.compose", subjectType: "unknown_future_subject", subjectId: "x", payloadSchemaVersion: 1, payload, idempotencyKey: "same-request-001", createdBy: "test" };
    const first = await queue.create(input);
    expect((await queue.create(input)).id).toBe(first.id);
    const other = await artifacts.put(Buffer.from("different"));
    await expect(queue.create({ ...input, payload: other })).rejects.toBeInstanceOf(DurableJobConflictError);
  });

  it("allows only one concurrent claimant", async () => {
    const { queue, payload } = await fixture();
    await queue.create({ kind: "runtime.generic", subjectType: "subject", subjectId: "1", payloadSchemaVersion: 1, payload, idempotencyKey: "claim-once-001", createdBy: "test" });
    const claims = await Promise.all([queue.claim("worker-a"), queue.claim("worker-b"), queue.claim("worker-c")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("recovers expired leases and times out exhausted work", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const { queue, payload } = await fixture(() => clock);
    const job = await queue.create({ kind: "runtime.generic", subjectType: "subject", subjectId: "1", payloadSchemaVersion: 1, payload, idempotencyKey: "lease-expiry-001", maxAttempts: 1, createdBy: "test" });
    expect(await queue.claim("worker", 5_000)).toBeTruthy();
    clock = new Date(clock.getTime() + 5_001);
    expect(await queue.recoverExpired("recovery")).toBe(1);
    expect((await queue.get(job.id))?.status).toBe("timed_out");
  });

  it("honours cancellation without publishing a result", async () => {
    const { queue, artifacts, payload } = await fixture();
    const job = await queue.create({ kind: "runtime.generic", subjectType: "subject", subjectId: "1", payloadSchemaVersion: 1, payload, idempotencyKey: "cancel-job-001", createdBy: "test" });
    const claim = (await queue.claim("worker"))!;
    await queue.start(job.id, claim.leaseToken, "worker");
    await queue.requestCancel(job.id, "admin");
    const output = await artifacts.put(Buffer.from("must-not-publish"));
    const cancelled = await queue.complete(job.id, claim.leaseToken, "worker", output);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.result).toBeNull();
  });

  it("quarantines unreviewed handlers instead of executing arbitrary work", async () => {
    const { queue, artifacts, payload } = await fixture();
    const job = await queue.create({ kind: "unknown.unreviewed", subjectType: "subject", subjectId: "1", payloadSchemaVersion: 1, payload, idempotencyKey: "unknown-kind-001", createdBy: "test" });
    const worker = new DurableJobWorker({ id: "worker", queue, artifacts, handlers: new Map(), pollMs: 100 });
    expect(await worker.runOnce()).toBe(true);
    expect((await queue.get(job.id))?.status).toBe("quarantined");
  });

  it("stops waiting for a handler that exceeds the generic execution deadline", async () => {
    vi.useFakeTimers();
    try {
      const { queue, artifacts, payload } = await fixture();
      const job = await queue.create({ kind: "runtime.slow", subjectType: "subject", subjectId: "1", payloadSchemaVersion: 1, payload, idempotencyKey: "timeout-job-001", timeoutMs: 1_000, createdBy: "test" });
      const worker = new DurableJobWorker({ id: "worker", queue, artifacts, handlers: new Map([["runtime.slow", async () => new Promise(() => undefined)]]) });
      const running = worker.runOnce();
      await vi.advanceTimersByTimeAsync(1_001);
      await running;
      expect((await queue.get(job.id))?.status).toBe("timed_out");
    } finally { vi.useRealTimers(); }
  });
});

describe("immutable content-addressed artifacts", () => {
  it("deduplicates identical bytes and rejects tampering on read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "jasim-artifacts-"));
    try {
      const store = new FilesystemImmutableArtifactStore(root);
      const first = await store.put(Buffer.from("evidence"));
      expect((await store.put(Buffer.from("evidence"))).uri).toBe(first.uri);
      const target = path.join(root, "sha256", first.digest.slice(0, 2), `${first.digest}.blob`);
      await writeFile(target, "tampered");
      await expect(store.get(first.uri)).rejects.toThrow(/digest verification/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("uses conditional S3 creation and verifies downloaded content", async () => {
    const content = Buffer.from("s3-evidence");
    const commands: Array<{ constructor: { name: string }; input: Record<string, unknown> }> = [];
    const client = {
      async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
        commands.push(command);
        if (command.constructor.name === "GetObjectCommand") {
          return {
            ContentLength: content.byteLength,
            ChecksumSHA256: Buffer.from("da877aa902766d39ecf909b9a18e7ce0b98644d81a4a039e5f9a72820e0a2008", "hex").toString("base64"),
            Body: { transformToByteArray: async () => content },
          };
        }
        return {};
      },
    };
    const store = new S3ImmutableArtifactStore({ bucket: "evidence", client: client as never });
    const artifact = await store.put(content);
    expect(commands[0].input).toMatchObject({ IfNoneMatch: "*", Bucket: "evidence" });
    await expect(store.get(artifact.uri)).resolves.toEqual(content);
  });
});
