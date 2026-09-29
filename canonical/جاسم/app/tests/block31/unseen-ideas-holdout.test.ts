/**
 * JASIM — THE HOLDOUT. TEN IDEAS NOBODY BUILT ANYTHING FOR.
 *
 * ─── WHAT THIS FILE IS ──────────────────────────────────────────────────────
 *
 * Not a specification and not a feature. It is the acceptance probe the final
 * vision asks for: a set of requests from domains that share NOTHING with each
 * other or with anything this runtime was developed against — a radio
 * telescope, a Syriac manuscript, forty beehives, a racing pigeon loft, a
 * licensed blaster, a sand assay, an eighty-tonne crane, a bronze bell, a
 * dark-sky site, a diving bell inspection.
 *
 * None of them was used while building any primitive here. If JASIM needed one
 * branch, one handler, one noun or one new core line to carry any of them, the
 * generality claim is false and this file is where it fails.
 *
 *   UNKNOWN DOMAIN + UNSEEN NEED + REAL PRIMITIVES = NO NEW CORE CODE
 *
 * ─── HOW IT IS BUILT, AND WHY THAT MATTERS ──────────────────────────────────
 *
 * ONE prover. The table below is strings and numbers. If the prover ever grows
 * an `if` that asks WHICH row it is looking at, that is the failure — and a
 * test at the bottom reads this file's own source to make sure it never does.
 *
 *   DOMAIN_BRANCHES_IN_THE_PROVER = 0
 *
 * ─── WHAT IT DELIBERATELY DOES NOT CLAIM ────────────────────────────────────
 *
 * Every step below is offline: no provider is connected and no model is called.
 * So this proves that the SHAPE of each request is expressible and that the
 * chain carries it — not that a real telescope was booked. What a provider
 * would add is the observation at the end, never a branch in the middle.
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
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let brokering: typeof import("../../api/runtime/cross-party-brokering");
let disclosure: typeof import("../../api/runtime/private-disclosure");
let setNegotiationEnvelope: typeof import("../../api/runtime/agreement-runtime").setNegotiationEnvelope;

const ASKER = "holdout-asker";
const HOLDER = "holdout-holder";

/** Where the asking side is, for every row. One point, no meaning. */
const HERE = { lat: 31.9539, lng: 35.9106 };
const NEAR = { lat: 31.98, lng: 35.94 };    // ~4 km
const FAR = { lat: 32.5556, lng: 35.85 };   // ~68 km

/**
 * TEN IDEAS. Every one of them is DATA.
 *
 * `measure` is what the asker requires of a candidate — including its
 * DIRECTION, because «at least this much capacity» and «no longer than this
 * many days» are both requirements and the difference between them is part of
 * what was asked, not something a runtime may guess. `fact` is what is true of
 * the asker; `ask` is the detail only the other party can answer; `release` is
 * the fact the other party needs once they have agreed to do it.
 */
