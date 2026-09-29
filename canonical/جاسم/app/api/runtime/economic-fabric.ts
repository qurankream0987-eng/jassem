/**
 * Block 1 — Economic Value Network (generic, domain-free).
 *
 * Offering and Need share one typed generic core (EconomicExpression).
 * Matching is deterministic: structured hard-constraint filtering with unit
 * normalization first, UNKNOWN stays UNKNOWN, composite matches are possible
 * when a Need allows splitting. Proposal terms are versioned canonical state;
 * acceptance creates a TransactionIntent — never a payment.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  economicEngagements,
  economicExpressions,
  economicMatches,
  economicProposals,
  memberships,
  transactionIntents,
  type EconomicEngagement,
  type EconomicExpression,
  type EconomicMatch,
  type EconomicProposal,
  type Membership,
  type TransactionIntent,
} from "../../db/schema";
import {
  checkMembershipAccess,
  grantMembership,
  revokeMembership,
} from "./block2/membership";
import { coordinatesFromPayload } from "./observation-presentation";
import {
  greatCircleMetres,
  normalizeUnit,
  type ConstraintExpression,
} from "./semantic-fabric";

export type ConstraintState = "PASS" | "SOFT_MATCH" | "UNKNOWN" | "FAIL";

/**
 * WHERE ONE ATTRIBUTE VALUE CAME FROM.
 *
 *   STATED   — the owner said it.
 *   INFERRED — something derived it: a model reading a photo, a video, a
 *              sentence. A guess, however good.
 *   OBSERVED — a connected system reported it.
 *
 * The need side has had half of this for a while: `goal-spec` records STATED or
 * INFERRED per constraint and downgrades an INFERRED one from HARD to SOFT,
 * because «an inference may guide, it may not exclude». This is the same law on
 * the other side, where it was missing entirely — and where it mattered more,
 * because a value decides matches for everybody who searches.
 *
 * VERIFIED is deliberately not here. It is a VERDICT `evidence-sufficiency`
 * reaches about evidence, never a label a writer gives itself: a
 * self-assignable «verified» would be the whole vulnerability.
 */
export const VALUE_PROVENANCES = ["STATED", "INFERRED", "OBSERVED"] as const;
export type ValueProvenance = (typeof VALUE_PROVENANCES)[number];

/** Per-attribute provenance. A field with no entry is NOT inferred. */
export type AttributeProvenance = Readonly<Record<string, ValueProvenance>>;

export function isValueProvenance(value: unknown): value is ValueProvenance {
  return typeof value === "string" && (VALUE_PROVENANCES as readonly string[]).includes(value);
}

export type ConstraintResult = {
  field: string;
  operator: string;
  state: ConstraintState;
  detail?: string;
};

export class EconomicAuthorizationError extends Error {
  override name = "EconomicAuthorizationError";
}

export class EconomicNotFoundError extends Error {
  override name = "EconomicNotFoundError";
}

/** Keys that may ever cross into a public projection. Nothing else leaks. */
const PUBLIC_PROJECTION_KEYS = new Set([
  "semanticType",
  "summary",
  "publicTerms",
  "availability",
  "publicEvidence",
  "engagementAction",
  "locationSummary",
  // WHICH of this offering's terms the other party may state values for, and
  // within what bounds. Published by the offering's owner, so widening it is
  // the owner's act and never the configuring party's.
  "configurableTerms",
]);

/**
 * The ONLY shape a non-owner may ever observe. Built solely from the
 * authorized public projection — never from private attributes, constraints,
 * or availability internals.
 */
export type PublicExpressionView = {
  id: string;
  kind: "offering" | "need";
  semanticType: string;
  visibility: EconomicExpression["visibility"];
  status: EconomicExpression["status"];
  version: number;
  projection: Record<string, unknown>;
};

function toPublicView(row: EconomicExpression): PublicExpressionView {
  const projection = (row.publicProjection ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.kind,
    semanticType:
      typeof projection.semanticType === "string" ? projection.semanticType : row.semanticType,
    visibility: row.visibility,
    status: row.status,
    version: row.version,
    projection,
  };
}

function normalizeSemanticText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Deterministic semantic compatibility gate for matching: substring or token
 * overlap between semantic types, or an explicit servesSemantics declaration
 * on the Offering. No LLM, no opaque scoring.
 */
export function semanticsCompatible(
  need: EconomicExpression,
  offering: EconomicExpression,
): boolean {
  const needType = normalizeSemanticText(need.semanticType);
  const offType = normalizeSemanticText(offering.semanticType);
  if (!needType || !offType) return false;
  if (needType.includes(offType) || offType.includes(needType)) return true;
  const needTokens = new Set(needType.split(/\s+/).filter(Boolean));
  const offTokens = new Set(offType.split(/\s+/).filter(Boolean));
  for (const token of needTokens) {
    if (offTokens.has(token)) return true;
  }
  const serves = offering.attributes?.servesSemantics;
  if (
    Array.isArray(serves) &&
    serves.some((entry) => {
      const declared = normalizeSemanticText(String(entry));
      return (
        declared === needType || needType.includes(declared) || declared.includes(needType)
      );
    })
  ) {
    return true;
  }
  return false;
}

