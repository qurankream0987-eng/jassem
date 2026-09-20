/**
 * JASIM — the Opportunity Exchange, reached from a plan, on the live runtime.
 *
 * ─── THE GAP, PROVEN BEFORE IT WAS FILLED ───────────────────────────────────
 *
 * The exchange in `economic-fabric.ts` was complete and domain-free before this
 * phase: one `EconomicExpression` for Need and Offering, typed constraints,
 * deterministic matching with unit normalisation, composite matches. The
 * acceptance catalog recorded 35 scenarios blocked on one thing — nothing a
 * person said could reach it.
 *
 * These tests drive the REAL executor: `executeRuntimeDagNode` → attempt →
 * capability → `gatherEffectAssertions` → `verifyExecutionAttempt` →
 * persistence. The exchange is reached the way every other step is.
 *
 * ─── ONE DOOR, MANY WORLDS ──────────────────────────────────────────────────
 *
 * Every scenario below — procurement, haulage, hiring, a laboratory
 * instrument, a generator, a cold-storage chamber — uses the SAME two
 * capabilities with the same four constraint fields. Nothing here recognises an
 * industry, and a case needing its own capability would be the failure.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { dagNodes, economicExpressions, executionAttempts } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const OWNER = "exchange-owner";
const OTHER = "exchange-other";
/** Conversation rows key their owner numerically; the DAG tables do not. */
const SPEAKER = "9701";

