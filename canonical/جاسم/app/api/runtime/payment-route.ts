/**
 * JASIM — FROM A CANONICAL PAYABLE TO A VERIFIED PAY-CAPABLE BINDING.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH
 *   MODEL != PAYMENT AUTHORITY · MODEL != PAYMENT ROUTE AUTHORITY
 *   MODEL != PAYEE AUTHORITY  · MODEL != PAYMENT SECRET STORE
 *   PROVIDER_PAY_CAPABILITY != AUTHORITY_TO_PAY
 *   PAYMENT_INTENT != PAYMENT_EXECUTION
 *   CHECKOUT_CREATED != PAYMENT_AUTHORIZED != CAPTURED != SETTLED
 *   PROVIDER_SUCCESS != VERIFIED_PAYMENT · PROVIDER_RECEIPT != VERIFICATION
 *   PAYMENT != FULFILLMENT
 *
 * ─── WHAT THIS IS, AND THE ONE THING THAT WAS MISSING ───────────────────────
 *
 * Both halves already existed and neither could reach the other.
 *
 * On one side: a canonical payable gate, a PaymentIntent with a durable
 * optimistic-lock claim, a provider identity pinned on first execution,
 * INCONCLUSIVE on lost transport, readback-over-callback verification, and
 * refunds as new effects that never rewrite history. All of it took its
 * provider as `deps.psp` — a client somebody handed it.
 *
 * On the other: a general provider binding runtime with PAY and REFUND as
 * ordinary capabilities, a credential vault, a trusted endpoint boundary and a
 * verification lifecycle.
 *
 * Nothing connected them, so the only production payment path read `provider`
 * and `adapterEndpoint` out of the MODEL's envelope. That is the bypass this
 * module closes.
 *
 *   PAYMENT_EXECUTION_BYPASSES_GENERAL_PROVIDER_BINDING = 0
 *
 * ─── AND WHAT THIS IS NOT ───────────────────────────────────────────────────
 *
 * Not a payment connector architecture, not a second binding runtime, and not
 * a second secret store. A payment provider is a provider whose manifest
 * contains PAY. It binds, authenticates, verifies, stores its credential and
 * revokes exactly like every other one.
 *
 *   PAYMENT_SPECIAL_BINDING_RUNTIME = 0 · PAYMENT_SPECIAL_SECRET_STORE = 0
 *
 * Not source resolution either. That runtime establishes FACTS through READ
 * and OBSERVE. Paying is a mutation, it is not a fact, and PAY is not in
 * `FACT_CAPABILITIES`.
 *
 *   READING THE WORLD != CHANGING THE WORLD
 *   PAY_IN_SOURCE_RESOLUTION = 0
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { scopePolicies } from "@db/schema-block2";
import {
  invokeThroughBinding,
  verifiedBindingsFor,
  type ProviderCapability,
} from "./provider-binding";
import {
  PspRejectedError,
  PspUncertainEffectError,
  type PspClient,
  type PspPaymentView,
} from "./block3/psp-client";
import type { PayableObligation } from "./block31/canonical-payable";

/** Paying and refunding. Both mutate, and neither can establish a fact. */
export const PAYMENT_CAPABILITY: ProviderCapability = "PAY";
export const REFUND_CAPABILITY: ProviderCapability = "REFUND";

export const PAYMENT_ROUTE_POLICY_KEY = "payment.route";

export type PaymentRoute = {
  readonly bindingId: string;
  readonly definitionId: string;
  /** Whose rail this is. Derived from the settlement, never named by a caller. */
  readonly scopeId: string;
  readonly side: "PAYER" | "PAYEE";
};

export type PaymentRouteResolution =
  | { readonly status: "RESOLVED"; readonly route: PaymentRoute }
  /** Nobody on either side of this settlement can execute it. */
  | { readonly status: "NO_ROUTE"; readonly detail: string }
  /** More than one could, and nothing canonical chooses. */
  | { readonly status: "AMBIGUOUS_ROUTE"; readonly routes: readonly PaymentRoute[] };

/**
 * What a scope may say about how its settlements are routed.
 *
 * `side` is a statement about this settlement: whose rail carries it. A payer
 * may legitimately say «our card, our processor» or «use the merchant's
 * acquiring bank» — it is their money moving, and it changes nothing about WHO
 * is paid or HOW MUCH.
 *
 * `preferredProviders` follows the law the source-resolution phase settled:
 * ranking a scope's own systems belongs to whoever owns them, and is read from
 * that scope, never from whoever asked.
 *
 *   REQUESTER_POLICY != SOURCE_OWNER_POLICY
 *
 * Neither field can name a payee, an amount, a currency, or make an ineligible
 * binding eligible.
 */
export type PaymentRoutePolicy = {
  readonly side: "PAYER" | "PAYEE" | null;
  readonly preferredProviders: readonly string[];
};

const NO_POLICY: PaymentRoutePolicy = Object.freeze({
  side: null,
  preferredProviders: Object.freeze([]),
});

