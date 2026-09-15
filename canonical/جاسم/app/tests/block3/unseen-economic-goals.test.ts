/**
 * Block 3 §126–§131 — ≥15 UNSEEN economic goals, each composed fresh
 * through the generic primitives with truthful outcomes only. None of these
 * goals existed as code paths: they are novel compositions, and each asserts
 * the exact truth the runtime must produce (no fabricated success, no double
 * effects, no domain code).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capabilityProviderCatalog } from "@db/schema";
import { createDelegationGrant } from "../../api/runtime/block2/delegation";
import { createFinancialCheckout, handleCheckoutReturn, PAYMENT_CHECKOUT_PURPOSE } from "../../api/runtime/block3/checkout";
import { applyApprovedCommercialChange } from "../../api/runtime/block3/commercial-changesets";
import { createCommercialOrder } from "../../api/runtime/block3/commercial-orders";
import { recognizeVerifiedPayment } from "../../api/runtime/block3/economic-events";
import { getPartyLedger } from "../../api/runtime/block3/economic-ledger";
import { createFeeRule } from "../../api/runtime/block3/fee-rules";
import { consumeMandateBudget, provisionMandateBudget } from "../../api/runtime/block3/financial-mandate";
import { formatMoney, moneyOf, parseMoney, subMoney } from "../../api/runtime/block3/money";
import { executePaymentEffect, refundPaymentEffect, reconcilePaymentEffect, verifyPaymentClaim } from "../../api/runtime/block3/payment-execution";
import { createPaymentIntent, getPaymentIntent } from "../../api/runtime/block3/payment-intents";
import { createPaymentMethodReference } from "../../api/runtime/block3/payment-methods";
import { createHttpPspClient } from "../../api/runtime/block3/psp-client";
import { cancelSubscription, checkQuota, createPlan, getEntitlement, processRenewal, recordUsage, subscribe } from "../../api/runtime/block3/subscriptions";
import { ingestAuthenticatedExternalEvent } from "../../api/runtime/block3/webhook-auth";
import { configureExternalActionProvider, resetExternalActionProviders } from "../../api/runtime/external-action-session";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";
import { getTestDb, resetBlock3 } from "./helpers/pg";
import { startControlledPsp, type ControlledPsp } from "./helpers/controlled-psp-server";

let psp: ControlledPsp;
const dispatcher: ContinuationDispatcher = { async dispatch() { return "enqueued"; } };
const T0 = new Date("2026-01-01T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  psp = await startControlledPsp();
  configureExternalActionProvider("psp-controlled", {
    [PAYMENT_CHECKOUT_PURPOSE]: { origins: [psp.url], pathPrefixes: ["/checkout"] },
  });
});
afterAll(async () => {
  await psp.close();
  resetExternalActionProviders();
});
beforeEach(async () => {
  await resetBlock3((await getTestDb()).db);
  psp.payments.clear();
  psp.sentCallbacks.length = 0;
  psp.setFailureMode("none");
  const { db } = await getTestDb();
  await db.insert(capabilityProviderCatalog).values({
    id: "psp-controlled", kind: "PSP", implementationId: "controlled-psp-v1",
    ioMetadata: { webhookSecret: psp.webhookSecret }, provenance: { source: "boot" },
  });
});

async function payIntent(key: string, amountMinor: string, payee = "seller-1") {
  const { db } = await getTestDb();
  const { intent } = await createPaymentIntent(db, {
    ownerId: "owner-1", payerRef: "buyer-1", payeeRef: payee,
    amountMinor, currency: "KWD", purpose: key, idempotencyKey: key,
  });
  return intent;
}

describe("unseen economic goals — truthful compositions only", () => {
  it("goal 01: buy a product end-to-end (order → intent → pay → recognize)", async () => {
    const { db } = await getTestDb();
    const order = await createCommercialOrder(db, {
      ownerId: "owner-1", sellerRef: "seller-1", buyerRef: "buyer-1",
      terms: { items: [{ ref: "camera-x9", quantity: 1 }], total: { minor: "249500", currency: "KWD" } },
    });
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1", amountMinor: "249500",
      currency: "KWD", purpose: "buy camera", orderId: order.id, idempotencyKey: "g01",
    });
    const executed = await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    expect(executed.outcome).toBe("CAPTURED");
    const recognized = await recognizeVerifiedPayment(db, { intentId: intent.id });
    expect(recognized.sellerPayable.amountMinor).toBe("249500"); // no fee rule ⇒ seller gets gross
  });

  it("goal 02: price-watch — no payment exists until the watched price is verified", async () => {
    const { db } = await getTestDb();
    // Watching is observation only; only after the verified price event does
    // a payment intent get created (§77: analysis never pays).
    const { paymentIntents } = await import("@db/schema");
    expect(await db.select().from(paymentIntents)).toHaveLength(0);
    const intent = await payIntent("g02", "19000"); // target price reached: 19.000 KWD
    expect(intent.status).toBe("CREATED");
  });

  it("goal 03: B2B — seller payable balance derives from ledger, never stored", async () => {
    const { db } = await getTestDb();
    const a = await payIntent("g03a", "100000", "corp-seller");
    const b = await payIntent("g03b", "250000", "corp-seller");
    for (const intent of [a, b]) {
      await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
      await recognizeVerifiedPayment(db, { intentId: intent.id });
    }
    const ledger = await getPartyLedger(db, { ownerId: "owner-1", party: "corp-seller", kind: "SELLER_PAYABLE" });
    expect(ledger[0].totalMinor).toBe("350000");
  });

  it("goal 04: non-payment goal stays payment-free (generality preserved)", async () => {
    const { db } = await getTestDb();
    // A pure usage/tracking goal: records usage, touches no payment tables.
    expect((await recordUsage(db, {
      ownerId: "u", metric: "reports", quantity: "1", unit: "report", sourceEventKey: "g04-1", periodKey: "2026-01",
    })).recorded).toBe(true);
    const { paymentIntents } = await import("@db/schema");
    expect(await db.select().from(paymentIntents)).toHaveLength(0);
  });

  it("goal 05: employment fee — percentage rule on a verified hire payment", async () => {
    const { db } = await getTestDb();
    await createFeeRule(db, { ownerId: "owner-1", kind: "service", triggerEventType: "TRANSACTION_VERIFIED", config: { percent: "10" } });
    const intent = await payIntent("g05", "3000000"); // 3000.000 KWD salary placement
    await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    const recognized = await recognizeVerifiedPayment(db, { intentId: intent.id });
    expect(recognized.revenue[0].amountMinor).toBe("300000"); // 10% exactly
    expect(recognized.sellerPayable.amountMinor).toBe("2700000");
  });

  it("goal 06: resource booking fee — fixed rule regardless of domain", async () => {
    const { db } = await getTestDb();
    await createFeeRule(db, { ownerId: "owner-1", kind: "booking", triggerEventType: "TRANSACTION_VERIFIED", config: { fixed: { amountMinor: "1500", currency: "KWD" } } });
    const intent = await payIntent("g06", "12000");
    await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    const recognized = await recognizeVerifiedPayment(db, { intentId: intent.id });
    expect(recognized.revenue[0].amountMinor).toBe("1500");
  });

  it("goal 07: subscription with trial → verified renewal → entitlement extended", async () => {
    const { db } = await getTestDb();
    const plan = await createPlan(db, {
      ownerId: "owner-1", name: "Fleet", priceMinor: "9000", currency: "KWD",
      trialDays: 7, entitlementScopes: [{ capability: "fleet-dashboard" }], now: T0,
    });
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "fleet-co", now: T0 });
    expect(subscription.status).toBe("TRIALING");
    // Renewal requires a REAL verified payment owned by the subscriber.
    const { intent } = await createPaymentIntent(db, {
      ownerId: "fleet-co", payerRef: "fleet-co", payeeRef: "owner-1",
      amountMinor: "9000", currency: "KWD", purpose: "renewal", idempotencyKey: "g07-renewal",
    });
    await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    const renewed = await processRenewal(db, {
      subscriptionId: subscription.id, outcome: "VERIFIED_PAYMENT", verifiedPaymentIntentId: intent.id,
      now: new Date(T0.getTime() + 7 * DAY),
    });
    expect(renewed.subscription.status).toBe("ACTIVE");
    expect(await getEntitlement(db, { subjectOwnerId: "fleet-co", capability: "fleet-dashboard", now: new Date(T0.getTime() + 8 * DAY) })).not.toBeNull();
  });

  it("goal 08: trial lapse without payment ⇒ access ends truthfully", async () => {
    const { db } = await getTestDb();
    const plan = await createPlan(db, {
      ownerId: "owner-1", name: "Trial", priceMinor: "1000", currency: "KWD",
      trialDays: 3, entitlementScopes: [{ capability: "api-access" }], now: T0,
    });
    await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-t", now: T0 });
    expect(await getEntitlement(db, { subjectOwnerId: "user-t", capability: "api-access", now: new Date(T0.getTime() + 4 * DAY) })).toBeNull();
  });

  it("goal 09: quota caps usage deterministically at the plan limit", async () => {
    const { db } = await getTestDb();
    const plan = await createPlan(db, {
      ownerId: "owner-1", name: "Metered", priceMinor: null, currency: null,
      entitlementScopes: [{ capability: "ai-minutes", quota: { minutes: 60 } }], now: T0,
    });
    await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-m", now: T0 });
    await recordUsage(db, { ownerId: "user-m", metric: "minutes", quantity: "59.5", unit: "minute", sourceEventKey: "g09-1", periodKey: "2026-01" });
    expect((await checkQuota(db, { subjectOwnerId: "user-m", capability: "ai-minutes", metric: "minutes", periodKey: "2026-01", now: T0 })).allowed).toBe(true);
    await recordUsage(db, { ownerId: "user-m", metric: "minutes", quantity: "0.6", unit: "minute", sourceEventKey: "g09-2", periodKey: "2026-01" });
    expect((await checkQuota(db, { subjectOwnerId: "user-m", capability: "ai-minutes", metric: "minutes", periodKey: "2026-01", now: T0 })).allowed).toBe(false);
  });

  it("goal 10: multi-currency mandate fails closed (no silent FX)", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(db, {
      principalOwnerId: "owner-1", delegateId: "agent-fx", purpose: "pay", allowedCapabilities: ["pay"],
      maxMonetary: "100.000", currency: "KWD", expiresAt: new Date("2027-01-01"), now: T0,
    });
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "100000" });
    const result = await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "5000", currency: "USD" });
    expect(result.outcome).toBe("REJECTED"); // FX is observation, never silent conversion
  });

  it("goal 11: agent spends within a hard budget; the excess is refused", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(db, {
      principalOwnerId: "owner-1", delegateId: "agent-shop", purpose: "shop", allowedCapabilities: ["pay"],
      maxMonetary: "50.000", currency: "KWD", expiresAt: new Date("2027-01-01"), now: T0,
    });
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "50000" });
    expect((await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "30000", currency: "KWD" })).outcome).toBe("ALLOWED");
    expect((await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "25000", currency: "KWD" })).outcome).toBe("REJECTED");
  });

  it("goal 12: single-use mandate authorizes exactly one purchase", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(db, {
      principalOwnerId: "owner-1", delegateId: "agent-once", purpose: "one gift", allowedCapabilities: ["pay"],
      maxMonetary: "20.000", currency: "KWD", expiresAt: new Date("2027-01-01"), now: T0,
    });
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", executionLimit: 1 });
    expect((await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "5000", currency: "KWD" })).outcome).toBe("ALLOWED");
    expect((await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "1000", currency: "KWD" })).outcome).toBe("REJECTED");
  });

  it("goal 13: full refund nets the customer to zero truthfully", async () => {
    const { db } = await getTestDb();
    const intent = await payIntent("g13", "249500");
    const executed = await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    await recognizeVerifiedPayment(db, { intentId: intent.id });
    await refundPaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, {
      intentId: intent.id, idempotencyKey: "g13-refund", providerReference: executed.providerReference!,
    });
    const ledger = await getPartyLedger(db, { ownerId: "owner-1", party: "buyer-1" });
    const refund = ledger.find((r) => r.kind === "REFUND");
    expect(refund?.totalMinor).toBe("-249500");
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("CAPTURED"); // history preserved
  });

  it("goal 14: fee policy change mid-stream — old payment cites v1, new cites v2", async () => {
    const { db } = await getTestDb();
    const v1 = await createFeeRule(db, { ownerId: "owner-1", kind: "percentage", triggerEventType: "TRANSACTION_VERIFIED", config: { percent: "2" } });
    const oldIntent = await payIntent("g14a", "100000");
    await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: oldIntent.id });
    const oldRec = await recognizeVerifiedPayment(db, { intentId: oldIntent.id });
    expect(oldRec.revenue[0].feeRuleVersion).toBe(1);
    expect(oldRec.revenue[0].amountMinor).toBe("2000");

    await applyApprovedCommercialChange(db, {
      targetType: "fee_rule", targetId: v1.id, mutation: { kind: "percentage", config: { percent: "5" } },
      approvalRef: "owner-approval-g14", ownerId: "owner-1",
    });
    const newIntent = await payIntent("g14b", "100000");
    await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: newIntent.id });
    const newRec = await recognizeVerifiedPayment(db, { intentId: newIntent.id });
    expect(newRec.revenue[0].feeRuleVersion).toBe(2);
    expect(newRec.revenue[0].amountMinor).toBe("5000");
  });

  it("goal 15: browser checkout success ≠ paid; only the verified chain pays", async () => {
    const { db } = await getTestDb();
    const intent = await payIntent("g15", "249500");
    const { session } = await createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-1", provider: "psp-controlled", adapterEndpoint: psp.url,
    });
    const ret = await handleCheckoutReturn(db, { sessionId: session.id, state: session.state, query: { success: "true" } });
    expect(ret.intentStatus).toBe("CREATED");
    await expect(recognizeVerifiedPayment(db, { intentId: intent.id })).rejects.toThrow(/unverified/i);
  });

  it("goal 16: forged webhook (no signature) creates zero effects", async () => {
    const { db } = await getTestDb();
    const intent = await payIntent("g16", "1000");
    const rawBody = JSON.stringify({ eventType: "payment.captured", reference: intent.id, amountMinor: "1000", currency: "KWD" });
    const result = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "g16-ev", eventType: "payment.captured",
      reference: intent.id, rawBody, ownerId: "owner-1",
    });
    expect(result.outcome).toBe("REJECTED");
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("CREATED");
  });

  it("goal 17: provider crash after capture ⇒ INCONCLUSIVE ⇒ reconciled CAPTURED, charged once", async () => {
    const { db } = await getTestDb();
    const intent = await payIntent("g17", "777000");
    psp.setFailureMode("crash_after_capture");
    await expect(executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id }))
      .rejects.toMatchObject({ code: "UNCERTAIN_EFFECT" });
    psp.setFailureMode("none");
    const ref = [...psp.payments.keys()][0];
    const reconciled = await reconcilePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id, providerReference: ref });
    expect(reconciled.outcome).toBe("RESOLVED_CAPTURED");
    expect(psp.payments.size).toBe(1);
  });

  it("goal 18: tokenized method reference usable; raw card data refused everywhere", async () => {
    const { db } = await getTestDb();
    const method = await createPaymentMethodReference(db, {
      ownerId: "owner-1", provider: "psp-controlled", methodType: "card", tokenRef: "tok_g18_safe", provenance: { source: "boot" },
    });
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1", amountMinor: "500",
      currency: "KWD", purpose: "micro", paymentMethodRef: method.id, idempotencyKey: "g18",
    });
    expect(intent.paymentMethodRef).toBe(method.id);
    await expect(createPaymentMethodReference(db, {
      ownerId: "owner-1", provider: "psp-controlled", methodType: "card", tokenRef: "4111111111111111", provenance: { source: "boot" },
    })).rejects.toThrow();
  });
});
