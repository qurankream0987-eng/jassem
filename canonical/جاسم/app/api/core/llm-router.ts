/**
 * ============================================================
 * LLM ROUTER V2 — Smart Multi-Model Routing (2026)
 * JASIM Cost-Optimized AI Routing with Token Tracking
 * ============================================================
 *
 * Implements:
 * - Groq/Llama 3.3 70B as fastest/cheapest tier
 * - OpenAI GPT-4o-mini for simple tasks
 * - Smart routing based on complexity analysis
 * - Token usage tracking per model
 * - Cost optimization (route to cheapest adequate model)
 * - Circuit breaker protection for all LLM calls
 * - Zod schemas for all inputs/outputs
 */

import { z } from "zod";
import {
  JASIMError,
  retryWithBackoff,
  CircuitBreaker,
  getCircuitBreaker,
  executeWithDegradation,
} from "./error-handler";

// ============================================
// ZOD SCHEMAS
// ============================================

export const LLMRequestSchema = z.object({
  complexity: z.enum(["simple", "normal", "complex", "premium"]).default("normal"),
  prompt: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(128000).default(500),
  systemPrompt: z.string().optional(),
  responseFormat: z.enum(["text", "json"]).default("text").optional(),
  // V2 fields
  preferredModel: z.string().optional(),
  budgetLimitUsd: z.number().optional(),
  requireJson: z.boolean().default(false),
  streaming: z.boolean().default(false),
  userId: z.string().optional(),
});

export type LLMRequest = z.infer<typeof LLMRequestSchema>;

export interface StreamOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  onChunk: (chunk: string) => void | Promise<void>;
  onError?: (error: string) => void;
}

