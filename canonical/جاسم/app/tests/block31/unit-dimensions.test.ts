/**
 * JASIM — جدول واحد للكميات، وبُعدان كانا مفقودين.
 *
 *   TWO_TABLES_THAT_MUST_AGREE = 0
 *   CURRENCY_IS_A_UNIT = 0
 *   UNKNOWN_UNIT_IS_NOT_AN_ERROR
 *
 * `block2/units` كان يحتفظ بنسخته الخاصة من «أي وحدة في أي بُعد» بجانب الجدول
 * الذي يستورد منه أصلاً. جدولان يجب أن يتطابقا ويُصانان منفصلين لا يتطابقان —
 * وقد افترقا فعلاً: `second` و`seconds` في الفابريك وغير موجودتين في النسخة،
 * فصارت وحدة الزمن الأساس نفسها بُعداً «مخصّصاً»، و٦٠ ثانية لا تُلبّي دقيقة.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { economicExpressions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let units: typeof import("../../api/runtime/block2/units");
let fabric: typeof import("../../api/runtime/semantic-fabric");
let economic: typeof import("../../api/runtime/economic-fabric");

const SELLER = "owner-seller";
const BUYER = "owner-buyer";

describe("one table of quantities", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    units = await import("../../api/runtime/block2/units");
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

  // ── 1 · العيب الذي كشفه التتبُّع ──────────────────────────────────────────

  it("the base unit of time is time, and sixty seconds satisfy one minute", async () => {
    // Before this phase: dimension «custom:seconds», and the answer was
    // `undefined` — «cannot compare» — for the two most basic time units there
    // are.
    for (const spelling of ["second", "seconds"]) {
      expect(units.canonicalQuantity(60, spelling), spelling).toMatchObject({
        dimension: "time", unit: "seconds", value: 60,
      });
    }
    expect(
      units.quantitySatisfies({ value: 1, unit: "minute" }, { value: 60, unit: "seconds" }),
    ).toBe(true);
    expect(
      units.quantitySatisfies({ value: 1, unit: "minute" }, { value: 59, unit: "seconds" }),
    ).toBe(false);
  });

  it("there is no second table to drift from", async () => {
    //   TWO_TABLES_THAT_MUST_AGREE = 0
    const source = await readFile(
      new URL("../../api/runtime/block2/units.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    // The dimension map and the base units are asked for, not restated.
    expect(source).toContain("unitDimension");
    expect(source).toContain("baseUnitOf");
    expect(source).not.toMatch(/DIMENSION_OF|BASE_UNIT\s*[:=]/);
    expect(source).not.toMatch(/"mass"|'mass'|"time"|'time'/);
    // And every unit the fabric knows is classified by the one that asks.
    for (const unit of ["kg", "ton", "seconds", "hour", "count", "m", "km", "m2", "hectare", "m3", "litre"]) {
      const dimension = fabric.unitDimension(unit);
      expect(dimension, unit).toBeDefined();
      expect(fabric.baseUnitOf(dimension!), unit).toBeDefined();
      expect(units.canonicalQuantity(1, unit), unit).toMatchObject({ dimension });
    }
  });

  // ── 2 · البُعدان المفقودان ────────────────────────────────────────────────

  it("volume, area and length convert exactly", async () => {
    const cases: Array<[number, string, string, number]> = [
      // volume
      [1, "m3", "litre", 1000],
      [40_000, "litre", "m3", 40],
      [1, "litre", "ml", 1000],
      [30, "cbm", "m3", 30],
      // area
      [1, "hectare", "m2", 10_000],
      [120, "hectare", "km2", 1.2],
      [1, "dunum", "m2", 1000],
      [1, "ha", "hectare", 1],
      // length
      [1, "km", "m", 1000],
      [1, "m", "cm", 100],
      [6000, "m", "km", 6],
    ];
    for (const [value, from, to, expected] of cases) {
      const got = fabric.normalizeUnit(value, from, to);
      expect(got, `${value}${from}→${to}`).toBeCloseTo(expected, 9);
    }
  });

  it("dimensions never cross", async () => {
    // A kilogram is not a metre, however willing anybody is to compare them.
    for (const [a, b] of [
      ["kg", "m"], ["m3", "m2"], ["hectare", "litre"], ["km", "hour"], ["count", "kg"],
    ]) {
      expect(fabric.normalizeUnit(1, a, b), `${a}→${b}`).toBeUndefined();
      expect(fabric.unitsCompatible(a, b), `${a}~${b}`).toBe(false);
    }
  });

  it("a currency is not a unit", async () => {
    //   CURRENCY_IS_A_UNIT = 0
    //
    // A currency has no factor — it has a market — and `block3/money` owns it,
    // with its own scales and its refusal to add two currencies.
    for (const code of ["JOD", "KWD", "USD", "SAR"]) {
      expect(fabric.unitDimension(code), code).toBeUndefined();
      expect(fabric.normalizeUnit(1, "JOD", "KWD")).toBeUndefined();
    }
  });

  // ── 3 · المجهول ليس خطأ ───────────────────────────────────────────────────

  it("an unknown unit still compares exactly with itself, and never across", async () => {
    //   UNKNOWN_UNIT_IS_NOT_AN_ERROR
    expect(units.canonicalQuantity(5, "صندوق")).toMatchObject({
      dimension: "custom:صندوق", unit: "صندوق", value: 5,
    });
    expect(
      units.quantitySatisfies({ value: 2, unit: "صندوق" }, { value: 5, unit: "صندوق" }),
    ).toBe(true);
    expect(
      units.quantitySatisfies({ value: 9, unit: "صندوق" }, { value: 5, unit: "صندوق" }),
    ).toBe(false);
    // And no conversion is invented between it and anything else.
    expect(
      units.quantitySatisfies({ value: 2, unit: "صندوق" }, { value: 5, unit: "kg" }),
    ).toBeUndefined();
  });

  it("spelling and spacing do not change a quantity", async () => {
    for (const [a, b] of [
      ["KG", "kg"], ["Hectare", "hectare"], [" M3 ", "m3"], ["Kilometres", "kilometres"],
    ]) {
      expect(fabric.unitDimension(a), a).toBe(fabric.unitDimension(b));
      expect(fabric.normalizeUnit(1, a, b), `${a}→${b}`).toBe(1);
    }
  });

  // ── 4 · حاجة وعرض يتقابلان رغم اختلاف التسمية ────────────────────────────

  it("a need and an offering that name the same quantity differently now meet", async () => {
    // Before this phase they did not: the two names could not be converted, so
    // the constraint answered UNKNOWN and the candidate was never viable.
    const offering = await economic.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: "سعة",
      attributes: { capacity: 40_000, capacityUnit: "litre" },
    });
    await economic.publishExpression({
      id: offering.id, ownerId: SELLER, projection: { semanticType: "سعة" },
    });
    const need = await economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: "سعة",
      hardConstraints: [
        { field: "capacity", operator: "gte", value: 30, unit: "m3" },
      ] as never,
    });
    const result = economic.evaluateMatch(await raw(need.id), await raw(offering.id));
    // 40,000 litres is 40 m³, which clears 30.
    expect(result.results[0]).toMatchObject({ field: "capacity", state: "PASS" });
    expect(result.viable).toBe(true);

    // And the same arithmetic refuses when it should.
    const small = await economic.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: "سعة",
      attributes: { capacity: 20_000, capacityUnit: "litre" },
    });
    await economic.publishExpression({
      id: small.id, ownerId: SELLER, projection: { semanticType: "سعة" },
    });
    expect(
      economic.evaluateMatch(await raw(need.id), await raw(small.id)).results[0],
    ).toMatchObject({ state: "FAIL" });
  });

  it("an area need meets an area offering across names", async () => {
    const offering = await economic.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: "مسح",
      attributes: { area: 1_600_000, areaUnit: "m2" },
    });
    await economic.publishExpression({
      id: offering.id, ownerId: SELLER, projection: { semanticType: "مسح" },
    });
    const need = await economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: "مسح",
      hardConstraints: [{ field: "area", operator: "gte", value: 120, unit: "hectare" }] as never,
    });
    // 1,600,000 m² is 160 ha, which clears 120.
    expect(
      economic.evaluateMatch(await raw(need.id), await raw(offering.id)).results[0],
    ).toMatchObject({ state: "PASS" });
  });

  it("a quantity in an unconvertible pair is UNKNOWN, never FAIL", async () => {
    const offering = await economic.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: "شيء",
      attributes: { capacity: 600, capacityUnit: "صندوق" },
    });
    await economic.publishExpression({
      id: offering.id, ownerId: SELLER, projection: { semanticType: "شيء" },
    });
    const need = await economic.createExpression({
      ownerId: BUYER, kind: "need", semanticType: "شيء",
      hardConstraints: [{ field: "capacity", operator: "gte", value: 30, unit: "m3" }] as never,
    });
    const result = economic.evaluateMatch(await raw(need.id), await raw(offering.id));
    expect(result.results[0]).toMatchObject({ state: "UNKNOWN" });
    expect(result.results[0]!.detail).toContain("units");
  });

  // ── 5 · لا مجال في جدول كميات ────────────────────────────────────────────

  it("the table names quantities, never things", async () => {
    const source = await readFile(
      new URL("../../api/runtime/semantic-fabric.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    const start = source.indexOf("const UNIT_TABLE");
    const table = source.slice(start, source.indexOf("export function unitDimension"));
    for (const forbidden of [
      "car", "food", "hotel", "warehouse", "truck", "room", "meal", "laptop",
      "jod", "kwd", "usd", "currency",
    ]) {
      expect(table.toLowerCase(), forbidden).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
    // Every declared dimension has a base unit, and every base unit is a row.
    for (const dimension of ["mass", "time", "count", "length", "area", "volume"]) {
      const base = fabric.baseUnitOf(dimension);
      expect(base, dimension).toBeDefined();
      expect(fabric.unitDimension(base!), dimension).toBe(dimension);
      expect(fabric.normalizeUnit(1, base!, base!), dimension).toBe(1);
    }
  });

  async function raw(id: string) {
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, id)).limit(1);
    return row!;
  }
});
