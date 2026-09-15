/**
 * JASIM Phase F Proof — Approval Resume
 *
 * Proves the approval-to-resume pipeline:
 *   1. Create a run with status "blocked"
 *   2. Seed an authorized proposal + approved approval via helper
 *   3. Call resumeApprovedPlan → run transitions blocked → "approved"
 *   4. Verify PLAN_RESUMED + PLAN_APPROVAL_CONSUMED events emitted
 *   5. Idempotency: calling resumeApprovedPlan twice throws
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
    }): Promise<{ id: string; status: string }>;

    seedAuthorizedProposalApproval(input: {
      ownerId: string;
      runId: string;
      conversationId?: string;
      fingerprint: string;
      intentType?: string;
      normalizedInputs?: Record<string, unknown>;
    }): Promise<{ proposalId: string; approvalId: string }>;

    resumeApprovedPlan(
      proposalId: string,
      ownerId: string,
    ): Promise<{ id: string; status: string }>;

    listRuntimeSemanticEvents(input: {
      ownerId: string;
      eventType?: string;
      limit?: number;
    }): Promise<
      Array<{
        id: number;
        type: string;
        payload: Record<string, unknown>;
        runId: string | null;
      }>
    >;
  };

  const TEST_USER_ID = "1";
  const fingerprint = `proof-fp-${randomUUID().replace(/-/g, "").substring(0, 16)}`;

  // ── Step 1: Create conversation ──────────────────────────────────────────
  const conversation = await runtime.createRuntimeConversation({
    ownerId: TEST_USER_ID,
    title: "Phase F Proof Conversation",
  });
  assert(conversation.id, "conversation must have id");

  // ── Step 2: Create run directly with status "blocked" ────────────────────
  const run = await runtime.createRuntimeRun({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    goal: "Test approval resume",
    idempotencyKey: `phase-f-proof-${fingerprint}`,
    status: "blocked",
    currentState: { effects: "none", risk: "high" },
  });
  assert(run.id, "run must have id");
  assert(
    run.status === "blocked",
    `Run must start with status "blocked", got: "${run.status}"`,
  );

  // ── Step 3: Seed authorized proposal + approved approval ─────────────────
  const { proposalId, approvalId } =
    await runtime.seedAuthorizedProposalApproval({
      ownerId: TEST_USER_ID,
      runId: run.id,
      conversationId: conversation.id,
      fingerprint,
      intentType: "direct_action",
      normalizedInputs: { query: "price check", test: true },
    });
  assert(proposalId, "proposalId must be set");
  assert(approvalId, "approvalId must be set");

  // ── Step 4: Resume the approved plan ─────────────────────────────────────
  const resumedRun = await runtime.resumeApprovedPlan(proposalId, TEST_USER_ID);
  assert(
    resumedRun.status === "ready",
    `Run must transition to "ready", got: "${resumedRun.status}"`,
  );

  // ── Step 5: Verify PLAN_RESUMED event was emitted atomically ─────────────
  const resumedEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    eventType: "PLAN_RESUMED",
    limit: 20,
  });
  const resumedEvent = resumedEvents.find(
    (e) => (e.payload.proposalId as string) === proposalId,
  );
  assert(
    resumedEvent !== undefined,
    "PLAN_RESUMED event must be emitted after resumeApprovedPlan",
  );
  assert(
    resumedEvent.runId === run.id,
    "PLAN_RESUMED event must reference the correct run",
  );
  assert(
    (resumedEvent.payload.previousStatus as string) === "blocked",
    "Event must record previousStatus = blocked",
  );
  assert(
    (resumedEvent.payload.resumedStatus as string) === "ready",
    "Event must record resumedStatus = ready",
  );

  // ── Step 6: Verify PLAN_APPROVAL_CONSUMED event ───────────────────────────
  const consumedEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    eventType: "PLAN_APPROVAL_CONSUMED",
    limit: 20,
  });
  const consumedEvent = consumedEvents.find(
    (e) => (e.payload.approvalId as string) === approvalId,
  );
  assert(
    consumedEvent !== undefined,
    "PLAN_APPROVAL_CONSUMED event must be emitted after resumeApprovedPlan",
  );
  assert(
    typeof (consumedEvent.payload.consumedAt as string) === "string",
    "Consumed event must record consumedAt timestamp",
  );

  // ── Step 7: Idempotency guard — second call must throw ────────────────────
  let threw = false;
  try {
    await runtime.resumeApprovedPlan(proposalId, TEST_USER_ID);
  } catch (err) {
    threw = true;
    const msg = (err as Error).message;
    assert(
      msg.includes("consumed") ||
        msg.includes("authorized") ||
        msg.includes("cannot be resumed") ||
        msg.includes("approved"),
      `Second resume must throw a guard error, got: ${msg}`,
    );
  }
  assert(threw, "Second call to resumeApprovedPlan must throw (idempotency guard)");

  console.log("JASIM Phase F — Approval Resume proof passed.");
}

run().catch((err) => {
  console.error("JASIM Phase F proof FAILED:", err.message ?? err);
  process.exit(1);
});
