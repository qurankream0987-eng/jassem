/**
 * JASIM — THE GENERAL MONITORING ENGINE.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   CONVERSATION
 *     -> MONITORING INTENT
 *       -> STANDING CONDITION
 *         -> AUTHORIZED OBSERVATION SOURCE
 *           -> DURABLE EVALUATION
 *             -> STATE TRANSITION
 *               -> NOTIFICATION INTENT
 *                 -> observation · verification · persistence
 *
 *   CONDITION_MATCHED != USER_NOTIFIED
 *   LEVEL             != EDGE
 *   UNKNOWN           != FALSE
 *   UNKNOWN           != ABSENT
 *   MONITORING AUTHORITY != EXECUTION AUTHORITY
 *
 * ─── WHAT WAS ALREADY THERE, AND IS REUSED ──────────────────────────────────
 *
 * The scheduler is `runtime_jobs` and the Block 2 sweep, which is itself a
 * durable job that re-enqueues its own next tick. The observation is
 * `observations` with `observationFreshness`. The ledger is `events`, ordered
 * by a serial id. The notification is `notification_intents`, which already
 * knows how to say BLOCKED_BY_PROVIDER per channel. None of those is rebuilt.
 *
 *   SECOND_SCHEDULERS_ADDED    = 0
 *   SECOND_OBSERVATION_SYSTEMS = 0
 *   SECOND_EVENT_LEDGERS       = 0
 *   SECOND_NOTIFICATION_TRUTHS = 0
 *
 * ─── WHAT WAS MISSING ───────────────────────────────────────────────────────
 *
 * `temporal_triggers` has had a CONDITION kind since Block 2, evaluated by an
 * INJECTED `ConditionEvaluator`. `api/boot.ts` constructs the worker with a
 * `resumeNode` and no evaluator, so a condition trigger has always polled
 * forever and never fired. Its `condition` column is untyped `jsonb`: there
 * was no condition language to evaluate even if something had been wired.
 *
 * And a trigger is a DAG continuation — `runId`, `nodeId`, `resumeNode`. There
 * was nowhere to keep WHAT a person is watching, WHAT counts as a match, and
 * what the LAST evaluation concluded, which is what lets a repeating poll tell
 * «it is true» apart from «it just became true».
 *
 * ─── AND WHAT THIS IS NOT ───────────────────────────────────────────────────
 *
 * Not a PriceMonitor, a DeliveryMonitor, a FlightMonitor, a DeviceMonitor or a
 * StockMonitor. A price and a temperature differ in the observation's payload
 * and in nothing the engine knows about.
 *
 *   DOMAIN_MONITOR_TYPES_ADDED = 0
 *   DOMAIN_WATCHERS_ADDED      = 0
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../queries/connection";
import {
  events,
  monitorEvaluations,
  observations,
  standingMonitors,
  type MonitorEvaluation,
  type Observation,
  type StandingMonitor,
} from "../../db/schema";
import { observationFreshness } from "./effect-observation-bridge";
import { assertNoExecutableCode } from "./world-runtime";
import { authorizeScopeAction, type ActingScope } from "./actor-scope";
import { evaluatePolicies } from "./policy-enforcement";
import type { Freshness } from "./canonical-dataset";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, and naming nothing that is watched
// ─────────────────────────────────────────────────────────────────────────────

/** Where a verdict may come from. Not what the verdict is ABOUT. */
export const MONITOR_SOURCE_CLASSES = [
  /** A canonical `observations` row for the subject. */
  "OBSERVATION",
  /** An authorized read the scope may perform, with its own freshness. */
  "AUTHORIZED_QUERY",
  /** A durable event in the ledger, consumed by cursor. */
  "WORLD_EVENT",
  /** The expected observation that did NOT arrive inside a window. */
  "ABSENCE",
] as const;
export type MonitorSourceClass = (typeof MONITOR_SOURCE_CLASSES)[number];

export const MONITOR_STATES = [
  "ACTIVE",
  "PAUSED",
  "TRIGGERED",
  "COMPLETED",
  "CANCELLED",
  /** Alive, and something it needs is not available. Never silently false. */
  "BLOCKED",
] as const;
export type MonitorState = (typeof MONITOR_STATES)[number];

/**
 * LEVEL — «هل هو أقل من ٥٠ الآن؟»
 * EDGE  — «هل نزل تحت ٥٠ للتو؟»
 *
 * The distinction §10 exists for: a repeating LEVEL poll on an unchanged fact
 * would notify every minute forever.
 */
export const MONITOR_EVALUATION_MODES = ["LEVEL", "EDGE"] as const;
export type MonitorEvaluationMode = (typeof MONITOR_EVALUATION_MODES)[number];

export const MONITOR_REPEAT_POLICIES = ["ONE_SHOT", "REPEATING"] as const;
export type MonitorRepeatPolicy = (typeof MONITOR_REPEAT_POLICIES)[number];

/**
 * What a monitor may DO when its condition matches.
 *
 * `NOTIFY` creates a notification INTENT and delivers nothing. `NONE` records
 * the transition and stops there. Nothing else, and deliberately: a monitor
 * detects, and every downstream act has to satisfy its own authority.
 *
 *   TARGET / CONDITION != EXECUTION AUTHORITY
 */
export const MONITOR_ACTION_KINDS = ["NOTIFY", "NONE"] as const;
export type MonitorActionKind = (typeof MONITOR_ACTION_KINDS)[number];

/** A verdict is three-valued. Collapsing it is how a stale reading decides. */
export const MONITOR_RESULTS = ["TRUE", "FALSE", "UNKNOWN"] as const;
export type MonitorResult = (typeof MONITOR_RESULTS)[number];

export const MONITOR_TRANSITIONS = ["NONE", "RISING", "FALLING", "REPEAT"] as const;
export type MonitorTransition = (typeof MONITOR_TRANSITIONS)[number];

/**
 * Keys a caller may never supply. Each one is the request trying to BE the
 * answer. Mirrored against `AUTHORITY_KEYS`, and a test holds the two together.
 */
