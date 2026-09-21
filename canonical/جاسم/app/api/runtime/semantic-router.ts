/**
 * JASIM — the semantic router. Which mechanism, and nothing about doing it.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * PlanGraph could already CLASSIFY a goal that is not a DAG — an identity
 * change, a setting, a direct read, a standing condition. The active turn could
 * not ACT on that classification, because the envelope's `kind` had already
 * decided. So «أرني جدول مبيعاتي» produced a blocked execution run, and
 * «سجلني خروج» produced one too, for the same reason: they arrived as
 * `direct_action`, and `direct_action` meant "make proposals".
 *
 * Classification without routing is half a mechanism. This is the other half.
 *
 * ─── THE ONE PLACE PRECEDENCE LIVES ─────────────────────────────────────────
 *
 * `ROUTING_RULES` below is an ordered list, read top to bottom, first match
 * wins. That is the whole algorithm. It is a list rather than a chain of `if`s
 * so that the precedence is a value a test can read, and so that "why did this
 * go there" is answered by one rule code rather than by tracing branches across
 * files.
 *
 * ─── WHAT IT KNOWS NOTHING ABOUT ────────────────────────────────────────────
 *
 * There is no SalesRoute, MapRoute, JobsRoute or DriverRoute, and there is no
 * place to put one: a route names an interaction mechanism, and every domain in
 * the world uses the same nine. «أرني مبيعاتي» and «أرني البضاعة» are one
 * route. «سجلني دخول» and «سجلني خروج» are one route.
 *
 * ─── A ROUTE IS NOT A PROMISE ───────────────────────────────────────────────
 *
 * Routing correctly to a mechanism that is not built yet is the honest outcome,
 * and it is the common one today: the data layer, standing conditions and
 * secure product surfaces do not exist. Each such route returns
 * `downstream: "NOT_IMPLEMENTED"` and a canonical safe state. It must never
 * fall back to a DAG because the real destination is missing — that would
 * answer a different question just to have answered one.
 */

import type { PlanGraph, PlanValidation } from "./plan-graph";

// ── The vocabulary ───────────────────────────────────────────────────────────

/**
 * Every mechanism a turn can be routed to.
 *
 * `LEGACY_FLAT` is the pre-PlanGraph path, kept deliberately and kept VISIBLE:
 * a fallback nobody can see is indistinguishable from a decision, and the point
 * of recording it is to be able to watch it shrink.
 */
export const SEMANTIC_ROUTES = [
  "TEXT",
  "DIRECT_READ",
  "GENERATED_PRESENTATION",
  "TRUSTED_PRODUCT_ACTION",
  "GENERAL_PLANGRAPH",
  "MONITORING",
  "PERSISTENT_LIVING_OBJECT",
  "PERSISTENT_WORLD",
  "LEGACY_FLAT",
] as const;
export type SemanticRoute = (typeof SEMANTIC_ROUTES)[number];

/** Whether the mechanism a route names actually exists yet. */
export type RouteDownstream = "AVAILABLE" | "NOT_IMPLEMENTED";

/**
 * Why a turn went where it went. One code per rule, so a recorded route is
 * explainable without re-running anything.
 */
export type RouteReason =
  | "PLAN_IDENTITY_CHANGE"
  | "PLAN_SETTING_MUTATION"
  | "PLAN_MONITORING"
  | "PLAN_PERSISTENT_WORLD"
  | "PLAN_DIRECT_READ"
  | "PLAN_DAG_EXECUTABLE"
  | "PLAN_NOT_ROUTABLE"
  | "ENVELOPE_TEXT"
  | "ENVELOPE_PRESENTATION"
  | "ENVELOPE_PERSISTENT_BUBBLE"
  | "ENVELOPE_EXECUTION_NO_PLAN";

/** The envelope kinds the output router can emit. */
export type RoutableEnvelopeKind =
  | "text"
  | "ephemeral_bubble"
  | "interactive_bubble"
  | "structured_result"
  | "direct_action"
  | "workflow"
  | "durable_run"
  | "persistent_smart_bubble";

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * What the turn needs from the data layer, when it needs anything.
 *
 * Deliberately thin. It exists so `DIRECT_READ` has somewhere real to point,
 * and carries only what a future `AuthorizedQuery` would need as its subject.
 * It is NOT a query, it names no table, and it holds no SQL — the model never
 * gets a database connection, and a boundary that carried one would be the
 * thing this phase is supposed to keep possible to build safely.
 */
export type RouteDataNeed = {
  readonly kind: "AUTHORIZED_READ";
  /** The goal's own words, kept so an answer can quote what was asked. */
  readonly subject: string;
};

