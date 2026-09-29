/**
 * THE THING THAT DECIDES WHETHER A CONDITION HAS COME TRUE.
 *
 * ── THE GAP, TRACED EXACTLY ─────────────────────────────────────────────────
 *
 * «إذا نزل المنتج تحت ٥٠، جهّز لي طلباً — ولا تنفّذ بدون موافقتي».
 *
 * `fireDueTemporalTriggers` handles a CONDITION trigger like this:
 *
 *     const verdict = evaluator
 *       ? await evaluator.evaluate(trigger.condition ?? {}, { ownerId })
 *       : undefined;
 *     if (verdict !== true) { reschedule; continue; }
 *
 * `ConditionEvaluator` is an injected seam, optional at every layer that passes
 * it on — `runBlock2Sweep`, `makeTemporalScanHandler`, `createBlock2Worker` —
 * and `boot.ts` constructs the worker with `{ resumeNode }` and NOTHING ELSE.
 *
 * So in production `evaluator` is undefined, the verdict is permanently
 * `undefined`, and EVERY CONDITION TRIGGER RESCHEDULES FOREVER AND NEVER FIRES.
 * The mechanism is careful, fail-closed and correct; it was one wire short of
 * being able to happen at all.
 *
 * ── ONE CONDITION LANGUAGE ──────────────────────────────────────────────────
 *
 *   TWO_CONDITION_LANGUAGES = 0
 *
 * The monitoring runtime already owns a condition vocabulary: a closed set of
 * operators, dotted field paths, scalar leaves, three-valued results, a depth
 * bound, and a screen that refuses anything executable smuggled into a string.
 * Writing a second grammar here would mean two things called «condition» that
 * drift, and the drift would resolve in favour of whichever one said TRUE.
 *
 * So a trigger's condition IS a monitor condition, validated by the same
 * `validateCondition` and evaluated by the same `evaluateCondition`.
 *
 * ── WHAT IT REFUSES TO CONFUSE ──────────────────────────────────────────────
 *
 *   UNREADABLE_CONDITION != FALSE_CONDITION
 *     A condition this runtime cannot read has not been found false. It is
 *     unknown, and unknown neither fires nor claims failure.
 *
 *   NO_READING != FALSE
 *     Nothing having been observed is not «the level is fine». The subject may
 *     simply never have been reported on.
 *
 *   CONDITION_READS_ONLY_THE_OWNERS_OWN
 *     Evaluating is a READ, and a read does not reach further than the scope
 *     that asked for it — the same rule, and the same query shape, monitoring
 *     already uses.
 *
 *   A_CONDITION_IS_NOT_AN_AUTHORITY
 *     A true condition dispatches a continuation. Whatever that continuation
 *     resumes still faces its own approval gate, its own policy and its own
 *     effect contract. Nothing here authorizes anything.
 *
 *     TARGET / CONDITION != EXECUTION AUTHORITY
 *
 * ── AND IT IS NOT A DOMAIN ──────────────────────────────────────────────────
 *
 * No stock level, no price, no threshold type. A subject, an observation type,
 * and a condition — all three are data.
 *
 *   DOMAIN_CONDITIONS_ADDED = 0
 */
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { observations } from "@db/schema";
import type { ConditionEvaluator } from "./block2/temporal";
import { evaluateCondition, validateCondition } from "./monitoring-runtime";

type Db = NodePgDatabase<any>;

/**
 * WHAT A TRIGGER'S CONDITION HAS TO SAY.
 *
 * A condition needs something to be about. «If it drops below fifty» is not a
 * question until something says fifty of what, on which thing — so a trigger
 * that names no subject is unreadable rather than false.
 */
type ReadableCondition = {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly observationType: string;
  readonly when: unknown;
};

function readable(condition: Record<string, unknown>): ReadableCondition | null {
  const subjectKind = condition.subjectKind;
  const subjectId = condition.subjectId;
  const observationType = condition.observationType;
  if (
    typeof subjectKind !== "string" || !subjectKind.trim() ||
    typeof subjectId !== "string" || !subjectId.trim() ||
    typeof observationType !== "string" || !observationType.trim() ||
    condition.when === undefined
  ) {
    return null;
  }
  return {
    subjectKind: subjectKind.trim(),
    subjectId: subjectId.trim(),
    observationType: observationType.trim(),
    when: condition.when,
  };
}

/**
 * The production evaluator.
 *
 * Returns `true` only when the condition is READ and found to hold. Everything
 * else — unreadable, unobserved, or genuinely uncertain — returns `undefined`,
 * which is the seam's own word for «truthfully unknown, poll again».
 *
 * It never returns `false` for an absence of knowledge. `false` is reserved for
 * a condition that was read against a real reading and did not hold.
 */
export function canonicalConditionEvaluator(db: Db): ConditionEvaluator {
  return {
    async evaluate(
      condition: Record<string, unknown>,
      context: { ownerId: string },
    ): Promise<boolean | undefined> {
      const shape = readable(condition ?? {});
      //   UNREADABLE_CONDITION != FALSE_CONDITION
      if (!shape) return undefined;

      let parsed;
      try {
        // The same validation a monitor's condition passes, including the
        // screen for executable text. A condition that cannot be validated is
        // unknown here rather than throwing into the sweep: one malformed
        // trigger must not stop every other one from being evaluated.
        parsed = validateCondition(shape.when);
      } catch {
        return undefined;
      }

      // Two readings, newest first: the condition vocabulary has operators
      // (`changed`, `entered_state`, `left_state`) that are about a TRANSITION,
      // and a transition needs the reading before this one. Without it those
      // operators already answer UNKNOWN by themselves.
      //
      //   CONDITION_READS_ONLY_THE_OWNERS_OWN — scoped to the trigger's owner,
      //   the same query shape monitoring uses.
      const rows = await db
        .select()
        .from(observations)
        .where(
          and(
            eq(observations.subjectKind, shape.subjectKind),
            eq(observations.subjectId, shape.subjectId),
            eq(observations.observationType, shape.observationType),
            eq(observations.ownerId, context.ownerId),
          ),
        )
        .orderBy(desc(observations.observedAt))
        .limit(2);

      const newest = rows[0];
      //   NO_READING != FALSE — nothing observed is not «it is fine».
      if (!newest) return undefined;

      const facts = (newest.payload ?? {}) as Record<string, unknown>;
      const previous = rows[1]
        ? ((rows[1].payload ?? {}) as Record<string, unknown>)
        : undefined;

      const verdict = evaluateCondition(parsed, facts, previous);
      if (verdict === "TRUE") return true;
      if (verdict === "FALSE") return false;
      return undefined;
    },
  };
}