export const MONITOR_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "ownerid",
  "scopeid",
  "principalid",
  "createdby",
  "actingscopeid",
  "organizationid",
  "businessid",
  "membership",
  "permission",
  "permissions",
  "authorized",
  "authorization",
  "approved",
  "approval",
  "policydecision",
  "policyoverride",
  "triggered",
  "matched",
  "notified",
  "delivered",
  // `state` is not here and is still refused: the request schema is
  // `.strict()` and never declared it. It stays out of this set because the
  // shared `AUTHORITY_KEYS` screens every model output in the runtime, and a
  // lifecycle field named `state` is an ordinary word elsewhere.
  "status",
  "verified",
]);

export class MonitorError extends Error {
  readonly code:
    | "INVALID"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "UNSUPPORTED"
    | "STATE";
  constructor(message: string, code: MonitorError["code"]) {
    super(message);
    this.code = code;
    this.name = "MonitorError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The condition language — typed, closed, and never executable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A field path into an observation's payload. Lower-case, dotted, bounded.
 *
 * Not an expression. There is no arithmetic, no function call and no
 * interpolation, because a condition that could compute could also do.
 */
const FIELD = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, "A field is a lower-case dotted path.");

const SCALAR = z.union([z.string().max(400), z.number(), z.boolean()]);

const COMPARISONS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "contains",
] as const;

export const MONITOR_OPERATORS = [
  ...COMPARISONS,
  "exists",
  "changed",
  "entered_state",
  "left_state",
  "within_range",
  "all",
  "any",
  "not",
] as const;
export type MonitorOperator = (typeof MONITOR_OPERATORS)[number];

export type MonitorCondition =
  | { op: (typeof COMPARISONS)[number]; field: string; value: string | number | boolean }
  | { op: "exists"; field: string }
  | { op: "changed"; field: string }
  | { op: "entered_state" | "left_state"; field: string; value: string }
  | { op: "within_range"; field: string; min: number; max: number }
  | { op: "all" | "any"; of: MonitorCondition[] }
  | { op: "not"; of: MonitorCondition };

/** Depth-bounded on purpose: nothing lawful nests this far. */
const MAX_CONDITION_DEPTH = 6;

const ConditionSchema: z.ZodType<MonitorCondition> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(COMPARISONS), field: FIELD, value: SCALAR }).strict(),
    z.object({ op: z.literal("exists"), field: FIELD }).strict(),
    z.object({ op: z.literal("changed"), field: FIELD }).strict(),
    z
      .object({
        op: z.enum(["entered_state", "left_state"]),
        field: FIELD,
        value: z.string().trim().min(1).max(120),
      })
      .strict(),
    z
      .object({ op: z.literal("within_range"), field: FIELD, min: z.number(), max: z.number() })
      .strict(),
    z.object({ op: z.enum(["all", "any"]), of: z.array(ConditionSchema).min(1).max(12) }).strict(),
    z.object({ op: z.literal("not"), of: ConditionSchema }).strict(),
  ]) as z.ZodType<MonitorCondition>,
);

function depthOf(condition: MonitorCondition, depth = 1): number {
  if (condition.op === "all" || condition.op === "any") {
    return Math.max(...condition.of.map((child) => depthOf(child, depth + 1)));
  }
  if (condition.op === "not") return depthOf(condition.of, depth + 1);
  return depth;
}

function walkKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      visit(key);
      walkKeys(item, visit);
    }
  }
}

/**
 * A monitoring request may not name the decision.
 *
 * Checked on the RAW input, before the schema: `.strict()` would call an
 * authority claim an "unexpected key", which is the wrong sentence for a
 * caller that tried to say it was already triggered.
 */
export function assertNoMonitorAuthorityClaim(value: unknown): void {
  walkKeys(value, (key) => {
    if (MONITOR_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new MonitorError(
        `«${key}» is the runtime's word, not the request's. A monitor may say what to watch and what counts as a match; it may not say whose it is, that it matched, or that anybody was told.`,
        "FORBIDDEN",
      );
    }
  });
}

/**
 * Validate a proposed condition, or refuse it.
 *
 *   MODEL PROPOSES != RUNTIME OWNS
 *
 * There is no raw JavaScript, no `eval`, no SQL and no expression string here
 * by construction: every leaf is an operator from a closed set with a dotted
 * field path and a scalar. `assertNoExecutableCode` — the same screen the world
 * runtime uses, so there is one of it — catches a program smuggled into a
 * string value.
 */
