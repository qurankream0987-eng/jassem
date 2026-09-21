/**
 * JASIM — A STORED POLICY IS NOT AN ENFORCED POLICY.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 *   POLICY STORED != POLICY ENFORCED
 *
 * `scope_policies` has been writable, scoped, versioned and private for two
 * phases, and could be written by talking for one. Nothing read a single row.
 * A person could say «لا تبيع بأقل من التكلفة», watch JASIM store it, and be
 * completely wrong about what would happen next.
 *
 * ─── WHAT A POLICY ROW ACTUALLY DEFINED ─────────────────────────────────────
 *
 * Nothing. `value` is free-form `jsonb` that only ever had authority keys
 * screened out of it. So the honest move is not to "start enforcing the
 * existing rows" — there were no semantics to enforce — but to recognise a
 * TYPED body inside the same column, and to keep telling the truth about every
 * row that is not one:
 *
 *   a body carrying `policySchema: "jasim.policy/1"` → an ENFORCEMENT policy
 *   any other body                                   → scope configuration
 *   a body CLAIMING the schema and failing to parse  → MALFORMED, fails closed
 *
 *   POLICY TEXT != EXECUTABLE POLICY
 *
 * The third case is the one that matters. Prose cannot masquerade as a rule by
 * being stored next to rules, and a rule that cannot be evaluated is never
 * silently skipped.
 *
 * ─── WHAT ENFORCEMENT MAY NEVER DO ──────────────────────────────────────────
 *
 *   MODEL INTERPRETATION != AUTHORITY
 *
 * No model is consulted here. Not to read a policy, not to decide whether one
 * applies, not to break a tie. A conversational layer may PROPOSE a typed
 * policy; asking a model at enforcement time what a stored sentence meant would
 * make every rule in the system mean whatever it said that day.
 *
 *   UNKNOWN POLICY SEMANTICS != ALLOW
 *   POLICY ABSENCE          != POLICY DENIAL
 *
 * Two different defaults, and both are deliberate. A scope with no policies
 * permits what its permissions permit. A scope with a policy nobody can read
 * permits nothing, because the alternative is proceeding past a rule.
 *
 * ─── AND WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 *   PERMISSION != POLICY
 *   POLICY     != AUTHORITY ENVELOPE
 *   ENVELOPE   != APPROVAL
 *   APPROVAL   != POLICY OVERRIDE
 *
 * Four different questions: may this person act here, what has this scope
 * forbidden itself, how far may JASIM go on someone's behalf, and did a person
 * decide. They compose, and the narrowest wins. A permission to transact does
 * not answer a policy that caps the amount, and approving something a policy
 * denies does not make it permitted.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { scopePolicies, type ScopePolicy } from "../../db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, and containing no domain
// ─────────────────────────────────────────────────────────────────────────────

/** The one recognized body. A version in the identifier, so a second can exist. */
export const POLICY_SCHEMA_ID = "jasim.policy/1";

export const POLICY_EFFECTS = [
  /** Says nothing new. Present so a scope can record an intention; it never widens. */
  "ALLOW",
  /** Categorically refused when the conditions hold. */
  "DENY",
  /** A person must decide this one, through the authority administration path. */
  "REQUIRE_APPROVAL",
  /** Permitted only while the parameters satisfy the named bounds. */
  "CONSTRAIN",
] as const;
export type PolicyEffect = (typeof POLICY_EFFECTS)[number];

export const POLICY_DECISIONS = [
  "ALLOWED",
  "DENIED",
  "REQUIRES_APPROVAL",
  /** A policy exists in this scope and cannot be evaluated. Fails closed. */
  "UNSUPPORTED_POLICY",
] as const;
export type PolicyDecisionClass = (typeof POLICY_DECISIONS)[number];

/**
 * Comparisons, reused from the fabric's own closed set rather than invented.
 *
 * `within_time` and `compatible` are deliberately absent: both need fabric
 * context to evaluate, and a comparison that needs context is a comparison that
 * can be wrong in two places.
 */
export const POLICY_OPERATORS = [
  "eq", "neq", "gte", "lte", "gt", "lt", "contains",
] as const;
export type PolicyOperator = (typeof POLICY_OPERATORS)[number];

