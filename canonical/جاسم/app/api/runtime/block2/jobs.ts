/**
 * Block 2 — durable-job wiring: continuation dispatch + maintenance sweep.
 *
 * Reuses the EXISTING durable job queue (availableAt claim loop, leases,
 * CAS recovery). No new scheduler, no new worker engine: the temporal scan
 * is itself a durable job that re-enqueues its next tick, so the whole
 * fabric survives restarts through the existing recovery path.
 */

import type { DurableJobQueue } from "../../core/durable-job-queue";
import type { ImmutableArtifactStore } from "../../core/immutable-artifact-store";
import type { DurableJobHandler } from "../../core/durable-job-worker";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { runs } from "@db/schema";
import {
  fireDueTemporalTriggers,
  type Block2Db,
  type ConditionEvaluator,
  type ContinuationDispatcher,
} from "./temporal";
import { expireDueReservations } from "./capacity";
import { expireDueAssignmentOffers } from "./assignments";
import { expireDueTrackSessions } from "./observations";

export const BLOCK2_JOB_KINDS = {
  TEMPORAL_SCAN: "block2.temporal-scan",
  RESUME_NODE: "block2.resume-node",
  NOTIFY_DELIVER: "block2.notify-deliver",
} as const;

export const TEMPORAL_SCAN_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Payload codec — job payloads are content-addressed immutable artifacts
// ---------------------------------------------------------------------------

export async function encodePayload(
  artifacts: ImmutableArtifactStore,
  value: Record<string, unknown>,
) {
  return artifacts.put(new TextEncoder().encode(JSON.stringify(value)), {
    mediaType: "application/json",
  });
}

