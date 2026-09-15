import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { discoveryResultSets, referenceBindings } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let createRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").createRuntimeConversation;
let getRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").getRuntimeConversation;
let routeCommerceEnvelope: typeof import("../../api/runtime/jasim-runtime").routeRuntimeConversationCommerceEnvelope;

const OWNER = "731";
const SELLER = "web-proof-seller";

beforeAll(async () => {
  handle = await getTestDb();
  process.env.SESSION_SECRET ??= "block31-web-proof-session-secret";
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({
    createRuntimeConversation,
    getRuntimeConversation,
    routeRuntimeConversationCommerceEnvelope: routeCommerceEnvelope,
  } = await import("../../api/runtime/jasim-runtime"));
});
beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE messages, conversations, reference_bindings, discovery_candidates,
      discovery_result_sets, economic_expressions CASCADE
  `));
});

describe("real web runtime conversation commerce seam", () => {
  it("persists discovery output, result set, and bindings through the production turn seam", async () => {
    const expression = await createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType: "resource.capability",
      attributes: { priceMinor: "9100", currency: "SAR" },
    });
    await publishExpression({
      id: expression.id,
      ownerId: SELLER,
      projection: {
        semanticType: "resource.capability",
        summary: "resource.capability",
        publicTerms: { money: { amountMinor: "9100", currency: "SAR" } },
      },
    });
    const conversation = await createRuntimeConversation({ ownerId: OWNER });
    const response = await routeCommerceEnvelope({
      ownerId: OWNER,
      conversationId: conversation.id,
      content: "search resource.capability",
      envelope: {
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "Search",
        goal: "search resource.capability",
        intent: {
          requiredCapabilities: ["discovery_search"],
          missingInputs: [],
          inputs: { query: "resource.capability" },
          risk: "none",
          persistence: "durable",
          effects: "none",
        },
        confidence: 0.98,
      },
    });
    expect(response?.output.kind).toBe("structured_result");
    if (response?.output.kind !== "structured_result") throw new Error("Expected structured_result");
    expect(response.output.data.resultSetId).toBeTruthy();
    expect((await handle.db.select().from(discoveryResultSets)
      .where(eq(discoveryResultSets.conversationId, conversation.id))).length).toBe(1);
    expect((await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.conversationId, conversation.id))).length).toBeGreaterThan(0);
    const persistedConversation = await getRuntimeConversation(conversation.id, OWNER);
    expect(persistedConversation.messages.map((message) => message.outputKind)).toEqual([
      null,
      "structured_result",
    ]);
  });

  it("passes a non-commerce text turn through without fabricating a commerce response", async () => {
    const conversation = await createRuntimeConversation({ ownerId: OWNER });
    const response = await routeCommerceEnvelope({
      ownerId: OWNER,
      conversationId: conversation.id,
      content: "summarize this text",
      envelope: {
        version: 1,
        decisionId: randomUUID(),
        kind: "text",
        content: "Unchanged general-runtime response",
        confidence: 0.9,
      },
    });
    expect(response).toBeNull();
    const persistedConversation = await getRuntimeConversation(conversation.id, OWNER);
    expect(persistedConversation.messages).toHaveLength(1);
    expect(persistedConversation.messages[0]).toMatchObject({
      role: "user",
      content: "summarize this text",
      outputKind: null,
    });
    expect(await handle.db.select().from(discoveryResultSets)).toEqual([]);
  });
});