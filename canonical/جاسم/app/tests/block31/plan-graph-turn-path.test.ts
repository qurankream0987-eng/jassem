/**
 * JASIM — the LIVE turn path produces a dependency-aware plan.
 *
 * Everything here is the shipped code except the provider itself. There is no
 * configured model in this environment, so `ModelGateway.prototype.generate` is
 * stubbed to return the JSON a model would return — and nothing else is
 * replaced. Routing, sanitisation, goal evaluation, plan validation, run
 * creation, DAG materialisation and every downstream check are the real ones.
 *
 * No test-only branch was added to production for this. The stub is a spy on a
 * singleton's prototype and exists only inside this file.
 *
 * What it proves:
 *   1. A turn that supplies no plan behaves exactly as it did before.
 *   2. A turn that supplies a valid plan gets a REAL dependency graph.
 *   3. An invalid plan produces no graph and says so, rather than half of one.
 *   4. A goal routed away from the DAG never becomes one.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { dagDependencies, dagNodes } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let routeRuntimeConversationTurn: typeof import("../../api/runtime/jasim-runtime").routeRuntimeConversationTurn;
let createRuntimeConversation: typeof import("../../api/runtime/jasim-runtime").createRuntimeConversation;
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const ownerId = "9401";
/** Neutral wording: nothing here should reach a commerce branch. */
const UTTERANCE = "جهّز لي التقرير الداخلي";

const INTENT = {
  requiredCapabilities: ["local-calculation", "local-analysis"],
  missingInputs: [],
  inputs: {},
  risk: "low",
  persistence: "durable",
  effects: "none",
};

const GOAL = {
  version: 1,
  outcome: "تجهيز التقرير الداخلي",
  constraints: [
    {
      dimension: "TIME",
      operator: "AT_MOST",
      value: 2,
      unit: "DAY",
      hardness: "HARD",
      source: "STATED",
    },
  ],
  preferences: ["TIME"],
  assumptions: [],
  unknowns: [],
};

/** measure → summarise, with the measurement flowing into the summary. */
const VALID_PLAN = {
  version: 1,
  kind: "DAG",
  nodes: [
    {
      key: "measure",
      capabilityId: "local-calculation",
      inputs: { values: [4, 6] },
      dependsOn: [],
      bindings: [],
      enforces: [0],
      authority: "NONE",
    },
    {
      key: "summarise",
      capabilityId: "local-analysis",
      inputs: { note: "تقرير" },
      dependsOn: ["measure"],
      bindings: [{ fromNode: "measure", valuePath: "result.sum", targetKey: "total" }],
      enforces: [0],
      authority: "NONE",
    },
  ],
  blockers: [],
};

function envelope(extra: Record<string, unknown>): string {
  return JSON.stringify({
    version: 1,
    decisionId: randomUUID(),
    kind: "direct_action",
    label: "تقرير",
    goal: "تجهيز التقرير الداخلي",
    intent: INTENT,
    confidence: 0.8,
    ...extra,
  });
}

/** Replace ONLY the provider call. */
function respondWith(text: string) {
  return vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
    text,
    provider: "openai",
    model: "stub-for-turn-path-test",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  } as never);
}

async function turn(body: string) {
  const conversation = await createRuntimeConversation({ ownerId, title: "plan turn" });
  respondWith(body);
  const result = await routeRuntimeConversationTurn({
    ownerId,
    conversationId: conversation.id,
    content: UTTERANCE,
  });
  const metadata = (result.assistantMessage.metadata ?? {}) as Record<string, unknown>;
  const runId = (metadata.runId as string | null) ?? null;
  const nodes = runId
    ? await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, runId))
    : [];
  return { result, metadata, runId, nodes };
}

