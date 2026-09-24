/**
 * JASIM — THE RUNTIME REMEMBERS WHAT YOU WANT.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   NEED_CONTINUITY != CHAT_HISTORY_AS_TRUTH · != MODEL_MEMORY
 *   NEED_CONTINUITY != LIVING_OBJECT · != TRANSACTION · != USER_PROFILE_MEMORY
 *   MODEL != NEED_AUTHORITY
 *   TOPIC_SWITCH != NEED_RESOLVED
 *
 * The decisive property: every model stub below sends ONLY the delta. Not one
 * of them restates the prior goal. If continuity came from the model rather
 * than from the runtime, these tests could not pass.
 *
 * Every turn enters through the real boundary, in one conversation.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let needs: typeof import("../../api/runtime/need-continuity");
let fabric: typeof import("../../api/runtime/economic-fabric");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

/**
 * Six unrelated things somebody might want. Not one of them is a kind the
 * runtime knows: they are an outcome and some bounds, six times over.
 *
 *   DOMAIN_NEED_TYPES_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
 */
const HOLDOUTS = [
  { id: "meal", outcome: "أن أشبع", dimension: "COST", value: 3, unit: "KWD" },
  { id: "vehicle", outcome: "أن أجد سيارة", dimension: "COST", value: 10000, unit: "KWD" },
  { id: "interpreter", outcome: "أن أجد مترجماً للمحكمة", dimension: "TIME", value: 2, unit: "HOUR" },
  { id: "storage", outcome: "أن أخزّن بضاعة", dimension: "TIME", value: 2, unit: "WEEK" },
  { id: "machine_time", outcome: "أن أشغّل المكنة الفاضية", dimension: "TIME", value: 6, unit: "HOUR" },
  // Unfamiliar: nothing in this repository has ever needed one.
  { id: "kiln_firing", outcome: "أن أحجز دورة حرق خزف", dimension: "COST", value: 45, unit: "KWD" },
] as const;

