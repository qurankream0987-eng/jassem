import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dagNodes, events as runEvents, executionAttempts, runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

/**
 * COMPENSATION, END TO END, ON THE LIVE PATH.
 *
 * The policy tests prove the decisions. This proves the thing only a database
 * can: that recovery runs as a REAL Run with a real immutable attempt and a
 * real verification verdict — and that the forward history survives it intact.
 */

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
const OWNER = "9200";

/** A run whose first step has a real effect and whose second fails. */
async function partiallyFailedRun(key: string) {
  const run = await runtime.createRuntimeRun({
    ownerId: OWNER, goal: `partial ${key}`, idempotencyKey: `partial-${key}`,
  });
  await runtime.createRuntimeDag({
    ownerId: OWNER,
    runId: run.id,
    nodes: [
      // A real MESSAGE_DISPATCH effect.
      { nodeKey: "A", capabilityId: "notify", maxAttempts: 1,
        inputs: { recipientId: "recipient-1", purpose: "update", title: "طلب", body: "نص" } },
      // Passes its input contract, then throws inside execute().
      { nodeKey: "B", capabilityId: "research-context", maxAttempts: 1, dependencies: ["A"],
        inputs: { research: "not-an-object", userGoal: "x" } },
    ],
  });
  await runtime.driveRunToCompletion(run.id, OWNER, "partial-worker");
  return run;
}

