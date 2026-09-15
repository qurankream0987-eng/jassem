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
 * The provider secret is bound from the capability provider CATALOG
 * (ioMetadata.webhookSecret, provisioning-time truth) — never from
 * discovery, never from the callback itself.
 *
 * VALID_SIGNATURE ≠ VERIFIED: a valid signature authenticates the evidence
 * source only. What the evidence proves is decided later by the Verifier.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { capabilityProviderCatalog, paymentIntents } from "@db/schema";
import type { Block2Db, ContinuationDispatcher } from "../block2/temporal";
import {
  ingestExternalEvent,
  type ExternalIngestResult,
} from "../block2/events";

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
    ownerId: string;
    runId?: string | null;
    nodeId?: string | null;
    observedVersion?: number;
    now?: Date;
  },
): Promise<AuthenticatedIngestResult> {
  const now = input.now ?? new Date();

  // 1) Provider binding + catalog-bound secret (provisioning truth only).
  const [provider] = await db
    .select()
    .from(capabilityProviderCatalog)
    .where(eq(capabilityProviderCatalog.id, input.provider))
    .limit(1);
  if (!provider) {
    return { outcome: "REJECTED", reason: "Unknown provider" };
  }
  const secret =
    provider.ioMetadata && typeof (provider.ioMetadata as Record<string, unknown>).webhookSecret === "string"
      ? ((provider.ioMetadata as Record<string, unknown>).webhookSecret as string)
      : null;
  if (!secret) {
    return { outcome: "REJECTED", reason: "Provider has no catalog-bound webhook secret" };
  }

  // 2) Authenticate: HMAC over the exact raw bytes.
  if (!verifyRawBodyHmacSha256(input.rawBody, input.signature, secret)) {
    return { outcome: "REJECTED", reason: "Invalid or missing signature" };
  }

  // 3) Freshness: reject stale/replayed-window callbacks.
  if (input.timestamp !== undefined) {
    if (!Number.isFinite(input.timestamp)) {
      return { outcome: "REJECTED", reason: "Malformed timestamp" };
    }
    if (Math.abs(now.getTime() - input.timestamp) > WEBHOOK_MAX_AGE_MS) {
      return { outcome: "REJECTED", reason: "Stale callback timestamp" };
    }
  }

  // 4) Only after authentication: parse the body (never verify reserialized).
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

  // 5) Bind unsigned routing metadata to the SIGNED payload: a valid HMAC
  //    over body A can never be routed as event/owner B.
  if (typeof payload.eventType === "string" && payload.eventType !== input.eventType) {
    return { outcome: "REJECTED", reason: "eventType metadata disagrees with the signed payload" };
  }
  if (typeof payload.reference === "string" && payload.reference !== input.reference) {
    return { outcome: "REJECTED", reason: "reference metadata disagrees with the signed payload" };
  }

  // 5b) Financial callbacks have a STRICT signed schema: the signed body
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

  // 6) Payment correlation + derived ownership: when the reference is a
  //    known payment intent, the event's owner is the INTENT's owner
  //    (derived — never caller-supplied) and its money must match the
  //    mandate exactly. Financial callbacks that correlate to NO known
  //    intent fail closed — they can never wake arbitrary owners.
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, input.reference))
    .limit(1);
  let ownerId = input.ownerId;
  if (intent) {
    if (intent.ownerId !== input.ownerId) {
      return { outcome: "REJECTED", reason: "Callback owner disagrees with the payment intent owner" };
    }
    if (typeof payload.amountMinor === "string" && payload.amountMinor !== intent.amountMinor) {
      return { outcome: "REJECTED", reason: "Callback amount disagrees with the payment mandate" };
    }
    if (typeof payload.currency === "string" && payload.currency !== intent.currency) {
      return { outcome: "REJECTED", reason: "Callback currency disagrees with the payment mandate" };
    }
    ownerId = intent.ownerId;
  } else if (input.eventType.startsWith("payment.")) {
    return { outcome: "REJECTED", reason: "Financial callback does not correlate to a known payment intent" };
  }

  // 7) Replay identity is derived from the SIGNED body: the caller can never
  //    mint a fresh dedupe key for the same authenticated callback bytes.
  const signedEventKey =
    typeof payload.id === "string"
      ? `pid:${payload.id}`
      : typeof payload.eventId === "string"
        ? `eid:${payload.eventId}`
        : `body:${createHash("sha256").update(input.rawBody, "utf8").digest("hex")}`;

  // 8) Authenticated + correlated → canonical ingestion (dedupe = replay
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
