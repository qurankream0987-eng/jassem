/**
 * JASIM — A NEED CAN NAME A MEASURE, AND THE MEASURE SURVIVES.
 *
 * ─── THE GAP, TRACED BEFORE ANYTHING WAS WRITTEN ────────────────────────────
 *
 * «أحتاج مكاناً لتخزين 30 متراً مكعباً» · «جهاز وزنه 7 أطنان» ·
 * «5,000 قطعة قبل الأربعاء» · «45 يوماً بدرجة حرارة محددة».
 *
 * Every one of those is a quantity of something on a number line, and none of
 * them could be stated as a need. `GOAL_DIMENSIONS` held six ABSTRACT
 * dimensions — COST, TIME, QUALITY, RISK, PRIVACY, LOCATION — while the
 * OFFERING side has carried an arbitrary `field` + `unit` since the fabric was
 * written. The two halves of the same runtime disagreed about what a
 * requirement can be.
 *
 *   A MEASURE IS NOT A QUALITY
 *
 * And below it, three more defects on the path a measure would have taken:
 *
 *   UNIT_DROPPED_IN_TRANSLATION = 0
 *     `translateConstraints` ended its non-COST branch by pushing
 *     `{ field, operator, value }` and DROPPING the unit, under a comment
 *     saying no conversion metadata existed. The metadata has existed since
 *     the units phase — and dropping the unit was never safe: «30 m³» became a
 *     bare `<= 30`, which a candidate holding 30000 litres satisfied. A silent
 *     FALSE MATCH, the mirror of the false exclusion that file refuses.
 *
 *   TWO_CONSTRAINT_EVALUATORS = 0
 *     `discovery.satisfiesHardConstraints` and `economic-fabric` both answered
 *     "does this candidate satisfy this constraint", and had drifted: one knew
 *     units, provenance and a six-operator vocabulary; the other knew none of
 *     them and spoke three operators. Discovery is the path everybody searches
 *     through, so the weaker answer was the one that decided.
 *
 *   INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0 — on the discovery path
 *     A model's reading of a photo both ADMITTED and EXCLUDED candidates in
 *     discovery. The law was enforced on the matching side and nowhere here.
 *
 *   TWO_UNIT_TABLES = 0
 *     `goal-spec` held a private SECONDS_PER_UNIT that only TIME consulted.
 *
 * ─── ONE DIMENSION, NOT A CATALOGUE OF QUANTITIES ───────────────────────────
 *
 * MEASURE stays one dimension. There is no VOLUME, no MASS, no TEMPERATURE and
 * no DURATION beside it, because what is measured is `field` and the scale is
 * `unit` — both data. Enumerating physical quantities is enumerating the world.
 *
 *   DOMAIN_DIMENSIONS_ADDED = 0
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let discover: typeof import("../../api/runtime/block31").discover;
let goalSpec: typeof import("../../api/runtime/goal-spec");
let translateConstraints: typeof import("../../api/runtime/need-continuity").translateConstraints;

const SELLER = "measure-seller";
const BUYER = "measure-buyer";

/** A stated bound, in the need's own vocabulary. */
const measure = (field: string, value: number, unit: string, over: Record<string, unknown> = {}) => ({
  dimension: "MEASURE" as const,
  operator: "AT_MOST" as const,
  value,
  unit,
  field,
  hardness: "HARD" as const,
  source: "STATED" as const,
  ...over,
});