const IDEAS = [
  {
    idea: "six hours of observing time on a radio telescope next month",
    semanticType: "radio.telescope.time",
    measure: { operator: "gte", field: "dishDiameter", value: 25, unit: "m", offered: 32000, offeredUnit: "mm" },
    fact: { field: "targetCoordinates", value: "RA 05h34m J2000" },
    ask: "backendBandwidth",
    release: "targetCoordinates",
  },
  {
    idea: "somebody to read a twelfth-century Syriac manuscript",
    semanticType: "manuscript.reading",
    measure: { operator: "max", field: "turnaround", value: 30, unit: "day", offered: 3, offeredUnit: "week" },
    fact: { field: "manuscriptFolioRange", value: "ff. 12r–41v" },
    ask: "scriptFamiliarity",
    release: "manuscriptFolioRange",
  },
  {
    idea: "moving forty beehives into an orchard during bloom",
    semanticType: "hive.transport",
    measure: { operator: "gte", field: "hiveCapacity", value: 40, unit: "count", offered: 60, offeredUnit: "count" },
    fact: { field: "orchardGate", value: "the lower track, second gate" },
    ask: "nightLoading",
    release: "orchardGate",
  },
  {
    idea: "custody of a racing pigeon loft for three weeks",
    semanticType: "loft.custody",
    measure: { operator: "max", field: "custodyWindow", value: 21, unit: "day", offered: 2, offeredUnit: "week" },
    fact: { field: "feedSchedule", value: "05:30 and 17:00" },
    ask: "ringReadingExperience",
    release: "feedSchedule",
  },
  {
    idea: "a licensed blaster to take down a rock outcrop",
    semanticType: "controlled.blasting",
    measure: { operator: "gte", field: "chargeMass", value: 120, unit: "kg", offered: 250000, offeredUnit: "g" },
    fact: { field: "nearestDwelling", value: "180 m uphill" },
    ask: "licenceClass",
    release: "nearestDwelling",
  },
  {
    idea: "testing sand for silica content",
    semanticType: "mineral.assay",
    measure: { operator: "gte", field: "sampleMass", value: 5, unit: "kg", offered: 12000, offeredUnit: "g" },
    fact: { field: "pitReference", value: "north face, bench 3" },
    ask: "methodStandard",
    release: "pitReference",
  },
  {
    idea: "a mobile crane lifting eighty tonnes at twelve metres",
    semanticType: "crane.hire",
    measure: { operator: "gte", field: "liftCapacity", value: 80, unit: "tonne", offered: 120000, offeredUnit: "kg" },
    fact: { field: "yardEntrance", value: "west ramp, 4.1 m clearance" },
    ask: "outriggerFootprint",
    release: "yardEntrance",
  },
  {
    idea: "casting a bronze bell of three hundred kilograms",
    semanticType: "bell.casting",
    measure: { operator: "gte", field: "castMass", value: 300, unit: "kg", offered: 500, offeredUnit: "kg" },
    fact: { field: "towerOpening", value: "1.2 m square" },
    ask: "tuningMethod",
    release: "towerOpening",
  },
  {
    idea: "a dark-sky site for astrophotography",
    semanticType: "darksky.site",
    measure: { operator: "gte", field: "skyBrightness", value: 21, unit: "count", offered: 22, offeredUnit: "count" },
    fact: { field: "vehicleAccessNote", value: "high clearance only after rain" },
    ask: "horizonObstruction",
    release: "vehicleAccessNote",
  },
  {
    idea: "inspecting a diving bell before certification",
    semanticType: "divingbell.inspection",
    measure: { operator: "gte", field: "ratedDepth", value: 300, unit: "m", offered: 45000, offeredUnit: "cm" },
    fact: { field: "quaysideBerth", value: "berth 7, tidal" },
    ask: "classSocietyApproval",
    release: "quaysideBerth",
  },
] as const;

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

type Idea = (typeof IDEAS)[number];

/**
 * THE PROVER. It reads the row and knows nothing else about it.
 *
 * Nine steps, each one an ordinary sentence, each one going through a
 * primitive that existed before any of these ideas did.
 */
