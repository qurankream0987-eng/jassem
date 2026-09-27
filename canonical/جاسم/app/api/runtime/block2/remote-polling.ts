import { completeRemoteRuntimeDagNode } from "../jasim-runtime";
import { authorizedConnection, httpAuthorizationFor } from "../provider-binding";
import { canonicalResultDigest } from "../execution-verifier";
import { createMcpClient } from "./mcp-client";
import {
  getRemoteExecution,
  RemoteExecutionError,
  transitionRemoteExecution,
} from "./remote-execution";
import type { Block2Db } from "./temporal";

export type RemoteTaskClient = {
  getTask(taskId: string): Promise<unknown>;
  cancelTask(taskId: string): Promise<{ confirmed: boolean }>;
};

export type RemoteClientFactory = (
  endpoint: string,
  headers: Readonly<Record<string, string>>,
) => RemoteTaskClient;

type PollDependencies = {
  clientFactory?: RemoteClientFactory;
  /** Supplying an authenticated owner makes the ownership boundary explicit. */
  ownerId?: string;
};

function defaultClientFactory(
  endpoint: string,
  headers: Readonly<Record<string, string>>,
): RemoteTaskClient {
  return createMcpClient({ baseUrl: endpoint, headers: { ...headers } });
}

/**
 * THE CONNECTION THAT CREATED THIS EXECUTION, AND NO OTHER.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 *
 * Polling and cancellation used to look the destination up like this:
 *
 *   execution.providerId → capability_provider_catalog → ioMetadata.endpoint
 *
 * — a DISCOVERED row, re-read at call time, mutable by whatever discovered it.
 * So a catalog row edited between the invocation and the poll redirected the
 * follow-up to wherever the new value pointed, and a cancellation — a mutating
 * external action — went to the same place. No account, no credential, no
 * grant, and an address whose only check was that it was public HTTPS.
 *
 *   DISCOVERED_ENDPOINT != AUTHORIZED_DESTINATION
 *   DISCOVERY_MUTATION_REDIRECTS_RUNNING_EXECUTION = 0
 *
 * ─── AND WHAT IT DOES INSTEAD ───────────────────────────────────────────────
 *
 * Reads the account the execution PINNED when it was created. Nothing is
 * reselected: not the latest binding, not a preferred provider, not the current
 * policy, not the first account that matches.
 *
 *   POLL_RESELECTS_PROVIDER_BINDING = 0 · CANCEL_RESELECTS_PROVIDER_BINDING = 0
 *   PAST_SELECTION != CURRENT_EXECUTION_AUTHORITY
 *
 * An execution that pinned nothing fails closed. There is no catalog fallback,
 * because a fallback is exactly the thing being removed.
 *
 *   NULL_PROVIDER_BINDING_POLL_ALLOWED = 0 · UNKNOWN_BINDING != ANY_BINDING
 *
 * ─── AUTHORITY IS RE-CHECKED, NOT REMEMBERED ────────────────────────────────
 *
 * WHICH account ran the request is a settled historical fact, and so is WHICH
 * EXACT OPERATION each follow-up was authorized as — both are read from the row.
 * Whether that connection may still be called is a question about NOW, and this
 * asks it again every time: a connection that is no longer VERIFIED is refused
 * for a readback and for a cancellation alike, which is the rule the general
 * provider doors already apply.
 *
 * The two follow-ups are DIFFERENT operations and need their own grants. Neither
 * inherits the invocation's, and neither is satisfied by another verb that
 * happens to be on the same side of the vocabulary.
 */
async function pinnedConnection(
  execution: {
    ownerId: string;
    providerBindingRef: string | null;
    providerDefinitionId: string | null;
    authorizedOperations: { invoke: string; readback?: string; cancel?: string } | null;
  },
  operation: "readback" | "cancel",
): Promise<{ endpoint: string; headers: Readonly<Record<string, string>> }> {
  // The exact verb this operation was authorized as, read from the row. An
  // execution that pinned none has no authorized readback and no authorized
  // withdrawal — which is a refusal, not a reason to look for a verb that would
  // do.
  //
  //   AUTHORITY_TO_EXECUTE != AUTHORITY_TO_READ_BACK
  //   AUTHORITY_TO_CREATE != AUTHORITY_TO_CANCEL
  const requiresCapability = execution.authorizedOperations?.[operation] ?? null;
  const outcome = await authorizedConnection({
    bindingId: execution.providerBindingRef,
    onBehalfOfScopeId: execution.ownerId,
    definitionId: execution.providerDefinitionId,
    requiresCapability: requiresCapability as never,
  });
  if (outcome.status !== "AUTHORIZED") {
    throw new RemoteExecutionError(outcome.detail, "FORBIDDEN");
  }
  return {
    endpoint: outcome.connection.endpoint,
    headers: httpAuthorizationFor(outcome.connection),
  };
}

