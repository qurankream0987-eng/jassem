/**
 * JASIM Runtime — durable execution tables (merged proven runtime layer).
 *
 * These tables implement the proven-runtime concepts that had no canonical
 * equivalent in the original schema:
 *   - runs                  (durable execution lifecycle)
 *   - dag_nodes/deps        (durable DAG: claims, leases, fencing, retries)
 *   - execution_proposals   (model-proposed, server-validated executions)
 *   - proposal_approvals    (fingerprint-bound execution authority)
 *   - action_receipts       (idempotent action execution records)
 *
 * Concepts that DID have canonical equivalents (conversations, messages,
 * tasks, bubbles, worlds=generatedSystems, events) live in db/schema.ts and
 * were extended there — no duplicate concept tables exist.
 *
 * ID conventions:
 *  - Runtime-owned entities use uuid primary keys.
 *  - References to canonical int-id tables (conversations, messages, tasks,
 *    bubbles, generated_systems) are stored as varchar strings of the numeric
 *    id — the canonical schema uses conventional logical references without
 *    enforced FK constraints, and these columns follow that style.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ============================================================================
// JSON payload shapes stored in tasks.world / generated_systems.schema
// ============================================================================

export type RuntimeActionRecord = {
  id: string;
  label: string;
  kind: "provide_input" | "approve" | "execute";
  requiresApproval: boolean;
  status: "ready" | "pending" | "completed" | "blocked";
};

export type RuntimeWorldDefinition = {
  id: string;
  schemaVersion: 1;
  version: number;
  name: string;
  description: string;
  continuity: "ephemeral" | "evolving";
  status: "active" | "archived";
  actors: Array<{ id: string; role: string; description?: string }>;
  entities: Array<{
    id: string;
    name: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;
  relationships: Array<{
    id: string;
    fromEntityId: string;
    toEntityId: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;
  collections: Array<{
    id: string;
    name: string;
    entityType: string;
    query?: Record<string, unknown>;
  }>;
  capabilities: string[];
  policies: Array<{ id: string; text: string; enabled: boolean }>;
  permissions: Array<{
    id: string;
    role: string;
    action: string;
    effect: "allow" | "deny";
  }>;
  workflows: Array<{
    id: string;
    kind: string;
    status: string;
    stepIds: string[];
  }>;
  actions: Array<{
    id: string;
    label: string;
    status: string;
    requiresApproval: boolean;
  }>;
  views: Array<{
    id: string;
    type: string;
    title: string;
    config: Record<string, unknown>;
  }>;
  state: Record<string, unknown>;
  transactions: Array<Record<string, unknown>>;
  memory: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
};

export type GeneratedRuntimeWorldRecord = {
  id: string;
  version: number;
  taskDNA: {
    objective: string;
    summary: string;
    intentType: string;
    actors: string[];
    objects: Array<{ name: string; type: string; attributes: Record<string, unknown> }>;
    actions: string[];
    constraints: Record<string, unknown>;
    requiredCapabilities: string[];
    confidence: number;
    interpretationSource: "model-gateway";
    model: { provider: string; model: string };
    unresolved: string[];
  };
  plan: {
    status: string;
    summary: string;
    reasoning?: string;
    steps: Array<{
      id: string;
      name: string;
      description: string;
      capability: string;
      inputs: Record<string, unknown>;
      dependencies: string[];
      risk: "none" | "low" | "medium" | "high" | "critical";
      requiresApproval: boolean;
    }>;
  };
  world: {
    name: string;
    description: string;
    continuity: "ephemeral" | "evolving";
    participants: Array<{ role: string; description: string }>;
    entities: Array<{
      id: string;
      name: string;
      type: string;
      attributes: Record<string, unknown>;
    }>;
    capabilities: string[];
    policies: string[];
  };
  executionContext: Record<string, unknown>[];
};

export type LegacyRuntimeWorldRecord = {
  id: string;
  version: number;
  taskDNA: {
    objective: string;
    interpretationSource: "deterministic-baseline";
    unresolved: string[];
  };
  plan: {
    status: string;
    steps: string[];
  };
  executionContext: Record<string, unknown>[];
};

export type RuntimeWorldRecord =
  | GeneratedRuntimeWorldRecord
  | LegacyRuntimeWorldRecord;

// ============================================================================
// RUNS — durable execution lifecycle
// ============================================================================

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: varchar("ownerId", { length: 255 }).notNull(),
    conversationId: varchar("conversationId", { length: 64 }),
    bubbleId: varchar("bubbleId", { length: 64 }),
    taskId: varchar("taskId", { length: 64 }),
    goal: text("goal").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    executionGraph: jsonb("executionGraph")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    currentState: jsonb("currentState")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    outputs: jsonb("outputs").$type<Record<string, unknown>>().notNull().default({}),
    requiredCapabilities: text("requiredCapabilities").array().notNull().default([]),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull(),
    resumeAt: timestamp("resumeAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("runs_owner_idx").on(table.ownerId),
    index("runs_conversation_idx").on(table.conversationId),
    index("runs_bubble_idx").on(table.bubbleId),
    uniqueIndex("runs_owner_idempotency_idx").on(table.ownerId, table.idempotencyKey),
  ],
);

// ============================================================================
// DAG — durable nodes, SUCCESS_REQUIRED dependencies, claims/leases/fencing
// ============================================================================

export const dagNodes = pgTable(
  "dag_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("runId")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    ownerId: varchar("ownerId", { length: 255 }).notNull(),
    nodeKey: varchar("nodeKey", { length: 160 }).notNull(),
    proposalId: uuid("proposalId").references(() => executionProposals.id, {
      onDelete: "set null",
    }),
    capabilityId: varchar("capabilityId", { length: 160 }),
    proposalFingerprint: varchar("proposalFingerprint", { length: 64 }),
    nodeType: varchar("nodeType", { length: 40 }).notNull().default("capability"),
    status: varchar("status", { length: 40 }).notNull().default("PENDING"),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown> | null>(),
    attemptCount: integer("attemptCount").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true }),
    claimedBy: varchar("claimedBy", { length: 160 }),
    leaseToken: varchar("leaseToken", { length: 160 }),
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    fenceVersion: integer("fenceVersion").notNull().default(0),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    failedAt: timestamp("failedAt", { withTimezone: true }),
    cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
    lastErrorCode: varchar("lastErrorCode", { length: 120 }),
    lastErrorSummary: text("lastErrorSummary"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("dag_nodes_run_key_idx").on(table.runId, table.nodeKey),
    index("dag_nodes_owner_idx").on(table.ownerId),
    index("dag_nodes_ready_idx").on(
      table.ownerId,
      table.runId,
      table.status,
      table.nextAttemptAt,
    ),
    index("dag_nodes_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const dagDependencies = pgTable(
  "dag_dependencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("runId")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    ownerId: varchar("ownerId", { length: 255 }).notNull(),
    upstreamNodeId: uuid("upstreamNodeId")
      .notNull()
      .references(() => dagNodes.id, { onDelete: "cascade" }),
    downstreamNodeId: uuid("downstreamNodeId")
      .notNull()
      .references(() => dagNodes.id, { onDelete: "cascade" }),
    dependencyType: varchar("dependencyType", { length: 40 })
      .notNull()
      .default("SUCCESS_REQUIRED"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dag_dependencies_edge_idx").on(
      table.runId,
      table.upstreamNodeId,
      table.downstreamNodeId,
    ),
    index("dag_dependencies_downstream_idx").on(table.downstreamNodeId),
    index("dag_dependencies_owner_idx").on(table.ownerId),
  ],
);

// ============================================================================
// EXECUTION PROPOSALS + fingerprint-bound approvals
// ============================================================================

export const executionProposals = pgTable(
  "execution_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: varchar("ownerId", { length: 255 }).notNull(),
    conversationId: varchar("conversationId", { length: 64 }),
    runId: uuid("runId").references(() => runs.id, { onDelete: "set null" }),
    bubbleId: varchar("bubbleId", { length: 64 }),
    worldId: varchar("worldId", { length: 64 }),
    sourceMessageId: varchar("sourceMessageId", { length: 64 }),
    intentType: varchar("intentType", { length: 80 }).notNull(),
    targetReferences: jsonb("targetReferences")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    capabilityId: varchar("capabilityId", { length: 160 }),
    capabilityVersion: varchar("capabilityVersion", { length: 40 }),
    normalizedInputs: jsonb("normalizedInputs")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    riskLevel: varchar("riskLevel", { length: 20 }).notNull(),
    sideEffectType: varchar("sideEffectType", { length: 40 }).notNull(),
    policyContext: jsonb("policyContext")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    policyDecision: varchar("policyDecision", { length: 40 }).notNull(),
    approvalRequired: boolean("approvalRequired").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    dependencies: uuid("dependencies").array().notNull().default([]),
    version: varchar("version", { length: 20 }).notNull().default("1"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("execution_proposals_owner_idx").on(table.ownerId),
    index("execution_proposals_run_idx").on(table.runId),
    index("execution_proposals_conversation_idx").on(table.conversationId),
    index("execution_proposals_fingerprint_idx").on(table.ownerId, table.fingerprint),
  ],
);

export const proposalApprovals = pgTable(
  "proposal_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposalId: uuid("proposalId")
      .notNull()
      .references(() => executionProposals.id, { onDelete: "cascade" }),
    ownerId: varchar("ownerId", { length: 255 }).notNull(),
    executionFingerprint: varchar("executionFingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    decidedAt: timestamp("decidedAt", { withTimezone: true }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    consumedAt: timestamp("consumedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("proposal_approvals_owner_idx").on(table.ownerId),
    index("proposal_approvals_proposal_idx").on(table.proposalId),
  ],
);

// ============================================================================
// ACTION RECEIPTS — idempotent action execution records
// ============================================================================

export const actionReceipts = pgTable(
  "action_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: varchar("taskId", { length: 64 }).notNull(),
    actionId: varchar("actionId", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 255 }).notNull().unique(),
    response: jsonb("response").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ============================================================================
// RUNTIME TASKS — canonical backing for createRuntimeTask / actOnRuntimeTask.
//
// Uses a UUID primary key (no serial) and varchar status (no PostgreSQL enum)
// so the table works without custom type definitions in every environment.
// Numeric foreign-key references (conversationId, bubbleId, worldId) follow
// the same bigint-as-number convention as the rest of @db/schema.
// ============================================================================

export const runtimeTasks = pgTable(
  "runtime_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: bigint("userId", { mode: "number" }).notNull(),
    conversationId: bigint("conversationId", { mode: "number" }),
    worldId: bigint("worldId", { mode: "number" }),
    bubbleId: bigint("bubbleId", { mode: "number" }),
    goal: text("goal").notNull(),
    status: varchar("status", { length: 40 }).notNull(),
    world: jsonb("world").$type<RuntimeWorldRecord>().notNull(),
    actions: jsonb("actions").$type<RuntimeActionRecord[]>().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("runtime_tasks_user_idx").on(table.userId),
    index("runtime_tasks_conversation_idx").on(table.conversationId),
    index("runtime_tasks_bubble_idx").on(table.bubbleId),
    index("runtime_tasks_world_idx").on(table.worldId),
  ],
);

// ============================================================================
// EXECUTION ATTEMPT LEDGER — immutable per-attempt records (Phase 2)
//
// ONE dag_node may have MANY execution attempts.
// dag_nodes.attemptCount remains an aggregate; this table is the audit truth.
// ============================================================================

export type ExecutionAttemptStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'INCONCLUSIVE';

export type VerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'INCONCLUSIVE';

export const executionAttempts = pgTable(
  "execution_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: varchar("ownerId", { length: 64 }).notNull(),
    runId: uuid("runId").notNull(),
    nodeId: uuid("nodeId").notNull(),
    nodeKey: varchar("nodeKey", { length: 255 }).notNull(),
    proposalId: uuid("proposalId"),
    capabilityId: varchar("capabilityId", { length: 160 }).notNull(),
    capabilityVersion: varchar("capabilityVersion", { length: 40 }),
    provider: varchar("provider", { length: 160 }),
    /** The execution fingerprint at the time of this attempt */
    fingerprint: varchar("fingerprint", { length: 255 }).notNull(),
    /** Idempotency key scoped to run:node:fenceVersion */
    idempotencyKey: varchar("idempotencyKey", { length: 512 }).notNull().unique(),
    attemptNumber: integer("attemptNumber").notNull(),
    /** Snapshot of the lease token at claim time */
    leaseToken: varchar("leaseToken", { length: 255 }),
    /** Fence version at claim time */
    fenceVersion: integer("fenceVersion").notNull().default(1),
    startedAt: timestamp("startedAt", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
    executionStatus: varchar("executionStatus", { length: 40 })
      .notNull()
      .$type<ExecutionAttemptStatus>()
      .default('RUNNING'),
    /** Reference ID from the external provider (e.g. OpenAI request_id) */
    providerReference: varchar("providerReference", { length: 512 }),
    /** Structured output after successful execution */
    normalizedResult: jsonb("normalizedResult").$type<Record<string, unknown>>(),
    /** Structured error if execution failed */
    normalizedError: jsonb("normalizedError").$type<Record<string, unknown>>(),
    verificationStatus: varchar("verificationStatus", { length: 40 })
      .notNull()
      .$type<VerificationStatus>()
      .default('PENDING'),
    /** Detail from the verifier (strategy used, notes) */
    verificationDetail: jsonb("verificationDetail").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("exec_attempts_run_idx").on(table.runId),
    index("exec_attempts_node_idx").on(table.nodeId),
    index("exec_attempts_owner_idx").on(table.ownerId),
    index("exec_attempts_status_idx").on(table.executionStatus),
    index("exec_attempts_idempotency_idx").on(table.idempotencyKey),
  ],
);

