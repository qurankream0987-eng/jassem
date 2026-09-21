/**
 * JASIM — THE GENERAL TRANSACTION AND FULFILLMENT RUNTIME.
 *
 * ─── THE CHAIN, KEPT SEPARATE ───────────────────────────────────────────────
 *
 *   OPPORTUNITY != PROPOSAL != AGREEMENT != COMMITMENT != TRANSACTION
 *   TRANSACTION != PAYMENT  != FULFILLMENT != VERIFICATION
 *
 *   ACCEPTED OFFER  != EXECUTED TRANSACTION
 *   PAID            != DELIVERED
 *   PROVIDER RECEIPT != VERIFIED FULFILLMENT
 *
 * Eight different facts. A runtime that collapses any adjacent pair is a
 * runtime that can tell somebody their goods arrived because a card cleared.
 *
 * ─── NOT A COMMERCE VERTICAL ────────────────────────────────────────────────
 *
 * There is no buyer column and no seller column. `parties` is a list, and an
 * Actor is a buyer in one transaction and a provider in the next — which is
 * the open market law, expressed as the absence of two fields.
 *
 * There is no `PurchaseTransaction` and no `RentalTransaction`. Goods, six
 * hours of laboratory time, warehouse pallets, a translation and a fabrication
 * job are the same row differing in a term key nothing here reads.
 *
 *   DOMAIN_TRANSACTION_TYPES_ADDED    = 0
 *   DOMAIN_FULFILLMENT_TYPES_ADDED    = 0
 *   DOMAIN_TRANSACTION_HANDLERS_ADDED = 0
 *
 * ─── AN OBLIGATION IS A COMMITMENT ──────────────────────────────────────────
 *
 * No `obligations` table was created, because one already existed under
 * another name: a Commitment is what an Agreement produces from a term that
 * declared who owes what. It gained a beneficiary, the evidence that would
 * prove it, and a link to the transaction. Two tables meaning the same thing
 * is how a system comes to have two answers.
 *
 * ─── WHAT SETTLES AN OBLIGATION ─────────────────────────────────────────────
 *
 *   CLAIMED_COMPLETE != VERIFIED_COMPLETE
 *
 * A term declares an evidence kind from the completion policy's own closed set,
 * and settlement runs the SAME `decideCompletion` every capability's effect
 * runs through, over Observations recorded by the SAME bridge. There is no
 * fulfillment verifier, per domain or otherwise.
 *
 *   DOMAIN_FULFILLMENT_VERIFIERS = 0
 *
 * ─── AND WHAT THE TRANSACTION'S STATE IS ────────────────────────────────────
 *
 * Derived from its obligations, always, and never written. A payment verified
 * while a delivery is pending is an OPEN transaction, and the one thing this
 * file exists to make impossible is for it to read as anything else.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  commitments,
  events,
  paymentIntents,
  transactions,
  type Agreement,
  type Commitment,
  type Transaction,
} from "../../db/schema";
import { termSheetOf, type Term, type TermSheet } from "./agreement-runtime";
import {
  COMPLETION_POLICIES,
  decideCompletion,
  type EffectAssertion,
  type EffectKind,
} from "./completion-policy";
import { resolveCompensationPolicy } from "./compensation-policy";
import { observationEvidence } from "./effect-observation-bridge";
import { disclosableDecision, evaluatePolicies } from "./policy-enforcement";
import { createPaymentIntent } from "./block3/payment-intents";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, and naming no domain
// ─────────────────────────────────────────────────────────────────────────────

/** Derived, never asserted. Nothing in this module writes SETTLED directly. */
export const TRANSACTION_STATES = [
  /** At least one required obligation is not yet verified. */
  "OPEN",
  /** Every required obligation is VERIFIED. */
  "SETTLED",
  /** An obligation definitively failed and nothing compensates it yet. */
  "FAILED",
  /** Ended before any irreversible effect. */
  "CANCELLED",
  /** An effect occurred and a compensating effect is owed. */
  "COMPENSATING",
] as const;
export type TransactionState = (typeof TRANSACTION_STATES)[number];

