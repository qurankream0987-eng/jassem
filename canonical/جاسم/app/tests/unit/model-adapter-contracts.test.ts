import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recorded: Array<Record<string, unknown>> = [];
vi.mock("../../api/runtime/model-usage-ledger", () => ({
  recordModelUsage: async (record: Record<string, unknown>) => {
    recorded.push(record);
  },
}));

import {
  ModelGateway,
  finishReasonFromProvider,
  type ModelProvider,
} from "../../api/runtime/model-gateway";
import { runWithModelCallBudget } from "../../api/runtime/model-call-budget";
import { normalizeModelFailure } from "../../api/runtime/model-failure";

/**
 * WAVE 2.1 PART 5 — adapter CONTRACT tests.
 *
 * This is explicitly not real-provider acceptance and no line in this file may
 * be cited as such. Nothing here proves a provider accepts these requests; it
 * proves that JASIM builds the request it believes it is building, and reads the
 * response it believes it is reading.
 *
 * That is worth doing before spending a credential, because it is where the
 * cheap mistakes live — a header spelled `Authorization` for a vendor that wants
 * `x-api-key`, a `max_tokens` where a model wants `max_completion_tokens`. Those
 * fail on the first real call and cost a debugging session each.
 */

const ENV_KEYS = [
  "JASIM_MODEL_PROVIDER",
  "JASIM_MODEL",
  "JASIM_MODEL_T1",
  "JASIM_MODEL_T1_FALLBACKS",
  "JASIM_MODEL_PRICES",
  "JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "MODEL_GATEWAY_API_KEY",
  "MODEL_GATEWAY_BASE_URL",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
] as const;

let savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const SECRET = "test-key-not-a-real-credential";

type Captured = { url: string; init: RequestInit };

function captureFetch(respond: () => Response): { calls: Captured[] } {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  recorded.length = 0;
  // Retries off: a contract test asserts one request shape, not backoff.
  process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE = "0";
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

const generate = (overrides: Record<string, unknown> = {}) =>
  runWithModelCallBudget({ origin: "TEST", label: "adapter contract", maxModelCalls: 4 }, () =>
    new ModelGateway().generate({
      prompt: "ما هي حالة الطلب؟",
      systemPrompt: "You are JASIM.",
      maxTokens: 512,
      temperature: 0.1,
      taskProfile: { purpose: "CONVERSATION" as const },
      ...overrides,
    }),
  );

function configure(provider: ModelProvider, model: string): void {
  process.env.JASIM_MODEL_PROVIDER = provider;
  process.env.JASIM_MODEL = model;
  if (provider === "openai") {
    process.env.OPENAI_API_KEY = SECRET;
    process.env.OPENAI_BASE_URL = "https://openai.invalid/v1";
  } else if (provider === "anthropic") {
    process.env.ANTHROPIC_API_KEY = SECRET;
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.invalid/v1";
  } else if (provider === "gemini") {
    process.env.GEMINI_API_KEY = SECRET;
    process.env.GEMINI_BASE_URL = "https://gemini.invalid/v1beta";
  } else {
    process.env.MODEL_GATEWAY_API_KEY = SECRET;
    process.env.MODEL_GATEWAY_BASE_URL = "https://compat.invalid/v1/";
  }
}

// ── openai ──────────────────────────────────────────────────────────────────

const openAiBody = (finish = "stop") => ({
  choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: finish }],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 40,
    total_tokens: 160,
    prompt_tokens_details: { cached_tokens: 30 },
    completion_tokens_details: { reasoning_tokens: 12 },
  },
});