export const LLMResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
  tier: z.number().min(0).max(10),
  tokensUsed: z.number().default(0),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cost: z.number().default(0),
  latency: z.number(),
  confidence: z.number().min(0).max(1).default(0.9),
  error: z.string().optional(),
  wasFallback: z.boolean().default(false).optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export const TokenUsageSchema = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  timestamp: z.string(),
  requestId: z.string(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const CostStatsSchema = z.object({
  totalRequests: z.number().default(0),
  totalTokens: z.number().default(0),
  totalInputTokens: z.number().default(0),
  totalOutputTokens: z.number().default(0),
  totalCost: z.number().default(0),
  avgLatency: z.number().default(0),
  avgCostPerRequest: z.number().default(0),
  modelBreakdown: z.record(z.string(), z.object({
    requests: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    cost: z.number(),
    avgLatency: z.number(),
  })),
  fallbackCount: z.number().default(0),
  savingsVsPremium: z.number().default(0), // How much saved vs always using premium
});

export type CostStats = z.infer<typeof CostStatsSchema>;

export const ModelCapabilitySchema = z.object({
  name: z.string(),
  tiers: z.array(z.enum(["simple", "normal", "complex", "premium"])),
  maxTokens: z.number(),
  supportsJson: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsArabic: z.boolean(),
  avgLatencyMs: z.number(),
  costPer1kInput: z.number(),
  costPer1kOutput: z.number(),
});

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

// ============================================
// MODEL CONFIGURATION — 2026 Model Lineup
// ============================================

interface ModelConfig {
  name: string;
  tier: number;
  baseUrl: string;
  apiKey: string | undefined;
  modelId: string;
  costPer1kInput: number;  // USD
  costPer1kOutput: number; // USD
  maxTokens: number;
  supportsJson: boolean;
  supportsStreaming: boolean;
  supportsArabic: boolean;
  avgLatencyMs: number;
  description: string;
  // Capabilities determine what complexity levels this model handles
  capabilities: Array<"simple" | "normal" | "complex" | "premium">;
  // Circuit breaker config per model
  circuitBreaker: {
    failureThreshold: number;
    recoveryTimeoutMs: number;
  };
}

function getModelConfigs(): Record<number, ModelConfig> {
  return {
    // Tier 0: Groq/Llama 3.3 70B — FASTEST, CHEAPEST
    0: {
      name: "groq-llama-3.3-70b",
      tier: 0,
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      modelId: "llama-3.3-70b-versatile",
      costPer1kInput: 0.000059,
      costPer1kOutput: 0.000079,
      maxTokens: 128000,
      supportsJson: true,
      supportsStreaming: true,
      supportsArabic: true,
      avgLatencyMs: 300,
      description: "Ultra-fast via Groq. Best cost/performance ratio.",
      capabilities: ["simple", "normal", "complex"],
      circuitBreaker: { failureThreshold: 5, recoveryTimeoutMs: 15000 },
    },

    // Tier 1: OpenAI GPT-4o-mini — Simple tasks
    1: {
      name: "gpt-4o-mini",
      tier: 1,
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      modelId: "gpt-4o-mini",
      costPer1kInput: 0.00015,
      costPer1kOutput: 0.0006,
      maxTokens: 128000,
      supportsJson: true,
      supportsStreaming: true,
      supportsArabic: true,
      avgLatencyMs: 500,
      description: "Fast & cheap for simple tasks. Great for structured JSON.",
      capabilities: ["simple", "normal"],
      circuitBreaker: { failureThreshold: 5, recoveryTimeoutMs: 15000 },
    },

    // Tier 2: Local Phi-4 — Free but limited
    2: {
      name: "phi4-mini",
      tier: 2,
      baseUrl: process.env.PHI4_ENDPOINT || "http://localhost:11434",
      apiKey: undefined,
      modelId: "phi4-mini",
      costPer1kInput: 0,
      costPer1kOutput: 0,
      maxTokens: 2048,
      supportsJson: true,
      supportsStreaming: false,
      supportsArabic: false,
      avgLatencyMs: 2000,
      description: "Local inference. Free but limited capabilities.",
      capabilities: ["simple"],
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 30000 },
    },

    // Tier 3: Gemini 2.0 Flash — Fast, cheap cloud
    3: {
      name: "gemini-2.0-flash",
      tier: 3,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: process.env.GEMINI_API_KEY,
      modelId: "gemini-2.0-flash-lite",
      costPer1kInput: 0.000075,
      costPer1kOutput: 0.0003,
      maxTokens: 8192,
      supportsJson: true,
      supportsStreaming: true,
      supportsArabic: true,
      avgLatencyMs: 600,
      description: "Fast multimodal from Google. Good for normal tasks.",
      capabilities: ["simple", "normal", "complex"],
      circuitBreaker: { failureThreshold: 5, recoveryTimeoutMs: 20000 },
    },

    // Tier 4: DeepSeek V3 — Powerful reasoning
    4: {
      name: "deepseek-chat",
      tier: 4,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
      modelId: "deepseek-chat",
      costPer1kInput: 0.00027,
      costPer1kOutput: 0.0011,
      maxTokens: 8192,
      supportsJson: true,
      supportsStreaming: true,
      supportsArabic: true,
      avgLatencyMs: 2000,
      description: "Strong reasoning at low cost. Best for complex Arabic.",
      capabilities: ["simple", "normal", "complex", "premium"],
      circuitBreaker: { failureThreshold: 4, recoveryTimeoutMs: 30000 },
    },

    // Tier 5: Claude Sonnet 4 — Premium quality
    5: {
      name: "claude-sonnet-4",
      tier: 5,
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: process.env.CLAUDE_API_KEY,
      modelId: "claude-sonnet-4-20250514",
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
      maxTokens: 4096,
      supportsJson: true,
      supportsStreaming: true,
      supportsArabic: true,
      avgLatencyMs: 3000,
      description: "Highest quality for legal, financial, edge cases.",
      capabilities: ["simple", "normal", "complex", "premium"],
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 30000 },
    },
  };
}

// ============================================
// SMART COMPLEXITY ANALYZER
// ============================================

export const ComplexityAnalysisSchema = z.object({
  complexity: z.enum(["simple", "normal", "complex", "premium"]),
  confidence: z.number().min(0).max(1),
  estimatedTokens: z.number(),
  requiresJson: z.boolean(),
  requiresArabic: z.boolean(),
  isMultiStep: z.boolean(),
  reasoningDepth: z.enum(["none", "light", "medium", "deep"]),
  suggestedTier: z.number().min(0).max(5),
});

export type ComplexityAnalysis = z.infer<typeof ComplexityAnalysisSchema>;

/**
 * Analyze request complexity for smart routing
 */
