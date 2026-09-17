import { z } from "zod";
import {
  ModelBudgetSchema,
  ModelTaskProfileSchema,
  selectModelPolicy,
  type ModelBudget,
  type ModelTaskProfile,
  type ModelTier,
} from "./model-policy";
import { recordModelUsage } from "./model-usage-ledger";
import {
  ModelBudgetExceededError,
  estimateModelCost,
  evaluateCostCeiling,
} from "./model-cost";

export const ModelProviderSchema = z.enum([
  "openai",
  "anthropic",
  "gemini",
  "openai-compatible",
]);

export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelSelectionSchema = z.object({
  provider: ModelProviderSchema.optional(),
  model: z.string().trim().min(1).max(128).optional(),
});

export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

export const ModelGatewayRequestSchema = z.object({
  prompt: z.string().min(1),
  systemPrompt: z.string().min(1),
  selection: ModelSelectionSchema.optional(),
  temperature: z.number().min(0).max(2).default(0.1),
  maxTokens: z.number().int().min(1).max(16_000).default(4_000),
  taskProfile: ModelTaskProfileSchema.optional(),
  budget: ModelBudgetSchema.partial().optional(),
  usageContext: z.object({
    ownerId: z.string().min(1).max(255).optional(),
    conversationId: z.string().max(64).optional(),
    runId: z.string().uuid().optional(),
    nodeId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
    promptVersion: z.string().min(1).max(80).default("jasim-gateway:v1"),
  }).optional(),
});

export type ModelGatewayRequest = z.input<typeof ModelGatewayRequestSchema>;

export const ModelGatewayResponseSchema = z.object({
  text: z.string().min(1),
  provider: ModelProviderSchema,
  model: z.string().min(1),
  tier: z.enum(["T1", "T2", "T3"]),
  inputTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative(),
  providerRequestId: z.string().optional(),
  fallbackUsed: z.boolean(),
  fallbackFrom: z.string().optional(),
  decisionReasons: z.array(z.string()),
});

export type ModelGatewayResponse = z.infer<typeof ModelGatewayResponseSchema>;

export class ModelGatewayUnavailableError extends Error {
  readonly code = "MODEL_GATEWAY_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayUnavailableError";
  }
}

export class ModelGatewayOutputError extends Error {
  readonly code = "MODEL_GATEWAY_INVALID_OUTPUT";

  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayOutputError";
  }
}

export class ModelGatewayPolicyError extends Error {
  readonly code = "MODEL_POLICY_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayPolicyError";
  }
}

// Re-exported so callers can catch every gateway failure from one module, even
// though the budget guard itself lives with the cost model.
export { ModelBudgetExceededError };

type ProviderConfig = {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
};

const defaultModels: Record<ModelProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-2.0-flash",
  "openai-compatible": "gpt-5.6-terra",
};

// Provider-edge defaults only. Deployments can override each independently
// through JASIM_MODEL_T1/T2/T3 without changing JASIM runtime policy.
const openAiCompatibleTierDefaults: Record<Exclude<ModelTier, "T0">, string> = {
  T1: "gpt-5.6-terra",
  T2: "o4-mini",
  T3: "gpt-5.6-sol",
};

function configuredProvider(): ModelProvider | undefined {
  const explicit = process.env.JASIM_MODEL_PROVIDER ?? process.env.MODEL_GATEWAY_PROVIDER;
  if (explicit) {
    const parsed = ModelProviderSchema.safeParse(explicit);
    if (!parsed.success) {
      throw new ModelGatewayUnavailableError(
        `Unsupported model provider "${explicit}". Choose openai, anthropic, gemini, or openai-compatible.`,
      );
    }
    return parsed.data;
  }

  if (process.env.MODEL_GATEWAY_API_KEY && process.env.MODEL_GATEWAY_BASE_URL) {
    return "openai-compatible";
  }
  if (
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY &&
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
  ) {
    return "openai-compatible";
  }
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return undefined;
}