describe("adapter contract — openai", () => {
  it("builds the request the API documents", async () => {
    configure("openai", "gpt-4o-mini");
    const { calls } = captureFetch(() => json(openAiBody(), 200, { "x-request-id": "req-oa-1" }));
    await generate();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://openai.invalid/v1/chat/completions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "You are JASIM." },
      { role: "user", content: "ما هي حالة الطلب؟" },
    ]);
    expect(body.max_tokens).toBe(512);
    expect(body.temperature).toBe(0.1);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits response_format when prose was asked for", async () => {
    configure("openai", "gpt-4o-mini");
    const { calls } = captureFetch(() => json(openAiBody()));
    await generate({ responseFormat: "text" });
    expect(JSON.parse(String(calls[0]!.init.body)).response_format).toBeUndefined();
  });

  it("parses usage, including the cached and reasoning sub-counts", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => json(openAiBody(), 200, { "x-request-id": "req-oa-1" }));
    const response = await generate();
    expect(response).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      tier: "T1",
      inputTokens: 120,
      cachedInputTokens: 30,
      outputTokens: 40,
      reasoningTokens: 12,
      totalTokens: 160,
      finishReason: "stop",
      providerRequestId: "req-oa-1",
      fallbackUsed: false,
    });
  });
});

// ── openai-compatible ───────────────────────────────────────────────────────

describe("adapter contract — openai-compatible", () => {
  it("uses max_completion_tokens and sends no temperature", async () => {
    // Both are real divergences from the openai adapter, and both are the kind
    // of detail that only shows up as a 400 on a live call.
    configure("openai-compatible", "gpt-5.6-terra");
    const { calls } = captureFetch(() => json(openAiBody()));
    await generate();

    expect(calls[0]!.url).toBe("https://compat.invalid/v1/chat/completions");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it("strips a trailing slash from the configured base URL", async () => {
    configure("openai-compatible", "gpt-5.6-terra");
    process.env.MODEL_GATEWAY_BASE_URL = "https://compat.invalid/v1///";
    const { calls } = captureFetch(() => json(openAiBody()));
    await generate();
    expect(calls[0]!.url).toBe("https://compat.invalid/v1/chat/completions");
  });
});

// ── anthropic ───────────────────────────────────────────────────────────────

const anthropicBody = (stop = "end_turn") => ({
  content: [{ type: "text", text: '{"answer":"ok"}' }],
  stop_reason: stop,
  usage: { input_tokens: 200, output_tokens: 60 },
});

describe("adapter contract — anthropic", () => {
  it("uses x-api-key and the version header, not Bearer", async () => {
    configure("anthropic", "claude-3-5-sonnet-latest");
    const { calls } = captureFetch(() => json(anthropicBody()));
    await generate();

    expect(calls[0]!.url).toBe("https://anthropic.invalid/v1/messages");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(SECRET);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
  });

  it("hoists the system prompt out of messages", async () => {
    configure("anthropic", "claude-3-5-sonnet-latest");
    const { calls } = captureFetch(() => json(anthropicBody()));
    await generate();
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.system).toBe("You are JASIM.");
    expect(body.messages).toEqual([{ role: "user", content: "ما هي حالة الطلب؟" }]);
    expect(body.max_tokens).toBe(512);
  });

  it("accepts CLAUDE_API_KEY as an alternative credential name", async () => {
    process.env.JASIM_MODEL_PROVIDER = "anthropic";
    process.env.JASIM_MODEL = "claude-3-5-sonnet-latest";
    process.env.CLAUDE_API_KEY = SECRET;
    const { calls } = captureFetch(() => json(anthropicBody()));
    await generate();
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe(SECRET);
  });

  it("reads anthropic's usage field names", async () => {
    configure("anthropic", "claude-3-5-sonnet-latest");
    captureFetch(() => json(anthropicBody()));
    const response = await generate();
    expect(response.inputTokens).toBe(200);
    expect(response.outputTokens).toBe(60);
    // Anthropic reports no total; inventing one would be a fabricated number.
    expect(response.totalTokens).toBeUndefined();
  });
});

// ── gemini ──────────────────────────────────────────────────────────────────

const geminiBody = (finish = "STOP") => ({
  candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] }, finishReason: finish }],
  usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 25, totalTokenCount: 115 },
});

