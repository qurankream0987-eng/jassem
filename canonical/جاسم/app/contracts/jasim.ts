/**
 * JASIM — Main Contract File
 * Shared TypeScript types for the General Generative Executable Agent system.
 * Used by both frontend and backend. All types are GENERIC — no domain-specific types.
 */

import type {
  TASK_STATUSES,
  TASK_PRIORITIES,
  CAPABILITY_RISK_LEVELS,
  CAPABILITY_SIDE_EFFECTS,
  AGENT_STATUSES,
  ENTITY_TYPES,
  COMMERCE_ACTIONS,
  MEMORY_SCOPES,
  MEMORY_CATEGORIES,
  EVENT_TYPES,
  BUBBLE_TYPES,
  DNA_PRIMITIVES,
  MESSAGE_ROLES,
  EXECUTION_STATUSES,
} from './constants';

// Re-export values for runtime usage
export {
  DNA_PRIMITIVES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  CAPABILITY_RISK_LEVELS,
  CAPABILITY_SIDE_EFFECTS,
  AGENT_STATUSES,
  ENTITY_TYPES,
  COMMERCE_ACTIONS,
  MEMORY_SCOPES,
  MEMORY_CATEGORIES,
  EVENT_TYPES,
  BUBBLE_TYPES,
  MESSAGE_ROLES,
  EXECUTION_STATUSES,
} from './constants';

// ═══════════════════════════════════════════════════════════════════════════════
// Primitive Type Aliases
// ═══════════════════════════════════════════════════════════════════════════════

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];
export type TaskPriority = (typeof TASK_PRIORITIES)[keyof typeof TASK_PRIORITIES];
export type CapabilityRiskLevel = (typeof CAPABILITY_RISK_LEVELS)[keyof typeof CAPABILITY_RISK_LEVELS];
export type CapabilitySideEffect = (typeof CAPABILITY_SIDE_EFFECTS)[keyof typeof CAPABILITY_SIDE_EFFECTS];
export type AgentStatus = (typeof AGENT_STATUSES)[keyof typeof AGENT_STATUSES];
export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];
export type CommerceAction = (typeof COMMERCE_ACTIONS)[keyof typeof COMMERCE_ACTIONS];
export type MemoryScope = (typeof MEMORY_SCOPES)[keyof typeof MEMORY_SCOPES];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[keyof typeof MEMORY_CATEGORIES];
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
export type BubbleType = (typeof BUBBLE_TYPES)[keyof typeof BUBBLE_TYPES];
export type DnaPrimitive = (typeof DNA_PRIMITIVES)[keyof typeof DNA_PRIMITIVES];
export type MessageRole = (typeof MESSAGE_ROLES)[keyof typeof MESSAGE_ROLES];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[keyof typeof EXECUTION_STATUSES];

// ═══════════════════════════════════════════════════════════════════════════════
// JSON Schema / OpenAPI-compatible Schema Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generic JSON Schema fragment used to describe input/output contracts
 * for capabilities, tools, and bubbles.
 */
export interface JSONSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'integer' | 'null';
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: (string | number | boolean)[];
  default?: unknown;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | JSONSchema;
  $ref?: string;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  [key: string]: unknown;
}

/**
 * Generic key-value metadata bag used across all entities.
 */
