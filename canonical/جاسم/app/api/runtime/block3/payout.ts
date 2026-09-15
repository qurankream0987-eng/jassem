/**
 * Generic payout boundary. Payouts are not settlements and are never inferred
 * from provider receipts: only authoritative readback can verify one.
 */
import { and, eq } from "drizzle-orm";
import { payouts } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import { appendEconomicEntry } from "./economic-ledger";
import { PspUncertainEffectError, type PspClient, type PspPayoutView } from "./psp-client";

export type PayoutStatus = "REQUESTED" | "EXECUTED" | "VERIFIED" | "INCONCLUSIVE" | "BLOCKED_BY_PROVIDER";
export class PayoutError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "INVALID_STATE" | "APPROVAL_REQUIRED" | "PROVIDER_UNAVAILABLE" | "UNCERTAIN_EFFECT") { super(message); }
}
type Input = { payoutId: string; ownerId: string; destinationRef?: string; amountMinor: string; currency: string; providerRef?: string; approvalRef?: string };

export async function requestPayout(db: Block2Db, input: Input) {
  if (!input.destinationRef || !input.providerRef) {
    return { status: "BLOCKED_BY_PROVIDER" as const, payout: null };
  }
  const key = `${input.payoutId}:${input.destinationRef}:${input.amountMinor}:${input.currency}`;
  const existing = await db.select().from(payouts).where(and(eq(payouts.ownerId, input.ownerId), eq(payouts.id, input.payoutId))).limit(1);
  if (existing[0]) {
    if (existing[0].destinationRef !== input.destinationRef && !input.approvalRef) throw new PayoutError("Destination change requires explicit owner approval", "APPROVAL_REQUIRED");
    if (existing[0].destinationRef !== input.destinationRef) {
      const [changed] = await db.update(payouts).set({
        destinationRef: input.destinationRef, approvalRef: input.approvalRef,
        status: "REQUESTED", version: existing[0].version + 1,
      }).where(and(eq(payouts.id, input.payoutId), eq(payouts.ownerId, input.ownerId))).returning();
      return { status: "REQUESTED" as const, payout: changed };
    }
    return { status: existing[0].status as PayoutStatus, payout: existing[0] };
  }
  const [payout] = await db.insert(payouts).values({
    id: input.payoutId, ownerId: input.ownerId, destinationRef: input.destinationRef,
    amountMinor: input.amountMinor, currency: input.currency, providerRef: input.providerRef,
    idempotencyKey: key, approvalRef: input.approvalRef ?? null,
  }).onConflictDoNothing().returning();
  return { status: (payout?.status ?? "REQUESTED") as PayoutStatus, payout: payout ?? null };
}

function binds(view: PspPayoutView, payout: typeof payouts.$inferSelect) {
  return view.id === payout.providerReference && view.destinationRef === payout.destinationRef &&
    view.amountMinor === payout.amountMinor && view.currency === payout.currency;
}

export async function executePayout(db: Block2Db, deps: { psp?: PspClient }, input: { payoutId: string }) {
  const [payout] = await db.select().from(payouts).where(eq(payouts.id, input.payoutId)).limit(1);
  if (!payout) throw new PayoutError("Payout not found", "NOT_FOUND");
  if (payout.status === "VERIFIED" || payout.status === "BLOCKED_BY_PROVIDER") return payout;
  if (!deps.psp?.payout || !payout.providerRef) {
    const [blocked] = await db.update(payouts).set({ status: "BLOCKED_BY_PROVIDER" }).where(eq(payouts.id, payout.id)).returning();
    return blocked;
  }
  if (payout.status === "INCONCLUSIVE") throw new PayoutError("Uncertain payout requires reconciliation; blind retry forbidden", "UNCERTAIN_EFFECT");
  try {
    // Reserve a stable provider correlation before dispatch. This is safe to
    // reuse for readback, but an INCONCLUSIVE row is never dispatched again.
    if (!payout.providerReference) {
      await db.update(payouts).set({ providerReference: `payout_${payout.id}` }).where(eq(payouts.id, payout.id));
      payout.providerReference = `payout_${payout.id}`;
    }
    const view = await deps.psp.payout({ payoutId: payout.id, amountMinor: payout.amountMinor, currency: payout.currency, destinationRef: payout.destinationRef, idempotencyKey: payout.idempotencyKey });
    if (view.amountMinor !== payout.amountMinor || view.currency !== payout.currency ||
        view.destinationRef !== payout.destinationRef) {
      throw new PayoutError("Provider receipt does not bind to requested payout", "INVALID_STATE");
    }
    const [updated] = await db.update(payouts).set({ status: "EXECUTED", providerReference: view.id }).where(eq(payouts.id, payout.id)).returning();
    return updated;
  } catch (error) {
    if (error instanceof PspUncertainEffectError) {
      const [updated] = await db.update(payouts).set({ status: "INCONCLUSIVE" }).where(eq(payouts.id, payout.id)).returning();
      return updated;
    }
    throw error;
  }
}

export async function reconcilePayout(db: Block2Db, deps: { psp: PspClient }, payoutId: string) {
  const [payout] = await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
  if (!payout) throw new PayoutError("Payout not found", "NOT_FOUND");
  if (!payout.providerReference || !deps.psp.payoutReadback) return payout;
  const view = await deps.psp.payoutReadback(payout.providerReference);
  if (!view || !binds(view, payout) || view.status !== "EXECUTED") return payout;
  const [verified] = await db.update(payouts).set({ status: "VERIFIED" }).where(eq(payouts.id, payout.id)).returning();
  await appendEconomicEntry(db, { ownerId: payout.ownerId, kind: "PAYOUT", party: payout.destinationRef, amountMinor: payout.amountMinor, currency: payout.currency, sourceEventType: "PAYOUT_VERIFIED", sourceId: payout.id, idempotencyKey: `payout:${payout.id}`, meta: { providerReference: payout.providerReference } });
  return verified;
}

export async function changePayoutDestination(db: Block2Db, payoutId: string, ownerId: string, destinationRef: string, approvalRef?: string) {
  if (!approvalRef) throw new PayoutError("Destination change requires explicit owner approval", "APPROVAL_REQUIRED");
  const [updated] = await db.update(payouts).set({ destinationRef, approvalRef, status: "REQUESTED" }).where(and(eq(payouts.id, payoutId), eq(payouts.ownerId, ownerId))).returning();
  if (!updated) throw new PayoutError("Payout not found", "NOT_FOUND");
  return updated;
}