async function carry(idea: Idea) {
  const conversationId = `holdout-${randomUUID()}`;
  const say = (ownerId: string, content: string, env: Envelope) =>
    orchestrate({
      db: handle.db,
      worlds,
      ownerId,
      conversationId,
      content,
      approvalRef: `message-${randomUUID()}`,
      envelope: env,
    });

  // Somebody who can do it — and somebody who could, but is too far.
  const able = await publishOffering(idea, NEAR, idea.measure.offered);
  const distant = await publishOffering(idea, FAR, idea.measure.offered);
  // And somebody near who cannot meet the measure.
  // Near enough, and on the WRONG SIDE of the bound — whichever side that is.
  const short = await publishOffering(
    idea,
    NEAR,
    idea.measure.operator === "gte" ? idea.measure.value - 1 : idea.measure.value + 1,
    idea.measure.unit,
  );

  // 1 — something true of ME.
  await say(ASKER, "…", envelope(["self:state"], { field: idea.fact.field, value: idea.fact.value }));
  await say(ASKER, "أوافق", envelope(["commerce:approve"]));
  // 2 — and where I am.
  await say(ASKER, "…", envelope(["self:state"], { field: "location", value: HERE }));
  await say(ASKER, "أوافق", envelope(["commerce:approve"]));

  // 3 — search: a measure AND a proximity, both bounds on quantities.
  const found = await say(
    ASKER,
    `ابحث عن ${idea.semanticType}`,
    envelope(["discovery"], {
      query: idea.semanticType,
      hardConstraints: [
        {
          field: idea.measure.field,
          operator: idea.measure.operator,
          value: idea.measure.value,
          unit: idea.measure.unit,
        },
        { field: "distance", operator: "max", value: 25, unit: "km" },
      ],
    }),
  );
  const refs = (found?.data.candidates as Array<Record<string, unknown>>).map(
    (candidate) => candidate.canonicalRef,
  );

  // 4 — pick it, 5 — request it.
  await say(ASKER, "خذ الأولى", envelope(["commerce:select"], { position: 1 }));
  await say(ASKER, "اطلبها", envelope(["commerce:propose"]));

  // 6 — ask the other party the one thing only they can answer.
  const asked = await say(ASKER, "اسأله", envelope(["counterparty:ask"], { property: idea.ask }));
  const pending = await brokering.pendingQuestionsFor({ ownerId: HOLDER });
  if (pending.length === 1) {
    await brokering.answerQuestion({
      questionId: pending[0]!.questionId,
      answeringOwnerId: HOLDER,
      value: "yes",
    });
  }
  const heard = await say(ASKER, "ماذا رد؟", envelope(["counterparty:answers"]));

  // 7 — the other party accepts, inside bounds they set in advance.
  const engagement = (
    await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversationId))
  ).find((row) => row.referenceKey === "current:engagement");
  if (engagement) {
    await setNegotiationEnvelope({
      engagementId: engagement.targetId,
      ownerId: HOLDER,
      principalId: HOLDER,
      bounds: {
        settlement: { direction: "HIGHER_IS_BETTER", target: 5000, reserve: 4000 },
        provision: { direction: "LOWER_IS_BETTER", target: 1, reserve: 2 },
      },
      mayAcceptWithinReserve: true,
    });
  }
  const accepted = await say(HOLDER, "أقبل", envelope(["proposal:accept"]));

  // 8 — release the one private thing they now need, 9 — confirm it.
  const shown = await say(ASKER, "أرسل له", envelope(["disclosure"], { field: idea.release }));
  const released = await say(ASKER, "أوافق", envelope(["commerce:approve"]));

  const subjectBinding = (
    await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversationId))
  ).find((row) => row.referenceKey === "current:need" && row.ownerId === ASKER);
  const read = subjectBinding
    ? await disclosure.readDisclosedField(handle.db, {
        recipientOwnerId: HOLDER,
        subjectKind: disclosure.DISCLOSABLE_SUBJECT_KIND,
        subjectId: subjectBinding.targetId,
        field: idea.release,
      })
    : { status: "NOT_DISCLOSED" as const };

  return { refs, able, distant, short, asked, heard, accepted, shown, released, read };
}

async function publishOffering(
  idea: Idea,
  at: { lat: number; lng: number },
  amount: number,
  unit?: string,
) {
  const expression = await createExpression({
    ownerId: HOLDER,
    kind: "offering",
    semanticType: idea.semanticType,
    attributes: {
      location: at,
      [idea.measure.field]: amount,
      [`${idea.measure.field}Unit`]: unit ?? idea.measure.offeredUnit,
      priceMinor: "5000",
      currency: "SAR",
    },
  });
  return publishExpression({
    id: expression.id,
    ownerId: HOLDER,
    projection: {
      semanticType: idea.semanticType,
      summary: idea.semanticType,
      publicTerms: { money: { amountMinor: "5000", currency: "SAR" } },
    },
  });
}