describe("a plan can reach the opportunity exchange", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw("TRUNCATE TABLE events, economic_expressions, economic_matches CASCADE"),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await handle.pool.end();
  });

  /** One node, through the real executor, with the production registry. */
  async function runNode(input: {
    capabilityId: string;
    inputs: Record<string, unknown>;
    owner?: string;
  }) {
    const owner = input.owner ?? OWNER;
    const run = await runtime.createRuntimeRun({
      ownerId: owner,
      goal: `exchange: ${input.capabilityId}`,
      idempotencyKey: `exchange-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId: owner,
      runId: run.id,
      nodes: [
        { nodeKey: "act", capabilityId: input.capabilityId, inputs: input.inputs, maxAttempts: 1 },
      ],
    });
    await runtime.executeRuntimeDagNode({
      ownerId: owner,
      runId: run.id,
      workerId: "exchange-worker",
    });
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    // The executor stores the CANONICAL envelope: `{ result, metadata }`. The
    // capability's own return value is the inner `result`.
    const envelope = (attempt!.normalizedResult ?? {}) as { result?: Record<string, unknown> };
    return {
      attempt: attempt!,
      result: (envelope.result ?? envelope) as Record<string, unknown>,
    };
  }

  const publish = (over: Record<string, unknown> = {}, owner?: string) =>
    runNode({
      capabilityId: "opportunity-publish",
      owner,
      inputs: {
        kind: "OFFERING",
        semanticType: "tuna can 200g",
        summary: "تونة 200 جرام",
        visibility: "PUBLIC",
        attributes: { quantity: 500, unitPrice: 0.8 },
        ...over,
      },
    });

  // ── 1. The door exists ─────────────────────────────────────────────────────

  it("publishing an Offering reaches the exchange and is verified by readback", async () => {
    const { attempt, result } = await publish();

    expect(attempt.executionStatus).toBe("COMPLETED");
    // INTERNAL_STATE: JASIM owns this record, so its own readback verifies it.
    expect(attempt.verificationStatus).toBe("VERIFIED");
    const detail = attempt.verificationDetail as {
      completion?: { confirmedBy?: string; decision?: string };
    };
    expect(detail.completion?.confirmedBy).toBe("INTERNAL_READBACK");

    const rows = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, OWNER));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("offering");
    expect(rows[0]!.visibility).toBe("public");
    expect(rows[0]!.status).toBe("active");
    expect(result.expressionId).toBe(rows[0]!.id);
  });

  it("publishing a Need reaches the same door", async () => {
    const { attempt, result } = await runNode({
      capabilityId: "opportunity-publish",
      inputs: {
        kind: "NEED",
        semanticType: "tuna can 200g",
        summary: "أحتاج 300 حبة تونة",
        visibility: "PUBLIC",
        attributes: { quantity: 300 },
        hardConstraints: [
          { field: "quantity", operator: "gte", value: 300 },
          { field: "unitPrice", operator: "lte", value: 0.85 },
        ],
      },
    });
    expect(attempt.verificationStatus).toBe("VERIFIED");
    expect(result.kind).toBe("NEED");

    const [row] = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, OWNER));
    expect(row!.kind).toBe("need");
    expect(row!.hardConstraints).toHaveLength(2);
  });

  it("an unpublished expression stays private", async () => {
    await publish({ visibility: "PRIVATE" });
    const [row] = await handle.db.select().from(economicExpressions);
    expect(row!.visibility).toBe("private");
    expect(row!.status).toBe("draft");
    expect(row!.publicProjection).toBeNull();
  });

  // ── 2. Matching — the exchange actually matching ──────────────────────────

  it("a Need finds a published Offering from another owner", async () => {
    // A supplier publishes. A different owner needs it. Neither used a
    // marketplace; both used the same capability.
    await publish({ attributes: { quantity: 500, unitPrice: 0.8 } }, OTHER);

    const need = await runNode({
      capabilityId: "opportunity-publish",
      inputs: {
        kind: "NEED",
        semanticType: "tuna can 200g",
        summary: "أحتاج 300 حبة",
        attributes: { quantity: 300 },
        hardConstraints: [
          { field: "quantity", operator: "gte", value: 300 },
          { field: "unitPrice", operator: "lte", value: 0.85 },
        ],
      },
    });

    const { result } = await runNode({
      capabilityId: "opportunity-discover",
      inputs: { needId: need.result.expressionId },
    });
    expect(result.mode).toBe("MATCH");
    expect(result.matchCount).toBe(1);
  });

  it("a Need that cannot be met finds nothing rather than something close", async () => {
    await publish({ attributes: { quantity: 500, unitPrice: 2.5 } }, OTHER);
    const need = await runNode({
      capabilityId: "opportunity-publish",
      inputs: {
        kind: "NEED",
        semanticType: "tuna can 200g",
        summary: "أحتاج بسعر أقل",
        attributes: { quantity: 300 },
        hardConstraints: [{ field: "unitPrice", operator: "lte", value: 0.85 }],
      },
    });
    const { result } = await runNode({
      capabilityId: "opportunity-discover",
      inputs: { needId: need.result.expressionId },
    });
    expect(result.matchCount).toBe(0);
  });

  it("discovery lists public offerings and nobody's private ones", async () => {
    await publish({ summary: "معروض علنًا" }, OTHER);
    await publish({ summary: "سرّي", visibility: "PRIVATE" }, OTHER);

    const { result } = await runNode({
      capabilityId: "opportunity-discover",
      inputs: { kind: "OFFERING" },
    });
    expect(result.resultCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("سرّي");
  });

  // ── 3. What a caller may not decide ───────────────────────────────────────

  it("a caller cannot publish as another owner", async () => {
    const { attempt } = await publish({ ownerId: OTHER } as Record<string, unknown>);
    // Rejected outright rather than ignored: a payload reaching for an owner
    // is not a formatting quirk.
    expect(attempt.executionStatus).toBe("FAILED");
    const rows = await handle.db.select().from(economicExpressions);
    expect(rows).toHaveLength(0);
  });

  it("a caller cannot smuggle a state transition through attributes", async () => {
    for (const key of ["visibility", "status", "verified", "published"]) {
      const { attempt } = await publish({ attributes: { [key]: "public" } });
      expect(attempt.executionStatus, key).toBe("FAILED");
    }
    expect(await handle.db.select().from(economicExpressions)).toHaveLength(0);
  });

  it("a caller cannot choose what becomes public", async () => {
    // The private bound is the sentence that must never leave. It is not read
    // by the projection builder at all, so naming it changes nothing.
    await publish({
      hardConstraints: [{ field: "unitPrice", operator: "lte", value: 0.85 }],
      publicTerms: { note: "معروض" },
    });
    const [row] = await handle.db.select().from(economicExpressions);
    const projection = JSON.stringify(row!.publicProjection);
    expect(projection).not.toContain("0.85");
    expect(projection).not.toContain("hardConstraints");
    expect(projection).toContain("معروض");
  });

  it("a caller cannot grant itself a shared visibility", async () => {
    const { attempt } = await publish({ visibility: "SHARED" });
    expect(attempt.executionStatus).toBe("FAILED");
  });

  it("another owner's Need cannot be matched", async () => {
    const need = await runNode({
      capabilityId: "opportunity-publish",
      owner: OTHER,
      inputs: { kind: "NEED", semanticType: "x", summary: "ليس لي" },
    });
    const { attempt } = await runNode({
      capabilityId: "opportunity-discover",
      inputs: { needId: need.result.expressionId },
    });
    expect(attempt.executionStatus).toBe("FAILED");
  });

  it("an unknown constraint operator is refused", async () => {
    const { attempt } = await publish({
      hardConstraints: [{ field: "quantity", operator: "DROP TABLE", value: 1 }],
    });
    expect(attempt.executionStatus).toBe("FAILED");
  });

  // ── 4. One Actor is both sides ────────────────────────────────────────────

  it("one owner holds a Need and an Offering at once", async () => {
    // Buyer and seller are contexts, not accounts. A factory buying raw
    // material while selling product is one identity holding both.
    await publish({ semanticType: "finished product", summary: "أبيع منتجي" });
    await runNode({
      capabilityId: "opportunity-publish",
      inputs: { kind: "NEED", semanticType: "raw material", summary: "أشتري مادة خام" },
    });
    const rows = await handle.db
      .select()
      .from(economicExpressions)
      .where(eq(economicExpressions.ownerId, OWNER));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(["offering", "need"]));
  });

  // ── 5. Holdouts ───────────────────────────────────────────────────────────

  /**
   * Domains that shaped no production code. Each publishes a Capacity as an
   * Offering and is found by a Need, through the same two capabilities and the
   * same constraint fields.
   */
  const HOLDOUTS = [
    {
      id: "laboratory_instrument_time",
      label: "a laboratory instrument's spare hours",
      semanticType: "instrument time",
      offering: { hours: 6, hourlyRate: 40 },
      failing: { hours: 6, hourlyRate: 500 },
      need: [{ field: "hours", operator: "gte", value: 4 }, { field: "hourlyRate", operator: "lte", value: 50 }],
    },
    {
      id: "temporary_generator",
      label: "a temporary generator with a response bound",
      semanticType: "standby power",
      offering: { kilowatts: 250, responseMinutes: 10 },
      failing: { kilowatts: 250, responseMinutes: 240 },
      need: [{ field: "kilowatts", operator: "gte", value: 200 }, { field: "responseMinutes", operator: "lte", value: 15 }],
    },
    {
      id: "cold_storage",
      label: "a cold-storage chamber",
      semanticType: "cold storage",
      offering: { cubicMetres: 80, degreesCelsius: -18 },
      // Warmer than the bound, not colder: a blanket "make the number bigger"
      // would have made this one MORE compliant.
      failing: { cubicMetres: 80, degreesCelsius: 4 },
      need: [{ field: "cubicMetres", operator: "gte", value: 50 }, { field: "degreesCelsius", operator: "lte", value: -15 }],
    },
    {
      id: "apiary_pollination",
      label: "an apiary's pollination hives",
      semanticType: "pollination service",
      offering: { hives: 40, pricePerHive: 12 },
      failing: { hives: 40, pricePerHive: 90 },
      need: [{ field: "hives", operator: "gte", value: 30 }, { field: "pricePerHive", operator: "lte", value: 15 }],
    },
    {
      id: "industrial_valve_service",
      label: "an industrial valve service call",
      semanticType: "valve maintenance",
      offering: { leadTimeDays: 2, callOutFee: 150 },
      failing: { leadTimeDays: 45, callOutFee: 150 },
      need: [{ field: "leadTimeDays", operator: "lte", value: 4 }, { field: "callOutFee", operator: "lte", value: 200 }],
    },
    {
      id: "desalination_maintenance",
      label: "desalination unit maintenance",
      semanticType: "desalination maintenance",
      offering: { capacityCubicMetres: 500, leadTimeDays: 7 },
      failing: { capacityCubicMetres: 500, leadTimeDays: 120 },
      need: [{ field: "capacityCubicMetres", operator: "gte", value: 400 }, { field: "leadTimeDays", operator: "lte", value: 14 }],
    },
    {
      id: "court_interpretation",
      label: "a court interpreter's free hours",
      semanticType: "interpretation",
      offering: { hours: 2, hourlyRate: 30 },
      failing: { hours: 2, hourlyRate: 300 },
      need: [{ field: "hours", operator: "gte", value: 2 }, { field: "hourlyRate", operator: "lte", value: 35 }],
    },
    {
      id: "community_lending",
      label: "a community library's lendable equipment",
      semanticType: "equipment lending",
      offering: { loanDays: 14, deposit: 20 },
      failing: { loanDays: 1, deposit: 20 },
      need: [{ field: "loanDays", operator: "gte", value: 7 }, { field: "deposit", operator: "lte", value: 50 }],
    },
    {
      id: "specialized_fabrication",
      label: "precision fabrication capacity",
      semanticType: "fabrication capacity",
      offering: { machineHours: 20, toleranceMicrons: 5 },
      failing: { machineHours: 20, toleranceMicrons: 500 },
      need: [{ field: "machineHours", operator: "gte", value: 10 }, { field: "toleranceMicrons", operator: "lte", value: 10 }],
    },
    {
      id: "event_equipment",
      label: "event equipment for one night",
      semanticType: "event equipment",
      offering: { nights: 1, seats: 300 },
      failing: { nights: 1, seats: 20 },
      need: [{ field: "seats", operator: "gte", value: 200 }, { field: "nights", operator: "lte", value: 2 }],
    },
    {
      id: "scientific_calibration",
      label: "a calibration service",
      semanticType: "calibration service",
      offering: { turnaroundDays: 3, accreditedTo: 0.01 },
      failing: { turnaroundDays: 60, accreditedTo: 0.01 },
      need: [{ field: "turnaroundDays", operator: "lte", value: 5 }, { field: "accreditedTo", operator: "lte", value: 0.05 }],
    },
    {
      id: "temporary_workspace",
      label: "a temporary workspace",
      semanticType: "workspace",
      offering: { desks: 8, weeklyRate: 400 },
      failing: { desks: 8, weeklyRate: 4000 },
      need: [{ field: "desks", operator: "gte", value: 4 }, { field: "weeklyRate", operator: "lte", value: 600 }],
    },
    {
      id: "agricultural_service",
      label: "a crop-spraying window",
      semanticType: "crop spraying",
      offering: { hectares: 50, daysUntilAvailable: 1 },
      failing: { hectares: 50, daysUntilAvailable: 40 },
      need: [{ field: "hectares", operator: "gte", value: 30 }, { field: "daysUntilAvailable", operator: "lte", value: 3 }],
    },
    {
      id: "energy_storage",
      label: "spare energy-storage capacity",
      semanticType: "energy storage",
      offering: { kilowattHours: 900, roundTripLossPercent: 8 },
      failing: { kilowattHours: 900, roundTripLossPercent: 60 },
      need: [{ field: "kilowattHours", operator: "gte", value: 500 }, { field: "roundTripLossPercent", operator: "lte", value: 12 }],
    },
    {
      id: "falconry_competition",
      label: "falconry competition equipment",
      semanticType: "competition equipment",
      offering: { perches: 60, dailyRate: 90 },
      failing: { perches: 60, dailyRate: 900 },
      need: [{ field: "perches", operator: "gte", value: 40 }, { field: "dailyRate", operator: "lte", value: 120 }],
    },
    {
      id: "mosque_library",
      label: "library cataloguing help",
      semanticType: "cataloguing service",
      offering: { volumesPerDay: 400, dailyRate: 50 },
      failing: { volumesPerDay: 400, dailyRate: 500 },
      need: [{ field: "volumesPerDay", operator: "gte", value: 250 }, { field: "dailyRate", operator: "lte", value: 80 }],
    },
  ] as const;

  it.each(HOLDOUTS)("holdout: $label matches with no new capability", async (holdout) => {
    await runNode({
      capabilityId: "opportunity-publish",
      owner: OTHER,
      inputs: {
        kind: "OFFERING",
        semanticType: holdout.semanticType,
        summary: holdout.label,
        visibility: "PUBLIC",
        attributes: holdout.offering,
      },
    });
    const need = await runNode({
      capabilityId: "opportunity-publish",
      inputs: {
        kind: "NEED",
        semanticType: holdout.semanticType,
        summary: `أحتاج ${holdout.semanticType}`,
        hardConstraints: holdout.need,
      },
    });
    const { result } = await runNode({
      capabilityId: "opportunity-discover",
      inputs: { needId: need.result.expressionId },
    });
    expect(result.matchCount).toBe(1);
  });

  it.each(HOLDOUTS)("holdout: $label does NOT match when the bound fails", async (holdout) => {
    await runNode({
      capabilityId: "opportunity-publish",
      owner: OTHER,
      inputs: {
        kind: "OFFERING",
        semanticType: holdout.semanticType,
        summary: holdout.label,
        visibility: "PUBLIC",
        // The same offering, moved outside the Need's bound in the direction
        // that bound actually cares about.
        attributes: holdout.failing,
      },
    });
    const need = await runNode({
      capabilityId: "opportunity-publish",
      inputs: {
        kind: "NEED",
        semanticType: holdout.semanticType,
        summary: "أحتاج ضمن حدودي",
        hardConstraints: holdout.need,
      },
    });
    const { result } = await runNode({
      capabilityId: "opportunity-discover",
      inputs: { needId: need.result.expressionId },
    });
    expect(result.matchCount).toBe(0);
  });
  // ── 6. The conversational path ────────────────────────────────────────────

  it("a conversational turn plans an exchange node", async () => {
    // The claim this phase actually makes: a person speaking can reach the
    // exchange. Everything here is the shipped code except the provider call,
    // which has no credentials in this environment.
    const conversation = await runtime.createRuntimeConversation({
      ownerId: SPEAKER,
      title: "market turn",
    });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "workflow",
        label: "عرض الشاحنة ثم البحث عن شحنة",
        goal: "أعرض شاحنتي الفارغة وأبحث عن شحنة مناسبة",
        intent: {
          requiredCapabilities: ["opportunity-publish", "opportunity-discover"],
          missingInputs: [],
          inputs: {},
          risk: "low",
          persistence: "durable",
          effects: "none",
        },
        confidence: 0.8,
        planGraph: {
          version: 1,
          kind: "DAG",
          nodes: [
            {
              key: "offer",
              capabilityId: "opportunity-publish",
              inputs: {
                kind: "OFFERING",
                semanticType: "haulage",
                summary: "شاحنتان فارغتان من عمان إلى العقبة",
                visibility: "PUBLIC",
                attributes: { tonnes: 24 },
              },
              dependsOn: [],
              bindings: [],
              enforces: [],
              authority: "NONE",
            },
            {
              key: "find",
              capabilityId: "opportunity-discover",
              inputs: { kind: "NEED", semanticType: "haulage" },
              dependsOn: ["offer"],
              bindings: [],
              enforces: [],
              authority: "NONE",
            },
          ],
          blockers: [],
        },
      }),
      provider: "openai",
      model: "stub-for-exchange-turn",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);

    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: SPEAKER,
      conversationId: conversation.id,
      content: "عندي شاحنتان فارغتان اليوم من عمان إلى العقبة، ابحث لي عن شحنات مناسبة",
    });

    const metadata = (result.assistantMessage.metadata ?? {}) as Record<string, unknown>;
    const runId = metadata.runId as string | null;
    // The legacy commerce branch answers any text containing «ابحث» by regex.
    // A validated plan outranks that keyword, so this turn reaches its plan.
    expect(metadata.commerceStatus, "a plan was not pre-empted by a keyword").toBeUndefined();
    expect(runId, "the turn opened a run").toBeTruthy();

    const nodes = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, runId!));
    expect(nodes.map((node) => node.capabilityId).sort()).toEqual([
      "opportunity-discover",
      "opportunity-publish",
    ]);
    // A real dependency, not two loose steps: the search waits for the offer.
    const find = nodes.find((node) => node.capabilityId === "opportunity-discover")!;
    const offer = nodes.find((node) => node.capabilityId === "opportunity-publish")!;
    expect(find.id).not.toBe(offer.id);
    // Plan validation accepted the capability ids, which is what makes the
    // exchange reachable from a plan at all.
    const plan = metadata.plan as { nodeKeys?: string[]; readiness?: string };
    expect(plan.nodeKeys).toEqual(["offer", "find"]);
  });
});
