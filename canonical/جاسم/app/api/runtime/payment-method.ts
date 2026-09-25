/**
 * JASIM — THE PAYER'S INSTRUMENT, AND THE PROVIDER ASKING FOR MORE.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   RAW_PAYMENT_CREDENTIAL   != PAYMENT_METHOD_REFERENCE
 *   PAYMENT_METHOD_REFERENCE != PAYMENT_AUTHORITY != PAYMENT_SUCCESS
 *   PAYMENT_METHOD_SELECTED  != PAYMENT_EXECUTED != PAYMENT_SETTLED
 *   CHALLENGE_CREATED        != CHALLENGE_COMPLETED != PAYMENT_SETTLED
 *   BROWSER_RETURN           != PAYMENT_PROOF
 *   ONE_TIME_METHOD          != REUSABLE_METHOD
 *   PAYMENT_AUTHORIZATION    != FUTURE_CHARGE_AUTHORIZATION
 *
 *   PROVIDER_BINDING_CREDENTIAL != CUSTOMER_PAYMENT_METHOD
 *
 * The last one is the distinction this module exists around. The binding's
 * credential authenticates JASIM to the provider; the payer's method names the
 * instrument the money comes from. The payment phase before this one only ever
 * needed the first, because its fixture provider funded itself — which is a
 * fact about that fixture and never was a payment method.
 *
 * ─── WHAT THE TRACE FOUND, AND WHAT IT CORRECTED ────────────────────────────
 *
 * Almost everything. `payment_method_references` exists, and so does a
 * producer — `createPaymentMethodReference`, which refuses card-shaped data
 * and anything failing a Luhn check before it will store a token. So does a
 * consumer: `resolvePaymentMethodReference`, plus the delegation mandate,
 * which already filters an execution by which method it names.
 *
 * Two things were genuinely absent:
 *
 *   the reference never reached the PROVIDER — `PspClient.authorize` has no
 *   parameter for one, so an instrument could be chosen and then ignored;
 *
 *   nothing could express REQUIRES_ACTION — zero occurrences in the runtime,
 *   so a provider needing the payer to approve something had no way to say so.
 *
 * Both are bridged here. No new table, no new state machine, no second payment
 * runtime: a challenge is an `external_action_session`, which already carries
 * a payment intent id, a single-use state, an origin and an expiry.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { externalActionSessions, paymentMethodReferences } from "@db/schema";
import { authorizeScopeAction } from "./actor-scope";
import { assertNotLocal, definitionFacts } from "./provider-binding";
import type { PaymentRoute } from "./payment-route";

/** How long an instrument may be chosen for. Declared by the provider. */
export const METHOD_REQUIREMENTS = ["NONE", "REQUIRED"] as const;
export type MethodRequirement = (typeof METHOD_REQUIREMENTS)[number];

/**
 * Whether the payer must produce an instrument at all.
 *
 * Read from the registered definition, which is trusted server code. A model
 * saying «this needs a card» establishes nothing, and neither does a caller.
 */
export function methodRequirementFor(definitionId: string): MethodRequirement {
  return definitionFacts(definitionId)?.paymentMethod ?? "NONE";
}

/**
 * What a person may safely be shown about an instrument they saved.
 *
 * Assembled field by field. The token reference is the one thing that could
 * act as a bearer value, and it has no field here to appear in.
 *
 *   SECRET_RETURNED_IN_METHOD_READ = 0
 */
export type MethodOption = {
  readonly methodRef: string;
  readonly methodType: string;
  readonly provider: string;
  readonly expiresAt: Date | null;
};

export type MethodResolution =
  /** This provider funds itself. Nothing is asked of anybody. */
  | { readonly status: "NOT_REQUIRED" }
  /** Exactly one eligible instrument, or the one that was asked for. */
  | { readonly status: "RESOLVED"; readonly methodRef: string }
  /** Several could pay. Choosing for somebody is not resolving. */
  | { readonly status: "SELECTION_REQUIRED"; readonly options: readonly MethodOption[] }
  /** None exists that this provider could use. A trusted surface is needed. */
  | { readonly status: "SETUP_REQUIRED"; readonly provider: string };

/**
 * Every instrument that could legitimately pay THIS settlement.
 *
 * Four filters, and each closes a different door:
 *
 *   owned by the payer        CROSS_SCOPE_PAYMENT_METHOD_USE = 0
 *   issued by THIS provider   CROSS_PROVIDER_PAYMENT_METHOD_USE = 0
 *   still ACTIVE              a revoked instrument is not an instrument
 *   not expired               nor is a lapsed one
 *
 * A token minted by one provider is meaningless to another and dangerous to
 * forward, so provider identity is matched exactly rather than loosely.
 */
