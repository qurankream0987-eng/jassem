/**
 * Block 1 — Generative Interaction Fabric.
 *
 * Semantic state is projected into the smallest sufficient interaction
 * surface. The UI is a projection, never the source of truth: actions emitted
 * here are intents only, never direct effects. Web and mobile share this one
 * presentation contract.
 */

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
  // A chart of a CanonicalDataset. Added with the data layer, not before: a
  // chart with no dataset is a picture.
  | "CHART"
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
  /** Intent identifier only. The renderer never executes effects directly. */
  intent: string;
  label: string;
  requiresApproval?: boolean;
  external?: boolean;
};

export type PresentationDefinition = {
  primitive: PresentationPrimitive;
  version: 1;
  title?: string;
  /** Projection data only — authorized, already-filtered state. */
  data: Record<string, unknown>;
  fields?: PresentationField[];
  children?: PresentationDefinition[];
  actions?: PresentationAction[];
};

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
  /**
   * The canonical record the presented surface was read out of.
   *
   *   CANONICAL_PRESENTATION_STATE != VISIBLE_RENDER_INSTANCE
   *
   * One stored surface, read by two renderers, was shown twice. This says
   * WHICH record is being presented so a host can claim it by identity —
   * never by comparing what two surfaces look like.
   */
  currentPresentationSource?: { kind: "message" | "commercial_order" | "economic_proposal"; id: string } | null;
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

export type SemanticPresentationInput = {
  /** What interaction the semantic state currently needs. */
  interactionNeed:
    | "inform"
    | "collect_input"
    | "compare"
    | "show_state"
    | "show_history"
    | "track"
    | "authorize"
    | "external_transition"
    | "operate_persistent"
    | "preview_artifact"
    | "show_schedule"
    | "show_result";
  data: Record<string, unknown>;
  missingFields?: PresentationField[];
  candidates?: Array<Record<string, unknown>>;
  /** Trusted observations only. Coordinates must come from trusted state. */
  observation?: {
    status?: string;
    locationDescription?: string;
    coordinates?: { lat: number; lng: number };
    observedAt?: string;
    source?: string;
  };
  events?: Array<{ at: string; semantics: string }>;
  approvalSummary?: {
    action: string;
    stateChanges?: string[];
    publicData?: string[];
    externalEffect?: string;
  };
  externalAction?: { provider: string; purpose: string; sessionId: string };
  persistent?: boolean;
  /** Generic signals consumed by the deterministic decision layer. */
  semanticOutput?:
    | "text"
    | "structured"
    | "candidates"
    | "comparison"
    | "input"
    | "state"
    | "document"
    | "world"
    | "error"
    | "empty"
    | "unknown";
  resultCount?: number;
  resultSetPresent?: boolean;
  referencedEntityCount?: number;
  selectedEntityCount?: number;
  requiresStructuredInput?: boolean;
  actionRisk?: "none" | "low" | "medium" | "high" | "critical";
  actionability?: "read_only" | "input_required" | "write" | "consequential";
  ongoing?: boolean;
  transactionState?:
    | "none"
    | "awaiting_approval"
    | "checkout_ready"
    | "ongoing"
    | "completed"
    | "failed";
  hasFinancialEffect?: boolean;
  documentSummary?: boolean;
  worldReference?: boolean;
};

const PRESENTATION_PRIMITIVES = [
  "TEXT",
  "CARD",
  "LIST",
  "ENTITY_CARD",
  "ENTITY_LIST",
  "ENTITY_GRID",
  "SEARCH_RESULTS",
  "GRID",
  "DETAIL",
  "FORM",
  "CHOICE",
  "TABLE",
  "COMPARISON",
  "STATUS",
  "PROGRESS",
  "TIMELINE",
  "TRACKER",
  "MAP",
  "MARKER",
  "ROUTE",
  "CALENDAR",
  "SCHEDULE",
  "ACTION",
  "APPROVAL",
  "CHECKOUT",
  "PRICE_SUMMARY",
  "EXTERNAL_ACTION",
  "PAYMENT_STATUS",
  "CHAT",
  "METRIC",
  // CHART became legitimate only once CanonicalDataset existed: a chart with
  // no dataset is a picture. It renders a dataset the runtime produced, never
  // model-authored drawing code.
  "CHART",
  "ARTIFACT_PREVIEW",
  "DOCUMENT",
  "MEDIA",
  "WARNING",
  "RECEIPT",
  "WORLD_SUMMARY",
  "WORKSPACE",
  "ERROR_STATE",
  "EMPTY_STATE",
  "SMART_BUBBLE",
] as const;

const PRESENTATION_INTENTS = [
  "approve",
  "reject",
  "submit",
  "cancel",
  "select",
  "retry",
  "open",
  "open_external",
  "expand",
  "minimize",
  "restore",
  "archive",
  "update",
] as const;

export const PresentationFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(["string", "number", "boolean", "array", "object"]),
    unit: z.string().max(80).optional(),
    requiredNow: z.boolean().optional(),
    readOnly: z.boolean().optional(),
    verified: z.boolean().optional(),
    unknown: z.boolean().optional(),
    label: z.string().max(240).optional(),
  })
  .strict();

/**
 * Presentation actions are intent identifiers, not executable component names
 * or JavaScript. The allow-list is deliberately finite so an unknown
 * privileged action fails closed before it reaches a renderer.
 */
export const PresentationActionSchema = z
  .object({
    intent: z.enum(PRESENTATION_INTENTS),
    label: z.string().trim().min(1).max(240),
    requiresApproval: z.boolean().optional(),
    external: z.boolean().optional(),
  })
  .strict();

