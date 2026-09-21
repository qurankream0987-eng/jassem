import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  boolean,
  bigint,
  index,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RuntimeActionRecord, RuntimeWorldRecord } from "./schema-runtime";

// ============================================
// ENUMS (pg-core)
// ============================================
export const users_role_enum = pgEnum("users_role", ["user", "admin", "agent", "system"]);
export const users_status_enum = pgEnum("users_status", ["active", "inactive", "suspended", "banned"]);
export const conversations_status_enum = pgEnum("conversations_status", ["active", "archived", "closed", "error"]);
export const messages_role_enum = pgEnum("messages_role", ["user", "assistant", "system", "tool", "agent"]);
export const tasks_status_enum = pgEnum("tasks_status", ["pending", "planning", "running", "paused", "waiting_approval", "waiting_input", "completed", "failed", "cancelled"]);
export const tasks_priority_enum = pgEnum("tasks_priority", ["low", "normal", "high", "critical"]);
export const task_steps_type_enum = pgEnum("task_steps_type", ["action", "decision", "approval", "tool_call", "agent_call", "human_input", "wait", "compensation", "error_handler"]);
export const task_steps_status_enum = pgEnum("task_steps_status", ["pending", "running", "waiting", "completed", "failed", "skipped", "cancelled"]);
export const capabilities_riskLevel_enum = pgEnum("capabilities_riskLevel", ["none", "low", "medium", "high", "critical"]);
export const tools_sideEffects_enum = pgEnum("tools_sideEffects", ["none", "read", "write", "destructive"]);
export const tool_invocations_status_enum = pgEnum("tool_invocations_status", ["pending", "running", "completed", "failed", "cancelled", "timeout"]);
export const identities_type_enum = pgEnum("identities_type", ["user", "agent", "system", "service", "organization", "device"]);
export const policies_scope_enum = pgEnum("policies_scope", ["global", "task", "capability", "tool", "user", "entity"]);
export const memory_entries_scope_enum = pgEnum("memory_entries_scope", ["global", "user", "task", "conversation", "entity", "system"]);
export const agent_logs_status_enum = pgEnum("agent_logs_status", ["started", "completed", "failed", "error"]);
export const bubbles_status_enum = pgEnum("bubbles_status", ["active", "inactive", "dismissed", "completed", "archived"]);
export const generated_systems_continuity_enum = pgEnum("generated_systems_continuity", ["persistent", "evolving"]);
export const generated_systems_visibility_enum = pgEnum("generated_systems_visibility", ["private", "public", "shared"]);
export const generated_systems_status_enum = pgEnum("generated_systems_status", ["draft", "generating", "active", "paused", "deprecated", "archived"]);
export const system_versions_status_enum = pgEnum("system_versions_status", ["draft", "active", "retired", "rolled_back"]);
export const dna_candidates_kind_enum = pgEnum("dna_candidates_kind", ["knowledge", "workflow", "capability", "policy", "ui", "world", "core_patch"]);
export const dna_candidates_status_enum = pgEnum("dna_candidates_status", ["candidate", "evaluating", "approved", "canary", "active", "rejected", "retired"]);
export const dna_versions_kind_enum = pgEnum("dna_versions_kind", ["knowledge", "workflow", "capability", "policy", "ui", "world"]);
export const dna_versions_status_enum = pgEnum("dna_versions_status", ["canary", "active", "retired"]);
export const core_kernel_baselines_status_enum = pgEnum("core_kernel_baselines_status", ["active", "superseded"]);
export const core_patch_candidates_risk_enum = pgEnum("core_patch_candidates_risk", ["critical"]);
export const core_patch_candidates_status_enum = pgEnum("core_patch_candidates_status", ["submitted", "evaluating", "rejected", "approved_for_build", "built", "signed", "shadow", "canary", "active", "rolled_back", "quarantined"]);
export const core_patch_events_eventType_enum = pgEnum("core_patch_events_eventType", ["submitted", "gate_recorded", "transitioned"]);
export const runtime_jobs_status_enum = pgEnum("runtime_jobs_status", ["queued", "claimed", "running", "succeeded", "failed", "timed_out", "cancelled", "quarantined"]);
export const capability_release_bindings_status_enum = pgEnum("capability_release_bindings_status", ["canary", "active", "disabled", "quarantined"]);
export const external_action_ledger_effect_enum = pgEnum("external_action_ledger_effect", ["none", "read", "write", "external_change", "financial"]);
export const external_action_ledger_status_enum = pgEnum("external_action_ledger_status", ["prepared", "executing", "succeeded", "failed", "uncertain", "reconciling", "manual_review"]);
export const external_webhook_events_status_enum = pgEnum("external_webhook_events_status", ["received", "applied", "unmatched", "ignored"]);
export const security_events_type_enum = pgEnum("security_events_type", ["permission_denied", "risk_gate_triggered", "approval_required", "approval_granted", "approval_denied", "policy_violation", "side_effect_executed", "authentication_failure", "suspicious_activity"]);
export const security_events_result_enum = pgEnum("security_events_result", ["allowed", "denied", "pending_approval"]);


// ============================================
// CORE: Users (generic auth)
// ============================================
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    unionId: varchar("unionId", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 320 }),
    avatar: text("avatar"),
    role: users_role_enum("role")
      .default("user")
      .notNull(),
    status: users_status_enum("status")
      .default("active")
      .notNull(),
    preferences: jsonb("preferences").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    unionIdIdx: uniqueIndex("users_unionId_idx").on(table.unionId),
    roleIdx: index("users_role_idx").on(table.role),
    statusIdx: index("users_status_idx").on(table.status),
  })
);

// ============================================
// CORE: Conversations (generic chat sessions)
// ============================================
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number" }).notNull(),
    title: varchar("title", { length: 255 }),
    status: conversations_status_enum("status")
      .default("active")
      .notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("conversations_userId_idx").on(table.userId),
    statusIdx: index("conversations_status_idx").on(table.status),
  })
);

// ============================================
// CORE: Messages (generic messages)
// ============================================
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversationId", { mode: "number" }).notNull(),
    role: messages_role_enum("role")
      .notNull(),
    content: text("content").notNull(),
    intent: varchar("intent", { length: 100 }),
    taskId: bigint("taskId", { mode: "number" }),
    bubbleData: jsonb("bubbleData").$type<Record<string, unknown>>(),
    outputKind: varchar("outputKind", { length: 50 }),
    ownerId: varchar("ownerId", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conversationIdIdx: index("messages_conversationId_idx").on(
      table.conversationId
    ),
    taskIdIdx: index("messages_taskId_idx").on(table.taskId),
    roleIdx: index("messages_role_idx").on(table.role),
    createdAtIdx: index("messages_createdAt_idx").on(table.createdAt),
    ownerIdIdx: index("messages_ownerId_idx").on(table.ownerId),
  })
);

