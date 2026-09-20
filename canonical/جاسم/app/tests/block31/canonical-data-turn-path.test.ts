/**
 * JASIM — real rows reach a real surface, through the real turn.
 *
 * The sequence the phase brief asks for, end to end:
 *
 *   «أرني عملياتي»      → DIRECT_READ → AuthorizedQuery → CanonicalDataset → TABLE
 *   «رتبها من الأعلى»   → the SAME dataset, re-sorted, no second read
 *   «حولها إلى رسم»     → the SAME dataset → MORPH → CHART
 *
 * Only the provider call is stubbed. The rows are real rows this test inserted
 * into the real proof database, read back through the shipped source adapter.
 * Nothing here is a fixture pretending to be data.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runs } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let routeRuntimeConversationTurn: typeof import("../../api/runtime/jasim-runtime").routeRuntimeConversationTurn;
let createRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").createRuntimeConversation;
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const OWNER = "9601";
const OTHER_OWNER = "9602";

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

async function seedRuns(owner: string, goals: readonly string[], status = "blocked") {
  for (const [index, goal] of goals.entries()) {
    await handle.db.insert(runs).values({
      ownerId: owner,
      goal,
      status: index % 2 === 0 ? status : "awaiting_input",
      idempotencyKey: `seed-${owner}-${goal}-${Date.now()}-${index}`,
    });
  }
}

let conversationId: string;

async function turn(utterance: string, body: string, owner = OWNER) {
  vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
    text: body,
    provider: "openai",
    model: "stub-for-data-test",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  } as never);
  const result = await routeRuntimeConversationTurn({
    ownerId: owner,
    conversationId,
    content: utterance,
  });
  return {
    result,
    output: result.output as Record<string, unknown>,
    metadata: (result.assistantMessage.metadata ?? {}) as Record<string, unknown>,
  };
}

describe("canonical data reaches a surface through the live turn", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    ({ routeRuntimeConversationTurn, createRuntimeConversation } = await import(
      "../../api/runtime/jasim-runtime"
    ));
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events CASCADE"));
    const conversation = await createRuntimeConversation({ ownerId: OWNER, title: "data" });
    conversationId = conversation.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── A ──────────────────────────────────────────────────────────────────────

  it("«أرني عملياتي» returns a TABLE of REAL rows", async () => {
    await seedRuns(OWNER, ["ألف", "باء", "جيم"]);
    const { output, metadata } = await turn(
      "أرني عملياتي",
      envelope({
        planGraph: READ_PLAN,
        dataNeed: { version: 1, resource: "runs", fields: ["goal", "status"] },
      }),
    );

    expect(metadata.semanticRoute).toBe("DIRECT_READ");
    expect(output.kind).toBe("dataset");
    expect(output.primitive).toBe("TABLE");
    expect(output.rowCount).toBe(3);

    const surface = output.surface as Record<string, unknown>;
    const rows = surface.rows as Array<{ cells: Array<{ key: string; value: unknown }> }>;
    const goals = rows.map((row) => row.cells.find((cell) => cell.key === "goal")!.value);
    // The rows this test inserted, not rows anybody invented.
    expect(goals.sort()).toEqual(["ألف", "باء", "جيم"]);
  });

  it("the dataset never claims live data", async () => {
    await seedRuns(OWNER, ["ألف"]);
    const { output, result } = await turn(
      "أرني عملياتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }),
    );
    expect(output.freshness).toBe("UNKNOWN");
    expect(result.assistantMessage.content).not.toContain("مباشر");
    expect(result.assistantMessage.content).toContain("آخر قراءة");
  });

  it("an empty result is a real answer, not an error and not invented rows", async () => {
    const { output, result } = await turn(
      "أرني عملياتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }),
    );
    expect(output.rowCount).toBe(0);
    expect((output.surface as Record<string, unknown>).emptyReason).toBe("NO_ROWS");
    expect(result.assistantMessage.content).toContain("لا توجد نتائج");
  });

  // ── B ──────────────────────────────────────────────────────────────────────

  it("«رتبها من الأعلى» reuses the SAME dataset", async () => {
    await seedRuns(OWNER, ["ألف", "باء", "جيم"]);
    const first = await turn(
      "أرني عملياتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }),
    );
    const firstId = first.output.datasetId;

    const second = await turn(
      "رتبها من الأعلى",
      envelope({ datasetOp: { op: "SORT", field: "goal", direction: "DESC" } }),
    );

    // Same dataset id — this is the same read, seen differently.
    expect(second.output.datasetId).toBe(firstId);
    expect(second.output.revision).toBe(2);
    expect(second.output.primitive).toBe("TABLE");

    const rows = (second.output.surface as Record<string, unknown>).rows as Array<{
      position: number;
      cells: Array<{ key: string; value: unknown }>;
    }>;
    expect(rows.map((row) => row.cells.find((c) => c.key === "goal")!.value)).toEqual([
      "جيم", "باء", "ألف",
    ]);
    // Positions renumbered, because «اعرض الثاني» now means a different row.
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it("a re-sort performs no second read", async () => {
    await seedRuns(OWNER, ["ألف", "باء"]);
    await turn("أرني عملياتي", envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }));

    // Delete every row. A re-sort that re-queried would now return nothing.
    await handle.db.execute(sql.raw("DELETE FROM runs"));

    const second = await turn(
      "رتبها من الأعلى",
      envelope({ datasetOp: { op: "SORT", field: "goal", direction: "ASC" } }),
    );
    expect(second.output.rowCount).toBe(2);
  });

  // ── C ──────────────────────────────────────────────────────────────────────

  it("«حولها إلى رسم» morphs the SAME dataset into a CHART", async () => {
    await seedRuns(OWNER, ["ألف", "باء", "جيم", "دال"]);
    const first = await turn(
      "أرني عملياتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }),
    );

    const second = await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", aggregation: "COUNT" },
      }),
    );

    expect(second.output.primitive).toBe("CHART");
    expect(second.output.datasetId).toBe(first.output.datasetId);
    const surface = second.output.surface as Record<string, unknown>;
    const points = surface.points as Array<{ category: string; value: number }>;
    expect(points.reduce((total, point) => total + point.value, 0)).toBe(4);
  });

  it("a chart over a non-numeric measure is refused, not coerced", async () => {
    await seedRuns(OWNER, ["ألف"]);
    await turn("أرني عملياتي", envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }));
    const { output } = await turn(
      "حولها إلى رسم",
      envelope({
        datasetOp: { op: "CHART", form: "BAR", categoryField: "status", measureField: "goal", aggregation: "AVG" },
      }),
    );
    expect(output.kind).toBe("routed");
    expect(output.cause).toBe("NOT_MEASURABLE");
  });

  it("a dataset operation with nothing on screen says so", async () => {
    const { output } = await turn(
      "رتبها من الأعلى",
      envelope({ datasetOp: { op: "SORT", field: "goal", direction: "ASC" } }),
    );
    expect(output.cause).toBe("NO_ACTIVE_DATASET");
  });

  // ── D — cross-owner ────────────────────────────────────────────────────────

  it("owner A cannot read owner B's rows", async () => {
    await seedRuns(OWNER, ["لي"]);
    await seedRuns(OTHER_OWNER, ["ليس لي", "ولا هذا"]);

    const { output } = await turn(
      "أرني عملياتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs", fields: ["goal"] } }),
    );
    expect(output.rowCount).toBe(1);
    const serialized = JSON.stringify(output);
    expect(serialized).toContain("لي");
    expect(serialized).not.toContain("ليس لي");
    expect(serialized).not.toContain("ولا هذا");
  });

  // ── E — missing resource, and the other truthful states ────────────────────

  it("«أرني مبيعاتي» is UNAVAILABLE — no invented sales", async () => {
    const { output, result } = await turn(
      "أرني مبيعاتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "مبيعاتي" } }),
    );
    expect(output.kind).toBe("routed");
    expect(output.state).toBe("UNAVAILABLE");
    expect(result.assistantMessage.content).toContain("لا يوجد مصدر بيانات");
  });

  it("a sensitive field is DENIED on the live path", async () => {
    await seedRuns(OWNER, ["ألف"]);
    const { output } = await turn(
      "أرني مفاتيح عملياتي",
      envelope({
        planGraph: READ_PLAN,
        dataNeed: { version: 1, resource: "runs", fields: ["idempotencyKey"] },
      }),
    );
    expect(output.state).toBe("DENIED");
    expect(JSON.stringify(output)).not.toContain("seed-");
  });

  it("an unknown field is NEEDS_INPUT", async () => {
    const { output } = await turn(
      "أرني أرباح عملياتي",
      envelope({
        planGraph: READ_PLAN,
        dataNeed: { version: 1, resource: "runs", fields: ["revenue"] },
      }),
    );
    expect(output.state).toBe("NEEDS_INPUT");
  });

  it("a read with no data need asks rather than guesses", async () => {
    const { output } = await turn("أرني شيئاً", envelope({ planGraph: READ_PLAN }));
    expect(output.state).toBe("NEEDS_INPUT");
    expect(output.cause).toBe("DATA_NEED_MISSING");
  });

  it("an ownerId smuggled into the data need fails the turn", async () => {
    await expect(
      turn(
        "أرني عمليات غيري",
        envelope({
          planGraph: READ_PLAN,
          dataNeed: { version: 1, resource: "runs", ownerId: OTHER_OWNER },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL in the data need fails the turn", async () => {
    await expect(
      turn(
        "أرني كل شيء",
        envelope({
          planGraph: READ_PLAN,
          dataNeed: { version: 1, resource: "runs", rawSql: "SELECT * FROM runs" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("a filter value containing SQL is bound, not interpreted", async () => {
    await seedRuns(OWNER, ["ألف"]);
    const { output } = await turn(
      "أرني عملياتي",
      envelope({
        planGraph: READ_PLAN,
        dataNeed: {
          version: 1,
          resource: "runs",
          filters: [{ field: "goal", operator: "EQ", value: "'; DROP TABLE runs; --" }],
        },
      }),
    );
    // It matched nothing, and the table is still there.
    expect(output.rowCount).toBe(0);
    const remaining = await handle.db.select().from(runs);
    expect(remaining).toHaveLength(1);
  });

  // ── Observability ─────────────────────────────────────────────────────────

  it("the read is recorded as shape and counts, never as contents", async () => {
    await seedRuns(OWNER, ["سرّي جداً"]);
    const { metadata } = await turn(
      "أرني عملياتي",
      envelope({
        planGraph: READ_PLAN,
        dataNeed: {
          version: 1,
          resource: "runs",
          filters: [{ field: "status", operator: "EQ", value: "blocked" }],
        },
      }),
    );
    const read = metadata.read as Record<string, unknown>;
    expect(read.resource).toBe("runs");
    expect(read.rowCount).toBe(1);
    expect(read.status).toBe("OK");
    const serialized = JSON.stringify(read);
    // No row payload, no filter VALUE, no owner id.
    expect(serialized).not.toContain("سرّي");
    expect(serialized).not.toContain("blocked");
    expect(serialized).not.toContain(OWNER);
  });

  // ── Bounded ───────────────────────────────────────────────────────────────

  it("a read is windowed even when nobody asked for a window", async () => {
    await seedRuns(OWNER, Array.from({ length: 60 }, (_, index) => `ه${index}`));
    const { output } = await turn(
      "أرني عملياتي",
      envelope({ planGraph: READ_PLAN, dataNeed: { version: 1, resource: "runs" } }),
    );
    expect(output.rowCount).toBe(50);
    expect((output.surface as { window: { totalRows?: number } }).window.totalRows).toBe(60);
  });
});
