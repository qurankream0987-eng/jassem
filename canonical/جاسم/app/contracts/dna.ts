/**
 * JASIM DNA Contract — World Definition Schema
 *
 * DNA describes WHAT a world contains, not HOW it runs.
 * It is generic — no domain-specific types.
 * The Runtime reads DNA and composes execution dynamically.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Field Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const FieldTypeSchema = z.enum([
  "string", "number", "boolean", "date", "datetime",
  "email", "url", "uuid", "json", "text", "rich_text",
  "image", "file", "currency", "percentage", "enum",
  "reference", "multi_reference", "geolocation",
]);

export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldValidationSchema = z.object({
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(), // regex
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  unique: z.boolean().default(false),
  immutable: z.boolean().default(false),
}).passthrough();

export const FieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: FieldTypeSchema,
  label: z.string(),
  description: z.string().optional(),
  validation: FieldValidationSchema.default({ required: false, unique: false, immutable: false }),
  // UI hints
  searchable: z.boolean().default(false),
  filterable: z.boolean().default(false),
  sortable: z.boolean().default(false),
  comparable: z.boolean().default(false),
  displayable: z.boolean().default(true),
  editable: z.boolean().default(true),
  hidden: z.boolean().default(false),
}).passthrough();

export type FieldDefinition = z.infer<typeof FieldSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Relation Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const CardinalitySchema = z.enum([
  "one_to_one", "one_to_many", "many_to_one", "many_to_many",
]);

export const RelationSchema = z.object({
  id: z.string(),
  name: z.string(),
  fromEntity: z.string(), // entity ID
  toEntity: z.string(),   // entity ID
  type: z.string().default("association"), // association, composition, aggregation
  cardinality: CardinalitySchema,
  required: z.boolean().default(false),
  inverseName: z.string().optional(), // name from the other side
}).passthrough();

export type RelationDefinition = z.infer<typeof RelationSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Entity Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const LifecycleSchema = z.object({
  states: z.array(z.string()).default(["draft", "active", "archived"]),
  transitions: z.array(z.object({
    from: z.string(),
    to: z.string(),
    trigger: z.string(), // capability or event
    guard: z.string().optional(), // condition expression
  })).default([]),
  initialState: z.string().default("draft"),
}).passthrough();

export const PermissionSchema = z.object({
  role: z.string(),
  actions: z.array(z.string()), // CREATE, READ, UPDATE, DELETE, etc.
  condition: z.string().optional(), // e.g. "owner == self"
}).passthrough();

export const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  fields: z.array(FieldSchema).default([]),
  relations: z.array(RelationSchema).default([]),
  lifecycle: LifecycleSchema.default({ states: ["draft", "active", "archived"], transitions: [], initialState: "draft" }),
  permissions: z.array(PermissionSchema).default([]),
  icon: z.string().optional(),
  color: z.string().optional(),
}).passthrough();

export type EntityDefinition = z.infer<typeof EntitySchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Binding (how a generic capability binds to this world)
// ═══════════════════════════════════════════════════════════════════════════════

export const CapabilityBindingSchema = z.object({
  capabilityId: z.string(), // e.g. "generic.create"
  targetEntity: z.string().optional(), // which entity this applies to
  inputMapping: z.record(z.string(), z.string()).default({}),
  outputMapping: z.record(z.string(), z.string()).default({}),
  preconditions: z.array(z.string()).default([]),
  postconditions: z.array(z.string()).default([]),
  uiHints: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type CapabilityBinding = z.infer<typeof CapabilityBindingSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow Definition (what CAN happen, not what WILL happen)
// ═══════════════════════════════════════════════════════════════════════════════

export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilityBinding: z.string(), // references CapabilityBinding
  description: z.string().optional(),
  parallel: z.boolean().default(false),
  optional: z.boolean().default(false),
  inputs: z.record(z.string(), z.unknown()).default({}),
  conditions: z.array(z.string()).default([]), // guard expressions
}).passthrough();

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  trigger: z.string().optional(), // what starts this workflow
  steps: z.array(WorkflowStepSchema).default([]),
  // DAG edges
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    condition: z.string().optional(),
  })).default([]),
}).passthrough();

export type WorkflowDefinition = z.infer<typeof WorkflowSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// UI Descriptor (what UI is needed, not how it renders)
// ═══════════════════════════════════════════════════════════════════════════════

export const UIComponentTypeSchema = z.enum([
  "form", "list", "detail", "search", "filter",
  "comparison", "gallery", "chart", "calendar",
  "map", "kanban", "progress", "confirmation",
  "actions", "breadcrumb", "navigation", "stats",
]);

export const UIActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilityBinding: z.string(),
  icon: z.string().optional(),
  variant: z.enum(["primary", "secondary", "danger", "ghost"]).default("primary"),
  condition: z.string().optional(),
}).passthrough();

export interface UIDescriptor {
  id: string;
  type: z.infer<typeof UIComponentTypeSchema>;
  entityId?: string;
  title?: string;
  description?: string;
  fields: string[];
  actions: Array<z.infer<typeof UIActionSchema>>;
  layout: {
    columns?: number;
    density: "compact" | "normal" | "comfortable";
    sortable: boolean;
    filterable: boolean;
    searchable: boolean;
    paginated: boolean;
    pageSize?: number;
  };
  dataSource: {
    type: "entity" | "capability" | "workflow";
    sourceId?: string;
    filters: Record<string, unknown>;
  };
  children: UIDescriptor[];
}

export const UIDescriptorSchema: z.ZodType<UIDescriptor> = z.object({
  id: z.string(),
  type: UIComponentTypeSchema,
  entityId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  // Which fields to show
  fields: z.array(z.string()).default([]), // field IDs
  // Actions available
  actions: z.array(UIActionSchema).default([]),
  // Layout hints
  layout: z.object({
    columns: z.number().optional(),
    density: z.enum(["compact", "normal", "comfortable"]).default("normal"),
    sortable: z.boolean().default(false),
    filterable: z.boolean().default(false),
    searchable: z.boolean().default(false),
    paginated: z.boolean().default(false),
    pageSize: z.number().optional(),
  }).default({
    density: "normal",
    sortable: false,
    filterable: false,
    searchable: false,
    paginated: false,
  }),
  // Data source
  dataSource: z.object({
    type: z.enum(["entity", "capability", "workflow"]).default("entity"),
    sourceId: z.string().optional(),
    filters: z.record(z.string(), z.unknown()).default({}),
  }).default({ type: "entity", filters: {} }),
  // Child descriptors (for composite screens)
  children: z.array(z.lazy(() => UIDescriptorSchema)).default([]),
}).passthrough();

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Definition
// ═══════════════════════════════════════════════════════════════════════════════

export const PolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["validation", "authorization", "rate_limit", "business_rule"]),
  target: z.string(), // entity or capability
  condition: z.string(), // expression
  action: z.enum(["allow", "deny", "warn", "require_approval"]),
  message: z.string().optional(),
}).passthrough();

export type PolicyDefinition = z.infer<typeof PolicySchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Theme / Branding
// ═══════════════════════════════════════════════════════════════════════════════

export const ThemeSchema = z.object({
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  fontFamily: z.string().optional(),
  direction: z.enum(["ltr", "rtl"]).default("ltr"),
  density: z.enum(["compact", "normal", "comfortable"]).default("normal"),
}).passthrough();

// ═══════════════════════════════════════════════════════════════════════════════
// Generated participation and continuity
//
// These are structural properties, not a catalogue of memberships. A role is
// free text produced from intent (or later from learned DNA), so JASIM can work
// with a relationship it has never seen before without adding a new enum.
// ═══════════════════════════════════════════════════════════════════════════════

export const WorldContinuitySchema = z.enum([
  "ephemeral",   // one outcome; may disappear when the task ends
  "persistent",  // a reusable space/system that survives conversations
  "evolving",    // persistent and expected to change through conversation
]);

export const ParticipantDefinitionSchema = z.object({
  id: z.string(),
  role: z.string(),
  label: z.string(),
  description: z.string().optional(),
  source: z.enum(["intent", "inferred", "runtime", "learned"]).default("intent"),
  capabilities: z.array(z.string()).default([]),
  policies: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type ParticipantDefinition = z.infer<typeof ParticipantDefinitionSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// World DNA (the complete definition)
// ═══════════════════════════════════════════════════════════════════════════════

export const WorldDNASchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().default("1.0.0"),
  ownerId: z.string().optional(),
  tenantId: z.string().optional(),
  visibility: z.enum(["private", "public", "shared"]).default("private"),
  // Free-form purpose plus structural lifetime. Neither field selects an app.
  purpose: z.string().optional(),
  continuity: WorldContinuitySchema.default("ephemeral"),
  participants: z.array(ParticipantDefinitionSchema).default([]),
  // Core definitions
  entities: z.array(EntitySchema).default([]),
  relations: z.array(RelationSchema).default([]),
  capabilities: z.array(CapabilityBindingSchema).default([]),
  workflows: z.array(WorkflowSchema).default([]),
  policies: z.array(PolicySchema).default([]),
  // UI
  ui: z.array(UIDescriptorSchema).default([]),
  theme: ThemeSchema.default({ direction: "ltr", density: "normal" }),
  // Metadata
  generatedFrom: z.string().optional(), // the original intent
  confidence: z.number().min(0).max(1).default(0.9),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  lineage: z.object({
    parentWorldId: z.string().optional(),
    parentVersion: z.string().optional(),
    changeRequest: z.string().optional(),
  }).default({}),
}).passthrough();

export type WorldDNA = z.infer<typeof WorldDNASchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Structure (output of Intent Engine)
// ═══════════════════════════════════════════════════════════════════════════════

export const IntentSchema = z.object({
  goal: z.string(),
  actors: z.array(z.object({
    role: z.string(),
    description: z.string().optional(),
  })).default([]),
  objects: z.array(z.object({
    name: z.string(),
    type: z.string().optional(),
    attributes: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
  actions: z.array(z.string()).default([]),
  constraints: z.array(z.object({
    type: z.string(),
    field: z.string(),
    operator: z.string(),
    value: z.unknown(),
  })).default([]),
  desiredOutcomes: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  domainHints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
}).passthrough();

export type IntentStructure = z.infer<typeof IntentSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Plan Definition (output of Planner — what WILL happen)
// ═══════════════════════════════════════════════════════════════════════════════

export const PlanStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  capabilityId: z.string(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  outputs: z.record(z.string(), z.unknown()).default({}),
  dependencies: z.array(z.string()).default([]), // step IDs
  parallel: z.boolean().default(false),
  optional: z.boolean().default(false),
  risk: z.enum(["none", "low", "medium", "high", "critical"]).default("low"),
  requiresApproval: z.boolean().default(false),
  fallbackStepId: z.string().optional(),
  verification: z.object({
    type: z.enum(["schema", "predicate", "manual", "none"]),
    config: z.record(z.string(), z.unknown()).default({}),
  }).default({ type: "none", config: {} }),
}).passthrough();

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string(),
  taskId: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(PlanStepSchema).default([]),
  // DAG edges for visualization
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    condition: z.string().optional(),
  })).default([]),
  // Failure strategy
  onFailure: z.enum(["stop", "retry", "fallback", "replan"]).default("replan"),
  maxRetries: z.number().default(3),
  // Context
  worldId: z.string().optional(),
  generatedAt: z.string().datetime().optional(),
}).passthrough();

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// Validation Helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function validateWorldDNA(dna: unknown): { valid: boolean; errors: string[] } {
  const result = WorldDNASchema.safeParse(dna);
  if (result.success) {
    const errors: string[] = [];
    const world = result.data;

    // Check entity ID uniqueness
    const entityIds = new Set<string>();
    for (const entity of world.entities) {
      if (entityIds.has(entity.id)) errors.push(`Duplicate entity ID: ${entity.id}`);
      entityIds.add(entity.id);
    }

    // Check relation targets exist
    for (const rel of world.relations) {
      if (!entityIds.has(rel.fromEntity)) errors.push(`Relation ${rel.id} references unknown entity: ${rel.fromEntity}`);
      if (!entityIds.has(rel.toEntity)) errors.push(`Relation ${rel.id} references unknown entity: ${rel.toEntity}`);
    }

    // Check capability bindings reference valid entities
    for (const cap of world.capabilities) {
      if (cap.targetEntity && !entityIds.has(cap.targetEntity)) {
        errors.push(`Capability ${cap.capabilityId} targets unknown entity: ${cap.targetEntity}`);
      }
    }

    // Check workflow steps reference valid capability bindings
    const capIds = new Set(world.capabilities.map(c => c.capabilityId));
    for (const wf of world.workflows) {
      for (const step of wf.steps) {
        if (!capIds.has(step.capabilityBinding)) {
          errors.push(`Workflow step ${step.id} references unknown capability: ${step.capabilityBinding}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
  return { valid: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
}

export function validateExecutionPlan(plan: unknown): { valid: boolean; errors: string[] } {
  const result = ExecutionPlanSchema.safeParse(plan);
  if (result.success) {
    const errors: string[] = [];
    const planData = result.data;

    // Check step ID uniqueness
    const stepIds = new Set<string>();
    for (const step of planData.steps) {
      if (stepIds.has(step.id)) errors.push(`Duplicate step ID: ${step.id}`);
      stepIds.add(step.id);
    }

    // Check dependency references exist
    for (const step of planData.steps) {
      for (const dep of step.dependencies) {
        if (!stepIds.has(dep)) errors.push(`Step ${step.id} depends on unknown step: ${dep}`);
      }
    }

    // Check for cycles (simple check)
    const visited = new Set<string>();
    const recStack = new Set<string>();
    function hasCycle(node: string): boolean {
      visited.add(node);
      recStack.add(node);
      const step = planData.steps.find(s => s.id === node);
      if (step) {
        for (const dep of step.dependencies) {
          if (!visited.has(dep) && hasCycle(dep)) return true;
          if (recStack.has(dep)) return true;
        }
      }
      recStack.delete(node);
      return false;
    }
    for (const step of planData.steps) {
      if (!visited.has(step.id) && hasCycle(step.id)) {
        errors.push(`Cycle detected in plan dependencies`);
        break;
      }
    }

    return { valid: errors.length === 0, errors };
  }
  return { valid: false, errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
}
