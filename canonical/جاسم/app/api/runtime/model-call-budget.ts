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

export class ModelCallBudgetScopeMissingError extends Error {
  readonly code = "MODEL_BUDGET_SCOPE_MISSING";

  constructor(message: string) {
    super(message);
    this.name = "ModelCallBudgetScopeMissingError";
  }
}

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
    throw new ModelCallBudgetScopeMissingError(
      `JASIM_MODEL_MAX_CALLS_PER_SCOPE must be a non-negative integer; received "${raw}".`,
    );
  }
  return parsed;
}

/**
 * `SCOPED` (default) enforces the ceiling wherever a scope is open and lets
 * unscoped code through — that is what tests, migrations and one-off scripts
 * need. `STRICT` refuses to invoke a model at all outside a scope, so a
 * deployment can prove that no production path reaches a provider unbounded.
 */
export type ModelCallBudgetEnforcement = "SCOPED" | "STRICT";

export function configuredEnforcement(): ModelCallBudgetEnforcement {
  return process.env.JASIM_MODEL_BUDGET_ENFORCEMENT?.trim().toUpperCase() === "STRICT"
    ? "STRICT"
    : "SCOPED";
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
    throw new ModelCallBudgetScopeMissingError(
      "MODEL_BUDGET_SCOPE_MISSING: JASIM_MODEL_BUDGET_ENFORCEMENT=STRICT forbids invoking a " +
        "model outside a server-established call budget scope.",
    );
  }
  return undefined;
}
