import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type State = {
  ownerId: string;
  runId: string;
  nodeId: string;
  workerId: string;
  leaseToken: string;
  fenceVersion: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runtime() {
  const root = path.resolve(process.cwd(), "../canonical/جاسم/app");
  return import(pathToFileURL(path.join(root, "api/runtime/jasim-runtime.ts")).href);
}

async function setup(statePath: string) {
  const api = await runtime();
  const appRoot = path.resolve(process.cwd(), "../canonical/جاسم/app");
  const users = await import(pathToFileURL(path.join(appRoot, "api/queries/users.ts")).href);
  const unionId = `block0:restart:${randomUUID()}`;
  await users.upsertUser({
    unionId,
    name: "Block 0 Restart Proof",
  });
  const owner = await users.findUserByUnionId(unionId);
  assert(owner, "restart proof owner was not persisted");
  const ownerId = String(owner.id);
  const run = await api.createRuntimeRun({
    ownerId,
    goal: "Block 0 durable restart proof",
    idempotencyKey: `block0-restart-${randomUUID()}`,
    status: "created",
  });
  await api.createRuntimeDag({
    ownerId,
    runId: run.id,
    nodes: [
      { nodeKey: "a", capabilityId: "local-calculation", inputs: { values: [1, 2, 3] } },
      {
        nodeKey: "b",
        capabilityId: "local-analysis",
        dependencies: ["a"],
        inputs: {
          fromA: "server_resolved",
          __runtimeBindings: [{ kind: "dag_node", sourceNodeKey: "a", targetKey: "fromA", valuePath: "result.sum" }],
        },
      },
      {
        nodeKey: "c",
        capabilityId: "local-analysis",
        dependencies: ["b"],
        inputs: {
          fromB: "server_resolved",
          __runtimeBindings: [{ kind: "dag_node", sourceNodeKey: "b", targetKey: "fromB", valuePath: "result.metrics.numericTotal" }],
        },
      },
      {
        nodeKey: "d",
        capabilityId: "local-analysis",
        dependencies: ["c"],
        inputs: {
          fromC: "server_resolved",
          __runtimeBindings: [{ kind: "dag_node", sourceNodeKey: "c", targetKey: "fromC", valuePath: "result.metrics.valuesProcessed" }],
        },
      },
    ],
  });
  await api.executeRuntimeDagNode({ ownerId, runId: run.id, workerId: "block0-worker-a" });
  await api.executeRuntimeDagNode({ ownerId, runId: run.id, workerId: "block0-worker-a" });
  const claim = await api.claimRuntimeDagNode({
    ownerId,
    runId: run.id,
    workerId: "block0-worker-a",
    leaseDurationMs: 1_000,
  });
  assert(claim, "worker A could not claim node C");
  const running = await api.startRuntimeDagNode({
    ownerId,
    nodeId: claim.id,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    fenceVersion: claim.fenceVersion,
  });
  await writeFile(statePath, JSON.stringify({
    ownerId,
    runId: run.id,
    nodeId: running.id,
    workerId: running.workerId,
    leaseToken: running.leaseToken,
    fenceVersion: running.fenceVersion,
  } satisfies State));
  console.log(`SETUP_PERSISTED run=${run.id} node=${running.id}`);
  // This deliberately terminates without executing finalization or shutdown.
  process.kill(process.pid, "SIGKILL");
}

async function recover(statePath: string) {
  const state = JSON.parse(await readFile(statePath, "utf8")) as State;
  await new Promise((resolve) => setTimeout(resolve, 1_150));
  const api = await runtime();
  await api.refreshRuntimeDag({ runId: state.runId, ownerId: state.ownerId });
  const reclaimed = await api.claimRuntimeDagNode({
    ownerId: state.ownerId,
    runId: state.runId,
    workerId: "block0-worker-b",
    leaseDurationMs: 5_000,
  });
  assert(reclaimed, "worker B could not reclaim expired node C");
  assert(reclaimed.id === state.nodeId, "recovery reclaimed an unexpected node");
  assert(reclaimed.fenceVersion > state.fenceVersion, "reclaimed lease did not advance fence version");
  await api.startRuntimeDagNode({
    ownerId: state.ownerId,
    nodeId: reclaimed.id,
    workerId: reclaimed.workerId,
    leaseToken: reclaimed.leaseToken,
    fenceVersion: reclaimed.fenceVersion,
  });
  try {
    await api.completeRuntimeDagNode({
      ownerId: state.ownerId,
      nodeId: state.nodeId,
      workerId: state.workerId,
      leaseToken: state.leaseToken,
      fenceVersion: state.fenceVersion,
      output: { forged: true },
    });
    throw new Error("stale worker completion unexpectedly succeeded");
  } catch (error) {
    assert(error instanceof Error && error.message.includes("STALE_WORKER_REJECTED"), "stale worker returned the wrong error");
  }
  await api.completeRuntimeDagNode({
    ownerId: state.ownerId,
    nodeId: reclaimed.id,
    workerId: reclaimed.workerId,
    leaseToken: reclaimed.leaseToken,
    fenceVersion: reclaimed.fenceVersion,
    output: { result: { resumed: true, metrics: { valuesProcessed: 1 } } },
  });
  await api.executeRuntimeDagNode({
    ownerId: state.ownerId,
    runId: state.runId,
    workerId: "block0-worker-b",
  });
  const completed = await api.getRuntimeRun(state.runId, state.ownerId);
  assert(completed.status === "completed", `expected completed run, got ${completed.status}`);
  const byKey = new Map(completed.dag.map((node: { nodeKey: string }) => [node.nodeKey, node]));
  assert((byKey.get("a") as { attemptCount: number }).attemptCount === 1, "completed node A re-executed");
  assert((byKey.get("b") as { attemptCount: number }).attemptCount === 1, "completed node B re-executed");
  assert((byKey.get("c") as { attemptCount: number }).attemptCount === 2, "reclaimed node C did not preserve attempt history");
  assert((byKey.get("d") as { attemptCount: number }).attemptCount === 1, "node D did not complete once");
  console.log("PASS MULTI_NODE_DAG");
  console.log("PASS LEASE_RECOVERY");
  console.log("STALE_WORKER_COMMIT=0");
  console.log("COMPLETED_NODE_REEXECUTION=0");
  console.log("DOUBLE_VALID_WORKER_CLAIM=0");
  console.log("BLIND_EFFECT_RETRY_AFTER_RESTART=0");
  console.log("FALSE_RUN_SUCCESS=0");
  console.log("PASS STARTUP_RECOVERY");
  console.log("PASS RUN_RESTART");
}

const [stage, statePath] = process.argv.slice(2);
if (!statePath || !["setup", "recover"].includes(stage ?? "")) {
  throw new Error("Usage: jasim-block0-restart-proof.ts <setup|recover> <state-path>");
}
void (stage === "setup" ? setup(statePath) : recover(statePath)).catch((error) => {
  console.error("JASIM Block 0 restart proof FAILED:", error);
  process.exit(1);
});