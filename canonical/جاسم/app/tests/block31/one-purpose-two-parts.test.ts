/**
 * JASIM — ONE PURPOSE THAT NEEDS TWO DIFFERENT THINGS, AND ONE OF THEM FAILS.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * Composition existed, and it could do exactly one thing: SPLIT ONE QUANTITY
 * across several offerings of the same sort — five hundred tonnes of storage
 * over three warehouses, summed, when the need said `splitAllowed`.
 *
 * A purpose needing two DIFFERENT things sums nothing. Traced on the live path,
 * such a need produced
 *
 *     matches.length === 0   ·   no composite   ·   nothing said
 *
 * «لم أجد شيئًا» — while both things existed, were published and were
 * available. The runtime was not wrong about any single offering. It could not
 * be asked the question.
 *
 *   PARTIAL_COVERAGE_IS_NOT_A_MATCH — and it is not silence either.
 *
 * ─── AND THE HALF NOBODY WANTS TO THINK ABOUT ───────────────────────────────
 *
 *   PART_SUCCEEDED != PURPOSE_ACHIEVED
 *   ANOTHER_PARTY_FAILED != YOUR_AGREEMENT_IS_VOID
 *   RUNTIME_RELEASES_NOTHING
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let composition: typeof import("../../api/runtime/component-composition");

const HAULER = "purpose-hauler";
const LIFTER = "purpose-lifter";
const BOTH_IN_ONE = "purpose-both";
const OWNER = "purpose-owner";

/**
 * Two parts of one purpose. The strings are the OWNER'S, and the runtime reads
 * none of them — which is why they can be anything at all.
 */
const HAUL = "move.load.roadway";
const LIFT = "raise.load.onsite";

beforeAll(async () => {
  handle = await getTestDb();
  fabric = await import("../../api/runtime/economic-fabric");
  composition = await import("../../api/runtime/component-composition");
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  // The shared reset clears the run tables only. Coverage is decided by which
  // offerings EXIST, so a leftover from another test would decide this one.
  await handle.db.execute(
    sql.raw(`TRUNCATE TABLE economic_matches, economic_engagements,
      economic_proposals, economic_expressions CASCADE`),
  );
});

