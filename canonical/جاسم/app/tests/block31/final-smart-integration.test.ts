import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let projectStructuredResult: typeof import("../../api/runtime/presentation-fabric").projectStructuredResult;

const OWNER = "final-smart-owner";
const SELLER = "final-smart-seller";
const CONVERSATION = "final-smart-conversation";
const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;

function envelope(capability: string, inputs: Record<string, unknown> = {}) {
  return {
    decisionId: randomUUID(),
    kind: "message",
    intent: {
      requiredCapabilities: [capability],
      missingInputs: [],
      inputs,
    },
  };
}

async function turn(
  content: string,
  capability: string,
  inputs: Record<string, unknown> = {},
) {
  return orchestrate({
    db: handle.db,
    worlds,
    ownerId: OWNER,
    conversationId: CONVERSATION,
    content,
    approvalRef: `message-${randomUUID()}`,
    envelope: envelope(capability, inputs),
  });
}

describe("JASIM Final Smart Integration", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
    ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
    ({ projectStructuredResult } = await import("../../api/runtime/presentation-fabric"));
  });

  beforeEach(async () => {
    await handle.db.execute(sql.raw(`
      TRUNCATE TABLE reference_bindings, discovery_candidates,
        discovery_result_sets, economic_expressions CASCADE
    `));
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("keeps second and fourth bound to the same internal canonical ResultSet", async () => {
    for (const semanticType of [
      "integration.alpha",
      "integration.beta",
      "integration.gamma",
      "integration.delta",
    ]) {
      const expression = await createExpression({
        ownerId: SELLER,
        kind: "offering",
        semanticType,
      });
      await publishExpression({
        id: expression.id,
        ownerId: SELLER,
        projection: { semanticType, summary: semanticType },
      });
    }

    const search = await turn(
      "ابحث داخل جاسم عن integration",
      "discovery_search",
      { query: "integration", scope: "INTERNAL", limit: 4 },
    );
    expect(search?.status).toBe("completed");
    const searchData = search?.data as {
      resultSetId: string;
      sources: string[];
      candidates: Array<Record<string, unknown>>;
    };
    expect(searchData.sources).toEqual(["JASIM_INTERNAL"]);
    expect(searchData.candidates).toHaveLength(4);
    expect(searchData.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "JASIM_INTERNAL",
          trust: "canonical_internal",
          canonicalRef: expect.any(String),
          externalRef: null,
          provenance: expect.objectContaining({
            canonicalKind: "economic_expression",
            version: expect.any(Number),
          }),
        }),
      ]),
    );

    const comparison = await turn(
      "قارن الثاني والرابع",
      "discovery_compare",
      { positions: [2, 4] },
    );
    expect(comparison).toMatchObject({
      status: "completed",
      data: {
        resultSetId: searchData.resultSetId,
        selectedPositions: [2, 4],
        semanticOutput: "comparison",
      },
    });
    expect((comparison?.data.candidates as Array<{ position: number }>).map((row) => row.position))
      .toEqual([2, 4]);

    const presentation = projectStructuredResult({
      label: comparison!.label,
      summary: comparison!.summary,
      data: comparison!.data,
    });
    expect(presentation.primitive).toBe("COMPARISON");
    expect(presentation.data.resultSetId).toBe(searchData.resultSetId);
  });

  it("blocks unavailable external discovery without fabricated results", async () => {
    const result = await turn(
      "ابحث فقط في الويب عن منتج حي",
      "discovery_search",
      { query: "live product", scope: "WEB" },
    );
    expect(result).toMatchObject({
      status: "blocked",
      data: {
        sources: [],
        candidates: [],
        semanticOutput: "error",
        blocker: "BLOCKED_BY_PROVIDER",
        effects: "none",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/merchant|price|availability|EXTERNAL_PROVIDER/u);
    expect(projectStructuredResult({
      label: result!.label,
      summary: result!.summary,
      data: result!.data,
    }).primitive).toBe("ERROR_STATE");
  });
});