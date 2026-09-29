/**
 * JASIM — ONE PURPOSE THAT NEEDS TWO DIFFERENT THINGS.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * «أريد نقل هذه الشحنة — أحتاج شاحنة ورافعة لتحميلها».
 *
 * Composition already existed in this runtime, and it could do exactly one
 * thing: SPLIT ONE QUANTITY across several offerings of the same sort. Five
 * hundred tonnes of storage over three warehouses, summed, when the need said
 * `splitAllowed`. Everything it does is addition of a single field.
 *
 * A purpose that needs two DIFFERENT things adds nothing up. The truck does not
 * contribute 50% of a crane. Traced on the live path, such a need produced
 *
 *     matches.length === 0   ·   no composite   ·   nothing reported
 *
 * — «لم أجد شيئًا» while both things exist, are published, and are available.
 * The runtime was not wrong about any single offering. It had no way to be
 * asked the question.
 *
 *   PARTIAL_COVERAGE_IS_NOT_A_MATCH — and it is not silence either.
 *
 * ─── WHAT A COMPONENT IS, AND WHO SAYS SO ───────────────────────────────────
 *
 *   A_COMPONENT_SET_IS_DECLARED_NOT_INFERRED
 *
 * Splitting a purpose into parts is a decision about what the person actually
 * requires. A model that did it would be inventing requirements and then
 * reporting them as the person's own — the same error as extracting an
 * attribute and calling it a declaration.
 *
 *     requiredComponents: [
 *       { key: "haul", semantics: "…", constraints: [ … ] },
 *       { key: "lift", semantics: "…", constraints: [ … ] },
 *     ]
 *
 * Each component carries its own semantics, because a crane is not
 * semantically compatible with «نقل شحنة» and must not be judged against it.
 * The SAME gate every match uses decides each component, against the
 * component's own semantics rather than the need's.
 *
 *   COMPONENTS_ARE_NOT_SUMMED — this is coverage, not capacity. The quantity
 *     composite answers a different question and keeps answering it.
 *
 *   ONE_OFFERING_MAY_COVER_TWO_COMPONENTS — a truck with a crane mounted on it
 *     covers both, and refusing that would be a rule about vehicles.
 *
 *   UNREADABLE_COMPONENTS != NO_COMPONENTS — a component set nothing can read
 *     is refused loudly. Treating it as «no components declared» would turn a
 *     two-part need into a one-part one and match it on half the truth, which
 *     is the worst outcome available here.
 *
 * ─── AND WHEN ONE PART FAILS ────────────────────────────────────────────────
 *
 *   PART_SUCCEEDED != PURPOSE_ACHIEVED
 *
 * The truck came. The crane did not. The shipment did not move, and a runtime
 * that reported one verified obligation as a satisfied purpose would be lying
 * about the only thing the person cared about.
 *
 *   ANOTHER_PARTY_FAILED != YOUR_AGREEMENT_IS_VOID
 *
 * The truck's owner did nothing wrong. Whatever the terms say they are owed,
 * they are still owed; a different party's failure is not an event in their
 * agreement. So no component is ever reported as void, released or cancelled
 * here, and this module writes nothing.
 *
 *   RUNTIME_RELEASES_NOTHING — what to do with an agreement that is intact and
 *     now pointless is the owner's decision, taken with the counterparty. This
 *     reports it and names who is on the other side. It does not take it.
 */

// TYPES ONLY, deliberately: `economic-fabric` imports this module, and a
// runtime edge back would be this file's first import cycle.
import type { ConstraintResult } from "./economic-fabric";
import type { ConstraintExpression } from "./semantic-fabric";
import type { EconomicExpression } from "../../db/schema";

export class CompositionError extends Error {
  override name = "CompositionError";
}

/** Where an owner declares the parts of their own purpose. */
export const REQUIRED_COMPONENTS_FIELD = "requiredComponents";

export type NeedComponent = {
  readonly key: string;
  readonly semantics: string;
  readonly constraints: readonly ConstraintExpression[];
};

