/**
 * Block 2 — canonical quantity normalization.
 *
 * Reuses the deterministic UNIT_TABLE already proven in the semantic fabric
 * (Block 1). LLM may interpret user language; it never owns canonical unit
 * arithmetic — every trusted numeric comparison flows through here.
 */

import { baseUnitOf, normalizeUnit, unitDimension, unitsCompatible } from "../semantic-fabric";

export { normalizeUnit, unitsCompatible };

/**
 * ─── THE SECOND TABLE THAT USED TO LIVE HERE, AND WHY IT IS GONE ────────────
 *
 * This module kept its own hand-written map of which unit belongs to which
 * dimension, beside the one in `semantic-fabric` that it already imported from.
 * Two tables that must agree and are maintained separately do not stay in
 * agreement, and these had already drifted: `second` and `seconds` were in the
 * fabric's table and missing from the copy here, so
 *
 *   canonicalQuantity(60, "seconds") → dimension "custom:seconds"
 *   quantitySatisfies({ 1, "minute" }, { 60, "seconds" }) → undefined
 *
 * — the declared BASE UNIT OF TIME was not recognized as time, and sixty
 * seconds did not satisfy a need for one minute.
 *
 *   TWO_TABLES_THAT_MUST_AGREE = 0
 *
 * So both facts are asked of the fabric now. Adding a unit is one edit in one
 * place, and this file cannot drift from it again because it holds nothing to
 * drift with.
 */
function normalizeName(unit: string): string {
  return unit.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export type CanonicalQuantity = {
  /** Value expressed in the canonical base unit of its dimension. */
  value: number;
  /** Canonical base unit ("kg" | "seconds" | "count" | normalized custom). */
  unit: string;
  dimension: string;
};

/**
 * Normalize a typed quantity to its canonical base unit.
 * Unknown units are kept as-is under their own name (custom dimension) so
 * same-unit comparisons still work deterministically; cross-unit comparison
 * of unknown units returns undefined (truthful "cannot compare").
 */
export function canonicalQuantity(value: number, unit: string): CanonicalQuantity | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const name = normalizeName(unit);
  const dimension = unitDimension(name);
  if (!dimension) {
    // Unknown is not an error. The unit keeps its own name under its own
    // dimension, so an exact same-unit comparison still works and only
    // CROSS-unit conversion is refused.
    return { value, unit: name, dimension: `custom:${name}` };
  }
  const base = baseUnitOf(dimension);
  if (!base) return undefined;
  const normalized = name === base ? value : normalizeUnit(value, name, base);
  if (normalized === undefined) return undefined;
  // Round-trip through kg→name→kg can accumulate float error; snap to 1e-9.
  const snapped = Math.abs(normalized - Math.round(normalized)) < 1e-9
    ? Math.round(normalized)
    : normalized;
  return { value: snapped, unit: base, dimension };
}

/**
 * Deterministic capacity check: does `supply` satisfy `need`?
 * Both are normalized to canonical form first. Returns undefined when the
 * dimensions are incompatible (truthful, never a guess).
 */
export function quantitySatisfies(
  need: { value: number; unit: string },
  supply: { value: number; unit: string },
): boolean | undefined {
  const n = canonicalQuantity(need.value, need.unit);
  const s = canonicalQuantity(supply.value, supply.unit);
  if (!n || !s || n.dimension !== s.dimension) return undefined;
  return s.value >= n.value;
}