export interface Metadata {
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single step within a task execution plan.
 */
export interface TaskStep {
  id: string;
  taskId: string;
  name: string;
  description?: string;
  type: string; // generic step classifier (e.g. 'capability', 'tool', 'approval', 'wait')
  status: TaskStatus;
  dependencies: string[]; // ids of steps that must complete before this one
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  error?: TaskError;
  retryCount: number;
  metadata?: Metadata;
}

/**
 * Node in a directed acyclic graph (DAG) representing an execution plan.
 */
export interface PlanNode {
  id: string;
  name: string;
  capability: string; // capability id or name
  dependencies: string[]; // ids of parent nodes
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  parallel: boolean; // whether this node can run in parallel with siblings
  metadata?: Metadata;
}

/**
 * Directed Acyclic Graph describing the full execution plan for a task.
 */
export interface DAG {
  nodes: PlanNode[];
  edges: Array<{ from: string; to: string }>;
  rootNodeId: string;
  metadata?: Metadata;
}

/**
 * Pending action that requires user interaction or approval.
 */
export interface PendingAction {
  id: string;
  type: string;
  description: string;
  required: boolean;
  payload?: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

/**
 * Approval record for a sensitive action.
 */
export interface Approval {
  id: string;
  action: string;
  actor: string; // who initiated
  permission: string;
  policy?: string; // policy id
  risk: CapabilityRiskLevel;
  required: boolean;
  approved: boolean | null; // null = pending
  approvedBy?: string;
  approvedAt?: string;
  expiresAt?: string;
  metadata?: Metadata;
}

/**
 * A task is the central unit of work in JASIM.
 * It progresses from intent → understanding → planning → execution → completion.
 */
export interface Task {
  id: string;
  goal: string;
  intent: string; // normalized intent extracted from user message
  context: Record<string, unknown>;
  entities: Entity[];
  constraints: string[];
  collectedData: Record<string, unknown>;
  missingData: string[]; // keys of data still needed
  plan?: DAG;
  steps: TaskStep[];
  currentStepId?: string;
  completedSteps: string[];
  pendingActions: PendingAction[];
  approvals: Approval[];
  permissions: string[];
  capabilities: string[]; // ids of capabilities required/used
  agents: string[]; // ids of agents assigned
  tools: string[]; // ids of tools invoked
  outputs: Record<string, unknown>[];
  errors: TaskError[];
  status: TaskStatus;
  history: TaskHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  metadata?: Metadata;
}

/**
 * Error that occurred during task execution.
 */
export interface TaskError {
  code: string;
  message: string;
  stepId?: string;
  agentId?: string;
  toolId?: string;
  timestamp: string;
  recoverable: boolean;
  metadata?: Metadata;
}

/**
 * A single entry in the task's audit/history log.
 */
export interface TaskHistoryEntry {
  id: string;
  timestamp: string;
  status: TaskStatus;
  stepId?: string;
  message: string;
  actor?: string;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Capability System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validation rule for capability inputs or outputs.
 */
export interface ValidationRule {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'exists' | 'regex';
  value?: unknown;
  message?: string;
}

/**
 * A capability is a discrete unit of functionality that an agent can invoke.
 * Capabilities are discovered, composed, and executed dynamically.
 */
export interface Capability {
  id: string;
  name: string;
  description: string;
  version: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  requirements: string[]; // ids or names of other capabilities/tools required
  permissions: string[];
  riskLevel: CapabilityRiskLevel;
  sideEffects: CapabilitySideEffect[];
  executionHandler: string; // identifier for the handler (generic)
  validationRules: ValidationRule[];
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent memory — both short-term working memory and references to long-term stores.
 */
export interface AgentMemory {
  working: Record<string, unknown>;
  longTermRefs: string[]; // ids of MemoryEntry items
  contextWindow: string[]; // recent events/messages
}

/**
 * Context available to an agent when making decisions.
 */
export interface AgentContext {
  goal: string;
  taskState: Record<string, unknown>;
  availableCapabilities: Capability[];
  availableTools: Tool[];
  permissions: Permission[];
  memory: AgentMemory;
  entities: Entity[];
  metadata?: Metadata;
}

/**
 * An agent is a runtime instance that executes capabilities toward a goal.
 */
export interface Agent {
  id: string;
  name: string;
  goal: string;
  context: AgentContext;
  constraints: string[];
  capabilities: string[]; // capability ids
  tools: string[]; // tool ids
  permissions: Permission[];
  memory: AgentMemory;
  state: Record<string, unknown>; // runtime state
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retry policy for tool invocations.
 */
export interface RetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableErrors: string[]; // error codes that should trigger retry
}

/**
 * Authentication requirements for a tool.
 */
export interface ToolAuthentication {
  required: boolean;
  type: 'none' | 'api_key' | 'oauth2' | 'bearer' | 'basic' | 'custom';
  scopes?: string[];
  metadata?: Metadata;
}

/**
 * A tool is an external executable resource (API, function, integration).
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  permissions: string[];
  sideEffects: CapabilitySideEffect[];
  authentication: ToolAuthentication;
  timeout: number; // ms
  retryPolicy: RetryPolicy;
  executor: string; // identifier for the executor implementation
  metadata?: Metadata;
}

/**
 * Record of a single tool invocation.
 */
export interface ToolInvocation {
  id: string;
  toolId: string;
  taskId: string;
  stepId: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  error?: TaskError;
  durationMs?: number;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Entity System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Identity associated with an entity.
 */
export interface Identity {
  id: string;
  entityId: string;
  type: string; // e.g. 'email', 'phone', 'username', 'wallet', 'did'
  credentials: Record<string, unknown>;
  verified: boolean;
  permissions: Permission[];
  metadata?: Metadata;
}

/**
 * An entity is any person, object, business, or generated artifact
 * that participates in a task.
 */
export interface Entity {
  id: string;
  type: EntityType;
  attributes: Record<string, unknown>;
  relationships: EntityRelationship[];
  capabilities: string[]; // capability ids this entity supports
  identity: Identity[];
  reputation?: ReputationScore;
  availability?: AvailabilityWindow;
  permissions: Permission[];
  metadata?: Metadata;
}

/**
 * Relationship between two entities.
 */
export interface EntityRelationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string; // e.g. 'owns', 'works_for', 'provides', 'located_in'
  strength?: number; // 0-1
  metadata?: Metadata;
}

/**
 * Reputation score for an entity.
 */
export interface ReputationScore {
  overall: number; // 0-1
  dimensions: Record<string, number>;
  source: string;
  updatedAt: string;
}

/**
 * Availability window for an entity.
 */
export interface AvailabilityWindow {
  timezone: string;
  schedule: Array<{
    day: string;
    start: string;
    end: string;
  }>;
  exceptions: Array<{
    date: string;
    available: boolean;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Commerce Primitives
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * State of an ongoing negotiation.
 */
export interface NegotiationState {
  objective: string;
  limits: Record<string, { min?: number; max?: number }>;
  preferences: Record<string, unknown>;
  allowedActions: CommerceAction[];
  forbiddenActions: CommerceAction[];
  authority: string; // who has authority to agree
  approvalThreshold: number; // value above which approval is needed
  currentOffer?: Record<string, unknown>;
  counterOffer?: Record<string, unknown>;
  status: 'open' | 'accepted' | 'rejected' | 'expired' | 'countered';
  metadata?: Metadata;
}

/**
 * Criteria for matching requests with candidates (entities, services, etc.).
 */
export interface MatchCriteria {
  request: string;
  constraints: Record<string, unknown>;
  location?: { latitude: number; longitude: number; radiusKm: number };
  availability?: AvailabilityWindow;
  priceRange?: { min?: number; max?: number; currency: string };
  quality?: { minScore: number };
  reputation?: { minScore: number };
  capabilities?: string[];
  preferences?: Record<string, unknown>;
}

/**
 * A single candidate in a match result.
 */
export interface MatchCandidate {
  entity: Entity;
  score: number; // 0-1
  breakdown: Record<string, number>;
  metadata?: Metadata;
}

/**
 * Result of a matching operation.
 */
export interface MatchResult {
  requestId: string;
  candidates: MatchCandidate[];
  topCandidateId?: string;
  criteria: MatchCriteria;
  timestamp: string;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Approval / Policy / Permission System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A permission grants the right to perform an action on a resource.
 */
export interface Permission {
  id: string;
  resource: string; // resource identifier pattern
  action: string; // action pattern
  conditions?: Record<string, unknown>; // contextual conditions
  granted: boolean;
  grantedBy?: string;
  grantedAt?: string;
  expiresAt?: string;
  metadata?: Metadata;
}

/**
 * A policy is a reusable set of rules that govern approvals.
 */
export interface Policy {
  id: string;
  name: string;
  rules: PolicyRule[];
  scope: string; // e.g. 'global', 'task', 'agent', 'user'
  priority: number; // higher number = higher priority
  active: boolean;
  metadata?: Metadata;
}

/**
 * Single rule within a policy.
 */
export interface PolicyRule {
  id: string;
  condition: Record<string, unknown>; // condition to match
  action: 'require_approval' | 'allow' | 'deny' | 'escalate';
  requiredApprovers?: number;
  approverRoles?: string[];
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memory System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A memory entry stores contextual knowledge for retrieval across tasks.
 */
export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  key: string;
  value: unknown;
  category: MemoryCategory;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Event System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event subscription for reactive processing.
 */
export interface EventSubscription {
  id: string;
  eventType: EventType;
  filter?: Record<string, unknown>; // partial match filter on payload
  handler: string; // handler identifier
  active: boolean;
  metadata?: Metadata;
}

/**
 * Generic event envelope used throughout JASIM.
 */
export interface JEvent {
  id: string;
  type: EventType;
  source: string; // component that emitted the event
  payload: Record<string, unknown>;
  timestamp: string;
  priority: TaskPriority;
  correlationId?: string; // for tracing related events
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI / Bubble System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Trust badge shown on bubbles to indicate verification level.
 */
export interface TrustBadge {
  level: 'none' | 'basic' | 'verified' | 'trusted' | 'system';
  verified: boolean;
  badges: string[]; // e.g. 'secure', 'payment', 'identity'
}

/**
 * Layout configuration for a bubble.
 */
export interface BubbleLayout {
  columns?: number;
  width?: 'auto' | 'full' | 'compact' | number;
  height?: 'auto' | 'compact' | number;
  rtl?: boolean;
  compact?: boolean;
}

/**
 * Theme configuration for a bubble.
 */
export interface BubbleTheme {
  background?: string;
  text?: string;
  accent?: string;
  glassmorphism?: boolean;
  rtl?: boolean;
  dark?: boolean;
}

/**
 * Action available within a bubble.
 */
export interface BubbleAction {
  id: string;
  label: string;
  type: 'submit' | 'cancel' | 'link' | 'download' | 'share' | 'custom';
  disabled?: boolean;
  payload?: Record<string, unknown>;
  /** Runtime bindings are generated from WorldDNA; UI never selects an app. */
  capabilityBinding?: string;
  targetEntity?: string;
  workflowId?: string;
  requiresApproval?: boolean;
  metadata?: Metadata;
}

/**
 * A bubble is a dynamically generated UI unit rendered in the chat.
 * It can be a form, list, comparison, map, or any other interactive widget.
 */
export interface BubbleSchema {
  id: string;
  type: BubbleType;
  title: string;
  subtitle?: string;
  layout: BubbleLayout;
  theme?: BubbleTheme;
  data: Record<string, unknown>;
  actions: BubbleAction[];
  trust: TrustBadge;
  version: string; // schema version for compatibility
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Conversation System
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A conversation is a persistent chat session between a user and JASIM.
 */
export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  status: 'active' | 'archived' | 'closed';
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  metadata?: Metadata;
}

/**
 * A message within a conversation.
 */
export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  intent?: string; // normalized intent
  taskId?: string; // associated task, if any
  bubbleData?: BubbleSchema; // optional generated bubble
  metadata?: Metadata;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DNA Primitives (The Core)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TaskDNA captures the primitive composition of a task.
 * It is the bridge between natural language intent and executable plans.
 */
export interface TaskDNA {
  id: string;
  primitives: DnaPrimitive[];
  parameters: Record<string, unknown>;
  constraints: string[];
  target?: string; // entity id or description of what the task acts upon
  context: Record<string, unknown>;
  confidence: number; // 0-1, how confident the system is in this DNA
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Execution & Observability
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Execution trace for auditing and debugging.
 */
export interface ExecutionTrace {
  id: string;
  taskId: string;
  stepId?: string;
  agentId?: string;
  capability?: string;
  tool?: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  duration: number; // ms
  status: ExecutionStatus;
  error?: TaskError;
  timestamp: string;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generated System (SaaS / Experience)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A generated system is a complete application or experience
 * created by JASIM for the user.
 */
export interface GeneratedSystem {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[]; // capability ids
  schema: JSONSchema; // schema of the system's data model
  status: 'draft' | 'active' | 'archived' | 'deprecated';
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Metadata;
}

/**
 * Version record for a generated system.
 */
export interface SystemVersion {
  id: string;
  systemId: string;
  version: string;
  schema: JSONSchema;
  state: 'draft' | 'published' | 'rolled_back';
  migration?: {
    fromVersion: string;
    script?: string;
    autoMigrate: boolean;
  };
  createdAt: string;
  metadata?: Metadata;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Composite / Derived Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Complete runtime snapshot of a task and its execution state.
 */
export interface TaskRuntimeSnapshot {
  task: Task;
  agent: Agent | null;
  traces: ExecutionTrace[];
  events: JEvent[];
  bubbles: BubbleSchema[];
  memory: MemoryEntry[];
  timestamp: string;
}

/**
 * Request to create a new task from a conversation message.
 */
export interface CreateTaskRequest {
  conversationId: string;
  userId: string;
  message: string;
  context?: Record<string, unknown>;
  priority?: TaskPriority;
}

/**
 * Response when a task is created or updated.
 */
export interface TaskResponse {
  task: Task;
  bubble?: BubbleSchema;
  message?: string;
  requiresApproval?: boolean;
}

/**
 * Request to execute the next step in a task.
 */
export interface ExecuteStepRequest {
  taskId: string;
  stepId: string;
  inputs?: Record<string, unknown>;
  approval?: Approval;
}

/**
 * Health/status of a JASIM runtime instance.
 */
export interface RuntimeHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  activeTasks: number;
  activeAgents: number;
  pendingApprovals: number;
  eventQueueDepth: number;
  memoryUsage: Record<string, number>;
  timestamp: string;
}