export async function eligibleMethodsFor(input: {
  payerScopeId: string;
  route: Pick<PaymentRoute, "definitionId">;
  now?: Date;
}): Promise<readonly MethodOption[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(paymentMethodReferences)
    .where(
      and(
        eq(paymentMethodReferences.ownerId, input.payerScopeId),
        eq(paymentMethodReferences.provider, input.route.definitionId),
        eq(paymentMethodReferences.status, "ACTIVE"),
      ),
    );
  return rows
    .filter((row) => !row.expiresAt || row.expiresAt.getTime() > now.getTime())
    .map((row) => ({
      methodRef: row.id,
      methodType: row.methodType,
      provider: row.provider,
      expiresAt: row.expiresAt,
    }));
}

/**
 * Which instrument pays, or what is still missing before one can.
 *
 * `requestedMethodRef` is a POINTER. A person may say «the second card» and a
 * stable reference may turn that into an id — but the id is then checked
 * against what this payer actually holds for this provider, exactly as a
 * transaction reference is checked against what this scope actually owes.
 *
 *   MODEL_CAN_INJECT_PAYMENT_METHOD_REF = NO
 *
 * Standing is re-read now rather than remembered, so an instrument belonging
 * to an organization stops being usable the moment the person loses authority
 * in it — whatever they could do yesterday.
 *
 *   AUTHORIZATION_RECHECK_BEFORE_METHOD_USE
 */
export async function resolveMethodForRoute(input: {
  payerScopeId: string;
  principalId: string;
  route: Pick<PaymentRoute, "definitionId">;
  requestedMethodRef?: string;
  now?: Date;
}): Promise<MethodResolution> {
  if (methodRequirementFor(input.route.definitionId) === "NONE") {
    return { status: "NOT_REQUIRED" };
  }
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.payerScopeId,
    permission: "act_financially",
    ...(input.now ? { now: input.now } : {}),
  });
  // Not permitted to spend here is the same answer as having nothing to spend
  // with: neither reveals whose instruments exist.
  if (!allowed.ok) return { status: "SETUP_REQUIRED", provider: input.route.definitionId };

  const eligible = await eligibleMethodsFor({
    payerScopeId: input.payerScopeId,
    route: input.route,
    ...(input.now ? { now: input.now } : {}),
  });

  if (input.requestedMethodRef) {
    const named = eligible.find((one) => one.methodRef === input.requestedMethodRef);
    // Naming an instrument this payer does not hold for this provider is the
    // same answer as holding none — a refusal that distinguished them would
    // say whose it is.
    return named
      ? { status: "RESOLVED", methodRef: named.methodRef }
      : { status: "SETUP_REQUIRED", provider: input.route.definitionId };
  }
  if (eligible.length === 0) {
    return { status: "SETUP_REQUIRED", provider: input.route.definitionId };
  }
  if (eligible.length === 1) return { status: "RESOLVED", methodRef: eligible[0]!.methodRef };
  return { status: "SELECTION_REQUIRED", options: eligible };
}

