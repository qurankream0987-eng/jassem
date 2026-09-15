/**
 * Block 3 §52–§55 — the financial/economic ledger. APPEND-ONLY.
 *
 * Permanent separations (§52–§53):
 * - This is NOT the execution attempt ledger (attempt = execution audit).
 * - It is NOT the notification/event log (event = semantic fact).
 * - A ledger entry is recognized value: CUSTOMER_PAYMENT, SELLER_VALUE,
 *   SELLER_PAYABLE, PROVIDER_COST, JASIM_REVENUE, REFUND, PAYOUT, ADJUSTMENT.
 *
 * Invariants:
 * - Entries are never updated or deleted; a reversal is a NEW entry.
 * - EconomicEvents come only from VERIFIED outcomes — writers pass the
 *   verified source (sourceEventType + sourceId) explicitly.
 * - Owner-scoped idempotency: replaying an effect never double-recognizes.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  economicLedgerEntries,
  ECONOMIC_ENTRY_KINDS,
  type EconomicEntryKind,
  type EconomicLedgerEntryRecord,
} from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import { normalizeCurrency } from "./money";

export class EconomicLedgerError extends Error {
  constructor(message: string, readonly code: "INVALID_INPUT") {
    super(message);
  }
}

const SIGNED_MINOR = /^-?\d+$/;

export type AppendEconomicEntryInput = {
  ownerId: string;
  kind: EconomicEntryKind;
  party: string;
  /** Signed exact minor units (negative = reversal/refund direction). */
  amountMinor: string;
  currency: string;
  /** The VERIFIED economic event that authorizes recognition. */
  sourceEventType: string;
  sourceId: string;
  attemptId?: string | null;
  paymentIntentId?: string | null;
  feeRuleId?: string | null;
  feeRuleVersion?: number | null;
  idempotencyKey: string;
  meta?: Record<string, unknown>;
  now?: Date;
};

/** Append one entry; replaying owner+idempotencyKey returns the original. */
export async function appendEconomicEntry(
  db: Block2Db,
  input: AppendEconomicEntryInput,
): Promise<{ entry: EconomicLedgerEntryRecord; created: boolean }> {
  if (!ECONOMIC_ENTRY_KINDS.includes(input.kind)) {
    throw new EconomicLedgerError(`Unknown economic kind: ${input.kind}`, "INVALID_INPUT");
  }
  if (!SIGNED_MINOR.test(input.amountMinor)) {
    throw new EconomicLedgerError("amountMinor must be a signed exact integer string", "INVALID_INPUT");
  }
  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch {
    throw new EconomicLedgerError("Invalid currency code", "INVALID_INPUT");
  }
  const inserted = await db
    .insert(economicLedgerEntries)
    .values({
      id: `ele_${randomUUID()}`,
      ownerId: input.ownerId,
      kind: input.kind,
      party: input.party,
      amountMinor: input.amountMinor,
      currency,
      sourceEventType: input.sourceEventType,
      sourceId: input.sourceId,
      attemptId: input.attemptId ?? null,
      paymentIntentId: input.paymentIntentId ?? null,
      feeRuleId: input.feeRuleId ?? null,
      feeRuleVersion: input.feeRuleVersion ?? null,
      idempotencyKey: input.idempotencyKey,
      meta: input.meta ?? {},
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { entry: inserted[0], created: true };
  const [existing] = await db
    .select()
    .from(economicLedgerEntries)
    .where(and(eq(economicLedgerEntries.ownerId, input.ownerId), eq(economicLedgerEntries.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (!existing) throw new EconomicLedgerError("Idempotent replay lost the original entry", "INVALID_INPUT");
  return { entry: existing, created: false };
}

/**
 * Balances are DERIVED, never stored (§55). Sum entries for a party,
 * optionally by kind — multi-currency results are returned per currency.
 */
export async function getPartyLedger(
  db: Block2Db,
  input: { ownerId: string; party?: string; kind?: EconomicEntryKind; currency?: string },
): Promise<Array<{ currency: string; kind: string; totalMinor: string }>> {
  const conditions = [eq(economicLedgerEntries.ownerId, input.ownerId)];
  if (input.party) conditions.push(eq(economicLedgerEntries.party, input.party));
  if (input.kind) conditions.push(eq(economicLedgerEntries.kind, input.kind));
  if (input.currency) conditions.push(eq(economicLedgerEntries.currency, normalizeCurrency(input.currency)));
  const rows = await db
    .select({
      currency: economicLedgerEntries.currency,
      kind: economicLedgerEntries.kind,
      totalMinor: sql<string>`COALESCE(SUM(${economicLedgerEntries.amountMinor}), 0)::text`,
    })
    .from(economicLedgerEntries)
    .where(and(...conditions))
    .groupBy(economicLedgerEntries.currency, economicLedgerEntries.kind);
  return rows;
}
