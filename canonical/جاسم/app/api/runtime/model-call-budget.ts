import { AsyncLocalStorage } from "node:async_hooks";
import { ModelBudgetExceededError } from "./model-cost";

/**
 * JASIM — Model call budget scope.
 *
 * WHY THIS IS NOT A PARAMETER.
 *
 * `ModelBudget.maxModelCalls` has existed in `model-policy.ts` since Phase 12
 * and has never been enforced. The obvious fix — check it inside
 * `ModelGateway.generate()` against the request's own budget — does not work and
 * is not safe:
 *
 *   1. The request's budget is supplied by the caller of `generate()`. A limit a
 *      caller can raise per call is not a limit; it is a suggestion. The ceiling
 *      has to be established *above* the code being limited.
 *   2. `maxModelCalls` defaults to 1. Enforced per request it would cap every
 *      request at one provider attempt, silently disabling tier fallback — a
 *      limit that breaks failover is worse than no limit.
 *   3. The thing worth bounding is not one `generate()` call. It is the total
 *      model spend of one unit of server work: one tRPC request, one durable
 *      job. A planner that loops can issue fifty `generate()` calls each of
 *      which individually respects its own budget.
 *
 * So the budget lives in an ambient, server-established scope. It is opened at a
 * trusted boundary the client never reaches (see `api/trpc.ts` and
 * `api/core/durable-job-worker.ts`), it is carried across `await` by
 * `AsyncLocalStorage`, and nothing inside the scope — not a caller, not a
 * planner, not model output — can widen it. `reserve()` is the only way to get a
 * slot and there is no `release()`: a spent attempt stays spent.
 *
 * CONCURRENCY. Reservation is deliberately synchronous, with no `await` between
 * reading `reserved` and incrementing it. On Node's single-threaded event loop
 * that makes the read-modify-write atomic, so N concurrent callers racing for
 * the last slot produce exactly one winner. A check that awaited anything before
 * incrementing would let every racer observe the same free slot.
 */

export type ModelCallBudgetOrigin =
  | "TRPC_REQUEST"
  | "DURABLE_JOB"
  | "BACKGROUND_TASK"
  | "TEST";

export type ModelCallBudgetSnapshot = {
  origin: ModelCallBudgetOrigin;
  label: string;
  maxModelCalls: number;
  /** Attempts already committed. Never decreases. */
  reserved: number;
  remaining: number;
};

/** Reasons a slot was taken, for the report a rejected scope can render. */
export type ModelCallReason =
  | "PRIMARY_ATTEMPT"
  | "FALLBACK_ATTEMPT"
  | "RETRY_ATTEMPT";

export class ModelBudgetContextMissingError extends Error {
  readonly code = "MODEL_BUDGET_CONTEXT_MISSING";

  constructor(message: string) {
    super(message);
    this.name = "ModelBudgetContextMissingError";
  }
}

/** Kept so existing importers and `instanceof` checks continue to resolve. */
export { ModelBudgetContextMissingError as ModelCallBudgetScopeMissingError };

/**
 * Default ceiling for one unit of server work. Chosen to be comfortably above
 * what any current JASIM path needs (the longest is one routing call plus tier
 * fallbacks) and far below a runaway loop. Deployments override it with
 * `JASIM_MODEL_MAX_CALLS_PER_SCOPE`.
 */
export const DEFAULT_MAX_MODEL_CALLS_PER_SCOPE = 8;

export function configuredMaxModelCalls(): number {
  const raw = process.env.JASIM_MODEL_MAX_CALLS_PER_SCOPE?.trim();
  if (!raw) return DEFAULT_MAX_MODEL_CALLS_PER_SCOPE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ModelBudgetConfigurationError(
      `JASIM_MODEL_MAX_CALLS_PER_SCOPE must be a non-negative integer; received "${raw}".`,
    );
  }
  return parsed;
}