describe("a need can say how much of what, and nothing loses the unit on the way", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
    ({ discover } = await import("../../api/runtime/block31"));
    goalSpec = await import("../../api/runtime/goal-spec");
    ({ translateConstraints } = await import("../../api/runtime/need-continuity"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  /** An offering, stated by its owner unless a provenance says otherwise. */
  async function offer(input: {
    semanticType: string;
    attributes: Record<string, unknown>;
    provenance?: Record<string, "STATED" | "INFERRED" | "OBSERVED">;
  }) {
    const expression = await createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType: input.semanticType,
      attributes: input.attributes,
      ...(input.provenance ? { attributeProvenance: input.provenance } : {}),
    });
    await publishExpression({
      id: expression.id,
      ownerId: SELLER,
      projection: { semanticType: input.semanticType, summary: input.semanticType },
    });
    return expression;
  }

  const search = async (
    query: string,
    hardConstraints: Array<Record<string, unknown>>,
  ) =>
    discover(handle.db, {
      ownerId: BUYER,
      conversationId: `measure-${randomUUID()}`,
      query,
      kind: "offering",
      explicitScope: "INTERNAL",
      availability: { internal: true, web: false },
      hardConstraints: hardConstraints as never,
    });

  // ── 1. THE GAP ITSELF ──────────────────────────────────────────────────────

  it("a measured quantity is a statable need", () => {
    // Before this phase the schema had no dimension that could hold it, so the
    // request did not fail to match — it could not be written down.
    const parsed = goalSpec.GoalSpecSchema.safeParse({
      version: 1,
      outcome: "storage for what I have",
      constraints: [measure("volume", 30, "m3")],
      preferences: [],
      assumptions: [],
      unknowns: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("a measure must say what it measures, and nothing else may name a field", () => {
    //   A MEASURE OF NOTHING = 0
    const noField = goalSpec.GoalSpecSchema.safeParse({
      version: 1,
      outcome: "thirty of something",
      constraints: [{ ...measure("volume", 30, "m3"), field: undefined }],
      preferences: [], assumptions: [], unknowns: [],
    });
    expect(noField.success).toBe(false);

    // And the reverse: a COST whose field is «volume» is not a sentence.
    const costWithField = goalSpec.GoalSpecSchema.safeParse({
      version: 1,
      outcome: "cheap",
      constraints: [{ ...measure("volume", 30, "KWD"), dimension: "COST" }],
      preferences: [], assumptions: [], unknowns: [],
    });
    expect(costWithField.success).toBe(false);
  });

  // ── 2. UNIT_DROPPED_IN_TRANSLATION = 0 ─────────────────────────────────────

  it("the unit travels into the search, instead of being dropped", () => {
    const { applied, unapplied } = translateConstraints([measure("volume", 30, "m3") as never]);
    expect(unapplied).toHaveLength(0);
    expect(applied).toEqual([{ field: "volume", operator: "max", value: 30, unit: "m3" }]);
  });

  it("a scale nothing knows is named, not discarded", () => {
    //   SILENT_GUESSED_FILTER = 0
    const { applied, unapplied } = translateConstraints([
      measure("radiance", 30, "glorbs") as never,
    ]);
    expect(applied).toHaveLength(0);
    expect(unapplied[0]!.reason).toBe("UNKNOWN_UNIT");
  });

  it("thirty cubic metres does not admit thirty thousand litres", async () => {
    // THE false match the dropped unit produced. Both offerings hold the SAME
    // volume; only the scale differs, and before this phase the litre row
    // passed a «30» bound because 30000 was never compared as a volume at all.
    const small = await offer({
      semanticType: "storage space",
      attributes: { volume: 12, volumeUnit: "m3" },
    });
    const sameSizeInLitres = await offer({
      semanticType: "storage space",
      attributes: { volume: 30000, volumeUnit: "L" },
    });
    const { applied } = translateConstraints([measure("volume", 20, "m3") as never]);

    const found = await search("storage space", applied as never);
    const refs = found.candidates.map((candidate) => candidate.canonicalRef);
    expect(refs).toContain(small.id);
    // 30000 L is 30 m³, which is more than 20 m³. It is excluded BECAUSE the
    // units were reconciled, not because the number looked big.
    expect(refs).not.toContain(sameSizeInLitres.id);
  });

  it("and it does admit the litres that really are smaller", async () => {
    const reallySmaller = await offer({
      semanticType: "storage space",
      attributes: { volume: 15000, volumeUnit: "L" },
    });
    const { applied } = translateConstraints([measure("volume", 20, "m3") as never]);
    const found = await search("storage space", applied as never);
    expect(found.candidates.map((entry) => entry.canonicalRef)).toContain(reallySmaller.id);
  });

  // ── 3. INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0, IN DISCOVERY ───────────────

  it("a guess about a photo neither excludes nor admits a candidate in search", async () => {
    // The owner never said how heavy it is; a model read it off a picture.
    // Before this phase discovery took that number at face value in BOTH
    // directions — the guess decided a real commercial outcome.
    const guessed = await offer({
      semanticType: "transport capacity",
      attributes: { mass: 40, massUnit: "tonne" },
      provenance: { mass: "INFERRED" },
    });
    const stated = await offer({
      semanticType: "transport capacity",
      attributes: { mass: 4, massUnit: "tonne" },
      provenance: { mass: "STATED" },
    });
    const { applied } = translateConstraints([measure("mass", 7, "tonne") as never]);

    const found = await search("transport capacity", applied as never);
    const refs = found.candidates.map((entry) => entry.canonicalRef);
    // The owner's own word answers the bound.
    expect(refs).toContain(stated.id);
    // The guess answers nothing — and UNKNOWN is not a hard match, so it does
    // not admit either. It is left for the brokering path to ask its owner.
    expect(refs).not.toContain(guessed.id);
  });

  it("a guess that would have PASSED is equally powerless", async () => {
    // The direction that matters commercially: an inferred value inside the
    // bound used to ADMIT a candidate nobody had vouched for.
    const guessedInside = await offer({
      semanticType: "hauling capacity",
      attributes: { mass: 3, massUnit: "tonne" },
      provenance: { mass: "INFERRED" },
    });
    const { applied } = translateConstraints([measure("mass", 7, "tonne") as never]);
    const found = await search("hauling capacity", applied as never);
    expect(found.candidates.map((entry) => entry.canonicalRef)).not.toContain(guessedInside.id);
  });

  // ── 4. TWO_UNIT_TABLES = 0, AND WHAT CONFLICTS ─────────────────────────────

  it("two bounds on different measures are two requirements, not a conflict", () => {
    //   INCOMPARABLE_ACROSS_FIELDS != CONTRADICTORY
    //
    // Grouping by dimension alone put a volume and a mass on one number line
    // and reported them as INCOMPARABLE_HARD_BOUNDS — sending somebody away to
    // resolve a conflict that does not exist.
    const evaluation = goalSpec.evaluateGoalSpec({
      version: 1,
      outcome: "move it and store it",
      constraints: [measure("volume", 30, "m3"), measure("mass", 7, "tonne")],
      preferences: [], assumptions: [], unknowns: [],
    } as never);
    expect(evaluation.conflicts).toHaveLength(0);
    expect(evaluation.readiness).not.toBe("UNSATISFIABLE");
  });

  it("two bounds on the SAME measure in different scales now compare", () => {
    // «at most 2 tonnes» beside «at least 3000 kilograms» is impossible, and
    // used to read as merely incomparable because only TIME had a unit table.
    const evaluation = goalSpec.evaluateGoalSpec({
      version: 1,
      outcome: "impossible on purpose",
      constraints: [
        measure("mass", 2, "tonne"),
        measure("mass", 3000, "kg", { operator: "AT_LEAST" }),
      ],
      preferences: [], assumptions: [], unknowns: [],
    } as never);
    expect(evaluation.conflicts.map((conflict) => conflict.code))
      .toContain("CONTRADICTORY_HARD_BOUNDS");
    // And it says WHICH measure, because a conflict nobody can name is not
    // one anybody can fix.
    expect(evaluation.conflicts[0]!.field).toBe("mass");
  });

  it("a time bound in weeks still compares against one in days", () => {
    //   TWO_UNIT_TABLES = 0 — the behaviour the deleted table provided, kept.
    const evaluation = goalSpec.evaluateGoalSpec({
      version: 1,
      outcome: "soon and not soon",
      constraints: [
        { dimension: "TIME", operator: "AT_MOST", value: 2, unit: "WEEK",
          hardness: "HARD", source: "STATED" },
        { dimension: "TIME", operator: "AT_LEAST", value: 30, unit: "DAY",
          hardness: "HARD", source: "STATED" },
      ],
      preferences: [], assumptions: [], unknowns: [],
    } as never);
    expect(evaluation.conflicts.map((conflict) => conflict.code))
      .toContain("CONTRADICTORY_HARD_BOUNDS");
  });

  it("one unrecognised scale still compares against itself", () => {
    // Traced, and it is the pre-existing stance rather than something this
    // phase changed: two bounds in the SAME unknown unit are on one number
    // line whatever that unit turns out to mean, so 2 and 9 are impossible.
    // Nothing is guessed — the scale is simply never converted.
    const evaluation = goalSpec.evaluateGoalSpec({
      version: 1,
      outcome: "unknowable but self-consistent",
      constraints: [
        measure("radiance", 2, "glorbs"),
        measure("radiance", 9, "glorbs", { operator: "AT_LEAST" }),
      ],
      preferences: [], assumptions: [], unknowns: [],
    } as never);
    expect(evaluation.conflicts.map((conflict) => conflict.code))
      .toContain("CONTRADICTORY_HARD_BOUNDS");
  });

  it("a known scale beside an unknown one is incomparable, never assumed equal", () => {
    // The dangerous mix. «at most 2 glorbs» and «at least 3000 kilograms» can
    // only be checked against each other by pretending one is the other.
    const evaluation = goalSpec.evaluateGoalSpec({
      version: 1,
      outcome: "two scales, one unreadable",
      constraints: [
        measure("mass", 2, "glorbs"),
        measure("mass", 3000, "kg", { operator: "AT_LEAST" }),
      ],
      preferences: [], assumptions: [], unknowns: [],
    } as never);
    expect(evaluation.conflicts.map((conflict) => conflict.code))
      .toContain("INCOMPARABLE_HARD_BOUNDS");
  });

  // ── 5. ONE EVALUATOR, AND NO DOMAIN ────────────────────────────────────────

  it("discovery holds no comparison of its own any more", () => {
    //   TWO_CONSTRAINT_EVALUATORS = 0
    const source = readFileSync("api/runtime/block31/discovery.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(source).toContain("evaluateConstraint(");
    // The hand-rolled operator comparisons this function used to carry.
    expect(source).not.toMatch(/actual <= expected|actual >= expected|actual === expected/);
  });

  it("the same bound behaves identically whatever is being measured", async () => {
    //   DOMAIN_DIMENSIONS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    const subjects = [
      "storage.capacity", "machine.time", "professional.hour",
      "seabed.survey_line", "artifact.conservation", "bandwidth.allocation",
    ];
    const { applied } = translateConstraints([measure("capacity", 100, "kg") as never]);
    for (const semanticType of subjects) {
      await resetBlock31(handle.db);
      const inside = await offer({
        semanticType,
        attributes: { capacity: 50000, capacityUnit: "g" },
      });
      const found = await search(semanticType, applied as never);
      // 50000 g is 50 kg. The filter cannot see what it is.
      expect(found.candidates.map((entry) => entry.canonicalRef), semanticType)
        .toContain(inside.id);
    }
  });

  it("no physical quantity became a dimension, and no domain did either", () => {
    for (const dimension of goalSpec.GOAL_DIMENSIONS) {
      expect(dimension)
        .not.toMatch(/VOLUME|MASS|WEIGHT|TEMPERATURE|DURATION|LENGTH|AREA|COUNT/i);
      expect(dimension)
        .not.toMatch(/STORAGE|SHIPPING|VEHICLE|FACTORY|SURVEY|RESTAURANT/i);
    }
    expect(goalSpec.GOAL_DIMENSIONS).toContain("MEASURE");
  });

  it("goal-spec keeps no unit table of its own", () => {
    //   TWO_UNIT_TABLES = 0
    const source = readFileSync("api/runtime/goal-spec.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(source).not.toContain("SECONDS_PER_UNIT");
    expect(source).not.toMatch(/86_400|604_800|3_600/);
    expect(source).toContain("unitDimension");
  });

  it("money did not get swept into the unit table", () => {
    //   CURRENCY_IS_A_UNIT = 0 · FX_CONVERSION_ADDED = 0
    const evaluation = goalSpec.evaluateGoalSpec({
      version: 1,
      outcome: "two currencies",
      constraints: [
        { dimension: "COST", operator: "AT_MOST", value: 3, unit: "KWD",
          hardness: "HARD", source: "STATED" },
        { dimension: "COST", operator: "AT_LEAST", value: 10, unit: "USD",
          hardness: "HARD", source: "STATED" },
      ],
      preferences: [], assumptions: [], unknowns: [],
    } as never);
    // Still incomparable, because no rate was invented to make them comparable.
    expect(evaluation.conflicts.map((conflict) => conflict.code))
      .toContain("INCOMPARABLE_HARD_BOUNDS");
  });
});
