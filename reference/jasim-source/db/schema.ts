import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  float,
  json,
  boolean,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ============================================
// CORE: Users (generic auth)
// ============================================
export const users = mysqlTable(
  "users",
  {
    id: serial("id").primaryKey(),
    unionId: varchar("unionId", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 320 }),
    avatar: text("avatar"),
    role: mysqlEnum("role", ["user", "admin", "agent", "system"])
      .default("user")
      .notNull(),
    status: mysqlEnum("status", ["active", "inactive", "suspended", "banned"])
      .default("active")
      .notNull(),
    preferences: json("preferences").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const conversations = mysqlTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    title: varchar("title", { length: 255 }),
    status: mysqlEnum("status", ["active", "archived", "closed", "error"])
      .default("active")
      .notNull(),
    context: json("context").$type<Record<string, unknown>>(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const messages = mysqlTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversationId", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    role: mysqlEnum("role", ["user", "assistant", "system", "tool", "agent"])
      .notNull(),
    content: text("content").notNull(),
    intent: varchar("intent", { length: 100 }),
    taskId: bigint("taskId", { mode: "number", unsigned: true }),
    bubbleData: json("bubbleData").$type<Record<string, unknown>>(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    conversationIdIdx: index("messages_conversationId_idx").on(
      table.conversationId
    ),
    taskIdIdx: index("messages_taskId_idx").on(table.taskId),
    roleIdx: index("messages_role_idx").on(table.role),
    createdAtIdx: index("messages_createdAt_idx").on(table.createdAt),
  })
);

// ============================================
// RUNTIME: Tasks (generic task execution)
// ============================================
export const tasks = mysqlTable(
  "tasks",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    conversationId: bigint("conversationId", {
      mode: "number",
      unsigned: true,
    }),
    goal: text("goal").notNull(),
    intent: varchar("intent", { length: 100 }),
    context: json("context").$type<Record<string, unknown>>(),
    entities: json("entities").$type<Record<string, unknown>>(),
    constraints: json("constraints").$type<Record<string, unknown>>(),
    collectedData: json("collectedData").$type<Record<string, unknown>>(),
    missingData: json("missingData").$type<string[]>(),
    plan: json("plan").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", [
      "pending",
      "planning",
      "running",
      "paused",
      "waiting_approval",
      "waiting_input",
      "completed",
      "failed",
      "cancelled",
    ])
      .default("pending")
      .notNull(),
    priority: mysqlEnum("priority", ["low", "normal", "high", "critical"])
      .default("normal")
      .notNull(),
    currentStepId: bigint("currentStepId", {
      mode: "number",
      unsigned: true,
    }),
    capabilities: json("capabilities").$type<string[]>(),
    agents: json("agents").$type<string[]>(),
    tools: json("tools").$type<string[]>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    errors: json("errors").$type<Array<Record<string, unknown>>>(),
    history: json("history").$type<Array<Record<string, unknown>>>(),
    parentTaskId: bigint("parentTaskId", {
      mode: "number",
      unsigned: true,
    }),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
  })
);

