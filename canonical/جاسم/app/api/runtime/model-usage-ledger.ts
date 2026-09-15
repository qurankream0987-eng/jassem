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
    fallbackUsed: record.fallbackUsed,
    fallbackFrom: record.fallbackFrom ?? null,
    escalatedFrom: record.escalatedFrom ?? null,
    escalationReason: record.escalationReason ?? null,
    success: record.success,
    errorCategory: record.errorCategory ?? null,
    promptVersion: record.promptVersion,
  });
}