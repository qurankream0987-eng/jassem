/**
 * JASIM — Zod Schemas for Runtime Validation
 * Mirrors all types in jasim.ts for use in both frontend and backend.
 */

import { z } from 'zod';
import {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Primitive Helpers
// ═══════════════════════════════════════════════════════════════════════════════

export const taskStatusSchema = z.nativeEnum(TASK_STATUSES);
export const taskPrioritySchema = z.nativeEnum(TASK_PRIORITIES);
export const capabilityRiskLevelSchema = z.nativeEnum(CAPABILITY_RISK_LEVELS);
export const capabilitySideEffectSchema = z.nativeEnum(CAPABILITY_SIDE_EFFECTS);
export const agentStatusSchema = z.nativeEnum(AGENT_STATUSES);
export const entityTypeSchema = z.nativeEnum(ENTITY_TYPES);
export const commerceActionSchema = z.nativeEnum(COMMERCE_ACTIONS);
export const memoryScopeSchema = z.nativeEnum(MEMORY_SCOPES);
export const memoryCategorySchema = z.nativeEnum(MEMORY_CATEGORIES);
export const eventTypeSchema = z.nativeEnum(EVENT_TYPES);
export const bubbleTypeSchema = z.nativeEnum(BUBBLE_TYPES);
export const dnaPrimitiveSchema = z.nativeEnum(DNA_PRIMITIVES);
export const messageRoleSchema = z.nativeEnum(MESSAGE_ROLES);
export const executionStatusSchema = z.nativeEnum(EXECUTION_STATUSES);

// ═══════════════════════════════════════════════════════════════════════════════
// Base / Shared Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const metadataSchema: z.ZodType = z.record(z.string(), z.unknown());

export const jsonSchemaSchema: z.ZodType = z.object({
  type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'integer', 'null']).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.lazy(() => jsonSchemaSchema)).optional(),
  required: z.array(z.string()).optional(),
  items: z.lazy(() => jsonSchemaSchema).optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  default: z.unknown().optional(),
  format: z.string().optional(),
  pattern: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  additionalProperties: z.union([z.boolean(), z.lazy(() => jsonSchemaSchema)]).optional(),
  $ref: z.string().optional(),
  oneOf: z.array(z.lazy(() => jsonSchemaSchema)).optional(),
  anyOf: z.array(z.lazy(() => jsonSchemaSchema)).optional(),
  allOf: z.array(z.lazy(() => jsonSchemaSchema)).optional(),
}).passthrough();

// ═══════════════════════════════════════════════════════════════════════════════
// Task System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const taskErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  stepId: z.string().optional(),
  agentId: z.string().optional(),
  toolId: z.string().optional(),
  timestamp: z.string().datetime(),
  recoverable: z.boolean(),
  metadata: metadataSchema.optional(),
});

export const taskHistoryEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  status: taskStatusSchema,
  stepId: z.string().optional(),
  message: z.string(),
  actor: z.string().optional(),
  metadata: metadataSchema.optional(),
});

export const taskStepSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.string(),
  status: taskStatusSchema,
  dependencies: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  error: taskErrorSchema.optional(),
  retryCount: z.number().default(0),
  metadata: metadataSchema.optional(),
});

export const planNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  capability: z.string(),
  dependencies: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  parallel: z.boolean(),
  metadata: metadataSchema.optional(),
});

export const dagSchema = z.object({
  nodes: z.array(planNodeSchema),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
  rootNodeId: z.string(),
  metadata: metadataSchema.optional(),
});

export const pendingActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  required: z.boolean(),
  payload: z.record(z.string(), z.unknown()).optional(),
  resolved: z.boolean(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().optional(),
});