export async function decodePayload(
  artifacts: ImmutableArtifactStore,
  uri: string,
): Promise<Record<string, unknown>> {
  const bytes = await artifacts.get(uri);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Continuation dispatcher — idempotent enqueue into the existing queue
// ---------------------------------------------------------------------------

export function makeContinuationDispatcher(deps: {
  queue: DurableJobQueue;
  artifacts: ImmutableArtifactStore;
}): ContinuationDispatcher {
  return {
    async dispatch(input) {
      const artifact = await encodePayload(deps.artifacts, input.payload);
      const existing = await deps.queue
        .create({
          kind: input.jobKind,
          subjectType: input.runId ? "run" : "system",
          subjectId: input.runId ?? input.ownerId,
          payloadSchemaVersion: 1,
          payload: artifact,
          idempotencyKey: input.idempotencyKey,
          createdBy: input.ownerId,
        })
        .then(() => "enqueued" as const)
        .catch(async (error: unknown) => {
          // Idempotent replay returns the existing job from queue.create; a
          // uniqueness race surfaces as a conflict error — both are benign.
          const message = error instanceof Error ? error.message : String(error);
          if (/conflict|idempoten|duplicate/i.test(message)) return "duplicate" as const;
          throw error;
        });
      return existing;
    },
  };
}

// ---------------------------------------------------------------------------
// Maintenance sweep — one durable-job handler drives every due Block 2 duty
// ---------------------------------------------------------------------------

export type SweepResult = {
  temporal: { scanned: number; fired: number; rescheduled: number; completed: number; expired: number };
  monitors: { evaluated: number; triggered: number; replayed: number };
  realtime: { connections: number; delivered: number; resyncRequired: number };
  reservationsExpired: number;
  assignmentOffersExpired: number;
  trackSessionsExpired: number;
  scheduledRunsQueued: number;
};

export async function runBlock2Sweep(
  db: Block2Db,
  deps: {
    dispatcher: ContinuationDispatcher;
    evaluator?: ConditionEvaluator;
    now?: Date;
  },
): Promise<SweepResult> {
  const now = deps.now ?? new Date();
  const temporal = await fireDueTemporalTriggers(db, deps.dispatcher, deps.evaluator, {
    now,
  });
  const reservationsExpired = await expireDueReservations(db, { now });
  const assignmentOffersExpired = await expireDueAssignmentOffers(db, { now });
  const trackSessionsExpired = (await expireDueTrackSessions(db, { now })).length;

  // Standing monitors evaluate HERE, inside the duty cycle that already
  // exists. That is the whole of the scheduling story: no timer, no worker of
  // its own, and restart recovery inherited rather than written again.
  //
  //   SECOND_SCHEDULERS_ADDED = 0
  const { sweepDueMonitors } = await import("../monitoring-runtime");
  const monitors = await sweepDueMonitors({ now });

  // Realtime delivery and heartbeat are steps in the SAME duty cycle. A socket
  // that stopped answering is closed here, and the ledger is carried to every
  // open subscription here — no timer of realtime's own, and a restart costs a
  // reconnect rather than a lost event.
  //
  //   SECOND_SCHEDULERS_ADDED = 0
  const { deliverRealtime, getWebSocketInstance } = await import("../../core/websocket");
  getWebSocketInstance()?.sweepHeartbeats();
  const realtime = await deliverRealtime({ now });

  // resumeAt is part of the canonical Run record. Discovery only schedules
  // explicitly timed WAITING runs; input/approval waits remain parked.
  const dueRuns = await db
    .select({ id: runs.id, ownerId: runs.ownerId, resumeAt: runs.resumeAt })
    .from(runs)
    .where(
      and(
        eq(runs.status, "waiting"),
        isNotNull(runs.resumeAt),
        lte(runs.resumeAt, now),
      ),
    );
  for (const run of dueRuns) {
    const scheduledFor = run.resumeAt!.toISOString();
    await deps.dispatcher.dispatch({
      ownerId: run.ownerId,
      jobKind: BLOCK2_JOB_KINDS.RESUME_NODE,
      payload: { runId: run.id, scheduledFor },
      idempotencyKey: `run-resume:${run.id}:${scheduledFor}`,
      runId: run.id,
    });
  }
  return {
    temporal,
    monitors,
    realtime,
    reservationsExpired,
    assignmentOffersExpired,
    trackSessionsExpired,
    scheduledRunsQueued: dueRuns.length,
  };
}

/**
 * Self-perpetuating scan chain: the scan job runs the sweep, then enqueues
 * its successor tick. Bucketed idempotency collapses duplicate scheduling.
 */
export function makeTemporalScanHandler(deps: {
  db: Block2Db;
  queue: DurableJobQueue;
  artifacts: ImmutableArtifactStore;
  evaluator?: ConditionEvaluator;
  scanIntervalMs?: number;
}): DurableJobHandler {
  const interval = Math.max(500, deps.scanIntervalMs ?? TEMPORAL_SCAN_INTERVAL_MS);
  return async ({ job }) => {
    const dispatcher = makeContinuationDispatcher({ queue: deps.queue, artifacts: deps.artifacts });
    const sweep = await runBlock2Sweep(deps.db, { dispatcher, evaluator: deps.evaluator });
    const nextTick = Math.floor(Date.now() / interval) + 1;
    await deps.queue.create({
      kind: BLOCK2_JOB_KINDS.TEMPORAL_SCAN,
      subjectType: "system",
      subjectId: "block2.temporal-scan",
      payloadSchemaVersion: 1,
      payload: await encodePayload(deps.artifacts, { tick: nextTick }),
      idempotencyKey: `block2:scan:tick:${nextTick}`,
      availableAt: new Date(nextTick * interval).toISOString(),
      createdBy: "block2.temporal-scan",
    });
    return encodePayload(deps.artifacts, {
      jobId: job.id,
      fired: sweep.temporal.fired,
      reservationsExpired: sweep.reservationsExpired,
    });
  };
}

/** Ensure the scan chain exists (idempotent — safe at every boot). */
export async function bootstrapTemporalScan(deps: {
  queue: DurableJobQueue;
  artifacts: ImmutableArtifactStore;
  scanIntervalMs?: number;
}): Promise<void> {
  const interval = Math.max(500, deps.scanIntervalMs ?? TEMPORAL_SCAN_INTERVAL_MS);
  const tick = Math.floor(Date.now() / interval) + 1;
  await deps.queue.create({
    kind: BLOCK2_JOB_KINDS.TEMPORAL_SCAN,
    subjectType: "system",
    subjectId: "block2.temporal-scan",
    payloadSchemaVersion: 1,
    payload: await encodePayload(deps.artifacts, { tick, bootstrap: true }),
    idempotencyKey: `block2:scan:tick:${tick}`,
    availableAt: new Date(tick * interval).toISOString(),
    createdBy: "block2.boot",
  });
}
