/**
 * A NEED THAT KEEPS LOOKING.
 *
 * ── THE GAP, TRACED ON THE LIVE PATH ────────────────────────────────────────
 *
 * «أخبرني عندما تظهر واحدة تحت ١٦ ألفاً» · «راقب السعر وإذا نزل أخبرني».
 *
 * `matchNeed` scans every public offering against a need, and it has exactly
 * two callers: a router procedure, and a capability. Both run because somebody
 * asked AT THAT MOMENT. Nothing re-runs it — not the duty cycle, not a
 * publication, not a trigger.
 *
 * So JASIM could answer «what exists now» and never «tell me when it exists».
 * A request whose answer had not been published yet came back empty and was
 * forgotten, which is the whole long-running half of the runtime missing.
 *
 *   A NEED CAN WAIT · ANSWERING_ONLY_WHAT_EXISTS_NOW = 0
 *
 * ── WHY THIS IS NOT A MONITOR ───────────────────────────────────────────────
 *
 * Every monitor source watches a SUBJECT — an observation about it, an
 * authorized read of it, an event from it, or its expected observation failing
 * to arrive. A need waiting for an offering that does not exist yet has no
 * subject to watch: the thing it is waiting for has no id, no row and no
 * owner. Threading that through an evaluator built around observation payloads
 * would have bent a careful module out of shape to hold something it was not
 * about.
 *
 * It runs in the SAME duty cycle, beside the monitors.
 *
 *   SECOND_SCHEDULERS_ADDED = 0
 *
 * ── WHAT WAITING IS NOT ─────────────────────────────────────────────────────
 *
 *   NEW_MATCH != EVERY_SWEEP
 *     A wait notifies on the EDGE — something appeared that was not there
 *     before — never on the level. A standing scan that reported the same
 *     candidate every cycle would be noise nobody could keep, and the person
 *     would stop reading it exactly when it mattered.
 *
 *   WAITING != PUBLISHING
 *     A waiting need is not shown to anybody. `matchNeed` reads public
 *     offerings; it never exposes the need doing the reading. Telling JASIM to
 *     keep looking for me is not advertising what I want.
 *
 *   MATCH != OFFER
 *     Something found later is a candidate, exactly like something found now.
 *     Nothing is reserved, nothing is bought, and nobody is contacted.
 *
 *     TARGET / CONDITION != EXECUTION AUTHORITY
 *
 *   WAITING_FOREVER = 0
 *     Every wait carries an end. An unbounded standing scan is a resource
 *     nobody authorized, and it would outlive the reason it was created for.
 *
 *   WAITING_IS_THE_OWNERS_CHOICE
 *     Started by them, stopped by them, and never begun because a search
 *     happened to come back empty.
 *
 * ── AND IT IS NOT A DOMAIN ──────────────────────────────────────────────────
 *
 * There is no PriceWatcher and no StockAlert. A wait is a need plus an end
 * date; what the need is about is the need's business.
 *
 *   DOMAIN_WATCHERS_ADDED = 0
 */
import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { waitingNeeds, type WaitingNeed } from "@db/schema-block2";
import { economicExpressions, economicMatches } from "@db/schema";
import { matchNeed } from "./economic-fabric";
import { createNotificationIntent } from "./block2/notifications";

type Db = NodePgDatabase<any>;

export const WAITING_STATES = ["WAITING", "STOPPED", "EXPIRED"] as const;
export type WaitingState = (typeof WAITING_STATES)[number];

/** The longest a wait may stand without being asked for again. */
export const MAX_WAIT_MS = 30 * 24 * 60 * 60 * 1000;

export class WaitingNeedError extends Error {
  readonly code: "NOT_THE_OWNER" | "NOT_A_NEED" | "INVALID";
  constructor(message: string, code: WaitingNeedError["code"]) {
    super(message);
    this.code = code;
    this.name = "WaitingNeedError";
  }
}

/**
 * «استمر بالبحث» — keep looking for this, until this date.
 *
 * Idempotent per need: asking twice is the same wait, not a second scan.
 */
export async function waitForMatch(
  db: Db,
  input: { needId: string; ownerId: string; expiresAt?: Date; now?: Date },
): Promise<WaitingNeed> {
  const now = input.now ?? new Date();
  const [need] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, input.needId))
    .limit(1);
  if (!need) throw new WaitingNeedError("No such need.", "NOT_A_NEED");
  //   WAITING_IS_THE_OWNERS_CHOICE — and only about their own need.
  if (need.ownerId !== input.ownerId) {
    throw new WaitingNeedError("Only the owner may ask for this.", "NOT_THE_OWNER");
  }
  if (need.kind !== "need") {
    throw new WaitingNeedError("Only a need waits; an offering is already there.", "NOT_A_NEED");
  }

  //   WAITING_FOREVER = 0 — bounded here, not trusted from a caller.
  const requested = input.expiresAt?.getTime() ?? now.getTime() + MAX_WAIT_MS;
  const expiresAt = new Date(Math.min(requested, now.getTime() + MAX_WAIT_MS));
  if (expiresAt.getTime() <= now.getTime()) {
    throw new WaitingNeedError("A wait that has already ended is not a wait.", "INVALID");
  }

  const [existing] = await db
    .select()
    .from(waitingNeeds)
    .where(eq(waitingNeeds.needId, input.needId))
    .limit(1);
  if (existing) {
    const [refreshed] = await db
      .update(waitingNeeds)
      .set({ state: "WAITING", expiresAt })
      .where(eq(waitingNeeds.id, existing.id))
      .returning();
    return refreshed!;
  }
  const [created] = await db
    .insert(waitingNeeds)
    .values({
      id: `wait_${randomUUID()}`,
      needId: input.needId,
      ownerId: input.ownerId,
      expiresAt,
    })
    .returning();
  return created!;
}