/** How a stored row relates to enforcement. Three states, and only one enforces. */
export const POLICY_BODY_CLASSES = ["ENFORCED", "RECORDED_ONLY", "MALFORMED"] as const;
export type PolicyBodyClass = (typeof POLICY_BODY_CLASSES)[number];

/**
 * Words a caller may never say about a policy decision.
 *
 * Each is a fact the runtime establishes. A model that could set
 * `policyDecision` would decide by describing; one that could set `bypass`
 * would not need to.
 */
export const POLICY_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "policydecision",
  "policyversion",
  "policyoverride",
  "policyid",
  "bypass",
  "bypasspolicy",
  "trusted",
  "exempt",
  "enforced",
]);

export class PolicyError extends Error {
  readonly code: "INVALID" | "UNSUPPORTED";
  constructor(message: string, code: "INVALID" | "UNSUPPORTED") {
    super(message);
    this.code = code;
    this.name = "PolicyError";
  }
}

export function assertNoPolicyAuthorityClaim(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (POLICY_AUTHORITY_KEYS.has(key.trim().toLowerCase())) {
      throw new PolicyError(
        `«${key}» states a policy decision the runtime establishes; it cannot be supplied in ${label}.`,
        "INVALID",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Facts
// ─────────────────────────────────────────────────────────────────────────────

export type Scalar = string | number | boolean;

/**
 * Every scalar in a value, by dotted path.
 *
 * ONE path convention for the whole runtime. The authority statement renders
 * its lines from this, and a policy names its fields with it, so a rule about
 * `bounds.price.reserve` is a rule about exactly the line the person read.
 * Two conventions would be two different meanings of the same sentence.
 *
 * Nested keys are sorted, because `jsonb` does not preserve key order and a
 * digest must depend on what something says rather than on how it was stored.
 */
export function scalarPaths(
  value: unknown,
  prefix = "",
  into: Array<{ path: string; value: Scalar }> = [],
  depth = 0,
): Array<{ path: string; value: Scalar }> {
  if (value === null || value === undefined || depth > 8 || into.length >= 400) return into;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    into.push({ path: prefix, value });
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scalarPaths(entry, prefix ? `${prefix}[${index}]` : `[${index}]`, into, depth + 1),
    );
    return into;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [key, entry] of entries) {
      scalarPaths(entry, prefix ? `${prefix}.${key}` : key, into, depth + 1);
    }
  }
  return into;
}

/** The flat fact map a condition is evaluated against. */
export function policyFacts(parameters: unknown): Readonly<Record<string, Scalar>> {
  return Object.freeze(
    Object.fromEntries(scalarPaths(parameters).map((entry) => [entry.path, entry.value])),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The typed body
// ─────────────────────────────────────────────────────────────────────────────

export type PolicyCondition = {
  readonly field: string;
  readonly operator: PolicyOperator;
  readonly value: Scalar;
};

export type EnforcementPolicy = {
  readonly schema: typeof POLICY_SCHEMA_ID;
  /** Action ids this governs — registered act ids, capability ids, or `*`. */
  readonly actions: readonly string[];
  /** When it bites. Empty means always, for the actions it governs. */
  readonly conditions: readonly PolicyCondition[];
  readonly effect: PolicyEffect;
  /** For CONSTRAIN: what the parameters must satisfy. */
  readonly requires: readonly PolicyCondition[];
  readonly effectiveFrom?: string;
  readonly effectiveUntil?: string;
};

const MAX_CONDITIONS = 20;
const MAX_ACTIONS = 40;

function parseConditions(raw: unknown, label: string): PolicyCondition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new PolicyError(`${label} must be a list.`, "INVALID");
  if (raw.length > MAX_CONDITIONS) throw new PolicyError(`${label} has too many entries.`, "INVALID");
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PolicyError(`${label}[${index}] is not a condition.`, "INVALID");
    }
    const record = entry as Record<string, unknown>;
    assertNoPolicyAuthorityClaim(record, label);
    const field = record.field;
    if (typeof field !== "string" || !field.trim()) {
      throw new PolicyError(`${label}[${index}] names no field.`, "INVALID");
    }
    const operator = String(record.operator ?? "");
    if (!(POLICY_OPERATORS as readonly string[]).includes(operator)) {
      throw new PolicyError(
        `${label}[${index}].operator must be one of ${POLICY_OPERATORS.join(", ")}.`,
        "INVALID",
      );
    }
    const value = record.value;
    const scalar =
      typeof value === "string" || typeof value === "boolean"
        ? value
        : typeof value === "number" && Number.isFinite(value)
          ? value
          : undefined;
    if (scalar === undefined) {
      throw new PolicyError(`${label}[${index}] has no comparable value.`, "INVALID");
    }
    return Object.freeze({ field: field.trim(), operator: operator as PolicyOperator, value: scalar });
  });
}