export function analyzeComplexity(request: LLMRequest): ComplexityAnalysis {
  const prompt = request.prompt.toLowerCase();
  const systemPrompt = (request.systemPrompt || "").toLowerCase();
  const combined = prompt + " " + systemPrompt;

  // Simple heuristics for complexity analysis
  const isSimple = /^(hi|hello|hey|مرحبا|هلا|شلونك)\b/.test(prompt) ||
    prompt.length < 50;

  const isPremium = /legal|law|contract|financial audit|compliance|regulatory|قانون|عقد|مالية|تدقيق|امتثال/i.test(combined);

  const isComplex = /negotiate|compare multiple|analyze|optimize|reason|فاوض|قارن|حلل|حساب/i.test(combined) ||
    prompt.length > 500;

  const requiresJson = request.requireJson || request.responseFormat === "json";
  const requiresArabic = /[\u0600-\u06FF]/.test(prompt);
  const isMultiStep = (prompt.match(/and then|then|step|بعدين|ثم/g) || []).length >= 2;
  const estimatedTokens = Math.ceil(combined.length / 4) + (request.maxTokens || 500);

  let complexity: "simple" | "normal" | "complex" | "premium";
  let suggestedTier: number;
  let reasoningDepth: "none" | "light" | "medium" | "deep";

  if (isSimple) {
    complexity = "simple";
    suggestedTier = 0; // Groq — cheapest
    reasoningDepth = "none";
  } else if (isPremium) {
    complexity = "premium";
    suggestedTier = 5; // Claude
    reasoningDepth = "deep";
  } else if (isComplex) {
    complexity = "complex";
    suggestedTier = 4; // DeepSeek
    reasoningDepth = "medium";
  } else {
    complexity = "normal";
    suggestedTier = 0; // Groq — best value
    reasoningDepth = "light";
  }

  // Adjust for JSON requirement (prefer models with strong JSON support)
  if (requiresJson && complexity === "simple") {
    suggestedTier = 1; // GPT-4o-mini for reliable JSON
  }

  // Budget override
  if (request.budgetLimitUsd && request.budgetLimitUsd < 0.01) {
    suggestedTier = 2; // Local Phi-4 if budget is tiny
  }

  return ComplexityAnalysisSchema.parse({
    complexity,
    confidence: 0.85,
    estimatedTokens,
    requiresJson,
    requiresArabic,
    isMultiStep,
    reasoningDepth,
    suggestedTier,
  });
}

// ============================================
// REQUEST TRACKING
// ============================================

interface RequestLog {
  timestamp: Date;
  tier: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  tokensUsed: number;
  cost: number;
  latency: number;
  isFallback: boolean;
  complexity: string;
  userId?: string;
}

const requestLogs: RequestLog[] = [];
const MAX_LOG_SIZE = 10000;

function logRequest(entry: RequestLog): void {
  requestLogs.push(entry);
  if (requestLogs.length > MAX_LOG_SIZE) {
    requestLogs.splice(0, requestLogs.length - MAX_LOG_SIZE);
  }
}

// ============================================
// LLM ROUTER V2 CLASS
// ============================================

export class LLMRouter {
  private configs: Record<number, ModelConfig>;

  // Fallback chain: try cheapest first, escalate to premium
  private fallbackChain = [0, 1, 3, 4, 2, 5]; // Groq → GPT-4o-mini → Gemini → DeepSeek → Phi-4 → Claude

  constructor() {
    this.configs = getModelConfigs();
  }

  /**
   * Route request with smart complexity analysis
   * Routes to cheapest adequate model
   */
  async route(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);

    // Analyze complexity
    const analysis = analyzeComplexity(validated);

    // Select tier based on complexity analysis
    const tier = validated.preferredModel
      ? this.resolveModelName(validated.preferredModel)
      : analysis.suggestedTier;