function requireOwner(row: EconomicExpression | EconomicEngagement, ownerId: string): void {
  const owner =
    "ownerId" in row ? row.ownerId : undefined;
  if (owner !== undefined && owner !== ownerId) {
    throw new EconomicAuthorizationError("Cross-owner access denied.");
  }
}

// ---------------------------------------------------------------------------
// Expressions (Offering / Need)
// ---------------------------------------------------------------------------

export async function createExpression(input: {
  ownerId: string;
  kind: "offering" | "need";
  semanticType: string;
  subjectEntityId?: string;
  schemaRef?: { id: string; version: string };
  attributes?: Record<string, unknown>;
  hardConstraints?: ConstraintExpression[];
  softPreferences?: ConstraintExpression[];
  availability?: Record<string, unknown>;
  /** Where each attribute value came from. A field with no entry is not inferred. */
  attributeProvenance?: AttributeProvenance;
}): Promise<EconomicExpression> {
  const [row] = await db
    .insert(economicExpressions)
    .values({
      id: randomUUID(),
      ownerId: input.ownerId,
      kind: input.kind,
      semanticType: input.semanticType,
      subjectEntityId: input.subjectEntityId,
      schemaRef: input.schemaRef,
      attributes: input.attributes ?? {},
      ...(input.attributeProvenance ? { attributeProvenance: { ...input.attributeProvenance } } : {}),
      hardConstraints: input.hardConstraints ?? [],
      softPreferences: input.softPreferences ?? [],
      availability: input.availability,
      visibility: "private",
      status: "draft",
    })
    .returning();
  return row;
}

/** Trusted server-side read. Never return this across an owner boundary. */
async function getExpressionInternal(id: string): Promise<EconomicExpression | undefined> {
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, id))
    .limit(1);
  return row;
}

export async function getExpression(
  id: string,
  requesterOwnerId?: string,
): Promise<EconomicExpression | PublicExpressionView | undefined> {
  const row = await getExpressionInternal(id);
  if (!row) return undefined;
  if (row.ownerId === requesterOwnerId) return row;
  // PRIVATE never crosses owners. SHARED requires an explicit active read
  // grant and returns the full participant view. UNLISTED is an explicit
  // permitted reference; PUBLIC is published. Those expose only the
  // controlled projection.
  if (row.visibility === "private") {
    throw new EconomicAuthorizationError("Cross-owner access denied.");
  }
  if (row.visibility === "shared") {
    if (requesterOwnerId) {
      const access = await checkMembershipAccess(db, {
        ownerId: row.ownerId,
        subjectId: requesterOwnerId,
        resourceKind: "economic_expression",
        resourceId: row.id,
        permission: "read",
      });
      if (access.ok) return row;
    }
    throw new EconomicAuthorizationError("Cross-owner access denied.");
  }
  return toPublicView(row);
}

export async function grantExpressionAccess(input: {
  expressionId: string;
  actorOwnerId: string;
  subjectId: string;
  permissions?: string[];
  purpose?: string;
  expiresAt?: Date;
}): Promise<{
  expression: EconomicExpression;
  membership: Membership;
  created: boolean;
}> {
  const row = await getExpressionInternal(input.expressionId);
  if (!row) throw new EconomicNotFoundError("Expression not found.");
  requireOwner(row, input.actorOwnerId);

  let expression = row;
  if (row.visibility === "private") {
    const [updated] = await db
      .update(economicExpressions)
      .set({
        visibility: "shared",
        version: row.version + 1,
      })
      .where(eq(economicExpressions.id, row.id))
      .returning();
    expression = updated;
  }

  const { membership, created } = await grantMembership(db, {
    ownerId: row.ownerId,
    subjectId: input.subjectId,
    resourceKind: "economic_expression",
    resourceId: row.id,
    permissions: input.permissions ?? ["read"],
    purpose: input.purpose,
    expiresAt: input.expiresAt,
  });
  return { expression, membership, created };
}

export async function revokeExpressionAccess(input: {
  expressionId: string;
  actorOwnerId: string;
  subjectId: string;
}): Promise<Membership> {
  const row = await getExpressionInternal(input.expressionId);
  if (!row) throw new EconomicNotFoundError("Expression not found.");
  requireOwner(row, input.actorOwnerId);

  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.ownerId, row.ownerId),
        eq(memberships.subjectId, input.subjectId),
        eq(memberships.resourceKind, "economic_expression"),
        eq(memberships.resourceId, row.id),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new EconomicNotFoundError("Expression membership not found.");
  }
  return revokeMembership(db, {
    membershipId: membership.id,
    actorOwnerId: input.actorOwnerId,
  });
}