export function validateCondition(proposal: unknown): MonitorCondition {
  assertNoMonitorAuthorityClaim(proposal);
  try {
    // ONE screen for executable text in this runtime, borrowed from the world
    // runtime rather than written a second time. Its refusal is re-thrown in
    // this module's vocabulary so a monitoring caller is not handed a world
    // error about a condition.
    assertNoExecutableCode(proposal);
  } catch (error) {
    throw new MonitorError(
      error instanceof Error ? error.message : "That condition carries something executable.",
      "INVALID",
    );
  }
  const parsed = ConditionSchema.safeParse(proposal);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MonitorError(
      `That is not a condition this runtime can evaluate: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "invalid"}.`,
      "INVALID",
    );
  }
  if (depthOf(parsed.data) > MAX_CONDITION_DEPTH) {
    throw new MonitorError("That condition nests further than anything lawful does.", "INVALID");
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluating a condition against facts
// ─────────────────────────────────────────────────────────────────────────────

type Facts = Record<string, unknown>;

function factAt(facts: Facts, path: string): unknown {
  let node: unknown = facts;
  for (const segment of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Three-valued AND/OR. An unknown leaf does not become a false one. */
function and3(left: MonitorResult, right: MonitorResult): MonitorResult {
  if (left === "FALSE" || right === "FALSE") return "FALSE";
  if (left === "UNKNOWN" || right === "UNKNOWN") return "UNKNOWN";
  return "TRUE";
}

function or3(left: MonitorResult, right: MonitorResult): MonitorResult {
  if (left === "TRUE" || right === "TRUE") return "TRUE";
  if (left === "UNKNOWN" || right === "UNKNOWN") return "UNKNOWN";
  return "FALSE";
}

function compare(
  op: (typeof COMPARISONS)[number],
  actual: unknown,
  expected: string | number | boolean,
): MonitorResult {
  if (actual === undefined || actual === null) return "UNKNOWN";
  if (op === "equals") return actual === expected ? "TRUE" : "FALSE";
  if (op === "not_equals") return actual !== expected ? "TRUE" : "FALSE";
  if (op === "contains") {
    if (typeof actual === "string" && typeof expected === "string") {
      return actual.includes(expected) ? "TRUE" : "FALSE";
    }
    if (Array.isArray(actual)) return actual.includes(expected) ? "TRUE" : "FALSE";
    // A containment question about something that contains nothing is not
    // false — it is a question this reading cannot answer.
    return "UNKNOWN";
  }
  if (typeof actual !== "number" || typeof expected !== "number") return "UNKNOWN";
  switch (op) {
    case "greater_than":
      return actual > expected ? "TRUE" : "FALSE";
    case "greater_or_equal":
      return actual >= expected ? "TRUE" : "FALSE";
    case "less_than":
      return actual < expected ? "TRUE" : "FALSE";
    case "less_or_equal":
      return actual <= expected ? "TRUE" : "FALSE";
  }
}

/**
 * Evaluate a condition against the facts now, and the facts last time.
 *
 * `previous` is what makes `changed`, `entered_state` and `left_state` mean
 * anything. With no previous evaluation they are UNKNOWN rather than false: a
 * monitor created a second ago has not seen anything change.
 */
export function evaluateCondition(
  condition: MonitorCondition,
  facts: Facts,
  previous: Facts | undefined,
): MonitorResult {
  switch (condition.op) {
    case "exists": {
      const value = factAt(facts, condition.field);
      return value === undefined || value === null ? "FALSE" : "TRUE";
    }
    case "changed": {
      if (!previous) return "UNKNOWN";
      const before = factAt(previous, condition.field);
      const now = factAt(facts, condition.field);
      if (now === undefined && before === undefined) return "UNKNOWN";
      return JSON.stringify(before ?? null) === JSON.stringify(now ?? null) ? "FALSE" : "TRUE";
    }
    case "entered_state": {
      if (!previous) return "UNKNOWN";
      const before = factAt(previous, condition.field);
      const now = factAt(facts, condition.field);
      if (now === undefined) return "UNKNOWN";
      return now === condition.value && before !== condition.value ? "TRUE" : "FALSE";
    }
    case "left_state": {
      if (!previous) return "UNKNOWN";
      const before = factAt(previous, condition.field);
      const now = factAt(facts, condition.field);
      if (now === undefined) return "UNKNOWN";
      return before === condition.value && now !== condition.value ? "TRUE" : "FALSE";
    }
    case "within_range": {
      const value = factAt(facts, condition.field);
      if (typeof value !== "number") return "UNKNOWN";
      return value >= condition.min && value <= condition.max ? "TRUE" : "FALSE";
    }
    case "all":
      return condition.of
        .map((child) => evaluateCondition(child, facts, previous))
        .reduce(and3, "TRUE" as MonitorResult);
    case "any":
      return condition.of
        .map((child) => evaluateCondition(child, facts, previous))
        .reduce(or3, "FALSE" as MonitorResult);
    case "not": {
      const inner = evaluateCondition(condition.of, facts, previous);
      return inner === "UNKNOWN" ? "UNKNOWN" : inner === "TRUE" ? "FALSE" : "TRUE";
    }
    default:
      return compare(condition.op, factAt(facts, condition.field), condition.value);
  }
}

/**
 * What the transition was, given the previous verdict.
 *
 *   RISING  — it just became true. This is what EDGE fires on.
 *   REPEAT  — it was already true and still is. This is the storm §10 warns of.
 *   FALLING — it stopped being true.
 *
 * An UNKNOWN previous verdict is not a false one, so a monitor that could not
 * read yesterday does not report a rise today just because it can read now —
 * unless it genuinely was FALSE before.
 */
export function transitionOf(
  previous: MonitorResult | null,
  current: MonitorResult,
): MonitorTransition {
  // Every true reading that was not already true is a rise — including the
  // first one ever, and one that follows an UNKNOWN. «أخبرني إذا نزل تحت ٥٠»
  // said about a price that is already below fifty is answered, not deferred
  // until it goes up and comes back down. What §10 warns about is the REPEAT
  // below, and that is the case this separates out.
  if (current === "TRUE") return previous === "TRUE" ? "REPEAT" : "RISING";
  if (current === "FALSE" && previous === "TRUE") return "FALLING";
  return "NONE";
}

/** Whether this transition fires, under this monitor's declared policy. */
export function firesOn(
  mode: MonitorEvaluationMode,
  repeat: MonitorRepeatPolicy,
  transition: MonitorTransition,
): boolean {
  if (transition === "RISING") return true;
  // A LEVEL monitor asked «is it true», so a repeat is an answer. An EDGE one
  // asked «did it become true», and a repeat is not.
  if (transition === "REPEAT") return mode === "LEVEL" && repeat === "REPEATING";
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Creating a monitor
// ─────────────────────────────────────────────────────────────────────────────

/** What a model may propose. Strict, and naming no decision. */
export const MonitorRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    subjectKind: z.string().trim().min(1).max(64),
    subjectId: z.string().trim().min(1).max(64),
    observationType: z.string().trim().min(1).max(64),
    sourceClass: z.enum(MONITOR_SOURCE_CLASSES).default("OBSERVATION"),
    condition: z.unknown(),
    evaluationMode: z.enum(MONITOR_EVALUATION_MODES).default("EDGE"),
    repeatPolicy: z.enum(MONITOR_REPEAT_POLICIES).default("ONE_SHOT"),
    freshnessRequirement: z.enum(["CURRENT", "ANY"]).default("CURRENT"),
    windowMs: z.number().int().min(1_000).max(30 * 24 * 3_600_000).optional(),
    pollMs: z.number().int().min(1_000).max(24 * 3_600_000).optional(),
    actionKind: z.enum(MONITOR_ACTION_KINDS).default("NOTIFY"),
    actionChannels: z.array(z.string().trim().min(1).max(24)).max(5).default([]),
  })
  .strict();
export type MonitorRequest = z.input<typeof MonitorRequestSchema>;

export type MonitorRecord = {
  readonly monitorId: string;
  readonly scopeId: string;
  readonly label: string;
  readonly subject: { kind: string; id: string; observationType: string };
  readonly sourceClass: MonitorSourceClass;
  readonly condition: MonitorCondition;
  readonly evaluationMode: MonitorEvaluationMode;
  readonly repeatPolicy: MonitorRepeatPolicy;
  readonly freshnessRequirement: "CURRENT" | "ANY";
  readonly state: MonitorState;
  readonly lastEvaluationAt: string | null;
  readonly lastResult: MonitorResult | null;
  readonly lastFreshness: Freshness | null;
  readonly lastMatchedAt: string | null;
  readonly triggerCount: number;
  readonly cursor: number;
  readonly version: number;
};

function recordOf(row: StandingMonitor): MonitorRecord {
  return {
    monitorId: row.id,
    scopeId: row.scopeId,
    label: row.label,
    subject: { kind: row.subjectKind, id: row.subjectId, observationType: row.observationType },
    sourceClass: row.sourceClass as MonitorSourceClass,
    condition: row.condition as unknown as MonitorCondition,
    evaluationMode: row.evaluationMode as MonitorEvaluationMode,
    repeatPolicy: row.repeatPolicy as MonitorRepeatPolicy,
    freshnessRequirement: row.freshnessRequirement as "CURRENT" | "ANY",
    state: row.state as MonitorState,
    lastEvaluationAt: row.lastEvaluationAt?.toISOString() ?? null,
    lastResult: (row.lastResult as MonitorResult | null) ?? null,
    lastFreshness: (row.lastFreshness as Freshness | null) ?? null,
    lastMatchedAt: row.lastMatchedAt?.toISOString() ?? null,
    triggerCount: row.triggerCount,
    cursor: row.cursor,
    version: row.version,
  };
}

/**
 * «راقب هذا وأخبرني إذا تغيّر».
 *
 * Watching is a READ that keeps happening, so creating one needs `view` on
 * the acting scope and nothing more — and gets nothing more. A monitor that
 * could be created with a write permission would be a monitor that could be
 * mistaken for an authorization to act.
 */
export async function createMonitor(input: {
  request: unknown;
  scope: ActingScope;
  conversationId?: string;
}): Promise<MonitorRecord> {
  assertNoMonitorAuthorityClaim(input.request);
  const parsed = MonitorRequestSchema.safeParse(input.request);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MonitorError(
      `That monitoring request is not well formed: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "invalid"}.`,
      "INVALID",
    );
  }
  const request = parsed.data;
  const condition = validateCondition(request.condition);

  if (request.sourceClass === "ABSENCE" && request.windowMs === undefined) {
    //   UNKNOWN != ABSENT
    // Nothing having arrived is not the same as nothing having happened. An
    // absence claim needs the window it was expected in, or it is a guess.
    throw new MonitorError(
      "An absence needs the window the expected observation had to arrive in. Nothing having been seen is not the same as nothing having happened.",
      "INVALID",
    );
  }
  if (
    request.evaluationMode === "LEVEL" &&
    request.repeatPolicy === "REPEATING" &&
    request.actionKind === "NOTIFY"
  ) {
    // §10, said out loud instead of discovered at 3am.
    throw new MonitorError(
      "A LEVEL condition that repeats would notify on every evaluation for as long as it stays true. Ask for EDGE — «أخبرني إذا أصبح» — or keep LEVEL and take no action.",
      "INVALID",
    );
  }

  const allowed = await authorizeScopeAction({
    principalId: input.scope.principalId,
    scopeId: input.scope.scopeId,
    permission: "view",
  });
  if (!allowed.ok) {
    throw new MonitorError(`This scope may not watch that: ${allowed.reason}.`, "FORBIDDEN");
  }
  const policy = await evaluatePolicies({
    scopeId: input.scope.scopeId,
    action: "monitor.create",
    parameters: {
      subjectKind: request.subjectKind,
      observationType: request.observationType,
      actionKind: request.actionKind,
    },
  });
  if (policy.outcome === "DENIED") {
    throw new MonitorError(
      `A rule of this scope forbids watching that (${policy.reasons[0]?.policyKey ?? "policy"}).`,
      "FORBIDDEN",
    );
  }
  if (policy.outcome === "UNSUPPORTED_POLICY") {
    throw new MonitorError(
      "A rule of this scope claims to govern this and cannot be read. Nothing proceeds past a rule nobody can evaluate.",
      "FORBIDDEN",
    );
  }

  // The cursor starts where the ledger is NOW. A new monitor does not fire on
  // history it was never watching.
  const [head] = await db
    .select({ id: events.id })
    .from(events)
    .orderBy(desc(events.id))
    .limit(1);

  const [row] = await db
    .insert(standingMonitors)
    .values({
      id: `mon_${randomUUID()}`,
      scopeId: input.scope.scopeId,
      createdBy: input.scope.principalId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      label: request.label,
      subjectKind: request.subjectKind,
      subjectId: request.subjectId,
      observationType: request.observationType,
      sourceClass: request.sourceClass,
      condition: condition as unknown as Record<string, unknown>,
      evaluationMode: request.evaluationMode,
      repeatPolicy: request.repeatPolicy,
      freshnessRequirement: request.freshnessRequirement,
      ...(request.windowMs !== undefined ? { windowMs: request.windowMs } : {}),
      ...(request.pollMs !== undefined ? { pollMs: request.pollMs } : {}),
      actionKind: request.actionKind,
      actionChannels: request.actionChannels,
      state: "ACTIVE",
      cursor: head?.id ?? 0,
    })
    .returning();
  return recordOf(row!);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle — every one of them scope-authorized
// ─────────────────────────────────────────────────────────────────────────────

async function loadScoped(monitorId: string, scope: ActingScope): Promise<StandingMonitor> {
  const [row] = await db
    .select()
    .from(standingMonitors)
    .where(and(eq(standingMonitors.id, monitorId), eq(standingMonitors.scopeId, scope.scopeId)))
    .limit(1);
  // Not found and not permitted are the SAME answer across scopes. Telling a
  // stranger that a monitor exists is already telling them something.
  if (!row) throw new MonitorError("No such monitor in this scope.", "NOT_FOUND");
  return row;
}

const LIFECYCLE: Readonly<Record<string, { from: readonly MonitorState[]; to: MonitorState }>> =
  Object.freeze({
    pause: { from: ["ACTIVE", "BLOCKED"], to: "PAUSED" },
    resume: { from: ["PAUSED", "BLOCKED"], to: "ACTIVE" },
    cancel: { from: ["ACTIVE", "PAUSED", "BLOCKED", "TRIGGERED"], to: "CANCELLED" },
  });

/** «أوقف المراقبة» · «استأنفها» · «ألغها». */
export async function transitionMonitor(input: {
  monitorId: string;
  scope: ActingScope;
  action: "pause" | "resume" | "cancel";
}): Promise<MonitorRecord> {
  const row = await loadScoped(input.monitorId, input.scope);
  const rule = LIFECYCLE[input.action]!;
  if (!rule.from.includes(row.state as MonitorState)) {
    throw new MonitorError(
      `A monitor that is ${row.state} cannot be ${input.action}d.`,
      "STATE",
    );
  }
  const updated = await db
    .update(standingMonitors)
    .set({ state: rule.to, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(standingMonitors.id, row.id), eq(standingMonitors.version, row.version)))
    .returning();
  if (!updated[0]) throw new MonitorError("That monitor changed while this was decided.", "CONFLICT");
  return recordOf(updated[0]);
}

export async function readMonitor(input: {
  monitorId: string;
  scope: ActingScope;
}): Promise<MonitorRecord | undefined> {
  const [row] = await db
    .select()
    .from(standingMonitors)
    .where(
      and(eq(standingMonitors.id, input.monitorId), eq(standingMonitors.scopeId, input.scope.scopeId)),
    )
    .limit(1);
  return row ? recordOf(row) : undefined;
}

/** «ما الذي تراقبه لي؟» */
export async function listMonitors(scope: ActingScope): Promise<readonly MonitorRecord[]> {
  const rows = await db
    .select()
    .from(standingMonitors)
    .where(eq(standingMonitors.scopeId, scope.scopeId))
    .orderBy(desc(standingMonitors.createdAt));
  return rows.map(recordOf);
}

/**
 * The evaluation ledger, oldest first and resumable from a cursor.
 *
 * The realtime PREPARATION §29 asks for, and none of the transport it forbids.
 * It carries verdicts and transitions — never the payload a reading held,
 * because a private row is not an audit record.
 */
export async function monitorEvaluationsSince(input: {
  monitorId: string;
  scope: ActingScope;
  after?: number;
  limit?: number;
}): Promise<readonly MonitorEvaluation[]> {
  await loadScoped(input.monitorId, input.scope);
  const rows = await db
    .select()
    .from(monitorEvaluations)
    .where(
      input.after !== undefined
        ? and(
            eq(monitorEvaluations.monitorId, input.monitorId),
            gt(monitorEvaluations.cursor, input.after),
          )
        : eq(monitorEvaluations.monitorId, input.monitorId),
    )
    .orderBy(monitorEvaluations.cursor)
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Durable evaluation
// ─────────────────────────────────────────────────────────────────────────────

export type EvaluationOutcome = {
  readonly monitorId: string;
  readonly result: MonitorResult;
  readonly freshness: Freshness;
  readonly transition: MonitorTransition;
  readonly triggered: boolean;
  readonly state: MonitorState;
  readonly notificationIntentId?: string;
  /** True when this exact reading had already been evaluated. */
  readonly replayed: boolean;
  readonly cursor?: number;
};

/**
 * The facts a canonical observation offers a condition.
 *
 * The payload, plus the two dimensions every observation has whatever it is
 * about. A price and a temperature both arrive as `payload.value`; that is
 * data semantics, and the engine never learns which is which.
 */
function factsOf(observation: Observation): Facts {
  return {
    ...(observation.payload ?? {}),
    observed_at: observation.observedAt.toISOString(),
    source_kind: observation.sourceKind,
  };
}

/** The newest canonical observation for this monitor's subject, if any. */
async function latestFor(monitor: StandingMonitor): Promise<Observation | undefined> {
  const [row] = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.subjectKind, monitor.subjectKind),
        eq(observations.subjectId, monitor.subjectId),
        eq(observations.observationType, monitor.observationType),
        // A scope reads its own observations. Watching is a read, and a read
        // does not reach further than the scope that asked for it.
        eq(observations.ownerId, monitor.scopeId),
      ),
    )
    .orderBy(desc(observations.observedAt))
    .limit(1);
  return row;
}

