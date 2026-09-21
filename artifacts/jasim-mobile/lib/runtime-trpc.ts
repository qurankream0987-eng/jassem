import type {
  SmartBubbleArtifactRole,
  SmartBubbleProjection,
  SmartBubbleRuntimeRecord,
} from "@workspace/jasim-bubble-contract";
import {
  ActiveWorkspaceProjectionSchema,
  LivingObjectsProjectionSchema,
  TrustedActionEnvelopeSchema,
  TrustedDispatchResultSchema,
  type ActiveWorkspaceProjection,
  type LivingObjectsProjection,
  type TrustedActionEnvelope,
  type TrustedDispatchResult,
} from "@workspace/jasim-runtime-contract";
import { runtimeEndpoint } from "@/lib/runtime-endpoint";

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } };
  error?: { json?: { message?: string }; message?: string };
};

export type RuntimeMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  outputKind?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type RuntimeRunReceipt = {
  status: string;
  verificationStatus?: "PENDING" | "VERIFIED" | "FAILED" | "INCONCLUSIVE";
  aggregatedOutput: Record<string, unknown>;
};

export type RuntimeConversation = {
  id: string;
  title: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  messages?: RuntimeMessage[];
  bubbles?: RuntimeBubble[];
};

export type RuntimeBubble = SmartBubbleRuntimeRecord;

// Delegated rather than rebuilt: two modules each constructing a URL is how
// the scheme rule ended up true in one place and unenforceable in the other.
const endpoint = runtimeEndpoint;

// Current bearer token — set by the SessionProvider via setCallToken().
// Kept in module scope so it is available synchronously for every call.
let _currentBearerToken: string | null = null;
let _onUnauthorized: () => void = () => {};

/** Called by SessionProvider once a token is resolved. */
export function setCallToken(token: string | null): void {
  _currentBearerToken = token;
}

/** Lets the session provider discard an expired bearer credential. */
export function setRuntimeUnauthorizedHandler(handler: () => void): void {
  _onUnauthorized = handler;
}

/** Headers for authenticated native media requests to the canonical runtime. */
export function runtimeRequestHeaders(): Record<string, string> {
  return buildHeaders();
}

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = { ...extra };
  if (_currentBearerToken) {
    base["Authorization"] = `Bearer ${_currentBearerToken}`;
  }
  return base;
}

async function call<T>(
  procedure: string,
  method: "GET" | "POST",
  input?: unknown,
): Promise<T> {
  const requestUrl =
    method === "GET" && input !== undefined
      ? `${endpoint(procedure)}?input=${encodeURIComponent(
          JSON.stringify({ json: input }),
        )}`
      : endpoint(procedure);
  const response = await fetch(requestUrl, {
    method,
    headers: method === "POST"
      ? buildHeaders({ "content-type": "application/json" })
      : buildHeaders(),
    body:
      method === "POST" && input !== undefined
        ? JSON.stringify({ json: input })
        : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as TrpcEnvelope<T>;
  if (response.status === 401) {
    _onUnauthorized();
  }
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.json?.message ??
        payload.error?.message ??
        `تعذر الاتصال بخادم جاسم (${response.status}).`,
    );
  }
  if (payload.result?.data?.json === undefined) {
    throw new Error("استجابة Runtime غير صالحة.");
  }
  return payload.result.data.json;
}

export async function listConversations(): Promise<RuntimeConversation[]> {
  const result = await call<{ conversations: RuntimeConversation[] }>(
    "runtime.conversationsList",
    "GET",
  );
  return result.conversations;
}

export function getConversation(conversationId: string): Promise<RuntimeConversation> {
  return call("runtime.conversationsGet", "GET", { conversationId });
}

export function getRunReceipt(runId: string): Promise<RuntimeRunReceipt> {
  return call("runtime.runsReceipt", "GET", { runId });
}

export function createConversation(title?: string): Promise<RuntimeConversation> {
  return call("runtime.conversationsCreate", "POST", title ? { title } : undefined);
}

