import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LedgerRow = {
  provider: string;
  modelId: string;
  tier: string;
  success: boolean;
  errorCategory?: string;
  estimatedCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  fallbackUsed: boolean;
};

const ledger: LedgerRow[] = [];
/** Set to make the ledger write throw, simulating a database outage. */
let ledgerFailure: Error | undefined;
vi.mock("../../api/runtime/model-usage-ledger", () => ({
  recordModelUsage: async (record: LedgerRow) => {
    if (ledgerFailure) throw ledgerFailure;
    ledger.push(record);
  },
}));

import { ModelGateway } from "../../api/runtime/model-gateway";
import {
  ModelBudgetContextMissingError,
  currentModelCallBudget,
  runWithModelCallBudget,
} from "../../api/runtime/model-call-budget";
import { ModelBudgetExceededError } from "../../api/runtime/model-cost";
import { normalizeModelFailure } from "../../api/runtime/model-failure";

/**
 * WAVE 2.1 PARTS 11 & 12 — failure classification and cost truth.
 *
 * Part 11's rule is the one that matters: no failure may come back as a normal
 * successful assistant response. A gateway that degrades into a cheerful
 * "Sorry, I couldn't reach the model!" string is worse than one that throws,
 * because the caller stores it, renders it, and counts it as an answer.
 *
 * Part 12's rule is its financial twin: every attempt that could have been
 * billed is recorded, and every refusal that could NOT have been billed is
 * recorded as such. A ledger that quietly omits a failed attempt understates
 * spend at exactly the moment spend is going wrong.
 */

const ENV_KEYS = [
  "JASIM_MODEL_PROVIDER",
  "JASIM_MODEL",
  "JASIM_MODEL_T1",
  "JASIM_MODEL_T1_FALLBACKS",
  "JASIM_MODEL_T2",
  "JASIM_MODEL_T2_FALLBACKS",
  "JASIM_MODEL_PRICES",
  "JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE",
  "JASIM_MODEL_MAX_CALLS_PER_SCOPE",
  "JASIM_MODEL_MAX_INPUT_TOKENS",
  "JASIM_MODEL_BUDGET_ENFORCEMENT",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
] as const;

let savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

const okBody = (tokens = { prompt: 1_000, completion: 500 }) => ({
  choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: tokens.prompt,
    completion_tokens: tokens.completion,
    total_tokens: tokens.prompt + tokens.completion,
  },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  ledger.length = 0;
  ledgerFailure = undefined;
  process.env.JASIM_MODEL_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-a-real-credential";
  process.env.OPENAI_BASE_URL = "https://openai.invalid/v1";
  process.env.JASIM_MODEL = "primary-model";
  process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE = "0";
  // A price table so cost is computable and assertions are about arithmetic,
  // not about configuration being absent.
  process.env.JASIM_MODEL_PRICES = JSON.stringify({
    "openai/primary-model": { inputPerMillion: 1, outputPerMillion: 4, currency: "USD" },
    "anthropic/fallback-model": { inputPerMillion: 2, outputPerMillion: 8, currency: "USD" },
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
});

const request = {
  prompt: "ما هي حالة الطلب؟",
  systemPrompt: "You are JASIM.",
  taskProfile: { purpose: "CONVERSATION" as const },
};

const run = <T>(fn: () => Promise<T>, maxModelCalls = 6) =>
  runWithModelCallBudget({ origin: "TEST", label: "failure truth", maxModelCalls }, fn);

async function failureOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "UNEXPECTED_SUCCESS";
  } catch (error) {
    return normalizeModelFailure(error).category;
  }
}

