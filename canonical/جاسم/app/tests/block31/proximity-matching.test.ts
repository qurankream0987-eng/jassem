/**
 * JASIM — «قريب» كمية، لا نوع جديد من القيود.
 *
 *   PROXIMITY_IS_A_NEW_CONSTRAINT_KIND = 0
 *   FABRICATED_POINT = 0
 *   MISSING_POINT_IS_UNKNOWN_NOT_FAR
 *   INFERRED_LOCATION_DECIDES_PROXIMITY = 0
 *   DERIVED_VALUE_OVERWRITES_A_STATED_ONE = 0
 *   GREAT_CIRCLE != TRAVEL_DISTANCE
 *   EXACT_COORDINATES_IN_A_PUBLIC_PROJECTION = 0
 *
 * المسافة طول، والطول بُعد صار الجدول يعرفه. فـ«ضمن ٢٥ كم» قيد عادي على كمية
 * عادية، يمرّ بنفس ماكينة «٧ أطنان على الأقل».
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { economicExpressions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/semantic-fabric");
let economic: typeof import("../../api/runtime/economic-fabric");

const SELLER = "owner-seller";
const BUYER = "owner-buyer";
const KIND = "خدمة";

/** Three real places, far enough apart that no rounding decides anything. */
const AMMAN = { lat: 31.9539, lng: 35.9106 };
const ZARQA = { lat: 32.0728, lng: 36.0880 };   // ~20 km from Amman
const AQABA = { lat: 29.5321, lng: 35.0063 };   // ~280 km from Amman

