import { describe, expect, it } from "vitest";
import { createCoreEvolutionLabHandler } from "../../services/core-evolution-lab/http-app";
import type { CoreEvolutionLabJobService } from "../../services/core-evolution-lab/job-service";

const token = "a-secure-test-token-with-24-chars";
const job = { id: "job_1", kind: "core_evolution.evaluate" as const, candidateId: "candidate-1", status: "queued" as const, attempts: 0, maxAttempts: 3, timeoutMs: 600_000, cancellationRequested: false, result: null, errorCode: null, errorSummary: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", completedAt: null };
const service = {
  submit: async () => job,
  get: async (id: string) => id === job.id ? job : undefined,
  report: async () => { throw new Error("not ready"); },
  cancel: async (id: string) => id === job.id ? { ...job, status: "cancelled" as const } : undefined,
} as unknown as CoreEvolutionLabJobService;

describe("asynchronous Core Evolution Lab HTTP contract", () => {
  it("retires the synchronous long-running endpoint", async () => {
    const handler = createCoreEvolutionLabHandler({ service, token });
    const response = await handler(new Request("https://lab.test/v1/evaluate-core-patch", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(410);
  });

  it("returns immediately with 202 and a durable job location", async () => {
    const handler = createCoreEvolutionLabHandler({ service, token });
    const response = await handler(new Request("https://lab.test/v1/core-evolution-jobs", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": "request-0001" }, body: "{}" }));
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/v1/core-evolution-jobs/${job.id}`);
  });

  it("exposes polling and cancellation without a long HTTP request", async () => {
    const handler = createCoreEvolutionLabHandler({ service, token });
    const status = await handler(new Request(`https://lab.test/v1/core-evolution-jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } }));
    const cancelled = await handler(new Request(`https://lab.test/v1/core-evolution-jobs/${job.id}/cancel`, { method: "POST", headers: { authorization: `Bearer ${token}` } }));
    expect(status.status).toBe(200);
    expect(cancelled.status).toBe(202);
  });
});
