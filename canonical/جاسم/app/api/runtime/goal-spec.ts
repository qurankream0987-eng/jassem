/**
 * JASIM — GoalSpec. What should happen, stated so a machine can check it.
 *
 * ─── THE GAP, PROVEN BEFORE IT WAS FILLED ───────────────────────────────────
 *
 * «رتب لي الموضوع بأرخص طريقة لكن لا تتأخر أكثر من يومين» carries two
 * requirements: cost should be as low as possible, and two days is a wall. The
 * envelope a turn produces today has nowhere typed for either:
 *
 *   EnvelopeExecutionIntent {
 *     requiredCapabilities: string[]        ← names of things, not requirements
 *     missingInputs:        string[]
 *     inputs:               Record<string, unknown>   ← free-form; unread
 *     risk, persistence, effects
 *   }
 *
 * A model may put `{ deadline: "48h" }` in `inputs` and the schema accepts it,
 * because `inputs` accepts anything. Nothing then reads it: no capability
 * contract mentions a deadline, no filter applies one, no result is checked
 * against one. The one place in the repository that interpolates
 * `{{inputs.constraints}}` is `api/core/capability-registry.ts`, which the
 * runtime does not import — a prompt template, not an enforcement point.
 *
 * So the failure is silent and complete: the deadline is heard, stored, and
 * never consulted. That is worse than refusing it, because the person has no
 * way to see it was dropped.
 *
 * ─── WHAT THIS MODULE IS, AND IS NOT ────────────────────────────────────────
 *
 *   GOAL = WHAT SHOULD HAPPEN.      PLAN = HOW IT WILL HAPPEN.
 *
 * This file is the first half and none of the second. It contains no step, no
 * capability, no provider, no ordering and no DAG. It cannot say how anything
 * will be achieved and must never learn to — a GoalSpec that names a step has
 * stopped being a goal.
 *
 * It is also not a planner's input format. It is a statement of what the person
 * asked for, checkable on its own: contradictory requirements are contradictory
 * before anyone tries to satisfy them, and a goal with an open question is not
 * actionable no matter how good a plan is.
 *
 * ─── HARDNESS IS THE LOAD-BEARING FIELD ─────────────────────────────────────
 *
 * HARD is a wall: a result that violates it is wrong, not merely worse. SOFT is
 * a direction: it orders outcomes and never excludes one. Collapsing the two is
 * how «لا تتأخر أكثر من يومين» becomes "we tried to be quick".
 *
 * ─── AND `source` IS WHAT KEEPS HARDNESS HONEST ─────────────────────────────
 *
 * A model reading «رتب لي الموضوع بسرعة» can reasonably infer a deadline. It
 * may not then present its own inference as the person's wall. So every
 * constraint records whether it was STATED or INFERRED, and an INFERRED
 * constraint is downgraded to SOFT — recorded, never silent.
 *
 * Downgrade rather than reject, for the same reason `applyCompletionDecision`
 * downgrades: an over-confident inference is an ordinary modelling mistake, and
 * rejecting the whole goal over one would cost a person their turn. The
 * adjustment is returned so it can be shown.
 */

import { z } from "zod";
import { sanitizeModelStructuredOutput } from "./model-output-trust";

// ── The frozen vocabulary ────────────────────────────────────────────────────

/**
 * The dimensions a requirement can be about.
 *
 * Frozen, and deliberately small. A car, a scaffold and a translator all reduce
 * to these six; a seventh should be added only when a requirement genuinely
 * cannot be expressed, never because a new domain arrived. A dimension named
 * after a domain would be the domain branch this architecture refuses.
 */
export const GOAL_DIMENSIONS = [
  "COST",
  "TIME",
  "QUALITY",
  "RISK",
  "PRIVACY",
  "LOCATION",
] as const;
export type GoalDimension = (typeof GOAL_DIMENSIONS)[number];

/**
 * How a value bounds a dimension.
 *
 * `MINIMIZE` / `MAXIMIZE` carry no value — «أرخص» names a direction, not a
 * number, and inventing the number is the fabrication this codebase refuses.
 */
