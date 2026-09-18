/**
 * JASIM EVALUATION — reading a trajectory out of canonical evidence.
 *
 * ─── NO NEW TELEMETRY ───────────────────────────────────────────────────────
 *
 * Every field below is read from a table the runtime already writes for its own
 * purposes. Nothing here asks the runtime to record anything extra, because a
 * benchmark that needs its own instrumentation measures the instrumentation.
 *
 * The one exception is documented in the report: `execution_attempts.provider`
 * is an existing column the executor never populated, so provider choice was
 * invisible. Filling a column that already exists is not new telemetry; it is
 * finishing a row.
 *
 * ─── NO CHAIN OF THOUGHT ────────────────────────────────────────────────────
 *
 * The evaluator reads structured artefacts only: statuses, ids, decisions,
 * reason codes, timestamps. It never reads, requires or stores model reasoning
 * text. `message.content` is deliberately excluded from every check — a
 * benchmark that asserts prose is measuring wording and calling it truth.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  dagDependencies,
  dagNodes,
  events as runEvents,
  executionAttempts,
  executionProposals,
  messages,
  modelUsageLedger,
  proposalApprovals,
  runs,
} from "@db/schema";

export type TrajectoryDb = NodePgDatabase<any>;

/** One node of the executed plan, with its own effect verdict. */
export type TrajectoryStep = {
  nodeKey: string;
  capabilityId: string | null;
  status: string;
  /** Upstream node keys. Empty on every conversational run today — see the report. */
  dependsOn: readonly string[];
  attempts: readonly {
    attemptId: string;
    attemptNumber: number;
    executionStatus: string;
    verificationStatus: string;
    provider: string | null;
    /** The completion policy's structured verdict, when one was recorded. */
    completion?: {
      effectKind?: string;
      decision?: string;
      reasonCode?: string;
      confirmedBy?: string;
      retryPermitted?: boolean;
      missingEvidence?: readonly string[];
    };
    startedAt: Date;
    finishedAt: Date | null;
  }[];
};

export type Trajectory = {
  runId: string | null;
  conversationId: string | null;
  ownerId: string;

  /** Interpretation — statuses and ids only, never the prose. */
  proposals: readonly {
    id: string;
    capabilityId: string | null;
    riskLevel: string;
    policyDecision: string;
    approvalRequired: boolean;
    status: string;
    fingerprint: string;
    dependencies: readonly string[];
  }[];

  approvals: readonly {
    proposalId: string;
    status: string;
    executionFingerprint: string;
    consumedAt: Date | null;
    expiresAt: Date | null;
  }[];

  plan: readonly TrajectoryStep[];
  runStatus: string | null;
  /** Structured run state. Read for blockedReason and effects only. */
  runState: Record<string, unknown>;

  /** Observable event types in order. Types only — never payload prose. */
  eventTypes: readonly string[];

  cost: {
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    costMinor: number | null;
  };

  latency: {
    /** First user message row → terminal run state. Null when either is absent. */
    endToEndMs: number | null;
    /** Sum of attempt durations — the runtime's own share, excluding waits. */
    executionMs: number;
  };

  /** Output kinds of assistant messages, in order. Kinds only. */
  outputKinds: readonly string[];
};

function completionOf(detail: unknown): TrajectoryStep["attempts"][number]["completion"] {
  if (!detail || typeof detail !== "object") return undefined;
  const completion = (detail as { completion?: unknown }).completion;
  if (!completion || typeof completion !== "object") return undefined;
  const record = completion as Record<string, unknown>;
  const str = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined);
  return {
    ...(str("effectKind") ? { effectKind: str("effectKind") } : {}),
    ...(str("decision") ? { decision: str("decision") } : {}),
    ...(str("reasonCode") ? { reasonCode: str("reasonCode") } : {}),
    ...(str("confirmedBy") ? { confirmedBy: str("confirmedBy") } : {}),
    ...(typeof record.retryPermitted === "boolean" ? { retryPermitted: record.retryPermitted } : {}),
    ...(Array.isArray(record.missingEvidence)
      ? { missingEvidence: record.missingEvidence.map(String) }
      : {}),
  };
}