// ============================================
// RUNTIME: Tasks (generic task execution)
// ============================================
export const tasks = pgTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number" }).notNull(),
    conversationId: bigint("conversationId", { mode: "number" }),
    goal: text("goal").notNull(),
    intent: varchar("intent", { length: 100 }),
    context: jsonb("context").$type<Record<string, unknown>>(),
    entities: jsonb("entities").$type<Record<string, unknown>>(),
    constraints: jsonb("constraints").$type<Record<string, unknown>>(),
    collectedData: jsonb("collectedData").$type<Record<string, unknown>>(),
    missingData: jsonb("missingData").$type<string[]>(),
    plan: jsonb("plan").$type<Record<string, unknown>>(),
    status: varchar("status", { length: 40 })
      .default("pending")
      .notNull(),
    priority: tasks_priority_enum("priority")
      .default("normal")
      .notNull(),
    currentStepId: bigint("currentStepId", { mode: "number" }),
    capabilities: jsonb("capabilities").$type<string[]>(),
    agents: jsonb("agents").$type<string[]>(),
    tools: jsonb("tools").$type<string[]>(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>(),
    errors: jsonb("errors").$type<Array<Record<string, unknown>>>(),
    history: jsonb("history").$type<Array<Record<string, unknown>>>(),
    world: jsonb("world").$type<RuntimeWorldRecord>(),
    actions: jsonb("actions").$type<RuntimeActionRecord[]>(),
    bubbleId: bigint("bubbleId", { mode: "number" }),
    worldId: bigint("worldId", { mode: "number" }),
    parentTaskId: bigint("parentTaskId", { mode: "number" }),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("tasks_userId_idx").on(table.userId),
    conversationIdIdx: index("tasks_conversationId_idx").on(
      table.conversationId
    ),
    statusIdx: index("tasks_status_idx").on(table.status),
    priorityIdx: index("tasks_priority_idx").on(table.priority),
    parentTaskIdIdx: index("tasks_parentTaskId_idx").on(table.parentTaskId),
    currentStepIdIdx: index("tasks_currentStepId_idx").on(table.currentStepId),
    createdAtIdx: index("tasks_createdAt_idx").on(table.createdAt),
    bubbleIdIdx: index("tasks_bubbleId_idx").on(table.bubbleId),
    worldIdIdx: index("tasks_worldId_idx").on(table.worldId),
  })
);

// ============================================
// RUNTIME: Task Steps (individual plan steps)
// ============================================
export const taskSteps = pgTable(
  "task_steps",
  {
    id: serial("id").primaryKey(),
    taskId: bigint("taskId", { mode: "number" }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: task_steps_type_enum("type")
      .default("action")
      .notNull(),
    status: task_steps_status_enum("status")
      .default("pending")
      .notNull(),
    dependencies: jsonb("dependencies").$type<string[]>(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>(),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    error: text("error"),
    retryCount: integer("retryCount").default(0),
    maxRetries: integer("maxRetries").default(3),
    agentId: varchar("agentId", { length: 100 }),
    capabilityId: bigint("capabilityId", { mode: "number" }),
    toolId: bigint("toolId", { mode: "number" }),
    approvalId: bigint("approvalId", { mode: "number" }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    taskIdIdx: index("task_steps_taskId_idx").on(table.taskId),
    statusIdx: index("task_steps_status_idx").on(table.status),
    typeIdx: index("task_steps_type_idx").on(table.type),
    capabilityIdIdx: index("task_steps_capabilityId_idx").on(
      table.capabilityId
    ),
    toolIdIdx: index("task_steps_toolId_idx").on(table.toolId),
    approvalIdIdx: index("task_steps_approvalId_idx").on(table.approvalId),
  })
);

// ============================================
// REGISTRY: Capabilities (capability definitions)
// ============================================
export const capabilities = pgTable(
  "capabilities",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    version: varchar("version", { length: 20 }).default("1.0.0"),
    inputSchema: jsonb("inputSchema").$type<Record<string, unknown>>(),
    outputSchema: jsonb("outputSchema").$type<Record<string, unknown>>(),
    requirements: jsonb("requirements").$type<string[]>(),
    permissions: jsonb("permissions").$type<string[]>(),
    riskLevel: capabilities_riskLevel_enum("riskLevel")
      .default("low")
      .notNull(),
    sideEffects: jsonb("sideEffects").$type<
      Array<{ type: string; description: string; reversible: boolean }>
    >(),
    executionHandler: varchar("executionHandler", { length: 255 }),
    validationRules: jsonb("validationRules").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    isActive: boolean("isActive").default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    nameIdx: uniqueIndex("capabilities_name_idx").on(table.name),
    riskLevelIdx: index("capabilities_riskLevel_idx").on(table.riskLevel),
    isActiveIdx: index("capabilities_isActive_idx").on(table.isActive),
  })
);

// ============================================
// REGISTRY: Tools (tool definitions)
// ============================================
export const tools = pgTable(
  "tools",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    inputSchema: jsonb("inputSchema").$type<Record<string, unknown>>(),
    outputSchema: jsonb("outputSchema").$type<Record<string, unknown>>(),
    permissions: jsonb("permissions").$type<string[]>(),
    sideEffects: tools_sideEffects_enum("sideEffects")
      .default("none")
      .notNull(),
    authentication: jsonb("authentication").$type<Record<string, unknown>>(),
    timeout: integer("timeout").default(30000),
    retryPolicy: jsonb("retryPolicy").$type<{
      maxRetries: number;
      backoff: string;
      retryableErrors: string[];
    }>(),
    executor: varchar("executor", { length: 255 }),
    isActive: boolean("isActive").default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    nameIdx: uniqueIndex("tools_name_idx").on(table.name),
    isActiveIdx: index("tools_isActive_idx").on(table.isActive),
    sideEffectsIdx: index("tools_sideEffects_idx").on(table.sideEffects),
  })
);

// ============================================
// RUNTIME: Tool Invocations (execution log)
// ============================================
export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: serial("id").primaryKey(),
    toolId: bigint("toolId", { mode: "number" }).notNull(),
    taskId: bigint("taskId", { mode: "number" }),
    stepId: bigint("stepId", { mode: "number" }),
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>(),
    status: tool_invocations_status_enum("status")
      .default("pending")
      .notNull(),
    duration: integer("duration"),
    error: text("error"),
    startedAt: timestamp("startedAt", { withTimezone: true }),
    completedAt: timestamp("completedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    toolIdIdx: index("tool_invocations_toolId_idx").on(table.toolId),
    taskIdIdx: index("tool_invocations_taskId_idx").on(table.taskId),
    stepIdIdx: index("tool_invocations_stepId_idx").on(table.stepId),
    statusIdx: index("tool_invocations_status_idx").on(table.status),
    createdAtIdx: index("tool_invocations_createdAt_idx").on(table.createdAt),
  })
);

