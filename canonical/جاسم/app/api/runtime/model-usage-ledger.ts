import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { modelUsageLedger } from "@db/schema";
import type { ModelTier, ModelPurpose } from "./model-policy";

export type ModelUsageRecord = {
  ownerId?: string;
  conversationId?: string;
  runId?: string;
  nodeId?: string;
  attemptId?: string;
  purpose: ModelPurpose;
  tier: Exclude<ModelTier, "T0">;
  provider: string;
  modelId: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  providerRequestId?: string;
  /**
   * Operational cost estimate for this call, or undefined when it is genuinely
   * unknown (no configured price, or the provider reported no usage). It is
   * never defaulted to 0: a zero would assert the call was free.
   *
   * This is telemetry, not money. It must never reach `economic_ledger_entries`.
   */
  estimatedCost?: number;
  /** Authoritative cost, when a provider later reports one. */
  actualProviderCost?: number;
  fallbackUsed: boolean;
  fallbackFrom?: string;
  escalatedFrom?: string;
  escalationReason?: string;
  success: boolean;
  errorCategory?: string;
  promptVersion: string;
};

/**
 * Durable, append-only evidence of a model invocation. It intentionally stores
 * operational metadata only — never prompt text, model output, credentials, or
 * user PII beyond canonical owner/resource identifiers.
 */
export async function recordModelUsage(record: ModelUsageRecord): Promise<void> {
  await db.insert(modelUsageLedger).values({
    ownerId: record.ownerId ?? null,
    conversationId: record.conversationId ?? null,
    runId: record.runId ?? null,
    nodeId: record.nodeId ?? null,
    attemptId: record.attemptId ?? null,
    purpose: record.purpose,
    tier: record.tier,
    provider: record.provider,
    modelId: record.modelId,
    inputTokens: record.inputTokens ?? null,
    cachedInputTokens: record.cachedInputTokens ?? null,
    outputTokens: record.outputTokens ?? null,
    reasoningTokens: record.reasoningTokens ?? null,
    totalTokens: record.totalTokens ?? null,
    latencyMs: record.latencyMs,
    providerRequestId: record.providerRequestId ?? null,
    estimatedCost: record.estimatedCost ?? null,
    actualProviderCost: record.actualProviderCost ?? null,
    fallbackUsed: record.fallbackUsed,
    fallbackFrom: record.fallbackFrom ?? null,
    escalatedFrom: record.escalatedFrom ?? null,
    escalationReason: record.escalationReason ?? null,
    success: record.success,
    errorCategory: record.errorCategory ?? null,
    promptVersion: record.promptVersion,
  });
}

// ── Cost attribution ────────────────────────────────────────────────────────

export type ModelCostSummary = {
  /** Calls whose cost is known. */
  pricedCalls: number;
  /**
   * Calls whose cost is genuinely unknown (no configured price, or no usage
   * reported). Surfaced separately so a total is never mistaken for complete.
   */
  unpricedCalls: number;
  /** Sum over priced calls only. Undefined when nothing was priced. */
  estimatedCost?: number;
  totalTokens: number;
  /** True when every call in scope had a known cost. */
  complete: boolean;
};

/**
 * Aggregates operational model cost for one owner, optionally narrowed to a
 * conversation or a run.
 *
 * Owner scope is mandatory, not optional, because this is a cross-tenant read
 * over a shared table: a summary that forgot its owner would leak another
 * customer's usage volume.
 *
 * `unpricedCalls` and `complete` exist so that a caller can never present a
 * partial sum as a full one. A total of $0.12 over 40 calls means something very
 * different when 38 of them were unpriced.
 */