export type ExecutionAttempt = typeof executionAttempts.$inferSelect;
export type NewExecutionAttempt = typeof executionAttempts.$inferInsert;

// ============================================================================
// CONVERSATION SUMMARIES — durable LLM-generated summaries for long contexts (Phase 5)
// ============================================================================

export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: bigint("conversationId", { mode: "number" }).notNull(),
    ownerId: bigint("ownerId", { mode: "number" }).notNull(),
    /** Message ID of the last message included in this summary */
    upToMessageId: bigint("upToMessageId", { mode: "number" }).notNull(),
    /** Total messages summarized */
    messageCount: integer("messageCount").notNull(),
    /** LLM-generated summary text */
    summaryText: text("summaryText").notNull(),
    /** Structured summary: decisions, constraints, refs, pending approvals */
    structuredSummary: jsonb("structuredSummary").$type<{
      importantDecisions: string[];
      persistentConstraints: string[];
      activeBubbleRefs: string[];
      activeRunIds: string[];
      pendingApprovals: string[];
      openQuestions: string[];
    }>().notNull(),
    /** Model that generated this summary */
    generatedBy: varchar("generatedBy", { length: 120 }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conv_summaries_conv_idx").on(table.conversationId),
    index("conv_summaries_owner_idx").on(table.ownerId),
  ],
);

