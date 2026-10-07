/**
 * WHAT SOMEBODY IS ASKING OF THIS PERSON.
 *
 * ─── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────
 *
 * Two surfaces need the same answer: the conversation's workspace, which shows
 * the term sheet so it can be read and agreed to, and the rail, which is the
 * only person-scoped thing JASIM draws and therefore the only place an ask can
 * reach somebody who has not opened a conversation at all.
 *
 *   TWO_READERS_OF_ONE_ASK = 0
 *
 * Two queries for one question drift, and the drift resolves in favour of
 * whichever one said «nothing is waiting».
 *
 * ─── AND WHAT AN ASK IS ─────────────────────────────────────────────────────
 *
 *   A REQUEST ADDRESSED TO ME IS NOT A FACT ABOUT MY THREAD
 *
 * Person-scoped by nature: nobody sends a term sheet to a conversation. The
 * filter is the one the spoken acceptance path already uses — proposals in
 * engagements this person participates in, that this person did NOT make,
 * still open — so what is shown and what can be accepted are the same set.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  economicEngagements,
  economicExpressions,
  economicMatches,
  economicProposals,
} from "@db/schema";

export type InboundAsk = {
  readonly proposalId: string;
  readonly version: number;
  readonly terms: Record<string, unknown>;
  readonly proposerOwnerId: string;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  /**
   * How the thing is NAMED, read canonically through the engagement's match.
   * A term sheet carries terms, not a label, and a bare identifier is not a
   * name for something somebody is being asked to agree to.
   */
  readonly subject: { title: string | null; summary: string | null };
};

export async function inboundAsksFor(ownerId: string): Promise<readonly InboundAsk[]> {
  const rows = await db
    .select({
      proposal: economicProposals,
      engagement: economicEngagements,
      // LEFT-joined: an ask whose subject cannot be read is still an ask, and
      // dropping it would hide a request somebody is waiting on an answer to.
      subject: economicExpressions,
    })
    .from(economicProposals)
    .innerJoin(economicEngagements, eq(economicEngagements.id, economicProposals.engagementId))
    .leftJoin(economicMatches, eq(economicMatches.id, economicEngagements.matchId))
    .leftJoin(economicExpressions, eq(economicExpressions.id, economicMatches.offeringId))
    .where(eq(economicProposals.status, "proposed"))
    .orderBy(desc(economicProposals.createdAt))
    .limit(50);

  return rows
    .filter(
      (row) =>
        row.engagement.participants.includes(ownerId) &&
        row.proposal.proposerOwnerId !== ownerId,
    )
    .map((row) => {
      const projection = (row.subject?.publicProjection ?? {}) as Record<string, unknown>;
      return {
        proposalId: row.proposal.id,
        version: row.proposal.version,
        terms: row.proposal.terms,
        proposerOwnerId: row.proposal.proposerOwnerId,
        expiresAt: row.proposal.expiresAt,
        createdAt: row.proposal.createdAt,
        subject: {
          title: typeof projection.semanticType === "string" ? projection.semanticType : null,
          summary: typeof projection.summary === "string" ? projection.summary : null,
        },
      };
    });
}