export const SemanticPresentationInputSchema = z
  .object({
    interactionNeed: z.enum([
      "inform",
      "collect_input",
      "compare",
      "show_state",
      "show_history",
      "track",
      "authorize",
      "external_transition",
      "operate_persistent",
      "preview_artifact",
      "show_schedule",
      "show_result",
    ]),
    data: z.record(z.string(), z.unknown()),
    missingFields: z.array(PresentationFieldSchema).max(100).optional(),
    candidates: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
    observation: z
      .object({
        status: z.string().max(120).optional(),
        locationDescription: z.string().max(500).optional(),
        coordinates: z
          .object({ lat: z.number().finite(), lng: z.number().finite() })
          .strict()
          .optional(),
        observedAt: z.string().max(120).optional(),
        source: z.string().max(240).optional(),
      })
      .strict()
      .optional(),
    events: z
      .array(z.object({ at: z.string().max(120), semantics: z.string().max(500) }).strict())
      .max(200)
      .optional(),
    approvalSummary: z
      .object({
        action: z.string().max(500),
        stateChanges: z.array(z.string().max(500)).max(100).optional(),
        publicData: z.array(z.string().max(500)).max(100).optional(),
        externalEffect: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    externalAction: z
      .object({
        provider: z.string().max(120),
        purpose: z.string().max(500),
        sessionId: z.string().max(240),
      })
      .strict()
      .optional(),
    persistent: z.boolean().optional(),
    semanticOutput: z
      .enum([
        "text",
        "structured",
        "candidates",
        "comparison",
        "input",
        "state",
        "document",
        "world",
        "error",
        "empty",
        "unknown",
      ])
      .optional(),
    resultCount: z.number().int().min(0).max(10_000).optional(),
    resultSetPresent: z.boolean().optional(),
    referencedEntityCount: z.number().int().min(0).max(10_000).optional(),
    selectedEntityCount: z.number().int().min(0).max(10_000).optional(),
    requiresStructuredInput: z.boolean().optional(),
    actionRisk: z.enum(["none", "low", "medium", "high", "critical"]).optional(),
    actionability: z.enum(["read_only", "input_required", "write", "consequential"]).optional(),
    ongoing: z.boolean().optional(),
    transactionState: z
      .enum(["none", "awaiting_approval", "checkout_ready", "ongoing", "completed", "failed"])
      .optional(),
    hasFinancialEffect: z.boolean().optional(),
    documentSummary: z.boolean().optional(),
    worldReference: z.boolean().optional(),
  })
  .strict();

export const PresentationDefinitionSchema: z.ZodType<PresentationDefinition> = z.lazy(
  (): z.ZodType<PresentationDefinition> =>
  z
    .object({
      primitive: z.enum(PRESENTATION_PRIMITIVES),
      version: z.literal(1),
      title: z.string().max(240).optional(),
      data: z.record(z.string(), z.unknown()),
      fields: z.array(PresentationFieldSchema).max(100).optional(),
      children: z.array(PresentationDefinitionSchema).max(50).optional(),
      actions: z.array(PresentationActionSchema).max(50).optional(),
    })
    .strict(),
);

export const ActiveWorkspaceProjectionSchema = z.object({
  kind: z.literal("active_workspace_projection"),
  version: z.literal(1),
  workspaceId: z.string().min(1).max(240),
  conversation: z
    .object({
      id: z.string().min(1),
      title: z.string().nullable(),
      status: z.enum(["active", "archived"]),
      updatedAt: z.string(),
    })
    .nullable(),
  activeGoal: z
    .object({
      kind: z.enum(["runtime_task", "runtime_run"]),
      id: z.string().min(1),
      text: z.string(),
      status: z.string(),
      taskId: z.string().nullable().optional(),
      runId: z.string().nullable().optional(),
      presentationVersion: z.string().nullable().optional(),
    })
    .nullable(),
  currentPresentation: PresentationDefinitionSchema.nullable(),
  // Optional by construction. A projection from a client or a cache that
  // predates this field must still PARSE — a missing claim means «nobody is
  // presenting it», which returns the record's own copy to the conversation.
  // Refusing the whole projection instead would blank the workspace over a
  // field whose entire job is to remove a duplicate.
  //
  //   AN ABSENT CLAIM IS NOT AN INVALID PROJECTION
  currentPresentationSource: z
    .object({
      // The runtime's own canonical record kinds — the same vocabulary a
      // reference binding's `targetKind` uses. A surface is read out of a
      // message's metadata, or built from a canonical row that is waiting on
      // the person; naming which is what keeps one thing from being drawn twice.
      kind: z.enum(["message", "commercial_order", "economic_proposal"]),
      id: z.string().min(1).max(240),
    })
    .nullable()
    .optional()
    .default(null),
  resultSet: z
    .object({
      id: z.string().min(1),
      version: z.number().int(),
      queryText: z.string(),
      sources: z.array(z.string()),
      candidates: z.array(
        z.object({
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
        }),
      ),
    })
    .nullable(),
  selectedEntityReferences: z.array(
    z.object({
      referenceKey: z.string(),
      targetKind: z.string(),
      targetId: z.string(),
      resultSetId: z.string().nullable(),
      position: z.number().int().nullable(),
    }),
  ),
  activeRun: z
    .object({
      id: z.string(),
      goal: z.string(),
      status: z.string(),
      taskId: z.string().nullable(),
      bubbleId: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  activeAction: z
    .object({
      id: z.string(),
      intentType: z.string(),
      status: z.string(),
      runId: z.string().nullable(),
      targetReferences: z.array(z.record(z.string(), z.unknown())),
      approvalRequired: z.boolean(),
    })
    .nullable(),
  approval: z
    .object({
      id: z.string(),
      proposalId: z.string(),
      status: z.string(),
      expiresAt: z.string().nullable(),
      presentationVersion: z.string(),
    })
    .nullable(),
  transactionReference: z
    .object({ kind: z.string(), id: z.string() })
    .nullable(),
  worldReference: z
    .object({
      kind: z.enum(["generated_system", "runtime_world"]),
      id: z.string(),
      worldKey: z.string().nullable(),
      version: z.union([z.string(), z.number()]).nullable(),
      status: z.string(),
    })
    .nullable(),
  status: z.enum([
    "idle",
    "active",
    "awaiting_input",
    "awaiting_approval",
    "running",
    "blocked",
    "failed",
    "completed",
  ]),
  attention: z.array(
    z.object({
      kind: z.enum(["input_required", "approval_required", "blocked", "failed", "ongoing"]),
      sourceId: z.string(),
      severity: z.enum(["info", "warning", "error"]),
      reason: z.string(),
      actionIntent: z.string().optional(),
    }),
  ),
  availablePresentationActions: z.array(PresentationActionSchema),
  updatedAt: z.string().nullable(),
  presentationVersion: z.string(),
}) satisfies z.ZodType<ActiveWorkspaceProjection>;

export type LivingObjectReference = {
  kind: "runtime_task" | "runtime_run" | "generated_system" | "smart_bubble";
  id: string;
};

export type LivingObjectStatus =
  | "ACTIVE"
  | "WAITING"
  | "RUNNING"
  | "MONITORING"
  | "WAITING_USER"
  | "WAITING_APPROVAL"
  | "VERIFYING"
  | "BLOCKED"
  | "FAILED"
  | "COMPLETED";

export type LivingObjectAttentionLevel =
  | "NONE"
  | "INFO"
  | "ACTION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "BLOCKED"
  | "FAILED"
  | "COMPLETED";

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
  progress?: {
    completed: number;
    total: number;
    ratio: number;
  } | null;
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

const LivingObjectReferenceSchema = z
  .object({
    kind: z.enum(["runtime_task", "runtime_run", "generated_system", "smart_bubble"]),
    id: z.string().min(1).max(240),
  })
  .strict();

const LivingObjectActionSchema = z
  .object({
    intent: z.enum(["open", "resume", "review", "approve", "cancel", "pause", "archive"]),
    label: z.string().min(1).max(240),
    requiresApproval: z.boolean().optional(),
    reference: LivingObjectReferenceSchema,
  })
  .strict();

export const LivingObjectProjectionSchema: z.ZodType<LivingObjectProjection> = z
  .object({
    id: z.string().min(1).max(300),
    underlyingReference: LivingObjectReferenceSchema,
    relatedReferences: z.array(LivingObjectReferenceSchema).max(20),
    semanticType: z.enum(["process", "world", "bubble"]),
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(2_000),
    status: z.enum([
      "ACTIVE",
      "WAITING",
      "RUNNING",
      "MONITORING",
      "WAITING_USER",
      "WAITING_APPROVAL",
      "VERIFYING",
      "BLOCKED",
      "FAILED",
      "COMPLETED",
    ]),
    attention: z
      .object({
        level: z.enum([
          "NONE",
          "INFO",
          "ACTION_REQUIRED",
          "APPROVAL_REQUIRED",
          "BLOCKED",
          "FAILED",
          "COMPLETED",
        ]),
        reason: z.string().max(500).nullable(),
      })
      .strict(),
    progress: z
      .object({
        completed: z.number().int().min(0),
        total: z.number().int().positive(),
        ratio: z.number().min(0).max(1),
      })
      .strict()
      .nullable()
      .optional(),
    primaryAction: LivingObjectActionSchema.nullable(),
    secondaryActions: z.array(LivingObjectActionSchema).max(10),
    updatedAt: z.string(),
    createdAt: z.string(),
    presentationVersion: z.string().min(1).max(300),
    durability: z.enum(["ongoing", "persistent", "recently_completed"]),
    completion: z.enum(["not_complete", "completed", "failed"]),
  })
  .strict();

export const LivingObjectsProjectionSchema: z.ZodType<LivingObjectsProjection> = z
  .object({
    kind: z.literal("living_objects_projection"),
    version: z.literal(1),
    objects: z.array(LivingObjectProjectionSchema).max(100),
    limit: z.number().int().min(1).max(100),
    generatedAt: z.string(),
  })
  .strict();

export function validatePresentationDefinition(value: unknown): PresentationDefinition {
  return PresentationDefinitionSchema.parse(value) as PresentationDefinition;
}

export function safeParsePresentationDefinition(value: unknown) {
  return PresentationDefinitionSchema.safeParse(value);
}

/**
 * Converts a semantic structured result into the existing Presentation IR.
 * This is intentionally read-only and carries no executable action.
 */
/**
 * THE GENERIC INTENTS A SURFACE MAY OFFER.
 *
 * Exactly the set the trusted action path already accepts. A button is an
 * INTENT and nothing more, so an intent nothing can carry out is a button that
 * lies about what will happen.
 *
 *   BUTTON != EXECUTION AUTHORITY
 *
 * An unfamiliar intent renders NO action rather than a domain verb somebody
 * invented — there is no BUY, ORDER, APPLY or BOOK here and there never can be.
 */
const SURFACE_INTENTS: ReadonlySet<string> = new Set([
  "open",
  "open_reference",
  "select",
  "approve",
  "reject",
  "resume",
  "execute",
  "run",
  "retry",
  "cancel",
]);

/** An exact minor-unit amount, or nothing. Never a float, never inferred. */
function canonicalMoney(value: unknown): { amountMinor: string; currency: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const money = value as Record<string, unknown>;
  const amountMinor = typeof money.amountMinor === "string" ? money.amountMinor : undefined;
  const currency = typeof money.currency === "string" ? money.currency.trim() : "";
  // An amount that is not an exact integer of minor units is not money this
  // runtime stores, and displaying it would be inventing a scale.
  if (!amountMinor || !/^-?\d+$/.test(amountMinor) || !currency) return undefined;
  return { amountMinor, currency };
}

/**
 * KEYS THE CARD ALREADY RENDERS THROUGH A PATH OF ITS OWN.
 *
 * A fact shown twice reads as two facts. The amount has `money`, the
 * description has `description`, the kind of thing IS the title, availability
 * has the badge path, and what may be done has `actions`. So none of them is
 * repeated as a property row.
 *
 *   MONEY_DUPLICATED_AS_ATTRIBUTE = 0 · AVAILABILITY_DUPLICATED_AS_ATTRIBUTE = 0
 *
 * `engagementAction` is here for a second reason: it names something to DO, and
 * an attribute has never been permission to do anything.
 *
 *   ATTRIBUTE != EXECUTION AUTHORITY
 *
 * Every word in this set is the economic fabric's OWN vocabulary — the keys
 * `PUBLIC_PROJECTION_KEYS` authorizes and the ones `safeCandidate` renames.
 * Not one of them is a domain noun, and nothing here reads what the thing is.
 */
const DEDICATED_SURFACE_KEYS: ReadonlySet<string> = new Set([
  "semantictype",
  "title",
  "name",
  "label",
  "summary",
  "description",
  "availability",
  "money",
  "price",
  "priceminor",
  "amountminor",
  "observedmoney",
  "currency",
  "actions",
  "actionable",
  "engagementaction",
]);

/**
 * MACHINERY, WHICH IS NOT A PROPERTY OF ANYTHING.
 *
 * «trust: canonical_internal» and «position: 1» are how the runtime describes a
 * ROW. Nobody asked to see them, and a card is not developer output. The same
 * is true of ids, scopes, policies, raw payloads and ranking debris.
 *
 * ── AND WHY THE TEST IS IN TWO HALVES ──────────────────────────────────────
 *
 * The first draft matched these as SEGMENTS of any key, and that filter hid
 * `internalVolume` — a chamber's declared internal volume, which is exactly the
 * kind of owner-published fact this phase exists to show. A guard that cannot
 * tell the fact from the machinery deletes the fact.
 *
 * So: a bare word that is machinery ONLY when it is the whole key goes in the
 * first set, and a word that is machinery in ANY compound goes in the second.
 * `maxPayload` is a declared capacity; `rawPayload` is a dump — which is why
 * «payload» is whole-key only, and «token» is not.
 */
const MACHINERY_WHOLE_KEY: ReadonlySet<string> = new Set([
  "id", "ids", "ref", "refs", "uuid", "guid",
  "key", "keys", "token", "tokens", "secret", "secrets",
  "credential", "credentials", "password", "passphrase", "hash", "signature", "hmac",
  "payload", "raw", "debug", "trace", "internal", "private",
  "rank", "ranking", "score",
  "trust", "provenance", "position", "cursor",
  "policy", "scope", "principal", "callback", "webhook",
]);

/**
 * A name whose LAST word says «this is an identifier, a credential, a ranking,
 * or how the runtime describes a row». `canonicalRef`, `scopeId`, `apiKey`,
 * `clientSecret` and `rankScore` all end in one; `keyLength`, `scoreRange`,
 * `internalVolume` and `traceWidth` do not, and they are facts.
 */
const MACHINERY_FINAL_SEGMENT: ReadonlySet<string> = new Set([
  "id", "ids", "uuid", "guid", "ref", "refs",
  "key", "keys", "token", "tokens", "secret", "secrets",
  "credential", "credentials", "password", "passphrase", "hash", "signature", "hmac",
  "score", "rank", "cursor", "policy", "principal", "scope",
  "trust", "provenance", "position",
]);

/**
 * A name whose FIRST word has no life as a qualifier of a published fact.
 * `debugInfo`, `callbackUrl` and `webhookTarget` are plumbing under any tail.
 *
 * Deliberately NOT here: «raw». `rawMaterial` is a real declared fact, and
 * `rawPayload` is the only thing this lets through — an owner's own word, in
 * their own authorized publication, which is theirs to publish.
 */
const MACHINERY_LEADING_SEGMENT: ReadonlySet<string> = new Set([
  "debug", "callback", "webhook",
]);

/** `ratedDepth` → ["rated","depth"]; `scope_id` → ["scope","id"]. */
function keySegments(key: string): readonly string[] {
  return key
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function isMachineryKey(key: string): boolean {
  if (MACHINERY_WHOLE_KEY.has(key.trim().toLowerCase())) return true;
  const segments = keySegments(key);
  if (segments.length === 0) return false;
  if (MACHINERY_FINAL_SEGMENT.has(segments[segments.length - 1]!)) return true;
  return segments.length > 1 && MACHINERY_LEADING_SEGMENT.has(segments[0]!);
}

type SurfaceScalar = string | number | boolean;

/**
 * THE VALUE FORMS CANONICAL ATTRIBUTES ALREADY USE, AND NO OTHERS.
 *
 * A bare number stays a bare number: «300» does not become 300 kg and «12»
 * does not become $12. Nothing here infers a scale, a currency or a unit.
 *
 *   UNKNOWN != EMPTY != FALSE != ZERO
 *
 * A shape this does not recognise renders NOTHING rather than `[object
 * Object]`, which is the honest outcome — an unreadable value is not a value.
 */
function surfaceScalar(value: unknown): SurfaceScalar | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : undefined;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}

function surfaceValue(value: unknown): SurfaceScalar | readonly SurfaceScalar[] | undefined {
  if (Array.isArray(value)) {
    const members = value
      .map(surfaceScalar)
      .filter((member): member is SurfaceScalar => member !== undefined);
    return members.length > 0 ? members : undefined;
  }
  return surfaceScalar(value);
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function plainObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * A MEASUREMENT, THE WAY THE FABRIC ALREADY WRITES ONE.
 *
 * `evaluateConstraint` reads a unit from the sibling `<field>Unit`, so that is
 * the convention a declared measurement already has — this reuses it rather
 * than inventing a second one. The unit attaches ONLY when its owner declared
 * it, which is why a bare number cannot acquire one.
 *
 *   TWO_MEASUREMENT_CONVENTIONS = 0
 */
const UNIT_SUFFIX = "Unit";

function pairedUnit(source: Record<string, unknown>, key: string): string | undefined {
  const unit = source[`${key}${UNIT_SUFFIX}`];
  return typeof unit === "string" && unit.trim() ? unit.trim() : undefined;
}

/**
 * How many property rows one card may carry. The renderer shows twelve; this
 * bounds what travels, so a bag nobody capped cannot become the payload.
 */
const MAX_SURFACE_ATTRIBUTES = 24;

/**
 * THE AUTHORIZED PUBLIC PROJECTION, AS PROPERTY ROWS A CARD CAN READ.
 *
 * ─── WHY THIS IS NOT A MAPPER ───────────────────────────────────────────────
 *
 *   NEW DOMAIN != NEW COMPONENT · NEW ATTRIBUTE != NEW UI COMPONENT
 *
 * Nothing here knows what anything IS. There is no semantic type, no list of
 * expected properties, and no branch on the thing's kind. A depth, an
 * attenuation, a throughput and a language travel the identical path, and an
 * attribute nobody has ever seen before needs no code at all.
 *
 * ─── AND THE ONE STRUCTURAL THING IT DOES ───────────────────────────────────
 *
 * The declared terms of an offering sit NESTED, under `publicTerms`. The card's
 * renderer reads scalars, so before this they rendered as nothing — present,
 * authorized, and invisible. So one level of nesting is flattened, generically:
 * any container, not a named one. A child keeps its own name when that name is
 * free and takes `parent.child` when it is not, so flattening can never make
 * two different facts look like one.
 */
export function surfaceAttributes(source: unknown): Record<string, SurfaceScalar | readonly SurfaceScalar[]> {
  const bag = plainObject(source);
  if (!bag) return {};
  const out: Record<string, SurfaceScalar | readonly SurfaceScalar[]> = {};

  const admissible = (key: string): boolean =>
    !DEDICATED_SURFACE_KEYS.has(key.trim().toLowerCase()) &&
    !isMachineryKey(key) &&
    // A unit belongs TO its measurement and is never a row of its own.
    !(key.endsWith(UNIT_SUFFIX) && key.length > UNIT_SUFFIX.length &&
      Object.prototype.hasOwnProperty.call(bag, key.slice(0, -UNIT_SUFFIX.length)));

  const put = (name: string, container: Record<string, unknown>, key: string, value: unknown) => {
    if (Object.keys(out).length >= MAX_SURFACE_ATTRIBUTES) return;
    const rendered = surfaceValue(value);
    if (rendered === undefined) return;
    const unit = Array.isArray(rendered) ? undefined : pairedUnit(container, key);
    out[name] = unit === undefined ? rendered : `${rendered} ${unit}`;
  };

  // Top level first, so a declared fact keeps its own name and a nested one
  // qualifies — never the other way round.
  for (const [key, value] of Object.entries(bag)) {
    if (!admissible(key)) continue;
    put(key, bag, key, value);
  }
  for (const [parent, value] of Object.entries(bag)) {
    if (!admissible(parent)) continue;
    const nested = plainObject(value);
    if (!nested) continue;
    const childAdmissible = (key: string): boolean =>
      !DEDICATED_SURFACE_KEYS.has(key.trim().toLowerCase()) &&
      !isMachineryKey(key) &&
      !(key.endsWith(UNIT_SUFFIX) && key.length > UNIT_SUFFIX.length &&
        Object.prototype.hasOwnProperty.call(nested, key.slice(0, -UNIT_SUFFIX.length)));
    for (const [child, childValue] of Object.entries(nested)) {
      if (!childAdmissible(child)) continue;
      const name = Object.prototype.hasOwnProperty.call(out, child) ? `${parent}.${child}` : child;
      put(name, nested, child, childValue);
    }
  }
  return out;
}

/**
 * A CANONICAL CANDIDATE, IN THE VOCABULARY THE CARD READS.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * Every piece of this already existed. Discovery persists a result set, the
 * orchestrator narrows each row to what may be shown, `decidePresentation`
 * already chooses ENTITY_GRID at six results or more, and the commerce turn
 * already writes the result into `metadata.presentation`. The candidates then
 * travelled through VERBATIM — so the canonical amount arrived as
 * `observedMoney` and the canonical intents as `actionable`, while the card
 * reads `money` and `actions`. Facts that were present, correct and
 * authorized rendered as nothing at all.
 *
 *   A NAME THE RENDERER DOES NOT READ IS A FACT NOBODY SEES
 *
 * ─── AND WHAT THIS MAY NOT DO ───────────────────────────────────────────────
 *
 * It renames and filters. It never adds.
 *
 *   MODEL != PRICE AUTHORITY · MODEL != AVAILABILITY AUTHORITY
 *   MODEL != IMAGE AUTHORITY · MODEL != ACTION AUTHORITY
 *
 * NO IMAGE IS PROJECTED, EVER. A canonical candidate carries no media field —
 * `NormalizedCandidate` has none — so any picture on such a card could only
 * have come from a sentence. `safeMediaUrl` proves a URL is safe to FETCH; it
 * proves nothing about whether that picture is of this thing.
 *
 *   SAFE_MEDIA_URL != TRUE IMAGE ASSOCIATION
 *
 * A fact that is absent stays absent: UNKNOWN != EMPTY != FALSE != ZERO.
 */
export function projectCandidateForSurface(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  // Identity for selection comes from canonical references, never from a
  // title, a position in an array, or whatever was newest.
  const reference =
    text(candidate.canonicalRef) ?? text(candidate.externalRef) ?? text(candidate.id);

  const money = canonicalMoney(candidate.observedMoney);
  const availability = text(candidate.availability);
  const attributes = surfaceAttributes(candidate.attributes);
  const actions = (Array.isArray(candidate.actionable) ? candidate.actionable : [])
    .filter((intent): intent is string => typeof intent === "string")
    .map((intent) => intent.trim().toLowerCase())
    .filter((intent) => SURFACE_INTENTS.has(intent))
    .map((intent) => ({ intent, label: intent }));

  return {
    ...(reference ? { ref: reference, id: reference } : {}),
    ...(text(candidate.title) ? { title: candidate.title } : {}),
    ...(text(candidate.summary) ? { description: candidate.summary } : {}),
    ...(money ? { money } : {}),
    // Availability is a canonical observation when it is there, and nothing at
    // all when it is not. An absent availability is not "unavailable".
    ...(availability ? { badges: [availability] } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(text(candidate.source) ? { source: candidate.source } : {}),
    // Narrowed, never passed through: see `surfaceAttributes`. An empty result
    // writes no key at all, so a thing that declared nothing renders no empty
    // property block — ABSENT_ATTRIBUTE_INVENTED = 0.
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    // Carried so nothing downstream has to go back to the database to know how
    // far this row may be trusted.
    ...(candidate.trust !== undefined ? { trust: candidate.trust } : {}),
    ...(candidate.provenance !== undefined ? { provenance: candidate.provenance } : {}),
    ...(typeof candidate.position === "number" ? { position: candidate.position } : {}),
  };
}

/**
 * A DRAFT, AS THE PERSON MUST SEE IT BEFORE THEY AGREE TO ANYTHING.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * Pressing a card creates a canonical draft order and binds it into the
 * conversation — and the workspace went on showing the search grid, because
 * `currentPresentation` is read out of the LATEST MESSAGE's metadata and the
 * trusted dispatch writes no message. So the terms a person must review before
 * approving were canonical, pinned, and nowhere on screen.
 *
 * ─── WHAT IT MAY READ ───────────────────────────────────────────────────────
 *
 *   LATEST_OFFERING_TERMS_REPLACE_DRAFT_TERMS = 0
 *
 * ONLY the draft's own pinned terms. The offering is not re-read here, so a
 * holder who changed their terms after the selection cannot have the new ones
 * shown as though they were what this person chose. (The existing propose path
 * compares fingerprints and refuses a stale draft; that stays where it is.)
 *
 * The label is the candidate's title AS IT WAS PRESENTED — a frozen discovery
 * row, never a fresh read — so the thing is named the way the person saw it.
 *
 * ─── AND WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 *   SHOWING TERMS != ACCEPTING TERMS · DRAFT_SURFACE != AUTHORITY
 *
 * It carries exactly ONE action, and only while the draft is unsent: `propose`,
 * meaning «send the draft I am looking at». It does not mean accepting for the
 * other party, and nothing downstream treats it that way.
 *
 *   SELECTION != PROPOSAL · PROPOSAL != AGREEMENT != TRANSACTION != PAYMENT
 *
 * `propose` is deliberately NOT in `SURFACE_INTENTS`, the filter a candidate's
 * declared intents pass through — so a search result can never declare it, and
 * sending is reachable only from a draft a person has in front of them.
 *
 *   BUTTON != EXECUTION AUTHORITY
 *
 * Once the draft carries a proposal the control is gone: the same surface,
 * reading the same canonical state, showing a draft that is now waiting on
 * somebody else. There is no second «sent» surface to keep in step.
 */
export function projectDraftOrderForReview(input: {
  order: {
    id: string;
    status: string;
    terms: Record<string, unknown>;
    termsVersion: number;
    termsFingerprint: string;
    partyConfiguration?: Record<string, unknown> | null;
    configurationFingerprint?: string | null;
    offeringFingerprint?: string | null;
    resultSetId?: string | null;
    candidateId?: string | null;
    /** Present once the draft has been offered. */
    proposalId?: string | null;
  };
  /** `<termsVersion>:<termsFingerprint>:<configurationFingerprint>`. */
  version: string;
  /** The row the person actually saw, frozen at discovery. */
  presentedAs?: { title?: string | null; summary?: string | null } | null;
}): PresentationDefinition {
  const terms = input.order.terms ?? {};
  const configuration = input.order.partyConfiguration ?? {};
  // WHAT THE SELECTION ITSELF PINNED, as opposed to what the holder published.
  // `selectOfferingAsDraftOrder` writes these two into the terms so the draft
  // remembers which offering at which version it came from. They are this
  // runtime's own bookkeeping, they are carried in `provenance` below, and
  // «offeringVersion: 2» is not a property of the thing being bought.
  //
  // Named here rather than guessed at by shape, because the function that
  // WRITES them is the one that knows them.
  const PINNED_BY_SELECTION = ["offeringRef", "offeringVersion"] as const;
  // A party's own stated values and the published terms are two different
  // movements, and they are read together here only to be SHOWN together.
  //
  //   PARTY_CONFIGURATION != COUNTERPARTY_CHANGED_TERMS
  const published = Object.fromEntries(
    Object.entries({ ...terms, ...configuration }).filter(
      ([key]) => !(PINNED_BY_SELECTION as readonly string[]).includes(key),
    ),
  );
  const attributes = surfaceAttributes(published);
  const money = canonicalMoney((terms as Record<string, unknown>).money);
  const title = typeof input.presentedAs?.title === "string" && input.presentedAs.title.trim()
    ? input.presentedAs.title.trim()
    : input.order.id;

  return validatePresentationDefinition({
    primitive: "DETAIL",
    version: 1,
    data: {
      entity: {
        ref: input.order.id,
        id: input.order.id,
        title,
        ...(typeof input.presentedAs?.summary === "string" && input.presentedAs.summary.trim()
          ? { description: input.presentedAs.summary.trim() }
          : {}),
        status: input.order.status,
        ...(input.order.proposalId
          ? { badges: ["بانتظار ردّ الطرف الآخر"] }
          : { actions: [{ intent: "propose", label: "إرسال العرض" }] }),
        ...(money ? { money } : {}),
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        // Carried, never drawn as a property OF the thing — the card's own
        // reserved-key rule already keeps machinery off the attribute rows.
        provenance: {
          // The two the press needs, in the shape every surface uses: a
          // canonical kind and the version of that exact thing.
          canonicalKind: "commercial_order",
          version: input.version,
          offeringRef: (terms as Record<string, unknown>).offeringRef ?? null,
          offeringVersion: (terms as Record<string, unknown>).offeringVersion ?? null,
          termsVersion: input.order.termsVersion,
          termsFingerprint: input.order.termsFingerprint,
          offeringFingerprint: input.order.offeringFingerprint ?? null,
          resultSetId: input.order.resultSetId ?? null,
          candidateId: input.order.candidateId ?? null,
        },
      },
      // What the person is being asked to do, stated rather than implied.
      // What the person is being asked to do, stated rather than implied —
      // and no longer asked once the draft is somebody else's turn.
      reviewRequired: !input.order.proposalId,
      orderStatus: input.order.status,
      proposalSent: Boolean(input.order.proposalId),
    },
  });
}

/**
 * SOMETHING SOMEBODY IS ASKING OF YOU.
 *
 * ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * A proposal could be sent and the person it was sent TO saw nothing at all.
 * The workspace derives its surface from the latest message or from this
 * conversation's own draft, and an inbound proposal is neither: it is not
 * addressed to a thread, it is addressed to a PERSON.
 *
 *   A REQUEST ADDRESSED TO ME IS NOT A FACT ABOUT MY THREAD
 *
 * So JASIM could broker half a deal — one side could ask, and the other side
 * was blind.
 *
 * ─── WHAT IT SHOWS ──────────────────────────────────────────────────────────
 *
 * The TERM SHEET AS PROPOSED, read from the proposal's own row. Not the
 * offering as it stands now, and not what the proposer's draft says — the
 * exact text the other party committed to the wire.
 *
 *   SHOWING TERMS != ACCEPTING TERMS
 *
 * ─── AND THE ONE CONTROL ────────────────────────────────────────────────────
 *
 * `approve`, meaning «I agree to these terms, myself, now». That is the whole
 * weight of it: accepting is what turns a proposal into an agreement, so the
 * runtime reserves it for places a person is provably present and refuses it
 * from a sentence a model classified.
 *
 *   MODEL != AUTHORITY · CLASSIFICATION != ACCEPTANCE
 *
 * There is no `reject` here, and that is not an oversight: declining is a
 * different canonical act with its own path, and a control whose press has
 * nowhere to go is the defect this codebase has closed twice already.
 */
export function projectInboundProposalForReview(input: {
  proposal: {
    id: string;
    version: number;
    terms: Record<string, unknown>;
    proposerOwnerId: string;
    expiresAt?: Date | string | null;
  };
  /** Who is looking, so «who pays» is stated rather than left to be inferred. */
  viewerOwnerId?: string;
  /** How the thing was named where it came from, frozen. */
  presentedAs?: { title?: string | null; summary?: string | null } | null;
}): PresentationDefinition {
  // ── A TERM SHEET IS A LIST OF TERMS, NOT A BAG OF FIELDS ────────────────
  //
  // Each row says what is owed, by whom, to whom — and reading it as a flat
  // record (my first attempt) silently produced an empty surface, which is the
  // worst possible outcome for a screen somebody agrees from.
  const carrier = input.proposal.terms?.terms ?? input.proposal.terms;
  const sheet = Array.isArray(carrier) ? carrier.map(objectOrNull) : [];
  const attributes: Record<string, string | number> = {};
  let money: { amountMinor: string; currency: string } | undefined;
  let owedByViewer: boolean | undefined;
  for (const term of sheet) {
    if (!term) continue;
    const key = typeof term.key === "string" ? term.key : null;
    if (!key) continue;
    const settlement = objectOrNull(term.settlement);
    if (settlement) {
      // The amount, in the exact minor units the runtime stores.
      money = canonicalMoney(settlement) ?? money;
      // WHO PAYS WHOM, which is the one fact a person must not have to infer.
      //
      //   WHO_ASKED != WHO_PAYS
      if (input.viewerOwnerId) owedByViewer = term.owedBy === input.viewerOwnerId;
      continue;
    }
    if (typeof term.value === "string" || typeof term.value === "number") {
      const unit = typeof term.unit === "string" && term.unit.trim() ? ` ${term.unit.trim()}` : "";
      attributes[key] = `${term.value}${unit}`;
    }
  }

  return validatePresentationDefinition({
    primitive: "DETAIL",
    version: 1,
    data: {
      entity: {
        ref: input.proposal.id,
        id: input.proposal.id,
        title: typeof input.presentedAs?.title === "string" && input.presentedAs.title.trim()
          ? input.presentedAs.title.trim()
          : input.proposal.id,
        ...(typeof input.presentedAs?.summary === "string" && input.presentedAs.summary.trim()
          ? { description: input.presentedAs.summary.trim() }
          : {}),
        status: "PROPOSED",
        badges: [
          "بانتظار ردّك",
          ...(owedByViewer === undefined ? [] : [owedByViewer ? "عليك الدفع" : "الدفع لك"]),
        ],
        ...(money ? { money } : {}),
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        actions: [{ intent: "approve", label: "قبول العرض" }],
        provenance: {
          canonicalKind: "economic_proposal",
          version: input.proposal.version,
          // WHO is asking. Carried, never drawn as a property of the terms.
          proposerOwnerId: input.proposal.proposerOwnerId,
          expiresAt: input.proposal.expiresAt
            ? new Date(input.proposal.expiresAt).toISOString()
            : null,
        },
      },
      // Said plainly: this is somebody else's ask, and nothing has happened yet.
      replyRequired: true,
      proposalVersion: input.proposal.version,
    },
  });
}

export function projectStructuredResult(input: {
  label: string;
  summary: string;
  data: Record<string, unknown>;
}): PresentationDefinition {
  const candidates = Array.isArray(input.data.candidates) ? input.data.candidates : undefined;
  const explicitSemanticOutput =
    input.data.semanticOutput === "comparison" || input.data.semanticOutput === "error"
      ? input.data.semanticOutput
      : undefined;
  return decidePresentation({
    interactionNeed: explicitSemanticOutput === "comparison"
      ? "compare"
      : candidates
        ? "show_result"
        : "inform",
    semanticOutput: explicitSemanticOutput ?? (candidates ? "candidates" : "structured"),
    resultCount: candidates?.length,
    resultSetPresent: candidates !== undefined,
    data: {
      summary: input.summary,
      ...input.data,
    },
  });
}

/**
 * Presentation Decision Layer.
 *
 * This is the single generic semantic selector. It does not render, execute,
 * persist, or inspect domain names. The precedence is explicit so a richer
 * surface cannot hide a blocker or an approval requirement.
 */
export function decidePresentation(
  input: SemanticPresentationInput,
): PresentationDefinition {
  const parsedInput = SemanticPresentationInputSchema.parse(input) as SemanticPresentationInput;
  const candidateData = Array.isArray(parsedInput.data.candidates)
    ? parsedInput.data.candidates
    : parsedInput.candidates;
  const resultCount =
    parsedInput.resultCount ??
    (candidateData ? candidateData.length : 0);
  const hasResultSet =
    parsedInput.resultSetPresent === true ||
    candidateData !== undefined;
  const hasLocation =
    parsedInput.observation?.coordinates !== undefined &&
    Number.isFinite(parsedInput.observation.coordinates.lat) &&
    Number.isFinite(parsedInput.observation.coordinates.lng);
  const highRisk =
    parsedInput.actionRisk === "high" ||
    parsedInput.actionRisk === "critical";
  const approvalRequired =
    parsedInput.interactionNeed === "authorize" ||
    parsedInput.transactionState === "awaiting_approval" ||
    parsedInput.actionability === "consequential" ||
    highRisk ||
    parsedInput.approvalSummary !== undefined;
  const inputRequired =
    parsedInput.interactionNeed === "collect_input" ||
    parsedInput.requiresStructuredInput === true ||
    parsedInput.actionability === "input_required";
  const ongoing =
    parsedInput.ongoing === true ||
    parsedInput.transactionState === "ongoing" ||
    parsedInput.interactionNeed === "track" ||
    parsedInput.interactionNeed === "show_state" ||
    parsedInput.interactionNeed === "show_history";

  // 1. Safety and truthfulness take precedence over richer presentation.
  if (
    parsedInput.semanticOutput === "error" ||
    parsedInput.transactionState === "failed"
  ) {
    return validatePresentationDefinition({
      primitive: "ERROR_STATE",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (approvalRequired) {
    return validatePresentationDefinition({
      primitive:
        parsedInput.hasFinancialEffect === true ||
        parsedInput.transactionState === "checkout_ready"
          ? "CHECKOUT"
          : "APPROVAL",
      version: 1,
      data: {
        action: parsedInput.approvalSummary?.action ?? parsedInput.data.action ?? "unspecified",
        stateChanges: parsedInput.approvalSummary?.stateChanges ?? [],
        publicData: parsedInput.approvalSummary?.publicData ?? [],
        externalEffect: parsedInput.approvalSummary?.externalEffect,
        ...parsedInput.data,
      },
      actions: [
        { intent: "approve", label: "أوافق", requiresApproval: true },
        { intent: "reject", label: "أرفض" },
      ],
    });
  }
  if (inputRequired) {
    // Two different things ask the user for something, and the contract
    // already distinguishes them: `missingFields` is data the runtime does not
    // have, while `candidates` is a bounded set of alternatives it already
    // holds and has already authorized. Asking "which of these?" with a text
    // box is a worse question than asking it with the list.
    //
    // Fields win when both are present: a choice cannot substitute for values
    // that still have to be supplied.
    const hasMissingFields = (parsedInput.missingFields ?? []).length > 0;
    if (!hasMissingFields && candidateData !== undefined && candidateData.length > 0) {
      return validatePresentationDefinition({
        primitive: "CHOICE",
        version: 1,
        data: { candidates: candidateData, resultCount: candidateData.length, ...parsedInput.data },
        actions: [{ intent: "select", label: "اختيار" }],
      });
    }
    return validatePresentationDefinition({
      primitive: "FORM",
      version: 1,
      data: parsedInput.data,
      fields: (parsedInput.missingFields ?? []).map((field) => ({
        ...field,
        requiredNow: field.requiredNow ?? field.unknown !== true,
      })),
    });
  }
  if (ongoing) {
    if (parsedInput.interactionNeed === "show_history") {
      return validatePresentationDefinition({
        primitive: "TIMELINE",
        version: 1,
        data: { events: parsedInput.events ?? [], ...parsedInput.data },
      });
    }
    if (parsedInput.interactionNeed === "track") {
      const children: PresentationDefinition[] = [
        {
          primitive: "TRACKER",
          version: 1,
          data: {
            status: parsedInput.observation?.status ?? "unavailable",
            locationDescription: parsedInput.observation?.locationDescription,
            observedAt: parsedInput.observation?.observedAt,
            source: parsedInput.observation?.source,
          },
        },
      ];
      if (hasLocation) {
        children.push({
          primitive: "MAP",
          version: 1,
          data: {
            markers: [
              {
                entityRef: String(parsedInput.data.entityRef ?? "subject"),
                coordinates: parsedInput.observation?.coordinates,
              },
            ],
          },
        });
      }
      return validatePresentationDefinition({
        primitive: "TRACKER",
        version: 1,
        data: parsedInput.data,
        children,
      });
    }
    return validatePresentationDefinition({
      primitive: "STATUS",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (
    parsedInput.interactionNeed === "compare" ||
    parsedInput.semanticOutput === "comparison"
  ) {
    return validatePresentationDefinition({
      primitive: "COMPARISON",
      version: 1,
      data: { candidates: candidateData ?? [], ...parsedInput.data },
    });
  }
  if (hasResultSet || parsedInput.semanticOutput === "candidates") {
    // The ONE place a candidate is renamed into what a card reads. Renaming
    // and filtering only — see `projectCandidateForSurface`.
    const surfaceCandidates = (candidateData ?? []).map((candidate) =>
      projectCandidateForSurface(candidate as Record<string, unknown>),
    );
    return validatePresentationDefinition({
      primitive: resultCount >= 6 ? "ENTITY_GRID" : "SEARCH_RESULTS",
      version: 1,
      data: {
        ...parsedInput.data,
        // After the spread, so a `candidates` key travelling in `data` cannot
        // put the raw shape back and undo the projection.
        candidates: surfaceCandidates,
        resultCount,
      },
    });
  }
  if (
    parsedInput.semanticOutput === "document" ||
    parsedInput.documentSummary === true
  ) {
    return validatePresentationDefinition({
      primitive: "DOCUMENT",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (parsedInput.semanticOutput === "world" || parsedInput.worldReference === true) {
    return validatePresentationDefinition({
      primitive: "WORLD_SUMMARY",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (parsedInput.interactionNeed === "external_transition") {
    return validatePresentationDefinition({
      primitive: "EXTERNAL_ACTION",
      version: 1,
      data: {
        provider: parsedInput.externalAction?.provider,
        purpose: parsedInput.externalAction?.purpose,
        sessionId: parsedInput.externalAction?.sessionId,
      },
      actions: parsedInput.externalAction
        ? [{ intent: "open_external", label: "متابعة", external: true }]
        : [],
    });
  }
  if (parsedInput.interactionNeed === "preview_artifact") {
    return validatePresentationDefinition({
      primitive: "ARTIFACT_PREVIEW",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (parsedInput.interactionNeed === "operate_persistent") {
    return validatePresentationDefinition({
      primitive: "SMART_BUBBLE",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (parsedInput.interactionNeed === "show_schedule") {
    return validatePresentationDefinition({
      primitive: "CALENDAR",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (parsedInput.semanticOutput === "empty") {
    return validatePresentationDefinition({
      primitive: "EMPTY_STATE",
      version: 1,
      data: parsedInput.data,
    });
  }
  if (parsedInput.semanticOutput === "structured") {
    return validatePresentationDefinition({
      primitive: "DETAIL",
      version: 1,
      data: parsedInput.data,
    });
  }
  return validatePresentationDefinition({
    primitive: "TEXT",
    version: 1,
    data: parsedInput.data,
  });
}

/**
 * Backwards-compatible name for existing callers. All callers now use the
 * unified decision layer rather than a second presentation router.
 */
export function routePresentation(
  input: SemanticPresentationInput,
): PresentationDefinition {
  return decidePresentation(input);
}

/** Generic match explanation projection (no opaque percentages). */
export function projectMatchExplanation(match: {
  constraintResults: Array<{
    field: string;
    state: "PASS" | "SOFT_MATCH" | "UNKNOWN" | "FAIL";
    detail?: string;
  }>;
  composite?: Array<{ expressionId: string; contribution: string }>;
}): PresentationDefinition {
  return validatePresentationDefinition({
    primitive: "COMPARISON",
    version: 1,
    data: {
      constraints: match.constraintResults,
      composite: match.composite ?? [],
    },
  });
}
