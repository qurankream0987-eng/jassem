import { z } from "zod";

export type PresentationPrimitive =
  | "TEXT"
  | "CARD"
  | "LIST"
  | "ENTITY_CARD"
  | "ENTITY_LIST"
  | "ENTITY_GRID"
  | "SEARCH_RESULTS"
  | "GRID"
  | "DETAIL"
  | "FORM"
  | "CHOICE"
  | "TABLE"
  | "COMPARISON"
  | "STATUS"
  | "PROGRESS"
  | "TIMELINE"
  | "TRACKER"
  | "MAP"
  | "MARKER"
  | "ROUTE"
  | "CALENDAR"
  | "SCHEDULE"
  | "ACTION"
  | "APPROVAL"
  | "CHECKOUT"
  | "PRICE_SUMMARY"
  | "EXTERNAL_ACTION"
  | "PAYMENT_STATUS"
  | "CHAT"
  | "METRIC"
  | "ARTIFACT_PREVIEW"
  | "DOCUMENT"
  | "MEDIA"
  | "WARNING"
  | "RECEIPT"
  | "WORLD_SUMMARY"
  | "WORKSPACE"
  | "ERROR_STATE"
  | "EMPTY_STATE"
  | "SMART_BUBBLE";

export type PresentationField = {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  unit?: string;
  requiredNow?: boolean;
  readOnly?: boolean;
  verified?: boolean;
  unknown?: boolean;
  label?: string;
};

export type PresentationAction = {
  intent:
    | "approve"
    | "reject"
    | "submit"
    | "cancel"
    | "select"
    | "retry"
    | "open"
    | "open_external"
    | "expand"
    | "minimize"
    | "restore"
    | "archive"
    | "update";
  label: string;
  requiresApproval?: boolean;
  external?: boolean;
};

export type PresentationDefinition = {
  primitive: PresentationPrimitive;
  version: 1;
  title?: string;
  data: Record<string, unknown>;
  fields?: PresentationField[];
  children?: PresentationDefinition[];
  actions?: PresentationAction[];
};

const PRESENTATION_PRIMITIVES = [
  "TEXT", "CARD", "LIST", "ENTITY_CARD", "ENTITY_LIST", "ENTITY_GRID",
  "SEARCH_RESULTS", "GRID", "DETAIL", "FORM", "CHOICE", "TABLE",
  "COMPARISON", "STATUS", "PROGRESS", "TIMELINE", "TRACKER", "MAP",
  "MARKER", "ROUTE", "CALENDAR", "SCHEDULE", "ACTION", "APPROVAL",
  "CHECKOUT", "PRICE_SUMMARY", "EXTERNAL_ACTION", "PAYMENT_STATUS",
  "CHAT", "METRIC", "ARTIFACT_PREVIEW", "DOCUMENT", "MEDIA", "WARNING",
  "RECEIPT", "WORLD_SUMMARY", "WORKSPACE", "ERROR_STATE", "EMPTY_STATE",
  "SMART_BUBBLE",
] as const satisfies readonly PresentationPrimitive[];

const PRESENTATION_INTENTS = [
  "approve", "reject", "submit", "cancel", "select", "retry", "open",
  "open_external", "expand", "minimize", "restore", "archive", "update",
] as const satisfies readonly PresentationAction["intent"][];

export const PresentationFieldSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["string", "number", "boolean", "array", "object"]),
  unit: z.string().max(80).optional(),
  requiredNow: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  verified: z.boolean().optional(),
  unknown: z.boolean().optional(),
  label: z.string().max(240).optional(),
}).strict();

export const PresentationActionSchema = z.object({
  intent: z.enum(PRESENTATION_INTENTS),
  label: z.string().trim().min(1).max(240),
  requiresApproval: z.boolean().optional(),
  external: z.boolean().optional(),
}).strict();

export const PresentationDefinitionSchema: z.ZodType<PresentationDefinition> = z.lazy(() =>
  z.object({
    primitive: z.enum(PRESENTATION_PRIMITIVES),
    version: z.literal(1),
    title: z.string().max(240).optional(),
    data: z.record(z.string(), z.unknown()),
    fields: z.array(PresentationFieldSchema).max(100).optional(),
    children: z.array(PresentationDefinitionSchema).max(50).optional(),
    actions: z.array(PresentationActionSchema).max(50).optional(),
  }).strict(),
);

export function safeParsePresentationDefinition(value: unknown) {
  return PresentationDefinitionSchema.safeParse(value);
}

export type ActiveWorkspaceStatus =
  | "idle"
  | "active"
  | "awaiting_input"
  | "awaiting_approval"
  | "running"
  | "blocked"
  | "failed"
  | "completed";

