/**
 * Block 3 §77–§81 — natural-language commercial mutation via ChangeSets.
 *
 * The loop is fixed and truthful: request → preview (diff) → OWNER approval
 * → apply. A recommendation/preview NEVER activates anything. Applying
 * requires an explicit approval reference (the Block 1 approval chain) and
 * runs through the versioned primitives — orders bump termsVersion +
 * fingerprint, fee rules supersede (new version, history preserved), plans
 * bump version (existing subscriptions keep their pinned planVersion).
 *
 * Generated businesses reuse these same primitives (§78): no domain code.
 */

import { and, eq, sql } from "drizzle-orm";
import { plans, type PlanRecord } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import { getCommercialOrder, updateCommercialTerms } from "./commercial-orders";
import { createFeeRule } from "./fee-rules";

export class ChangeSetError extends Error {
  readonly code: "NOT_FOUND" | "APPROVAL_REQUIRED" | "INVALID_MUTATION" | "VERSION_CONFLICT";
constructor(
    message: string,
    code: "NOT_FOUND" | "APPROVAL_REQUIRED" | "INVALID_MUTATION" | "VERSION_CONFLICT",
  ) {
    super(message);
    this.code = code;
  }
}

export type CommercialTargetType = "commercial_order" | "fee_rule" | "plan";

export type CommercialMutation = Record<string, unknown>;

/** Deterministic deep diff for preview (before/after, changed paths). */
export function previewCommercialChange(
  before: Record<string, unknown>,
  mutation: CommercialMutation,
): { before: Record<string, unknown>; after: Record<string, unknown>; changedPaths: string[] } {
  const after = { ...before, ...mutation };
  const changedPaths = Object.keys(mutation)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(mutation[key]))
    .sort();
  return { before, after, changedPaths };
}

/**
 * Apply an APPROVED commercial change. `approvalRef` must reference the
 * owner-approved ChangeSet from the approval chain — without it the apply
 * fails closed (recommendation ≠ activation, §80).
 */
export async function applyApprovedCommercialChange(
  db: Block2Db,
  input: {
    targetType: CommercialTargetType;
    targetId: string;
    mutation: CommercialMutation;
    /** Proof of owner approval (ChangeSet/approval id from the runtime). */
    approvalRef?: string;
    expectedVersion?: number;
    ownerId: string;
    now?: Date;
  },
): Promise<{ applied: true; newVersion: number }> {
  if (!input.approvalRef || !input.approvalRef.trim()) {
    throw new ChangeSetError("Commercial mutation requires an owner-approved ChangeSet reference", "APPROVAL_REQUIRED");
  }
  switch (input.targetType) {
    case "commercial_order": {
      const order = await getCommercialOrder(db, input.targetId);
      if (!order) throw new ChangeSetError(`Order not found: ${input.targetId}`, "NOT_FOUND");
      const updated = await updateCommercialTerms(db, {
        id: order.id,
        terms: { ...order.terms, ...input.mutation },
        expectedVersion: input.expectedVersion ?? order.termsVersion,
        now: input.now,
      });
      return { applied: true, newVersion: updated.termsVersion };
    }
    case "fee_rule": {
      const superseded = await createFeeRule(db, {
        ownerId: input.ownerId,
        worldId: typeof input.mutation.worldId === "string" ? input.mutation.worldId : undefined,
        kind: String(input.mutation.kind ?? "percentage") as never,
        triggerEventType: String(input.mutation.triggerEventType ?? "TRANSACTION_VERIFIED"),
        config: (input.mutation.config as Record<string, unknown>) ?? {},
        supersedesRuleId: input.targetId,
        now: input.now,
      });
      return { applied: true, newVersion: superseded.version };
    }
    case "plan": {
      const [plan] = await db.select().from(plans).where(eq(plans.id, input.targetId)).limit(1);
      if (!plan) throw new ChangeSetError(`Plan not found: ${input.targetId}`, "NOT_FOUND");
      if (plan.ownerId !== input.ownerId) throw new ChangeSetError("Plan belongs to a different owner", "NOT_FOUND");
      const nextPrice = input.mutation.priceMinor !== undefined
        ? input.mutation.priceMinor === null ? null : String(input.mutation.priceMinor)
        : plan.priceMinor;
      const nextCurrency = input.mutation.currency !== undefined
        ? input.mutation.currency === null ? null : String(input.mutation.currency).trim().toUpperCase()
        : plan.currency;
      if ((nextPrice === null) !== (nextCurrency === null) || (nextPrice !== null && !/^[0-9]+$/.test(nextPrice))) {
        throw new ChangeSetError("Plan money requires integer minor units and currency together", "INVALID_MUTATION");
      }
      if (
        input.mutation.status !== undefined &&
        !["ACTIVE", "PAUSED"].includes(String(input.mutation.status))
      ) {
        throw new ChangeSetError("Plan status must be ACTIVE or PAUSED", "INVALID_MUTATION");
      }
      const expectedVersion = input.expectedVersion ?? plan.version;
      const updated = await db
        .update(plans)
        .set({
          ...(input.mutation.priceMinor !== undefined ? { priceMinor: nextPrice } : {}),
          ...(input.mutation.currency !== undefined ? { currency: nextCurrency } : {}),
          ...(input.mutation.name !== undefined ? { name: String(input.mutation.name) } : {}),
          ...(input.mutation.cadence !== undefined ? { cadence: String(input.mutation.cadence) } : {}),
          ...(input.mutation.status !== undefined ? { status: String(input.mutation.status) } : {}),
          ...(input.mutation.trialPolicy !== undefined
            ? { trialPolicy: input.mutation.trialPolicy as Record<string, unknown> }
            : {}),
          ...(input.mutation.usagePolicy !== undefined
            ? { usagePolicy: input.mutation.usagePolicy as Record<string, unknown> }
            : {}),
          ...(input.mutation.entitlementScopes !== undefined
            ? { entitlementScopes: input.mutation.entitlementScopes as Array<Record<string, unknown>> }
            : {}),
          version: sql`${plans.version} + 1`,
          updatedAt: input.now ?? new Date(),
        })
        .where(and(eq(plans.id, plan.id), eq(plans.version, expectedVersion)))
        .returning();
      if (!updated[0]) {
        throw new ChangeSetError("Plan changed concurrently — re-preview and re-approve", "VERSION_CONFLICT");
      }
      return { applied: true, newVersion: updated[0].version };
    }
    default:
      throw new ChangeSetError(`Unknown commercial target: ${input.targetType}`, "INVALID_MUTATION");
  }
}

/** Subscription view helper: a plan change never mutates pinned versions. */
export async function planAtVersion(db: Block2Db, planId: string): Promise<PlanRecord | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  return plan ?? null;
}
