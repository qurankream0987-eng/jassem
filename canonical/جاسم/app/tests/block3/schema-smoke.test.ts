/**
 * Block 3 migration 0009 smoke proof: the hand-written SQL and the Drizzle
 * schema agree — every new table accepts a canonical insert + read-back.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  commercialOrders,
  economicLedgerEntries,
  entitlements,
  feeRules,
  mandateBudgets,
  paymentIntents,
  paymentMethodReferences,
  plans,
  subscriptions,
  usageRecords,
} from "@db/schema";
import { getTestDb, resetBlock3 } from "./helpers/pg";

describe("Block 3 schema/migration smoke", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("round-trips a row through every Block 3 table", async () => {
    const { db } = await getTestDb();
    const now = new Date("2026-01-01T00:00:00Z");
    const periodEnd = new Date("2026-02-01T00:00:00Z");

    const [order] = await db.insert(commercialOrders).values({
      id: "ord_1", ownerId: "owner-1", sellerRef: "seller-1", buyerRef: "buyer-1",
      terms: { items: [{ ref: "laptop-2", quantity: 1 }] }, termsFingerprint: "fp",
    }).returning();
    expect(order.termsVersion).toBe(1);

    const [intent] = await db.insert(paymentIntents).values({
      id: "pint_1", ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "249500", currency: "KWD", purpose: "buy laptop",
      idempotencyKey: "idem-1", orderId: "ord_1",
    }).returning();
    expect(intent.amountMinor).toBe("249500"); // exact minor units, no float
    expect(intent.status).toBe("CREATED");

    const [method] = await db.insert(paymentMethodReferences).values({
      id: "pmr_1", ownerId: "owner-1", provider: "psp-controlled", methodType: "card",
      tokenRef: "tok_123", provenance: { source: "boot" },
    }).returning();
    expect(method.status).toBe("ACTIVE");

    const [budget] = await db.insert(mandateBudgets).values({
      grantId: "dlg_1", currency: "KWD", budgetMinor: "100000", executionLimit: 1,
    }).returning();
    expect(budget.consumedMinor).toBe("0");

    const [entry] = await db.insert(economicLedgerEntries).values({
      id: "ele_1", ownerId: "owner-1", kind: "CUSTOMER_PAYMENT", party: "buyer-1",
      amountMinor: "249500", currency: "KWD", sourceEventType: "PAYMENT_CAPTURED_VERIFIED",
      sourceId: "pint_1", paymentIntentId: "pint_1", idempotencyKey: "econ-1",
    }).returning();
    expect(entry.feeRuleId).toBeNull();

    const [rule] = await db.insert(feeRules).values({
      id: "fee_1", ownerId: "owner-1", kind: "percentage", triggerEventType: "TRANSACTION_VERIFIED",
      config: { percent: "2.5" },
    }).returning();
    expect(rule.version).toBe(1);

    const [plan] = await db.insert(plans).values({
      id: "plan_1", ownerId: "owner-1", name: "Pro", priceMinor: "5000", currency: "KWD",
      entitlementScopes: [{ capability: "transport-booking", quota: 100 }],
    }).returning();
    expect(plan.cadence).toBe("MONTHLY");

    const [subscription] = await db.insert(subscriptions).values({
      id: "sub_1", ownerId: "buyer-1", planId: "plan_1", planVersion: 1,
      periodStart: now, periodEnd,
    }).returning();
    expect(subscription.cancelAtPeriodEnd).toBe(false);

    const [entitlement] = await db.insert(entitlements).values({
      id: "ent_1", subjectOwnerId: "buyer-1", sourceType: "SUBSCRIPTION", sourceId: "sub_1",
      scope: { capability: "transport-booking" }, quota: { remaining: 100 },
    }).returning();
    expect(entitlement.status).toBe("ACTIVE");

    const [usage] = await db.insert(usageRecords).values({
      id: "use_1", ownerId: "buyer-1", subscriptionId: "sub_1", metric: "rides",
      quantity: "1", unit: "ride", sourceEventKey: "evt-ride-1", periodKey: "2026-01",
    }).returning();
    expect(usage.quantity).toBe("1.000000");
  });

  it("enforces owner-scoped idempotency uniqueness (payment + ledger + usage)", async () => {
    const { db } = await getTestDb();
    const intent = {
      id: "pint_a", ownerId: "owner-1", payerRef: "p", payeeRef: "s",
      amountMinor: "1000", currency: "KWD", purpose: "x", idempotencyKey: "same-key",
    };
    await db.insert(paymentIntents).values(intent);
    await expect(db.insert(paymentIntents).values({ ...intent, id: "pint_b" })).rejects.toThrow();
    // A different owner MAY reuse the same key.
    await db.insert(paymentIntents).values({ ...intent, id: "pint_c", ownerId: "owner-2" });

    const entry = {
      id: "ele_a", ownerId: "owner-1", kind: "REFUND" as const, party: "buyer",
      amountMinor: "-1000", currency: "KWD", sourceEventType: "REFUND_VERIFIED",
      sourceId: "pint_a", idempotencyKey: "ref-1",
    };
    await db.insert(economicLedgerEntries).values(entry);
    await expect(db.insert(economicLedgerEntries).values({ ...entry, id: "ele_b" })).rejects.toThrow();

    const usage = {
      id: "use_a", ownerId: "owner-1", metric: "rides", quantity: "1", unit: "ride",
      sourceEventKey: "evt-1", periodKey: "2026-01",
    };
    await db.insert(usageRecords).values(usage);
    await expect(db.insert(usageRecords).values({ ...usage, id: "use_b" })).rejects.toThrow();
  });
});
