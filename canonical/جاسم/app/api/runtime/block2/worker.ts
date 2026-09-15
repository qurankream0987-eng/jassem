/**
 * Block 2 — worker assembly over the EXISTING durable job queue.
 *
 * The canonical executor stays request-driven; this module adds the smallest
 * possible durable driver: a DurableJobWorker over the existing runtimeJobs
 * queue with reviewed Block 2 handlers only. The temporal scan chain
 * re-enqueues itself, so time/wait survives restarts through the existing
 * lease + recovery machinery (no new scheduler, no new runtime).
 */

import { DurableJobQueue } from "../../core/durable-job-queue";
import { DrizzleDurableJobRepository } from "../../core/drizzle-durable-job-repository";
import { DurableJobWorker, type DurableJobHandler } from "../../core/durable-job-worker";
import { FilesystemImmutableArtifactStore } from "../../core/immutable-artifact-store";
import { db } from "../../queries/connection";
import {
  BLOCK2_JOB_KINDS,
  bootstrapTemporalScan,
  decodePayload,
  encodePayload,
  makeContinuationDispatcher,
  makeTemporalScanHandler,
  runBlock2Sweep,
} from "./jobs";
import type { ConditionEvaluator } from "./temporal";
import { deliverNotificationIntent } from "./notifications";

export type Block2WorkerDeps = {
  /** Injected seam: resume a waiting DAG node (wired by the runtime). */
  resumeNode?: (input: { runId: string; nodeId?: string; ownerId: string }) => Promise<void>;
  evaluator?: ConditionEvaluator;
  scanIntervalMs?: number;
  artifactsRoot?: string;
};

export function createBlock2Worker(deps: Block2WorkerDeps = {}) {
  let resumeNode = deps.resumeNode;
  const artifacts = new FilesystemImmutableArtifactStore(
    deps.artifactsRoot ?? ".local/block2-artifacts",
  );
  const queue = new DurableJobQueue({ repository: new DrizzleDurableJobRepository() });
  const dispatcher = makeContinuationDispatcher({ queue, artifacts });

  const handlers = new Map<string, DurableJobHandler>();
  handlers.set(
    BLOCK2_JOB_KINDS.TEMPORAL_SCAN,
    makeTemporalScanHandler({
      db,
      queue,
      artifacts,
      evaluator: deps.evaluator,
      scanIntervalMs: deps.scanIntervalMs,
    }),
  );
  handlers.set(BLOCK2_JOB_KINDS.RESUME_NODE, async ({ job }) => {
    const payload = await decodePayload(artifacts, job.payload.uri);
    if (resumeNode && typeof payload.runId === "string") {
      await resumeNode({
        runId: payload.runId,
        nodeId: typeof payload.nodeId === "string" ? payload.nodeId : undefined,
        ownerId: job.createdBy,
      });
    }
    return encodePayload(artifacts, { resumed: Boolean(resumeNode), runId: payload.runId });
  });
  handlers.set(BLOCK2_JOB_KINDS.NOTIFY_DELIVER, async ({ job }) => {
    const payload = await decodePayload(artifacts, job.payload.uri);
    if (typeof payload.intentId !== "string") {
      throw new Error("notify-deliver job missing intentId");
    }
    if (
      typeof payload.attemptId !== "string" ||
      !payload.attemptId ||
      payload.attemptId.startsWith("job:")
    ) {
      throw new Error("notify-deliver job requires a real canonical attemptId");
    }
    if (typeof payload.runId !== "string" || typeof payload.nodeId !== "string") {
      throw new Error("notify-deliver job requires canonical runId and nodeId lineage");
    }
    const result = await deliverNotificationIntent(db, {
      intentId: payload.intentId,
      attemptContext: {
        runId: payload.runId,
        nodeId: payload.nodeId,
        attemptId: payload.attemptId,
      },
    });
    return encodePayload(artifacts, { intentId: payload.intentId, state: result.state });
  });

  const worker = new DurableJobWorker({
    id: "block2-worker",
    queue,
    artifacts,
    handlers,
    pollMs: Math.max(500, deps.scanIntervalMs ?? 1_000),
  });

  return {
    worker,
    queue,
    artifacts,
    dispatcher,
    setResumeNode(callback: NonNullable<Block2WorkerDeps["resumeNode"]>) {
      resumeNode = callback;
    },
    /** Drive one full duty cycle synchronously (tests + request-driven hosts). */
    async sweepNow(evaluator?: ConditionEvaluator) {
      return runBlock2Sweep(db, { dispatcher, evaluator: evaluator ?? deps.evaluator });
    },
    async bootstrap() {
      await bootstrapTemporalScan({ queue, artifacts, scanIntervalMs: deps.scanIntervalMs });
    },
  };
}

export type Block2Worker = ReturnType<typeof createBlock2Worker>;

let singleton: Block2Worker | undefined;

/** Process-wide accessor (idempotent). */
export function getBlock2Worker(deps: Block2WorkerDeps = {}): Block2Worker {
  if (!singleton) singleton = createBlock2Worker(deps);
  else if (deps.resumeNode) singleton.setResumeNode(deps.resumeNode);
  return singleton;
}
