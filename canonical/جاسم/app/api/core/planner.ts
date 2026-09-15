/**
 * JASIM Planner V2 — LLM-Powered Dynamic Planning & Orchestration
 *
 * Responsibilities:
 *   - Understand user intent (via IntentEngine)
 *   - Decompose goals into executable DAGs using LLM reasoning
 *   - Discover required capabilities
 *   - Compose agents for plan execution
 *   - Generate Task DNA from intent
 *   - Risk assessment, human-in-the-loop gates, and automatic fallbacks
 *
 * V2 Changes:
 *   - LLM-based dynamic plan generation (replaces static DAG templates)
 *   - Risk assessment per plan node
 *   - Human approval gates for high-risk operations
 *   - Fallback nodes for critical paths
 *   - Capability validation with graceful degradation
 */

import { z } from "zod";
import { db } from "../queries/connection";
import { tasks, taskSteps } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  TASK_STATUSES,
  DNA_PRIMITIVES,
  type DnaPrimitive,
  type TaskStatus,
  type Capability,
  type PlanNode,
  type DAG,
  type TaskDNA,
  type Agent,
  type JSONSchema,
} from "@contracts/jasim";
import {
  TaskError,
  ValidationError,
  NotFoundError,
  ERROR_CODES,
} from "@contracts/errors";
import { llmRouter } from "./llm-router";
import type { Intent } from "./intent-engine";
import type { Cytoplasm } from "./cytoplasm";
import type { CapabilityRegistry } from "./capability-registry";

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schemas for LLM Output Validation
// ═══════════════════════════════════════════════════════════════════════════════

const LlmPlanStepSchema = z.object({
  name: z.string(),
  capability: z.string(),
  description: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  dependencies: z.array(z.string()).default([]),
  parallel: z.boolean().default(false),
  risk: z.enum(["none", "low", "medium", "high", "critical"]).default("low"),
  requiresApproval: z.boolean().default(false),
  fallbackCapability: z.string().optional(),
});

