/**
 * JASIM — the conversational path into the Opportunity Exchange.
 *
 * ─── THE GAP THIS CLOSES, TRACED BEFORE IT WAS FILLED ───────────────────────
 *
 * `economic-fabric.ts` already holds a complete, domain-free exchange: Need and
 * Offering share one `EconomicExpression`, constraints are typed, matching is
 * deterministic with unit normalisation, composite matches exist, and nothing
 * in it names an industry. The acceptance catalog recorded 35 scenarios —
 * every open-market pair and all sixteen holdouts — blocked on one thing:
 *
 *   NOTHING A PERSON SAYS CAN REACH IT.
 *
 * Not a missing marketplace. Not a missing primitive. A missing door.
 *
 * ─── WHY CAPABILITIES AND NOT A ROUTE ───────────────────────────────────────
 *
 * A new semantic route would make "the market" a destination the runtime has to
 * decide about, and would mean the exchange is a place rather than a mechanism.
 * These are two entries in the capability registry instead, so the EXISTING
 * GoalSpec → PlanGraph → DAG path reaches them like anything else: a goal that
 * needs to publish a Need plans a node, and a goal that needs to buy something
 * plans that node beside the others it needs.
 *
 * That also means the market composes. «اعرض شاحنتي الفارغة ثم ابحث عن شحنة»
 * is two nodes with a dependency, not a special mode.
 *
 * ─── WHAT A CALLER MAY NOT DECIDE ───────────────────────────────────────────
 *
 * The owner comes from the execution context and never from inputs. The public
 * projection is built HERE from a closed set of fields — a caller that could
 * choose what becomes public could publish a private constraint by naming it,
 * and «لا تتجاوز 250» is exactly the sentence that must never leave.
 *
 * Visibility is PRIVATE or PUBLIC only. `shared` exists in the fabric and needs
 * an explicit access grant per party, which is a separate authority act and not
 * something a plan node may perform in passing.
 */

import { db } from "../queries/connection";
import {
  createExpression,
  discoverExpressions,
  matchNeed,
  publishExpression,
} from "./economic-fabric";
import { economicExpressions } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import type { ConstraintExpression, ConstraintOperator } from "./semantic-fabric";
import type { EffectAssertion } from "./completion-policy";

// ── Bounds ───────────────────────────────────────────────────────────────────

const MAX_CONSTRAINTS = 20;
const MAX_ATTRIBUTE_KEYS = 40;
const MAX_TEXT = 400;
const MAX_RESULTS = 50;

const OPERATORS: ReadonlySet<string> = new Set<ConstraintOperator>([
  "eq", "neq", "gte", "lte", "gt", "lt", "contains", "within_time", "compatible",
]);

/**
 * Identity and authority, which a caller never supplies.
 *
 * Screened at the TOP LEVEL of the inputs. `ownerId` is the one that matters
 * most — identity comes from the session — and the rest are the fabric's own
 * state columns, which change through a transition rather than an assignment.
 *
 * `visibility` is deliberately absent: it IS a legitimate input, taken from a
 * closed two-value set and validated below. Screening it here would have
 * refused the ordinary case.
 */
const RESERVED_INPUT_KEYS: ReadonlySet<string> = new Set([
  "ownerid", "owner", "userid", "tenantid", "actorid",
  "status", "version", "publicprojection", "id",
  "verified", "trusted", "approved", "authorized", "published",
]);

/**
 * The same, plus the fields a caller must not write into free-form data.
 *
 * `attributes` is an open bag, so `visibility` inside it would be a state
 * transition smuggled past the one validated place that performs it.
 */
const RESERVED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  ...RESERVED_INPUT_KEYS,
  "visibility",
]);

export class OpportunityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityInputError";
  }
}

