/**
 * Phase 1 — P0 Cross-Owner Security Proof
 *
 * Exit gate requirements:
 *   CONVERSATION_HISTORY_CROSS_OWNER=BLOCKED
 *   SEED_APPROVAL_CROSS_OWNER=BLOCKED
 *   EVENT_WRITE_CROSS_OWNER=BLOCKED
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const OWNER_A = "1";
const OWNER_B = "2";

async function run() {
  const runtimeUrl = pathToFileURL(
    path.resolve(process.cwd(), "../canonical/جاسم/app/api/runtime/jasim-runtime.ts"),
  ).href;

  const runtime = (await import(runtimeUrl)) as {
    createRuntimeConversation(input: { ownerId: string; title?: string }): Promise<{ id: string }>;
    createRuntimeRun(input: {
      ownerId: string; goal: string; idempotencyKey: string; conversationId?: string;
    }): Promise<{ id: string; status: string }>;
    createRuntimeMessage(input: {
      ownerId: string; conversationId: string; role: string; content: string;
    }): Promise<{ id: string }>;
    seedAuthorizedProposalApproval(input: {
      ownerId: string; runId: string; fingerprint: string; intentType?: string; capabilityId?: string;
    }): Promise<{ proposalId: string; approvalId: string }>;
    createRuntimeSemanticEvent(input: {
      type: string; ownerId: string; runId?: string; conversationId?: string;
      payload: Record<string, unknown>; message?: string;
    }): Promise<void>;
  };

  console.log("\n=== Phase 1 Security Proof ===\n");

  // Setup
  const convA = await runtime.createRuntimeConversation({ ownerId: OWNER_A, title: "Owner A's private conversation" });
  console.log(`[SETUP] Owner A conversation: ${convA.id}`);

  const runA = await runtime.createRuntimeRun({
    ownerId: OWNER_A, goal: "Owner A's private goal",
    idempotencyKey: `phase1-sec-run-${Date.now()}`, conversationId: convA.id,
  });
  console.log(`[SETUP] Owner A run: ${runA.id}`);

  await runtime.createRuntimeMessage({
    ownerId: OWNER_A, conversationId: convA.id, role: "user",
    content: "Secret message from Owner A",
  });

  let pass = 0; let fail = 0;

  // ── Test 1: Cross-owner message creation blocked ──────────────────────────
  console.log("\n[TEST 1] Cross-owner conversation message creation...");
  try {
    await runtime.createRuntimeMessage({
      ownerId: OWNER_B, conversationId: convA.id, role: "user",
      content: "Owner B injecting into Owner A's conversation",
    });
    console.log("❌ FAIL: Should have thrown RuntimeAccessError");
    fail++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("access")) {
      console.log("✅ PASS: Cross-owner message creation blocked:", msg.slice(0, 80));
      console.log("   CONVERSATION_HISTORY_CROSS_OWNER=BLOCKED");
      pass++;
    } else {
      console.log("❌ FAIL: Wrong error:", msg.slice(0, 100));
      fail++;
    }
  }

  // ── Test 2: Cross-owner proposal seeding blocked ──────────────────────────
  console.log("\n[TEST 2] Cross-owner proposal seeding...");
  try {
    await runtime.seedAuthorizedProposalApproval({
      ownerId: OWNER_B, runId: runA.id,
      fingerprint: `cross-owner-test-${Date.now()}`,
    });
    console.log("❌ FAIL: Should have thrown RuntimeAccessError");
    fail++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("access")) {
      console.log("✅ PASS: Cross-owner proposal seeding blocked:", msg.slice(0, 80));
      console.log("   SEED_APPROVAL_CROSS_OWNER=BLOCKED");
      pass++;
    } else {
      console.log("❌ FAIL: Wrong error:", msg.slice(0, 100));
      fail++;
    }
  }

  // ── Test 3: Cross-owner semantic event blocked ────────────────────────────
  console.log("\n[TEST 3] Cross-owner semantic event injection...");
  try {
    await runtime.createRuntimeSemanticEvent({
      type: "RUN_CREATED", ownerId: OWNER_B, runId: runA.id,
      payload: { test: true },
    });
    console.log("❌ FAIL: Should have thrown RuntimeAccessError");
    fail++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("access")) {
      console.log("✅ PASS: Cross-owner event injection blocked:", msg.slice(0, 80));
      console.log("   EVENT_WRITE_CROSS_OWNER=BLOCKED");
      pass++;
    } else {
      console.log("❌ FAIL: Wrong error:", msg.slice(0, 100));
      fail++;
    }
  }

  // ── Test 4: Same-owner operations still work (regression) ────────────────
  console.log("\n[TEST 4] Same-owner operations (regression check)...");
  try {
    await runtime.createRuntimeSemanticEvent({
      type: "RUN_CREATED", ownerId: OWNER_A, runId: runA.id,
      payload: { test: true }, message: "Same-owner event — should succeed",
    });
    const msg2 = await runtime.createRuntimeMessage({
      ownerId: OWNER_A, conversationId: convA.id, role: "assistant",
      content: "Regression test passed",
    });
    if (msg2.id) {
      console.log("✅ PASS: Same-owner operations unaffected");
      pass++;
    }
  } catch (err) {
    console.log("❌ FAIL: Same-owner operation threw:", err instanceof Error ? err.message.slice(0, 100) : String(err));
    fail++;
  }

  console.log(`\n=== Phase 1 Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log("❌ Phase 1 FAILED");
    process.exit(1);
  }

  console.log("✅ Phase 1 COMPLETE");
  console.log("CONVERSATION_HISTORY_CROSS_OWNER=BLOCKED");
  console.log("SEED_APPROVAL_CROSS_OWNER=BLOCKED");
  console.log("EVENT_WRITE_CROSS_OWNER=BLOCKED");
  process.exit(0);
}

void run().catch((err) => { console.error(err); process.exit(1); });
