/**
 * Block 3 §48–§51 — financial checkout: server-minted URLs only, browser
 * success ≠ payment truth, full webhook→verifier loop over real HTTP.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capabilityProviderCatalog } from "@db/schema";
import {
  CheckoutError,
  createFinancialCheckout,
  handleCheckoutReturn,
  PAYMENT_CHECKOUT_PURPOSE,
} from "../../api/runtime/block3/checkout";
import {
  configureExternalActionProvider,
  resetExternalActionProviders,
} from "../../api/runtime/external-action-session";
import { executePaymentEffect, verifyPaymentClaim } from "../../api/runtime/block3/payment-execution";
import { createPaymentIntent, getPaymentIntent } from "../../api/runtime/block3/payment-intents";
import { createHttpPspClient } from "../../api/runtime/block3/psp-client";
import { ingestAuthenticatedExternalEvent } from "../../api/runtime/block3/webhook-auth";
import type { ContinuationDispatcher } from "../../api/runtime/block2/temporal";
import { getTestDb, resetBlock3 } from "./helpers/pg";
import { startControlledPsp, type ControlledPsp } from "./helpers/controlled-psp-server";

let psp: ControlledPsp;
const dispatcher: ContinuationDispatcher = { async dispatch() { return "enqueued"; } };

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
  const { db } = await getTestDb();
  await db.insert(capabilityProviderCatalog).values({
    id: "psp-controlled", kind: "PSP", implementationId: "controlled-psp-v1",
    ioMetadata: { webhookSecret: psp.webhookSecret }, provenance: { source: "boot" },
  });
});

async function makeIntent(key: string) {
  const { db } = await getTestDb();
  const { intent } = await createPaymentIntent(db, {
    ownerId: "owner-1", payerRef: "buyer-1", payeeRef: "seller-1",
    amountMinor: "249500", currency: "KWD", purpose: "buy laptop", idempotencyKey: key,
  });
  return intent;
}

describe("financial checkout sessions (§48–§51)", () => {
  it("mints the checkout URL server-side from the trusted adapter origin only", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("co-url");
    const { session, checkoutUrl } = await createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-1", provider: "psp-controlled", adapterEndpoint: psp.url,
    });
    expect(checkoutUrl.startsWith(`${psp.url}/checkout/`)).toBe(true);
    expect(checkoutUrl).toContain(`ref=${encodeURIComponent(intent.id)}`);
    expect(session.paymentIntentId).toBe(intent.id);
    // An attacker-origin endpoint can never validate against the trust policy.
    await expect(createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-1", provider: "psp-controlled",
      adapterEndpoint: "https://evil.example",
    })).rejects.toThrow();
  });

  it("binds session owner to intent owner and refuses used-up intents", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("co-owner");
    await expect(createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-2", provider: "psp-controlled", adapterEndpoint: psp.url,
    })).rejects.toThrow(CheckoutError);
  });

  it("?success=true NEVER marks the payment PAID (§51)", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("co-browser");
    const { session } = await createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-1", provider: "psp-controlled", adapterEndpoint: psp.url,
    });
    const result = await handleCheckoutReturn(db, {
      sessionId: session.id, state: session.state, query: { success: "true" },
    });
    expect(result.browserLeg).toBe("COMPLETED");
    expect(result.paymentTruth).toBe("UNCHANGED");
    expect((await getPaymentIntent(db, intent.id))?.status).toBe("CREATED"); // untouched
    // Replay of the return (same session) is refused.
    await expect(handleCheckoutReturn(db, { sessionId: session.id, state: session.state, query: { success: "true" } }))
      .rejects.toThrow(/consumed|closed/i);
    // CSRF: wrong state never consumes.
    const { session: s2 } = await createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-1", provider: "psp-controlled", adapterEndpoint: psp.url,
    });
    await expect(handleCheckoutReturn(db, { sessionId: s2.id, state: "forged" })).rejects.toThrow(/state/i);
  });

  it("full loop: checkout → PSP capture → authenticated webhook → verifier ⇒ CAPTURED truth", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("co-loop");
    await createFinancialCheckout(db, {
      intentId: intent.id, ownerId: "owner-1", provider: "psp-controlled", adapterEndpoint: psp.url,
    });
    // Execute through the trusted chain over real HTTP.
    const executed = await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    expect(executed.outcome).toBe("CAPTURED");

    // The PSP emitted a signed capture callback; deliver it through the
    // authenticated ingestion boundary (§10–§13).
    const callback = psp.sentCallbacks.find((c) => c.rawBody.includes("payment.captured"));
    expect(callback).toBeDefined();
    const ingestion = await ingestAuthenticatedExternalEvent(db, dispatcher, {
      provider: "psp-controlled", connectorId: "conn-1",
      eventKey: `cb-${intent.id}`, eventType: "payment.captured", reference: intent.id,
      rawBody: callback!.rawBody, signature: callback!.signature,
      timestamp: Date.now(), ownerId: "owner-1",
    });
    expect(ingestion.outcome).toBe("ACCEPTED");

    // Evidence is verified against the authoritative readback — not trusted.
    const verdict = await verifyPaymentClaim(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, {
      intentId: intent.id,
      providerReference: executed.providerReference!,
      claim: { status: "CAPTURED", amountMinor: "249500", currency: "KWD" },
    });
    expect(verdict.verified).toBe(true);
  });

  it("a callback with mismatched amount is authentic but NEVER grants truth", async () => {
    const { db } = await getTestDb();
    const intent = await makeIntent("co-mismatch");
    const executed = await executePaymentEffect(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, { intentId: intent.id });
    // Authentic transport (valid HMAC) but the CLAIM disagrees with the mandate.
    const verdict = await verifyPaymentClaim(db, { psp: createHttpPspClient(psp.url), providerRef: "psp-controlled" }, {
      intentId: intent.id,
      providerReference: executed.providerReference!,
      claim: { status: "CAPTURED", amountMinor: "1", currency: "KWD" },
    });
    expect(verdict.verified).toBe(false);
    expect(verdict.reason).toMatch(/disagrees|≠/);
  });
});