/**
 * Publication is an authorized state transition producing a controlled
 * projection — never a raw dump of internal state.
 */
export async function publishExpression(input: {
  id: string;
  ownerId: string;
  projection: Record<string, unknown>;
}): Promise<EconomicExpression> {
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, input.id))
    .limit(1);
  if (!row) throw new EconomicNotFoundError("Expression not found.");
  requireOwner(row, input.ownerId);
  const disallowed = Object.keys(input.projection).filter(
    (key) => !PUBLIC_PROJECTION_KEYS.has(key),
  );
  if (disallowed.length > 0) {
    throw new Error(
      `Public projection may only contain authorized keys; rejected: ${disallowed.join(", ")}`,
    );
  }
  const [updated] = await db
    .update(economicExpressions)
    .set({
      visibility: "public",
      status: "active",
      publicProjection: input.projection,
      version: row.version + 1,
    })
    .where(eq(economicExpressions.id, row.id))
    .returning();
  return updated;
}

/**
 * General discovery: only PUBLIC expressions are eligible for cross-user
 * discovery. Owners always see their own expressions. PRIVATE/UNLISTED/SHARED
 * never appear in general discovery for other users.
 */
/**
 * SOMETHING TRUE OF MY OWN THING — not something I require of yours.
 *
 * ── THE DISTINCTION THIS FUNCTION EXISTS TO HOLD ────────────────────────────
 *
 *   A FACT ABOUT ME IS NOT A REQUIREMENT OF THEM
 *
 * «أريد مكانيكياً ضمن 25 كم» is a CONSTRAINT: what a candidate must satisfy.
 * «أنا عند الدوار الخامس» is an ATTRIBUTE: what is true of me. Conflating them
 * turns my own location into something candidates are filtered against, which
 * is not a sentence anybody meant — and it is why the need a turn created
 * carried constraints and never once carried a fact.
 *
 * ── WHAT A MODEL'S READING OF MY SENTENCE IS WORTH ──────────────────────────
 *
 *   MODEL_EXTRACTION != OWNER_DECLARATION
 *
 * I said words; something turned them into a value. That value may be right
 * and it is still not me speaking, so it lands INFERRED by default — and an
 * INFERRED value already decides nothing anywhere in this runtime. It becomes
 * STATED when I look at what was recorded and say yes, which is the only
 * moment at which I actually declared it.
 *
 * ── AND IT IS NOT A PUBLICATION ─────────────────────────────────────────────
 *
 *   STATING_IS_NOT_PUBLISHING
 *
 * The public projection is not touched. Telling JASIM where I am is not
 * telling the world, and nothing here can widen what anybody else can see.
 */
export async function stateOwnAttribute(input: {
  expressionId: string;
  ownerId: string;
  field: string;
  value: unknown;
  /** Default INFERRED. STATED only when the owner confirmed this exact value. */
  provenance?: ValueProvenance;
}): Promise<EconomicExpression> {
  const field = input.field.trim();
  if (!field) throw new EconomicAuthorizationError("A value with no field is not a statement.");
  const [row] = await db
    .select()
    .from(economicExpressions)
    .where(eq(economicExpressions.id, input.expressionId))
    .limit(1);
  if (!row) throw new EconomicNotFoundError("Expression not found.");
  //   OWNER_STATES_ONLY_THEIR_OWN — stating a fact about somebody else's thing
  //   is the whole class of impersonation this refuses in one line.
  requireOwner(row, input.ownerId);

  const attributes = { ...((row.attributes ?? {}) as Record<string, unknown>) };
  const provenanceMap = {
    ...((row.attributeProvenance ?? {}) as AttributeProvenance),
  } as Record<string, ValueProvenance>;
  attributes[field] = input.value;
  provenanceMap[field] = input.provenance ?? "INFERRED";

  const [updated] = await db
    .update(economicExpressions)
    .set({
      attributes,
      attributeProvenance: provenanceMap,
      version: row.version + 1,
      // publicProjection deliberately absent. STATING_IS_NOT_PUBLISHING.
    })
    .where(eq(economicExpressions.id, row.id))
    .returning();
  return updated!;
}

