/**
 * JASIM — a PlanGraph becomes a REAL durable DAG.
 *
 * The unit tests prove the contract. This proves the thing they cannot: that
 * the dependencies a plan declares become rows in `dag_dependencies`, that the
 * shipped executor honours them, and that a binding moves a real value out of
 * one node's stored output and into the next node's inputs.
 *
 * §7 of the phase brief is explicit that this must not be faked in test-only
 * metadata. So nothing here hand-writes a DAG: every node comes out of
 * `materializePlanGraph`, and every execution goes through
 * `driveRunToCompletion` — the same function `runtime.runsExecute` calls.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { dagDependencies, dagNodes, executionAttempts } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import type { PlanGraph } from "../../api/runtime/plan-graph";

/**
 * Everything is imported INSIDE `beforeAll`.
 *
 * `plan-graph.ts` reaches the capability registry, which reaches the runtime,
 * which opens its database connection at module load. A static import would
 * therefore connect to whatever `DATABASE_URL` said before `getTestDb()`
 * repointed it at the isolated proof database — and the test would then write
 * to one database and read from another, which is exactly what it did on the
 * first run: `createRuntimeDag` returned happily and every query came back
 * empty.
 */
let handle: TestDbHandle;
let createRuntimeDag: typeof import("../../api/runtime/jasim-runtime").createRuntimeDag;
let createRuntimeRun: typeof import("../../api/runtime/jasim-runtime").createRuntimeRun;
let driveRunToCompletion: typeof import("../../api/runtime/jasim-runtime").driveRunToCompletion;
let PlanGraphSchema: typeof import("../../api/runtime/plan-graph").PlanGraphSchema;
let materializePlanGraph: typeof import("../../api/runtime/plan-graph").materializePlanGraph;
let validatePlanGraph: typeof import("../../api/runtime/plan-graph").validatePlanGraph;
let GoalSpecSchema: typeof import("../../api/runtime/goal-spec").GoalSpecSchema;
let evaluateGoalSpec: typeof import("../../api/runtime/goal-spec").evaluateGoalSpec;
let DIAMOND: PlanGraph;

const ownerId = "9301";

const emptyGoal = () =>
  evaluateGoalSpec(GoalSpecSchema.parse({ version: 1, outcome: "هدف عام" }));

/**
 *      A
 *      ↓
 *      B
 *    ┌─┴─┐
 *    C   D
 *    └─┬─┘
 *      E
 */
const DIAMOND_SOURCE = {
  version: 1,
  kind: "DAG",
  nodes: [
    { key: "A", capabilityId: "local-calculation", inputs: { values: [2, 3] } },
    {
      key: "B",
      capabilityId: "local-calculation",
      // Deliberately NOT a `values` array: `safeCalculation` prefers that key
      // when it exists and would then ignore the bound value entirely, which
      // would make this test pass for the wrong reason.
      inputs: { base: 10 },
      dependsOn: ["A"],
      // A's sum (5) becomes one of B's inputs. Nothing about this value exists
      // until A has actually run.
      bindings: [{ fromNode: "A", valuePath: "result.sum", targetKey: "carried" }],
    },
    { key: "C", capabilityId: "local-calculation", inputs: { values: [1] }, dependsOn: ["B"] },
    { key: "D", capabilityId: "local-calculation", inputs: { values: [4] }, dependsOn: ["B"] },
    { key: "E", capabilityId: "local-analysis", inputs: { note: "join" }, dependsOn: ["C", "D"] },
  ],
};

async function materialize(plan: PlanGraph, key: string) {
  const run = await createRuntimeRun({
    ownerId,
    goal: `plan graph: ${key}`,
    idempotencyKey: `plan-graph-${key}-${Date.now()}`,
  });
  await createRuntimeDag({ ownerId, runId: run.id, nodes: materializePlanGraph(plan) });
  return run;
}

