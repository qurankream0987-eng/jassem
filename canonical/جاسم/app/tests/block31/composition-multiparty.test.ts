import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  commercialOrders,
  delegationGrants,
  discoveryResultSets,
  economicExpressions,
  paymentIntents,
  referenceBindings,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let createDelegationGrant: typeof import("../../api/runtime/block2/delegation").createDelegationGrant;
let listDelegationGrants: typeof import("../../api/runtime/block2/delegation").listDelegationGrants;

const SELLER = "party-a";
const BUYER = "party-b";
const FULFILLER = "party-d";
const OUTSIDER = "party-c";
const CONVERSATION = "multiparty-conversation";
const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;
const envelope = (capability: string, inputs: Record<string, unknown> = {}) => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: [capability], missingInputs: [], inputs },
});

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
  ({ createDelegationGrant, listDelegationGrants } = await import("../../api/runtime/block2/delegation"));
});
beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE delegation_grants, reference_bindings, discovery_candidates,
      discovery_result_sets, commercial_orders, payment_intents, economic_expressions CASCADE
  `));
});

describe("multi-party purchase to fulfillment composition", () => {
  it("persists seller, buyer, approval, payment, and bounded fulfillment authority hops", async () => {
    const expression = await createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType: "resource.capability",
      attributes: { priceMinor: "6100", currency: "SAR" },
    });
    await publishExpression({
      id: expression.id,
      ownerId: SELLER,
      projection: {
        semanticType: "resource.capability",
        summary: "resource.capability",
        publicTerms: { money: { amountMinor: "6100", currency: "SAR" } },
      },
    });
    const call = (content: string, capability: string) => orchestrate({
      db: handle.db,
      worlds,
      ownerId: BUYER,
      conversationId: CONVERSATION,
      content,
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope(capability),
    });
    await call("search resource.capability", "discovery_search");
    const selected = await call("select first", "commerce_select");
    const approved = await call("approve", "commerce_approve");
    const orderId = selected!.data.orderId as string;
    const grant = await createDelegationGrant(handle.db, {
      principalOwnerId: BUYER,
      delegateId: FULFILLER,
      delegateKind: "user",
      purpose: "fulfill-approved-order",
      allowedCapabilities: ["fulfillment.observe", "fulfillment.complete"],
      resourceScope: { kinds: ["commercial_order"], ids: [orderId] },
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      now: new Date("2029-01-01T00:00:00.000Z"),
    });

    const [order] = await handle.db.select().from(commercialOrders)
      .where(and(eq(commercialOrders.id, orderId), eq(commercialOrders.ownerId, BUYER)));
    const [payment] = await handle.db.select().from(paymentIntents)
      .where(eq(paymentIntents.id, approved!.data.paymentIntentId as string));
    const [persistedGrant] = await handle.db.select().from(delegationGrants)
      .where(eq(delegationGrants.id, grant.id));
    expect(order.status).toBe("DRAFT");
    expect(order.sellerRef).toBe(expression.id);
    expect(payment.orderId).toBe(order.id);
    expect(payment.providerConstraints).toMatchObject({ approvedOrderFingerprint: order.termsFingerprint });
    expect(persistedGrant.resourceScope).toEqual({ kinds: ["commercial_order"], ids: [order.id] });
    expect((await handle.db.select().from(economicExpressions)).some((row) => row.ownerId === SELLER)).toBe(true);
    expect((await handle.db.select().from(discoveryResultSets)).some((row) => row.ownerId === BUYER)).toBe(true);
    expect((await handle.db.select().from(referenceBindings)).some((row) => row.ownerId === BUYER)).toBe(true);

    expect(await listDelegationGrants(handle.db, { principalOwnerId: OUTSIDER })).toEqual([]);
    expect(await handle.db.select().from(commercialOrders).where(eq(commercialOrders.ownerId, OUTSIDER))).toEqual([]);
    expect(await handle.db.select().from(paymentIntents).where(eq(paymentIntents.ownerId, OUTSIDER))).toEqual([]);
  });
});