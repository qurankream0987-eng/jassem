/**
 * JASIM — «قارن الثاني والرابع», on the live resolver.
 *
 * ─── WHAT WAS BROKEN ────────────────────────────────────────────────────────
 *
 * `resolveRuntimeReferences` is the generic reference path every conversational
 * turn goes through. Two things were wrong with it, and only one of them was
 * visible:
 *
 *   1. Its cue pattern contained no ordinal word at all, so an utterance made
 *      entirely of a position — «قارن الثاني والرابع» — returned
 *      `not_requested`. The runtime did not fail to resolve the reference; it
 *      never registered that one had been made.
 *
 *   2. The one ordinal it did know, «الثاني», was resolved as `ranked[1]` —
 *      index one of a list sorted by the runtime's own semantic score. That
 *      answers a different question. «الثاني» is a position in what the person
 *      was shown, and substituting the runtime's second-best guess for their
 *      instruction is a wrong answer delivered at high confidence.
 *
 * These tests run the shipped resolver against a real proof database, with a
 * real enumerated result seeded the way the runtime writes one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { dagNodes, runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let resolveRuntimeReferences: typeof import("../../api/runtime/jasim-runtime").resolveRuntimeReferences;
let createRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").createRuntimeConversation;

// Numeric, because the conversation tables key the owner as a bigint via
// `toNumId`. A descriptive string becomes NaN there and fails the insert.
const ownerId = "9101";
const otherOwnerId = "9102";

/** The five titles, in the order a person would have seen them numbered. */
const TITLES = ["ألف", "باء", "جيم", "دال", "هاء"] as const;

async function seedEnumeratedSources(options: {
  owner: string;
  titles: readonly string[];
  idPrefix: string;
}): Promise<string[]> {
  const [run] = await handle.db
    .insert(runs)
    .values({
      ownerId: options.owner,
      goal: `enumerated result for ${options.idPrefix}`,
      status: "COMPLETED",
      idempotencyKey: `ordinal-${options.owner}-${options.idPrefix}-${Date.now()}`,
    })
    .returning();
  const sources = options.titles.map((title, index) => ({
    sourceId: `${options.idPrefix}-${index + 1}`,
    title,
    snippet: `مقتطف ${title}`,
    url: `https://example.invalid/${options.idPrefix}/${index + 1}`,
  }));
  const [node] = await handle.db
    .insert(dagNodes)
    .values({
      runId: run.id,
      ownerId: options.owner,
      nodeKey: `${options.idPrefix}-node`,
      status: "COMPLETED",
      inputs: {},
      output: { sources },
      completedAt: new Date(),
    })
    .returning();
  // The ids the resolver builds, so a test can assert WHICH item came back
  // rather than merely that something did.
  return sources.map((source) => `${node.id}:${source.sourceId}`);
}

