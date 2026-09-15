/**
 * Block 3 §33–§45 — trusted payment execution against a real PSP boundary.
 *
 * Rules honored here:
 * - §33/§35: effects run through the trusted path with JASIM-level
 *   idempotency (owner + intent + effect scope); replay never double-charges.
 * - §36: when effect truth is uncertain (transport lost after dispatch),
 *   the intent goes INCONCLUSIVE and only reconciliation evidence resolves
 *   it — never a blind retry, never a guessed outcome.
 * - §37–§38: provider callbacks/claims are EVIDENCE, never truth. The
 *   verifier compares any claim against the authoritative provider
 *   readback; "callback says CAPTURED, readback says NOT_CAPTURED" is
 *   NOT VERIFIED.
 * - §44–§45: a refund is a NEW financial effect producing NEW ledger
 *   entries; the original payment history is never rewritten.
 */

import { and, eq, sql } from "drizzle-orm";
import { economicLedgerEntries, paymentIntents, type PaymentIntentRecord } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import { revalidateDelegationGrant } from "../block2/delegation";
import { appendEconomicEntry } from "./economic-ledger";
import { consumeMandateBudget } from "./financial-mandate";
import { formatMoney, moneyOf } from "./money";
import {
  getPaymentIntent,
  transitionPaymentIntent,
  PaymentIntentError,
} from "./payment-intents";
import {
  PspRejectedError,
  PspUncertainEffectError,
  type PspClient,
  type PspPaymentView,
} from "./psp-client";

type PaymentExecutionErrorCode =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "MANDATE_REJECTED"
  | "PROVIDER_REJECTED"
  | "UNCERTAIN_EFFECT"
  | "NOT_VERIFIED"
  | "PROVIDER_BINDING";

export class PaymentExecutionError extends Error {
  readonly code: PaymentExecutionErrorCode;
  readonly intent?: PaymentIntentRecord;
  constructor(message: string, code: PaymentExecutionErrorCode, intent?: PaymentIntentRecord) {
    super(message);
    this.code = code;
    this.intent = intent;
  }
}

export type PaymentExecutionDeps = { psp: PspClient; providerRef?: string };

function moneyMatches(intent: PaymentIntentRecord, view: PspPaymentView): boolean {
  return view.amountMinor === intent.amountMinor && view.currency === intent.currency;
}

/**
 * Payment-to-intent correlation: a readback view attests truth for THIS
 * intent only if it is the exact provider payment requested (view.id), it was
 * created FOR this intent (view.reference = intent.id, set at authorize), and
 * it equals the reference already persisted on the intent when one exists.
 * Same-money payments belonging to other intents can never be attributed.
 */
function viewBindsToIntent(
  view: PspPaymentView,
  intent: PaymentIntentRecord,
  requestedReference: string,
): boolean {
  if (view.id !== requestedReference) return false;
  if (view.reference !== intent.id) return false;
  if (intent.providerReference && intent.providerReference !== requestedReference) return false;
  return true;
}

/**
 * Provider-identity binding (cross-provider attribution guard). A trusted
 * provider identity is MANDATORY before any provider round trip: no
 * unidentified client may execute, capture, settle, reconcile, or refund.
 * executePaymentEffect is the binding ceremony — the first execution claim
 * atomically binds the intent to the executing provider; every other path
 * requires the binding to already exist and match exactly.
 */
function providerBindingViolation(
  intent: PaymentIntentRecord,
  deps: PaymentExecutionDeps,
  opts: { allowBind: boolean },
): string | null {
  if (!deps.providerRef) {
    return "A trusted provider identity is required before any provider round trip";
  }
  if (!intent.providerRef) {
    return opts.allowBind ? null : "Payment intent has no provider binding";
  }
  if (deps.providerRef !== intent.providerRef) {
    return `Provider identity mismatch: intent is bound to ${intent.providerRef}, not ${deps.providerRef}`;
  }
  return null;
}

async function markInconclusive(db: Block2Db, intent: PaymentIntentRecord): Promise<PaymentIntentRecord> {
  try {
    return await transitionPaymentIntent(db, { id: intent.id, to: "INCONCLUSIVE" });
  } catch {
    // Already inconclusive or racing — re-read truth.
    const current = await getPaymentIntent(db, intent.id);
    return current ?? intent;
  }
}

/**
 * Truth application — INTERNAL to this module. A status asserting a provider
 * effect is written ONLY after an authoritative readback of that provider
 * state whose money matches the mandate. There is no exported API that turns
 * caller-constructed evidence into payment truth.
 */
