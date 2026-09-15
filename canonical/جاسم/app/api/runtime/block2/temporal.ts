/**
 * Block 2 — TemporalTrigger: a thin persisted layer over the existing
 * durable worker (availableAt claim loop). NOT a scheduler engine.
 *
 * Guarantees:
 * - Durable wait: a waiting Run keeps no active process; the due scan is a
 *   normal durable job, so restart-after-wait is inherited from the worker.
 * - Wake deduplication: continuation dispatch is idempotent on
 *   `trigger:{id}:{fireCount}` and the trigger row is claimed by CAS on
 *   (state, fireCount) before dispatch — two workers cannot double-fire.
 * - Recurrence is computed deterministically (native Intl timezone math);
 *   no model ever invents the next fire timestamp.
 */

import { and, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { randomUUID, createHash } from "node:crypto";
import {
  temporalTriggers,
  type RecurrenceRule,
  type TemporalTrigger,
  type TemporalTriggerKind,
} from "@db/schema";

export type Block2Db = NodePgDatabase<any>;

/** Injected seam: how a fired continuation reaches the durable worker. */
export interface ContinuationDispatcher {
  dispatch(input: {
    ownerId: string;
    jobKind: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    runId?: string | null;
    nodeId?: string | null;
  }): Promise<"enqueued" | "duplicate">;
}

/** Injected seam for CONDITION triggers: evaluates against canonical state
 *  or observations. Returns undefined when truthfully unknown (reschedule). */
export interface ConditionEvaluator {
  evaluate(
    condition: Record<string, unknown>,
    context: { ownerId: string },
  ): Promise<boolean | undefined>;
}

export const CONDITION_DEFAULT_POLL_MS = 60_000;

// ---------------------------------------------------------------------------
// Timezone-safe wall-clock ↔ UTC conversion (native Intl, no new deps)
// ---------------------------------------------------------------------------

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new TemporalTriggerError(`Invalid IANA timezone: ${timezone}`);
  }
}

export class TemporalTriggerError extends Error {}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

function wallPartsInZone(instant: Date, timezone: string): WallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday,
  };
}

/**
 * Convert a wall-clock time in `timezone` to a UTC instant.
 * Two-pass offset refinement keeps the wall time stable across DST shifts.
 */
