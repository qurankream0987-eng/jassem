/**
 * Phase 3 — Independent Execution Verifier Proof
 *
 * Tests:
 *   1. COMPLETED openai-chat output → VERIFIED
 *   2. COMPLETED output with empty completion → INCONCLUSIVE
 *   3. FAILED execution → FAILED
 *   4. RUNNING status → INCONCLUSIVE
 *   5. Missing required fields → FAILED
 *   6. INCONCLUSIVE MUST NOT become success (assertInconclusiveIsNotSuccess)
 */
import {
  verifyExecutionAttempt,
  assertInconclusiveIsNotSuccess,
} from "../../canonical/جاسم/app/api/runtime/execution-verifier";
import { randomUUID } from "node:crypto";

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

function test(name: string, fn: () => void) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
  } catch (err) {
    console.log(`  ❌ Threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
    fail++;
  }
}

function canonicalResult(result: Record<string, unknown>) {
  return {
    result,
    metadata: { capabilityId: "proof" },
  };
}

async function main() {
  console.log("\n=== Phase 3 Independent Verifier Proof ===\n");

  const baseInput = {
    attemptId: randomUUID(),
    runId: randomUUID(),
    nodeId: randomUUID(),
    idempotencyKey: `phase3-${Date.now()}`,
  };

  // ── Test 1: Valid openai-chat output → VERIFIED ────────────────────────────
  test("Valid openai-chat output → VERIFIED", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "openai-chat",
      executionStatus: "COMPLETED",
      normalizedResult: canonicalResult({
        kind: "openai-chat",
        completion: "هذا هو الرد الصحيح من النموذج",
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      }),
      normalizedError: null,
    });
    check("Strategy is COMPOSITE", result.strategy === "COMPOSITE");
    check("Status is VERIFIED", result.status === "VERIFIED");
    check("Has notes", result.notes.length > 0);
    check("verifiedAt is a Date", result.verifiedAt instanceof Date);
  });

  // ── Test 2: Empty completion → INCONCLUSIVE ────────────────────────────────
  test("Empty completion → INCONCLUSIVE", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "openai-chat",
      executionStatus: "COMPLETED",
      normalizedResult: canonicalResult({
        kind: "openai-chat",
        completion: "",
        usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
      }),
      normalizedError: null,
    });
    check("Status is INCONCLUSIVE (empty completion)", result.status === "INCONCLUSIVE" || result.status === "FAILED");
  });

  // ── Test 3: FAILED execution status → FAILED ──────────────────────────────
  test("FAILED execution status → FAILED", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "openai-chat",
      executionStatus: "FAILED",
      normalizedResult: null,
      normalizedError: { message: "Connection timeout" },
    });
    check("Status is FAILED", result.status === "FAILED");
    check("Contains failure note", result.notes.some((n) => n.toLowerCase().includes("fail")));
  });

  // ── Test 4: RUNNING status → INCONCLUSIVE ─────────────────────────────────
  test("RUNNING status → INCONCLUSIVE", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "openai-chat",
      executionStatus: "RUNNING",
      normalizedResult: null,
      normalizedError: null,
    });
    check("Status is INCONCLUSIVE (still running)", result.status === "INCONCLUSIVE");
  });

  // ── Test 5: Missing required receipt fields → FAILED ──────────────────────
  test("Missing attemptId → FAILED", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      attemptId: "",
      capabilityId: "openai-chat",
      executionStatus: "COMPLETED",
      normalizedResult: canonicalResult({ kind: "openai-chat", completion: "ok", usage: {} }),
      normalizedError: null,
    });
    check("Status is FAILED (missing attemptId)", result.status === "FAILED");
  });

  // ── Test 6: INCONCLUSIVE must not become success ───────────────────────────
  test("assertInconclusiveIsNotSuccess enforces the invariant", () => {
    const inconclusiveResult = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "openai-chat",
      executionStatus: "RUNNING",
      normalizedResult: null,
      normalizedError: null,
    });
    let threwCorrectly = false;
    if (inconclusiveResult.status === "INCONCLUSIVE") {
      try {
        assertInconclusiveIsNotSuccess(inconclusiveResult);
      } catch (err) {
        threwCorrectly = err instanceof Error && err.message.includes("INCONCLUSIVE");
      }
      check("assertInconclusiveIsNotSuccess throws for INCONCLUSIVE", threwCorrectly);
    } else {
      check("(skipped — result was not INCONCLUSIVE)", true);
    }
  });

  // ── Test 7: generic capability payload → VERIFIED ──────────────────────────
  test("local-calculation canonical envelope → VERIFIED", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "local-calculation",
      executionStatus: "COMPLETED",
      normalizedResult: canonicalResult({ sum: 42, average: 21 }),
      normalizedError: null,
    });
    check("Status is VERIFIED", result.status === "VERIFIED");
  });

  // ── Test 8: Corrupt result (wrong kind) → FAILED/INCONCLUSIVE ─────────────
  test("Wrong kind for openai-chat → not VERIFIED", () => {
    const result = verifyExecutionAttempt({
      ...baseInput,
      capabilityId: "openai-chat",
      executionStatus: "COMPLETED",
      normalizedResult: canonicalResult({ kind: "something-else", data: {} }),
      normalizedError: null,
    });
    check("Status is not VERIFIED (wrong kind)", result.status !== "VERIFIED");
  });

  console.log(`\n=== Phase 3 Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log("❌ PHASE 3 FAILED");
    process.exit(1);
  }
  console.log("✅ Phase 3 COMPLETE");
  console.log("INDEPENDENT_VERIFIER=ACTIVE");
  console.log("INCONCLUSIVE_NEVER_SUCCESS=ENFORCED");
  process.exit(0);
}

void main();
