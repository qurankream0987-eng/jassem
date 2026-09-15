import { eq, and, inArray, or } from 'drizzle-orm';
import { db } from '../queries/connection';
import { tasks, taskSteps } from '@db/schema';
import { getCapabilityRegistry } from './capability-registry';
import { getToolRuntime } from './tool-runtime';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import { TaskError, NotFoundError, ERROR_CODES } from '@contracts/errors';
import { TASK_STATUSES } from '@contracts/constants';
import type { Task } from '@contracts/jasim';
import { llmRouter } from './llm-router';
import type { Cytoplasm } from './cytoplasm';
import type { CapabilityRegistry } from './capability-registry';
import type { ToolRuntime } from './tool-runtime';
import type { AgentRuntime } from './agent-runtime';
import { Planner } from './planner';

const MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 1000;
const MAX_PARALLEL_STEPS = 5;
const STEP_TIMEOUT_MS = 30000;

// Local type definitions (not exported from contracts yet)
interface ExecutionContext {
  taskId: string;
  stepId: string;
  stepName: string;
  stepType: string;
  userId: string;
  correlationId: string;
}

interface StepResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT LOOP: Observation, Verification, Repair, Replanning
// ═══════════════════════════════════════════════════════════════════════════════

interface Observation {
  stepId: number;
  stepName: string;
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE' | 'INVALID_RESULT' | 'BLOCKED' | 'REQUIRES_HUMAN';
  result: Record<string, unknown>;
  error?: string;
  duration: number;
  timestamp: string;
  attempt: number;
}

interface VerificationResult {
  passed: boolean;
  reason: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

interface Artifact {
  taskId: number;
  goal: string;
  status: 'completed' | 'failed' | 'partial';
  stepsCompleted: number;
  stepsFailed: number;
  outputs: Record<string, unknown>;
  observations: Observation[];
  finalResult?: Record<string, unknown>;
  error?: string;
}

// Stub types exported for api/core/index.ts barrel file
export interface RecoveryStrategy {
  name: string;
  fallbackCapability?: string;
  maxRetries: number;
}

export interface StepExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  duration: number;
}

export interface DAGStep {
  id: number;
  name: string;
  type: string;
  status: string;
  dependencies: string[];
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export const taskEventBus = new EventEmitter();
taskEventBus.setMaxListeners(100);

export class TaskRuntime {
  private capabilityRegistry: CapabilityRegistry;
  private toolRuntime: ToolRuntime;
  private agentRuntime: AgentRuntime;
  private cytoplasm: Cytoplasm;
  private runningTasks = new Map<number, AbortController>();
  private stepObservations = new Map<number, Observation[]>();

  constructor(
    cytoplasm: Cytoplasm,
    capabilityRegistry: CapabilityRegistry,
    toolRuntime: ToolRuntime,
    agentRuntime: AgentRuntime,
  ) {
    this.cytoplasm = cytoplasm;
    this.capabilityRegistry = capabilityRegistry;
    this.toolRuntime = toolRuntime;
    this.agentRuntime = agentRuntime;
  }

  async createTask(goal: string, userId: number, conversationId?: number): Promise<Task> {
    const [result] = await db.insert(tasks).values({
      userId,
      goal,
      status: TASK_STATUSES.PLANNING,
      priority: 'normal',
      conversationId: conversationId ?? null,
      context: { createdFrom: 'chat', goal },
      outputs: {},
    }) as any;
    const taskId = Number(result.insertId);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[];
    this.emitEvent(taskId, 'task_created', { taskId, goal, userId });
    return task as Task;
  }

  async executePlan(taskId: number, isReplan: boolean = false): Promise<Task> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[];
    if (!task) throw new NotFoundError('Task', String(taskId));

    await db.update(tasks).set({ status: 'running', startedAt: new Date() }).where(eq(tasks.id, taskId));
    this.emitEvent(taskId, 'execution_started', { taskId, goal: task.goal });