function taskObservation(raw: unknown): {
  completed: boolean;
  failed: boolean;
  content?: unknown;
  receiptSignature?: string;
  evidence: Record<string, unknown>;
} {
  const evidence =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : { value: raw };
  const status = typeof evidence.status === "string" ? evidence.status.toLowerCase() : "";
  const failed = ["failed", "error", "cancelled", "canceled"].includes(status);
  const completed = ["completed", "complete", "succeeded", "success"].includes(status);
  const result =
    evidence.result !== null &&
    typeof evidence.result === "object" &&
    !Array.isArray(evidence.result)
      ? evidence.result as Record<string, unknown>
      : undefined;
  const content =
    result && Object.prototype.hasOwnProperty.call(result, "content")
      ? result.content
      : Object.prototype.hasOwnProperty.call(evidence, "content")
        ? evidence.content
        : evidence.result;
  const receipt =
    result?.receipt &&
    typeof result.receipt === "object" &&
    !Array.isArray(result.receipt)
      ? result.receipt as Record<string, unknown>
      : undefined;
  const receiptSignature =
    receipt?.algorithm === "hmac-sha256" && typeof receipt.signature === "string"
      ? receipt.signature
      : undefined;
  return {
    completed,
    failed,
    content,
    evidence,
    ...(receiptSignature ? { receiptSignature } : {}),
  };
}

function normalizedRemoteContent(capabilityId: string, content: unknown): Record<string, unknown> {
  const result =
    content !== null && typeof content === "object" && !Array.isArray(content)
      ? content as Record<string, unknown>
      : { content };
  return {
    result: JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
    metadata: { capabilityId },
  };
}

export async function pollRemoteExecution(
  db: Block2Db,
  remoteExecutionId: string,
  deps: PollDependencies = {},
): Promise<unknown> {
  const execution = await getRemoteExecution(db, remoteExecutionId);
  if (!execution) throw new RemoteExecutionError("Remote execution not found", "NOT_FOUND");
  if (deps.ownerId !== undefined && execution.ownerId !== deps.ownerId) {
    throw new RemoteExecutionError("Remote execution belongs to another owner", "FORBIDDEN");
  }
  if (execution.state === "COMPLETED") return null;
  if (execution.state !== "RUNNING" || !execution.remoteReference) {
    throw new RemoteExecutionError("Remote execution is not pollable", "INVALID_STATE");
  }

  // A readback of work this account already did. Reading, not changing.
  const connection = await pinnedConnection(execution, "readback");
  const client = (deps.clientFactory ?? defaultClientFactory)(connection.endpoint, connection.headers);
  const observation = taskObservation(await client.getTask(execution.remoteReference));
  if (!observation.completed && !observation.failed) return null;
  if (observation.failed) {
    await transitionRemoteExecution(db, {
      id: execution.id,
      ownerId: execution.ownerId,
      to: "FAILED",
      expectedVersion: execution.version,
      evidence: observation.evidence,
    });
    return null;
  }

  const output = normalizedRemoteContent(execution.providerId, observation.content);
  const payload =
    output.result && typeof output.result === "object" && !Array.isArray(output.result)
      ? output.result as Record<string, unknown>
      : {};
  const resultDigest = canonicalResultDigest(payload);
  await transitionRemoteExecution(db, {
    id: execution.id,
    ownerId: execution.ownerId,
    to: "COMPLETED",
    expectedVersion: execution.version,
    evidence: {
      ...observation.evidence,
      resultDigest,
      ...(observation.receiptSignature
        ? { receiptSignature: observation.receiptSignature }
        : {}),
    },
  });
  return completeRemoteRuntimeDagNode({
    database: db,
    ownerId: execution.ownerId,
    remoteExecutionId: execution.id,
    output,
  });
}

export async function requestRemoteCancellation(
  db: Block2Db,
  input: {
    id: string;
    ownerId: string;
    clientFactory?: RemoteClientFactory;
  },
) {
  const execution = await getRemoteExecution(db, input.id);
  if (!execution) throw new RemoteExecutionError("Remote execution not found", "NOT_FOUND");
  if (execution.ownerId !== input.ownerId) {
    throw new RemoteExecutionError("Remote execution belongs to another owner", "FORBIDDEN");
  }
  if (execution.state !== "RUNNING" || !execution.remoteReference) {
    throw new RemoteExecutionError("Remote execution is not cancellable", "INVALID_STATE");
  }

  // A NEW instruction to the other side, so it needs a mutating grant and the
  // connection's authority is re-checked now rather than remembered — and it is
  // checked BEFORE the state moves, so a refusal leaves canonical state exactly
  // as it was rather than parking the execution at CANCEL_REQUESTED forever.
  //
  //   REFUSED_CANCEL_MOVES_CANONICAL_STATE = 0
  const connection = await pinnedConnection(execution, "cancel");
  const requested = await transitionRemoteExecution(db, {
    id: execution.id,
    ownerId: input.ownerId,
    to: "CANCEL_REQUESTED",
    expectedVersion: execution.version,
  });
  const client = (input.clientFactory ?? defaultClientFactory)(connection.endpoint, connection.headers);
  const cancellation = await client.cancelTask(execution.remoteReference);
  if (!cancellation.confirmed) return requested;
  return transitionRemoteExecution(db, {
    id: execution.id,
    ownerId: input.ownerId,
    to: "CANCEL_CONFIRMED",
    expectedVersion: requested.version,
    evidence: {
      confirmed: true,
      cancelledBy: "provider",
      reference: execution.remoteReference,
    },
  });
}