export function zonedWallToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
): Date {
  let utcMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  for (let pass = 0; pass < 3; pass += 1) {
    const observed = wallPartsInZone(new Date(utcMs), timezone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const desiredAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
    const delta = desiredAsUtc - observedAsUtc;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

// ---------------------------------------------------------------------------
// Recurrence: deterministic next-occurrence computation
// ---------------------------------------------------------------------------

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

function nextRecurrenceUtc(rule: RecurrenceRule, timezone: string, fromUtc: Date): Date | undefined {
  const match = TIME_OF_DAY.exec(rule.timeOfDay);
  if (!match) throw new TemporalTriggerError(`Invalid timeOfDay: ${rule.timeOfDay}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const interval = Math.max(1, rule.interval ?? 1);
  const anchor = wallPartsInZone(fromUtc, timezone);
  const weekdays =
    rule.freq === "weekdays"
      ? [1, 2, 3, 4, 5]
      : rule.freq === "weekly"
        ? (rule.byWeekdays ?? [anchor.weekday])
        : undefined;

  // Walk candidate days in the target zone. 400-day cap bounds the scan.
  const startDayUtc = Date.UTC(anchor.year, anchor.month - 1, anchor.day);
  for (let dayOffset = 0; dayOffset <= 400; dayOffset += 1) {
    const dayMs = startDayUtc + dayOffset * 86_400_000;
    const probe = new Date(dayMs + 43_200_000); // noon UTC: stable day identity
    const wall = wallPartsInZone(probe, timezone);
    if (rule.freq === "daily" && dayOffset % interval !== 0) continue;
    if (weekdays && !weekdays.includes(wall.weekday)) continue;
    if (rule.freq !== "daily" && interval > 1) {
      const weeksSinceAnchor = Math.floor(dayOffset / 7);
      if (weeksSinceAnchor % interval !== 0) continue;
    }
    const candidate = zonedWallToUtc(
      { year: wall.year, month: wall.month, day: wall.day, hour, minute },
      timezone,
    );
    if (rule.until && candidate.getTime() > Date.parse(rule.until)) return undefined;
    if (candidate.getTime() > fromUtc.getTime()) return candidate;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Trigger creation
// ---------------------------------------------------------------------------

export type CreateTemporalTriggerInput = {
  ownerId: string;
  kind: TemporalTriggerKind;
  idempotencyKey: string;
  runId?: string | null;
  nodeId?: string | null;
  /** AT/DEADLINE: absolute UTC instant. */
  fireAt?: Date;
  /** AFTER: milliseconds from base (default: now). */
  afterMs?: number;
  timezone?: string;
  recurrence?: RecurrenceRule;
  condition?: Record<string, unknown>;
  conditionPollMs?: number;
  eventFilter?: { eventType?: string; match?: Record<string, unknown> };
  continuation?: TemporalTrigger["continuation"];
  maxFires?: number;
  now?: Date;
};

export async function createTemporalTrigger(
  db: Block2Db,
  input: CreateTemporalTriggerInput,
): Promise<{ trigger: TemporalTrigger; created: boolean }> {
  const now = input.now ?? new Date();
  const existing = await db
    .select()
    .from(temporalTriggers)
    .where(
      and(
        eq(temporalTriggers.ownerId, input.ownerId),
        eq(temporalTriggers.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing[0]) return { trigger: existing[0], created: false };

  let fireAt: Date | null = null;
  switch (input.kind) {
    case "AT":
    case "DEADLINE": {
      if (!input.fireAt) throw new TemporalTriggerError(`${input.kind} requires fireAt`);
      fireAt = input.fireAt;
      break;
    }
    case "AFTER": {
      if (input.afterMs === undefined || input.afterMs < 0) {
        throw new TemporalTriggerError("AFTER requires a non-negative afterMs");
      }
      fireAt = new Date(now.getTime() + input.afterMs);
      break;
    }
    case "RECURRING": {
      if (!input.recurrence) throw new TemporalTriggerError("RECURRING requires recurrence rule");
      const timezone = input.timezone ?? "UTC";
      assertValidTimezone(timezone);
      const next = nextRecurrenceUtc(input.recurrence, timezone, now);
      if (!next) throw new TemporalTriggerError("Recurrence has no future occurrence");
      fireAt = next;
      break;
    }
    case "CONDITION": {
      if (!input.condition) throw new TemporalTriggerError("CONDITION requires a condition");
      // Conditions are evaluated by the due scan itself; fireAt is the next poll.
      fireAt = new Date(now.getTime() + (input.conditionPollMs ?? CONDITION_DEFAULT_POLL_MS));
      break;
    }
    case "EVENT": {
      if (!input.eventFilter?.eventType) {
        throw new TemporalTriggerError("EVENT requires eventFilter.eventType");
      }
      fireAt = null; // woken by event ingestion, not the clock
      break;
    }
  }

  const id = `tt_${randomUUID()}`;
  const rows = await db
    .insert(temporalTriggers)
    .values({
      id,
      ownerId: input.ownerId,
      runId: input.runId ?? null,
      nodeId: input.nodeId ?? null,
      kind: input.kind,
      fireAt,
      timezone: input.timezone ?? null,
      recurrence: input.recurrence ?? null,
      condition: input.condition ?? null,
      eventFilter: input.eventFilter ?? null,
      continuation: input.continuation ?? {},
      state: "active",
      maxFires: input.maxFires ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (!rows[0]) {
    const raced = await db
      .select()
      .from(temporalTriggers)
      .where(
        and(
          eq(temporalTriggers.ownerId, input.ownerId),
          eq(temporalTriggers.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return { trigger: raced[0]!, created: false };
  }
  return { trigger: rows[0], created: true };
}

// ---------------------------------------------------------------------------
// Lifecycle: pause / resume / cancel
// ---------------------------------------------------------------------------

export async function transitionTemporalTrigger(
  db: Block2Db,
  input: { ownerId: string; triggerId: string; action: "pause" | "resume" | "cancel"; now?: Date },
): Promise<TemporalTrigger> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(temporalTriggers)
      .where(and(eq(temporalTriggers.id, input.triggerId), eq(temporalTriggers.ownerId, input.ownerId)))
      .limit(1)
      .for("update");
    const trigger = rows[0];
    if (!trigger) throw new TemporalTriggerError("Trigger not found");
    if (["cancelled", "fired", "completed", "expired"].includes(trigger.state)) {
      throw new TemporalTriggerError(`Trigger is terminal (${trigger.state})`);
    }
    if (input.action === "pause" && trigger.state !== "active") {
      throw new TemporalTriggerError("Only an active trigger can be paused");
    }
    if (input.action === "resume" && trigger.state !== "paused") {
      throw new TemporalTriggerError("Only a paused trigger can be resumed");
    }
    let patch: Partial<typeof temporalTriggers.$inferInsert>;
    if (input.action === "cancel") {
      patch = { state: "cancelled" };
    } else if (input.action === "pause") {
      patch = { state: "paused" };
    } else {
      // Resume: recompute the next fire so paused time never fires retroactively.
      const fireAt =
        trigger.kind === "RECURRING" && trigger.recurrence
          ? nextRecurrenceUtc(trigger.recurrence, trigger.timezone ?? "UTC", now)
          : trigger.kind === "CONDITION"
            ? new Date(now.getTime() + CONDITION_DEFAULT_POLL_MS)
            : trigger.fireAt && trigger.fireAt.getTime() > now.getTime()
              ? trigger.fireAt
              : new Date(now.getTime() + 1_000);
      patch = { state: "active", fireAt: fireAt ?? null };
      if (!fireAt) throw new TemporalTriggerError("Trigger has no future occurrence to resume");
    }
    const updated = await tx
      .update(temporalTriggers)
      .set(patch)
      .where(eq(temporalTriggers.id, trigger.id))
      .returning();
    return updated[0]!;
  });
}

// ---------------------------------------------------------------------------
// Firing — called by the durable worker's periodic scan job
// ---------------------------------------------------------------------------

function continuationKey(trigger: TemporalTrigger): string {
  return `trigger:${trigger.id}:${trigger.fireCount}`;
}

export type FireScanResult = {
  scanned: number;
  fired: number;
  rescheduled: number;
  completed: number;
  expired: number;
};

/**
 * Claim and fire all due triggers. Each trigger is claimed by a CAS on
 * (state='active', fireCount) so concurrent scanners cannot both fire it;
 * the continuation itself is dispatched with a per-fire idempotency key, so
 * even a lost race can never produce a duplicate effect (DOUBLE_WAKE=0).
 */
export async function fireDueTemporalTriggers(
  db: Block2Db,
  dispatcher: ContinuationDispatcher,
  evaluator?: ConditionEvaluator,
  options?: { now?: Date; limit?: number },
): Promise<FireScanResult> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 100;
  const result: FireScanResult = { scanned: 0, fired: 0, rescheduled: 0, completed: 0, expired: 0 };

  const due = await db
    .select()
    .from(temporalTriggers)
    .where(and(eq(temporalTriggers.state, "active"), lte(temporalTriggers.fireAt, now)))
    .orderBy(temporalTriggers.fireAt)
    .limit(limit);

  for (const trigger of due) {
    result.scanned += 1;

    // CONDITION: evaluate BEFORE any mutation. An unmet/unknown condition only
    // reschedules the poll — it never consumes a firing.
    if (trigger.kind === "CONDITION") {
      const verdict = evaluator
        ? await evaluator.evaluate(trigger.condition ?? {}, { ownerId: trigger.ownerId })
        : undefined;
      if (verdict !== true) {
        const pollMs =
          typeof trigger.condition?.pollMs === "number"
            ? (trigger.condition.pollMs as number)
            : CONDITION_DEFAULT_POLL_MS;
        await db
          .update(temporalTriggers)
          .set({ fireAt: new Date(now.getTime() + pollMs) })
          .where(
            and(
              eq(temporalTriggers.id, trigger.id),
              eq(temporalTriggers.state, "active"),
              eq(temporalTriggers.fireCount, trigger.fireCount),
            ),
          );
        result.rescheduled += 1;
        continue;
      }
    }

    // Dispatch BEFORE the claim, keyed by the PRE-claim fire count
    // (`trigger:{id}:{fireCount}`). A crash between dispatch and claim replays
    // the sweep with the SAME key, and the durable queue's idempotency
    // collapses the duplicate enqueue — the continuation effect is
    // exactly-once. (Claiming first and keying the retry by a NEW count
    // would double-fire after a crash.)
    const continuation = trigger.continuation ?? {};
    if (continuation.jobKind) {
      await dispatcher.dispatch({
        ownerId: trigger.ownerId,
        jobKind: continuation.jobKind,
        payload: {
          ...(continuation.jobPayload ?? {}),
          triggerId: trigger.id,
          triggerKind: trigger.kind,
          firedAt: now.toISOString(),
        },
        idempotencyKey: continuationKey(trigger),
        runId: trigger.runId,
        nodeId: trigger.nodeId,
      });
    }

    // One atomic CAS: claim this firing AND advance the lifecycle (next
    // occurrence or terminal state) in a single statement. A crash after the
    // claim can never re-dispatch — the row is no longer due/active.
    const firesExhausted =
      (trigger.maxFires !== null && trigger.fireCount + 1 >= trigger.maxFires) ||
      (trigger.recurrence?.count !== undefined && trigger.fireCount + 1 >= trigger.recurrence.count);
    const next =
      trigger.kind === "RECURRING" && !firesExhausted
        ? nextRecurrenceUtc(trigger.recurrence!, trigger.timezone ?? "UTC", now)
        : null;
    const terminal =
      trigger.kind === "RECURRING" ? (firesExhausted ? "completed" : "expired") : "fired";
    const claimed = await db
      .update(temporalTriggers)
      .set(
        next
          ? { lastFiredAt: now, fireCount: trigger.fireCount + 1, fireAt: next }
          : { lastFiredAt: now, fireCount: trigger.fireCount + 1, state: terminal },
      )
      .where(
        and(
          eq(temporalTriggers.id, trigger.id),
          eq(temporalTriggers.state, "active"),
          eq(temporalTriggers.fireCount, trigger.fireCount),
        ),
      )
      .returning({ id: temporalTriggers.id });
    if (!claimed[0]) continue; // lost the race — the dispatch above collapses via idempotency
    result.fired += 1;
    if (next) result.rescheduled += 1;
    else if (terminal === "expired") result.expired += 1;
    else result.completed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// EVENT triggers — woken by canonical event ingestion (not the clock)
// ---------------------------------------------------------------------------

function matchesFilter(
  filter: { eventType?: string; match?: Record<string, unknown> },
  event: { eventType: string; payload: Record<string, unknown> },
): boolean {
  if (filter.eventType && filter.eventType !== event.eventType) return false;
  if (!filter.match) return true;
  return Object.entries(filter.match).every(([key, value]) => event.payload[key] === value);
}

export async function fireEventTriggers(
  db: Block2Db,
  dispatcher: ContinuationDispatcher,
  event: { eventType: string; ownerId: string; payload: Record<string, unknown> },
  options?: { now?: Date },
): Promise<number> {
  const now = options?.now ?? new Date();
  const candidates = await db
    .select()
    .from(temporalTriggers)
    .where(and(eq(temporalTriggers.ownerId, event.ownerId), eq(temporalTriggers.state, "active"), eq(temporalTriggers.kind, "EVENT")));
  let fired = 0;
  for (const trigger of candidates) {
    if (!trigger.eventFilter || !matchesFilter(trigger.eventFilter, event)) continue;
    const claimed = await db
      .update(temporalTriggers)
      .set({ lastFiredAt: now, fireCount: trigger.fireCount + 1 })
      .where(
        and(
          eq(temporalTriggers.id, trigger.id),
          eq(temporalTriggers.state, "active"),
          eq(temporalTriggers.fireCount, trigger.fireCount),
        ),
      )
      .returning({ id: temporalTriggers.id });
    if (!claimed[0]) continue;
    const continuation = trigger.continuation ?? {};
    if (continuation.jobKind) {
      await dispatcher.dispatch({
        ownerId: trigger.ownerId,
        jobKind: continuation.jobKind,
        payload: {
          ...(continuation.jobPayload ?? {}),
          triggerId: trigger.id,
          triggerKind: trigger.kind,
          event: { eventType: event.eventType, payload: event.payload },
        },
        idempotencyKey: continuationKey(trigger),
        runId: trigger.runId,
        nodeId: trigger.nodeId,
      });
    }
    const exhausted = trigger.maxFires !== null && trigger.fireCount + 1 >= trigger.maxFires;
    await db
      .update(temporalTriggers)
      .set({ state: exhausted ? "completed" : "active" })
      .where(eq(temporalTriggers.id, trigger.id));
    fired += 1;
  }
  return fired;
}

/** Stable digest for trigger-bound evidence (deterministic, no model). */
export function triggerDigest(trigger: Pick<TemporalTrigger, "ownerId" | "kind" | "idempotencyKey">): string {
  return createHash("sha256")
    .update(`${trigger.ownerId}${trigger.kind}${trigger.idempotencyKey}`)
    .digest("hex");
}

/** Expire HELD-style resources: helper used by reservation expiry jobs. */
export async function listActiveTriggersForRun(db: Block2Db, runId: string): Promise<TemporalTrigger[]> {
  return db
    .select()
    .from(temporalTriggers)
    .where(and(eq(temporalTriggers.runId, runId), eq(temporalTriggers.state, "active")));
}

export { nextRecurrenceUtc };