export const approvalSchema = z.object({
  id: z.string(),
  action: z.string(),
  actor: z.string(),
  permission: z.string(),
  policy: z.string().optional(),
  risk: capabilityRiskLevelSchema,
  required: z.boolean(),
  approved: z.boolean().nullable(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: metadataSchema.optional(),
});

export const taskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  intent: z.string(),
  context: z.record(z.string(), z.unknown()),
  entities: z.array(z.lazy(() => entitySchema)),
  constraints: z.array(z.string()),
  collectedData: z.record(z.string(), z.unknown()),
  missingData: z.array(z.string()),
  plan: dagSchema.optional(),
  steps: z.array(taskStepSchema),
  currentStepId: z.string().optional(),
  completedSteps: z.array(z.string()),
  pendingActions: z.array(pendingActionSchema),
  approvals: z.array(approvalSchema),
  permissions: z.array(z.string()),
  capabilities: z.array(z.string()),
  agents: z.array(z.string()),
  tools: z.array(z.string()),
  outputs: z.array(z.record(z.string(), z.unknown())),
  errors: z.array(taskErrorSchema),
  status: taskStatusSchema,
  history: z.array(taskHistoryEntrySchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Capability System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const validationRuleSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'exists', 'regex']),
  value: z.unknown().optional(),
  message: z.string().optional(),
});

export const capabilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  inputSchema: jsonSchemaSchema,
  outputSchema: jsonSchemaSchema,
  requirements: z.array(z.string()),
  permissions: z.array(z.string()),
  riskLevel: capabilityRiskLevelSchema,
  sideEffects: z.array(capabilitySideEffectSchema),
  executionHandler: z.string(),
  validationRules: z.array(validationRuleSchema),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const retryPolicySchema = z.object({
  maxRetries: z.number(),
  backoffMultiplier: z.number(),
  initialDelayMs: z.number(),
  maxDelayMs: z.number(),
  retryableErrors: z.array(z.string()),
});

export const toolAuthenticationSchema = z.object({
  required: z.boolean(),
  type: z.enum(['none', 'api_key', 'oauth2', 'bearer', 'basic', 'custom']),
  scopes: z.array(z.string()).optional(),
  metadata: metadataSchema.optional(),
});

export const toolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchema: jsonSchemaSchema,
  outputSchema: jsonSchemaSchema,
  permissions: z.array(z.string()),
  sideEffects: z.array(capabilitySideEffectSchema),
  authentication: toolAuthenticationSchema,
  timeout: z.number(),
  retryPolicy: retryPolicySchema,
  executor: z.string(),
  metadata: metadataSchema.optional(),
});

export const toolInvocationSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  taskId: z.string(),
  stepId: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()).optional(),
  status: executionStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: taskErrorSchema.optional(),
  durationMs: z.number().optional(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Entity System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const permissionSchema = z.object({
  id: z.string(),
  resource: z.string(),
  action: z.string(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  granted: z.boolean(),
  grantedBy: z.string().optional(),
  grantedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: metadataSchema.optional(),
});

export const identitySchema = z.object({
  id: z.string(),
  entityId: z.string(),
  type: z.string(),
  credentials: z.record(z.string(), z.unknown()),
  verified: z.boolean(),
  permissions: z.array(permissionSchema),
  metadata: metadataSchema.optional(),
});

export const reputationScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  dimensions: z.record(z.string(), z.number()),
  source: z.string(),
  updatedAt: z.string().datetime(),
});

export const availabilityWindowSchema = z.object({
  timezone: z.string(),
  schedule: z.array(z.object({
    day: z.string(),
    start: z.string(),
    end: z.string(),
  })),
  exceptions: z.array(z.object({
    date: z.string(),
    available: z.boolean(),
  })),
});

export const entityRelationshipSchema = z.object({
  id: z.string(),
  fromEntityId: z.string(),
  toEntityId: z.string(),
  type: z.string(),
  strength: z.number().min(0).max(1).optional(),
  metadata: metadataSchema.optional(),
});