export async function discoverExpressions(input: {
  kind: "offering" | "need";
  requesterOwnerId: string;
  semanticType?: string;
}): Promise<Array<EconomicExpression | PublicExpressionView>> {
  const rows = await db
    .select()
    .from(economicExpressions)
    .where(
      and(
        eq(economicExpressions.kind, input.kind),
        eq(economicExpressions.status, "active"),
      ),
    )
    .limit(500);
  return rows
    .filter((row) => {
      if (row.ownerId === input.requesterOwnerId) return true;
      if (row.visibility !== "public") return false;
      if (
        input.semanticType &&
        !row.semanticType.toLowerCase().includes(input.semanticType.toLowerCase()) &&
        !String(row.publicProjection?.semanticType ?? row.semanticType)
          .toLowerCase()
          .includes(input.semanticType.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .map((row) => (row.ownerId === input.requesterOwnerId ? row : toPublicView(row)));
}

// ---------------------------------------------------------------------------
// Deterministic matching
// ---------------------------------------------------------------------------

function readField(source: Record<string, unknown>, field: string): unknown {
  return source[field];
}

/**
 * Does this candidate satisfy this constraint?
 *
 * Exported because DISCOVERY must reach the same answer as matching. Two
 * evaluators of one question drift, and the drift resolves in favour of
 * whichever one said yes.
 *
 *   TWO_CONSTRAINT_EVALUATORS = 0
 */
export function evaluateConstraint(
  constraint: ConstraintExpression,
  candidateAttributes: Record<string, unknown>,
  candidateConstraints?: { unit?: string },
  candidateProvenance?: AttributeProvenance,
): ConstraintResult {
  const base: Pick<ConstraintResult, "field" | "operator"> = {
    field: constraint.field,
    operator: constraint.operator,
  };
  const raw = readField(candidateAttributes, constraint.field);
  if (raw === undefined || raw === null) {
    return { ...base, state: "UNKNOWN", detail: "field not present" };
  }
  // ── A GUESS ABOUT SOMEBODY'S THING DECIDES NOTHING ──────────────────────
  //
  // An INFERRED value is a model's reading of a photo, a video or a sentence.
  // It may be right, and it is still not the owner speaking. Letting it answer
  // a hard constraint means a guess decides a real commercial outcome — in
  // BOTH directions, since excluding a candidate wrongly costs the seller and
  // including one wrongly costs the buyer.
  //
  //   INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0
  //   INFERRED_VALUE_ADMITS_A_CANDIDATE = 0
  //
  // UNKNOWN is the honest answer and already means what is needed here:
  // «nothing is known», never FAIL. A buyer who cares then asks — the brokering
  // path carries the question to the owner, whose answer is theirs.
  //
  // This mirrors `evaluateGoalSpec`, which downgrades an INFERRED constraint
  // from HARD to SOFT for the same reason: an inference may guide, never decide.
  if (candidateProvenance?.[constraint.field] === "INFERRED") {
    return {
      ...base,
      state: "UNKNOWN",
      detail: "value is inferred, not stated by its owner",
    };
  }

  let candidateValue = raw;
  if (
    typeof raw === "number" &&
    typeof constraint.value === "number" &&
    constraint.unit
  ) {
    const candidateUnit =
      candidateConstraints?.unit ??
      (typeof candidateAttributes[`${constraint.field}Unit`] === "string"
        ? (candidateAttributes[`${constraint.field}Unit`] as string)
        : constraint.unit);
    if (candidateUnit !== constraint.unit) {
      const normalized = normalizeUnit(raw, candidateUnit, constraint.unit);
      if (normalized === undefined) {
        return { ...base, state: "UNKNOWN", detail: "incompatible units" };
      }
      candidateValue = normalized;
    }
  }

  const compare = (): boolean | "unknown" => {
    switch (constraint.operator) {
      case "eq":
        return candidateValue === constraint.value;
      case "neq":
        return candidateValue !== constraint.value;
      case "gte":
        return typeof candidateValue === "number" && typeof constraint.value === "number"
          ? candidateValue >= constraint.value
          : "unknown";
      case "lte":
        return typeof candidateValue === "number" && typeof constraint.value === "number"
          ? candidateValue <= constraint.value
          : "unknown";
      case "gt":
        return typeof candidateValue === "number" && typeof constraint.value === "number"
          ? candidateValue > constraint.value
          : "unknown";
      case "lt":
        return typeof candidateValue === "number" && typeof constraint.value === "number"
          ? candidateValue < constraint.value
          : "unknown";
      case "contains":
        if (Array.isArray(candidateValue)) return candidateValue.includes(constraint.value);
        if (typeof candidateValue === "string" && typeof constraint.value === "string") {
          return candidateValue.toLowerCase().includes(constraint.value.toLowerCase());
        }
        return "unknown";
      case "within_time":
      case "compatible":
        return candidateValue === constraint.value ? true : "unknown";
    }
  };

  const outcome = compare();
  if (outcome === "unknown") return { ...base, state: "UNKNOWN" };
  return { ...base, state: outcome ? "PASS" : "FAIL" };
}

/**
 * THE NAME A DERIVED DISTANCE TAKES, in metres, the base unit of length.
 *
 * Reserved rather than magic: a need bounds `distance` the way it bounds any
 * other quantity, and the unit table converts «25 km» for it like anything else.
 */
export const DERIVED_DISTANCE_FIELD = "distance";

/**
 * HOW FAR APART, when both sides actually said where they are.
 *
 * ─── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 *
 * A point is read through the same strict reader observations use: two finite
 * numbers in range, never a coerced string and never an out-of-range pair,
 * because a coerced point is a fabricated location.
 *
 *   FABRICATED_POINT = 0
 *
 * One side without a usable point yields NOTHING — not a large distance. «Not
 * known to be near» is not «far», and returning a number here would turn a
 * silence into an exclusion.
 *
 *   MISSING_POINT_IS_UNKNOWN_NOT_FAR
 *
 * And a derived value never displaces a stated one: if the owner themselves
 * stated a field by this name, theirs stands and nothing is derived over it.
 *
 *   DERIVED_VALUE_OVERWRITES_A_STATED_ONE = 0
 */
export function withDistanceFrom(input: {
  /** Where the asking side is. Undefined when they never said. */
  readonly origin: { readonly lat: number; readonly lng: number } | undefined;
  /** True when the origin was derived rather than stated by whoever owns it. */
  readonly originInferred?: boolean;
  readonly attributes: Record<string, unknown>;
  readonly provenance?: AttributeProvenance | undefined;
}): {
  attributes: Record<string, unknown>;
  provenance: AttributeProvenance | undefined;
} {
  const attributes = { ...input.attributes };
  const provenance = input.provenance;
  if (DERIVED_DISTANCE_FIELD in attributes) return { attributes, provenance };

  const there = coordinatesFromPayload(
    (attributes.location ?? undefined) as Record<string, unknown> | undefined,
  );
  if (!input.origin || !there) return { attributes, provenance };

  attributes[DERIVED_DISTANCE_FIELD] = greatCircleMetres(input.origin, there);
  attributes[`${DERIVED_DISTANCE_FIELD}Unit`] = "m";
  // A derivation is only as good as what it was derived FROM. If either side's
  // location was a model's reading of a photo rather than its owner's word, the
  // distance inherits that and decides nothing — the same rule, one step along.
  //
  //   INFERRED_LOCATION_DECIDES_PROXIMITY = 0
  const eitherInferred = provenance?.location === "INFERRED" || input.originInferred === true;
  return {
    attributes,
    ...(eitherInferred
      ? { provenance: { ...(provenance ?? {}), [DERIVED_DISTANCE_FIELD]: "INFERRED" as const } }
      : { provenance }),
  };
}

/** The two-expression shape matching uses. One derivation, two callers. */
function withDerivedDistance(
  need: EconomicExpression,
  offering: EconomicExpression,
): {
  attributes: Record<string, unknown>;
  provenance: AttributeProvenance | undefined;
} {
  const needProvenance = need.attributeProvenance as AttributeProvenance | null | undefined;
  const origin = coordinatesFromPayload(
    (need.attributes?.location ?? undefined) as Record<string, unknown> | undefined,
  );
  return withDistanceFrom({
    origin,
    originInferred: needProvenance?.location === "INFERRED",
    attributes: (offering.attributes ?? {}) as Record<string, unknown>,
    provenance: (offering.attributeProvenance ?? undefined) as AttributeProvenance | undefined,
  });
}

export function evaluateMatch(
  need: EconomicExpression,
  offering: EconomicExpression,
): { results: ConstraintResult[]; viable: boolean } {
  const constraints = (need.hardConstraints ?? []) as ConstraintExpression[];
  const { attributes, provenance } = withDerivedDistance(need, offering);
  const results = constraints.map((constraint) =>
    evaluateConstraint(constraint, attributes, undefined, provenance),
  );
  // UNKNOWN is never FAIL, but a candidate with zero proven PASSes is not viable either.
  const viable =
    !results.some((result) => result.state === "FAIL") &&
    (results.length === 0 || results.some((result) => result.state === "PASS"));
  return { results, viable };
}

export async function matchNeedToOffering(input: {
  needId: string;
  offeringId: string;
  createdByOwnerId: string;
}): Promise<EconomicMatch> {
  const need = await getExpressionInternal(input.needId);
  const offering = await getExpressionInternal(input.offeringId);
  if (!need || !offering) throw new EconomicNotFoundError("Expression not found.");
  // Authorization: only the Need owner may initiate matching (the match
  // record is attributed to them), and the Offering must be theirs or
  // publicly visible — private expressions are never an oracle.
  if (need.ownerId !== input.createdByOwnerId || need.kind !== "need") {
    throw new EconomicAuthorizationError("Only the Need owner may initiate matching.");
  }
  if (offering.ownerId !== input.createdByOwnerId && offering.visibility !== "public") {
    throw new EconomicAuthorizationError("Offering is not visible to this owner.");
  }
  if (!semanticsCompatible(need, offering)) {
    const [row] = await db
      .insert(economicMatches)
      .values({
        id: randomUUID(),
        needId: need.id,
        offeringId: offering.id,
        constraintResults: [
          {
            field: "semanticType",
            operator: "compatible",
            state: "FAIL",
            detail: "semantic types are not compatible",
          },
        ],
        status: "rejected",
        createdByOwnerId: input.createdByOwnerId,
      })
      .returning();
    return row;
  }
  const { results, viable } = evaluateMatch(need, offering);
  const [row] = await db
    .insert(economicMatches)
    .values({
      id: randomUUID(),
      needId: need.id,
      offeringId: offering.id,
      constraintResults: results,
      status: viable ? "viable" : "rejected",
      createdByOwnerId: input.createdByOwnerId,
    })
    .returning();
  return row;
}

/**
 * Discover candidate Offerings for a Need, filter hard constraints first,
 * then attempt a composite match when the Need allows splitting.
 */
export async function matchNeed(input: {
  needId: string;
  requesterOwnerId: string;
}): Promise<{ matches: EconomicMatch[]; composite?: EconomicMatch }> {
  const need = await getExpressionInternal(input.needId);
  if (!need) throw new EconomicNotFoundError("Need not found.");
  if (need.ownerId !== input.requesterOwnerId || need.kind !== "need") {
    throw new EconomicAuthorizationError("Only the Need owner may initiate matching.");
  }
  // Server-side trusted candidate scan: public expressions plus the
  // requester's own active ones. Only Match records (never raw attributes)
  // leave this function.
  const candidates = (
    await db
      .select()
      .from(economicExpressions)
      .where(
        and(
          eq(economicExpressions.kind, "offering"),
          eq(economicExpressions.status, "active"),
        ),
      )
      .limit(500)
  ).filter(
    (row) =>
      row.visibility === "public" || row.ownerId === input.requesterOwnerId,
  );

  const matches: EconomicMatch[] = [];
  const capacityContributors: Array<{
    offering: EconomicExpression;
    value: number;
    results: ConstraintResult[];
  }> = [];
  const constraints = (need.hardConstraints ?? []) as ConstraintExpression[];
  const capacityConstraint = constraints.find(
    (constraint) =>
      ["gte", "gt"].includes(constraint.operator) && typeof constraint.value === "number",
  );

  for (const offering of candidates) {
    if (offering.id === need.id) continue;
    // Hard semantic-compatibility gate before any constraint work.
    if (!semanticsCompatible(need, offering)) continue;
    const { results, viable } = evaluateMatch(need, offering);
    if (viable) {
      const [row] = await db
        .insert(economicMatches)
        .values({
          id: randomUUID(),
          needId: need.id,
          offeringId: offering.id,
          constraintResults: results,
          status: "viable",
          createdByOwnerId: input.requesterOwnerId,
        })
        .returning();
      matches.push(row);
      continue;
    }
    // Composite eligibility: only capacity may fail; every other hard
    // constraint must not FAIL (UNKNOWN is tolerated, never claimed).
    if (capacityConstraint) {
      const otherFailure = results.some(
        (result) => result.field !== capacityConstraint.field && result.state === "FAIL",
      );
      if (otherFailure) continue;
      // The same law, on the path that does not go through `evaluateConstraint`.
      // A composite match sums capacities into a promise somebody will be held
      // to; a guessed capacity has no business in that sum.
      //
      //   INFERRED_VALUE_CONTRIBUTES_TO_A_CAPACITY_PROMISE = 0
      if (
        (offering.attributeProvenance as AttributeProvenance | null | undefined)?.[
          capacityConstraint.field
        ] === "INFERRED"
      ) {
        continue;
      }
      const raw = offering.attributes?.[capacityConstraint.field];
      if (typeof raw === "number" && raw > 0) {
        const unit =
          (offering.attributes?.[`${capacityConstraint.field}Unit`] as string) ??
          capacityConstraint.unit;
        const normalized = unit
          ? normalizeUnit(raw, unit, capacityConstraint.unit ?? unit)
          : raw;
        if (normalized !== undefined) {
          capacityContributors.push({ offering, value: normalized, results });
        }
      }
    }
  }

  const splitAllowed = need.attributes?.splitAllowed === true;
  const singleFacilityRequired = need.attributes?.singleFacilityRequired === true;
  if (
    matches.length === 0 &&
    capacityConstraint &&
    splitAllowed &&
    !singleFacilityRequired &&
    capacityContributors.length > 1
  ) {
    const required = capacityConstraint.value as number;
    const sorted = [...capacityContributors].sort((a, b) => b.value - a.value);
    const picked: typeof sorted = [];
    let total = 0;
    for (const contributor of sorted) {
      picked.push(contributor);
      total += contributor.value;
      if (total >= required) break;
    }
    if (total >= required) {
      // Truthfulness: the composite carries every contributor's full
      // constraint results — UNKNOWN states are preserved, never hidden
      // behind the passing capacity total.
      const compositeResults: Array<Record<string, unknown>> = [
        {
          field: capacityConstraint.field,
          operator: capacityConstraint.operator,
          state: "PASS",
          detail: `composite total ${total} >= ${required}`,
        },
      ];
      let hasUnknown = false;
      for (const contributor of picked) {
        for (const result of contributor.results) {
          if (result.field === capacityConstraint.field) continue;
          if (result.state === "UNKNOWN") hasUnknown = true;
          compositeResults.push({
            ...result,
            contributorExpressionId: contributor.offering.id,
          });
        }
      }
      const [composite] = await db
        .insert(economicMatches)
        .values({
          id: randomUUID(),
          needId: need.id,
          offeringId: null,
          compositeComponents: picked.map((contributor) => ({
            expressionId: contributor.offering.id,
            contribution: {
              field: capacityConstraint.field,
              value: contributor.value,
              unit: capacityConstraint.unit,
            },
            constraintResults: contributor.results,
          })),
          constraintResults: compositeResults,
          // A composite with unresolved UNKNOWNs is a candidate, not viable.
          status: hasUnknown ? "candidate" : "viable",
          createdByOwnerId: input.requesterOwnerId,
        })
        .returning();
      return { matches, composite };
    }
  }

  return { matches };
}

// ---------------------------------------------------------------------------
// Engagement + versioned Proposal + TransactionIntent
// ---------------------------------------------------------------------------

/**
 * The parties of a match, derived from the matched expressions.
 *
 * Exported because a caller that had to NAME the participants could name a
 * stranger. The only correct answer comes from the match itself, so the only
 * safe thing a caller can do is ask for it.
 */
export async function participantsForMatch(matchId: string): Promise<string[]> {
  const [match] = await db
    .select()
    .from(economicMatches)
    .where(eq(economicMatches.id, matchId))
    .limit(1);
  if (!match) throw new EconomicNotFoundError("Match not found.");
  const expressionIds = [
    match.needId,
    ...(match.offeringId
      ? [match.offeringId]
      : (match.compositeComponents ?? []).map((c) => c.expressionId)),
  ];
  const matched = await db
    .select()
    .from(economicExpressions)
    .where(inArray(economicExpressions.id, expressionIds));
  return [...new Set(matched.map((row) => row.ownerId))];
}

export async function createEngagement(input: {
  matchId: string;
  initiatorOwnerId: string;
  participants: string[];
  context?: Record<string, unknown>;
  /**
   * WHICH conversational need this attempt came from, at the revision it had
   * when the attempt was made. Runtime-supplied; a model never names it.
   *
   *   PROVENANCE != AUTHORITY — recording where something came from grants
   *   nobody anything, and this value is read by no authorization check.
   */
  need?: { id: string; revision: number };
}): Promise<EconomicEngagement> {
  // Engagements are match-backed: participants are DERIVED from an authorized
  // match, never caller-nominated. Unmatched engagements would require an
  // invitation/consent flow that does not exist yet — reject truthfully
  // rather than persisting a fabricated cross-owner relationship.
  const [match] = await db
    .select()
    .from(economicMatches)
    .where(eq(economicMatches.id, input.matchId))
    .limit(1);
  if (!match) throw new EconomicNotFoundError("Match not found.");
  if (match.status !== "viable" && match.status !== "candidate") {
    throw new EconomicAuthorizationError(`Match is ${match.status}, not viable.`);
  }
  if (match.createdByOwnerId !== input.initiatorOwnerId) {
    throw new EconomicAuthorizationError(
      "Only the match initiator may open an engagement from it.",
    );
  }
  // Derive the exact participant set from the matched expressions.
  const allowed = new Set(await participantsForMatch(input.matchId));
  const requested = new Set(input.participants);
  if (requested.size !== allowed.size || [...requested].some((p) => !allowed.has(p))) {
    throw new EconomicAuthorizationError(
      "Engagement participants must be exactly the parties of the authorized match.",
    );
  }
  const [row] = await db
    .insert(economicEngagements)
    .values({
      id: randomUUID(),
      matchId: input.matchId,
      initiatorOwnerId: input.initiatorOwnerId,
      participants: input.participants,
      context: input.context ?? {},
      ...(input.need
        ? { needId: input.need.id, needRevision: input.need.revision }
        : {}),
    })
    .returning();
  return row;
}

/**
 * THE ONE GATE FOR «MAY THESE TWO PARTIES BE IN CONTACT AT ALL».
 *
 * Exported so that anything else built between two owners asks THIS question
 * rather than growing its own answer. An engagement is match-backed and its
 * participants are derived, never nominated — so participation in one is the
 * consent, and a second consent path would be a second place to get it wrong.
 *
 *   ENGAGEMENT_IS_THE_CONTACT_AUTHORITY
 *   SECOND_CROSS_OWNER_CONSENT_PATH = 0
 */
export async function requireEngagementParticipant(
  engagementId: string,
  ownerId: string,
): Promise<EconomicEngagement> {
  const [row] = await db
    .select()
    .from(economicEngagements)
    .where(eq(economicEngagements.id, engagementId))
    .limit(1);
  if (!row) throw new EconomicNotFoundError("Engagement not found.");
  if (!row.participants.includes(ownerId)) {
    throw new EconomicAuthorizationError("Not an engagement participant.");
  }
  return row;
}

export async function createProposal(input: {
  engagementId: string;
  proposerOwnerId: string;
  terms: Record<string, unknown>;
  termsSchemaRef?: { id: string; version: string };
  expiresAt?: Date;
}): Promise<EconomicProposal> {
  await requireEngagementParticipant(input.engagementId, input.proposerOwnerId);
  // Versioning is transactional and CAS-guarded: the previous proposal is
  // countered only if still proposed, and the unique (engagementId, version)
  // index rejects any concurrent duplicate version.
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(economicProposals)
      .where(eq(economicProposals.engagementId, input.engagementId))
      .orderBy(desc(economicProposals.version))
      .limit(1);
    const version = (existing[0]?.version ?? 0) + 1;
    if (existing[0]) {
      await tx
        .update(economicProposals)
        .set({ status: "countered" })
        .where(
          and(
            eq(economicProposals.id, existing[0].id),
            eq(economicProposals.status, "proposed"),
          ),
        );
    }
    const [row] = await tx
      .insert(economicProposals)
      .values({
        id: randomUUID(),
        engagementId: input.engagementId,
        proposerOwnerId: input.proposerOwnerId,
        terms: input.terms,
        termsSchemaRef: input.termsSchemaRef,
        version,
        status: "proposed",
        supersedesId: existing[0]?.id,
        expiresAt: input.expiresAt,
      })
      .returning();
    return row;
  });
}

/**
 * Acceptance references the exact proposal version and creates a
 * TransactionIntent. Payment is never mandatory: valueKind derives from
 * whether terms carry a monetary amount.
 */
export async function respondToProposal(input: {
  proposalId: string;
  ownerId: string;
  action: "accept" | "reject";
}): Promise<{ proposal: EconomicProposal; transactionIntent?: TransactionIntent }> {
  const [proposal] = await db
    .select()
    .from(economicProposals)
    .where(eq(economicProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new EconomicNotFoundError("Proposal not found.");
  const engagement = await requireEngagementParticipant(
    proposal.engagementId,
    input.ownerId,
  );
  if (proposal.proposerOwnerId === input.ownerId) {
    throw new EconomicAuthorizationError("Proposer cannot accept their own proposal.");
  }
  if (proposal.status !== "proposed") {
    throw new Error(`Proposal v${proposal.version} is ${proposal.status}, not proposed.`);
  }
  // CAS transition + intent creation in ONE transaction, with expiry evaluated
  // by DATABASE TIME inside the same predicate: a proposal expiring between
  // read and update can never be accepted.
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(economicProposals)
      .set({ status: input.action === "accept" ? "accepted" : "rejected" })
      .where(
        and(
          eq(economicProposals.id, proposal.id),
          eq(economicProposals.status, "proposed"),
          or(
            isNull(economicProposals.expiresAt),
            sql`${economicProposals.expiresAt} > now()`,
          ),
        ),
      )
      .returning();
    if (!updated) {
      // Distinguish expiry from a concurrent decision, atomically.
      const [current] = await tx
        .select()
        .from(economicProposals)
        .where(eq(economicProposals.id, proposal.id))
        .limit(1);
      if (current?.status === "proposed") {
        await tx
          .update(economicProposals)
          .set({ status: "expired" })
          .where(
            and(eq(economicProposals.id, proposal.id), eq(economicProposals.status, "proposed")),
          );
        throw new Error(`Proposal v${proposal.version} has expired.`);
      }
      throw new Error(`Proposal v${proposal.version} is no longer proposed.`);
    }

    if (input.action === "reject") return { proposal: updated };

    const terms = proposal.terms ?? {};
    const monetary =
      typeof terms.price === "number" && typeof terms.currency === "string";
    const [intent] = await tx
      .insert(transactionIntents)
      .values({
        id: randomUUID(),
        proposalId: proposal.id,
        engagementId: engagement.id,
        participants: engagement.participants,
        valueKind: monetary ? "monetary" : "non_monetary",
        terms,
        status: "intent",
      })
      .returning();
    return { proposal: updated, transactionIntent: intent };
  });
}

// ---------------------------------------------------------------------------
// Test/maintenance helper
// ---------------------------------------------------------------------------

export async function deleteExpressionsForOwners(ownerIds: string[]): Promise<void> {
  const rows = await db
    .select({ id: economicExpressions.id })
    .from(economicExpressions)
    .where(inArray(economicExpressions.ownerId, ownerIds));
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  const matches = await db
    .select({ id: economicMatches.id })
    .from(economicMatches)
    .where(inArray(economicMatches.needId, ids));
  if (matches.length > 0) {
    await db
      .delete(economicMatches)
      .where(inArray(economicMatches.id, matches.map((m) => m.id)));
  }
  await db.delete(economicExpressions).where(inArray(economicExpressions.id, ids));
}
