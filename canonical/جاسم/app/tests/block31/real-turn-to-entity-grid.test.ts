/**
 * JASIM — A REAL TURN, A CANONICAL RESULT SET, AND A GRID.
 *
 * ─── WHY THIS TEST AND NOT A UNIT TEST ──────────────────────────────────────
 *
 * `decidePresentation({ resultCount: 6 })` returning ENTITY_GRID proves the
 * decision and nothing about the BRIDGE. What was missing was never the
 * decision — it was whether a real conversation reaches it from canonical
 * state. So nothing here is injected: no `currentPresentation` handed in, no
 * `metadata.presentation` seeded, no candidate invented. A person asks, real
 * offerings are found, and the surface is read back from the projection the
 * interface itself queries.
 *
 *   PRESENTATION = READ-ONLY PROJECTION OF AUTHORIZED CANONICAL STATE
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;

let SEEKER = "";
let HOLDER = "";

/** Neutral. The bridge must never learn what any of this is. */
const KIND = "capability.offering";

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
  const rows = await handle.db.insert(users).values([
    { unionId: `seek-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
  ] as never).returning();
  SEEKER = String(rows[0]!.id);
  HOLDER = String(rows[1]!.id);
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
    economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
    reference_bindings, messages, conversations, events CASCADE`));
});

describe("a real turn reaches a grid from canonical state", () => {
  async function publish(count: number) {
    for (let index = 0; index < count; index += 1) {
      const expression = await fabric.createExpression({
        ownerId: HOLDER,
        kind: "offering",
        semanticType: KIND,
        attributes: { quantity: 10 + index },
      });
      await fabric.publishExpression({
        id: expression.id,
        ownerId: HOLDER,
        projection: { semanticType: KIND, summary: `عنصر ${index + 1}` },
      });
    }
  }

  /** A real turn: the person's own words through the production orchestrator. */
  async function ask(content: string) {
    const conversation = await runtime.createRuntimeConversation({
      ownerId: SEEKER, title: "بحث",
    });
    const output = await orchestrate({
      db: handle.db,
      ownerId: SEEKER,
      conversationId: conversation.id,
      content,
      approvalRef: `msg-${randomUUID()}`,
      envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
    } as never);
    return { conversation, output };
  }

  it("six published offerings become an ENTITY_GRID the interface can read", async () => {
    await publish(6);
    const { conversation, output } = await ask(`ابحث عن ${KIND}`);

    // The canonical result set exists, and the turn is a structured result.
    expect(output?.kind).toBe("structured_result");
    const data = output!.data as { resultSetId: string; candidates: unknown[] };
    expect(data.resultSetId).toBeTruthy();
    expect(data.candidates).toHaveLength(6);

    // THE BRIDGE: the same projection the interface queries, not an injection.
    const surface = (await import("../../api/runtime/presentation-fabric")).projectStructuredResult({
      label: output!.label, summary: output!.summary, data: output!.data,
    });
    expect(surface.primitive).toBe("ENTITY_GRID");
    const cards = (surface.data as { candidates: Record<string, unknown>[] }).candidates;
    expect(cards).toHaveLength(6);
    // Every card carries a canonical identity the selection path can resolve.
    for (const card of cards) expect(typeof card.ref).toBe("string");
    // And nothing was invented.
    for (const card of cards) expect(card.image).toBeUndefined();
    expect(conversation.id).toBeTruthy();
  });

  it("three become the smaller surface, by count alone", async () => {
    await publish(3);
    const { output } = await ask(`ابحث عن ${KIND}`);
    const surface = (await import("../../api/runtime/presentation-fabric")).projectStructuredResult({
      label: output!.label, summary: output!.summary, data: output!.data,
    });
    expect(surface.primitive).toBe("SEARCH_RESULTS");
  });

  it("nothing published produces no cards and no fake ones", async () => {
    const { output } = await ask(`ابحث عن ${KIND}`);
    const surface = (await import("../../api/runtime/presentation-fabric")).projectStructuredResult({
      label: output!.label, summary: output!.summary, data: output!.data,
    });
    expect((surface.data as { candidates: unknown[] }).candidates).toEqual([]);
  });

  it("the surface a later turn shows is the later result set, not the earlier one", async () => {
    //   STALE_RESULTSET_PRESENTATION_SURVIVES_NEW_VERSION = 0
    await publish(3);
    const first = await ask(`ابحث عن ${KIND}`);
    expect((first.output!.data as { candidates: unknown[] }).candidates).toHaveLength(3);
    await publish(4);
    const second = await ask(`ابحث عن ${KIND}`);
    const secondData = second.output!.data as { resultSetId: string; candidates: unknown[] };
    expect(secondData.candidates).toHaveLength(7);
    // A new result set, not the old one re-shown.
    expect(secondData.resultSetId).not.toBe(
      (first.output!.data as { resultSetId: string }).resultSetId,
    );
  });

  it("the projection the INTERFACE queries carries the grid — nothing injected", async () => {
    //   F. Why was `currentPresentation` null? Because the candidates travelled
    //   under names the card does not read; the chain itself was whole.
    //
    // This drives the production envelope path, which writes the assistant
    // message AND its `metadata.presentation`, then reads the surface back
    // through `getActiveWorkspaceProjection` — the same call the interface
    // makes. No presentation is handed in and no metadata is seeded.
    await publish(6);
    const conversation = await runtime.createRuntimeConversation({
      ownerId: SEEKER, title: "بحث حقيقي",
    });
    const routed = await runtime.routeRuntimeConversationCommerceEnvelope({
      ownerId: SEEKER,
      conversationId: conversation.id,
      content: `ابحث عن ${KIND}`,
      envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
    } as never);
    expect(routed).not.toBeNull();

    const projected = await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: conversation.id,
    });
    expect(projected.currentPresentation).not.toBeNull();
    expect(projected.currentPresentation!.primitive).toBe("ENTITY_GRID");
    const cards = (projected.currentPresentation!.data as {
      candidates: Record<string, unknown>[];
    }).candidates;
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(typeof card.ref).toBe("string");
      expect(card.image).toBeUndefined();
    }
  });

  it("a conversation's surface does not leak into another conversation", async () => {
    //   CROSS_CONVERSATION_PRESENTATION_LEAK = 0
    await publish(6);
    const withResults = await ask(`ابحث عن ${KIND}`);
    expect((withResults.output!.data as { candidates: unknown[] }).candidates).toHaveLength(6);

    const other = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "أخرى" });
    const projected = await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: other.id,
    });
    expect(projected.currentPresentation).toBeNull();
  });
});
