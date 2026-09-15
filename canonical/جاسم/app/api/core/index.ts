/**
 * JASIM Core Runtime — Module Exports
 *
 * Exports all runtime engines for the General Generative Executable Agent.
 */

// ── Cytoplasm (Shared Execution Environment) ──────────────────────────────────
export {
  Cytoplasm,
  getCytoplasm,
  resetCytoplasm,
  MemoryEngine,
  EventBus,
  PolicyEngine,
  PermissionEngine,
  StateManager,
  ConfigManager,
  ExecutionTracer,
  type RuntimeContext,
  type MemoryQuery,
  type PolicyResult,
} from "./cytoplasm";

// ── Capability Registry ───────────────────────────────────────────────────────
export {
  CapabilityRegistry,
  type CapabilityFilter,
} from "./capability-registry";

// ── Tool Runtime ────────────────────────────────────────────────────────────────
export {
  ToolRuntime,
  type ExecutionContext,
  type ToolResult,
} from "./tool-runtime";

// ── Intent Engine ─────────────────────────────────────────────────────────────
export {
  IntentEngine,
  type Entity,
  type Intent,
  type ConversationContext,
} from "./intent-engine";

// ── Planner ───────────────────────────────────────────────────────────────────
export {
  Planner,
  type AgentCompositionRequest,
} from "./planner";

// ── Agent Runtime ─────────────────────────────────────────────────────────────
export {
  AgentRuntime,
  type PlanNode,
  type Action,
  type Request,
  type AgentResult,
} from "./agent-runtime";

// ── Task Runtime ───────────────────────────────────────────────────────────────
export {
  TaskRuntime,
  type RecoveryStrategy,
  type StepExecutionResult,
  type DAGStep,
} from "./task-runtime";

// ── Commerce Runtime ────────────────────────────────────────────────────────────
export {
  CommerceRuntime,
  type NegotiationResult,
} from "./commerce-runtime";