export type ActiveWorkspaceAttention = {
  kind: "input_required" | "approval_required" | "blocked" | "failed" | "ongoing";
  sourceId: string;
  severity: "info" | "warning" | "error";
  reason: string;
  actionIntent?: string;
};

export type ActiveWorkspaceProjection = {
  kind: "active_workspace_projection";
  version: 1;
  workspaceId: string;
  conversation: {
    id: string;
    title: string | null;
    status: "active" | "archived";
    updatedAt: string;
  } | null;
  activeGoal: {
    kind: "runtime_task" | "runtime_run";
    id: string;
    text: string;
    status: string;
    taskId?: string | null;
    runId?: string | null;
    presentationVersion?: string | null;
  } | null;
  currentPresentation: PresentationDefinition | null;
  resultSet: {
    id: string;
    version: number;
    queryText: string;
    sources: string[];
    candidates: Array<{
      id: string;
      position: number;
      title: string;
      summary: string | null;
      source: string;
      canonicalRef: string | null;
      externalRef: string | null;
      attributes: Record<string, unknown>;
      availability: string | null;
      trust: string;
      actionable: string[];
      provenance: Record<string, unknown>;
      observedAt: string | null;
    }>;
  } | null;
  selectedEntityReferences: Array<{
    referenceKey: string;
    targetKind: string;
    targetId: string;
    resultSetId: string | null;
    position: number | null;
  }>;
  activeRun: {
    id: string;
    goal: string;
    status: string;
    taskId: string | null;
    bubbleId: string | null;
    updatedAt: string;
  } | null;
  activeAction: {
    id: string;
    intentType: string;
    status: string;
    runId: string | null;
    targetReferences: Record<string, unknown>[];
    approvalRequired: boolean;
  } | null;
  approval: {
    id: string;
    proposalId: string;
    status: string;
    expiresAt: string | null;
    presentationVersion: string;
  } | null;
  transactionReference: { kind: string; id: string } | null;
  worldReference: {
    kind: "generated_system" | "runtime_world";
    id: string;
    worldKey: string | null;
    version: string | number | null;
    status: string;
  } | null;
  status: ActiveWorkspaceStatus;
  attention: ActiveWorkspaceAttention[];
  availablePresentationActions: PresentationAction[];
  updatedAt: string | null;
  presentationVersion: string;
};

const activeWorkspaceProjectionSchema = z.object({
  kind: z.literal("active_workspace_projection"),
  version: z.literal(1),
  workspaceId: z.string().min(1).max(240),
  conversation: z.object({
    id: z.string().min(1),
    title: z.string().nullable(),
    status: z.enum(["active", "archived"]),
    updatedAt: z.string(),
  }).nullable(),
  activeGoal: z.object({
    kind: z.enum(["runtime_task", "runtime_run"]),
    id: z.string().min(1),
    text: z.string(),
    status: z.string(),
    taskId: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    presentationVersion: z.string().nullable().optional(),
  }).nullable(),
  currentPresentation: PresentationDefinitionSchema.nullable(),
  resultSet: z.object({
    id: z.string().min(1),
    version: z.number().int(),
    queryText: z.string(),
    sources: z.array(z.string()),
    candidates: z.array(z.object({
      id: z.string(),
      position: z.number().int(),
      title: z.string(),
      summary: z.string().nullable(),
      source: z.string(),
      canonicalRef: z.string().nullable(),
      externalRef: z.string().nullable(),
      attributes: z.record(z.string(), z.unknown()),
      availability: z.string().nullable(),
      trust: z.string(),
      actionable: z.array(z.string()),
      provenance: z.record(z.string(), z.unknown()),
      observedAt: z.string().nullable(),
    })),
  }).nullable(),
  selectedEntityReferences: z.array(z.object({
    referenceKey: z.string(),
    targetKind: z.string(),
    targetId: z.string(),
    resultSetId: z.string().nullable(),
    position: z.number().int().nullable(),
  })),
  activeRun: z.object({
    id: z.string(),
    goal: z.string(),
    status: z.string(),
    taskId: z.string().nullable(),
    bubbleId: z.string().nullable(),
    updatedAt: z.string(),
  }).nullable(),
  activeAction: z.object({
    id: z.string(),
    intentType: z.string(),
    status: z.string(),
    runId: z.string().nullable(),
    targetReferences: z.array(z.record(z.string(), z.unknown())),
    approvalRequired: z.boolean(),
  }).nullable(),
  approval: z.object({
    id: z.string(),
    proposalId: z.string(),
    status: z.string(),
    expiresAt: z.string().nullable(),
    presentationVersion: z.string(),
  }).nullable(),
  transactionReference: z.object({ kind: z.string(), id: z.string() }).nullable(),
  worldReference: z.object({
    kind: z.enum(["generated_system", "runtime_world"]),
    id: z.string(),
    worldKey: z.string().nullable(),
    version: z.union([z.string(), z.number()]).nullable(),
    status: z.string(),
  }).nullable(),
  status: z.enum([
    "idle", "active", "awaiting_input", "awaiting_approval", "running",
    "blocked", "failed", "completed",
  ]),
  attention: z.array(z.object({
    kind: z.enum(["input_required", "approval_required", "blocked", "failed", "ongoing"]),
    sourceId: z.string(),
    severity: z.enum(["info", "warning", "error"]),
    reason: z.string(),
    actionIntent: z.string().optional(),
  })),
  availablePresentationActions: z.array(PresentationActionSchema),
  updatedAt: z.string().nullable(),
  presentationVersion: z.string(),
}).strict() satisfies z.ZodType<ActiveWorkspaceProjection>;