function resolveConfig(selection: ModelSelection = {}): ProviderConfig {
  const provider = selection.provider ?? configuredProvider();
  if (!provider) {
    throw new ModelGatewayUnavailableError(
      "No model service is configured. Configure JASIM_MODEL_PROVIDER with its provider API key before creating a task.",
    );
  }

  const model =
    selection.model ??
    process.env.JASIM_MODEL ??
    process.env.MODEL_GATEWAY_MODEL ??
    defaultModels[provider];
  if (!model) {
    throw new ModelGatewayUnavailableError(
      "No model identifier is configured for the openai-compatible provider. Set MODEL_GATEWAY_MODEL or include model in the request.",
    );
  }
  switch (provider) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) {
        throw new ModelGatewayUnavailableError(
          "The openai model provider was selected, but OPENAI_API_KEY is not configured.",
        );
      }
      return {
        provider,
        model,
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      };
    case "anthropic":
      if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
        throw new ModelGatewayUnavailableError(
          "The anthropic model provider was selected, but ANTHROPIC_API_KEY is not configured.",
        );
      }
      return {
        provider,
        model,
        apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
      };
    case "gemini":
      if (!process.env.GEMINI_API_KEY) {
        throw new ModelGatewayUnavailableError(
          "The gemini model provider was selected, but GEMINI_API_KEY is not configured.",
        );
      }
      return {
        provider,
        model,
        apiKey: process.env.GEMINI_API_KEY,
        baseUrl: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
      };
    case "openai-compatible":
      {
        const apiKey =
          process.env.MODEL_GATEWAY_API_KEY ??
          process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
        const baseUrl =
          process.env.MODEL_GATEWAY_BASE_URL ??
          process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
        if (!apiKey || !baseUrl) {
        throw new ModelGatewayUnavailableError(
          "The openai-compatible provider requires MODEL_GATEWAY credentials or Replit AI Integrations.",
        );
      }
        return {
          provider,
          model,
          apiKey,
          baseUrl: baseUrl.replace(/\/+$/, ""),
        };
      }
    default:
      throw new ModelGatewayUnavailableError("The selected model provider is not supported.");
  }
}

function tierSelection(tier: Exclude<ModelTier, "T0">): ModelSelection {
  const providerValue = process.env[`JASIM_MODEL_${tier}_PROVIDER`];
  const provider = providerValue ? ModelProviderSchema.parse(providerValue) : configuredProvider();
  const legacyModel = process.env.JASIM_MODEL ?? process.env.MODEL_GATEWAY_MODEL;
  const model =
    process.env[`JASIM_MODEL_${tier}`] ??
    (tier === "T1"
      ? legacyModel
      : provider === "openai-compatible"
        ? openAiCompatibleTierDefaults[tier]
        : legacyModel);
  return { provider, model };
}

function fallbackSelections(tier: Exclude<ModelTier, "T0">): ModelSelection[] {
  const raw = process.env[`JASIM_MODEL_${tier}_FALLBACKS`]?.trim();
  if (!raw) return [];
  return raw.split(",").flatMap((entry) => {
    const [providerValue, model] = entry.trim().split(":", 2);
    const parsed = ModelProviderSchema.safeParse(providerValue);
    return parsed.success && model?.trim() ? [{ provider: parsed.data, model: model.trim() }] : [];
  });
}

function extractOpenAiText(data: unknown): string {
  const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  return typeof choices?.[0]?.message?.content === "string" ? choices[0].message.content : "";
}

function extractAnthropicText(data: unknown): string {
  const content = (data as { content?: Array<{ type?: string; text?: unknown }> }).content;
  return typeof content?.[0]?.text === "string" ? content[0].text : "";
}

function extractGeminiText(data: unknown): string {
  const candidates = (data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  }).candidates;
  const text = candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text : "";
}

function usageFromProvider(data: unknown): {
  inputTokens?: number; cachedInputTokens?: number; outputTokens?: number;
  reasoningTokens?: number; totalTokens?: number;
} {
  const usage = (data as { usage?: Record<string, unknown>; usageMetadata?: Record<string, unknown> }).usage
    ?? (data as { usageMetadata?: Record<string, unknown> }).usageMetadata
    ?? {};
  const inputDetails = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  const outputDetails = usage.completion_tokens_details ?? usage.output_tokens_details ?? {};
  const number = (source: Record<string, unknown>, ...keys: string[]) => {
    const value = keys.map((key) => source[key]).find((item) => typeof item === "number");
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
  };
  return {
    inputTokens: number(usage, "prompt_tokens", "input_tokens", "promptTokenCount"),
    cachedInputTokens: number(
      inputDetails as Record<string, unknown>,
      "cached_tokens",
      "cached_input_tokens",
      "cachedContentTokenCount",
    ) ?? number(usage, "cached_tokens", "cached_input_tokens", "cachedContentTokenCount"),
    outputTokens: number(usage, "completion_tokens", "output_tokens", "candidatesTokenCount"),
    reasoningTokens: number(
      outputDetails as Record<string, unknown>,
      "reasoning_tokens",
      "reasoningTokenCount",
    ) ?? number(usage, "reasoning_tokens", "reasoningTokenCount"),
    totalTokens: number(usage, "total_tokens", "totalTokenCount"),
  };
}

