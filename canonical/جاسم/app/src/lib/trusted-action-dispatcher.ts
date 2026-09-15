import {
  TrustedActionEnvelopeSchema,
  type TrustedActionEnvelope,
  type TrustedActionType,
  type TrustedDispatchResult,
} from "@contracts/trusted-action";

export type TrustedActionInput = Omit<
  TrustedActionEnvelope,
  "version" | "payload"
> & {
  payload?: Record<string, unknown>;
};

export function createTrustedActionEnvelope(
  input: TrustedActionInput,
): TrustedActionEnvelope {
  return TrustedActionEnvelopeSchema.parse({
    version: 1,
    ...input,
    payload: input.payload ?? {},
  });
}

export function isDispatchRefreshOutcome(
  result: TrustedDispatchResult,
): boolean {
  return (
    result.refreshProjection === true ||
    result.outcome === "OPENED" ||
    result.outcome === "PROJECTION_REFRESH_REQUIRED"
  );
}

export function trustedActionFailure(
  result: TrustedDispatchResult,
): Error | null {
  if (
    result.outcome === "LOCAL_ONLY" ||
    result.outcome === "OPENED" ||
    result.outcome === "PROJECTION_REFRESH_REQUIRED" ||
    result.outcome === "DISPATCH_ACCEPTED"
  ) {
    return null;
  }
  return new Error(result.message);
}

export type { TrustedActionType };