    return this.callTier(tier, validated);
  }

  /**
   * Route with automatic fallback chain
   * Uses cost-optimized fallback ordering
   */
  async routeWithFallback(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    const analysis = analyzeComplexity(validated);
    const primaryTier = validated.preferredModel
      ? this.resolveModelName(validated.preferredModel)
      : analysis.suggestedTier;

    const chain = this.buildFallbackChain(primaryTier, analysis);

    let lastError = "";
    let isFallback = false;

    for (const tier of chain) {
      try {
        const config = this.configs[tier];
        if (!config) continue;

        // Skip if API key not available (except local models)
        if (tier !== 2 && !config.apiKey) {
          lastError = `Tier ${tier} (${config.name}): API key not configured`;
          continue;
        }

        const result = await this.callTier(tier, validated, isFallback);
        if (!result.error) {
          if (isFallback) {
            result.wasFallback = true;
          }
          return result;
        }
        lastError = result.error;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      isFallback = true;
    }

    return {
      text: "",
      model: "fallback-exhausted",
      tier: -1,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      latency: 0,
      confidence: 0,
      error: `All LLM tiers failed. Last error: ${lastError}`,
    };
  }

  /**
   * Route specifically to Groq (fastest)
   */
  async routeGroq(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    return this.callTier(0, validated);
  }

  /**
   * Route specifically to GPT-4o-mini (cheap JSON)
   */
  async routeGPT4oMini(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    return this.callTier(1, validated);
  }

  /**
   * Route specifically to DeepSeek (best for Arabic)
   */
  async routeDeepSeek(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    return this.callTier(4, validated);
  }

  /**
   * Route specifically to Claude (premium)
   */
  async routeClaude(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    return this.callTier(5, validated);
  }

  // ============================================
  // STREAMING: Real-time token streaming
  // ============================================

  /**
   * Stream tokens from the LLM in real-time.
   * Uses Groq (tier 0) by default for fastest streaming.
   * Falls back through the chain on errors.
   */
  async stream(options: StreamOptions): Promise<{ text: string; model: string; tier: number }> {
    const {
      prompt,
      systemPrompt,
      temperature = 0.7,
      maxTokens = 600,
      model,
      onChunk,
      onError,
    } = options;

    // Try streaming-capable tiers in order
    const tiersToTry = model
      ? [this.resolveModelName(model)]
      : [0, 1, 3, 4, 5]; // Groq, OpenAI, Gemini, DeepSeek, Claude

    let lastError = "";

    for (const tier of tiersToTry) {
      const config = this.configs[tier];
      if (!config) continue;
      if (!config.supportsStreaming) {
        lastError = `Tier ${tier} (${config.name}) does not support streaming`;
        continue;
      }
      if (tier !== 2 && !config.apiKey) {
        lastError = `Tier ${tier} (${config.name}): API key not configured`;
        continue;
      }

      try {
        const breaker = getCircuitBreaker(`llm-${config.name}`, config.circuitBreaker);
        return await breaker.execute(async () => {
          const startTime = Date.now();
          let result: { text: string; model: string; tier: number };

          switch (tier) {
            case 0:
            case 1:
            case 4:
              result = await this.streamOpenAICompatible(config, prompt, systemPrompt, temperature, maxTokens, onChunk);
              break;
            case 5:
              result = await this.streamClaudeSSE(config, prompt, systemPrompt, temperature, maxTokens, onChunk);
              break;
            default:
              // Fallback for non-streaming models: call normally and emit the whole response
              const response = await this.callTier(tier, {
                prompt, systemPrompt, temperature, maxTokens, complexity: "simple", responseFormat: "text", requireJson: false, streaming: false,
              });
              if (response.text) {
                await onChunk(response.text);
              }
              result = { text: response.text, model: config.name, tier };
          }

          const latency = Date.now() - startTime;
          logRequest({
            timestamp: new Date(),
            tier,
            model: config.name,
            inputTokens: this.estimateTokens(prompt + (systemPrompt || "")),
            outputTokens: this.estimateTokens(result.text),
            tokensUsed: this.estimateTokens(prompt + (systemPrompt || "") + result.text),
            cost: 0, // Streaming cost estimation deferred
            latency,
            isFallback: tier !== tiersToTry[0],
            complexity: "simple",
            userId: undefined,
          });

          return result;
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (onError) onError(lastError);
        // Continue to next tier
      }
    }

    throw new Error(`Streaming failed on all tiers. Last error: ${lastError}`);
  }

  // ============================================
  // PRIVATE: Streaming Implementations
  // ============================================

  private async streamOpenAICompatible(
    config: ModelConfig,
    prompt: string,
    systemPrompt: string | undefined,
    temperature: number,
    maxTokens: number,
    onChunk: (chunk: string) => void | Promise<void>,
  ): Promise<{ text: string; model: string; tier: number }> {
    const messages = this.buildMessages({ prompt, systemPrompt } as LLMRequest);

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        temperature,
        max_tokens: Math.min(maxTokens, config.maxTokens),
        stream: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${config.name} HTTP ${res.status}: ${errText}`);
    }

    if (!res.body) {
      throw new Error(`${config.name}: No response body for streaming`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const choices = (parsed.choices as Array<Record<string, unknown>>) || [];
            const delta = (choices[0]?.delta as Record<string, unknown>) || {};
            const content = delta.content as string | undefined;

            if (content) {
              fullText += content;
              await onChunk(content);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text: fullText, model: config.name, tier: config.tier };
  }

  private async streamClaudeSSE(
    config: ModelConfig,
    prompt: string,
    systemPrompt: string | undefined,
    temperature: number,
    maxTokens: number,
    onChunk: (chunk: string) => void | Promise<void>,
  ): Promise<{ text: string; model: string; tier: number }> {
    const messages = this.buildClaudeMessages({ prompt, systemPrompt } as LLMRequest);

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        max_tokens: Math.min(maxTokens, config.maxTokens),
        temperature,
        stream: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude HTTP ${res.status}: ${errText}`);
    }

    if (!res.body) {
      throw new Error("Claude: No response body for streaming");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            const type = parsed.type as string;

            if (type === "content_block_delta") {
              const delta = (parsed.delta as Record<string, unknown>) || {};
              const text = delta.text as string | undefined;
              if (text) {
                fullText += text;
                await onChunk(text);
              }
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text: fullText, model: config.name, tier: config.tier };
  }

  /**
   * Get cost statistics with savings analysis
   */
  async getCostStats(): Promise<CostStats> {
    const modelBreakdown: CostStats["modelBreakdown"] = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;

    for (const log of requestLogs) {
      const key = log.model;
      if (!modelBreakdown[key]) {
        modelBreakdown[key] = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, avgLatency: 0 };
      }
      modelBreakdown[key].requests++;
      modelBreakdown[key].inputTokens += log.inputTokens;
      modelBreakdown[key].outputTokens += log.outputTokens;
      modelBreakdown[key].totalTokens += log.tokensUsed;
      modelBreakdown[key].cost += log.cost;
      modelBreakdown[key].avgLatency =
        (modelBreakdown[key].avgLatency * (modelBreakdown[key].requests - 1) + log.latency) /
        modelBreakdown[key].requests;

      totalInputTokens += log.inputTokens;
      totalOutputTokens += log.outputTokens;
      totalTokens += log.tokensUsed;
      totalCost += log.cost;
      totalLatency += log.latency;
    }

    const fallbackCount = requestLogs.filter((l) => l.isFallback).length;

    // Calculate savings vs always using premium (Claude)
    const claudeCostPer1kIn = this.configs[5].costPer1kInput;
    const claudeCostPer1kOut = this.configs[5].costPer1kOutput;
    const hypotheticalPremiumCost = (totalInputTokens / 1000) * claudeCostPer1kIn +
      (totalOutputTokens / 1000) * claudeCostPer1kOut;
    const savingsVsPremium = hypotheticalPremiumCost - totalCost;

    return {
      totalRequests: requestLogs.length,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      avgLatency: requestLogs.length > 0 ? totalLatency / requestLogs.length : 0,
      avgCostPerRequest: requestLogs.length > 0 ? totalCost / requestLogs.length : 0,
      modelBreakdown,
      fallbackCount,
      savingsVsPremium: Math.round(savingsVsPremium * 1e6) / 1e6,
    };
  }

  /**
   * Get model capabilities comparison
   */
  getModelCapabilities(): ModelCapability[] {
    return Object.values(this.configs).map((c) => ({
      name: c.name,
      tiers: c.capabilities,
      maxTokens: c.maxTokens,
      supportsJson: c.supportsJson,
      supportsStreaming: c.supportsStreaming,
      supportsArabic: c.supportsArabic,
      avgLatencyMs: c.avgLatencyMs,
      costPer1kInput: c.costPer1kInput,
      costPer1kOutput: c.costPer1kOutput,
    }));
  }

  // ============================================
  // PRIVATE: Tier selection
  // ============================================

  private selectTier(request: LLMRequest, analysis?: ComplexityAnalysis): number {
    const analyzed = analysis || analyzeComplexity(request);

    switch (request.complexity) {
      case "simple": return 0; // Groq — cheapest for simple
      case "normal": return analyzed.requiresJson ? 1 : 0; // GPT-4o-mini for JSON, else Groq
      case "complex": return 4; // DeepSeek for complex reasoning
      case "premium": return 5; // Claude for premium
      default: return 0;
    }
  }

  private resolveModelName(name: string): number {
    const lower = name.toLowerCase();
    for (const [tier, config] of Object.entries(this.configs)) {
      if (config.modelId.toLowerCase().includes(lower) ||
          config.name.toLowerCase().includes(lower)) {
        return Number(tier);
      }
    }
    return 0; // Default to Groq
  }

  private buildFallbackChain(startTier: number, analysis: ComplexityAnalysis): number[] {
    // Filter chain to models that support the required complexity
    const eligible = this.fallbackChain.filter((tier) => {
      const config = this.configs[tier];
      if (!config) return false;
      if (!config.apiKey && tier !== 2) return false; // Skip if no API key
      return config.capabilities.includes(analysis.complexity);
    });

    const chain: number[] = [];
    if (eligible.includes(startTier)) {
      chain.push(startTier);
    }
    for (const tier of eligible) {
      if (tier !== startTier && !chain.includes(tier)) {
        chain.push(tier);
      }
    }
    return chain.length > 0 ? chain : [0]; // Fallback to Groq
  }

  // ============================================
  // PRIVATE: Model calling with circuit breaker
  // ============================================

  private async callTier(
    tier: number,
    request: LLMRequest,
    isFallback = false,
  ): Promise<LLMResponse> {
    const config = this.configs[tier];
    if (!config) {
      return this.createErrorResponse("unknown", tier, `Unknown tier: ${tier}`);
    }

    const breaker = getCircuitBreaker(`llm-${config.name}`, config.circuitBreaker);

    try {
      return await breaker.execute(async () => {
        const startTime = Date.now();

        let response: LLMResponse;

        switch (tier) {
          case 0: response = await this.callGroq(request, config); break;
          case 1: response = await this.callOpenAI(request, config); break;
          case 2: response = await this.callPhi4(request, config); break;
          case 3: response = await this.callGemini(request, config); break;
          case 4: response = await this.callDeepSeek(request, config); break;
          case 5: response = await this.callClaude(request, config); break;
          default:
            return this.createErrorResponse(config.name, tier, `Unsupported tier: ${tier}`);
        }

        const latency = Date.now() - startTime;
        response.latency = latency;

        logRequest({
          timestamp: new Date(),
          tier,
          model: config.name,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          tokensUsed: response.tokensUsed,
          cost: response.cost,
          latency,
          isFallback,
          complexity: request.complexity,
          userId: request.userId,
        });

        return response;
      });
    } catch (error) {
      if (error instanceof JASIMError && error.code === "CIRCUIT_OPEN") {
        return this.createErrorResponse(config.name, tier, `Circuit breaker OPEN for ${config.name}`);
      }

      const latency = 0;
      return this.createErrorResponse(
        config.name,
        tier,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // ============================================
  // TIER 0: Groq / Llama 3.3 70B — FASTEST
  // ============================================

  private async callGroq(request: LLMRequest, config: ModelConfig): Promise<LLMResponse> {
    if (!config.apiKey) return this.createNoKeyResponse(config);

    const messages = this.buildMessages(request);

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        temperature: request.temperature,
        max_tokens: Math.min(request.maxTokens, config.maxTokens),
        response_format: request.requireJson || request.responseFormat === "json"
          ? { type: "json_object" } : undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const choices = (data.choices as Array<Record<string, unknown>>) || [];
    const message = (choices[0]?.message as Record<string, unknown>) || {};
    const text = (message.content as string) || "";
    const usage = (data.usage as Record<string, number>) || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const cost = this.calculateCost(config, inputTokens, outputTokens);

    return {
      text,
      model: config.name,
      tier: config.tier,
      tokensUsed: totalTokens,
      inputTokens,
      outputTokens,
      cost,
      latency: 0,
      confidence: 0.92,
    };
  }

  // ============================================
  // TIER 1: OpenAI GPT-4o-mini — Simple tasks
  // ============================================

  private async callOpenAI(request: LLMRequest, config: ModelConfig): Promise<LLMResponse> {
    if (!config.apiKey) return this.createNoKeyResponse(config);

    const messages = this.buildMessages(request);

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        temperature: request.temperature,
        max_tokens: Math.min(request.maxTokens, config.maxTokens),
        response_format: request.requireJson || request.responseFormat === "json"
          ? { type: "json_object" } : undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const choices = (data.choices as Array<Record<string, unknown>>) || [];
    const message = (choices[0]?.message as Record<string, unknown>) || {};
    const text = (message.content as string) || "";
    const usage = (data.usage as Record<string, number>) || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const cost = this.calculateCost(config, inputTokens, outputTokens);

    return {
      text,
      model: config.name,
      tier: config.tier,
      tokensUsed: totalTokens,
      inputTokens,
      outputTokens,
      cost,
      latency: 0,
      confidence: 0.9,
    };
  }

  // ============================================
  // TIER 2: Phi-4 Mini — Local
  // ============================================

  private async callPhi4(request: LLMRequest, config: ModelConfig): Promise<LLMResponse> {
    const messages = this.buildMessages(request);

    try {
      const res = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.modelId,
          messages,
          options: {
            temperature: request.temperature,
            num_predict: Math.min(request.maxTokens, config.maxTokens),
          },
        }),
      });

      if (!res.ok) {
        return {
          text: "", model: config.name, tier: config.tier,
          tokensUsed: 0, inputTokens: 0, outputTokens: 0,
          cost: 0, latency: 0, confidence: 0,
          error: `Phi-4 not available: HTTP ${res.status}`,
        };
      }

      const data = await res.json() as Record<string, unknown>;
      const message = (data.message as Record<string, unknown>) || {};
      const text = (message.content as string) || (data.response as string) || "";
      const promptTokens = this.estimateTokens(request.prompt + (request.systemPrompt || ""));
      const completionTokens = this.estimateTokens(text);

      return {
        text,
        model: config.name,
        tier: config.tier,
        tokensUsed: promptTokens + completionTokens,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cost: 0,
        latency: 0,
        confidence: 0.7,
      };
    } catch {
      return {
        text: "", model: config.name, tier: config.tier,
        tokensUsed: 0, inputTokens: 0, outputTokens: 0,
        cost: 0, latency: 0, confidence: 0,
        error: "Phi-4 local endpoint unreachable",
      };
    }
  }

  // ============================================
  // TIER 3: Gemini 2.0 Flash
  // ============================================

  private async callGemini(request: LLMRequest, config: ModelConfig): Promise<LLMResponse> {
    if (!config.apiKey) return this.createNoKeyResponse(config);

    const contents = this.buildGeminiContents(request);
    const url = `${config.baseUrl}/models/${config.modelId}:generateContent?key=${config.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: Math.min(request.maxTokens, config.maxTokens),
          responseMimeType: request.requireJson || request.responseFormat === "json"
            ? "application/json" : "text/plain",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const candidates = (data.candidates as Array<Record<string, unknown>>) || [];
    const content = (candidates[0]?.content as Record<string, unknown>) || {};
    const parts = (content.parts as Array<Record<string, unknown>>) || [];
    const text = (parts[0]?.text as string) || "";
    const usage = (data.usageMetadata as Record<string, number>) || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = inputTokens + outputTokens;
    const cost = this.calculateCost(config, inputTokens, outputTokens);

    return {
      text,
      model: config.name,
      tier: config.tier,
      tokensUsed: totalTokens,
      inputTokens,
      outputTokens,
      cost,
      latency: 0,
      confidence: 0.88,
    };
  }

  // ============================================
  // TIER 4: DeepSeek — Best for Arabic
  // ============================================

  private async callDeepSeek(request: LLMRequest, config: ModelConfig): Promise<LLMResponse> {
    if (!config.apiKey) return this.createNoKeyResponse(config);

    const messages = this.buildMessages(request);

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        temperature: request.temperature,
        max_tokens: Math.min(request.maxTokens, config.maxTokens),
        response_format: request.requireJson || request.responseFormat === "json"
          ? { type: "json_object" } : undefined,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`DeepSeek HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const choices = (data.choices as Array<Record<string, unknown>>) || [];
    const message = (choices[0]?.message as Record<string, unknown>) || {};
    const text = (message.content as string) || "";
    const usage = (data.usage as Record<string, number>) || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const cost = this.calculateCost(config, inputTokens, outputTokens);

    return {
      text,
      model: config.name,
      tier: config.tier,
      tokensUsed: totalTokens,
      inputTokens,
      outputTokens,
      cost,
      latency: 0,
      confidence: 0.93,
    };
  }

  // ============================================
  // TIER 5: Claude — Premium quality
  // ============================================

  private async callClaude(request: LLMRequest, config: ModelConfig): Promise<LLMResponse> {
    if (!config.apiKey) return this.createNoKeyResponse(config);

    const messages = this.buildClaudeMessages(request);

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.modelId,
        messages,
        max_tokens: Math.min(request.maxTokens, config.maxTokens),
        temperature: request.temperature,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const content = (data.content as Array<Record<string, unknown>>) || [];
    const text = (content[0]?.text as string) || "";
    const usage = (data.usage as Record<string, number>) || {};
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cost = this.calculateCost(config, inputTokens, outputTokens);

    return {
      text,
      model: config.name,
      tier: config.tier,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      cost,
      latency: 0,
      confidence: 0.96,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private calculateCost(config: ModelConfig, inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1000) * config.costPer1kInput;
    const outputCost = (outputTokens / 1000) * config.costPer1kOutput;
    return Math.round((inputCost + outputCost) * 1e6) / 1e6;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private createNoKeyResponse(config: ModelConfig): LLMResponse {
    return {
      text: "",
      model: config.name,
      tier: config.tier,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      latency: 0,
      confidence: 0,
      error: `${config.name}: API key not configured`,
    };
  }

  private createErrorResponse(model: string, tier: number, error: string): LLMResponse {
    return {
      text: "",
      model,
      tier,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      latency: 0,
      confidence: 0,
      error,
    };
  }

  private buildMessages(request: LLMRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });
    return messages;
  }

  private buildGeminiContents(request: LLMRequest): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (request.systemPrompt) {
      contents.push({ role: "user", parts: [{ text: request.systemPrompt }] });
      contents.push({ role: "model", parts: [{ text: "Understood." }] });
    }
    contents.push({ role: "user", parts: [{ text: request.prompt }] });
    return contents;
  }

  private buildClaudeMessages(request: LLMRequest): Array<{ role: "user" | "assistant"; content: string }> {
    const content = request.systemPrompt
      ? `[System: ${request.systemPrompt}]\n\n${request.prompt}`
      : request.prompt;
    return [{ role: "user", content }];
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let routerInstance: LLMRouter | null = null;

export function getLLMRouter(): LLMRouter {
  if (!routerInstance) {
    routerInstance = new LLMRouter();
  }
  return routerInstance;
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export async function routeLLM(request: LLMRequest): Promise<LLMResponse> {
  return getLLMRouter().route(request);
}

export async function routeLLMWithFallback(request: LLMRequest): Promise<LLMResponse> {
  return getLLMRouter().routeWithFallback(request);
}

export async function routeLLMGroq(request: LLMRequest): Promise<LLMResponse> {
  return getLLMRouter().routeGroq(request);
}

export async function routeLLMGPT4oMini(request: LLMRequest): Promise<LLMResponse> {
  return getLLMRouter().routeGPT4oMini(request);
}

export async function routeLLMDeepSeek(request: LLMRequest): Promise<LLMResponse> {
  return getLLMRouter().routeDeepSeek(request);
}

export async function routeLLMClaude(request: LLMRequest): Promise<LLMResponse> {
  return getLLMRouter().routeClaude(request);
}

export async function getLLMCostStats(): Promise<CostStats> {
  return getLLMRouter().getCostStats();
}

export function getLLMModelCapabilities(): ModelCapability[] {
  return getLLMRouter().getModelCapabilities();
}

export function analyzeLLMComplexity(request: LLMRequest): ComplexityAnalysis {
  return analyzeComplexity(request);
}

export async function streamLLM(options: StreamOptions): Promise<{ text: string; model: string; tier: number }> {
  return getLLMRouter().stream(options);
}

// ============================================
// BACKWARD COMPATIBILITY
// ============================================
export const llmRouter = getLLMRouter();
