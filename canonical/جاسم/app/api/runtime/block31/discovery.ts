import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  discoveryCandidates,
  discoveryResultSets,
  economicExpressions,
  type CandidateTrust,
  type DiscoverySourceKind,
  type EconomicExpression,
} from "../../../db/schema";
import {
  evaluateConstraintSet,
  withDistanceFrom,
  type AttributeProvenance,
} from "../economic-fabric";
import type { ConstraintExpression, ConstraintOperator } from "../semantic-fabric";

export type Block31Db = NodePgDatabase<any>;

export type SourceAvailability =
  | Partial<Record<DiscoverySourceKind, boolean>>
  | {
      internal?: boolean;
      web?: boolean;
      connectedProviders?: readonly string[];
      mcpProviders?: readonly string[];
      a2aProviders?: readonly string[];
    };

const ALL_SOURCES: DiscoverySourceKind[] = [
  "JASIM_INTERNAL",
  "WEB_OBSERVATION",
  "CONNECTED_PROVIDER",
  "MCP_PROVIDER",
  "A2A_PROVIDER",
];

function isAvailable(source: DiscoverySourceKind, availability: SourceAvailability): boolean {
  if (source in availability) {
    return (availability as Partial<Record<DiscoverySourceKind, boolean>>)[source] === true;
  }
  const configured = availability as Exclude<SourceAvailability, Partial<Record<DiscoverySourceKind, boolean>>>;
  if (source === "JASIM_INTERNAL") return configured.internal !== false;
  if (source === "WEB_OBSERVATION") return configured.web !== false;
  if (source === "CONNECTED_PROVIDER") return (configured.connectedProviders?.length ?? 0) > 0;
  if (source === "MCP_PROVIDER") return (configured.mcpProviders?.length ?? 0) > 0;
  return (configured.a2aProviders?.length ?? 0) > 0;
}

function requestedSources(scope: unknown): DiscoverySourceKind[] {
  const values = Array.isArray(scope) ? scope : typeof scope === "string" ? [scope] : [];
  return values.flatMap((value) => {
    const normalized = String(value).trim().toUpperCase();
    if ((ALL_SOURCES as string[]).includes(normalized)) return [normalized as DiscoverySourceKind];
    if (normalized === "INTERNAL" || normalized === "JASIM") return ["JASIM_INTERNAL"];
    if (normalized === "WEB" || normalized === "INTERNET") return ["WEB_OBSERVATION"];
    if (normalized === "CONNECTED") return ["CONNECTED_PROVIDER"];
    if (normalized === "MCP") return ["MCP_PROVIDER"];
    if (normalized === "A2A") return ["A2A_PROVIDER"];
    return [];
  });
}

/** Select only sources justified by the user's restriction and actual availability. */
export function planSources(
  query: string,
  explicitScope?: unknown,
  availability: SourceAvailability = { internal: true, web: true },
): DiscoverySourceKind[] {
  const explicit = requestedSources(explicitScope);
  if (explicit.length > 0) return [...new Set(explicit)].filter((source) => isAvailable(source, availability));

  const normalized = `${query} ${typeof explicitScope === "string" ? explicitScope : ""}`
    .trim()
    .toLowerCase();
  const internalOnly = /only\s+(?:inside\s+)?jasim|فقط\s+داخل\s+جاسم/u.test(normalized);
  const webOnly =
    /only\s+(?:on\s+)?(?:the\s+)?(?:internet|web)|فقط\s+في\s+(?:الإنترنت|الانترنت|الويب)/u.test(
      normalized,
    );
  const desired: DiscoverySourceKind[] = internalOnly
    ? ["JASIM_INTERNAL"]
    : webOnly
      ? ["WEB_OBSERVATION"]
      : ["JASIM_INTERNAL", "WEB_OBSERVATION"];
  return desired.filter((source) => isAvailable(source, availability));
}