const LlmPlanResultSchema = z.object({
  steps: z.array(LlmPlanStepSchema).min(1),
  reasoning: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AgentCompositionRequest {
  goal: string;
  taskId: string;
  capabilities: string[];
  tools: string[];
  permissions: string[];
  memory: Array<Record<string, unknown>>;
  constraints: Record<string, unknown>;
}

interface LLMPlanResult {
  steps: Array<{
    name: string;
    capability: string;
    description?: string;
    inputs: Record<string, unknown>;
    dependencies: string[];
    parallel: boolean;
    risk: "none" | "low" | "medium" | "high" | "critical";
    requiresApproval: boolean;
    fallbackCapability?: string;
  }>;
  reasoning?: string;
}

interface PlanContext {
  userId?: string;
  conversationId?: string;
  taskId?: string;
  previousMessages?: Array<{ role: string; content: string }>;
  accumulatedContext?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Planner V2
// ═══════════════════════════════════════════════════════════════════════════════

export class Planner {
  private cytoplasm: Cytoplasm;
  private capabilityRegistry: CapabilityRegistry;

  constructor(cytoplasm: Cytoplasm, capabilityRegistry: CapabilityRegistry) {
    this.cytoplasm = cytoplasm;
    this.capabilityRegistry = capabilityRegistry;
  }

  // ── Understand Intent ────────────────────────────────────────────────────────

  async understand(goal: string, context: Record<string, unknown> = {}): Promise<Intent> {
    const { IntentEngine } = await import("./intent-engine");
    const engine = new IntentEngine();

    const conversationContext = {
      accumulatedContext: context,
      previousMessages: (context.previousMessages as Array<Record<string, unknown>>) ?? [],
      userId: String(context.userId ?? ""),
    };

    const intent = await engine.classify(goal, conversationContext);

    await this.cytoplasm.tracer.trace({
      taskId: context.taskId ? Number(context.taskId) : undefined,
      capabilityId: undefined,
      toolId: undefined,
      agentId: context.agentId ? String(context.agentId) : undefined,
      inputs: { goal, context },
      outputs: { intent },
      duration: 0,
      status: "completed",
      metadata: { phase: "understand" },
    });

    return intent;
  }

  // ── Decompose Goal into Plan (LLM-Powered) ───────────────────────────────────

  async plan(
    goal: string,
    intent: Intent,
    availableCapabilities: Capability[],
    context?: PlanContext
  ): Promise<DAG> {
    let planResult: LLMPlanResult;
    let planSource: "learned" | "generated" = "generated";

    // ── MEMORY PATH: Check learning engine for known patterns ───────────────
    try {
      const learnedPattern = await this.cytoplasm.learning.getBestPattern(intent.type);

      if (learnedPattern && learnedPattern.score > 0.8) {
        console.log(`[Planner] Using learned pattern for intent=${intent.type} (score=${learnedPattern.score.toFixed(3)})`);
        const adaptedNodes = await this.cytoplasm.learning.adaptPlan(learnedPattern.plan, intent.type);
        planResult = this.planNodesToResult(adaptedNodes, goal, intent);
        planSource = "learned";
      } else {
        // ── LLM PATH: Generate new plan ─────────────────────────────────
        planResult = await this.llmPlan(goal, intent, availableCapabilities, context);
      }
    } catch (err) {
      console.warn("[Planner] Learning engine lookup failed, falling back to LLM:", err instanceof Error ? err.message : String(err));
      planResult = await this.llmPlan(goal, intent, availableCapabilities, context);
    }

    // Step 2: Parse plan into DAG
    let dag = this.parsePlanToDAG(planResult, goal, intent);

    // Step 3: Validate capabilities exist
    dag = this.validateCapabilities(dag, availableCapabilities);

    // Step 4: Add risk assessment
    dag = this.assessRisk(dag, availableCapabilities);

    // Step 5: Add human gates where needed
    dag = this.addHumanGates(dag);

    // Step 6: Add fallbacks
    dag = this.addFallbacks(dag);

    // ── LEARNING PATH: Score and store plan for future learning ───────────
    try {
      const planScore = await this.cytoplasm.learning.scorePlan(dag.nodes);
      await this.cytoplasm.learning.recordPattern(
        intent.type,
        dag.nodes,
        { source: planSource, score: planScore },
        0, // Will be updated after execution via task-runtime
      );

      // Also store in operational memory for fast retrieval
      await this.cytoplasm.operational.storePattern({
        goalType: intent.type,
        capabilities: dag.nodes.map((n) => n.capability),
        toolSequence: dag.nodes.map((n) => n.name),
        contextConditions: { goal, confidence: intent.confidence },
        successRate: planScore,
        executionCount: 0,
        avgDurationMs: 0,
      });

      console.log(`[Planner] Scored plan for intent=${intent.type}: score=${planScore.toFixed(3)} source=${planSource}`);
    } catch (learnErr) {
      console.warn("[Planner] Learning storage failed:", learnErr instanceof Error ? learnErr.message : String(learnErr));
    }

    // Log trace
    await this.cytoplasm.tracer.trace({
      taskId: context?.taskId ? Number(context.taskId) : undefined,
      capabilityId: undefined,
      toolId: undefined,
      agentId: undefined,
      inputs: { goal, intent, availableCapabilities: availableCapabilities.length },
      outputs: { dag },
      duration: 0,
      status: "completed",
      metadata: { phase: "plan", llmReasoning: planResult.reasoning, planSource },
    });

    return dag;
  }

  // ── Discover Capabilities ────────────────────────────────────────────────────

  async discoverCapabilities(goal: string, intent: Intent): Promise<Capability[]> {
    const discovered = await this.capabilityRegistry.discover(goal, { intent });

    const required = new Set(intent.suggestedPrimitives.map((p) => p.toLowerCase()));
    const filtered = discovered.filter((cap) => {
      const name = cap.name.toLowerCase();
      return (
        required.has(name) ||
        intent.requiredCapabilities.some((rc) => name.includes(rc.toLowerCase()))
      );
    });

    return filtered.length > 0 ? filtered : discovered.slice(0, 5);
  }

  // ── Compose Agents ───────────────────────────────────────────────────────────

  async composeAgents(plan: DAG, context: Record<string, unknown>): Promise<Agent[]> {
    const agents: Agent[] = [];
    const capabilityGroups = this.groupByCapability(plan);

    for (const [capabilityName, nodes] of capabilityGroups) {
      if (nodes.length === 0) continue;

      const agent: Agent = {
        id: `agent_${capabilityName.toLowerCase()}_${Date.now()}`,
        name: `${capabilityName} Agent`,
        goal: `Execute ${nodes.map((n) => n.name).join(", ")}`,
        context: {
          goal: String(context.goal ?? ""),
          taskState: context,
          availableCapabilities: [],
          availableTools: [],
          permissions: [],
          memory: { working: {}, longTermRefs: [], contextWindow: [] },
          entities: [],
        },
        constraints: [],
        capabilities: [capabilityName],
        tools: [],
        permissions: [],
        memory: { working: {}, longTermRefs: [], contextWindow: [] },
        state: { assignedNodes: nodes.map((n) => n.id), progress: 0 },
        status: "idle",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      agents.push(agent);
    }

    await this.cytoplasm.tracer.trace({
      taskId: context.taskId ? Number(context.taskId) : undefined,
      capabilityId: undefined,
      toolId: undefined,
      agentId: undefined,
      inputs: { plan, context },
      outputs: { agents },
      duration: 0,
      status: "completed",
      metadata: { phase: "composeAgents" },
    });

    return agents;
  }

  // ── Generate Task DNA ────────────────────────────────────────────────────────

  async generateTaskDNA(intent: Intent): Promise<TaskDNA> {
    const primitives = this.mapIntentToPrimitives(intent);

    return {
      id: `dna_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      primitives,
      parameters: {
        goal: intent.goal,
        entities: intent.entities,
        constraints: intent.constraints,
      },
      constraints: Object.keys(intent.constraints),
      target: intent.entities[0]?.value,
      context: {
        confidence: intent.confidence,
        urgency: intent.urgency,
        sentiment: intent.sentiment,
      },
      confidence: intent.confidence,
      metadata: {
        generatedAt: new Date().toISOString(),
        version: "2.0.0",
      },
    };
  }

  // ── Persist Plan to Database ─────────────────────────────────────────────────

  async persistPlan(taskId: number, dag: DAG): Promise<void> {
    await db.update(tasks).set({
      plan: dag as Record<string, unknown>,
      status: "planning",
      updatedAt: new Date(),
    }).where(eq(tasks.id, taskId));

    const stepValues = dag.nodes.map((node) => ({
      taskId,
      name: node.name,
      description: `Execute capability: ${node.capability}`,
      type: "action" as const,
      status: "pending" as const,
      dependencies: node.dependencies,
      inputs: node.inputs,
      outputs: {},
      retryCount: 0,
      maxRetries: 3,
    }));

    if (stepValues.length > 0) {
      await db.insert(taskSteps).values(stepValues);
    }
  }

  // ── Load Plan from Database ──────────────────────────────────────────────────

  async loadPlan(taskId: number): Promise<{ dag: DAG; steps: typeof taskSteps.$inferSelect[] }> {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      throw new NotFoundError("Task", String(taskId));
    }

    if (!task.plan) {
      throw new TaskError(ERROR_CODES.TASK_PLANNING_FAILED, "Task has no plan", String(taskId));
    }

    const steps = await db.query.taskSteps.findMany({
      where: eq(taskSteps.taskId, taskId),
      orderBy: [taskSteps.id],
    });

    return {
      dag: task.plan as unknown as DAG,
      steps,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: LLM-Powered Plan Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  private async llmPlan(
    goal: string,
    intent: Intent,
    availableCapabilities: Capability[],
    context?: PlanContext
  ): Promise<LLMPlanResult> {
    const capsDescription = availableCapabilities
      .map((c) => `- ${c.name}: ${c.description ?? "No description"} (risk: ${c.riskLevel ?? "unknown"})`)
      .join("\n");

    const conversationHistory = context?.previousMessages
      ?.slice(-3)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n") ?? "None";

    const response = await llmRouter.route({
      prompt: `You are JASIM's planning engine. Given a user goal and available capabilities, generate an execution plan.

Goal: ${goal}
Intent: ${intent.type}
Entities: ${JSON.stringify(intent.entities.map((e) => ({ type: e.type, value: e.value })))}
Constraints: ${JSON.stringify(intent.constraints)}
Urgency: ${intent.urgency ?? "medium"}
Sentiment: ${intent.sentiment ?? "neutral"}

Conversation history (last 3 messages):
${conversationHistory}

Available Capabilities:
${capsDescription || "No capabilities registered."}

Return a JSON plan with this exact structure:
{
  "steps": [
    {
      "name": "Descriptive step name",
      "capability": "CapabilityName",
      "description": "What this step does",
      "inputs": { "key": "value" },
      "dependencies": [],
      "parallel": false,
      "risk": "none|low|medium|high|critical",
      "requiresApproval": false,
      "fallbackCapability": "AlternativeCapabilityName"
    }
  ],
  "reasoning": "Brief explanation of the planning strategy"
}

Rules:
1. Generate 3-8 steps depending on complexity
2. First step should be UNDERSTAND (always)
3. Last step should be CONFIRM or COMMUNICATE results
4. Use ONLY capabilities from the Available Capabilities list
5. Set "parallel": true for steps that can execute simultaneously (SEARCH, COMPARE, ANALYZE, VALIDATE)
6. Set "requiresApproval": true for steps with risk "high" or "critical" (bookings, purchases, writes)
7. Set "fallbackCapability" for critical steps that have alternatives
8. Dependencies should reference step indices or previous step names
9. Keep step names concise (2-5 words)
10. Order steps in execution order; parallel steps with same dependencies can run together`,
      systemPrompt: "You are JASIM's planning engine. You decompose user goals into executable step-by-step plans using available capabilities. Be thorough but concise. Return only valid JSON.",
      responseFormat: "json",
      complexity: "complex",
      maxTokens: 2000,
      temperature: 0.3,
    });

    if (response.error || !response.text) {
      console.warn("[Planner] LLM planning failed, using static fallback:", response.error);
      return this.buildStaticFallbackPlan(intent);
    }

    try {
      const parsed = this.safeJsonParse(response.text);
      const validated = LlmPlanResultSchema.safeParse(parsed);

      if (!validated.success) {
        console.warn("[Planner] LLM plan validation failed:", validated.error.message);
        return this.buildStaticFallbackPlan(intent);
      }

      return validated.data;
    } catch (err) {
      console.warn("[Planner] Failed to parse LLM plan:", err instanceof Error ? err.message : String(err));
      return this.buildStaticFallbackPlan(intent);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Plan Parsing & DAG Construction
  // ═══════════════════════════════════════════════════════════════════════════════

  private parsePlanToDAG(planResult: LLMPlanResult, goal: string, intent: Intent): DAG {
    const nodes: PlanNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    const stepIdMap = new Map<number, string>();

    for (let i = 0; i < planResult.steps.length; i++) {
      const step = planResult.steps[i];
      const nodeId = `step_${i + 1}_${this.slugify(step.name)}`;
      stepIdMap.set(i, nodeId);

      const node: PlanNode = {
        id: nodeId,
        name: step.name,
        capability: step.capability,
        dependencies: [],
        inputs: {
          ...step.inputs,
          goal,
          intentType: intent.type,
        },
        outputs: {},
        parallel: step.parallel,
        metadata: {
          description: step.description,
          risk: step.risk,
          requiresApproval: step.requiresApproval,
          fallbackCapability: step.fallbackCapability,
          phase: i === 0 ? "cognition" : i === planResult.steps.length - 1 ? "validation" : "execution",
        },
      };

      nodes.push(node);
    }

    // Resolve dependencies
    for (let i = 0; i < planResult.steps.length; i++) {
      const step = planResult.steps[i];
      const nodeId = stepIdMap.get(i)!;
      const node = nodes[i];

      if (step.dependencies.length === 0 && i > 0) {
        // Default dependency on previous step
        const prevId = stepIdMap.get(i - 1);
        if (prevId) {
          node.dependencies = [prevId];
          edges.push({ from: prevId, to: nodeId });
        }
      } else {
        for (const dep of step.dependencies) {
          // dep can be a step name or an index
          let depId: string | undefined;

          // Try as index
          const depIndex = Number(dep);
          if (!Number.isNaN(depIndex) && depIndex >= 0 && depIndex < planResult.steps.length) {
            depId = stepIdMap.get(depIndex);
          }

          // Try as name match
          if (!depId) {
            const match = nodes.find((n) => n.name === dep || n.id === dep);
            depId = match?.id;
          }

          if (depId && depId !== nodeId) {
            node.dependencies.push(depId);
            edges.push({ from: depId, to: nodeId });
          }
        }
      }
    }

    // Handle parallel execution groups
    const parallelGroups = new Map<string, PlanNode[]>();
    for (const node of nodes) {
      if (node.parallel && node.dependencies.length > 0) {
        const depKey = node.dependencies.sort().join(",");
        if (!parallelGroups.has(depKey)) {
          parallelGroups.set(depKey, []);
        }
        parallelGroups.get(depKey)!.push(node);
      }
    }

    // Add sync nodes after parallel groups
    for (const [depKey, group] of parallelGroups) {
      if (group.length > 1) {
        const syncId = `step_sync_${this.slugify(depKey)}_${Date.now()}`;
        const syncNode: PlanNode = {
          id: syncId,
          name: "Synchronize Results",
          capability: DNA_PRIMITIVES.VALIDATE,
          dependencies: group.map((n) => n.id),
          inputs: { results: [] },
          outputs: {},
          parallel: false,
          metadata: { phase: "sync", description: "Wait for parallel steps to complete" },
        };
        nodes.push(syncNode);
        for (const node of group) {
          edges.push({ from: node.id, to: syncId });
        }

        // Update downstream dependencies to use sync node instead
        const groupIds = new Set(group.map((n) => n.id));
        for (const node of nodes) {
          if (groupIds.has(node.id)) continue;
          const hasGroupDep = node.dependencies.some((d) => groupIds.has(d));
          if (hasGroupDep) {
            node.dependencies = [...new Set([...node.dependencies.filter((d) => !groupIds.has(d)), syncId])];
            edges.push({ from: syncId, to: node.id });
          }
        }
      }
    }

    return {
      nodes,
      edges,
      rootNodeId: nodes[0]?.id ?? "step_1",
      metadata: {
        goal,
        intentType: intent.type,
        confidence: intent.confidence,
        generatedAt: new Date().toISOString(),
        llmReasoning: planResult.reasoning,
        version: "2.0.0",
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Capability Validation
  // ═══════════════════════════════════════════════════════════════════════════════

  private validateCapabilities(dag: DAG, availableCapabilities: Capability[]): DAG {
    const availableNames = new Set(availableCapabilities.map((c) => c.name.toLowerCase()));
    const availableIds = new Set(availableCapabilities.map((c) => String(c.id).toLowerCase()));

    const validatedNodes = dag.nodes.map((node) => {
      const capName = node.capability.toLowerCase();
      const isAvailable = availableNames.has(capName) || availableIds.has(capName);

      if (!isAvailable && node.capability !== DNA_PRIMITIVES.UNDERSTAND && node.capability !== DNA_PRIMITIVES.VALIDATE) {
        // Try to find closest match
        const fallback = availableCapabilities.find((c) =>
          c.name.toLowerCase().includes(capName) || capName.includes(c.name.toLowerCase())
        );

        if (fallback) {
          return {
            ...node,
            capability: fallback.name,
            metadata: {
              ...node.metadata,
              originalCapability: node.capability,
              validated: true,
              substituted: true,
            },
          };
        }

        // Mark as needing external capability
        return {
          ...node,
          metadata: {
            ...node.metadata,
            validated: false,
            missingCapability: node.capability,
            warning: `Capability '${node.capability}' not available in registry`,
          },
        };
      }

      return {
        ...node,
        metadata: {
          ...node.metadata,
          validated: true,
        },
      };
    });

    return { ...dag, nodes: validatedNodes };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Risk Assessment
  // ═══════════════════════════════════════════════════════════════════════════════

  private assessRisk(dag: DAG, availableCapabilities: Capability[]): DAG {
    const riskMap = new Map<string, "none" | "low" | "medium" | "high" | "critical">();

    for (const cap of availableCapabilities) {
      riskMap.set(cap.name.toLowerCase(), (cap.riskLevel ?? "low") as "none" | "low" | "medium" | "high" | "critical");
    }

    const assessedNodes = dag.nodes.map((node) => {
      let risk: "none" | "low" | "medium" | "high" | "critical" =
        (node.metadata?.risk as "none" | "low" | "medium" | "high" | "critical") ?? "low";

      // Override with capability risk if available
      const capRisk = riskMap.get(node.capability.toLowerCase());
      if (capRisk) {
        risk = capRisk;
      }

      // Intent-based risk elevation
      if (node.capability === DNA_PRIMITIVES.BUY || node.capability === DNA_PRIMITIVES.SELL) {
        risk = this.elevateRisk(risk);
      }
      if (node.capability === DNA_PRIMITIVES.BOOK && (node.metadata?.requiresApproval as boolean)) {
        risk = this.elevateRisk(risk);
      }

      // Side-effect detection
      const cap = availableCapabilities.find((c) => c.name.toLowerCase() === node.capability.toLowerCase());
      const hasWriteSideEffect = cap?.sideEffects?.some((s) => s.type === "write" || s.type === "destructive" || s.type === "payment" || s.type === "data_modification");
      if (hasWriteSideEffect) {
        risk = this.elevateRisk(risk);
      }

      return {
        ...node,
        metadata: {
          ...node.metadata,
          risk,
          assessedAt: new Date().toISOString(),
        },
      };
    });

    return { ...dag, nodes: assessedNodes };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Human Approval Gates
  // ═══════════════════════════════════════════════════════════════════════════════

  private addHumanGates(dag: DAG): DAG {
    const gatedNodes: PlanNode[] = [];
    const gatedEdges = [...dag.edges];
    let approvalCount = 0;

    for (const node of dag.nodes) {
      gatedNodes.push(node);

      const risk = (node.metadata?.risk as string) ?? "low";
      const requiresApproval = node.metadata?.requiresApproval as boolean;

      if (risk === "critical" || risk === "high" || requiresApproval) {
        approvalCount++;
        const gateId = `step_approval_${approvalCount}_${node.id}`;
        const gateNode: PlanNode = {
          id: gateId,
          name: `Approve: ${node.name}`,
          capability: DNA_PRIMITIVES.CONFIRM,
          dependencies: [node.id],
          inputs: {
            action: node.name,
            capability: node.capability,
            risk,
            description: `Human approval required before executing: ${node.name}`,
          },
          outputs: {},
          parallel: false,
          metadata: {
            phase: "approval",
            gateType: "human_approval",
            targetNode: node.id,
            risk,
            autoExpire: 3600, // 1 hour
          },
        };
        gatedNodes.push(gateNode);
        gatedEdges.push({ from: node.id, to: gateId });

        // Update downstream dependencies to wait for gate
        for (const downstream of dag.nodes) {
          if (downstream.dependencies.includes(node.id) && downstream.id !== gateId) {
            downstream.dependencies = downstream.dependencies.map((dep) =>
              dep === node.id ? gateId : dep
            );
          }
        }
        for (const edge of gatedEdges) {
          if (edge.from === node.id && edge.to !== gateId) {
            edge.from = gateId;
          }
        }
      }
    }

    return { ...dag, nodes: gatedNodes, edges: gatedEdges };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Fallback Nodes
  // ═══════════════════════════════════════════════════════════════════════════════

  private addFallbacks(dag: DAG): DAG {
    const nodesWithFallbacks: PlanNode[] = [...dag.nodes];
    const fallbackEdges = [...dag.edges];

    for (const node of dag.nodes) {
      const fallbackCap = node.metadata?.fallbackCapability as string | undefined;
      const risk = (node.metadata?.risk as string) ?? "low";

      if (fallbackCap && risk !== "none") {
        const fallbackId = `step_fallback_${node.id}`;
        const fallbackNode: PlanNode = {
          id: fallbackId,
          name: `Fallback: ${node.name}`,
          capability: fallbackCap,
          dependencies: node.dependencies,
          inputs: {
            ...node.inputs,
            fallbackFor: node.id,
            originalCapability: node.capability,
          },
          outputs: {},
          parallel: false,
          metadata: {
            phase: "fallback",
            fallbackFor: node.id,
            description: `Fallback execution if ${node.name} fails`,
          },
        };

        nodesWithFallbacks.push(fallbackNode);
        fallbackEdges.push({ from: node.id, to: fallbackId });
      }
    }

    return { ...dag, nodes: nodesWithFallbacks, edges: fallbackEdges };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Static Fallback Plan (when LLM fails)
  // ═══════════════════════════════════════════════════════════════════════════════

  private buildStaticFallbackPlan(intent: Intent): LLMPlanResult {
    const steps: LLMPlanResult["steps"] = [
      {
        name: "Understand Goal",
        capability: DNA_PRIMITIVES.UNDERSTAND,
        description: "Parse and understand the user's goal",
        inputs: { goal: intent.goal },
        dependencies: [],
        parallel: false,
        risk: "none",
        requiresApproval: false,
      },
      {
        name: "Extract Information",
        capability: DNA_PRIMITIVES.EXTRACT,
        description: "Extract relevant entities and constraints",
        inputs: { entities: intent.entities },
        dependencies: ["0"],
        parallel: false,
        risk: "none",
        requiresApproval: false,
      },
      {
        name: "Reason About Approach",
        capability: DNA_PRIMITIVES.REASON,
        description: "Determine the best approach",
        inputs: { intent: intent.type },
        dependencies: ["1"],
        parallel: false,
        risk: "low",
        requiresApproval: false,
      },
    ];

    for (let i = 0; i < intent.suggestedPrimitives.length; i++) {
      const primitive = intent.suggestedPrimitives[i];
      steps.push({
        name: `${primitive.charAt(0) + primitive.slice(1).toLowerCase()}`,
        capability: primitive,
        description: `Execute ${primitive} operation`,
        inputs: { goal: intent.goal },
        dependencies: [String(steps.length - 1)],
        parallel: this.canRunInParallel(primitive as DnaPrimitive),
        risk: "low",
        requiresApproval: [DNA_PRIMITIVES.BUY, DNA_PRIMITIVES.SELL, DNA_PRIMITIVES.BOOK].includes(primitive as DnaPrimitive),
        fallbackCapability: DNA_PRIMITIVES.EXECUTE,
      });
    }

    steps.push({
      name: "Confirm Results",
      capability: DNA_PRIMITIVES.CONFIRM,
      description: "Validate and confirm execution results",
      inputs: { results: [] },
      dependencies: [String(steps.length - 1)],
      parallel: false,
      risk: "none",
      requiresApproval: false,
    });

    return {
      steps,
      reasoning: "Static fallback plan generated due to LLM unavailability",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PRIVATE: Utility Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private canRunInParallel(primitive: DnaPrimitive): boolean {
    const parallelSafe: DnaPrimitive[] = [
      DNA_PRIMITIVES.SEARCH,
      DNA_PRIMITIVES.RETRIEVE,
      DNA_PRIMITIVES.COMPARE,
      DNA_PRIMITIVES.ANALYZE,
      DNA_PRIMITIVES.CALCULATE,
      DNA_PRIMITIVES.VERIFY,
      DNA_PRIMITIVES.VALIDATE,
      DNA_PRIMITIVES.READ,
      DNA_PRIMITIVES.FILTER,
      DNA_PRIMITIVES.RANK,
      DNA_PRIMITIVES.EXTRACT,
    ];
    return parallelSafe.includes(primitive);
  }

  private elevateRisk(current: "none" | "low" | "medium" | "high" | "critical"): "none" | "low" | "medium" | "high" | "critical" {
    const order: Array<"none" | "low" | "medium" | "high" | "critical"> = ["none", "low", "medium", "high", "critical"];
    const idx = order.indexOf(current);
    return order[Math.min(idx + 1, order.length - 1)];
  }

  private groupByCapability(plan: DAG): Map<string, PlanNode[]> {
    const groups = new Map<string, PlanNode[]>();
    for (const node of plan.nodes) {
      if (!groups.has(node.capability)) {
        groups.set(node.capability, []);
      }
      groups.get(node.capability)!.push(node);
    }
    return groups;
  }

  private mapIntentToPrimitives(intent: Intent): DnaPrimitive[] {
    const mapped: DnaPrimitive[] = [];

    for (const cap of intent.suggestedPrimitives) {
      const upper = cap.toUpperCase();
      if (Object.values(DNA_PRIMITIVES).includes(upper as DnaPrimitive)) {
        mapped.push(upper as DnaPrimitive);
      }
    }

    if (mapped.length === 0) {
      mapped.push(DNA_PRIMITIVES.UNDERSTAND);
      mapped.push(DNA_PRIMITIVES.EXECUTE);
    }

    return [...new Set(mapped)];
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
  }

  /**
   * Convert PlanNodes (from learned pattern adaptation) back into LLMPlanResult format.
   */
  private planNodesToResult(nodes: PlanNode[], goal: string, intent: Intent): LLMPlanResult {
    const steps = nodes.map((node) => ({
      name: node.name,
      capability: node.capability,
      description: (node.metadata?.description as string) ?? `${node.capability} step for ${goal}`,
      inputs: { ...node.inputs, goal, intentType: intent.type },
      dependencies: node.dependencies.map((dep) => dep.replace(/^step_\d+_/, "")),
      parallel: node.parallel,
      risk: (node.metadata?.risk as "none" | "low" | "medium" | "high" | "critical") ?? "low",
      requiresApproval: (node.metadata?.requiresApproval as boolean) ?? false,
      fallbackCapability: (node.metadata?.fallbackCapability as string) ?? undefined,
    }));

    return {
      steps,
      reasoning: `Adapted from learned pattern for intent=${intent.type} (memory-influenced planning)`,
    };
  }

  private safeJsonParse(text: string): unknown {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const cleanText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

    try {
      return JSON.parse(cleanText);
    } catch {
      const firstBrace = cleanText.indexOf("{");
      const lastBrace = cleanText.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          return JSON.parse(cleanText.slice(firstBrace, lastBrace + 1));
        } catch {
          // fall through
        }
      }
      throw new Error("Failed to parse LLM response as JSON");
    }
  }
}
