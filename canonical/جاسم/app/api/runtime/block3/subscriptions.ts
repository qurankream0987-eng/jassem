/**
 * Block 3 §67–§76 — generic Plan / Subscription / Entitlement / usage.
 *
 * Truths enforced (§68–§76):
 * - A subscription is a BILLING RELATIONSHIP, not a payment. Renewal may
 *   produce payments via the trusted chain; entitlement changes follow
 *   VERIFIED events + policy only.
 * - A trial creates an ENTITLEMENT, never a fake payment (§71).
 * - Failed renewal ⇒ truthful PAST_DUE → grace → SUSPENDED → EXPIRED per
 *   policy — never silent and never fabricated success (§72).
 * - Cancel-immediate and cancel-at-period-end are distinct (§73).
 * - Usage metering is idempotent: replay can never consume quota or bill
 *   twice (§74). Quota is deterministic, server-side truth (§75).
 * - The UI can never self-unlock: server entitlement state is the only
 *   truth (§69).
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  entitlements,
  paymentIntents,
  plans,
  subscriptions,
  usageRecords,
  type EntitlementRecord,
  type PlanRecord,
  type SubscriptionRecord,
} from "@db/schema";
import type { Block2Db } from "../block2/temporal";

export class BillingError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "INVALID_STATE"
    | "NO_ENTITLEMENT"
    | "QUOTA_EXCEEDED"
    | "PAYMENT_UNVERIFIED";
  constructor(
    message: string,
    code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "INVALID_STATE"
      | "NO_ENTITLEMENT"
      | "QUOTA_EXCEEDED"
      | "PAYMENT_UNVERIFIED",
  ) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function createPlan(
  db: Block2Db,
  input: {
    ownerId: string;
    worldId?: string;
    name: string;
    /** NULL = free plan. */
    priceMinor?: string | null;
    currency?: string | null;
    cadence?: string;
    trialDays?: number;
    entitlementScopes: Array<Record<string, unknown>>;
    usagePolicy?: Record<string, unknown>;
    now?: Date;
  },
): Promise<PlanRecord> {
  if ((input.priceMinor == null) !== (input.currency == null)) {
    throw new BillingError("Price and currency must be provided together", "INVALID_INPUT");
  }
  if (input.priceMinor != null && !/^[0-9]+$/.test(input.priceMinor)) {
    throw new BillingError("priceMinor must be an exact integer string", "INVALID_INPUT");
  }
  const [plan] = await db
    .insert(plans)
    .values({
      id: `plan_${randomUUID()}`,
      ownerId: input.ownerId,
      worldId: input.worldId,
      name: input.name,
      priceMinor: input.priceMinor ?? null,
      currency: input.currency ?? null,
      cadence: input.cadence ?? "MONTHLY",
      trialPolicy: input.trialDays ? { trialDays: input.trialDays } : {},
      entitlementScopes: input.entitlementScopes,
      usagePolicy: input.usagePolicy ?? {},
    })
    .returning();
  return plan;
}

// ---------------------------------------------------------------------------
// Subscriptions + entitlements
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const CADENCE_DAYS: Record<string, number> = { WEEKLY: 7, MONTHLY: 30, QUARTERLY: 91, YEARLY: 365 };

function periodEndFor(cadence: string, start: Date): Date {
  return new Date(start.getTime() + (CADENCE_DAYS[cadence] ?? 30) * DAY_MS);
}

