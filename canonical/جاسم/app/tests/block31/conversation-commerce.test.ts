/**
 * Block 3.1 — Conversation ↔ commerce wiring proofs.
 * Discovery turns persist result sets and ordinal bindings; publish turns create
 * owned offerings; selection creates fingerprinted DRAFT orders; approval binds
 * the exact approved fingerprint into a PaymentIntent; mutated terms force
 * re-approval; bare "pay" language without context clarifies instead of paying;
 * world commerce mutates owned-world plans only. All generic — no domain nouns.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  commercialOrders,
  economicExpressions,
  externalActionSessions,
  paymentIntents,
  plans,
  referenceBindings,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
// Dynamic imports: economic-fabric and the orchestrator bind the module-level
// db at import time, so they must load only after the test database URL exists.
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let orchestrateConversationCommerce: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let createWorldPlan: typeof import("../../api/runtime/block3/generated-business-economics").createWorldPlan;

const OWNER = "conv-owner";
const SELLER = "conv-seller";
const WORLD_KEY = "conv-world";

/** Minimal ownership-only stand-in for GeneratedWorldService (as in block3 tests). */
const worlds = {
  get: async (ownerId: number, worldId: string) =>
    worldId === WORLD_KEY ? { ownerId, id: worldId, worldKey: WORLD_KEY } : undefined,
  conversationWorld: async () => undefined,
} as never;

type Envelope = {
  decisionId: string;
  kind: string;
  goal?: string;
  intent?: { requiredCapabilities: string[]; missingInputs: string[]; inputs: Record<string, unknown> };
};

function envelope(capabilities: string[], inputs: Record<string, unknown> = {}): Envelope {
  return {
    decisionId: randomUUID(),
    kind: "message",
    intent: { requiredCapabilities: capabilities, missingInputs: [], inputs },
  };
}

function turn(
  content: string,
  env: Envelope,
  overrides: Partial<Parameters<typeof orchestrateConversationCommerce>[0]> = {},
) {
  return orchestrateConversationCommerce({
    db: handle.db,
    worlds,
    ownerId: OWNER,
    conversationId: `conv-${randomUUID()}`,
    content,
    approvalRef: `message-${randomUUID()}`,
    envelope: env,
    ...overrides,
  });
}

