import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { commercialOrders, economicExpressions, paymentIntents } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let discover: typeof import("../../api/runtime/block31/discovery").discover;
let bindReference: typeof import("../../api/runtime/block31/reference-bindings").bindReference;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;

const OWNER = "resource-owner";
const BUYER = "resource-buyer";
const CONVERSATION = "resource-conversation";
const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ discover } = await import("../../api/runtime/block31/discovery"));
  ({ bindReference } = await import("../../api/runtime/block31/reference-bindings"));
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
});
beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      commercial_orders, payment_intents, economic_expressions CASCADE
  `));
});

describe("generic owned-resource monetization", () => {
  it("publishes, discovers, selects, approves, and pins payment to approved terms", async () => {
    const resourceId = `resource-${randomUUID()}`;
    const expression = await createExpression({
      ownerId: OWNER,
      kind: "offering",
      semanticType: "resource.capability",
      subjectEntityId: resourceId,
      attributes: { ownership: { ownerId: OWNER, resourceId }, priceMinor: "7300", currency: "SAR" },
    });
    await publishExpression({
      id: expression.id,
      ownerId: OWNER,
      projection: {
        semanticType: "resource.capability",
        summary: "resource.capability",
        publicTerms: { money: { amountMinor: "7300", currency: "SAR" } },
      },
    });
    const found = await discover(handle.db, {
      ownerId: BUYER,
      conversationId: CONVERSATION,
      query: "resource.capability",
      availability: { internal: true, web: false },
    });
    expect(found.candidates[0]!.canonicalRef).toBe(expression.id);
    await bindReference(handle.db, {
      ownerId: BUYER,
      conversationId: CONVERSATION,
      referenceKey: "ordinal:1",
      targetKind: "discovery_candidate",
      targetId: found.candidates[0]!.id,
      resultSetId: found.resultSet.id,
      position: 1,
    });
    const turn = (content: string, capability: string) => orchestrate({
      db: handle.db,
      worlds,
      ownerId: BUYER,
      conversationId: CONVERSATION,
      content,
      approvalRef: `message-${randomUUID()}`,
      envelope: {
        decisionId: randomUUID(),
        kind: "message",
        intent: { requiredCapabilities: [capability], missingInputs: [], inputs: {} },
      },
    });
    const selected = await turn("select first", "commerce_select");
    const approved = await turn("approve", "commerce_approve");
    const [order] = await handle.db.select().from(commercialOrders)
      .where(eq(commercialOrders.id, selected!.data.orderId as string));
    const [payment] = await handle.db.select().from(paymentIntents)
      .where(eq(paymentIntents.id, approved!.data.paymentIntentId as string));
    const [persistedExpression] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, expression.id));
    expect(persistedExpression.subjectEntityId).toBe(resourceId);
    expect(order.status).toBe("DRAFT");
    expect(payment.providerConstraints).toMatchObject({ approvedOrderFingerprint: order.termsFingerprint });
  });
});