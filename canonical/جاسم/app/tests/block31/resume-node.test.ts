import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { dagNodes, executionAttempts, runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createBlock2Worker: typeof import("../../api/runtime/block2/worker").createBlock2Worker;
let createRuntimeDag: typeof import("../../api/runtime/jasim-runtime").createRuntimeDag;
let createRuntimeRun: typeof import("../../api/runtime/jasim-runtime").createRuntimeRun;
let resumeScheduledRuntimeRun: typeof import("../../api/runtime/jasim-runtime").resumeScheduledRuntimeRun;

describe("Block 3.1 scheduled run restart continuation", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    ({ createBlock2Worker } = await import("../../api/runtime/block2/worker"));
    ({ createRuntimeDag, createRuntimeRun, resumeScheduledRuntimeRun } =
      await import("../../api/runtime/jasim-runtime"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("discovers a due waiting run after fresh boot and executes its node once", async () => {
    const ownerId = "sample-owner";
    const run = await createRuntimeRun({
      ownerId,
      goal: "sample durable goal",
      idempotencyKey: "sample-due-run",
    });
    await createRuntimeDag({
      ownerId,
      runId: run.id,
      nodes: [{
        nodeKey: "sample-step",
        capabilityId: "local-calculation",
        inputs: { values: [2, 3] },
        maxAttempts: 1,
      }],
    });
    await handle.db
      .update(runs)
      .set({ status: "waiting", resumeAt: new Date(Date.now() - 1_000) })
      .where(eq(runs.id, run.id));
    await handle.db
      .update(dagNodes)
      .set({ status: "WAITING" })
      .where(eq(dagNodes.runId, run.id));

    const freshWorker = createBlock2Worker({
      artifactsRoot: `.local/block31-artifacts-${run.id}`,
      resumeNode: async ({ runId, ownerId }) => {
        await resumeScheduledRuntimeRun({ runId, ownerId });
      },
    });
    await freshWorker.bootstrap();
    const sweep = await freshWorker.sweepNow();
    expect(sweep.scheduledRunsQueued).toBe(1);
    expect(await freshWorker.worker.runOnce()).toBe(true);

    // Repeated discovery/worker passes resolve to the same durable job and
    // canonical DAG fencing prevents a second execution attempt.
    await freshWorker.sweepNow();
    await freshWorker.worker.runOnce();
    const [node] = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    const attempts = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    expect(node.attemptCount).toBe(1);
    expect(attempts).toHaveLength(1);
    // The resumed execution is the explicitly local, side-effect-free
    // capability. No external or financial execution was inferred/retried.
    expect(attempts[0]!.capabilityId).toBe("local-calculation");
  });

  it("does not auto-resume an input wait, even when resumeAt is due", async () => {
    const run = await createRuntimeRun({
      ownerId: "sample-owner",
      goal: "sample input-bound goal",
      idempotencyKey: "sample-input-wait",
      status: "awaiting_input",
      resumeAt: new Date(Date.now() - 1_000),
    });
    const callback = vi.fn();
    const freshWorker = createBlock2Worker({
      artifactsRoot: `.local/block31-artifacts-${run.id}`,
      resumeNode: callback,
    });
    const sweep = await freshWorker.sweepNow();
    expect(sweep.scheduledRunsQueued).toBe(0);
    expect(await freshWorker.worker.runOnce()).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    const [parked] = await handle.db
      .select({ status: runs.status, resumeAt: runs.resumeAt })
      .from(runs)
      .where(and(eq(runs.id, run.id), eq(runs.ownerId, "sample-owner")));
    expect(parked.status).toBe("awaiting_input");
    expect(parked.resumeAt).not.toBeNull();
  });
});