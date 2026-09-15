/**
 * Block 3 §30–§45 / §96 — trusted payment execution against the CONTROLLED
 * TEST PROVIDER over a REAL HTTP boundary: no double charges, crash-after-
 * effect ⇒ INCONCLUSIVE ⇒ reconciliation, callback claims verified against
 * authoritative readback, refund as a new effect, mandate enforcement first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDelegationGrant } from "../../api/runtime/block2/delegation";
import { getPartyLedger } from "../../api/runtime/block3/economic-ledger";
import { provisionMandateBudget } from "../../api/runtime/block3/financial-mandate";
import {
  executePaymentEffect,
  PaymentExecutionError,
  reconcilePaymentEffect,
  refundPaymentEffect,
  verifyPaymentClaim,
} from "../../api/runtime/block3/payment-execution";
import { createPaymentIntent } from "../../api/runtime/block3/payment-intents";
import { createHttpPspClient } from "../../api/runtime/block3/psp-client";
import { getTestDb, resetBlock3 } from "./helpers/pg";
import { startControlledPsp, type ControlledPsp } from "./helpers/controlled-psp-server";

let psp: ControlledPsp;
let pspClient: ReturnType<typeof createHttpPspClient>;

beforeAll(async () => {
  psp = await startControlledPsp();
  pspClient = createHttpPspClient(psp.url);
});
afterAll(async () => psp.close());
beforeEach(async () => {
  await resetBlock3((await getTestDb()).db);
  psp.payments.clear();
  psp.sentCallbacks.length = 0;
  psp.setFailureMode("none");
});

async function makeIntent(idempotencyKey: string, amountMinor = "249500") {
  const { db } = await getTestDb();
  const { intent } = await createPaymentIntent(db, {
    ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
    amountMinor, currency: "KWD", purpose: "buy laptop", idempotencyKey,
  });
  return intent;
}

describe("trusted payment execution over real HTTP", () => {
  it("executes authorize+capture to CAPTURED with exact KWD money", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-happy");
    const result = await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    expect(result.outcome).toBe("CAPTURED");
    expect(result.intent.status).toBe("CAPTURED");
    const payment = [...psp.payments.values()][0];
    expect(payment.amountMinor).toBe("249500");
    expect(payment.currency).toBe("KWD");
  });

  it("replaying the same intent never double-charges (DOUBLE_CHARGES=0)", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-replay");
    const first = await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    const second = await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    expect(first.outcome).toBe("CAPTURED");
    expect(second.outcome).toBe("CAPTURED");
    expect(psp.payments.size).toBe(1); // exactly one provider-side payment
  });

  it("mandate rejection fails closed BEFORE the provider is called", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(db, {
      principalOwnerId: "owner-1", delegateId: "agent-pay", purpose: "buy laptop",
      allowedCapabilities: ["pay"], maxMonetary: "10.000", currency: "KWD",
      expiresAt: new Date("2027-01-01T00:00:00Z"), now: new Date("2026-01-01T00:00:00Z"),
    });
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "10000" });
    const intent = await makeIntent("exec-mandate"); // 249.500 KWD > 10.000 budget
    await expect(executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id, grantId: grant.id, delegateId: "agent-pay" }))
      .rejects.toMatchObject({ code: "MANDATE_REJECTED" });
    expect(psp.payments.size).toBe(0); // provider never touched
    const { db: db2 } = await getTestDb();
    const { getPaymentIntent } = await import("../../api/runtime/block3/payment-intents");
    expect((await getPaymentIntent(db2, intent.id))?.status).toBe("FAILED");
  });
});

describe("crash recovery and payment truth (§36–§38, §96)", () => {
  it("crash after effect ⇒ INCONCLUSIVE, then reconciliation readback resolves truth", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-crash");
    psp.setFailureMode("crash_after_capture");
    const error = await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentExecutionError);
    expect((error as PaymentExecutionError).code).toBe("UNCERTAIN_EFFECT");
    expect((error as PaymentExecutionError).intent?.status).toBe("INCONCLUSIVE");
    // No blind retry. The capture DID happen provider-side; readback proves it.
    const providerReference = [...psp.payments.keys()][0];
    psp.setFailureMode("none");
    const reconciled = await reconcilePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id, providerReference });
    expect(reconciled.outcome).toBe("RESOLVED_CAPTURED");
    expect(reconciled.intent.status).toBe("CAPTURED");
  });

  it("callback claims CAPTURED but readback says NOT_CAPTURED ⇒ NOT VERIFIED (mandatory)", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-lie");
    await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    const providerReference = [...psp.payments.keys()][0];
    psp.setFailureMode("readback_lies_uncaptured");
    const verdict = await verifyPaymentClaim(db, { psp: pspClient, providerRef: "psp-controlled" }, {
      intentId: intent.id,
      providerReference,
      claim: { status: "CAPTURED", amountMinor: "249500", currency: "KWD" },
    });
    expect(verdict.verified).toBe(false);
    expect(verdict.reason).toMatch(/readback disagrees/i);
  });

  it("truthful claim verifies against authoritative readback", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-verify");
    await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    const providerReference = [...psp.payments.keys()][0];
    const verdict = await verifyPaymentClaim(db, { psp: pspClient, providerRef: "psp-controlled" }, {
      intentId: intent.id,
      providerReference,
      claim: { status: "CAPTURED", amountMinor: "249500", currency: "KWD" },
    });
    expect(verdict.verified).toBe(true);
  });

  it("provider amount/currency mismatch ⇒ INCONCLUSIVE, never auto-VERIFIED", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-mismatch");
    psp.setFailureMode("amount_mismatch");
    const result = await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    expect(result.outcome).toBe("INCONCLUSIVE");
    expect(result.intent.status).toBe("INCONCLUSIVE");
  });
});

describe("refund as a NEW effect (§44–§45)", () => {
  it("refund appends a negative REFUND entry and never rewrites history", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-refund");
    const executed = await executePaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: intent.id });
    const providerReference = executed.providerReference!;

    const refund = await refundPaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, {
      intentId: intent.id, idempotencyKey: "refund-1", providerReference,
    });
    expect(refund.outcome).toBe("REFUNDED");

    // History preserved: the intent is still CAPTURED; value netted via ledger.
    const { getPaymentIntent } = await import("../../api/runtime/block3/payment-intents");
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("CAPTURED");
    const ledger = await getPartyLedger(db, { ownerId: "owner-1", party: "buyer-1", kind: "REFUND" });
    expect(ledger).toEqual([{ currency: "KWD", kind: "REFUND", totalMinor: "-249500" }]);

    // Replay ⇒ idempotent, never double-refunds (DOUBLE_REFUNDS=0).
    const replay = await refundPaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, {
      intentId: intent.id, idempotencyKey: "refund-1", providerReference,
    });
    expect(replay.ledgerEntryId).toBe(refund.ledgerEntryId);
    const ledgerAfter = await getPartyLedger(db, { ownerId: "owner-1", party: "buyer-1", kind: "REFUND" });
    expect(ledgerAfter[0].totalMinor).toBe("-249500");
  });

  it("refund of a different PSP state is refused", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("exec-refund-bad");
    await expect(refundPaymentEffect(db, { psp: pspClient, providerRef: "psp-controlled" }, {
      intentId: intent.id, idempotencyKey: "refund-x", providerReference: "psp_missing",
    })).rejects.toThrow(); // intent not CAPTURED
  });
});
