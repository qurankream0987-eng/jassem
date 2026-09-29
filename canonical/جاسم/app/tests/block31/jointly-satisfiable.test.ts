/**
 * JASIM — TWO THINGS IT CAN DO, AND NOT BOTH AT ONCE.
 *
 * ─── THE FALSE MATCH ────────────────────────────────────────────────────────
 *
 * «رافعتي تصل ٣٥ متراً، لكنها عند ذلك المدى تحمل ٨ أطنان فقط».
 *
 * Constraints were evaluated ONE AT A TIME against scalar attributes, so a need
 * for `reach >= 32 m` AND `capacity >= 11 t` matched a crane declaring
 * `reach: 35, capacity: 20` — both PASS, independently, and the crane cannot do
 * both at once. The same shape produces a generator rated 30 kW whose
 * continuous output is 22.
 *
 *   INDEPENDENT_CONSTRAINTS_SATISFIED != JOINTLY_SATISFIABLE
 *
 * This is the worst error this runtime can make. Not a refusal, not an
 * uncertainty — A MATCH THAT LOOKS RIGHT. Somebody drives out.
 *
 * ─── AND WHY IT WAS NOT A BUG IN THE EVALUATOR ──────────────────────────────
 *
 * Most attributes genuinely do not interact: a price and a colour constrain
 * nothing about each other, and assuming interaction everywhere would refuse
 * the world. The gap was never «assume they interact» — it was that AN OWNER
 * HAD NO WAY TO SAY THAT THEY DO.
 *
 *   BETWEEN_TWO_DECLARED_POINTS_IS_NOT_A_PROMISE
 *   A_HEADLINE_NUMBER_IS_NOT_A_JOINT_PROMISE
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let discover: typeof import("../../api/runtime/block31").discover;

const SELLER = "joint-seller";
const BUYER = "joint-buyer";

beforeAll(async () => {
  handle = await getTestDb();
  fabric = await import("../../api/runtime/economic-fabric");
  ({ discover } = await import("../../api/runtime/block31"));
});

beforeEach(async () => {
  await resetBlock31(handle.db);
});

describe("two things it can do, and not both at once", () => {
  async function offering(input: {
    semanticType: string;
    attributes: Record<string, unknown>;
    provenance?: Record<string, "STATED" | "INFERRED" | "OBSERVED">;
  }) {
    const expression = await fabric.createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType: input.semanticType,
      attributes: input.attributes,
      ...(input.provenance ? { attributeProvenance: input.provenance } : {}),
    });
    return fabric.publishExpression({
      id: expression.id,
      ownerId: SELLER,
      projection: { semanticType: input.semanticType, summary: input.semanticType },
    });
  }

  const search = (semanticType: string, constraints: Array<Record<string, unknown>>) =>
    discover(handle.db, {
      ownerId: BUYER,
      conversationId: `joint-${randomUUID()}`,
      query: semanticType,
      kind: "offering",
      explicitScope: "INTERNAL",
      availability: { internal: true, web: false },
      hardConstraints: constraints as never,
    });

  /** «reach ≥ 32 m AND capacity ≥ 11 t» — the two bounds that must hold together. */
  const BOTH = [
    { field: "reach", operator: "gte", value: 32, unit: "m" },
    { field: "capacity", operator: "gte", value: 11, unit: "tonne" },
  ];

  // ── 1. THE FALSE MATCH, AND ITS END ────────────────────────────────────────

  it("a thing that declares only headline numbers still matches, as it always did", async () => {
    // Unchanged behaviour: nothing was said about the two interacting, so
    // nothing is assumed. Refusing this would refuse the world.
    const headline = await offering({
      semanticType: "lift.service",
      attributes: { reach: 35, reachUnit: "m", capacity: 20, capacityUnit: "tonne" },
    });
    const found = await search("lift.service", BOTH);
    expect(found.candidates.map((entry) => entry.canonicalRef)).toContain(headline.id);
  });

  it("the SAME thing, once its owner declares what it can do where, is refused", async () => {
    //   INDEPENDENT_CONSTRAINTS_SATISFIED != JOINTLY_SATISFIABLE
    const declared = await offering({
      semanticType: "lift.service",
      attributes: {
        reach: 35,
        reachUnit: "m",
        capacity: 20,
        capacityUnit: "tonne",
        capabilityPoints: [
          { reach: 20, reachUnit: "m", capacity: 20, capacityUnit: "tonne" },
          { reach: 35, reachUnit: "m", capacity: 8, capacityUnit: "tonne" },
        ],
      },
    });
    const found = await search("lift.service", BOTH);
    // At 35 m it lifts 8 t; at 20 m it lifts 20 t. Neither configuration does
    // what was asked, so the answer is no — not «probably».
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(declared.id);
  });

  it("and it matches the moment ONE configuration really does both", async () => {
    const able = await offering({
      semanticType: "lift.service",
      attributes: {
        capabilityPoints: [
          { reach: 20, reachUnit: "m", capacity: 20, capacityUnit: "tonne" },
          { reach: 34, reachUnit: "m", capacity: 14, capacityUnit: "tonne" },
        ],
      },
    });
    const found = await search("lift.service", BOTH);
    expect(found.candidates.map((entry) => entry.canonicalRef)).toContain(able.id);
  });

  it("the headline number does not rescue a configuration that cannot", async () => {
    //   A_HEADLINE_NUMBER_IS_NOT_A_JOINT_PROMISE
    const boastful = await offering({
      semanticType: "power.supply",
      attributes: {
        // «مولّد ٣٠ كيلوواط» — the number on the side of the machine.
        output: 30,
        outputUnit: "count",
        capabilityPoints: [{ output: 22, outputUnit: "count" }],
      },
    });
    const found = await search("power.supply", [
      { field: "output", operator: "gte", value: 25, unit: "count" },
    ]);
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(boastful.id);
  });

  it("a point fills in only what it mentions", async () => {
    // The configuration says nothing about the crew, so the scalar beside it
    // still answers — a point is a configuration, not a replacement record.
    const partial = await offering({
      semanticType: "lift.service",
      attributes: {
        crew: 3,
        crewUnit: "count",
        capabilityPoints: [{ reach: 34, reachUnit: "m", capacity: 14, capacityUnit: "tonne" }],
      },
    });
    const found = await search("lift.service", [
      ...BOTH,
      { field: "crew", operator: "gte", value: 2, unit: "count" },
    ]);
    expect(found.candidates.map((entry) => entry.canonicalRef)).toContain(partial.id);
  });

  it("nothing is interpolated between two declared points", async () => {
    //   BETWEEN_TWO_DECLARED_POINTS_IS_NOT_A_PROMISE
    //
    // 20 m → 20 t and 35 m → 8 t. A straight line between them would «reach»
    // 27 m at 14 t. Nobody promised that configuration, so nobody may be held
    // to it.
    const two = await offering({
      semanticType: "lift.service",
      attributes: {
        capabilityPoints: [
          { reach: 20, reachUnit: "m", capacity: 20, capacityUnit: "tonne" },
          { reach: 35, reachUnit: "m", capacity: 8, capacityUnit: "tonne" },
        ],
      },
    });
    const found = await search("lift.service", [
      { field: "reach", operator: "gte", value: 27, unit: "m" },
      { field: "capacity", operator: "gte", value: 14, unit: "tonne" },
    ]);
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(two.id);
  });

  // ── 2. UNITS AND GUESSES STILL BEHAVE ──────────────────────────────────────

  it("a configuration in another scale is reconciled, not compared raw", async () => {
    const metric = await offering({
      semanticType: "lift.service",
      attributes: {
        capabilityPoints: [{ reach: 34000, reachUnit: "mm", capacity: 14000, capacityUnit: "kg" }],
      },
    });
    const found = await search("lift.service", BOTH);
    expect(found.candidates.map((entry) => entry.canonicalRef)).toContain(metric.id);
  });

  it("configurations a model read off a spec sheet decide nothing", async () => {
    //   INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0 — one level up.
    const guessed = await offering({
      semanticType: "lift.service",
      attributes: {
        capabilityPoints: [{ reach: 34, reachUnit: "m", capacity: 14, capacityUnit: "tonne" }],
      },
      provenance: { capabilityPoints: "INFERRED" },
    });
    const found = await search("lift.service", BOTH);
    // It would have PASSED. A guess that admits is as wrong as one that
    // excludes — and here it would have promised a lift nobody vouched for.
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(guessed.id);
  });

  // ── 3. THE MATCHING SIDE AGREES WITH THE SEARCH SIDE ───────────────────────

  it("matching reaches the same verdict as discovery", async () => {
    //   TWO_CONSTRAINT_EVALUATORS = 0 — and now, one set evaluator.
    const declared = await offering({
      semanticType: "lift.service",
      attributes: {
        capabilityPoints: [
          { reach: 20, reachUnit: "m", capacity: 20, capacityUnit: "tonne" },
          { reach: 35, reachUnit: "m", capacity: 8, capacityUnit: "tonne" },
        ],
      },
    });
    const need = await fabric.createExpression({
      ownerId: BUYER,
      kind: "need",
      semanticType: "lift.service",
      attributes: {},
      hardConstraints: [
        { field: "reach", operator: "gte", value: 32, unit: "m" },
        { field: "capacity", operator: "gte", value: 11, unit: "tonne" },
      ],
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id,
      offeringId: declared.id,
      createdByOwnerId: BUYER,
    });
    expect(match.status).not.toBe("viable");
  });

  // ── 4. IT IS A SET EVALUATOR, NOT A DOMAIN ─────────────────────────────────

  it("the same declaration works for anything with a trade-off", async () => {
    const worlds = [
      { semanticType: "cold.transport", a: "holdTemp", b: "durationHours" },
      { semanticType: "press.time", a: "tonnage", b: "bedWidth" },
      { semanticType: "survey.line", a: "depth", b: "resolution" },
      { semanticType: "kiln.firing", a: "peakTemp", b: "chamberVolume" },
    ];
    for (const world of worlds) {
      await resetBlock31(handle.db);
      const declared = await offering({
        semanticType: world.semanticType,
        attributes: {
          capabilityPoints: [
            { [world.a]: 100, [`${world.a}Unit`]: "count", [world.b]: 10, [`${world.b}Unit`]: "count" },
            { [world.a]: 10, [`${world.a}Unit`]: "count", [world.b]: 100, [`${world.b}Unit`]: "count" },
          ],
        },
      });
      const found = await search(world.semanticType, [
        { field: world.a, operator: "gte", value: 90, unit: "count" },
        { field: world.b, operator: "gte", value: 90, unit: "count" },
      ]);
      expect(found.candidates.map((entry) => entry.canonicalRef), world.semanticType)
        .not.toContain(declared.id);
    }
  });

  it("no noun entered the set evaluator", () => {
    const source = readFileSync("api/runtime/economic-fabric.ts", "utf8");
    const fn = source.slice(source.indexOf("export function evaluateConstraintSet"));
    const body = fn
      .slice(0, fn.indexOf("\n}\n"))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of ["crane", "reach", "lift", "generator", "boat", "payload", "kw", "tonne"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
    // And nothing is invented between declared configurations.
    expect(body).not.toMatch(/interpolat|average|\bslope\b/);
  });

  it("discovery and matching call the same set evaluator", () => {
    for (const path of [
      "api/runtime/block31/discovery.ts",
      "api/runtime/economic-fabric.ts",
    ]) {
      expect(readFileSync(path, "utf8")).toContain("evaluateConstraintSet(");
    }
  });
});
