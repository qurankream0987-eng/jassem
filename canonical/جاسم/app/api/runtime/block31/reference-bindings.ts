import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
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
  conversationId: string,
  n: number,
): Promise<Resolution<typeof discoveryCandidates.$inferSelect>> {
  if (!Number.isInteger(n) || n < 1) return { status: "NOT_FOUND" };
  const sets = await db
    .select()
    .from(discoveryResultSets)
    .where(eq(discoveryResultSets.conversationId, conversationId))
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
  conversationId: string,
): Promise<Resolution<typeof referenceBindings.$inferSelect>> {
  const rows = await db
    .select()
    .from(referenceBindings)
    .where(
      and(
        eq(referenceBindings.conversationId, conversationId),
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