export async function paymentRoutePolicyFor(scopeId: string): Promise<PaymentRoutePolicy> {
  const [row] = await db
    .select({ value: scopePolicies.value })
    .from(scopePolicies)
    .where(
      and(
        eq(scopePolicies.scopeId, scopeId),
        eq(scopePolicies.policyKey, PAYMENT_ROUTE_POLICY_KEY),
        eq(scopePolicies.state, "active"),
      ),
    )
    .orderBy(desc(scopePolicies.version))
    .limit(1);
  if (!row) return NO_POLICY;
  const value = row.value as Record<string, unknown>;
  const side = value.side === "PAYER" || value.side === "PAYEE" ? value.side : null;
  const preferredProviders = Array.isArray(value.preferredProviders)
    ? value.preferredProviders.filter((entry): entry is string => typeof entry === "string")
    : [];
  return { side, preferredProviders };
}

/**
 * WHOSE RAIL CARRIES THIS SETTLEMENT.
 *
 * Not «always the payer» and not «always the payee». A card payment runs on
 * the merchant's acquiring side; a bank transfer runs on the payer's. Both are
 * legitimate, so both sides of the canonical settlement are eligible and the
 * choice is canonical rather than assumed.
 *
 *   PAYMENT_BINDING_SCOPE_DERIVED_CANONICALLY
 *   MODEL_CAN_CHOOSE_ARBITRARY_PAYMENT_BINDING = NO
 *
 * The two sides come from the payable obligation — who owes, and who is owed —
 * and from nowhere else. No caller names a scope, and a scope with no stake in
 * this settlement is never considered however many PAY bindings it holds.
 *
 *   CROSS_SCOPE_PAY_PROVIDER = 0
 */
export async function resolvePaymentRoute(input: {
  payable: Pick<PayableObligation, "payeeRef">;
  /** The scope that OWES. From the canonical payable resolution. */
  payerScopeId: string;
  capability?: ProviderCapability;
}): Promise<PaymentRouteResolution> {
  const capability = input.capability ?? PAYMENT_CAPABILITY;
  const sides: readonly { scopeId: string; side: "PAYER" | "PAYEE" }[] = [
    { scopeId: input.payerScopeId, side: "PAYER" },
    { scopeId: input.payable.payeeRef, side: "PAYEE" },
  ];

  const found: PaymentRoute[] = [];
  let ambiguousWithin = false;
  for (const { scopeId, side } of sides) {
    if (found.some((one) => one.scopeId === scopeId)) continue;
    // VERIFIED, granted, and this scope's own. The binding runtime decides all
    // three; nothing here can widen any of them.
    const eligible = await verifiedBindingsFor({ scopeId, capability });
    if (eligible.length === 0) continue;
    if (eligible.length === 1) {
      found.push({
        bindingId: eligible[0]!.bindingId,
        definitionId: eligible[0]!.definitionId,
        scopeId,
        side,
      });
      continue;
    }
    // Several of ITS OWN. Its own ranking, read from its own policy.
    //
    //   MULTIPLE_PAYMENT_PROVIDER_LATEST_WINS = 0
    const owner = await paymentRoutePolicyFor(scopeId);
    const preferred = owner.preferredProviders
      .map((definitionId) => eligible.find((one) => one.definitionId === definitionId))
      .find((match) => match !== undefined);
    if (preferred) {
      found.push({
        bindingId: preferred.bindingId,
        definitionId: preferred.definitionId,
        scopeId,
        side,
      });
    } else {
      ambiguousWithin = true;
    }
  }

  if (ambiguousWithin) return { status: "AMBIGUOUS_ROUTE", routes: found };
  if (found.length === 0) {
    return { status: "NO_ROUTE", detail: "No verified payment route exists for this settlement." };
  }
  if (found.length === 1) return { status: "RESOLVED", route: found[0]! };

  // Both sides could carry it. WHICH SIDE is a canonical question about this
  // settlement, and the payer answers it in their own policy — it is their
  // money moving. Absent that, it is not guessed.
  //
  //   PAYMENT_ROUTE_REQUIRED, never arbitrary execution.
  const payerPolicy = await paymentRoutePolicyFor(input.payerScopeId);
  const chosen = payerPolicy.side
    ? found.find((one) => one.side === payerPolicy.side)
    : undefined;
  return chosen
    ? { status: "RESOLVED", route: chosen }
    : { status: "AMBIGUOUS_ROUTE", routes: found };
}

// ─────────────────────────────────────────────────────────────────────────────
// The adapter, seen as a payment provider
// ─────────────────────────────────────────────────────────────────────────────

/** What an adapter is asked to do, inside the one PAY/REFUND capability. */
export const PAYMENT_OPERATIONS = ["AUTHORIZE", "CAPTURE", "REFUND", "READBACK"] as const;
export type PaymentOperation = (typeof PAYMENT_OPERATIONS)[number];