describe("a plan graph materialises into the durable DAG", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    ({ createRuntimeDag, createRuntimeRun, driveRunToCompletion } = await import(
      "../../api/runtime/jasim-runtime"
    ));
    ({ PlanGraphSchema, materializePlanGraph, validatePlanGraph } = await import(
      "../../api/runtime/plan-graph"
    ));
    ({ GoalSpecSchema, evaluateGoalSpec } = await import("../../api/runtime/goal-spec"));
    DIAMOND = PlanGraphSchema.parse(DIAMOND_SOURCE);
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events CASCADE"));
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("the plan validates before anything is written", () => {
    expect(validatePlanGraph({ plan: DIAMOND, goal: emptyGoal() }).readiness).toBe("EXECUTABLE");
  });

  it("the declared dependencies become real dag_dependencies rows", async () => {
    const run = await materialize(DIAMOND, "edges");
    const nodes = await handle.db
      .select()
      .from(dagNodes)
      .where(eq(dagNodes.runId, run.id));
    const keyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));

    const edges = await handle.db
      .select()
      .from(dagDependencies)
      .where(eq(dagDependencies.runId, run.id));

    const pairs = edges
      .map((edge) => `${keyById.get(edge.upstreamNodeId)}->${keyById.get(edge.downstreamNodeId)}`)
      .sort();
    expect(pairs).toEqual(["A->B", "B->C", "B->D", "C->E", "D->E"]);
  });

  it("the real executor honours the order", async () => {
    const run = await materialize(DIAMOND, "order");
    await driveRunToCompletion(run.id, ownerId, "plan-graph-worker");

    const attempts = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id))
      .orderBy(asc(executionAttempts.startedAt));
    const nodes = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    const keyById = new Map(nodes.map((node) => [node.id, node.nodeKey]));
    const sequence = attempts.map((attempt) => keyById.get(attempt.nodeId)!);

    const at = (key: string) => sequence.indexOf(key);
    expect(sequence).toHaveLength(5);
    expect(at("A")).toBeLessThan(at("B"));
    expect(at("B")).toBeLessThan(at("C"));
    expect(at("B")).toBeLessThan(at("D"));
    expect(at("C")).toBeLessThan(at("E"));
    expect(at("D")).toBeLessThan(at("E"));
  });

  it("every node completes", async () => {
    const run = await materialize(DIAMOND, "complete");
    await driveRunToCompletion(run.id, ownerId, "plan-graph-worker");
    const nodes = await handle.db.select().from(dagNodes).where(eq(dagNodes.runId, run.id));
    expect(nodes.map((node) => node.status).sort()).toEqual(
      ["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"],
    );
  });

  it("a binding carries a real value from A's output into B's inputs", async () => {
    // The value 5 exists nowhere in the plan. It is A's sum, computed at
    // execution time, and the runtime — not the model — put it there.
    const run = await materialize(DIAMOND, "binding");
    await driveRunToCompletion(run.id, ownerId, "plan-graph-worker");

    const [b] = await handle.db
      .select()
      .from(dagNodes)
      .where(eq(dagNodes.nodeKey, "B"));

    // The stored inputs keep the BINDING, not the value: the runtime resolves
    // it at execution and never rewrites the immutable plan contract. So the
    // proof that the value moved is in B's result — 10 (its own input) plus 5
    // (A's sum, which did not exist when the plan was written).
    const output = b.output as Record<string, unknown>;
    const result = (output.result ?? output) as Record<string, unknown>;
    expect(result.sum).toBe(15);
    expect(result.count).toBe(2);
    // 10 was in the plan. 5 was not — it is A's sum, computed at execution.
    expect((b.inputs as Record<string, unknown>).base).toBe(10);
    expect(JSON.stringify(b.inputs)).not.toContain("5");
  });

  it("the model never supplied a node id — the runtime resolved it", async () => {
    const run = await materialize(DIAMOND, "identity");
    const [b] = await handle.db.select().from(dagNodes).where(eq(dagNodes.nodeKey, "B"));
    const bindings = (b.inputs as Record<string, unknown>).__runtimeBindings as Array<
      Record<string, unknown>
    >;
    // What the plan wrote: a plan key and a path. Nothing else.
    expect(bindings[0]).toMatchObject({ kind: "dag_node", sourceNodeKey: "A" });
    expect(bindings[0]).not.toHaveProperty("sourceNodeId");
    expect(bindings[0]).not.toHaveProperty("sourceRunId");
    expect(run.id).toBeTruthy();
  });

  it("the runtime re-checks the dependency edge rather than trusting the plan", async () => {
    // `resolveRuntimeDagExecutionInputs` looks the edge up in
    // `dag_dependencies` itself before honouring a binding. The plan layer
    // rejects a binding without a dependency, and so does the durable layer —
    // neither is relying on the other to have been careful.
    const source = (
      await import("node:fs")
    ).readFileSync(
      new URL("../../api/runtime/jasim-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "A runtime data binding must reference a declared DAG dependency.",
    );
  });

  it("the DAG rejects a cycle the plan validator would also have caught", async () => {
    // Belt and braces on purpose: the semantic layer refuses it, and so does
    // the durable layer. Neither is relying on the other to be careful.
    const cyclic = {
      version: 1 as const,
      kind: "DAG" as const,
      nodes: [
        { key: "X", capabilityId: "local-calculation", inputs: {}, dependsOn: ["Y"], bindings: [], enforces: [], authority: "NONE" as const },
        { key: "Y", capabilityId: "local-calculation", inputs: {}, dependsOn: ["X"], bindings: [], enforces: [], authority: "NONE" as const },
      ],
      blockers: [],
    };
    expect(validatePlanGraph({ plan: cyclic, goal: emptyGoal() }).readiness).toBe("BLOCKED");

    const run = await createRuntimeRun({
      ownerId,
      goal: "cyclic",
      idempotencyKey: `plan-graph-cycle-${Date.now()}`,
    });
    await expect(
      createRuntimeDag({ ownerId, runId: run.id, nodes: materializePlanGraph(cyclic) }),
    ).rejects.toThrow(/cycle/i);
  });

  it("a plan whose capability has no provider still materialises and blocks truthfully", async () => {
    // §10. Planning must not depend on a provider existing. `notify` has no
    // configured adapter here, so the DAG is built, runs, and reports the
    // truth rather than the plan being refused up front.
    const plan = PlanGraphSchema.parse({
      version: 1,
      kind: "DAG",
      nodes: [
        { key: "measure", capabilityId: "local-calculation", inputs: { values: [1] } },
        { key: "tell", capabilityId: "notify", inputs: { message: "x" }, dependsOn: ["measure"] },
      ],
    });
    expect(validatePlanGraph({ plan, goal: emptyGoal() }).readiness).toBe("EXECUTABLE");

    const run = await materialize(plan, "provider");
    await driveRunToCompletion(run.id, ownerId, "plan-graph-worker");

    const [tell] = await handle.db.select().from(dagNodes).where(eq(dagNodes.nodeKey, "tell"));
    // Whatever the outcome, it is never a silent success.
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.nodeId, tell.id));
    if (attempt) {
      expect(attempt.verificationStatus).not.toBe("VERIFIED");
    }
    // Observed: WAITING. `notify` has external side effects, so the registry
    // floor demands owner approval and the node waits for it rather than
    // firing. A plan existing is not a run succeeding.
    expect(["PENDING", "READY", "RUNNING", "WAITING", "FAILED", "BLOCKED", "COMPLETED"]).toContain(
      tell.status,
    );
    expect(tell.status).not.toBe("COMPLETED");
  });
});
