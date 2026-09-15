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

function candidateField(row: EconomicExpression, field: string): unknown {
  if (field === "quantity") return row.attributes.quantity ?? object(row.availability).quantity;
  return row.attributes[field];
}

/** Missing hard-constraint values do not pass: UNKNOWN is not a hard match. */
export function satisfiesHardConstraints(
  row: EconomicExpression,
  constraints: readonly HardConstraint[],
): boolean {
  return constraints.every((constraint) => {
    if (constraint.maxMinor !== undefined || constraint.field === "price") {
      const money = object(row.attributes.price ?? row.attributes.money);
      const minor = canonicalMinor(
        row.attributes.priceMinor ?? money.minor ?? money.amountMinor,
      );
      const maximum = canonicalMinor(constraint.maxMinor ?? constraint.value);
      if (minor === null || maximum === null) return false;
      const candidateCurrency = String(row.attributes.currency ?? money.currency ?? "").toUpperCase();
      if (constraint.currency && candidateCurrency !== constraint.currency.trim().toUpperCase()) return false;
      return minor <= maximum;
    }
    const field = constraint.field ?? (constraint.quantity !== undefined ? "quantity" : "");
    if (!field) return false;
    const actual = candidateField(row, field);
    const expected = constraint.quantity ?? constraint.value;
    if (actual === undefined || actual === null || expected === undefined) return false;
    if (constraint.operator === "max" || constraint.operator === "<=") {
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    }
    if (constraint.operator === "gte" || constraint.operator === ">=") {
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    }
    return actual === expected;
  });
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
  ).filter((expression) => satisfiesHardConstraints(expression, input.hardConstraints ?? []));
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
  },
) {
  const sources = planSources(input.query, input.explicitScope, input.availability);
  const normalized: NormalizedCandidate[] = [];
  if (sources.includes("JASIM_INTERNAL")) {
    const rows = await searchInternal(db, {
      query: input.query,
      requesterOwnerId: input.ownerId,
      kind: input.kind,
      historical: input.historical,
      hardConstraints: input.hardConstraints,
      limit: input.limit,
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
    })
    .returning();
  const values = normalized.slice(0, input.limit ?? normalized.length).map((candidate, index) => ({
    id: `drc_${randomUUID()}`,
    resultSetId,
    position: index + 1,
    ...candidate,
  }));
  const candidates = values.length
    ? await db.insert(discoveryCandidates).values(values).returning()
    : [];
  return { resultSet, candidates };
}