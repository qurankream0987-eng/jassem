/**
 * JASIM Phase H Proof — Receipt + Verifier + Reconciliation
 *
 * Proves the post-execution reconciliation loop:
 *   1. Full flow: create run → seed proposal → resume (F) → execute (G)
 *   2. buildRunReceipt → receipt.status = "verified", outputs populated
 *   3. reconcileRunToConversation → runs.outputs updated, assistant message posted
 *   4. Verify RUN_RECONCILED + RUN_OUTPUTS_PERSISTED semantic events
 *   5. Verify assistant message in conversation with outputKind "run_receipt"
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
    createRuntimeConversation(input: { ownerId: string; title?: string }): Promise<{ id: string }>;

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

    resumeApprovedPlan(proposalId: string, ownerId: string): Promise<{ id: string; status: string }>;
    executeApprovedRun(runId: string, ownerId: string): Promise<{ id: string; status: string }>;

    buildRunReceipt(runId: string, ownerId: string): Promise<{
      runId: string;
      status: string;
      completedAt: string;
      nodeCount: number;
      completedNodes: number;
      outputs: Array<{ nodeKey: string; capabilityId: string; output: Record<string, unknown> }>;
      aggregatedOutput: Record<string, unknown>;
      verifierNotes: string[];
    }>;

    reconcileRunToConversation(runId: string, ownerId: string): Promise<{
      runId: string;
      status: string;
      completedNodes: number;
      nodeCount: number;
      outputs: Array<{ nodeKey: string; capabilityId: string; output: Record<string, unknown> }>;
      aggregatedOutput: Record<string, unknown>;
    }>;

    getRuntimeRun(runId: string, ownerId: string): Promise<{
      id: string;
      status: string;
      outputs: Record<string, unknown>;
      conversationId: string | null;
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    }>;

    listRuntimeSemanticEvents(input: {
      ownerId: string;
      eventType?: string;
      limit?: number;
    }): Promise<Array<{ id: number; type: string; payload: Record<string, unknown>; runId: string | null }>>;

    listRuntimeMessages(input: {
      ownerId: string;
      conversationId: string;
    }): Promise<Array<{ role: string; content: string; outputKind: string | null; metadata: Record<string, unknown> }>>;
  };

  const TEST_USER_ID = "1";
  const fingerprint = `proof-h-${randomUUID().replace(/-/g, "").substring(0, 16)}`;
  const normalizedInputs = { values: [5, 10, 15, 20], operation: "sum" };

  // ── Step 1: Full setup — conversation + run + proposal + approval ─────────
  const conversation = await runtime.createRuntimeConversation({
    ownerId: TEST_USER_ID,
    title: "Phase H Proof Conversation",
  });

  const run = await runtime.createRuntimeRun({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
    goal: "Calculate sum of test values",
    idempotencyKey: `phase-h-proof-${fingerprint}`,
    status: "blocked",
    requiredCapabilities: ["local-calculation"],
  });
  assert(run.status === "blocked", `Expected blocked, got: ${run.status}`);

  const { proposalId } = await runtime.seedAuthorizedProposalApproval({
    ownerId: TEST_USER_ID,
    runId: run.id,
    conversationId: conversation.id,
    fingerprint,
    capabilityId: "local-calculation",
    normalizedInputs,
  });

  // Phase F + G: resume → execute
  await runtime.resumeApprovedPlan(proposalId, TEST_USER_ID);
  const completedRun = await runtime.executeApprovedRun(run.id, TEST_USER_ID);
  assert(
    completedRun.status === "completed",
    `Run must complete before Phase H, got: "${completedRun.status}"`,
  );

  // ── Step 2: Build receipt (read-only) ────────────────────────────────────
  const receipt = await runtime.buildRunReceipt(run.id, TEST_USER_ID);
  assert(
    receipt.runId === run.id,
    "Receipt must reference the correct run",
  );
  assert(
    receipt.status === "verified",
    `Receipt status must be "verified", got: "${receipt.status}"`,
  );
  assert(receipt.nodeCount > 0, "Receipt must count at least one node");
  assert(
    receipt.completedNodes === receipt.nodeCount,
    `All nodes must be completed (${receipt.completedNodes}/${receipt.nodeCount})`,
  );
  assert(receipt.outputs.length > 0, "Receipt must include at least one node output");

  // Verify local-calculation output structure
  const calcOutput = receipt.outputs[0]!;
  assert(
    calcOutput.capabilityId === "local-calculation",
    `Expected local-calculation capability, got: ${calcOutput.capabilityId}`,
  );
  const calcResult =
    calcOutput.output.result &&
    typeof calcOutput.output.result === "object" &&
    !Array.isArray(calcOutput.output.result)
      ? (calcOutput.output.result as Record<string, unknown>)
      : calcOutput.output;
  assert(
    typeof (calcResult.sum as number) === "number",
    "local-calculation output must include a numeric sum",
  );
  assert(
    (calcResult.sum as number) === 50,
    `Expected sum = 50 (5+10+15+20), got: ${calcResult.sum}`,
  );

  assert(
    receipt.aggregatedOutput[calcOutput.nodeKey] !== undefined,
    "Aggregated output must include node output keyed by nodeKey",
  );
  assert(
    receipt.verifierNotes.length === 0,
    `Verifier notes must be empty for a clean run, got: ${receipt.verifierNotes.join(", ")}`,
  );

  // ── Step 3: Reconcile run to conversation ────────────────────────────────
  const finalReceipt = await runtime.reconcileRunToConversation(run.id, TEST_USER_ID);
  assert(
    finalReceipt.status === "verified",
    `Final receipt must be verified, got: "${finalReceipt.status}"`,
  );

  // ── Step 4: Verify runs.outputs was updated ───────────────────────────────
  const updatedRun = await runtime.getRuntimeRun(run.id, TEST_USER_ID);
  assert(
    Object.keys(updatedRun.outputs).length > 0,
    "runs.outputs must be populated after reconciliation",
  );

  // ── Step 5: Verify RUN_RECONCILED semantic event ─────────────────────────
  const reconciledEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    eventType: "RUN_RECONCILED",
    limit: 20,
  });
  const reconciledEvent = reconciledEvents.find(
    (e) => e.runId === run.id || (e.payload.runId as string) === run.id,
  );
  assert(
    reconciledEvent !== undefined,
    "RUN_RECONCILED event must be emitted after reconciliation",
  );
  assert(
    (reconciledEvent.payload.receiptStatus as string) === "verified",
    "Event must record receiptStatus = verified",
  );
  assert(
    (reconciledEvent.payload.messagePosted as boolean) === true,
    "Event must indicate an assistant message was posted",
  );

  // ── Step 6: Verify RUN_OUTPUTS_PERSISTED event ────────────────────────────
  const persistedEvents = await runtime.listRuntimeSemanticEvents({
    ownerId: TEST_USER_ID,
    eventType: "RUN_OUTPUTS_PERSISTED",
    limit: 20,
  });
  const persistedEvent = persistedEvents.find((e) => e.runId === run.id);
  assert(
    persistedEvent !== undefined,
    "RUN_OUTPUTS_PERSISTED event must be emitted",
  );

  // ── Step 7: Verify assistant message in conversation ─────────────────────
  const messages = await runtime.listRuntimeMessages({
    ownerId: TEST_USER_ID,
    conversationId: conversation.id,
  });
  const receiptMessage = messages.find(
    (m) =>
      m.role === "assistant" &&
      m.outputKind === "run_receipt",
  );
  assert(
    receiptMessage !== undefined,
    "An assistant message with outputKind='run_receipt' must be posted to the conversation",
  );
  assert(
    (receiptMessage.metadata.runId as string) === run.id,
    "Receipt message metadata must reference the correct run",
  );

  console.log("JASIM Phase H — Receipt + Verifier + Reconciliation proof passed.");
}

run().catch((err) => {
  console.error("JASIM Phase H proof FAILED:", err.message ?? err);
  process.exit(1);
});
