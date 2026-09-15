/**
 * JASIM — Execution Attempt Ledger Immutability Proof
 *
 * Proves:
 *   ATTEMPT_1_PRESERVED   — failed attempt row untouched after retry
 *   ATTEMPT_2_CREATED     — second attempt creates a NEW row
 *   IMMUTABLE_HISTORY     — neither row is overwritten
 *   NO_OVERWRITE          — INSERT-only pattern
 *   FINGERPRINT_LINKAGE   — both share the same runId / nodeId
 *   IDEMPOTENCY_LINKAGE   — idempotency keys differ (fenceVersion embedded)
 *
 * Flow:
 *   1. createRuntimeRun(blocked) → seedProposal → resumeApprovedPlan → materializeDAG
 *   2. claimRuntimeDagNode → startRuntimeDagNode
 *   3. Insert attempt-1 row (FAILED) manually — mimics what executeRuntimeDagNode would do
 *   4. failRuntimeDagNode(RETRYABLE) → node → RETRY_SCHEDULED
 *   5. Wait 6s for retry delay → refreshRuntimeDag → node back to READY
 *   6. executeRuntimeDagNode → succeeds → attempt-2 row (COMPLETED)
 *   7. listNodeExecutionAttempts → verify BOTH rows intact
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

function chk(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✅ ${label}`);
  else console.error(`  ❌ ${label}${detail ? ": " + detail : ""}`);
  return ok;
}

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
      ownerId: string; goal: string; idempotencyKey: string;
      conversationId?: string; status?: string;
      currentState?: Record<string, unknown>;
      requiredCapabilities?: string[];
    }): Promise<{ id: string; status: string }>;
    seedAuthorizedProposalApproval(input: {
      ownerId: string; runId: string; conversationId?: string;
      fingerprint: string; intentType?: string;
      capabilityId?: string; normalizedInputs?: Record<string, unknown>;
    }): Promise<{ proposalId: string; approvalId: string }>;
    resumeApprovedPlan(proposalId: string, ownerId: string): Promise<{ id: string; status: string }>;
    materializeApprovedRunDag(runId: string, ownerId: string): Promise<{ id: string; status: string }>;
    claimRuntimeDagNode(input: { ownerId: string; runId: string; workerId: string; leaseDurationMs?: number }): Promise<{ id: string; leaseToken: string; fenceVersion: number } | null>;
    startRuntimeDagNode(input: { ownerId: string; nodeId: string; workerId: string; leaseToken: string; fenceVersion: number }): Promise<{ id: string; leaseToken: string; fenceVersion: number }>;
    failRuntimeDagNode(input: {
      ownerId: string; nodeId: string; workerId: string;
      leaseToken: string; fenceVersion: number;
      errorCode: "RETRYABLE" | "PERMANENT" | "AUTHORIZATION" | "POLICY" | "INPUT" | "STALE" | "CANCELLED";
      summary: string;
    }): Promise<unknown>;
    executeRuntimeDagNode(input: { ownerId: string; runId: string; workerId: string }): Promise<unknown>;
    listNodeExecutionAttempts(nodeId: string, ownerId: string): Promise<Array<{
      id: string; attemptNumber: number; executionStatus: string; verificationStatus: string;
      idempotencyKey: string; fenceVersion: number; runId: string; nodeId: string;
      startedAt: Date | null; finishedAt: Date | null;
    }>>;
  };

  const { db } = (await import(dbUrl)) as { db: {
    $client: { query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
  }};

  console.log("\n=== Execution Attempt Ledger Immutability Proof ===\n");

  const OWNER = "1";
  const WORKER = "immutability-proof-worker";
  const FP = `immut-fp-${Date.now()}`;
  let pass = 0; let fail = 0;

  const check_ = (label: string, ok: boolean, detail?: string) => {
    if (chk(label, ok, detail)) pass++; else fail++;
    return ok;
  };

  // ── Setup: blocked run → proposal → resume → DAG ────────────────────────
  const conv = await runtime.createRuntimeConversation({ ownerId: OWNER, title: "Immutability Proof" });
  const runObj = await runtime.createRuntimeRun({
    ownerId: OWNER, goal: "Prove attempt immutability",
    idempotencyKey: `immut-proof-${Date.now()}`,
    conversationId: conv.id,
    status: "blocked",
    currentState: { effects: "none", risk: "high" },
    requiredCapabilities: ["local-calculation"],
  });
  console.log(`[SETUP] Run: ${runObj.id} status=${runObj.status}`);

  const { proposalId } = await runtime.seedAuthorizedProposalApproval({
    ownerId: OWNER, runId: runObj.id, conversationId: conv.id,
    fingerprint: FP,
    intentType: "direct_action",
    capabilityId: "local-calculation",
    normalizedInputs: { operation: "sum", values: [10, 20, 30] },
  });
  console.log(`[SETUP] Proposal: ${proposalId}`);

  const resumedRun = await runtime.resumeApprovedPlan(proposalId, OWNER);
  console.log(`[SETUP] After resume: status=${resumedRun.status}`);

  const dagRun = await runtime.materializeApprovedRunDag(runObj.id, OWNER);
  console.log(`[SETUP] After materialize: status=${dagRun.status}`);

  // ── Attempt 1: Claim → Start → Insert FAILED record → Fail RETRYABLE ──────
  console.log("\n[ATTEMPT 1] Claim node → Start → Insert FAILED attempt → RETRYABLE fail");
  const claim1 = await runtime.claimRuntimeDagNode({
    ownerId: OWNER, runId: runObj.id, workerId: WORKER, leaseDurationMs: 30_000,
  });

  if (!claim1) {
    console.error("❌ Could not claim node — DAG has no READY node");
    process.exit(1);
  }
  console.log(`  Claimed nodeId: ${claim1.id}  fenceVersion=${claim1.fenceVersion}`);
  const nodeId = claim1.id;

  const started1 = await runtime.startRuntimeDagNode({
    ownerId: OWNER, nodeId, workerId: WORKER,
    leaseToken: claim1.leaseToken, fenceVersion: claim1.fenceVersion,
  });
  console.log(`  Started: fenceVersion=${started1.fenceVersion}`);

  // Insert the FAILED attempt record (mimics executeRuntimeDagNode's Phase 2 tracking)
  const attempt1Id = randomUUID();
  const ikey1 = `${runObj.id}:${nodeId}:${started1.fenceVersion}`;
  await db.$client.query(
    `INSERT INTO execution_attempts
       (id, "ownerId", "runId", "nodeId", "nodeKey", "capabilityId",
        fingerprint, "idempotencyKey", "attemptNumber", "fenceVersion",
        "startedAt", "finishedAt", "executionStatus", "verificationStatus",
        "normalizedError")
     VALUES ($1,$2,$3,$4,'step-0','local-calculation',$5,$6,$7,$8,
             NOW() - INTERVAL '5 seconds', NOW(),
             'FAILED','FAILED',
             '{"message":"Simulated transient failure for immutability proof"}')`,
    [attempt1Id, OWNER, runObj.id, nodeId, FP, ikey1,
     started1.fenceVersion, started1.fenceVersion],
  );
  console.log(`  Inserted FAILED attempt1: ${attempt1Id}`);

  // Fail node with RETRYABLE so it goes to RETRY_SCHEDULED → back to READY
  await runtime.failRuntimeDagNode({
    ownerId: OWNER, nodeId, workerId: WORKER,
    leaseToken: started1.leaseToken, fenceVersion: started1.fenceVersion,
    errorCode: "RETRYABLE",
    summary: "Transient failure for immutability proof — expecting retry",
  });
  console.log("  Node failed with RETRYABLE → RETRY_SCHEDULED");

  // ── Wait for retry delay (5s × attemptCount = 5s) ─────────────────────────
  console.log("\n[WAIT] 6.5s for retry delay...");
  await new Promise((r) => setTimeout(r, 6_500));

  // ── Attempt 2: executeRuntimeDagNode (full path — creates its own attempt) ──
  console.log("\n[ATTEMPT 2] executeRuntimeDagNode → COMPLETED");
  try {
    await runtime.executeRuntimeDagNode({ ownerId: OWNER, runId: runObj.id, workerId: WORKER });
    console.log("  Node executed");
  } catch (err) {
    console.log(`  Note: ${err instanceof Error ? err.message.slice(0, 100) : err}`);
  }

  // ── Verify: Both rows exist, attempt 1 unchanged ──────────────────────────
  console.log("\n[VERIFY] Reading execution_attempts for this node...");
  const attempts = await runtime.listNodeExecutionAttempts(nodeId, OWNER);
  console.log(`  Total rows found: ${attempts.length}`);
  for (const a of attempts) {
    console.log(`    id=${a.id.slice(0, 8)}… attempt#${a.attemptNumber} status=${a.executionStatus} ikey=…${a.idempotencyKey.slice(-10)}`);
  }

  const a1 = attempts.find((a) => a.id === attempt1Id);
  const a2 = attempts.find((a) => a.id !== attempt1Id);

  check_("ATTEMPT_1_PRESERVED — original FAILED row still present", !!a1);
  check_("ATTEMPT_1_STATUS_UNCHANGED — still FAILED", a1?.executionStatus === "FAILED");
  check_("ATTEMPT_1_IKEY_UNCHANGED — idempotencyKey intact", a1?.idempotencyKey === ikey1);

  check_("ATTEMPT_2_CREATED — second row exists", !!a2);
  if (a2) {
    check_("ATTEMPT_2_DIFFERENT_ID — distinct attemptId", a2.id !== attempt1Id);
    check_("ATTEMPT_2_HIGHER_FENCE — fenceVersion incremented", a2.fenceVersion > started1.fenceVersion);
    check_("IDEMPOTENCY_LINKAGE — ikeys differ", a1?.idempotencyKey !== a2.idempotencyKey);
    check_("FINGERPRINT_LINKAGE — same runId", a2.runId === runObj.id);
    check_("FINGERPRINT_LINKAGE — same nodeId", a2.nodeId === nodeId);
  } else {
    fail += 5;
  }
  check_("NO_OVERWRITE — two distinct rows", attempts.length >= 2);
  check_("IMMUTABLE_HISTORY — attempt1 finishedAt set (not wiped)", a1?.finishedAt !== null);

  console.log(`\n=== Immutability Proof Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log("❌ FAILED"); process.exit(1); }

  console.log("✅ ATTEMPT_LEDGER_IMMUTABILITY=PROVEN");
  console.log("ATTEMPT_1_PRESERVED=PASS");
  console.log("ATTEMPT_2_CREATED=PASS");
  console.log("IMMUTABLE_HISTORY=PASS");
  console.log("NO_OVERWRITE=PASS");
  console.log("FINGERPRINT_LINKAGE=PASS");
  console.log("IDEMPOTENCY_LINKAGE=PASS");
  process.exit(0);
}

void run().catch((err) => { console.error(err); process.exit(1); });