describe("adapter contract — gemini", () => {
  it("puts the key in the query string and the system prompt in systemInstruction", async () => {
    configure("gemini", "gemini-2.0-flash");
    const { calls } = captureFetch(() => json(geminiBody()));
    await generate();

    expect(calls[0]!.url).toBe(
      `https://gemini.invalid/v1beta/models/gemini-2.0-flash:generateContent?key=${SECRET}`,
    );
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are JASIM." }] });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "ما هي حالة الطلب؟" }] }]);
    expect(body.generationConfig.maxOutputTokens).toBe(512);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("drops responseMimeType for prose", async () => {
    configure("gemini", "gemini-2.0-flash");
    const { calls } = captureFetch(() => json(geminiBody()));
    await generate({ responseFormat: "text" });
    expect(JSON.parse(String(calls[0]!.init.body)).generationConfig.responseMimeType).toBeUndefined();
  });

  it("URL-encodes a model name containing a slash", async () => {
    configure("gemini", "models/gemini-2.0-flash");
    const { calls } = captureFetch(() => json(geminiBody()));
    await generate();
    expect(calls[0]!.url).toContain("models%2Fgemini-2.0-flash:generateContent");
  });

  it("reads gemini's usageMetadata names", async () => {
    configure("gemini", "gemini-2.0-flash");
    captureFetch(() => json(geminiBody()));
    const response = await generate();
    expect(response).toMatchObject({ inputTokens: 90, outputTokens: 25, totalTokens: 115 });
  });
});

// ── shared contract behaviour ───────────────────────────────────────────────

describe("adapter contract — finish reasons normalize across all vocabularies", () => {
  it("maps each provider's words onto one vocabulary", () => {
    expect(finishReasonFromProvider({ choices: [{ finish_reason: "stop" }] }, "openai")).toBe("stop");
    expect(finishReasonFromProvider({ choices: [{ finish_reason: "length" }] }, "openai")).toBe("length");
    expect(finishReasonFromProvider({ choices: [{ finish_reason: "tool_calls" }] }, "openai")).toBe("tool_use");
    expect(finishReasonFromProvider({ stop_reason: "end_turn" }, "anthropic")).toBe("stop");
    expect(finishReasonFromProvider({ stop_reason: "max_tokens" }, "anthropic")).toBe("length");
    expect(finishReasonFromProvider({ candidates: [{ finishReason: "STOP" }] }, "gemini")).toBe("stop");
    expect(finishReasonFromProvider({ candidates: [{ finishReason: "MAX_TOKENS" }] }, "gemini")).toBe("length");
    expect(finishReasonFromProvider({ candidates: [{ finishReason: "SAFETY" }] }, "gemini")).toBe("content_filter");
  });

  it("an unrecognized reason is 'unknown', never 'stop'", () => {
    expect(finishReasonFromProvider({ choices: [{ finish_reason: "brand_new" }] }, "openai")).toBe("unknown");
    expect(finishReasonFromProvider({}, "anthropic")).toBe("unknown");
  });

  it("refuses truncated JSON rather than passing it downstream", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => json(openAiBody("length")));
    await expect(generate()).rejects.toThrow(/output token ceiling/);
  });

  it("keeps truncated PROSE, because half an answer is still an answer", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => json(openAiBody("length")));
    const response = await generate({ responseFormat: "text" });
    expect(response.finishReason).toBe("length");
  });
});