describe("ordinal references resolve to positions, on the live path", () => {
  let conversationId: string;
  let sourceIds: string[];

  beforeAll(async () => {
    handle = await getTestDb();
    ({ resolveRuntimeReferences, createRuntimeConversation } = await import(
      "../../api/runtime/jasim-runtime"
    ));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events CASCADE"));
    const conversation = await createRuntimeConversation({ ownerId, title: "ordinals" });
    conversationId = conversation.id;
    sourceIds = await seedEnumeratedSources({ owner: ownerId, titles: TITLES, idPrefix: "src" });
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const resolve = (content: string) =>
    resolveRuntimeReferences({ ownerId, conversationId, content });

  it("an utterance made only of ordinals is no longer `not_requested`", async () => {
    // The headline defect. Before this wave the cue pattern held no ordinal,
    // so this sentence never reached the resolver's body at all.
    const resolution = await resolve("قارن المصدر الثاني والرابع");
    expect(resolution.status).not.toBe("not_requested");
  });

  it("«الثاني» is the second item shown, not the second-best match", async () => {
    const resolution = await resolve("اعرض المصدر الثاني");
    expect(resolution.status).toBe("resolved");
    expect(resolution.references).toHaveLength(1);
    expect(resolution.references[0].resolvedId).toBe(sourceIds[1]);
    expect(resolution.references[0].evidence).toContain("Position 2 of 5");
  });

  it.each([
    ["المصدر الأول", 0],
    ["المصدر الثالث", 2],
    ["المصدر الخامس", 4],
  ])("«%s» resolves to the item at that position", async (phrase, index) => {
    const resolution = await resolve(`اعرض ${phrase}`);
    expect(resolution.status).toBe("resolved");
    expect(resolution.references[0]?.resolvedId).toBe(sourceIds[index]);
  });

  it("«قارن الثاني والرابع» returns BOTH, in the order written", async () => {
    // One reference would have silently dropped half of the request.
    const resolution = await resolve("قارن المصدر الثاني والرابع");
    expect(resolution.status).toBe("resolved");
    expect(resolution.references.map((reference) => reference.resolvedId)).toEqual([
      sourceIds[1],
      sourceIds[3],
    ]);
  });

  it("«الأخير» is the last item, whatever the list length is", async () => {
    const resolution = await resolve("اعرض المصدر الأخير");
    expect(resolution.status).toBe("resolved");
    expect(resolution.references[0]?.resolvedId).toBe(sourceIds[4]);
  });

  it("«الذي قبله» is the one before the last, not the last", async () => {
    const resolution = await resolve("اعرض المصدر الذي قبله");
    expect(resolution.status).toBe("resolved");
    expect(resolution.references[0]?.resolvedId).toBe(sourceIds[3]);
  });

  it("a position past the end is unresolved, never the nearest item", async () => {
    // Clamping «السابع» to the fifth would be a confident wrong answer, which
    // is the failure this whole codebase refuses.
    const resolution = await resolve("اعرض المصدر السابع");
    expect(resolution.status).toBe("unresolved");
    expect(resolution.references).toEqual([]);
    expect(resolution.clarification).toContain("5");
  });

  it("one bad position in a pair fails the whole pair", async () => {
    const resolution = await resolve("قارن المصدر الثاني والتاسع");
    expect(resolution.status).toBe("unresolved");
    expect(resolution.references).toEqual([]);
  });

  it("a position never reaches another owner's enumeration", async () => {
    // The security property that outlives this feature: an ordinal is a
    // position within what THIS owner was shown.
    const foreign = await seedEnumeratedSources({
      owner: otherOwnerId,
      titles: ["واو", "زاي", "حاء"],
      idPrefix: "foreign",
    });
    const resolution = await resolve("اعرض المصدر الثاني");
    expect(resolution.status).toBe("resolved");
    expect(resolution.references[0]?.resolvedId).toBe(sourceIds[1]);
    for (const reference of resolution.references) {
      expect(foreign).not.toContain(reference.resolvedId);
    }
  });

  it("an ordinal with nothing enumerated does not invent a position", async () => {
    await handle.db.execute(sql.raw("TRUNCATE TABLE dag_nodes CASCADE"));
    const resolution = await resolve("اعرض المصدر الثاني");
    expect(resolution.status).not.toBe("resolved");
  });

  it("the newest enumeration wins when there are two", async () => {
    // A person says «الثاني» about the list in front of them, which is the one
    // produced most recently — not the one from six turns ago.
    const newer = await seedEnumeratedSources({
      owner: ownerId,
      titles: ["طاء", "ياء", "كاف"],
      idPrefix: "newer",
    });
    const resolution = await resolve("اعرض المصدر الثاني");
    expect(resolution.status).toBe("resolved");
    expect(resolution.references[0]?.resolvedId).toBe(newer[1]);
  });

  it("an utterance with no ordinal still behaves as it always did", async () => {
    // The regression guard. Removing the old `ranked[1]` line must not change
    // what a non-ordinal reference resolves to.
    const resolution = await resolve("ما هو الطقس غداً؟");
    expect(resolution.status).toBe("not_requested");
  });
});
