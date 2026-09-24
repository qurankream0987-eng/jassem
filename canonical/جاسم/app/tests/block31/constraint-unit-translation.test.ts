/**
 * JASIM — «أقل من 3 دنانير» MUST ACTUALLY EXCLUDE.
 *
 *   A constraint the need runtime understands must not be silently ignored by
 *   discovery when it can be translated faithfully — and must not become a
 *   hard filter when it cannot.
 *
 *   UNIT_CONVERSION != FX_CONVERSION · FLOAT != MONEY
 *   NEED_ORIGINAL_CONSTRAINT_PRESERVED · DISCOVERY_FILTER_IS_DERIVED
 *
 * Every turn enters through the real conversation boundary.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let fabric: typeof import("../../api/runtime/economic-fabric");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

describe("a stated price bound reaches the search", () => {
  let actor: typeof users.$inferSelect;
  let conversationId: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    fabric = await import("../../api/runtime/economic-fabric");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE conversation_needs, discovery_result_sets,
        discovery_candidates, economic_expressions, reference_bindings,
        living_objects, events CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'unit-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `unit-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    actor = row!;
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(actor.id), title: "unit",
    });
    conversationId = conversation.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  const me = () => String(actor.id);

  async function turn(content: string, envelope: Record<string, unknown>) {
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({ version: 1, decisionId: randomUUID(), ...envelope }),
      provider: "openai", model: "stub-for-unit-translation",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(), conversationId, content,
    });
    return result.output as Record<string, unknown>;
  }

  const base = (over: Record<string, unknown> = {}) => ({
    kind: "direct_action", label: "قول", goal: "هدف",
    intent: {
      requiredCapabilities: [], missingInputs: [], inputs: {},
      risk: "low" as const, persistence: "durable" as const, effects: "none" as const,
    },
    confidence: 0.9, ...over,
  });

  const search = () => base({
    intent: {
      requiredCapabilities: ["discovery"], missingInputs: [],
      inputs: { kind: "NEED", semanticType: "prepared.item" },
      risk: "low" as const, persistence: "durable" as const, effects: "none" as const,
    },
  });

  const costBound = (value: number | string, unit: string) => ({
    intent: "REFINE",
    addConstraints: [{
      dimension: "COST", operator: "AT_MOST", value, unit,
      hardness: "HARD", source: "STATED",
    }],
  });

  async function offering(label: string, priceMinor: string, currency: string) {
    const expression = await fabric.createExpression({
      ownerId: `seller-${label}`, kind: "offering", semanticType: "prepared.item",
      attributes: { priceMinor, currency },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId: `seller-${label}`,
      projection: {
        semanticType: "prepared.item", summary: label,
        publicTerms: { label, money: { amountMinor: priceMinor, currency } },
      },
    });
  }

  const labelsOf = (out: Record<string, unknown>) =>
    (out.data as { candidates: { summary: string }[] }).candidates
      .map((candidate) => candidate.summary).sort();

  // ── §19 · THE PRIMARY JOURNEY ─────────────────────────────────────────────

  it("«أقل من 3 دنانير كويتية» excludes the dearer one and never compares USD", async () => {
    await offering("A", "1500", "KWD");
    await offering("B", "2500", "KWD");
    await offering("C", "3500", "KWD");
    await offering("D", "2000", "USD");

    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("شاورما", { ...base(), need: { intent: "REFINE", addPreferences: ["QUALITY"] } });
    await turn("أقل من 3 دنانير كويتية", { ...base(), need: costBound(3, "KWD") });

    const out = await turn("ابحث", search());
    // A and B are under 3 KWD. C is over. D is priced in another currency and
    // is not compared as though 2000 USD minor were 2000 KWD minor.
    expect(labelsOf(out)).toEqual(["A", "B"]);
    expect((out.data as { unappliedConstraints: unknown[] }).unappliedConstraints).toHaveLength(0);
  });

  it("the need keeps the person's own words while the filter is derived", async () => {
    //   NEED_ORIGINAL_CONSTRAINT_PRESERVED · DISCOVERY_FILTER_IS_DERIVED
    await offering("A", "1500", "KWD");
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("أقل من 3 دنانير", { ...base(), need: costBound(3, "KWD") });
    await turn("ابحث", search());

    const needs = await handle.db.execute(
      sql.raw(`SELECT constraints FROM conversation_needs`),
    );
    const stored = (needs.rows[0] as { constraints: Record<string, unknown>[] }).constraints[0]!;
    // Still «COST AT_MOST 3 KWD», in the units they spoke.
    expect(stored).toMatchObject({ dimension: "COST", value: 3, unit: "KWD", source: "STATED" });

    const sets = await handle.db.execute(
      sql.raw(`SELECT "hardConstraints" FROM discovery_result_sets`),
    );
    // The search filtered on the derived form.
    expect((sets.rows[0] as { hardConstraints: unknown[] }).hardConstraints)
      .toEqual([{ field: "price", maxMinor: "3000", currency: "KWD" }]);
  });

  it("what was actually filtered on is stored with the result set", async () => {
    //   APPLIED_FILTER_AUDITABLE
    await offering("A", "1500", "KWD");
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("أقل من 2.5 دينار", { ...base(), need: costBound(2.5, "KWD") });
    const out = await turn("ابحث", search());

    const sets = await handle.db.execute(
      sql.raw(`SELECT "needId", "needRevision", "hardConstraints" FROM discovery_result_sets`),
    );
    const set = sets.rows[0] as {
      needId: string; needRevision: number; hardConstraints: { maxMinor: string }[];
    };
    // Need, revision and the exact bound applied — the whole audit in one row.
    expect(set.needId).toBeTruthy();
    expect(set.needRevision).toBe(2);
    expect(set.hardConstraints[0]!.maxMinor).toBe("2500");
    expect((out.data as { appliedConstraints: unknown[] }).appliedConstraints).toHaveLength(1);
  });

  // ── §20 · CORRECTION ──────────────────────────────────────────────────────

  it("a corrected bound searches again at the new number, and the old set keeps the old one", async () => {
    //   OLD_RESULT_FILTER_MUTATED = 0
    await offering("A", "1500", "KWD");
    await offering("B", "2500", "KWD");
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("أقل من 3 دنانير", { ...base(), need: costBound(3, "KWD") });
    const first = await turn("ابحث", search());
    expect(labelsOf(first)).toEqual(["A", "B"]);

    await turn("لا، خلها 2 دينار", { ...base(), need: { ...costBound(2, "KWD"), intent: "CORRECT" } });
    const second = await turn("ابحث", search());
    // 2500 is now over the bound.
    expect(labelsOf(second)).toEqual(["A"]);

    // One need, one price bound — a correction replaced it rather than joining it.
    const needs = await handle.db.execute(
      sql.raw(`SELECT constraints, revision FROM conversation_needs`),
    );
    const row = needs.rows[0] as { constraints: { dimension: string }[]; revision: number };
    expect(row.constraints.filter((c) => c.dimension === "COST")).toHaveLength(1);

    // And the FIRST search still records the bound it actually used.
    const sets = await handle.db.execute(
      sql.raw(`SELECT "needRevision", "hardConstraints" FROM discovery_result_sets
        ORDER BY "createdAt"`),
    );
    const [older, newer] = sets.rows as {
      needRevision: number; hardConstraints: { maxMinor: string }[];
    }[];
    expect(older!.hardConstraints[0]!.maxMinor).toBe("3000");
    expect(newer!.hardConstraints[0]!.maxMinor).toBe("2000");
    expect(older!.needRevision).toBeLessThan(newer!.needRevision);
  });

  // ── §21 · WHAT CANNOT BE APPLIED ──────────────────────────────────────────

  it("«أقل من 3» with no currency is refused where it is said, not guessed later", async () => {
    //   MISSING_CURRENCY_GUESSED = 0 · SILENT_GUESSED_FILTER = 0
    //
    // The canonical goal schema already refuses a bare number — «at most 3 of
    // what?» — so the refusal lands at the moment somebody says it, which is
    // earlier and stronger than declining to translate it afterwards. Nothing
    // unusable is ever stored.
    await offering("A", "1500", "KWD");
    await offering("C", "3500", "KWD");
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    const refused = await turn("أقل من 3", {
      ...base(),
      need: {
        intent: "REFINE",
        addConstraints: [{
          dimension: "COST", operator: "AT_MOST", value: 3,
          hardness: "HARD", source: "STATED",
        }],
      },
    });
    expect(JSON.stringify(refused)).toContain("NEED_INVALID");

    // The need carries no price bound at all…
    const needs = await handle.db.execute(
      sql.raw(`SELECT constraints, revision FROM conversation_needs`),
    );
    const row = needs.rows[0] as { constraints: unknown[]; revision: number };
    expect(row.constraints).toHaveLength(0);
    expect(row.revision).toBe(1);

    // …so the search excludes nothing. 3 was never turned into 3000 KWD minor.
    const out = await turn("ابحث", search());
    expect(labelsOf(out)).toEqual(["A", "C"]);
    const sets = await handle.db.execute(
      sql.raw(`SELECT "hardConstraints" FROM discovery_result_sets`),
    );
    expect((sets.rows[0] as { hardConstraints: unknown[] }).hardConstraints).toHaveLength(0);
  });

  it("a search stays honest when the need holds only a direction", async () => {
    //   PREFERENCE_INVENTED_AS_HARD_BOUND = 0
    await offering("A", "1500", "KWD");
    await offering("C", "3500", "KWD");
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("الأرخص", {
      ...base(),
      need: {
        intent: "REFINE",
        addConstraints: [{
          dimension: "COST", operator: "MINIMIZE",
          hardness: "HARD", source: "STATED",
        }],
      },
    });
    const out = await turn("ابحث", search());
    // «cheapest» ranks; it does not exclude.
    expect(labelsOf(out)).toEqual(["A", "C"]);
    const unapplied = (out.data as { unappliedConstraints: { reason: string }[] })
      .unappliedConstraints;
    expect(unapplied[0]!.reason).toBe("DIRECTION_NOT_A_BOUND");
  });

  it("a bound the model states in minor units still works exactly as before", async () => {
    //   MINOR_UNIT_REGRESSION = 0
    await offering("A", "1500", "KWD");
    await offering("C", "3500", "KWD");
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("حد أعلى", { ...base(), need: costBound(3000, "minor") });
    const out = await turn("ابحث", search());
    expect(labelsOf(out)).toEqual(["A"]);
  });
});