async function grantEntitlement(
  db: Block2Db,
  input: {
    subjectOwnerId: string;
    sourceType: "TRIAL" | "SUBSCRIPTION";
    sourceId: string;
    scope: Record<string, unknown>;
    quota: Record<string, unknown>;
    expiresAt: Date | null;
    now?: Date;
  },
): Promise<EntitlementRecord> {
  const inserted = await db
    .insert(entitlements)
    .values({
      id: `ent_${randomUUID()}`,
      subjectOwnerId: input.subjectOwnerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      scope: input.scope,
      quota: input.quota,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const [existing] = await db
    .select()
    .from(entitlements)
    .where(
      and(
        eq(entitlements.subjectOwnerId, input.subjectOwnerId),
        eq(entitlements.sourceType, input.sourceType),
        eq(entitlements.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  return existing;
}

/**
 * Subscribe: a trial creates an ENTITLEMENT directly (no payment object,
 * no fake charge). A paid plan starts PAST_DUE until the first renewal
 * payment is VERIFIED — access follows verified money only.
 */
export async function subscribe(
  db: Block2Db,
  input: { planId: string; subscriberOwnerId: string; now?: Date },
): Promise<{ subscription: SubscriptionRecord; entitlements: EntitlementRecord[] }> {
  const now = input.now ?? new Date();
  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!plan || plan.status !== "ACTIVE") throw new BillingError(`Plan not found: ${input.planId}`, "NOT_FOUND");

  const trialDays = Number((plan.trialPolicy as Record<string, unknown>).trialDays ?? 0);
  const isTrial = trialDays > 0;
  const isFree = plan.priceMinor === null;
  const status = isTrial ? "TRIALING" : isFree ? "ACTIVE" : "PAST_DUE";
  const periodEnd = isTrial ? new Date(now.getTime() + trialDays * DAY_MS) : periodEndFor(plan.cadence, now);

  const [subscription] = await db
    .insert(subscriptions)
    .values({
      id: `sub_${randomUUID()}`,
      ownerId: input.subscriberOwnerId,
      planId: plan.id,
      planVersion: plan.version,
      status,
      periodStart: now,
      periodEnd,
    })
    .returning();

  // Trials and free plans grant access immediately; paid plans wait for
  // verified payment (confirmSubscriptionPayment).
  const granted: EntitlementRecord[] = [];
  if (status !== "PAST_DUE") {
    for (const scope of plan.entitlementScopes) {
      granted.push(
        await grantEntitlement(db, {
          subjectOwnerId: input.subscriberOwnerId,
          sourceType: isTrial ? "TRIAL" : "SUBSCRIPTION",
          sourceId: subscription.id,
          scope,
          quota: (scope.quota as Record<string, unknown>) ?? {},
          expiresAt: periodEnd,
          now,
        }),
      );
    }
  }
  return { subscription, entitlements: granted };
}

/**
 * Confirm a subscription payment after the trusted payment chain produced a
 * VERIFIED capture. Only then does a paid subscription activate/renew.
 */
export async function confirmSubscriptionPayment(
  db: Block2Db,
  input: { subscriptionId: string; verifiedPaymentIntentId: string; now?: Date },
): Promise<SubscriptionRecord> {
  const now = input.now ?? new Date();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1);
  if (!sub) throw new BillingError(`Subscription not found: ${input.subscriptionId}`, "NOT_FOUND");
  const [plan] = await db.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);

  // The reference must be a REAL verified payment — never an arbitrary id:
  // existing intent, terminal-verified status, owned by the subscriber, and
  // money exactly matching the plan price.
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(eq(paymentIntents.id, input.verifiedPaymentIntentId))
    .limit(1);
  if (!intent || intent.ownerId !== sub.ownerId) {
    throw new BillingError("Verified payment intent not found for this owner", "PAYMENT_UNVERIFIED");
  }
  if (intent.status !== "CAPTURED" && intent.status !== "SETTLED") {
    throw new BillingError(`Payment is ${intent.status} — not a verified payment`, "PAYMENT_UNVERIFIED");
  }
  if (plan?.priceMinor != null && (intent.amountMinor !== plan.priceMinor || intent.currency !== plan.currency)) {
    throw new BillingError("Payment money disagrees with the plan price", "PAYMENT_UNVERIFIED");
  }

  const newEnd = periodEndFor(plan?.cadence ?? "MONTHLY", now);
  const [updated] = await db
    .update(subscriptions)
    .set({
      status: "ACTIVE",
      periodStart: now,
      periodEnd: newEnd,
      cancelAtPeriodEnd: false,
      version: sql`${subscriptions.version} + 1`,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, sub.id))
    .returning();
  for (const scope of plan?.entitlementScopes ?? []) {
    await grantEntitlement(db, {
      subjectOwnerId: sub.ownerId,
      sourceType: "SUBSCRIPTION",
      sourceId: sub.id,
      scope,
      quota: (scope.quota as Record<string, unknown>) ?? {},
      expiresAt: newEnd,
      now,
    });
  }
  return updated;
}

/**
 * Renewal truth (§72): a verified payment renews; failure walks the honest
 * path PAST_DUE → (grace) → SUSPENDED → EXPIRED. Never fabricated success.
 */
export async function processRenewal(
  db: Block2Db,
  input: {
    subscriptionId: string;
    outcome: "VERIFIED_PAYMENT" | "FAILED_PAYMENT";
    verifiedPaymentIntentId?: string;
    /** Policy: grace days before suspension, suspension days before expiry. */
    graceDays?: number;
    suspendAfterDays?: number;
    now?: Date;
  },
): Promise<{ subscription: SubscriptionRecord; entitlementsRevoked: number }> {
  const now = input.now ?? new Date();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1);
  if (!sub) throw new BillingError(`Subscription not found: ${input.subscriptionId}`, "NOT_FOUND");

  if (input.outcome === "VERIFIED_PAYMENT") {
    if (!input.verifiedPaymentIntentId) {
      throw new BillingError("Renewal success requires a verified payment reference", "PAYMENT_UNVERIFIED");
    }
    const renewed = await confirmSubscriptionPayment(db, {
      subscriptionId: sub.id,
      verifiedPaymentIntentId: input.verifiedPaymentIntentId,
      now,
    });
    return { subscription: renewed, entitlementsRevoked: 0 };
  }

  // Failed payment: deterministic policy walk based on elapsed time.
  const graceDays = input.graceDays ?? 3;
  const suspendAfterDays = input.suspendAfterDays ?? 7;
  const overdueDays = Math.max(0, (now.getTime() - sub.periodEnd.getTime()) / DAY_MS);
  let status: SubscriptionRecord["status"];
  if (overdueDays > suspendAfterDays) status = "EXPIRED";
  else if (overdueDays > graceDays) status = "SUSPENDED";
  else status = "PAST_DUE";

  const [updated] = await db
    .update(subscriptions)
    .set({ status, version: sql`${subscriptions.version} + 1`, updatedAt: now })
    .where(eq(subscriptions.id, sub.id))
    .returning();

  let entitlementsRevoked = 0;
  if (status === "SUSPENDED" || status === "EXPIRED") {
    const revoked = await db
      .update(entitlements)
      .set({ status: status === "EXPIRED" ? "EXPIRED" : "SUSPENDED", updatedAt: now })
      .where(and(eq(entitlements.sourceId, sub.id), eq(entitlements.status, "ACTIVE")))
      .returning({ id: entitlements.id });
    entitlementsRevoked = revoked.length;
  }
  return { subscription: updated, entitlementsRevoked };
}

/** Cancel: immediate (access ends now) vs at period end (access survives). */
export async function cancelSubscription(
  db: Block2Db,
  input: { subscriptionId: string; mode: "IMMEDIATE" | "PERIOD_END"; now?: Date },
): Promise<{ subscription: SubscriptionRecord; entitlementsRevoked: number }> {
  const now = input.now ?? new Date();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, input.subscriptionId)).limit(1);
  if (!sub) throw new BillingError(`Subscription not found: ${input.subscriptionId}`, "NOT_FOUND");
  if (["CANCELLED", "EXPIRED"].includes(sub.status)) {
    throw new BillingError(`Subscription already ${sub.status}`, "INVALID_STATE");
  }
  if (input.mode === "PERIOD_END") {
    const [updated] = await db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true, version: sql`${subscriptions.version} + 1`, updatedAt: now })
      .where(eq(subscriptions.id, sub.id))
      .returning();
    return { subscription: updated, entitlementsRevoked: 0 };
  }
  const [updated] = await db
    .update(subscriptions)
    .set({ status: "CANCELLED", cancelledAt: now, version: sql`${subscriptions.version} + 1`, updatedAt: now })
    .where(eq(subscriptions.id, sub.id))
    .returning();
  const revoked = await db
    .update(entitlements)
    .set({ status: "REVOKED", updatedAt: now })
    .where(and(eq(entitlements.sourceId, sub.id), eq(entitlements.status, "ACTIVE")))
    .returning({ id: entitlements.id });
  return { subscription: updated, entitlementsRevoked: revoked.length };
}

