/**
 * Block 3 §67–§76 / §100–§103 — subscriptions, trials, renewals, cancel
 * modes, usage idempotency, deterministic quota, server-side entitlement
 * truth (the UI can never self-unlock).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions as subscriptionsTable } from "@db/schema";
import { eq } from "drizzle-orm";
import { moneyOf } from "../../api/runtime/block3/money";
import {
  BillingError,
  cancelSubscription,
  checkQuota,
  createPlan,
  getEntitlement,
  processRenewal,
  recordUsage,
  subscribe,
} from "../../api/runtime/block3/subscriptions";
import { createPaymentIntent, transitionPaymentIntent } from "../../api/runtime/block3/payment-intents";
import { getTestDb, resetBlock3 } from "./helpers/pg";

const T0 = new Date("2026-01-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

async function makePlan(opts: { trialDays?: number; paid?: boolean } = {}) {
  const { db } = await getTestDb();
  return createPlan(db, {
    ownerId: "owner-1",
    name: "Pro",
    priceMinor: opts.paid === false ? null : "5000",
    currency: opts.paid === false ? null : "KWD",
    trialDays: opts.trialDays,
    entitlementScopes: [{ capability: "rides", quota: { rides: 10 } }],
    now: T0,
  });
}

/** A real verified payment (public legal transition path) owned by the subscriber. */
async function verifiedPayment(ownerId: string, key: string, amountMinor = "5000") {
  const { db } = await getTestDb();
  const { intent } = await createPaymentIntent(db, {
    ownerId, payerRef: ownerId, payeeRef: "owner-1",
    amountMinor, currency: "KWD", purpose: "subscription", idempotencyKey: key,
    providerRef: "stub-psp",
  });
  await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
  const { applyProviderCapture } = await import("../../api/runtime/block3/payment-execution");
  return applyProviderCapture(db, {
    psp: {
      authorize: async () => { throw new Error("unused"); },
      capture: async () => { throw new Error("unused"); },
      refund: async () => { throw new Error("unused"); },
      readback: async (id: string) => ({ id, status: "CAPTURED", amountMinor, currency: "KWD", reference: intent.id }),
    },
    providerRef: "stub-psp",
  }, { intentId: intent.id, providerReference: "psp_test" });
}

describe("subscription lifecycle (§100)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("paid plan starts PAST_DUE — access waits for verified payment", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan();
    const { subscription, entitlements } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    expect(subscription.status).toBe("PAST_DUE");
    expect(entitlements).toHaveLength(0); // no fake entitlement before money
    expect(await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: T0 })).toBeNull();
  });

  it("trial creates an ENTITLEMENT, never a fake payment (§71/§101)", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan({ trialDays: 14 });
    const { subscription, entitlements } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    expect(subscription.status).toBe("TRIALING");
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0].sourceType).toBe("TRIAL");
    const active = await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: T0 });
    expect(active?.expiresAt?.getTime()).toBe(T0.getTime() + 14 * DAY);
    // The trial wrote NO payment rows — no fabricated success anywhere.
    const { paymentIntents } = await import("@db/schema");
    expect(await db.select().from(paymentIntents)).toHaveLength(0);
  });

  it("expired trial entitlement stops answering", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan({ trialDays: 14 });
    await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    const after = new Date(T0.getTime() + 15 * DAY);
    expect(await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: after })).toBeNull();
  });
});