// ============================================
// ENTITY: Generic Entity System
// ============================================
export const entities = pgTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    relationships: jsonb("relationships").$type<
      Array<{
        entityId: number;
        type: string;
        metadata?: Record<string, unknown>;
      }>
    >(),
    capabilities: jsonb("capabilities").$type<string[]>(),
    identityId: bigint("identityId", { mode: "number" }),
    reputation: jsonb("reputation").$type<{
      score: number;
      reviews: number;
      trustLevel: string;
    }>(),
    availability: jsonb("availability").$type<Record<string, unknown>>(),
    permissions: jsonb("permissions").$type<string[]>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    typeIdx: index("entities_type_idx").on(table.type),
    nameIdx: index("entities_name_idx").on(table.name),
    identityIdIdx: index("entities_identityId_idx").on(table.identityId),
  })
);

// ============================================
// IDENTITY: Identity System
// ============================================
export const identities = pgTable(
  "identities",
  {
    id: serial("id").primaryKey(),
    entityId: bigint("entityId", { mode: "number" }).notNull(),
    type: identities_type_enum("type")
      .default("user")
      .notNull(),
    credentials: jsonb("credentials").$type<Record<string, unknown>>(),
    verified: boolean("verified").default(false),
    permissions: jsonb("permissions").$type<string[]>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    entityIdIdx: index("identities_entityId_idx").on(table.entityId),
    typeIdx: index("identities_type_idx").on(table.type),
    verifiedIdx: index("identities_verified_idx").on(table.verified),
  })
);

// ============================================
// AUTHORITY: Approvals (human-in-the-loop)
// ============================================
export const approvals = pgTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    taskId: bigint("taskId", { mode: "number" }).notNull(),
    stepId: bigint("stepId", { mode: "number" }),
    action: varchar("action", { length: 255 }).notNull(),
    actor: varchar("actor", { length: 255 }),
    permission: varchar("permission", { length: 100 }),
    policy: jsonb("policy").$type<Record<string, unknown>>(),
    riskLevel: capabilities_riskLevel_enum("riskLevel")
      .default("low")
      .notNull(),
    required: boolean("required").default(true),
    approved: boolean("approved"),
    approvedBy: bigint("approvedBy", { mode: "number" }),
    approvedAt: timestamp("approvedAt", { withTimezone: true }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index("approvals_taskId_idx").on(table.taskId),
    stepIdIdx: index("approvals_stepId_idx").on(table.stepId),
    approvedByIdx: index("approvals_approvedBy_idx").on(table.approvedBy),
    statusIdx: index("approvals_status_idx").on(table.approved),
    expiresAtIdx: index("approvals_expiresAt_idx").on(table.expiresAt),
  })
);

// ============================================
// GOVERNANCE: Policies (policy engine rules)
// ============================================
export const policies = pgTable(
  "policies",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull().unique(),
    description: text("description"),
    rules: jsonb("rules").$type<
      Array<{
        condition: Record<string, unknown>;
        action: string;
        effect: "allow" | "deny";
      }>
    >(),
    scope: policies_scope_enum("scope")
      .default("global")
      .notNull(),
    priority: integer("priority").default(0),
    isActive: boolean("isActive").default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    nameIdx: uniqueIndex("policies_name_idx").on(table.name),
    scopeIdx: index("policies_scope_idx").on(table.scope),
    isActiveIdx: index("policies_isActive_idx").on(table.isActive),
    priorityIdx: index("policies_priority_idx").on(table.priority),
  })
);

// ============================================
// MEMORY: Scoped Memory Entries
// ============================================
export const memoryEntries = pgTable(
  "memory_entries",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number" }),
    taskId: bigint("taskId", { mode: "number" }),
    entityId: bigint("entityId", { mode: "number" }),
    scope: memory_entries_scope_enum("scope")
      .default("global")
      .notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    value: jsonb("value").$type<unknown>(),
    permissions: jsonb("permissions").$type<string[]>(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("memory_entries_userId_idx").on(table.userId),
    taskIdIdx: index("memory_entries_taskId_idx").on(table.taskId),
    entityIdIdx: index("memory_entries_entityId_idx").on(table.entityId),
    scopeIdx: index("memory_entries_scope_idx").on(table.scope),
    categoryIdx: index("memory_entries_category_idx").on(table.category),
    keyIdx: index("memory_entries_key_idx").on(table.key),
    expiresAtIdx: index("memory_entries_expiresAt_idx").on(table.expiresAt),
  })
);

// ============================================
// EVENTS: Event Log
// ============================================
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 100 }).notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    priority: tasks_priority_enum("priority")
      .default("normal")
      .notNull(),
    processed: boolean("processed").default(false),
    processedAt: timestamp("processedAt", { withTimezone: true }),
    correlationId: varchar("correlationId", { length: 100 }),
    ownerId: varchar("ownerId", { length: 255 }),
    runId: varchar("runId", { length: 64 }),
    proposalId: varchar("proposalId", { length: 64 }),
    taskRef: varchar("taskRef", { length: 64 }),
    message: text("message"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    typeIdx: index("events_type_idx").on(table.type),
    sourceIdx: index("events_source_idx").on(table.source),
    processedIdx: index("events_processed_idx").on(table.processed),
    priorityIdx: index("events_priority_idx").on(table.priority),
    correlationIdIdx: index("events_correlationId_idx").on(
      table.correlationId
    ),
    createdAtIdx: index("events_createdAt_idx").on(table.createdAt),
    ownerIdIdx: index("events_ownerId_idx").on(table.ownerId),
    runIdIdx: index("events_runId_idx").on(table.runId, table.createdAt),
    proposalIdIdx: index("events_proposalId_idx").on(table.proposalId, table.createdAt),
  })
);

// ============================================
// EVENTS: Event Subscriptions
// ============================================
export const eventSubscriptions = pgTable(
  "event_subscriptions",
  {
    id: serial("id").primaryKey(),
    eventType: varchar("eventType", { length: 100 }).notNull(),
    filter: jsonb("filter").$type<Record<string, unknown>>(),
    handler: varchar("handler", { length: 255 }).notNull(),
    active: boolean("active").default(true),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    // Block 2 (migration 0008): owner binding + run continuation + lifecycle.
    ownerId: varchar("ownerId", { length: 100 }),
    runId: uuid("runId"),
    nodeId: uuid("nodeId"),
    source: varchar("source", { length: 32 }).default("internal").notNull(),
    state: varchar("state", { length: 16 }).default("active").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    lastTriggeredAt: timestamp("lastTriggeredAt", { withTimezone: true }),
  },
  (table) => ({
    eventTypeIdx: index("event_subscriptions_eventType_idx").on(
      table.eventType
    ),
    activeIdx: index("event_subscriptions_active_idx").on(table.active),
  })
);

