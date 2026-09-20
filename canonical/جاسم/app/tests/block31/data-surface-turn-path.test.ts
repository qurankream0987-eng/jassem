/**
 * JASIM — the data surface, inside the ACTIVE conversation.
 *
 * `canonical-data-turn-path.test.ts` proved rows reach a surface. This file
 * proves the part a person actually experiences: the surface stays the SAME
 * object as they ask for different views of it, the ordinal they say next
 * means the row they are looking at, and an aggregate never claims more than
 * it computed.
 *
 *   «أرني عملياتي»        → TABLE   (ENTER)
 *   «رتبها من الأعلى»     → TABLE   (UPDATE, positions renumbered)
 *   «حولها إلى رسم»       → CHART   (MORPH)
 *   «رجّعها جدول»         → TABLE   (MORPH back — no re-query)
 *   «اعرض الصف الثاني»    → the row at presented position 2
 *
 * Only the provider call is stubbed. Every row is a row this test inserted
 * into the real proof database and read back through the shipped adapter.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let routeRuntimeConversationTurn: typeof import("../../api/runtime/jasim-runtime").routeRuntimeConversationTurn;
let createRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").createRuntimeConversation;
let resolveRuntimeReferences: typeof import("../../api/runtime/jasim-runtime").resolveRuntimeReferences;
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const OWNER = "9611";

const INTENT = {
  requiredCapabilities: [],
  missingInputs: [],
  inputs: {},
  risk: "none",
  persistence: "ephemeral",
  effects: "none",
};

const READ_PLAN = { version: 1, kind: "DIRECT_READ", nodes: [], blockers: [] };

function envelope(extra: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    decisionId: randomUUID(),
    kind: "direct_action",
    label: "قراءة",
    goal: "عرض البيانات",
    intent: INTENT,
    confidence: 0.85,
    ...extra,
  });
}

async function seedRuns(goals: readonly string[]) {
  for (const [index, goal] of goals.entries()) {
    await handle.db.insert(runs).values({
      ownerId: OWNER,
      goal,
      status: index % 2 === 0 ? "blocked" : "awaiting_input",
      idempotencyKey: `surface-${goal}-${Date.now()}-${index}`,
    });
  }
}

let conversationId: string;

async function turn(utterance: string, body: string) {
  vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
    text: body,
    provider: "openai",
    model: "stub-for-surface-test",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  } as never);
  const result = await routeRuntimeConversationTurn({
    ownerId: OWNER,
    conversationId,
    content: utterance,
  });
  return {
    result,
    output: result.output as Record<string, unknown>,
    surface: (result.output as { surface?: Record<string, unknown> }).surface ?? {},
    metadata: (result.assistantMessage.metadata ?? {}) as Record<string, unknown>,
  };
}

const read = (extra: Record<string, unknown> = {}) =>
  envelope({
    planGraph: READ_PLAN,
    dataNeed: { version: 1, resource: "runs", ...extra },
  });

describe("the data surface lives inside the conversation", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    ({ routeRuntimeConversationTurn, createRuntimeConversation, resolveRuntimeReferences } =
      await import("../../api/runtime/jasim-runtime"));
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events CASCADE"));
    const conversation = await createRuntimeConversation({ ownerId: OWNER, title: "surface" });
    conversationId = conversation.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── The four lifecycle states, on one dataset ─────────────────────────────

  it("TABLE → CHART → TABLE is one dataset seen three ways", async () => {
    await seedRuns(["ألف", "باء", "جيم", "دال"]);

    const entered = await turn("أرني عملياتي", read({ fields: ["goal", "status"] }));
    expect(entered.output.primitive).toBe("TABLE");
    const datasetId = entered.output.datasetId;

    const morphed = await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "COUNT" },
      }),
    );
    expect(morphed.output.primitive).toBe("CHART");
    expect(morphed.output.datasetId).toBe(datasetId);

    const back = await turn("رجّعها جدول", envelope({ datasetOp: { op: "TABLE" } }));
    expect(back.output.primitive).toBe("TABLE");
    expect(back.output.datasetId).toBe(datasetId);
    // The same revision: going back to the table changed nothing about the
    // data, so calling it a new version would be a lie about the rows.
    expect(back.output.revision).toBe(entered.output.revision);
    expect(back.output.rowCount).toBe(4);
  });

  it("CHART → TABLE performs no second read", async () => {
    await seedRuns(["ألف", "باء"]);
    await turn("أرني عملياتي", read());
    await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "COUNT" },
      }),
    );

    // Every row is gone. A re-query would answer with an empty table, which
    // would be a different answer from the one on screen.
    await handle.db.execute(sql.raw("DELETE FROM runs"));

    const back = await turn("رجّعها جدول", envelope({ datasetOp: { op: "TABLE" } }));
    expect(back.output.rowCount).toBe(2);
    const rows = back.surface.rows as Array<{ cells: Array<{ key: string; value: unknown }> }>;
    expect(rows.map((row) => row.cells.find((cell) => cell.key === "goal")!.value).sort()).toEqual([
      "ألف",
      "باء",
    ]);
  });

  it("a sort survives the morph, so the table comes back in the order it left", async () => {
    await seedRuns(["ألف", "باء", "جيم"]);
    await turn("أرني عملياتي", read());
    await turn(
      "رتبها من الأعلى",
      envelope({ datasetOp: { op: "SORT", field: "goal", direction: "DESC" } }),
    );
    await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "COUNT" },
      }),
    );
    const back = await turn("رجّعها جدول", envelope({ datasetOp: { op: "TABLE" } }));

    expect(back.surface.sort).toEqual([{ field: "goal", direction: "DESC" }]);
    const rows = back.surface.rows as Array<{ position: number; cells: Array<{ key: string; value: unknown }> }>;
    expect(rows.map((row) => row.cells.find((cell) => cell.key === "goal")!.value)).toEqual([
      "جيم",
      "باء",
      "ألف",
    ]);
  });

  it("a view change with nothing on screen says so rather than reading something", async () => {
    const { output } = await turn("رجّعها جدول", envelope({ datasetOp: { op: "TABLE" } }));
    expect(output.kind).toBe("routed");
    expect(output.cause).toBe("NO_ACTIVE_DATASET");
  });

  // ── References follow the PRESENTED order ─────────────────────────────────

  it("«الصف الثاني» means the second row as presented, not as read", async () => {
    // Four rows, not three: with three, reversing the order leaves the middle
    // row at position 2 and the test would pass without proving anything.
    await seedRuns(["ألف", "باء", "تاء", "ثاء"]);
    await turn("أرني عملياتي", read({ sort: [{ field: "goal", direction: "ASC" }] }));

    const beforeSort = await resolveRuntimeReferences({
      ownerId: OWNER,
      conversationId,
      content: "اعرض الصف الثاني",
    });
    expect(beforeSort.status).toBe("resolved");
    const first = beforeSort.references[0]!;
    expect(first.referenceType).toBe("dataset_row");

    // Now reverse the presented order. «الثاني» must follow the screen.
    const resorted = await turn(
      "رتبها من الأعلى",
      envelope({ datasetOp: { op: "SORT", field: "goal", direction: "DESC" } }),
    );
    const rows = resorted.surface.rows as Array<{ ref: string; position: number }>;
    const presentedSecond = rows.find((row) => row.position === 2)!;

    const afterSort = await resolveRuntimeReferences({
      ownerId: OWNER,
      conversationId,
      content: "اعرض الصف الثاني",
    });
    expect(afterSort.status).toBe("resolved");
    expect(afterSort.references[0]!.resolvedId).toContain(presentedSecond.ref);
    // The order really did change; otherwise this test would pass trivially.
    expect(afterSort.references[0]!.resolvedId).not.toBe(first.resolvedId);
  });

  it("the fifth row of a table of three is refused, not approximated", async () => {
    await seedRuns(["ألف", "باء", "جيم"]);
    await turn("أرني عملياتي", read());
    const resolution = await resolveRuntimeReferences({
      ownerId: OWNER,
      conversationId,
      content: "اعرض الصف الخامس",
    });
    expect(resolution.status).toBe("unresolved");
    expect(resolution.references).toHaveLength(0);
  });

  // ── What an aggregate is allowed to claim ─────────────────────────────────

  it("a source-side GROUP BY is counted over everything, and says so", async () => {
    await seedRuns(Array.from({ length: 9 }, (_, index) => `ه${index}`));
    const { output, metadata } = await turn(
      "كم عملية في كل حالة؟",
      read({ groupBy: ["status"], aggregate: [{ field: "id", fn: "COUNT" }] }),
    );

    const dataset = metadata.dataset as {
      aggregation?: { scope: string; coverage: { counted: number } };
    };
    expect(dataset.aggregation?.scope).toBe("SOURCE");
    // Nine rows became two groups: the numbers are the source's, not a
    // reduction of a window.
    expect(output.rowCount).toBe(2);
    const rows = (output.surface as { rows: Array<{ cells: Array<{ key: string; value: unknown }> }> }).rows;
    // The measure column is named by the aggregate, not by the resource: a row
    // of an aggregate is a group, and «العدد» is not a column `runs` has.
    const counts = rows.map((row) => Number(row.cells.find((cell) => cell.key === "COUNT_id")?.value));
    expect(counts.reduce((total, value) => total + value, 0)).toBe(9);
  });

  it("a chart over a source aggregate carries no window caveat", async () => {
    await seedRuns(Array.from({ length: 9 }, (_, index) => `ه${index}`));
    await turn(
      "كم عملية في كل حالة؟",
      read({ groupBy: ["status"], aggregate: [{ field: "id", fn: "COUNT" }] }),
    );
    const { surface } = await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "SUM", measureField: "COUNT_id" },
      }),
    );
    expect(surface.scope).toBe("SOURCE");
  });

  it("a chart over a partial window admits the window", async () => {
    await seedRuns(Array.from({ length: 60 }, (_, index) => `ه${index}`));
    const first = await turn("أرني عملياتي", read());
    expect(first.output.rowCount).toBe(50);

    const { surface } = await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "COUNT" },
      }),
    );
    expect(surface.scope).toBe("PARTIAL_WINDOW");
    expect(surface.coverage).toEqual({ counted: 50, total: 60 });
  });

  it("an aggregate over a field that cannot be grouped is refused", async () => {
    await seedRuns(["ألف"]);
    const { output } = await turn(
      "اجمعها حسب المفتاح",
      read({ groupBy: ["idempotencyKey"], aggregate: [{ field: "id", fn: "COUNT" }] }),
    );
    expect(output.kind).toBe("routed");
    expect(["DENIED", "NEEDS_INPUT"]).toContain(output.state);
    expect(JSON.stringify(output)).not.toContain("surface-");
  });

  // ── What reaches the client ───────────────────────────────────────────────

  it("the surface carries only declared columns", async () => {
    await seedRuns(["ألف"]);
    const { surface } = await turn("أرني عملياتي", read({ fields: ["goal", "status"] }));
    const columns = (surface.columns as Array<{ key: string }>).map((column) => column.key);
    // Exactly what was asked for. The identity field still travels and is
    // still read — it is simply not a column of an answer nobody asked it to
    // be part of.
    expect(columns).toEqual(["goal", "status"]);
    const rows = surface.rows as Array<{ cells: Array<{ key: string }> }>;
    for (const row of rows) {
      expect(row.cells.map((cell) => cell.key)).toEqual(["goal", "status"]);
    }
    expect(JSON.stringify(surface)).not.toContain("idempotencyKey");
    expect(JSON.stringify(surface)).not.toContain("surface-");
  });

  it("asking for everything still shows the identity", async () => {
    // The rule is «not asked for», not «never shown»: a person who named no
    // fields asked for the whole row, and the identity is part of it.
    await seedRuns(["ألف"]);
    const { surface } = await turn("أرني عملياتي", read());
    const columns = (surface.columns as Array<{ key: string }>).map((column) => column.key);
    expect(columns[0]).toBe("id");
  });

  it("an UNAVAILABLE turn reaches the client as a state, not as a reply", async () => {
    const { output, metadata } = await turn(
      "أرني مبيعاتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "مبيعاتي" } }),
    );
    expect(output.kind).toBe("routed");
    expect(output.state).toBe("UNAVAILABLE");
    // Nothing for the surface registry to draw — the client renders the state.
    expect(output.surface).toBeUndefined();
    expect(metadata.surface).toBeUndefined();
  });

  it("a DENIED turn reaches the client as DENIED, carrying none of the denied data", async () => {
    await seedRuns(["ألف"]);
    const { output } = await turn(
      "أرني مفاتيح عملياتي",
      read({ fields: ["idempotencyKey"] }),
    );
    expect(output.kind).toBe("routed");
    expect(output.state).toBe("DENIED");
    expect(output.surface).toBeUndefined();
    expect(JSON.stringify(output)).not.toContain("surface-");
  });

  it("a read never asks to be approved", async () => {
    // The Presentation IR used to come from the envelope's KIND, and
    // `direct_action` maps to «موافقة مطلوبة» — so a table arrived with an
    // approval card under it, asking a person to authorize a read that had
    // already happened. The route is the fact; the kind was a guess.
    await seedRuns(["ألف"]);
    const { output, metadata } = await turn("أرني عملياتي", read());
    expect((output.presentation as { primitive: string }).primitive).toBe("TEXT");
    expect((metadata.presentation as { primitive: string }).primitive).toBe("TEXT");
    expect(JSON.stringify(output.presentation)).not.toContain("موافقة");
  });

  it("a routed non-answer never asks to be approved either", async () => {
    const { output } = await turn(
      "أرني مبيعاتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "مبيعاتي" } }),
    );
    expect((output.presentation as { primitive: string }).primitive).toBe("TEXT");
    expect(JSON.stringify(output.presentation)).not.toContain("موافقة");
  });

  it("the metadata a message carries is the surface the client mounts", async () => {
    await seedRuns(["ألف", "باء"]);
    const { metadata, output } = await turn("أرني عملياتي", read());
    const surface = metadata.surface as Record<string, unknown>;
    // Same object, same identity — the client is not handed a second rendering
    // of the same data that could drift from the one the runtime decided.
    expect(surface.primitive).toBe("TABLE");
    expect(surface.datasetId).toBe(output.datasetId);
    expect(surface.revision).toBe(output.revision);
  });
});
