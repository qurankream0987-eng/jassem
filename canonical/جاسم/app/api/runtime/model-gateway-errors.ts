/**
 * Gateway error types, extracted from `model-gateway.ts`.
 *
 * They live in their own module so that `model-failure.ts` can classify them
 * without importing the gateway, and the gateway can use the classifier — which
 * would otherwise be a cycle. `model-gateway.ts` re-exports everything here, so
 * existing importers are unaffected and `instanceof` still compares the same
 * class object.
 */

export class ModelGatewayUnavailableError extends Error {
  readonly code = "MODEL_GATEWAY_UNAVAILABLE";
  /**
   * The provider's HTTP status, when the request actually reached it. Absent
   * means the call never got that far (DNS, TLS, abort, missing credential) —
   * a distinction the failure taxonomy depends on, and one that string-matching
   * the message cannot make reliably.
   */
  readonly status?: number;
  /** Provider-advertised backoff in milliseconds, parsed from `retry-after`. */
  readonly retryAfterMs?: number;

  constructor(message: string, options?: { status?: number; retryAfterMs?: number }) {
    super(message);
    this.name = "ModelGatewayUnavailableError";
    this.status = options?.status;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class ModelGatewayOutputError extends Error {
  readonly code = "MODEL_GATEWAY_INVALID_OUTPUT";

  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayOutputError";
  }
}

export class ModelGatewayPolicyError extends Error {
  readonly code = "MODEL_POLICY_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayPolicyError";
  }
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date. Both are honoured; an
 * unparseable or negative value yields `undefined` rather than 0, because a 0
 * would assert "retry immediately" on no evidence.
 */
export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : undefined;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  const delta = date - Date.now();
  return delta > 0 ? delta : undefined;
}