export type ConversationSummary = typeof conversationSummaries.$inferSelect;

// ============================================================================
// MODEL USAGE LEDGER — durable, append-only cost and routing evidence (Phase 12)
// ============================================================================

export const modelUsageLedger = pgTable(
  "jasim_model_usage_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: varchar("ownerId", { length: 255 }),
    conversationId: varchar("conversationId", { length: 64 }),
    runId: uuid("runId"),
    nodeId: uuid("nodeId"),
    attemptId: uuid("attemptId"),
    purpose: varchar("purpose", { length: 80 }).notNull(),
    tier: varchar("tier", { length: 8 }).notNull(),
    provider: varchar("provider", { length: 80 }).notNull(),
    modelId: varchar("modelId", { length: 160 }).notNull(),
    inputTokens: integer("inputTokens"),
    cachedInputTokens: integer("cachedInputTokens"),
    outputTokens: integer("outputTokens"),
    reasoningTokens: integer("reasoningTokens"),
    totalTokens: integer("totalTokens"),
    latencyMs: integer("latencyMs").notNull(),
    providerRequestId: varchar("providerRequestId", { length: 255 }),
    estimatedCost: doublePrecision("estimatedCost"),
    actualProviderCost: doublePrecision("actualProviderCost"),
    fallbackUsed: boolean("fallbackUsed").notNull().default(false),
    fallbackFrom: varchar("fallbackFrom", { length: 255 }),
    escalatedFrom: varchar("escalatedFrom", { length: 8 }),
    escalationReason: varchar("escalationReason", { length: 120 }),
    success: boolean("success").notNull(),
    errorCategory: varchar("errorCategory", { length: 120 }),
    promptVersion: varchar("promptVersion", { length: 80 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("model_usage_owner_idx").on(table.ownerId),
    index("model_usage_conversation_idx").on(table.conversationId),
    index("model_usage_run_idx").on(table.runId),
    index("model_usage_created_idx").on(table.createdAt),
  ],
);

export type ModelUsageLedger = typeof modelUsageLedger.$inferSelect;

// ============================================================================
// Row types
// ============================================================================

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type DagNode = typeof dagNodes.$inferSelect;
export type NewDagNode = typeof dagNodes.$inferInsert;
export type DagDependency = typeof dagDependencies.$inferSelect;
export type ExecutionProposal = typeof executionProposals.$inferSelect;
export type ProposalApproval = typeof proposalApprovals.$inferSelect;
export type ActionReceipt = typeof actionReceipts.$inferSelect;

// ============================================================================
// Smart Bubble Content Versions — generative mutation audit trail
// ============================================================================

export type MutationType =
  | 'DATA_MUTATION'
  | 'STRUCTURAL_MUTATION'
  | 'POLICY_MUTATION'
  | 'VIEW_MUTATION'
  | 'PERMISSION_MUTATION';

export interface BubbleChangeSet {
  /** Unique identifier for this changeset */
  id: string;
  mutationType: MutationType;
  /** Human-readable summary of what changed */
  description: string;
  /** Original natural-language instruction that generated this changeset */
  nlInstruction: string;
  /** Version string this changeset was generated from (e.g. "schema:0") */
  fromVersion: string;
  /** Complete new BubbleSchema after applying all changes */
  newSchema: Record<string, unknown>;
  estimatedImpact: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}

export const bubbleContentVersions = pgTable(
  "jasim_runtime_bubble_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bubbleId: bigint("bubbleId", { mode: "number" }).notNull(),
    ownerId: bigint("ownerId", { mode: "number" }).notNull(),
    /** e.g. "schema:1", "schema:2" */
    schemaVersion: varchar("schemaVersion", { length: 40 }).notNull(),
    /** Previous version, null for first mutation */
    fromVersion: varchar("fromVersion", { length: 40 }),
    mutationType: varchar("mutationType", { length: 40 }).notNull(),
    nlInstruction: text("nlInstruction"),
    changeSet: jsonb("changeSet").$type<BubbleChangeSet>().notNull(),
    schemaBefore: jsonb("schemaBefore").$type<Record<string, unknown>>(),
    schemaAfter: jsonb("schemaAfter").$type<Record<string, unknown>>().notNull(),
    appliedBy: bigint("appliedBy", { mode: "number" }).notNull(),
    appliedAt: timestamp("appliedAt", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("bubble_versions_bubble_idx").on(table.bubbleId),
    index("bubble_versions_owner_idx").on(table.ownerId),
    index("bubble_versions_type_idx").on(table.mutationType),
  ],
);

export type BubbleContentVersion = typeof bubbleContentVersions.$inferSelect;
export type NewBubbleContentVersion = typeof bubbleContentVersions.$inferInsert;
