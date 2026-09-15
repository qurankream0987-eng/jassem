import { z } from "@workspace/api-zod";

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
});

export type ModelGatewayRequest = z.input<typeof ModelGatewayRequestSchema>;

export const ModelGatewayResponseSchema = z.object({
  text: z.string().min(1),
  provider: ModelProviderSchema,
  model: z.string().min(1),
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
  "openai-compatible": "",
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
      if (!process.env.MODEL_GATEWAY_API_KEY || !process.env.MODEL_GATEWAY_BASE_URL) {
        throw new ModelGatewayUnavailableError(
          "The openai-compatible provider requires MODEL_GATEWAY_BASE_URL and MODEL_GATEWAY_API_KEY.",
        );
      }
      return {
        provider,
        model,
        apiKey: process.env.MODEL_GATEWAY_API_KEY,
        baseUrl: process.env.MODEL_GATEWAY_BASE_URL.replace(/\/+$/, ""),
      };
    default:
      throw new ModelGatewayUnavailableError("The selected model provider is not supported.");
  }
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

async function responseError(response: Response, provider: ModelProvider): Promise<never> {
  const detail = (await response.text()).slice(0, 500);
  throw new ModelGatewayUnavailableError(
    `${provider} model service returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
  );
}

export class ModelGateway {
  async generate(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    const validated = ModelGatewayRequestSchema.parse(request);
    const config = resolveConfig(validated.selection);
    const signal = AbortSignal.timeout(45_000);

    let response: Response;
    let text: string;
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
        text = extractAnthropicText(await response.json());
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
        text = extractGeminiText(await response.json());
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
            temperature: validated.temperature,
            max_tokens: validated.maxTokens,
            response_format: { type: "json_object" },
          }),
        });
        if (!response.ok) await responseError(response, config.provider);
        text = extractOpenAiText(await response.json());
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

    return ModelGatewayResponseSchema.parse({
      text: text.trim(),
      provider: config.provider,
      model: config.model,
    });
  }
}

export const modelGateway = new ModelGateway();