// ============================================
// OBSERVABILITY: Agent Logs
// ============================================
export const agentLogs = pgTable(
  "agent_logs",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agentId", { length: 100 }).notNull(),
    taskId: bigint("taskId", { mode: "number" }),
    stepId: bigint("stepId", { mode: "number" }),
    capability: varchar("capability", { length: 100 }),
    tool: varchar("tool", { length: 100 }),
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>(),
    duration: integer("duration"),
    status: agent_logs_status_enum("status")
      .default("started")
      .notNull(),
    error: text("error"),
    tokensUsed: integer("tokensUsed").default(0),
    cost: doublePrecision("cost").default(0),
    model: varchar("model", { length: 100 }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentIdIdx: index("agent_logs_agentId_idx").on(table.agentId),
    taskIdIdx: index("agent_logs_taskId_idx").on(table.taskId),
    stepIdIdx: index("agent_logs_stepId_idx").on(table.stepId),
    statusIdx: index("agent_logs_status_idx").on(table.status),
    createdAtIdx: index("agent_logs_createdAt_idx").on(table.createdAt),
  })
);

// ============================================
// OBSERVABILITY: Execution Traces
// ============================================
export const executionTraces = pgTable(
  "execution_traces",
  {
    id: serial("id").primaryKey(),
    taskId: bigint("taskId", { mode: "number" }).notNull(),
    stepId: bigint("stepId", { mode: "number" }),
    agentId: varchar("agentId", { length: 100 }),
    capabilityId: bigint("capabilityId", { mode: "number" }),
    toolId: bigint("toolId", { mode: "number" }),
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>(),
    duration: integer("duration"),
    status: tool_invocations_status_enum("status")
      .default("pending")
      .notNull(),
    error: text("error"),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => ({
    taskIdIdx: index("execution_traces_taskId_idx").on(table.taskId),
    stepIdIdx: index("execution_traces_stepId_idx").on(table.stepId),
    agentIdIdx: index("execution_traces_agentId_idx").on(table.agentId),
    capabilityIdIdx: index("execution_traces_capabilityId_idx").on(
      table.capabilityId
    ),
    toolIdIdx: index("execution_traces_toolId_idx").on(table.toolId),
    timestampIdx: index("execution_traces_timestamp_idx").on(
      table.timestamp
    ),
    statusIdx: index("execution_traces_status_idx").on(table.status),
  })
);

// ============================================
// UI: Bubbles (dynamic UI instances)
// ============================================
export const bubbles = pgTable(
  "bubbles",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number" }).notNull(),
    taskId: bigint("taskId", { mode: "number" }),
    conversationId: bigint("conversationId", { mode: "number" }),
    type: varchar("type", { length: 50 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    schema: jsonb("schema").$type<Record<string, unknown>>(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    status: bubbles_status_enum("status")
      .default("active")
      .notNull(),
    position: jsonb("position").$type<{
      x?: number;
      y?: number;
      z?: number;
      pinned?: boolean;
    }>(),
    mode: varchar("mode", { length: 20 }),
    semanticDescription: text("semanticDescription"),
    activeView: varchar("activeView", { length: 100 }).default("default"),
    presentationState: jsonb("presentationState")
      .$type<Record<string, unknown>>()
      .default({}),
    permissions: jsonb("permissions")
      .$type<Record<string, unknown>>()
      .default({}),
    references: jsonb("references")
      .$type<Array<Record<string, unknown>>>()
      .default([]),
    worldId: bigint("worldId", { mode: "number" }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIdx: index("bubbles_userId_idx").on(table.userId),
    taskIdIdx: index("bubbles_taskId_idx").on(table.taskId),
    conversationIdIdx: index("bubbles_conversationId_idx").on(
      table.conversationId
    ),
    typeIdx: index("bubbles_type_idx").on(table.type),
    statusIdx: index("bubbles_status_idx").on(table.status),
    worldIdIdx: index("bubbles_worldId_idx").on(table.worldId),
  })
);

// ============================================
// GENERATED: Generated SaaS / Experience Systems
// ============================================
export const generatedSystems = pgTable(
  "generated_systems",
  {
    id: serial("id").primaryKey(),
    worldKey: varchar("worldKey", { length: 160 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    version: varchar("version", { length: 20 }).default("1.0.0"),
    ownerId: bigint("ownerId", { mode: "number" }).notNull(),
    /**
     * The scope this world belongs to — a person's own id, or an
     * organization's. `ownerId` stays WHO MADE IT; this is WHOSE IT IS, and
     * they stopped being the same question when a business became a scope.
     */
    scopeId: varchar("scopeId", { length: 64 }),
    continuity: generated_systems_continuity_enum("continuity"),
    visibility: generated_systems_visibility_enum("visibility").default("private"),
    sourceTaskId: bigint("sourceTaskId", { mode: "number" }),
    conversationId: bigint("conversationId", { mode: "number" }),
    capabilities: jsonb("capabilities").$type<string[]>(),
    schema: jsonb("schema").$type<Record<string, unknown>>(),
    status: generated_systems_status_enum("status")
      .default("draft")
      .notNull(),
    config: jsonb("config").$type<Record<string, unknown>>(),
    archivedAt: timestamp("archivedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerIdIdx: index("generated_systems_ownerId_idx").on(table.ownerId),
    statusIdx: index("generated_systems_status_idx").on(table.status),
    nameIdx: index("generated_systems_name_idx").on(table.name),
    worldKeyIdx: uniqueIndex("generated_systems_world_key_idx").on(table.ownerId, table.worldKey),
    // The scoped uniqueness. Two worlds with one key under one scope is the
    // duplicate a retried materialization must never produce.
    scopeWorldIdx: uniqueIndex("generated_systems_scope_world_idx").on(table.scopeId, table.worldKey),
    scopeIdx: index("generated_systems_scope_idx").on(table.scopeId, table.status),
    conversationIdx: index("generated_systems_conversation_idx").on(table.conversationId),
  })
);

// ============================================
// GENERATED: Versioned Generated Systems
// ============================================
export const systemVersions = pgTable(
  "system_versions",
  {
    id: serial("id").primaryKey(),
    systemId: bigint("systemId", { mode: "number" }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    status: system_versions_status_enum("status").default("draft").notNull(),
    parentVersion: varchar("parentVersion", { length: 20 }),
    contentDigest: varchar("contentDigest", { length: 64 }),
    changeRequest: text("changeRequest"),
    requestKey: varchar("requestKey", { length: 128 }),
    createdBy: bigint("createdBy", { mode: "number" }),
    schema: jsonb("schema").$type<Record<string, unknown>>(),
    state: jsonb("state").$type<Record<string, unknown>>(),
    migration: jsonb("migration").$type<{
      fromVersion: string;
      changes: Array<Record<string, unknown>>;
      rollback: Array<Record<string, unknown>>;
    }>(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp("activatedAt", { withTimezone: true }),
  },
  (table) => ({
    systemIdIdx: index("system_versions_systemId_idx").on(table.systemId),
    versionIdx: index("system_versions_version_idx").on(table.version),
    uniqueVersion: uniqueIndex("system_versions_unique_idx").on(
      table.systemId,
      table.version
    ),
    digestIdx: index("system_versions_digest_idx").on(table.systemId, table.contentDigest),
    requestKeyIdx: uniqueIndex("system_versions_request_key_idx").on(table.systemId, table.requestKey),
    statusIdx: index("system_versions_status_idx").on(table.systemId, table.status),
  })
);

// ============================================
// GENERATIVE DNA: Assimilated candidates
// ============================================
export const dnaCandidates = pgTable(
  "dna_candidates",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    sourceDigest: varchar("sourceDigest", { length: 64 }).notNull(),
    kind: dna_candidates_kind_enum("kind").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    summary: text("summary").notNull(),
    status: dna_candidates_status_enum("status").default("candidate").notNull(),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").$type<Record<string, unknown>>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    evaluations: jsonb("evaluations").$type<Array<Record<string, unknown>>>().notNull(),
    approvedBy: varchar("approvedBy", { length: 100 }),
    approvedAt: timestamp("approvedAt", { withTimezone: true }),
    rejectionReason: text("rejectionReason"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    sourceDigestIdx: uniqueIndex("dna_candidates_source_digest_idx").on(table.sourceDigest),
    statusIdx: index("dna_candidates_status_idx").on(table.status),
    kindIdx: index("dna_candidates_kind_idx").on(table.kind),
  }),
);

// ============================================
// GENERATIVE DNA: Immutable activated versions
// ============================================
export const dnaVersions = pgTable(
  "dna_versions",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    geneId: varchar("geneId", { length: 255 }).notNull(),
    candidateId: varchar("candidateId", { length: 100 }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    kind: dna_versions_kind_enum("kind").notNull(),
    status: dna_versions_status_enum("status").default("canary").notNull(),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    source: jsonb("source").$type<Record<string, unknown>>().notNull(),
    lineage: jsonb("lineage").$type<Record<string, unknown>>().notNull(),
    fitness: jsonb("fitness").$type<Record<string, unknown>>().notNull(),
    activatedBy: varchar("activatedBy", { length: 100 }).notNull(),
    activatedAt: timestamp("activatedAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    geneIdIdx: index("dna_versions_gene_id_idx").on(table.geneId),
    candidateIdIdx: index("dna_versions_candidate_id_idx").on(table.candidateId),
    statusIdx: index("dna_versions_status_idx").on(table.status),
    uniqueGeneVersion: uniqueIndex("dna_versions_gene_version_idx").on(table.geneId, table.version),
  }),
);

// ============================================
// GENERATIVE DNA: Reproducible genome snapshots
// ============================================
export const dnaGenomeSnapshots = pgTable(
  "dna_genome_snapshots",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    digest: varchar("digest", { length: 64 }).notNull(),
    geneVersionIds: jsonb("geneVersionIds").$type<string[]>().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    digestIdx: uniqueIndex("dna_genome_snapshots_digest_idx").on(table.digest),
  }),
);

// ============================================
// GENERATIVE DNA: Evidence used for fitness
// ============================================
export const dnaExecutionEvidence = pgTable(
  "dna_execution_evidence",
  {
    id: serial("id").primaryKey(),
    versionId: varchar("versionId", { length: 100 }).notNull(),
    success: boolean("success").notNull(),
    verified: boolean("verified").notNull(),
    latencyMs: integer("latencyMs").notNull(),
    cost: doublePrecision("cost").default(0).notNull(),
    safetyIncident: boolean("safetyIncident").default(false).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    recordedAt: timestamp("recordedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdIdx: index("dna_execution_evidence_version_id_idx").on(table.versionId),
    recordedAtIdx: index("dna_execution_evidence_recorded_at_idx").on(table.recordedAt),
  }),
);

// ============================================
// CORE EVOLUTION LAB: Immutable kernel baselines
// ============================================
export const coreKernelBaselines = pgTable(
  "core_kernel_baselines",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    version: varchar("version", { length: 20 }).notNull(),
    kernelDigest: varchar("kernelDigest", { length: 64 }).notNull(),
    manifestDigest: varchar("manifestDigest", { length: 64 }).notNull(),
    testSuiteDigest: varchar("testSuiteDigest", { length: 64 }).notNull(),
    artifactRef: varchar("artifactRef", { length: 500 }),
    status: core_kernel_baselines_status_enum("status").default("active").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    versionIdx: uniqueIndex("core_kernel_baselines_version_idx").on(table.version),
    kernelDigestIdx: uniqueIndex("core_kernel_baselines_digest_idx").on(table.kernelDigest),
    statusIdx: index("core_kernel_baselines_status_idx").on(table.status),
  }),
);

// ============================================
// CORE EVOLUTION LAB: Inert patch candidates
// ============================================
export const corePatchCandidates = pgTable(
  "core_patch_candidates",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    dnaCandidateId: varchar("dnaCandidateId", { length: 100 }).notNull(),
    baseBaselineId: varchar("baseBaselineId", { length: 100 }).notNull(),
    targetVersion: varchar("targetVersion", { length: 20 }).notNull(),
    sourceDigest: varchar("sourceDigest", { length: 64 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: text("summary").notNull(),
    risk: core_patch_candidates_risk_enum("risk").default("critical").notNull(),
    status: core_patch_candidates_status_enum("status").default("submitted").notNull(),
    scope: jsonb("scope").$type<string[]>().notNull(),
    declaredEffects: jsonb("declaredEffects").$type<string[]>().notNull(),
    testPlan: jsonb("testPlan").$type<string[]>().notNull(),
    rollbackPlan: jsonb("rollbackPlan").$type<string[]>().notNull(),
    requiredGates: jsonb("requiredGates").$type<string[]>().notNull(),
    gateResults: jsonb("gateResults").$type<Array<Record<string, unknown>>>().notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    dnaCandidateIdx: uniqueIndex("core_patch_candidates_dna_candidate_idx").on(table.dnaCandidateId),
    baselineIdx: index("core_patch_candidates_baseline_idx").on(table.baseBaselineId),
    statusIdx: index("core_patch_candidates_status_idx").on(table.status),
    sourceDigestIdx: index("core_patch_candidates_source_digest_idx").on(table.sourceDigest),
  }),
);

// ============================================
// CORE EVOLUTION LAB: Append-only audit events
// ============================================
export const corePatchEvents = pgTable(
  "core_patch_events",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    candidateId: varchar("candidateId", { length: 100 }).notNull(),
    eventType: core_patch_events_eventType_enum("eventType").notNull(),
    previousStatus: varchar("previousStatus", { length: 40 }),
    nextStatus: varchar("nextStatus", { length: 40 }).notNull(),
    actor: varchar("actor", { length: 100 }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    eventDigest: varchar("eventDigest", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    candidateIdx: index("core_patch_events_candidate_idx").on(table.candidateId),
    eventDigestIdx: uniqueIndex("core_patch_events_digest_idx").on(table.eventDigest),
    createdAtIdx: index("core_patch_events_created_at_idx").on(table.createdAt),
  }),
);

// ============================================
// RUNTIME: Domain-neutral durable job queue
// ============================================
export const runtimeJobs = pgTable(
  "runtime_jobs",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    kind: varchar("kind", { length: 160 }).notNull(),
    subjectType: varchar("subjectType", { length: 100 }).notNull(),
    subjectId: varchar("subjectId", { length: 160 }).notNull(),
    payloadSchemaVersion: integer("payloadSchemaVersion").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
    status: runtime_jobs_status_enum("status").notNull(),
    priority: integer("priority").default(0).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("maxAttempts").default(3).notNull(),
    timeoutMs: integer("timeoutMs").default(600000).notNull(),
    availableAt: timestamp("availableAt", { withTimezone: true }).notNull(),
    leaseOwner: varchar("leaseOwner", { length: 160 }),
    leaseToken: varchar("leaseToken", { length: 160 }),
    leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
    cancellationRequestedAt: timestamp("cancellationRequestedAt", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: varchar("errorCode", { length: 160 }),
    errorSummary: text("errorSummary"),
    revision: integer("revision").default(0).notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completedAt", { withTimezone: true }),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex("runtime_jobs_kind_idempotency_idx").on(table.kind, table.idempotencyKey),
    claimIdx: index("runtime_jobs_claim_idx").on(table.status, table.availableAt, table.priority),
    leaseIdx: index("runtime_jobs_lease_idx").on(table.status, table.leaseExpiresAt),
    subjectIdx: index("runtime_jobs_subject_idx").on(table.subjectType, table.subjectId),
  }),
);

export const runtimeJobEvents = pgTable(
  "runtime_job_events",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    jobId: varchar("jobId", { length: 100 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    actor: varchar("actor", { length: 160 }).notNull(),
    previousStatus: varchar("previousStatus", { length: 40 }),
    nextStatus: varchar("nextStatus", { length: 40 }).notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    previousEventDigest: varchar("previousEventDigest", { length: 64 }),
    eventDigest: varchar("eventDigest", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobCreatedIdx: index("runtime_job_events_job_created_idx").on(table.jobId, table.createdAt),
    digestIdx: uniqueIndex("runtime_job_events_digest_idx").on(table.eventDigest),
  }),
);

// ============================================
// GENERATIVE DNA: Durable signed capability releases
// ============================================
export const capabilityReleaseBindings = pgTable(
  "capability_release_bindings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    packageId: varchar("packageId", { length: 128 }).notNull(),
    packageVersion: varchar("packageVersion", { length: 20 }).notNull(),
    packageDigest: varchar("packageDigest", { length: 64 }).notNull(),
    capabilityId: varchar("capabilityId", { length: 200 }).notNull(),
    candidateId: varchar("candidateId", { length: 100 }).notNull(),
    geneVersionId: varchar("geneVersionId", { length: 100 }),
    status: capability_release_bindings_status_enum("status").notNull(),
    sandboxProvider: varchar("sandboxProvider", { length: 160 }).notNull(),
    signingKeyId: varchar("signingKeyId", { length: 160 }).notNull(),
    binding: jsonb("binding").$type<Record<string, unknown>>().notNull(),
    envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
    storedAt: timestamp("storedAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    packageDigestIdx: uniqueIndex("capability_release_package_digest_idx").on(table.packageDigest),
    capabilityIdx: index("capability_release_capability_idx").on(table.capabilityId),
    statusIdx: index("capability_release_status_idx").on(table.status),
    geneVersionIdx: index("capability_release_gene_version_idx").on(table.geneVersionId),
  }),
);

// ============================================
// EXTERNAL RUNTIME: Side-effect ledger and reconciliation queue
// ============================================
export const externalActionLedger = pgTable(
  "external_action_ledger",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    connectorId: varchar("connectorId", { length: 160 }).notNull(),
    capabilityId: varchar("capabilityId", { length: 160 }).notNull(),
    effect: external_action_ledger_effect_enum("effect").notNull(),
    taskId: bigint("taskId", { mode: "number" }).notNull(),
    userId: bigint("userId", { mode: "number" }).notNull(),
    planId: varchar("planId", { length: 160 }).notNull(),
    worldId: varchar("worldId", { length: 160 }),
    stepId: varchar("stepId", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    approvalId: varchar("approvalId", { length: 100 }),
    inputDigest: varchar("inputDigest", { length: 64 }).notNull(),
    reconciliationData: jsonb("reconciliationData").$type<Record<string, unknown>>().notNull(),
    status: external_action_ledger_status_enum("status").notNull(),
    providerReference: varchar("providerReference", { length: 255 }),
    resultDigest: varchar("resultDigest", { length: 64 }),
    errorCode: varchar("errorCode", { length: 160 }),
    attempts: integer("attempts").default(0).notNull(),
    nextReconcileAt: timestamp("nextReconcileAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex("external_action_idempotency_idx").on(table.connectorId, table.idempotencyKey),
    statusDueIdx: index("external_action_status_due_idx").on(table.status, table.nextReconcileAt),
    taskIdx: index("external_action_task_idx").on(table.taskId),
  }),
);

// Sensitive values requested by generated bubbles are envelope-encrypted and
// referenced from the task checkpoint; plaintext never enters task JSON.
export const generatedInputSecrets = pgTable(
  "generated_input_secrets",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    taskId: bigint("taskId", { mode: "number" }).notNull(),
    userId: bigint("userId", { mode: "number" }).notNull(),
    requestId: varchar("requestId", { length: 100 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: varchar("iv", { length: 64 }).notNull(),
    authTag: varchar("authTag", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskUserIdx: index("generated_input_secret_task_user_idx").on(table.taskId, table.userId),
    expiresIdx: index("generated_input_secret_expires_idx").on(table.expiresAt),
  }),
);

export const externalWebhookEvents = pgTable(
  "external_webhook_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    provider: varchar("provider", { length: 100 }).notNull(),
    connectorId: varchar("connectorId", { length: 160 }).notNull(),
    eventKey: varchar("eventKey", { length: 255 }).notNull(),
    eventType: varchar("eventType", { length: 160 }).notNull(),
    reference: varchar("reference", { length: 255 }).notNull(),
    payloadDigest: varchar("payloadDigest", { length: 64 }).notNull(),
    status: external_webhook_events_status_enum("status").notNull(),
    actionId: varchar("actionId", { length: 64 }),
    receivedAt: timestamp("receivedAt", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processedAt", { withTimezone: true }),
  },
  (table) => ({
    providerEventIdx: uniqueIndex("external_webhook_provider_event_idx").on(table.provider, table.eventKey),
    statusIdx: index("external_webhook_status_idx").on(table.status),
    referenceIdx: index("external_webhook_reference_idx").on(table.connectorId, table.reference),
  }),
);

// ============================================
// SECURITY: Security Events (audit log)
// ============================================
export const securityEvents = pgTable(
  "security_events",
  {
    id: serial("id").primaryKey(),
    type: security_events_type_enum("type").notNull(),
    userId: varchar("userId", { length: 100 }),
    capabilityId: varchar("capabilityId", { length: 100 }),
    toolId: varchar("toolId", { length: 100 }),
    action: varchar("action", { length: 255 }).notNull(),
    result: security_events_result_enum("result")
      .default("allowed")
      .notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    typeIdx: index("security_events_type_idx").on(table.type),
    userIdIdx: index("security_events_userId_idx").on(table.userId),
    resultIdx: index("security_events_result_idx").on(table.result),
    timestampIdx: index("security_events_timestamp_idx").on(table.timestamp),
    capabilityIdIdx: index("security_events_capabilityId_idx").on(table.capabilityId),
  })
);

// ============================================
// MARKETS: Regional market configuration
// ============================================
export const markets = pgTable("markets", {
  code: varchar("code", { length: 8 }).primaryKey(),
  nameAr: varchar("nameAr", { length: 255 }).notNull(),
  nameEn: varchar("nameEn", { length: 255 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  currencySymbol: varchar("currencySymbol", { length: 16 }).notNull(),
  pricingMultiplier: doublePrecision("pricingMultiplier").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================
// BLOCK 1: ECONOMIC VALUE NETWORK (generic, domain-free)
// ============================================
export const economic_expressions_kind_enum = pgEnum("economic_expressions_kind", ["offering", "need"]);
export const economic_expressions_visibility_enum = pgEnum("economic_expressions_visibility", ["private", "unlisted", "shared", "public"]);
export const economic_expressions_status_enum = pgEnum("economic_expressions_status", ["draft", "active", "paused", "closed"]);
export const economic_matches_status_enum = pgEnum("economic_matches_status", ["candidate", "viable", "rejected", "withdrawn"]);
export const economic_engagements_state_enum = pgEnum("economic_engagements_state", ["open", "suspended", "closed"]);
export const economic_proposals_status_enum = pgEnum("economic_proposals_status", ["draft", "proposed", "countered", "accepted", "rejected", "withdrawn", "expired"]);
export const transaction_intents_status_enum = pgEnum("transaction_intents_status", ["intent", "cancelled", "fulfilled_externally"]);
export const external_action_sessions_status_enum = pgEnum("external_action_sessions_status", ["active", "used", "expired", "revoked"]);

/** Offering and Need share one typed generic core; semanticType + typed attributes carry the domain meaning. */
export const economicExpressions = pgTable(
  "economic_expressions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    kind: economic_expressions_kind_enum("kind").notNull(),
    subjectEntityId: varchar("subjectEntityId", { length: 64 }),
    semanticType: varchar("semanticType", { length: 160 }).notNull(),
    schemaRef: jsonb("schemaRef").$type<{ id: string; version: string }>(),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    hardConstraints: jsonb("hardConstraints").$type<unknown[]>().notNull().default([]),
    softPreferences: jsonb("softPreferences").$type<unknown[]>().notNull().default([]),
    availability: jsonb("availability").$type<Record<string, unknown>>(),
    visibility: economic_expressions_visibility_enum("visibility").notNull().default("private"),
    status: economic_expressions_status_enum("status").notNull().default("draft"),
    publicProjection: jsonb("publicProjection").$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerIdx: index("economic_expressions_owner_idx").on(table.ownerId),
    discoveryIdx: index("economic_expressions_discovery_idx").on(table.kind, table.visibility, table.status),
  }),
);

export const economicMatches = pgTable(
  "economic_matches",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    needId: varchar("needId", { length: 64 }).notNull(),
    offeringId: varchar("offeringId", { length: 64 }),
    compositeComponents: jsonb("compositeComponents").$type<Array<{ expressionId: string; contribution: Record<string, unknown> }>>(),
    constraintResults: jsonb("constraintResults").$type<unknown[]>().notNull().default([]),
    status: economic_matches_status_enum("status").notNull().default("candidate"),
    createdByOwnerId: varchar("createdByOwnerId", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    needIdx: index("economic_matches_need_idx").on(table.needId),
    offeringIdx: index("economic_matches_offering_idx").on(table.offeringId),
  }),
);

export const economicEngagements = pgTable(
  "economic_engagements",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    matchId: varchar("matchId", { length: 64 }),
    initiatorOwnerId: varchar("initiatorOwnerId", { length: 100 }).notNull(),
    participants: jsonb("participants").$type<string[]>().notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    state: economic_engagements_state_enum("state").notNull().default("open"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    matchIdx: index("economic_engagements_match_idx").on(table.matchId),
  }),
);

export const economicProposals = pgTable(
  "economic_proposals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    engagementId: varchar("engagementId", { length: 64 }).notNull(),
    proposerOwnerId: varchar("proposerOwnerId", { length: 100 }).notNull(),
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull(),
    termsSchemaRef: jsonb("termsSchemaRef").$type<{ id: string; version: string }>(),
    version: integer("version").notNull(),
    status: economic_proposals_status_enum("status").notNull().default("proposed"),
    supersedesId: varchar("supersedesId", { length: 64 }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    engagementIdx: index("economic_proposals_engagement_idx").on(table.engagementId),
    engagementVersionIdx: uniqueIndex("economic_proposals_engagement_version_idx").on(
      table.engagementId,
      table.version,
    ),
  }),
);