describe("what somebody wants survives the turn that said it", () => {
  let actor: typeof users.$inferSelect;
  let conversationId: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    needs = await import("../../api/runtime/need-continuity");
    fabric = await import("../../api/runtime/economic-fabric");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE conversation_needs, living_objects, events,
        economic_expressions, economic_matches, economic_engagements,
        economic_proposals, agreements, commitments, transactions,
        payment_intents, commercial_orders, reference_bindings,
        organizations, memberships, scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'need-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `need-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    actor = row!;
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(actor.id), title: "need",
    });
    conversationId = conversation.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const me = () => String(actor.id);

  /** A real turn. The model says ONLY what changed. */
  async function turn(
    content: string,
    need?: Record<string, unknown>,
    over: Record<string, unknown> = {},
  ) {
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "قول",
        goal: "هدف",
        intent: {
          requiredCapabilities: [], missingInputs: [], inputs: {},
          risk: "low", persistence: "ephemeral", effects: "none",
        },
        confidence: 0.9,
        ...(need ? { need } : {}),
        ...over,
      }),
      provider: "openai", model: "stub-for-need-continuity",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(), conversationId, content,
    });
    return result.output as Record<string, unknown>;
  }

  const bound = (
    dimension: string, value: number, unit: string,
    source: "STATED" | "INFERRED" = "STATED",
    hardness: "HARD" | "SOFT" = "HARD",
  ) => ({ dimension, operator: "AT_MOST", value, unit, hardness, source });

  async function rows() {
    const result = await handle.db.execute(
      sql.raw(`SELECT id, outcome, constraints, preferences, unknowns, state, revision
        FROM conversation_needs WHERE "conversationId" = '${conversationId}'
        ORDER BY "createdAt"`),
    );
    return result.rows as {
      id: string; outcome: string; constraints: { dimension: string; value?: unknown;
      hardness: string; source: string }[]; preferences: string[]; unknowns: string[];
      state: string; revision: number;
    }[];
  }

  // ── A · THE JOURNEY, DELTA ONLY ───────────────────────────────────────────

  it("the whole journey works while the model never restates the prior goal", async () => {
    //   DELTA_ONLY_REFINEMENT · MODEL_MUST_RESTATE_FULL_PRIOR_GOAL = NO
    await turn("جاسم أنا جائع", {
      intent: "NEW", outcome: "أن أشبع", addUnknowns: ["نوع الطعام"],
    });
    const [n1] = await rows();
    expect(n1!.revision).toBe(1);
    expect(n1!.unknowns).toContain("نوع الطعام");

    // From here on, NOT ONE stub mentions «أن أشبع» or any earlier constraint.
    await turn("شاورما", {
      intent: "REFINE", resolveUnknowns: ["نوع الطعام"], addPreferences: ["QUALITY"],
    });
    await turn("قريبة", {
      intent: "REFINE", addConstraints: [
        { dimension: "LOCATION", operator: "MINIMIZE", hardness: "SOFT", source: "STATED" },
      ],
    });
    await turn("وأقل من 3", {
      intent: "REFINE", addConstraints: [bound("COST", 3, "KWD")],
    });

    const after = await rows();
    expect(after).toHaveLength(1);
    const need = after[0]!;
    // The outcome survived four turns without the model ever repeating it.
    expect(need.id).toBe(n1!.id);
    expect(need.outcome).toBe("أن أشبع");
    expect(need.revision).toBe(4);
    expect(need.unknowns).toHaveLength(0);
    expect(need.preferences).toContain("QUALITY");
    expect(need.constraints.map((c) => c.dimension).sort()).toEqual(["COST", "LOCATION"]);
    //   NEED_CREATED_LIVING_OBJECT = 0
    const objects = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM living_objects`));
    expect((objects.rows[0] as { n: number }).n).toBe(0);
  });

  it("a correction replaces a bound instead of piling a second one on it", async () => {
    //   CORRECTION_SEMANTICS
    //   CONTRADICTORY_ACTIVE_CONSTRAINTS_FROM_SIMPLE_CORRECTION = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("أقل من 5", { intent: "REFINE", addConstraints: [bound("COST", 5, "KWD")] });
    await turn("لا، خل الميزانية 7", {
      intent: "CORRECT", addConstraints: [bound("COST", 7, "KWD")],
    });

    const [need] = await rows();
    const cost = need!.constraints.filter((c) => c.dimension === "COST");
    expect(cost).toHaveLength(1);
    expect(cost[0]!.value).toBe(7);
  });

  // ── B · PROVENANCE ────────────────────────────────────────────────────────

  it("what was inferred stays inferred, and cannot exclude", async () => {
    //   PROVENANCE_SURVIVES_REFINEMENT · INFERRED_AS_USER_STATED = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    // The model infers proximity matters and proposes it as HARD.
    await turn("قريبة", {
      intent: "REFINE",
      addConstraints: [
        { dimension: "LOCATION", operator: "MINIMIZE", hardness: "HARD", source: "INFERRED" },
      ],
    });
    const [afterInference] = await rows();
    const inferred = afterInference!.constraints.find((c) => c.dimension === "LOCATION")!;
    // An inference may guide; it may not exclude.
    expect(inferred.hardness).toBe("SOFT");
    expect(inferred.source).toBe("INFERRED");

    // Two more turns later it is still INFERRED. Nothing promoted it.
    await turn("وأقل من 3", { intent: "REFINE", addConstraints: [bound("COST", 3, "KWD")] });
    const [later] = await rows();
    expect(later!.constraints.find((c) => c.dimension === "LOCATION")!.source).toBe("INFERRED");
  });

  it("an inference cannot overwrite something the person actually said", async () => {
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("أقل من 3", { intent: "REFINE", addConstraints: [bound("COST", 3, "KWD")] });
    // The model now "infers" a laxer budget. It must not take the slot.
    await turn("ربما أكثر", {
      intent: "REFINE", addConstraints: [bound("COST", 20, "KWD", "INFERRED", "SOFT")],
    });
    const [need] = await rows();
    const cost = need!.constraints.find((c) => c.dimension === "COST")!;
    expect(cost.value).toBe(3);
    expect(cost.source).toBe("STATED");
  });

  // ── C · TOPIC SWITCH AND RESUME ───────────────────────────────────────────

  it("a topic switch makes a second need and contaminates neither", async () => {
    //   TOPIC_SWITCH_CREATES_SEPARATE_NEED · CONTEXT_CONTAMINATION = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("شاورما رخيصة", {
      intent: "REFINE", addConstraints: [bound("COST", 3, "KWD")],
    });
    await turn("بالمناسبة ابحث لي عن برادو مستعملة", {
      intent: "NEW", outcome: "أن أجد سيارة",
    });

    const all = await rows();
    expect(all).toHaveLength(2);
    const meal = all[0]!;
    const car = all[1]!;
    //   TOPIC_SWITCH != NEED_RESOLVED — it stepped back, it did not finish.
    expect(meal.state).toBe("BACKGROUND");
    expect(car.state).toBe("ACTIVE");
    // The meal's budget did not follow the car.
    expect(car.constraints).toHaveLength(0);
    expect(meal.constraints.map((c) => c.dimension)).toContain("COST");

    // Refining now refines the CAR.
    await turn("أقل من عشرة آلاف", {
      intent: "REFINE", addConstraints: [bound("COST", 10000, "KWD")],
    });
    const afterCar = await rows();
    expect(afterCar[1]!.constraints.find((c) => c.dimension === "COST")!.value).toBe(10000);
    //   MEAL_CONSTRAINTS_ON_CAR_NEED = 0 — the meal is untouched.
    expect(afterCar[0]!.constraints.find((c) => c.dimension === "COST")!.value).toBe(3);
    expect(afterCar[0]!.revision).toBe(meal.revision);
  });

  it("coming back resumes the right need and leaves the other alone", async () => {
    //   PRIOR_NEED_RESUME · WRONG_NEED_MUTATION = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("شاورما", { intent: "REFINE", addPreferences: ["QUALITY"] });
    await turn("بالمناسبة أبي برادو", { intent: "NEW", outcome: "أن أجد سيارة" });
    const beforeResume = await rows();
    const carRevision = beforeResume[1]!.revision;

    await turn("نرجع للأكل، خلها بروستد بدل الشاورما", {
      intent: "RESUME", addAssumptions: ["بروستد بدل الشاورما"],
    });

    const after = await rows();
    expect(after[0]!.state).toBe("ACTIVE");
    expect(after[0]!.outcome).toBe("أن أشبع");
    expect(after[1]!.state).toBe("BACKGROUND");
    // The car was not touched by coming back to the meal.
    expect(after[1]!.revision).toBe(carRevision);
  });

  it("with more than one thing set aside, coming back asks instead of guessing", async () => {
    //   AMBIGUOUS_NEED_GUESS = 0 · LATEST_NEED_ALWAYS_WINS = NO
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("وأحتاج مترجم", { intent: "NEW", outcome: "أن أجد مترجماً" });
    await turn("وأبي برادو", { intent: "NEW", outcome: "أن أجد سيارة" });

    const out = await turn("نرجع", { intent: "RESUME" });
    expect(JSON.stringify(out)).toContain("لم يتضح");
    // Nothing moved.
    const all = await rows();
    expect(all.filter((row) => row.state === "ACTIVE")).toHaveLength(1);
    expect(all[2]!.state).toBe("ACTIVE");
  });

  // ── D · DISCOVERY CONSUMES THE NEED ───────────────────────────────────────

  it("discovery uses canonical need constraints the model never resent", async () => {
    //   DISCOVERY_USES_CANONICAL_NEED
    //   DISCOVERY_RECONSTRUCTS_NEED_FROM_CHAT_HISTORY = NO
    for (const [label, price] of [["cheap", "1000"], ["dear", "9000"]] as const) {
      const expression = await fabric.createExpression({
        ownerId: `seller-${label}`, kind: "offering", semanticType: "prepared.item",
        attributes: { priceMinor: price },
      });
      await fabric.publishExpression({
        id: expression.id, ownerId: `seller-${label}`,
        projection: {
          semanticType: "prepared.item", summary: label,
          publicTerms: { label, money: { amountMinor: price, currency: "KWD" } },
        },
      });
    }
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("شاورما", { intent: "REFINE", addPreferences: ["COST"] });

    // The search turn carries NO constraints at all. Everything it uses came
    // from canonical state.
    const out = await turn("ابحث", undefined, {
      intent: {
        requiredCapabilities: ["discovery"], missingInputs: [],
        inputs: { kind: "NEED", semanticType: "prepared.item" },
        risk: "low", persistence: "ephemeral", effects: "none",
      },
    });
    const data = out.data as { candidates: unknown[] };
    expect(data.candidates.length).toBeGreaterThan(0);

    // And the reference system still answers «which one», not the need.
    //   NEED != RESULT_SET · NEED != REFERENCE_BINDING
    const bindings = await handle.db.execute(
      sql.raw(`SELECT "referenceKey" FROM reference_bindings WHERE "ownerId" = '${me()}'`),
    );
    expect(bindings.rows.length).toBe(data.candidates.length);
  });

  // ── E · WHAT THE MODEL MAY NOT DO ─────────────────────────────────────────

  it("a model cannot set the scope, the revision, or that a need is satisfied", async () => {
    //   MODEL_CAN_SET_NEED_SCOPE = NO · MODEL_CAN_SET_NEED_REVISION = NO
    //   MODEL_CAN_MARK_NEED_SATISFIED = NO · AUTHORITY_SMUGGLING = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    // A claim of authority is LOUD by design: the shared screen throws before
    // anything is stored, exactly as it does for every other runtime. A claim
    // the shared screen does not know is refused by the need's own screen.
    // Either way nothing is written, which is the property that matters.
    for (const forged of [
      { intent: "REFINE", scopeId: "someone-else" },
      { intent: "REFINE", revision: 99 },
      { intent: "REFINE", resolved: true },
      { intent: "REFINE", state: "RESOLVED" },
      { intent: "REFINE", published: true },
      { intent: "REFINE", ownerId: "someone-else" },
    ]) {
      let refused = false;
      try {
        const out = await turn("غيّر", forged);
        refused = /NEED_(FORBIDDEN|INVALID)/.test(JSON.stringify(out));
      } catch (error) {
        refused = /AUTHORITY_REJECTED|may not carry/.test(String(error));
      }
      expect(refused, JSON.stringify(forged)).toBe(true);
    }
    const [need] = await rows();
    // Untouched: not the scope, not the revision, not the state.
    expect(need!.revision).toBe(1);
    expect(need!.state).toBe("ACTIVE");
  });

  it("a need id from another conversation resolves to nothing", async () => {
    //   CROSS_CONVERSATION_NEED_LEAK = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    const [mine] = await rows();

    const other = await runtime.createRuntimeConversation({ ownerId: me(), title: "other" });
    conversationId = other.id;
    const out = await turn("غيّرها", { intent: "REFINE", needRef: mine!.id });
    expect(JSON.stringify(out)).toContain("NEED_NOT_FOUND");
  });

  it("a need belonging to another scope resolves to nothing", async () => {
    //   CROSS_OWNER_NEED_LEAK = 0 · CROSS_SCOPE_NEED_LEAK = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    const [mine] = await rows();
    // Same conversation, different acting scope.
    await handle.db.execute(
      sql.raw(`UPDATE conversation_needs SET "scopeId" = 'another-scope' WHERE id = '${mine!.id}'`),
    );
    const out = await turn("غيّرها", { intent: "REFINE", needRef: mine!.id });
    expect(JSON.stringify(out)).toContain("NEED_NOT_FOUND");
  });

  // ── F · CONCURRENCY AND RESTART ───────────────────────────────────────────

  it("two devices refining at once lose nothing", async () => {
    //   LOST_NEED_UPDATE = 0 · STALE_NEED_WRITE_SILENTLY_ACCEPTED = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    const [need] = await rows();

    // Both read revision 1 and both write. The compare-and-set makes the loser
    // rebase onto the winner rather than overwrite it.
    await Promise.all([
      needs.applyNeedTurn({
        conversationId, scopeId: me(), principalId: me(),
        patch: { intent: "REFINE", addConstraints: [bound("COST", 5, "KWD")] },
      }),
      needs.applyNeedTurn({
        conversationId, scopeId: me(), principalId: me(),
        patch: { intent: "REFINE", addConstraints: [bound("QUALITY", 4, "STARS")] },
      }),
    ]);

    const [after] = await rows();
    expect(after!.id).toBe(need!.id);
    expect(after!.revision).toBe(3);
    // BOTH survived. Neither writer's delta was dropped.
    expect(after!.constraints.map((c) => c.dimension).sort()).toEqual(["COST", "QUALITY"]);
  });

  it("continuity is in the database, not in this process", async () => {
    //   PROCESS_RESTART_NEED_CONTINUITY · PROCESS_LOCAL_NEED_STATE = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("أقل من 3", { intent: "REFINE", addConstraints: [bound("COST", 3, "KWD")] });

    // A fresh module instance — the closest a test gets to a restart. Nothing
    // in memory carries over.
    vi.resetModules();
    const reloaded = await import("../../api/runtime/need-continuity");
    const current = await reloaded.currentNeed({ conversationId, scopeId: me() });
    expect(current?.outcome).toBe("أن أشبع");
    expect(current?.revision).toBe(2);
  });

  // ── G · WHAT A NEED IS NOT ────────────────────────────────────────────────

  it("wanting something publishes nothing to the market", async () => {
    //   CONVERSATIONAL_NEED_AUTO_PUBLISHED = 0 · PRIVATE_NEED_LEAK_TO_MARKET = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    await turn("شاورما رخيصة", {
      intent: "REFINE", addConstraints: [bound("COST", 3, "KWD")],
    });
    const published = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM economic_expressions`),
    );
    expect((published.rows[0] as { n: number }).n).toBe(0);
  });

  it("a passing constraint is not a permanent preference", async () => {
    //   NEED_STATE != USER_PROFILE_MEMORY
    //   TEMPORARY_CONSTRAINT_AUTO_SAVED_TO_PROFILE = 0
    await turn("أريد شيء رخيص", {
      intent: "NEW", outcome: "أن أشبع",
      addConstraints: [bound("COST", 2, "KWD")],
    });
    const profile = await handle.db.execute(
      sql.raw(`SELECT preferences FROM users WHERE id = ${actor.id}`),
    );
    expect((profile.rows[0] as { preferences: Record<string, unknown> }).preferences).toEqual({});
  });

  it("nothing marks a need satisfied on its own", async () => {
    //   FALSE_NEED_SATISFACTION = 0
    await turn("أنا جائع", { intent: "NEW", outcome: "أن أشبع" });
    const [need] = await rows();
    expect(need!.state).toBe("ACTIVE");
    // There is no path from a model patch to RESOLVED, and nothing in this
    // repository yet links a need to the exchange that came out of it.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/need-continuity.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/state:\s*"RESOLVED"/);
  });

  // ── H · SIX UNRELATED THINGS, ONE RUNTIME ─────────────────────────────────

  it("six unrelated wants take the identical path", async () => {
    //   DOMAIN_NEED_TYPES_ADDED = 0 · DOMAIN_NEED_HANDLERS_ADDED = 0
    for (const holdout of HOLDOUTS) {
      const conversation = await runtime.createRuntimeConversation({
        ownerId: me(), title: holdout.id,
      });
      conversationId = conversation.id;
      await turn("أحتاج", { intent: "NEW", outcome: holdout.outcome });
      await turn("بهذا الحد", {
        intent: "REFINE",
        addConstraints: [bound(holdout.dimension, holdout.value, holdout.unit)],
      });
      const all = await rows();
      expect(all, holdout.id).toHaveLength(1);
      expect(all[0]!.revision, holdout.id).toBe(2);
      expect(all[0]!.outcome, holdout.id).toBe(holdout.outcome);
      expect(all[0]!.constraints, holdout.id).toHaveLength(1);
    }
  });

  it("and the runtime branches on no noun at all", async () => {
    // The companion. The sixth holdout appears nowhere else in this repository,
    // so a runtime that had learned anything domain-shaped would fail there.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/need-continuity.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // Whole words only: an English verb that happens to contain a domain noun
    // («carry» contains «car») says nothing about branching, and flagging it
    // would make this test about spelling rather than about generality.
    for (const noun of ["food", "meal", "car", "vehicle", "translator", "storage",
      "kiln", "restaurant", "hotel", "flight", "shawarma", "broasted"]) {
      expect(code.toLowerCase(), `branches on ${noun}`)
        .not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
    expect(code).not.toMatch(/\bswitch\s*\(/);
  });
});