export function archiveConversation(conversationId: string): Promise<RuntimeConversation> {
  return call("runtime.conversationsArchive", "POST", { conversationId });
}

export async function createTurn(
  conversationId: string,
  content: string,
): Promise<{
  userMessage: RuntimeMessage;
  assistantMessage: RuntimeMessage;
  output: Record<string, unknown>;
}> {
  return call("runtime.turnsCreate", "POST", { conversationId, content });
}

export async function listBubbles(): Promise<RuntimeBubble[]> {
  const result = await call<{ bubbles: RuntimeBubble[] }>(
    "runtime.bubblesList",
    "GET",
  );
  return result.bubbles;
}

export function getBubbleProjection(
  bubbleId: string,
): Promise<SmartBubbleProjection<RuntimeBubble>> {
  return call("runtime.bubblesProjection", "GET", { bubbleId });
}

export async function getWorkspaceProjection(
  conversationId?: string,
): Promise<ActiveWorkspaceProjection> {
  const result = await call<unknown>(
    "runtime.workspaceProjection",
    "GET",
    conversationId ? { conversationId } : undefined,
  );
  return ActiveWorkspaceProjectionSchema.parse(result);
}

export async function getLivingObjectsProjection(
  limit = 30,
): Promise<LivingObjectsProjection> {
  const result = await call<unknown>(
    "runtime.activeLivingObjects",
    "GET",
    { limit },
  );
  return LivingObjectsProjectionSchema.parse(result);
}

export async function dispatchTrustedAction(
  input: TrustedActionEnvelope,
): Promise<TrustedDispatchResult> {
  const action = TrustedActionEnvelopeSchema.parse(input);
  const result = await call<unknown>("runtime.dispatchAction", "POST", action);
  return TrustedDispatchResultSchema.parse(result);
}
// ── The persistent world ─────────────────────────────────────────────────────
//
//   UI != WORLD · UI != CANONICAL STATE
//
// The SAME `runtime.*` procedures the web app calls. There is no
// MobileWorldRuntime and no world semantics on this side of the wire:
// presentation adapts, meaning does not. A world read here after a cold start
// is the world the server has, not something restored from local state.

export type MobileWorldSummary = {
  worldId: string;
  title: string;
  status: string;
  version: string;
  entityCount: number;
  policyCount: number;
  workflowCount: number;
  updatedAt: string;
};

export type MobileWorldVersion = {
  version: string;
  status: string;
  parentVersion?: string;
  changeRequest?: string;
  createdAt: string;
};

export async function listWorlds(organizationId?: string): Promise<MobileWorldSummary[]> {
  const result = await call<{ worlds: MobileWorldSummary[] }>(
    "runtime.worldList",
    "GET",
    organizationId ? { organizationId } : undefined,
  );
  return result.worlds;
}

export function getWorld(
  worldId: string,
  organizationId?: string,
): Promise<{ world: MobileWorldSummary; projection: Record<string, unknown> }> {
  return call("runtime.worldRead", "GET", {
    worldId,
    ...(organizationId ? { organizationId } : {}),
  });
}

/** Every version, superseded ones included. Nothing was erased to make room. */
export async function getWorldHistory(
  worldId: string,
  organizationId?: string,
): Promise<MobileWorldVersion[]> {
  const result = await call<{ versions: MobileWorldVersion[] }>("runtime.worldHistory", "GET", {
    worldId,
    ...(organizationId ? { organizationId } : {}),
  });
  return result.versions;
}

/**
 * The durable ledger, resumed from a cursor.
 *
 * Polled. Nothing here subscribes, and nothing here says «مباشر» — the
 * transport is a separate capability and this is only the cursor it will use.
 */
export async function getWorldEvents(
  worldId: string,
  after?: number,
): Promise<{ events: { cursor: number; type: string; version: string; message: string }[]; cursor: number }> {
  return call("runtime.worldEvents", "GET", {
    worldId,
    ...(after !== undefined ? { after } : {}),
  });
}