/**
 * Evaluate ONE monitor against the reading in front of it.
 *
 * The whole phase in one function, and the order is the point:
 *
 *   1. is this monitor even listening?
 *   2. have we already judged this exact reading?     (replay)
 *   3. is the reading allowed to decide?              (freshness)
 *   4. what does the condition say?                   (three-valued)
 *   5. what changed since last time?                  (edge vs level)
 *   6. does that fire, under the declared policy?
 *   7. record it, atomically, guarded by the version. (concurrency)
 *   8. and only then, a notification INTENT.          (never a delivery)
 */
export async function evaluateMonitor(input: {
  monitorId: string;
  /** The reading. Omitted, the newest canonical observation is read. */
  observation?: Observation;
  sourceClass?: "SCHEDULED" | "EVENT" | "ABSENCE_WINDOW";
  now?: Date;
}): Promise<EvaluationOutcome> {
  const now = input.now ?? new Date();
  const [monitor] = await db
    .select()
    .from(standingMonitors)
    .where(eq(standingMonitors.id, input.monitorId))
    .limit(1);
  if (!monitor) throw new MonitorError("No such monitor.", "NOT_FOUND");

  // 1. A paused monitor does not evaluate. Not "evaluates and discards" —
  // nothing is read, so nothing can leak into its history either.
  if (monitor.state !== "ACTIVE") {
    return {
      monitorId: monitor.id,
      result: (monitor.lastResult as MonitorResult | null) ?? "UNKNOWN",
      freshness: (monitor.lastFreshness as Freshness | null) ?? "UNKNOWN",
      transition: "NONE",
      triggered: false,
      state: monitor.state as MonitorState,
      replayed: false,
    };
  }

  const sourceClass = input.sourceClass ?? "SCHEDULED";
  const observation = input.observation ?? (await latestFor(monitor));

  // The key a replay collides on.
  //
  // An observation has an id, and the same reading judged twice is one
  // judgement. An ABSENCE is the exception and has to be: what changes its
  // verdict is TIME, not a new reading, so judging it against the last
  // observation's id would freeze it at "something arrived recently" forever.
  // Its key is the window it is asking about, so each window is judged once
  // and the clock is allowed to change the answer.
  const evaluationKey =
    monitor.sourceClass === "ABSENCE"
      ? `absence:${Math.floor(now.getTime() / Math.max(monitor.windowMs ?? 1, 1))}`
      : observation
        ? `obs:${observation.id}`
        : `${sourceClass.toLowerCase()}:${now.toISOString()}`;

  // 2. Replay. The same observation reaching the same monitor twice is one
  // judgement, and the unique index is what makes that true under a race.
  const [already] = await db
    .select()
    .from(monitorEvaluations)
    .where(
      and(
        eq(monitorEvaluations.monitorId, monitor.id),
        eq(monitorEvaluations.evaluationKey, evaluationKey),
      ),
    )
    .limit(1);
  if (already) {
    return {
      monitorId: monitor.id,
      result: already.result as MonitorResult,
      freshness: already.freshness as Freshness,
      transition: "NONE",
      triggered: false,
      state: monitor.state as MonitorState,
      replayed: true,
      cursor: already.cursor,
    };
  }

  // 3. Freshness. A reading with no declared horizon is UNKNOWN, never
  // CURRENT — and a monitor that asked for the state NOW may not be decided
  // by yesterday's temperature.
  const freshness: Freshness = observation ? observationFreshness(observation, now) : "UNKNOWN";
  const facts = observation ? factsOf(observation) : {};
  const previous = Object.keys(monitor.lastFacts ?? {}).length > 0 ? monitor.lastFacts : undefined;

  let result: MonitorResult;
  if (monitor.sourceClass === "ABSENCE") {
    // 3b. Absence, and the only honest way to claim it: an expected
    // observation, a window it had to arrive in, and a clock.
    //
    //   UNKNOWN != ABSENT
    const window = monitor.windowMs ?? 0;
    const lastSeen = observation?.observedAt.getTime();
    const since = lastSeen ?? monitor.createdAt.getTime();
    result = now.getTime() - since >= window ? "TRUE" : "FALSE";
  } else if (monitor.freshnessRequirement === "CURRENT" && freshness !== "CURRENT") {
    // Not false. Unknown — and a monitor whose verdict is unknown has not
    // decided that the world is fine.
    result = "UNKNOWN";
  } else if (!observation) {
    result = "UNKNOWN";
  } else {
    result = evaluateCondition(
      monitor.condition as unknown as MonitorCondition,
      facts,
      previous,
    );
  }

  // 4 & 5.
  const transition = transitionOf((monitor.lastResult as MonitorResult | null) ?? null, result);
  const fires =
    firesOn(
      monitor.evaluationMode as MonitorEvaluationMode,
      monitor.repeatPolicy as MonitorRepeatPolicy,
      transition,
    ) && monitor.actionKind !== "NONE";
  const records = transition === "RISING" || fires;

  // 6. The state after this evaluation. A ONE_SHOT monitor that fired is
  // finished; a REPEATING one keeps watching.
  const nextState: MonitorState =
    records && monitor.repeatPolicy === "ONE_SHOT" ? "TRIGGERED" : (monitor.state as MonitorState);

  // 7. One guarded write. Two workers on the same monitor: the second finds
  // the version moved and does not also record a trigger.
  const updated = await db
    .update(standingMonitors)
    .set({
      lastEvaluationAt: now,
      lastResult: result,
      lastFreshness: freshness,
      ...(observation ? { lastObservationRef: observation.id } : {}),
      lastFacts: Object.keys(facts).length > 0 ? facts : monitor.lastFacts,
      ...(records ? { lastMatchedAt: now, triggerCount: monitor.triggerCount + 1 } : {}),
      state: nextState,
      version: monitor.version + 1,
      updatedAt: now,
    })
    .where(
      and(eq(standingMonitors.id, monitor.id), eq(standingMonitors.version, monitor.version)),
    )
    .returning();
  if (!updated[0]) {
    // Somebody else judged this reading first. Theirs stands.
    return {
      monitorId: monitor.id,
      result,
      freshness,
      transition: "NONE",
      triggered: false,
      state: monitor.state as MonitorState,
      replayed: true,
    };
  }

  // 8. The notification INTENT, which is not a delivery.
  //
  //   CONDITION_MATCHED != USER_NOTIFIED
  //
  // The trigger above is already durable. If this fails or the channels the
  // person asked for have no provider, the trigger does not evaporate.
  let notificationIntentId: string | undefined;
  if (fires && monitor.actionKind === "NOTIFY") {
    notificationIntentId = await createMatchNotification(monitor, result);
  }

  const [evaluation] = await db
    .insert(monitorEvaluations)
    .values({
      id: `mev_${randomUUID()}`,
      monitorId: monitor.id,
      scopeId: monitor.scopeId,
      evaluatedAt: now,
      sourceClass,
      result,
      freshness,
      transition,
      triggered: records,
      ...(observation ? { observationRef: observation.id } : {}),
      ...(notificationIntentId ? { notificationIntentId } : {}),
      evaluationKey,
    })
    .returning();

  return {
    monitorId: monitor.id,
    result,
    freshness,
    transition,
    triggered: records,
    state: nextState,
    ...(notificationIntentId ? { notificationIntentId } : {}),
    replayed: false,
    cursor: evaluation!.cursor,
  };
}

