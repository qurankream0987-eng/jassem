/**
 * Block 3 §52–§66 — economic event recognition + contribution margin.
 *
 * EconomicEvents are recognized ONLY from VERIFIED outcomes (§56): a
 * payment must be in the CAPTURED/SETTLED verified state before any value
 * is recognized. Recognition writes append-only ledger entries:
 *   CUSTOMER_PAYMENT (gross, customer party)
 *   JASIM_REVENUE    (per active fee rule, citing rule id + version)
 *   SELLER_PAYABLE   (gross − total fees, seller party)
 * All entries are idempotent per (owner, effect key): replay recognizes
 * nothing twice (§55).
 */

import { and, eq, sql } from "drizzle-orm";
import { economicLedgerEntries } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import type { EconomicLedgerEntryRecord } from "@db/schema";
import { appendEconomicEntry } from "./economic-ledger";
import { activeFeeRulesFor, computeFeeLines } from "./fee-rules";
import { moneyOf, subMoney, type Money } from "./money";
import { getPaymentIntent } from "./payment-intents";

export class EconomicEventError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "NOT_VERIFIED" | "INVALID_STATE") {
    super(message);
  }
}

/** The canonical verified trigger type fee rules bind to for payments. */
export const TRANSACTION_VERIFIED = "TRANSACTION_VERIFIED";

export type RecognizedPayment = {
  customerPayment: EconomicLedgerEntryRecord;
  revenue: EconomicLedgerEntryRecord[];
  sellerPayable: EconomicLedgerEntryRecord;
  totalFeesMinor: string;
  alreadyRecognized: boolean;
};

/** Recognize a VERIFIED captured payment into the economic ledger. */
export async function recognizeVerifiedPayment(
  db: Block2Db,
  input: { intentId: string; now?: Date },
): Promise<RecognizedPayment> {
  const intent = await getPaymentIntent(db, input.intentId);
  if (!intent) throw new EconomicEventError(`Payment intent not found: ${input.intentId}`, "NOT_FOUND");
  if (intent.status !== "CAPTURED" && intent.status !== "SETTLED") {
    // §56: economic truth only from verified outcomes.
    throw new EconomicEventError(
      `Cannot recognize economics from unverified payment state ${intent.status}`,
      "NOT_VERIFIED",
    );
  }
  const gross = moneyOf(intent.amountMinor, intent.currency);
  const base = {
    ownerId: intent.ownerId,
    currency: intent.currency,
    paymentIntentId: intent.id,
    now: input.now,
  };

  const customerPayment = await appendEconomicEntry(db, {
    ...base,
    kind: "CUSTOMER_PAYMENT",
    party: intent.payerRef,
    amountMinor: gross.minor,
    sourceEventType: "PAYMENT_CAPTURED_VERIFIED",
    sourceId: intent.id,
    idempotencyKey: `capture:${intent.id}`,
  });

  const rules = await activeFeeRulesFor(db, intent.ownerId, TRANSACTION_VERIFIED);
  const lines = computeFeeLines(rules, gross);
  const revenue: EconomicLedgerEntryRecord[] = [];
  let totalFees = moneyOf("0", gross.currency);
  for (const line of lines) {
    const { entry } = await appendEconomicEntry(db, {
      ...base,
      kind: "JASIM_REVENUE",
      party: "JASIM",
      amountMinor: line.fee.minor,
      sourceEventType: TRANSACTION_VERIFIED,
      sourceId: intent.id,
      feeRuleId: line.ruleId,
      feeRuleVersion: line.ruleVersion,
      idempotencyKey: `revenue:${intent.id}:${line.ruleId}`,
    });
    revenue.push(entry);
    totalFees = moneyOf((BigInt(totalFees.minor) + BigInt(line.fee.minor)).toString(), gross.currency);
  }

  const sellerPayable = await appendEconomicEntry(db, {
    ...base,
    kind: "SELLER_PAYABLE",
    party: intent.payeeRef,
    amountMinor: subMoney(gross, totalFees).minor,
    sourceEventType: TRANSACTION_VERIFIED,
    sourceId: intent.id,
    idempotencyKey: `payable:${intent.id}`,
  });

  return {
    customerPayment: customerPayment.entry,
    revenue,
    sellerPayable: sellerPayable.entry,
    totalFeesMinor: totalFees.minor,
    alreadyRecognized: !customerPayment.created,
  };
}

/**
 * Contribution margin (§62–§63), derived from the ledger — never stored.
 * Provider cost may be UNKNOWN; then the margin is truthfully UNKNOWN (null)
 * rather than a fabricated number.
 */
export async function computeContributionMargin(
  db: Block2Db,
  input: { ownerId: string; currency: string },
): Promise<{
  revenueMinor: string;
  providerCostMinor: string | null;
  marginMinor: string | null;
}> {
  const sums = await db
    .select({
      kind: economicLedgerEntries.kind,
      totalMinor: sql<string>`COALESCE(SUM(${economicLedgerEntries.amountMinor}), 0)::text`,
    })
    .from(economicLedgerEntries)
    .where(and(eq(economicLedgerEntries.ownerId, input.ownerId), eq(economicLedgerEntries.currency, input.currency)))
    .groupBy(economicLedgerEntries.kind);
  const byKind = new Map(sums.map((row) => [row.kind, row.totalMinor]));
  const revenueMinor = byKind.get("JASIM_REVENUE") ?? "0";
  const providerCostMinor = byKind.get("PROVIDER_COST") ?? null;
  return {
    revenueMinor,
    providerCostMinor,
    marginMinor: providerCostMinor === null ? null : (BigInt(revenueMinor) - BigInt(providerCostMinor)).toString(),
  };
}
