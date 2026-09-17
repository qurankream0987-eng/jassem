/**
 * JASIM — Model cost estimation and budget ceiling.
 *
 * These tests exist to protect three JASIM invariants, not merely the
 * arithmetic:
 *
 *   1. Unknown cost is `undefined`, never `0`. A zero would assert the call was
 *      free — a fabricated truth, which JASIM forbids everywhere else.
 *   2. Estimation never under-reports. A ceiling that under-estimates gives the
 *      operator false confidence, which is worse than having no ceiling.
 *   3. Operational model cost is telemetry, never financial truth, and the
 *      ceiling is opt-in so it cannot silently change existing behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ModelPriceConfigError,
  estimateModelCost,
  estimateWorstCaseModelCost,
  evaluateCostCeiling,
  loadModelPriceTable,
  resetModelPriceTableCache,
  resolveModelPrice,
} from "../../api/runtime/model-cost";

const ORIGINAL = process.env.JASIM_MODEL_PRICES;

function setPrices(table: unknown): void {
  process.env.JASIM_MODEL_PRICES = JSON.stringify(table);
  resetModelPriceTableCache();
}

beforeEach(() => {
  delete process.env.JASIM_MODEL_PRICES;
  resetModelPriceTableCache();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.JASIM_MODEL_PRICES;
  else process.env.JASIM_MODEL_PRICES = ORIGINAL;
  resetModelPriceTableCache();
});

describe("price table configuration", () => {
  it("treats an absent variable as 'no prices configured', not an error", () => {
    expect(loadModelPriceTable()).toEqual({});
  });

  it("rejects malformed JSON instead of silently disabling the ceiling", () => {
    process.env.JASIM_MODEL_PRICES = "{not json";
    resetModelPriceTableCache();
    expect(() => loadModelPriceTable()).toThrow(ModelPriceConfigError);
  });

  it("rejects a structurally invalid table", () => {
    setPrices({ "openai/gpt-x": { inputPerMillion: "free" } });
    expect(() => loadModelPriceTable()).toThrow(ModelPriceConfigError);
  });

  it("rejects a negative rate", () => {
    setPrices({ "openai/gpt-x": { inputPerMillion: -1, outputPerMillion: 1 } });
    expect(() => loadModelPriceTable()).toThrow(ModelPriceConfigError);
  });

  it("prefers an exact model rate over the provider wildcard", () => {
    setPrices({
      "openai/*": { inputPerMillion: 10, outputPerMillion: 20 },
      "openai/gpt-x": { inputPerMillion: 1, outputPerMillion: 2 },
    });
    expect(resolveModelPrice("openai", "gpt-x")).toMatchObject({
      source: "EXACT",
      key: "openai/gpt-x",
    });
    expect(resolveModelPrice("openai", "gpt-other")).toMatchObject({
      source: "PROVIDER_DEFAULT",
      key: "openai/*",
    });
  });

  it("re-reads the environment when configuration changes", () => {
    setPrices({ "openai/gpt-x": { inputPerMillion: 1, outputPerMillion: 2 } });
    expect(resolveModelPrice("openai", "gpt-x").price?.inputPerMillion).toBe(1);
    setPrices({ "openai/gpt-x": { inputPerMillion: 5, outputPerMillion: 2 } });
    expect(resolveModelPrice("openai", "gpt-x").price?.inputPerMillion).toBe(5);
  });
});

describe("unknown cost is never zero", () => {
  it("returns PRICE_UNCONFIGURED with no amount when the model has no rate", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 1_000,
      outputTokens: 1_000,
    });
    expect(estimate.source).toBe("PRICE_UNCONFIGURED");
    expect(estimate.amount).toBeUndefined();
    expect(estimate.amount).not.toBe(0);
  });

  it("returns TOKENS_UNKNOWN when the provider reported no usage at all", () => {
    setPrices({ "openai/gpt-x": { inputPerMillion: 1, outputPerMillion: 2 } });
    const estimate = estimateModelCost({ provider: "openai", model: "gpt-x" });
    expect(estimate.source).toBe("TOKENS_UNKNOWN");
    expect(estimate.amount).toBeUndefined();
  });

  it("still prices a call when only one side of usage was reported", () => {
    setPrices({ "openai/gpt-x": { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 } });
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      outputTokens: 3,
    });
    expect(estimate.amount).toBeCloseTo(6, 10);
  });
});

describe("estimation arithmetic", () => {
  beforeEach(() => {
    // 1 unit per token on input, 2 per token on output, for readable assertions.
    setPrices({
      "openai/gpt-x": { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 },
    });
  });

  it("prices uncached input and completion output", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(estimate.amount).toBeCloseTo(10 * 1 + 5 * 2, 10);
    expect(estimate.currency).toBe("USD");
  });

  it("does not double-count cached input, which is a SUBSET of input", () => {
    setPrices({
      "openai/gpt-x": {
        inputPerMillion: 1_000_000,
        outputPerMillion: 2_000_000,
        cachedInputPerMillion: 100_000, // one tenth
      },
    });
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 0,
    });
    // 60 uncached at 1 + 40 cached at 0.1 — NOT 100 at 1 plus 40 at 0.1.
    expect(estimate.amount).toBeCloseTo(60 * 1 + 40 * 0.1, 10);
  });

  it("does not double-count reasoning tokens, which are a SUBSET of output", () => {
    setPrices({
      "openai/gpt-x": {
        inputPerMillion: 1_000_000,
        outputPerMillion: 2_000_000,
        reasoningPerMillion: 4_000_000,
      },
    });
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 30,
    });
    // 70 completion at 2 + 30 reasoning at 4.
    expect(estimate.amount).toBeCloseTo(70 * 2 + 30 * 4, 10);
  });

  it("bills cached input at the FULL input rate when no cache rate is configured", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 100,
      cachedInputTokens: 100,
      outputTokens: 0,
    });
    // Conservative: assuming an unstated discount would under-report.
    expect(estimate.amount).toBeCloseTo(100, 10);
  });

  it("bills reasoning at the output rate when no reasoning rate is configured", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 0,
      outputTokens: 50,
      reasoningTokens: 50,
    });
    expect(estimate.amount).toBeCloseTo(50 * 2, 10);
  });

  it("clamps a subset that exceeds its parent rather than producing a negative", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 10,
      cachedInputTokens: 999,
      outputTokens: 0,
    });
    expect(estimate.amount).toBeGreaterThanOrEqual(0);
    expect(estimate.amount).toBeCloseTo(10, 10);
  });

  it("ignores nonsensical negative token counts instead of subtracting cost", () => {
    const estimate = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 10,
      cachedInputTokens: -100,
      outputTokens: 0,
    });
    expect(estimate.amount).toBeCloseTo(10, 10);
  });
});

describe("worst-case projection", () => {
  it("prices every allowed token at the full rate", () => {
    setPrices({
      "openai/gpt-x": { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 },
    });
    const estimate = estimateWorstCaseModelCost({
      provider: "openai",
      model: "gpt-x",
      maxInputTokens: 1_000,
      maxOutputTokens: 100,
    });
    expect(estimate.amount).toBeCloseTo(1_000 * 1 + 100 * 2, 10);
  });

  it("never under-estimates the actual cost of a call within the same limits", () => {
    setPrices({
      "openai/gpt-x": {
        inputPerMillion: 1_000_000,
        outputPerMillion: 2_000_000,
        cachedInputPerMillion: 1,
      },
    });
    const worst = estimateWorstCaseModelCost({
      provider: "openai",
      model: "gpt-x",
      maxInputTokens: 1_000,
      maxOutputTokens: 100,
    });
    const actual = estimateModelCost({
      provider: "openai",
      model: "gpt-x",
      inputTokens: 1_000,
      cachedInputTokens: 500,
      outputTokens: 100,
      reasoningTokens: 20,
    });
    expect(worst.amount!).toBeGreaterThanOrEqual(actual.amount!);
  });
});

describe("budget ceiling", () => {
  beforeEach(() => {
    setPrices({
      "openai/cheap": { inputPerMillion: 1_000, outputPerMillion: 1_000 },
      "openai/expensive": { inputPerMillion: 5_000_000, outputPerMillion: 5_000_000 },
    });
  });

  const projection = { maxInputTokens: 1_000, maxOutputTokens: 1_000 };

  it("is opt-in: with no ceiling the call always proceeds", () => {
    const decision = evaluateCostCeiling({
      provider: "openai",
      model: "expensive",
      ...projection,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("NO_CEILING");
  });

  it("blocks a projected call above the ceiling", () => {
    const decision = evaluateCostCeiling({
      provider: "openai",
      model: "expensive",
      ...projection,
      maxEstimatedCost: 1,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CEILING_EXCEEDED");
    expect(decision.estimate.amount).toBeGreaterThan(1);
  });

  it("allows a projected call within the ceiling", () => {
    const decision = evaluateCostCeiling({
      provider: "openai",
      model: "cheap",
      ...projection,
      maxEstimatedCost: 1_000,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("WITHIN_CEILING");
  });

  it("allows, and reports, an unknown cost rather than halting the runtime", () => {
    // Blocking here would turn a missing price table into "JASIM stopped
    // thinking". The unknown is surfaced instead of hidden.
    const decision = evaluateCostCeiling({
      provider: "openai",
      model: "unpriced",
      ...projection,
      maxEstimatedCost: 0.000001,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("COST_UNKNOWN");
    expect(decision.estimate.amount).toBeUndefined();
  });

  it("treats a ceiling of exactly the projected cost as allowed", () => {
    const exact = estimateWorstCaseModelCost({
      provider: "openai",
      model: "cheap",
      ...projection,
    });
    const decision = evaluateCostCeiling({
      provider: "openai",
      model: "cheap",
      ...projection,
      maxEstimatedCost: exact.amount!,
    });
    expect(decision.allowed).toBe(true);
  });

  it("blocks when a zero ceiling meets a priced call", () => {
    const decision = evaluateCostCeiling({
      provider: "openai",
      model: "cheap",
      ...projection,
      maxEstimatedCost: 0,
    });
    expect(decision.allowed).toBe(false);
  });
});
