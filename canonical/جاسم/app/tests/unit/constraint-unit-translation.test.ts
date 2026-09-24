/**
 * JASIM — WHAT SOMEBODY SAID, IN THE TERMS THE SEARCH SPEAKS.
 *
 *   UNDERSTOOD != TRANSLATABLE
 *   TRANSLATABLE != CONVERTIBLE_BY_GUESSING
 *   UNIT_CONVERSION != FX_CONVERSION
 *   DISPLAY_VALUE != CANONICAL_VALUE · FLOAT != MONEY
 *
 * A constraint the need runtime understands must not be silently ignored by
 * discovery when it CAN be translated faithfully — and must not become a hard
 * filter when it cannot.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { translateConstraints } from "../../api/runtime/need-continuity";
import { satisfiesHardConstraints } from "../../api/runtime/block31/discovery";
import type { GoalConstraint } from "../../api/runtime/goal-spec";

const bound = (over: Partial<GoalConstraint> = {}): GoalConstraint => ({
  dimension: "COST", operator: "AT_MOST", value: 3, unit: "KWD",
  hardness: "HARD", source: "STATED", ...over,
} as GoalConstraint);

/** A candidate as the fabric stores one. */
const priced = (priceMinor: string, currency: string) =>
  ({ attributes: { priceMinor, currency } }) as never;

const applyTo = (candidate: never, constraints: readonly Record<string, unknown>[]) =>
  satisfiesHardConstraints(candidate, constraints as never);

describe("money is normalized through the canonical money module", () => {
  it("«أقل من 3 دنانير» excludes 3500 and admits 2500", () => {
    //   The bug this phase exists to close.
    const { applied, unapplied } = translateConstraints([bound()]);
    expect(unapplied).toHaveLength(0);
    expect(applied).toEqual([{ field: "price", maxMinor: "3000", currency: "KWD" }]);
    expect(applyTo(priced("2500", "KWD"), applied)).toBe(true);
    expect(applyTo(priced("3500", "KWD"), applied)).toBe(false);
  });

  it("each currency uses its own scale, and no branch names a currency", () => {
    //   KWD 3 · USD 2 · JPY 0 — metadata, not code.
    const cases: [number, string, string][] = [
      [3, "KWD", "3000"], [2, "KWD", "2000"],
      [10, "USD", "1000"], [100, "JPY", "100"],
    ];
    for (const [value, unit, minor] of cases) {
      const { applied } = translateConstraints([bound({ value, unit })]);
      expect(applied[0], `${value} ${unit}`).toEqual({
        field: "price", maxMinor: minor, currency: unit,
      });
    }
  });

  it("decimals are exact, including the ones floating point gets wrong", () => {
    //   FLOAT_MONEY_CONVERSION = 0 · ROUNDING_BY_ACCIDENT = 0
    //
    // 2.5 * 1000 and 10.99 * 100 are the classic binary-float traps
    // (10.99 * 100 === 1098.9999999999998). Exact decimal parsing has no
    // opinion about that at all.
    const cases: [number | string, string, string][] = [
      [2.5, "KWD", "2500"],
      ["2.750", "KWD", "2750"],
      [10.99, "USD", "1099"],
      [0.07, "USD", "7"],
      [1.1, "USD", "110"],
    ];
    for (const [value, unit, minor] of cases) {
      const { applied } = translateConstraints([bound({ value, unit } as never)]);
      expect(applied[0], `${value} ${unit}`).toMatchObject({ maxMinor: minor });
    }
  });

  it("precision a currency does not have is refused, never rounded", () => {
    //   UNAUTHORIZED_ROUNDING = 0
    for (const [value, unit] of [["2.7505", "KWD"], ["1.005", "USD"], ["5.5", "JPY"]] as const) {
      const { applied, unapplied } = translateConstraints([bound({ value, unit } as never)]);
      expect(applied, `${value} ${unit}`).toHaveLength(0);
      expect(unapplied[0]!.reason, `${value} ${unit}`).toBe("PRECISION_UNREPRESENTABLE");
    }
  });
});

describe("what cannot be translated does not exclude", () => {
  it("a bound with no unit is never guessed into a currency", () => {
    //   MISSING_CURRENCY_GUESSED = 0
    const { applied, unapplied } = translateConstraints([
      bound({ unit: undefined } as never),
    ]);
    expect(applied).toHaveLength(0);
    expect(unapplied[0]).toEqual({ dimension: "COST", unit: null, reason: "NO_UNIT" });
  });

  it("a unit this runtime holds no metadata for is named, not assumed", () => {
    const { applied, unapplied } = translateConstraints([bound({ unit: "XYZ" })]);
    expect(applied).toHaveLength(0);
    expect(unapplied[0]!.reason).toBe("UNKNOWN_UNIT");
  });

  it("a direction is a preference and never becomes a bound", () => {
    //   PREFERENCE_INVENTED_AS_HARD_BOUND = 0
    for (const operator of ["MINIMIZE", "MAXIMIZE"] as const) {
      const { applied, unapplied } = translateConstraints([
        bound({ operator, value: undefined, unit: "KWD" } as never),
      ]);
      expect(applied, operator).toHaveLength(0);
      expect(unapplied[0]!.reason, operator).toBe("DIRECTION_NOT_A_BOUND");
    }
  });

  it("everything refused is returned, so nothing is refused in silence", () => {
    //   SILENT_GUESSED_FILTER = 0
    const { applied, unapplied } = translateConstraints([
      bound({ value: 3, unit: "KWD" }),
      bound({ dimension: "LOCATION", operator: "MINIMIZE", value: undefined } as never),
      bound({ unit: undefined } as never),
    ]);
    expect(applied).toHaveLength(1);
    expect(unapplied.map((entry) => entry.reason).sort())
      .toEqual(["DIRECTION_NOT_A_BOUND", "NO_UNIT"]);
  });
});

