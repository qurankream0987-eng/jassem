/**
 * Block 8 §57–§66 / §99 — the ONE generic fee engine, versioned rules,
 * verified-only economic recognition, and truthful contribution margin.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  computeContributionMargin,
  EconomicEventError,
  recognizeVerifiedPayment,
  TRANSACTION_VERIFIED,
} from "../../api/runtime/block3/economic-events";
import { appendEconomicEntry, getPartyLedger } from "../../api/runtime/block3/economic-ledger";
import {
  createFeeRule,
  evaluateFeeRule,
  FeeRuleError,
} from "../../api/runtime/block3/fee-rules";
import { moneyOf, parseMoney } from "../../api/runtime/block3/money";
import { createPaymentIntent, transitionPaymentIntent } from "../../api/runtime/block3/payment-intents";
import { getTestDb, resetBlock3 } from "./helpers/pg";

describe("fee rule engine — exact, generic, versioned", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("computes fixed / percentage / tiered fees exactly (KWD 3 decimals)", () => {
    const gross = parseMoney("100.000", "KWD");
    expect(evaluateFeeRule({ kind: "fixed", config: { amountMinor: "500", currency: "KWD" } }, gross))
      .toEqual({ minor: "500", currency: "KWD" });
    expect(evaluateFeeRule({ kind: "percentage", config: { percent: "2.5" } }, gross))
      .toEqual({ minor: "2500", currency: "KWD" });
    // Progressive: first 50 KWD at 0 fee-fixed 0.250; remainder at 4%.
    const tiered = evaluateFeeRule({
      kind: "tiered",
      config: { tiers: [{ upToMinor: "50000", amountMinor: "250" }, { upToMinor: null, percent: "4" }] },
    }, gross);
    expect(tiered).toEqual({ minor: "2250", currency: "KWD" }); // 0.250 + 4% of 50.000
  });

  it("alias kinds (service/success/…) must carry a native formula — no domain code", () => {
    const gross = parseMoney("10.125", "KWD");
    expect(evaluateFeeRule({ kind: "service", config: { percent: "2.5" } }, gross))
      .toEqual({ minor: "253", currency: "KWD" });
    expect(() => evaluateFeeRule({ kind: "promotion", config: {} }, gross)).toThrow(/formula/i);
    expect(() => evaluateFeeRule({ kind: "fixed", config: { amountMinor: "100", currency: "USD" } }, gross))
      .toThrow(FeeRuleError);
  });

  it("versioned change supersedes; history keeps the version that produced it", async () => {
    const { db } = await getTestDb();
    const v1 = await createFeeRule(db, {
      ownerId: "owner-1", kind: "percentage", triggerEventType: TRANSACTION_VERIFIED, config: { percent: "2.5" },
    });
    const v2 = await createFeeRule(db, {
      ownerId: "owner-1", kind: "percentage", triggerEventType: TRANSACTION_VERIFIED,
      config: { percent: "3" }, supersedesRuleId: v1.id,
    });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("ACTIVE");
    const { feeRules } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    const [old] = await db.select().from(feeRules).where(eq(feeRules.id, v1.id));
    expect(old.status).toBe("SUPERSEDED");
  });
});

describe("economic recognition — verified outcomes only (§56)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  async function capturedIntent(key: string) {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "100000", currency: "KWD", purpose: "order", idempotencyKey: key,
      providerRef: "stub-psp",
    });
    await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
    const { applyProviderCapture } = await import("../../api/runtime/block3/payment-execution");
    await applyProviderCapture(db, {
      psp: {
        authorize: async () => { throw new Error("unused"); },
        capture: async () => { throw new Error("unused"); },
        refund: async () => { throw new Error("unused"); },
        readback: async (id: string) => ({ id, status: "CAPTURED", amountMinor: "100000", currency: "KWD", reference: intent.id }),
      },
      providerRef: "stub-psp",
    }, { intentId: intent.id, providerReference: "psp_test" });
    return intent;
  }

  it("refuses to recognize economics from unverified payment states", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "b", payeeRef: "s",
      amountMinor: "1000", currency: "KWD", purpose: "x", idempotencyKey: "unverified",
    });
    await expect(recognizeVerifiedPayment(db, { intentId: intent.id })).rejects.toThrow(EconomicEventError);
  });

  it("recognizes gross, revenue (citing rule version), and seller payable — reconciling exactly", async () => {
    const { db } = await getTestDb();
    await createFeeRule(db, {
      ownerId: "owner-1", kind: "percentage", triggerEventType: TRANSACTION_VERIFIED, config: { percent: "2.5" },
    });
    const intent = await capturedIntent("econ-1");
    const recognized = await recognizeVerifiedPayment(db, { intentId: intent.id });
    expect(recognized.customerPayment.amountMinor).toBe("100000");
    expect(recognized.revenue).toHaveLength(1);
    expect(recognized.revenue[0].amountMinor).toBe("2500");
    expect(recognized.revenue[0].feeRuleVersion).toBe(1);
    expect(recognized.sellerPayable.amountMinor).toBe("97500");
    // gross = revenue + payable (never invents or loses money)
    expect(BigInt(recognized.sellerPayable.amountMinor) + BigInt(recognized.totalFeesMinor)).toBe(100000n);

    // Replay recognizes nothing twice.
    const replay = await recognizeVerifiedPayment(db, { intentId: intent.id });
    expect(replay.alreadyRecognized).toBe(true);
    const revenueLedger = await getPartyLedger(db, { ownerId: "owner-1", party: "JASIM" });
    expect(revenueLedger).toEqual([{ currency: "KWD", kind: "JASIM_REVENUE", totalMinor: "2500" }]);
  });

  it("contribution margin is truthfully UNKNOWN without provider cost data", async () => {
    const { db } = await getTestDb();
    await createFeeRule(db, {
      ownerId: "owner-1", kind: "percentage", triggerEventType: TRANSACTION_VERIFIED, config: { percent: "2.5" },
    });
    const intent = await capturedIntent("econ-margin");
    await recognizeVerifiedPayment(db, { intentId: intent.id });

    const unknown = await computeContributionMargin(db, { ownerId: "owner-1", currency: "KWD" });
    expect(unknown.revenueMinor).toBe("2500");
    expect(unknown.providerCostMinor).toBeNull();
    expect(unknown.marginMinor).toBeNull(); // UNKNOWN, never fabricated

    await appendEconomicEntry(db, {
      ownerId: "owner-1", kind: "PROVIDER_COST", party: "psp-controlled",
      amountMinor: "900", currency: "KWD", sourceEventType: "PROVIDER_INVOICE_VERIFIED",
      sourceId: "inv-1", idempotencyKey: "cost-1",
    });
    const known = await computeContributionMargin(db, { ownerId: "owner-1", currency: "KWD" });
    expect(known.marginMinor).toBe("1600"); // 2500 − 900
  });
});
