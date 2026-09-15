import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { jasimRuntimeConversations } from "./jasim-conversations";
import { jasimRuntimeBubbles, jasimRuntimeMessages } from "./jasim-conversations";
import { z } from "zod/v4";
import { jasimRuntimeWorlds } from "./jasim-worlds";

export type RuntimeActionRecord = {
  id: string;
  label: string;
  kind: "provide_input" | "approve" | "execute";
  requiresApproval: boolean;
  status: "ready" | "pending" | "completed" | "blocked";
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

export const jasimRuntimeTasks = pgTable("jasim_runtime_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: text("owner_id").notNull(),
  conversationId: text("conversation_id"),
  worldId: uuid("world_id").references(() => jasimRuntimeWorlds.id, {
    onDelete: "set null",
  }),
  bubbleId: uuid("bubble_id").references(() => jasimRuntimeBubbles.id, {
    onDelete: "set null",
  }),
  goal: text("goal").notNull(),
  status: text("status").notNull(),
  world: jsonb("world").$type<RuntimeWorldRecord>().notNull(),
  actions: jsonb("actions").$type<RuntimeActionRecord[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const jasimRuntimeEvents = pgTable("jasim_runtime_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => jasimRuntimeTasks.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jasimRuntimeActionReceipts = pgTable("jasim_runtime_action_receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => jasimRuntimeTasks.id, { onDelete: "cascade" }),
  actionId: text("action_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jasimRuntimeRuns = pgTable(
  "jasim_runtime_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    conversationId: uuid("conversation_id").references(
      () => jasimRuntimeConversations.id,
      { onDelete: "set null" },
    ),
    bubbleId: uuid("bubble_id").references(() => jasimRuntimeBubbles.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => jasimRuntimeTasks.id, {
      onDelete: "set null",
    }),
    goal: text("goal").notNull(),
    status: text("status").notNull(),
    executionGraph: jsonb("execution_graph")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    currentState: jsonb("current_state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    outputs: jsonb("outputs").$type<Record<string, unknown>>().notNull().default({}),
    requiredCapabilities: text("required_capabilities").array().notNull().default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    resumeAt: timestamp("resume_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("jasim_runtime_runs_owner_idx").on(table.ownerId),
    index("jasim_runtime_runs_conversation_idx").on(table.conversationId),
    index("jasim_runtime_runs_bubble_idx").on(table.bubbleId),
    uniqueIndex("jasim_runtime_runs_owner_idempotency_idx").on(
      table.ownerId,
      table.idempotencyKey,
    ),
  ],
);

export const jasimRuntimeRunEvents = pgTable(
  "jasim_runtime_run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => jasimRuntimeRuns.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("jasim_runtime_run_events_run_idx").on(table.runId, table.createdAt),
    index("jasim_runtime_run_events_owner_idx").on(table.ownerId),
  ],
);

export const jasimRuntimeDagNodes = pgTable(
  "jasim_runtime_dag_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => jasimRuntimeRuns.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    nodeKey: text("node_key").notNull(),
    proposalId: uuid("proposal_id").references(() => jasimRuntimeExecutionProposals.id, {
      onDelete: "set null",
    }),
    capabilityId: text("capability_id"),
    proposalFingerprint: text("proposal_fingerprint"),
    nodeType: text("node_type").notNull().default("capability"),
    status: text("status").notNull().default("PENDING"),
    inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb("output").$type<Record<string, unknown> | null>(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fenceVersion: integer("fence_version").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorSummary: text("last_error_summary"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("jasim_runtime_dag_nodes_run_key_idx").on(table.runId, table.nodeKey),
    index("jasim_runtime_dag_nodes_owner_idx").on(table.ownerId),
    index("jasim_runtime_dag_nodes_ready_idx").on(
      table.ownerId,
      table.runId,
      table.status,
      table.nextAttemptAt,
    ),
    index("jasim_runtime_dag_nodes_lease_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const jasimRuntimeDagDependencies = pgTable(
  "jasim_runtime_dag_dependencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => jasimRuntimeRuns.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    upstreamNodeId: uuid("upstream_node_id")
      .notNull()
      .references(() => jasimRuntimeDagNodes.id, { onDelete: "cascade" }),
    downstreamNodeId: uuid("downstream_node_id")
      .notNull()
      .references(() => jasimRuntimeDagNodes.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type").notNull().default("SUCCESS_REQUIRED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("jasim_runtime_dag_dependencies_edge_idx").on(
      table.runId,
      table.upstreamNodeId,
      table.downstreamNodeId,
    ),
    index("jasim_runtime_dag_dependencies_downstream_idx").on(table.downstreamNodeId),
    index("jasim_runtime_dag_dependencies_owner_idx").on(table.ownerId),
  ],
);

export const jasimRuntimeExecutionProposals = pgTable(
  "jasim_runtime_execution_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    conversationId: uuid("conversation_id").references(() => jasimRuntimeConversations.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").references(() => jasimRuntimeRuns.id, { onDelete: "set null" }),
    bubbleId: uuid("bubble_id").references(() => jasimRuntimeBubbles.id, {
      onDelete: "set null",
    }),
    worldId: uuid("world_id").references(() => jasimRuntimeWorlds.id, { onDelete: "set null" }),
    sourceMessageId: uuid("source_message_id").references(() => jasimRuntimeMessages.id, {
      onDelete: "set null",
    }),
    intentType: text("intent_type").notNull(),
    targetReferences: jsonb("target_references")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    capabilityId: text("capability_id"),
    capabilityVersion: text("capability_version"),
    normalizedInputs: jsonb("normalized_inputs")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    riskLevel: text("risk_level").notNull(),
    sideEffectType: text("side_effect_type").notNull(),
    policyContext: jsonb("policy_context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    policyDecision: text("policy_decision").notNull(),
    approvalRequired: boolean("approval_required").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull(),
    dependencies: uuid("dependencies").array().notNull().default([]),
    version: text("version").notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("jasim_runtime_proposals_owner_idx").on(table.ownerId),
    index("jasim_runtime_proposals_run_idx").on(table.runId),
    index("jasim_runtime_proposals_conversation_idx").on(table.conversationId),
    index("jasim_runtime_proposals_fingerprint_idx").on(table.ownerId, table.fingerprint),
  ],
);

export const jasimRuntimeProposalApprovals = pgTable(
  "jasim_runtime_proposal_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => jasimRuntimeExecutionProposals.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    executionFingerprint: text("execution_fingerprint").notNull(),
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("jasim_runtime_approvals_owner_idx").on(table.ownerId),
    index("jasim_runtime_approvals_proposal_idx").on(table.proposalId),
  ],
);

export const jasimRuntimeProposalEvents = pgTable(
  "jasim_runtime_proposal_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => jasimRuntimeExecutionProposals.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("jasim_runtime_proposal_events_proposal_idx").on(table.proposalId, table.createdAt),
    index("jasim_runtime_proposal_events_owner_idx").on(table.ownerId),
  ],
);

export const insertJasimRuntimeTaskSchema = createInsertSchema(
  jasimRuntimeTasks,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertJasimRuntimeTask = z.infer<
  typeof insertJasimRuntimeTaskSchema
>;
export type JasimRuntimeTask = typeof jasimRuntimeTasks.$inferSelect;