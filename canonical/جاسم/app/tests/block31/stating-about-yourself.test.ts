/**
 * JASIM — A PERSON CAN SAY SOMETHING ABOUT THEIR OWN THING.
 *
 * ─── THE GAP, TRACED BEFORE ANYTHING WAS WRITTEN ────────────────────────────
 *
 * No turn wrote an attribute anywhere. `proposeTurn` created its need with
 * `attributes: {}` and nothing ever put anything in it, so the need a
 * conversation created was permanently empty. Two things that had just been
 * built could therefore never work from a conversation:
 *
 *   • proximity had no origin — «ابحث عن مكانيكي» could not search NEAR you
 *   • disclosure had nothing to release — «أرسل له موقعي» found no location
 *
 * The person could say it and JASIM had nowhere to put it.
 *
 * ─── THE DISTINCTION THIS PHASE HOLDS ───────────────────────────────────────
 *
 *   A FACT ABOUT ME IS NOT A REQUIREMENT OF THEM
 *
 * «أريد ضمن 25 كم» is a CONSTRAINT: what a candidate must satisfy. «أنا عند
 * الدوار» is an ATTRIBUTE: what is true of me. Conflating them turns my own
 * location into something candidates get filtered against.
 *
 *   MODEL_EXTRACTION != OWNER_DECLARATION
 *
 * I said words; something turned them into a value. It lands INFERRED, decides
 * nothing, and becomes STATED at the moment I look at it and say yes.
 *
 *   ONE_CONVERSATION_ONE_SUBJECT_OF_MINE — said before the search and said
 *   after the agreement, both reach the same thing.
 *
 *   STATING_IS_NOT_PUBLISHING — telling JASIM is not telling the world.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { economicExpressions, referenceBindings } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let stateOwnAttribute: typeof import("../../api/runtime/economic-fabric").stateOwnAttribute;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let disclosure: typeof import("../../api/runtime/private-disclosure");
let setNegotiationEnvelope: typeof import("../../api/runtime/agreement-runtime").setNegotiationEnvelope;

const ME = "state-me";
const SELLER = "state-seller";
const OTHER = "state-other";

const ROADSIDE = { lat: 31.9539, lng: 35.9106 };
const NEARBY = { lat: 31.98, lng: 35.94 };   // ~4 km
const DISTANT = { lat: 32.5556, lng: 35.85 }; // ~68 km

const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;

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
  ({ createExpression, publishExpression, stateOwnAttribute } = await import(
    "../../api/runtime/economic-fabric"
  ));
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
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

describe("saying something about yourself, and what it is worth", () => {
  const conversationId = () => `state-${randomUUID()}`;

  function conversation(id: string) {
    return {
      say: (ownerId: string, content: string, env: Envelope) =>
        orchestrate({
          db: handle.db,
          worlds,
          ownerId,
          conversationId: id,
          content,
          approvalRef: `message-${randomUUID()}`,
          envelope: env,
        }),
    };
  }

  const iAm = (field: string, value: unknown) =>
    envelope(["self:state"], { field, value });

  async function subjectOf(id: string, ownerId = ME) {
    const bound = (
      await handle.db.select().from(referenceBindings)
        .where(eq(referenceBindings.conversationId, id))
    ).find((row) => row.referenceKey === "current:need" && row.ownerId === ownerId);
    if (!bound) return null;
    const [row] = await handle.db
      .select().from(economicExpressions).where(eq(economicExpressions.id, bound.targetId));
    return row ?? null;
  }

  async function workshop(at: { lat: number; lng: number }, semanticType: string) {
    const expression = await createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType,
      attributes: { location: at, priceMinor: "5000", currency: "SAR" },
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

  // ── 1. THE GAP ─────────────────────────────────────────────────────────────

  it("a fact about you lands on your own thing, where nothing could put one before", async () => {
    const id = conversationId();
    const { say } = conversation(id);
    const recorded = await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));

    expect(recorded?.data.field).toBe("location");
    expect(recorded?.data.value).toEqual(ROADSIDE);
    const subject = await subjectOf(id);
    expect((subject!.attributes as Record<string, unknown>).location).toEqual(ROADSIDE);
    expect(subject!.ownerId).toBe(ME);
  });

  it("what the model read out of a sentence is INFERRED, and decides nothing yet", async () => {
    //   MODEL_EXTRACTION != OWNER_DECLARATION
    const id = conversationId();
    const { say } = conversation(id);
    const recorded = await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));
    expect(recorded?.status).toBe("awaiting_approval");
    expect(recorded?.data.provenance).toBe("INFERRED");
    expect(recorded?.data.decidesNothingYet).toBe(true);

    const subject = await subjectOf(id);
    expect((subject!.attributeProvenance as Record<string, string>).location).toBe("INFERRED");
  });

  it("confirming is the moment it becomes the person's own word", async () => {
    const id = conversationId();
    const { say } = conversation(id);
    await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));
    const confirmed = await say(ME, "أوافق", envelope(["commerce:approve"]));
    expect(confirmed?.data.provenance).toBe("STATED");

    const subject = await subjectOf(id);
    expect((subject!.attributeProvenance as Record<string, string>).location).toBe("STATED");
  });

  it("telling JASIM is not telling the world", async () => {
    //   STATING_IS_NOT_PUBLISHING
    const id = conversationId();
    const { say } = conversation(id);
    await say(ME, "كود البوابة 8821", iAm("gateCode", "8821"));
    await say(ME, "أوافق", envelope(["commerce:approve"]));
    const subject = await subjectOf(id);
    expect(subject!.visibility).not.toBe("public");
    expect(JSON.stringify(subject!.publicProjection ?? {})).not.toContain("8821");
  });

  it("nobody states a fact about somebody else's thing", async () => {
    //   OWNER_STATES_ONLY_THEIR_OWN
    const theirs = await createExpression({
      ownerId: OTHER, kind: "need", semanticType: "anything", attributes: {},
    });
    await expect(
      stateOwnAttribute({
        expressionId: theirs.id, ownerId: ME, field: "location", value: ROADSIDE,
      }),
    ).rejects.toThrow();
  });

  it("a value with no field, or a field with no value, records nothing", async () => {
    const id = conversationId();
    const { say } = conversation(id);
    const noField = await say(ME, "أنا هنا", envelope(["self:state"], { value: ROADSIDE }));
    expect(noField?.status).toBe("awaiting_input");
    const noValue = await say(ME, "موقعي", envelope(["self:state"], { field: "location" }));
    expect(noValue?.status).toBe("awaiting_input");
    expect(await subjectOf(id)).toBeNull();
  });

  // ── 2. THE SEARCH NOW STARTS WHERE THE PERSON IS ───────────────────────────

  it("«ابحث» searches from where the person said they are", async () => {
    const id = conversationId();
    const { say } = conversation(id);
    const near = await workshop(NEARBY, "mobile.repair");
    const far = await workshop(DISTANT, "mobile.repair");

    await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));
    await say(ME, "أوافق", envelope(["commerce:approve"]));

    const found = await say(
      ME,
      "ابحث عن mobile.repair",
      envelope(["discovery"], {
        query: "mobile.repair",
        hardConstraints: [{ field: "distance", operator: "max", value: 25, unit: "km" }],
      }),
    );
    const refs = (found?.data.candidates as Array<Record<string, unknown>>).map(
      (candidate) => candidate.canonicalRef,
    );
    expect(refs).toContain(near.id);
    expect(refs).not.toContain(far.id);
  });

  it("an unconfirmed point does not decide who is near", async () => {
    //   INFERRED_LOCATION_DECIDES_PROXIMITY = 0
    const id = conversationId();
    const { say } = conversation(id);
    const near = await workshop(NEARBY, "mobile.repair");

    // Said, and never confirmed.
    await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));

    const found = await say(
      ME,
      "ابحث عن mobile.repair",
      envelope(["discovery"], {
        query: "mobile.repair",
        hardConstraints: [{ field: "distance", operator: "max", value: 25, unit: "km" }],
      }),
    );
    const refs = (found?.data.candidates as Array<Record<string, unknown>>).map(
      (candidate) => candidate.canonicalRef,
    );
    // It would have PASSED. A guess that admits is as wrong as one that excludes.
    expect(refs).not.toContain(near.id);
  });

  it("the search origin comes from the person, never from the envelope", async () => {
    //   MODEL_NAMES_THE_SEARCH_ORIGIN = 0
    const id = conversationId();
    const { say } = conversation(id);
    const near = await workshop(NEARBY, "mobile.repair");

    // The envelope claims a point. Nothing reads it.
    const found = await say(
      ME,
      "ابحث عن mobile.repair",
      envelope(["discovery"], {
        query: "mobile.repair",
        origin: ROADSIDE,
        location: ROADSIDE,
        hardConstraints: [{ field: "distance", operator: "max", value: 25, unit: "km" }],
      }),
    );
    const refs = (found?.data.candidates as Array<Record<string, unknown>>).map(
      (candidate) => candidate.canonicalRef,
    );
    expect(refs).not.toContain(near.id);
  });

  // ── 3. ONE SUBJECT, FROM THE FIRST SENTENCE TO THE LAST ────────────────────

  it("what was said before the search is still there after the agreement", async () => {
    //   ONE_CONVERSATION_ONE_SUBJECT_OF_MINE
    const id = conversationId();
    const { say } = conversation(id);
    await workshop(NEARBY, "mobile.repair");

    await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));
    await say(ME, "أوافق", envelope(["commerce:approve"]));
    const before = await subjectOf(id);

    await say(ME, "ابحث عن mobile.repair", envelope(["discovery"], { query: "mobile.repair" }));
    await say(ME, "خذ الأولى", envelope(["commerce:select"], { position: 1 }));
    await say(ME, "اطلبها", envelope(["commerce:propose"]));

    const after = await subjectOf(id);
    // The SAME expression, still carrying what the person said about themselves.
    expect(after!.id).toBe(before!.id);
    expect((after!.attributes as Record<string, unknown>).location).toEqual(ROADSIDE);
    // And publishing the need did not carry it outward.
    expect(JSON.stringify(after!.publicProjection ?? {})).not.toContain(String(ROADSIDE.lat));
  });

  // ── 4. THE WHOLE STORY, FROM SENTENCES ALONE ───────────────────────────────

  it("stranded, found, agreed, told — every step a sentence", async () => {
    const id = conversationId();
    const { say } = conversation(id);
    await workshop(NEARBY, "mobile.repair");

    await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));
    await say(ME, "أوافق", envelope(["commerce:approve"]));
    await say(
      ME,
      "ابحث عن mobile.repair",
      envelope(["discovery"], {
        query: "mobile.repair",
        hardConstraints: [{ field: "distance", operator: "max", value: 25, unit: "km" }],
      }),
    );
    await say(ME, "خذ الأولى", envelope(["commerce:select"], { position: 1 }));
    await say(ME, "اطلبها", envelope(["commerce:propose"]));

    // The other side's own bounds, set in advance. A classified sentence never
    // carries owner-direct authority.
    const engagement = (
      await handle.db.select().from(referenceBindings)
        .where(eq(referenceBindings.conversationId, id))
    ).find((row) => row.referenceKey === "current:engagement");
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
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));

    const shown = await say(ME, "أرسل له موقعي", envelope(["disclosure"], { field: "location" }));
    expect(shown?.status).toBe("awaiting_approval");
    expect(shown?.data.value).toEqual(ROADSIDE);
    // It says whose word it is about to hand over.
    expect(shown?.data.provenance).toBe("STATED");

    const released = await say(ME, "أوافق", envelope(["commerce:approve"]));
    expect(released?.data.released).toBe(true);

    const subject = await subjectOf(id);
    const read = await disclosure.readDisclosedField(handle.db, {
      recipientOwnerId: SELLER,
      subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
      subjectId: subject!.id,
      field: "location",
    });
    expect(read.status === "RELEASED" && read.value).toEqual(ROADSIDE);
  });

  it("a release of something JASIM only guessed says so, in the sentence itself", async () => {
    const id = conversationId();
    const { say } = conversation(id);
    await workshop(NEARBY, "mobile.repair");
    // Never confirmed.
    await say(ME, "أنا عند الدوار", iAm("location", ROADSIDE));
    await say(ME, "ابحث عن mobile.repair", envelope(["discovery"], { query: "mobile.repair" }));
    await say(ME, "خذ الأولى", envelope(["commerce:select"], { position: 1 }));
    await say(ME, "اطلبها", envelope(["commerce:propose"]));
    const engagement = (
      await handle.db.select().from(referenceBindings)
        .where(eq(referenceBindings.conversationId, id))
    ).find((row) => row.referenceKey === "current:engagement");
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
    await say(SELLER, "أقبل", envelope(["proposal:accept"]));

    const shown = await say(ME, "أرسل له موقعي", envelope(["disclosure"], { field: "location" }));
    expect(shown?.data.provenance).toBe("INFERRED");
    expect(shown?.summary).toContain("كما فهمتُه");
  });

  // ── 5. GENERALITY ──────────────────────────────────────────────────────────

  it("the same turn records anything about anyone's own thing", async () => {
    //   DOMAIN_ATTRIBUTE_TYPES_ADDED = 0
    const facts: Array<[string, unknown]> = [
      ["location", { lat: 31.1, lng: 35.1 }],
      ["gateCode", "8821"],
      ["humidityWindow", "45-50"],
      ["siteAccessNote", "south jetty"],
      ["contactPreference", "voice"],
      ["vesselDraft", 4.2],
    ];
    for (const [field, value] of facts) {
      const id = conversationId();
      const { say } = conversation(id);
      const recorded = await say(ME, "خذ هذا عني", iAm(field, value));
      expect(recorded?.data.field, field).toBe(field);
      const subject = await subjectOf(id);
      expect((subject!.attributes as Record<string, unknown>)[field], field).toEqual(value);
    }
  });

  it("no domain noun entered the attribute writer", () => {
    const source = readFileSync("api/runtime/economic-fabric.ts", "utf8");
    const fn = source.slice(source.indexOf("export async function stateOwnAttribute"));
    const body = fn
      .slice(0, fn.indexOf("\n}\n"))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of ["location", "address", "phone", "gps", "gate", "vehicle", "car"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});
