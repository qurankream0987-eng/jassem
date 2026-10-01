/**
 * JASIM — THE PROJECTION NAMES THE RECORD IT IS PRESENTING.
 *
 * ─── THE DUPLICATION, AT ITS SOURCE ─────────────────────────────────────────
 *
 * `getActiveWorkspaceProjection` builds `currentPresentation` by calling
 * `presentationFromMessage(latestMessage.metadata)`. So the workspace host and
 * the message bubble were never two stored surfaces — they were two readers of
 * ONE row, and the person saw it twice.
 *
 *   CANONICAL_PRESENTATION_STATE != VISIBLE_RENDER_INSTANCE
 *
 * Nothing canonical is deleted to fix that. The projection simply says WHICH
 * record it is presenting, so a host can claim that record by identity and the
 * record's own place in the conversation knows not to draw it again.
 *
 *   CANONICAL_PRESENTATION_DELETED_TO_FIX_UI = 0
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq, desc } from "drizzle-orm";
import { users, messages } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let SEEKER = "";
let HOLDER = "";

const KIND = "subsea.instrument.calibration";

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  const rows = await handle.db.insert(users).values([
    { unionId: `seek-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
  ] as never).returning();
  SEEKER = String(rows[0]!.id);
  HOLDER = String(rows[1]!.id);
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, discovery_result_sets,
    discovery_candidates, reference_bindings, messages, conversations, events CASCADE`));
});

async function publish(count: number) {
  for (let i = 0; i < count; i += 1) {
    const e = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: KIND, attributes: { quantity: 10 + i },
    });
    await fabric.publishExpression({
      id: e.id, ownerId: HOLDER,
      projection: { semanticType: KIND, summary: `عنصر ${i + 1}`, publicTerms: { ratedDepth: 450, ratedDepthUnit: "m" } },
    });
  }
}

async function ask(conversationId: string) {
  await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId: SEEKER, conversationId, content: `ابحث عن ${KIND}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
  } as never);
}

const latestAssistantId = async (conversationId: string) => {
  const rows = await handle.db
    .select().from(messages)
    .where(eq(messages.conversationId, Number(conversationId)))
    .orderBy(desc(messages.id));
  return String(rows.find((row) => row.role === "assistant")!.id);
};

describe("the projection names the record it is presenting", () => {
  it("names the exact message the presented surface was read out of", async () => {
    await publish(6);
    const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "ن" });
    await ask(conversation.id);

    const projected = await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: conversation.id,
    });
    expect(projected.currentPresentation).not.toBeNull();
    expect(projected.currentPresentationSource).toEqual({
      kind: "message",
      id: await latestAssistantId(conversation.id),
    });
  });

  it("moves to the NEW record on a later turn, so the earlier one is nobody's claim", async () => {
    //   ONE SEMANTIC PRESENTATION -> ONE VISIBLE INSTANCE, not
    //   ONE CONVERSATION -> ONE PRESENTATION. An earlier turn's surface must
    //   come back to the conversation the moment the host stops presenting it.
    await publish(6);
    const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "ن" });
    await ask(conversation.id);
    const first = (await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: conversation.id,
    })).currentPresentationSource;

    await ask(conversation.id);
    const second = (await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: conversation.id,
    })).currentPresentationSource;

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
    // And the earlier message still holds its own surface — nothing was
    // deleted to stop it being drawn twice.
    const rows = await handle.db
      .select().from(messages)
      .where(eq(messages.conversationId, Number(conversation.id)));
    const withPresentation = rows.filter(
      (row) => (row.metadata as Record<string, unknown> | null)?.presentation,
    );
    expect(withPresentation.length).toBe(2);
  });

  it("claims nothing when the latest record carries no surface", async () => {
    const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "ن" });
    const projected = await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: conversation.id,
    });
    expect(projected.currentPresentation).toBeNull();
    expect(projected.currentPresentationSource).toBeNull();
  });

  it("identity comes from the record, never from what the surface looks like", async () => {
    // Two turns over the SAME six offerings produce byte-identical candidate
    // content. They are still two records and must still be two surfaces.
    //
    //   VISUAL_EQUALITY_USED_FOR_DEDUPE = 0 · JSON_EQUALITY_USED_FOR_DEDUPE = 0
    await publish(6);
    const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "ن" });
    await ask(conversation.id);
    await ask(conversation.id);
    const rows = await handle.db
      .select().from(messages)
      .where(eq(messages.conversationId, Number(conversation.id)));
    const surfaces = rows
      .map((row) => (row.metadata as Record<string, unknown> | null)?.presentation)
      .filter(Boolean)
      .map((value) => JSON.stringify((value as { data?: { candidates?: unknown } }).data?.candidates));
    expect(surfaces).toHaveLength(2);
    const source = (await projection.getActiveWorkspaceProjection({
      ownerId: SEEKER, conversationId: conversation.id,
    })).currentPresentationSource;
    // Exactly one of the two records is claimed, whatever they contain.
    expect(source).not.toBeNull();
    expect(rows.filter((row) => String(row.id) === source!.id)).toHaveLength(1);
  });
});
