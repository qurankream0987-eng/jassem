/**
 * JASIM — يوصِل السؤال، ولا يجيب عن أحد.
 *
 *   ANSWER_AUTHORITY_IS_THE_SUBJECT_OWNER
 *   SELLER_ANSWER_IS_EVIDENCE_NOT_ATTRIBUTE
 *   MODEL_ANSWERS_ON_BEHALF_OF_A_PARTY = 0
 *   UNANSWERED != FALSE · DECLINED != UNAVAILABLE
 *   QUESTION_LEAKS_ASKER_IDENTITY = 0
 *   ENGAGEMENT_IS_THE_CONTACT_AUTHORITY
 *
 * A buyer asks about the mileage; the offering never declared one. The answer
 * must come from the seller, arrive with the seller's name on it, and never
 * become something the offering claims about itself.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { crossPartyQuestions, economicExpressions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let broker: typeof import("../../api/runtime/cross-party-brokering");

const BUYER = "owner-buyer";
const SELLER = "owner-seller";
const STRANGER = "owner-stranger";
const KIND = "سيارة برادو";

describe("a question one party asks about the other party's thing", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    fabric = await import("../../api/runtime/economic-fabric");
    broker = await import("../../api/runtime/cross-party-brokering");
  }, 60_000);

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE cross_party_questions, economic_proposals, economic_engagements,
        economic_matches, economic_expressions, transaction_intents, memberships CASCADE`),
    );
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  /** A seller's published car, and a buyer's need, matched into an engagement. */
  async function market(input?: { sellerAttributes?: Record<string, unknown> }) {
    const offering = await fabric.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: KIND,
      attributes: input?.sellerAttributes ?? { year: 2019, colour: "أبيض" },
    });
    const published = await fabric.publishExpression({
      id: offering.id, ownerId: SELLER,
      projection: { semanticType: KIND, summary: "برادو ٢٠١٩ أبيض" },
    });
    const need = await fabric.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id, offeringId: published.id, createdByOwnerId: BUYER,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id, initiatorOwnerId: BUYER, participants: [BUYER, SELLER],
    });
    return { offering: published, need, match, engagement };
  }

  const rowOf = async (questionId: string) => {
    const [row] = await handle.db.select().from(crossPartyQuestions)
      .where(eq(crossPartyQuestions.id, questionId)).limit(1);
    return row;
  };

  const expressionOf = async (id: string) => {
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, id)).limit(1);
    return row!;
  };

  // ── 1 · THE WHOLE JOURNEY ────────────────────────────────────────────────

  it("the buyer asks, the seller answers, and the answer carries the seller's name", async () => {
    const { offering, engagement } = await market();

    // The buyer asks about something the offering never declared.
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    expect(asked).toMatchObject({
      property: "mileage", status: "asked", subjectRevision: offering.version,
    });
    // Nothing is known. Not zero, not unavailable.
    //
    //   UNANSWERED != FALSE
    expect(asked.answer).toBeUndefined();

    // It reaches the seller — and says nothing about who is asking.
    const inbox = await broker.pendingQuestionsFor({ ownerId: SELLER });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ property: "mileage", subjectExpressionId: offering.id });
    expect(JSON.stringify(inbox[0])).not.toContain(BUYER);
    expect(Object.keys(inbox[0]!).sort()).toEqual(
      ["askedAt", "property", "questionId", "subjectExpressionId", "subjectRevision"],
    );

    // The seller answers.
    const answered = await broker.answerQuestion({
      questionId: asked.questionId, answeringOwnerId: SELLER, value: 120_000,
    });
    expect(answered).toMatchObject({ status: "answered" });
    // And it comes back as EVIDENCE, with its authority attached.
    expect(answered.answer).toMatchObject({ value: 120_000, source: "SELF_REPORTED" });

    // The buyer reads it as «the seller says», never as «the car has».
    const seen = await broker.answersFor({
      engagementId: engagement.id, askedByOwnerId: BUYER,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.answer).toMatchObject({ value: 120_000, source: "SELF_REPORTED" });

    // ── AND THE OFFERING DID NOT CHANGE ──────────────────────────────────
    //
    //   BUYER_QUESTION_MUTATES_SELLER_OFFERING = 0
    //   ANSWER_BECOMES_DECLARED_ATTRIBUTE = 0
    const after = await expressionOf(offering.id);
    expect(after.attributes).toEqual({ year: 2019, colour: "أبيض" });
    expect(after.version).toBe(offering.version);
    expect(JSON.stringify(after)).not.toContain("120000");
    expect(JSON.stringify(after.publicProjection)).not.toContain("mileage");
  });

  // ── 2 · ONLY THE OWNER MAY ANSWER ────────────────────────────────────────

  it("nobody but the owner of the thing may answer about it", async () => {
    //   ANSWER_AUTHORITY_IS_THE_SUBJECT_OWNER
    const { offering, engagement } = await market();
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    // The asker cannot answer their own question — which would be writing the
    // seller's words for them.
    await expect(
      broker.answerQuestion({
        questionId: asked.questionId, answeringOwnerId: BUYER, value: 10,
      }),
    ).rejects.toMatchObject({ name: "EconomicNotFoundError" });
    // Nor may a stranger, and the refusal does not admit the question exists.
    await expect(
      broker.answerQuestion({
        questionId: asked.questionId, answeringOwnerId: STRANGER, value: 10,
      }),
    ).rejects.toMatchObject({ name: "EconomicNotFoundError" });
    expect((await rowOf(asked.questionId))!.status).toBe("asked");
    expect((await rowOf(asked.questionId))!.answerValue).toBeNull();
  });

  // ── 3 · CONTACT NEEDS CONSENT ────────────────────────────────────────────

  it("without an engagement there is no question, and no engagement can be invented", async () => {
    //   ENGAGEMENT_IS_THE_CONTACT_AUTHORITY
    const { offering, engagement, match } = await market();
    // A stranger cannot ask through somebody else's engagement.
    await expect(
      broker.askCounterparty({
        engagementId: engagement.id, askedByOwnerId: STRANGER,
        subjectExpressionId: offering.id, property: "mileage",
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    // And a stranger cannot make one: participants are derived from the match.
    await expect(
      fabric.createEngagement({
        matchId: match.id, initiatorOwnerId: STRANGER, participants: [STRANGER, SELLER],
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await handle.db.select().from(crossPartyQuestions)).toHaveLength(0);
  });

  it("a party may not ask about its own thing, nor about a third party's", async () => {
    const { need, engagement } = await market();
    // The buyer's own need is not a question.
    await expect(
      broker.askCounterparty({
        engagementId: engagement.id, askedByOwnerId: BUYER,
        subjectExpressionId: need.id, property: "budget",
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    // Somebody else's published offering, outside this engagement.
    const elsewhere = await fabric.createExpression({
      ownerId: STRANGER, kind: "offering", semanticType: KIND,
    });
    await fabric.publishExpression({
      id: elsewhere.id, ownerId: STRANGER, projection: { semanticType: KIND },
    });
    await expect(
      broker.askCounterparty({
        engagementId: engagement.id, askedByOwnerId: BUYER,
        subjectExpressionId: elsewhere.id, property: "mileage",
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await handle.db.select().from(crossPartyQuestions)).toHaveLength(0);
  });

  // ── 4 · SILENCE AND REFUSAL ARE NOT ANSWERS ──────────────────────────────

  it("declining says something about the seller, not about the car", async () => {
    //   DECLINED != UNAVAILABLE · DECLINED != NO
    const { offering, engagement } = await market();
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "accidentHistory",
    });
    const declined = await broker.declineQuestion({
      questionId: asked.questionId, answeringOwnerId: SELLER,
    });
    expect(declined.status).toBe("declined");
    // No value is carried, and none can be read out of it by a caller
    // expecting a default.
    expect(declined.answer).toBeUndefined();
    const seen = await broker.answersFor({ engagementId: engagement.id, askedByOwnerId: BUYER });
    expect(seen[0]).toMatchObject({ status: "declined" });
    expect(seen[0]!.answer).toBeUndefined();
    // The offering still says nothing about it either.
    expect(JSON.stringify(await expressionOf(offering.id))).not.toContain("accidentHistory");
  });

  it("an empty answer is not an answer", async () => {
    const { offering, engagement } = await market();
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    for (const value of [undefined, null]) {
      await expect(
        broker.answerQuestion({
          questionId: asked.questionId, answeringOwnerId: SELLER, value,
        }),
      ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    }
    expect((await rowOf(asked.questionId))!.status).toBe("asked");
  });

  it("an answered question is settled, and cannot be answered again", async () => {
    const { offering, engagement } = await market();
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    await broker.answerQuestion({
      questionId: asked.questionId, answeringOwnerId: SELLER, value: 120_000,
    });
    await expect(
      broker.answerQuestion({
        questionId: asked.questionId, answeringOwnerId: SELLER, value: 90_000,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect((await rowOf(asked.questionId))!.answerValue).toEqual({ value: 120_000 });
    // It is also out of the seller's inbox: it is done.
    expect(await broker.pendingQuestionsFor({ ownerId: SELLER })).toHaveLength(0);
  });

  // ── 5 · ASKING TWICE IS THE SAME QUESTION ────────────────────────────────

  it("repeating a question is the same question, not a second obligation", async () => {
    //   REPEATED_QUESTION_CREATES_SECOND_OBLIGATION = 0
    const { offering, engagement } = await market();
    const first = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    const again = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    expect(again.questionId).toBe(first.questionId);
    expect(await broker.pendingQuestionsFor({ ownerId: SELLER })).toHaveLength(1);
    // Even four at once leave one.
    await Promise.allSettled(
      [0, 1, 2, 3].map(() =>
        broker.askCounterparty({
          engagementId: engagement.id, askedByOwnerId: BUYER,
          subjectExpressionId: offering.id, property: "mileage",
        }),
      ),
    );
    expect(await handle.db.select().from(crossPartyQuestions)).toHaveLength(1);
  });

  // ── 6 · AN ANSWER DESCRIBES A VERSION ────────────────────────────────────

  it("an answer stays attached to the version it described", async () => {
    //   ANSWER_SURVIVES_SUBJECT_REVISION = 0 · SUBJECT_REVISED_SINCE
    const { offering, engagement } = await market();
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    await broker.answerQuestion({
      questionId: asked.questionId, answeringOwnerId: SELLER, value: 120_000,
    });
    let current = await broker.currentAnswersFor({
      engagementId: engagement.id, askedByOwnerId: BUYER,
    });
    expect(current[0]).toMatchObject({ stale: false, currentRevision: offering.version });

    // The seller republishes — a new version of the thing.
    const revised = await fabric.publishExpression({
      id: offering.id, ownerId: SELLER,
      projection: { semanticType: KIND, summary: "برادو ٢٠١٩ أبيض — بعد الصيانة" },
    });
    expect(revised.version).toBeGreaterThan(offering.version);

    current = await broker.currentAnswersFor({
      engagementId: engagement.id, askedByOwnerId: BUYER,
    });
    // The answer is still the seller's, still 120,000 — and no longer claimed
    // to describe the thing as it now is.
    expect(current[0]).toMatchObject({
      stale: true, subjectRevision: offering.version, currentRevision: revised.version,
    });
    expect(current[0]!.answer).toMatchObject({ value: 120_000, source: "SELF_REPORTED" });
    // And the same question may now be asked again about the NEW version.
    const afresh = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    expect(afresh.questionId).not.toBe(asked.questionId);
    expect(afresh.subjectRevision).toBe(revised.version);
    expect(afresh.status).toBe("asked");
  });

  // ── 7 · NOBODY READS SOMEBODY ELSE'S THREAD ──────────────────────────────

  it("each party reads only its own questions", async () => {
    const { offering, need, engagement } = await market();
    await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: offering.id, property: "mileage",
    });
    // The seller may ask the buyer about the buyer's need, in the same
    // engagement — it is a two-way relationship.
    const sellerAsked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: SELLER,
      subjectExpressionId: need.id, property: "timeframe",
    });
    expect(sellerAsked.status).toBe("asked");
    // But neither reads the other's thread.
    const buyerSees = await broker.answersFor({
      engagementId: engagement.id, askedByOwnerId: BUYER,
    });
    const sellerSees = await broker.answersFor({
      engagementId: engagement.id, askedByOwnerId: SELLER,
    });
    expect(buyerSees.map((one) => one.property)).toEqual(["mileage"]);
    expect(sellerSees.map((one) => one.property)).toEqual(["timeframe"]);
    // And each inbox holds only what was asked of it.
    expect((await broker.pendingQuestionsFor({ ownerId: SELLER })).map((o) => o.property))
      .toEqual(["mileage"]);
    expect((await broker.pendingQuestionsFor({ ownerId: BUYER })).map((o) => o.property))
      .toEqual(["timeframe"]);
    expect(await broker.pendingQuestionsFor({ ownerId: STRANGER })).toHaveLength(0);
  });

  // ── 8 · NO DOMAIN, NO MODEL, NO SECOND CONSENT PATH ──────────────────────

  it("brokering names no domain, answers for nobody, and invents no consent", async () => {
    const source = await readFile(
      new URL("../../api/runtime/cross-party-brokering.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    for (const forbidden of [
      "car", "سيارة", "vehicle", "mileage", "restaurant", "laptop", "phone",
      "driver", "seller", "buyer", "price",
    ]) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // No model is consulted, and no answer is generated.
    for (const forbidden of ["ModelGateway", "model-gateway", "generate", "prompt", "complete("]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    // Consent is the engagement's, not this module's.
    expect(source).toContain("requireEngagementParticipant");
    expect(source).not.toContain("grantMembership");
    expect(source).not.toContain("createEngagement");
    // And an answer's worth is stated once, as what it is.
    expect(source).toContain('CROSS_PARTY_ANSWER_SOURCE: EffectClaimSource = "SELF_REPORTED"');
    expect(broker.CROSS_PARTY_ANSWER_SOURCE).toBe("SELF_REPORTED");
  });
});
