/**
 * Block 3 §48–§51 — financial checkout sessions.
 *
 * Reuses the Block 1 ExternalActionSession machinery (server-owned trust
 * registry, purpose-bound origins, nonce/state, expiry) with a financial
 * binding: the session carries the PaymentIntent it pays for.
 *
 * Permanent truths:
 * - The checkout URL is constructed SERVER-SIDE from the trusted adapter's
 *   configured origin. Callers never supply a URL; the LLM can never mint
 *   one. (§49)
 * - Browser presentation is never transaction truth: a return URL carrying
 *   ?success=true NEVER marks a payment PAID. Payment truth changes only
 *   through authenticated webhooks + the verifier + authoritative
 *   readback. (§50–§51)
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { externalActionSessions, type ExternalActionSession } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import {
  ExternalActionSessionError,
  getExternalActionPolicy,
  validateExternalActionUrl,
} from "../external-action-session";
import { getPaymentIntent } from "./payment-intents";

export const PAYMENT_CHECKOUT_PURPOSE = "payment_checkout";
const DEFAULT_CHECKOUT_TTL_MS = 10 * 60 * 1000;

export class CheckoutError extends Error {
  readonly code: "NOT_FOUND" | "OWNER_MISMATCH" | "INVALID_STATE" | "INVALID_RETURN";
constructor(
    message: string,
    code: "NOT_FOUND" | "OWNER_MISMATCH" | "INVALID_STATE" | "INVALID_RETURN",
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * Create a payment-bound checkout session. The URL is built from the
 * trusted adapter endpoint and validated against the provider's configured
 * payment_checkout policy (approved origins + path prefixes).
 */
export async function createFinancialCheckout(
  db: Block2Db,
  input: {
    intentId: string;
    ownerId: string;
    provider: string;
    /** Trusted adapter endpoint (catalog-bound); the URL is derived, never caller-supplied. */
    adapterEndpoint: string;
    ttlMs?: number;
    now?: Date;
  },
): Promise<{ session: ExternalActionSession; checkoutUrl: string }> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new CheckoutError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  if (intent.ownerId !== input.ownerId) {
    throw new CheckoutError("Checkout session owner must equal the payment intent owner", "OWNER_MISMATCH");
  }
  if (intent.status !== "CREATED" && intent.status !== "REQUIRES_APPROVAL") {
    throw new CheckoutError(`Cannot check out a payment in state ${intent.status}`, "INVALID_STATE");
  }

  const sessionToken = randomUUID();
  const candidate = `${input.adapterEndpoint.replace(/\/+$/, "")}/checkout/${sessionToken}?ref=${encodeURIComponent(intent.id)}`;
  const policy = getExternalActionPolicy(input.provider, PAYMENT_CHECKOUT_PURPOSE);
  const { url, origin } = validateExternalActionUrl(candidate, policy);

  const now = input.now ?? new Date();
  const [session] = await db
    .insert(externalActionSessions)
    .values({
      id: randomUUID(),
      ownerId: input.ownerId,
      provider: input.provider,
      purpose: PAYMENT_CHECKOUT_PURPOSE,
      url: url.toString(),
      origin,
      nonce: randomUUID(),
      state: randomUUID(),
      runId: null,
      transactionIntentId: intent.transactionIntentId ?? null,
      paymentIntentId: intent.id,
      status: "active",
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_CHECKOUT_TTL_MS)),
    })
    .returning();
  return { session, checkoutUrl: url.toString() };
}

export type CheckoutReturnResult = {
  browserLeg: "COMPLETED" | "FAILED";
  /** Always "UNCHANGED": the browser leg never moves payment truth. */
  paymentTruth: "UNCHANGED";
  intentStatus: string;
};

/**
 * Handle the browser return from the provider checkout. Consumes the
 * session (state-bound, single-use, expiry-checked) and reports the browser
 * leg — WITHOUT touching payment truth. `?success=true` is presentation.
 */
export async function handleCheckoutReturn(
  db: Block2Db,
  input: { sessionId: string; state: string; query?: Record<string, string>; now?: Date },
): Promise<CheckoutReturnResult> {
  const now = input.now ?? new Date();
  const [session] = await db
    .select()
    .from(externalActionSessions)
    .where(eq(externalActionSessions.id, input.sessionId))
    .limit(1);
  if (!session) throw new CheckoutError(`Checkout session not found: ${input.sessionId}`, "NOT_FOUND");
  if (session.state !== input.state) {
    throw new CheckoutError("Checkout return state mismatch", "INVALID_RETURN");
  }
  if (session.status !== "active") {
    throw new CheckoutError("Checkout session already consumed or closed", "INVALID_RETURN");
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new ExternalActionSessionError("Checkout session expired");
  }
  await db
    .update(externalActionSessions)
    .set({ status: "used", usedAt: now })
    .where(eq(externalActionSessions.id, session.id));

  const success = input.query?.success === "true";
  const intent = session.paymentIntentId ? await getPaymentIntent(db, session.paymentIntentId) : null;
  return {
    browserLeg: success ? "COMPLETED" : "FAILED",
    paymentTruth: "UNCHANGED",
    intentStatus: intent?.status ?? "UNKNOWN",
  };
}
