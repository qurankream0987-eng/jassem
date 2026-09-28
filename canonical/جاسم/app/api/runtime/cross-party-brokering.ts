/**
 * JASIM — JASIM BROKERS, AND ANSWERS FOR NOBODY.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   ANSWER_AUTHORITY_IS_THE_SUBJECT_OWNER
 *   SELLER_ANSWER_IS_EVIDENCE_NOT_ATTRIBUTE
 *   MODEL_ANSWERS_ON_BEHALF_OF_A_PARTY = 0
 *   UNANSWERED != FALSE · UNANSWERED != UNAVAILABLE
 *   QUESTION_LEAKS_ASKER_IDENTITY = 0
 *   ENGAGEMENT_IS_THE_CONTACT_AUTHORITY
 *
 * ─── WHAT WAS MISSING ───────────────────────────────────────────────────────
 *
 * A buyer asks about something an offering never declared — the mileage, the
 * delivery window, whether the size is really in stock. There was nowhere for
 * that question to go. `economic-fabric` guards ownership strictly and
 * correctly: a non-owner sees the public projection and nothing else. So the
 * only two ways to fill the gap were both wrong.
 *
 *   The model answers    → invention. A number with no author.
 *   Write it into the    → a claim the seller never made, indistinguishable
 *   offering's attributes  from what they declared at publication.
 *
 * The third way is the one a human broker uses: carry the question to the
 * person who knows, and bring their answer back WITH THEIR NAME ON IT.
 *
 * ─── WHY IT NEEDS AN ENGAGEMENT ─────────────────────────────────────────────
 *
 * A question is contact, and contact needs consent. The only authorized
 * cross-owner relationship in this repository is the engagement: match-backed,
 * with participants DERIVED from the authorized match rather than nominated by
 * a caller. `createEngagement` already refuses to invent one, saying an
 * unmatched engagement «would require an invitation/consent flow that does not
 * exist yet». That is still true, and this does not build one — it reuses the
 * consent that exists.
 *
 *   SECOND_CROSS_OWNER_CONSENT_PATH = 0
 *
 * ─── WHAT AN ANSWER IS ──────────────────────────────────────────────────────
 *
 * `SELF_REPORTED` evidence: «the acting party asserts it. Uncorroborated.» That
 * is the honest classification. It is also the STRONGEST evidence that exists
 * for how many kilometres a car has driven — nobody issues a receipt for that —
 * and it is still not a fact JASIM asserts. The distinction is not pedantry: it
 * is the difference between «the seller says 120,000 km» and «the car has
 * driven 120,000 km», and only one of those is true.
 *
 * So an answer is never written into `economic_expressions.attributes`. Nothing
 * downstream can read it as something the seller declared at publication, and
 * `evidence-sufficiency` can weigh it for whatever act is about to happen.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  crossPartyQuestions,
  economicExpressions,
  type CrossPartyQuestion,
} from "../../db/schema";
import {
  EconomicAuthorizationError,
  EconomicNotFoundError,
  requireEngagementParticipant,
} from "./economic-fabric";
import type { EffectClaimSource } from "./completion-policy";

/** What an answer is worth, stated rather than assumed. */
export const CROSS_PARTY_ANSWER_SOURCE: EffectClaimSource = "SELF_REPORTED";

/**
 * WHAT THE ASKING PARTY SEES.
 *
 * The question, its subject at the exact revision asked about, and what came
 * back — `value` only when somebody actually said something. `source` travels
 * with it, because evidence without its authority is a rumour.
 */
export type AskedQuestionView = {
  readonly questionId: string;
  readonly property: string;
  readonly subjectExpressionId: string;
  readonly subjectRevision: number;
  readonly status: CrossPartyQuestion["status"];
  readonly answer?: { readonly value: unknown; readonly source: EffectClaimSource; readonly answeredAt: Date };
};

/**
 * WHAT THE ANSWERING PARTY SEES.
 *
 * Their own thing, and what was asked about it. NOT who asked, not what that
 * party needs, not what they were willing to pay — none of which is any of the
 * answering party's business, and all of which would price-discriminate the
 * asker if it travelled.
 *
 *   QUESTION_LEAKS_ASKER_IDENTITY = 0
 *   QUESTION_LEAKS_ASKER_NEED = 0
 */
export type PendingQuestionView = {
  readonly questionId: string;
  readonly property: string;
  readonly subjectExpressionId: string;
  readonly subjectRevision: number;
  readonly askedAt: Date;
};