export const BOUNDED_OPERATORS = ["AT_MOST", "AT_LEAST", "EQUALS"] as const;
export const DIRECTIONAL_OPERATORS = ["MINIMIZE", "MAXIMIZE"] as const;
export const CONSTRAINT_OPERATORS = [...BOUNDED_OPERATORS, ...DIRECTIONAL_OPERATORS] as const;
export type ConstraintOperator = (typeof CONSTRAINT_OPERATORS)[number];

/** A wall, or a direction. */
export type Hardness = "HARD" | "SOFT";

/** Whether the person said it, or the model worked it out. */
export type ConstraintSource = "STATED" | "INFERRED";

/**
 * Time units, with fixed factors, so two time bounds can be compared without
 * consulting anything. Every other dimension compares only within one unit —
 * see `contradictions`.
 */
const SECONDS_PER_UNIT: Readonly<Record<string, number>> = Object.freeze({
  SECOND: 1,
  MINUTE: 60,
  HOUR: 3_600,
  DAY: 86_400,
  WEEK: 604_800,
});

// ── The schema ───────────────────────────────────────────────────────────────

const ConstraintSchema = z
  .object({
    dimension: z.enum(GOAL_DIMENSIONS),
    operator: z.enum(CONSTRAINT_OPERATORS),
    /** Absent for MINIMIZE / MAXIMIZE; required otherwise. */
    value: z.union([z.number(), z.string().trim().min(1).max(120)]).optional(),
    /** Free-form because units are domain vocabulary: KWD, DAY, KM, STARS. */
    unit: z.string().trim().min(1).max(40).optional(),
    hardness: z.enum(["HARD", "SOFT"]),
    source: z.enum(["STATED", "INFERRED"]),
    /** The words this came from. Quoting keeps the claim checkable. */
    evidence: z.string().trim().min(1).max(400).optional(),
  })
  .strict()
  .superRefine((constraint, context) => {
    const directional = (DIRECTIONAL_OPERATORS as readonly string[]).includes(
      constraint.operator,
    );
    if (directional && constraint.value !== undefined) {
      context.addIssue({
        code: "custom",
        message: "MINIMIZE and MAXIMIZE state a direction and carry no value.",
      });
    }
    if (!directional && constraint.value === undefined) {
      context.addIssue({
        code: "custom",
        message: "A bounded operator needs a value.",
      });
    }
    if (!directional && typeof constraint.value === "number" && !constraint.unit) {
      // A bare number is not a requirement. "at most 2" of what?
      context.addIssue({ code: "custom", message: "A numeric bound needs a unit." });
    }
  });

export type GoalConstraint = z.infer<typeof ConstraintSchema>;

/**
 * The goal, as the model proposes it.
 *
 * `.strict()` throughout: an unexpected key is a prompt bug or an injection
 * landing, and both deserve to be loud rather than ignored.
 */
export const GoalSpecSchema = z
  .object({
    version: z.literal(1),
    /** What must become true. Prose, because outcomes are not enumerable. */
    outcome: z.string().trim().min(1).max(2_000),
    constraints: z.array(ConstraintSchema).max(20).default([]),
    /** The dimensions that matter, most important first. Ties are not encoded. */
    preferences: z.array(z.enum(GOAL_DIMENSIONS)).max(GOAL_DIMENSIONS.length).default([]),
    /** What the model inferred and the person did not say. */
    assumptions: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
    /** What must be asked before acting. A non-empty list blocks. */
    unknowns: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
  })
  .strict();

export type GoalSpec = z.infer<typeof GoalSpecSchema>;

// ── Authority ────────────────────────────────────────────────────────────────

/**
 * Keys a goal may never carry.
 *
 * Each one ends a conversation the model is not entitled to end. A goal states
 * what should happen; it may not declare that it has been approved, that a
 * requirement has been waived, or that a confirmation can be skipped. These
 * join the shared authority set rather than being checked separately, so one
 * sanitiser covers every model output.
 */
export const GOAL_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "constraintwaived",
  "waiveconstraint",
  "overrideconstraint",
  "ignoreconstraint",
  "hardnessoverride",
  "constraintsatisfied",
  "goalachieved",
  "goalcomplete",
  "budgetapproved",
  "approvedbyowner",
]);