/**
 * Read a typed policy out of a stored body, or refuse.
 *
 * Throws rather than returning a partial: a policy half-understood is the
 * `UNKNOWN POLICY SEMANTICS != ALLOW` case, and the caller turns it into a
 * closed door rather than an approximation.
 */
export function parseEnforcementPolicy(value: unknown): EnforcementPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyError("A policy body must be an object.", "INVALID");
  }
  const body = value as Record<string, unknown>;
  if (body.policySchema !== POLICY_SCHEMA_ID) {
    throw new PolicyError(`«${String(body.policySchema)}» is not a policy schema.`, "UNSUPPORTED");
  }
  assertNoPolicyAuthorityClaim(body, "a policy body");

  const effect = String(body.effect ?? "");
  if (!(POLICY_EFFECTS as readonly string[]).includes(effect)) {
    throw new PolicyError(`«${effect}» is not a policy effect.`, "INVALID");
  }
  const actionsRaw = body.actions;
  if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) {
    throw new PolicyError("A policy must say which actions it governs.", "INVALID");
  }
  if (actionsRaw.length > MAX_ACTIONS) throw new PolicyError("Too many actions.", "INVALID");
  const actions = actionsRaw.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new PolicyError(`actions[${index}] is not an action id.`, "INVALID");
    }
    return entry.trim();
  });

  const conditions = parseConditions(body.conditions, "conditions");
  const requires = parseConditions(body.requires, "requires");
  if (effect === "CONSTRAIN" && requires.length === 0) {
    throw new PolicyError("A CONSTRAIN policy must say what it requires.", "INVALID");
  }
  for (const key of ["effectiveFrom", "effectiveUntil"] as const) {
    const at = body[key];
    if (at !== undefined && (typeof at !== "string" || Number.isNaN(Date.parse(at)))) {
      throw new PolicyError(`«${key}» is not a timestamp.`, "INVALID");
    }
  }
  return Object.freeze({
    schema: POLICY_SCHEMA_ID,
    actions: Object.freeze(actions),
    conditions: Object.freeze(conditions),
    effect: effect as PolicyEffect,
    requires: Object.freeze(requires),
    ...(typeof body.effectiveFrom === "string" ? { effectiveFrom: body.effectiveFrom } : {}),
    ...(typeof body.effectiveUntil === "string" ? { effectiveUntil: body.effectiveUntil } : {}),
  });
}

/**
 * What a stored row IS, said out loud.
 *
 * This is the whole answer to `POLICY TEXT != EXECUTABLE POLICY`. A person who
 * asked for a rule and got a note has to be able to see that, which is why the
 * authority statement renders this classification on its own line.
 */