/**
 * Enforcement mode.
 *
 * `STRICT` refuses to invoke a model at all without a trusted budget context.
 * `SCOPED` enforces the ceiling wherever a context is open and lets unscoped
 * code through.
 *
 * WHY THE DEFAULT IS STRICT, AND WHY PRODUCTION CANNOT LEAVE IT.
 *
 * Wave 2 shipped `SCOPED` as the default and named the consequence as the first
 * thing a reviewer should doubt: the whole control rests on `AsyncLocalStorage`
 * carrying the context, and any boundary that loses the context turns a bounded
 * call into an unbounded one — silently, because an absent context and a
 * generous one look identical at the call site.
 *
 * "Set the environment variable correctly" is not a safety property. An
 * unset variable, a typo, a container that drops the environment, a new
 * deployment target nobody remembered to configure — each of them silently
 * selects the unsafe mode, and the failure only shows up as a bill. So:
 *
 *   - Fail-closed is the DEFAULT, not an opt-in. An unset variable is strict.
 *   - Production IGNORES the variable entirely. There is no value anyone can
 *     set, by accident or on purpose, that makes a production deployment
 *     execute a model call outside a budget context.
 *   - Relaxing it requires an explicit `SCOPED` AND a non-production
 *     environment. Development and test can opt out deliberately; neither can
 *     leak that choice into production, because production does not read it.
 */
export type ModelCallBudgetEnforcement = "SCOPED" | "STRICT";

export class ModelBudgetConfigurationError extends Error {
  readonly code = "MODEL_BUDGET_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ModelBudgetConfigurationError";
  }
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function configuredEnforcement(): ModelCallBudgetEnforcement {
  if (isProductionRuntime()) return "STRICT";
  return process.env.JASIM_MODEL_BUDGET_ENFORCEMENT?.trim().toUpperCase() === "SCOPED"
    ? "SCOPED"
    : "STRICT";
}

export class ModelCallBudget {
  readonly origin: ModelCallBudgetOrigin;
  readonly label: string;
  readonly maxModelCalls: number;
  private reserved = 0;

  constructor(input: {
    origin: ModelCallBudgetOrigin;
    label: string;
    maxModelCalls?: number;
  }) {
    this.origin = input.origin;
    this.label = input.label;
    const requested = input.maxModelCalls ?? configuredMaxModelCalls();
    // A nested scope can only ever narrow. There is no path that widens.
    this.maxModelCalls = Math.max(0, Math.min(requested, configuredMaxModelCalls()));
  }

  snapshot(): ModelCallBudgetSnapshot {
    return {
      origin: this.origin,
      label: this.label,
      maxModelCalls: this.maxModelCalls,
      reserved: this.reserved,
      remaining: Math.max(0, this.maxModelCalls - this.reserved),
    };
  }

  /**
   * Commit one provider attempt. Synchronous and irreversible by design: see the
   * concurrency note at the top of this file.
   */
  reserve(reason: ModelCallReason): ModelCallBudgetSnapshot {
    if (this.reserved >= this.maxModelCalls) {
      throw new ModelBudgetExceededError(
        `MODEL_BUDGET_EXCEEDED: ${this.label} has already used its ` +
          `${this.maxModelCalls} permitted model call(s); ${reason} was refused.`,
      );
    }
    this.reserved += 1;
    return this.snapshot();
  }
}

const storage = new AsyncLocalStorage<ModelCallBudget>();

export function currentModelCallBudget(): ModelCallBudget | undefined {
  return storage.getStore();
}

/** Runs `fn` inside a fresh budget scope. Scopes nest; an inner one cannot widen. */
export function runWithModelCallBudget<T>(
  input: { origin: ModelCallBudgetOrigin; label: string; maxModelCalls?: number },
  fn: () => Promise<T>,
): Promise<T> {
  const outer = storage.getStore();
  const requested = input.maxModelCalls;
  const bounded =
    outer === undefined
      ? requested
      : Math.min(requested ?? outer.maxModelCalls, outer.snapshot().remaining);
  return storage.run(new ModelCallBudget({ ...input, maxModelCalls: bounded }), fn);
}

/**
 * The single enforcement point. Every provider attempt in the gateway passes
 * through here before any network call, so a refusal happens before spend rather
 * than after it — and, critically, before failover, so a refused call cannot be
 * retried "through another provider".
 */