/** Accepted structured intent to exchange value. Payment is never mandatory. */
export const transactionIntents = pgTable(
  "transaction_intents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    proposalId: varchar("proposalId", { length: 64 }).notNull(),
    engagementId: varchar("engagementId", { length: 64 }).notNull(),
    participants: jsonb("participants").$type<string[]>().notNull(),
    valueKind: varchar("valueKind", { length: 32 }).notNull(),
    terms: jsonb("terms").$type<Record<string, unknown>>().notNull(),
    status: transaction_intents_status_enum("status").notNull().default("intent"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    proposalIdx: uniqueIndex("transaction_intents_proposal_idx").on(table.proposalId),
  }),
);

/** Server-created, owner/purpose-bound external provider transition sessions. */
export const externalActionSessions = pgTable(
  "external_action_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerId: varchar("ownerId", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 160 }).notNull(),
    purpose: varchar("purpose", { length: 255 }).notNull(),
    url: text("url").notNull(),
    origin: varchar("origin", { length: 255 }).notNull(),
    nonce: varchar("nonce", { length: 64 }).notNull(),
    state: varchar("state", { length: 64 }).notNull(),
    runId: varchar("runId", { length: 64 }),
    transactionIntentId: varchar("transactionIntentId", { length: 64 }),
    /** Block 3 financial binding: the PaymentIntent this checkout pays for. */
    paymentIntentId: varchar("paymentIntentId", { length: 64 }),
    status: external_action_sessions_status_enum("status").notNull().default("active"),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    usedAt: timestamp("usedAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index("external_action_sessions_owner_idx").on(table.ownerId),
    expiryIdx: index("external_action_sessions_expiry_idx").on(table.expiresAt),
  }),
);