describe("ten ideas nobody built anything for", () => {
  for (const idea of IDEAS) {
    it(`${idea.idea}`, async () => {
      const out = await carry(idea);

      // FOUND — and the two that should not be.
      expect(out.refs, "the one that can, nearby").toContain(out.able.id);
      expect(out.refs, "same capability, too far").not.toContain(out.distant.id);
      expect(out.refs, "near enough, not big enough").not.toContain(out.short.id);

      // ASKED — and the answer is evidence, never an attribute of the thing.
      expect(out.asked?.data.answerIsEvidenceNotFact).toBe(true);
      expect(out.heard?.data.answers).toMatchObject([
        { property: idea.ask, answer: "yes", stale: false },
      ]);

      // AGREED — and it says what it is not.
      expect(out.accepted?.data.agreementId).toBeTruthy();
      expect(out.accepted?.data.paid).toBe(false);
      expect(out.accepted?.data.fulfilled).toBe(false);

      // RELEASED — shown first, to one person, nothing published.
      expect(out.shown?.status).toBe("awaiting_approval");
      expect(out.shown?.data.value).toBe(idea.fact.value);
      expect(out.released?.data.released).toBe(true);
      expect(out.released?.data.published).toBe(false);
      expect(out.read.status).toBe("RELEASED");
      expect(out.read.status === "RELEASED" && out.read.value).toBe(idea.fact.value);
    });
  }

  it("the units were reconciled, not compared as bare numbers", async () => {
    // Every row states its requirement in one scale and the offering holds it
    // in another: millimetres against metres, weeks against days, grams
    // against kilograms, centimetres against metres. A runtime comparing raw
    // numbers would have matched almost none of them — and would have matched
    // some of the wrong ones.
    const scales = IDEAS.filter((idea) => idea.measure.unit !== idea.measure.offeredUnit);
    expect(scales.length).toBeGreaterThanOrEqual(6);
  });

  it("the prover never asks which idea it is holding", () => {
    //   DOMAIN_BRANCHES_IN_THE_PROVER = 0
    //
    // The whole claim rests on this. If the chain needed to know that a
    // telescope is not a beehive, the table would be a disguised switch.
    const source = readFileSync("tests/block31/unseen-ideas-holdout.test.ts", "utf8");
    const prover = source.slice(source.indexOf("async function carry("));
    const body = prover
      .slice(0, prover.indexOf("\nasync function publishOffering"))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(body).not.toMatch(/idea\.semanticType\s*===/);
    expect(body).not.toMatch(/switch\s*\(/);
    for (const word of ["telescope", "manuscript", "hive", "pigeon", "blast",
      "sand", "crane", "bell", "sky", "diving"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}`, "i"));
    }
  });

  it("no core file learned any of these words, and none branches on a kind", () => {
    //   NEW DOMAIN != NEW AGENT · UNKNOWN IDEA != UNSUPPORTED DOMAIN
    //
    // ── AN EXPECTATION OF MINE THAT WAS RIGHT, AND TOO BROAD ───────────────
    //
    // OLD_EXPECTATION: none of the ten nouns appears ANYWHERE in a core file,
    //   comments included.
    // WHY_IT_IS_WRONG: it fired on a COMMENT. The joint-satisfiability phase
    //   explains its law by naming the example that revealed it — «a crane
    //   reaching 35 m that lifts 8 t there» — which is exactly how every law
    //   in this runtime is documented, and is not logic. Meanwhile the rule it
    //   stands for is about CODE: an example must never become a branch.
    // NEW_EXPECTATION: the words are checked against the code with comments
    //   stripped, AND no core file may decide anything by WHICH KIND a thing
    //   is — no `semanticType` compared to a string literal, no
    //   `.includes("…")`/`.startsWith("…")` on one, no `switch` over one.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the old assertion could be passed
    //   by a branch this list happens not to name — `if (semanticType ===
    //   "lift.service")` contains none of the ten words. The new one fails
    //   that branch whatever it is called, which is the rule the word list was
    //   only ever approximating.
    //
    // ── AND WHY IT SAYS «LITERAL» AND NOT «=== AT ALL» ─────────────────────
    //
    // Two shapes compare a semanticType and encode no domain, and a rule that
    // banned them would be a rule this runtime would have to break:
    //
    //   typeof projection.semanticType === "string"   a shape guard
    //   row.semanticType !== semanticType             «did the type change»
    //
    // Neither can say WHICH kind: the first asks whether a value is a string,
    // the second compares two values that both arrive at runtime and treats
    // every kind identically. What no core file may ever do is name one. So
    // the typeof guard is stripped, and what remains must never meet a quoted
    // literal — which is exactly the failure this rule exists to catch, and
    // catches under any naming.
    const core = [
      "api/runtime/block31/conversation-orchestrator.ts",
      "api/runtime/block31/discovery.ts",
      "api/runtime/economic-fabric.ts",
      "api/runtime/private-disclosure.ts",
      "api/runtime/cross-party-brokering.ts",
      "api/runtime/goal-spec.ts",
      "api/runtime/semantic-fabric.ts",
    ];
    for (const path of core) {
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      for (const word of ["telescope", "manuscript", "beehive", "pigeon", "blaster",
        "silica", "crane", "bell", "darksky", "divingbell", "assay", "loft"]) {
        expect(code, `${path} names ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
      }
      // The rule the list approximates: nothing decides by WHAT KIND of thing.
      const decisions = code.replace(/typeof\s+[\w.?\[\]"']*semanticType\s*===\s*"string"/g, " ");
      expect(decisions, `${path} compares a semanticType to a literal`).not.toMatch(
        /semanticType\s*(===|!==|==|!=)\s*["'`]/,
      );
      expect(decisions, `${path} tests a semanticType against a literal`).not.toMatch(
        /semanticType\s*\??\.(includes|startsWith|endsWith|match)\(\s*[/"'`]/,
      );
      expect(decisions, `${path} switches on a semanticType`).not.toMatch(
        /switch\s*\([^)]*semanticType/,
      );
    }
  });
});