export function reserveModelCall(reason: ModelCallReason): ModelCallBudgetSnapshot | undefined {
  const budget = storage.getStore();
  if (budget) return budget.reserve(reason);
  if (configuredEnforcement() === "STRICT") {
    throw new ModelBudgetContextMissingError(
      "MODEL_BUDGET_CONTEXT_MISSING: a model call was attempted outside a trusted budget " +
        "context. Every model call must run inside one — see `runWithModelCallBudget` and the " +
        "boundaries in api/trpc.ts and api/core/durable-job-worker.ts. The provider was not " +
        "contacted.",
    );
  }
  return undefined;
}

// ── The explicit contract (Part 3) ──────────────────────────────────────────

/**
 * `ModelExecutionContext` is the same object `AsyncLocalStorage` transports,
 * named as what it is so that critical code can be reasoned about without
 * knowing how it travels.
 *
 * The distinction matters. ALS is a *transport*: it answers "how does this
 * reach the gateway three call frames down without threading a parameter
 * through code that does not care about budgets". It is not, and must not be,
 * where the safety rule lives. A rule that exists only as "there is probably
 * something in the async store" is invisible at every site that depends on it.
 *
 * THE OWNERSHIP RULES, stated once, in one place:
 *
 *   WHO CREATES IT   Only a trusted server boundary: the tRPC base procedure
 *                    (`api/trpc.ts`) and the durable job worker
 *                    (`api/core/durable-job-worker.ts`). A boundary is trusted
 *                    because no client input reaches its arguments — the limit
 *                    comes from deployment configuration, never a request.
 *
 *   WHO MAY NARROW   Anyone, by nesting `runWithModelCallBudget`. A nested
 *                    context is clamped to the parent's REMAINING slots, so
 *                    narrowing is always real and never a reset.
 *
 *   WHO MAY WIDEN    Nobody. There is no API that raises a ceiling, and the
 *                    constructor clamps against the deployment maximum, so even
 *                    a fresh top-level context cannot exceed it.
 *
 *   WHO CONSUMES     Only `ModelGateway.generate()`, through
 *                    `reserveModelCall()`, once per provider attempt —
 *                    primary, fallback and retry alike, always before the
 *                    network call.
 *
 *   WHO MAY RELEASE  Nobody. There is no `release()`. A spent attempt stays
 *                    spent, because the money is spent whether or not the
 *                    response was useful.
 *
 *   NESTING          Inner contexts inherit `min(requested, parent.remaining)`.
 *                    Spending in a child does not refund the parent, and the
 *                    parent's own ceiling still bounds the total.
 */
export type ModelExecutionContext = ModelCallBudget;

/**
 * The trusted accessor. Use this wherever code genuinely requires a budget to
 * exist, rather than reading `currentModelCallBudget()` and branching on
 * `undefined` — a branch on `undefined` is exactly how "no context" quietly
 * becomes "no limit".
 */
export function requireModelExecutionContext(purpose: string): ModelExecutionContext {
  const context = storage.getStore();
  if (!context) {
    throw new ModelBudgetContextMissingError(
      `MODEL_BUDGET_CONTEXT_MISSING: ${purpose} requires a trusted budget context and none is ` +
        "open. The operation was not performed.",
    );
  }
  return context;
}

/**
 * Re-establishes a context across a boundary that `AsyncLocalStorage` cannot
 * cross on its own — a worker thread, a child process, a scheduler that stores
 * callbacks and invokes them from its own root context.
 *
 * It takes a SNAPSHOT, not the live object, and deliberately reconstructs a
 * *fresh* context bounded by what was left. Sharing the live object across a
 * process boundary would be a lie: two isolates cannot share one counter, and a
 * counter that is not shared is not a ceiling. Reconstructing from the
 * remaining allowance is conservative — the far side can never have more than
 * the near side had left at the moment it crossed.
 */
export function runWithReestablishedModelBudget<T>(
  snapshot: Pick<ModelCallBudgetSnapshot, "origin" | "label" | "remaining">,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(
    new ModelCallBudget({
      origin: snapshot.origin,
      label: `${snapshot.label} (re-established)`,
      maxModelCalls: snapshot.remaining,
    }),
    fn,
  );
}