export type EconomicExpression = typeof economicExpressions.$inferSelect;
export type EconomicMatch = typeof economicMatches.$inferSelect;
export type EconomicEngagement = typeof economicEngagements.$inferSelect;
export type EconomicProposal = typeof economicProposals.$inferSelect;
export type TransactionIntent = typeof transactionIntents.$inferSelect;
export type ExternalActionSession = typeof externalActionSessions.$inferSelect;

// ============================================
// TYPE EXPORTS
// ============================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type TaskStep = typeof taskSteps.$inferSelect;
export type NewTaskStep = typeof taskSteps.$inferInsert;

export type Capability = typeof capabilities.$inferSelect;
export type NewCapability = typeof capabilities.$inferInsert;

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;

export type ToolInvocation = typeof toolInvocations.$inferSelect;
export type NewToolInvocation = typeof toolInvocations.$inferInsert;

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;

export type Identity = typeof identities.$inferSelect;
export type NewIdentity = typeof identities.$inferInsert;

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

export type Policy = typeof policies.$inferSelect;
export type NewPolicy = typeof policies.$inferInsert;

export type MemoryEntry = typeof memoryEntries.$inferSelect;
export type NewMemoryEntry = typeof memoryEntries.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type EventSubscription = typeof eventSubscriptions.$inferSelect;
export type NewEventSubscription = typeof eventSubscriptions.$inferInsert;

