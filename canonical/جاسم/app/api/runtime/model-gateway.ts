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
import {
  ModelGatewayOutputError,
  ModelGatewayPolicyError,
  ModelGatewayUnavailableError,
  parseRetryAfter,
} from "./model-gateway-errors";
import { reserveModelCall, type ModelCallReason } from "./model-call-budget";
import { enforceContextBudget } from "./model-context-budget";
import {
  configuredMaxRetriesPerCandidate,
  normalizeModelFailure,
  retryDelayMs,
  type ModelFailureCategory,
} from "./model-failure";

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
  /**
   * Every JASIM runtime path wants strict JSON, so that stays the default. A
   * capability whose whole product is prose needs "text" — asking a provider for
   * a JSON object and then treating the result as prose is how a chat capability
   * starts answering in braces.
   */
  responseFormat: z.enum(["json", "text"]).default("json"),
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
  /**
   * Why generation stopped, normalized across providers. `length` is the one
   * that matters: a response cut off at the token ceiling looks like a complete
   * answer to every caller that only reads `text`.
   */
  finishReason: z.enum(["stop", "length", "content_filter", "tool_use", "unknown"]),
  latencyMs: z.number().int().nonnegative(),
  providerRequestId: z.string().optional(),
  fallbackUsed: z.boolean(),
  fallbackFrom: z.string().optional(),
  decisionReasons: z.array(z.string()),
});

export type ModelGatewayResponse = z.infer<typeof ModelGatewayResponseSchema>;

// The error types live in `model-gateway-errors.ts` so the failure taxonomy can
// classify them without importing this module. They are re-exported here so
// every existing importer keeps working unchanged.
export {
  ModelGatewayUnavailableError,
  ModelGatewayOutputError,
  ModelGatewayPolicyError,
} from "./model-gateway-errors";

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

export type NormalizedFinishReason = "stop" | "length" | "content_filter" | "tool_use" | "unknown";

/**
 * Three vendors, three vocabularies for the same five outcomes. Normalizing
 * here means no caller has to know that anthropic says `max_tokens` where
 * openai says `length` and gemini shouts `MAX_TOKENS`.
 *
 * An unrecognized value maps to `"unknown"`, never to `"stop"`. Defaulting to
 * `"stop"` would assert that generation completed normally on no evidence,
 * which is exactly the claim this field exists to stop JASIM making.
 */