describe("renewal truth (§72/§102)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("verified payment renews and extends the period", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan();
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    const payment = await verifiedPayment("user-1", "renew-ok");
    const renewed = await processRenewal(db, {
      subscriptionId: subscription.id, outcome: "VERIFIED_PAYMENT", verifiedPaymentIntentId: payment.id, now: T0,
    });
    expect(renewed.subscription.status).toBe("ACTIVE");
    expect(renewed.subscription.periodEnd.getTime()).toBe(T0.getTime() + 30 * DAY);
    expect(await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: T0 })).not.toBeNull();
  });

  it("failed renewal walks PAST_DUE → SUSPENDED → EXPIRED truthfully, never fabricated", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan();
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    const payment = await verifiedPayment("user-1", "renew-p1");
    await processRenewal(db, { subscriptionId: subscription.id, outcome: "VERIFIED_PAYMENT", verifiedPaymentIntentId: payment.id, now: T0 });

    const grace = await processRenewal(db, {
      subscriptionId: subscription.id, outcome: "FAILED_PAYMENT", graceDays: 3, suspendAfterDays: 7,
      now: new Date(T0.getTime() + 31 * DAY), // 1 day overdue
    });
    expect(grace.subscription.status).toBe("PAST_DUE");
    expect(grace.entitlementsRevoked).toBe(0);

    const suspended = await processRenewal(db, {
      subscriptionId: subscription.id, outcome: "FAILED_PAYMENT", graceDays: 3, suspendAfterDays: 7,
      now: new Date(T0.getTime() + 35 * DAY), // 5 days overdue
    });
    expect(suspended.subscription.status).toBe("SUSPENDED");
    expect(suspended.entitlementsRevoked).toBe(1);
    expect(await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: new Date(T0.getTime() + 35 * DAY) })).toBeNull();

    const expired = await processRenewal(db, {
      subscriptionId: subscription.id, outcome: "FAILED_PAYMENT", graceDays: 3, suspendAfterDays: 7,
      now: new Date(T0.getTime() + 40 * DAY),
    });
    expect(expired.subscription.status).toBe("EXPIRED");
  });

  it("renewal success without a verified payment reference is refused", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan();
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    await expect(processRenewal(db, { subscriptionId: subscription.id, outcome: "VERIFIED_PAYMENT", now: T0 }))
      .rejects.toThrow(/verified payment/i);
  });
});

describe("cancel modes (§73)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("period-end keeps access until the boundary; immediate revokes now", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan({ paid: false });
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });

    const periodEnd = await cancelSubscription(db, { subscriptionId: subscription.id, mode: "PERIOD_END", now: T0 });
    expect(periodEnd.subscription.status).toBe("ACTIVE");
    expect(periodEnd.subscription.cancelAtPeriodEnd).toBe(true);
    expect(periodEnd.entitlementsRevoked).toBe(0);
    expect(await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: T0 })).not.toBeNull();

    const immediate = await cancelSubscription(db, { subscriptionId: subscription.id, mode: "IMMEDIATE", now: T0 });
    expect(immediate.subscription.status).toBe("CANCELLED");
    expect(immediate.entitlementsRevoked).toBe(1);
    expect(await getEntitlement(db, { subjectOwnerId: "user-1", capability: "rides", now: T0 })).toBeNull();
  });
});

describe("usage metering + quota (§74–§75/§103)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("replayed usage events never consume quota or bill twice", async () => {
    const { db } = await getTestDb();
    const input = { ownerId: "user-1", metric: "rides", quantity: "1", unit: "ride", sourceEventKey: "evt-1", periodKey: "2026-01" };
    expect((await recordUsage(db, input)).recorded).toBe(true);
    expect((await recordUsage(db, input)).recorded).toBe(false); // replay: zero effect
    expect((await recordUsage(db, { ...input, id: "x", sourceEventKey: "evt-2" })).recorded).toBe(true);
  });

  it("quota is deterministic server-side truth", async () => {
    const { db } = await getTestDb();
    const plan = await makePlan({ paid: false });
    await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-1", now: T0 });
    for (let i = 0; i < 10; i += 1) {
      await recordUsage(db, { ownerId: "user-1", metric: "rides", quantity: "1", unit: "ride", sourceEventKey: `ride-${i}`, periodKey: "2026-01" });
    }
    const atLimit = await checkQuota(db, { subjectOwnerId: "user-1", capability: "rides", metric: "rides", periodKey: "2026-01", now: T0 });
    expect(atLimit).toMatchObject({ allowed: false, used: "10.000000", limit: "10" });
    // No entitlement ⇒ refusal, not a guess.
    await expect(checkQuota(db, { subjectOwnerId: "stranger", capability: "rides", metric: "rides", periodKey: "2026-01", now: T0 }))
      .rejects.toThrow(BillingError);
  });
});
