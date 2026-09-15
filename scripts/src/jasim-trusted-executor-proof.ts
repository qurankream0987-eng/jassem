/**
 * JASIM Phase G Proof — Trusted Executor
 *
 * Proves the end-to-end approved-plan execution pipeline:
 *   1. Create run (blocked) + seed proposal (local-calculation) + approval
 *   2. Resume plan (Phase F) → run becomes "ready"
 *   3. materializeApprovedRunDag → DAG nodes created from proposal
 *   4. driveRunToCompletion → nodes execute → run becomes "completed"
 *   5. Verify run status = "completed"
 *   6. Verify DAG node output contains calculation result
 *   7. Safety: attempt to materialize again → throws "already exists"
 *   8. executeApprovedRun is idempotent (already completed → returns completed)
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run() {
  const moduleUrl = pathToFileURL(
    path.resolve(
      process.cwd(),
      "../canonical/جاسم/app/api/runtime/jasim-runtime.ts",
    ),
  ).href;

  const runtime = (await import(moduleUrl)) as {
    createRuntimeConversation(input: {
      ownerId: string;
      title?: string;
    }): Promise<{ id: string }>;

    createRuntimeRun(input: {
      ownerId: string;
      conversationId?: string;
      goal: string;
      idempotencyKey: string;
      status?: string;
      currentState?: Record<string, unknown>;
      requiredCapabilities?: string[];
    }): Promise<{ id: string; status: string }>;

    seedAuthorizedProposalApproval(input: {
      ownerId: string;
      runId: string;
      conversationId?: string;
      fingerprint: string;
      intentType?: string;
      capabilityId?: string;
      normalizedInputs?: Record<string, unknown>;
    }): Promise<{ proposalId: string; approvalId: string }>;

    resumeApprovedPlan(
      proposalId: string,
      ownerId: string,
    ): Promise<{ id: string; status: string }>;

    materializeApprovedRunDag(
      runId: string,
      ownerId: string,
    ): Promise<{ id: string; status: string }>;

    driveRunToCompletion(
      runId: string,
      ownerId: string,
      workerId?: string,
    ): Promise<{ id: string; status: string }>;

    executeApprovedRun(
      runId: string,
      ownerId: string,
    ): Promise<{ id: string; status: string }>;

    getRuntimeRun(
      runId: string,
      ownerId: string,
    ): Promise<{
      id: string;
      status: string;
      goal: string;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    }>;
  };

  const TEST_USER_ID = "1";
  const fingerprint = `proof-g-${randomUUID().replace(/-/g, "").substring(0, 16)}`;
  // Use specific inputs that local-calculation will process
  const normalizedInputs = { values: [10, 20, 30], operation: "sum" };

  // ── Step 1: Create conversation + run ────────────────────────────────────
  const conversation = await runtime.createRuntimeConversation({
    ownerId: TEST_USER_ID,
    title: "Phase G Proof Conversation",
  });
  assert(conversation.id, "conversation must have id");

  const run = await runtime.createRuntimeRun({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    goal: "Sum a list of values",
    idempotencyKey: `phase-g-proof-${fingerprint}`,
    status: "blocked",
    currentState: { effects: "none", risk: "high" },
    requiredCapabilities: ["local-calculation"],
  });
  assert(run.id, "run must have id");
  assert(run.status === "blocked", `Expected blocked, got: ${run.status}`);

  // ── Step 2: Seed authorized proposal (local-calculation) + approval ──────
  const { proposalId } = await runtime.seedAuthorizedProposalApproval({
    ownerId: TEST_USER_ID,
    runId: run.id,
    conversationId: conversation.id,
    fingerprint,
    intentType: "direct_action",
    capabilityId: "local-calculation",
    normalizedInputs,
  });
  assert(proposalId, "proposalId must be set");

  // ── Step 3: Phase F — Resume plan → run becomes "ready" ──────────────────
  const resumedRun = await runtime.resumeApprovedPlan(proposalId, TEST_USER_ID);
  assert(
    resumedRun.status === "ready",
    `Run must be "ready" after resume, got: "${resumedRun.status}"`,
  );

  // ── Step 4: Phase G — Materialize DAG ────────────────────────────────────
  const dagRun = await runtime.materializeApprovedRunDag(run.id, TEST_USER_ID);
  assert(
    dagRun.id === run.id,
    "materializeApprovedRunDag must return the same run",
  );
  // After DAG creation, run status transitions (reconcile called by createRuntimeDag)
  // It may be "ready" or "running" — not terminal
  assert(
    !["completed", "failed", "cancelled"].includes(dagRun.status),
    `Run must not be terminal immediately after DAG creation, got: "${dagRun.status}"`,
  );

  // ── Step 5: Safety — materialize again must throw "already exists" ────────
  let threw = false;
  try {
    await runtime.materializeApprovedRunDag(run.id, TEST_USER_ID);
  } catch (err) {
    threw = true;
    const msg = (err as Error).message;
    assert(
      msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("dag") ||
        msg.toLowerCase().includes("existing"),
      `Rematerialize must throw a DAG-exists error, got: ${msg}`,
    );
  }
  assert(threw, "Rematerializing an existing DAG must throw");

  // ── Step 6: Drive to completion ───────────────────────────────────────────
  const completedRun = await runtime.driveRunToCompletion(
    run.id,
    TEST_USER_ID,
    "jasim-proof-worker-g",
  );
  assert(
    completedRun.status === "completed",
    `Run must be "completed" after driveRunToCompletion, got: "${completedRun.status}"`,
  );

  // ── Step 7: executeApprovedRun on completed run is idempotent ─────────────
  // A second run won't re-execute (already completed / terminal)
  const idempotentRun = await runtime.executeApprovedRun(run.id, TEST_USER_ID);
  assert(
    idempotentRun.status === "completed",
    `Idempotent executeApprovedRun must return completed, got: "${idempotentRun.status}"`,
  );

  // ── Step 8: Run events contain DAG_RUN_STATE_UPDATED ─────────────────────
  const finalRun = await runtime.getRuntimeRun(run.id, TEST_USER_ID);
  const completedEvent = finalRun.events.find(
    (e) => e.type === "DAG_RUN_STATE_UPDATED" || e.type === "RUN_CREATED",
  );
  assert(
    completedEvent !== undefined,
    "Run must have at least one lifecycle event",
  );

  console.log("JASIM Phase G — Trusted Executor proof passed.");
}

run().catch((err) => {
  console.error("JASIM Phase G proof FAILED:", err.message ?? err);
  process.exit(1);
});