export function finishReasonFromProvider(
  data: unknown,
  provider: ModelProvider,
): NormalizedFinishReason {
  const raw =
    provider === "anthropic"
      ? (data as { stop_reason?: unknown }).stop_reason
      : provider === "gemini"
        ? (data as { candidates?: Array<{ finishReason?: unknown }> }).candidates?.[0]?.finishReason
        : (data as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]?.finish_reason;
  if (typeof raw !== "string") return "unknown";
  switch (raw.toLowerCase()) {
    case "stop":
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "content_filter":
    case "safety":
    case "recitation":
    case "prohibited_content":
      return "content_filter";
    case "tool_calls":
    case "tool_use":
    case "function_call":
      return "tool_use";
    default:
      return "unknown";
  }
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

/**
 * Gemini authenticates by query string, so the request URL contains the
 * credential. Nothing in JASIM logs that URL today — but "today" is the
 * operative word, and a transport error message is composed by the runtime,
 * not by us: a future Node or undici version may well include the URL it failed
 * to reach.
 *
 * Redacting at the point where a provider error becomes a JASIM error is the
 * cheap end of that trade. The alternative is auditing every log statement
 * downstream forever.
 */
function redactCredentials(text: string, apiKey?: string): string {
  let safe = text.replace(/([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi, "$1[REDACTED]");
  if (apiKey && apiKey.length >= 8) safe = safe.split(apiKey).join("[REDACTED]");
  return safe;
}

async function responseError(
  response: Response,
  provider: ModelProvider,
  apiKey?: string,
): Promise<never> {
  // Providers echo the offending key back in 401 bodies. That body goes into an
  // error message, which goes into logs.
  const detail = redactCredentials((await response.text()).slice(0, 500), apiKey);
  // The status travels on the error object, not only inside the message. The
  // failure taxonomy has to tell 429 from 401 from 500 to decide whether a
  // retry, a failover or neither is honest — and message prose is a provider's
  // to change without notice.
  throw new ModelGatewayUnavailableError(
    `${provider} model service returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
    { status: response.status, retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) },
  );
}

/**
 * The usage ledger is durable telemetry, not the response path.
 *
 * Two bad outcomes if a write throws and nothing catches it. On the success
 * path, a database hiccup would discard a response the provider has already
 * billed for — losing both the money and the answer. On a failure path, the
 * write happens inside a `catch`, so a throw would replace the provider's error
 * with a database error and abort failover before the next candidate is tried.
 *
 * So a failed write never propagates. It is loud instead of silent: the row that
 * was lost is logged with its identity, so under-counted spend is visible in the
 * logs rather than only in the invoice. Never log the prompt, the output, or
 * anything from `usageContext` beyond what the row already carries.
 */
async function recordUsageSafely(record: Parameters<typeof recordModelUsage>[0]): Promise<void> {
  try {
    await recordModelUsage(record);
  } catch (error) {
    console.error(
      "[model-gateway] usage ledger write failed; this call is UNCOUNTED. " +
        `provider=${record.provider} model=${record.modelId} tier=${record.tier} ` +
        `success=${record.success} reason=${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

    // Context budgeting happens once, before any candidate is contacted. An
    // oversized prompt is oversized for every model, so paying a provider to
    // tell us that — four times over, once per fallback — would be spend with
    // no possible outcome. It also runs before the first budget reservation:
    // refusing to send costs nothing and should not consume an allowance.
    const requestStartedAt = Date.now();
    let contextAssessment: ReturnType<typeof enforceContextBudget>;
    try {
      contextAssessment = enforceContextBudget({
        segments: [validated.systemPrompt, validated.prompt],
        declaredMaxInputTokens: validated.budget?.maxInputTokens,
        label: `${profile.purpose} (${selectedTier})`,
      });
    } catch (error) {
      // A refusal is still an event. Left unrecorded, the one symptom of a
      // prompt that is quietly growing past its budget would be its own
      // absence from the ledger.
      await recordUsageSafely({
        ...validated.usageContext,
        purpose: profile.purpose,
        tier: selectedTier,
        provider: "unavailable",
        modelId: "unavailable",
        latencyMs: Date.now() - requestStartedAt,
        fallbackUsed: false,
        escalatedFrom: decision.escalatedFrom,
        escalationReason: profile.escalationReason,
        success: false,
        errorCategory: normalizeModelFailure(error).category,
        promptVersion: validated.usageContext?.promptVersion ?? "jasim-gateway:v1",
      });
      throw error;
    }

    const startedAt = Date.now();
    const maxRetriesPerCandidate = configuredMaxRetriesPerCandidate();
    let firstFailure: string | undefined;
    let fallbackFrom: string | undefined;
    let lastError: unknown;
    /** Attempts that actually entered a provider request. Drives ledger rows. */
    let providerAttempts = 0;

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

      let candidateExhaustedBudget = false;
      for (let attempt = 0; attempt <= maxRetriesPerCandidate; attempt += 1) {
        const reason: ModelCallReason =
          attempt > 0 ? "RETRY_ATTEMPT" : index > 0 ? "FALLBACK_ATTEMPT" : "PRIMARY_ATTEMPT";
        // THE ENFORCEMENT POINT. Every provider attempt — primary, fallback and
        // retry alike — commits a slot from the ambient server-established
        // budget before any network call. Because the refusal happens here
        // rather than after the request, a refused call cannot be re-attempted
        // "through another provider": the break below leaves the candidate loop
        // as well.
        try {
          reserveModelCall(reason);
        } catch (error) {
          lastError = error;
          firstFailure ??= `${config.provider}/${config.model}`;
          candidateExhaustedBudget = true;
          break;
        }
        providerAttempts += 1;
        const attemptStartedAt = Date.now();

        try {
          const result = await this.generateFromConfig(config, validated, decision.timeoutMs);
          // Two different latencies, both true. The ledger row measures THIS
          // attempt, which is what a provider-performance question needs. The
          // response carries total elapsed time including retries and backoff,
          // which is what the caller actually waited.
          const attemptLatencyMs = Date.now() - attemptStartedAt;
          const latencyMs = Date.now() - startedAt;
          const response = ModelGatewayResponseSchema.parse({
            text: result.text.trim(),
            provider: config.provider,
            model: config.model,
            tier: selectedTier,
            latencyMs,
            providerRequestId: result.providerRequestId,
            finishReason: result.finishReason,
            fallbackUsed: index > 0,
            fallbackFrom: index > 0 ? fallbackFrom : undefined,
            decisionReasons: [
              ...decision.decisionReasons,
              `ESTIMATED_INPUT_TOKENS_${contextAssessment.estimatedInputTokens}`,
              ...(attempt > 0 ? [`RETRY_${attempt}`] : []),
            ],
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
          await recordUsageSafely({
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
            latencyMs: attemptLatencyMs,
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
          const failure = normalizeModelFailure(error);
          // EVERY attempt that reached a provider gets its own ledger row.
          // A single aggregate row per request was a cost-truth hole: a
          // failover from A to B recorded only B's success, while A may well
          // have generated tokens before failing and billed for them. One row
          // per attempt makes spend countable instead of inferable.
          await recordUsageSafely({
            ...validated.usageContext,
            purpose: profile.purpose,
            tier: selectedTier,
            provider: config.provider,
            modelId: config.model,
            latencyMs: Date.now() - attemptStartedAt,
            fallbackUsed: index > 0,
            fallbackFrom: index > 0 ? firstFailure : undefined,
            escalatedFrom: decision.escalatedFrom,
            escalationReason: profile.escalationReason,
            success: false,
            errorCategory: failure.category,
            promptVersion: validated.usageContext?.promptVersion ?? "jasim-gateway:v1",
          });
          if (!failure.allowFailover) {
            // Terminal for the whole request, not just this candidate: a policy
            // rejection, an authority violation or a spent budget is not a fact
            // about this provider.
            candidateExhaustedBudget = true;
            break;
          }
          if (failure.retryable && attempt < maxRetriesPerCandidate) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, failure)));
            continue;
          }
          break;
        }
      }
      if (candidateExhaustedBudget) break;
    }

    const failure = normalizeModelFailure(lastError);
    const errorCategory: ModelFailureCategory = failure.category;
    if (providerAttempts === 0) {
      // Nothing was contacted — a missing credential, a cost ceiling, a refused
      // budget. It is still recorded, because "JASIM declined to call a model"
      // is an event worth being able to count, but with `provider` and `modelId`
      // set to "unavailable" so it can never be mistaken for billed usage.
      await recordUsageSafely({
        ...validated.usageContext,
        purpose: profile.purpose,
        tier: selectedTier,
        provider: "unavailable",
        modelId: "unavailable",
        latencyMs: Date.now() - startedAt,
        fallbackUsed: false,
        fallbackFrom: firstFailure,
        escalatedFrom: decision.escalatedFrom,
        escalationReason: profile.escalationReason,
        success: false,
        errorCategory,
        promptVersion: validated.usageContext?.promptVersion ?? "jasim-gateway:v1",
      });
    }
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
    finishReason: NormalizedFinishReason;
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
        if (!response.ok) await responseError(response, config.provider, config.apiKey);
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
                ...(validated.responseFormat === "json"
                  ? { responseMimeType: "application/json" }
                  : {}),
              },
            }),
          },
        );
        if (!response.ok) await responseError(response, config.provider, config.apiKey);
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
            ...(validated.responseFormat === "json"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
        });
        if (!response.ok) await responseError(response, config.provider, config.apiKey);
        data = await response.json();
        text = extractOpenAiText(data);
      }
    } catch (error) {
      if (error instanceof ModelGatewayUnavailableError) throw error;
      const message = redactCredentials(
        error instanceof Error ? error.message : String(error),
        config.apiKey,
      );
      throw new ModelGatewayUnavailableError(
        `Unable to reach the ${config.provider} model service: ${message}`,
      );
    }

    if (!text.trim()) {
      throw new ModelGatewayOutputError(
        `The ${config.provider} model returned an empty response; no task was saved.`,
      );
    }
    const finishReason = finishReasonFromProvider(data, config.provider);
    if (finishReason === "length" && validated.responseFormat === "json") {
      // Truncated JSON is not JSON. Downstream it would surface as a confusing
      // parse error about an unexpected end of input; saying what actually
      // happened is more useful, and it is a retryable failure rather than a
      // malformed-model one.
      throw new ModelGatewayOutputError(
        `The ${config.provider} model hit its output token ceiling before finishing its JSON ` +
          "response, so the output is truncated and was discarded.",
      );
    }
    return {
      text,
      providerRequestId: response.headers.get("x-request-id") ?? undefined,
      finishReason,
      usage: usageFromProvider(data),
    };
  }
}

export const modelGateway = new ModelGateway();