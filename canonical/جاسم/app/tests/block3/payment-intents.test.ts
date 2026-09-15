/**
 * Block 3 §17/§39–§41 — PaymentIntent lifecycle: idempotent creation,
 * honest state machine (AUTH ≠ CAPTURE ≠ SETTLEMENT), terminal truth,
 * INCONCLUSIVE resolvable only by reconciliation evidence.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  canTransitionPayment,
  createPaymentIntent,
  getPaymentIntent,
  PaymentIntentError,
  transitionPaymentIntent,
} from "../../api/runtime/block3/payment-intents";
import { getTestDb, resetBlock3 } from "./helpers/pg";

const base = {
  ownerId: "owner-1",
  payerRef: "buyer-1",
  payeeRef: "seller-1",
  amountMinor: "249500",
  currency: "KWD",
  purpose: "buy laptop",
  providerRef: "stub-psp",
  idempotencyKey: "pay-key-1",
};

describe("PaymentIntent — creation and JASIM-level idempotency", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("creates once; replaying owner+idempotencyKey returns the original", async () => {
    const { db } = await getTestDb();
    const first = await createPaymentIntent(db, base);
    const second = await createPaymentIntent(db, base);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.intent.id).toBe(first.intent.id);
    expect(second.intent.amountMinor).toBe("249500");
    expect(second.intent.currency).toBe("KWD");
  });

  it("rejects non-exact and non-positive amounts", async () => {
    const { db } = await getTestDb();
    await expect(createPaymentIntent(db, { ...base, amountMinor: "249.5", idempotencyKey: "k2" })).rejects.toThrow(PaymentIntentError);
    await expect(createPaymentIntent(db, { ...base, amountMinor: "0", idempotencyKey: "k3" })).rejects.toThrow(/positive/);
    await expect(createPaymentIntent(db, { ...base, amountMinor: "-5", idempotencyKey: "k4" })).rejects.toThrow(PaymentIntentError);
    await expect(createPaymentIntent(db, { ...base, currency: "??", idempotencyKey: "k5" })).rejects.toThrow(/currency/i);
  });
});

describe("PaymentIntent — state machine honesty", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("walks the happy path AUTH → CAPTURE → SETTLED as distinct verified states", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, base);
    let current = await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
    current = await transitionPaymentIntent(db, { id: intent.id, to: "PROVIDER_AUTHORIZED" });
    // CAPTURED/SETTLED are unreachable from the public API; truth comes only
    // from an authoritative provider readback via the executor boundary.
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "CAPTURED" })).rejects.toThrow(/Invalid payment transition/);
    const { applyProviderCapture, applyProviderSettlement } = await import("../../api/runtime/block3/payment-execution");
    const readbackPsp = (status: string) => ({
      authorize: async () => { throw new Error("unused"); },
      capture: async () => { throw new Error("unused"); },
      refund: async () => { throw new Error("unused"); },
      readback: async (id: string) => ({ id, status, amountMinor: current.amountMinor, currency: current.currency, reference: intent.id }),
    });
    current = await applyProviderCapture(db, { psp: readbackPsp("CAPTURED"), providerRef: "stub-psp" }, { intentId: intent.id, providerReference: "psp_x" });
    expect(current.status).toBe("CAPTURED");
    current = await applyProviderSettlement(db, { psp: readbackPsp("SETTLED"), providerRef: "stub-psp" }, { intentId: intent.id, providerReference: "psp_x" });
    expect(current.status).toBe("SETTLED");
    expect(current.status).toBe("SETTLED");
    // AUTH ≠ CAPTURE: authorized is not capturable proof of settlement.
    expect(canTransitionPayment("PROVIDER_AUTHORIZED", "SETTLED")).toBe(false);
  });

  it("rejects skipping authority stages (CREATED → CAPTURED)", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, base);
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "CAPTURED" })).rejects.toThrow(/Invalid payment transition/);
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("CREATED");
  });

  it("terminal states are final — truth is never rewritten", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, { ...base, idempotencyKey: "term-1" });
    await transitionPaymentIntent(db, { id: intent.id, to: "FAILED" });
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "SETTLED" })).rejects.toThrow(/terminal/i);
  });

  it("INCONCLUSIVE resolves only via reconciliation outcomes, never backwards", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, { ...base, idempotencyKey: "inc-1" });
    await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
    await transitionPaymentIntent(db, { id: intent.id, to: "INCONCLUSIVE" });
    expect(canTransitionPayment("INCONCLUSIVE", "CREATED")).toBe(false);
    expect(canTransitionPayment("INCONCLUSIVE", "EXECUTING")).toBe(false);
    // The public transition API can NEVER fabricate truth from INCONCLUSIVE
    // (INCONCLUSIVE is terminal to the public API).
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "CAPTURED" }))
      .rejects.toMatchObject({ code: "TERMINAL" });
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "FAILED" }))
      .rejects.toMatchObject({ code: "TERMINAL" });
    // Only the reconciler's authoritative readback resolves it; a readback
    // that LIES about the money (wrong amount) never captures.
    const { reconcilePaymentEffect } = await import("../../api/runtime/block3/payment-execution");
    const { getPaymentIntent: readIntent } = await import("../../api/runtime/block3/payment-intents");
    const mkPsp = (status: string, amountMinor: string) => ({
      authorize: async () => { throw new Error("unused"); },
      capture: async () => { throw new Error("unused"); },
      refund: async () => { throw new Error("unused"); },
      readback: async (id: string) => ({ id, status, amountMinor, currency: "KWD", reference: intent.id }),
    });
    const lying = await reconcilePaymentEffect(db, { psp: mkPsp("CAPTURED", "1"), providerRef: "stub-psp" }, { intentId: intent.id, providerReference: "psp_lying" });
    expect(lying.outcome).toBe("DISCREPANCY");
    expect((await readIntent(db, intent.id))?.status).toBe("INCONCLUSIVE");
    const resolved = await reconcilePaymentEffect(db, { psp: mkPsp("CAPTURED", intent.amountMinor), providerRef: "stub-psp" }, { intentId: intent.id, providerReference: "psp_x" });
    expect(resolved.outcome).toBe("RESOLVED_CAPTURED");
  });

  it("races on version: concurrent transitions conflict instead of double-applying", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, { ...base, idempotencyKey: "cas-1" });
    const [a, b] = await Promise.allSettled([
      transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING", expectedVersion: 1 }),
      transitionPaymentIntent(db, { id: intent.id, to: "CANCELLED", expectedVersion: 1 }),
    ]);
    const outcomes = [a, b].map((r) => r.status);
    expect(outcomes.sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = [a, b].find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(PaymentIntentError);
  });
});