export type AgentLog = typeof agentLogs.$inferSelect;
export type NewAgentLog = typeof agentLogs.$inferInsert;

export type ExecutionTrace = typeof executionTraces.$inferSelect;
export type NewExecutionTrace = typeof executionTraces.$inferInsert;

export type Bubble = typeof bubbles.$inferSelect;
export type NewBubble = typeof bubbles.$inferInsert;

export type GeneratedSystem = typeof generatedSystems.$inferSelect;
export type NewGeneratedSystem = typeof generatedSystems.$inferInsert;

export type SystemVersion = typeof systemVersions.$inferSelect;
export type NewSystemVersion = typeof systemVersions.$inferInsert;

export type DNACandidateRecord = typeof dnaCandidates.$inferSelect;
export type NewDNACandidateRecord = typeof dnaCandidates.$inferInsert;

export type DNAVersionRecord = typeof dnaVersions.$inferSelect;
export type NewDNAVersionRecord = typeof dnaVersions.$inferInsert;

export type DNAGenomeSnapshotRecord = typeof dnaGenomeSnapshots.$inferSelect;
export type NewDNAGenomeSnapshotRecord = typeof dnaGenomeSnapshots.$inferInsert;

export type DNAExecutionEvidenceRecord = typeof dnaExecutionEvidence.$inferSelect;
export type NewDNAExecutionEvidenceRecord = typeof dnaExecutionEvidence.$inferInsert;