async function responseError(response: Response, provider: ModelProvider): Promise<never> {
  const detail = (await response.text()).slice(0, 500);
  throw new ModelGatewayUnavailableError(
    `${provider} model service returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
  );
}

export class ModelGateway {
  async generate(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    const validated = ModelGatewayRequestSchema.parse(request);
    const profile: ModelTaskProfile = validated.taskProfile ?? {
      purpose: "CONVERSATION",
      complexity: 0.35,
      ambiguity: 0.15,
      novelty: 0.15,
      estimatedContextSize: validated.prompt.length + validated.systemPrompt.length,
      requiresStructuredOutput: true,
      requiresTools: false,
      requiresVision: false,
      structuralMutation: false,
      worldGeneration: false,
      userFacing: true,
      latencySensitivity: "normal",
      qualityRequirement: "standard",
      previousTierFailure: false,
      previousPlanFailure: false,
      escalationCount: 0,
      deterministic: false,
    };
    const decision = selectModelPolicy(profile, validated.budget as Partial<ModelBudget> | undefined);
    if (decision.mode === "T0") {
      throw new ModelGatewayPolicyError(
        "MODEL_POLICY_T0_REQUIRED: deterministic caller path must not invoke a language model.",
      );
    }
    const selectedTier = decision.tier as Exclude<ModelTier, "T0">;

    const selections = validated.selection
      ? [validated.selection]
      : [tierSelection(selectedTier), ...fallbackSelections(selectedTier)];
    const startedAt = Date.now();
    let firstFailure: string | undefined;
    let fallbackFrom: string | undefined;
    let lastError: unknown;

    for (const [index, selection] of selections.entries()) {
      let config: ProviderConfig;
      try {
        config = resolveConfig(selection);
      } catch (error) {
        lastError = error;
        firstFailure ??= selection.provider ?? "unconfigured";
        continue;
      }
      // Pre-flight cost ceiling. It runs per candidate because a fallback may be
      // a different, more expensive model than the primary — a ceiling checked
      // only once at the top would let failover spend past it. A candidate that
      // breaches the ceiling is skipped rather than aborting the whole request,
      // so a cheaper fallback can still serve it.
      const ceiling = evaluateCostCeiling({
        provider: config.provider,
        model: config.model,
        // Falls back to the declared ModelBudget default rather than to the
        // request's output cap: conflating an output limit with an input limit
        // would under-estimate the input side and weaken the ceiling.
        maxInputTokens: validated.budget?.maxInputTokens ?? ModelBudgetSchema.shape.maxInputTokens.parse(undefined),
        maxOutputTokens: decision.maxOutputTokens,
        maxEstimatedCost: validated.budget?.maxEstimatedCost,
      });
      if (!ceiling.allowed) {
        lastError = new ModelBudgetExceededError(
          `MODEL_BUDGET_EXCEEDED: ${config.provider}/${config.model} could cost up to ` +
            `${ceiling.estimate.amount?.toFixed(6)} ${ceiling.estimate.currency ?? ""}`.trim() +
            `, above the configured ceiling of ${validated.budget?.maxEstimatedCost}.`,
        );
        firstFailure ??= `${config.provider}/${config.model}`;
        continue;
      }

      try {
        const result = await this.generateFromConfig(config, validated, decision.timeoutMs);
        const latencyMs = Date.now() - startedAt;
        const response = ModelGatewayResponseSchema.parse({
          text: result.text.trim(),
          provider: config.provider,
          model: config.model,
          tier: selectedTier,
          latencyMs,
          providerRequestId: result.providerRequestId,
          fallbackUsed: index > 0,
          fallbackFrom: index > 0 ? fallbackFrom : undefined,
          decisionReasons: decision.decisionReasons,
          ...result.usage,
        });
        // Cost is derived from what the provider actually reported, never from
        // the projection used by the ceiling above. An unknown cost stays
        // undefined so the ledger never records a call as free.
        const cost = estimateModelCost({
          provider: response.provider,
          model: response.model,
          inputTokens: response.inputTokens,
          cachedInputTokens: response.cachedInputTokens,
          outputTokens: response.outputTokens,
          reasoningTokens: response.reasoningTokens,
        });
        await recordModelUsage({
          ...validated.usageContext,
          purpose: profile.purpose,
          tier: selectedTier,
          provider: response.provider,
          modelId: response.model,
          estimatedCost: cost.amount,
          inputTokens: response.inputTokens,
          cachedInputTokens: response.cachedInputTokens,
          outputTokens: response.outputTokens,
          reasoningTokens: response.reasoningTokens,
          totalTokens: response.totalTokens,
          latencyMs,
          providerRequestId: response.providerRequestId,
          fallbackUsed: response.fallbackUsed,
          fallbackFrom: response.fallbackFrom,
          escalatedFrom: decision.escalatedFrom,
          escalationReason: profile.escalationReason,
          success: true,
          promptVersion: validated.usageContext?.promptVersion ?? "jasim-gateway:v1",
        });
        return response;
      } catch (error) {
        lastError = error;
        fallbackFrom ??= `${config.provider}/${config.model}`;
      }
    }

    const latencyMs = Date.now() - startedAt;
    const errorCategory =
      lastError instanceof ModelGatewayOutputError
        ? "INVALID_OUTPUT"
        : lastError instanceof ModelBudgetExceededError
          ? "MODEL_BUDGET_EXCEEDED"
          : "PROVIDER_UNAVAILABLE";
    await recordModelUsage({
      ...validated.usageContext,
      purpose: profile.purpose,
      tier: selectedTier,
      provider: fallbackFrom?.split("/")[0] ?? "unavailable",
      modelId: fallbackFrom?.split("/")[1] ?? "unavailable",
      latencyMs,
      fallbackUsed: selections.length > 1,
      fallbackFrom: firstFailure,
      escalatedFrom: decision.escalatedFrom,
      escalationReason: profile.escalationReason,
      success: false,
      errorCategory,
      promptVersion: validated.usageContext?.promptVersion ?? "jasim-gateway:v1",
    });
    if (lastError instanceof Error) throw lastError;
    throw new ModelGatewayUnavailableError("No configured model provider completed the request.");
  }

  private async generateFromConfig(
    config: ProviderConfig,
    validated: z.output<typeof ModelGatewayRequestSchema>,
    timeoutMs: number,
  ): Promise<{
    text: string;
    providerRequestId?: string;
    usage: ReturnType<typeof usageFromProvider>;
  }> {
    const signal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    let text: string;
    let data: unknown;
    try {
      if (config.provider === "anthropic") {
        response = await fetch(`${config.baseUrl}/messages`, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: config.model,
            system: validated.systemPrompt,
            messages: [{ role: "user", content: validated.prompt }],
            temperature: validated.temperature,
            max_tokens: validated.maxTokens,
          }),
        });
        if (!response.ok) await responseError(response, config.provider);
        data = await response.json();
        text = extractAnthropicText(data);
      } else if (config.provider === "gemini") {
        response = await fetch(
          `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey!)}`,
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: validated.systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: validated.prompt }] }],
              generationConfig: {
                temperature: validated.temperature,
                maxOutputTokens: validated.maxTokens,
                responseMimeType: "application/json",
              },
            }),
          },
        );
        if (!response.ok) await responseError(response, config.provider);
        data = await response.json();
        text = extractGeminiText(data);
      } else {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey!}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: validated.systemPrompt },
              { role: "user", content: validated.prompt },
            ],
            ...(config.provider === "openai-compatible"
              ? {}
              : { temperature: validated.temperature }),
            ...(config.provider === "openai-compatible"
              ? { max_completion_tokens: validated.maxTokens }
              : { max_tokens: validated.maxTokens }),
            response_format: { type: "json_object" },
          }),
        });
        if (!response.ok) await responseError(response, config.provider);
        data = await response.json();
        text = extractOpenAiText(data);
      }
    } catch (error) {
      if (error instanceof ModelGatewayUnavailableError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelGatewayUnavailableError(
        `Unable to reach the ${config.provider} model service: ${message}`,
      );
    }

    if (!text.trim()) {
      throw new ModelGatewayOutputError(
        `The ${config.provider} model returned an empty response; no task was saved.`,
      );
    }
    return {
      text,
      providerRequestId: response.headers.get("x-request-id") ?? undefined,
      usage: usageFromProvider(data),
    };
  }
}

export const modelGateway = new ModelGateway();