/**
 * The notification a match asks for — as an INTENT, and nothing further.
 *
 * Delivery belongs to the Trusted Executor, which is why this creates the row
 * and stops. The intent's own per-channel state is the truth about whether
 * anybody was told, and a monitor never speaks for it.
 */
async function createMatchNotification(
  monitor: StandingMonitor,
  result: MonitorResult,
): Promise<string | undefined> {
  const { createNotificationIntent } = await import("./block2/notifications");
  try {
    const intent = await createNotificationIntent(db, {
      ownerId: monitor.scopeId,
      recipientId: monitor.createdBy,
      purpose: "standing-monitor-match",
      content: {
        title: monitor.label,
        // The label and the verdict. Not the payload: a private reading is
        // not something to copy into a notification body.
        body: `الشرط الذي طلبت مراقبته تحقّق (${result}).`,
      },
      privacyClass: "standard",
      urgency: "normal",
      channels: monitor.actionChannels,
      entityRef: { kind: "standing_monitor", id: monitor.id },
      idempotencyKey: `monitor:${monitor.id}:${monitor.triggerCount + 1}`,
    });
    return intent?.id;
  } catch {
    // A notification that could not even be intended does not un-trigger the
    // monitor. The evaluation row still says it matched.
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The two modes, both on machinery that already existed
// ─────────────────────────────────────────────────────────────────────────────

export type MonitorSweepResult = {
  readonly evaluated: number;
  readonly triggered: number;
  readonly replayed: number;
};

/**
 * SCHEDULED evaluation.
 *
 * Called from the Block 2 sweep — the duty cycle that is itself a durable job
 * re-enqueueing its own next tick. There is no new scheduler here, no timer,
 * and no worker of its own, which is why a monitor survives a restart without
 * anybody writing recovery code for it.
 */
export async function sweepDueMonitors(options?: {
  now?: Date;
  limit?: number;
}): Promise<MonitorSweepResult> {
  const now = options?.now ?? new Date();
  const rows = await db
    .select()
    .from(standingMonitors)
    .where(eq(standingMonitors.state, "ACTIVE"))
    .orderBy(standingMonitors.lastEvaluationAt)
    .limit(Math.min(Math.max(options?.limit ?? 100, 1), 500));

  const result = { evaluated: 0, triggered: 0, replayed: 0 };
  for (const monitor of rows) {
    // Not due yet. The poll interval is the monitor's own, never a cron string
    // and never a domain timer.
    const last = monitor.lastEvaluationAt?.getTime();
    if (last !== undefined && now.getTime() - last < monitor.pollMs) continue;
    const outcome = await evaluateMonitor({ monitorId: monitor.id, sourceClass: "SCHEDULED", now });
    result.evaluated += 1;
    if (outcome.triggered) result.triggered += 1;
    if (outcome.replayed) result.replayed += 1;
  }
  return result;
}

/**
 * EVENT-DRIVEN evaluation.
 *
 * A canonical observation has been recorded; every ACTIVE monitor watching
 * that subject is evaluated against it. This is a real event path — the
 * observation arrives and the evaluation follows it — not a UI timer wearing
 * an event's clothes, and it needs no realtime transport to be true.
 */
export async function evaluateMonitorsForObservation(input: {
  observation: Observation;
  now?: Date;
}): Promise<readonly EvaluationOutcome[]> {
  const rows = await db
    .select()
    .from(standingMonitors)
    .where(
      and(
        eq(standingMonitors.state, "ACTIVE"),
        eq(standingMonitors.subjectKind, input.observation.subjectKind),
        eq(standingMonitors.subjectId, input.observation.subjectId),
        eq(standingMonitors.observationType, input.observation.observationType),
        // The observation's owner scope, and only it. A monitor never reaches
        // into a reading that was not its scope's to see.
        eq(standingMonitors.scopeId, input.observation.ownerId),
      ),
    );
  const outcomes: EvaluationOutcome[] = [];
  for (const monitor of rows) {
    outcomes.push(
      await evaluateMonitor({
        monitorId: monitor.id,
        observation: input.observation,
        sourceClass: "EVENT",
        ...(input.now ? { now: input.now } : {}),
      }),
    );
  }
  return outcomes;
}

/**
 * WORLD_EVENT evaluation, by cursor.
 *
 * The durable ledger the world phase built is consumed here rather than
 * polled blindly: a monitor advances its own cursor, so a restart resumes
 * exactly where it stopped and nothing between is skipped or replayed.
 */
export async function advanceWorldMonitors(input: {
  scopeId: string;
  now?: Date;
  limit?: number;
}): Promise<readonly EvaluationOutcome[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(standingMonitors)
    .where(
      and(
        eq(standingMonitors.state, "ACTIVE"),
        eq(standingMonitors.scopeId, input.scopeId),
        eq(standingMonitors.sourceClass, "WORLD_EVENT"),
      ),
    );
  const outcomes: EvaluationOutcome[] = [];
  for (const monitor of rows) {
    const pending = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.ownerId, monitor.scopeId),
          eq(events.correlationId, monitor.subjectId),
          gt(events.id, monitor.cursor),
        ),
      )
      .orderBy(events.id)
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));

    for (const event of pending) {
      const facts: Facts = {
        ...(event.payload ?? {}),
        event_type: event.type,
      };
      const outcome = await evaluateMonitor({
        monitorId: monitor.id,
        observation: {
          // A ledger entry read AS an observation of the world: it has an id,
          // an instant and a payload, and its freshness horizon is the moment
          // it was written, because an event is current when it happens.
          id: `evt_${event.id}`,
          ownerId: monitor.scopeId,
          subjectKind: monitor.subjectKind,
          subjectId: monitor.subjectId,
          observationType: monitor.observationType,
          observedAt: event.createdAt,
          sourceKind: "system",
          providerId: null,
          provenance: {},
          payload: facts,
          freshnessExpiresAt: new Date(event.createdAt.getTime() + 24 * 3_600_000),
          createdAt: event.createdAt,
        } as Observation,
        sourceClass: "EVENT",
        now,
      });
      outcomes.push(outcome);
      await db
        .update(standingMonitors)
        .set({ cursor: event.id })
        .where(eq(standingMonitors.id, monitor.id));
      if (outcome.state !== "ACTIVE") break;
    }
  }
  return outcomes;
}