describe("recovery from partial failure", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    runtime = await import("../../api/runtime/jasim-runtime");
  });
  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events, notification_intents CASCADE"));
  });
  afterAll(async () => { await handle.pool.end(); });

  it("plans recovery for the effect that happened and skips the one that did not", async () => {
    const run = await partiallyFailedRun("plan");
    const result = await runtime.compensateFailedRun({ runId: run.id, ownerId: OWNER });

    const byNode = new Map(result.plan.requirements.map((r) => [r.sourceNodeKey, r]));
    // A executed a real messaging effect that was never confirmed delivered,
    // so compensating it is unsafe — the same rule that forbids blind retry.
    expect(byNode.get("A")!.effectKind).toBe("MESSAGE_DISPATCH");
    expect(byNode.get("A")!.decision).toBe("MANUAL_INTERVENTION_REQUIRED");
    expect(byNode.get("A")!.reasonCode).toBe("EFFECT_UNCERTAIN_COMPENSATION_UNSAFE");
    // B never had an effect at all.
    expect(byNode.get("B")!.decision).toBe("SKIP");
    expect(result.outcome).toBe("MANUAL_INTERVENTION_REQUIRED");
  });

  it("records the plan as a run event without executing anything", async () => {
    const run = await partiallyFailedRun("event");
    const before = await handle.db.select().from(executionAttempts);
    await runtime.compensateFailedRun({ runId: run.id, ownerId: OWNER });
    const after = await handle.db.select().from(executionAttempts);
    // Planning is pure: no new attempt, no new effect.
    expect(after.length).toBe(before.length);

    const types = (await handle.db.select().from(runEvents).where(eq(runEvents.runId, run.id)))
      .map((event) => event.type);
    expect(types).toContain("COMPENSATION_PLANNED");
  });

  it("executes recovery as a real linked Run with a real verified attempt", async () => {
    // A verified effect is the precondition for compensation, so this run's
    // effect is confirmed first by delivering the notification for real.
    const run = await runtime.createRuntimeRun({
      ownerId: OWNER, goal: "verified effect", idempotencyKey: "verified-effect",
    });
    await runtime.createRuntimeDag({
      ownerId: OWNER, runId: run.id,
      nodes: [{ nodeKey: "A", capabilityId: "notify", maxAttempts: 1,
        inputs: { recipientId: "recipient-2", purpose: "update", title: "طلب", body: "نص" } }],
    });
    await runtime.driveRunToCompletion(run.id, OWNER, "w");

    // Force the ledger to the verified state the compensation path requires.
    const [node] = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    await handle.db.update(executionAttempts)
      .set({ verificationStatus: "VERIFIED" })
      .where(eq(executionAttempts.nodeId, node!.id));

    const result = await runtime.compensateFailedRun({
      runId: run.id, ownerId: OWNER, execute: true,
    });

    expect(result.compensationRunId).toBeTruthy();
    expect(result.plan.executable.map((r) => r.sourceNodeKey)).toEqual(["A"]);

    // The compensation is a REAL run with a REAL attempt of its own.
    const compensationAttempts = await handle.db
      .select().from(executionAttempts)
      .where(eq(executionAttempts.runId, result.compensationRunId!));
    expect(compensationAttempts).toHaveLength(1);
    expect(compensationAttempts[0]!.capabilityId).toBe("notify");
    // And it is judged by the same completion policy — not assumed done.
    const detail = compensationAttempts[0]!.verificationDetail as Record<string, any>;
    expect(detail.completion.effectKind).toBe("MESSAGE_DISPATCH");
    expect(compensationAttempts[0]!.verificationStatus).not.toBe("VERIFIED");

    // A correction was SENT — compensation is a new effect, not an undo.
    const intents = await handle.db.execute(
      sql.raw(`SELECT purpose FROM notification_intents ORDER BY "createdAt"`),
    );
    expect((intents.rows as Array<{ purpose: string }>).map((r) => r.purpose))
      .toContain("correction");
  });

  it("never reports full recovery for a partially compensatable effect", async () => {
    const run = await runtime.createRuntimeRun({
      ownerId: OWNER, goal: "residual", idempotencyKey: "residual",
    });
    await runtime.createRuntimeDag({
      ownerId: OWNER, runId: run.id,
      nodes: [{ nodeKey: "A", capabilityId: "notify", maxAttempts: 1,
        inputs: { recipientId: "recipient-3", purpose: "update", title: "ط", body: "ن" } }],
    });
    await runtime.driveRunToCompletion(run.id, OWNER, "w");
    const [node] = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    await handle.db.update(executionAttempts)
      .set({ verificationStatus: "VERIFIED" })
      .where(eq(executionAttempts.nodeId, node!.id));

    const result = await runtime.compensateFailedRun({
      runId: run.id, ownerId: OWNER, execute: true,
    });
    // A sent message cannot be unsent. Even a perfect correction leaves a
    // residue, so recovery is never COMPLETE here.
    expect(result.outcome).not.toBe("RECOVERY_COMPLETE");
    expect(["RECOVERY_INCOMPLETE", "MANUAL_INTERVENTION_REQUIRED"]).toContain(result.outcome);
  });

  it("is idempotent across a repeated call: one compensation run, no double effect", async () => {
    const run = await runtime.createRuntimeRun({
      ownerId: OWNER, goal: "idem", idempotencyKey: "idem",
    });
    await runtime.createRuntimeDag({
      ownerId: OWNER, runId: run.id,
      nodes: [{ nodeKey: "A", capabilityId: "notify", maxAttempts: 1,
        inputs: { recipientId: "recipient-4", purpose: "update", title: "ط", body: "ن" } }],
    });
    await runtime.driveRunToCompletion(run.id, OWNER, "w");
    const [node] = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    await handle.db.update(executionAttempts)
      .set({ verificationStatus: "VERIFIED" })
      .where(eq(executionAttempts.nodeId, node!.id));

    const first = await runtime.compensateFailedRun({ runId: run.id, ownerId: OWNER, execute: true });
    // A worker restart, a duplicate job delivery, a reconciliation retry.
    const second = await runtime.compensateFailedRun({ runId: run.id, ownerId: OWNER, execute: true });

    expect(second.compensationRunId).toBe(first.compensationRunId);
    const compensationRuns = await handle.db.select().from(runs)
      .where(eq(runs.idempotencyKey, `compensation:${run.id}`));
    expect(compensationRuns).toHaveLength(1);
    // And exactly one compensating attempt exists, not two.
    const attempts = await handle.db.select().from(executionAttempts)
      .where(eq(executionAttempts.runId, first.compensationRunId!));
    expect(attempts).toHaveLength(1);
  });

  it("leaves the forward history exactly as it was", async () => {
    const run = await runtime.createRuntimeRun({
      ownerId: OWNER, goal: "history", idempotencyKey: "history",
    });
    await runtime.createRuntimeDag({
      ownerId: OWNER, runId: run.id,
      nodes: [{ nodeKey: "A", capabilityId: "notify", maxAttempts: 1,
        inputs: { recipientId: "recipient-5", purpose: "update", title: "ط", body: "ن" } }],
    });
    await runtime.driveRunToCompletion(run.id, OWNER, "w");
    const [node] = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    await handle.db.update(executionAttempts)
      .set({ verificationStatus: "VERIFIED" })
      .where(eq(executionAttempts.nodeId, node!.id));

    const before = (await handle.db.select().from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id)))[0]!;
    await runtime.compensateFailedRun({ runId: run.id, ownerId: OWNER, execute: true });
    const after = (await handle.db.select().from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id)))[0]!;

    // PAYMENT_CAPTURED stays a fact after REFUND_VERIFIED. The original effect
    // is never mutated into "never happened".
    expect(after.verificationStatus).toBe(before.verificationStatus);
    expect(after.executionStatus).toBe(before.executionStatus);
    expect(after.finishedAt?.getTime()).toBe(before.finishedAt?.getTime());
  });

  it("refuses to compensate another owner's run", async () => {
    const run = await partiallyFailedRun("cross-owner");
    await expect(
      runtime.compensateFailedRun({ runId: run.id, ownerId: "9999", execute: true }),
    ).rejects.toThrow();
  });
});
