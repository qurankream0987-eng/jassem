/**
 * LLM Router - Multi-tier AI routing system for JASIM
 * Tiers: 1=Phi-4(local), 2=Gemini(fast), 3=DeepSeek(powerful), 4=Claude(premium)
 * Routes requests by complexity, tracks costs, implements fallback chains
 */

import { z } from "zod";

// ============================================
// ZOD SCHEMAS
// ============================================

export const LLMRequestSchema = z.object({
  complexity: z.enum(["simple", "normal", "complex", "premium"]).default("normal"),
  prompt: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(8192).default(500),
  systemPrompt: z.string().optional(),
  responseFormat: z.enum(["text", "json"]).default("text").optional(),
});

export const LLMResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
  tier: z.number().min(1).max(4),
  tokensUsed: z.number().default(0),
  cost: z.number().default(0),
  latency: z.number(), // ms
  confidence: z.number().min(0).max(1).default(0.9),
  error: z.string().optional(),
});

export const CostStatsSchema = z.object({
  totalRequests: z.number().default(0),
  totalTokens: z.number().default(0),
  totalCost: z.number().default(0),
  avgLatency: z.number().default(0),
  tierBreakdown: z.record(z.string(), z.object({
    requests: z.number(),
    tokens: z.number(),
    cost: z.number(),
  })),
  fallbackCount: z.number().default(0),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type LLMRequest = z.infer<typeof LLMRequestSchema>;
export type LLMResponse = z.infer<typeof LLMResponseSchema>;
export type CostStats = z.infer<typeof CostStatsSchema>;

// ============================================
// MODEL CONFIGURATION
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
  timeout: number; // ms
}

function getModelConfigs(): Record<number, ModelConfig> {
  return {
    1: {
      name: "phi4-mini",
      tier: 1,
      baseUrl: process.env.PHI4_ENDPOINT || "http://localhost:11434",
      apiKey: undefined,
      modelId: "phi4-mini",
      costPer1kInput: 0,
      costPer1kOutput: 0,
      maxTokens: 2048,
      supportsJson: true,
      timeout: 10000,
    },
    2: {
      name: "gemini-flash",
      tier: 2,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: process.env.GEMINI_API_KEY,
      modelId: "gemini-2.0-flash-lite",
      costPer1kInput: 0.000075,
      costPer1kOutput: 0.0003,
      maxTokens: 8192,
      supportsJson: true,
      timeout: 15000,
    },
    3: {
      name: "deepseek-chat",
      tier: 3,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
      modelId: "deepseek-chat",
      costPer1kInput: 0.00027,
      costPer1kOutput: 0.0011,
      maxTokens: 8192,
      supportsJson: true,
      timeout: 30000,
    },
    4: {
      name: "claude-sonnet",
      tier: 4,
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: process.env.CLAUDE_API_KEY,
      modelId: "claude-sonnet-4-20250514",
      costPer1kInput: 0.003,
      costPer1kOutput: 0.015,
      maxTokens: 4096,
      supportsJson: true,
      timeout: 30000,
    },
  };
}

// ============================================
// REQUEST TRACKING
// ============================================

interface RequestLog {
  timestamp: Date;
  tier: number;
  model: string;
  tokensUsed: number;
  cost: number;
  latency: number;
  isFallback: boolean;
}

// In-memory request log (consider using DB for production)
const requestLogs: RequestLog[] = [];
const MAX_LOG_SIZE = 10000;

function logRequest(entry: RequestLog): void {
  requestLogs.push(entry);
  if (requestLogs.length > MAX_LOG_SIZE) {
    requestLogs.splice(0, requestLogs.length - MAX_LOG_SIZE);
  }
}

// ============================================
// LLM ROUTER CLASS
// ============================================

export class LLMRouter {
  private configs: Record<number, ModelConfig>;
  private fallbackChain = [3, 2, 4, 1]; // Tier 3 fails → 2 → 4 → 1

  constructor() {
    this.configs = getModelConfigs();
  }

  /**
   * Route request to appropriate model based on complexity
   */
  async route(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    const tier = this.selectTier(validated);
    return this.callTier(tier, validated);
  }

  /**
   * Route with automatic fallback chain
   * If primary model fails, try: Tier3 → Tier2 → Tier4 → Tier1
   */
  async routeWithFallback(request: LLMRequest): Promise<LLMResponse> {
    const validated = LLMRequestSchema.parse(request);
    const primaryTier = this.selectTier(validated);

    // Build fallback chain starting from selected tier
    const chain = this.buildFallbackChain(primaryTier);

    let lastError = "";
    for (const tier of chain) {
      try {
        const config = this.configs[tier];
        // Skip if API key not available (except tier 1 which may need no key)
        if (tier !== 1 && !config.apiKey) {
          lastError = `Tier ${tier}: API key not configured`;
          continue;
        }

        const result = await this.callTier(tier, validated, true);
        if (!result.error) {
          return result;
        }
        lastError = result.error;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Continue to next tier in chain
      }
    }

    // All tiers exhausted - return error response
    return {
      text: "",
      model: "fallback-exhausted",
      tier: 0,
      tokensUsed: 0,
      cost: 0,
      latency: 0,
      confidence: 0,
      error: `All LLM tiers failed. Last error: ${lastError}`,
    };
  }

  /**
   * Select tier based on request complexity
   */
  private selectTier(request: LLMRequest): number {
    switch (request.complexity) {
      case "simple":
        return 1; // Phi-4: greetings, FAQ, simple tasks
      case "normal":
        return 2; // Gemini Flash: product search, common tasks
      case "complex":
        return 3; // DeepSeek: haggle, negotiation, reasoning
      case "premium":
        return 4; // Claude: legal, financial, edge cases
      default:
        return 2;
    }
  }

  /**
   * Build fallback chain starting from a given tier
   */
  private buildFallbackChain(startTier: number): number[] {
    const chain: number[] = [startTier];
    for (const tier of this.fallbackChain) {
      if (tier !== startTier && !chain.includes(tier)) {
        chain.push(tier);
      }
    }
    // Always ensure tier 1 (local) is last resort
    if (!chain.includes(1)) {
      chain.push(1);
    }
    return chain;
  }

  /**
   * Call a specific tier
   */
  private async callTier(
    tier: number,
    request: LLMRequest,
    isFallback = false
  ): Promise<LLMResponse> {
    const config = this.configs[tier];
    if (!config) {
      throw new Error(`Unknown tier: ${tier}`);
    }

    const startTime = Date.now();

    try {
      let response: LLMResponse;

      switch (tier) {
        case 1:
          response = await this.callPhi4(request, config);
          break;
        case 2:
          response = await this.callGemini(request, config);
          break;
        case 3:
          response = await this.callDeepSeek(request, config);
          break;
        case 4:
          response = await this.callClaude(request, config);
          break;
        default:
          throw new Error(`Unsupported tier: ${tier}`);
      }

      const latency = Date.now() - startTime;
      response.latency = latency;

      // Log the request
      logRequest({
        timestamp: new Date(),
        tier,
        model: config.name,
        tokensUsed: response.tokensUsed,
        cost: response.cost,
        latency,
        isFallback,
      });

      return response;
    } catch (err) {
      const latency = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);

      return {
        text: "",
        model: config.name,
        tier,
        tokensUsed: 0,
        cost: 0,
        latency,
        confidence: 0,
        error: errorMsg,
      };
    }
  }

  // ============================================
  // TIER 3: DeepSeek - Powerful cloud model
  // ============================================
  private async callDeepSeek(
    request: LLMRequest,
    config: ModelConfig
  ): Promise<LLMResponse> {
    if (!config.apiKey) {
      return this.createNoKeyResponse(config);
    }

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
        response_format:
          request.responseFormat === "json" ? { type: "json_object" } : undefined,
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
    const usage = (data.usage as Record<string, number>) || { prompt_tokens: 0, completion_tokens: 0 };
    const totalTokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    const cost = this.calculateCost(config, usage.prompt_tokens || 0, usage.completion_tokens || 0);

    return {
      text,
      model: config.name,
      tier: 3,
      tokensUsed: totalTokens,
      cost,
      latency: 0,
      confidence: 0.92,
    };
  }

  // ============================================
  // TIER 2: Gemini Flash - Fast, cheap
  // ============================================
  private async callGemini(
    request: LLMRequest,
    config: ModelConfig
  ): Promise<LLMResponse> {
    if (!config.apiKey) {
      return this.createNoKeyResponse(config);
    }

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
          responseMimeType:
            request.responseFormat === "json" ? "application/json" : "text/plain",
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
    const totalTokens = (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0);
    const cost = this.calculateCost(config, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);

    return {
      text,
      model: config.name,
      tier: 2,
      tokensUsed: totalTokens,
      cost,
      latency: 0,
      confidence: 0.88,
    };
  }

  // ============================================
  // TIER 4: Claude - Premium quality
  // ============================================
  private async callClaude(
    request: LLMRequest,
    config: ModelConfig
  ): Promise<LLMResponse> {
    if (!config.apiKey) {
      return this.createNoKeyResponse(config);
    }

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
      tier: 4,
      tokensUsed: inputTokens + outputTokens,
      cost,
      latency: 0,
      confidence: 0.95,
    };
  }

  // ============================================
  // TIER 1: Phi-4 Mini - Local, free
  // ============================================
  private async callPhi4(
    request: LLMRequest,
    config: ModelConfig
  ): Promise<LLMResponse> {
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
        // Phi-4 may not be available - return graceful fallback
        return {
          text: "",
          model: config.name,
          tier: 1,
          tokensUsed: 0,
          cost: 0,
          latency: 0,
          confidence: 0,
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
        tier: 1,
        tokensUsed: promptTokens + completionTokens,
        cost: 0,
        latency: 0,
        confidence: 0.7,
      };
    } catch {
      // Local model not running - return graceful error for fallback
      return {
        text: "",
        model: config.name,
        tier: 1,
        tokensUsed: 0,
        cost: 0,
        latency: 0,
        confidence: 0,
        error: "Phi-4 local endpoint unreachable",
      };
    }
  }

  // ============================================
  // COST TRACKING
  // ============================================

  async getCostStats(): Promise<CostStats> {
    const tierBreakdown: CostStats["tierBreakdown"] = {};
    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;

    for (const log of requestLogs) {
      const key = `tier_${log.tier}`;
      if (!tierBreakdown[key]) {
        tierBreakdown[key] = { requests: 0, tokens: 0, cost: 0 };
      }
      tierBreakdown[key].requests++;
      tierBreakdown[key].tokens += log.tokensUsed;
      tierBreakdown[key].cost += log.cost;
      totalTokens += log.tokensUsed;
      totalCost += log.cost;
      totalLatency += log.latency;
    }

    const fallbackCount = requestLogs.filter((l) => l.isFallback).length;

    return {
      totalRequests: requestLogs.length,
      totalTokens,
      totalCost,
      avgLatency: requestLogs.length > 0 ? totalLatency / requestLogs.length : 0,
      tierBreakdown,
      fallbackCount,
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
    // Rough estimation: ~4 chars per token for Arabic/English mix
    return Math.ceil(text.length / 4);
  }

  private createNoKeyResponse(config: ModelConfig): LLMResponse {
    return {
      text: "",
      model: config.name,
      tier: config.tier,
      tokensUsed: 0,
      cost: 0,
      latency: 0,
      confidence: 0,
      error: `${config.name}: API key not configured`,
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

  private buildClaudeMessages(
    request: LLMRequest
  ): Array<{ role: "user" | "assistant"; content: string }> {
    // Claude doesn't have a separate system role in the messages array,
    // prepend system prompt to the user message
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

export async function getLLMCostStats(): Promise<CostStats> {
  return getLLMRouter().getCostStats();
}
