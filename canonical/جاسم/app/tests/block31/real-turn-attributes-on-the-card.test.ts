/**
 * JASIM — A REAL TURN CARRIES A DECLARED PROPERTY TO THE CARD.
 *
 * ─── WHY NOT A UNIT TEST ────────────────────────────────────────────────────
 *
 * `projectCandidateForSurface({attributes})` returning property rows proves the
 * BRIDGE and nothing about the CHAIN. What was broken was the chain: the bag
 * existed on the row, the bridge already passed it on, the card already had a
 * `<dl>` for it — and `safeCandidate` dropped it in between. So nothing here is
 * injected: no `currentPresentation` handed in, no `metadata.presentation`
 * seeded, no candidate invented. An owner publishes, a person asks, and the
 * properties are read back from the projection the interface itself queries.
 *
 *   PRESENTATION = READ-ONLY PROJECTION OF AUTHORIZED CANONICAL STATE
 *
 * ─── AND WHAT THE TRACE FOUND ON THE WAY ────────────────────────────────────
 *
 *   MATCHED_ON != PUBLISHED
 *
 * Discovery FILTERS on `economicExpressions.attributes` — the owner's PRIVATE
 * declared facts — while the candidate row carries the AUTHORIZED PUBLIC
 * PROJECTION under the same word. A candidate is therefore selected on facts
 * its card must not show, and this proves the private bag stays private even
 * when it is the very thing that found the candidate.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");

let SEEKER = "";
let HOLDER = "";

/**
 * UNFAMILIAR BY CONSTRUCTION — three kinds of thing with no word in common and
 * no word in the runtime. Declared the way the fabric already declares a
 * measurement: a scalar plus the sibling `<field>Unit` its own constraint
 * evaluator reads.
 */
const HOLDOUTS = [
  {
    kind: "seabed.survey.instrument",
    publicTerms: { ratedDepth: 450, ratedDepthUnit: "m", mass: 19, massUnit: "kg" },
    expect: { ratedDepth: "450 m", mass: "19 kg" },
  },
  {
    kind: "acoustic.isolation.chamber",
    publicTerms: { attenuation: 65, attenuationUnit: "dB", internalVolume: 12, internalVolumeUnit: "m3" },
    expect: { attenuation: "65 dB", internalVolume: "12 m3" },
  },
  {
    kind: "temporary.interpreter.capacity",
    publicTerms: { language: "Mandarin", duration: 2, durationUnit: "h" },
    expect: { language: "Mandarin", duration: "2 h" },
  },
] as const;

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  const rows = await handle.db.insert(users).values([
    { unionId: `seek-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
  ] as never).returning();
  SEEKER = String(rows[0]!.id);
  HOLDER = String(rows[1]!.id);
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
    economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
    reference_bindings, messages, conversations, events CASCADE`));
});

/**
 * An owner publishes. `private` is the owner's own declared fact that
 * `publishExpression` can never carry — it is not a `PUBLIC_PROJECTION_KEYS`
 * entry, so it is structurally unable to reach a projection.
 */
async function publish(input: {
  kind: string;
  count: number;
  publicTerms?: Record<string, unknown>;
  privateAttributes?: Record<string, unknown>;
}) {
  for (let index = 0; index < input.count; index += 1) {
    const expression = await fabric.createExpression({
      ownerId: HOLDER,
      kind: "offering",
      semanticType: input.kind,
      attributes: { quantity: 10 + index, ...(input.privateAttributes ?? {}) },
    });
    await fabric.publishExpression({
      id: expression.id,
      ownerId: HOLDER,
      projection: {
        semanticType: input.kind,
        summary: `عنصر ${index + 1}`,
        ...(input.publicTerms ? { publicTerms: input.publicTerms } : {}),
      },
    });
  }
}

