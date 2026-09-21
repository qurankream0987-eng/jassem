/**
 * Block 3 §17, §39–§41 — the generic PaymentIntent primitive.
 *
 * A PaymentIntent binds owner/payer/payee/Money/purpose/constraints/
 * method-reference/idempotency BEFORE execution. It is not a payment
 * attempt, not revenue, not settlement, not payout.
 *
 * State machine (§39): AUTH ≠ CAPTURE ≠ SETTLEMENT ≠ PAYOUT. Terminal
 * states are honest and final; INCONCLUSIVE marks "effect may have
 * happened, truth unknown" and is resolved ONLY by reconciliation evidence.
 * A REFUND never rewrites this history — it is a new financial effect (§45).
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  paymentIntents,
  PAYMENT_INTENT_STATUSES,
  type PaymentIntentRecord,
  type PaymentIntentStatus,
} from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import { normalizeCurrency } from "./money";

export const PAYMENT_TRANSITIONS: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  CREATED: ["REQUIRES_APPROVAL", "EXECUTING", "CANCELLED", "EXPIRED", "FAILED"],
  REQUIRES_APPROVAL: ["EXECUTING", "CANCELLED", "EXPIRED", "FAILED"],
  EXECUTING: ["PROVIDER_AUTHORIZED", "FAILED", "INCONCLUSIVE"],
  PROVIDER_AUTHORIZED: ["FAILED", "CANCELLED", "INCONCLUSIVE"],
  // Truth-changing targets (CAPTURED/SETTLED) are NOT reachable from this
  // public map at all: they are applied exclusively by payment-execution.ts
  // from an authoritative provider readback. Captured truth is
  // irreversible; refunds are new effects.
  CAPTURED: ["INCONCLUSIVE"],
  SETTLED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  // INCONCLUSIVE has NO public outgoing transitions: only the reconciler's
  // authoritative readback resolves it. Truth is never claimed without
  // provider-derived evidence.
  INCONCLUSIVE: [],
};

// Truth-changing states (CAPTURED/SETTLED) and INCONCLUSIVE resolution are
// NOT functions of this module at all: they are applied exclusively by
// payment-execution.ts, which derives them from an authoritative provider
// READBACK — never from caller-constructed evidence objects.

export class PaymentIntentError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "NOT_FOUND"
    | "INVALID_TRANSITION"
    | "VERSION_CONFLICT"
    | "TERMINAL";
  constructor(
    message: string,
    code:
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "INVALID_TRANSITION"
      | "VERSION_CONFLICT"
      | "TERMINAL",
  ) {
    super(message);
    this.code = code;
  }
}

const POSITIVE_MINOR = /^[0-9]+$/;

export type CreatePaymentIntentInput = {
  ownerId: string;
  payerRef: string;
  payeeRef: string;
  /** Exact integer minor units as a string (canonical Money). */
  amountMinor: string;
  currency: string;
  purpose: string;
  transactionIntentId?: string | null;
  /** The canonical Transaction this settles, when it settles one. */
  transactionId?: string | null;
  orderId?: string | null;
  providerConstraints?: Record<string, unknown>;
  paymentMethodRef?: string | null;
  /** Immutable provider/catalog binding — once set, only this provider's
   *  authoritative readback may establish truth for the intent. */
  providerRef?: string | null;
  authorizationRequirement?: string;
  idempotencyKey: string;
  expiresAt?: Date | null;
  now?: Date;
};

/** Create a payment intent; replaying the same owner+key returns the original. */
export async function createPaymentIntent(
  db: Block2Db,
  input: CreatePaymentIntentInput,
): Promise<{ intent: PaymentIntentRecord; created: boolean }> {
  if (!POSITIVE_MINOR.test(input.amountMinor) || BigInt(input.amountMinor) <= 0n) {
    throw new PaymentIntentError("amountMinor must be a positive exact integer string", "INVALID_INPUT");
  }
  if (!input.idempotencyKey.trim()) {
    throw new PaymentIntentError("idempotencyKey is required", "INVALID_INPUT");
  }
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch {
    throw new PaymentIntentError("Invalid currency code", "INVALID_INPUT");
  }
  const inserted = await db
    .insert(paymentIntents)
    .values({
      id: `pint_${randomUUID()}`,
      ownerId: input.ownerId,
      payerRef: input.payerRef,
      payeeRef: input.payeeRef,
      amountMinor: input.amountMinor,
      currency,
      purpose: input.purpose,
      transactionIntentId: input.transactionIntentId ?? null,
      transactionId: input.transactionId ?? null,
      orderId: input.orderId ?? null,
      providerConstraints: input.providerConstraints ?? {},
      paymentMethodRef: input.paymentMethodRef ?? null,
      providerRef: input.providerRef ?? null,
      authorizationRequirement: input.authorizationRequirement ?? "OWNER_APPROVAL",
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt ?? null,
      status: "CREATED",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { intent: inserted[0], created: true };
  const [existing] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.ownerId, input.ownerId), eq(paymentIntents.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (!existing) throw new PaymentIntentError("Idempotent replay lost the original intent", "NOT_FOUND");
  return { intent: existing, created: false };
}

export function canTransitionPayment(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Version-checked state transition (CAS). Invalid transitions and terminal
 * states fail closed; concurrent transitions race on the version column.
 */
export async function transitionPaymentIntent(
  db: Block2Db,
  input: { id: string; to: PaymentIntentStatus; expectedVersion?: number; now?: Date },
): Promise<PaymentIntentRecord> {
  if (!PAYMENT_INTENT_STATUSES.includes(input.to)) {
    throw new PaymentIntentError(`Unknown status: ${input.to}`, "INVALID_TRANSITION");
  }
  const [current] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, input.id)).limit(1);
  if (!current) throw new PaymentIntentError(`Payment intent not found: ${input.id}`, "NOT_FOUND");
  if (PAYMENT_TRANSITIONS[current.status].length === 0) {
    throw new PaymentIntentError(
      `Payment intent is terminal (${current.status}); truth cannot be rewritten`,
      "TERMINAL",
    );
  }
  if (!canTransitionPayment(current.status, input.to)) {
    throw new PaymentIntentError(
      `Invalid payment transition ${current.status} → ${input.to}`,
      "INVALID_TRANSITION",
    );
  }
  const version = input.expectedVersion ?? current.version;
  const updated = await db
    .update(paymentIntents)
    .set({ status: input.to, version: sql`${paymentIntents.version} + 1`, updatedAt: input.now ?? new Date() })
    .where(and(eq(paymentIntents.id, input.id), eq(paymentIntents.version, version)))
    .returning();
  if (!updated[0]) {
    throw new PaymentIntentError("Concurrent transition conflicted on version", "VERSION_CONFLICT");
  }
  return updated[0];
}

export async function getPaymentIntent(db: Block2Db, id: string) {
  const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).limit(1);
  return intent ?? null;
}
