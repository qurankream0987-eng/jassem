/**
 * Block 3 §30–§31 — PSP client over a REAL HTTP boundary.
 *
 * The generic payment provider contract: authorize / capture / refund /
 * readback, with exact minor-unit money. The only implementation allowed in
 * this phase is the CONTROLLED_TEST_PROVIDER; production PSP access stays
 * BLOCKED_BY_PROVIDER until a new owner execution order opens it.
 *
 * Failure taxonomy (§35–§36):
 * - PspRejectedError: the provider definitively said no (4xx/invalid state).
 * - PspUncertainEffectError: transport failed AFTER the request may have
 *   landed — the effect is unknown. Callers must go INCONCLUSIVE and
 *   reconcile via readback, never blind-retry.
 */

export type PspPaymentView = {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  reference: string;
};
export type PspPayoutView = { id: string; status: string; amountMinor: string; currency: string; destinationRef: string };

export class PspRejectedError extends Error {
  // Written out rather than declared as a constructor parameter property:
  // `erasableSyntaxOnly` forbids those, and this file had never been reached
  // by the strictly-checked project until the payment route imported it.
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class PspUncertainEffectError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type PspClient = {
  authorize(input: {
    amountMinor: string;
    currency: string;
    reference: string;
    idempotencyKey: string;
  }): Promise<PspPaymentView>;
  capture(paymentId: string): Promise<PspPaymentView>;
  /** Refund carries a caller idempotency key so replays never double-refund. */
  refund(paymentId: string, idempotencyKey: string): Promise<PspPaymentView>;
  /** Authoritative provider readback; null when the payment is unknown. */
  readback(paymentId: string): Promise<PspPaymentView | null>;
  payout?(input: { payoutId?: string; amountMinor: string; currency: string; destinationRef: string; idempotencyKey: string }): Promise<PspPayoutView>;
  payoutReadback?(payoutId: string): Promise<PspPayoutView | null>;
};

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

async function request(
  fetchImpl: FetchLike,
  endpoint: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  let response;
  try {
    response = await fetchImpl(`${endpoint}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // Network failure after dispatch: the effect is UNKNOWN, not failed.
    throw new PspUncertainEffectError(
      `Provider transport failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  const parsed = (await response.json()) as unknown;
  return { status: response.status, body: parsed };
}

export function createHttpPspClient(
  endpoint: string,
  fetchImpl?: FetchLike,
): PspClient {
  const fetcher: FetchLike =
    fetchImpl ??
    ((globalThis.fetch as unknown as FetchLike | undefined) ??
      (() => {
        throw new PspUncertainEffectError("No fetch implementation available");
      }));

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { status, body: parsed } = await request(fetcher, endpoint, method, path, body);
    if (status >= 500) {
      // Server error after dispatch: effect unknown.
      throw new PspUncertainEffectError(`Provider 5xx (${status}) — effect unknown`);
    }
    if (status >= 400) {
      const message =
        parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)
          ? String((parsed as Record<string, unknown>).error)
          : `Provider rejected (${status})`;
      throw new PspRejectedError(message, status);
    }
    return parsed as T;
  }

  return {
    authorize: (input) =>
      call<PspPaymentView>("POST", "/payments", {
        amountMinor: input.amountMinor,
        currency: input.currency,
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
      }),
    capture: (paymentId) => call<PspPaymentView>("POST", `/payments/${paymentId}/capture`),
    refund: (paymentId, idempotencyKey) =>
      call<PspPaymentView>("POST", `/payments/${paymentId}/refund`, { idempotencyKey }),
    readback: async (paymentId) => {
      const { status, body } = await request(fetcher, endpoint, "GET", `/payments/${paymentId}`);
      if (status === 404) return null;
      if (status >= 400) throw new PspRejectedError(`Readback rejected (${status})`, status);
      return body as PspPaymentView;
    },
    payout: (input) => call<PspPayoutView>("POST", "/payouts", input),
    payoutReadback: async (payoutId) => {
      const { status, body } = await request(fetcher, endpoint, "GET", `/payouts/${payoutId}`);
      if (status === 404) return null;
      if (status >= 400) throw new PspRejectedError(`Payout readback rejected (${status})`, status);
      return body as PspPayoutView;
    },
  };
}
