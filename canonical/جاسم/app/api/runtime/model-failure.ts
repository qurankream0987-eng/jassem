import {
  ModelGatewayOutputError,
  ModelGatewayPolicyError,
  ModelGatewayUnavailableError,
} from "./model-gateway-errors";
import { ModelBudgetExceededError } from "./model-cost";
import { ModelBudgetContextMissingError } from "./model-call-budget";
import { ModelContextTooLargeError } from "./model-context-budget";
import { ModelOutputAuthorityError, ModelPromptFenceError } from "./model-output-trust";

/**
 * JASIM — Normalized model failure taxonomy.
 *
 * Four providers, four error shapes, and the JASIM-side guards on top of them.
 * Without a normalizer every caller ends up string-matching vendor prose, which
 * breaks the first time a provider rewrites a message.
 *
 * The taxonomy answers two questions that are NOT the same question, and
 * conflating them is how a gateway turns one failure into four bills:
 *
 *   `retryable`     — would the identical request to the identical model
 *                     plausibly succeed a moment later? Only transport,
 *                     rate-limit, timeout and malformed-output failures qualify.
 *   `allowFailover` — would a *different* model plausibly succeed? A missing
 *                     credential for provider A says nothing about provider B,
 *                     so that fails over without being retryable.
 *
 * A budget refusal is neither. That is the whole point of a budget: "you have
 * spent your allowance" must never be answered by spending more, whether on the
 * same model or a cheaper one. `MODEL_CONTEXT_TOO_LARGE` is likewise neither —
 * the same oversized prompt fails everywhere, and the fix is to reduce it.
 */

export type ModelFailureCategory =
  | "MODEL_BUDGET_EXCEEDED"
  | "MODEL_BUDGET_CONTEXT_MISSING"
  | "MODEL_CONTEXT_TOO_LARGE"
  | "MODEL_POLICY_REJECTED"
  | "MODEL_OUTPUT_AUTHORITY_REJECTED"
  | "MODEL_PROMPT_FENCE_COLLISION"
  | "MODEL_GATEWAY_INVALID_OUTPUT"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_MODEL_NOT_FOUND"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE";

export type NormalizedModelFailure = {
  category: ModelFailureCategory;
  retryable: boolean;
  allowFailover: boolean;
  /** Provider-advertised backoff, when one was given. */
  retryAfterMs?: number;
  /** Safe to log and to store in the usage ledger: never contains prompt text. */
  message: string;
};

function fromHttpStatus(status: number): {
  category: ModelFailureCategory;
  retryable: boolean;
  allowFailover: boolean;
} {
  if (status === 401 || status === 403) {
    // A bad key is a deployment fact, not a transient one. Another provider may
    // still be configured correctly, so failover is allowed and retry is not.
    return { category: "PROVIDER_AUTH_FAILED", retryable: false, allowFailover: true };
  }
  if (status === 404) {
    return { category: "PROVIDER_MODEL_NOT_FOUND", retryable: false, allowFailover: true };
  }
  if (status === 408 || status === 504) {
    return { category: "PROVIDER_TIMEOUT", retryable: true, allowFailover: true };
  }
  if (status === 429) {
    return { category: "PROVIDER_RATE_LIMITED", retryable: true, allowFailover: true };
  }
  if (status === 413 || status === 422) {
    // The provider itself judged the request too large or unprocessable. Sending
    // it again unchanged is spend without hope.
    return { category: "MODEL_CONTEXT_TOO_LARGE", retryable: false, allowFailover: false };
  }
  if (status >= 500) {
    return { category: "PROVIDER_UNAVAILABLE", retryable: true, allowFailover: true };
  }
  return { category: "PROVIDER_UNAVAILABLE", retryable: false, allowFailover: true };
}

export function normalizeModelFailure(error: unknown): NormalizedModelFailure {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof ModelBudgetExceededError) {
    return {
      category: "MODEL_BUDGET_EXCEEDED",
      retryable: false,
      allowFailover: false,
      message,
    };
  }
  if (error instanceof ModelBudgetContextMissingError) {
    return {
      category: "MODEL_BUDGET_CONTEXT_MISSING",
      retryable: false,
      allowFailover: false,
      message,
    };
  }
  if (error instanceof ModelContextTooLargeError) {
    return {
      category: "MODEL_CONTEXT_TOO_LARGE",
      retryable: false,
      allowFailover: false,
      message,
    };
  }
  if (error instanceof ModelGatewayPolicyError) {
    return { category: "MODEL_POLICY_REJECTED", retryable: false, allowFailover: false, message };
  }
  if (error instanceof ModelOutputAuthorityError) {
    // Deliberately terminal. A model that tried to assert `paid: true` may well
    // produce clean JSON on a second attempt, and that is exactly why retrying
    // is wrong: it would turn a visible security event into an invisible one.
    return {
      category: "MODEL_OUTPUT_AUTHORITY_REJECTED",
      retryable: false,
      allowFailover: false,
      message,
    };
  }
  if (error instanceof ModelPromptFenceError) {
    return {
      category: "MODEL_PROMPT_FENCE_COLLISION",
      retryable: false,
      allowFailover: false,
      message,
    };
  }
  if (error instanceof ModelGatewayOutputError) {
    // Empty or unparseable output is the one genuinely stochastic failure: the
    // same request at the same temperature can succeed next time.
    return {
      category: "MODEL_GATEWAY_INVALID_OUTPUT",
      retryable: true,
      allowFailover: true,
      message,
    };
  }
  if (error instanceof ModelGatewayUnavailableError) {
    if (typeof error.status === "number") {
      const mapped = fromHttpStatus(error.status);
      return { ...mapped, retryAfterMs: error.retryAfterMs, message };
    }
    // No status: the request never reached the provider (DNS, TLS, abort,
    // missing credential). Transport failures are transient more often than not.
    const missingCredential = /is not configured|requires MODEL_GATEWAY credentials|No model service is configured/i.test(
      message,
    );
    return {
      category: missingCredential ? "PROVIDER_AUTH_FAILED" : "PROVIDER_UNAVAILABLE",
      retryable: !missingCredential,
      allowFailover: true,
      message,
    };
  }

  return { category: "PROVIDER_UNAVAILABLE", retryable: false, allowFailover: true, message };
}

/**
 * Bounded retry budget for a single provider candidate.
 *
 * One retry, not three. Every retry is a real charge against the scope's call
 * budget, and a provider that failed twice in a row is telling JASIM something
 * that a third attempt will not change. Deployments raise it deliberately
 * through `JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE`; the value is clamped so a
 * misconfiguration cannot turn one request into a spend loop.
 */
export const DEFAULT_MAX_RETRIES_PER_CANDIDATE = 1;
const RETRY_CEILING = 3;

export function configuredMaxRetriesPerCandidate(): number {
  const raw = process.env.JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE?.trim();
  if (!raw) return DEFAULT_MAX_RETRIES_PER_CANDIDATE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_MAX_RETRIES_PER_CANDIDATE;
  return Math.min(parsed, RETRY_CEILING);
}

/** Exponential backoff, honouring a provider-advertised delay when it gave one. */
export function retryDelayMs(attempt: number, failure: NormalizedModelFailure): number {
  if (typeof failure.retryAfterMs === "number" && failure.retryAfterMs >= 0) {
    return Math.min(failure.retryAfterMs, 30_000);
  }
  return Math.min(250 * 2 ** attempt, 4_000);
}