function text(value: unknown, field: string, required = true): string {
  if (typeof value !== "string" || !value.trim()) {
    if (!required) return "";
    throw new OpportunityInputError(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT) {
    throw new OpportunityInputError(`${field} exceeds ${MAX_TEXT} characters.`);
  }
  return trimmed;
}

function assertNoReservedKeys(
  record: Record<string, unknown>,
  label: string,
  reserved: ReadonlySet<string> = RESERVED_ATTRIBUTE_KEYS,
): void {
  for (const key of Object.keys(record)) {
    if (reserved.has(key.toLowerCase())) {
      throw new OpportunityInputError(
        `${label}.${key} is decided by the runtime, never by the caller.`,
      );
    }
  }
}

function attributes(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new OpportunityInputError("attributes must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length > MAX_ATTRIBUTE_KEYS) {
    throw new OpportunityInputError(`attributes exceeds ${MAX_ATTRIBUTE_KEYS} keys.`);
  }
  assertNoReservedKeys(record, "attributes");
  return record;
}

/**
 * Typed constraints, validated against the fabric's own closed operator set.
 *
 * Nothing here interprets what a field MEANS. `quantity >= 300` and
 * `responseMinutes <= 15` are the same four fields to this function, which is
 * why one validator serves procurement, hiring and a generator's response time.
 */
function constraints(value: unknown, label: string): ConstraintExpression[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OpportunityInputError(`${label} must be an array.`);
  if (value.length > MAX_CONSTRAINTS) {
    throw new OpportunityInputError(`${label} exceeds ${MAX_CONSTRAINTS} entries.`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new OpportunityInputError(`${label}[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const field = text(record.field, `${label}[${index}].field`);
    const operator = String(record.operator ?? "");
    if (!OPERATORS.has(operator)) {
      throw new OpportunityInputError(
        `${label}[${index}].operator must be one of ${[...OPERATORS].join(", ")}.`,
      );
    }
    if (record.value === undefined) {
      throw new OpportunityInputError(`${label}[${index}].value is required.`);
    }
    const scalar = record.value;
    if (scalar !== null && typeof scalar === "object") {
      throw new OpportunityInputError(`${label}[${index}].value must be a scalar.`);
    }
    return {
      field,
      operator: operator as ConstraintOperator,
      value: scalar,
      ...(typeof record.unit === "string" && record.unit.trim()
        ? { unit: record.unit.trim() }
        : {}),
    };
  });
}

/**
 * What the world is allowed to see, decided here.
 *
 * Built from the expression's own declared summary and semantic type, plus an
 * explicitly offered `publicTerms` block. Hard constraints and private
 * attributes are structurally unable to reach it: they are not read by this
 * function at all.
 */
function publicProjection(input: {
  semanticType: string;
  summary: string;
  publicTerms?: Record<string, unknown>;
  availability?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    semanticType: input.semanticType,
    summary: input.summary,
    ...(input.publicTerms ? { publicTerms: input.publicTerms } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
  };
}

// ── Publishing ───────────────────────────────────────────────────────────────

export type PublishInputs = {
  kind: "NEED" | "OFFERING";
  semanticType: string;
  summary: string;
  attributes?: Record<string, unknown>;
  hardConstraints?: unknown;
  softPreferences?: unknown;
  availability?: Record<string, unknown>;
  publicTerms?: Record<string, unknown>;
  visibility?: "PRIVATE" | "PUBLIC";
};

export async function executeOpportunityPublish(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  // The top level is screened too, not only `attributes`. Identity arriving
  // here would be ignored rather than obeyed — the owner comes from the
  // session — but silently ignoring it is how a caller comes to believe it
  // worked. A payload naming an owner is refused and says so.
  assertNoReservedKeys(inputs, "inputs", RESERVED_INPUT_KEYS);
  const kindRaw = String(inputs.kind ?? "").toUpperCase();
  if (kindRaw !== "NEED" && kindRaw !== "OFFERING") {
    throw new OpportunityInputError("kind must be NEED or OFFERING.");
  }
  const semanticType = text(inputs.semanticType, "semanticType");
  const summary = text(inputs.summary, "summary");
  const visibility = String(inputs.visibility ?? "PRIVATE").toUpperCase();
  if (visibility !== "PRIVATE" && visibility !== "PUBLIC") {
    throw new OpportunityInputError(
      "visibility must be PRIVATE or PUBLIC. Sharing with a named party is a separate grant.",
    );
  }

  const availability =
    inputs.availability === undefined || inputs.availability === null
      ? undefined
      : attributes(inputs.availability);
  const publicTerms =
    inputs.publicTerms === undefined || inputs.publicTerms === null
      ? undefined
      : attributes(inputs.publicTerms);

  const created = await createExpression({
    // From the session. Nothing in `inputs` reached this line.
    ownerId,
    kind: kindRaw === "NEED" ? "need" : "offering",
    semanticType,
    attributes: { summary, ...attributes(inputs.attributes) },
    hardConstraints: constraints(inputs.hardConstraints, "hardConstraints"),
    softPreferences: constraints(inputs.softPreferences, "softPreferences"),
    ...(availability ? { availability } : {}),
  });

  if (visibility === "PUBLIC") {
    const published = await publishExpression({
      id: created.id,
      ownerId,
      projection: publicProjection({
        semanticType,
        summary,
        ...(publicTerms ? { publicTerms } : {}),
        ...(availability ? { availability } : {}),
      }),
    });
    return {
      expressionId: published.id,
      kind: kindRaw,
      semanticType,
      visibility: published.visibility,
      status: published.status,
      // The effect this attempt claims. Its worth is decided elsewhere.
      effect: { state: "OCCURRED" as const, reference: published.id },
    };
  }

  return {
    expressionId: created.id,
    kind: kindRaw,
    semanticType,
    visibility: created.visibility,
    status: created.status,
    effect: { state: "OCCURRED" as const, reference: created.id },
  };
}

/**
 * The effect readback: JASIM's own durable record of what it just wrote.
 *
 * `INTERNAL_STATE` is the one effect class where this is authoritative, because
 * JASIM owns the state. For anything leaving the system it would not be, and
 * the policy table is what enforces that difference.
 */
async function resolvePublishEffect(context: {
  ownerId: string;
  result: Record<string, unknown> | null;
}): Promise<EffectAssertion | undefined> {
  const expressionId = context.result?.expressionId;
  if (typeof expressionId !== "string" || !expressionId) return undefined;
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(
      and(
        eq(economicExpressions.id, expressionId),
        eq(economicExpressions.ownerId, context.ownerId),
      ),
    )
    .limit(1);
  if (!row) {
    return {
      state: "NOT_OCCURRED",
      source: "INTERNAL_READBACK",
      authority: "opportunity-exchange",
      notes: ["No expression of this owner matches the id the attempt reported."],
    };
  }
  return {
    state: "OCCURRED",
    source: "INTERNAL_READBACK",
    authority: "opportunity-exchange",
    reference: row.id,
    notes: [`The expression is recorded as ${row.status}/${row.visibility}.`],
  };
}

// ── Discovery ────────────────────────────────────────────────────────────────

/**
 * MATCHING IS NOT A READ, and this was declared wrongly at first.
 *
 * `opportunity-discover` originally did both jobs and declared
 * `sideEffects: none`. Listing really is a read. Matching is not: `matchNeed`
 * INSERTS an `economic_matches` row per viable offering, with a fresh id each
 * time, so calling it twice records the same finding twice. Those rows are
 * derived, but they are neither idempotent nor reconstructable after the
 * underlying offerings change — which makes them canonical internal state.
 *
 * A capability's effect class is one value, so a capability that is sometimes
 * pure and sometimes not has to be classified by its worst case or split. It
 * is split, because classifying the whole thing INTERNAL_STATE would have made
 * a plain listing demand an effect readback it could never satisfy.
 *
 * FALSE_PURE_READ = 0.
 */
export async function executeOpportunityMatch(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  assertNoReservedKeys(inputs, "inputs", RESERVED_INPUT_KEYS);
  const needId = typeof inputs.needId === "string" ? inputs.needId.trim() : "";
  if (!needId) throw new OpportunityInputError("needId is required to match a Need.");

  const { matches, composite } = await matchNeed({ needId, requesterOwnerId: ownerId });
  return {
    mode: "MATCH",
    needId,
    matchCount: matches.length,
    matches: matches.slice(0, MAX_RESULTS).map((match) => ({
      matchId: match.id,
      offeringId: match.offeringId,
      status: match.status,
      constraintResults: match.constraintResults,
    })),
    ...(composite
      ? {
          composite: {
            matchId: composite.id,
            components: composite.compositeComponents,
            status: composite.status,
          },
        }
      : {}),
    // A finding of zero is still a finding that happened.
    effect: { state: "OCCURRED" as const, reference: needId },
  };
}

/**
 * The readback for a match run: JASIM's own record that the matching happened.
 *
 * A zero-match run wrote nothing, and that is not a failure — it is the honest
 * answer that nothing matched. So the readback confirms the NEED still exists
 * and belongs to this scope, which is what the attempt actually claimed.
 */
async function resolveMatchEffect(context: {
  ownerId: string;
  result: Record<string, unknown> | null;
}): Promise<EffectAssertion | undefined> {
  const needId = context.result?.needId;
  if (typeof needId !== "string" || !needId) return undefined;
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(
      and(
        eq(economicExpressions.id, needId),
        eq(economicExpressions.ownerId, context.ownerId),
      ),
    )
    .limit(1);
  if (!row) {
    return {
      state: "NOT_OCCURRED",
      source: "INTERNAL_READBACK",
      authority: "opportunity-exchange",
      notes: ["No Need of this scope matches the id the attempt reported."],
    };
  }
  return {
    state: "OCCURRED",
    source: "INTERNAL_READBACK",
    authority: "opportunity-exchange",
    reference: row.id,
    notes: ["The Need this attempt matched against is recorded in this scope."],
  };
}

/**
 * Listing. A genuine read: it inserts nothing and is safe to repeat.
 *
 * `needId` is refused here rather than quietly routed to matching, because the
 * difference between the two is the difference between reading and writing.
 */
export async function executeOpportunityDiscover(
  inputs: Record<string, unknown>,
  ownerId: string,
): Promise<Record<string, unknown>> {
  assertNoReservedKeys(inputs, "inputs", RESERVED_INPUT_KEYS);
  if (typeof inputs.needId === "string" && inputs.needId.trim()) {
    throw new OpportunityInputError(
      "Matching a Need records findings and is a separate capability; discovery only lists.",
    );
  }

  const kindRaw = String(inputs.kind ?? "OFFERING").toUpperCase();
  if (kindRaw !== "NEED" && kindRaw !== "OFFERING") {
    throw new OpportunityInputError("kind must be NEED or OFFERING.");
  }
  const semanticType =
    typeof inputs.semanticType === "string" && inputs.semanticType.trim()
      ? inputs.semanticType.trim()
      : undefined;

  const found = await discoverExpressions({
    kind: kindRaw === "NEED" ? "need" : "offering",
    requesterOwnerId: ownerId,
    ...(semanticType ? { semanticType } : {}),
  });

  return {
    mode: "DISCOVER",
    kind: kindRaw,
    ...(semanticType ? { semanticType } : {}),
    resultCount: found.length,
    // Only what the fabric decided each viewer may see. An owner's own rows
    // come back whole; everyone else's arrive as their public projection, and
    // this function does not widen either.
    results: found.slice(0, MAX_RESULTS).map((entry) => ({
      expressionId: entry.id,
      semanticType: entry.semanticType,
      kind: entry.kind,
      visibility: entry.visibility,
      status: entry.status,
      view: "projection" in entry ? entry.projection : { own: true },
    })),
  };
}

export { resolveMatchEffect, resolvePublishEffect };