export async function readTrajectory(
  db: TrajectoryDb,
  input: { ownerId: string; runId?: string; conversationId?: string },
): Promise<Trajectory> {
  const { ownerId, runId = null, conversationId = null } = input;

  const runRow = runId
    ? (await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.ownerId, ownerId))))[0]
    : undefined;

  const proposalRows = runId
    ? await db
        .select()
        .from(executionProposals)
        .where(and(eq(executionProposals.runId, runId), eq(executionProposals.ownerId, ownerId)))
    : [];

  const approvalRows = proposalRows.length
    ? await db
        .select()
        .from(proposalApprovals)
        .where(inArray(proposalApprovals.proposalId, proposalRows.map((p) => p.id)))
    : [];

  const nodeRows = runId
    ? await db
        .select()
        .from(dagNodes)
        .where(and(eq(dagNodes.runId, runId), eq(dagNodes.ownerId, ownerId)))
    : [];

  const dependencyRows = runId
    ? await db
        .select()
        .from(dagDependencies)
        .where(and(eq(dagDependencies.runId, runId), eq(dagDependencies.ownerId, ownerId)))
    : [];

  const attemptRows = runId
    ? await db
        .select()
        .from(executionAttempts)
        .where(and(eq(executionAttempts.runId, runId), eq(executionAttempts.ownerId, ownerId)))
        .orderBy(asc(executionAttempts.startedAt))
    : [];

  const eventRows = runId
    ? await db
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), eq(runEvents.ownerId, ownerId)))
        .orderBy(asc(runEvents.id))
    : [];

  const messageRows = conversationId
    ? await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.ownerId, ownerId)))
        .orderBy(asc(messages.createdAt))
    : [];

  const ledgerRows = runId
    ? await db.select().from(modelUsageLedger).where(eq(modelUsageLedger.runId, runId))
    : [];

  const keyById = new Map(nodeRows.map((node) => [node.id, node.nodeKey]));
  const upstreamByNode = new Map<string, string[]>();
  for (const dependency of dependencyRows) {
    const list = upstreamByNode.get(dependency.downstreamNodeId) ?? [];
    const key = keyById.get(dependency.upstreamNodeId);
    if (key) list.push(key);
    upstreamByNode.set(dependency.downstreamNodeId, list);
  }

  const plan: TrajectoryStep[] = nodeRows.map((node) => ({
    nodeKey: node.nodeKey,
    capabilityId: node.capabilityId ?? null,
    status: node.status,
    dependsOn: upstreamByNode.get(node.id) ?? [],
    attempts: attemptRows
      .filter((attempt) => attempt.nodeId === node.id)
      .map((attempt) => ({
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        executionStatus: attempt.executionStatus,
        verificationStatus: attempt.verificationStatus,
        provider: attempt.provider ?? null,
        ...(completionOf(attempt.verificationDetail)
          ? { completion: completionOf(attempt.verificationDetail) }
          : {}),
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
      })),
  }));

  const executionMs = attemptRows.reduce(
    (total, attempt) =>
      total +
      (attempt.finishedAt ? attempt.finishedAt.getTime() - attempt.startedAt.getTime() : 0),
    0,
  );

  const firstUserAt = messageRows.find((message) => message.role === "user")?.createdAt ?? null;
  const terminalAt = runRow?.updatedAt ?? null;

  return {
    runId,
    conversationId,
    ownerId,
    proposals: proposalRows.map((proposal) => ({
      id: proposal.id,
      capabilityId: proposal.capabilityId ?? null,
      riskLevel: proposal.riskLevel,
      policyDecision: proposal.policyDecision,
      approvalRequired: proposal.approvalRequired,
      status: proposal.status,
      fingerprint: proposal.fingerprint,
      dependencies: proposal.dependencies ?? [],
    })),
    approvals: approvalRows.map((approval) => ({
      proposalId: approval.proposalId,
      status: approval.status,
      executionFingerprint: approval.executionFingerprint,
      consumedAt: approval.consumedAt ?? null,
      expiresAt: approval.expiresAt ?? null,
    })),
    plan,
    runStatus: runRow?.status ?? null,
    runState: (runRow?.currentState ?? {}) as Record<string, unknown>,
    eventTypes: eventRows.map((event) => event.type),
    cost: {
      modelCalls: ledgerRows.length,
      inputTokens: ledgerRows.reduce((total, row) => total + (row.inputTokens ?? 0), 0),
      outputTokens: ledgerRows.reduce((total, row) => total + (row.outputTokens ?? 0), 0),
      costMinor: ledgerRows.length
        ? ledgerRows.reduce((total, row) => total + Number(row.costMinor ?? 0), 0)
        : null,
    },
    latency: {
      endToEndMs:
        firstUserAt && terminalAt ? terminalAt.getTime() - firstUserAt.getTime() : null,
      executionMs,
    },
    outputKinds: messageRows
      .filter((message) => message.role === "assistant")
      .map((message) => message.outputKind ?? "text"),
  };
}
