/**
 * JASIM — AN ADDRESS A PROVIDER CAN POST TO, AND NOTHING MORE.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   HTTP_RECEIPT != PAYMENT_TRUTH · HTTP_2XX != PAYMENT_SETTLED
 *   ROUTE_PARAM != AUTHORITY · QUERY_PARAM != AUTHORITY · BODY_FIELD != AUTHORITY
 *   PARSED_JSON != SIGNED_RAW_BYTES
 *   BODY_RESERIALIZATION != ORIGINAL_CALLBACK
 *   WEBHOOK_ROUTE != PAY · != CAPTURE · != REFUND
 *   TRANSPORT_INGRESS != PAYMENT_VERIFIER · != PROVIDER_ADAPTER
 *   DUPLICATE_HTTP_DELIVERY != DUPLICATE_EFFECT
 *   CALLER_OWNER_ID != CANONICAL_OWNER_AUTHORITY
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * Transport. The authenticated boundary, the replay ledger, the correlation,
 * the readback and the verifier all already existed and are all reached through
 * `ingestPaymentEvent`. This file gives them a door, and decides which HTTP
 * number to answer with.
 *
 * ─── THE RAW BYTES ARE THE LOAD-BEARING PART ────────────────────────────────
 *
 * The HMAC is verified against exactly what arrived. `c.req.text()` returns the
 * body unchanged; nothing here parses and re-serialises before verification,
 * and nothing normalises whitespace, key order, number formatting or escaping.
 * A body that is semantically identical but byte-different is a different body,
 * and its old signature does not cover it.
 *
 *   RAW_BYTES_CAPTURED_BEFORE_RESERIALIZATION
 *   SEMANTICALLY_SAME_RESERIALIZED_BODY_ACCEPTED_WITH_OLD_SIGNATURE = 0
 *
 * A parse DOES happen — but only to read the ROUTING fields out of bytes that
 * were already authenticated by the boundary, and the boundary independently
 * re-checks that those fields equal the signed payload. Parsing to route is not
 * parsing to verify.
 *
 * ─── AND WHAT THE CALLER CANNOT ESTABLISH ───────────────────────────────────
 *
 * The provider in the path is a SELECTOR into the server's own catalog, never a
 * claim. Posting to one provider's route without that provider's catalog-bound
 * secret fails closed, so the path name grants nothing.
 *
 *   ROUTE_PROVIDER_NAME != AUTHORITY
 *
 * The owner is never sent: the boundary derives it from the correlated payment.
 * The connector is derived from the route. The event type, the payment
 * reference, the money and the timestamp are read from the SIGNED body, so a
 * query string or an unsigned header has nothing to contribute and no field to
 * contribute it through.
 *
 *   HTTP_CALLER_CAN_CHOOSE_OWNER = 0
 *   HTTP_CALLER_CAN_CHOOSE_CONNECTOR_AUTHORITY = 0
 *   HTTP_CALLER_CAN_SWAP_PAYMENT_INTENT = 0
 *   BODY_QUERY_PROVIDER_OVERRIDE = 0
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContinuationDispatcher } from "../runtime/block2/temporal";
import { ingestPaymentEvent, type PaymentEventOutcome } from "../runtime/payment-event";

/**
 * A tight cap of its own.
 *
 * The signed financial schema is a handful of short strings — an event type, a
 * reference, minor units, a currency, an id, a timestamp. Sixty-four kilobytes
 * is generous for that and nowhere near the application's general 50 MB, which
 * exists for prompts and uploads and has no business being a webhook's budget.
 * The global limit is left exactly as it is.
 *
 *   OVERSIZED_WEBHOOK_BODY_ACCEPTED = 0 · GLOBAL_JSON_BODY_PARSER_WEAKENED = NO
 */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/** The one header the signature may arrive in. Generic, and not a provider's. */
export const SIGNATURE_HEADER = "x-jasim-signature";

