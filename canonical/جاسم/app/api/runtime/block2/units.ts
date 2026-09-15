/**
 * Block 2 — canonical quantity normalization.
 *
 * Reuses the deterministic UNIT_TABLE already proven in the semantic fabric
 * (Block 1). LLM may interpret user language; it never owns canonical unit
 * arithmetic — every trusted numeric comparison flows through here.
 */

import { normalizeUnit, unitsCompatible } from "../semantic-fabric";

export { normalizeUnit, unitsCompatible };

/** Canonical base units per dimension. */
const BASE_UNIT: Record<string, string> = {
  mass: "kg",
  time: "seconds",
  count: "count",
};

const DIMENSION_OF: Record<string, string> = {
  g: "mass",
  kg: "mass",
  ton: "mass",
  tonne: "mass",
  minute: "time",
  minutes: "time",
  hour: "time",
  hours: "time",
  day: "time",
  days: "time",
  week: "time",
  weeks: "time",
  seat: "count",
  seats: "count",
  unit: "count",
  units: "count",
};

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
  const dimension = DIMENSION_OF[name];
  if (!dimension) {
    return { value, unit: name, dimension: `custom:${name}` };
  }
  const base = BASE_UNIT[dimension];
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
