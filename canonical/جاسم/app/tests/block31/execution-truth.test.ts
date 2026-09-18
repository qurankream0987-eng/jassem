import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dagNodes, events as runEvents, executionAttempts } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

/**
 * EXECUTION TRUTH ON THE LIVE PATH.
 *
 * The unit tests prove the decision function and the block-2 tests prove the
 * notification readback. This proves the thing neither can: that a run driven
 * through the REAL executor — `executeApprovedRun` → `driveRunToCompletion` →
 * `executeRuntimeDagNode`, the path `runtime.runsExecute` takes — records the
 * effect verdict in the attempt ledger, and that a run whose effect is
 * unconfirmed does not produce a verified receipt.
 *
 * This harness repoints the runtime's own connection at an isolated proof
 * database, so the functions under test are the shipped ones.
 */

let handle: TestDbHandle;
let createRuntimeDag: typeof import("../../api/runtime/jasim-runtime").createRuntimeDag;
let createRuntimeRun: typeof import("../../api/runtime/jasim-runtime").createRuntimeRun;
let driveRunToCompletion: typeof import("../../api/runtime/jasim-runtime").driveRunToCompletion;
let buildRunReceipt: typeof import("../../api/runtime/jasim-runtime").buildRunReceipt;

const ownerId = "truth-owner";

async function runOneNode(input: {
  key: string;
  capabilityId: string;
  inputs: Record<string, unknown>;
}) {
  const run = await createRuntimeRun({
    ownerId,
    goal: `effect truth: ${input.key}`,
    idempotencyKey: `effect-truth-${input.key}`,
  });
  await createRuntimeDag({
    ownerId,
    runId: run.id,
    nodes: [{ nodeKey: input.key, capabilityId: input.capabilityId, inputs: input.inputs, maxAttempts: 1 }],
  });
  await driveRunToCompletion(run.id, ownerId, "effect-truth-worker");
  const [attempt] = await handle.db
    .select()
    .from(executionAttempts)
    .where(eq(executionAttempts.runId, run.id));
  const [node] = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
  return { run, attempt, node };
}