describe("currency participates in the comparison", () => {
  it("a KWD bound never admits or excludes a USD price", () => {
    //   CROSS_CURRENCY_FALSE_COMPARISON = 0 · FX_CONVERSION_ADDED = 0
    const { applied } = translateConstraints([bound({ value: 3, unit: "KWD" })]);
    // 2000 USD minor is a smaller integer than 3000. Without a rate, that
    // means nothing, and the runtime declines rather than deciding.
    expect(applyTo(priced("2000", "USD"), applied)).toBe(false);
    expect(applyTo(priced("2000", "KWD"), applied)).toBe(true);
  });

  it("no exchange rate exists anywhere on this path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "api/runtime/need-continuity.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const word of ["rate", "fx", "exchange", "convertCurrency"]) {
      expect(source.toLowerCase(), `names ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

describe("the translation is a projection, not a rewrite", () => {
  it("translating does not touch the constraint it was given", () => {
    //   NEED_ORIGINAL_CONSTRAINT_PRESERVED · DISCOVERY_FILTER_IS_DERIVED
    const original = bound({ value: 3, unit: "KWD" });
    const snapshot = JSON.stringify(original);
    const { applied } = translateConstraints([original]);
    expect(JSON.stringify(original)).toBe(snapshot);
    // The derived filter speaks a different language entirely.
    expect(applied[0]).not.toHaveProperty("dimension");
    expect(applied[0]).not.toHaveProperty("hardness");
  });

  it("provenance and hardness are not carried into the filter at all", () => {
    //   TRANSLATION_CHANGES_PROVENANCE = 0 · TRANSLATION_PROMOTES_INFERENCE = 0
    const stated = translateConstraints([bound({ source: "STATED" })]).applied[0];
    const inferred = translateConstraints([
      bound({ source: "INFERRED", hardness: "SOFT" }),
    ]).applied[0];
    // A filter derived from an inference is identical in shape — translation
    // changes units and nothing else. What may EXCLUDE is decided upstream by
    // the need runtime, which only hands over HARD constraints.
    expect(inferred).toEqual(stated);
    expect(JSON.stringify(stated)).not.toMatch(/STATED|INFERRED|HARD|SOFT/);
  });
});

describe("exact minor units keep working exactly as before", () => {
  it("a bound already in minor units is unchanged", () => {
    //   MINOR_UNIT_REGRESSION = 0
    const { applied, unapplied } = translateConstraints([
      bound({ value: 3000, unit: "minor" }),
    ]);
    expect(unapplied).toHaveLength(0);
    expect(applied).toEqual([{ field: "price", maxMinor: "3000" }]);
    expect(applyTo(priced("2500", "KWD"), applied)).toBe(true);
    expect(applyTo(priced("3500", "KWD"), applied)).toBe(false);
  });

  it("a non-integer minor amount is refused rather than truncated", () => {
    const { applied, unapplied } = translateConstraints([
      bound({ value: 2500.5, unit: "minor" }),
    ]);
    expect(applied).toHaveLength(0);
    expect(unapplied[0]!.reason).toBe("PRECISION_UNREPRESENTABLE");
  });
});

describe("money is general, and so is this", () => {
  it("the same bound behaves identically whatever is being bought", () => {
    //   DOMAIN_UNIT_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    const { applied } = translateConstraints([bound({ value: 3, unit: "KWD" })]);
    for (const semanticType of ["prepared.item", "used.vehicle", "professional.hour",
      "machine.time", "storage.capacity", "venue.slot", "seabed.survey_line"]) {
      // A candidate differs only in what it is; the filter cannot see that.
      const candidate = { attributes: { priceMinor: "2500", currency: "KWD" }, semanticType } as never;
      expect(applyTo(candidate, applied), semanticType).toBe(true);
    }
  });

  it("no currency and no noun is named in a branch", () => {
    const source = readFileSync(
      resolve(process.cwd(), "api/runtime/need-continuity.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const word of ["KWD", "USD", "JPY", "SAR", "dinar", "dollar",
      "food", "car", "venue", "storage"]) {
      expect(source, `branches on ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
  });
});