/** The production envelope path: writes the message AND `metadata.presentation`. */
async function cardsFromARealTurn(kind: string, over: Record<string, unknown> = {}) {
  const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "بحث" });
  const routed = await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId: SEEKER,
    conversationId: conversation.id,
    content: `ابحث عن ${kind}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8, ...over },
  } as never);
  expect(routed).not.toBeNull();
  // The SAME call the interface makes. No presentation handed in, none seeded.
  const projected = await projection.getActiveWorkspaceProjection({
    ownerId: SEEKER, conversationId: conversation.id,
  });
  expect(projected.currentPresentation).not.toBeNull();
  return {
    primitive: projected.currentPresentation!.primitive,
    cards: (projected.currentPresentation!.data as { candidates: Record<string, unknown>[] }).candidates,
  };
}

describe("a real turn carries a declared property to the card", () => {
  it("every unfamiliar kind reaches the grid with its own declared properties", async () => {
    for (const holdout of HOLDOUTS) {
      await resetBlock31(handle.db);
      await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, discovery_result_sets,
        discovery_candidates, reference_bindings, messages, conversations, events CASCADE`));
      await publish({ kind: holdout.kind, count: 6, publicTerms: holdout.publicTerms });

      const { primitive, cards } = await cardsFromARealTurn(holdout.kind);
      expect(primitive, holdout.kind).toBe("ENTITY_GRID");
      expect(cards, holdout.kind).toHaveLength(6);
      for (const card of cards) {
        expect(card.attributes, holdout.kind).toEqual(holdout.expect);
        // Still a canonical identity, and still no picture invented.
        expect(typeof card.ref, holdout.kind).toBe("string");
        expect(card.image, holdout.kind).toBeUndefined();
      }
    }
  });

  it("the private fact the search MATCHED on never reaches the card", async () => {
    //   MATCHED_ON != PUBLISHED
    //
    // `quantity` is a private declared attribute: it is what discovery filters
    // on, and it is not a `PUBLIC_PROJECTION_KEYS` entry. Releasing a private
    // field to a counterparty is a separate authorized act with its own module;
    // it is never a side effect of appearing in a list.
    await publish({
      kind: "archival.cold.storage",
      count: 6,
      publicTerms: { capacity: 48, capacityUnit: "m3" },
      privateAttributes: { internalCostMinor: "900000", supplierNote: "سرّي" },
    });
    const { cards } = await cardsFromARealTurn("archival.cold.storage");
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card.attributes).toEqual({ capacity: "48 m3" });
      const serialized = JSON.stringify(card);
      expect(serialized).not.toContain("quantity");
      expect(serialized).not.toContain("900000");
      expect(serialized).not.toContain("سرّي");
    }
  });

  it("a thing whose owner published no terms gets no property block", async () => {
    //   ABSENT_ATTRIBUTE_INVENTED = 0 · UNKNOWN != EMPTY
    await publish({ kind: "industrial.drying.capacity", count: 6 });
    const { cards } = await cardsFromARealTurn("industrial.drying.capacity");
    expect(cards).toHaveLength(6);
    for (const card of cards) expect(card.attributes).toBeUndefined();
  });

  it("the smaller surface carries the same properties as the grid", async () => {
    await publish({
      kind: "seabed.survey.instrument",
      count: 3,
      publicTerms: { ratedDepth: 450, ratedDepthUnit: "m" },
    });
    const { primitive, cards } = await cardsFromARealTurn("seabed.survey.instrument");
    expect(primitive).toBe("SEARCH_RESULTS");
    expect(cards).toHaveLength(3);
    for (const card of cards) expect(card.attributes).toEqual({ ratedDepth: "450 m" });
  });

  it("an untrusted candidate's attributes never render as properties of the thing", async () => {
    //
    //   MODEL != ATTRIBUTE AUTHORITY
    //
    // `webResults` arrive in the MODEL'S OWN ENVELOPE — this is the production
    // reader, not a test hook. So an external candidate's bag is a model's prose
    // wearing a shape, and its trust already says so. The attributes below are
    // exactly what a model would invent, and the card must show none of them.
    const { cards } = await cardsFromARealTurn("acoustic.isolation.chamber", {
      intent: {
        inputs: {
          webResults: [
            {
              url: "https://example.com/a",
              title: "عنصر خارجي",
              snippet: "ملاحظة",
              attributes: { attenuation: 99, inventedByTheModel: "نعم" },
            },
          ],
        },
      },
    });
    const external = cards.filter((card) => card.source === "WEB_OBSERVATION");
    expect(external.length).toBeGreaterThan(0);
    for (const card of external) {
      expect(card.attributes).toBeUndefined();
      const serialized = JSON.stringify(card);
      expect(serialized).not.toContain("inventedByTheModel");
      expect(serialized).not.toContain("99");
    }
  });
});
