/**
 * Block 2 — provider-side execution references shared by MCP and A2A.
 *
 * A RemoteExecution is deliberately below a JASIM Run/DAG node. It records
 * only invocation and provider evidence, with optimistic concurrency on every
 * mutation.
 */

import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  type DelegationGrant,
  remoteExecutions,
  type RemoteExecution,
  type RemoteExecutionState,
} from "@db/schema";
import type { Block2Db } from "./temporal";

/**
 * The only payload that may cross the A2A boundary. In particular, this
 * projection has no place for conversation, memory, or world state.
 */
export function buildA2AProjection(input: {
  objective: string;
  typedInput: Record<string, unknown>;
  grant: DelegationGrant;
  timeLimitMs?: number;
}): {
  objective: string;
  typedInput: Record<string, unknown>;
  delegationGrantId: string;
  allowedCapabilities: string[];
  expiresAt: string | null;
} {
  const boundedExpiry =
    input.timeLimitMs !== undefined &&
    Number.isFinite(input.timeLimitMs) &&
    input.timeLimitMs > 0
      ? new Date(Date.now() + input.timeLimitMs)
      : null;
  const expiresAt =
    input.grant.expiresAt && boundedExpiry
      ? new Date(Math.min(input.grant.expiresAt.getTime(), boundedExpiry.getTime()))
      : input.grant.expiresAt ?? boundedExpiry;
  return {
    objective: input.objective,
    typedInput: input.typedInput,
    delegationGrantId: input.grant.id,
    allowedCapabilities: input.grant.allowedCapabilities.filter(
      (capability) => !input.grant.deniedCapabilities.includes(capability),
    ),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

export class RemoteExecutionError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "INVALID_STATE"
    | "STALE_VERSION"
    | "DUPLICATE_CALLBACK"
    | "INVALID";

  constructor(
    message: string,
    code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID_STATE"
      | "STALE_VERSION"
      | "DUPLICATE_CALLBACK"
      | "INVALID",
  ) {
    super(message);
    this.code = code;
  }
}

const transitions: Record<RemoteExecutionState, readonly RemoteExecutionState[]> = {
  INVOKED: ["RUNNING", "COMPLETED", "FAILED", "INCONCLUSIVE"],
  RUNNING: ["COMPLETED", "FAILED", "INCONCLUSIVE", "CANCEL_REQUESTED"],
  CANCEL_REQUESTED: ["CANCEL_CONFIRMED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  CANCEL_CONFIRMED: [],
  INCONCLUSIVE: [],
};

function assertTransition(
  from: RemoteExecutionState,
  to: RemoteExecutionState,
  evidence?: Record<string, unknown>,
): void {
  if (!transitions[from].includes(to)) {
    throw new RemoteExecutionError(`Illegal remote execution transition: ${from} -> ${to}`, "INVALID_STATE");
  }
  if (
    to === "CANCEL_CONFIRMED" &&
    (evidence?.cancelledBy !== "provider" ||
      typeof evidence.reference !== "string" ||
      evidence.reference.length === 0)
  ) {
    throw new RemoteExecutionError(
      "Cancellation confirmation requires provider evidence and a reference",
      "INVALID",
    );
  }
}

function appendedEvidence(
  current: Record<string, unknown>,
  next: Record<string, unknown> | undefined,
  observedAt: Date,
): Record<string, unknown> {
  if (!next) return current;
  const prior = Array.isArray(current.observations) ? current.observations : [];
  return {
    ...current,
    ...next,
    observations: [...prior, { ...next, observedAt: observedAt.toISOString() }],
  };
}

export type CreateRemoteExecutionInput = {
  ownerId: string;
  runId: string;
  nodeId: string;
  providerId: string;
  bindingId?: string;
  protocolKind: "MCP" | "A2A";
  requestDigest: string;
  idempotencyKey: string;
  delegationGrantId?: string;
};

export async function createRemoteExecution(
  db: Block2Db,
  input: CreateRemoteExecutionInput,
): Promise<RemoteExecution> {
  if (!input.ownerId || !input.providerId || !input.requestDigest || !input.idempotencyKey) {
    throw new RemoteExecutionError("Required remote execution fields are missing", "INVALID");
  }
  const inserted = await db
    .insert(remoteExecutions)
    .values({
      id: `rex_${randomUUID()}`,
      ownerId: input.ownerId,
      runId: input.runId,
      nodeId: input.nodeId,
      providerId: input.providerId,
      bindingId: input.bindingId ?? null,
      protocolKind: input.protocolKind,
      requestDigest: input.requestDigest,
      idempotencyKey: input.idempotencyKey,
      delegationGrantId: input.delegationGrantId ?? null,
      state: "INVOKED",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const existing = await db
    .select()
    .from(remoteExecutions)
    .where(
      and(
        eq(remoteExecutions.ownerId, input.ownerId),
        eq(remoteExecutions.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    throw new RemoteExecutionError("Idempotent remote execution could not be read", "INVALID");
  }
  return existing[0];
}

export async function attachRemoteReference(
  db: Block2Db,
  input: { id: string; ownerId: string; remoteReference: string; expectedVersion: number },
): Promise<RemoteExecution> {
  if (!input.remoteReference) {
    throw new RemoteExecutionError("remoteReference is required", "INVALID");
  }
  const rows = await db
    .update(remoteExecutions)
    .set({
      remoteReference: input.remoteReference,
      state: "RUNNING",
      lastObservedAt: new Date(),
      version: sql`${remoteExecutions.version} + 1`,
    })
    .where(
      and(
        eq(remoteExecutions.id, input.id),
        eq(remoteExecutions.ownerId, input.ownerId),
        eq(remoteExecutions.state, "INVOKED"),
        eq(remoteExecutions.version, input.expectedVersion),
      ),
    )
    .returning();
  if (rows[0]) return rows[0];
  return explainFailedCas(db, input.id, input.ownerId, input.expectedVersion, "INVOKED");
}

export async function transitionRemoteExecution(
  db: Block2Db,
  input: {
    id: string;
    ownerId: string;
    to: RemoteExecutionState;
    expectedVersion: number;
    evidence?: Record<string, unknown>;
  },
): Promise<RemoteExecution> {
  const current = await requireOwned(db, input.id, input.ownerId);
  if (current.version !== input.expectedVersion) {
    throw new RemoteExecutionError("Remote execution version is stale", "STALE_VERSION");
  }
  assertTransition(current.state, input.to, input.evidence);
  const now = new Date();
  const rows = await db
    .update(remoteExecutions)
    .set({
      state: input.to,
      evidence: appendedEvidence(current.evidence, input.evidence, now),
      lastObservedAt: now,
      version: sql`${remoteExecutions.version} + 1`,
    })
    .where(
      and(
        eq(remoteExecutions.id, input.id),
        eq(remoteExecutions.ownerId, input.ownerId),
        eq(remoteExecutions.state, current.state),
        eq(remoteExecutions.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!rows[0]) throw new RemoteExecutionError("Remote execution version is stale", "STALE_VERSION");
  return rows[0];
}

export async function recordProviderCallback(
  db: Block2Db,
  input: {
    providerId: string;
    remoteReference: string;
    callbackId: string;
    state: RemoteExecutionState;
    evidence: Record<string, unknown>;
    observedVersion: number;
  },
): Promise<{ applied: boolean; duplicate?: true; execution: RemoteExecution }> {
  if (!input.callbackId || !input.remoteReference) {
    throw new RemoteExecutionError("callbackId and remoteReference are required", "INVALID");
  }
  const found = await db
    .select()
    .from(remoteExecutions)
    .where(
      and(
        eq(remoteExecutions.providerId, input.providerId),
        eq(remoteExecutions.remoteReference, input.remoteReference),
      ),
    )
    .limit(1);
  const current = found[0];
  if (!current) throw new RemoteExecutionError("Remote execution not found", "NOT_FOUND");
  const seen = Array.isArray(current.evidence.seenCallbackIds)
    ? current.evidence.seenCallbackIds.filter((value): value is string => typeof value === "string")
    : [];
  if (seen.includes(input.callbackId)) {
    return { applied: false, duplicate: true, execution: current };
  }
  if (input.observedVersion !== current.version) {
    throw new RemoteExecutionError("Callback observed a stale execution version", "STALE_VERSION");
  }
  assertTransition(current.state, input.state, input.evidence);
  const now = new Date();
  const evidence = appendedEvidence(
    current.evidence,
    { ...input.evidence, seenCallbackIds: [...seen, input.callbackId] },
    now,
  );
  const rows = await db
    .update(remoteExecutions)
    .set({
      state: input.state,
      evidence,
      lastObservedAt: now,
      version: sql`${remoteExecutions.version} + 1`,
    })
    .where(
      and(
        eq(remoteExecutions.id, current.id),
        eq(remoteExecutions.version, input.observedVersion),
      ),
    )
    .returning();
  if (rows[0]) return { applied: true, execution: rows[0] };

  // A concurrent replay may have won the CAS. Report it as a duplicate only
  // when its callback id is now durably present.
  const latest = await getRemoteExecution(db, current.id);
  if (
    latest &&
    Array.isArray(latest.evidence.seenCallbackIds) &&
    latest.evidence.seenCallbackIds.includes(input.callbackId)
  ) {
    return { applied: false, duplicate: true, execution: latest };
  }
  throw new RemoteExecutionError("Callback observed a stale execution version", "STALE_VERSION");
}

async function requireOwned(db: Block2Db, id: string, ownerId: string): Promise<RemoteExecution> {
  const execution = await getRemoteExecution(db, id);
  if (!execution) throw new RemoteExecutionError("Remote execution not found", "NOT_FOUND");
  if (execution.ownerId !== ownerId) {
    throw new RemoteExecutionError("Remote execution belongs to another owner", "FORBIDDEN");
  }
  return execution;
}

async function explainFailedCas(
  db: Block2Db,
  id: string,
  ownerId: string,
  expectedVersion: number,
  expectedState: RemoteExecutionState,
): Promise<never> {
  const current = await requireOwned(db, id, ownerId);
  if (current.version !== expectedVersion) {
    throw new RemoteExecutionError("Remote execution version is stale", "STALE_VERSION");
  }
  if (current.state !== expectedState) {
    throw new RemoteExecutionError("Remote execution is in an invalid state", "INVALID_STATE");
  }
  throw new RemoteExecutionError("Remote execution update failed", "STALE_VERSION");
}

export async function getRemoteExecution(
  db: Block2Db,
  id: string,
): Promise<RemoteExecution | undefined> {
  const rows = await db.select().from(remoteExecutions).where(eq(remoteExecutions.id, id)).limit(1);
  return rows[0];
}

export async function listRemoteExecutions(
  db: Block2Db,
  filter: { runId?: string; ownerId?: string; providerId?: string },
): Promise<RemoteExecution[]> {
  const conditions = [];
  if (filter.runId) conditions.push(eq(remoteExecutions.runId, filter.runId));
  if (filter.ownerId) conditions.push(eq(remoteExecutions.ownerId, filter.ownerId));
  if (filter.providerId) conditions.push(eq(remoteExecutions.providerId, filter.providerId));
  return db
    .select()
    .from(remoteExecutions)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}