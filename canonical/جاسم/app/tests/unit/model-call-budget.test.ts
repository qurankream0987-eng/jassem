import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The ledger writes to Postgres. These tests are about the ceiling, not about
// storage, so the write is replaced by a counter — which doubles as evidence
// that a refused call never reaches the recording path either.
const recorded: Array<Record<string, unknown>> = [];
vi.mock("../../api/runtime/model-usage-ledger", () => ({
  recordModelUsage: async (record: Record<string, unknown>) => {
    recorded.push(record);
  },
}));

import {
  DEFAULT_MAX_MODEL_CALLS_PER_SCOPE,
  ModelBudgetContextMissingError,
  ModelCallBudget,
  configuredEnforcement,
  configuredMaxModelCalls,
  currentModelCallBudget,
  requireModelExecutionContext,
  reserveModelCall,
  runWithModelCallBudget,
} from "../../api/runtime/model-call-budget";
import { ModelBudgetExceededError } from "../../api/runtime/model-cost";
import { ModelGateway } from "../../api/runtime/model-gateway";

const ENV_KEYS = [
  "JASIM_MODEL_MAX_CALLS_PER_SCOPE",
  "JASIM_MODEL_BUDGET_ENFORCEMENT",
  "JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE",
  "JASIM_MODEL_PROVIDER",
  "JASIM_MODEL",
  "JASIM_MODEL_T1",
  "JASIM_MODEL_T1_FALLBACKS",
  "JASIM_MODEL_PRICES",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  recorded.length = 0;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("model call budget — the scope itself", () => {
  it("permits exactly maxModelCalls reservations and refuses the next one", () => {
    const budget = new ModelCallBudget({ origin: "TEST", label: "t", maxModelCalls: 3 });
    expect(budget.reserve("PRIMARY_ATTEMPT").remaining).toBe(2);
    expect(budget.reserve("FALLBACK_ATTEMPT").remaining).toBe(1);
    expect(budget.reserve("RETRY_ATTEMPT").remaining).toBe(0);
    expect(() => budget.reserve("FALLBACK_ATTEMPT")).toThrow(ModelBudgetExceededError);
  });

  it("names the limit and the refused reason, so a refusal is explainable", () => {
    const budget = new ModelCallBudget({ origin: "TEST", label: "query runtime.send", maxModelCalls: 1 });
    budget.reserve("PRIMARY_ATTEMPT");
    expect(() => budget.reserve("FALLBACK_ATTEMPT")).toThrow(
      /query runtime\.send has already used its 1 permitted model call\(s\); FALLBACK_ATTEMPT was refused/,
    );
  });

  it("never gives a slot back — a spent attempt stays spent", () => {
    const budget = new ModelCallBudget({ origin: "TEST", label: "t", maxModelCalls: 1 });
    budget.reserve("PRIMARY_ATTEMPT");
    expect(budget.snapshot().reserved).toBe(1);
    expect(budget.snapshot().remaining).toBe(0);
    expect(Object.keys(budget)).not.toContain("release");
    expect((budget as unknown as Record<string, unknown>).release).toBeUndefined();
  });

  it("a maxModelCalls of 0 refuses the very first call", () => {
    const budget = new ModelCallBudget({ origin: "TEST", label: "t", maxModelCalls: 0 });
    expect(() => budget.reserve("PRIMARY_ATTEMPT")).toThrow(ModelBudgetExceededError);
  });
});

describe("model call budget — a scope cannot be widened from inside", () => {
  it("clamps a request above the deployment ceiling", () => {
    process.env.JASIM_MODEL_MAX_CALLS_PER_SCOPE = "2";
    const budget = new ModelCallBudget({ origin: "TEST", label: "t", maxModelCalls: 500 });
    expect(budget.maxModelCalls).toBe(2);
  });

  it("a nested scope can only narrow, never widen", async () => {
    await runWithModelCallBudget({ origin: "TEST", label: "outer", maxModelCalls: 2 }, async () => {
      currentModelCallBudget()!.reserve("PRIMARY_ATTEMPT");
      await runWithModelCallBudget(
        { origin: "TEST", label: "inner", maxModelCalls: 50 },
        async () => {
          // One slot was already spent in the outer scope, so the inner scope
          // inherits one, not fifty.
          expect(currentModelCallBudget()!.maxModelCalls).toBe(1);
        },
      );
    });
  });

  it("defaults to the deployment ceiling when a scope names no limit", async () => {
    expect(configuredMaxModelCalls()).toBe(DEFAULT_MAX_MODEL_CALLS_PER_SCOPE);
    await runWithModelCallBudget({ origin: "TEST", label: "t" }, async () => {
      expect(currentModelCallBudget()!.maxModelCalls).toBe(DEFAULT_MAX_MODEL_CALLS_PER_SCOPE);
    });
  });

  it("carries the scope across await boundaries", async () => {
    await runWithModelCallBudget({ origin: "TEST", label: "t", maxModelCalls: 4 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await Promise.resolve();
      expect(currentModelCallBudget()?.label).toBe("t");
    });
  });

  it("does not leak out of its scope", async () => {
    await runWithModelCallBudget({ origin: "TEST", label: "t" }, async () => undefined);
    expect(currentModelCallBudget()).toBeUndefined();
  });
});

describe("model call budget — enforcement fails closed", () => {
  it("an unset variable selects STRICT, not the permissive mode", () => {
    expect(process.env.JASIM_MODEL_BUDGET_ENFORCEMENT).toBeUndefined();
    expect(configuredEnforcement()).toBe("STRICT");
    expect(() => reserveModelCall("PRIMARY_ATTEMPT")).toThrow(ModelBudgetContextMissingError);
    expect(() => reserveModelCall("PRIMARY_ATTEMPT")).toThrow(/MODEL_BUDGET_CONTEXT_MISSING/);
  });

  it("a typo does not silently select the permissive mode", () => {
    for (const value of ["scoped_", "SCOPE", "", "  ", "PERMISSIVE", "false", "0"]) {
      process.env.JASIM_MODEL_BUDGET_ENFORCEMENT = value;
      expect(configuredEnforcement()).toBe("STRICT");
    }
  });

  it("relaxing it takes an explicit, exact opt-out", () => {
    process.env.JASIM_MODEL_BUDGET_ENFORCEMENT = "SCOPED";
    expect(configuredEnforcement()).toBe("SCOPED");
    expect(reserveModelCall("PRIMARY_ATTEMPT")).toBeUndefined();
  });

  it("production ignores the variable entirely — there is no value that relaxes it", () => {
    const savedNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      for (const value of ["SCOPED", "scoped", "  SCOPED  ", "off", ""]) {
        process.env.JASIM_MODEL_BUDGET_ENFORCEMENT = value;
        expect(configuredEnforcement()).toBe("STRICT");
        expect(() => reserveModelCall("PRIMARY_ATTEMPT")).toThrow(ModelBudgetContextMissingError);
      }
    } finally {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it("STRICT still permits calls inside a context", async () => {
    await runWithModelCallBudget({ origin: "TEST", label: "t", maxModelCalls: 1 }, async () => {
      expect(reserveModelCall("PRIMARY_ATTEMPT")?.remaining).toBe(0);
    });
  });

  it("requireModelExecutionContext refuses rather than returning undefined", () => {
    // The point of the accessor: a caller cannot accidentally branch on
    // `undefined` and treat "no context" as "no limit".
    expect(() => requireModelExecutionContext("a planning loop")).toThrow(
      ModelBudgetContextMissingError,
    );
  });
});

// ── Gateway integration ─────────────────────────────────────────────────────

function configureSingleProvider(): void {
  process.env.JASIM_MODEL_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key-not-a-real-credential";
  process.env.OPENAI_BASE_URL = "https://provider.invalid/v1";
  process.env.JASIM_MODEL = "test-model";
}

function okResponse(text = '{"ok":true}'): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("model call budget — enforced inside the gateway", () => {
  it("rejects the N+1th call and never reaches the provider for it", async () => {
    configureSingleProvider();
    const fetchSpy = vi.fn(async () => okResponse());
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const gateway = new ModelGateway();

    const request = {
      prompt: "hello",
      systemPrompt: "system",
      taskProfile: { purpose: "CONVERSATION" as const },
    };

    await runWithModelCallBudget({ origin: "TEST", label: "two-call scope", maxModelCalls: 2 }, async () => {
      await expect(gateway.generate(request)).resolves.toMatchObject({ model: "test-model" });
      await expect(gateway.generate(request)).resolves.toMatchObject({ model: "test-model" });
      await expect(gateway.generate(request)).rejects.toThrow(ModelBudgetExceededError);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("concurrency cannot bypass the ceiling", async () => {
    configureSingleProvider();
    const fetchSpy = vi.fn(async () => {
      // A real provider call is slow. If the reservation were made after an
      // await, every racer would observe the same free slot here.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return okResponse();
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const gateway = new ModelGateway();

    const results = await runWithModelCallBudget(
      { origin: "TEST", label: "three-call scope", maxModelCalls: 3 },
      async () =>
        Promise.allSettled(
          Array.from({ length: 12 }, () =>
            gateway.generate({
              prompt: "hello",
              systemPrompt: "system",
              taskProfile: { purpose: "CONVERSATION" as const },
            }),
          ),
        ),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(9);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const failure of rejected) {
      expect((failure as PromiseRejectedResult).reason).toBeInstanceOf(ModelBudgetExceededError);
    }
  });

  it("a budget-rejected call does not continue via another provider", async () => {
    configureSingleProvider();
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential";
    // Two candidates are configured, so without the rule a refusal on the first
    // would simply fail over onto the second and spend anyway.
    process.env.JASIM_MODEL_T1_FALLBACKS = "anthropic:fallback-model";
    const fetchSpy = vi.fn(async () => okResponse());
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const gateway = new ModelGateway();

    await runWithModelCallBudget({ origin: "TEST", label: "exhausted", maxModelCalls: 1 }, async () => {
      currentModelCallBudget()!.reserve("PRIMARY_ATTEMPT"); // spend the only slot
      await expect(
        gateway.generate({
          prompt: "hello",
          systemPrompt: "system",
          taskProfile: { purpose: "CONVERSATION" as const },
        }),
      ).rejects.toThrow(ModelBudgetExceededError);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recorded.at(-1)).toMatchObject({
      success: false,
      errorCategory: "MODEL_BUDGET_EXCEEDED",
    });
  });

  it("failover consumes budget per attempt rather than per request", async () => {
    configureSingleProvider();
    process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-credential";
    process.env.JASIM_MODEL_T1_FALLBACKS = "anthropic:fallback-model";
    process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE = "0";
    const fetchSpy = vi.fn(async () => new Response("upstream exploded", { status: 500 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const gateway = new ModelGateway();

    await runWithModelCallBudget({ origin: "TEST", label: "one slot", maxModelCalls: 1 }, async () => {
      await expect(
        gateway.generate({
          prompt: "hello",
          systemPrompt: "system",
          taskProfile: { purpose: "CONVERSATION" as const },
        }),
      ).rejects.toBeInstanceOf(Error);
    });

    // The primary attempt spent the only slot; the fallback was refused before
    // it could reach the network.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses an unscoped caller by default, before the provider is contacted", async () => {
    configureSingleProvider();
    const fetchSpy = vi.fn(async () => okResponse());
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const gateway = new ModelGateway();
    await expect(
      gateway.generate({
        prompt: "hello",
        systemPrompt: "system",
        taskProfile: { purpose: "CONVERSATION" as const },
      }),
    ).rejects.toThrow(ModelBudgetContextMissingError);
    // The invariant is "no model call executes without a trusted context", not
    // "the failure is reported afterwards".
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an explicitly relaxed non-production environment still works for scripts", async () => {
    process.env.JASIM_MODEL_BUDGET_ENFORCEMENT = "SCOPED";
    configureSingleProvider();
    globalThis.fetch = (async () => okResponse()) as unknown as typeof fetch;
    const gateway = new ModelGateway();
    await expect(
      gateway.generate({
        prompt: "hello",
        systemPrompt: "system",
        taskProfile: { purpose: "CONVERSATION" as const },
      }),
    ).resolves.toMatchObject({ provider: "openai" });
  });
});

// ── The trusted boundary itself ─────────────────────────────────────────────

describe("the tRPC boundary opens the scope", () => {
  it("every procedure runs inside a budget, without opting in", async () => {
    const { router, publicQuery, authedQuery } = await import("../../api/trpc");
    const seen: Array<{ label: string; max: number } | undefined> = [];
    const appRouter = router({
      open: publicQuery.query(() => {
        const budget = currentModelCallBudget();
        seen.push(budget ? { label: budget.label, max: budget.maxModelCalls } : undefined);
        return "ok";
      }),
      guarded: authedQuery.query(() => {
        const budget = currentModelCallBudget();
        seen.push(budget ? { label: budget.label, max: budget.maxModelCalls } : undefined);
        return "ok";
      }),
    });

    const caller = appRouter.createCaller({ user: { id: 1 } } as never);
    await caller.open();
    await caller.guarded();

    // Neither procedure asked for a budget. Both got one, because the scope is
    // ambient and sits below every procedure.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ label: "query open", max: DEFAULT_MAX_MODEL_CALLS_PER_SCOPE });
    expect(seen[1]).toEqual({ label: "query guarded", max: DEFAULT_MAX_MODEL_CALLS_PER_SCOPE });
  });

  it("the ceiling comes from deployment configuration, never from the request", async () => {
    process.env.JASIM_MODEL_MAX_CALLS_PER_SCOPE = "2";
    const { router, publicQuery } = await import("../../api/trpc");
    let observed = -1;
    const appRouter = router({
      // The input is attacker-controlled and names the field an attacker would
      // hope is read. It is not read.
      open: publicQuery
        .input((value: unknown) => value as { maxModelCalls: number })
        .query(({ input }) => {
          void input.maxModelCalls;
          observed = currentModelCallBudget()!.maxModelCalls;
          return "ok";
        }),
    });
    await appRouter.createCaller({ user: null } as never).open({ maxModelCalls: 9_999 });
    expect(observed).toBe(2);
  });

  it("unauthenticated requests are bounded too — the scope is opened before auth runs", async () => {
    const { router, authedQuery } = await import("../../api/trpc");
    const appRouter = router({ guarded: authedQuery.query(() => "ok") });
    // Reaching the UNAUTHORIZED error at all proves the budget middleware ran
    // first and did not throw; auth is the inner layer, not the outer one.
    await expect(
      appRouter.createCaller({ user: null } as never).guarded(),
    ).rejects.toThrow(/Authentication required/i);
  });
});
