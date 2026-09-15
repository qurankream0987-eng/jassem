import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  commercialOrders,
  discoveryResultSets,
  economicExpressions,
  referenceBindings,
} from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let discover: typeof import("../../api/runtime/block31/discovery").discover;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;

const OWNER = "intent-owner";
const SELLER = "intent-seller";
const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;
const envelope = (capabilities: string[], inputs: Record<string, unknown> = {}) => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: capabilities, missingInputs: [], inputs },
});
const call = (
  conversationId: string,
  content: string,
  capabilities: string[],
  inputs: Record<string, unknown> = {},
) => orchestrate({
  db: handle.db,
  worlds,
  ownerId: OWNER,
  conversationId,
  content,
  approvalRef: `message-${randomUUID()}`,
  envelope: envelope(capabilities, inputs),
});

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ discover } = await import("../../api/runtime/block31/discovery"));
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
});
beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      commercial_orders, payment_intents, economic_expressions CASCADE
  `));
});

async function seedOffering(ownerId = SELLER) {
  const expression = await createExpression({
    ownerId,
    kind: "offering",
    semanticType: "resource.capability",
    attributes: { priceMinor: "2500", currency: "SAR" },
  });
  return publishExpression({
    id: expression.id,
    ownerId,
    projection: {
      semanticType: "resource.capability",
      summary: "resource.capability",
      publicTerms: { money: { amountMinor: "2500", currency: "SAR" } },
    },
  });
}

describe("adaptive conversation intent handling", () => {
  it("clarifies an ordinal when two result sets are equally current and never guesses", async () => {
    await seedOffering();
    const conversationId = "ambiguous-conversation";
    await discover(handle.db, {
      ownerId: OWNER,
      conversationId,
      query: "resource.capability",
      availability: { internal: true, web: false },
    });
    await discover(handle.db, {
      ownerId: OWNER,
      conversationId,
      query: "resource.capability",
      availability: { internal: true, web: false },
    });
    const sameInstant = new Date("2025-01-01T00:00:00.000Z");
    await handle.db.update(discoveryResultSets).set({ createdAt: sameInstant })
      .where(eq(discoveryResultSets.conversationId, conversationId));

    const result = await call(conversationId, "select first", ["commerce_select"]);
    expect(result?.label).toBe("Clarification required");
    expect(result?.status).toBe("awaiting_input");
    expect(result?.summary).toMatch(/أكثر من مجموعة نتائج/);
    expect(result?.data.effects).toBe("none");
    expect(await handle.db.select().from(commercialOrders)).toEqual([]);
  });

  it("does not reuse a publication intent when the next same-domain turn is discovery", async () => {
    const conversationId = "intent-switch-conversation";
    const published = await call(
      conversationId,
      "sell resource.capability",
      ["commerce_publish"],
      { subject: "resource.capability", priceMinor: "3200", currency: "SAR" },
    );
    const searched = await call(
      conversationId,
      "search resource.capability",
      ["discovery_search"],
      { query: "resource.capability" },
    );
    expect(published?.label).toBe("Offering published");
    expect(searched?.label).toBe("Discovery results");
    expect(searched?.data.resultSetId).toBeTruthy();
    const bindings = await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversationId));
    expect(bindings.some((row) => row.targetKind === "discovery_candidate")).toBe(true);
    expect(bindings.some((row) => row.targetId === published!.data.expressionId)).toBe(false);
    expect((await handle.db.select().from(economicExpressions)).length).toBe(1);
  });

  it("returns null for a non-commercial research envelope", async () => {
    const result = await call(
      "research-conversation",
      "summarize the supplied material",
      ["document_analysis"],
    );
    expect(result).toBeNull();
    expect(await handle.db.select().from(economicExpressions)).toEqual([]);
    expect(await handle.db.select().from(discoveryResultSets)).toEqual([]);
  });
});