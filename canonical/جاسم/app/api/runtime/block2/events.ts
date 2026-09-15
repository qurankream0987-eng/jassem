/**
 * Block 2 — canonical event emission + external ingestion.
 *
 * REUSES the existing events/eventSubscriptions/externalWebhookEvents
 * tables (NEW_EVENT_BUS = 0). External path is strictly:
 * authenticate source → normalize → bind provider/owner/run → deduplicate →
 * staleness/version validation → canonical event → wake/continue.
 * An arbitrary webhook NEVER mutates state directly.
 */

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { eventSubscriptions, events, externalWebhookEvents, remoteExecutions } from "@db/schema";
import type { Block2Db, ContinuationDispatcher } from "./temporal";
import { fireEventTriggers } from "./temporal";

export type CanonicalEvent = {
  id: number;
  type: string;
  ownerId: string | null;
  runId: string | null;
  payload: Record<string, unknown>;
};

function filterMatches(
  filter: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, value]) => payload[key] === value);
}

/**
 * Wake run-continuation subscriptions bound to this event. Supported
 * handlers are deterministic identifiers only ("resume-node",
 * "enqueue:<jobKind>") — a subscription never names executable code.
 */
async function wakeSubscriptions(
  db: Block2Db,
  dispatcher: ContinuationDispatcher,
  event: CanonicalEvent,
  now: Date,
): Promise<number> {
  const subs = await db
    .select()
    .from(eventSubscriptions)
    .where(
      and(
        eq(eventSubscriptions.eventType, event.type),
        eq(eventSubscriptions.active, true),
        eq(eventSubscriptions.state, "active"),
      ),
    );
  let woken = 0;
  for (const sub of subs) {
    if (sub.expiresAt && sub.expiresAt.getTime() <= now.getTime()) continue;
    if (!filterMatches(sub.filter, event.payload)) continue;
    if (sub.ownerId && event.ownerId && sub.ownerId !== event.ownerId) continue;
    const idempotencyKey = `event-sub:${sub.id}:${event.id}`;
    if (sub.handler === "resume-node" && sub.runId) {
      await dispatcher.dispatch({
        ownerId: sub.ownerId ?? event.ownerId ?? "system",
        jobKind: "block2.resume-node",
        payload: { runId: sub.runId, nodeId: sub.nodeId ?? undefined, eventId: event.id },
        idempotencyKey,
        runId: sub.runId,
        nodeId: sub.nodeId,
      });
      woken += 1;
    } else if (sub.handler.startsWith("enqueue:")) {
      await dispatcher.dispatch({
        ownerId: sub.ownerId ?? event.ownerId ?? "system",
        jobKind: sub.handler.slice("enqueue:".length),
        payload: { eventId: event.id, eventType: event.type, eventPayload: event.payload },
        idempotencyKey,
        runId: sub.runId,
        nodeId: sub.nodeId,
      });
      woken += 1;
    }
    // Unknown handlers: recorded subscription, deliberately no effect.
    if (woken > 0) {
      await db
        .update(eventSubscriptions)
        .set({ lastTriggeredAt: now })
        .where(eq(eventSubscriptions.id, sub.id));
    }
  }
  return woken;
}

/** Internal canonical emission: persist, then wake EVENT triggers + subs. */
export async function emitCanonicalEvent(
  db: Block2Db,
  dispatcher: ContinuationDispatcher,
  input: {
    type: string;
    source: string;
    payload: Record<string, unknown>;
    ownerId?: string | null;
    runId?: string | null;
    correlationId?: string | null;
    now?: Date;
  },
): Promise<{ event: CanonicalEvent; triggersFired: number; subscriptionsWoken: number }> {
  const now = input.now ?? new Date();
  const inserted = await db
    .insert(events)
    .values({
      type: input.type,
      source: input.source,
      payload: input.payload,
      ownerId: input.ownerId ?? null,
      runId: input.runId ?? null,
      correlationId: input.correlationId ?? null,
      priority: "normal",
      processed: false,
    })
    .returning({ id: events.id });
  const event: CanonicalEvent = {
    id: inserted[0]!.id,
    type: input.type,
    ownerId: input.ownerId ?? null,
    runId: input.runId ?? null,
    payload: input.payload,
  };
  const triggersFired = input.ownerId
    ? await fireEventTriggers(db, dispatcher, {
        eventType: input.type,
        ownerId: input.ownerId,
        payload: input.payload,
      }, { now })
    : 0;
  const subscriptionsWoken = await wakeSubscriptions(db, dispatcher, event, now);
  await db.update(events).set({ processed: true, processedAt: now }).where(eq(events.id, event.id));
  return { event, triggersFired, subscriptionsWoken };
}

