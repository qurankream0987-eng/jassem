import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  discoveryCandidates,
  discoveryResultSets,
  referenceBindings,
} from "../../../db/schema";
import type { Block31Db } from "./discovery";

export type Resolution<T> =
  | { status: "RESOLVED"; value: T }
  | { status: "NOT_FOUND" }
  | { status: "AMBIGUOUS"; candidates: T[] };

/**
 * Who is asking, and about which conversation.
 *
 * Both resolvers below used to take a bare `conversationId`, which made their
 * safety depend entirely on every caller remembering to check ownership first.
 * Today's callers do check, so this was never a proven cross-owner leak — but
 * "safe because everyone has been careful so far" is not an invariant, and the
 * next caller inherits no warning.
 *
 * Passing a scope object rather than two positional strings also means a bare
 * conversation id can no longer be handed in by accident: omitting the owner is
 * a type error rather than a silent widening.
 */
export type ReferenceScope = {
  ownerId: string;
  conversationId: string;
};

export async function bindReference(
  db: Block31Db,
  input: {
    ownerId: string;
    conversationId: string;
    referenceKey: string;
    targetKind: string;
    targetId: string;
    resultSetId?: string;
    position?: number;
  },
) {
  return db.transaction(async (tx) => {
    //
    // ── SUPERSESSION HAS TO BE ONE THING AT A TIME ──────────────────────────
    //
    // Two presses arriving together each read «nothing is current yet» in their
    // own snapshot and each inserted, leaving TWO active bindings for one key —
    // so «the current order» had two answers and the review showed whichever
    // was read first. Measured, not supposed: two concurrent selects produced
    // two rows with `supersededAt IS NULL`.
    //
    //   CURRENT_ORDER_HAS_TWO_ACTIVE_BINDINGS = 0
    //
    // The lock is Postgres's own, taken for the transaction and released with
    // it, and it is per (conversation, key) — so ordinals, deictics and orders
    // never wait on each other, and a client mutex is not load-bearing for
    // anything. The partial unique index alongside it means the invariant
    // survives a writer that forgets to take the lock at all.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.conversationId}:${input.referenceKey}`}, 0))`,
    );
    await tx
      .update(referenceBindings)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(referenceBindings.conversationId, input.conversationId),
          eq(referenceBindings.referenceKey, input.referenceKey),
          isNull(referenceBindings.supersededAt),
        ),
      );
    const [binding] = await tx
      .insert(referenceBindings)
      .values({ id: `ref_${randomUUID()}`, ...input })
      .returning();
    return binding;
  });
}

export async function resolveOrdinal(
  db: Block31Db,
  scope: ReferenceScope,
  n: number,
): Promise<Resolution<typeof discoveryCandidates.$inferSelect>> {
  if (!Number.isInteger(n) || n < 1) return { status: "NOT_FOUND" };
  // Candidates are reached through their result set, so scoping the set by
  // owner scopes the ordinal. A set belonging to someone else yields nothing
  // rather than an error, so the resolver cannot confirm that it exists.
  const sets = await db
    .select()
    .from(discoveryResultSets)
    .where(
      and(
        eq(discoveryResultSets.ownerId, scope.ownerId),
        eq(discoveryResultSets.conversationId, scope.conversationId),
      ),
    )
    .orderBy(desc(discoveryResultSets.createdAt))
    .limit(2);
  if (!sets.length) return { status: "NOT_FOUND" };
  if (sets.length > 1 && sets[0].createdAt.getTime() === sets[1].createdAt.getTime()) {
    const tied = await db
      .select()
      .from(discoveryCandidates)
      .where(
        and(
          eq(discoveryCandidates.position, n),
          eq(discoveryCandidates.resultSetId, sets[0].id),
        ),
      );
    const other = await db
      .select()
      .from(discoveryCandidates)
      .where(
        and(
          eq(discoveryCandidates.position, n),
          eq(discoveryCandidates.resultSetId, sets[1].id),
        ),
      );
    return { status: "AMBIGUOUS", candidates: [...tied, ...other] };
  }
  const rows = await db
    .select()
    .from(discoveryCandidates)
    .where(
      and(
        eq(discoveryCandidates.resultSetId, sets[0].id),
        eq(discoveryCandidates.position, n),
      ),
    );
  if (!rows.length) return { status: "NOT_FOUND" };
  if (rows.length > 1) return { status: "AMBIGUOUS", candidates: rows };
  return { status: "RESOLVED", value: rows[0] };
}

export async function resolveThis(
  db: Block31Db,
  scope: ReferenceScope,
): Promise<Resolution<typeof referenceBindings.$inferSelect>> {
  const rows = await db
    .select()
    .from(referenceBindings)
    .where(
      and(
        eq(referenceBindings.ownerId, scope.ownerId),
        eq(referenceBindings.conversationId, scope.conversationId),
        isNull(referenceBindings.supersededAt),
      ),
    )
    .orderBy(desc(referenceBindings.createdAt))
    .limit(2);
  if (!rows.length) return { status: "NOT_FOUND" };
  if (rows.length > 1 && rows[0].createdAt.getTime() === rows[1].createdAt.getTime()) {
    return { status: "AMBIGUOUS", candidates: rows };
  }
  return { status: "RESOLVED", value: rows[0] };
}