function viewForAsker(row: CrossPartyQuestion): AskedQuestionView {
  return {
    questionId: row.id,
    property: row.property,
    subjectExpressionId: row.subjectExpressionId,
    subjectRevision: row.subjectRevision,
    status: row.status,
    // Only an ANSWERED question carries a value. A declined or open one carries
    // none, and no caller can tell the two apart by reading a default.
    ...(row.status === "answered" && row.answerValue && row.answeredAt
      ? {
          answer: {
            value: row.answerValue.value,
            source: CROSS_PARTY_ANSWER_SOURCE,
            answeredAt: row.answeredAt,
          },
        }
      : {}),
  };
}

/**
 * ASK THE OTHER PARTY ABOUT THEIR OWN THING.
 *
 * Three facts are checked and none is believed from the caller: that the asker
 * is in this engagement, that the subject belongs to somebody ELSE in it, and
 * which revision of that subject the question is about.
 */
export async function askCounterparty(input: {
  engagementId: string;
  askedByOwnerId: string;
  subjectExpressionId: string;
  /** A property name the runtime derived. Never free-text from a model. */
  property: string;
}): Promise<AskedQuestionView> {
  const engagement = await requireEngagementParticipant(
    input.engagementId,
    input.askedByOwnerId,
  );
  const property = input.property.trim();
  if (!property) {
    throw new EconomicAuthorizationError("A question with no subject property is not a question.");
  }
  const [subject] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, input.subjectExpressionId))
    .limit(1);
  if (!subject) throw new EconomicNotFoundError("Expression not found.");
  // ONE'S OWN THING IS NOT A QUESTION, AND A THIRD PARTY'S IS NOT THIS
  // ENGAGEMENT'S. Both refusals are the same sentence, because telling them
  // apart would say whether an id exists.
  if (
    subject.ownerId === input.askedByOwnerId ||
    !engagement.participants.includes(subject.ownerId)
  ) {
    throw new EconomicAuthorizationError(
      "That is not something the other party of this engagement can be asked about.",
    );
  }
  const values = {
    id: `cpq_${randomUUID()}`,
    engagementId: input.engagementId,
    askedByOwnerId: input.askedByOwnerId,
    subjectOwnerId: subject.ownerId,
    subjectExpressionId: subject.id,
    // PINNED. The answer will describe the thing as it is now, so it is
    // recorded against the version it was asked about.
    subjectRevision: subject.version,
    property,
  };
  // Asking twice is the same question, not a second one — so the second ask
  // returns the first, rather than becoming a way to press the other party.
  //
  //   REPEATED_QUESTION_CREATES_SECOND_OBLIGATION = 0
  const [inserted] = await db
    .insert(crossPartyQuestions)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (inserted) return viewForAsker(inserted);
  const [existing] = await db
    .select()
    .from(crossPartyQuestions)
    .where(
      and(
        eq(crossPartyQuestions.engagementId, values.engagementId),
        eq(crossPartyQuestions.subjectExpressionId, values.subjectExpressionId),
        eq(crossPartyQuestions.subjectRevision, values.subjectRevision),
        eq(crossPartyQuestions.property, values.property),
      ),
    )
    .limit(1);
  if (!existing) throw new EconomicNotFoundError("Question not found.");
  return viewForAsker(existing);
}

/**
 * WHAT THIS OWNER HAS BEEN ASKED, about their own things.
 *
 * Read by subject owner, so nobody can list somebody else's inbox — and the
 * view carries no trace of who is asking.
 */
export async function pendingQuestionsFor(input: {
  ownerId: string;
  engagementId?: string;
}): Promise<readonly PendingQuestionView[]> {
  const rows = await db
    .select()
    .from(crossPartyQuestions)
    .where(
      and(
        eq(crossPartyQuestions.subjectOwnerId, input.ownerId),
        eq(crossPartyQuestions.status, "asked"),
        ...(input.engagementId
          ? [eq(crossPartyQuestions.engagementId, input.engagementId)]
          : []),
      ),
    );
  return rows.map((row) => ({
    questionId: row.id,
    property: row.property,
    subjectExpressionId: row.subjectExpressionId,
    subjectRevision: row.subjectRevision,
    askedAt: row.createdAt,
  }));
}

/**
 * THE OWNER ANSWERS. NOBODY ELSE CAN.
 *
 * Not the asker, not a third party, not JASIM, and not a model on the owner's
 * behalf. The answer is stored as what it is — this owner's own statement about
 * their own thing — and it does not touch the expression.
 *
 *   BUYER_QUESTION_MUTATES_SELLER_OFFERING = 0
 *   ANSWER_BECOMES_DECLARED_ATTRIBUTE = 0
 */