export type CoreKernelBaselineRecord = typeof coreKernelBaselines.$inferSelect;
export type NewCoreKernelBaselineRecord = typeof coreKernelBaselines.$inferInsert;

export type CorePatchCandidateRecord = typeof corePatchCandidates.$inferSelect;
export type NewCorePatchCandidateRecord = typeof corePatchCandidates.$inferInsert;

/**
 * Block 1.1 — externally discovered capability provider catalog.
 * NATIVE providers live in code (auto-registered from trusted handlers) and
 * are NOT persisted here; this table persists normalized external candidates
 * (MCP/A2A/…) with trust classification, freshness, and provenance.
 */
export const capabilityProviderCatalog = pgTable(
  "capability_provider_catalog",
  {
    id: varchar("id", { length: 96 }).primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(),
    capabilityId: varchar("capabilityId", { length: 128 }),
    implementationId: varchar("implementationId", { length: 128 }).notNull(),
    protocol: varchar("protocol", { length: 32 }),
    protocolVersion: varchar("protocolVersion", { length: 64 }),
    trustClass: varchar("trustClass", { length: 32 })
      .notNull()
      .default("UNTRUSTED_CANDIDATE"),
    availabilityState: varchar("availabilityState", { length: 16 })
      .notNull()
      .default("UNKNOWN"),
    availabilityObservedAt: timestamp("availabilityObservedAt", { withTimezone: true }),
    costClass: varchar("costClass", { length: 16 }).notNull().default("UNKNOWN"),
    latencyClass: varchar("latencyClass", { length: 16 }).notNull().default("UNKNOWN"),
    ioMetadata: jsonb("ioMetadata")
      .$type<{
        inputSpec?: unknown[];
        outputSpec?: unknown[];
        endpoint?: string;
        /** Trusted boot-time configuration; never populated from discovery. */
        receiptSecret?: string;
        /** Trusted boot-time webhook authentication secret; never from discovery. */
        webhookSecret?: string;
      }>()
      .notNull()
      .default({}),
    /** Provider descriptions are DATA — never instructions, never trust. */
    description: text("description"),
    provenance: jsonb("provenance")
      .$type<{ source: string; reference?: string }>()
      .notNull(),
    discoveredAt: timestamp("discoveredAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    refreshedAt: timestamp("refreshedAt", { withTimezone: true }),
    /** Stale metadata must never silently authorize execution. */
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    schemaHash: varchar("schemaHash", { length: 128 }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    capabilityIdx: index("capability_provider_catalog_capability_idx").on(
      table.capabilityId,
    ),
  }),
);

export type CorePatchEventRecord = typeof corePatchEvents.$inferSelect;
export type NewCorePatchEventRecord = typeof corePatchEvents.$inferInsert;

export type RuntimeJobRecord = typeof runtimeJobs.$inferSelect;
export type NewRuntimeJobRecord = typeof runtimeJobs.$inferInsert;
export type RuntimeJobEventRecord = typeof runtimeJobEvents.$inferSelect;
export type NewRuntimeJobEventRecord = typeof runtimeJobEvents.$inferInsert;

export type CapabilityReleaseBindingRecord = typeof capabilityReleaseBindings.$inferSelect;
export type NewCapabilityReleaseBindingRecord = typeof capabilityReleaseBindings.$inferInsert;

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type NewSecurityEvent = typeof securityEvents.$inferInsert;

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;

export type CapabilityProviderCatalogRecord = typeof capabilityProviderCatalog.$inferSelect;
export type NewCapabilityProviderCatalogRecord = typeof capabilityProviderCatalog.$inferInsert;

// Merged runtime tables (runs, DAG, proposals, approvals, receipts)
export * from "./schema-runtime";
export * from "./schema-block2";
export * from "./schema-block3";
export * from "./schema-block31";