/**
 * Transport acknowledgement, which is a different thing from payment truth.
 *
 * A provider whose authentic event simply did not prove settlement has done
 * nothing wrong, and answering 500 would tell it to try again forever. So a
 * refusal that is ABOUT the evidence is acknowledged; only a genuine internal
 * failure — where a retry might actually help — gets a 5xx.
 *
 *   EXPECTED_REFUSAL_RETURNS_500 = 0 · HTTP_2XX != PAYMENT_SETTLED
 */
const STATUS_FOR: Readonly<Record<PaymentEventOutcome, 200 | 202 | 400>> = Object.freeze({
  // It did not authenticate, or did not correlate. The caller's problem.
  REJECTED: 400,
  // These bytes were already seen. Acknowledged, so it stops resending.
  DUPLICATE: 200,
  STALE: 200,
  // Authenticated, recorded, and it moved no payment.
  NO_EFFECT: 200,
  // Authentic, and the provider's own state did not bear it out. Accepted as
  // received; deliberately not a 500, and deliberately not a 200 either.
  UNVERIFIED: 202,
  APPLIED: 200,
});

export function createPaymentWebhookRoutes(dispatcher: ContinuationDispatcher): Hono {
  const routes = new Hono();

  // Route-scoped, and applied before the handler so oversized bytes are
  // refused without ever being read.
  routes.use("/:provider", bodyLimit({ maxSize: WEBHOOK_MAX_BODY_BYTES }));

  routes.post("/:provider", async (c) => {
    // The path names which catalog entry to authenticate against. It proves
    // nothing by itself, and the boundary below is what decides.
    const provider = c.req.param("provider");

    // EXACTLY what arrived. No parse, no re-serialise, no normalisation.
    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch {
      return c.json({ received: false, reason: "Unreadable body." }, 400);
    }

    // Routing fields, read from bytes the boundary will independently verify
    // against the signature and against the payment mandate.
    let routing: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return c.json({ received: false, reason: "Body must be a JSON object." }, 400);
      }
      routing = parsed as Record<string, unknown>;
    } catch {
      // Deterministic, and never an uncaught throw.
      return c.json({ received: false, reason: "Malformed JSON." }, 400);
    }
    const eventType = typeof routing.eventType === "string" ? routing.eventType : "";
    const reference = typeof routing.reference === "string" ? routing.reference : "";
    const timestamp = typeof routing.timestamp === "number" ? routing.timestamp : undefined;
    if (!eventType || !reference) {
      return c.json(
        { received: false, reason: "A callback must carry its event type and reference." },
        400,
      );
    }

    const result = await ingestPaymentEvent(dispatcher, {
      provider,
      // Derived from the route, never from the caller. It is a label on the
      // ledger row and was never authority — this keeps it from looking like
      // one.
      connectorId: `route:${provider}`,
      // The boundary derives the real dedupe identity from the signed body; a
      // caller-chosen key could never widen it, and this one is only a label.
      eventKey: `http:${provider}`,
      eventType,
      reference,
      rawBody,
      ...(c.req.header(SIGNATURE_HEADER) ? { signature: c.req.header(SIGNATURE_HEADER)! } : {}),
      // From the SIGNED body, so there is no unsigned timestamp at this door
      // for anybody to swap.
      ...(timestamp === undefined ? {} : { timestamp }),
      // ownerId is deliberately absent. The payment decides whose it is.
    });

    // The outcome name, and no payment status. A caller who can sign already
    // knows what they sent; telling them what JASIM now believes would make
    // this response a state oracle for whoever holds the secret.
    return c.json({ received: result.outcome !== "REJECTED", outcome: result.outcome },
      STATUS_FOR[result.outcome]);
  });

  // Anything that is not a POST is not a callback. Answered deterministically
  // rather than falling through to the application's 404.
  routes.all("/:provider", (c) => c.json({ received: false, reason: "Method not allowed." }, 405));

  return routes;
}