export const ActiveWorkspaceProjectionSchema = activeWorkspaceProjectionSchema;

export type PresentationTransition =
  | "ENTER"
  | "UPDATE"
  | "MORPH"
  | "EXIT"
  | "NO_CHANGE";

export type PresentationIdentity = {
  key: string;
  primitive: PresentationPrimitive;
};

function stableSerialization(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialization).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialization(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function fingerprint(value: unknown): string {
  const serialized = stableSerialization(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}-${serialized.length}`;
}

export function derivePresentationIdentity(
  projection: ActiveWorkspaceProjection | null | undefined,
): PresentationIdentity | null {
  const presentation = projection?.currentPresentation;
  if (!projection || !presentation) return null;
  return {
    primitive: presentation.primitive,
    key: `${presentation.primitive}:${fingerprint({
      workspaceId: projection.workspaceId,
      conversationId: projection.conversation?.id ?? null,
      presentationVersion: projection.presentationVersion,
      status: projection.status,
      activeGoal: projection.activeGoal,
      resultSet: projection.resultSet
        ? { id: projection.resultSet.id, version: projection.resultSet.version }
        : null,
      selectedReferenceKeys: projection.selectedEntityReferences
        .map((reference) => ({
          referenceKey: reference.referenceKey,
          targetKind: reference.targetKind,
          targetId: reference.targetId,
          resultSetId: reference.resultSetId,
          position: reference.position,
        }))
        .sort((left, right) => left.referenceKey.localeCompare(right.referenceKey)),
      activeRun: projection.activeRun,
      activeAction: projection.activeAction,
      approval: projection.approval,
      transactionReference: projection.transactionReference,
      worldReference: projection.worldReference,
      presentation,
    })}`,
  };
}

export function classifyPresentationTransition(
  previous: PresentationIdentity | null,
  current: PresentationIdentity | null,
): PresentationTransition {
  if (!previous && current) return "ENTER";
  if (previous && !current) return "EXIT";
  if (!previous && !current) return "NO_CHANGE";
  if (!previous || !current) return "NO_CHANGE";
  if (previous.key === current.key) return "NO_CHANGE";
  return previous.primitive === current.primitive ? "UPDATE" : "MORPH";
}

export type LivingObjectReference = {
  kind: "runtime_task" | "runtime_run" | "generated_system" | "smart_bubble";
  id: string;
};

export type LivingObjectStatus =
  | "ACTIVE" | "WAITING" | "RUNNING" | "MONITORING" | "WAITING_USER"
  | "WAITING_APPROVAL" | "VERIFYING" | "BLOCKED" | "FAILED" | "COMPLETED";

export type LivingObjectAttentionLevel =
  | "NONE" | "INFO" | "ACTION_REQUIRED" | "APPROVAL_REQUIRED"
  | "BLOCKED" | "FAILED" | "COMPLETED";

export type LivingObjectAction = {
  intent: "open" | "resume" | "review" | "approve" | "cancel" | "pause" | "archive";
  label: string;
  requiresApproval?: boolean;
  reference: LivingObjectReference;
};

export type LivingObjectProjection = {
  id: string;
  underlyingReference: LivingObjectReference;
  relatedReferences: LivingObjectReference[];
  semanticType: "process" | "world" | "bubble";
  title: string;
  summary: string;
  status: LivingObjectStatus;
  attention: {
    level: LivingObjectAttentionLevel;
    reason: string | null;
  };
  progress?: { completed: number; total: number; ratio: number } | null;
  primaryAction: LivingObjectAction | null;
  secondaryActions: LivingObjectAction[];
  updatedAt: string;
  createdAt: string;
  presentationVersion: string;
  durability: "ongoing" | "persistent" | "recently_completed";
  completion: "not_complete" | "completed" | "failed";
};

export type LivingObjectsProjection = {
  kind: "living_objects_projection";
  version: 1;
  objects: LivingObjectProjection[];
  limit: number;
  generatedAt: string;
};

const livingObjectReferenceSchema = z.object({
  kind: z.enum(["runtime_task", "runtime_run", "generated_system", "smart_bubble"]),
  id: z.string().min(1).max(240),
}).strict();

const livingObjectActionSchema = z.object({
  intent: z.enum(["open", "resume", "review", "approve", "cancel", "pause", "archive"]),
  label: z.string().min(1).max(240),
  requiresApproval: z.boolean().optional(),
  reference: livingObjectReferenceSchema,
}).strict();

export const LivingObjectProjectionSchema: z.ZodType<LivingObjectProjection> = z.object({
  id: z.string().min(1).max(300),
  underlyingReference: livingObjectReferenceSchema,
  relatedReferences: z.array(livingObjectReferenceSchema).max(20),
  semanticType: z.enum(["process", "world", "bubble"]),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2_000),
  status: z.enum([
    "ACTIVE", "WAITING", "RUNNING", "MONITORING", "WAITING_USER",
    "WAITING_APPROVAL", "VERIFYING", "BLOCKED", "FAILED", "COMPLETED",
  ]),
  attention: z.object({
    level: z.enum([
      "NONE", "INFO", "ACTION_REQUIRED", "APPROVAL_REQUIRED",
      "BLOCKED", "FAILED", "COMPLETED",
    ]),
    reason: z.string().max(500).nullable(),
  }).strict(),
  progress: z.object({
    completed: z.number().int().min(0),
    total: z.number().int().positive(),
    ratio: z.number().min(0).max(1),
  }).strict().nullable().optional(),
  primaryAction: livingObjectActionSchema.nullable(),
  secondaryActions: z.array(livingObjectActionSchema).max(10),
  updatedAt: z.string(),
  createdAt: z.string(),
  presentationVersion: z.string().min(1).max(300),
  durability: z.enum(["ongoing", "persistent", "recently_completed"]),
  completion: z.enum(["not_complete", "completed", "failed"]),
}).strict();

export const LivingObjectsProjectionSchema: z.ZodType<LivingObjectsProjection> = z.object({
  kind: z.literal("living_objects_projection"),
  version: z.literal(1),
  objects: z.array(LivingObjectProjectionSchema).max(100),
  limit: z.number().int().min(1).max(100),
  generatedAt: z.string(),
}).strict();

export const TrustedActionSourceSchema = z.enum([
  "PRESENTATION", "WORKSPACE", "LIVING_OBJECT", "SMART_BUBBLE", "CONVERSATION",
]);
export type TrustedActionSource = z.infer<typeof TrustedActionSourceSchema>;

export const TrustedReferenceKindSchema = z.enum([
  "conversation", "runtime_task", "runtime_run", "smart_bubble",
  "generated_system", "execution_proposal",
]);
export type TrustedReferenceKind = z.infer<typeof TrustedReferenceKindSchema>;

export const TrustedReferenceSchema = z.object({
  kind: TrustedReferenceKindSchema,
  id: z.string().trim().min(1).max(240),
}).strict();
export type TrustedReference = z.infer<typeof TrustedReferenceSchema>;

export const TrustedPresentationReferenceSchema = z.object({
  kind: z.enum(["workspace", "bubble", "living_object"]),
  id: z.string().trim().min(1).max(240),
}).strict();
export type TrustedPresentationReference = z.infer<typeof TrustedPresentationReferenceSchema>;

export const TrustedActionTypeSchema = z.enum([
  "WORKSPACE_COLLAPSE", "WORKSPACE_EXPAND", "RAIL_COLLAPSE", "RAIL_EXPAND",
  "LOCAL_TAB_CHANGE", "OPEN_REFERENCE", "RESUME_OPERATION", "REFRESH_PROJECTION",
  "UPDATE_BUBBLE_PRESENTATION", "ATTACH_ARTIFACT", "SUBMIT_INPUT", "SELECT_ENTITY",
  "REQUEST_CHANGE", "CREATE_PROPOSAL", "APPROVE_PROPOSAL", "CANCEL_OPERATION",
  "REQUEST_EXECUTION", "RECONCILE_RUN",
]);
export type TrustedActionType = z.infer<typeof TrustedActionTypeSchema>;

const trustedActionPayloadSchema = z.record(z.string().max(120), z.unknown());
export const TrustedActionEnvelopeSchema = z.object({
  version: z.literal(1),
  actionId: z.string().trim().min(1).max(200),
  actionType: TrustedActionTypeSchema,
  intent: z.string().trim().min(1).max(160),
  source: TrustedActionSourceSchema,
  targetReference: TrustedReferenceSchema.optional(),
  conversationReference: TrustedReferenceSchema.optional(),
  goalReference: TrustedReferenceSchema.optional(),
  presentationReference: TrustedPresentationReferenceSchema.optional(),
  expectedPresentationVersion: z.string().trim().min(1).max(300).optional(),
  payload: trustedActionPayloadSchema.default({}),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
}).strict();
export type TrustedActionEnvelope = z.infer<typeof TrustedActionEnvelopeSchema>;

export const TRUSTED_LOCAL_ACTION_TYPES = [
  "WORKSPACE_COLLAPSE", "WORKSPACE_EXPAND", "RAIL_COLLAPSE",
  "RAIL_EXPAND", "LOCAL_TAB_CHANGE",
] as const satisfies readonly TrustedActionType[];

export const TRUSTED_CANONICAL_READ_ACTION_TYPES = [
  "OPEN_REFERENCE", "RESUME_OPERATION", "REFRESH_PROJECTION",
] as const satisfies readonly TrustedActionType[];

export const TRUSTED_CONSEQUENTIAL_ACTION_TYPES = [
  "SUBMIT_INPUT", "SELECT_ENTITY", "REQUEST_CHANGE", "CREATE_PROPOSAL",
  "APPROVE_PROPOSAL", "CANCEL_OPERATION", "REQUEST_EXECUTION",
  "RECONCILE_RUN", "ATTACH_ARTIFACT", "UPDATE_BUBBLE_PRESENTATION",
] as const satisfies readonly TrustedActionType[];

export type TrustedDispatchOutcome =
  | "LOCAL_ONLY" | "OPENED" | "PROJECTION_REFRESH_REQUIRED" | "DISPATCH_ACCEPTED"
  | "APPROVAL_REQUIRED" | "BLOCKED" | "STALE" | "UNAUTHORIZED"
  | "INVALID_ACTION" | "INCONCLUSIVE" | "FAILED";

export type TrustedDispatchResult = {
  outcome: TrustedDispatchOutcome;
  actionId?: string;
  actionType?: TrustedActionType;
  reference?: TrustedReference;
  message: string;
  refreshProjection?: boolean;
  canonicalState?: string;
};

export const TrustedDispatchResultSchema: z.ZodType<TrustedDispatchResult> = z.object({
  outcome: z.enum([
    "LOCAL_ONLY", "OPENED", "PROJECTION_REFRESH_REQUIRED", "DISPATCH_ACCEPTED",
    "APPROVAL_REQUIRED", "BLOCKED", "STALE", "UNAUTHORIZED",
    "INVALID_ACTION", "INCONCLUSIVE", "FAILED",
  ]),
  actionId: z.string().optional(),
  actionType: TrustedActionTypeSchema.optional(),
  reference: TrustedReferenceSchema.optional(),
  message: z.string(),
  refreshProjection: z.boolean().optional(),
  canonicalState: z.string().optional(),
}).strict();

export function isTrustedLocalAction(actionType: TrustedActionType): boolean {
  return (TRUSTED_LOCAL_ACTION_TYPES as readonly string[]).includes(actionType);
}

export function isTrustedCanonicalAction(actionType: TrustedActionType): boolean {
  return (
    (TRUSTED_CANONICAL_READ_ACTION_TYPES as readonly string[]).includes(actionType) ||
    (TRUSTED_CONSEQUENTIAL_ACTION_TYPES as readonly string[]).includes(actionType)
  );
}

/**
 * Client-safe URL policy for generated presentation content.
 * Presentation data may suggest a URL, but it may never select an executable
 * scheme or an arbitrary storage/object path.
 */
export function safePresentationExternalUrl(
  value: unknown,
  protocols: readonly string[] = ["https:"],
): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const trimmed = value.trim();
  const match = /^([a-z][a-z\d+.-]*):\/\/([^/?#\s]+)([/?#][^\s]*)?$/i.exec(trimmed);
  if (!match) return null;

  const protocol = `${match[1].toLowerCase()}:`;
  if (!protocols.some((allowedProtocol) => allowedProtocol.toLowerCase() === protocol)) {
    return null;
  }

  const host = match[2];
  const suffix = match[3] ?? "/";
  return `${protocol}//${host}${suffix}`;
}

export function safePresentationPath(value: unknown, prefix: string): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.startsWith("//") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}