export type RouteDecision = {
  readonly route: SemanticRoute;
  readonly reason: RouteReason;
  readonly downstream: RouteDownstream;
  /** Present only for `DIRECT_READ`. */
  readonly dataNeed?: RouteDataNeed;
  /** The plan's own classification, when a plan was proposed. */
  readonly planKind?: PlanGraph["kind"];
};

/**
 * Mechanisms that do not exist yet.
 *
 * Listed once, as data, so "is this built" is never answered by a comment. A
 * route in this set returns a truthful unavailable state rather than executing
 * something adjacent.
 */
const NOT_IMPLEMENTED: ReadonlySet<SemanticRoute> = new Set<SemanticRoute>([
  // DIRECT_READ left this set when the data layer landed. It now reaches
  // `readCanonicalData`, and its unavailable cases are the data layer's own —
  // UNAVAILABLE for an unregistered resource, DENIED for a field, and so on —
  // which are far more specific than "not built".
  // PERSISTENT_WORLD left this set when the world runtime landed. A turn now
  // validates a definition, authorizes it against the acting scope, commits it
  // atomically and reads it back before anybody is told it exists. Its
  // unavailable cases are that runtime's own — NEEDS_INPUT for a definition
  // that never arrived, DENIED for a rule of the scope, CONFLICT for a stale
  // version — and every one of them is more specific than "not built".
  "TRUSTED_PRODUCT_ACTION",
  "MONITORING",
]);

// ── Precedence, as data ──────────────────────────────────────────────────────

type RoutingInput = {
  readonly envelopeKind: RoutableEnvelopeKind;
  readonly plan?: PlanGraph;
  readonly planValidation?: PlanValidation;
  /** The goal's outcome, when one was proposed. Used only as a DataNeed subject. */
  readonly goalOutcome?: string;
};

type RoutingRule = {
  readonly reason: RouteReason;
  readonly route: SemanticRoute;
  readonly when: (input: RoutingInput) => boolean;
};

/**
 * Read top to bottom. First match wins. This ordering is the precedence rule
 * §10 of the brief asks to be deterministic and in one place.
 *
 * Plan-derived rules all precede envelope-derived ones, which is the fix: the
 * envelope's `kind` is a presentation decision made before anyone thought about
 * mechanism, and letting it win is what produced a blocked execution run for a
 * question.
 */
export const ROUTING_RULES: readonly RoutingRule[] = Object.freeze([
  // ── 1. Identity first, unconditionally ────────────────────────────────────
  //
  // Before validity, before everything. A plan that says it changes who the
  // runtime operates as must never become a DAG, and that has to hold even when
  // the plan is malformed — a broken identity plan is the case where routing it
  // as ordinary execution would be most dangerous, not least.
  {
    reason: "PLAN_IDENTITY_CHANGE",
    route: "TRUSTED_PRODUCT_ACTION",
    when: ({ plan }) => plan?.kind === "IDENTITY_CHANGE",
  },
  {
    reason: "PLAN_SETTING_MUTATION",
    route: "TRUSTED_PRODUCT_ACTION",
    when: ({ plan }) => plan?.kind === "SETTING_MUTATION",
  },

  // ── 2. Standing conditions before one-shot work ───────────────────────────
  //
  // «راقب السعر» is not «ما السعر». Collapsing a monitoring goal into an
  // immediate execution answers a different question and looks like success.
  {
    reason: "PLAN_MONITORING",
    route: "MONITORING",
    when: ({ plan }) => plan?.kind === "MONITORING",
  },

  {
    reason: "PLAN_PERSISTENT_WORLD",
    route: "PERSISTENT_WORLD",
    when: ({ plan }) => plan?.kind === "PERSISTENT_WORLD",
  },

  // ── 3. A read is not a plan ───────────────────────────────────────────────
  //
  // Before the DAG rule: a request that merely MENTIONS something a capability
  // could do is still a read. «أرني مبيعاتي» must not become execution because
  // the word "show" sits near a capability name.
  {
    reason: "PLAN_DIRECT_READ",
    route: "DIRECT_READ",
    when: ({ plan }) => plan?.kind === "DIRECT_READ",
  },

  // ── 4. Real work, only when the plan is actually sound ────────────────────
  {
    reason: "PLAN_DAG_EXECUTABLE",
    route: "GENERAL_PLANGRAPH",
    when: ({ plan, planValidation }) =>
      plan?.kind === "DAG" &&
      planValidation?.readiness === "EXECUTABLE" &&
      planValidation.violations.length === 0,
  },

  // ── 5. A plan that survived none of the above ─────────────────────────────
  //
  // A DAG plan that is blocked, unsatisfiable or malformed. It routes to the
  // legacy flat path, which creates proposals and executes nothing — the same
  // truthful non-execution it would have produced before plans existed.
  {
    reason: "PLAN_NOT_ROUTABLE",
    route: "LEGACY_FLAT",
    when: ({ plan }) => plan !== undefined,
  },

  // ── 6. No plan: the envelope's own shape decides ──────────────────────────
  { reason: "ENVELOPE_TEXT", route: "TEXT", when: ({ envelopeKind }) => envelopeKind === "text" },
  {
    reason: "ENVELOPE_PRESENTATION",
    route: "GENERATED_PRESENTATION",
    when: ({ envelopeKind }) =>
      envelopeKind === "ephemeral_bubble" ||
      envelopeKind === "interactive_bubble" ||
      envelopeKind === "structured_result",
  },
  {
    reason: "ENVELOPE_PERSISTENT_BUBBLE",
    route: "PERSISTENT_LIVING_OBJECT",
    when: ({ envelopeKind }) => envelopeKind === "persistent_smart_bubble",
  },
  {
    reason: "ENVELOPE_EXECUTION_NO_PLAN",
    route: "LEGACY_FLAT",
    when: ({ envelopeKind }) =>
      envelopeKind === "direct_action" ||
      envelopeKind === "workflow" ||
      envelopeKind === "durable_run",
  },
]);

