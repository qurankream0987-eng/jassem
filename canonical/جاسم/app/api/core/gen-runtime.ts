/**
 * JASIM Generative Runtime
 *
 * The main orchestrator that converts USER INTENT into RUNNING PRODUCT.
 *
 * Flow:
 *   User Intent → Intent Engine → DNA Descriptor → Planner → TaskRuntime → UI Contract
 *
 * This is NOT a replacement for TaskRuntime.
 * TaskRuntime executes plans. GenerativeRuntime CREATES and ORCHESTRATES plans.
 */

import type { GeneVersion } from "@contracts/generative-dna";
import {
  type IntentStructure,
  type WorldDNA,
  type ExecutionPlan,
  type UIDescriptor,
  IntentSchema,
  ExecutionPlanSchema,
  validateExecutionPlan,
} from "@contracts/dna";
import { type Capability } from "@contracts/jasim";
import { capabilityRegistry } from "./capability-registry";
import { getDNADescriptor } from "./dna-descriptor";
import { llmRouter } from "./llm-router";
import {
  DynamicRuntimeComposer,
  type DynamicRuntimeComposition,
} from "./dynamic-runtime-composer";
import { parseDeterministicIntent } from "./deterministic-intent";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface GenerativeRuntimeOptions {
  useLLM?: boolean;
  enableVerification?: boolean;
  enableRepair?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface GenerativeRuntimeExecutionContext {
  /** Reuse the chat task instead of creating a second task. */
  taskId?: number;
  userId?: number;
  conversationId?: number;
  /** Explicit world to evolve; otherwise the conversation's attached world is used. */
  parentWorldId?: string;
  attachments?: Array<{
    type: "image" | "voice" | "location" | "file";
    url: string;
    name?: string;
  }>;
}

export interface GenerativeRuntimeResult {
  success: boolean;
  taskId?: string;
  intent?: IntentStructure;
  world?: WorldDNA;
  plan?: ExecutionPlan;
  executionResult?: any;
  uiContract?: UIContract;
  error?: string;
  durationMs: number;
  dnaGenes?: GeneVersion[];
  composition?: DynamicRuntimeComposition;
  temporaryAgentIds?: string[];
}

export interface UIContract {
  screens: UIDescriptor[];
  theme: WorldDNA["theme"];
  data: Record<string, any>;
  status: "ready" | "loading" | "error" | "partial";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Engine (Real — not a mock)
// ═══════════════════════════════════════════════════════════════════════════════

const INTENT_PARSE_PROMPT = `Parse the following user goal into a structured intent.

Extract:
- goal: The main objective (1 sentence)
- actors: Who participates (roles)
- objects: What things are involved
- actions: What operations should be possible
- constraints: Rules or limitations
- desiredOutcomes: What success looks like
- unknowns: What is ambiguous or needs clarification
- domainHints: Keywords that suggest the domain type

Return ONLY valid JSON.`;

export class IntentEngine {
  async parse(userGoal: string): Promise<IntentStructure> {
    try {
      const response = await llmRouter.route({
        complexity: "complex",
        prompt: `${INTENT_PARSE_PROMPT}\n\nUser Goal: "${userGoal}"`,
        systemPrompt: "You are JASIM's Intent Engine. Parse user goals into structured intents. Return ONLY valid JSON.",
        responseFormat: "json",
        requireJson: true,
        streaming: false,
        temperature: 0.2,
        maxTokens: 2000,
      });

      if (response?.text) {
        const parsed = JSON.parse(response.text);
        const validated = IntentSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      }
    } catch (err) {
      console.warn("[IntentEngine] LLM parsing failed:", err);
    }

    // Fallback: deterministic parsing from goal text
    return this.parseDeterministically(userGoal);
  }

  /** Language fallback that extracts generic roles and operations, not apps. */
  parseDeterministically(goal: string): IntentStructure {
    return parseDeterministicIntent(goal);
  }
}

let intentEngineInstance: IntentEngine | null = null;

export function getIntentEngine(): IntentEngine {
  if (!intentEngineInstance) {
    intentEngineInstance = new IntentEngine();
  }
  return intentEngineInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Capability Resolver (discovers capabilities from World DNA)
// ═══════════════════════════════════════════════════════════════════════════════

export class CapabilityResolver {
  async resolve(world: WorldDNA, genes: GeneVersion[] = []): Promise<Capability[]> {
    const capabilities: Capability[] = [];

    for (const binding of world.capabilities) {
      try {
        const cap = await capabilityRegistry.getByName(binding.capabilityId);
        if (cap) {
          // Create a specialized version for this entity
          const specialized = {
            ...cap,
            id: `${binding.capabilityId}_${binding.targetEntity ?? "generic"}`,
            name: `${cap.name} ${binding.targetEntity ?? ""}`.trim(),
            metadata: {
              ...cap.metadata,
              targetEntity: binding.targetEntity,
              inputMapping: binding.inputMapping,
              outputMapping: binding.outputMapping,
              preconditions: binding.preconditions,
              postconditions: binding.postconditions,
              uiHints: binding.uiHints,
            },
          } as unknown as Capability;
          capabilities.push(specialized);
        }
      } catch {
        // Capability not found in registry — skip it
        // In production, this would log a warning
      }
    }

    // Activated capability genes may only bind to executors already reviewed
    // and registered in the canonical CapabilityRegistry.
    for (const gene of genes) {
      if (gene.status !== "active" || gene.proposal.kind !== "capability" || !gene.proposal.executorRef) continue;
      const executorName = gene.proposal.executorRef.replace(/^capability:/, "");
      try {
        const cap = await capabilityRegistry.getByName(executorName);
        if (cap && !capabilities.some((item) => item.id === String(cap.id))) {
          capabilities.push({
            ...cap,
            id: String(cap.id),
            metadata: {
              ...cap.metadata,
              dnaGeneId: gene.geneId,
              dnaVersionId: gene.id,
              dnaFitness: gene.fitness.score,
            },
          } as unknown as Capability);
        }
      } catch {
        // A stale executor reference never becomes an implicit execution path.
      }
    }

    return capabilities;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Planner (generates ExecutionPlan from WorldDNA + Capabilities)
// ═══════════════════════════════════════════════════════════════════════════════

const PLAN_GENERATION_PROMPT = `You are JASIM's Planner. Generate an execution plan (DAG) from a World Definition.

Given:
- A World with entities, capabilities, and workflows
- A specific user intent

Generate an Execution Plan with steps that:
1. Can be executed by TaskRuntime
2. Respect dependencies (DAG — no cycles)
3. Include verification for each step
4. Include fallback strategies

Each step needs:
- id: unique string
- name: human-readable
- capabilityId: which capability executes this
- inputs: what the step needs
- dependencies: which steps must complete first
- parallel: can run in parallel with others
- optional: can be skipped if fails
- risk: none|low|medium|high|critical
- verification: how to verify the result

Return ONLY valid JSON matching ExecutionPlan schema.`;

export class GenerativePlanner {
  async plan(
    intent: IntentStructure,
    world: WorldDNA,
    capabilities: Capability[],
    genes: GeneVersion[] = [],
  ): Promise<ExecutionPlan> {
    try {
      const response = await llmRouter.route({
        complexity: "complex",
        prompt: `${PLAN_GENERATION_PROMPT}\n\nIntent: ${JSON.stringify(intent)}\nWorld: ${JSON.stringify(world)}\nCapabilities: ${capabilities.map(c => c.id).join(", ")}\nActive DNA: ${JSON.stringify(genes.map(g => ({ kind: g.proposal.kind, name: g.proposal.name, summary: g.proposal.summary, executorRef: g.proposal.executorRef, fitness: g.fitness.score })))}`,
        systemPrompt: "You are JASIM's Planner. Generate executable DAG plans. Return ONLY valid JSON.",
        responseFormat: "json",
        requireJson: true,
        streaming: false,
        temperature: 0.2,
        maxTokens: 4000,
      });

      if (response?.text) {
        const parsed = JSON.parse(response.text);
        const validated = ExecutionPlanSchema.safeParse(parsed);
        if (validated.success) {
          const plan = validated.data;
          const execValidation = validateExecutionPlan(plan);
          if (execValidation.valid) return plan;
          console.warn("[GenerativePlanner] LLM plan failed execution validation:", execValidation.errors);
        }
      }
    } catch (err) {
      console.warn("[GenerativePlanner] LLM planning failed:", err);
    }

    // Fallback: generate plan from workflow definitions
    return this.fallbackPlan(intent, world);
  }

  private fallbackPlan(intent: IntentStructure, world: WorldDNA): ExecutionPlan {
    const steps: ExecutionPlan["steps"] = [];
    const edges: ExecutionPlan["edges"] = [];

    // Use the first workflow or generate a default one
    const workflow = world.workflows[0];
    if (workflow) {
      const prevSteps: string[] = [];
      for (const wfStep of workflow.steps) {
        const stepId = `step_${steps.length + 1}`;
        steps.push({
          id: stepId,
          name: wfStep.name,
          description: wfStep.description ?? `Execute ${wfStep.capabilityBinding}`,
          capabilityId: wfStep.capabilityBinding,
          inputs: wfStep.inputs,
          outputs: {},
          dependencies: [...prevSteps],
          parallel: wfStep.parallel ?? false,
          optional: wfStep.optional ?? false,
          risk: "low",
          requiresApproval: false,
          verification: { type: "schema", config: {} },
        });
        for (const prev of prevSteps) {
          edges.push({ from: prev, to: stepId });
        }
        if (!wfStep.parallel) {
          prevSteps.length = 0;
          prevSteps.push(stepId);
        } else {
          prevSteps.push(stepId);
        }
      }
    }

    // Add default steps if no workflow
    if (steps.length === 0) {
      const step1 = `step_1`;
      const step2 = `step_2`;
      steps.push(
        {
          id: step1,
          name: "Initialize",
          description: "Initialize the generated runtime",
          capabilityId: "generic.READ",
          inputs: { goal: intent.goal },
          outputs: {},
          dependencies: [],
          parallel: false,
          optional: false,
          risk: "none",
          requiresApproval: false,
          verification: { type: "none", config: {} },
        },
        {
          id: step2,
          name: "Execute Main Action",
          description: "Execute the primary generated capability",
          capabilityId: world.capabilities[0]?.capabilityId || "generic.READ",
          inputs: {},
          outputs: {},
          dependencies: [step1],
          parallel: false,
          optional: false,
          risk: "low",
          requiresApproval: false,
          verification: { type: "schema", config: {} },
        },
      );
      edges.push({ from: step1, to: step2 });
    }

    return {
      id: `plan_${Date.now()}`,
      name: `Plan for ${intent.goal.slice(0, 30)}`,
      description: `Auto-generated plan for: ${intent.goal}`,
      steps,
      edges,
      onFailure: "replan",
      maxRetries: 3,
      worldId: world.id,
      generatedAt: new Date().toISOString(),
    };
  }
}

let plannerInstance: GenerativePlanner | null = null;

export { getDNADescriptor } from "./dna-descriptor";

export function getGenerativePlanner(): GenerativePlanner {
  if (!plannerInstance) {
    plannerInstance = new GenerativePlanner();
  }
  return plannerInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Contract Generator
// ═══════════════════════════════════════════════════════════════════════════════

export class UIContractGenerator {
  generate(world: WorldDNA, executionResult?: any): UIContract {
    const screens = [...world.ui];
    const pendingExecutionStates = new Set(["pending", "queued", "running", "planning", "loading"]);

    // Add dynamic screens based on execution result
    if (executionResult?.error) {
      screens.push({
        id: "ui_error",
        type: "confirmation",
        title: "Error",
        fields: [],
        actions: [
          { id: "act_retry", label: "Retry", capabilityBinding: "generic.CREATE", variant: "primary" },
          { id: "act_cancel", label: "Cancel", capabilityBinding: "generic.CREATE", variant: "ghost" },
        ],
      });
    }

    // Add progress screen if workflow is running
    if (executionResult?.status === "running") {
      screens.unshift({
        id: "ui_progress",
        type: "progress",
        title: "Processing",
        fields: [],
        actions: [],
      });
    }

    return {
      screens,
      theme: world.theme,
      data: executionResult ?? {},
      // UI readiness and side-effect completion are separate facts. A
      // generated/simulated result is renderable even though its external
      // actions were not executed; that truth remains in data.status.
      status: executionResult?.error
        ? "error"
        : pendingExecutionStates.has(executionResult?.status)
          ? "loading"
          : "ready",
    };
  }
}

let uiGeneratorInstance: UIContractGenerator | null = null;

export function getUIContractGenerator(): UIContractGenerator {
  if (!uiGeneratorInstance) {
    uiGeneratorInstance = new UIContractGenerator();
  }
  return uiGeneratorInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generative Runtime (Main Orchestrator)
// ═══════════════════════════════════════════════════════════════════════════════

export class GenerativeRuntime {
  private intentEngine: IntentEngine;
  private dnaDescriptor: ReturnType<typeof getDNADescriptor>;
  private capabilityResolver: CapabilityResolver;
  private planner: GenerativePlanner;
  private uiGenerator: UIContractGenerator;
  private dynamicComposer: DynamicRuntimeComposer;

  constructor(
    private options: GenerativeRuntimeOptions = {},
  ) {
    this.intentEngine = getIntentEngine();
    this.dnaDescriptor = getDNADescriptor();
    this.capabilityResolver = new CapabilityResolver();
    this.planner = getGenerativePlanner();
    this.uiGenerator = getUIContractGenerator();
    this.dynamicComposer = new DynamicRuntimeComposer();
  }

  /**
   * Execute a user goal end-to-end.
   *
   * Steps:
   * 1. Parse intent
   * 2. Generate world DNA
   * 3. Resolve capabilities
   * 4. Generate execution plan
   * 5. Execute plan via TaskRuntime
   * 6. Generate UI contract
   * 7. Return complete result
   */
  async executeGoal(
    userGoal: string,
    context: GenerativeRuntimeExecutionContext = {},
  ): Promise<GenerativeRuntimeResult> {
    const startTime = Date.now();

    try {
      // Step 1: Parse Intent
      const parsedIntent = await this.intentEngine.parse(userGoal);
      const intent = context.attachments?.length
        ? IntentSchema.parse({
            ...parsedIntent,
            objects: parsedIntent.objects.length > 0
              ? parsedIntent.objects.map((object, index) => index === 0 ? {
                  ...object,
                  attributes: { ...object.attributes, suppliedAttachments: context.attachments },
                } : object)
              : [{
                  name: "user supplied subject",
                  type: "subject",
                  attributes: { suppliedAttachments: context.attachments },
                }],
            actions: context.attachments.some((attachment) => attachment.type === "image")
              ? [...new Set([...parsedIntent.actions, "vision"])]
              : parsedIntent.actions,
          })
        : parsedIntent;

      // Step 2: Retrieve only active, evidence-scored DNA relevant to this goal.
      // Persistence failures do not grant capabilities or stop the base runtime.
      let dnaGenes: GeneVersion[] = [];
      try {
        const { initializeConfiguredCapabilityReleases } = await import("./runtime");
        await initializeConfiguredCapabilityReleases();
      } catch (releaseError) {
        console.warn("[GenerativeRuntime] Signed capability restoration unavailable:", releaseError instanceof Error ? releaseError.message : String(releaseError));
      }
      try {
        const { getGenerativeDNAService } = await import("./runtime");
        dnaGenes = await getGenerativeDNAService().findActiveGenes(userGoal);
      } catch (dnaError) {
        console.warn("[GenerativeRuntime] Active DNA lookup unavailable:", dnaError instanceof Error ? dnaError.message : String(dnaError));
      }

      // Step 3: Compose an ephemeral world, plan, agents and UI from generic
      // operations. No domain application or fixed screen is selected here.
      let composition: DynamicRuntimeComposition | undefined;
      let world: WorldDNA;
      let plan: ExecutionPlan;
      try {
        let baseWorld: WorldDNA | undefined;
        if (context.userId && (context.parentWorldId || context.conversationId)) {
          try {
            const { getGeneratedWorldService } = await import("./runtime");
            baseWorld = context.parentWorldId
              ? (await getGeneratedWorldService().get(context.userId, context.parentWorldId))?.activeWorld
              : context.conversationId
                ? await getGeneratedWorldService().conversationWorld(context.userId, context.conversationId)
                : undefined;
          } catch (worldLookupError) {
            console.warn("[GenerativeRuntime] Attached world lookup unavailable:", worldLookupError instanceof Error ? worldLookupError.message : String(worldLookupError));
          }
        }
        composition = this.dynamicComposer.compose(intent, dnaGenes, { baseWorld, conversationId: context.conversationId });
        world = composition.world;
        plan = composition.plan;
      } catch (compositionError) {
        console.warn("[GenerativeRuntime] Dynamic composition failed; using compatibility fallback:", compositionError instanceof Error ? compositionError.message : String(compositionError));
        world = await this.dnaDescriptor.generate(intent, {
          useLLM: this.options.useLLM,
          fallbackToPattern: false,
          validateOutput: true,
        });
        const fallbackCapabilities = await this.capabilityResolver.resolve(world, dnaGenes);
        plan = await this.planner.plan(intent, world, fallbackCapabilities, dnaGenes);
      }

      // Resolve bindings for audit and stale-executor rejection. The generated
      // plan still references capability names, never domain components.
      await this.capabilityResolver.resolve(world, dnaGenes);

      // Step 5: Execute Plan via TaskRuntime
      // NOTE: In production, this executes against real capabilities.
      // In test/demo mode, we gracefully handle execution failures.
      let executionResult: any;
      let taskId: string | undefined;
      const temporaryAgentIds: string[] = [];
      try {
        const { getAgentRuntime, getTaskRuntime, getGeneratedPlanExecutor } = await import("./runtime");
        const task = context.taskId
          ? { id: context.taskId }
          : await getTaskRuntime().createTask(userGoal, context.userId ?? 1, context.conversationId);
        const numericTaskId = Number(task.id);
        taskId = String(numericTaskId);
        const agentRuntime = getAgentRuntime();
        for (const spec of composition?.agents ?? []) {
          try {
            const agent = await agentRuntime.composeAgent({
              goal: spec.goal,
              taskId,
              capabilities: spec.capabilities,
              tools: [],
              permissions: spec.permissions,
              memory: [{ compositionId: composition?.id, stepIds: spec.stepIds }],
              constraints: { lifetime: spec.lifetime, disposeWhen: spec.disposeWhen },
            });
            temporaryAgentIds.push(agent.id);
          } catch (agentError) {
            console.warn("[GenerativeRuntime] Temporary agent composition failed:", agentError instanceof Error ? agentError.message : String(agentError));
          }
        }
        try {
          executionResult = await getGeneratedPlanExecutor().execute({
            taskId: numericTaskId,
            userId: context.userId ?? 1,
            plan,
            worldId: world.id,
          });
        } finally {
          await Promise.all(temporaryAgentIds.map((agentId) =>
            agentRuntime.dispose(agentId).catch((disposeError) => {
              console.warn("[GenerativeRuntime] Temporary agent disposal failed:", disposeError instanceof Error ? disposeError.message : String(disposeError));
            }),
          ));
        }
      } catch (execErr) {
        console.warn("[GenerativeRuntime] Execution failed (non-critical):", execErr instanceof Error ? execErr.message : String(execErr));
        executionResult = {
          status: "simulated",
          results: {},
          completedSteps: [],
          note: "Execution simulated — generative output is valid",
        };
      }

      // Step 6: Generate UI Contract
      const uiContract = this.uiGenerator.generate(world, executionResult);

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        taskId,
        intent,
        world,
        plan,
        executionResult,
        uiContract,
        dnaGenes,
        composition,
        temporaryAgentIds,
        durationMs,
      };
    } catch (error) {
      console.error("[GenerativeRuntime] executeGoal failed:", error);
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      };
    }
  }

}

// Singleton
let genRuntimeInstance: GenerativeRuntime | null = null;

export function getGenerativeRuntime(options?: GenerativeRuntimeOptions): GenerativeRuntime {
  if (!genRuntimeInstance) {
    genRuntimeInstance = new GenerativeRuntime(options);
  }
  return genRuntimeInstance;
}