    let steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId)) as any[];
    if (steps.length === 0) {
      console.warn(`[TaskRuntime] No steps found for task ${taskId}. Creating fallback plan.`);
      const fallbackSteps = [
        { taskId, name: 'understand_goal', type: 'action', description: 'Understand the user goal', inputs: { text: task.goal }, status: 'pending', dependencies: [], retryCount: 0 },
        { taskId, name: 'generate_response', type: 'action', description: 'Generate a helpful response', inputs: { prompt: task.goal }, status: 'pending', dependencies: [], retryCount: 0 },
      ];
      for (const s of fallbackSteps) {
        await db.insert(taskSteps).values(s as any);
      }
      steps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId)) as any[];
      // Wire dependency for fallback: step 2 depends on step 1
      if (steps.length >= 2) {
        await db.update(taskSteps).set({ dependencies: [String(steps[0].id)] }).where(eq(taskSteps.id, steps[1].id));
        steps[1].dependencies = [String(steps[0].id)];
      }
    }

    // Filter out cancelled steps when rebuilding DAG after replan
    steps = steps.filter((s: any) => s.status !== 'cancelled');

    const levels = this.buildDAGLevels(steps);
    const abortController = new AbortController();
    this.runningTasks.set(taskId, abortController);
    if (!isReplan) {
      this.stepObservations.set(taskId, []); // Only reset observations on first run
    }
    let completedSteps = 0;
    const totalSteps = steps.length;

    let replanTriggered = false;

    try {
      for (const level of levels) {
        if (abortController.signal.aborted) break;
        if (level.length === 1) {
          const stepReplan = await this.executeStep(taskId, level[0], abortController.signal, steps);
          if (stepReplan) {
            replanTriggered = true;
            break;
          }
        } else {
          const batch = level.slice(0, MAX_PARALLEL_STEPS);
          const results = await Promise.all(batch.map((s: any) => this.executeStep(taskId, s, abortController.signal, steps)));
          if (results.some(r => r)) {
            replanTriggered = true;
            break;
          }
          if (level.length > MAX_PARALLEL_STEPS) {
            const remaining = level.slice(MAX_PARALLEL_STEPS);
            for (const s of remaining) {
              if (abortController.signal.aborted) break;
              const stepReplan = await this.executeStep(taskId, s, abortController.signal, steps);
              if (stepReplan) {
                replanTriggered = true;
                break;
              }
            }
          }
        }
        completedSteps += level.length;
      }

      if (replanTriggered && !isReplan) {
        return this.executePlan(taskId, true);
      }

      const finalSteps = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskId)) as any[];
      const activeSteps = finalSteps.filter((s: any) => s.status !== 'cancelled');
      const allCompleted = activeSteps.every((s: any) => s.status === 'completed');
      const anyFailed = activeSteps.some((s: any) => s.status === 'failed');
      const finalStatus = allCompleted ? TASK_STATUSES.COMPLETED : anyFailed ? TASK_STATUSES.FAILED : 'running';

      // Generate final artifact
      const observations = this.stepObservations.get(taskId) ?? [];
      const artifact = this.generateArtifact(taskId, task, finalSteps, observations);
      this.emitEvent(taskId, 'artifact_generated', { artifact });

      await db.update(tasks).set({
        status: finalStatus,
        completedAt: finalStatus === TASK_STATUSES.COMPLETED ? new Date() : null,
      }).where(eq(tasks.id, taskId));

      this.emitEvent(taskId, 'execution_completed', { taskId, status: finalStatus });
      return (await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[])[0] as Task;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TaskRuntime] Execution error for task ${taskId}:`, errorMsg);
      await db.update(tasks).set({
        status: TASK_STATUSES.FAILED,
        errors: [{ message: errorMsg, step: 'execution', time: new Date().toISOString() }],
        completedAt: new Date(),
      }).where(eq(tasks.id, taskId));
      this.emitEvent(taskId, 'execution_failed', { taskId, error: errorMsg });
      throw new TaskError(ERROR_CODES.TASK_EXECUTION_FAILED, `Task execution failed: ${errorMsg}`, String(taskId));
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  private async executeStep(taskId: number, step: any, signal: AbortSignal, allSteps?: any[]): Promise<boolean> {
    if (signal.aborted) return false;

    // Skip steps that are already in a terminal state
    if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled' || step.status === 'waiting') {
      return false;
    }

    // ── Dependency Check ─────────────────────────────────────────────────────────
    const depIds = Array.isArray(step.dependencies) ? step.dependencies : [];
    if (depIds.length > 0) {
      // Fetch dependency steps — handle both numeric DB IDs and string planner IDs
      const depConditions = depIds.map((depId: string) => {
        // Try numeric ID first
        const numericId = Number(depId);
        if (!Number.isNaN(numericId)) {
          return eq(taskSteps.id, numericId);
        }
        // Fall back to name matching (planner uses string IDs like "step_1_name")
        const nameMatch = depId.replace(/^step_\d+_/, '').replace(/_/g, ' ');
        return eq(taskSteps.name, nameMatch);
      });

      // Check all dependencies in a single query
      const depSteps = await db.select().from(taskSteps)
        .where(and(eq(taskSteps.taskId, taskId), or(...depConditions))) as any[];

      const allDepsCompleted = depSteps.length === depIds.length && depSteps.every((d: any) => d.status === 'completed');
      if (!allDepsCompleted) {
        console.log(`[TaskRuntime] Step ${step.id} waiting for dependencies`);
        return false;
      }
    }

    // ── Resolve Inputs (inject dependency outputs) ───────────────────────────────
    const resolvedInputs = allSteps ? this.resolveStepInputs(step, allSteps) : (step.inputs as Record<string, unknown> ?? {});

    await db.update(taskSteps).set({ status: 'running', startedAt: new Date() }).where(eq(taskSteps.id, step.id));
    this.emitEvent(taskId, 'step_started', { stepId: step.id, stepName: step.name, stepType: step.type });

    try {
      // ── Execute ────────────────────────────────────────────────────────────────
      const result = await this.executeStepInternal(taskId, step, resolvedInputs);

      // ── Observe ────────────────────────────────────────────────────────────────
      const observation = this.createObservation(step, result, step.retryCount);
      this.recordObservation(taskId, observation);

      // ── Verify ─────────────────────────────────────────────────────────────────
      const verification = this.verifyResult(step, result);

      if (!verification.passed) {
        console.warn(`[TaskRuntime] Step ${step.id} verification failed: ${verification.reason}`);

        // ── Repair ───────────────────────────────────────────────────────────────
        const repair = await this.repairStep(taskId, step, observation, verification, allSteps);

        if (repair.action === 'retry') {
          // Will be handled by the retry logic below (same flow as catch block)
          throw new Error(`Verification failed, retry needed: ${verification.reason}`);
        } else if (repair.action === 'alternative') {
          // Alternative succeeded during repair
          await db.update(taskSteps).set({
            status: 'completed',
            completedAt: new Date(),
            outputs: { repaired: true, method: 'alternative' },
            error: null,
          }).where(eq(taskSteps.id, step.id));
          this.emitEvent(taskId, 'step_completed', { stepId: step.id, success: true, repaired: true });
          return false;
        } else if (repair.action === 'skip') {
          await db.update(taskSteps).set({
            status: 'completed',
            completedAt: new Date(),
            outputs: { skipped: true, reason: 'Optional step failed verification' },
          }).where(eq(taskSteps.id, step.id));
          this.emitEvent(taskId, 'step_completed', { stepId: step.id, success: true, skipped: true });
          return false;
        } else if (repair.action === 'escalate') {
          await db.update(taskSteps).set({
            status: 'waiting',
            error: `Escalated to human: ${verification.reason}`,
          }).where(eq(taskSteps.id, step.id));
          this.emitEvent(taskId, 'step_escalated', { stepId: step.id, reason: verification.reason });
          return false;
        } else if (repair.action === 'replan') {
          // Mark step as cancelled before replanning (old plan is being replaced)
          await db.update(taskSteps).set({
            status: 'cancelled',
            error: `Replanning after verification failure: ${verification.reason}`,
          }).where(eq(taskSteps.id, step.id));
          if (allSteps) {
            const stepInMemory = allSteps.find((s: any) => s.id === step.id);
            if (stepInMemory) {
              stepInMemory.status = 'cancelled';
            }
          }
          const observations = this.stepObservations.get(taskId) ?? [];
          const replanSuccess = await this.replan(taskId, step, observations);
          if (replanSuccess) {
            return true; // Signal replan was triggered
          }
          // Replan failed — mark step as failed
          await db.update(taskSteps).set({
            status: 'failed',
            error: `Replanning failed after step ${step.id} failed verification`,
          }).where(eq(taskSteps.id, step.id));
          throw new Error(`Replanning failed after step ${step.id} failed verification`);
        }
      }

      // ── Store Success ──────────────────────────────────────────────────────────
      await db.update(taskSteps).set({
        status: result.success ? 'completed' : 'failed',
        completedAt: new Date(),
        outputs: result.output as Record<string, unknown> ?? {},
        error: result.error ?? null,
        retryCount: step.retryCount + (result.success ? 0 : 1),
      }).where(eq(taskSteps.id, step.id));

      // TASK 1 FIX: Update in-memory allSteps so downstream steps see this output
      if (allSteps) {
        const stepInMemory = allSteps.find((s: any) => s.id === step.id);
        if (stepInMemory) {
          stepInMemory.outputs = result.output ?? {};
          stepInMemory.status = result.success ? 'completed' : 'failed';
          stepInMemory.retryCount = step.retryCount + (result.success ? 0 : 1);
        }
      }

      if (result.success && result.output) {
        const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[];
        const currentOutputs = (task.outputs as Record<string, unknown> ?? {});
        await db.update(tasks).set({
          outputs: { ...currentOutputs, [step.name]: result.output },
        }).where(eq(tasks.id, taskId));
      }
      this.emitEvent(taskId, 'step_completed', { stepId: step.id, success: result.success, output: result.output });
      return false;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TaskRuntime] Step ${step.id} (${step.name}) failed:`, errorMsg);
      const newRetryCount = step.retryCount + 1;
      if (newRetryCount <= MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, newRetryCount - 1);
        console.log(`[TaskRuntime] Retrying step ${step.id} in ${backoff}ms (attempt ${newRetryCount}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, backoff));
        await db.update(taskSteps).set({
          status: 'pending',
          retryCount: newRetryCount,
          error: `Retry ${newRetryCount}: ${errorMsg}`,
        }).where(eq(taskSteps.id, step.id));
        // TASK 1 FIX: Update in-memory retry count
        if (allSteps) {
          const stepInMemory = allSteps.find((s: any) => s.id === step.id);
          if (stepInMemory) {
            stepInMemory.retryCount = newRetryCount;
            stepInMemory.error = `Retry ${newRetryCount}: ${errorMsg}`;
          }
        }
        const retryReplan = await this.executeStep(taskId, { ...step, status: 'pending', retryCount: newRetryCount }, signal, allSteps);
        if (retryReplan) {
          return true; // Propagate replan signal up
        }
      } else {
        // Mark step as cancelled before attempting recovery/replan
        // (if replan succeeds, the step is replaced; if replan fails, we'll mark as failed)
        await db.update(taskSteps).set({
          status: 'cancelled',
          error: errorMsg,
          completedAt: new Date(),
          retryCount: newRetryCount,
        }).where(eq(taskSteps.id, step.id));

        // TASK 1 FIX: Update in-memory failed state
        if (allSteps) {
          const stepInMemory = allSteps.find((s: any) => s.id === step.id);
          if (stepInMemory) {
            stepInMemory.status = 'cancelled';
            stepInMemory.error = errorMsg;
            stepInMemory.retryCount = newRetryCount;
          }
        }

        // Record failure observation
        const failObservation: Observation = {
          stepId: step.id,
          stepName: step.name,
          status: 'FAILURE',
          result: {},
          error: errorMsg,
          duration: 0,
          timestamp: new Date().toISOString(),
          attempt: newRetryCount,
        };
        this.recordObservation(taskId, failObservation);

        // Try recovery
        const recovered = await this.tryRecovery(taskId, step, errorMsg, allSteps);
        if (!recovered) {
          // Trigger replan if recovery fails
          const observations = this.stepObservations.get(taskId) ?? [];
          const replanSuccess = await this.replan(taskId, step, observations);
          if (replanSuccess) {
            return true; // Signal replan was triggered
          }

          // Replan failed — mark step as failed
          await db.update(taskSteps).set({
            status: 'failed',
            error: `Replanning failed after execution failure: ${errorMsg}`,
          }).where(eq(taskSteps.id, step.id));

          // Replan failed — mark task as FAILED
          await db.update(tasks).set({
            status: TASK_STATUSES.FAILED,
            errors: [{ message: `Step ${step.name} failed after ${MAX_RETRIES} retries: ${errorMsg}`, step: step.name, time: new Date().toISOString() }],
          }).where(eq(tasks.id, taskId));
        }
      }
      this.emitEvent(taskId, 'step_failed', { stepId: step.id, error: errorMsg, retries: newRetryCount });
    }
  }

  private recordObservation(taskId: number, observation: Observation): void {
    const existing = this.stepObservations.get(taskId) ?? [];
    existing.push(observation);
    this.stepObservations.set(taskId, existing);
  }

  private buildDAGLevels(steps: any[]): any[][] {
    const levels: any[][] = [];
    const visited = new Set<number>();
    const remaining = new Set(steps.map((s: any) => s.id));

    while (remaining.size > 0) {
      const level: any[] = [];
      const toRemove = new Set<number>();

      for (const stepId of remaining) {
        const step = steps.find((s: any) => s.id === stepId);
        if (!step) {
          toRemove.add(stepId);
          continue;
        }

        let depsMet = true;
        const deps = Array.isArray(step.dependencies) ? step.dependencies : [];
        for (const depId of deps) {
          const depStep = steps.find((s: any) => String(s.id) === String(depId));
          if (depStep && !visited.has(depStep.id)) {
            depsMet = false;
            break;
          }
        }

        if (depsMet) {
          level.push(step);
          toRemove.add(stepId);
        }
      }

      // Remove processed steps after iteration completes
      for (const id of toRemove) {
        remaining.delete(id);
      }

      if (level.length === 0) {
        console.warn('[TaskRuntime] Could not resolve DAG level, possible circular dependency');
        break;
      }
      levels.push(level);
      for (const s of level) visited.add(s.id);
    }
    return levels;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 2 — Resolve Step Inputs (Dependency Output Injection)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Resolves a step's inputs by merging dependency outputs.
   * Handles template variables like "$step_name.outputs" and "$prev.outputs".
   */
  private resolveStepInputs(step: any, allSteps: any[]): Record<string, unknown> {
    const baseInputs = (step.inputs as Record<string, unknown> ?? {});
    const resolved: Record<string, unknown> = { ...baseInputs };

    // Find dependency steps and merge their outputs
    const depIds = Array.isArray(step.dependencies) ? step.dependencies : [];
    for (const depId of depIds) {
      // Match by numeric ID, string ID, or name
      const depStep = allSteps.find((s: any) =>
        String(s.id) === String(depId) ||
        s.name === depId ||
        (typeof depId === 'string' && s.name === depId.replace(/^step_\d+_/, '').replace(/_/g, ' '))
      );

      if (depStep && depStep.outputs && Object.keys(depStep.outputs).length > 0) {
        // Merge under a namespaced key to avoid collisions
        const depKey = depStep.name.replace(/\s+/g, '_').toLowerCase();
        resolved[`${depKey}_output`] = depStep.outputs;

        // Also flatten specific common fields for convenience
        if (depStep.outputs.result !== undefined) {
          resolved[`${depKey}_result`] = depStep.outputs.result;
        }
        if (depStep.outputs.data !== undefined) {
          resolved[`${depKey}_data`] = depStep.outputs.data;
        }

        // Make outputs available under the raw dependency ID too
        resolved[`dep_${String(depId).replace(/[^a-zA-Z0-9]/g, '_')}`] = depStep.outputs;
      }
    }

    // Resolve template variables in string values: "$step_name.outputs.field"
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        resolved[key] = this.resolveTemplateVariable(value, allSteps);
      }
    }

    return resolved;
  }

  private resolveTemplateVariable(template: string, allSteps: any[]): unknown {
    // Patterns: "$step_name.outputs", "$prev.outputs.result", "$step_name.output"
    const match = template.match(/^\$([a-zA-Z0-9_\s]+)\.(outputs?|result|data)(?:\.(.+))?$/);
    if (!match) return template;

    const [, stepRef, , fieldPath] = match;
    const targetStep = allSteps.find((s: any) =>
      s.name.toLowerCase() === stepRef.toLowerCase() ||
      s.name.toLowerCase().replace(/\s+/g, '_') === stepRef.toLowerCase()
    );

    if (!targetStep || !targetStep.outputs) return template;

    if (fieldPath) {
      const parts = fieldPath.split('.');
      let value: unknown = targetStep.outputs;
      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          return template;
        }
      }
      return value;
    }

    return targetStep.outputs;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 4 — Observation (Structured capture after execution)
  // ═══════════════════════════════════════════════════════════════════════════════

  private createObservation(step: any, result: StepResult, attempt: number): Observation {
    let status: Observation['status'];

    if (!result.success) {
      status = result.error?.includes('human') || result.error?.includes('approval')
        ? 'REQUIRES_HUMAN'
        : result.error?.includes('blocked') || result.error?.includes('unauthorized')
          ? 'BLOCKED'
          : 'FAILURE';
    } else if (!result.output || Object.keys(result.output).length === 0) {
      status = 'INVALID_RESULT';
    } else if (result.error) {
      status = 'PARTIAL_SUCCESS';
    } else {
      status = 'SUCCESS';
    }

    return {
      stepId: step.id,
      stepName: step.name,
      status,
      result: result.output,
      error: result.error,
      duration: result.duration,
      timestamp: new Date().toISOString(),
      attempt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 5 — Verification (Validate result against expected outcome)
  // ═══════════════════════════════════════════════════════════════════════════════

  private verifyResult(step: any, result: StepResult): VerificationResult {
    const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

    // Check 1: Execution succeeded
    checks.push({
      name: 'execution_success',
      passed: result.success,
      detail: result.success ? 'Step executed without throwing' : `Execution failed: ${result.error}`,
    });

    // Check 2: Output is not empty
    const hasOutput = result.output && Object.keys(result.output).length > 0;
    checks.push({
      name: 'output_present',
      passed: hasOutput,
      detail: hasOutput ? `Output has ${Object.keys(result.output).length} fields` : 'Output is empty or null',
    });

    // Check 3: No error field unless partial success
    const hasCriticalError = result.error && !result.error.includes('warning') && !result.error.includes('deprecated');
    checks.push({
      name: 'no_critical_error',
      passed: !hasCriticalError || result.success,
      detail: hasCriticalError ? `Error present: ${result.error}` : 'No critical errors',
    });

    // Check 4: If step expects specific output fields, verify them
    const expectedOutput = step.expectedOutput as Record<string, string> | undefined;
    if (expectedOutput && hasOutput) {
      for (const [field, type] of Object.entries(expectedOutput)) {
        const hasField = field in result.output;
        const correctType = hasField ? typeof result.output[field] === type : false;
        checks.push({
          name: `expected_field_${field}`,
          passed: hasField && correctType,
          detail: hasField
            ? (correctType ? `Field ${field} has correct type ${type}` : `Field ${field} has wrong type: expected ${type}, got ${typeof result.output[field]}`)
            : `Missing expected field: ${field}`,
        });
      }
    }

    const allPassed = checks.every((c) => c.passed);
    return {
      passed: allPassed,
      reason: allPassed
        ? 'All verification checks passed'
        : `Failed checks: ${checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
      checks,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 6 — Repair (Bounded recovery when verification fails)
  // ═══════════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 6 — Repair Decision Engine (Dynamic + Deterministic Fallback)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Decides the repair action based on observation, verification result, and step metadata.
   * First attempts LLM-based decision; falls back to deterministic policy if LLM unavailable.
   */
  private async decideRepairAction(
    step: any,
    observation: Observation,
    verification: VerificationResult,
    alternatives: any[],
  ): Promise<{ action: 'retry' | 'alternative' | 'replan' | 'escalate' | 'skip'; reasoning: string; confidence: number }> {
    // Build structured context for the decision
    const decisionContext = {
      stepName: step.name,
      stepType: step.type,
      retryCount: step.retryCount,
      maxRetries: MAX_RETRIES,
      optional: step.optional ?? false,
      riskLevel: step.riskLevel ?? 'normal',
      observationStatus: observation.status,
      verificationPassed: verification.passed,
      failedChecks: verification.checks.filter(c => !c.passed).map(c => c.name),
      hasAlternatives: alternatives.length > 0,
      alternativeCount: alternatives.length,
    };

    // Try LLM-based decision first
    try {
      const llmDecision = await llmRouter.route({
        prompt: `You are a repair decision engine for an AI agent. Given the following context, decide the best repair action.

Context:
${JSON.stringify(decisionContext, null, 2)}

Available actions: retry, alternative, replan, escalate, skip.

Respond with ONLY a JSON object in this exact format:
{"action": "<action>", "reasoning": "<brief reasoning>", "confidence": <0.0-1.0>}`,
        systemPrompt: 'You are a repair decision engine. Output only valid JSON.',
        responseFormat: 'json',
        complexity: 'simple',
        maxTokens: 500,
        temperature: 0.1,
        requireJson: true,
        streaming: false,
      });

      const parsed = typeof llmDecision === 'string' ? JSON.parse(llmDecision) : llmDecision;
      if (parsed && parsed.action && ['retry', 'alternative', 'replan', 'escalate', 'skip'].includes(parsed.action)) {
        return {
          action: parsed.action,
          reasoning: parsed.reasoning || 'LLM decision',
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        };
      }
    } catch (llmErr) {
      console.warn(`[TaskRuntime] LLM repair decision failed, using deterministic fallback:`, llmErr);
    }

    // Deterministic fallback policy
    return this.deterministicRepairPolicy(decisionContext);
  }

  /**
   * Deterministic repair policy when LLM is unavailable.
   */
  private deterministicRepairPolicy(ctx: {
    stepName: string;
    stepType: string;
    retryCount: number;
    maxRetries: number;
    optional: boolean;
    riskLevel: string;
    observationStatus: string;
    verificationPassed: boolean;
    failedChecks: string[];
    hasAlternatives: boolean;
    alternativeCount: number;
  }): { action: 'retry' | 'alternative' | 'replan' | 'escalate' | 'skip'; reasoning: string; confidence: number } {
    // Rule 1: Retry if output was invalid and retries remain
    if (ctx.observationStatus === 'INVALID_RESULT' && ctx.retryCount < ctx.maxRetries) {
      return { action: 'retry', reasoning: 'Invalid result with retries remaining', confidence: 0.95 };
    }

    // Rule 2: Retry if execution failed and retries remain
    if ((ctx.observationStatus === 'FAILURE' || ctx.failedChecks.includes('execution_success')) && ctx.retryCount < ctx.maxRetries) {
      return { action: 'retry', reasoning: 'Execution failure with retries remaining', confidence: 0.9 };
    }

    // Rule 3: Use alternative capability if available
    if (ctx.hasAlternatives) {
      return { action: 'alternative', reasoning: `${ctx.alternativeCount} alternative capability(s) available`, confidence: 0.85 };
    }

    // Rule 4: Skip if optional
    if (ctx.optional) {
      return { action: 'skip', reasoning: 'Step is optional, skipping', confidence: 0.9 };
    }

    // Rule 5: Escalate if high risk
    if (ctx.riskLevel === 'high' || ctx.riskLevel === 'critical') {
      return { action: 'escalate', reasoning: `High risk level: ${ctx.riskLevel}`, confidence: 0.95 };
    }

    // Rule 6: Default to replan
    return { action: 'replan', reasoning: 'No other repair strategies viable, replanning required', confidence: 0.8 };
  }

  private async repairStep(taskId: number, step: any, observation: Observation, verification: VerificationResult, allSteps?: any[]): Promise<{ action: 'retry' | 'alternative' | 'replan' | 'escalate' | 'skip'; success: boolean }> {
    console.log(`[TaskRuntime] Repairing step ${step.id} (${step.name}): ${verification.reason}`);

    const alternatives = await this.findAlternativeCapabilities(step);
    const decision = await this.decideRepairAction(step, observation, verification, alternatives);

    console.log(`[TaskRuntime] Repair decision for step ${step.id}: ${decision.action} (confidence: ${decision.confidence}, reasoning: ${decision.reasoning})`);

    switch (decision.action) {
      case 'retry':
        return { action: 'retry', success: false };

      case 'alternative': {
        if (alternatives.length > 0) {
          console.log(`[TaskRuntime] Repair: Trying ${alternatives.length} alternative(s)`);
          for (const alt of alternatives) {
            try {
              const stepInputs = allSteps ? this.resolveStepInputs(step, allSteps) : (step.inputs as Record<string, unknown> ?? {});
              await this.capabilityRegistry.execute(alt.id, stepInputs, {
                taskId: String(taskId),
                stepId: String(step.id),
                userId: String(step.userId ?? 'system'),
                correlationId: randomUUID(),
              });
              return { action: 'alternative', success: true };
            } catch {
              continue;
            }
          }
        }
        // Alternatives exhausted — fall through to replan
        console.log(`[TaskRuntime] Repair: All alternatives failed, falling back to replan`);
        return { action: 'replan', success: false };
      }

      case 'skip':
        console.log(`[TaskRuntime] Repair: Skipping optional step ${step.id}`);
        return { action: 'skip', success: true };

      case 'escalate':
        console.log(`[TaskRuntime] Repair: Escalating high-risk step ${step.id}`);
        return { action: 'escalate', success: false };

      case 'replan':
      default:
        console.log(`[TaskRuntime] Repair: Replanning required for step ${step.id}`);
        return { action: 'replan', success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 7 — Replanning (Regenerate plan when current plan invalidates)
  // ═══════════════════════════════════════════════════════════════════════════════

  private async replan(taskId: number, failedStep: any, observations: Observation[]): Promise<boolean> {
    console.log(`[TaskRuntime] Replanning task ${taskId} after step ${failedStep.id} failed`);

    try {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[];
      if (!task) return false;

      // Gather context for replanning
      const completedSteps = observations
        .filter((o) => o.status === 'SUCCESS' || o.status === 'PARTIAL_SUCCESS')
        .map((o) => o.stepName);

      const failedSteps = observations
        .filter((o) => o.status === 'FAILURE' || o.status === 'INVALID_RESULT')
        .map((o) => o.stepName);

      // Update task context with replanning metadata
      const currentContext = (task.context as Record<string, unknown> ?? {});
      const replanCount = ((currentContext.replanCount as number) ?? 0) + 1;

      // Prevent infinite replanning loops
      if (replanCount > 3) {
        console.error(`[TaskRuntime] Replanning loop detected for task ${taskId}, aborting`);
        await db.update(tasks).set({
          context: {
            ...currentContext,
            replanned: true,
            replanCount,
            replanAborted: true,
            error: 'Replanning loop detected after 3 attempts',
          },
        }).where(eq(tasks.id, taskId));
        return false;
      }

      await db.update(tasks).set({
        context: {
          ...currentContext,
          replanned: true,
          replanCount,
          completedSteps,
          failedSteps,
          lastFailure: {
            stepId: failedStep.id,
            stepName: failedStep.name,
            error: failedStep.error,
            time: new Date().toISOString(),
          },
        },
      }).where(eq(tasks.id, taskId));

      // ── REAL REPLANNING: Invoke Planner to generate new plan ──────────────────
      try {
        const planner = new Planner(this.cytoplasm, this.capabilityRegistry);

        // Understand the current goal with failure context
        const intent = await planner.understand(task.goal, {
          ...currentContext,
          replanContext: true,
          failedSteps,
          completedSteps,
          previousFailure: {
            stepId: failedStep.id,
            stepName: failedStep.name,
            error: failedStep.error,
          },
        });

        // Get available capabilities
        const availableCapabilities = await this.capabilityRegistry.list();

        // Generate new plan that avoids failed steps
        const newDag = await planner.plan(task.goal, intent, availableCapabilities as any, {
          taskId: String(taskId),
          userId: String(task.userId),
          previousMessages: [],
          accumulatedContext: {
            ...currentContext,
            replanned: true,
            replanCount,
            failedSteps,
            completedSteps,
          },
        });

        // Mark old pending steps as obsolete
        const remainingSteps = await db.select().from(taskSteps)
          .where(and(eq(taskSteps.taskId, taskId), eq(taskSteps.status, 'pending'))) as any[];

        for (const rs of remainingSteps) {
          await db.update(taskSteps).set({
            status: 'cancelled',
            error: 'Cancelled due to replan',
          }).where(eq(taskSteps.id, rs.id));
        }

        // Persist new plan
        await planner.persistPlan(taskId, newDag);

        console.log(`[TaskRuntime] Replanning successful for task ${taskId}: ${newDag.nodes.length} new steps generated`);

        this.emitEvent(taskId, 'replan_completed', {
          taskId,
          replanCount,
          newStepsCount: newDag.nodes.length,
          failedStepId: failedStep.id,
          completedSteps,
        });

        return true;
      } catch (plannerErr) {
        console.error(`[TaskRuntime] Planner invocation failed during replan:`, plannerErr);
        // Fall back to event-based replan (for external handlers)
        this.emitEvent(taskId, 'replan_triggered', {
          taskId,
          failedStepId: failedStep.id,
          failedStepName: failedStep.name,
          completedSteps,
          failedSteps,
          remainingSteps: (await db.select().from(taskSteps)
            .where(and(eq(taskSteps.taskId, taskId), eq(taskSteps.status, 'pending'))) as any[]).length,
          plannerError: plannerErr instanceof Error ? plannerErr.message : String(plannerErr),
        });
        return false;
      }
    } catch (err) {
      console.error(`[TaskRuntime] Replanning failed for task ${taskId}:`, err);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT LOOP: Step 8 — Artifact Generation
  // ═══════════════════════════════════════════════════════════════════════════════

  private generateArtifact(taskId: number, task: any, allSteps: any[], observations: Observation[]): Artifact {
    const completed = allSteps.filter((s: any) => s.status === 'completed');
    const failed = allSteps.filter((s: any) => s.status === 'failed');

    const finalOutputs: Record<string, unknown> = {};
    for (const s of completed) {
      if (s.outputs && Object.keys(s.outputs).length > 0) {
        finalOutputs[s.name] = s.outputs;
      }
    }

    const status: Artifact['status'] = failed.length === 0
      ? 'completed'
      : completed.length === 0
        ? 'failed'
        : 'partial';

    return {
      taskId,
      goal: task.goal,
      status,
      stepsCompleted: completed.length,
      stepsFailed: failed.length,
      outputs: finalOutputs,
      observations,
      finalResult: task.outputs as Record<string, unknown>,
      error: failed.length > 0
        ? `${failed.length} step(s) failed: ${failed.map((f: any) => f.name).join(', ')}`
        : undefined,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]);
  }

  private async executeStepInternal(taskId: number, step: any, resolvedInputs?: Record<string, unknown>): Promise<StepResult> {
    const startTime = Date.now();
    const context: ExecutionContext = {
      taskId: String(taskId),
      stepId: String(step.id),
      stepName: step.name || '',
      stepType: step.type || '',
      userId: String(step.userId ?? 'system'),
      correlationId: randomUUID(),
    };

    try {
      const intelligenceCapabilities = [
        'understand', 'classify', 'plan', 'decompose', 'reason', 'generate', 'create',
        'transform', 'analyze', 'compare', 'negotiate', 'communicate', 'ask',
        'verify', 'validate', 'recover', 'adapt', 'interpret', 'extract', 'vision',
        'discover', 'retrieve', 'search', 'list', 'read', 'write', 'calculate',
        'filter', 'match', 'rank', 'track', 'monitor', 'schedule', 'book',
        'buy', 'sell', 'delegate', 'execute', 'wait', 'retry', 'persist',
        'remember', 'forget', 'confirm', 'list_entities',
      ];

      // Use resolved inputs (with dependency outputs injected) or fall back to raw step inputs
      const stepInputs = resolvedInputs ?? (step.inputs as Record<string, unknown> ?? {});

      if (intelligenceCapabilities.includes(step.type)) {
        const caps = await this.capabilityRegistry.list();
        const cap = caps.find((c: any) => c.name.toLowerCase() === step.type.toLowerCase());
        if (cap) {
          const capResult = await this.withTimeout(
            this.capabilityRegistry.execute(cap.id, stepInputs, context),
            STEP_TIMEOUT_MS,
            `Capability ${cap.name} timed out after ${STEP_TIMEOUT_MS}ms`,
          );
          return {
            success: true,
            output: capResult as Record<string, unknown>,
            duration: Date.now() - startTime,
          };
        }
      }

      const tools = await this.toolRuntime.list();
      const tool = tools.find((t: any) => t.name.toLowerCase() === step.type.toLowerCase());
      if (tool) {
        const result = await this.withTimeout(
          this.toolRuntime.invoke(tool.id, stepInputs, context),
          STEP_TIMEOUT_MS,
          `Tool ${tool.name} timed out after ${STEP_TIMEOUT_MS}ms`,
        );
        return {
          success: result.success,
          output: result.output as Record<string, unknown> ?? {},
          error: result.error,
          duration: Date.now() - startTime,
        };
      }

      console.warn(`[TaskRuntime] Unknown step type: ${step.type}, attempting LLM fallback`);
      const llmResult = await this.withTimeout(llmRouter.route({
        prompt: `Execute step: ${step.name} (${step.type}) for task: ${step.description || ''}`,
        systemPrompt: 'You are JASIM, a general-purpose execution agent. Execute the described step and return the result.',
        responseFormat: 'text',
        complexity: 'simple',
        maxTokens: 1000,
        temperature: 0.3,
        requireJson: false,
        streaming: false,
      }), STEP_TIMEOUT_MS, `LLM fallback timed out after ${STEP_TIMEOUT_MS}ms`) as any;
      return {
        success: true,
        output: { result: llmResult.text || llmResult },
        duration: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TaskRuntime] executeStepInternal error for step ${step.id}:`, errorMsg);
      return {
        success: false,
        output: {},
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }

  private async tryRecovery(taskId: number, step: any, error: string, allSteps?: any[]): Promise<boolean> {
    console.log(`[TaskRuntime] Attempting recovery for step ${step.id} (${step.name})`);
    if (step.retryCount < MAX_RETRIES) {
      console.log(`[TaskRuntime] Recovery: Will retry step ${step.id}`);
      return false;
    }

    const alternatives = await this.findAlternativeCapabilities(step);
    if (alternatives.length > 0) {
      const alt = alternatives[0];
      console.log(`[TaskRuntime] Recovery: Trying alternative capability: ${alt.name}`);
      try {
        const context: ExecutionContext = {
          taskId: String(taskId),
          stepId: String(step.id),
          stepName: step.name || '',
          stepType: step.type || '',
          userId: String(step.userId ?? 'system'),
          correlationId: randomUUID(),
        };
        const stepInputs = allSteps ? this.resolveStepInputs(step, allSteps) : (step.inputs as Record<string, unknown> ?? {});
        const altResult = await this.capabilityRegistry.execute(alt.id, stepInputs, context);
        await db.update(taskSteps).set({
          status: 'completed',
          completedAt: new Date(),
          outputs: altResult as Record<string, unknown> ?? {},
          error: null,
        }).where(eq(taskSteps.id, step.id));
        return true;
      } catch (altErr) {
        console.error(`[TaskRuntime] Alternative capability ${alt.name} also failed:`, altErr);
      }
    }

    if (step.optional) {
      console.log(`[TaskRuntime] Recovery: Skipping optional step ${step.id}`);
      await db.update(taskSteps).set({
        status: 'completed',
        completedAt: new Date(),
        outputs: { skipped: true, reason: 'Optional step failed recovery' },
      }).where(eq(taskSteps.id, step.id));
      return true;
    }

    if (step.riskLevel === 'high' || step.riskLevel === 'critical') {
      console.log(`[TaskRuntime] Recovery: Escalating to human for step ${step.id}`);
      await db.update(taskSteps).set({
        status: 'waiting',
        error: `Escalated to human: ${error}`,
      }).where(eq(taskSteps.id, step.id));
      return true;
    }

    return false;
  }

  private async findAlternativeCapabilities(step: any): Promise<any[]> {
    const allCaps = await this.capabilityRegistry.list();
    const stepType = step.type.toLowerCase();
    return allCaps.filter((cap: any) => {
      const capName = cap.name.toLowerCase();
      return capName !== stepType && capName.includes(stepType);
    }).map((cap: any) => ({ id: cap.id, name: cap.name }));
  }

  private emitEvent(taskId: number, type: string, data: Record<string, unknown>): void {
    const event = {
      taskId,
      type,
      timestamp: new Date().toISOString(),
      ...data,
    };
    taskEventBus.emit('taskEvent', event);
    taskEventBus.emit(type, event);
    // Note: DB persistence of events is disabled until events table schema
    // is updated to include taskId/data columns or a dedicated taskEvents table is created.
  }

  async getTask(taskId: number): Promise<Task> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[];
    if (!task) throw new NotFoundError('Task', String(taskId));
    return task as Task;
  }

  async pause(taskId: number): Promise<void> {
    await db.update(tasks).set({ status: TASK_STATUSES.PAUSED }).where(eq(tasks.id, taskId));
    this.emitEvent(taskId, 'task_paused', { taskId });
  }

  async resume(taskId: number): Promise<Task> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)) as any[];
    if (!task) throw new NotFoundError('Task', String(taskId));
    await db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, taskId));
    this.emitEvent(taskId, 'task_resumed', { taskId });
    return this.executePlan(taskId);
  }

  async transition(taskId: number, status: string, metadata?: Record<string, unknown>): Promise<Task> {
    const updates: any = { status, updatedAt: new Date() };
    if (metadata) {
      updates.context = metadata;
    }
    if (status === TASK_STATUSES.COMPLETED) {
      updates.completedAt = new Date();
    }
    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
    this.emitEvent(taskId, 'task_transitioned', { taskId, status, metadata });
    return this.getTask(taskId);
  }

  async cancelTask(taskId: number): Promise<void> {
    const controller = this.runningTasks.get(taskId);
    if (controller) {
      controller.abort();
    }
    await db.update(tasks).set({
      status: TASK_STATUSES.CANCELLED,
      completedAt: new Date(),
    }).where(eq(tasks.id, taskId));
    this.emitEvent(taskId, 'task_cancelled', { taskId });
  }
}

let taskRuntimeInstance: TaskRuntime | null = null;
export function getTaskRuntime(
  cytoplasm?: Cytoplasm,
  capabilityRegistry?: CapabilityRegistry,
  toolRuntime?: ToolRuntime,
  agentRuntime?: AgentRuntime,
): TaskRuntime {
  if (!taskRuntimeInstance) {
    taskRuntimeInstance = new TaskRuntime(
      cytoplasm!,
      capabilityRegistry!,
      toolRuntime!,
      agentRuntime!,
    );
  }
  return taskRuntimeInstance;
}