// ─────────────────────────────────────────────────────────────────────────────
// What a surface may show
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical projection.
 *
 *   NO FAKE «LIVE»
 *
 * What is watched, what counts as a match, what state it is in, when it was
 * last checked, how fresh that reading was, and — said out loud — whether the
 * channels the person asked for have a provider at all.
 */
export async function projectMonitor(record: MonitorRecord): Promise<Record<string, unknown>> {
  const { getConfiguredChannelAdapters } = await import("./block2/notifications");
  const [row] = await db
    .select({ channels: standingMonitors.actionChannels, actionKind: standingMonitors.actionKind })
    .from(standingMonitors)
    .where(eq(standingMonitors.id, record.monitorId))
    .limit(1);
  const requested = row?.channels ?? [];
  const configured = new Set(
    getConfiguredChannelAdapters()
      .filter((adapter) => adapter.configured)
      .map((adapter) => adapter.channel),
  );
  return {
    monitorId: record.monitorId,
    label: record.label,
    watching: record.subject,
    condition: describeCondition(record.condition),
    mode: record.evaluationMode,
    repeat: record.repeatPolicy,
    state: record.state,
    lastCheckedAt: record.lastEvaluationAt,
    lastResult: record.lastResult ?? "UNKNOWN",
    lastFreshness: record.lastFreshness ?? "UNKNOWN",
    lastMatchedAt: record.lastMatchedAt,
    triggerCount: record.triggerCount,
    delivery: {
      action: row?.actionKind ?? "NONE",
      requestedChannels: requested,
      // The part a person is most likely to assume the other way round.
      unconfiguredChannels: requested.filter((channel) => !configured.has(channel)),
      deliveryConfigured: requested.every((channel) => configured.has(channel)),
    },
    // A monitor polls. Nothing subscribes, and nothing here says otherwise.
    live: false,
  };
}