describe("how near is near", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    fabric = await import("../../api/runtime/semantic-fabric");
    economic = await import("../../api/runtime/economic-fabric");
  }, 60_000);

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE economic_matches, economic_expressions, memberships CASCADE`),
    );
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  async function offering(input: {
    location?: unknown;
    attributes?: Record<string, unknown>;
    provenance?: Record<string, "STATED" | "INFERRED" | "OBSERVED">;
    projection?: Record<string, unknown>;
  }) {
    const created = await economic.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: KIND,
      attributes: {
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.attributes ?? {}),
      },
      ...(input.provenance ? { attributeProvenance: input.provenance } : {}),
    });
    return economic.publishExpression({
      id: created.id, ownerId: SELLER,
      projection: input.projection ?? { semanticType: KIND, locationSummary: "عمّان" },
    });
  }

  const needWithin = (km: number, location?: unknown, over?: Record<string, unknown>) =>
    economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
      attributes: { ...(location !== undefined ? { location } : {}), ...(over ?? {}) },
      hardConstraints: [
        { field: economic.DERIVED_DISTANCE_FIELD, operator: "lte", value: km, unit: "km" },
      ] as never,
    });

  const raw = async (id: string) => {
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, id)).limit(1);
    return row!;
  };

  const distanceResult = (result: { results: { field: string; state: string; detail?: string }[] }) =>
    result.results.find((one) => one.field === economic.DERIVED_DISTANCE_FIELD)!;

  // ── 1 · الهندسة ──────────────────────────────────────────────────────────

  it("the geometry is right, symmetric, and zero for a point against itself", async () => {
    expect(fabric.greatCircleMetres(AMMAN, AMMAN)).toBe(0);
    const there = fabric.greatCircleMetres(AMMAN, ZARQA);
    const back = fabric.greatCircleMetres(ZARQA, AMMAN);
    expect(there).toBeCloseTo(back, 6);
    expect(there / 1000).toBeGreaterThan(18);
    expect(there / 1000).toBeLessThan(23);
    expect(fabric.greatCircleMetres(AMMAN, AQABA) / 1000).toBeGreaterThan(250);
    // Antipodal points return a real number, not NaN.
    const antipode = fabric.greatCircleMetres({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
    expect(Number.isFinite(antipode)).toBe(true);
    expect(antipode / 1000).toBeGreaterThan(20_000);
  });

  // ── 2 · «ضمن كذا» قيد عادي ────────────────────────────────────────────────

  it("a radius decides like any other bound, in whatever unit it is named", async () => {
    const near = await offering({ location: ZARQA });
    const far = await offering({ location: AQABA });
    const need = await needWithin(25, AMMAN);
    expect(distanceResult(economic.evaluateMatch(await raw(need.id), await raw(near.id))).state)
      .toBe("PASS");
    expect(distanceResult(economic.evaluateMatch(await raw(need.id), await raw(far.id))).state)
      .toBe("FAIL");

    // The same requirement in metres, through the one unit table.
    const inMetres = await economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
      attributes: { location: AMMAN },
      hardConstraints: [
        { field: economic.DERIVED_DISTANCE_FIELD, operator: "lte", value: 25_000, unit: "m" },
      ] as never,
    });
    expect(distanceResult(economic.evaluateMatch(await raw(inMetres.id), await raw(near.id))).state)
      .toBe("PASS");
  });

  it("proximity is not authority: near is a filter and nothing more", async () => {
    //   NEAR != AVAILABLE
    const near = await offering({ location: ZARQA, attributes: { capacity: 2, capacityUnit: "unit" } });
    const need = await economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
      attributes: { location: AMMAN },
      hardConstraints: [
        { field: economic.DERIVED_DISTANCE_FIELD, operator: "lte", value: 25, unit: "km" },
        { field: "capacity", operator: "gte", value: 10, unit: "unit" },
      ] as never,
    });
    const result = economic.evaluateMatch(await raw(need.id), await raw(near.id));
    expect(distanceResult(result).state).toBe("PASS");
    // Close by, and still not enough. Being near excuses nothing.
    expect(result.results.find((one) => one.field === "capacity")!.state).toBe("FAIL");
    expect(result.viable).toBe(false);
  });

  // ── 3 · الصمت ليس بُعداً ─────────────────────────────────────────────────

  it("a missing or unusable point is UNKNOWN, never far", async () => {
    //   MISSING_POINT_IS_UNKNOWN_NOT_FAR · FABRICATED_POINT = 0
    const need = await needWithin(25, AMMAN);
    const cases: unknown[] = [
      undefined,
      // A coerced point is a fabricated location.
      { lat: "31.95", lng: "35.91" },
      { lat: 31.95 },
      { lat: Number.NaN, lng: 35.91 },
      // Out of range is corrupt data, not a place.
      { lat: 991, lng: 35.91 },
      { lat: 31.95, lng: -900 },
      "عمّان",
    ];
    for (const location of cases) {
      const candidate = await offering({ location });
      const result = distanceResult(economic.evaluateMatch(await raw(need.id), await raw(candidate.id)));
      expect(result.state, JSON.stringify(location)).toBe("UNKNOWN");
      expect(result.detail, JSON.stringify(location)).toContain("not present");
    }
    // And a buyer who did not say where THEY are gets the same answer.
    const anywhere = await needWithin(25, undefined);
    const somewhere = await offering({ location: ZARQA });
    expect(distanceResult(economic.evaluateMatch(await raw(anywhere.id), await raw(somewhere.id))).state)
      .toBe("UNKNOWN");
  });

  // ── 4 · موقع مخمَّن لا يحسم ──────────────────────────────────────────────

  it("a location the model guessed decides no proximity, from either side", async () => {
    //   INFERRED_LOCATION_DECIDES_PROXIMITY = 0
    const need = await needWithin(25, AMMAN);
    const guessed = await offering({
      location: ZARQA, provenance: { location: "INFERRED" },
    });
    const result = distanceResult(economic.evaluateMatch(await raw(need.id), await raw(guessed.id)));
    expect(result.state).toBe("UNKNOWN");
    expect(result.detail).toContain("inferred");

    // Far AND guessed is equally undecided: the half that costs the seller.
    const guessedFar = await offering({
      location: AQABA, provenance: { location: "INFERRED" },
    });
    expect(distanceResult(economic.evaluateMatch(await raw(need.id), await raw(guessedFar.id))).state)
      .toBe("UNKNOWN");

    // And a guess on the BUYER's own side taints it too.
    const guessedNeed = await economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
      attributes: { location: AMMAN },
      attributeProvenance: { location: "INFERRED" },
      hardConstraints: [
        { field: economic.DERIVED_DISTANCE_FIELD, operator: "lte", value: 25, unit: "km" },
      ] as never,
    });
    const stated = await offering({ location: ZARQA, provenance: { location: "STATED" } });
    expect(distanceResult(economic.evaluateMatch(await raw(guessedNeed.id), await raw(stated.id))).state)
      .toBe("UNKNOWN");
  });

  it("an owner's own stated distance is never overwritten by a derivation", async () => {
    //   DERIVED_VALUE_OVERWRITES_A_STATED_ONE = 0
    const stated = await offering({
      location: AQABA,
      attributes: { distance: 1000, distanceUnit: "m" },
      provenance: { distance: "STATED" },
    });
    const need = await needWithin(25, AMMAN);
    // Geometry says ~280 km. The owner said one kilometre and theirs stands.
    expect(distanceResult(economic.evaluateMatch(await raw(need.id), await raw(stated.id))).state)
      .toBe("PASS");
    expect((await raw(stated.id)).attributes).toMatchObject({ distance: 1000 });
  });

  // ── 5 · الخصوصية ─────────────────────────────────────────────────────────

  it("matching reads a private point and the public projection keeps a summary", async () => {
    //   EXACT_COORDINATES_IN_A_PUBLIC_PROJECTION = 0
    const near = await offering({
      location: ZARQA, projection: { semanticType: KIND, locationSummary: "الزرقاء" },
    });
    const need = await needWithin(25, AMMAN);
    // It matched, so the point was read.
    expect(distanceResult(economic.evaluateMatch(await raw(need.id), await raw(near.id))).state)
      .toBe("PASS");
    // And the only thing a non-owner may see is the summary.
    const view = await economic.getExpression(near.id, BUYER);
    const serialized = JSON.stringify(view);
    expect(serialized).toContain("الزرقاء");
    expect(serialized).not.toContain("32.07");
    expect(serialized).not.toContain("36.08");
    expect(serialized).not.toContain("location\":{");
    // Publishing a raw point as a public key is refused outright.
    const another = await economic.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: KIND, attributes: { location: ZARQA },
    });
    await expect(
      economic.publishExpression({
        id: another.id, ownerId: SELLER,
        projection: { semanticType: KIND, location: ZARQA } as never,
      }),
    ).rejects.toThrow(/authorized keys/i);
  });

  // ── 6 · ما لا تدّعيه الهندسة ─────────────────────────────────────────────

  it("nothing claims a travel distance, a travel time or a road", async () => {
    //   GREAT_CIRCLE != TRAVEL_DISTANCE
    const source = await readFile(
      new URL("../../api/runtime/semantic-fabric.ts", import.meta.url), "utf8",
    );
    const bare = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const start = bare.indexOf("const EARTH_MEAN_RADIUS_METRES");
    const geometry = bare.slice(start, bare.indexOf("export function unitDimension"));
    for (const forbidden of ["route", "road", "traffic", "eta", "driving", "travel"]) {
      expect(geometry.toLowerCase(), forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
    // The limitation is written down where somebody will read it.
    expect(source).toContain("GREAT_CIRCLE != TRAVEL_DISTANCE");
    // And a distance is a length, not a new kind of thing.
    expect(fabric.unitDimension("km")).toBe("length");
    expect(fabric.baseUnitOf("length")).toBe("m");
  });

  it("proximity names no domain", async () => {
    const source = await readFile(
      new URL("../../api/runtime/economic-fabric.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    const start = source.indexOf("function withDerivedDistance");
    const body = source.slice(start, source.indexOf("export function evaluateMatch"));
    for (const forbidden of [
      "driver", "restaurant", "car", "delivery", "warehouse", "amman", "city",
    ]) {
      expect(body.toLowerCase(), forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
    // One strict reader for a point, shared rather than copied.
    expect(source).toContain("coordinatesFromPayload");
  });
});