// ── Validation ───────────────────────────────────────────────────────────────

/** Why a goal cannot be acted on, or how it was changed to make it honest. */
export type GoalAdjustment = {
  readonly code: "INFERRED_CONSTRAINT_DOWNGRADED";
  readonly dimension: GoalDimension;
  readonly detail: string;
};

export type GoalConflict = {
  readonly code: "CONTRADICTORY_HARD_BOUNDS" | "INCOMPARABLE_HARD_BOUNDS";
  readonly dimension: GoalDimension;
  readonly detail: string;
};

/**
 * Whether the goal can be acted on at all — before anyone asks how.
 *
 * `NEEDS_INPUT` and `UNSATISFIABLE` are different answers and must stay
 * different. The first is "ask the person"; the second is "no plan can exist".
 * Reporting the second as the first sends somebody away to answer a question
 * that will not help.
 */
export type GoalReadiness = "ACTIONABLE" | "NEEDS_INPUT" | "UNSATISFIABLE";

export type GoalEvaluation = {
  readonly readiness: GoalReadiness;
  /** The goal after honesty adjustments. Never more permissive than proposed. */
  readonly goal: GoalSpec;
  readonly adjustments: readonly GoalAdjustment[];
  readonly conflicts: readonly GoalConflict[];
  /** Hard requirements, after downgrades. What a future plan must satisfy. */
  readonly hardConstraints: readonly GoalConstraint[];
  /** Directions, after downgrades. What a future plan may rank by. */
  readonly softConstraints: readonly GoalConstraint[];
};

/** A numeric bound in a comparable unit, or `null` when it cannot be compared. */
function comparable(constraint: GoalConstraint): { value: number; unit: string } | null {
  if (typeof constraint.value !== "number" || !constraint.unit) return null;
  const unit = constraint.unit.toUpperCase();
  if (constraint.dimension === "TIME") {
    const factor = SECONDS_PER_UNIT[unit];
    // An unrecognised time unit is not silently treated as seconds.
    return factor ? { value: constraint.value * factor, unit: "SECOND" } : null;
  }
  // Every other dimension compares only within one unit. Two costs in
  // different currencies need a rate, and a rate is external data this module
  // does not have — guessing one would be an invented fact.
  return { value: constraint.value, unit };
}

/**
 * HARD bounds on one dimension that cannot all hold.
 *
 * Only impossibility is reported. `AT_MOST 5` with `AT_MOST 3` is redundant,
 * not contradictory, and narrowing a requirement is the person's prerogative.
 */
function contradictions(constraints: readonly GoalConstraint[]): GoalConflict[] {
  const conflicts: GoalConflict[] = [];
  for (const dimension of GOAL_DIMENSIONS) {
    const onDimension = constraints.filter(
      (constraint) => constraint.dimension === dimension && constraint.hardness === "HARD",
    );
    if (onDimension.length < 2) continue;

    const bounded = onDimension.filter((constraint) =>
      (BOUNDED_OPERATORS as readonly string[]).includes(constraint.operator),
    );
    const points = bounded.map((constraint) => ({ constraint, point: comparable(constraint) }));

    const units = new Set(
      points.flatMap(({ point }) => (point ? [point.unit] : [])),
    );
    // A bound this module cannot place on a number line is NOT one it may
    // ignore. Dropping it would let «خلال أسبوعين» beside «لا تقل عن شهر» pass
    // as satisfiable because one of the two was unreadable — silently
    // discarding a hard requirement, which is the failure this file exists to
    // refuse. It is reported as incomparable instead.
    const uncomparable = points.filter(({ point }) => point === null).length;
    if (units.size > 1 || uncomparable > 0) {
      const named = [...units, ...(uncomparable > 0 ? ["unrecognised"] : [])];
      conflicts.push({
        code: "INCOMPARABLE_HARD_BOUNDS",
        dimension,
        // Not a contradiction and not a pass: two hard bounds nobody can check
        // against each other must be surfaced, not assumed compatible.
        detail: `Two hard bounds on ${dimension} use units that cannot be compared (${named.join(", ")}).`,
      });
      continue;
    }

    let lower = Number.NEGATIVE_INFINITY;
    let upper = Number.POSITIVE_INFINITY;
    const equals: number[] = [];
    for (const { constraint, point } of points) {
      if (!point) continue;
      if (constraint.operator === "AT_MOST") upper = Math.min(upper, point.value);
      if (constraint.operator === "AT_LEAST") lower = Math.max(lower, point.value);
      if (constraint.operator === "EQUALS") equals.push(point.value);
    }
    const distinctEquals = new Set(equals);
    const impossible =
      lower > upper ||
      distinctEquals.size > 1 ||
      [...distinctEquals].some((value) => value < lower || value > upper);

    if (impossible) {
      conflicts.push({
        code: "CONTRADICTORY_HARD_BOUNDS",
        dimension,
        detail: `No value of ${dimension} satisfies every hard bound stated for it.`,
      });
    }
  }
  return conflicts;
}

