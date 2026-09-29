/**
 * JASIM — ONE CONVERSATION DRIVES THE WHOLE CHAIN.
 *
 * ─── THE GAP, TRACED BEFORE ANYTHING WAS WRITTEN ────────────────────────────
 *
 * Three runtimes were built, proven, and reachable by NOTHING a person could
 * say:
 *
 *   askCounterparty       → 0 callers outside its own module
 *   commitAgreement       → 0 callers from any turn
 *   discloseToCounterparty→ 0 callers from any turn
 *
 * And the reason they could not be reached was smaller and worse than any of
 * them: `proposeTurn` created an engagement, a need and a proposal, bound NONE
 * of them, and returned. Every later sentence — «اسأله إن كانت ما زالت
 * موجودة», «أرسل له موقعي» — had nothing to refer to. The conversation ended
 * at "proposal sent" and the rest of JASIM sat behind a door with no handle.
 *
 *   WHAT_A_TURN_CREATES_IS_NAMEABLE
 *
 * ─── AND THE ONES THAT MUST NOT COLLAPSE INTO EACH OTHER ────────────────────
 *
 *   OWN_CONFIRMATION != COUNTERPARTY_ACCEPTANCE
 *     «أوافق» pins one's OWN draft. «أقبل» is the other party saying yes to
 *     what was sent. Reading one as the other would let a buyer's confirmation
 *     of their own words look like a seller's acceptance.
 *
 *   MODEL_EXTRACTION != OWNER_DECLARATION
 *     The model decided WHICH field «أرسل له موقعي» meant. A released address
 *     cannot be un-released, so the release is shown first and performed second.
 *
 *   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY
 *     Talking to somebody is not permission to learn where they are.
 *
 * ─── AND IT IS NOT A SCENARIO ───────────────────────────────────────────────
 *
 * Nothing below branches on what is being bought. The last test runs the
 * identical sentence sequence for five unrelated subjects.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { economicExpressions, referenceBindings } from "@db/schema";
import { privateDisclosures } from "@db/schema-block2";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let brokering: typeof import("../../api/runtime/cross-party-brokering");
let disclosure: typeof import("../../api/runtime/private-disclosure");
let setNegotiationEnvelope: typeof import("../../api/runtime/agreement-runtime").setNegotiationEnvelope;

const BUYER = "chain-buyer";
const SELLER = "chain-seller";
const STRANGER = "chain-stranger";

const worlds = {
  get: async () => undefined,
  conversationWorld: async () => undefined,
} as never;

type Envelope = {
  decisionId: string;
  kind: string;
  intent?: { requiredCapabilities: string[]; missingInputs: string[]; inputs: Record<string, unknown> };
};

const envelope = (capabilities: string[], inputs: Record<string, unknown> = {}): Envelope => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: capabilities, missingInputs: [], inputs },
});

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
  brokering = await import("../../api/runtime/cross-party-brokering");
  disclosure = await import("../../api/runtime/private-disclosure");
  ({ setNegotiationEnvelope } = await import("../../api/runtime/agreement-runtime"));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      fulfillment_observations, commercial_orders, payment_intents, plans,
      cross_party_questions, private_disclosures, agreements, commitments,
      negotiation_envelopes, economic_proposals, economic_engagements,
      economic_matches, economic_expressions CASCADE
  `));
});

describe("a person says things, and JASIM carries the whole chain", () => {
  /** One conversation, so every turn refers to the same things. */
  function conversation(id: string) {
    const say = (
      ownerId: string,
      content: string,
      env: Envelope,
    ) =>
      orchestrate({
        db: handle.db,
        worlds,
        ownerId,
        conversationId: id,
        content,
        approvalRef: `message-${randomUUID()}`,
        envelope: env,
      });
    return { say };
  }

  async function seedOffering(semanticType: string) {
    const expression = await createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType,
      attributes: { priceMinor: "5000", currency: "SAR" },
    });
    return publishExpression({
      id: expression.id,
      ownerId: SELLER,
      projection: {
        semanticType,
        summary: semanticType,
        publicTerms: { money: { amountMinor: "5000", currency: "SAR" } },
      },
    });
  }

  /** Search → take the first → send the request. All pre-existing turns. */
  async function upToProposal(semanticType: string, conversationId: string) {
    const { say } = conversation(conversationId);
    await seedOffering(semanticType);
    await say(BUYER, `ابحث عن ${semanticType}`, envelope(["discovery"], { query: semanticType }));
    await say(BUYER, "خذ الأولى", envelope(["commerce:select"], { position: 1 }));
    const sent = await say(BUYER, "اطلبها", envelope(["commerce:propose"]));
    expect(sent?.data.proposalId).toBeTruthy();
    return { say, sent };
  }

  const bindings = async (conversationId: string, ownerId: string) =>
    (await handle.db
      .select()
      .from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversationId)))
      .filter((row) => row.ownerId === ownerId)
      .map((row) => row.referenceKey);

  /**
   * The counterparty's OWN bounds, set in advance.
   *
   * A conversational «أقبل» cannot carry owner-direct authority — the model
   * decided what the sentence meant, and a model that could bind somebody to a
   * term sheet by classifying a sentence is the whole vulnerability. So JASIM
   * accepts for you only inside limits you set yourself, beforehand.
   *
   *   MODEL != AUTHORITY · CLASSIFICATION != ACCEPTANCE
   */
  async function sellerBounds(conversationId: string) {
    const engagement = (
      await handle.db.select().from(referenceBindings)
        .where(eq(referenceBindings.conversationId, conversationId))
    ).find((row) => row.referenceKey === "current:engagement");
    expect(engagement).toBeTruthy();
    await setNegotiationEnvelope({
      engagementId: engagement!.targetId,
      ownerId: SELLER,
      principalId: SELLER,
      bounds: {
        settlement: { direction: "HIGHER_IS_BETTER", target: 5000, reserve: 4000 },
        provision: { direction: "LOWER_IS_BETTER", target: 1, reserve: 2 },
      },
      mayAcceptWithinReserve: true,
    });
  }

  // ── 1. THE DOOR WITH NO HANDLE ─────────────────────────────────────────────

  it("what a turn creates, a later turn can name", async () => {
    const id = `chain-${randomUUID()}`;
    await upToProposal("workspace.seat", id);
    const keys = await bindings(id, BUYER);
    // Before this phase the engagement, the need and the proposal were created
    // and dropped on the floor.
    expect(keys).toContain("current:engagement");
    expect(keys).toContain("current:need");
    expect(keys).toContain("current:proposal");
    expect(keys).toContain("current:counterparty_offering");
    // And the keys are generic. There is no current:mechanic.
    for (const key of keys) {
      expect(key).not.toMatch(/mechanic|car|seat|driver|hotel|doctor/i);
    }
  });

  // ── 2. ASKING THE OTHER PARTY, FROM A SENTENCE ─────────────────────────────

  it("«اسأله» carries a question that the runtime alone could be asked to carry", async () => {
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);

    const asked = await say(
      BUYER,
      "اسأله عن الحالة",
      envelope(["counterparty:ask"], { property: "condition" }),
    );
    expect(asked?.data.answered).toBe(false);
    // A seller's word is evidence, never an attribute of the thing.
    //   SELLER_ANSWER_IS_EVIDENCE_NOT_ATTRIBUTE
    expect(asked?.data.answerIsEvidenceNotFact).toBe(true);

    // The other party sees their own thing and the question — and nothing
    // about who asked.  QUESTION_LEAKS_ASKER_IDENTITY = 0
    const pending = await brokering.pendingQuestionsFor({ ownerId: SELLER });
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending[0])).not.toContain(BUYER);

    await brokering.answerQuestion({
      questionId: pending[0]!.questionId,
      answeringOwnerId: SELLER,
      value: "as described",
    });

    const heard = await say(BUYER, "ماذا رد؟", envelope(["counterparty:answers"]));
    expect(heard?.data.answers).toMatchObject([
      { property: "condition", answer: "as described", stale: false },
    ]);
  });

  it("asking about something nobody named, or in no engagement, clarifies", async () => {
    const id = `chain-${randomUUID()}`;
    const { say } = conversation(id);
    const nothing = await say(BUYER, "اسأله عن الحالة", envelope(["counterparty:ask"], { property: "condition" }));
    expect(nothing?.status).toBe("awaiting_input");

    const withEngagement = await upToProposal("workspace.seat", `chain-${randomUUID()}`);
    const noProperty = await withEngagement.say(BUYER, "اسأله", envelope(["counterparty:ask"]));
    expect(noProperty?.status).toBe("awaiting_input");
  });

  // ── 3. THE OTHER PARTY ACCEPTS ─────────────────────────────────────────────

  it("«أقبل» from the counterparty makes the agreement, and says what it is not", async () => {
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);

    await sellerBounds(id);
    const accepted = await say(SELLER, "أقبل", envelope(["proposal:accept"]));
    expect(accepted?.data.agreementId).toBeTruthy();
    // AGREEMENT != TRANSACTION != FULFILLMENT, stated rather than implied.
    expect(accepted?.data.paid).toBe(false);
    expect(accepted?.data.fulfilled).toBe(false);
  });

  it("without bounds set in advance, JASIM refuses to accept for you", async () => {
    //   MODEL != AUTHORITY · CLASSIFICATION != ACCEPTANCE
    //
    // Caught by an inherited ratchet on who may set the direct-acceptance
    // flag, and the ratchet was right: that flag is reserved for the two
    // places a person is provably present, and a classified sentence is
    // neither. Saying so is better than binding somebody quietly.
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    const refused = await say(SELLER, "أقبل", envelope(["proposal:accept"]));
    expect(refused?.status).toBe("blocked");
    expect(refused?.data.agreementCreated).toBe(false);
    expect(refused?.data.effects).toBe("none");
    expect(await handle.db.select().from(privateDisclosures)).toHaveLength(0);
  });

  it("«أوافق» is not «أقبل»", async () => {
    //   OWN_CONFIRMATION != COUNTERPARTY_ACCEPTANCE
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    const confirmed = await say(BUYER, "أوافق", envelope(["commerce:approve"]));
    // Whatever the buyer's own confirmation does, it does not produce the
    // counterparty's agreement.
    expect(confirmed?.data.agreementId).toBeUndefined();
    const rows = await handle.db.select().from(privateDisclosures);
    expect(rows).toHaveLength(0);
  });

  // ── 4. RELEASING SOMETHING PRIVATE, IN TWO TURNS ───────────────────────────

  /** The buyer's own need, carrying something private, as intake would leave it. */
  async function statePrivateField(conversationId: string, field: string, value: unknown) {
    const [bound] = await handle.db
      .select()
      .from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversationId));
    const needBinding = (
      await handle.db.select().from(referenceBindings)
        .where(eq(referenceBindings.conversationId, conversationId))
    ).find((row) => row.referenceKey === "current:need");
    expect(bound).toBeTruthy();
    expect(needBinding).toBeTruthy();
    await handle.db
      .update(economicExpressions)
      .set({ attributes: { [field]: value } })
      .where(eq(economicExpressions.id, needBinding!.targetId));
    return needBinding!.targetId;
  }

  it("before an agreement, nothing private is released whatever is said", async () => {
    //   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    await statePrivateField(id, "meetingPoint", { lat: 31.95, lng: 35.91 });

    const refused = await say(
      BUYER, "أرسل له موقعي", envelope(["disclosure"], { field: "meetingPoint" }),
    );
    expect(refused?.status).toBe("awaiting_input");
    expect(await handle.db.select().from(privateDisclosures)).toHaveLength(0);
  });

  it("after the agreement, the release is SHOWN first and PERFORMED second", async () => {
    //   MODEL_EXTRACTION != OWNER_DECLARATION
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    const point = { lat: 31.9539, lng: 35.9106 };
    const needId = await statePrivateField(id, "meetingPoint", point);
    await sellerBounds(id);
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));

    const shown = await say(
      BUYER, "أرسل له موقعي", envelope(["disclosure"], { field: "meetingPoint" }),
    );
    expect(shown?.status).toBe("awaiting_approval");
    expect(shown?.data.released).toBe(false);
    expect(shown?.data.effects).toBe("none");
    // The owner sees exactly what will go, and to whom.
    expect(shown?.data.field).toBe("meetingPoint");
    expect(shown?.data.value).toEqual(point);
    expect(shown?.data.recipientOwnerId).toBe(SELLER);
    expect(await handle.db.select().from(privateDisclosures)).toHaveLength(0);

    const released = await say(BUYER, "أوافق", envelope(["commerce:approve"]));
    expect(released?.data.released).toBe(true);
    expect(released?.data.published).toBe(false);

    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: SELLER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: needId,
      field: "meetingPoint",
    });
    expect(read.status === "RELEASED" && read.value).toEqual(point);
  });

  it("a release the person never confirmed never happens", async () => {
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    await statePrivateField(id, "meetingPoint", { lat: 31.9, lng: 35.9 });
    await sellerBounds(id);
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));
    await say(BUYER, "أرسل له موقعي", envelope(["disclosure"], { field: "meetingPoint" }));
    // They change their mind and say something else entirely.
    await say(BUYER, "ابحث عن شيء آخر", envelope(["discovery"], { query: "workspace.seat" }));
    expect(await handle.db.select().from(privateDisclosures)).toHaveLength(0);
  });

  it("releasing something the person never stated says so, and releases nothing", async () => {
    //   DISCLOSING_WHAT_IS_NOT_THERE = 0
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    await sellerBounds(id);
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));
    const nothing = await say(
      BUYER, "أرسل له موقعي", envelope(["disclosure"], { field: "meetingPoint" }),
    );
    expect(nothing?.status).toBe("awaiting_input");
    expect(await handle.db.select().from(privateDisclosures)).toHaveLength(0);
  });

  it("somebody outside the conversation releases nothing and learns nothing", async () => {
    const id = `chain-${randomUUID()}`;
    const { say } = await upToProposal("workspace.seat", id);
    const needId = await statePrivateField(id, "meetingPoint", { lat: 31.9, lng: 35.9 });
    await sellerBounds(id);
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));
    await say(BUYER, "أرسل له موقعي", envelope(["disclosure"], { field: "meetingPoint" }));
    await say(BUYER, "أوافق", envelope(["commerce:approve"]));

    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: STRANGER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: needId,
      field: "meetingPoint",
    });
    expect(read.status).toBe("NOT_DISCLOSED");
  });

  // ── 5. THE SAME SENTENCES, FIVE UNRELATED WORLDS ───────────────────────────

  it("the identical sentence sequence runs for five subjects that share nothing", async () => {
    //   NEW DOMAIN != NEW AGENT · NEW EXAMPLE != NEW FEATURE FAMILY
    const worldsUnderTest: Array<{ semanticType: string; field: string; value: unknown }> = [
      { semanticType: "mobile.repair", field: "meetingPoint", value: { lat: 31.9, lng: 35.9 } },
      { semanticType: "seabed.survey", field: "siteAccessNote", value: "gate 4" },
      { semanticType: "artifact.conservation", field: "humidityWindow", value: "45-50" },
      { semanticType: "machine.hire", field: "yardCode", value: "8821" },
      { semanticType: "interpreting.onsite", field: "buildingEntrance", value: "north door" },
    ];

    for (const world of worldsUnderTest) {
      await handle.db.execute(sql.raw(`
        TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
          commercial_orders, cross_party_questions, private_disclosures, agreements,
          commitments, economic_proposals, economic_engagements, economic_matches,
          economic_expressions CASCADE
      `));
      const id = `chain-${randomUUID()}`;
      const { say } = await upToProposal(world.semanticType, id);
      const needId = await statePrivateField(id, world.field, world.value);

      await sellerBounds(id);
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));
      const shown = await say(
        BUYER, "أرسل له موقعي", envelope(["disclosure"], { field: world.field }),
      );
      expect(shown?.status, world.semanticType).toBe("awaiting_approval");
      await say(BUYER, "أوافق", envelope(["commerce:approve"]));

      const read = await disclosure.readDisclosedField(handle.db, {
        recipientOwnerId: SELLER,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: needId,
        field: world.field,
      });
      expect(read.status, world.semanticType).toBe("RELEASED");
      expect(read.status === "RELEASED" && read.value).toEqual(world.value);
    }
  });

  it("no domain noun entered the dispatch", () => {
    const source = readFileSync("api/runtime/block31/conversation-orchestrator.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const word of [
      "mechanic", "vehicle", "restaurant", "hotel", "doctor", "courier",
      "translator", "warehouse", "factory", "flight",
    ]) {
      expect(source, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });
});