/** «كفى» — stop looking. Only the person who asked may. */
export async function stopWaiting(
  db: Db,
  input: { needId: string; ownerId: string },
): Promise<WaitingNeed | null> {
  const [row] = await db
    .select()
    .from(waitingNeeds)
    .where(eq(waitingNeeds.needId, input.needId))
    .limit(1);
  if (!row) return null;
  if (row.ownerId !== input.ownerId) {
    throw new WaitingNeedError("Only the owner may stop this.", "NOT_THE_OWNER");
  }
  const [stopped] = await db
    .update(waitingNeeds)
    .set({ state: "STOPPED" })
    .where(eq(waitingNeeds.id, row.id))
    .returning();
  return stopped!;
}

export async function readWait(
  db: Db,
  input: { needId: string; ownerId: string },
): Promise<WaitingNeed | null> {
  const [row] = await db
    .select()
    .from(waitingNeeds)
    .where(eq(waitingNeeds.needId, input.needId))
    .limit(1);
  if (!row) return null;
  if (row.ownerId !== input.ownerId) {
    throw new WaitingNeedError("Only the owner may read this.", "NOT_THE_OWNER");
  }
  return row;
}

export type WaitSweepResult = {
  readonly swept: number;
  readonly expired: number;
  readonly notified: number;
  readonly newMatches: number;
};

/**
 * Every live wait, once, in the duty cycle that already exists.
 *
 * A match that ALREADY EXISTED when the wait was created is not news. Only a
 * match row this sweep created is, which is why the edge is read from the
 * canonical match ledger rather than from a remembered list — a list would go
 * stale against the thing it is summarizing.
 *
 *   NEW_MATCH != EVERY_SWEEP
 */
export async function sweepWaitingNeeds(
  db: Db,
  options?: { now?: Date; limit?: number },
): Promise<WaitSweepResult> {
  const now = options?.now ?? new Date();

  //   WAITING_FOREVER = 0 — ended waits stop being work before anything else.
  const expiredRows = await db
    .update(waitingNeeds)
    .set({ state: "EXPIRED" })
    .where(and(eq(waitingNeeds.state, "WAITING"), lte(waitingNeeds.expiresAt, now)))
    .returning({ id: waitingNeeds.id });

  const due = await db
    .select()
    .from(waitingNeeds)
    .where(eq(waitingNeeds.state, "WAITING"))
    .limit(options?.limit ?? 100);

  let notified = 0;
  let newMatches = 0;
  for (const wait of due) {
    // ── WHAT COUNTS AS NEW ──────────────────────────────────────────────────
    //
    // WHICH OFFERINGS, not how many match rows. Traced while proving this:
    // `matchNeed` APPENDS a match row on every call rather than upserting, so
    // a row count grows on every sweep whether or not the world changed —
    // counting rows would have reported the same candidate as news forever,
    // which is the precise failure this law exists to prevent.
    //
    //   NEW_MATCH != EVERY_SWEEP
    const seen = new Set(
      (
        await db
          .selectDistinct({ offeringId: economicMatches.offeringId })
          .from(economicMatches)
          .where(
            and(eq(economicMatches.needId, wait.needId), eq(economicMatches.status, "viable")),
          )
      ).map((row) => row.offeringId),
    );

    try {
      // Run AS THE OWNER. `matchNeed` refuses anybody else, which is what keeps
      // a sweep from becoming an oracle over other people's needs.
      await matchNeed({ needId: wait.needId, requesterOwnerId: wait.ownerId });
    } catch {
      // A need that can no longer be matched — deleted, closed, or no longer
      // this owner's — stops being swept rather than failing the cycle.
      await db
        .update(waitingNeeds)
        .set({ state: "STOPPED", lastSweptAt: now })
        .where(eq(waitingNeeds.id, wait.id));
      continue;
    }

    const now_viable = new Set(
      (
        await db
          .selectDistinct({ offeringId: economicMatches.offeringId })
          .from(economicMatches)
          .where(
            and(eq(economicMatches.needId, wait.needId), eq(economicMatches.status, "viable")),
          )
      ).map((row) => row.offeringId),
    );
    const appeared = [...now_viable].filter((offeringId) => !seen.has(offeringId)).length;

    if (appeared > 0) {
      newMatches += appeared;
      await createNotificationIntent(db as never, {
        ownerId: wait.ownerId,
        recipientId: wait.ownerId,
        purpose: "waiting_need_match",
        content: {
          title: "ظهر شيء جديد",
          body: "ظهر ما يطابق ما كنتَ تنتظره. لم يُحجز شيء ولم يُشترَ شيء.",
          // IDS AND COUNTS ONLY. A notification says that something changed,
          // never what it now says — reading it is a separate authorized act.
          data: { needId: wait.needId, appeared },
        },
        // One notice per wait per new arrival: a retried sweep cannot send the
        // same news twice.
        idempotencyKey: `waiting:${wait.id}:${now_viable.size}`,
        entityRef: { kind: "economic_expression", id: wait.needId },
      });
      notified += 1;
      await db
        .update(waitingNeeds)
        .set({
          lastSweptAt: now,
          lastNotifiedAt: now,
          noticesSent: wait.noticesSent + 1,
        })
        .where(eq(waitingNeeds.id, wait.id));
      continue;
    }

    await db
      .update(waitingNeeds)
      .set({ lastSweptAt: now })
      .where(eq(waitingNeeds.id, wait.id));
  }

  return { swept: due.length, expired: expiredRows.length, notified, newMatches };
}
