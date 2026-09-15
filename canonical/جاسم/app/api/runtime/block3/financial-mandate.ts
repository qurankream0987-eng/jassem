/**
 * Block 3 §21–§23 — Financial Mandate = DelegationGrant extension.
 *
 * Stateless authority (capabilities, ceilings, currency, constraints) lives
 * on the existing DelegationGrant — there is exactly ONE authorization
 * system. This module adds the missing STATEFUL enforcement: a durable
 * budget/usage record per financial grant, consumed ATOMICALLY by
 * PostgreSQL in the same UPDATE's WHERE clause, so concurrent executions
 * can never overrun a budget or double-use a single-use mandate.
 *
 * Guarantees proven by tests (§97):
 * - budget race: two concurrent 60 KWD spends against 100 KWD ⇒ at most one.
 * - single-use race: executionLimit=1 ⇒ exactly one concurrent use wins.
 * - currency mismatch fails closed (INC-1/2 semantics, statefully).
 */

import { and, eq, sql } from "drizzle-orm";
import { delegationGrants, mandateBudgets, type MandateBudgetRecord } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import { normalizeCurrency } from "./money";

export class MandateBudgetError extends Error {
  readonly code: | "GRANT_NOT_FOUND"
      | "BUDGET_EXISTS"
      | "BUDGET_NOT_FOUND"
      | "INVALID_AMOUNT";
constructor(
    message: string,
    code: | "GRANT_NOT_FOUND"
      | "BUDGET_EXISTS"
      | "BUDGET_NOT_FOUND"
      | "INVALID_AMOUNT",
  ) {
    super(message);
    this.code = code;
  }
}

const MINOR_INTEGER = /^-?\d+$/;

/** Provision the durable budget for a financial delegation grant. */
export async function provisionMandateBudget(
  db: Block2Db,
  input: {
    grantId: string;
    currency: string;
    /** Exact minor-unit string; omit for unconstrained budget. */
    budgetMinor?: string | null;
    executionLimit?: number | null;
    periodKey?: string | null;
  },
): Promise<MandateBudgetRecord> {
  const [grant] = await db
    .select({ id: delegationGrants.id })
    .from(delegationGrants)
    .where(eq(delegationGrants.id, input.grantId))
    .limit(1);
  if (!grant) {
    throw new MandateBudgetError(`Delegation grant not found: ${input.grantId}`, "GRANT_NOT_FOUND");
  }
  if (input.budgetMinor != null && !MINOR_INTEGER.test(input.budgetMinor)) {
    throw new MandateBudgetError("Budget must be an exact integer of minor units", "INVALID_AMOUNT");
  }
  if (input.executionLimit != null && (!Number.isSafeInteger(input.executionLimit) || input.executionLimit < 1)) {
    throw new MandateBudgetError("Execution limit must be a positive integer", "INVALID_AMOUNT");
  }
  const inserted = await db
    .insert(mandateBudgets)
    .values({
      grantId: input.grantId,
      currency: normalizeCurrency(input.currency),
      budgetMinor: input.budgetMinor ?? null,
      executionLimit: input.executionLimit ?? null,
      periodKey: input.periodKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted[0]) {
    throw new MandateBudgetError(`Mandate budget already provisioned: ${input.grantId}`, "BUDGET_EXISTS");
  }
  return inserted[0];
}

export type MandateConsumption =
  | { outcome: "ALLOWED"; budget: MandateBudgetRecord }
  | {
      outcome: "REJECTED";
      code: "BUDGET_NOT_FOUND" | "CURRENCY_MISMATCH" | "INSUFFICIENT_BUDGET" | "EXECUTION_LIMIT_EXHAUSTED";
      reason: string;
    };

/**
 * Atomically consume budget + one execution. The entire decision happens
 * inside ONE UPDATE's WHERE — concurrent calls serialize at the row and at
 * most the authorized number can succeed.
 */
export async function consumeMandateBudget(
  db: Block2Db,
  input: {
    grantId: string;
    /** Exact minor-unit string in the mandate's currency. */
    amountMinor: string;
    currency: string;
    now?: Date;
  },
): Promise<MandateConsumption> {
  if (!MINOR_INTEGER.test(input.amountMinor) || BigInt(input.amountMinor) <= 0n) {
    throw new MandateBudgetError("Amount must be a positive exact integer of minor units", "INVALID_AMOUNT");
  }
  const currency = normalizeCurrency(input.currency);
  const now = input.now ?? new Date();

  const updated = await db
    .update(mandateBudgets)
    .set({
      consumedMinor: sql`${mandateBudgets.consumedMinor} + ${input.amountMinor}`,
      executionsUsed: sql`${mandateBudgets.executionsUsed} + 1`,
      version: sql`${mandateBudgets.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(mandateBudgets.grantId, input.grantId),
        eq(mandateBudgets.currency, currency),
        sql`(${mandateBudgets.budgetMinor} IS NULL OR ${mandateBudgets.budgetMinor} - ${mandateBudgets.consumedMinor} >= ${input.amountMinor})`,
        sql`(${mandateBudgets.executionLimit} IS NULL OR ${mandateBudgets.executionsUsed} < ${mandateBudgets.executionLimit})`,
      ),
    )
    .returning();

  if (updated[0]) return { outcome: "ALLOWED", budget: updated[0] };

  // Classify the rejection (post-check; never retries the mutation).
  const [budget] = await db
    .select()
    .from(mandateBudgets)
    .where(eq(mandateBudgets.grantId, input.grantId))
    .limit(1);
  if (!budget) return { outcome: "REJECTED", code: "BUDGET_NOT_FOUND", reason: "No mandate budget provisioned" };
  if (budget.currency !== currency) {
    return { outcome: "REJECTED", code: "CURRENCY_MISMATCH", reason: `Mandate currency is ${budget.currency}, not ${currency}` };
  }
  if (budget.executionLimit != null && budget.executionsUsed >= budget.executionLimit) {
    return { outcome: "REJECTED", code: "EXECUTION_LIMIT_EXHAUSTED", reason: "Mandate execution limit reached" };
  }
  return { outcome: "REJECTED", code: "INSUFFICIENT_BUDGET", reason: "Mandate budget exceeded" };
}

/**
 * Compensation: release previously consumed budget (e.g. a refunded or
 * voided payment frees the mandate). Floors at zero; never negative.
 */
export async function releaseMandateConsumption(
  db: Block2Db,
  input: { grantId: string; amountMinor: string; now?: Date },
): Promise<MandateBudgetRecord | null> {
  if (!MINOR_INTEGER.test(input.amountMinor) || BigInt(input.amountMinor) <= 0n) {
    throw new MandateBudgetError("Amount must be a positive exact integer of minor units", "INVALID_AMOUNT");
  }
  const updated = await db
    .update(mandateBudgets)
    .set({
      consumedMinor: sql`GREATEST(${mandateBudgets.consumedMinor} - ${input.amountMinor}, 0)`,
      executionsUsed: sql`GREATEST(${mandateBudgets.executionsUsed} - 1, 0)`,
      version: sql`${mandateBudgets.version} + 1`,
      updatedAt: input.now ?? new Date(),
    })
    .where(eq(mandateBudgets.grantId, input.grantId))
    .returning();
  return updated[0] ?? null;
}

export async function getMandateBudget(db: Block2Db, grantId: string) {
  const [budget] = await db.select().from(mandateBudgets).where(eq(mandateBudgets.grantId, grantId)).limit(1);
  return budget ?? null;
}