describe("execution truth is recorded per attempt on the live path", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    ({ createRuntimeDag, createRuntimeRun, driveRunToCompletion, buildRunReceipt } = await import(
      "../../api/runtime/jasim-runtime"
    ));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events, notification_intents CASCADE"));
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("a pure capability is still VERIFIED, and says why", async () => {
    // The regression guard for everything that already worked. Nearly every
    // registered capability is read-only, and none of them may become harder
    // to complete because effectful ones became harder.
    const { attempt, node } = await runOneNode({
      key: "pure-step",
      capabilityId: "local-calculation",
      inputs: { values: [2, 3] },
    });
    expect(attempt!.executionStatus).toBe("COMPLETED");
    expect(attempt!.verificationStatus).toBe("VERIFIED");
    expect(node!.status).toBe("COMPLETED");

    const detail = attempt!.verificationDetail as Record<string, any>;
    expect(detail.completion).toMatchObject({
      effectKind: "NONE",
      decision: "VERIFIED",
      reasonCode: "NO_EFFECT_TO_VERIFY",
    });
  });

  it("the completion policy is recorded for every attempt, not only failing ones", async () => {
    const { attempt } = await runOneNode({
      key: "pure-recorded",
      capabilityId: "local-analysis",
      inputs: { text: "something to analyse" },
    });
    const detail = attempt!.verificationDetail as Record<string, any>;
    // An attempt whose ledger row cannot say what was verified is not an audit
    // record, it is a rumour.
    expect(detail.completion).toBeDefined();
    expect(detail.completion.effectKind).toBe("NONE");
    expect(detail.notes.join(" ")).toContain("[COMPLETION_POLICY]");
  });

  it("a messaging effect nobody can deliver is NOT verified, and the run says so", async () => {
    // THE CASE THIS PHASE EXISTS FOR. With no notification channel configured
    // in this environment, the intent's own state is BLOCKED_BY_PROVIDER. The
    // capability returns successfully, its output shape is valid, and before
    // the completion policy the attempt came out VERIFIED.
    const { run, attempt, node } = await runOneNode({
      key: "message-step",
      capabilityId: "notify",
      inputs: {
        recipientId: "recipient-1",
        purpose: "update",
        title: "عنوان",
        body: "نص",
      },
    });

    // The step executed: that part was always true and is still recorded.
    expect(attempt!.executionStatus).toBe("COMPLETED");
    // The effect did not: that part is new.
    expect(attempt!.verificationStatus).not.toBe("VERIFIED");

    const detail = attempt!.verificationDetail as Record<string, any>;
    expect(detail.completion.effectKind).toBe("MESSAGE_DISPATCH");
    expect(detail.completion.decision).not.toBe("VERIFIED");
    // Nothing accepted the executor's word, and the ledger says which sources
    // would have been accepted.
    expect(detail.completion.assertions.map((entry: any) => entry.source)).not.toContain(
      "INDEPENDENT_READBACK",
    );

    // And the run-level truth follows, with no separate bookkeeping:
    const receipt = await buildRunReceipt(run.id, ownerId);
    expect(receipt.verificationStatus).not.toBe("VERIFIED");
    expect(receipt.status).not.toBe("verified");

    // The node's own fate is recorded either way — what must never happen is a
    // verified receipt for an effect that did not occur.
    expect(["COMPLETED", "FAILED"]).toContain(node!.status);
  });

  it("an unconfirmed effect leaves a readable trail rather than a silent pass", async () => {
    const { run, attempt } = await runOneNode({
      key: "message-trail",
      capabilityId: "notify",
      inputs: {
        recipientId: "recipient-2",
        purpose: "update",
        title: "عنوان",
        body: "نص",
      },
    });
    const events = await handle.db.select().from(runEvents).where(eq(runEvents.runId, run.id));
    const types = events.map((entry) => entry.type);
    // Either the effect was refused (the node fails and says so) or it is
    // awaiting confirmation (the node completes and says so). Both are
    // recorded; neither is silence.
    const detail = attempt!.verificationDetail as Record<string, any>;
    if (detail.completion.decision === "PENDING") {
      expect(types).toContain("EFFECT_AWAITING_CONFIRMATION");
      const event = events.find((entry) => entry.type === "EFFECT_AWAITING_CONFIRMATION")!;
      // The event that reports an effect must not assert the step had none.
      expect((event.payload as Record<string, unknown>).effects).toBe("external");
    } else {
      expect(detail.completion.reasonCode).toBe("EFFECT_DID_NOT_OCCUR");
    }
  });

  it("two effect classes in one run resolve independently", async () => {
    const run = await createRuntimeRun({
      ownerId,
      goal: "mixed effect classes",
      idempotencyKey: "effect-truth-mixed",
    });
    await createRuntimeDag({
      ownerId,
      runId: run.id,
      nodes: [
        { nodeKey: "calc", capabilityId: "local-calculation", inputs: { values: [1, 1] }, maxAttempts: 1 },
        {
          nodeKey: "tell",
          capabilityId: "notify",
          inputs: { recipientId: "r3", purpose: "update", title: "ع", body: "ن" },
          maxAttempts: 1,
        },
      ],
    });
    await driveRunToCompletion(run.id, ownerId, "effect-truth-worker");

    const attempts = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    const byCapability = new Map(attempts.map((entry) => [entry.capabilityId, entry]));
    expect(byCapability.get("local-calculation")!.verificationStatus).toBe("VERIFIED");
    expect(byCapability.get("notify")!.verificationStatus).not.toBe("VERIFIED");

    // One unverified effect is enough to withhold the run's receipt. A partial
    // truth reported as a whole one is the failure mode being prevented.
    const receipt = await buildRunReceipt(run.id, ownerId);
    expect(receipt.verificationStatus).not.toBe("VERIFIED");
  });
});