describe("a conversational turn can now produce a real dependency graph", () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("no plan → the turn behaves exactly as it always did", async () => {
    // The regression guard for every existing conversation. A model that never
    // learns to emit a plan must be unaffected by this wiring.
    const { metadata, nodes } = await turn(envelope({}));
    expect(metadata.plan).toBeUndefined();
    expect(nodes).toHaveLength(0);
    expect(metadata.proposalIds).toBeTruthy();
  });

  it("a valid plan becomes real DAG nodes with a real edge", async () => {
    const { metadata, runId, nodes } = await turn(
      envelope({ goalSpec: GOAL, planGraph: VALID_PLAN }),
    );

    expect(nodes.map((node) => node.nodeKey).sort()).toEqual(["measure", "summarise"]);

    const keyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));
    const edges = await handle.db
      .select()
      .from(dagDependencies)
      .where(eq(dagDependencies.runId, runId!));
    expect(
      edges.map((edge) => `${keyById.get(edge.upstreamNodeId)}->${keyById.get(edge.downstreamNodeId)}`),
    ).toEqual(["measure->summarise"]);

    const plan = metadata.plan as Record<string, unknown>;
    expect(plan.kind).toBe("DAG");
    expect(plan.readiness).toBe("EXECUTABLE");
    expect(plan.order).toEqual(["measure", "summarise"]);
    expect(metadata.planAttachment).toMatchObject({ attached: true });
  });

  it("the hard deadline is recorded as ENFORCED, with its owners named", async () => {
    const { metadata } = await turn(envelope({ goalSpec: GOAL, planGraph: VALID_PLAN }));
    const plan = metadata.plan as { dispositions: Array<Record<string, unknown>> };
    expect(plan.dispositions).toHaveLength(1);
    expect(plan.dispositions[0]).toMatchObject({
      dimension: "TIME",
      hardness: "HARD",
      status: "ENFORCED",
    });
    expect(plan.dispositions[0].nodeKeys).toEqual(["measure", "summarise"]);
  });

  it("the goal evaluation rides along on the same turn", async () => {
    const { metadata } = await turn(envelope({ goalSpec: GOAL, planGraph: VALID_PLAN }));
    expect(metadata.goal).toMatchObject({ readiness: "ACTIONABLE" });
  });

  it("a plan that drops the hard deadline produces NO graph", async () => {
    // The silent omission this whole line of work exists to make impossible.
    const dropped = {
      ...VALID_PLAN,
      nodes: VALID_PLAN.nodes.map((node) => ({ ...node, enforces: [] })),
    };
    const { metadata, nodes } = await turn(envelope({ goalSpec: GOAL, planGraph: dropped }));
    expect(nodes).toHaveLength(0);
    expect((metadata.plan as Record<string, unknown>).readiness).toBe("BLOCKED");
    expect(metadata.planAttachment).toBeUndefined();
  });

  it("a cyclic plan produces NO graph", async () => {
    const cyclic = {
      ...VALID_PLAN,
      nodes: [
        { ...VALID_PLAN.nodes[0], dependsOn: ["summarise"], bindings: [] },
        { ...VALID_PLAN.nodes[1], dependsOn: ["measure"] },
      ],
    };
    const { metadata, nodes } = await turn(envelope({ goalSpec: GOAL, planGraph: cyclic }));
    expect(nodes).toHaveLength(0);
    const plan = metadata.plan as { readiness: string; violations: Array<{ code: string }> };
    expect(plan.readiness).toBe("BLOCKED");
    expect(plan.violations.map((violation) => violation.code)).toContain("CYCLE");
  });

  it("a plan naming a capability that does not exist produces NO graph", async () => {
    const invented = {
      ...VALID_PLAN,
      nodes: [{ ...VALID_PLAN.nodes[0], capabilityId: "internal-reports-api" }],
    };
    const { metadata, nodes } = await turn(envelope({ goalSpec: GOAL, planGraph: invented }));
    expect(nodes).toHaveLength(0);
    const plan = metadata.plan as { violations: Array<{ code: string }> };
    expect(plan.violations.map((violation) => violation.code)).toContain("UNKNOWN_CAPABILITY");
  });

  it("a goal routed away from the DAG never becomes one", async () => {
    // «سجلني دخول» changes who the runtime operates as. The turn may still
    // record an intent; it may not manufacture execution steps for it.
    const identity = { version: 1, kind: "IDENTITY_CHANGE", nodes: [], blockers: [] };
    const { metadata, nodes } = await turn(envelope({ goalSpec: GOAL, planGraph: identity }));
    expect(nodes).toHaveLength(0);
    expect((metadata.plan as Record<string, unknown>).kind).toBe("IDENTITY_CHANGE");
    expect(metadata.planAttachment).toBeUndefined();
  });

  it("an authority claim in the plan fails the turn rather than being trimmed", async () => {
    const smuggled = { ...VALID_PLAN, planApproved: true };
    await expect(
      turn(envelope({ goalSpec: GOAL, planGraph: smuggled })),
    ).rejects.toThrow();
  });

  it("a plan cannot reach another owner's run through a binding", async () => {
    // `sourceRunId` is not a field on a plan binding, so a proposal carrying
    // one is rejected by the schema before anything reads it.
    const pointed = {
      ...VALID_PLAN,
      nodes: [
        VALID_PLAN.nodes[0],
        {
          ...VALID_PLAN.nodes[1],
          bindings: [
            {
              fromNode: "measure",
              valuePath: "result.sum",
              targetKey: "total",
              sourceRunId: "00000000-0000-4000-8000-000000000000",
            },
          ],
        },
      ],
    };
    await expect(turn(envelope({ goalSpec: GOAL, planGraph: pointed }))).rejects.toThrow();
  });
});
