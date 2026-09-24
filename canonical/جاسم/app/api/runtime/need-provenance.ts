/**
 * WHAT DID THE USER WANT, AND WHAT ACTUALLY CAME OF IT?
 *
 *   PROVENANCE != AUTHORITY
 *   PROVENANCE != VERIFICATION
 *   PROVENANCE != COMPLETION
 *
 *   TRANSACTION_CREATED  != NEED_SATISFIED
 *   PAYMENT_VERIFIED     != NEED_SATISFIED
 *   FULFILLMENT_CLAIMED  != NEED_SATISFIED
 *
 * A provenance edge says only THIS CAME FROM THAT. It grants nobody anything,
 * proves nothing happened, and is read by no authorization check anywhere.
 *
 * THE CHAIN IS WALKED, NEVER GUESSED. Every step below is a stored id on a
 * canonical, immutable row:
 *
 *   transaction.agreementId → agreement.proposalId → proposal.engagementId
 *     → engagement.needId @ engagement.needRevision
 *
 * Nothing here reads a transcript, a semantic type, an amount, a timestamp or
 * «the most recent need». If an edge is absent the answer is that it is
 * absent — which is why automatic resolution was correctly impossible before
 * these edges existed, and is still impossible wherever they are missing.
 *
 *   NO_PROVENANCE → NO_AUTOMATIC_NEED_RESOLUTION
 *
 * NO DOMAIN. A meal, a used vehicle, an hour of somebody's time and a kiln
 * firing are the same four ids in a row.
 *
 *   DOMAIN_PROVENANCE_HANDLERS_ADDED = 0
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../queries/connection";
import { agreements, commitments, conversationNeeds, transactions } from "@db/schema-block2";
import { economicEngagements, economicProposals } from "@db/schema";

/** One transaction, and the need revision it was undertaken for. */
export type NeedLineage = {
  readonly transactionId: string;
  readonly agreementId: string;
  readonly proposalId: string;
  readonly engagementId: string;
  readonly needId: string;
  /** The revision the need had WHEN the attempt was made, not now. */
  readonly needRevision: number;
  readonly transactionState: string;
};

/**
 * Walk from a transaction back to the need it came from.
 *
 * Returns null at the first missing edge rather than filling it in. A
 * transaction created outside a conversational need has no need, and saying so
 * is the whole point.
 */
export async function lineageOfTransaction(
  transactionId: string,
): Promise<NeedLineage | null> {
  const [row] = await db
    .select({
      transactionId: transactions.id,
      transactionState: transactions.state,
      agreementId: transactions.agreementId,
      proposalId: agreements.proposalId,
      engagementId: economicProposals.engagementId,
      needId: economicEngagements.needId,
      needRevision: economicEngagements.needRevision,
    })
    .from(transactions)
    .innerJoin(agreements, eq(transactions.agreementId, agreements.id))
    .innerJoin(economicProposals, eq(agreements.proposalId, economicProposals.id))
    .innerJoin(economicEngagements, eq(economicProposals.engagementId, economicEngagements.id))
    .where(eq(transactions.id, transactionId))
    .limit(1);

  if (!row || !row.needId || row.needRevision === null) return null;
  return {
    transactionId: row.transactionId,
    agreementId: row.agreementId,
    proposalId: row.proposalId,
    engagementId: row.engagementId,
    needId: row.needId,
    needRevision: row.needRevision,
    transactionState: row.transactionState,
  };
}

/**
 * Every transaction that came from one need, whichever revision it was at.
 *
 *   ONE NEED → MULTIPLE ATTEMPTS → zero or more transactions
 *
 * A rejected or withdrawn attempt simply never reaches a transaction, so it
 * appears here not at all — which is why a failed attempt can neither resolve
 * a need nor create a second one.
 */
