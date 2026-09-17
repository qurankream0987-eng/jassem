import { z } from "zod";

/**
 * JASIM — Model cost estimation.
 *
 * OPERATIONAL TELEMETRY, NOT FINANCIAL TRUTH.
 *
 * What a model invocation costs JASIM to operate is a cost of running the
 * intelligence, not money moving between a customer and a seller. It informs
 * unit economics; it must never enter `economic_ledger_entries`, never become a
 * `payment_intent`, and never be presented to a user as an amount they owe.
 * Block 3 money is exact minor-unit integers precisely because it is
 * authoritative; these numbers are estimates and are stored as floating point in
 * the `model_usage_ledger.estimatedCost` column that already exists for them.
 *
 * TRUTHFULNESS RULES (the reason this file is not three lines long):
 *
 *   1. An unconfigured price yields `undefined`, never `0`. A zero cost is a
 *      claim that the call was free, and that claim would be false. "We do not
 *      know what this cost" is a legitimate, renderable state.
 *   2. Missing token counts yield `undefined` for the same reason. A provider
 *      that did not report usage has not told us the call was cheap.
 *   3. Where a rate is unknown but a related rate is known, estimation is
 *      deliberately CONSERVATIVE (never under-reports). A budget guard that
 *      under-estimates is worse than no guard at all.
 *
 * PROVIDER NEUTRALITY: no vendor price is hardcoded. Prices change, and a stale
 * hardcoded table becomes a confident lie. Rates are supplied by deployment
 * configuration through `JASIM_MODEL_PRICES`, keyed by `provider/model` with an
 * optional `provider/*` fallback.
 */

// ── Price table ─────────────────────────────────────────────────────────────

export const ModelPriceSchema = z.object({
  /** Cost per 1,000,000 uncached input tokens. */
  inputPerMillion: z.number().nonnegative(),
  /** Cost per 1,000,000 output tokens. */
  outputPerMillion: z.number().nonnegative(),
  /**
   * Cost per 1,000,000 cached input tokens. When absent, cached input is billed
   * at the full input rate — conservative, because assuming a discount we were
   * not told about would under-report the cost.
   */
  cachedInputPerMillion: z.number().nonnegative().optional(),
  /**
   * Cost per 1,000,000 reasoning tokens. When absent, reasoning tokens are
   * billed at the output rate, which is how providers that do not separate them
   * already charge.
   */
  reasoningPerMillion: z.number().nonnegative().optional(),
  /** ISO-4217 code. Purely descriptive: JASIM never converts between currencies here. */
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
});

export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const ModelPriceTableSchema = z.record(z.string().trim().min(1), ModelPriceSchema);
export type ModelPriceTable = z.infer<typeof ModelPriceTableSchema>;

export class ModelPriceConfigError extends Error {
  readonly code = "MODEL_PRICE_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ModelPriceConfigError";
  }
}

export class ModelBudgetExceededError extends Error {
  readonly code = "MODEL_BUDGET_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "ModelBudgetExceededError";
  }
}

let cachedTable: { raw: string | undefined; table: ModelPriceTable } | undefined;

/**
 * Parses `JASIM_MODEL_PRICES` into a validated price table.
 *
 * An absent variable is normal and means "no prices configured" — not an error.
 * A malformed variable IS an error: silently ignoring it would leave operators
 * believing a budget ceiling is protecting them when nothing is.
 */
export function loadModelPriceTable(): ModelPriceTable {
  const raw = process.env.JASIM_MODEL_PRICES?.trim() || undefined;
  if (cachedTable && cachedTable.raw === raw) return cachedTable.table;
  if (!raw) {
    cachedTable = { raw, table: {} };
    return cachedTable.table;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ModelPriceConfigError(
      "JASIM_MODEL_PRICES is not valid JSON. Expected {\"provider/model\":{\"inputPerMillion\":n,\"outputPerMillion\":n}}.",
    );
  }
  const result = ModelPriceTableSchema.safeParse(parsed);
  if (!result.success) {
    throw new ModelPriceConfigError(
      `JASIM_MODEL_PRICES is structurally invalid: ${result.error.issues[0]?.message ?? "unknown issue"}.`,
    );
  }
  cachedTable = { raw, table: result.data };
  return result.data;
}

/** Test support: forces the next lookup to re-read the environment. */
export function resetModelPriceTableCache(): void {
  cachedTable = undefined;
}

export type PriceResolution =
  | { price: ModelPrice; source: "EXACT" | "PROVIDER_DEFAULT"; key: string }
  | { price: undefined; source: "PRICE_UNCONFIGURED"; key: undefined };

/**
 * Resolves the rate for one provider/model pair.
 *
 * Exact `provider/model` wins over the `provider/*` fallback, so a deployment
 * can price its common models precisely and still bound the unknown ones.
 */
export function resolveModelPrice(provider: string, model: string): PriceResolution {
  const table = loadModelPriceTable();
  const exactKey = `${provider}/${model}`;
  const exact = table[exactKey];
  if (exact) return { price: exact, source: "EXACT", key: exactKey };
  const wildcardKey = `${provider}/*`;
  const wildcard = table[wildcardKey];
  if (wildcard) return { price: wildcard, source: "PROVIDER_DEFAULT", key: wildcardKey };
  return { price: undefined, source: "PRICE_UNCONFIGURED", key: undefined };
}