async function seedOffering(overrides: { priceMinor?: string } = {}) {
  const expression = await createExpression({
    ownerId: SELLER,
    kind: "offering",
    semanticType: "workspace.seat",
    attributes: { priceMinor: overrides.priceMinor ?? "5000", currency: "SAR" },
  });
  return publishExpression({
    id: expression.id,
    ownerId: SELLER,
    projection: {
      semanticType: "workspace.seat",
      summary: "workspace.seat",
      publicTerms: { money: { amountMinor: overrides.priceMinor ?? "5000", currency: "SAR" } },
    },
  });
}

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ orchestrateConversationCommerce } = await import("../../api/runtime/block31"));
  ({ createWorldPlan } = await import("../../api/runtime/block3/generated-business-economics"));
});
beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      fulfillment_observations, commercial_orders, payment_intents, plans,
      economic_expressions CASCADE
  `));
});

describe("conversation commerce wiring", () => {
  it("discovery turn persists a result set and exact ordinal bindings", async () => {
    await seedOffering();
    const conversationId = `conv-${randomUUID()}`;
    const result = await turn("ابحث عن مقعد عمل", envelope(["discovery_search"], { query: "workspace.seat" }), { conversationId });
    expect(result?.kind).toBe("structured_result");
    expect(result?.data.resultSetId).toBeTruthy();
    const candidates = result?.data.candidates as Array<Record<string, unknown>>;
    expect(candidates.length).toBeGreaterThan(0);
    // Candidate data must be the safe projection (no protected internals).
    expect(JSON.stringify(candidates[0])).not.toContain("attributes");
    const bindings = await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversationId));
    expect(bindings.some((b) => b.referenceKey === "ordinal:1")).toBe(true);
  });

  it("sell turn publishes an owned offering; missing price asks for input with no effects", async () => {
    const missing = await turn("انشر عرضاً", envelope(["commerce_publish"], { subject: "workspace.seat" }));
    expect(missing?.status).toBe("awaiting_input");
    expect((missing?.data.missingInputs as string[]).sort()).toEqual(["currency", "priceMinor"]);

    const published = await turn(
      "انشر مقعد عمل",
      envelope(["commerce_publish"], { subject: "workspace.seat", priceMinor: "7000", currency: "SAR" }),
    );
    expect(published?.status).toBe("completed");
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, published!.data.expressionId as string));
    expect(row.ownerId).toBe(OWNER);
    expect(row.status).toBe("active");
  });

  it("select-first creates a DRAFT order fingerprinted to current terms", async () => {
    await seedOffering();
    const conversationId = `conv-${randomUUID()}`;
    await turn("ابحث عن مقعد عمل", envelope(["discovery_search"], { query: "workspace.seat" }), { conversationId });
    const selected = await turn("اختر الأول", envelope(["commerce_select"]), { conversationId });
    expect(selected?.status).toBe("awaiting_approval");
    const [order] = await handle.db.select().from(commercialOrders)
      .where(eq(commercialOrders.id, selected!.data.orderId as string));
    expect(order.status).toBe("DRAFT");
    expect(order.termsFingerprint).toBe(selected!.data.termsFingerprint);
    const terms = order.terms as Record<string, unknown>;
    expect(terms.offeringRef).toBeTruthy();
    expect(terms.offeringVersion).toBeTruthy();
  });

  it("terms mutation after selection or approval forces re-approval; payment intent pins the approved fingerprint", async () => {
    const offering = await seedOffering();
    const conversationId = `conv-${randomUUID()}`;
    await turn("ابحث عن مقعد عمل", envelope(["discovery_search"], { query: "workspace.seat" }), { conversationId });
    const selected = await turn("اختر الأول", envelope(["commerce_select"]), { conversationId });
    expect(selected?.status).toBe("awaiting_approval");

    // Seller changes the price before approval → approval must refresh terms.
    await publishExpression({
      id: offering.id,
      ownerId: SELLER,
      projection: {
        semanticType: "workspace.seat",
        summary: "workspace.seat",
        publicTerms: { money: { amountMinor: "9000", currency: "SAR" } },
      },
    });
    const approved = await turn("أوافق", envelope(["commerce_approve"]), { conversationId });
    expect(approved?.status).toBe("reapproval_required");
    // No payment intent may exist for mutated terms.
    expect((await handle.db.select().from(paymentIntents)).length).toBe(0);

    // Approving the refreshed terms creates a payment intent pinned to the new fingerprint.
    const reapproved = await turn("أوافق", envelope(["commerce_approve"]), { conversationId });
    expect(reapproved?.status).toBe("completed");
    const [intent] = await handle.db.select().from(paymentIntents);
    const [order] = await handle.db.select().from(commercialOrders);
    expect(intent.status).toBe("CREATED");
    const constraints = intent.providerConstraints as Record<string, unknown>;
    expect(constraints.approvedOrderFingerprint).toBe(order.termsFingerprint);

    // Mutate again after approval → pay refuses and forces re-approval.
    await publishExpression({
      id: offering.id,
      ownerId: SELLER,
      projection: {
        semanticType: "workspace.seat",
        summary: "workspace.seat",
        publicTerms: { money: { amountMinor: "12000", currency: "SAR" } },
      },
    });
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: paying after the offering moved returns
    //   `reapproval_required` — the draft's fingerprints disagreed.
    // WHY_OLD_EXPECTATION_WAS_FALSE: it asserted that a mutated DRAFT is what
    //   stops a payment, which means an UNMUTATED draft would have let one
    //   through. No agreement, commitment or transaction exists anywhere in
    //   this test, so there was never an obligation to pay at all. The old
    //   assertion passed for the wrong reason and would have hidden the
    //   pre-agreement checkout bypass.
    // NEW_EXPECTATION: `blocked`, with `NO_PAYABLE_OBLIGATION`, and no
    //   checkout session.
    // WHY_NEW_EXPECTATION_IS_STRONGER: the refusal no longer depends on the
    //   draft having moved. It holds for every draft, moved or not, because
    //   the question asked is «what obligation is this satisfying» rather than
    //   «does this fingerprint still match». The old guard could be satisfied
    //   by leaving the offering alone; this one cannot be satisfied at all
    //   until the counterparty has actually agreed.
    //
    const pay = await turn("ادفع", envelope(["commerce_pay"], { provider: "stub", adapterEndpoint: "http://127.0.0.1:9" }), { conversationId });
    expect(pay?.status).toBe("blocked");
    expect(pay?.data.reason).toBe("NO_PAYABLE_OBLIGATION");
    expect((await handle.db.select().from(externalActionSessions)).length).toBe(0);

    // And with the offering left exactly as approved, the answer is the same.
    const payUnmutated = await turn("ادفع", envelope(["commerce_pay"]), { conversationId });
    expect(payUnmutated?.data.reason).toBe("NO_PAYABLE_OBLIGATION");
  });

  it("bare pay language with no payment context refuses on canonical grounds", async () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: `awaiting_input` / «Clarification required» — the word
    //   «ادفع» alone names no payment intent in this conversation.
    // WHY_OLD_EXPECTATION_WAS_FALSE: it located the refusal in missing
    //   CONVERSATION CONTEXT. That makes the guard a property of what the
    //   conversation happens to remember, so a conversation that did carry a
    //   draft payment reference would have passed it — which is exactly the
    //   bypass this phase closed.
    // NEW_EXPECTATION: `blocked` with `NO_PAYABLE_OBLIGATION`.
    // WHY_NEW_EXPECTATION_IS_STRONGER: the refusal is now a property of
    //   CANONICAL STATE rather than of conversational memory. It cannot be
    //   escaped by giving the conversation more context, and it still asserts
    //   everything the old one did — no effect, and no payment intent.
    //
    const result = await turn("ادفع", envelope(["commerce_pay"]));
    expect(result?.status).toBe("blocked");
    expect(result?.label).toBe("No payable obligation");
    expect(result?.data.reason).toBe("NO_PAYABLE_OBLIGATION");
    expect(result?.data.effects).toBe("none");
    expect((await handle.db.select().from(paymentIntents)).length).toBe(0);
  });

  it("world plan mutation applies through approved changesets on the owned world only", async () => {
    const db = handle.db;
    const plan = await createWorldPlan(db, worlds, {
      ownerId: "42",
      ownerNumericId: 42,
      worldId: WORLD_KEY,
      name: "Default",
      priceMinor: "1000",
      currency: "SAR",
      cadence: "MONTHLY",
      entitlementScopes: [],
    });
    const result = await orchestrateConversationCommerce({
      db,
      worlds,
      ownerId: "42", // numeric owner required by the world seam
      conversationId: "7",
      content: "أوقف الخطة",
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope(["world_commerce"], { worldRef: WORLD_KEY, planId: plan.id, mutation: { status: "PAUSED" } }),
    });
    expect(result?.status).toBe("completed");
    const [updated] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(updated.status).toBe("PAUSED");
  });

  it("published world offering is discoverable across owners without leaking internals", async () => {
    await seedOffering({ priceMinor: "5000" });
    const result = await turn(
      "ابحث عن مقعد عمل",
      envelope(["discovery_search"], { query: "workspace.seat" }),
      { ownerId: "someone-else" },
    );
    const candidates = result?.data.candidates as Array<Record<string, unknown>>;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.trust).toBe("canonical_internal");
  });
});