/**
 * Choose the smallest sufficient mechanism.
 *
 * Pure: no database, no provider, no clock, no model. The same inputs route the
 * same way every time, which is what makes a recorded route worth recording.
 */
export function decideSemanticRoute(input: RoutingInput): RouteDecision {
  const matched = ROUTING_RULES.find((rule) => rule.when(input));
  // The rule list is exhaustive over the envelope kinds, so this is unreachable
  // in practice. It resolves to the flat path rather than throwing, because a
  // turn is a conversation and an unroutable turn should still answer.
  const rule = matched ?? {
    reason: "ENVELOPE_EXECUTION_NO_PLAN" as const,
    route: "LEGACY_FLAT" as const,
  };

  return {
    route: rule.route,
    reason: rule.reason,
    downstream: NOT_IMPLEMENTED.has(rule.route) ? "NOT_IMPLEMENTED" : "AVAILABLE",
    ...(rule.route === "DIRECT_READ"
      ? { dataNeed: { kind: "AUTHORIZED_READ" as const, subject: input.goalOutcome ?? "" } }
      : {}),
    ...(input.plan ? { planKind: input.plan.kind } : {}),
  };
}

// ── Truthful unavailability ──────────────────────────────────────────────────

/**
 * The canonical safe state for a route whose mechanism does not exist.
 *
 * `UNAVAILABLE` and not `FAILED`: nothing was attempted, so nothing failed.
 * And not `BLOCKED_BY_PROVIDER` either — no provider is missing here; the part
 * JASIM itself has not built yet is missing, which is a different fact and
 * deserves a different word.
 */
export type RouteUnavailable = {
  readonly state: "UNAVAILABLE";
  readonly cause: "MECHANISM_NOT_IMPLEMENTED";
  readonly route: SemanticRoute;
  /** Safe to show a person. Says what was understood and what is missing. */
  readonly message: string;
};

const UNAVAILABLE_MESSAGE: Readonly<Record<string, string>> = Object.freeze({
  DIRECT_READ:
    "فهمت أنك تطلب عرض بيانات. طبقة قراءة البيانات المصرّح بها غير مبنية بعد، ولن أعرض أرقاماً غير حقيقية.",
  TRUSTED_PRODUCT_ACTION:
    "فهمت أن هذا إجراء على حسابك. هذه الإجراءات تتم عبر سطح آمن غير مبني بعد، ولن أنفّذها عبر المحادثة.",
  MONITORING:
    "فهمت أنك تريد مراقبة مستمرة. آلية الشروط الدائمة غير مبنية بعد، ولن أحوّلها إلى تنفيذ لمرة واحدة.",
  PERSISTENT_WORLD:
    "فهمت أنك تريد نظاماً دائماً. تكوين العوالم من خطة غير مبني بعد، ولن أنشئ عالماً ناقصاً.",
});

export function routeUnavailable(route: SemanticRoute): RouteUnavailable {
  return {
    state: "UNAVAILABLE",
    cause: "MECHANISM_NOT_IMPLEMENTED",
    route,
    message:
      UNAVAILABLE_MESSAGE[route] ??
      "فهمت الطلب، لكن الآلية المناسبة له غير مبنية بعد.",
  };
}