describe("PART 11 — every failure mode is a failure, never a cheerful answer", () => {
  it("invalid credential → PROVIDER_AUTH_FAILED", async () => {
    globalThis.fetch = (async () =>
      new Response("invalid_api_key", { status: 401 })) as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "PROVIDER_AUTH_FAILED",
    );
  });

  it("no credential configured at all → PROVIDER_AUTH_FAILED, before any request", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "PROVIDER_AUTH_FAILED",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("provider timeout → PROVIDER_TIMEOUT", async () => {
    globalThis.fetch = (async () =>
      new Response("gateway timeout", { status: 504 })) as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "PROVIDER_TIMEOUT",
    );
  });

  it("an aborted request → PROVIDER_UNAVAILABLE, not a partial answer", async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "PROVIDER_UNAVAILABLE",
    );
  });

  it("rate limit → PROVIDER_RATE_LIMITED", async () => {
    globalThis.fetch = (async () =>
      new Response("slow down", { status: 429 })) as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "PROVIDER_RATE_LIMITED",
    );
  });

  it("malformed structured output → MODEL_GATEWAY_INVALID_OUTPUT", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ choices: [{ message: { content: "" } }] })) as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "MODEL_GATEWAY_INVALID_OUTPUT",
    );
  });

  it("truncated JSON → MODEL_GATEWAY_INVALID_OUTPUT, not a half answer", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        choices: [{ message: { content: '{"answer":"partia' }, finish_reason: "length" }],
      })) as unknown as typeof fetch;
    expect(await failureOf(() => run(() => new ModelGateway().generate(request)))).toBe(
      "MODEL_GATEWAY_INVALID_OUTPUT",
    );
  });

  it("context limit → MODEL_CONTEXT_TOO_LARGE, before the provider is contacted", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const category = await failureOf(() =>
      run(() =>
        new ModelGateway().generate({
          ...request,
          prompt: "ب".repeat(200_000),
          budget: { maxInputTokens: 1_000 },
        }),
      ),
    );
    expect(category).toBe("MODEL_CONTEXT_TOO_LARGE");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("budget exhausted → MODEL_BUDGET_EXCEEDED", async () => {
    globalThis.fetch = (async () => jsonResponse(okBody())) as unknown as typeof fetch;
    const category = await failureOf(() =>
      run(async () => {
        currentModelCallBudget()!.reserve("PRIMARY_ATTEMPT");
        return new ModelGateway().generate(request);
      }, 1),
    );
    expect(category).toBe("MODEL_BUDGET_EXCEEDED");
  });

  it("missing budget context in the fail-closed default → hard failure before the provider call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(new ModelGateway().generate(request)).rejects.toBeInstanceOf(
      ModelBudgetContextMissingError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("not one of these returns a successful-looking response object", async () => {
    // The single assertion Part 11 actually asks for, stated as one check over
    // every mode rather than implied by nine separate ones.
    const modes: Array<[string, () => Promise<unknown>]> = [
      ["auth", async () => {
        globalThis.fetch = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
        return run(() => new ModelGateway().generate(request));
      }],
      ["rate-limit", async () => {
        globalThis.fetch = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
        return run(() => new ModelGateway().generate(request));
      }],
      ["empty-output", async () => {
        globalThis.fetch = (async () =>
          jsonResponse({ choices: [{ message: { content: "" } }] })) as unknown as typeof fetch;
        return run(() => new ModelGateway().generate(request));
      }],
      ["no-context", async () => new ModelGateway().generate(request)],
    ];
    for (const [name, mode] of modes) {
      await expect(mode(), name).rejects.toBeInstanceOf(Error);
    }
  });
});