// ── Estimation ──────────────────────────────────────────────────────────────

export type ModelCostInput = {
  provider: string;
  model: string;
  inputTokens?: number;
  /** Subset of `inputTokens` served from the provider's cache. */
  cachedInputTokens?: number;
  outputTokens?: number;
  /** Subset of `outputTokens` spent on reasoning, where the provider reports it. */
  reasoningTokens?: number;
};

export type ModelCostEstimate = {
  /** Undefined whenever the answer is genuinely unknown. Never defaulted to 0. */
  amount?: number;
  currency?: string;
  source: "EXACT" | "PROVIDER_DEFAULT" | "PRICE_UNCONFIGURED" | "TOKENS_UNKNOWN";
};

const PER_MILLION = 1_000_000;

function nonNegative(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Estimates the cost of one completed model call from its reported usage.
 *
 * Token-subset handling is the subtle part. Providers report `cachedInputTokens`
 * as a SUBSET of `inputTokens`, and `reasoningTokens` as a SUBSET of
 * `outputTokens`. Billing both totals at their own rate would double-count, so
 * each subset is removed from its parent before the parent is priced.
 */
export function estimateModelCost(input: ModelCostInput): ModelCostEstimate {
  const resolution = resolveModelPrice(input.provider, input.model);
  if (!resolution.price) return { source: "PRICE_UNCONFIGURED" };

  const inputTokens = nonNegative(input.inputTokens);
  const outputTokens = nonNegative(input.outputTokens);
  // A provider that reported neither side told us nothing about the size of the
  // call, so the honest estimate is "unknown" rather than a partial number.
  if (inputTokens === undefined && outputTokens === undefined) {
    return { source: "TOKENS_UNKNOWN" };
  }

  const price = resolution.price;
  let amount = 0;

  if (inputTokens !== undefined) {
    const cached = Math.min(nonNegative(input.cachedInputTokens) ?? 0, inputTokens);
    const uncached = inputTokens - cached;
    // No configured cache rate means we assume no discount, never a free ride.
    const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;
    amount += (uncached * price.inputPerMillion) / PER_MILLION;
    amount += (cached * cachedRate) / PER_MILLION;
  }

  if (outputTokens !== undefined) {
    const reasoning = Math.min(nonNegative(input.reasoningTokens) ?? 0, outputTokens);
    const completion = outputTokens - reasoning;
    const reasoningRate = price.reasoningPerMillion ?? price.outputPerMillion;
    amount += (completion * price.outputPerMillion) / PER_MILLION;
    amount += (reasoning * reasoningRate) / PER_MILLION;
  }

  return { amount, currency: price.currency, source: resolution.source };
}

/**
 * Worst-case cost of a call that has NOT happened yet, used by the pre-flight
 * budget guard.
 *
 * It assumes every allowed token is spent at the full uncached/completion rate.
 * That is intentional: a ceiling that only catches average cases is not a
 * ceiling. An unconfigured price yields `undefined`, and the caller must decide
 * what an unknown cost means rather than being handed a fabricated zero.
 */
export function estimateWorstCaseModelCost(input: {
  provider: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
}): ModelCostEstimate {
  const resolution = resolveModelPrice(input.provider, input.model);
  if (!resolution.price) return { source: "PRICE_UNCONFIGURED" };
  const maxInput = nonNegative(input.maxInputTokens) ?? 0;
  const maxOutput = nonNegative(input.maxOutputTokens) ?? 0;
  const price = resolution.price;
  const amount =
    (maxInput * price.inputPerMillion) / PER_MILLION +
    (maxOutput * price.outputPerMillion) / PER_MILLION;
  return { amount, currency: price.currency, source: resolution.source };
}

// ── Budget guard ────────────────────────────────────────────────────────────

export type CostCeilingDecision =
  | { allowed: true; reason: "WITHIN_CEILING" | "NO_CEILING" | "COST_UNKNOWN"; estimate: ModelCostEstimate }
  | { allowed: false; reason: "CEILING_EXCEEDED"; estimate: ModelCostEstimate };

/**
 * Decides whether a projected call may proceed under `budget.maxEstimatedCost`.
 *
 * When no ceiling is configured the call proceeds — this guard is opt-in, so it
 * cannot change the behavior of callers that never set a budget.
 *
 * When a ceiling IS configured but the price is not, the call proceeds and the
 * decision is reported as `COST_UNKNOWN`. Blocking here would turn "we forgot to
 * configure prices" into "JASIM stopped thinking", which is a far worse failure
 * than an unmetered call. The unknown is surfaced, not hidden.
 */
export function evaluateCostCeiling(input: {
  provider: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCost?: number;
}): CostCeilingDecision {
  const estimate = estimateWorstCaseModelCost(input);
  if (input.maxEstimatedCost === undefined) {
    return { allowed: true, reason: "NO_CEILING", estimate };
  }
  if (estimate.amount === undefined) {
    return { allowed: true, reason: "COST_UNKNOWN", estimate };
  }
  if (estimate.amount > input.maxEstimatedCost) {
    return { allowed: false, reason: "CEILING_EXCEEDED", estimate };
  }
  return { allowed: true, reason: "WITHIN_CEILING", estimate };
}