/** Server-side entitlement truth (§69): the ONLY source the UI may trust. */
export async function getEntitlement(
  db: Block2Db,
  input: { subjectOwnerId: string; capability: string; now?: Date },
): Promise<EntitlementRecord | null> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.subjectOwnerId, input.subjectOwnerId), eq(entitlements.status, "ACTIVE")));
  return (
    rows.find(
      (row) =>
        (row.scope as Record<string, unknown>).capability === input.capability &&
        (row.expiresAt === null || row.expiresAt.getTime() > now.getTime()),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Usage metering (§74–§75)
// ---------------------------------------------------------------------------

/** Record usage idempotently: the same sourceEventKey can never count twice. */
export async function recordUsage(
  db: Block2Db,
  input: {
    ownerId: string;
    metric: string;
    quantity: string;
    unit: string;
    sourceEventKey: string;
    subscriptionId?: string | null;
    periodKey: string;
  },
): Promise<{ recorded: boolean }> {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(input.quantity)) {
    throw new BillingError("quantity must be a non-negative exact decimal string", "INVALID_INPUT");
  }
  const inserted = await db
    .insert(usageRecords)
    .values({
      id: `use_${randomUUID()}`,
      ownerId: input.ownerId,
      subscriptionId: input.subscriptionId ?? null,
      metric: input.metric,
      quantity: input.quantity,
      unit: input.unit,
      sourceEventKey: input.sourceEventKey,
      periodKey: input.periodKey,
    })
    .onConflictDoNothing()
    .returning({ id: usageRecords.id });
  return { recorded: inserted.length > 0 };
}

/** Deterministic server-side quota check (§75): summed usage vs entitlement quota. */
export async function checkQuota(
  db: Block2Db,
  input: { subjectOwnerId: string; capability: string; metric: string; periodKey: string; now?: Date },
): Promise<{ allowed: boolean; used: string; limit: string | null }> {
  const entitlement = await getEntitlement(db, {
    subjectOwnerId: input.subjectOwnerId,
    capability: input.capability,
    now: input.now,
  });
  if (!entitlement) throw new BillingError("No active entitlement for this capability", "NO_ENTITLEMENT");
  const quota = entitlement.quota as Record<string, unknown>;
  const limitRaw = quota[input.metric];
  const limit = limitRaw === undefined || limitRaw === null ? null : String(limitRaw);
  const [sum] = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageRecords.quantity}), 0)::text` })
    .from(usageRecords)
    .where(and(eq(usageRecords.ownerId, input.subjectOwnerId), eq(usageRecords.metric, input.metric), eq(usageRecords.periodKey, input.periodKey)));
  const used = sum?.total ?? "0";
  if (limit === null) return { allowed: true, used, limit: null };
  // Exact decimal comparison via scaled integers (no floats).
  const scaled = (v: string) => {
    const [i, f = ""] = v.split(".");
    return BigInt(i) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
  };
  return { allowed: scaled(used) < scaled(limit), used, limit };
}