function readConstraint(value: unknown, where: string): ConstraintExpression {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CompositionError(`${where}: a constraint must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const field = typeof raw.field === "string" ? raw.field.trim() : "";
  const operator = typeof raw.operator === "string" ? raw.operator.trim() : "";
  if (!field) throw new CompositionError(`${where}: a constraint must name a field.`);
  if (!operator) throw new CompositionError(`${where}: a constraint must name an operator.`);
  if (raw.value === undefined) throw new CompositionError(`${where}: a constraint must carry a value.`);
  return {
    field,
    operator: operator as ConstraintExpression["operator"],
    value: raw.value,
    ...(typeof raw.unit === "string" && raw.unit.trim() ? { unit: raw.unit.trim() } : {}),
  };
}

/**
 * The parts this need declares, or null when it declares none.
 *
 * Refuses rather than shrugging: see UNREADABLE_COMPONENTS != NO_COMPONENTS.
 */
export function declaredComponents(
  need: Pick<EconomicExpression, "attributes">,
): readonly NeedComponent[] | null {
  const raw = (need.attributes ?? {})[REQUIRED_COMPONENTS_FIELD];
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new CompositionError("A declared component set must be a list.");
  }
  if (raw.length === 0) {
    throw new CompositionError("A declared component set cannot be empty.");
  }
  const seen = new Set<string>();
  const components = raw.map((entry, index) => {
    const where = `component ${index}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CompositionError(`${where}: each component must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim() : "";
    const semantics = typeof row.semantics === "string" ? row.semantics.trim() : "";
    if (!key) throw new CompositionError(`${where}: each component must have a key.`);
    if (seen.has(key)) throw new CompositionError(`${where}: duplicate component key «${key}».`);
    seen.add(key);
    // Without its own semantics a component would be judged against the whole
    // purpose, and the part that is not the purpose would never match.
    if (!semantics) {
      throw new CompositionError(`${where}: each component must say what it is about.`);
    }
    const constraints = row.constraints;
    if (constraints !== undefined && !Array.isArray(constraints)) {
      throw new CompositionError(`${where}: constraints must be a list.`);
    }
    return {
      key,
      semantics,
      constraints: ((constraints ?? []) as unknown[]).map((c, i) =>
        readConstraint(c, `${where} constraint ${i}`),
      ),
    };
  });
  return components;
}

export type ComponentCandidate = {
  readonly offeringId: string;
  readonly ownerId: string;
  readonly results: readonly ConstraintResult[];
};

export type ComponentCoverage = {
  readonly key: string;
  readonly semantics: string;
  readonly covered: boolean;
  readonly candidates: readonly ComponentCandidate[];
};

export type CompositionOutcome = {
  /** False when the need declared no parts; every caller behaves as before. */
  readonly declared: boolean;
  readonly components: readonly ComponentCoverage[];
  /** The keys of the parts nothing covers. Named, never merely counted. */
  readonly uncovered: readonly string[];
  /** Every declared part has at least one candidate. All of them, or none. */
  readonly viable: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// WHAT BECAME OF A PURPOSE WHOSE PARTS WENT DIFFERENT WAYS
// ─────────────────────────────────────────────────────────────────────────────

/** What is known about one part. The runtime's own three answers, no more. */
export const COMPONENT_OUTCOMES = ["PENDING", "VERIFIED", "FAILED"] as const;
export type ComponentOutcome = (typeof COMPONENT_OUTCOMES)[number];

export type ComponentStanding = {
  readonly key: string;
  readonly outcome: ComponentOutcome;
  /** Who is on the other side of this part. Named so somebody can be told. */
  readonly counterpartyOwnerId?: string;
  readonly agreementRef?: string;
};

export const PURPOSE_STATES = ["PENDING", "ACHIEVED", "PARTIAL", "FAILED"] as const;
export type PurposeState = (typeof PURPOSE_STATES)[number];

/**
 * Words a caller may never assert about a purpose or about somebody's
 * agreement. A model, a provider or a client that could say «released» would
 * make the owner's decision decorative.
 */
export const PURPOSE_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "released",
  "release",
  "void",
  "voided",
  "cancelled",
  "canceled",
  "discharged",
  "waived",
  // Lower case throughout: the check folds case before looking a key up.
  "purposestate",
]);

export function assertNoPurposeAuthorityClaim(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (PURPOSE_AUTHORITY_KEYS.has(key.trim().toLowerCase())) {
      throw new CompositionError(`«${key}» is not something a caller may assert.`);
    }
  }
}

export type PurposeVerdict = {
  readonly purpose: PurposeState;
  /** Parts that definitively did not happen. */
  readonly failed: readonly ComponentStanding[];
  /** Parts that are intact. Not one of them is void. */
  readonly standing: readonly ComponentStanding[];
  /**
   * Intact parts whose purpose can no longer be achieved. The owner decides
   * what becomes of them, with the counterparty — never this function.
   */
  readonly awaitingOwnerDecision: readonly ComponentStanding[];
  readonly notes: readonly string[];
};

/**
 * Fold the parts into one truthful answer about the whole.
 *
 * Nothing here is a verdict about anybody's agreement, and that is the point:
 * `standing` is the list of parts this function refuses to touch.
 */
export function purposeVerdict(input: {
  standings: readonly ComponentStanding[];
}): PurposeVerdict {
  const standings = input.standings;
  if (standings.length === 0) {
    throw new CompositionError("A purpose with no parts has nothing to report.");
  }
  const failed = standings.filter((entry) => entry.outcome === "FAILED");
  const verified = standings.filter((entry) => entry.outcome === "VERIFIED");
  const pending = standings.filter((entry) => entry.outcome === "PENDING");
  // Everything that is not a definitive failure is intact, whether it has
  // happened yet or not.   ANOTHER_PARTY_FAILED != YOUR_AGREEMENT_IS_VOID
  const standing = standings.filter((entry) => entry.outcome !== "FAILED");
  const notes: string[] = [];

  if (failed.length === 0) {
    return pending.length === 0
      ? { purpose: "ACHIEVED", failed, standing, awaitingOwnerDecision: [], notes }
      : { purpose: "PENDING", failed, standing, awaitingOwnerDecision: [], notes };
  }

  if (verified.length === 0 && pending.length === 0) {
    notes.push("Every part definitively failed.");
    return { purpose: "FAILED", failed, standing, awaitingOwnerDecision: [], notes };
  }

  //   PART_SUCCEEDED != PURPOSE_ACHIEVED
  notes.push("Part of this happened and part of it definitively did not, so the purpose was not achieved.");
  if (standing.length > 0) {
    //   RUNTIME_RELEASES_NOTHING
    notes.push(
      "The parts that are intact are still intact: another party's failure is not an event in their agreement. What becomes of them is the owner's decision, taken with the counterparty.",
    );
  }
  return {
    purpose: "PARTIAL",
    failed,
    standing,
    awaitingOwnerDecision: standing,
    notes,
  };
}
