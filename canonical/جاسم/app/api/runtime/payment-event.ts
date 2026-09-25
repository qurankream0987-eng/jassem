/**
 * JASIM — THE PROVIDER SAID SOMETHING. THAT IS NOT THE SAME AS IT BEING TRUE.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   PROVIDER_EVENT != PAYMENT_TRUTH · AUTHENTICATED_EVENT != SETTLED
 *   EVENT_RECEIVED != EVENT_VERIFIED
 *   WEBHOOK_SUCCESS_FIELD != SETTLEMENT_PROOF
 *   EVENT_ID != PAYMENT_INTENT_ID · DUPLICATE_EVENT != DUPLICATE_EFFECT
 *   WEBHOOK != PAY · PROVIDER_CALLBACK != EXECUTION_AUTHORITY
 *
 * ─── WHAT THE TRACE FOUND ───────────────────────────────────────────────────
 *
 * Every part of this already existed, and none of them were joined.
 *
 * `ingestAuthenticatedExternalEvent` authenticates an HMAC over the exact raw
 * bytes against a catalog-bound secret, refuses a stale timestamp, refuses a
 * financial callback whose signed body does not itself carry its event type,
 * reference, amount and currency, refuses one whose amount or currency
 * disagrees with the mandate, refuses one that correlates to no known payment,
 * derives ownership from the INTENT rather than the caller, and derives the
 * replay key from the SIGNED body so a caller cannot mint a fresh one for the
 * same bytes. `external_webhook_events` deduplicates on a unique index, which
 * is durable across processes. `verifyPaymentClaim` weighs a claim against the
 * authoritative readback.
 *
 * And nothing in production called the last one, or moved a payment because an
 * event arrived. So a provider that settles asynchronously — the ordinary case
 * for a bank transfer, a delayed capture, or a payer who closed the browser —
 * had no way to tell JASIM so.
 *
 * ─── WHAT THIS ADDS ─────────────────────────────────────────────────────────
 *
 * The join, and nothing else. No table: the ledger that deduplicates was
 * already the right ledger. No verifier: the one that weighs a claim against a
 * readback was already the right verifier. No state machine: the transitions
 * that apply truth were already the right transitions.
 *
 * ─── AND WHAT IT CANNOT DO ──────────────────────────────────────────────────
 *
 * Spend anything. The only provider call reachable from here is a readback —
 * `verifyPaymentClaim` and `applyProviderSettlement` each make exactly one, and
 * neither authorize, capture nor refund is imported into this file at all.
 *
 *   EVENT_PATH_PAY_CALLS = 0 · EVENT_PATH_CAPTURE_CALLS = 0
 *   EVENT_PATH_REFUND_CALLS = 0
 *   REVOKED_BINDING_NEW_MUTATION_FROM_EVENT = 0
 */

import { eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { paymentIntents } from "@db/schema";
import type { ContinuationDispatcher } from "./block2/temporal";
import { ingestAuthenticatedExternalEvent } from "./block3/webhook-auth";
import {
  applyProviderCapture,
  applyProviderSettlement,
  verifyPaymentClaim,
} from "./block3/payment-execution";
import { paymentExecutionRoute } from "./payment-route";

/**
 * What an event was allowed to change, and why.
 *
 * Every outcome but the last two leaves the payment exactly as it was. That is
 * not a failure mode — it is most of what this function does.
 */
export const PAYMENT_EVENT_OUTCOMES = [
  /** It did not authenticate, or did not correlate. Nothing happened. */
  "REJECTED",
  /** These exact signed bytes were already seen. One event, one effect. */
  "DUPLICATE",
  /** It arrived behind the state it describes. */
  "STALE",
  /** Authenticated and recorded, and it moved no payment. */
  "NO_EFFECT",
  /** The provider's own readback did not bear the claim out. */
  "UNVERIFIED",
  /** The readback bore it out, and the payment moved. */
  "APPLIED",
] as const;
export type PaymentEventOutcome = (typeof PAYMENT_EVENT_OUTCOMES)[number];

export type PaymentEventResult = {
  readonly outcome: PaymentEventOutcome;
  readonly reason: string;
  readonly paymentIntentId?: string;
  /** The canonical status afterwards. Set by the payment runtime, not here. */
  readonly paymentStatus?: string;
};

/**
 * Terminal states an event may never walk backwards.
 *
 * An out-of-order callback describing an older moment is a fact about the
 * past, and the past does not get to overwrite a settlement that already
 * happened.
 *
 *   OUT_OF_ORDER_EVENT_DOWNGRADES_TERMINAL_STATE = 0
 */
const TERMINAL: ReadonlySet<string> = new Set(["SETTLED", "CAPTURED", "FAILED", "CANCELLED", "EXPIRED"]);

/**
 * A provider event arrives.
 *
 * The caller is the server's own webhook route: it passes the exact bytes it
 * received and the provider identity the ROUTE was registered under. There is
 * no parameter here a model could reach, and no way for one to name a
 * provider, a payment, a secret or a binding.
 *
 *   MODEL_CAN_SELECT_WEBHOOK_PROVIDER = NO
 *   UNAUTHENTICATED_EVENT_CAN_CHANGE_PAYMENT = 0
 */
export async function ingestPaymentEvent(
  dispatcher: ContinuationDispatcher,
  input: {
    /** The provider the ROUTE belongs to. Server-owned, never from the body. */
    provider: string;
    connectorId: string;
    eventKey: string;
    eventType: string;
    /** The canonical PaymentIntent id, and the signed body must agree. */
    reference: string;
    rawBody: string;
    signature?: string;
    timestamp?: number;
    ownerId: string;
    now?: Date;
  },
): Promise<PaymentEventResult> {
  // ── 1 · AUTHENTICATE, CORRELATE, DEDUPLICATE ────────────────────────────
  //
  // Entirely the existing boundary's. A bad signature, an unknown provider, a
  // stale timestamp, a body that does not carry its own amount, an amount that
  // disagrees with the mandate, or a reference matching no payment all stop
  // here — before anything in this file has looked at a payment.
  const ingested = await ingestAuthenticatedExternalEvent(db as never, dispatcher, {
    provider: input.provider,
    connectorId: input.connectorId,
    eventKey: input.eventKey,
    eventType: input.eventType,
    reference: input.reference,
    rawBody: input.rawBody,
    ...(input.signature ? { signature: input.signature } : {}),
    ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
    ownerId: input.ownerId,
    ...(input.now ? { now: input.now } : {}),
  });
  if (ingested.outcome !== "ACCEPTED") {
    // DUPLICATE is the load-bearing one: the same authenticated bytes arriving
    // a hundred times, on any number of processes, reach this line and stop.
    //
    //   DUPLICATE_EVENT_CAN_DUPLICATE_EFFECT = 0 · CROSS_PROCESS_EVENT_REPLAY = 0
    return {
      outcome: ingested.outcome === "DUPLICATE" ? "DUPLICATE" : ingested.outcome === "STALE" ? "STALE" : "REJECTED",
      reason: "reason" in ingested ? ingested.reason : "Not accepted",
    };
  }

  // ── 2 · THE PAYMENT IT CLAIMS TO BE ABOUT ───────────────────────────────
  //
  // Found by the reference the signed body carried and the boundary already
  // matched against the mandate. Never by amount, by owner, by recency or by
  // «the only open one».
  //
  //   AMBIGUOUS_EVENT_PAYMENT_MATCH = 0
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, input.reference))
    .limit(1);
  if (!intent) {
    return { outcome: "REJECTED", reason: "No such payment." };
  }
  if (TERMINAL.has(intent.status)) {
    return {
      outcome: "NO_EFFECT",
      reason: `This payment is already ${intent.status}.`,
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
    };
  }
  if (!intent.providerReference) {
    // Nothing was executed at the provider, so there is nothing of theirs to
    // read back. An event about it proves nothing whatever it says.
    return {
      outcome: "NO_EFFECT",
      reason: "This payment has no provider execution to verify.",
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
    };
  }

  // ── 3 · THE RAIL IT WAS EXECUTED ON ─────────────────────────────────────
  //
  // Rebuilt from the payment, and refused if it now resolves elsewhere — the
  // same law the challenge continuation follows, for the same reason: reading
  // one provider's state to settle a payment made at another attributes a
  // settlement to the wrong rail.
  const routed = await paymentExecutionRoute({
    payable: { payeeRef: intent.payeeRef },
    payerScopeId: intent.ownerId,
  });
  if (routed.status !== "RESOLVED" || routed.route.definitionId !== intent.providerRef) {
    return {
      outcome: "NO_EFFECT",
      reason: "No usable route to the provider this payment was executed on.",
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
    };
  }

  // ── 4 · WEIGH THE CLAIM AGAINST THE PROVIDER'S OWN STATE ────────────────
  //
  // The existing verifier, unchanged. A signed body saying CAPTURED and a
  // readback saying anything else is NOT VERIFIED — the signature
  // authenticated who spoke, and never what they said.
  //
  //   EVENT_SUCCESS_BYPASSES_VERIFICATION = 0
  const claimed = claimFrom(input.rawBody);
  const verdict = await verifyPaymentClaim(db as never, routed.deps, {
    intentId: intent.id,
    providerReference: intent.providerReference,
    claim: claimed,
  });
  if (!verdict.verified) {
    // Including when there is no authoritative state to read at all.
    //
    //   UNKNOWN != SUCCESS
    return {
      outcome: "UNVERIFIED",
      reason: verdict.reason,
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
    };
  }

  // ── 5 · APPLY, THROUGH THE TRANSITIONS THAT ALREADY EXIST ───────────────
  //
  // Each re-reads the provider itself and re-checks the money and the binding
  // before it writes. This function adds no transition of its own.
  const apply = verdict.authoritativeStatus === "SETTLED" ? applyProviderSettlement : applyProviderCapture;
  if (verdict.authoritativeStatus !== "SETTLED" && verdict.authoritativeStatus !== "CAPTURED") {
    return {
      outcome: "NO_EFFECT",
      reason: `The provider's own state is ${verdict.authoritativeStatus ?? "unknown"}.`,
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
    };
  }
  // The appliers refuse by THROWING, and they refuse on one thing the verifier
  // above does not check: whether the readback is bound to THIS payment.
  // `verifyPaymentClaim` weighs status and money; `viewBindsToIntent` weighs
  // identity. Both must hold, and a webhook route that threw on the second
  // would be a route that returns 500 to a provider who did nothing wrong.
  //
  // Nothing is written before the refusal, so catching it reports the same
  // fact the throw carried, and leaves the payment exactly as it was.
  //
  //   WRONG_PROVIDER_REFERENCE_EVENT_SETTLES = 0
  try {
    const applied = await apply(db as never, routed.deps, {
      intentId: intent.id,
      providerReference: intent.providerReference,
    });
    return {
      outcome: "APPLIED",
      reason: verdict.reason,
      paymentIntentId: applied.id,
      paymentStatus: applied.status,
    };
  } catch (error) {
    return {
      outcome: "UNVERIFIED",
      reason: error instanceof Error ? error.message : "The provider's state does not attest this.",
      paymentIntentId: intent.id,
      paymentStatus: intent.status,
    };
  }
}

/**
 * What the signed body CLAIMS.
 *
 * Read from the bytes that were authenticated, and treated as a claim for the
 * verifier to weigh — never as a finding. There is no provider name here and
 * no branch on one: an adapter normalises whatever its own system calls a
 * settlement into this shape before it reaches the route.
 *
 *   PROVIDER_NAME_EVENT_BRANCHES = 0 · DOMAIN_EVENT_HANDLERS_ADDED = 0
 */
function claimFrom(rawBody: string): { status: string; amountMinor?: string; currency?: string } {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: "UNKNOWN" };
  }
  const text = (key: string): string | undefined =>
    typeof payload[key] === "string" ? (payload[key] as string) : undefined;
  return {
    status: text("status") ?? "UNKNOWN",
    ...(text("amountMinor") ? { amountMinor: text("amountMinor")! } : {}),
    ...(text("currency") ? { currency: text("currency")! } : {}),
  };
}