// ---------------------------------------------------------------------------
// External ingestion — dedupe + staleness before any canonical effect
// ---------------------------------------------------------------------------

export type ExternalIngestResult =
  | { outcome: "ACCEPTED"; eventId: number }
  | { outcome: "DUPLICATE"; reason: string }
  | { outcome: "STALE"; reason: string };

export async function ingestExternalEvent(
  db: Block2Db,
  dispatcher: ContinuationDispatcher,
  input: {
    provider: string;
    connectorId: string;
    /** Provider-unique event key — replay of the same key has zero effects. */
    eventKey: string;
    eventType: string;
    reference: string;
    payload: Record<string, unknown>;
    ownerId: string;
    runId?: string | null;
    nodeId?: string | null;
    /** Provider-side version for staleness protection. */
    observedVersion?: number;
    now?: Date;
  },
): Promise<ExternalIngestResult> {
  const now = input.now ?? new Date();

  // 1) Deduplicate at the trust boundary (unique provider+eventKey).
  const intake = await db
    .insert(externalWebhookEvents)
    .values({
      id: `ewh_${randomUUID()}`,
      provider: input.provider,
      connectorId: input.connectorId,
      eventKey: input.eventKey,
      eventType: input.eventType,
      reference: input.reference,
      payloadDigest: createPayloadDigest(input.payload),
      status: "received",
      actionId: input.nodeId ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: externalWebhookEvents.id });
  if (!intake[0]) {
    return { outcome: "DUPLICATE", reason: "Event key already ingested — replay has no effects" };
  }

  // 2) Staleness/version validation against the bound remote execution.
  const bound = await db
    .select()
    .from(remoteExecutions)
    .where(
      and(
        eq(remoteExecutions.providerId, input.provider),
        eq(remoteExecutions.remoteReference, input.reference),
      ),
    )
    .limit(1);
  if (bound[0] && input.observedVersion !== undefined && input.observedVersion < bound[0].version) {
    await db
      .update(externalWebhookEvents)
      .set({ status: "ignored", processedAt: now })
      .where(eq(externalWebhookEvents.id, intake[0].id));
    return { outcome: "STALE", reason: "Event version is behind canonical state" };
  }

  // 3) Canonical event + wake (idempotent downstream via event id keys).
  const { event } = await emitCanonicalEvent(db, dispatcher, {
    type: input.eventType,
    source: `provider:${input.provider}`,
    payload: input.payload,
    ownerId: input.ownerId,
    runId: input.runId ?? bound[0]?.runId ?? null,
    now,
  });
  await db
    .update(externalWebhookEvents)
    .set({ status: "applied", processedAt: now })
    .where(eq(externalWebhookEvents.id, intake[0].id));
  return { outcome: "ACCEPTED", eventId: event.id };
}

function createPayloadDigest(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

/** Read external intake status (used by reconciliation/tests). */
export async function getExternalIntake(db: Block2Db, provider: string, eventKey: string) {
  const rows = await db
    .select()
    .from(externalWebhookEvents)
    .where(and(eq(externalWebhookEvents.provider, provider), eq(externalWebhookEvents.eventKey, eventKey)))
    .limit(1);
  return rows[0];
}

export { sql as _sql };
