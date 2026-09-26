/**
 * Code-review hardening proofs — the trust-boundary regressions found in
 * review must stay fixed: full grant revalidation at execution time,
 * subscription activation only via a real verified payment, webhook
 * correlation against the signed payload + mandate, refund idempotency
 * under concurrency.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { economicLedgerEntries } from "@db/schema";
import { eq } from "drizzle-orm";
import { createDelegationGrant, revokeDelegationGrant } from "../../api/runtime/block2/delegation";
import { provisionMandateBudget } from "../../api/runtime/block3/financial-mandate";
import { applyProviderCapture, executePaymentEffect, refundPaymentEffect } from "../../api/runtime/block3/payment-execution";
import { createPaymentIntent, getPaymentIntent, transitionPaymentIntent } from "../../api/runtime/block3/payment-intents";
import { createHttpPspClient } from "../../api/runtime/block3/psp-client";
import { confirmSubscriptionPayment, createPlan, subscribe } from "../../api/runtime/block3/subscriptions";
import { ingestAuthenticatedExternalEvent } from "../../api/runtime/block3/webhook-auth";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";
import { getTestDb, resetBlock3 } from "./helpers/pg";
import {
  bindIntentToProviderAccount,
  installFixtureWebhookVerification,
} from "./helpers/webhook-verification-fixture";
import { startControlledPsp, type ControlledPsp } from "./helpers/controlled-psp-server";

let psp: ControlledPsp;
const dispatcher: ContinuationDispatcher = { async dispatch() { return "enqueued"; } };
const T0 = new Date("2026-01-01T00:00:00Z");

/** A stub provider boundary whose readback reports the given truth. */
const readbackStub = (amountMinor: string, status = "CAPTURED", reference = "") => ({
  authorize: async () => { throw new Error("unused"); },
  capture: async () => { throw new Error("unused"); },
  refund: async () => { throw new Error("unused"); },
  readback: async (id: string) => ({ id, status, amountMinor, currency: "KWD", reference }),
});

beforeAll(async () => {
  psp = await startControlledPsp();
});
afterAll(async () => {
  await psp.close();
});
beforeEach(async () => {
  await resetBlock3((await getTestDb()).db);
  psp.payments.clear();
  psp.sentCallbacks.length = 0;
  psp.setFailureMode("none");
  installFixtureWebhookVerification({ "psp-controlled": psp.webhookSecret });
});