describe("one purpose, two different parts", () => {
  async function offering(input: {
    ownerId: string;
    semanticType: string;
    attributes?: Record<string, unknown>;
    provenance?: Record<string, "STATED" | "INFERRED" | "OBSERVED">;
  }) {
    const expression = await fabric.createExpression({
      ownerId: input.ownerId,
      kind: "offering",
      semanticType: input.semanticType,
      attributes: input.attributes ?? {},
      ...(input.provenance ? { attributeProvenance: input.provenance } : {}),
    });
    return fabric.publishExpression({
      id: expression.id,
      ownerId: input.ownerId,
      projection: { semanticType: input.semanticType, summary: input.semanticType },
    });
  }

  /** A need whose owner declared what it is made of. */
  async function need(components: unknown, over: Record<string, unknown> = {}) {
    return fabric.createExpression({
      ownerId: OWNER,
      kind: "need",
      semanticType: "deliver.this.consignment",
      attributes: { requiredComponents: components, ...over },
      hardConstraints: [],
    });
  }

  const TWO_PARTS = [
    { key: "haul", semantics: HAUL, constraints: [{ field: "capacity", operator: "gte", value: 9, unit: "tonne" }] },
    { key: "lift", semantics: LIFT, constraints: [{ field: "reach", operator: "gte", value: 12, unit: "m" }] },
  ];

  const match = (needId: string) => fabric.matchNeed({ needId, requesterOwnerId: OWNER });

  // ── 1. THE OLD ANSWER, AND THE NEW ONE ─────────────────────────────────────

  it("a need that declares nothing behaves exactly as it always did", async () => {
    // The whole point of a declared set: nothing is assumed for anybody else.
    const plain = await fabric.createExpression({
      ownerId: OWNER,
      kind: "need",
      semanticType: HAUL,
      attributes: {},
      hardConstraints: [{ field: "capacity", operator: "gte", value: 9, unit: "tonne" }],
    });
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" } });
    const result = await match(plain.id);
    expect(result.matches).toHaveLength(1);
    expect(result.coverage).toBeUndefined();
    expect(result.composite).toBeUndefined();
  });

  it("with only one part available, the uncovered part is NAMED, not silence", async () => {
    //   PARTIAL_COVERAGE_IS_NOT_A_MATCH
    const purpose = await need(TWO_PARTS);
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" } });

    const result = await match(purpose.id);
    // No match, as before — but now the runtime can say WHICH half it is missing.
    expect(result.matches).toHaveLength(0);
    expect(result.composite).toBeUndefined();
    expect(result.coverage!.viable).toBe(false);
    expect(result.coverage!.uncovered).toEqual(["lift"]);
    // And it knows the half it DID cover, and who offers it.
    const haul = result.coverage!.components.find((c) => c.key === "haul")!;
    expect(haul.covered).toBe(true);
    expect(haul.candidates[0]!.ownerId).toBe(HAULER);
  });

  it("with both parts available, one composite covers the whole purpose", async () => {
    const purpose = await need(TWO_PARTS);
    const haulOffer = await offering({
      ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" },
    });
    const liftOffer = await offering({
      ownerId: LIFTER, semanticType: LIFT, attributes: { reach: 18, reachUnit: "m" },
    });

    const result = await match(purpose.id);
    expect(result.coverage!.viable).toBe(true);
    expect(result.coverage!.uncovered).toEqual([]);
    expect(result.composite).toBeDefined();
    expect(result.composite!.offeringId).toBeNull();
    const parts = result.composite!.compositeComponents!;
    expect(parts.map((p) => p.expressionId).sort()).toEqual([haulOffer.id, liftOffer.id].sort());
    expect(parts.map((p) => (p.contribution as Record<string, unknown>).componentKey).sort())
      .toEqual(["haul", "lift"]);
  });

  it("and the two parties on it are both named, so either can be reached", async () => {
    const purpose = await need(TWO_PARTS);
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" } });
    await offering({ ownerId: LIFTER, semanticType: LIFT, attributes: { reach: 18, reachUnit: "m" } });

    const result = await match(purpose.id);
    const parties = await fabric.participantsForMatch(result.composite!.id);
    expect(parties.sort()).toEqual([HAULER, LIFTER, OWNER].sort());
  });

  // ── 2. A PART IS A REQUIREMENT, JUDGED LIKE ANY OTHER ──────────────────────

  it("a part whose candidate fails its own bound is not covered", async () => {
    const purpose = await need(TWO_PARTS);
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" } });
    // Reaches 6 m where 12 is required. Present, published, and not enough.
    await offering({ ownerId: LIFTER, semanticType: LIFT, attributes: { reach: 6, reachUnit: "m" } });

    const result = await match(purpose.id);
    expect(result.coverage!.uncovered).toEqual(["lift"]);
  });

  it("a part is reconciled across scales like everything else", async () => {
    //   UNIT_DROPPED_IN_TRANSLATION = 0
    const purpose = await need(TWO_PARTS);
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20000, capacityUnit: "kg" } });
    await offering({ ownerId: LIFTER, semanticType: LIFT, attributes: { reach: 1800, reachUnit: "cm" } });
    const result = await match(purpose.id);
    expect(result.coverage!.viable).toBe(true);
  });

  it("a part inherits joint satisfiability without restating it", async () => {
    //   INDEPENDENT_CONSTRAINTS_SATISFIED != JOINTLY_SATISFIABLE — the law from
    //   the phase before this one, reaching a component for free.
    const purpose = await need([
      TWO_PARTS[0],
      {
        key: "lift",
        semantics: LIFT,
        constraints: [
          { field: "reach", operator: "gte", value: 32, unit: "m" },
          { field: "capacity", operator: "gte", value: 11, unit: "tonne" },
        ],
      },
    ]);
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" } });
    await offering({
      ownerId: LIFTER,
      semanticType: LIFT,
      attributes: {
        reach: 35, reachUnit: "m", capacity: 20, capacityUnit: "tonne",
        capabilityPoints: [
          { reach: 20, reachUnit: "m", capacity: 20, capacityUnit: "tonne" },
          { reach: 35, reachUnit: "m", capacity: 8, capacityUnit: "tonne" },
        ],
      },
    });
    const result = await match(purpose.id);
    // Both bounds hold, in no single configuration it declared.
    expect(result.coverage!.uncovered).toEqual(["lift"]);
  });

  it("one thing may cover both parts", async () => {
    //   ONE_OFFERING_MAY_COVER_TWO_COMPONENTS — refusing this would be a rule
    //   about vehicles, and this runtime has no rules about vehicles.
    const purpose = await need(TWO_PARTS);
    await offering({
      ownerId: BOTH_IN_ONE,
      semanticType: HAUL,
      attributes: {
        capacity: 20, capacityUnit: "tonne", reach: 18, reachUnit: "m",
        // The declaration that says «I also serve that» — already in the fabric.
        servesSemantics: [LIFT],
      },
    });
    const result = await match(purpose.id);
    expect(result.coverage!.viable).toBe(true);
    const parts = result.composite!.compositeComponents!;
    expect(new Set(parts.map((p) => p.expressionId)).size).toBe(1);
  });

  it("every candidate a part has travels with the composite", async () => {
    // Choosing is the owner's. The row records a candidate, not a decision.
    const purpose = await need(TWO_PARTS);
    await offering({ ownerId: HAULER, semanticType: HAUL, attributes: { capacity: 20, capacityUnit: "tonne" } });
    await offering({ ownerId: "purpose-hauler-2", semanticType: HAUL, attributes: { capacity: 40, capacityUnit: "tonne" } });
    await offering({ ownerId: LIFTER, semanticType: LIFT, attributes: { reach: 18, reachUnit: "m" } });

    const result = await match(purpose.id);
    const haul = result.composite!.compositeComponents!
      .find((p) => (p.contribution as Record<string, unknown>).componentKey === "haul")!;
    expect((haul.contribution as { alternatives: string[] }).alternatives).toHaveLength(2);
  });

  // ── 3. WHO MAY SAY WHAT A PURPOSE IS MADE OF ───────────────────────────────

  it("a component set nothing can read is refused, not shrugged off", async () => {
    //   UNREADABLE_COMPONENTS != NO_COMPONENTS — reading an unreadable set as
    //   «no parts declared» would match a two-part need on half the truth,
    //   which is the worst answer available here.
    for (const broken of [
      "haul and lift",
      [],
      [{ semantics: HAUL }],
      [{ key: "haul" }],
      [{ key: "haul", semantics: HAUL }, { key: "haul", semantics: LIFT }],
      [{ key: "haul", semantics: HAUL, constraints: "capacity >= 9" }],
      [{ key: "haul", semantics: HAUL, constraints: [{ operator: "gte", value: 9 }] }],
      [{ key: "haul", semantics: HAUL, constraints: [{ field: "capacity", value: 9 }] }],
      [{ key: "haul", semantics: HAUL, constraints: [{ field: "capacity", operator: "gte" }] }],
    ]) {
      const purpose = await need(broken);
      await expect(match(purpose.id), JSON.stringify(broken)).rejects.toThrow(
        composition.CompositionError,
      );
    }
  });

  it("nothing may claim a purpose is released", async () => {
    for (const key of ["released", "void", "cancelled", "discharged", "waived", "purposeState"]) {
      expect(() => composition.assertNoPurposeAuthorityClaim({ [key]: true }), key).toThrow();
    }
    expect(() => composition.assertNoPurposeAuthorityClaim({ notes: "fine" })).not.toThrow();
  });

  // ── 4. ONE PART FAILS ──────────────────────────────────────────────────────

  const standing = (key: string, outcome: "PENDING" | "VERIFIED" | "FAILED", who: string) => ({
    key, outcome, counterpartyOwnerId: who,
  });

  it("every part done is the only thing that achieves the purpose", () => {
    const verdict = composition.purposeVerdict({
      standings: [standing("haul", "VERIFIED", HAULER), standing("lift", "VERIFIED", LIFTER)],
    });
    expect(verdict.purpose).toBe("ACHIEVED");
    expect(verdict.awaitingOwnerDecision).toEqual([]);
  });

  it("one part done and one failed is PARTIAL — never achieved, never merely failed", () => {
    //   PART_SUCCEEDED != PURPOSE_ACHIEVED
    const verdict = composition.purposeVerdict({
      standings: [standing("haul", "VERIFIED", HAULER), standing("lift", "FAILED", LIFTER)],
    });
    expect(verdict.purpose).toBe("PARTIAL");
    expect(verdict.failed.map((f) => f.key)).toEqual(["lift"]);
  });

  it("the party who did nothing wrong keeps their agreement", () => {
    //   ANOTHER_PARTY_FAILED != YOUR_AGREEMENT_IS_VOID
    const verdict = composition.purposeVerdict({
      standings: [standing("haul", "VERIFIED", HAULER), standing("lift", "FAILED", LIFTER)],
    });
    expect(verdict.standing.map((s) => s.key)).toEqual(["haul"]);
    expect(verdict.standing[0]!.counterpartyOwnerId).toBe(HAULER);
    // And it is handed to the person, not decided for them.
    expect(verdict.awaitingOwnerDecision.map((s) => s.key)).toEqual(["haul"]);
    expect(JSON.stringify(verdict)).not.toMatch(/released|void|cancelled|discharged/i);
  });

  it("a part still waiting when a sibling fails is standing too, not void", () => {
    const verdict = composition.purposeVerdict({
      standings: [standing("haul", "PENDING", HAULER), standing("lift", "FAILED", LIFTER)],
    });
    expect(verdict.purpose).toBe("PARTIAL");
    expect(verdict.standing.map((s) => s.key)).toEqual(["haul"]);
  });

  it("nothing decided yet is PENDING, and every part failing is FAILED", () => {
    expect(composition.purposeVerdict({
      standings: [standing("haul", "PENDING", HAULER), standing("lift", "VERIFIED", LIFTER)],
    }).purpose).toBe("PENDING");
    const allFailed = composition.purposeVerdict({
      standings: [standing("haul", "FAILED", HAULER), standing("lift", "FAILED", LIFTER)],
    });
    expect(allFailed.purpose).toBe("FAILED");
    expect(allFailed.standing).toEqual([]);
    expect(allFailed.awaitingOwnerDecision).toEqual([]);
  });

  it("a purpose with no parts reports nothing rather than something", () => {
    expect(() => composition.purposeVerdict({ standings: [] })).toThrow(composition.CompositionError);
  });

  // ── 5. STRUCTURE ───────────────────────────────────────────────────────────

  it("the runtime writes no release anywhere on this path", () => {
    //   RUNTIME_RELEASES_NOTHING
    const source = readFileSync("api/runtime/component-composition.ts", "utf8");
    // It never reaches a database at all — a module that cannot write cannot
    // release, and that is a stronger guarantee than any review of its writes.
    expect(source).not.toMatch(/\bdb\b\s*\.|from "\.\.\/queries\/connection"/);
    expect(source).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
  });

  it("no noun entered either the reader or the verdict", () => {
    //   DOMAIN_DIMENSIONS_ADDED = 0 · NEW DOMAIN != NEW AGENT
    const code = readFileSync("api/runtime/component-composition.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const word of ["truck", "crane", "haul", "lift", "shipment", "consignment",
      "cargo", "vehicle", "freight", "load", "reach", "tonne"]) {
      expect(code, word).not.toMatch(new RegExp(`\\b${word}`, "i"));
    }
    expect(code).not.toMatch(/switch\s*\(/);
  });

  it("composition reuses the one constraint evaluator rather than a second one", () => {
    //   TWO_CONSTRAINT_EVALUATORS = 0
    const source = readFileSync("api/runtime/economic-fabric.ts", "utf8");
    const fn = source.slice(source.indexOf("export function composeAcrossComponents"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain("evaluateConstraintSet(");
    expect(body).toContain("semanticsCompatible(");
    expect(body).toContain("withDistanceFrom(");
    // And it sums nothing: this is coverage, not capacity.
    //   COMPONENTS_ARE_NOT_SUMMED
    expect(body).not.toMatch(/\+=|reduce\(/);
  });
});
