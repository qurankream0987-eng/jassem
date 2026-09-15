/**
 * JASIM Agent Runtime — Temporary Agent Composition & Execution
 *
 * Agents are TEMPORARY. They are composed for a task and disposed after.
 * No hardcoded agents. All agents are dynamically assembled from capabilities.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { agentLogs, type AgentLog, type NewAgentLog } from "@db/schema";
import {
  AGENT_STATUSES,
  DNA_PRIMITIVES,
  type AgentStatus,
  type Agent,
  type AgentMemory,
  type AgentContext,
  type Capability,
  type Tool,
  type Permission,
} from "@contracts/jasim";
import {
  AgentError,
  NotFoundError,
  ValidationError,
  ERROR_CODES,
} from "@contracts/errors";
import type { Cytoplasm } from "./cytoplasm";
import type { CapabilityRegistry } from "./capability-registry";
import type { ToolRuntime, ExecutionContext } from "./tool-runtime";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentCompositionRequest {
  goal: string;
  taskId: string;
  capabilities: string[]; // capability IDs or names
  tools: string[]; // tool IDs
  permissions: string[];
  memory: Array<Record<string, unknown>>;
  constraints: Record<string, unknown>;
}

export interface PlanNode {
  id: string;
  name: string;
  capability: string;
  dependencies: string[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  parallel: boolean;
  metadata?: Record<string, unknown>;
}

export interface Action {
  type: string;
  target: string;
  inputs: Record<string, unknown>;
  expectedOutput?: string;
}

export interface Request {
  type: "info" | "approval" | "clarification";
  description: string;
  required: boolean;
  options?: unknown[];
}

export interface AgentResult {
  plan?: PlanNode[];
  actions?: Action[];
  results?: unknown[];
  requests?: Request[];
  state: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Runtime
// ═══════════════════════════════════════════════════════════════════════════════

export class AgentRuntime {
  private agents = new Map<string, Agent>();
  private cytoplasm: Cytoplasm;
  private capabilityRegistry: CapabilityRegistry;
  private toolRuntime: ToolRuntime;

  constructor(cytoplasm: Cytoplasm, capabilityRegistry: CapabilityRegistry, toolRuntime: ToolRuntime) {
    this.cytoplasm = cytoplasm;
    this.capabilityRegistry = capabilityRegistry;
    this.toolRuntime = toolRuntime;
  }

  // ── Compose Agent ────────────────────────────────────────────────────────────

  async composeAgent(request: AgentCompositionRequest): Promise<Agent> {
    const validated = z.object({
      goal: z.string().min(1),
      taskId: z.string(),
      capabilities: z.array(z.string()),
      tools: z.array(z.string()),
      permissions: z.array(z.string()),
      memory: z.array(z.record(z.string(), z.unknown())).default([]),
      constraints: z.record(z.string(), z.unknown()).default({}),
    }).parse(request);

    // Resolve capabilities
    const resolvedCapabilities: string[] = [];
    for (const cap of validated.capabilities) {
      try {
        const byName = await this.capabilityRegistry.getByName(cap).catch(() => null);
        if (byName) {
          resolvedCapabilities.push(byName.name);
        } else {
          const byId = await this.capabilityRegistry.get(Number(cap)).catch(() => null);
          if (byId) {
            resolvedCapabilities.push(byId.name);
          }
        }
      } catch {
        // Capability not found, skip
      }
    }

    if (resolvedCapabilities.length === 0) {
      // Default to UNDERSTAND + EXECUTE if no capabilities resolved
      resolvedCapabilities.push(DNA_PRIMITIVES.UNDERSTAND, DNA_PRIMITIVES.EXECUTE);
    }

    const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const memory: AgentMemory = {
      working: { compositionRequest: validated, resolvedCapabilities },
      longTermRefs: [],
      contextWindow: [],
    };

    const context: AgentContext = {
      goal: validated.goal,
      taskState: { taskId: validated.taskId },
      availableCapabilities: [],
      availableTools: [],
      permissions: validated.permissions.map((p) => ({
        id: `perm_${p}`,
        resource: "*",
        action: p,
        granted: true,
      })),
      memory,
      entities: [],
    };

    const agent: Agent = {
      id: agentId,
      name: `Agent-${resolvedCapabilities[0]}`,
      goal: validated.goal,
      context,
      constraints: Object.keys(validated.constraints),
      capabilities: resolvedCapabilities,
      tools: validated.tools,
      permissions: context.permissions,
      memory,
      state: { phase: "composed", progress: 0 },
      status: "idle",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.agents.set(agentId, agent);

    // Log agent creation
    await db.insert(agentLogs).values({
      agentId,
      taskId: Number(validated.taskId),
      capability: resolvedCapabilities[0],
      inputs: { request: validated },
      outputs: { agentId, capabilities: resolvedCapabilities },
      status: "completed",
      model: "jasim-runtime",
    });

    return agent;
  }

  // ── Execute Agent ────────────────────────────────────────────────────────────

  async execute(agentId: string, goal: string, state: Record<string, unknown>): Promise<AgentResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new NotFoundError("Agent", agentId);
    }

    // Update status
    agent.status = "executing";
    agent.state = { ...agent.state, ...state, currentGoal: goal };
    agent.updatedAt = new Date().toISOString();

    const startTime = Date.now();
    const result: AgentResult = { state: agent.state };

    try {
      // Phase 1: Plan
      const plan = await this.planExecution(agent, goal);
      result.plan = plan;

      // Phase 2: Execute plan actions
      const actions: Action[] = [];
      const results: unknown[] = [];

      for (const node of plan) {
        const action: Action = {
          type: node.capability,
          target: node.id,
          inputs: { ...node.inputs, ...this.resolveInputs(node, results) },
        };
        actions.push(action);

        // Execute the capability
        try {
          const capResult = await this.executeCapability(agent, node);
          results.push({ nodeId: node.id, success: true, output: capResult });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.push({ nodeId: node.id, success: false, error: errorMsg });

          // Log failure
          await db.insert(agentLogs).values({
            agentId,
            taskId: agent.context.taskState.taskId ? Number(agent.context.taskState.taskId) : undefined,
            capability: node.capability,
            inputs: action.inputs,
            outputs: { error: errorMsg },
            status: "error",
            error: errorMsg,
            model: "jasim-runtime",
          });

          // If critical capability fails, stop
          if (!this.canContinueAfterError(node.capability)) {
            break;
          }
        }
      }

      result.actions = actions;
      result.results = results;
      agent.status = "completed";
      agent.state.progress = 100;

      // Log completion
      await db.insert(agentLogs).values({
        agentId,
        taskId: agent.context.taskState.taskId ? Number(agent.context.taskState.taskId) : undefined,
        outputs: { result: "completed", actionCount: actions.length },
        duration: Date.now() - startTime,
        status: "completed",
        model: "jasim-runtime",
      });
    } catch (err) {
      agent.status = "failed";
      const errorMsg = err instanceof Error ? err.message : String(err);

      await db.insert(agentLogs).values({
        agentId,
        taskId: agent.context.taskState.taskId ? Number(agent.context.taskState.taskId) : undefined,
        outputs: { error: errorMsg },
        duration: Date.now() - startTime,
        status: "error",
        error: errorMsg,
        model: "jasim-runtime",
      });

      throw new AgentError(
        ERROR_CODES.AGENT_EXECUTION_FAILED,
        errorMsg,
        agentId,
        true
      );
    }

    agent.updatedAt = new Date().toISOString();
    return result;
  }

  // ── Dispose Agent ────────────────────────────────────────────────────────────

  async dispose(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new NotFoundError("Agent", agentId);
    }

    // Log disposal
    await db.insert(agentLogs).values({
      agentId,
      taskId: agent.context.taskState.taskId ? Number(agent.context.taskState.taskId) : undefined,
      outputs: { disposed: true, finalStatus: agent.status },
      status: "completed",
      model: "jasim-runtime",
    });

    this.agents.delete(agentId);
  }

  // ── Recompose Agent ──────────────────────────────────────────────────────────

  async recompose(agentId: string, newCapabilities: string[]): Promise<Agent> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new NotFoundError("Agent", agentId);
    }

    // Resolve new capabilities
    const resolved: string[] = [];
    for (const cap of newCapabilities) {
      try {
        const byName = await this.capabilityRegistry.getByName(cap).catch(() => null);
        if (byName) resolved.push(byName.name);
        else {
          const byId = await this.capabilityRegistry.get(Number(cap)).catch(() => null);
          if (byId) resolved.push(byId.name);
        }
      } catch {
        // Skip
      }
    }

    agent.capabilities = [...new Set([...agent.capabilities, ...resolved])];
    agent.memory.working = { ...agent.memory.working, recomposedAt: new Date().toISOString() };
    agent.updatedAt = new Date().toISOString();

    // Log recomposition
    await db.insert(agentLogs).values({
      agentId,
      taskId: agent.context.taskState.taskId ? Number(agent.context.taskState.taskId) : undefined,
      outputs: { recomposed: true, newCapabilities: resolved, allCapabilities: agent.capabilities },
      status: "completed",
      model: "jasim-runtime",
    });

    return agent;
  }

  // ── Get Agent ──────────────────────────────────────────────────────────────

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async planExecution(agent: Agent, goal: string): Promise<PlanNode[]> {
    // Simple planning: create a node for each capability in sequence
    const nodes: PlanNode[] = [];
    let previousId = "";

    for (let i = 0; i < agent.capabilities.length; i++) {
      const cap = agent.capabilities[i];
      const nodeId = `node_${i}_${cap.toLowerCase()}`;
      const node: PlanNode = {
        id: nodeId,
        name: `${cap}`,
        capability: cap,
        dependencies: previousId ? [previousId] : [],
        inputs: { goal, stepIndex: i },
        outputs: {},
        parallel: false,
        metadata: { agentId: agent.id, taskId: agent.context.taskState.taskId },
      };
      nodes.push(node);
      previousId = nodeId;
    }

    return nodes;
  }

  private async executeCapability(agent: Agent, node: PlanNode): Promise<unknown> {
    const execContext: ExecutionContext = {
      taskId: String(agent.context.taskState.taskId ?? ""),
      agentId: agent.id,
      metadata: { nodeId: node.id, capability: node.capability },
    };

    try {
      const cap = await this.capabilityRegistry.getByName(node.capability);
      return await this.capabilityRegistry.execute(cap.id, node.inputs, execContext);
    } catch {
      // Try as tool
      try {
        const tool = await this.toolRuntime.getByName(node.capability);
        const result = await this.toolRuntime.invoke(tool.id, node.inputs, execContext);
        return result.output;
      } catch {
        // Fallback: return inputs as outputs
        return { passthrough: true, inputs: node.inputs };
      }
    }
  }

  private resolveInputs(node: PlanNode, previousResults: unknown[]): Record<string, unknown> {
    // Pass outputs from previous steps as inputs
    const inputs = { ...node.inputs };
    if (previousResults.length > 0) {
      inputs.previousResults = previousResults;
    }
    return inputs;
  }

  private canContinueAfterError(capability: string): boolean {
    const nonCritical = [
      DNA_PRIMITIVES.SEARCH,
      DNA_PRIMITIVES.DISCOVER,
      DNA_PRIMITIVES.ANALYZE,
      DNA_PRIMITIVES.EXTRACT,
    ];
    return nonCritical.includes(capability as typeof DNA_PRIMITIVES[keyof typeof DNA_PRIMITIVES]);
  }
}
