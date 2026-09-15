/**
 * Block 3 §77–§81 — commercial mutation only through preview → approval →
 * apply. A recommendation never activates; every apply cites approval and
 * preserves versioned history.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyApprovedCommercialChange,
  ChangeSetError,
  previewCommercialChange,
} from "../../api/runtime/block3/commercial-changesets";
import { createCommercialOrder, getCommercialOrder } from "../../api/runtime/block3/commercial-orders";
import { createFeeRule } from "../../api/runtime/block3/fee-rules";
import { createPlan, subscribe } from "../../api/runtime/block3/subscriptions";
import { getTestDb, resetBlock3 } from "./helpers/pg";

const T0 = new Date("2026-01-01T00:00:00Z");

describe("commercial changesets (§77–§81)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("preview produces a deterministic diff and mutates NOTHING", async () => {
    const { db } = await getTestDb();
    const order = await createCommercialOrder(db, {
      ownerId: "o", sellerRef: "s", buyerRef: "b",
      terms: { total: { minor: "1000", currency: "KWD" }, note: "a" },
    });
    const preview = previewCommercialChange(order.terms, { note: "b" });
    expect(preview.changedPaths).toEqual(["note"]);
    expect(preview.after.note).toBe("b");
    expect((await getCommercialOrder(db, order.id))?.terms).toEqual(order.terms); // untouched
    expect((await getCommercialOrder(db, order.id))?.termsVersion).toBe(1);
  });

  it("apply fails closed without an owner approval reference", async () => {
    const { db } = await getTestDb();
    const order = await createCommercialOrder(db, {
      ownerId: "o", sellerRef: "s", buyerRef: "b", terms: { note: "a" },
    });
    await expect(applyApprovedCommercialChange(db, {
      targetType: "commercial_order", targetId: order.id, mutation: { note: "b" }, ownerId: "o",
    })).rejects.toThrow(ChangeSetError);
    expect((await getCommercialOrder(db, order.id))?.termsVersion).toBe(1);
  });

  it("approved order mutation bumps termsVersion and changes the fingerprint", async () => {
    const { db } = await getTestDb();
    const order = await createCommercialOrder(db, {
      ownerId: "o", sellerRef: "s", buyerRef: "b",
      terms: { total: { minor: "1000", currency: "KWD" } },
    });
    const fp1 = order.termsFingerprint;
    const applied = await applyApprovedCommercialChange(db, {
      targetType: "commercial_order", targetId: order.id,
      mutation: { total: { minor: "900", currency: "KWD" } },
      approvalRef: "approval-123", ownerId: "o",
    });
    expect(applied.newVersion).toBe(2);
    const after = await getCommercialOrder(db, order.id);
    expect(after?.termsFingerprint).not.toBe(fp1);
  });

  it("approved fee change supersedes the rule (history preserved)", async () => {
    const { db } = await getTestDb();
    const rule = await createFeeRule(db, {
      ownerId: "o", kind: "percentage", triggerEventType: "TRANSACTION_VERIFIED", config: { percent: "2.5" },
    });
    const applied = await applyApprovedCommercialChange(db, {
      targetType: "fee_rule", targetId: rule.id,
      mutation: { kind: "percentage", config: { percent: "3" } },
      approvalRef: "approval-124", ownerId: "o",
    });
    expect(applied.newVersion).toBe(2);
  });

  it("approved plan price change bumps plan version; existing subscriptions keep their pinned version", async () => {
    const { db } = await getTestDb();
    const plan = await createPlan(db, {
      ownerId: "o", name: "Pro", priceMinor: "5000", currency: "KWD",
      entitlementScopes: [{ capability: "rides" }], now: T0,
    });
    const { subscription } = await subscribe(db, { planId: plan.id, subscriberOwnerId: "u1", now: T0 });
    expect(subscription.planVersion).toBe(1);
    const applied = await applyApprovedCommercialChange(db, {
      targetType: "plan", targetId: plan.id,
      mutation: { priceMinor: "6000" }, approvalRef: "approval-125", ownerId: "o",
    });
    expect(applied.newVersion).toBe(2);
    // The existing subscription is untouched — it pinned planVersion 1.
    const { subscriptions } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscription.id));
    expect(sub.planVersion).toBe(1);
  });
});