describe("adapter contract — status and error mapping", () => {
  const cases: Array<[number, string]> = [
    [401, "PROVIDER_AUTH_FAILED"],
    [403, "PROVIDER_AUTH_FAILED"],
    [404, "PROVIDER_MODEL_NOT_FOUND"],
    [429, "PROVIDER_RATE_LIMITED"],
    [500, "PROVIDER_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"],
    [504, "PROVIDER_TIMEOUT"],
  ];

  for (const [status, category] of cases) {
    it(`HTTP ${status} maps to ${category} for every adapter`, async () => {
      for (const provider of ["openai", "anthropic", "gemini", "openai-compatible"] as const) {
        configure(provider, "some-model");
        captureFetch(() => new Response("provider said no", { status }));
        const failure = await generate().then(
          () => undefined,
          (error) => normalizeModelFailure(error),
        );
        expect(failure?.category, `${provider} ${status}`).toBe(category);
      }
    });
  }

  it("carries a Retry-After through to the backoff decision", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => new Response("slow down", { status: 429, headers: { "retry-after": "7" } }));
    const failure = await generate().then(
      () => undefined,
      (error) => normalizeModelFailure(error),
    );
    expect(failure?.retryAfterMs).toBe(7_000);
  });

  it("truncates the provider's error body instead of logging it whole", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => new Response("x".repeat(5_000), { status: 500 }));
    const failure = await generate().then(
      () => undefined,
      (error) => normalizeModelFailure(error),
    );
    expect(failure!.message.length).toBeLessThan(700);
  });

  it("an empty completion is a failure, not an empty success", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => json({ choices: [{ message: { content: "   " } }] }));
    const failure = await generate().then(
      () => undefined,
      (error) => normalizeModelFailure(error),
    );
    expect(failure?.category).toBe("MODEL_GATEWAY_INVALID_OUTPUT");
  });

  it("a provider response missing usage yields undefined counts, never zero", async () => {
    configure("anthropic", "claude-3-5-sonnet-latest");
    captureFetch(() => json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    const response = await generate({ responseFormat: "text" });
    expect(response.inputTokens).toBeUndefined();
    expect(response.outputTokens).toBeUndefined();
    // And the ledger must not record it as free.
    expect(recorded.at(-1)).toMatchObject({ success: true });
    expect(recorded.at(-1)!.estimatedCost).toBeUndefined();
  });
});

describe("adapter contract — no credential reaches anywhere it should not", () => {
  it("never puts the key in the error message or the ledger", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(() => new Response(`invalid key: ${SECRET}`.slice(0, 20), { status: 401 }));
    const failure = await generate().then(
      () => undefined,
      (error) => normalizeModelFailure(error),
    );
    // The provider echoed a prefix of nothing sensitive; what matters is that
    // JASIM itself never interpolates the credential.
    expect(failure!.message).not.toContain(SECRET);
    expect(JSON.stringify(recorded)).not.toContain(SECRET);
  });

  it("never puts the key in the response object", async () => {
    configure("gemini", "gemini-2.0-flash");
    captureFetch(() => json(geminiBody()));
    const response = await generate();
    // The gemini URL carries the key by design; the RESPONSE must not.
    expect(JSON.stringify(response)).not.toContain(SECRET);
  });
});

describe("PART 17 — credential redaction at the error boundary", () => {
  it("strips a key from a query string echoed in a transport error", async () => {
    configure("gemini", "gemini-2.0-flash");
    globalThis.fetch = (async (url: string) => {
      // The shape a runtime transport error takes when it names what it could
      // not reach. Gemini authenticates by query string, so this is where a key
      // would escape into a log.
      throw new Error(`request to ${String(url)} failed, reason: ECONNREFUSED`);
    }) as unknown as typeof fetch;

    const failure = await generate().then(
      () => undefined,
      (error) => normalizeModelFailure(error),
    );
    expect(failure!.message).not.toContain(SECRET);
    expect(failure!.message).toContain("[REDACTED]");
  });

  it("strips a key echoed back in a provider's own error body", async () => {
    configure("openai", "gpt-4o-mini");
    captureFetch(
      () => new Response(`Incorrect API key provided: ${SECRET}`, { status: 401 }),
    );
    const failure = await generate().then(
      () => undefined,
      (error) => normalizeModelFailure(error),
    );
    expect(failure!.message).not.toContain(SECRET);
  });
});