export const entitySchema = z.object({
  id: z.string(),
  type: entityTypeSchema,
  attributes: z.record(z.string(), z.unknown()),
  relationships: z.array(entityRelationshipSchema),
  capabilities: z.array(z.string()),
  identity: z.array(identitySchema),
  reputation: reputationScoreSchema.optional(),
  availability: availabilityWindowSchema.optional(),
  permissions: z.array(permissionSchema),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Commerce Primitives Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const negotiationStateSchema = z.object({
  objective: z.string(),
  limits: z.record(z.string(), z.object({ min: z.number().optional(), max: z.number().optional() })),
  preferences: z.record(z.string(), z.unknown()),
  allowedActions: z.array(commerceActionSchema),
  forbiddenActions: z.array(commerceActionSchema),
  authority: z.string(),
  approvalThreshold: z.number(),
  currentOffer: z.record(z.string(), z.unknown()).optional(),
  counterOffer: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['open', 'accepted', 'rejected', 'expired', 'countered']),
  metadata: metadataSchema.optional(),
});

export const matchCriteriaSchema = z.object({
  request: z.string(),
  constraints: z.record(z.string(), z.unknown()),
  location: z.object({ latitude: z.number(), longitude: z.number(), radiusKm: z.number() }).optional(),
  availability: availabilityWindowSchema.optional(),
  priceRange: z.object({ min: z.number().optional(), max: z.number().optional(), currency: z.string() }).optional(),
  quality: z.object({ minScore: z.number() }).optional(),
  reputation: z.object({ minScore: z.number() }).optional(),
  capabilities: z.array(z.string()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export const matchCandidateSchema = z.object({
  entity: entitySchema,
  score: z.number().min(0).max(1),
  breakdown: z.record(z.string(), z.number()),
  metadata: metadataSchema.optional(),
});

export const matchResultSchema = z.object({
  requestId: z.string(),
  candidates: z.array(matchCandidateSchema),
  topCandidateId: z.string().optional(),
  criteria: matchCriteriaSchema,
  timestamp: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Approval / Policy Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const policyRuleSchema = z.object({
  id: z.string(),
  condition: z.record(z.string(), z.unknown()),
  action: z.enum(['require_approval', 'allow', 'deny', 'escalate']),
  requiredApprovers: z.number().optional(),
  approverRoles: z.array(z.string()).optional(),
  metadata: metadataSchema.optional(),
});

export const policySchema = z.object({
  id: z.string(),
  name: z.string(),
  rules: z.array(policyRuleSchema),
  scope: z.string(),
  priority: z.number(),
  active: z.boolean(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Memory System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const memoryEntrySchema = z.object({
  id: z.string(),
  scope: memoryScopeSchema,
  key: z.string(),
  value: z.unknown(),
  category: memoryCategorySchema,
  permissions: z.array(permissionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Event System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const eventSubscriptionSchema = z.object({
  id: z.string(),
  eventType: eventTypeSchema,
  filter: z.record(z.string(), z.unknown()).optional(),
  handler: z.string(),
  active: z.boolean(),
  metadata: metadataSchema.optional(),
});

export const jEventSchema = z.object({
  id: z.string(),
  type: eventTypeSchema,
  source: z.string(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime(),
  priority: taskPrioritySchema,
  correlationId: z.string().optional(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// UI / Bubble System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const trustBadgeSchema = z.object({
  level: z.enum(['none', 'basic', 'verified', 'trusted', 'system']),
  verified: z.boolean(),
  badges: z.array(z.string()),
});

export const bubbleLayoutSchema = z.object({
  columns: z.number().optional(),
  width: z.union([z.enum(['auto', 'full', 'compact']), z.number()]).optional(),
  height: z.union([z.enum(['auto', 'compact']), z.number()]).optional(),
  rtl: z.boolean().optional(),
  compact: z.boolean().optional(),
});

export const bubbleThemeSchema = z.object({
  background: z.string().optional(),
  text: z.string().optional(),
  accent: z.string().optional(),
  glassmorphism: z.boolean().optional(),
  rtl: z.boolean().optional(),
  dark: z.boolean().optional(),
});

export const bubbleActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['submit', 'cancel', 'link', 'download', 'share', 'custom']),
  disabled: z.boolean().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  metadata: metadataSchema.optional(),
});

export const bubbleSchema = z.object({
  id: z.string(),
  type: bubbleTypeSchema,
  title: z.string(),
  subtitle: z.string().optional(),
  layout: bubbleLayoutSchema,
  theme: bubbleThemeSchema.optional(),
  data: z.record(z.string(), z.unknown()),
  actions: z.array(bubbleActionSchema),
  trust: trustBadgeSchema,
  version: z.string(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const agentMemorySchema = z.object({
  working: z.record(z.string(), z.unknown()),
  longTermRefs: z.array(z.string()),
  contextWindow: z.array(z.string()),
});

export const agentContextSchema = z.object({
  goal: z.string(),
  taskState: z.record(z.string(), z.unknown()),
  availableCapabilities: z.array(capabilitySchema),
  availableTools: z.array(toolSchema),
  permissions: z.array(permissionSchema),
  memory: agentMemorySchema,
  entities: z.array(entitySchema),
  metadata: metadataSchema.optional(),
});

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  context: agentContextSchema,
  constraints: z.array(z.string()),
  capabilities: z.array(z.string()),
  tools: z.array(z.string()),
  permissions: z.array(permissionSchema),
  memory: agentMemorySchema,
  state: z.record(z.string(), z.unknown()),
  status: agentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Conversation System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const conversationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().optional(),
  status: z.enum(['active', 'archived', 'closed']),
  context: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  intent: z.string().optional(),
  taskId: z.string().optional(),
  bubbleData: bubbleSchema.optional(),
  metadata: metadataSchema.optional(),
  createdAt: z.string().datetime(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// DNA Primitive Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const taskDnaSchema = z.object({
  id: z.string(),
  primitives: z.array(dnaPrimitiveSchema),
  parameters: z.record(z.string(), z.unknown()),
  constraints: z.array(z.string()),
  target: z.string().optional(),
  context: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Execution & Observability Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const executionTraceSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  stepId: z.string().optional(),
  agentId: z.string().optional(),
  capability: z.string().optional(),
  tool: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()).optional(),
  duration: z.number(),
  status: executionStatusSchema,
  error: taskErrorSchema.optional(),
  timestamp: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Generated System Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const generatedSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  capabilities: z.array(z.string()),
  schema: jsonSchemaSchema,
  status: z.enum(['draft', 'active', 'archived', 'deprecated']),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

export const systemVersionSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  version: z.string(),
  schema: jsonSchemaSchema,
  state: z.enum(['draft', 'published', 'rolled_back']),
  migration: z.object({
    fromVersion: z.string(),
    script: z.string().optional(),
    autoMigrate: z.boolean(),
  }).optional(),
  createdAt: z.string().datetime(),
  metadata: metadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Composite / Request-Response Schemas
// ═══════════════════════════════════════════════════════════════════════════════

export const taskRuntimeSnapshotSchema = z.object({
  task: taskSchema,
  agent: agentSchema.nullable(),
  traces: z.array(executionTraceSchema),
  events: z.array(jEventSchema),
  bubbles: z.array(bubbleSchema),
  memory: z.array(memoryEntrySchema),
  timestamp: z.string().datetime(),
});

export const createTaskRequestSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
  priority: taskPrioritySchema.optional(),
});

export const taskResponseSchema = z.object({
  task: taskSchema,
  bubble: bubbleSchema.optional(),
  message: z.string().optional(),
  requiresApproval: z.boolean().optional(),
});

export const executeStepRequestSchema = z.object({
  taskId: z.string(),
  stepId: z.string(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  approval: approvalSchema.optional(),
});

export const runtimeHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  uptime: z.number(),
  activeTasks: z.number(),
  activeAgents: z.number(),
  pendingApprovals: z.number(),
  eventQueueDepth: z.number(),
  memoryUsage: z.record(z.string(), z.number()),
  timestamp: z.string().datetime(),
});
