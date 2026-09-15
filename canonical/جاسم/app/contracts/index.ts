/**
 * JASIM — Shared Contracts
 * Re-exports all types, constants, schemas, and errors for convenience.
 *
 * Usage:
 *   import { Task, taskSchema, TASK_STATUSES, JasimError } from '@jasim/contracts';
 */

// ── Constants ─────────────────────────────────────────────────────────────────
export {
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

// ── Types ──────────────────────────────────────────────────────────────────────
export type {
  // Primitives
  TaskStatus,
  TaskPriority,
  CapabilityRiskLevel,
  CapabilitySideEffect,
  AgentStatus,
  EntityType,
  CommerceAction,
  MemoryScope,
  MemoryCategory,
  EventType,
  BubbleType,
  DnaPrimitive,
  MessageRole,
  ExecutionStatus,

  // Base
  JSONSchema,
  Metadata,

  // Task System
  Task,
  TaskStep,
  TaskHistoryEntry,
  PlanNode,
  DAG,
  PendingAction,
  Approval,

  // Capability System
  Capability,
  ValidationRule,

  // Agent System
  Agent,
  AgentMemory,
  AgentContext,

  // Tool System
  Tool,
  ToolAuthentication,
  RetryPolicy,
  ToolInvocation,

  // Entity System
  Entity,
  EntityRelationship,
  Identity,
  ReputationScore,
  AvailabilityWindow,

  // Commerce Primitives
  NegotiationState,
  MatchCriteria,
  MatchCandidate,
  MatchResult,

  // Approval / Policy
  Permission,
  Policy,
  PolicyRule,

  // Memory
  MemoryEntry,

  // Events
  JEvent,
  EventSubscription,

  // UI / Bubbles
  BubbleSchema,
  BubbleLayout,
  BubbleTheme,
  BubbleAction,
  TrustBadge,

  // Conversation
  Conversation,
  Message,

  // DNA
  TaskDNA,

  // Execution
  ExecutionTrace,

  // Generated System
  GeneratedSystem,
  SystemVersion,

  // Composite
  TaskRuntimeSnapshot,
  CreateTaskRequest,
  TaskResponse,
  ExecuteStepRequest,
  RuntimeHealth,
} from './jasim';

// ── DNA (World Definition) ────────────────────────────────────────────────────
export {
  WorldDNASchema,
  EntitySchema,
  FieldSchema,
  RelationSchema,
  CapabilityBindingSchema,
  WorkflowSchema,
  UIDescriptorSchema,
  PolicySchema,
  IntentSchema,
  ExecutionPlanSchema,
  PlanStepSchema,
  validateWorldDNA,
  validateExecutionPlan,
} from './dna';

export type {
  WorldDNA,
  EntityDefinition,
  FieldDefinition,
  RelationDefinition,
  CapabilityBinding,
  WorkflowDefinition,
  UIDescriptor,
  PolicyDefinition,
  IntentStructure,
  ExecutionPlan,
} from './dna';

// ── Errors ────────────────────────────────────────────────────────────────────
export {
  JasimError,
  TaskError,
  AgentError,
  CapabilityError,
  ToolError,
  ApprovalError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  RateLimitError,
  EventError,
  BubbleError,
  ERROR_CODES,
} from './errors';

// ── Zod Schemas ───────────────────────────────────────────────────────────────
export {
  metadataSchema,
  jsonSchemaSchema,
  taskStatusSchema,
  taskPrioritySchema,
  capabilityRiskLevelSchema,
  capabilitySideEffectSchema,
  agentStatusSchema,
  entityTypeSchema,
  commerceActionSchema,
  memoryScopeSchema,
  memoryCategorySchema,
  eventTypeSchema,
  bubbleTypeSchema,
  dnaPrimitiveSchema,
  messageRoleSchema,
  executionStatusSchema,

  // Task
  taskErrorSchema,
  taskHistoryEntrySchema,
  taskStepSchema,
  planNodeSchema,
  dagSchema,
  pendingActionSchema,
  approvalSchema,
  taskSchema,

  // Capability
  validationRuleSchema,
  capabilitySchema,

  // Tool
  retryPolicySchema,
  toolAuthenticationSchema,
  toolSchema,
  toolInvocationSchema,

  // Entity
  permissionSchema,
  identitySchema,
  reputationScoreSchema,
  availabilityWindowSchema,
  entityRelationshipSchema,
  entitySchema,

  // Commerce
  negotiationStateSchema,
  matchCriteriaSchema,
  matchCandidateSchema,
  matchResultSchema,

  // Policy
  policyRuleSchema,
  policySchema,

  // Memory
  memoryEntrySchema,

  // Event
  eventSubscriptionSchema,
  jEventSchema,

  // Bubble
  trustBadgeSchema,
  bubbleLayoutSchema,
  bubbleThemeSchema,
  bubbleActionSchema,
  bubbleSchema,

  // Agent
  agentMemorySchema,
  agentContextSchema,
  agentSchema,

  // Conversation
  conversationSchema,
  messageSchema,

  // DNA
  taskDnaSchema,

  // Execution
  executionTraceSchema,

  // Generated System
  generatedSystemSchema,
  systemVersionSchema,

  // Composite
  taskRuntimeSnapshotSchema,
  createTaskRequestSchema,
  taskResponseSchema,
  executeStepRequestSchema,
  runtimeHealthSchema,
} from './zod';