/** The opaque token this reference stands for. Trusted call sites only. */
export async function tokenForMethod(input: {
  methodRef: string;
  payerScopeId: string;
  definitionId: string;
  now?: Date;
}): Promise<string | null> {
  const now = input.now ?? new Date();
  const [row] = await db
    .select()
    .from(paymentMethodReferences)
    .where(
      and(
        eq(paymentMethodReferences.id, input.methodRef),
        eq(paymentMethodReferences.ownerId, input.payerScopeId),
        eq(paymentMethodReferences.provider, input.definitionId),
        eq(paymentMethodReferences.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  return row.tokenRef;
}

// ─────────────────────────────────────────────────────────────────────────────
// When the provider needs the payer to do something
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one status that means «not finished, and not failed».
 *
 * 3-D Secure, a bank approval, a wallet confirmation, a device prompt and a
 * redirect authorization are all THIS, and none of them is a runtime. An
 * adapter normalises whatever its provider calls it into this one word.
 *
 *   No ThreeDSRuntime. No WalletChallengeRuntime.
 */
export const REQUIRES_ACTION = "REQUIRES_ACTION";

export type PaymentChallenge = {
  readonly challengeId: string;
  readonly paymentIntentId: string;
  /** Where the person goes. Provider-hosted, and validated before it is stored. */
  readonly url: string;
  /** Single-use, and checked on return. */
  readonly state: string;
  readonly expiresAt: Date;
};

const DEFAULT_CHALLENGE_TTL_MS = 15 * 60 * 1000;

/**
 * Open a challenge, bound to exactly one payment.
 *
 * An `external_action_session`, which already carries the payment intent, a
 * single-use state, a validated origin and an expiry. Building a second
 * session primitive for this would have been building the same thing twice.
 *
 *   NEW_PARALLEL_TRUSTED_SURFACE_RUNTIME = 0
 *
 * The binding to the intent and the payer is what stops one challenge from
 * authorising another payment:
 *
 *   CROSS_PAYMENT_CHALLENGE_REPLAY = 0 · CROSS_SCOPE_CHALLENGE_REPLAY = 0
 */
export async function openPaymentChallenge(input: {
  paymentIntentId: string;
  payerScopeId: string;
  definitionId: string;
  /** The provider's own reference for the payment needing action. */
  providerReference: string;
  url: string;
  ttlMs?: number;
  now?: Date;
}): Promise<PaymentChallenge> {
  const now = input.now ?? new Date();
  let origin: string;
  try {
    const parsed = new URL(input.url);
    if (parsed.protocol !== "https:") throw new Error("not https");
    // The same host rule a provider endpoint is held to, shared rather than
    // rewritten. A challenge is a place a PERSON is sent, so sending them
    // somewhere local is the one thing worse than sending them nowhere.
    assertNotLocal(parsed);
    origin = parsed.origin;
  } catch {
    // A challenge nobody can safely open is not a challenge. Refused rather
    // than stored, so no person is ever sent somewhere unchecked.
    throw new Error("A payment challenge must be a public https address.");
  }
  const state = `pch_${crypto.randomUUID()}`;
  const [session] = await db
    .insert(externalActionSessions)
    .values({
      id: crypto.randomUUID(),
      ownerId: input.payerScopeId,
      provider: input.definitionId,
      purpose: "payment_challenge",
      url: input.url,
      origin,
      nonce: crypto.randomUUID(),
      state,
      paymentIntentId: input.paymentIntentId,
      status: "active",
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_CHALLENGE_TTL_MS)),
    })
    .returning();
  return {
    challengeId: session!.id,
    paymentIntentId: input.paymentIntentId,
    url: input.url,
    state,
    expiresAt: session!.expiresAt,
    // The provider's reference is deliberately NOT returned to the caller's
    // surface: it belongs to the intent, which already persists it.
  } as PaymentChallenge & { providerReference?: never };
}

export type ChallengeReturn = {
  /** What the BROWSER did. The only thing a browser can establish. */
  readonly userLeg: "RETURNED";
  /** Always. A return is not a receipt.  */
  readonly paymentTruth: "UNCHANGED";
  readonly paymentIntentId: string;
};

/**
 * The person came back.
 *
 * That is the entire claim, and the only one a return can support. It moves no
 * payment state, reads no query parameter as a verdict, and believes nothing a
 * client body says. It consumes the session so the same return cannot be
 * replayed, and hands back the payment to reconcile — through the readback the
 * payment runtime already trusts and nothing else.
 *
 *   RETURN_URL_PAYMENT_SUCCESS_AUTHORITY = 0
 *   CLIENT_CHALLENGE_SUCCESS_SETTLES = 0
 *   3DS_SUCCESS_SCREEN != SETTLEMENT_PROOF
 *   SURFACE_CLOSED != PAYMENT_CANCELLED
 */
export async function completePaymentChallenge(input: {
  challengeId: string;
  state: string;
  payerScopeId: string;
  now?: Date;
}): Promise<ChallengeReturn> {
  const now = input.now ?? new Date();
  const [session] = await db
    .select()
    .from(externalActionSessions)
    .where(eq(externalActionSessions.id, input.challengeId))
    .limit(1);
  // Somebody else's challenge and a guessed id give the identical refusal.
  if (
    !session ||
    session.purpose !== "payment_challenge" ||
    session.ownerId !== input.payerScopeId ||
    session.state !== input.state ||
    session.status !== "active" ||
    !session.paymentIntentId
  ) {
    throw new Error("No such challenge.");
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    // An expired challenge authorises nothing, and its expiry is not a
    // failure either — only the provider can say the payment failed.
    throw new Error("That challenge has expired.");
  }
  await db
    .update(externalActionSessions)
    .set({ status: "used", usedAt: now })
    .where(eq(externalActionSessions.id, session.id));
  return {
    userLeg: "RETURNED",
    paymentTruth: "UNCHANGED",
    paymentIntentId: session.paymentIntentId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coming back, and what that is allowed to cause
// ─────────────────────────────────────────────────────────────────────────────

export type ChallengeContinuation = {
  /** What the browser did. Still the only thing a browser establishes. */
  readonly userLeg: "RETURNED";
  readonly paymentIntentId: string;
  /**
   * What the PROVIDER's own state turned out to be, through the readback the
   * payment runtime already trusts. `NO_ROUTE` and `PROVIDER_CHANGED` are
   * refusals to look, not findings about the money.
   */
  readonly outcome:
    | "RESOLVED_CAPTURED"
    | "RESOLVED_FAILED"
    | "STILL_INCONCLUSIVE"
    | "DISCREPANCY"
    | "NO_ROUTE"
    | "PROVIDER_CHANGED";
  /** The canonical status afterwards. Set by the payment runtime, not here. */
  readonly paymentStatus: string;
};

/**
 * THE PAYER CAME BACK. RECONCILE.
 *
 * ─── WHAT THIS FUNCTION CANNOT BE TOLD ──────────────────────────────────────
 *
 * Look at what it takes: a challenge id, its single-use state, and who is
 * returning. There is no parameter for a status, an amount, a currency, a
 * payee, a provider or a payment id — so a return carrying `success=true`,
 * `status=paid` or `amount=1` has nowhere to put any of it.
 *
 *   RETURN_QUERY_PAYMENT_STATUS_USED = 0 · RETURN_QUERY_AMOUNT_USED = 0
 *   RETURN_QUERY_CURRENCY_USED = 0 · RETURN_QUERY_PAYEE_USED = 0
 *   RETURN_QUERY_PROVIDER_USED = 0
 *   CLIENT_CAN_SWAP_PAYMENT_INTENT_AFTER_CHALLENGE = 0
 *   CLIENT_CAN_SWAP_PROVIDER_REFERENCE_AFTER_CHALLENGE = 0
 *
 * That is not a check. It is an absence, which is the only kind of guarantee a
 * browser cannot argue with.
 *
 * ─── AND WHAT IT DOES INSTEAD ───────────────────────────────────────────────
 *
 * Everything from canonical state. The consumed challenge names its payment;
 * the payment names its payer, its payee and — pinned on first execution — its
 * provider and its provider reference. The route is rebuilt from those, and
 * refused if it now resolves to a different provider than the one the payment
 * was executed on.
 *
 * Then `reconcilePaymentEffect` does the rest, exactly as it already did:
 * readback only, money re-matched, binding re-checked, discrepancy left
 * visible. This function moves no payment state of its own.
 *
 *   BROWSER_RETURN != PAYMENT_PROOF · RECONCILIATION_RETRY != PAYMENT_RETRY
 *   CHALLENGE_RETURN_SECOND_PAY_CALL = 0
 *
 * ─── AND WHY IT IS ONLY A CONVENIENCE ───────────────────────────────────────
 *
 * A payer who completes the provider's page and then closes the browser has
 * still paid. An authenticated provider event, or a later reconciliation,
 * establishes that without anybody returning anywhere.
 *
 *   BROWSER_RETURN_REQUIRED_FOR_PAYMENT_TRUTH = NO
 */
export async function resumePaymentAfterChallenge(input: {
  challengeId: string;
  state: string;
  payerScopeId: string;
  now?: Date;
}): Promise<ChallengeContinuation> {
  // Single-use, payer-bound, state-bound, expiry-checked. A second identical
  // return finds the session consumed and never reaches the provider.
  //
  //   CHALLENGE_REPLAY_TRIGGERS_SECOND_RECONCILIATION = 0
  const returned = await completePaymentChallenge({
    challengeId: input.challengeId,
    state: input.state,
    payerScopeId: input.payerScopeId,
    ...(input.now ? { now: input.now } : {}),
  });

  const [{ getPaymentIntent }, { reconcilePaymentEffect }, { paymentExecutionRoute }] =
    await Promise.all([
      import("./block3/payment-intents"),
      import("./block3/payment-execution"),
      import("./payment-route"),
    ]);

  const intent = await getPaymentIntent(db as never, returned.paymentIntentId);
  if (!intent) throw new Error("No such payment.");

  // Rebuilt from the payment, not from the return. The payer and the payee are
  // the intent's own, so no caller chooses whose rail is consulted.
  const routed = await paymentExecutionRoute({
    payable: { payeeRef: intent.payeeRef },
    payerScopeId: intent.ownerId,
  });
  if (routed.status !== "RESOLVED") {
    return {
      userLeg: "RETURNED",
      paymentIntentId: intent.id,
      outcome: "NO_ROUTE",
      paymentStatus: intent.status,
    };
  }
  // The payment was executed on a pinned provider. If the route now resolves
  // somewhere else — a binding revoked, a preference changed — that is a
  // refusal to look, not a verdict. Reading one provider's state to settle a
  // payment made at another is how a settlement gets attributed to the wrong
  // rail.
  if (routed.route.definitionId !== intent.providerRef) {
    return {
      userLeg: "RETURNED",
      paymentIntentId: intent.id,
      outcome: "PROVIDER_CHANGED",
      paymentStatus: intent.status,
    };
  }

  // No `providerReference` is passed: the durable one on the intent is the
  // only one reconciliation will read, and handing it a second one is how a
  // caller would point a readback at somebody else's payment.
  const reconciled = await reconcilePaymentEffect(db as never, routed.deps, {
    intentId: intent.id,
  });
  return {
    userLeg: "RETURNED",
    paymentIntentId: intent.id,
    outcome: reconciled.outcome,
    paymentStatus: reconciled.intent.status,
  };
}