export type HardConstraint = {
  field?: string;
  operator?: "eq" | "=" | "max" | "<=" | "gte" | ">=";
  value?: unknown;
  /** The scale the bound is stated in. Dropping it is a silent false match. */
  unit?: string;
  maxMinor?: string;
  currency?: string;
  quantity?: number;
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function canonicalMinor(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * The attribute bag a constraint is judged against.
 *
 * `quantity` has always been readable from `availability` as well as from
 * `attributes`, and that stays true — it is flattened into one bag here so the
 * shared evaluator sees exactly what this function used to see.
 */
function candidateAttributes(row: EconomicExpression): Record<string, unknown> {
  const attributes = { ...(row.attributes ?? {}) } as Record<string, unknown>;
  if (attributes.location === undefined) {
    const fromAvailability = object(row.availability).location;
    if (fromAvailability !== undefined) attributes.location = fromAvailability;
  }
  if (attributes.quantity === undefined) {
    const fromAvailability = object(row.availability).quantity;
    if (fromAvailability !== undefined) attributes.quantity = fromAvailability;
  }
  return attributes;
}

/**
 * Money, compared in exact minor units, in one currency.
 *
 *   CURRENCY_IS_A_UNIT = 0
 *
 * Kept here and deliberately NOT handed to the shared evaluator: a currency is
 * not a scale of some other currency, and there is no rate anywhere on this
 * path.
 */
function satisfiesMoneyBound(row: EconomicExpression, constraint: HardConstraint): boolean {
  const money = object(row.attributes.price ?? row.attributes.money);
  const minor = canonicalMinor(row.attributes.priceMinor ?? money.minor ?? money.amountMinor);
  const maximum = canonicalMinor(constraint.maxMinor ?? constraint.value);
  if (minor === null || maximum === null) return false;
  const candidateCurrency = String(row.attributes.currency ?? money.currency ?? "").toUpperCase();
  if (constraint.currency && candidateCurrency !== constraint.currency.trim().toUpperCase()) {
    return false;
  }
  return minor <= maximum;
}

/**
 * WHERE THE ASKING SIDE IS, for this search only.
 *
 * «ابحث لي عن مكانيكي» means a NEARBY one, and until now proximity lived on
 * the matching side alone: `discover` had no idea where anybody was, so a
 * distance bound could not filter anything at all.
 *
 * It is the searcher's OWN point, carried for the length of one query and
 * never written anywhere. A candidate learns nothing: what leaves this module
 * is a candidate list built from public projections, and a projection has
 * never carried coordinates.
 *
 *   SEARCHING_NEAR_SOMEBODY_DISCLOSES_NOTHING = 0
 *   PROXIMITY_FILTERS_WITHOUT_DISCLOSING
 */
export type SearchOrigin = {
  readonly lat: number;
  readonly lng: number;
  /** True when the point was derived rather than stated by whoever owns it. */
  readonly inferred?: boolean;
};

/** The legacy discovery operators, in the vocabulary the fabric speaks. */
const OPERATOR_TRANSLATION: Readonly<Record<string, ConstraintOperator>> = Object.freeze({
  max: "lte",
  "<=": "lte",
  gte: "gte",
  ">=": "gte",
  eq: "eq",
  "=": "eq",
});

/**
 * Missing hard-constraint values do not pass: UNKNOWN is not a hard match.
 *
 * ── WHAT THIS STOPPED DOING BY ITSELF ───────────────────────────────────────
 *
 * This function used to compare raw numbers with its own small operator table.
 * `economic-fabric` had a second evaluator for the same question, and the two
 * had drifted apart in three ways that all cost real matches:
 *
 *   • UNITS — this one had none. A bound of «30 m³» was a bare `<= 30`, and a
 *     candidate holding 30000 litres satisfied it. The other normalizes.
 *
 *   • PROVENANCE — this one had none, so a model's reading of a photo both
 *     ADMITTED and EXCLUDED candidates on the path everybody searches through.
 *     INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0 was enforced on the matching
 *     side and nowhere here.
 *
 *   • OPERATORS — two vocabularies (`max` here, `lte` there) for one idea.
 *
 * So the comparison is now the fabric's, and this function keeps only what is
 * genuinely its own: money, and the legacy shapes discovery callers send.
 *
 *   TWO_CONSTRAINT_EVALUATORS = 0
 */
export function satisfiesHardConstraints(
  row: EconomicExpression,
  constraints: readonly HardConstraint[],
  origin?: SearchOrigin,
): boolean {
  // Distance is derived here, exactly as matching derives it, and by the same
  // function — so «within 25 km» means one thing in this runtime.
  //
  //   MISSING_POINT_IS_UNKNOWN_NOT_FAR — one side without a usable point
  //   yields no distance at all, never a large one, so a silence cannot be
  //   read as «far away».
  //
  //   INFERRED_LOCATION_DECIDES_PROXIMITY = 0 — a point a model read off a
  //   photo makes the distance INFERRED, and an inferred value decides
  //   nothing.
  const derived = withDistanceFrom({
    origin: origin ? { lat: origin.lat, lng: origin.lng } : undefined,
    ...(origin?.inferred ? { originInferred: true } : {}),
    attributes: candidateAttributes(row),
    provenance: (row.attributeProvenance ?? undefined) as AttributeProvenance | undefined,
  });
  const attributes = derived.attributes;
  const provenance = derived.provenance;
  // Money is compared here and alone: a currency is not a scale of another
  // currency, and there is no rate on this path.
  for (const constraint of constraints) {
    if (constraint.maxMinor !== undefined || constraint.field === "price") {
      if (!satisfiesMoneyBound(row, constraint)) return false;
    }
  }

  // ── EVERYTHING ELSE, TOGETHER ───────────────────────────────────────────
  //
  // Translated once into the fabric's vocabulary and evaluated as a SET, so an
  // offering that declared its configurations must satisfy every bound in the
  // SAME one. Judging them one at a time is what let a crane reaching 35 m and
  // lifting 20 t match a need for both, when it can only do either.
  //
  //   INDEPENDENT_CONSTRAINTS_SATISFIED != JOINTLY_SATISFIABLE
  const fieldConstraints: ConstraintExpression[] = [];
  for (const constraint of constraints) {
    if (constraint.maxMinor !== undefined || constraint.field === "price") continue;
    const field = constraint.field ?? (constraint.quantity !== undefined ? "quantity" : "");
    if (!field) return false;
    const value = constraint.quantity ?? constraint.value;
    if (value === undefined) return false;
    const operator = OPERATOR_TRANSLATION[constraint.operator ?? "eq"];
    if (!operator) return false;
    fieldConstraints.push({
      field,
      operator,
      value,
      ...(constraint.unit ? { unit: constraint.unit } : {}),
    });
  }
  if (fieldConstraints.length === 0) return true;

  const { results, jointlySatisfiable } = evaluateConstraintSet(
    fieldConstraints,
    attributes,
    provenance,
  );
  // No declared configuration satisfies all of them at once. Not «unknown» —
  // the owner said what it can do, and this is not among it.
  if (!jointlySatisfiable) return false;
  // UNKNOWN is not a hard match — the stance this function has always taken
  // and the reason it is still the one deciding. What CHANGED is which
  // answers are UNKNOWN: a missing value, an owner who never stated it, an
  // inference, or units that cannot be reconciled. Each of those is
  // "nobody knows", and none of them is "no".
  return results.every((result) => result.state === "PASS" || result.state === "SOFT_MATCH");
}

export type WebObservation = {
  url: string;
  title?: string | null;
  snippet?: string | null;
  provider?: string | null;
  domain?: string | null;
  retrievedAt?: string | Date | null;
  publishedAt?: string | null;
  attributes?: Record<string, unknown>;
  observedPriceMinor?: string | null;
  observedCurrency?: string | null;
  availability?: string | null;
};

export type NormalizedCandidate = {
  source: DiscoverySourceKind;
  canonicalRef: string | null;
  externalRef: string | null;
  providerId: string | null;
  title: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  observedPriceMinor: string | null;
  observedCurrency: string | null;
  availability: string | null;
  trust: CandidateTrust;
  capabilityRef: string | null;
  actionable: string[];
  provenance: Record<string, unknown>;
  observedAt: Date | null;
};

export function normalizeCandidate(
  input:
    | { source: "JASIM_INTERNAL"; expression: EconomicExpression }
    | { source: "WEB_OBSERVATION"; result: WebObservation },
): NormalizedCandidate {
  if (input.source === "JASIM_INTERNAL") {
    const projection = object(input.expression.publicProjection);
    const title =
      typeof projection.title === "string"
        ? projection.title
        : typeof projection.semanticType === "string"
          ? projection.semanticType
          : typeof projection.summary === "string"
            ? projection.summary
            : "";
    return {
      source: input.source,
      canonicalRef: input.expression.id,
      externalRef: null,
      providerId: null,
      title,
      summary: typeof projection.summary === "string" ? projection.summary : null,
      attributes: projection,
      observedPriceMinor: null,
      observedCurrency: null,
      availability: null,
      trust: "canonical_internal",
      capabilityRef: null,
      actionable: [],
      provenance: { canonicalKind: "economic_expression", version: input.expression.version },
      observedAt: input.expression.updatedAt,
    };
  }
  if (!/^https?:\/\//i.test(input.result.url)) throw new Error("Web candidate requires a valid HTTP(S) URL.");
  if (
    input.result.observedPriceMinor !== undefined &&
    input.result.observedPriceMinor !== null &&
    !/^-?\d+$/.test(input.result.observedPriceMinor)
  ) {
    throw new Error("Observed money must use exact integer minor units.");
  }
  if (
    (input.result.observedPriceMinor !== undefined &&
      input.result.observedPriceMinor !== null) !==
    (input.result.observedCurrency !== undefined &&
      input.result.observedCurrency !== null)
  ) {
    throw new Error("Observed money requires both minor units and currency.");
  }
  let domain = input.result.domain ?? null;
  if (!domain) domain = new URL(input.result.url).hostname.replace(/^www\./, "");
  const observedAt = input.result.retrievedAt ? new Date(input.result.retrievedAt) : null;
  if (observedAt && Number.isNaN(observedAt.getTime())) throw new Error("Invalid web retrieval timestamp.");
  return {
    source: input.source,
    canonicalRef: null,
    externalRef: input.result.url,
    providerId: input.result.provider ?? null,
    title: input.result.title ?? domain,
    summary: input.result.snippet ?? null,
    attributes: input.result.attributes ?? {},
    observedPriceMinor: input.result.observedPriceMinor ?? null,
    observedCurrency: input.result.observedCurrency ?? null,
    availability: input.result.availability ?? null,
    trust: "untrusted_external_evidence",
    capabilityRef: null,
    actionable: [],
    provenance: {
      url: input.result.url,
      domain,
      provider: input.result.provider ?? null,
      retrievedAt: observedAt?.toISOString() ?? null,
      publishedAt: input.result.publishedAt ?? null,
      externalContent: "untrusted_evidence_only",
    },
    observedAt,
  };
}

export async function searchInternal(
  db: Block31Db,
  input: {
    query: string;
    requesterOwnerId: string;
    kind?: "offering" | "need";
    status?: "draft" | "active" | "paused" | "closed";
    historical?: boolean;
    hardConstraints?: HardConstraint[];
    origin?: SearchOrigin;
    limit?: number;
  },
): Promise<EconomicExpression[]> {
  const statusClause = input.historical
    ? input.status
      ? eq(economicExpressions.status, input.status)
      : undefined
    : eq(economicExpressions.status, "active");
  const visibilityClause = or(
    eq(economicExpressions.ownerId, input.requesterOwnerId),
    and(eq(economicExpressions.visibility, "public"), eq(economicExpressions.status, "active")),
  );
  // Fetch the structured eligibility pool without calculating any semantic
  // score. This makes it impossible for relevance to admit a hard failure.
  const eligible = (
    await db
    .select()
    .from(economicExpressions)
    .where(
      and(
        input.kind ? eq(economicExpressions.kind, input.kind) : undefined,
        statusClause,
        visibilityClause,
      ),
    )
    .limit(500)
  ).filter((expression) =>
    satisfiesHardConstraints(expression, input.hardConstraints ?? [], input.origin),
  );
  if (eligible.length === 0) return [];

  const ranked = await db
    .select()
    .from(economicExpressions)
    .where(inArray(economicExpressions.id, eligible.map((row) => row.id)))
    .orderBy(
      desc(sql`greatest(
        similarity(${economicExpressions.semanticType}, ${input.query}),
        similarity(coalesce(${economicExpressions.publicProjection}::text, ''), ${input.query})
      )`),
      desc(economicExpressions.createdAt),
    )
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
  return ranked;
}

export async function discover(
  db: Block31Db,
  input: {
    ownerId: string;
    conversationId: string;
    query: string;
    runId?: string;
    explicitScope?: unknown;
    availability?: SourceAvailability;
    kind?: "offering" | "need";
    historical?: boolean;
    hardConstraints?: HardConstraint[];
    webResults?: WebObservation[];
    limit?: number;
    /**
     * WHY this search is happening — the conversational need at the exact
     * revision it had when the search ran. Supplied by the runtime, never by a
     * caller's payload and never by the model.
     */
    need?: { id: string; revision: number };
    /**
     * WHICH OFFERINGS SOMEBODY PAID TO HAVE SEEN.
     *
     * Runtime-supplied — a settled commercial fact about who bought placement,
     * never a payload a caller sends and never a model's suggestion.
     *
     *   MODEL_NOMINATES_A_SPONSORED_RESULT = 0
     *
     * It is read AFTER eligibility and never by the ordering, so it cannot
     * admit a candidate the buyer's constraints excluded and cannot move a
     * better answer down.
     */
    sponsoredRefs?: readonly string[];
    /**
     * Where the searcher is. Runtime-supplied from their own need, carried for
     * one query, written nowhere, and disclosed to nobody.
     */
    origin?: SearchOrigin;
  },
) {
  const sources = planSources(input.query, input.explicitScope, input.availability);
  const sponsoredRefs = new Set(input.sponsoredRefs ?? []);
  const normalized: NormalizedCandidate[] = [];
  if (sources.includes("JASIM_INTERNAL")) {
    const rows = await searchInternal(db, {
      query: input.query,
      requesterOwnerId: input.ownerId,
      kind: input.kind,
      historical: input.historical,
      hardConstraints: input.hardConstraints,
      ...(input.origin ? { origin: input.origin } : {}),
      // The display cut belongs to this function, not to the query — a
      // candidate merit leaves OUTSIDE the cut is exactly the one a sponsor may
      // pay to have seen, and the query truncating first would make it
      // unreachable. Asked for only when somebody actually paid, so an ordinary
      // search costs no more than it did.
      ...(sponsoredRefs.size === 0 ? { limit: input.limit } : {}),
    });
    normalized.push(...rows.map((expression) => normalizeCandidate({ source: "JASIM_INTERNAL", expression })));
  }
  if (sources.includes("WEB_OBSERVATION")) {
    normalized.push(
      ...(input.webResults ?? []).map((result) => normalizeCandidate({ source: "WEB_OBSERVATION", result })),
    );
  }

  const resultSetId = `drs_${randomUUID()}`;
  const [resultSet] = await db
    .insert(discoveryResultSets)
    .values({
      id: resultSetId,
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      runId: input.runId,
      queryText: input.query,
      sources,
      hardConstraints: input.hardConstraints ?? [],
      ...(input.need ? { needId: input.need.id, needRevision: input.need.revision } : {}),
    })
    .returning();
  // ── MERIT FIRST, AND MERIT ALONE ─────────────────────────────────────────
  //
  // The list a person reads as «the answer» is cut from the ordering above,
  // which never saw who paid. Sponsorship is applied after this line and can
  // only ever ADD a labelled placement behind it.
  //
  //   SPONSORED != BEST · ADVERTISER_BUYS_JASIM_OPINION = 0
  const limit = input.limit ?? normalized.length;
  const merit = normalized.slice(0, limit);
  // An eligible candidate that merit left outside the limit, whose owner paid
  // to be seen. ELIGIBLE is the operative word: `normalized` is built from the
  // pool that already passed the buyer's hard constraints, so nothing here can
  // reach a candidate those constraints excluded.
  //
  //   MONEY_BUYS_AN_EXEMPTION_FROM_A_BUYERS_REQUIREMENT = 0
  const promoted =
    sponsoredRefs.size === 0
      ? []
      : normalized
          .slice(limit)
          .filter((candidate) => candidate.canonicalRef && sponsoredRefs.has(candidate.canonicalRef));
  const values = [
    ...merit.map((candidate) => ({
      candidate,
      // A candidate that earned its place is still labelled when its owner
      // paid: the label describes the RELATIONSHIP, not the placement, and
      // hiding it on the ones that also happen to rank well is the oldest way
      // of laundering an advertisement.
      //
      //   SPONSORED_RESULT_IS_UNLABELLED = 0
      sponsored: Boolean(candidate.canonicalRef && sponsoredRefs.has(candidate.canonicalRef)),
    })),
    ...promoted.map((candidate) => ({ candidate, sponsored: true })),
  ].map((entry, index) => ({
    id: `drc_${randomUUID()}`,
    resultSetId,
    position: index + 1,
    sponsored: entry.sponsored,
    ...entry.candidate,
  }));
  const candidates = values.length
    ? await db.insert(discoveryCandidates).values(values).returning()
    : [];
  return { resultSet, candidates };
}