describe("review hardening proofs", () => {
  it("a REVOKED grant is rejected at execution time even with budget provisioned", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(db, {
      principalOwnerId: "owner-1", delegateId: "agent-pay", purpose: "pay",
      allowedCapabilities: ["pay"], maxMonetary: "100.000", currency: "KWD",
      expiresAt: new Date("2027-01-01T00:00:00Z"), now: T0,
    });
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "100000" });
    await revokeDelegationGrant(db, { grantId: grant.id, actorOwnerId: "owner-1", now: T0 });
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "5000", currency: "KWD", purpose: "pay", idempotencyKey: "h-revoked",
    });
    await expect(executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, {
      intentId: intent.id, grantId: grant.id, delegateId: "agent-pay",
    })).rejects.toMatchObject({ code: "MANDATE_REJECTED" });
    expect(psp.payments.size).toBe(0); // provider never touched
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("FAILED");
  });

  it("subscription activation requires a REAL verified payment — fabricated/foreign/mismatched ids rejected", async () => {
    const { db } = await getTestDb();
    const plan = await createPlan(db, {
      ownerId: "owner-1", name: "Pro", priceMinor: "5000", currency: "KWD",
      entitlementScopes: [{ capability: "rides" }], now: T0,
    });
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "user-9", now: T0 });
    // Fabricated id.
    await expect(confirmSubscriptionPayment(db, {
      subscriptionId: subscription.id, verifiedPaymentIntentId: "pint_fabricated",
    })).rejects.toMatchObject({ code: "PAYMENT_UNVERIFIED" });
    // Foreign owner.
    const { intent: foreign } = await createPaymentIntent(db, {
      ownerId: "attacker", payerRef: "attacker", payeeRef: "owner-1",
      amountMinor: "5000", currency: "KWD", purpose: "x", idempotencyKey: "h-foreign",
      providerRef: "stub-psp",
    });
    await transitionPaymentIntent(db, { id: foreign.id, to: "EXECUTING" });
    await applyProviderCapture(db, { psp: readbackStub("5000", "CAPTURED", foreign.id), providerRef: "stub-psp" }, { intentId: foreign.id, providerReference: "psp_test" });
    await expect(confirmSubscriptionPayment(db, {
      subscriptionId: subscription.id, verifiedPaymentIntentId: foreign.id,
    })).rejects.toMatchObject({ code: "PAYMENT_UNVERIFIED" });
    // Right owner, wrong money.
    const { intent: wrongAmount } = await createPaymentIntent(db, {
      ownerId: "user-9", payerRef: "user-9", payeeRef: "owner-1",
      amountMinor: "4999", currency: "KWD", purpose: "x", idempotencyKey: "h-wrong-amt",
      providerRef: "stub-psp",
    });
    await transitionPaymentIntent(db, { id: wrongAmount.id, to: "EXECUTING" });
    await applyProviderCapture(db, { psp: readbackStub("4999", "CAPTURED", wrongAmount.id), providerRef: "stub-psp" }, { intentId: wrongAmount.id, providerReference: "psp_test" });
    await expect(confirmSubscriptionPayment(db, {
      subscriptionId: subscription.id, verifiedPaymentIntentId: wrongAmount.id,
    })).rejects.toMatchObject({ code: "PAYMENT_UNVERIFIED" });
  });

  it("webhook with a VALID signature but wrong owner or amount is rejected at correlation", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "1000", currency: "KWD", purpose: "p", idempotencyKey: "h-wh",
    });
    // The account this payment was executed at. Without it the callbacks below
    // are refused for a reason this test is not about: a callback concerning a
    // payment that reached no provider account cannot be evidence about it, and
    // is now refused before any signature is checked.
    await bindIntentToProviderAccount(db, intent.id, {
      providerRef: "psp-controlled",
      bindingRef: "pb-controlled",
    });
    const sign = (body: string) => createHmac("sha256", psp.webhookSecret).update(body, "utf8").digest("hex");

    const goodBody = JSON.stringify({ eventType: "payment.captured", reference: intent.id, amountMinor: "1000", currency: "KWD" });
    const wrongOwner = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "h-wh-1", eventType: "payment.captured",
      reference: intent.id, rawBody: goodBody, signature: sign(goodBody), timestamp: Date.now(), ownerId: "attacker",
    });
    expect(wrongOwner.outcome).toBe("REJECTED");

    const badAmount = JSON.stringify({ eventType: "payment.captured", reference: intent.id, amountMinor: "1", currency: "KWD" });
    const amountMismatch = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "h-wh-2", eventType: "payment.captured",
      reference: intent.id, rawBody: badAmount, signature: sign(badAmount), timestamp: Date.now(), ownerId: "owner-1",
    });
    expect(amountMismatch.outcome).toBe("REJECTED");

    // Metadata lying about the signed body is rejected too.
    const metaLie = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "h-wh-3", eventType: "payment.refunded",
      reference: intent.id, rawBody: goodBody, signature: sign(goodBody), timestamp: Date.now(), ownerId: "owner-1",
    });
    expect(metaLie.outcome).toBe("REJECTED");

    // The honest delivery is accepted.
    const honest = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "h-wh-4", eventType: "payment.captured",
      reference: intent.id, rawBody: goodBody, signature: sign(goodBody), timestamp: Date.now(), ownerId: "owner-1",
    });
    expect(honest.outcome).toBe("ACCEPTED");
  });

  it("concurrent refunds with the same key produce exactly one ledger entry and one provider refund", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "7000", currency: "KWD", purpose: "p", idempotencyKey: "h-rf",
    });
    await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    const [a, b] = await Promise.allSettled([
      refundPaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id, idempotencyKey: "h-rf-key" }),
      refundPaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id, idempotencyKey: "h-rf-key" }),
    ]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled"); // idempotent replay, not failure
    const entries = await db.select().from(economicLedgerEntries).where(eq(economicLedgerEntries.idempotencyKey, "h-rf-key"));
    expect(entries).toHaveLength(1);
    expect([...psp.payments.values()][0].status).toBe("REFUNDED");
  });

  it("the public transition API can never establish CAPTURED truth — not even with forged evidence money", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "5000", currency: "KWD", purpose: "p", idempotencyKey: "h-truth",
      providerRef: "stub-psp",
    });
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "CAPTURED" })).rejects.toThrow();
    await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
    await expect(transitionPaymentIntent(db, { id: intent.id, to: "CAPTURED" })).rejects.toThrow();
    // A readback that LIES about the money can never capture the mandate.
    await expect(applyProviderCapture(db, { psp: readbackStub("1", "CAPTURED", intent.id), providerRef: "stub-psp" }, { intentId: intent.id, providerReference: "psp_fake" }))
      .rejects.toMatchObject({ code: "NOT_VERIFIED" });
  });

  it("one signed callback with many caller eventKeys ingests exactly once", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "1000", currency: "KWD", purpose: "p", idempotencyKey: "h-replay",
    });
    // The account this payment was executed at. Without it the callbacks below
    // are refused for a reason this test is not about: a callback concerning a
    // payment that reached no provider account cannot be evidence about it, and
    // is now refused before any signature is checked.
    await bindIntentToProviderAccount(db, intent.id, {
      providerRef: "psp-controlled",
      bindingRef: "pb-controlled",
    });
    const body = JSON.stringify({ eventType: "payment.captured", reference: intent.id, amountMinor: "1000", currency: "KWD" });
    const signature = createHmac("sha256", psp.webhookSecret).update(body, "utf8").digest("hex");
    const outcomes: string[] = [];
    for (const key of ["k1", "k2", "k3"]) {
      outcomes.push((await ingestAuthenticatedExternalEvent(db, dispatcher, {
        provider: "psp-controlled", connectorId: "c", eventKey: key, eventType: "payment.captured",
        reference: intent.id, rawBody: body, signature, timestamp: Date.now(), ownerId: "owner-1",
      })).outcome);
    }
    expect(outcomes).toEqual(["ACCEPTED", "DUPLICATE", "DUPLICATE"]);
  });

  it("a financial callback with no correlatable payment intent fails closed", async () => {
    const { db } = await getTestDb();
    const body = JSON.stringify({ eventType: "payment.captured", reference: "pint_unknown", amountMinor: "1000", currency: "KWD" });
    const signature = createHmac("sha256", psp.webhookSecret).update(body, "utf8").digest("hex");
    const result = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "k", eventType: "payment.captured",
      reference: "pint_unknown", rawBody: body, signature, timestamp: Date.now(), ownerId: "owner-1",
    });
    expect(result.outcome).toBe("REJECTED");
  });

  it("financial callbacks missing required SIGNED fields are rejected even with a valid signature", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "1000", currency: "KWD", purpose: "p", idempotencyKey: "h-schema",
    });
    // The account this payment was executed at. Without it the callbacks below
    // are refused for a reason this test is not about: a callback concerning a
    // payment that reached no provider account cannot be evidence about it, and
    // is now refused before any signature is checked.
    await bindIntentToProviderAccount(db, intent.id, {
      providerRef: "psp-controlled",
      bindingRef: "pb-controlled",
    });
    const sign = (body: string) => createHmac("sha256", psp.webhookSecret).update(body, "utf8").digest("hex");
    // Signed body WITHOUT a reference; unsigned caller metadata points at a real intent.
    const noRef = JSON.stringify({ eventType: "payment.captured", amountMinor: "1000", currency: "KWD" });
    expect((await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "s1", eventType: "payment.captured",
      reference: intent.id, rawBody: noRef, signature: sign(noRef), timestamp: Date.now(), ownerId: "owner-1",
    })).outcome).toBe("REJECTED");
    // Signed body WITHOUT amount/currency.
    const noMoney = JSON.stringify({ eventType: "payment.captured", reference: intent.id });
    expect((await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "c", eventKey: "s2", eventType: "payment.captured",
      reference: intent.id, rawBody: noMoney, signature: sign(noMoney), timestamp: Date.now(), ownerId: "owner-1",
    })).outcome).toBe("REJECTED");
  });

  it("a captured provider payment for ANOTHER intent can never establish truth here", async () => {
    const { db } = await getTestDb();
    const pspClient = createHttpPspClient(psp.url);
    const mk = async (key: string) => (await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "7000", currency: "KWD", purpose: "p", idempotencyKey: key,
      providerRef: "psp-controlled",
    })).intent;
    const a = await mk("h-xa");
    const b = await mk("h-xb");
    await transitionPaymentIntent(db, { id: a.id, to: "EXECUTING" });
    await transitionPaymentIntent(db, { id: b.id, to: "EXECUTING" });
    // Two REAL provider payments: identical money, different JASIM references.
    const payA = await pspClient.authorize({ amountMinor: "7000", currency: "KWD", reference: a.id, idempotencyKey: "h-xa" });
    await pspClient.capture(payA.id);
    const payB = await pspClient.authorize({ amountMinor: "7000", currency: "KWD", reference: b.id, idempotencyKey: "h-xb" });
    await pspClient.capture(payB.id);
    // Cross-application attempts must fail and preserve NO entitlement.
    await expect(applyProviderCapture(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: a.id, providerReference: payB.id }))
      .rejects.toMatchObject({ code: "NOT_VERIFIED" });
    await expect(applyProviderCapture(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: b.id, providerReference: payA.id }))
      .rejects.toMatchObject({ code: "NOT_VERIFIED" });
    expect((await getPaymentIntent(db, a.id))?.status).toBe("EXECUTING");
    expect((await getPaymentIntent(db, b.id))?.status).toBe("EXECUTING");
    // The correctly bound reference works.
    const done = await applyProviderCapture(db, { psp: pspClient, providerRef: "psp-controlled" }, { intentId: a.id, providerReference: payA.id });
    expect(done.status).toBe("CAPTURED");
  });

  it("cross-provider readback with colliding payment ids can never establish truth", async () => {
    const { db } = await getTestDb();
    const pspB = await startControlledPsp();
    try {
      const clientA = createHttpPspClient(psp.url);
      const clientB = createHttpPspClient(pspB.url);
      const { intent } = await createPaymentIntent(db, {
        ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
        amountMinor: "7000", currency: "KWD", purpose: "p", idempotencyKey: "h-xp",
        providerRef: "psp-a",
      });
      await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
      // Provider B hosts a COLLIDING payment: fresh id space, the SAME JASIM
      // reference and money — replayed reference or misrouted response.
      const forged = await clientB.authorize({ amountMinor: "7000", currency: "KWD", reference: intent.id, idempotencyKey: "h-xp-b" });
      await clientB.capture(forged.id);
      // Every same-provider guard passes on B's view; the durable provider
      // binding rejects the cross-provider attribution BEFORE any truth.
      await expect(applyProviderCapture(db, { psp: clientB, providerRef: "psp-b" }, { intentId: intent.id, providerReference: forged.id }))
        .rejects.toMatchObject({ code: "PROVIDER_BINDING" });
      // A bound intent with an UNIDENTIFIED client is rejected too.
      await expect(applyProviderCapture(db, { psp: clientA }, { intentId: intent.id, providerReference: forged.id }))
        .rejects.toMatchObject({ code: "PROVIDER_BINDING" });
      expect((await getPaymentIntent(db, intent.id))?.status).toBe("EXECUTING");
      // The genuinely bound provider path works.
      const payA = await clientA.authorize({ amountMinor: "7000", currency: "KWD", reference: intent.id, idempotencyKey: "h-xp" });
      await clientA.capture(payA.id);
      const done = await applyProviderCapture(db, { psp: clientA, providerRef: "psp-a" }, { intentId: intent.id, providerReference: payA.id });
      expect(done.status).toBe("CAPTURED");
    } finally {
      await pspB.close();
    }
  });

  it("an UNBOUND intent can never reach a provider without a trusted identity", async () => {
    const { db } = await getTestDb();
    const { intent } = await createPaymentIntent(db, {
      ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
      amountMinor: "1000", currency: "KWD", purpose: "p", idempotencyKey: "h-unbound",
    });
    // Direct truth application on an unbound intent rejects before PSP access.
    await expect(applyProviderCapture(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id, providerReference: "pay_x" }))
      .rejects.toMatchObject({ code: "PROVIDER_BINDING" });
    // Execution without a provider identity rejects before any authorize call.
    await expect(executePaymentEffect(db, { psp: createHttpPspClient(psp.url) }, { intentId: intent.id }))
      .rejects.toMatchObject({ code: "PROVIDER_BINDING" });
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("FAILED");
    // No provider payment was ever created for this intent.
    expect([...psp.payments.values()].filter((p) => p.reference === intent.id)).toHaveLength(0);
  });
});