/**
 * Check a proposed goal and return what may be relied on.
 *
 * Pure. No model, no database, no clock. The same goal evaluates the same way
 * every time, which is what makes the verdict quotable back to a person.
 */
export function evaluateGoalSpec(proposed: GoalSpec): GoalEvaluation {
  const adjustments: GoalAdjustment[] = [];

  const constraints = proposed.constraints.map((constraint) => {
    // The one honesty rule, applied before anything else reads `hardness`.
    if (constraint.source === "INFERRED" && constraint.hardness === "HARD") {
      adjustments.push({
        code: "INFERRED_CONSTRAINT_DOWNGRADED",
        dimension: constraint.dimension,
        detail:
          `A ${constraint.dimension} requirement the model inferred was proposed as HARD. ` +
          "It is treated as SOFT: an inference may guide, it may not exclude.",
      });
      return { ...constraint, hardness: "SOFT" as const };
    }
    return constraint;
  });

  const goal: GoalSpec = { ...proposed, constraints };
  const conflicts = contradictions(constraints);
  const hardConstraints = constraints.filter((constraint) => constraint.hardness === "HARD");
  const softConstraints = constraints.filter((constraint) => constraint.hardness === "SOFT");

  // Order matters. An unsatisfiable goal stays unsatisfiable even with open
  // questions, because answering them cannot make it possible — and sending
  // somebody to answer a question that will not help is its own small lie.
  const readiness: GoalReadiness =
    conflicts.length > 0 ? "UNSATISFIABLE" : goal.unknowns.length > 0 ? "NEEDS_INPUT" : "ACTIONABLE";

  return { readiness, goal, adjustments, conflicts, hardConstraints, softConstraints };
}

/**
 * Parse a model's proposed goal, refusing authority and unexpected shape.
 *
 * Throws `ModelOutputAuthorityError` when the model claims authority, and a
 * `ZodError` when the shape is wrong. Both are loud on purpose: a goal is the
 * first link in the trust chain, and a malformed first link should not be
 * repaired into a plausible one.
 */
export function parseProposedGoalSpec(value: unknown): GoalSpec {
  const sanitized = sanitizeModelStructuredOutput(value, { label: "goal spec" });
  return GoalSpecSchema.parse(sanitized.value);
}

/**
 * A short, truthful Arabic statement of why a goal cannot be acted on yet.
 *
 * Returns `undefined` for an actionable goal — there is nothing to say, and
 * saying something anyway trains people to ignore the message.
 */
export function goalBlockerMessage(evaluation: GoalEvaluation): string | undefined {
  if (evaluation.readiness === "UNSATISFIABLE") {
    const dimensions = [...new Set(evaluation.conflicts.map((conflict) => conflict.dimension))];
    return `الشروط المطلوبة متعارضة (${dimensions.join("، ")}). لا يمكن تحقيقها معاً كما هي.`;
  }
  if (evaluation.readiness === "NEEDS_INPUT") {
    return `أحتاج توضيحاً قبل البدء: ${evaluation.goal.unknowns.join("، ")}`;
  }
  return undefined;
}
