/**
 * WHAT EXACT CANONICAL OBLIGATION IS THIS PAYMENT SATISFYING?
 *
 *   NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH
 *
 *   COMMERCIAL_ORDER != PAYABLE_OBLIGATION
 *   PAYMENT_INTENT   != PAYMENT
 *   PAYMENT_AUTHORIZATION != SETTLEMENT
 *
 * A payment surface may not become executable because somebody selected
 * something and approved their own draft. The basis for paying is an OPEN
 * SETTLEMENT COMMITMENT that this scope OWES, on an OPEN TRANSACTION that the
 * agreement runtime produced — and nothing else may stand in for it.
 *
 * Every field the payment carries is read from that commitment here: the
 * amount, the currency and who is owed. None of them comes from the draft, the
 * offering projection, the presentation, the client payload or the model.
 *
 *   PAYMENT_AMOUNT_SOURCE    = CANONICAL_ACCEPTED_SETTLEMENT
 *   PAYMENT_CURRENCY_SOURCE  = CANONICAL_ACCEPTED_SETTLEMENT
 *   PAYMENT_RECIPIENT_SOURCE = CANONICAL_ACCEPTED_OBLIGATION
 *
 * There is no vocabulary of things here. What makes an obligation payable is
 * that somebody owes money on a live exchange, which is the same fact whether
 * what was exchanged was an hour, a room, a machine's time or a meal.
 *
 *   DOMAIN_PAYMENT_REQUIREMENT_TYPES_ADDED = 0
 */

import { and, eq, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { commitments, transactions } from "@db/schema-block2";

/**
 * One payable obligation, as the payment path must see it.
 *
 * `amountMinor` is exact integer minor units and `currency` is mandatory:
 * money is never a float and never a display string.
 */
export type PayableObligation = {
  readonly commitmentId: string;
  readonly transactionId: string;
  readonly amountMinor: string;
  readonly currency: string;
  /** Who is owed. Declared by the obligation, never inferred from a column name. */
  readonly payeeRef: string;
  readonly termKey: string;
};

export type PayableResolution =
  /** Exactly one. The only state from which a payment may be prepared. */
  | { readonly status: "RESOLVED"; readonly payable: PayableObligation }
  /** Nothing this scope owes on a live exchange. */
  | { readonly status: "NONE" }
  /** More than one, and choosing for somebody is not resolving. */
  | { readonly status: "AMBIGUOUS"; readonly candidates: readonly PayableObligation[] };

function money(value: unknown): { amountMinor: string; currency: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const amountMinor = record.amountMinor;
  const currency = record.currency;
  if (typeof amountMinor !== "string" || !/^[0-9]+$/u.test(amountMinor)) return null;
  if (BigInt(amountMinor) <= 0n) return null;
  if (typeof currency !== "string" || !currency.trim()) return null;
  return { amountMinor, currency: currency.trim() };
}

/**
 * Every obligation this ACTING SCOPE owes money on, across live exchanges.
 *
 * Scoped by who OWES, so a person's scope never sees an organization's
 * obligations and an organization's scope never sees a person's:
 *
 *   CROSS_SCOPE_PAYMENT_BINDING = 0
 *
 * A commitment is payable only while both it and its transaction are open. A
 * settled obligation, a cancelled exchange and an obligation belonging to
 * somebody else are all simply absent here rather than refused later.
 */
export async function payableObligationsFor(
  db: NodePgDatabase<any>,
  scopeId: string,
): Promise<readonly PayableObligation[]> {
  const rows = await db
    .select({
      commitmentId: commitments.id,
      transactionId: commitments.transactionId,
      settlement: commitments.settlement,
      beneficiaryActorId: commitments.beneficiaryActorId,
      termKey: commitments.termKey,
      transactionState: transactions.state,
    })
    .from(commitments)
    .innerJoin(transactions, eq(commitments.transactionId, transactions.id))
    .where(
      and(
        // Who OWES it. The obligation says so; nothing is inferred.
        eq(commitments.ownerId, scopeId),
        // PENDING is the one state in which an obligation is still owed and
        // nobody has claimed to have discharged it. An obligation somebody
        // already CLAIMED is deliberately excluded: paying it again because
        // the claim is not yet VERIFIED would be a second charge, and
        //
        //   CLAIMED_COMPLETE != VERIFIED_COMPLETE
        //
        // is a reason to verify, never a reason to pay twice.
        eq(commitments.state, "PENDING"),
        isNotNull(commitments.settlement),
        eq(transactions.state, "OPEN"),
      ),
    );

  const payable: PayableObligation[] = [];
  for (const row of rows) {
    const amount = money(row.settlement);
    // An obligation with no exact money is not a payable one. It is not an
    // error either — plenty of obligations are owed in something other than
    // money, and they belong to fulfillment, not to payment.
    if (!amount) continue;
    if (!row.transactionId || !row.beneficiaryActorId) continue;
    payable.push({
      commitmentId: row.commitmentId,
      transactionId: row.transactionId,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      payeeRef: row.beneficiaryActorId,
      termKey: row.termKey,
    });
  }
  return payable;
}

/**
 * Resolve the ONE obligation a payment would satisfy.
 *
 * When a reference names one, that one is used and it is still checked against
 * this scope's own payable set — a handle is a way of pointing at something,
 * never a reason to be allowed to pay it:
 *
 *   LIVING_OBJECT != PAYMENT_AUTHORITY
 *   LIVING_OBJECT != SETTLEMENT_TRUTH
 *
 * When none is named and more than one is owed, the answer is that more than
 * one is owed. Picking the first row, the newest row, or the one a draft
 * happens to mention would each be a guess:
 *
 *   AMBIGUOUS_PAYMENT_TARGET_GUESS = 0
 */
export async function resolvePayable(
  db: NodePgDatabase<any>,
  input: { scopeId: string; transactionRef?: string | undefined },
): Promise<PayableResolution> {
  const payable = await payableObligationsFor(db, input.scopeId);
  if (payable.length === 0) return { status: "NONE" };

  if (input.transactionRef) {
    const named = payable.find((entry) => entry.transactionId === input.transactionRef);
    // Naming something this scope does not owe money on is the same answer as
    // owing nothing: a refusal that distinguished them would say whose it is.
    return named ? { status: "RESOLVED", payable: named } : { status: "NONE" };
  }

  if (payable.length > 1) return { status: "AMBIGUOUS", candidates: payable };
  return { status: "RESOLVED", payable: payable[0]! };
}