// ============================================
// RUNTIME: Task Steps (individual plan steps)
// ============================================
export const taskSteps = mysqlTable(
  "task_steps",
  {
    id: serial("id").primaryKey(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: mysqlEnum("type", [
      "action",
      "decision",
      "approval",
      "tool_call",
      "agent_call",
      "human_input",
      "wait",
      "compensation",
      "error_handler",
    ])
      .default("action")
      .notNull(),
    status: mysqlEnum("status", [
      "pending",
      "running",
      "waiting",
      "completed",
      "failed",
      "skipped",
      "cancelled",
    ])
      .default("pending")
      .notNull(),
    dependencies: json("dependencies").$type<string[]>(),
    inputs: json("inputs").$type<Record<string, unknown>>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    error: text("error"),
    retryCount: int("retryCount").default(0),
    maxRetries: int("maxRetries").default(3),
    agentId: varchar("agentId", { length: 100 }),
    capabilityId: bigint("capabilityId", {
      mode: "number",
      unsigned: true,
    }),
    toolId: bigint("toolId", { mode: "number", unsigned: true }),
    approvalId: bigint("approvalId", {
      mode: "number",
      unsigned: true,
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const capabilities = mysqlTable(
  "capabilities",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    version: varchar("version", { length: 20 }).default("1.0.0"),
    inputSchema: json("inputSchema").$type<Record<string, unknown>>(),
    outputSchema: json("outputSchema").$type<Record<string, unknown>>(),
    requirements: json("requirements").$type<string[]>(),
    permissions: json("permissions").$type<string[]>(),
    riskLevel: mysqlEnum("riskLevel", ["none", "low", "medium", "high", "critical"])
      .default("low")
      .notNull(),
    sideEffects: json("sideEffects").$type<
      Array<{ type: string; description: string; reversible: boolean }>
    >(),
    executionHandler: varchar("executionHandler", { length: 255 }),
    validationRules: json("validationRules").$type<Record<string, unknown>>(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    isActive: boolean("isActive").default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const tools = mysqlTable(
  "tools",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    inputSchema: json("inputSchema").$type<Record<string, unknown>>(),
    outputSchema: json("outputSchema").$type<Record<string, unknown>>(),
    permissions: json("permissions").$type<string[]>(),
    sideEffects: mysqlEnum("sideEffects", ["none", "read", "write", "destructive"])
      .default("none")
      .notNull(),
    authentication: json("authentication").$type<Record<string, unknown>>(),
    timeout: int("timeout").default(30000),
    retryPolicy: json("retryPolicy").$type<{
      maxRetries: number;
      backoff: string;
      retryableErrors: string[];
    }>(),
    executor: varchar("executor", { length: 255 }),
    isActive: boolean("isActive").default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const toolInvocations = mysqlTable(
  "tool_invocations",
  {
    id: serial("id").primaryKey(),
    toolId: bigint("toolId", { mode: "number", unsigned: true }).notNull(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }),
    stepId: bigint("stepId", { mode: "number", unsigned: true }),
    inputs: json("inputs").$type<Record<string, unknown>>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "timeout",
    ])
      .default("pending")
      .notNull(),
    duration: int("duration"),
    error: text("error"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const entities = mysqlTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    attributes: json("attributes").$type<Record<string, unknown>>(),
    relationships: json("relationships").$type<
      Array<{
        entityId: number;
        type: string;
        metadata?: Record<string, unknown>;
      }>
    >(),
    capabilities: json("capabilities").$type<string[]>(),
    identityId: bigint("identityId", { mode: "number", unsigned: true }),
    reputation: json("reputation").$type<{
      score: number;
      reviews: number;
      trustLevel: string;
    }>(),
    availability: json("availability").$type<Record<string, unknown>>(),
    permissions: json("permissions").$type<string[]>(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const identities = mysqlTable(
  "identities",
  {
    id: serial("id").primaryKey(),
    entityId: bigint("entityId", { mode: "number", unsigned: true }).notNull(),
    type: mysqlEnum("type", [
      "user",
      "agent",
      "system",
      "service",
      "organization",
      "device",
    ])
      .default("user")
      .notNull(),
    credentials: json("credentials").$type<Record<string, unknown>>(),
    verified: boolean("verified").default(false),
    permissions: json("permissions").$type<string[]>(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const approvals = mysqlTable(
  "approvals",
  {
    id: serial("id").primaryKey(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }).notNull(),
    stepId: bigint("stepId", { mode: "number", unsigned: true }),
    action: varchar("action", { length: 255 }).notNull(),
    actor: varchar("actor", { length: 255 }),
    permission: varchar("permission", { length: 100 }),
    policy: json("policy").$type<Record<string, unknown>>(),
    riskLevel: mysqlEnum("riskLevel", ["none", "low", "medium", "high", "critical"])
      .default("low")
      .notNull(),
    required: boolean("required").default(true),
    approved: boolean("approved"),
    approvedBy: bigint("approvedBy", { mode: "number", unsigned: true }),
    approvedAt: timestamp("approvedAt"),
    expiresAt: timestamp("expiresAt"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const policies = mysqlTable(
  "policies",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull().unique(),
    description: text("description"),
    rules: json("rules").$type<
      Array<{
        condition: Record<string, unknown>;
        action: string;
        effect: "allow" | "deny";
      }>
    >(),
    scope: mysqlEnum("scope", [
      "global",
      "task",
      "capability",
      "tool",
      "user",
      "entity",
    ])
      .default("global")
      .notNull(),
    priority: int("priority").default(0),
    isActive: boolean("isActive").default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const memoryEntries = mysqlTable(
  "memory_entries",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }),
    taskId: bigint("taskId", { mode: "number", unsigned: true }),
    entityId: bigint("entityId", { mode: "number", unsigned: true }),
    scope: mysqlEnum("scope", ["global", "user", "task", "conversation", "entity", "system"])
      .default("global")
      .notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    value: json("value").$type<unknown>(),
    permissions: json("permissions").$type<string[]>(),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
export const events = mysqlTable(
  "events",
  {
    id: serial("id").primaryKey(),
    type: varchar("type", { length: 100 }).notNull(),
    source: varchar("source", { length: 100 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    priority: mysqlEnum("priority", ["low", "normal", "high", "critical"])
      .default("normal")
      .notNull(),
    processed: boolean("processed").default(false),
    processedAt: timestamp("processedAt"),
    correlationId: varchar("correlationId", { length: 100 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
  })
);

// ============================================
// EVENTS: Event Subscriptions
// ============================================
export const eventSubscriptions = mysqlTable(
  "event_subscriptions",
  {
    id: serial("id").primaryKey(),
    eventType: varchar("eventType", { length: 100 }).notNull(),
    filter: json("filter").$type<Record<string, unknown>>(),
    handler: varchar("handler", { length: 255 }).notNull(),
    active: boolean("active").default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const agentLogs = mysqlTable(
  "agent_logs",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agentId", { length: 100 }).notNull(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }),
    stepId: bigint("stepId", { mode: "number", unsigned: true }),
    capability: varchar("capability", { length: 100 }),
    tool: varchar("tool", { length: 100 }),
    inputs: json("inputs").$type<Record<string, unknown>>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    duration: int("duration"),
    status: mysqlEnum("status", [
      "started",
      "completed",
      "failed",
      "error",
    ])
      .default("started")
      .notNull(),
    error: text("error"),
    tokensUsed: int("tokensUsed").default(0),
    cost: float("cost").default(0),
    model: varchar("model", { length: 100 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const executionTraces = mysqlTable(
  "execution_traces",
  {
    id: serial("id").primaryKey(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }).notNull(),
    stepId: bigint("stepId", { mode: "number", unsigned: true }),
    agentId: varchar("agentId", { length: 100 }),
    capabilityId: bigint("capabilityId", {
      mode: "number",
      unsigned: true,
    }),
    toolId: bigint("toolId", { mode: "number", unsigned: true }),
    inputs: json("inputs").$type<Record<string, unknown>>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    duration: int("duration"),
    status: mysqlEnum("status", [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
      "timeout",
    ])
      .default("pending")
      .notNull(),
    error: text("error"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
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
export const bubbles = mysqlTable(
  "bubbles",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }),
    conversationId: bigint("conversationId", {
      mode: "number",
      unsigned: true,
    }),
    type: varchar("type", { length: 50 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    schema: json("schema").$type<Record<string, unknown>>(),
    data: json("data").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", ["active", "inactive", "dismissed", "completed"])
      .default("active")
      .notNull(),
    position: json("position").$type<{
      x?: number;
      y?: number;
      z?: number;
      pinned?: boolean;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
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
  })
);

// ============================================
// GENERATED: Generated SaaS / Experience Systems
// ============================================
export const generatedSystems = mysqlTable(
  "generated_systems",
  {
    id: serial("id").primaryKey(),
    worldKey: varchar("worldKey", { length: 160 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    version: varchar("version", { length: 20 }).default("1.0.0"),
    ownerId: bigint("ownerId", { mode: "number", unsigned: true }).notNull(),
    continuity: mysqlEnum("continuity", ["persistent", "evolving"]),
    visibility: mysqlEnum("visibility", ["private", "public", "shared"]).default("private"),
    sourceTaskId: bigint("sourceTaskId", { mode: "number", unsigned: true }),
    conversationId: bigint("conversationId", { mode: "number", unsigned: true }),
    capabilities: json("capabilities").$type<string[]>(),
    schema: json("schema").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", [
      "draft",
      "generating",
      "active",
      "paused",
      "deprecated",
      "archived",
    ])
      .default("draft")
      .notNull(),
    config: json("config").$type<Record<string, unknown>>(),
    archivedAt: timestamp("archivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerIdIdx: index("generated_systems_ownerId_idx").on(table.ownerId),
    statusIdx: index("generated_systems_status_idx").on(table.status),
    nameIdx: index("generated_systems_name_idx").on(table.name),
    worldKeyIdx: uniqueIndex("generated_systems_world_key_idx").on(table.ownerId, table.worldKey),
    conversationIdx: index("generated_systems_conversation_idx").on(table.conversationId),
  })
);

// ============================================
// GENERATED: Versioned Generated Systems
// ============================================
export const systemVersions = mysqlTable(
  "system_versions",
  {
    id: serial("id").primaryKey(),
    systemId: bigint("systemId", { mode: "number", unsigned: true }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    status: mysqlEnum("status", ["draft", "active", "retired", "rolled_back"]).default("draft").notNull(),
    parentVersion: varchar("parentVersion", { length: 20 }),
    contentDigest: varchar("contentDigest", { length: 64 }),
    changeRequest: text("changeRequest"),
    requestKey: varchar("requestKey", { length: 128 }),
    createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
    schema: json("schema").$type<Record<string, unknown>>(),
    state: json("state").$type<Record<string, unknown>>(),
    migration: json("migration").$type<{
      fromVersion: string;
      changes: Array<Record<string, unknown>>;
      rollback: Array<Record<string, unknown>>;
    }>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    activatedAt: timestamp("activatedAt"),
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
export const dnaCandidates = mysqlTable(
  "dna_candidates",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    sourceDigest: varchar("sourceDigest", { length: 64 }).notNull(),
    kind: mysqlEnum("kind", [
      "knowledge",
      "workflow",
      "capability",
      "policy",
      "ui",
      "world",
      "core_patch",
    ]).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    summary: text("summary").notNull(),
    status: mysqlEnum("status", [
      "candidate",
      "evaluating",
      "approved",
      "canary",
      "active",
      "rejected",
      "retired",
    ]).default("candidate").notNull(),
    proposal: json("proposal").$type<Record<string, unknown>>().notNull(),
    source: json("source").$type<Record<string, unknown>>().notNull(),
    warnings: json("warnings").$type<string[]>().notNull(),
    evaluations: json("evaluations").$type<Array<Record<string, unknown>>>().notNull(),
    approvedBy: varchar("approvedBy", { length: 100 }),
    approvedAt: timestamp("approvedAt"),
    rejectionReason: text("rejectionReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
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
export const dnaVersions = mysqlTable(
  "dna_versions",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    geneId: varchar("geneId", { length: 255 }).notNull(),
    candidateId: varchar("candidateId", { length: 100 }).notNull(),
    version: varchar("version", { length: 20 }).notNull(),
    kind: mysqlEnum("kind", [
      "knowledge",
      "workflow",
      "capability",
      "policy",
      "ui",
      "world",
    ]).notNull(),
    status: mysqlEnum("status", ["canary", "active", "retired"]).default("canary").notNull(),
    proposal: json("proposal").$type<Record<string, unknown>>().notNull(),
    source: json("source").$type<Record<string, unknown>>().notNull(),
    lineage: json("lineage").$type<Record<string, unknown>>().notNull(),
    fitness: json("fitness").$type<Record<string, unknown>>().notNull(),
    activatedBy: varchar("activatedBy", { length: 100 }).notNull(),
    activatedAt: timestamp("activatedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
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
export const dnaGenomeSnapshots = mysqlTable(
  "dna_genome_snapshots",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    digest: varchar("digest", { length: 64 }).notNull(),
    geneVersionIds: json("geneVersionIds").$type<string[]>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    digestIdx: uniqueIndex("dna_genome_snapshots_digest_idx").on(table.digest),
  }),
);

// ============================================
// GENERATIVE DNA: Evidence used for fitness
// ============================================
export const dnaExecutionEvidence = mysqlTable(
  "dna_execution_evidence",
  {
    id: serial("id").primaryKey(),
    versionId: varchar("versionId", { length: 100 }).notNull(),
    success: boolean("success").notNull(),
    verified: boolean("verified").notNull(),
    latencyMs: int("latencyMs").notNull(),
    cost: float("cost").default(0).notNull(),
    safetyIncident: boolean("safetyIncident").default(false).notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  },
  (table) => ({
    versionIdIdx: index("dna_execution_evidence_version_id_idx").on(table.versionId),
    recordedAtIdx: index("dna_execution_evidence_recorded_at_idx").on(table.recordedAt),
  }),
);

// ============================================
// CORE EVOLUTION LAB: Immutable kernel baselines
// ============================================
export const coreKernelBaselines = mysqlTable(
  "core_kernel_baselines",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    version: varchar("version", { length: 20 }).notNull(),
    kernelDigest: varchar("kernelDigest", { length: 64 }).notNull(),
    manifestDigest: varchar("manifestDigest", { length: 64 }).notNull(),
    testSuiteDigest: varchar("testSuiteDigest", { length: 64 }).notNull(),
    artifactRef: varchar("artifactRef", { length: 500 }),
    status: mysqlEnum("status", ["active", "superseded"]).default("active").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const corePatchCandidates = mysqlTable(
  "core_patch_candidates",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    dnaCandidateId: varchar("dnaCandidateId", { length: 100 }).notNull(),
    baseBaselineId: varchar("baseBaselineId", { length: 100 }).notNull(),
    targetVersion: varchar("targetVersion", { length: 20 }).notNull(),
    sourceDigest: varchar("sourceDigest", { length: 64 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: text("summary").notNull(),
    risk: mysqlEnum("risk", ["critical"]).default("critical").notNull(),
    status: mysqlEnum("status", [
      "submitted",
      "evaluating",
      "rejected",
      "approved_for_build",
      "built",
      "signed",
      "shadow",
      "canary",
      "active",
      "rolled_back",
      "quarantined",
    ]).default("submitted").notNull(),
    scope: json("scope").$type<string[]>().notNull(),
    declaredEffects: json("declaredEffects").$type<string[]>().notNull(),
    testPlan: json("testPlan").$type<string[]>().notNull(),
    rollbackPlan: json("rollbackPlan").$type<string[]>().notNull(),
    requiredGates: json("requiredGates").$type<string[]>().notNull(),
    gateResults: json("gateResults").$type<Array<Record<string, unknown>>>().notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
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
export const corePatchEvents = mysqlTable(
  "core_patch_events",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    candidateId: varchar("candidateId", { length: 100 }).notNull(),
    eventType: mysqlEnum("eventType", ["submitted", "gate_recorded", "transitioned"]).notNull(),
    previousStatus: varchar("previousStatus", { length: 40 }),
    nextStatus: varchar("nextStatus", { length: 40 }).notNull(),
    actor: varchar("actor", { length: 100 }).notNull(),
    evidence: json("evidence").$type<Record<string, unknown>>().notNull(),
    eventDigest: varchar("eventDigest", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
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
export const runtimeJobs = mysqlTable(
  "runtime_jobs",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    kind: varchar("kind", { length: 160 }).notNull(),
    subjectType: varchar("subjectType", { length: 100 }).notNull(),
    subjectId: varchar("subjectId", { length: 160 }).notNull(),
    payloadSchemaVersion: int("payloadSchemaVersion").notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
    status: mysqlEnum("status", ["queued", "claimed", "running", "succeeded", "failed", "timed_out", "cancelled", "quarantined"]).notNull(),
    priority: int("priority").default(0).notNull(),
    attempts: int("attempts").default(0).notNull(),
    maxAttempts: int("maxAttempts").default(3).notNull(),
    timeoutMs: int("timeoutMs").default(600000).notNull(),
    availableAt: timestamp("availableAt").notNull(),
    leaseOwner: varchar("leaseOwner", { length: 160 }),
    leaseToken: varchar("leaseToken", { length: 160 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    cancellationRequestedAt: timestamp("cancellationRequestedAt"),
    result: json("result").$type<Record<string, unknown>>(),
    errorCode: varchar("errorCode", { length: 160 }),
    errorSummary: text("errorSummary"),
    revision: int("revision").default(0).notNull(),
    createdBy: varchar("createdBy", { length: 100 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex("runtime_jobs_kind_idempotency_idx").on(table.kind, table.idempotencyKey),
    claimIdx: index("runtime_jobs_claim_idx").on(table.status, table.availableAt, table.priority),
    leaseIdx: index("runtime_jobs_lease_idx").on(table.status, table.leaseExpiresAt),
    subjectIdx: index("runtime_jobs_subject_idx").on(table.subjectType, table.subjectId),
  }),
);

export const runtimeJobEvents = mysqlTable(
  "runtime_job_events",
  {
    id: varchar("id", { length: 100 }).primaryKey(),
    jobId: varchar("jobId", { length: 100 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    actor: varchar("actor", { length: 160 }).notNull(),
    previousStatus: varchar("previousStatus", { length: 40 }),
    nextStatus: varchar("nextStatus", { length: 40 }).notNull(),
    detail: json("detail").$type<Record<string, unknown>>().notNull(),
    previousEventDigest: varchar("previousEventDigest", { length: 64 }),
    eventDigest: varchar("eventDigest", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    jobCreatedIdx: index("runtime_job_events_job_created_idx").on(table.jobId, table.createdAt),
    digestIdx: uniqueIndex("runtime_job_events_digest_idx").on(table.eventDigest),
  }),
);

// ============================================
// GENERATIVE DNA: Durable signed capability releases
// ============================================
export const capabilityReleaseBindings = mysqlTable(
  "capability_release_bindings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    packageId: varchar("packageId", { length: 128 }).notNull(),
    packageVersion: varchar("packageVersion", { length: 20 }).notNull(),
    packageDigest: varchar("packageDigest", { length: 64 }).notNull(),
    capabilityId: varchar("capabilityId", { length: 200 }).notNull(),
    candidateId: varchar("candidateId", { length: 100 }).notNull(),
    geneVersionId: varchar("geneVersionId", { length: 100 }),
    status: mysqlEnum("status", ["canary", "active", "disabled", "quarantined"]).notNull(),
    sandboxProvider: varchar("sandboxProvider", { length: 160 }).notNull(),
    signingKeyId: varchar("signingKeyId", { length: 160 }).notNull(),
    binding: json("binding").$type<Record<string, unknown>>().notNull(),
    envelope: json("envelope").$type<Record<string, unknown>>().notNull(),
    storedAt: timestamp("storedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
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
export const externalActionLedger = mysqlTable(
  "external_action_ledger",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    connectorId: varchar("connectorId", { length: 160 }).notNull(),
    capabilityId: varchar("capabilityId", { length: 160 }).notNull(),
    effect: mysqlEnum("effect", ["none", "read", "write", "external_change", "financial"]).notNull(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    planId: varchar("planId", { length: 160 }).notNull(),
    worldId: varchar("worldId", { length: 160 }),
    stepId: varchar("stepId", { length: 160 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    approvalId: varchar("approvalId", { length: 100 }),
    inputDigest: varchar("inputDigest", { length: 64 }).notNull(),
    reconciliationData: json("reconciliationData").$type<Record<string, unknown>>().notNull(),
    status: mysqlEnum("status", ["prepared", "executing", "succeeded", "failed", "uncertain", "reconciling", "manual_review"]).notNull(),
    providerReference: varchar("providerReference", { length: 255 }),
    resultDigest: varchar("resultDigest", { length: 64 }),
    errorCode: varchar("errorCode", { length: 160 }),
    attempts: int("attempts").default(0).notNull(),
    nextReconcileAt: timestamp("nextReconcileAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex("external_action_idempotency_idx").on(table.connectorId, table.idempotencyKey),
    statusDueIdx: index("external_action_status_due_idx").on(table.status, table.nextReconcileAt),
    taskIdx: index("external_action_task_idx").on(table.taskId),
  }),
);

// Sensitive values requested by generated bubbles are envelope-encrypted and
// referenced from the task checkpoint; plaintext never enters task JSON.
export const generatedInputSecrets = mysqlTable(
  "generated_input_secrets",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    taskId: bigint("taskId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    requestId: varchar("requestId", { length: 100 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: varchar("iv", { length: 64 }).notNull(),
    authTag: varchar("authTag", { length: 64 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    taskUserIdx: index("generated_input_secret_task_user_idx").on(table.taskId, table.userId),
    expiresIdx: index("generated_input_secret_expires_idx").on(table.expiresAt),
  }),
);

export const externalWebhookEvents = mysqlTable(
  "external_webhook_events",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    provider: varchar("provider", { length: 100 }).notNull(),
    connectorId: varchar("connectorId", { length: 160 }).notNull(),
    eventKey: varchar("eventKey", { length: 255 }).notNull(),
    eventType: varchar("eventType", { length: 160 }).notNull(),
    reference: varchar("reference", { length: 255 }).notNull(),
    payloadDigest: varchar("payloadDigest", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["received", "applied", "unmatched", "ignored"]).notNull(),
    actionId: varchar("actionId", { length: 64 }),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
    processedAt: timestamp("processedAt"),
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
export const securityEvents = mysqlTable(
  "security_events",
  {
    id: serial("id").primaryKey(),
    type: mysqlEnum("type", [
      "permission_denied",
      "risk_gate_triggered",
      "approval_required",
      "approval_granted",
      "approval_denied",
      "policy_violation",
      "side_effect_executed",
      "authentication_failure",
      "suspicious_activity",
    ]).notNull(),
    userId: varchar("userId", { length: 100 }),
    capabilityId: varchar("capabilityId", { length: 100 }),
    toolId: varchar("toolId", { length: 100 }),
    action: varchar("action", { length: 255 }).notNull(),
    result: mysqlEnum("result", ["allowed", "denied", "pending_approval"])
      .default("allowed")
      .notNull(),
    reason: text("reason"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
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