/** What the world is SAID to have done. Not what JASIM can prove. */
export const OBLIGATION_STATES = [
  "PENDING",
  "IN_PROGRESS",
  /** Somebody says it is done. This is a claim and nothing more. */
  "CLAIMED",
  "FAILED",
  "CANCELLED",
] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

/** What JASIM can prove, in the verifier's own vocabulary. */
export const OBLIGATION_VERIFICATIONS = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "INCONCLUSIVE",
] as const;
export type ObligationVerification = (typeof OBLIGATION_VERIFICATIONS)[number];

export class TransactionError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "INVALID"
    | "POLICY"
    | "IMMUTABLE"
    | "STATE";
  constructor(message: string, code: TransactionError["code"]) {
    super(message);
    this.code = code;
    this.name = "TransactionError";
  }
}

/**
 * Words a caller may never say about a transaction.
 *
 * Every one is a fact this runtime establishes from evidence. A model that
 * could set `fulfilled` would deliver by describing.
 */
export const TRANSACTION_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "transactionid",
  "settled",
  "fulfilled",
  "verified",
  "verification",
  "paid",
  "captured",
  "receipt",
  "paymentreceipt",
  "providertrust",
  "obligationstate",
]);

export function assertNoTransactionAuthorityClaim(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (TRANSACTION_AUTHORITY_KEYS.has(key.trim().toLowerCase())) {
      throw new TransactionError(
        `«${key}» states an outcome the runtime establishes from evidence; it cannot be supplied in ${label}.`,
        "INVALID",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot
// ─────────────────────────────────────────────────────────────────────────────

function canonical(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return "null";
}

/** The committed facts, fingerprinted, so a later edit is a visible mismatch. */
export function termsDigest(terms: TermSheet): string {
  return createHash("sha256").update(canonical(terms)).digest("hex");
}

/**
 * The scalar facts of a term sheet, by the ONE dotted-path convention.
 *
 *   A FACT THAT IS DISPLAYED MUST BE THE FACT THAT IS COMPARED.
 *
 * `terms.price = 95` and `units.price = "KWD"` are two facts. A policy that
 * compared «95 KWD» to 100 would silently never match, and a rule that
 * silently never matches is worse than one that errors.
 */
export function transactionFacts(terms: TermSheet): Record<string, unknown> {
  return {
    terms: Object.fromEntries(terms.map((term) => [term.key, term.value])),
    units: Object.fromEntries(
      terms.filter((term) => term.unit).map((term) => [term.key, term.unit!]),
    ),
    settlements: Object.fromEntries(
      terms
        .filter((term) => term.settlement)
        .map((term) => [term.key, Number(term.settlement!.amountMinor)]),
    ),
    currencies: Object.fromEntries(
      terms
        .filter((term) => term.settlement)
        .map((term) => [term.key, term.settlement!.currency]),
    ),
    obligationCount: terms.filter((term) => term.owedBy).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialization
// ─────────────────────────────────────────────────────────────────────────────

async function appendTransactionEvent(input: {
  scopeId: string;
  type: string;
  transactionId: string;
  message: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  // Append-only, owner-scoped, ordered by the table's own serial id — which is
  // the cursor a future realtime subscriber resumes from. Nothing here is a
  // verdict a client could mistake for one; it records that a fact changed.
  await db.insert(events).values({
    type: input.type,
    source: "runtime",
    ownerId: input.scopeId,
    message: input.message,
    payload: { transactionId: input.transactionId, ...input.payload },
  });
}

/**
 * A committed Agreement becomes exactly one Transaction.
 *
 * Idempotent by construction: the unique index on `agreementId` is what makes
 * a double click, a retry and a replayed turn lose the race rather than create
 * a second transaction. No compare-and-set dance, because the database already
 * knows how to hold one row.
 *
 * Called from `commitAgreement`, so there is no separate decision to make and
 * no second approval to invent: the person who agreed is the person who
 * committed.
 */
export async function materializeTransaction(input: {
  agreement: Agreement;
  scopeId: string;
  commitments: readonly Commitment[];
  origin?: Record<string, unknown>;
  now?: Date;
}): Promise<{ transaction: Transaction; created: boolean }> {
  const terms = termSheetOf(input.agreement.terms, "committed terms");
  const parties = [...input.agreement.participants];

  // ── The scope's own rules, at the transaction boundary ──────────────────
  //
  // The same one function `agreement.commit` consulted, asked a different
  // question. A rule may permit agreeing and still forbid executing.
  const decision = await evaluatePolicies({
    scopeId: input.scopeId,
    action: "transaction.execute",
    parameters: transactionFacts(terms),
    resourceRefs: { agreementId: input.agreement.id, partyCount: parties.length },
    ...(input.now ? { now: input.now } : {}),
  });
  if (decision.outcome !== "ALLOWED") {
    throw new TransactionError(
      decision.outcome === "REQUIRES_APPROVAL"
        ? "A policy of this scope requires a person to approve executing this."
        : decision.outcome === "UNSUPPORTED_POLICY"
          ? "This scope carries a policy that cannot be evaluated, so nothing executes under it."
          : "A policy of this scope forbids executing this.",
      "POLICY",
    );
  }

  const [row] = await db
    .insert(transactions)
    .values({
      id: `txn_${randomUUID()}`,
      scopeId: input.scopeId,
      parties,
      agreementId: input.agreement.id,
      proposalId: input.agreement.proposalId,
      engagementId: input.agreement.engagementId,
      termsSnapshot: { terms } as unknown as Record<string, unknown>,
      termsDigest: termsDigest(terms),
      origin: input.origin ?? { source: "INTERNAL_EXCHANGE" },
      authorityBasis: input.agreement.authorityBasis,
      policyDecision: disclosableDecision(decision),
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Somebody else got there first. That is the correct outcome, and the
    // existing row is the answer rather than an error.
    const [existing] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.agreementId, input.agreement.id))
      .limit(1);
    if (!existing) {
      throw new TransactionError("The transaction was lost between insert and read.", "STATE");
    }
    return { transaction: existing, created: false };
  }

  await bindObligations({ transaction: row, terms, commitments: input.commitments });
  await appendTransactionEvent({
    scopeId: input.scopeId,
    type: "TRANSACTION_MATERIALIZED",
    transactionId: row.id,
    message: "A committed agreement became a transaction.",
    payload: { agreementId: input.agreement.id, parties: parties.length },
  });
  return { transaction: row, created: true };
}

/**
 * Turn the agreement's commitments into the transaction's obligations.
 *
 * Nothing is inferred. `owedBy` came from the term; `owedTo` came from the term
 * or — with exactly two parties — is the other one, which is determinate rather
 * than a guess. Evidence defaults to `HUMAN_ACTION`, the strictest kind, so
 * forgetting to declare it can never make an obligation easier to settle.
 */
async function bindObligations(input: {
  transaction: Transaction;
  terms: TermSheet;
  commitments: readonly Commitment[];
}): Promise<void> {
  const byKey = new Map(input.terms.map((term) => [term.key, term]));
  for (const commitment of input.commitments) {
    const term = byKey.get(commitment.termKey);
    if (!term) continue;
    await db
      .update(commitments)
      .set({
        transactionId: input.transaction.id,
        beneficiaryActorId: beneficiaryOf(term, input.transaction.parties),
        evidenceKind: term.evidence ?? "HUMAN_ACTION",
        ...(term.subjectKind ? { subjectKind: term.subjectKind } : {}),
        ...(term.subjectId ? { subjectId: term.subjectId } : {}),
        ...(term.settlement ? { settlement: term.settlement } : {}),
        terms: {
          key: term.key,
          value: term.value,
          ...(term.unit ? { unit: term.unit } : {}),
        },
        state: "PENDING",
        verification: "PENDING",
        updatedAt: new Date(),
      })
      .where(eq(commitments.id, commitment.id));
  }
}

/**
 * Who an obligation is owed to.
 *
 * Declared, or — with exactly two parties — the other one, which is
 * determinate. With three, there is no "other party" to be determinate about,
 * and guessing which of two beneficiaries a term meant would be the runtime
 * deciding who gets paid.
 *
 *   AMBIGUOUS_MULTI_PARTY_BENEFICIARY = REJECTED
 */
function beneficiaryOf(term: Term, parties: readonly string[]): string {
  if (term.owedTo) {
    if (!parties.includes(term.owedTo)) {
      throw new TransactionError(
        `«${term.key}» is owed to somebody who is not a party to this transaction.`,
        "INVALID",
      );
    }
    return term.owedTo;
  }
  const others = parties.filter((party) => party !== term.owedBy);
  if (others.length !== 1) {
    throw new TransactionError(
      `«${term.key}» does not say who it is owed to, and with ${parties.length} parties there is no "other party" to infer.`,
      "INVALID",
    );
  }
  return others[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

async function requireParty(transactionId: string, actorId: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  if (!row) throw new TransactionError("Transaction not found.", "NOT_FOUND");
  if (!row.parties.includes(actorId) && row.scopeId !== actorId) {
    throw new TransactionError("Not a party to this transaction.", "FORBIDDEN");
  }
  return row;
}

export async function obligationsOf(transactionId: string): Promise<readonly Commitment[]> {
  return db
    .select()
    .from(commitments)
    .where(eq(commitments.transactionId, transactionId))
    .orderBy(asc(commitments.createdAt));
}

/**
 * The transaction's state, derived from its obligations every time it is asked.
 *
 * `payment verified, delivery pending` is OPEN. That sentence is the reason
 * this function exists and the reason nothing may write `state` by hand.
 */
export function deriveTransactionState(
  obligations: readonly Commitment[],
  current: TransactionState = "OPEN",
): TransactionState {
  if (current === "CANCELLED" || current === "COMPENSATING") return current;
  if (obligations.length === 0) return current;
  if (obligations.some((obligation) => obligation.verification === "FAILED")) return "FAILED";
  if (obligations.some((obligation) => obligation.state === "FAILED")) return "FAILED";
  return obligations.every((obligation) => obligation.verification === "VERIFIED")
    ? "SETTLED"
    : "OPEN";
}

async function refreshTransactionState(transaction: Transaction): Promise<Transaction> {
  const obligations = await obligationsOf(transaction.id);
  const next = deriveTransactionState(obligations, transaction.state as TransactionState);
  if (next === transaction.state) return transaction;
  const [updated] = await db
    .update(transactions)
    .set({ state: next, updatedAt: new Date(), version: transaction.version + 1 })
    .where(and(eq(transactions.id, transaction.id), eq(transactions.version, transaction.version)))
    .returning();
  if (updated) {
    await appendTransactionEvent({
      scopeId: transaction.scopeId,
      type: "TRANSACTION_STATE_CHANGED",
      transactionId: transaction.id,
      message: `The transaction moved from ${transaction.state} to ${next}.`,
      payload: { from: transaction.state, to: next },
    });
  }
  return updated ?? transaction;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fulfillment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Somebody says an obligation is done.
 *
 * This is a CLAIM and is recorded as one. It moves `state`, never
 * `verification`, and a party claiming their own obligation is exactly the
 * thing the two columns exist to keep apart.
 */
export async function claimObligation(input: {
  obligationId: string;
  actorId: string;
  note?: string;
}): Promise<Commitment> {
  const [obligation] = await db
    .select()
    .from(commitments)
    .where(eq(commitments.id, input.obligationId))
    .limit(1);
  if (!obligation || !obligation.transactionId) {
    throw new TransactionError("Obligation not found.", "NOT_FOUND");
  }
  // Only the party who owes it may claim it. Nobody claims on another's
  // behalf, and claiming somebody else's obligation done is not a kindness.
  if (obligation.ownerId !== input.actorId) {
    throw new TransactionError("Only the party who owes an obligation may claim it.", "FORBIDDEN");
  }
  if (obligation.state === "CANCELLED") {
    throw new TransactionError("A cancelled obligation cannot be claimed.", "STATE");
  }
  const [updated] = await db
    .update(commitments)
    .set({ state: "CLAIMED", updatedAt: new Date() })
    .where(eq(commitments.id, obligation.id))
    .returning();
  await appendTransactionEvent({
    scopeId: input.actorId,
    type: "OBLIGATION_CLAIMED",
    transactionId: obligation.transactionId,
    message: "A party says an obligation is complete. Nothing has verified it.",
    payload: { obligationId: obligation.id, termKey: obligation.termKey },
  });
  return updated!;
}

/**
 * What JASIM can prove, from Observations, through the one completion policy.
 *
 * The obligation's declared evidence kind selects the policy; the policy says
 * which claim sources suffice; the observations were recorded by the bridge
 * with their source fixed by the CHANNEL they arrived on. Nothing in this
 * function decides what evidence is worth, and there is no branch on what is
 * being fulfilled.
 */
export async function settleObligation(input: {
  obligationId: string;
  attemptId: string;
  now?: Date;
}): Promise<{ obligation: Commitment; transaction: Transaction }> {
  const [obligation] = await db
    .select()
    .from(commitments)
    .where(eq(commitments.id, input.obligationId))
    .limit(1);
  if (!obligation || !obligation.transactionId) {
    throw new TransactionError("Obligation not found.", "NOT_FOUND");
  }
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, obligation.transactionId))
    .limit(1);
  if (!transaction) throw new TransactionError("Transaction not found.", "NOT_FOUND");

  const effectKind = obligation.evidenceKind as EffectKind;
  const policy = COMPLETION_POLICIES[effectKind];
  const assertions: EffectAssertion[] = [];
  if (obligation.subjectKind && obligation.subjectId) {
    const evidence = await observationEvidence(
      db,
      {
        ownerId: transaction.scopeId,
        attemptId: input.attemptId,
        subjectKind: obligation.subjectKind,
        subjectId: obligation.subjectId,
        observationType: "fulfillment",
        // What the payload must say. The obligation names its own term, and
        // the observation either speaks about it or is about something else.
        occurredWhen: (payload) => payload.termKey === obligation.termKey && payload.state === "COMPLETE",
        notOccurredWhen: (payload) =>
          payload.termKey === obligation.termKey && payload.state === "NOT_COMPLETE",
      },
      input.now ?? new Date(),
    );
    if (evidence) assertions.push(evidence.assertion);
  }

  const evaluation = decideCompletion({ policy, outputShapeValid: true, assertions });
  const verification: ObligationVerification =
    evaluation.decision === "VERIFIED"
      ? "VERIFIED"
      : evaluation.decision === "FAILED"
        ? "FAILED"
        : evaluation.decision === "INCONCLUSIVE"
          ? "INCONCLUSIVE"
          : "PENDING";

  const [updated] = await db
    .update(commitments)
    .set({
      verification,
      // A verified obligation is also, finally, done. An unverified one keeps
      // whatever claim it had — a claim is not downgraded by failing to prove.
      ...(verification === "VERIFIED" ? { state: "CLAIMED" as const } : {}),
      updatedAt: new Date(),
    })
    .where(eq(commitments.id, obligation.id))
    .returning();

  await appendTransactionEvent({
    scopeId: transaction.scopeId,
    type: "OBLIGATION_VERIFICATION_CHANGED",
    transactionId: transaction.id,
    message: `An obligation's verification moved to ${verification}.`,
    payload: {
      obligationId: obligation.id,
      termKey: obligation.termKey,
      from: obligation.verification,
      to: verification,
      decision: evaluation.decision,
      reasonCode: evaluation.reasonCode,
      evidenceKind: obligation.evidenceKind,
    },
  });
  return { obligation: updated!, transaction: await refreshTransactionState(transaction) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bind a money obligation to the payment runtime that already exists.
 *
 * Block 3 owns payment: exact minor units, a mandatory currency, an
 * owner+idempotency unique index, provider separation, refund as a new effect.
 * This creates a PaymentIntent and points it at the transaction. It does not
 * move money, and creating an intent is not paying.
 *
 *   TRANSACTION != PAYMENT
 *
 * No currency is ever converted. If two terms disagree about currency that is
 * the parties' problem to settle, not a rate this runtime invents.
 */
export async function bindPaymentObligation(input: {
  obligationId: string;
  actorId: string;
}): Promise<{ paymentIntentId: string; created: boolean }> {
  const [obligation] = await db
    .select()
    .from(commitments)
    .where(eq(commitments.id, input.obligationId))
    .limit(1);
  if (!obligation || !obligation.transactionId) {
    throw new TransactionError("Obligation not found.", "NOT_FOUND");
  }
  const transaction = await requireParty(obligation.transactionId, input.actorId);
  if (!obligation.settlement) {
    throw new TransactionError(
      "This obligation declared no money, so there is nothing to pay.",
      "INVALID",
    );
  }
  if (!obligation.beneficiaryActorId) {
    throw new TransactionError("This obligation names nobody to pay.", "INVALID");
  }

  const { intent, created } = await createPaymentIntent(db, {
    ownerId: transaction.scopeId,
    payerRef: obligation.ownerId,
    payeeRef: obligation.beneficiaryActorId,
    amountMinor: obligation.settlement.amountMinor,
    currency: obligation.settlement.currency,
    purpose: `obligation:${obligation.termKey}`,
    transactionId: transaction.id,
    // Stable identity, so a retry returns the original rather than a second
    // payable. The obligation is the identity: one obligation, one payment.
    idempotencyKey: `obligation:${obligation.id}`,
  });
  if (created || obligation.paymentIntentId !== intent.id) {
    await db
      .update(commitments)
      .set({ paymentIntentId: intent.id, updatedAt: new Date() })
      .where(eq(commitments.id, obligation.id));
  }
  return { paymentIntentId: intent.id, created };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ending
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancel, and only while cancelling is honest.
 *
 * Once anything has been VERIFIED, there is nothing to cancel: what happened
 * happened, and the answer is compensation — a NEW effect — rather than a
 * state that pretends an effect vanished.
 */
export async function cancelTransaction(input: {
  transactionId: string;
  actorId: string;
  reason: string;
}): Promise<{ transaction: Transaction; compensation: readonly CompensationRequirement[] }> {
  const transaction = await requireParty(input.transactionId, input.actorId);
  const obligations = await obligationsOf(transaction.id);
  const performed = obligations.filter((obligation) => obligation.verification === "VERIFIED");

  if (performed.length > 0) {
    const compensation = compensationFor(performed);
    const [updated] = await db
      .update(transactions)
      .set({ state: "COMPENSATING", updatedAt: new Date(), version: transaction.version + 1 })
      .where(eq(transactions.id, transaction.id))
      .returning();
    await appendTransactionEvent({
      scopeId: transaction.scopeId,
      type: "TRANSACTION_COMPENSATION_REQUIRED",
      transactionId: transaction.id,
      message: "Something already happened, so this needs compensating rather than cancelling.",
      payload: { reason: input.reason, performed: performed.length },
    });
    return { transaction: updated ?? transaction, compensation };
  }

  await db
    .update(commitments)
    .set({ state: "CANCELLED", updatedAt: new Date() })
    .where(eq(commitments.transactionId, transaction.id));
  const [updated] = await db
    .update(transactions)
    .set({ state: "CANCELLED", updatedAt: new Date(), version: transaction.version + 1 })
    .where(eq(transactions.id, transaction.id))
    .returning();
  await appendTransactionEvent({
    scopeId: transaction.scopeId,
    type: "TRANSACTION_CANCELLED",
    transactionId: transaction.id,
    message: "Cancelled before anything irreversible happened.",
    payload: { reason: input.reason },
  });
  return { transaction: updated ?? transaction, compensation: [] };
}

export type CompensationRequirement = {
  readonly obligationId: string;
  readonly termKey: string;
  readonly reversibility: string;
  readonly compensable: boolean;
  readonly residualNote?: string;
};

/**
 * What compensating would mean, per performed obligation.
 *
 * Read from the compensation policy the runtime already has, keyed by the
 * obligation's effect kind. A compensation is a NEW effect: a refund, a
 * released reservation, a cancelled future action. It does not erase the
 * original, and nothing here deletes a row to make an effect go away.
 */
export function compensationFor(
  performed: readonly Commitment[],
): readonly CompensationRequirement[] {
  return performed.map((obligation) => {
    const policy = resolveCompensationPolicy(obligation.evidenceKind as EffectKind);
    return {
      obligationId: obligation.id,
      termKey: obligation.termKey,
      reversibility: policy.reversibility,
      compensable: policy.reversibility !== "IRREVERSIBLE",
      ...(policy.residualNote ? { residualNote: policy.residualNote } : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a party may see. Built from named fields, as every projection is.
 *
 * A transaction does not hand its parties each other's negotiation floors,
 * internal policies or provider secrets. Only the committed terms cross the
 * boundary, and the policy decision travels as ids and codes.
 */
export async function projectTransaction(input: {
  transactionId: string;
  actorId: string;
}): Promise<Record<string, unknown>> {
  const transaction = await requireParty(input.transactionId, input.actorId);
  const obligations = await obligationsOf(transaction.id);
  const terms = termSheetOf(transaction.termsSnapshot, "committed terms");
  const paid = await db
    .select({ id: paymentIntents.id, status: paymentIntents.status })
    .from(paymentIntents)
    .where(eq(paymentIntents.transactionId, transaction.id));

  return {
    transactionId: transaction.id,
    state: deriveTransactionState(obligations, transaction.state as TransactionState),
    parties: transaction.parties,
    origin: transaction.origin,
    // What was agreed.
    terms: terms.map((term) => ({
      key: term.key,
      value: term.value,
      ...(term.unit ? { unit: term.unit } : {}),
    })),
    // What is committed, what is claimed, what is verified, what remains.
    obligations: obligations.map((obligation) => ({
      obligationId: obligation.id,
      termKey: obligation.termKey,
      owedBy: obligation.ownerId,
      owedTo: obligation.beneficiaryActorId,
      dueAt: obligation.dueAt,
      state: obligation.state,
      // Two facts, side by side, so a surface cannot show one as the other.
      verification: obligation.verification,
      evidenceKind: obligation.evidenceKind,
      ...(obligation.settlement ? { settlement: obligation.settlement } : {}),
    })),
    // What is paid — the payment runtime's own status, never re-interpreted.
    payments: paid,
    outstanding: obligations.filter((obligation) => obligation.verification !== "VERIFIED").length,
    policy: transaction.policyDecision,
    authority: transaction.authorityBasis,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

/** The durable event trail, resumable from a serial cursor. */
export async function transactionTimeline(input: {
  transactionId: string;
  actorId: string;
  afterId?: number;
  limit?: number;
}): Promise<readonly { id: number; type: string; message: string; payload: unknown }[]> {
  const transaction = await requireParty(input.transactionId, input.actorId);
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.ownerId, transaction.scopeId))
    .orderBy(asc(events.id))
    .limit(Math.min(input.limit ?? 200, 500));
  return rows
    .filter(
      (row) =>
        (row.payload as { transactionId?: unknown } | null)?.transactionId === transaction.id &&
        (input.afterId === undefined || row.id > input.afterId),
    )
    .map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message ?? "",
      payload: row.payload,
    }));
}

export async function transactionForAgreement(
  agreementId: string,
): Promise<Transaction | undefined> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.agreementId, agreementId))
    .limit(1);
  return row;
}