describe("PART 12 — retry, failover and refusal are all accounted for", () => {
  it("a retry spends a budget slot and is recorded as its own attempt", async () => {
    process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE = "1";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1 ? new Response("boom", { status: 500 }) : jsonResponse(okBody());
    }) as unknown as typeof fetch;

    await run(async () => {
      const response = await new ModelGateway().generate(request);
      expect(response.decisionReasons).toContain("RETRY_1");
      // The retry consumed a second slot: two attempts, not one.
      expect(currentModelCallBudget()!.snapshot().reserved).toBe(2);
    });

    expect(calls).toBe(2);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({ success: false, errorCategory: "PROVIDER_UNAVAILABLE" });
    expect(ledger[1]).toMatchObject({ success: true, provider: "openai" });
  });

  it("a failover records BOTH the failed attempt and the successful one", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential";
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.invalid/v1";
    process.env.JASIM_MODEL_T1_FALLBACKS = "anthropic:fallback-model";

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("primary exploded", { status: 500 })
        : jsonResponse({
            content: [{ type: "text", text: '{"answer":"ok"}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1_000, output_tokens: 500 },
          });
    }) as unknown as typeof fetch;

    await run(() => new ModelGateway().generate(request));

    // The whole point: the primary's attempt is visible. A single aggregate row
    // would have shown only the anthropic success and understated the request.
    expect(ledger).toHaveLength(2);
    expect(ledger[0]).toMatchObject({
      provider: "openai",
      modelId: "primary-model",
      success: false,
    });
    expect(ledger[1]).toMatchObject({
      provider: "anthropic",
      modelId: "fallback-model",
      success: true,
    });
    // 1000 in @ $2/M + 500 out @ $8/M = 0.002 + 0.004
    expect(ledger[1]!.estimatedCost).toBeCloseTo(0.006, 9);
  });

  it("tier escalation is recorded under the tier that actually ran", async () => {
    process.env.JASIM_MODEL_T2 = "balanced-model";
    globalThis.fetch = (async () => jsonResponse(okBody())) as unknown as typeof fetch;
    await run(() =>
      new ModelGateway().generate({
        ...request,
        taskProfile: {
          purpose: "CONVERSATION" as const,
          previousTierFailure: true,
          priorTier: "T1" as const,
          escalationCount: 1,
        },
      }),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ tier: "T2", modelId: "balanced-model", success: true });
  });

  it("a budget refusal before the network creates NO provider token usage", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await run(async () => {
      currentModelCallBudget()!.reserve("PRIMARY_ATTEMPT");
      await expect(new ModelGateway().generate(request)).rejects.toBeInstanceOf(
        ModelBudgetExceededError,
      );
    }, 1);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(1);
    const row = ledger[0]!;
    expect(row.errorCategory).toBe("MODEL_BUDGET_EXCEEDED");
    // "unavailable" rather than a provider name: this row can never be mistaken
    // for billed usage by any aggregation.
    expect(row.provider).toBe("unavailable");
    expect(row.modelId).toBe("unavailable");
    expect(row.inputTokens).toBeUndefined();
    expect(row.outputTokens).toBeUndefined();
    expect(row.estimatedCost).toBeUndefined();
  });

  it("a context refusal likewise records a refusal, not a call", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    await run(() =>
      new ModelGateway()
        .generate({ ...request, prompt: "ب".repeat(200_000), budget: { maxInputTokens: 500 } })
        .catch(() => undefined),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      provider: "unavailable",
      errorCategory: "MODEL_CONTEXT_TOO_LARGE",
    });
  });

  it("every attempt in a multi-attempt request is individually observable", async () => {
    process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE = "1";
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential";
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.invalid/v1";
    process.env.JASIM_MODEL_T1_FALLBACKS = "anthropic:fallback-model";
    globalThis.fetch = (async () =>
      new Response("everything is down", { status: 503 })) as unknown as typeof fetch;

    await run(() => new ModelGateway().generate(request).catch(() => undefined), 8);

    // primary ×2 (attempt + retry), fallback ×2 (attempt + retry)
    expect(ledger).toHaveLength(4);
    expect(ledger.map((row) => `${row.provider}/${row.modelId}`)).toEqual([
      "openai/primary-model",
      "openai/primary-model",
      "anthropic/fallback-model",
      "anthropic/fallback-model",
    ]);
    expect(ledger.every((row) => row.success === false)).toBe(true);
    expect(ledger.every((row) => row.errorCategory === "PROVIDER_UNAVAILABLE")).toBe(true);
  });

  it("per-attempt latency is the attempt's, not the whole request's", async () => {
    process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE = "1";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return calls === 1 ? new Response("boom", { status: 500 }) : jsonResponse(okBody());
    }) as unknown as typeof fetch;

    const response = await run(() => new ModelGateway().generate(request));
    // Total elapsed covers both attempts plus the backoff between them; the
    // successful attempt's own row must be shorter than that.
    expect(ledger[1]!.latencyMs).toBeLessThan(response.latencyMs);
  });

  it("a priced success records the arithmetic, not an assumption", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(okBody({ prompt: 2_000, completion: 1_000 }))) as unknown as typeof fetch;
    await run(() => new ModelGateway().generate(request));
    // 2000 in @ $1/M + 1000 out @ $4/M = 0.002 + 0.004
    expect(ledger[0]!.estimatedCost).toBeCloseTo(0.006, 9);
  });

  it("an unpriced model records undefined cost, never zero", async () => {
    process.env.JASIM_MODEL = "model-with-no-configured-price";
    globalThis.fetch = (async () => jsonResponse(okBody())) as unknown as typeof fetch;
    await run(() => new ModelGateway().generate(request));
    expect(ledger[0]!.success).toBe(true);
    expect(ledger[0]!.estimatedCost).toBeUndefined();
  });
});

describe("PART 17 — a ledger outage degrades the evidence, never the answer", () => {
  it("returns the already-billed response even if the row cannot be written", async () => {
    ledgerFailure = new Error("connection terminated unexpectedly");
    globalThis.fetch = (async () => jsonResponse(okBody())) as unknown as typeof fetch;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await run(() => new ModelGateway().generate(request));

    // The provider has already charged for this call. Discarding the answer
    // would lose the money AND the result.
    expect(response.text).toBe('{"answer":"ok"}');
    // But the loss is loud: an uncounted call has to be findable in the logs.
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("UNCOUNTED"));
    expect(errors.mock.calls[0]![0]).toContain("provider=openai");
    errors.mockRestore();
  });

  it("a ledger outage does not mask the provider's error, nor abort failover", async () => {
    ledgerFailure = new Error("connection terminated unexpectedly");
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential";
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.invalid/v1";
    process.env.JASIM_MODEL_T1_FALLBACKS = "anthropic:fallback-model";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("primary exploded", { status: 500 })
        : jsonResponse({
            content: [{ type: "text", text: '{"answer":"ok"}' }],
            stop_reason: "end_turn",
          });
    }) as unknown as typeof fetch;

    const response = await run(() => new ModelGateway().generate(request));
    // Failover still happened: the write failure inside the catch did not
    // replace the provider error and break out of the loop.
    expect(calls).toBe(2);
    expect(response.provider).toBe("anthropic");
    errors.mockRestore();
  });
});
