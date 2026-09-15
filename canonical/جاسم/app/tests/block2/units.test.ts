import { describe, expect, it } from "vitest";
import {
  canonicalQuantity,
  quantitySatisfies,
  unitsCompatible,
} from "../../api/runtime/block2/units";

describe("Block 2 units", () => {
  it("canonicalizes mass and time quantities", () => {
    expect(canonicalQuantity(1_000, "g")).toMatchObject({ value: 1, unit: "kg" });
    expect(canonicalQuantity(2, "kg")).toMatchObject({ value: 2, unit: "kg" });
    expect(canonicalQuantity(2, "minutes")).toMatchObject({ value: 120, unit: "seconds" });
    expect(canonicalQuantity(30, "seconds")).toMatchObject({ value: 30, unit: "seconds" });
  });

  it("compares compatible quantities and refuses mismatches", () => {
    expect(quantitySatisfies({ value: 500, unit: "g" }, { value: 1, unit: "kg" })).toBe(true);
    expect(quantitySatisfies({ value: 2, unit: "kg" }, { value: 500, unit: "g" })).toBe(false);
    expect(quantitySatisfies({ value: 1, unit: "kg" }, { value: 1, unit: "minute" })).toBeUndefined();
    expect(unitsCompatible("kg", "g")).toBe(true);
    expect(unitsCompatible("kg", "minutes")).toBe(false);
  });
});