export async function summarizeModelCost(input: {
  ownerId: string;
  conversationId?: string;
  runId?: string;
}): Promise<ModelCostSummary> {
  const filters = [eq(modelUsageLedger.ownerId, input.ownerId)];
  if (input.conversationId) {
    filters.push(eq(modelUsageLedger.conversationId, input.conversationId));
  }
  if (input.runId) filters.push(eq(modelUsageLedger.runId, input.runId));

  const rows = await db
    .select({
      estimatedCost: modelUsageLedger.estimatedCost,
      totalTokens: modelUsageLedger.totalTokens,
    })
    .from(modelUsageLedger)
    .where(and(...filters));

  let pricedCalls = 0;
  let unpricedCalls = 0;
  let estimatedCost = 0;
  let totalTokens = 0;
  for (const row of rows) {
    if (typeof row.estimatedCost === "number") {
      pricedCalls += 1;
      estimatedCost += row.estimatedCost;
    } else {
      unpricedCalls += 1;
    }
    totalTokens += row.totalTokens ?? 0;
  }

  return {
    pricedCalls,
    unpricedCalls,
    estimatedCost: pricedCalls > 0 ? estimatedCost : undefined,
    totalTokens,
    complete: rows.length > 0 && unpricedCalls === 0,
  };
}

// ── Cost breakdown ──────────────────────────────────────────────────────────

export type ModelCostDimension = "provider" | "modelId" | "tier" | "purpose";

export type ModelCostBucket = ModelCostSummary & {
  /** The dimension value this bucket aggregates, e.g. "anthropic" or "T2". */
  key: string;
  calls: number;
  failedCalls: number;
};

/**
 * Aggregates the same owner-scoped usage as `summarizeModelCost`, grouped along
 * one dimension.
 *
 * Grouping is done in application code rather than SQL on purpose: the
 * `complete` flag is not a sum, it is a claim that nothing in the bucket was
 * unpriced, and `SUM(estimatedCost)` in Postgres would quietly treat a NULL as
 * absent and report a confident total over partial data. The whole reason this
 * module exists is that a cost number without its coverage is misleading.
 *
 * Failed calls are counted but never silently excluded: a failover storm that
 * burned forty attempts and returned nothing still cost money, and a report that
 * showed only successes would understate spend exactly when it matters.
 */
export async function breakdownModelCost(input: {
  ownerId: string;
  dimension: ModelCostDimension;
  conversationId?: string;
  runId?: string;
}): Promise<ModelCostBucket[]> {
  const filters = [eq(modelUsageLedger.ownerId, input.ownerId)];
  if (input.conversationId) {
    filters.push(eq(modelUsageLedger.conversationId, input.conversationId));
  }
  if (input.runId) filters.push(eq(modelUsageLedger.runId, input.runId));

  const rows = await db
    .select({
      provider: modelUsageLedger.provider,
      modelId: modelUsageLedger.modelId,
      tier: modelUsageLedger.tier,
      purpose: modelUsageLedger.purpose,
      estimatedCost: modelUsageLedger.estimatedCost,
      totalTokens: modelUsageLedger.totalTokens,
      success: modelUsageLedger.success,
    })
    .from(modelUsageLedger)
    .where(and(...filters));

  const buckets = new Map<string, ModelCostBucket>();
  for (const row of rows) {
    const key = row[input.dimension];
    const bucket = buckets.get(key) ?? {
      key,
      calls: 0,
      failedCalls: 0,
      pricedCalls: 0,
      unpricedCalls: 0,
      estimatedCost: undefined,
      totalTokens: 0,
      complete: false,
    };
    bucket.calls += 1;
    if (!row.success) bucket.failedCalls += 1;
    if (typeof row.estimatedCost === "number") {
      bucket.pricedCalls += 1;
      bucket.estimatedCost = (bucket.estimatedCost ?? 0) + row.estimatedCost;
    } else {
      bucket.unpricedCalls += 1;
    }
    bucket.totalTokens += row.totalTokens ?? 0;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, complete: bucket.unpricedCalls === 0 }))
    // Largest known spend first, with unpriced buckets last rather than
    // sorted as if they were free.
    .sort((left, right) => (right.estimatedCost ?? -1) - (left.estimatedCost ?? -1));
}