const TRUTH_SOURCES: Record<"CAPTURED" | "SETTLED" | "FAILED", readonly string[]> = {
  CAPTURED: ["EXECUTING", "PROVIDER_AUTHORIZED", "INCONCLUSIVE"],
  SETTLED: ["CAPTURED"],
  FAILED: ["EXECUTING", "PROVIDER_AUTHORIZED", "INCONCLUSIVE"],
};

async function applyTruthStatus(
  db: Block2Db,
  input: { intentId: string; status: "CAPTURED" | "SETTLED" | "FAILED"; view?: PspPaymentView },
): Promise<PaymentIntentRecord> {
  const current = await getPaymentIntent(db, input.intentId);
  if (!current) throw new PaymentExecutionError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  if (current.status === input.status) return current; // idempotent replay
  if (!TRUTH_SOURCES[input.status].includes(current.status)) {
    throw new PaymentExecutionError(`Cannot record ${input.status} from state ${current.status}`, "INVALID_STATE", current);
  }
  const [updated] = await db
    .update(paymentIntents)
    .set({
      status: input.status,
      ...(input.view ? { providerReference: input.view.id } : {}),
      version: sql`${paymentIntents.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(paymentIntents.id, current.id), eq(paymentIntents.version, current.version)))
    .returning();
  if (!updated) {
    const raced = await getPaymentIntent(db, input.intentId);
    if (raced?.status === input.status) return raced;
    throw new PaymentExecutionError("Concurrent truth application conflicted", "INVALID_STATE", current);
  }
  return updated;
}

/**
 * Apply CAPTURED truth derived ONLY from an authoritative provider readback.
 * Callers supply a provider REFERENCE, never evidence: the provider boundary
 * decides whether the capture exists and its money matches the mandate.
 */
export async function applyProviderCapture(
  db: Block2Db,
  deps: PaymentExecutionDeps,
  input: { intentId: string; providerReference: string },
): Promise<PaymentIntentRecord> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new PaymentExecutionError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  const bindingViolation = providerBindingViolation(intent, deps, { allowBind: false });
  if (bindingViolation) throw new PaymentExecutionError(bindingViolation, "PROVIDER_BINDING", intent);
  const view = await deps.psp.readback(input.providerReference);
  if (!view || view.status !== "CAPTURED" || !moneyMatches(intent, view)) {
    throw new PaymentExecutionError("Provider readback does not attest this capture", "NOT_VERIFIED", intent);
  }
  if (!viewBindsToIntent(view, intent, input.providerReference)) {
    throw new PaymentExecutionError("Provider readback is not bound to this payment intent", "NOT_VERIFIED", intent);
  }
  return applyTruthStatus(db, { intentId: intent.id, status: "CAPTURED", view });
}

/** Apply SETTLED truth derived ONLY from an authoritative provider readback. */
export async function applyProviderSettlement(
  db: Block2Db,
  deps: PaymentExecutionDeps,
  input: { intentId: string; providerReference: string },
): Promise<PaymentIntentRecord> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new PaymentExecutionError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  const bindingViolation = providerBindingViolation(intent, deps, { allowBind: false });
  if (bindingViolation) throw new PaymentExecutionError(bindingViolation, "PROVIDER_BINDING", intent);
  const view = await deps.psp.readback(input.providerReference);
  if (!view || view.status !== "SETTLED" || !moneyMatches(intent, view)) {
    throw new PaymentExecutionError("Provider readback does not attest this settlement", "NOT_VERIFIED", intent);
  }
  if (!viewBindsToIntent(view, intent, input.providerReference)) {
    throw new PaymentExecutionError("Provider readback is not bound to this payment intent", "NOT_VERIFIED", intent);
  }
  return applyTruthStatus(db, { intentId: intent.id, status: "SETTLED", view });
}

/**
 * Execute a payment intent (authorize + capture) against the PSP.
 * Optional mandate enforcement consumes the grant budget atomically FIRST —
 * a rejected mandate never reaches the provider.
 */
export async function executePaymentEffect(
  db: Block2Db,
  deps: PaymentExecutionDeps,
  input: { intentId: string; grantId?: string | null; delegateId?: string | null; attemptId?: string | null },
): Promise<{ outcome: "CAPTURED" | "FAILED" | "INCONCLUSIVE"; intent: PaymentIntentRecord; providerReference?: string }> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new PaymentExecutionError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  if (intent.status !== "CREATED" && intent.status !== "REQUIRES_APPROVAL") {
    // Idempotent replay: the effect was already decided — return truth.
    if (["EXECUTING", "PROVIDER_AUTHORIZED", "CAPTURED", "SETTLED", "INCONCLUSIVE"].includes(intent.status)) {
      return { outcome: intent.status === "CAPTURED" ? "CAPTURED" : "INCONCLUSIVE", intent };
    }
    throw new PaymentExecutionError(`Payment intent is ${intent.status}`, "INVALID_STATE", intent);
  }

  // 1) Claim execution FIRST (CAS on the intent row): exactly one caller
  //    wins, so no mandate budget is ever consumed by a losing race.
  let executing: PaymentIntentRecord;
  try {
    executing = await transitionPaymentIntent(db, { id: intent.id, to: "EXECUTING" });
  } catch (error) {
    if (error instanceof PaymentIntentError && error.code === "VERSION_CONFLICT") {
      const current = await getPaymentIntent(db, intent.id);
      if (current && current.status !== "CREATED") return { outcome: "INCONCLUSIVE", intent: current };
    }
    throw error;
  }

  // 2) Revalidate the FULL grant at execution time (INC-3): revocation,
  //    expiry, delegate identity, purpose, monetary ceiling, and
  //    payee/provider/method/currency constraints are rechecked HERE — a
  //    stale or revoked grant never dispatches an effect.
  if (input.grantId) {
    const revalidation = await revalidateDelegationGrant(db, {
      grantId: input.grantId,
      delegateId: input.delegateId ?? "",
      capability: "pay",
      purpose: intent.purpose,
      resourceRef: { kind: "payment_intent", id: intent.id },
      monetaryAmountExact: formatMoney(moneyOf(intent.amountMinor, intent.currency)),
      context: {
        currency: intent.currency,
        payeeRef: intent.payeeRef,
        providerRef: deps.providerRef,
        paymentMethodRef: intent.paymentMethodRef ?? undefined,
      },
    });
    if (!revalidation.ok) {
      const failed = await transitionPaymentIntent(db, { id: intent.id, to: "FAILED" });
      throw new PaymentExecutionError(
        `Mandate rejected: ${revalidation.code} — ${revalidation.reason}`,
        "MANDATE_REJECTED",
        failed,
      );
    }
    const consumption = await consumeMandateBudget(db, {
      grantId: input.grantId,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
    });
    if (consumption.outcome === "REJECTED") {
      const failed = await transitionPaymentIntent(db, { id: intent.id, to: "FAILED" });
      throw new PaymentExecutionError(`Mandate rejected: ${consumption.reason}`, "MANDATE_REJECTED", failed);
    }
  }

  // 3) Provider identity is MANDATORY before any provider round trip. The
  //    first execution claim is the binding ceremony: an unbound intent is
  //    atomically bound to the executing provider; a bound intent must match.
  const bindingViolation = providerBindingViolation(intent, deps, { allowBind: true });
  if (bindingViolation) {
    const failed = await transitionPaymentIntent(db, { id: intent.id, to: "FAILED" });
    throw new PaymentExecutionError(bindingViolation, "PROVIDER_BINDING", failed);
  }
  if (!intent.providerRef) {
    await db
      .update(paymentIntents)
      .set({ providerRef: deps.providerRef!, updatedAt: new Date() })
      .where(eq(paymentIntents.id, intent.id));
  }

  try {
    const authorized = await deps.psp.authorize({
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      reference: intent.id,
      idempotencyKey: intent.idempotencyKey,
    });
    // Persist the provider reference the moment it exists — crash recovery
    // must reconcile from durable state, never from memory.
    await db
      .update(paymentIntents)
      .set({ providerReference: authorized.id, updatedAt: new Date() })
      .where(eq(paymentIntents.id, intent.id));
    if (!moneyMatches(intent, authorized)) {
      // Provider authorized different money than mandated — truth unknown.
      const inconclusive = await markInconclusive(db, executing);
      return { outcome: "INCONCLUSIVE", intent: inconclusive, providerReference: authorized.id };
    }
    let captured: PspPaymentView;
    try {
      captured = await deps.psp.capture(authorized.id);
    } catch (error) {
      if (error instanceof PspUncertainEffectError) {
        const inconclusive = await markInconclusive(db, executing);
        throw new PaymentExecutionError(
          "Capture effect uncertain — INCONCLUSIVE pending reconciliation",
          "UNCERTAIN_EFFECT",
          inconclusive,
        );
      }
      throw error;
    }
    if (!moneyMatches(intent, captured) || captured.status !== "CAPTURED") {
      const inconclusive = await markInconclusive(db, executing);
      return { outcome: "INCONCLUSIVE", intent: inconclusive, providerReference: captured.id };
    }
    // The capture RESPONSE is still only a claim: truth is confirmed by an
    // authoritative readback of the provider's canonical state before
    // anything is recorded.
    const truth = await deps.psp.readback(captured.id);
    if (
      !truth || truth.status !== "CAPTURED" || !moneyMatches(intent, truth)
      || !viewBindsToIntent(truth, intent, captured.id)
    ) {
      const inconclusive = await markInconclusive(db, executing);
      return { outcome: "INCONCLUSIVE", intent: inconclusive, providerReference: captured.id };
    }
    const done = await applyTruthStatus(db, { intentId: executing.id, status: "CAPTURED", view: truth });
    return { outcome: "CAPTURED", intent: done, providerReference: captured.id };
  } catch (error) {
    if (error instanceof PaymentExecutionError) throw error;
    if (error instanceof PspUncertainEffectError) {
      const inconclusive = await markInconclusive(db, executing);
      throw new PaymentExecutionError("Provider effect uncertain — INCONCLUSIVE", "UNCERTAIN_EFFECT", inconclusive);
    }
    if (error instanceof PspRejectedError) {
      const failed = await transitionPaymentIntent(db, { id: executing.id, to: "FAILED" });
      throw new PaymentExecutionError(`Provider rejected: ${error.message}`, "PROVIDER_REJECTED", failed);
    }
    throw error;
  }
}

/**
 * Reconcile an INCONCLUSIVE intent using ONLY authoritative readback (§36).
 * No blind retry of the charge; the readback decides the truth.
 */
export async function reconcilePaymentEffect(
  db: Block2Db,
  deps: PaymentExecutionDeps,
  input: { intentId: string; providerReference?: string },
): Promise<{ outcome: "RESOLVED_CAPTURED" | "RESOLVED_FAILED" | "STILL_INCONCLUSIVE" | "DISCREPANCY"; intent: PaymentIntentRecord }> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new PaymentExecutionError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  if (intent.status !== "INCONCLUSIVE") return { outcome: "STILL_INCONCLUSIVE", intent };
  // Provider identity must exist and match the durable binding before any
  // readback.
  if (providerBindingViolation(intent, deps, { allowBind: false })) return { outcome: "DISCREPANCY", intent };

  // Reconcile ONLY the durably bound provider reference: a caller-claimed
  // different payment is a visible discrepancy, never silently adopted.
  const reference = intent.providerReference ?? input.providerReference;
  if (!reference) return { outcome: "STILL_INCONCLUSIVE", intent };
  if (input.providerReference && intent.providerReference && input.providerReference !== intent.providerReference) {
    return { outcome: "DISCREPANCY", intent };
  }
  const view = await deps.psp.readback(reference);
  if (!view) return { outcome: "STILL_INCONCLUSIVE", intent };
  if (view.status === "CAPTURED" && moneyMatches(intent, view) && viewBindsToIntent(view, intent, reference)) {
    // The readback IS the evidence — truth applied from the provider's
    // canonical state, money AND intent binding re-validated.
    const resolved = await applyTruthStatus(db, { intentId: intent.id, status: "CAPTURED", view });
    return { outcome: "RESOLVED_CAPTURED", intent: resolved };
  }
  if ((view.status === "AUTHORIZED" || view.status === "FAILED") && viewBindsToIntent(view, intent, reference)) {
    // Definitive readback evidence the capture never happened.
    const resolved = await applyTruthStatus(db, { intentId: intent.id, status: "FAILED", view });
    return { outcome: "RESOLVED_FAILED", intent: resolved };
  }
  // Amount/currency/binding disagree — discrepancy stays visible, never hidden.
  return { outcome: "DISCREPANCY", intent };
}

/**
 * The payment truth verifier (§37–§38): any provider claim (callback,
 * response body, UI redirect) is EVIDENCE and is verified ONLY against the
 * authoritative readback of canonical state.
 */
export async function verifyPaymentClaim(
  db: Block2Db,
  deps: PaymentExecutionDeps,
  input: {
    intentId: string;
    providerReference: string;
    claim: { status: string; amountMinor?: string; currency?: string };
  },
): Promise<{ verified: boolean; reason: string; authoritativeStatus?: string }> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) return { verified: false, reason: "Unknown payment intent" };
  const view = await deps.psp.readback(input.providerReference);
  if (!view) return { verified: false, reason: "No authoritative provider state" };
  const claimAmount = input.claim.amountMinor ?? intent.amountMinor;
  const claimCurrency = input.claim.currency ?? intent.currency;
  const claimConsistent = claimAmount === intent.amountMinor && claimCurrency === intent.currency;
  const authoritativeConsistent = moneyMatches(intent, view);

  // The mandatory case: claim says CAPTURED, readback says otherwise.
  if (input.claim.status === "CAPTURED" && view.status !== "CAPTURED") {
    return { verified: false, reason: "Claim CAPTURED but authoritative readback disagrees", authoritativeStatus: view.status };
  }
  if (!claimConsistent || !authoritativeConsistent) {
    return { verified: false, reason: "Amount/currency evidence disagrees with the mandate", authoritativeStatus: view.status };
  }
  if (input.claim.status !== view.status) {
    return { verified: false, reason: `Claim ${input.claim.status} ≠ readback ${view.status}`, authoritativeStatus: view.status };
  }
  return { verified: true, reason: "Claim matches authoritative provider state", authoritativeStatus: view.status };
}

/**
 * Refund = a NEW financial effect (§45). The original intent history is
 * never rewritten; a REFUND ledger entry (negative value) is appended.
 */
export async function refundPaymentEffect(
  db: Block2Db,
  deps: PaymentExecutionDeps,
  input: { intentId: string; idempotencyKey: string; providerReference?: string; now?: Date },
): Promise<{ outcome: "REFUNDED"; ledgerEntryId: string }> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new PaymentExecutionError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  if (intent.status !== "CAPTURED" && intent.status !== "SETTLED") {
    throw new PaymentExecutionError(`Cannot refund a payment in state ${intent.status}`, "INVALID_STATE", intent);
  }
  const bindingViolation = providerBindingViolation(intent, deps, { allowBind: false });
  if (bindingViolation) throw new PaymentExecutionError(bindingViolation, "PROVIDER_BINDING", intent);
  const providerReference = input.providerReference ?? intent.providerReference;
  if (!providerReference) {
    throw new PaymentExecutionError("Provider reference required for refund", "INVALID_STATE", intent);
  }

  // JASIM-level idempotency FIRST: a replayed refund effect never reaches
  // the provider twice (DOUBLE_REFUNDS=0), even across process restarts.
  const [existing] = await db
    .select()
    .from(economicLedgerEntries)
    .where(and(eq(economicLedgerEntries.ownerId, intent.ownerId), eq(economicLedgerEntries.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) return { outcome: "REFUNDED", ledgerEntryId: existing.id };

  let refunded: PspPaymentView;
  try {
    // The idempotency key travels to the provider, so a provider-side replay
    // can never double-refund even if both JASIM checks are raced.
    refunded = await deps.psp.refund(providerReference, input.idempotencyKey);
  } catch (error) {
    if (error instanceof PspRejectedError || error instanceof PspUncertainEffectError) {
      // Possible crash-after-effect: the provider may have already refunded.
      // Recover truth via authoritative readback instead of blind retry.
      const view = await deps.psp.readback(providerReference);
      if (view?.status === "REFUNDED" && moneyMatches(intent, view) && viewBindsToIntent(view, intent, providerReference)) {
        refunded = view;
      } else if (error instanceof PspUncertainEffectError) {
        throw new PaymentExecutionError("Refund effect uncertain — reconcile via readback", "UNCERTAIN_EFFECT", intent);
      } else {
        throw new PaymentExecutionError(`Provider rejected refund: ${error.message}`, "PROVIDER_REJECTED", intent);
      }
    } else {
      throw error;
    }
  }
  if (!moneyMatches(intent, refunded)) {
    throw new PaymentExecutionError("Refund amount/currency disagrees with the mandate", "NOT_VERIFIED", intent);
  }
  const { entry } = await appendEconomicEntry(db, {
    ownerId: intent.ownerId,
    kind: "REFUND",
    party: intent.payerRef,
    amountMinor: `-${intent.amountMinor}`,
    currency: intent.currency,
    sourceEventType: "PAYMENT_REFUND_VERIFIED",
    sourceId: intent.id,
    attemptId: null,
    paymentIntentId: intent.id,
    idempotencyKey: input.idempotencyKey,
    meta: { providerReference },
    now: input.now,
  });
  return { outcome: "REFUNDED", ledgerEntryId: entry.id };
}

/** Test/inspection helper: current intents for an owner. */
export async function listPaymentIntents(db: Block2Db, ownerId: string) {
  return db.select().from(paymentIntents).where(eq(paymentIntents.ownerId, ownerId));
}