function asPaymentView(value: unknown): PspPaymentView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PspRejectedError("The provider returned nothing readable.", 502);
  }
  const record = value as Record<string, unknown>;
  const text = (key: string): string =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  const view: PspPaymentView = {
    id: text("id"),
    status: text("status"),
    amountMinor: text("amountMinor"),
    currency: text("currency"),
    reference: text("reference"),
  };
  if (!view.id) throw new PspRejectedError("The provider named no payment.", 502);
  return view;
}

/**
 * A `PspClient` backed by a VERIFIED, PAY-granted general provider binding.
 *
 * This is the whole bridge. The payment execution runtime keeps every rule it
 * already had — idempotency, the claim, money matching, readback over
 * callback, INCONCLUSIVE on lost transport — and simply stops being handed a
 * client by whoever called it.
 *
 * ─── HOW A FAILURE IS CLASSIFIED, AND WHY IT MATTERS MOST HERE ──────────────
 *
 *   ERROR       → REJECTED   the provider definitively said no
 *   UNAVAILABLE → UNCERTAIN  it may have landed; the effect is unknown
 *   thrown      → UNCERTAIN  same, and the reason the door reports it that way
 *
 * Collapsing the second into the first is how a system double-charges: a
 * request that may have succeeded, recorded as failed, invites a retry.
 *
 *   AMBIGUOUS_NETWORK_FAILURE_BLIND_RECHARGE = 0
 *   PROVIDER_FAILURE != PAYMENT_SUCCESS
 */
export function pspClientForRoute(route: PaymentRoute): PspClient {
  async function operate(
    operation: PaymentOperation,
    capability: ProviderCapability,
    parameters: Record<string, unknown>,
  ): Promise<PspPaymentView | null> {
    const outcome = await invokeThroughBinding({
      bindingId: route.bindingId,
      onBehalfOfScopeId: route.scopeId,
      capability,
      parameters: { operation, ...parameters },
    });
    if (outcome.status === "REFUSED") {
      // A refusal is definitive: nothing was sent, so nothing can be in
      // flight. Reported as rejected rather than uncertain, which is the
      // safe direction only because it is also the true one.
      throw new PspRejectedError(outcome.detail, 403);
    }
    if (outcome.status === "PROVIDER_UNAVAILABLE") {
      throw new PspUncertainEffectError(outcome.detail);
    }
    if (outcome.status === "PROVIDER_ERROR") {
      throw new PspRejectedError(outcome.detail, 400);
    }
    if (operation === "READBACK" && (outcome.value === null || outcome.value === undefined)) {
      return null;
    }
    return asPaymentView(outcome.value);
  }

  return {
    authorize: async (request) =>
      (await operate("AUTHORIZE", PAYMENT_CAPABILITY, {
        // Every value here was reconstructed from canonical state by the
        // execution runtime immediately before this call. None of it came
        // from a model, a client or a stored UI payload.
        //
        //   STALE_CLIENT_PAYMENT_AMOUNT_USED = 0
        //   STALE_MODEL_PAYMENT_PAYEE_USED = 0
        amountMinor: request.amountMinor,
        currency: request.currency,
        reference: request.reference,
        idempotencyKey: request.idempotencyKey,
      }))!,
    capture: async (paymentId) =>
      (await operate("CAPTURE", PAYMENT_CAPABILITY, { paymentId }))!,
    refund: async (paymentId, idempotencyKey) =>
      (await operate("REFUND", REFUND_CAPABILITY, { paymentId, idempotencyKey }))!,
    // Reading back a payment you made is part of having made it, so it runs
    // on the same granted capability rather than borrowing a reading one.
    readback: async (paymentId) => operate("READBACK", PAYMENT_CAPABILITY, { paymentId }),
  };
}

/**
 * The execution dependencies for a settlement, or the reason there are none.
 *
 * `providerRef` is the definition id, which is what the execution runtime pins
 * to the intent on first execution and refuses to let change afterwards. So a
 * settlement started on one provider can never be finished on another.
 *
 *   PROVIDER_PAYMENT_ID != JASIM_PAYMENT_INTENT_ID
 */
export async function paymentExecutionRoute(input: {
  payable: Pick<PayableObligation, "payeeRef">;
  payerScopeId: string;
  capability?: ProviderCapability;
}): Promise<
  | { readonly status: "RESOLVED"; readonly route: PaymentRoute; readonly deps: { psp: PspClient; providerRef: string } }
  | { readonly status: "NO_ROUTE"; readonly detail: string }
  | { readonly status: "AMBIGUOUS_ROUTE"; readonly routes: readonly PaymentRoute[] }
> {
  const resolved = await resolvePaymentRoute(input);
  if (resolved.status !== "RESOLVED") return resolved;
  return {
    status: "RESOLVED",
    route: resolved.route,
    deps: { psp: pspClientForRoute(resolved.route), providerRef: resolved.route.definitionId },
  };
}
