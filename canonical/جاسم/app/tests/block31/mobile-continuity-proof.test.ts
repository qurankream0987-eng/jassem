import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { commercialOrders, paymentIntents } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;

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
});
beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      commercial_orders, payment_intents, economic_expressions CASCADE
  `));
});

describe("client-agnostic canonical continuity", () => {
  it("runs identical discovery and order flows for mobile-dev and web owner identifiers", async () => {
    const seller = "continuity-seller";
    const expression = await createExpression({
      ownerId: seller,
      kind: "offering",
      semanticType: "resource.capability",
      attributes: { priceMinor: "8800", currency: "SAR" },
    });
    await publishExpression({
      id: expression.id,
      ownerId: seller,
      projection: {
        semanticType: "resource.capability",
        summary: "resource.capability",
        publicTerms: { money: { amountMinor: "8800", currency: "SAR" } },
      },
    });

    const runFlow = async (ownerId: string, conversationId: string) => {
      const turn = (content: string, capability: string, inputs: Record<string, unknown> = {}) =>
        orchestrate({
          db: handle.db,
          worlds,
          ownerId,
          conversationId,
          content,
          approvalRef: `message-${randomUUID()}`,
          envelope: envelope(capability, inputs),
        });
      const found = await turn(
        "search resource.capability",
        "discovery_search",
        { query: "resource.capability" },
      );
      const selected = await turn("select first", "commerce_select");
      const approved = await turn("approve", "commerce_approve");
      const [order] = await handle.db.select().from(commercialOrders)
        .where(eq(commercialOrders.id, selected!.data.orderId as string));
      const [payment] = await handle.db.select().from(paymentIntents)
        .where(eq(paymentIntents.id, approved!.data.paymentIntentId as string));
      return {
        candidateRefs: (found!.data.candidates as Array<{ canonicalRef: string }>).map((row) => row.canonicalRef),
        orderStatus: order.status,
        termsFingerprint: order.termsFingerprint,
        paymentAmount: payment.amountMinor,
        paymentCurrency: payment.currency,
      };
    };

    const mobile = await runFlow("dev:local", "mobile-continuity");
    const web = await runFlow("web-owner-17", "web-continuity");
    expect(mobile).toEqual(web);
    expect(mobile.candidateRefs).toEqual([expression.id]);
  });
});