/** A condition, rendered for a person. Never re-interpreted. */
export function describeCondition(condition: MonitorCondition): string {
  switch (condition.op) {
    case "all":
      return condition.of.map(describeCondition).join(" و ");
    case "any":
      return condition.of.map(describeCondition).join(" أو ");
    case "not":
      return `ليس (${describeCondition(condition.of)})`;
    case "exists":
      return `«${condition.field}» موجود`;
    case "changed":
      return `«${condition.field}» تغيّر`;
    case "entered_state":
      return `«${condition.field}» أصبح ${condition.value}`;
    case "left_state":
      return `«${condition.field}» لم يعد ${condition.value}`;
    case "within_range":
      return `«${condition.field}» بين ${condition.min} و ${condition.max}`;
    default: {
      const symbol: Record<string, string> = {
        equals: "=",
        not_equals: "≠",
        greater_than: ">",
        greater_or_equal: "≥",
        less_than: "<",
        less_or_equal: "≤",
        contains: "يحتوي",
      };
      return `«${condition.field}» ${symbol[condition.op] ?? condition.op} ${condition.value}`;
    }
  }
}

/** Which monitors this conversation started, so «أوقفها» resolves. */
export async function conversationMonitors(input: {
  scope: ActingScope;
  conversationId: string;
}): Promise<readonly MonitorRecord[]> {
  const rows = await db
    .select()
    .from(standingMonitors)
    .where(
      and(
        eq(standingMonitors.scopeId, input.scope.scopeId),
        eq(standingMonitors.conversationId, input.conversationId),
        inArray(standingMonitors.state, ["ACTIVE", "PAUSED", "TRIGGERED", "BLOCKED"]),
      ),
    )
    .orderBy(desc(standingMonitors.createdAt));
  return rows.map(recordOf);
}