export async function transactionsForNeed(needId: string): Promise<readonly NeedLineage[]> {
  const rows = await db
    .select({
      transactionId: transactions.id,
      transactionState: transactions.state,
      agreementId: transactions.agreementId,
      proposalId: agreements.proposalId,
      engagementId: economicProposals.engagementId,
      needId: economicEngagements.needId,
      needRevision: economicEngagements.needRevision,
    })
    .from(economicEngagements)
    .innerJoin(economicProposals, eq(economicProposals.engagementId, economicEngagements.id))
    .innerJoin(agreements, eq(agreements.proposalId, economicProposals.id))
    .innerJoin(transactions, eq(transactions.agreementId, agreements.id))
    .where(and(eq(economicEngagements.needId, needId), isNotNull(economicEngagements.needRevision)));

  return rows.map((row) => ({
    transactionId: row.transactionId,
    agreementId: row.agreementId,
    proposalId: row.proposalId,
    engagementId: row.engagementId,
    needId: row.needId!,
    needRevision: row.needRevision!,
    transactionState: row.transactionState,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// The resolution gate
// ─────────────────────────────────────────────────────────────────────────────

export const NEED_SATISFACTION_VERDICTS = [
  /** Provenance and verification both hold. The only verdict that resolves. */
  "SATISFIED",
  /** Nothing ever came of it. */
  "NO_TRANSACTION",
  /** Something came of it, and it is not finished. */
  "FULFILLMENT_INCOMPLETE",
  /** Attempts exist at an older revision than the need now has. */
  "SUPERSEDED_BY_REVISION",
  /** More than one transaction: whether they COVER the outcome is unknowable. */
  "INCONCLUSIVE",
] as const;
export type NeedSatisfactionVerdict = (typeof NEED_SATISFACTION_VERDICTS)[number];

export type NeedSatisfaction = {
  readonly verdict: NeedSatisfactionVerdict;
  readonly needId: string;
  readonly needRevision: number;
  readonly lineage: readonly NeedLineage[];
  /** Said plainly, because a refusal to conclude is an answer people act on. */
  readonly reason: string;
};

/**
 * Can JASIM say this need was satisfied?
 *
 * Both halves must hold, and neither substitutes for the other:
 *
 *   A. deterministic provenance from the need TO a transaction, at the
 *      revision the need has NOW; and
 *   B. every obligation in that transaction VERIFIED — not claimed, not paid.
 *
 * CONSERVATIVE BY CONSTRUCTION. With more than one traced transaction the
 * answer is INCONCLUSIVE, because nothing in a need says how many things it
 * takes to satisfy it. «جهز لي فعالية» may need a hall, an interpreter and
 * transport, and one finished transaction is not the outcome. Inventing
 * partial-completion semantics to make that case green would be inventing the
 * answer.
 *
 *   ONE_TRANSACTION_ALWAYS_RESOLVES_NEED = NO
 *   INCONCLUSIVE_NEED_SATISFACTION != RESOLVED
 */
export async function evaluateNeedSatisfaction(input: {
  needId: string;
  conversationId: string;
  scopeId: string;
}): Promise<NeedSatisfaction> {
  const [need] = await db
    .select()
    .from(conversationNeeds)
    .where(
      and(
        eq(conversationNeeds.id, input.needId),
        // Scoped. Provenance never bridges an access boundary.
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
      ),
    )
    .limit(1);
  if (!need) {
    throw new Error("No such need in this conversation.");
  }

  const all = await transactionsForNeed(need.id);
  if (all.length === 0) {
    return {
      verdict: "NO_TRANSACTION",
      needId: need.id,
      needRevision: need.revision,
      lineage: [],
      reason: "لم تنشأ عن هذه الحاجة أي معاملة.",
    };
  }

  // Only attempts made for what the need says NOW can satisfy what it says
  // now. A correction after a search does not inherit the old attempt.
  //
  //   OLD_REVISION_TRANSACTION_AUTO_SATISFIES_NEW_REVISION = 0
  const current = all.filter((entry) => entry.needRevision === need.revision);
  if (current.length === 0) {
    return {
      verdict: "SUPERSEDED_BY_REVISION",
      needId: need.id,
      needRevision: need.revision,
      lineage: all,
      reason: "المعاملات القائمة تعود لصيغة أقدم من هذه الحاجة بعد تعديلها.",
    };
  }

  if (current.length > 1) {
    return {
      verdict: "INCONCLUSIVE",
      needId: need.id,
      needRevision: need.revision,
      lineage: current,
      reason: "أكثر من معاملة تعود لهذه الحاجة، ولا أعرف إن كانت تغطيها كلها.",
    };
  }

  const only = current[0]!;
  const obligations = await db
    .select({ verification: commitments.verification, state: commitments.state })
    .from(commitments)
    .where(eq(commitments.transactionId, only.transactionId));

  //   CLAIMED_COMPLETE != VERIFIED_COMPLETE · PAYMENT != FULFILLMENT
  //
  // Every obligation, both directions. A paid-for thing that was never
  // delivered leaves its counter-obligation unverified, and that is the case
  // this check exists for.
  const unverified = obligations.filter((row) => row.verification !== "VERIFIED");
  if (obligations.length === 0 || unverified.length > 0) {
    return {
      verdict: "FULFILLMENT_INCOMPLETE",
      needId: need.id,
      needRevision: need.revision,
      lineage: current,
      reason: "المعاملة قائمة، ولم يُتحقق بعد من تنفيذ كل التزاماتها.",
    };
  }

  return {
    verdict: "SATISFIED",
    needId: need.id,
    needRevision: need.revision,
    lineage: current,
    reason: "معاملة واحدة تعود لهذه الحاجة بصيغتها الحالية، وتحقق تنفيذ كل التزاماتها.",
  };
}

/**
 * Resolve a need, and ONLY on a SATISFIED verdict.
 *
 * There is no argument by which a caller can force this, and no path from a
 * model patch reaches it. Every other verdict leaves the need exactly as it
 * was — which is the difference between a runtime that knows and one that
 * would rather say something.
 *
 *   MODEL_CAN_MARK_NEED_RESOLVED = NO
 *   UNVERIFIED_FULFILLMENT_RESOLVES_NEED = 0
 */
export async function resolveNeedIfSatisfied(input: {
  needId: string;
  conversationId: string;
  scopeId: string;
}): Promise<NeedSatisfaction> {
  const satisfaction = await evaluateNeedSatisfaction(input);
  if (satisfaction.verdict !== "SATISFIED") return satisfaction;
  await db
    .update(conversationNeeds)
    .set({ state: "RESOLVED", updatedAt: new Date() })
    .where(
      and(
        eq(conversationNeeds.id, input.needId),
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
        // The revision the verdict was reached on. A refinement landing in
        // between makes the verdict stale, and a stale verdict resolves
        // nothing.
        eq(conversationNeeds.revision, satisfaction.needRevision),
      ),
    );
  return satisfaction;
}

/**
 * Which needs in this conversation an arrived-at transaction speaks to.
 *
 * Used by nothing that decides; it answers «did this finish what I asked
 * for?». A transaction with no need edge belongs to no conversational need,
 * and no amount of matching by owner, amount, time or semantic type changes
 * that.
 *
 *   CROSS_NEED_SATISFACTION = 0 · LATEST_NEED_RESOLUTION_GUESS = 0
 */
export async function needsAffectedByTransaction(input: {
  transactionId: string;
  conversationId: string;
  scopeId: string;
}): Promise<readonly string[]> {
  const lineage = await lineageOfTransaction(input.transactionId);
  if (!lineage) return [];
  const rows = await db
    .select({ id: conversationNeeds.id })
    .from(conversationNeeds)
    .where(
      and(
        inArray(conversationNeeds.id, [lineage.needId]),
        eq(conversationNeeds.conversationId, input.conversationId),
        eq(conversationNeeds.scopeId, input.scopeId),
      ),
    );
  return rows.map((row) => row.id);
}