export async function answerQuestion(input: {
  questionId: string;
  answeringOwnerId: string;
  value: unknown;
  now?: Date;
}): Promise<AskedQuestionView> {
  const row = await questionOwnedBy(input.questionId, input.answeringOwnerId);
  if (row.status !== "asked") {
    throw new EconomicAuthorizationError(`That question is ${row.status}.`);
  }
  if (input.value === undefined || input.value === null) {
    // «I am not saying» is DECLINE, which is a different act with a different
    // meaning. An empty answer must not be able to masquerade as one.
    throw new EconomicAuthorizationError(
      "An answer with no value is not an answer; decline it instead.",
    );
  }
  const [updated] = await db
    .update(crossPartyQuestions)
    .set({
      status: "answered",
      answerValue: { value: input.value },
      answeredAt: input.now ?? new Date(),
    })
    .where(
      and(
        eq(crossPartyQuestions.id, row.id),
        // The status is re-checked by the write itself, so two answers racing
        // cannot both land.
        eq(crossPartyQuestions.status, "asked"),
      ),
    )
    .returning();
  if (!updated) throw new EconomicAuthorizationError("That question is no longer open.");
  return viewForAsker(updated);
}

/**
 * THE OWNER DECLINES — which is an answer about the owner, not about the thing.
 *
 *   DECLINED != UNAVAILABLE · DECLINED != NO
 */
export async function declineQuestion(input: {
  questionId: string;
  answeringOwnerId: string;
}): Promise<AskedQuestionView> {
  const row = await questionOwnedBy(input.questionId, input.answeringOwnerId);
  if (row.status !== "asked") {
    throw new EconomicAuthorizationError(`That question is ${row.status}.`);
  }
  const [updated] = await db
    .update(crossPartyQuestions)
    .set({ status: "declined" })
    .where(and(eq(crossPartyQuestions.id, row.id), eq(crossPartyQuestions.status, "asked")))
    .returning();
  if (!updated) throw new EconomicAuthorizationError("That question is no longer open.");
  return viewForAsker(updated);
}

/**
 * WHAT THE ASKING PARTY HAS ASKED, AND WHAT CAME BACK.
 *
 * Only this party's own questions. An engagement participant does not get to
 * read what the other one asked.
 */
export async function answersFor(input: {
  engagementId: string;
  askedByOwnerId: string;
}): Promise<readonly AskedQuestionView[]> {
  await requireEngagementParticipant(input.engagementId, input.askedByOwnerId);
  const rows = await db
    .select()
    .from(crossPartyQuestions)
    .where(
      and(
        eq(crossPartyQuestions.engagementId, input.engagementId),
        eq(crossPartyQuestions.askedByOwnerId, input.askedByOwnerId),
      ),
    );
  return rows.map(viewForAsker);
}

/**
 * ANSWERS THAT STILL DESCRIBE THE THING AS IT IS NOW.
 *
 * An answer was given about an exact version. If the owner has revised the
 * expression since, the answer described something that has changed — so it is
 * reported as stale rather than silently carried forward.
 *
 *   ANSWER_SURVIVES_SUBJECT_REVISION = 0
 *   SUBJECT_REVISED_SINCE
 */
export async function currentAnswersFor(input: {
  engagementId: string;
  askedByOwnerId: string;
}): Promise<
  readonly (AskedQuestionView & { readonly stale: boolean; readonly currentRevision: number })[]
> {
  const asked = await answersFor(input);
  if (asked.length === 0) return [];
  const subjects = await db
    .select({ id: economicExpressions.id, version: economicExpressions.version })
    .from(economicExpressions)
    .where(inArray(economicExpressions.id, [...new Set(asked.map((one) => one.subjectExpressionId))]));
  const versionOf = new Map(subjects.map((one) => [one.id, one.version]));
  return asked.map((one) => {
    const current = versionOf.get(one.subjectExpressionId) ?? one.subjectRevision;
    return { ...one, currentRevision: current, stale: current !== one.subjectRevision };
  });
}

async function questionOwnedBy(
  questionId: string,
  ownerId: string,
): Promise<CrossPartyQuestion> {
  const [row] = await db
    .select()
    .from(crossPartyQuestions)
    .where(eq(crossPartyQuestions.id, questionId))
    .limit(1);
  // ONE refusal for «no such question» and «not yours», because telling them
  // apart is an existence oracle over other people's conversations.
  if (!row || row.subjectOwnerId !== ownerId) {
    throw new EconomicNotFoundError("Question not found.");
  }
  return row;
}