/**
 * Record a canonical observation AND evaluate what was waiting for it.
 *
 * The event-driven entry point §5A asks for. It is a separate function rather
 * than a hook inside `recordObservation` on purpose: that primitive is called
 * with a transaction handle by callers who know nothing about monitoring, and
 * evaluating inside somebody else's transaction is how a monitor comes to fire
 * for a write that later rolled back.
 *
 * An observation recorded through the raw primitive is not lost — the
 * scheduled sweep reaches it within the monitor's own poll interval. What this
 * adds is immediacy, and it needs no transport to have it.
 */
export async function recordObservationAndEvaluate(input: {
  ownerId: string;
  subjectKind: string;
  subjectId: string;
  observationType: string;
  payload: Record<string, unknown>;
  observedAt?: Date;
  freshnessTtlMs?: number;
  sourceKind?: string;
  now?: Date;
}): Promise<{ observation: Observation; outcomes: readonly EvaluationOutcome[] }> {
  const { recordObservation } = await import("./block2/observations");
  const observation = await recordObservation(db, {
    ownerId: input.ownerId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    observationType: input.observationType,
    payload: input.payload,
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
    ...(input.freshnessTtlMs !== undefined ? { freshnessTtlMs: input.freshnessTtlMs } : {}),
    ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
  });
  const outcomes = await evaluateMonitorsForObservation({
    observation,
    ...(input.now ? { now: input.now } : {}),
  });
  return { observation, outcomes };
}
