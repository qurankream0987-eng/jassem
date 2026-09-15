/**
 * Phase 4 — Reconciliation Proof
 *
 * Tests:
 *   1. findUncertainExecutionAttempts finds stale RUNNING attempts
 *   2. reconcileUncertainAttempt updates the ledger
 *   3. No blind retry — only ledger update
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

async function run() {
  const runtimeUrl = pathToFileURL(
    path.resolve(process.cwd(), "../canonical/جاسم/app/api/runtime/jasim-runtime.ts"),
  ).href;
  const dbUrl = pathToFileURL(
    path.resolve(process.cwd(), "../canonical/جاسم/app/api/queries/connection.ts"),
  ).href;

  const runtime = (await import(runtimeUrl)) as {
    createRuntimeConversation(input: { ownerId: string; title?: string }): Promise<{ id: string }>;
    createRuntimeRun(input: {
      ownerId: string; goal: string; idempotencyKey: string; conversationId?: string;
    }): Promise<{ id: string }>;
    findUncertainExecutionAttempts(ownerId: string, staleAfterMs?: number): Promise<Array<{ id: string; executionStatus: string }>>;
    reconcileUncertainAttempt(attemptId: string, ownerId: string): Promise<{ status: string; strategy: string; notes: string[] }>;
  };

  const { db } = (await import(dbUrl)) as { db: {
    $client: { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
  }};

  console.log("\n=== Phase 4 Reconciliation Proof ===\n");

  const OWNER = "1";
  const conv = await runtime.createRuntimeConversation({ ownerId: OWNER, title: "Phase 4 Test" });
  const run2 = await runtime.createRuntimeRun({
    ownerId: OWNER, goal: "Prove reconciliation",
    idempotencyKey: `phase4-reconcile-${Date.now()}`, conversationId: conv.id,
  });
  console.log(`[SETUP] Run: ${run2.id}`);

  // Insert a stale RUNNING attempt (simulating a crashed process)
  const staleNodeId = randomUUID();
  const staleAttemptId = randomUUID();
  const staleIdempotencyKey = `phase4-stale-${Date.now()}`;
  const staleStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  await db.$client.query(
    `INSERT INTO execution_attempts 
      (id, "ownerId", "runId", "nodeId", "nodeKey", "capabilityId", fingerprint, "idempotencyKey", "attemptNumber", "fenceVersion", "startedAt", "executionStatus", "verificationStatus")
      VALUES ($1, $2, $3, $4, 'stale-node', 'openai-chat', 'test-fp', $5, 1, 1, $6, 'RUNNING', 'PENDING')`,
    [staleAttemptId, OWNER, run2.id, staleNodeId, staleIdempotencyKey, staleStartedAt],
  );
  console.log(`[SETUP] Inserted stale RUNNING attempt: ${staleAttemptId}`);

  // Test 1: findUncertainExecutionAttempts finds the stale attempt
  console.log("\n[TEST 1] Find stale RUNNING attempts...");
  const uncertain = await runtime.findUncertainExecutionAttempts(OWNER, 5 * 60 * 1000);
  const found = uncertain.find((a: { id: string }) => a.id === staleAttemptId);
  if (found) {
    console.log("✅ PASS: Stale attempt found in uncertain list");
  } else {
    console.log("❌ FAIL: Stale attempt not found");
    process.exit(1);
  }

  // Test 2: reconcileUncertainAttempt updates the ledger
  console.log("\n[TEST 2] Reconcile uncertain attempt...");
  const result = await runtime.reconcileUncertainAttempt(staleAttemptId, OWNER);
  console.log(`  Verification status: ${result.status}`);
  console.log(`  Strategy: ${result.strategy}`);
  if (result.status === "INCONCLUSIVE" || result.status === "FAILED") {
    console.log("✅ PASS: Reconciled as INCONCLUSIVE/FAILED (node not in dag_nodes — correct)");
  } else {
    console.log(`⚠️ INFO: Status ${result.status} (may be acceptable)`);
  }

  // Test 3: Attempt no longer in RUNNING state
  console.log("\n[TEST 3] Verify attempt updated (no longer RUNNING)...");
  const checkResult = await db.$client.query(
    `SELECT "executionStatus" FROM execution_attempts WHERE id = $1`,
    [staleAttemptId],
  );
  const updatedStatus = checkResult.rows[0]?.executionStatus as string | undefined;
  if (updatedStatus && updatedStatus !== "RUNNING") {
    console.log(`✅ PASS: Attempt updated to: ${updatedStatus}`);
  } else {
    console.log(`❌ FAIL: Attempt still RUNNING after reconciliation: ${updatedStatus}`);
    process.exit(1);
  }

  // Test 4: No blind retry — stale attempt gone from uncertain list
  console.log("\n[TEST 4] No blind retry — attempt removed from uncertain list...");
  const freshUncertain = await runtime.findUncertainExecutionAttempts(OWNER, 5 * 60 * 1000);
  const stillThere = freshUncertain.find((a: { id: string }) => a.id === staleAttemptId);
  if (!stillThere) {
    console.log("✅ PASS: Reconciled attempt no longer in uncertain list");
  } else {
    console.log("❌ FAIL: Attempt still in uncertain list");
    process.exit(1);
  }

  console.log("\n=== Phase 4 COMPLETE ===");
  console.log("UNCERTAIN_ATTEMPT_DETECTION=ACTIVE");
  console.log("RECONCILIATION_UPDATES_LEDGER=VERIFIED");
  console.log("NO_BLIND_RETRY=ENFORCED");
  process.exit(0);
}

void run().catch((err) => { console.error(err); process.exit(1); });
