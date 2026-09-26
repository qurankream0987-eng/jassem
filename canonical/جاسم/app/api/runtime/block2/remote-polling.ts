import { eq } from "drizzle-orm";
import { capabilityProviderCatalog } from "@db/schema";
import { completeRemoteRuntimeDagNode } from "../jasim-runtime";
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

export type RemoteClientFactory = (endpoint: string) => RemoteTaskClient;

type PollDependencies = {
  clientFactory?: RemoteClientFactory;
  /** Supplying an authenticated owner makes the ownership boundary explicit. */
  ownerId?: string;
};

function defaultClientFactory(endpoint: string): RemoteTaskClient {
  return createMcpClient({ baseUrl: endpoint });
}

/**
 * WHERE the remote system is.
 *
 * `receiptSecret` used to come back from here too, read as plaintext out of a
 * discovery row and handed to the completion path, which checked a receipt
 * against whatever its caller supplied. It is gone: the material now belongs to
 * the ACCOUNT the execution recorded, and the completion path resolves it.
 *
 *   PROVIDER_RECEIPT_SECRET != PUBLIC DISCOVERY METADATA
 *   CLIENT_CAN_OVERRIDE_RECEIPT_SECRET = 0
 *
 * The ENDPOINT still comes from the catalog, and that is a separate question
 * this phase deliberately did not widen into — see
 * `docs/architecture/JASIM_RECEIPT_VERIFICATION.md`.
 */
async function providerConfiguration(
  db: Block2Db,
  providerId: string,
): Promise<{ endpoint: string }> {
  const [provider] = await db
    .select()
    .from(capabilityProviderCatalog)
    .where(eq(capabilityProviderCatalog.id, providerId))
    .limit(1);
  if (!provider || (provider.kind !== "MCP" && provider.kind !== "A2A")) {
    throw new RemoteExecutionError("Remote provider catalog entry not found", "NOT_FOUND");
  }
  const endpoint =
    typeof provider.ioMetadata.endpoint === "string"
      ? provider.ioMetadata.endpoint
      : provider.provenance.reference;
  if (!endpoint) {
    throw new RemoteExecutionError("Remote provider endpoint is unavailable", "INVALID");
  }
  return { endpoint };
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

  const provider = await providerConfiguration(db, execution.providerId);
  const client = (deps.clientFactory ?? defaultClientFactory)(provider.endpoint);
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

  const requested = await transitionRemoteExecution(db, {
    id: execution.id,
    ownerId: input.ownerId,
    to: "CANCEL_REQUESTED",
    expectedVersion: execution.version,
  });
  const provider = await providerConfiguration(db, execution.providerId);
  const client = (input.clientFactory ?? defaultClientFactory)(provider.endpoint);
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