export function classifyPolicyBody(value: unknown): PolicyBodyClass {
  const claims =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).policySchema !== undefined;
  if (!claims) return "RECORDED_ONLY";
  try {
    parseEnforcementPolicy(value);
    return "ENFORCED";
  } catch {
    return "MALFORMED";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

function compare(operator: PolicyOperator, fact: Scalar | undefined, value: Scalar): boolean {
  if (fact === undefined) return false;
  switch (operator) {
    case "eq":
      return fact === value;
    case "neq":
      return fact !== value;
    case "contains":
      return typeof fact === "string" && typeof value === "string" && fact.includes(value);
    default: {
      // An ordering over two things that are not both numbers is not an
      // ordering. Refusing to compare is not the same as comparing false —
      // but for a CONDITION, "does not hold" is the honest reading, and for a
      // REQUIREMENT the caller inverts it, so an incomparable requirement is
      // unsatisfied and the action stops.
      if (typeof fact !== "number" || typeof value !== "number") return false;
      if (operator === "gte") return fact >= value;
      if (operator === "lte") return fact <= value;
      if (operator === "gt") return fact > value;
      return fact < value;
    }
  }
}

function conditionsHold(
  conditions: readonly PolicyCondition[],
  facts: Readonly<Record<string, Scalar>>,
): boolean {
  // ALL of them. A policy with several conditions is one rule, not several.
  return conditions.every((condition) =>
    compare(condition.operator, facts[condition.field], condition.value),
  );
}

function withinWindow(policy: EnforcementPolicy, now: Date): boolean {
  if (policy.effectiveFrom && Date.parse(policy.effectiveFrom) > now.getTime()) return false;
  if (policy.effectiveUntil && Date.parse(policy.effectiveUntil) <= now.getTime()) return false;
  return true;
}

function governs(policy: EnforcementPolicy, action: string): boolean {
  return policy.actions.includes("*") || policy.actions.includes(action);
}

/**
 * Why a decision came out the way it did.
 *
 * Deliberately id, version, key, effect and a fixed reason code — and NEVER
 * the policy body. A seller's floor, a buyer's ceiling and an internal
 * threshold all steer decisions without being disclosed, and a "reason" that
 * quoted the rule would disclose every one of them.
 */
export type PolicyReason = {
  readonly policyId: string;
  readonly policyKey: string;
  readonly version: number;
  readonly effect: PolicyEffect;
  readonly code:
    | "CONDITIONS_MET"
    | "REQUIREMENT_UNSATISFIED"
    | "MALFORMED_POLICY"
    | "NOT_APPLICABLE";
  /** The FIELD a requirement named, so a caller can propose something legal. */
  readonly field?: string;
};

export type PolicyDecision = {
  readonly outcome: PolicyDecisionClass;
  readonly reasons: readonly PolicyReason[];
  /** Every enforcement policy consulted, so a decision is attributable. */
  readonly consulted: readonly { readonly policyId: string; readonly version: number }[];
};

export type PolicyRequest = {
  readonly scopeId: string;
  /** A registered act id, a capability id, or any future action id. */
  readonly action: string;
  /** Canonical parameters. Flattened here; nothing is interpreted. */
  readonly parameters?: unknown;
  /** Resource references, merged into the facts under `resource.`. */
  readonly resourceRefs?: Record<string, Scalar>;
  readonly now?: Date;
};

const ALLOWED_WITH_NOTHING: PolicyDecision = Object.freeze({
  outcome: "ALLOWED",
  reasons: Object.freeze([]),
  consulted: Object.freeze([]),
});

/** The latest active version of each policy key in a scope. */
export async function activeScopePolicies(scopeId: string): Promise<readonly ScopePolicy[]> {
  const rows = await db
    .select()
    .from(scopePolicies)
    .where(and(eq(scopePolicies.scopeId, scopeId), eq(scopePolicies.state, "active")))
    .orderBy(desc(scopePolicies.version));
  const latest = new Map<string, ScopePolicy>();
  for (const row of rows) {
    // Ordered newest first, so the first one wins and a superseded version can
    // never quietly authorize anything.
    if (!latest.has(row.policyKey)) latest.set(row.policyKey, row);
  }
  return [...latest.values()];
}

/**
 * THE enforcement boundary. One function, called before anything irreversible.
 *
 * It takes an action id and canonical parameters and returns a decision. It
 * knows nothing about what the action is, has no branch per capability and no
 * hook per domain, and a future transaction runtime calls it exactly as an
 * authority act does.
 */
export async function evaluatePolicies(request: PolicyRequest): Promise<PolicyDecision> {
  if (!request.scopeId?.trim() || !request.action?.trim()) {
    throw new PolicyError("A policy decision needs a scope and an action.", "INVALID");
  }
  const rows = await activeScopePolicies(request.scopeId);
  if (rows.length === 0) return ALLOWED_WITH_NOTHING;

  const now = request.now ?? new Date();
  const facts = {
    ...policyFacts(request.parameters ?? {}),
    ...Object.fromEntries(
      Object.entries(request.resourceRefs ?? {}).map(([key, value]) => [`resource.${key}`, value]),
    ),
  };

  const reasons: PolicyReason[] = [];
  const consulted: { policyId: string; version: number }[] = [];
  let denied = false;
  let requiresApproval = false;
  let unsupported = false;

  for (const row of rows) {
    const body = classifyPolicyBody(row.value);
    // A setting is not a rule and never was. It takes no part in this.
    if (body === "RECORDED_ONLY") continue;
    consulted.push({ policyId: row.id, version: row.version });

    if (body === "MALFORMED") {
      // Present, active, claiming to be a rule, and unreadable. There is no
      // safe way to proceed past it, and no way to know what it governs.
      unsupported = true;
      reasons.push({
        policyId: row.id,
        policyKey: row.policyKey,
        version: row.version,
        effect: "DENY",
        code: "MALFORMED_POLICY",
      });
      continue;
    }

    const policy = parseEnforcementPolicy(row.value);
    if (!governs(policy, request.action) || !withinWindow(policy, now)) continue;
    if (!conditionsHold(policy.conditions, facts)) continue;

    if (policy.effect === "ALLOW") {
      // Records an intention and widens nothing. An explicit permission cannot
      // erase a denial somewhere else in the same scope.
      reasons.push({
        policyId: row.id,
        policyKey: row.policyKey,
        version: row.version,
        effect: "ALLOW",
        code: "CONDITIONS_MET",
      });
      continue;
    }
    if (policy.effect === "DENY") {
      denied = true;
      reasons.push({
        policyId: row.id,
        policyKey: row.policyKey,
        version: row.version,
        effect: "DENY",
        code: "CONDITIONS_MET",
      });
      continue;
    }
    if (policy.effect === "REQUIRE_APPROVAL") {
      requiresApproval = true;
      reasons.push({
        policyId: row.id,
        policyKey: row.policyKey,
        version: row.version,
        effect: "REQUIRE_APPROVAL",
        code: "CONDITIONS_MET",
      });
      continue;
    }
    // CONSTRAIN: permitted only while the parameters satisfy it. Nothing is
    // clamped — rewriting somebody's parameters to make them legal is the
    // runtime negotiating on their behalf without being asked.
    const unsatisfied = policy.requires.find(
      (requirement) => !compare(requirement.operator, facts[requirement.field], requirement.value),
    );
    if (unsatisfied) {
      denied = true;
      reasons.push({
        policyId: row.id,
        policyKey: row.policyKey,
        version: row.version,
        effect: "CONSTRAIN",
        code: "REQUIREMENT_UNSATISFIED",
        field: unsatisfied.field,
      });
    }
  }

  // The narrowest result wins. Nothing here can raise an outcome.
  const outcome: PolicyDecisionClass = unsupported
    ? "UNSUPPORTED_POLICY"
    : denied
      ? "DENIED"
      : requiresApproval
        ? "REQUIRES_APPROVAL"
        : "ALLOWED";
  return Object.freeze({
    outcome,
    reasons: Object.freeze(reasons),
    consulted: Object.freeze(consulted),
  });
}

/** Whether a decision permits proceeding without a person deciding it. */
export function permitsExecution(decision: PolicyDecision): boolean {
  return decision.outcome === "ALLOWED";
}

/**
 * What may be recorded about a decision.
 *
 * Ids, versions, effects and reason codes — the things that make a decision
 * attributable and explainable — and never a payload. This is what goes into a
 * statement, an event or a log.
 */
export function disclosableDecision(decision: PolicyDecision): Record<string, unknown> {
  return {
    outcome: decision.outcome,
    policies: decision.reasons.map((reason) => ({
      policyId: reason.policyId,
      policyKey: reason.policyKey,
      version: reason.version,
      effect: reason.effect,
      code: reason.code,
      ...(reason.field ? { field: reason.field } : {}),
    })),
  };
}
