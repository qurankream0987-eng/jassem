/**
 * Block 3 §10–§13 — authenticated financial webhook ingestion.
 *
 * The Block 2 ingestion path (ingestExternalEvent) deliberately had no
 * authentication input. Consequential financial callbacks MUST enter through
 * this authenticated boundary instead:
 *
 *   raw callback → identify ProviderBinding → verify HMAC over the EXACT raw
 *   body bytes → verify timestamp freshness → replay protection (existing
 *   provider+eventKey dedupe) → normalize → canonical ingestion.
 *
 * Fail-closed: unknown provider, missing secret, invalid signature, stale
 * timestamp, malformed body — all reject with zero canonical effects.
 *
 * The verification material is resolved SERVER-SIDE from the provider BINDING
 * whose account the callback is about — sealed in the credential vault, never
 * from discovery metadata, never from the callback itself, and never from
 * anything the caller sent. See `api/runtime/webhook-verification.ts`.
 *
 *   CLIENT_CAN_OVERRIDE_WEBHOOK_SECRET = 0
 *   BODY_SECRET_USED = 0 · QUERY_SECRET_USED = 0
 *
 * VALID_SIGNATURE ≠ VERIFIED: a valid signature authenticates the evidence
 * source only. What the evidence proves is decided later by the Verifier.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { paymentIntents } from "@db/schema";
import type { Block2Db, ContinuationDispatcher } from "../block2/temporal";
import {
  ingestExternalEvent,
  type ExternalIngestResult,
} from "../block2/events";
import { webhookVerificationResolver } from "../webhook-verification";

/** Maximum accepted callback age (replay/staleness window). */
export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** HMAC-SHA256 over the exact raw body bytes (never parse→reserialize). */
export function verifyRawBodyHmacSha256(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const normalized = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return constantTimeTextEqual(normalized.toLowerCase(), expected);
}

export type AuthenticatedIngestResult =
  | ExternalIngestResult
  | { outcome: "REJECTED"; reason: string };

export async function ingestAuthenticatedExternalEvent(
  db: Block2Db,
  dispatcher: ContinuationDispatcher,
  input: {
    provider: string;
    connectorId: string;
    eventKey: string;
    eventType: string;
    reference: string;
    /** Exact raw request body bytes (utf8). Verification runs against this. */
    rawBody: string;
    /** Provider signature header (hex or sha256=hex). */
    signature?: string;
    /** Provider-declared event timestamp (ms epoch) for freshness. */
    timestamp?: number;
    /**
     * OPTIONAL, and for a `payment.*` callback it should be absent.
     *
     * A public HTTP ingress has no legitimate way to know whose payment an
     * event concerns, and a caller that could name an owner would be naming
     * authority. So for a financial callback the owner is DERIVED from the
     * correlated PaymentIntent below; when a caller does supply one it is
     * checked against the intent rather than believed.
     *
     *   CALLER_OWNER_ID != CANONICAL_OWNER_AUTHORITY
     *   HTTP_CALLER_CAN_CHOOSE_OWNER = 0
     *
     * A NON-financial event has no intent to derive from, so it still requires
     * one from its trusted server-side caller.
     */
    ownerId?: string;
    runId?: string | null;
    nodeId?: string | null;
    observedVersion?: number;
    now?: Date;
  },
): Promise<AuthenticatedIngestResult> {
  const now = input.now ?? new Date();

  // 1) WHOSE callback is this — before anything it says is believed.
  //
  // The route names a provider DEFINITION, which two different companies may
  // each hold their own account at. So the ACCOUNT is derived from the payment
  // the callback correlates to, and the material that authenticates it belongs
  // to that account's binding.
  //
  // Correlating on the unsigned reference is SELECTION, not belief: picking the
  // wrong account simply produces material the signature does not check out
  // against, and every field read here is re-checked against the SIGNED body
  // further down. Nothing has been trusted by the time the HMAC is verified.
  //
  //   ROUTE_PROVIDER_NAME != SECRET AUTHORITY
  //   PROVIDER_DEFINITION != PROVIDER_BINDING
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, input.reference))
    .limit(1);
  const routedAsFinancial = input.eventType.startsWith("payment.");
  if (routedAsFinancial && !intent) {
    return { outcome: "REJECTED", reason: "Financial callback does not correlate to a known payment intent" };
  }
  if (intent?.providerRef && intent.providerRef !== input.provider) {
    // Posted to one provider's route about a payment made at another. Refused
    // here rather than surviving to a readback that would attribute one
    // provider's settlement to a different rail.
    //
    //   CROSS_PROVIDER_SECRET_AUTHENTICATES = 0
    return { outcome: "REJECTED", reason: "That payment was not executed on this provider" };
  }
  if (intent && !intent.providerBindingRef) {
    // Either nothing was ever executed for this payment, or it was executed
    // before an account was recorded. An account nobody can name has no
    // callbacks that could be about it.
    return { outcome: "REJECTED", reason: "That payment has no executing provider account" };
  }
  if (!intent && input.ownerId === undefined) {
    // A non-financial callback has no payment to derive an account from, so it
    // still arrives only from trusted server-side code that already knows whose
    // it is. A public ingress supplies no owner and reaches none of this.
    return { outcome: "REJECTED", reason: "A non-financial callback requires its owner" };
  }

  // 2) The material, resolved from canonical state. No parameter of this
  //    function is a secret, a reference, a vault or a database.
  const material = await webhookVerificationResolver()({
    definitionId: input.provider,
    bindingId: intent?.providerBindingRef ?? null,
    // Only when there is no account to be exact about, so a missing binding can
    // never quietly widen into "any binding in the scope".
    scopeId: intent?.providerBindingRef ? null : (input.ownerId ?? null),
  });
  if (!material) {
    // Not connected, revoked, never configured, or unreadable — one refusal for
    // all of them, because telling them apart is an oracle.
    //
    //   MISSING_SECRET_AUTHENTICATES = 0
    return { outcome: "REJECTED", reason: "No webhook verification material for this provider" };
  }

  // 3) Authenticate: HMAC over the exact raw bytes.
  if (!verifyRawBodyHmacSha256(input.rawBody, input.signature, material.secret)) {
    return { outcome: "REJECTED", reason: "Invalid or missing signature" };
  }

  // 4) Freshness is checked below, AFTER the body is parsed — because a
  //    timestamp that is not itself signed is not evidence of anything:
  //
  //      FRESH_TIMESTAMP != AUTHENTICATED_TIMESTAMP
  //
  //    An old validly-signed body handed a fresh unsigned timestamp would
  //    otherwise pass a freshness check it never earned. The durable replay
  //    ledger is what actually stops a repeat of those bytes; this makes the
  //    freshness claim mean what it says.

  // 5) Only after authentication: parse the body (never verify reserialized).
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.rawBody);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { outcome: "REJECTED", reason: "Callback body must be a JSON object" };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { outcome: "REJECTED", reason: "Malformed JSON body" };
  }

  // 5b) Freshness, from the SIGNED body wherever it carries a timestamp.
  //
  //     A signed timestamp is authoritative and a caller-supplied one may not
  //     contradict it. Where the signed body carries none, the caller's is
  //     accepted for the window check exactly as before — and remains what it
  //     always was: a hint, behind the ledger.
  //
  //   UNSIGNED_TIMESTAMP_CAN_REFRESH_OLD_SIGNED_BODY = 0
  const signedTimestamp = typeof payload.timestamp === "number" ? payload.timestamp : undefined;
  if (signedTimestamp !== undefined && input.timestamp !== undefined && signedTimestamp !== input.timestamp) {
    return { outcome: "REJECTED", reason: "Callback timestamp disagrees with the signed payload" };
  }
  const freshnessAt = signedTimestamp ?? input.timestamp;
  if (freshnessAt !== undefined) {
    if (!Number.isFinite(freshnessAt)) {
      return { outcome: "REJECTED", reason: "Malformed timestamp" };
    }
    if (Math.abs(now.getTime() - freshnessAt) > WEBHOOK_MAX_AGE_MS) {
      return { outcome: "REJECTED", reason: "Stale callback timestamp" };
    }
  }

  // 6) Bind unsigned routing metadata to the SIGNED payload: a valid HMAC
  //    over body A can never be routed as event/owner B.
  if (typeof payload.eventType === "string" && payload.eventType !== input.eventType) {
    return { outcome: "REJECTED", reason: "eventType metadata disagrees with the signed payload" };
  }
  if (typeof payload.reference === "string" && payload.reference !== input.reference) {
    return { outcome: "REJECTED", reason: "reference metadata disagrees with the signed payload" };
  }

  // 6b) Financial callbacks have a STRICT signed schema: the signed body
  //     itself must carry the event type, the payment reference, and the
  //     amount/currency. Absent signed fields can never be backfilled by
  //     unsigned caller metadata.
  const signedEventType = typeof payload.eventType === "string" ? payload.eventType : null;
  const isFinancial =
    input.eventType.startsWith("payment.") || (signedEventType?.startsWith("payment.") ?? false);
  if (isFinancial) {
    if (signedEventType !== input.eventType) {
      return { outcome: "REJECTED", reason: "Financial callback must carry its event type in the signed body" };
    }
    if (typeof payload.reference !== "string" || payload.reference !== input.reference) {
      return { outcome: "REJECTED", reason: "Financial callback must carry its payment reference in the signed body" };
    }
    if (typeof payload.amountMinor !== "string" || typeof payload.currency !== "string") {
      return { outcome: "REJECTED", reason: "Financial callback must carry signed amount and currency" };
    }
  }

  // 7) Payment correlation + derived ownership: when the reference is a
  //    known payment intent, the event's owner is the INTENT's owner
  //    (derived — never caller-supplied) and its money must match the
  //    mandate exactly. The intent itself was loaded in step 1, because the
  //    account whose material authenticates the callback is derived from it.
  let ownerId = input.ownerId;
  if (intent) {
    // Supplied → checked. Absent → derived. Either way the intent decides.
    if (input.ownerId !== undefined && intent.ownerId !== input.ownerId) {
      return { outcome: "REJECTED", reason: "Callback owner disagrees with the payment intent owner" };
    }
    if (typeof payload.amountMinor === "string" && payload.amountMinor !== intent.amountMinor) {
      return { outcome: "REJECTED", reason: "Callback amount disagrees with the payment mandate" };
    }
    if (typeof payload.currency === "string" && payload.currency !== intent.currency) {
      return { outcome: "REJECTED", reason: "Callback currency disagrees with the payment mandate" };
    }
    ownerId = intent.ownerId;
  }
  // There is no `else` left to write: step 1 already refused a financial
  // callback that correlates to nothing, and a non-financial one that named no
  // owner. Both refusals happen BEFORE any material is resolved, which is
  // strictly earlier than they used to.
  //
  //   UNCORRELATED_FINANCIAL_CALLBACK_AUTHENTICATES = 0
  //   OWNERLESS_CALLBACK_AUTHENTICATES = 0
  if (ownerId === undefined) {
    // Unreachable, and kept as a hard floor rather than an assertion: a
    // canonical event with no owner would wake an arbitrary scope, and that is
    // too expensive a thing to leave to a proof about control flow.
    return { outcome: "REJECTED", reason: "A non-financial callback requires its owner" };
  }

  // 8) Replay identity is derived from the SIGNED body: the caller can never
  //    mint a fresh dedupe key for the same authenticated callback bytes.
  const signedEventKey =
    typeof payload.id === "string"
      ? `pid:${payload.id}`
      : typeof payload.eventId === "string"
        ? `eid:${payload.eventId}`
        : `body:${createHash("sha256").update(input.rawBody, "utf8").digest("hex")}`;

  // 9) Authenticated + correlated → canonical ingestion (dedupe = replay
  //    protection, staleness check, canonical event emission).
  return ingestExternalEvent(db, dispatcher, {
    provider: input.provider,
    connectorId: input.connectorId,
    eventKey: signedEventKey,
    eventType: input.eventType,
    reference: input.reference,
    payload,
    ownerId,
    runId: input.runId ?? null,
    nodeId: input.nodeId ?? null,
    observedVersion: input.observedVersion,
    now,
  });
}
