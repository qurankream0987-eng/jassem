import { createHash, randomUUID } from "node:crypto";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import type { ExecutionPlan, PlanStep } from "@contracts/dna";
import {
  GeneratedExecutionCheckpointSchema,
  type GeneratedPlanExecutionResult,
  type GeneratedExecutionCheckpoint,
  type GeneratedInputRequest,
} from "@contracts/generated-execution";
import type { RuntimeInputRequirement } from "@contracts/runtime-connector";
import type {
  ApprovalDecisionInput,
  GeneratedExecutionStore,
} from "./generated-execution-store";
import {
  MemoryGeneratedInputSecretVault,
  type GeneratedInputSecretVault,
} from "./generated-input-secret-vault";

export interface ExecutableCapabilityDescriptor {
  registryId?: string;
  capabilityId: string;
  risk: "none" | "low" | "medium" | "high" | "critical";
  sideEffects: Array<{ type: string; reversible: boolean }>;
}

export interface CapabilityExecutionContext {
  taskId: number;
  userId: number;
  planId: string;
  worldId?: string;
  stepId: string;
  idempotencyKey: string;
  approvalId?: string;
}

export interface GeneratedCapabilityExecutionPort {
  describe(capabilityId: string): Promise<ExecutableCapabilityDescriptor>;
  inputRequirements?(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<RuntimeInputRequirement | undefined>;
  invoke(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<unknown>;
}

export interface ExecuteGeneratedPlanInput {
  taskId: number;
  userId: number;
  plan: ExecutionPlan;
  worldId?: string;
}

export interface DecideGeneratedApprovalInput extends ApprovalDecisionInput {
  plan: ExecutionPlan;
  worldId?: string;
}

export interface ProvideGeneratedInputInput extends ExecuteGeneratedPlanInput {
  requestId: string;
  values: Record<string, unknown>;
}

const APPROVAL_TTL_MS = 30 * 60 * 1000;
const INPUT_TTL_MS = 30 * 60 * 1000;

export class GeneratedPlanExecutor {
  private readonly locks = new Map<string, Promise<GeneratedPlanExecutionResult>>();

  constructor(
    private readonly capabilities: GeneratedCapabilityExecutionPort,
    private readonly store: GeneratedExecutionStore,
    private readonly secrets: GeneratedInputSecretVault = new MemoryGeneratedInputSecretVault(),
  ) {}

  execute(input: ExecuteGeneratedPlanInput): Promise<GeneratedPlanExecutionResult> {
    const lockKey = `${input.taskId}:${input.plan.id}`;
    const previous = this.locks.get(lockKey) ?? Promise.resolve(undefined);
    const current = previous.catch(() => undefined).then(() => this.run(input));
    this.locks.set(lockKey, current);
    return current.finally(() => {
      if (this.locks.get(lockKey) === current) this.locks.delete(lockKey);
    });
  }

  async decideApproval(input: DecideGeneratedApprovalInput): Promise<GeneratedPlanExecutionResult> {
    await this.store.decideApproval(input);
    return this.execute(input);
  }

  async provideInput(input: ProvideGeneratedInputInput): Promise<GeneratedPlanExecutionResult> {
    const checkpoint = await this.store.load(input.taskId, input.plan.id);
    if (!checkpoint || checkpoint.userId !== input.userId) throw new Error("Execution does not belong to this user");
    const request = checkpoint.pendingInput;
    if (!request || request.id !== input.requestId || checkpoint.status !== "waiting_input") {
      throw new Error("Generated input request is no longer pending");
    }
    if (Date.parse(request.expiresAt) <= Date.now()) throw new Error("Generated input request has expired");

    const accepted = this.validateAndSelectInput(request, input.values);
    const publicValues: Record<string, unknown> = {};
    const secretValues: Record<string, unknown> = {};
    for (const field of request.fields) {
      const value = this.readPath(accepted, field.path);
      if (value === undefined) continue;
      this.writePath(field.sensitive ? secretValues : publicValues, field.path, value);
    }
    const secretRef = Object.keys(secretValues).length > 0
      ? await this.secrets.put({
          taskId: checkpoint.taskId,
          userId: checkpoint.userId,
          requestId: request.id,
          expiresAt: request.expiresAt,
        }, secretValues)
      : undefined;
    checkpoint.collectedInputs[request.stepId] = { values: publicValues, secretRef, requestId: request.id };
    checkpoint.pendingInput = undefined;
    checkpoint.pendingStepId = undefined;
    checkpoint.status = "running";
    await this.bumpAndSave(checkpoint);
    return this.execute(input);
  }

  private async run(input: ExecuteGeneratedPlanInput): Promise<GeneratedPlanExecutionResult> {
    let checkpoint = await this.store.load(input.taskId, input.plan.id)
      ?? this.createCheckpoint(input);

    if (checkpoint.userId !== input.userId) throw new Error("Execution does not belong to this user");
    if (checkpoint.status === "completed" || checkpoint.status === "rejected") {
      return this.toResult(checkpoint, input.plan);
    }

    if (checkpoint.status === "waiting_input" && checkpoint.pendingInput) {
      return this.toResult(checkpoint, input.plan);
    }

    checkpoint = await this.consumeApproval(checkpoint);
    if (checkpoint.status === "waiting_approval" || checkpoint.status === "rejected") {
      await this.store.save(checkpoint);
      return this.toResult(checkpoint, input.plan);
    }

    checkpoint.status = "running";
    checkpoint.error = undefined;
    await this.bumpAndSave(checkpoint);

    while (checkpoint.completedSteps.length < input.plan.steps.length) {
      const completed = new Set(checkpoint.completedSteps);
      const executable = input.plan.steps.filter((step) =>
        !completed.has(step.id) && step.dependencies.every((dependency) => completed.has(dependency)),
      );
      if (executable.length === 0) {
        checkpoint.status = "failed";
        checkpoint.error = "Cycle detected or dependencies cannot be resolved";
        await this.bumpAndSave(checkpoint);
        return this.toResult(checkpoint, input.plan);
      }

      for (const step of executable) {
        if (step.requiresApproval && !checkpoint.authorizedSteps[step.id]) {
          checkpoint = await this.pauseForApproval(checkpoint, input.plan, step);
          await this.bumpAndSave(checkpoint);
          return this.toResult(checkpoint, input.plan);
        }

        const outcome = await this.executeStep(checkpoint, step);
        checkpoint = outcome.checkpoint;
        if (outcome.inputRequirement) {
          checkpoint = this.pauseForInput(checkpoint, step, outcome.inputRequirement);
          await this.bumpAndSave(checkpoint);
          return this.toResult(checkpoint, input.plan);
        }
        if (!outcome.success && !step.optional) {
          checkpoint.status = "failed";
          checkpoint.error = outcome.error ?? `Step ${step.id} failed`;
          await this.bumpAndSave(checkpoint);
          return this.toResult(checkpoint, input.plan);
        }

        if (!checkpoint.completedSteps.includes(step.id)) checkpoint.completedSteps.push(step.id);
        if (!outcome.success) checkpoint.results[step.id] = { skipped: true, error: outcome.error };
        await this.bumpAndSave(checkpoint);
      }
    }

    checkpoint.status = "completed";
    checkpoint.pendingApprovalId = undefined;
    checkpoint.pendingStepId = undefined;
    await this.bumpAndSave(checkpoint);
    await this.removeSecrets(checkpoint);
    return this.toResult(checkpoint, input.plan);
  }

  private createCheckpoint(input: ExecuteGeneratedPlanInput): GeneratedExecutionCheckpoint {
    const now = new Date().toISOString();
    return GeneratedExecutionCheckpointSchema.parse({
      executionKey: this.digest(`${input.taskId}:${input.plan.id}:${input.worldId ?? "world"}`),
      taskId: input.taskId,
      userId: input.userId,
      planId: input.plan.id,
      worldId: input.worldId,
      status: "running",
      completedSteps: [],
      results: {},
      invocations: {},
      authorizedSteps: {},
      collectedInputs: {},
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async consumeApproval(checkpoint: GeneratedExecutionCheckpoint): Promise<GeneratedExecutionCheckpoint> {
    if (!checkpoint.pendingApprovalId || !checkpoint.pendingStepId) return checkpoint;
    const ticket = await this.store.getApproval(checkpoint.pendingApprovalId);
    if (!ticket || ticket.status === "pending") {
      checkpoint.status = "waiting_approval";
      return checkpoint;
    }
    if (ticket.status === "rejected" || ticket.status === "expired") {
      checkpoint.status = "rejected";
      checkpoint.error = ticket.status === "expired" ? "Approval expired" : ticket.reason ?? "Action rejected by user";
      return checkpoint;
    }

    for (const stepId of ticket.authorizedStepIds) checkpoint.authorizedSteps[stepId] = ticket.id;
    const pendingStep = checkpoint.pendingStepId;
    const approvalCompletesStep = checkpoint.results[pendingStep] &&
      (checkpoint.results[pendingStep] as Record<string, unknown>).awaitingDecision === true;
    if (approvalCompletesStep) {
      checkpoint.results[pendingStep] = {
        approved: true,
        approvalId: ticket.id,
        approvedBy: ticket.decidedBy,
        approvedAt: ticket.decidedAt,
      };
      if (!checkpoint.completedSteps.includes(pendingStep)) checkpoint.completedSteps.push(pendingStep);
    }
    checkpoint.pendingApprovalId = undefined;
    checkpoint.pendingStepId = undefined;
    checkpoint.status = "running";
    return checkpoint;
  }

  private async pauseForApproval(
    checkpoint: GeneratedExecutionCheckpoint,
    plan: ExecutionPlan,
    step: PlanStep,
  ): Promise<GeneratedExecutionCheckpoint> {
    const authorizedStepIds = this.approvalScope(plan, step);
    const descriptors = await Promise.all(authorizedStepIds.map((stepId) => {
      const scopedStep = plan.steps.find((candidate) => candidate.id === stepId)!;
      return this.capabilities.describe(scopedStep.capabilityId);
    }));
    const currentDescriptor = descriptors[authorizedStepIds.indexOf(step.id)];
    const ticket = await this.store.requestApproval({
      taskId: checkpoint.taskId,
      userId: checkpoint.userId,
      planId: checkpoint.planId,
      worldId: checkpoint.worldId,
      stepId: step.id,
      capabilityId: step.capabilityId,
      capabilityRegistryId: currentDescriptor?.registryId,
      title: step.name,
      risk: step.risk,
      authorizedStepIds,
      authorizedCapabilityIds: descriptors.flatMap((descriptor) => descriptor.registryId ? [descriptor.registryId] : []),
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
    });
    checkpoint.pendingApprovalId = ticket.id;
    checkpoint.pendingStepId = step.id;
    checkpoint.status = "waiting_approval";
    checkpoint.results[step.id] = {
      awaitingDecision: this.isManualApprovalStep(step),
      approvalId: ticket.id,
      authorizedStepIds,
    };
    return checkpoint;
  }

  private approvalScope(plan: ExecutionPlan, boundary: PlanStep): string[] {
    const scope = new Set<string>([boundary.id]);
    if (!this.isManualApprovalStep(boundary)) return [...scope];

    const queue = [boundary.id];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of plan.steps.filter((step) => step.dependencies.includes(parentId))) {
        if (this.isManualApprovalStep(child)) continue;
        if (child.requiresApproval) scope.add(child.id);
        queue.push(child.id);
      }
    }
    return [...scope];
  }

  private isManualApprovalStep(step: PlanStep): boolean {
    return step.capabilityId === DNA_PRIMITIVES.CONFIRM || step.verification.type === "manual";
  }

  private async executeStep(
    checkpoint: GeneratedExecutionCheckpoint,
    step: PlanStep,
  ): Promise<{ success: boolean; checkpoint: GeneratedExecutionCheckpoint; error?: string; inputRequirement?: RuntimeInputRequirement }> {
    const inputs = await this.resolveStepInputs(checkpoint, step);
    const context: CapabilityExecutionContext = {
      taskId: checkpoint.taskId,
      userId: checkpoint.userId,
      planId: checkpoint.planId,
      worldId: checkpoint.worldId,
      stepId: step.id,
      idempotencyKey: this.digest(`${checkpoint.executionKey}:${step.id}:${step.capabilityId}:requirements`),
      approvalId: checkpoint.authorizedSteps[step.id],
    };
    const inputRequirement = await this.capabilities.inputRequirements?.(step.capabilityId, inputs, context);
    if (inputRequirement) return { success: false, checkpoint, inputRequirement };
    const inputDigest = this.digest(this.canonicalize(inputs));
    const idempotencyKey = this.digest(`${checkpoint.executionKey}:${step.id}:${step.capabilityId}:${inputDigest}`);
    const existing = checkpoint.invocations[idempotencyKey];
    if (existing?.status === "succeeded") {
      checkpoint.results[step.id] = existing.result;
      return { success: true, checkpoint };
    }

    const descriptor = await this.capabilities.describe(step.capabilityId);
    if (["executing", "uncertain"].includes(existing?.status ?? "") && descriptor.sideEffects.length > 0) {
      return {
        success: false,
        checkpoint,
        error: `Execution outcome for side-effecting step ${step.id} is uncertain; manual reconciliation is required`,
      };
    }

    checkpoint.invocations[idempotencyKey] = {
      idempotencyKey,
      stepId: step.id,
      capabilityId: step.capabilityId,
      inputDigest,
      status: "executing",
      startedAt: new Date().toISOString(),
    };
    await this.bumpAndSave(checkpoint);

    try {
      const result = await this.capabilities.invoke(step.capabilityId, inputs, {
        taskId: checkpoint.taskId,
        userId: checkpoint.userId,
        planId: checkpoint.planId,
        worldId: checkpoint.worldId,
        stepId: step.id,
        idempotencyKey,
        approvalId: checkpoint.authorizedSteps[step.id],
      });
      const safeResult = await this.redactCollectedSecrets(checkpoint, step.id, result);
      checkpoint.invocations[idempotencyKey] = {
        ...checkpoint.invocations[idempotencyKey],
        status: "succeeded",
        result: safeResult,
        completedAt: new Date().toISOString(),
      };
      checkpoint.results[step.id] = safeResult;
      return { success: true, checkpoint };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const uncertain = descriptor.sideEffects.length > 0 && Boolean(error && typeof error === "object" &&
        "outcomeUncertain" in error && (error as { outcomeUncertain?: unknown }).outcomeUncertain === true);
      checkpoint.invocations[idempotencyKey] = {
        ...checkpoint.invocations[idempotencyKey],
        status: uncertain ? "uncertain" : "failed",
        error: message,
        completedAt: new Date().toISOString(),
      };
      return { success: false, checkpoint, error: message };
    }
  }

  private pauseForInput(
    checkpoint: GeneratedExecutionCheckpoint,
    step: PlanStep,
    requirement: RuntimeInputRequirement,
  ): GeneratedExecutionCheckpoint {
    const now = Date.now();
    checkpoint.pendingInput = {
      id: randomUUID(),
      taskId: checkpoint.taskId,
      planId: checkpoint.planId,
      stepId: step.id,
      capabilityId: step.capabilityId,
      connectorId: requirement.connectorId,
      title: requirement.title,
      description: requirement.description,
      submitLabel: requirement.submitLabel,
      fields: requirement.fields,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INPUT_TTL_MS).toISOString(),
    };
    checkpoint.pendingStepId = step.id;
    checkpoint.status = "waiting_input";
    return checkpoint;
  }

  private async resolveStepInputs(checkpoint: GeneratedExecutionCheckpoint, step: PlanStep): Promise<Record<string, unknown>> {
    const base = this.resolveValue(step.inputs, checkpoint.results) as Record<string, unknown>;
    const collected = checkpoint.collectedInputs[step.id];
    if (!collected) return base;
    let sensitive: Record<string, unknown> = {};
    if (collected.secretRef) {
      sensitive = await this.secrets.get(collected.secretRef, {
        taskId: checkpoint.taskId,
        userId: checkpoint.userId,
        requestId: collected.requestId,
      });
    }
    return this.deepMerge(this.deepMerge(base, collected.values), sensitive);
  }

  private validateAndSelectInput(request: GeneratedInputRequest, values: Record<string, unknown>): Record<string, unknown> {
    const accepted: Record<string, unknown> = {};
    for (const field of request.fields) {
      const value = this.readPath(values, field.path);
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new Error(`Missing required value: ${field.label}`);
      }
      if (value === undefined) continue;
      if (["number", "currency"].includes(field.type) && typeof value !== "number") throw new Error(`${field.label} must be a number`);
      if (field.type === "boolean" && typeof value !== "boolean") throw new Error(`${field.label} must be true or false`);
      if (["text", "textarea", "phone", "url", "token", "select", "datetime"].includes(field.type) && typeof value !== "string") {
        throw new Error(`${field.label} must be text`);
      }
      if (field.type === "select" && field.options && !field.options.some((option) => option.value === value)) {
        throw new Error(`${field.label} has an invalid option`);
      }
      this.writePath(accepted, field.path, value);
    }
    return accepted;
  }

  private readPath(value: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, part) =>
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)[part]
        : undefined, value);
  }

  private writePath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let current = target;
    for (const part of parts.slice(0, -1)) {
      const next = current[part];
      current = next && typeof next === "object" && !Array.isArray(next)
        ? next as Record<string, unknown>
        : (current[part] = {}) as Record<string, unknown>;
    }
    current[parts.at(-1)!] = value;
  }

  private deepMerge(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
    const merged = { ...left };
    for (const [key, value] of Object.entries(right)) {
      merged[key] = value && typeof value === "object" && !Array.isArray(value) &&
        merged[key] && typeof merged[key] === "object" && !Array.isArray(merged[key])
        ? this.deepMerge(merged[key] as Record<string, unknown>, value as Record<string, unknown>)
        : value;
    }
    return merged;
  }

  private async removeSecrets(checkpoint: GeneratedExecutionCheckpoint): Promise<void> {
    await Promise.all(Object.values(checkpoint.collectedInputs).flatMap((collected) => collected.secretRef
      ? [this.secrets.remove(collected.secretRef, { taskId: checkpoint.taskId, userId: checkpoint.userId })]
      : []));
  }

  private async redactCollectedSecrets(
    checkpoint: GeneratedExecutionCheckpoint,
    stepId: string,
    result: unknown,
  ): Promise<unknown> {
    const collected = checkpoint.collectedInputs[stepId];
    if (!collected?.secretRef) return result;
    const secrets = await this.secrets.get(collected.secretRef, {
      taskId: checkpoint.taskId,
      userId: checkpoint.userId,
      requestId: collected.requestId,
    });
    const values = new Set(this.leafValues(secrets).map((value) => this.canonicalize(value)));
    const visit = (value: unknown): unknown => {
      if (values.has(this.canonicalize(value))) return "[REDACTED]";
      if (Array.isArray(value)) return value.map(visit);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
      }
      return value;
    };
    return visit(result);
  }

  private leafValues(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap((item) => this.leafValues(item));
    if (value && typeof value === "object") return Object.values(value).flatMap((item) => this.leafValues(item));
    return [value];
  }

  private resolveValue(value: unknown, results: Record<string, unknown>): unknown {
    if (typeof value === "string") {
      const match = value.match(/^\$\{([^}]+)\}$/);
      return match ? results[match[1]] : value;
    }
    if (Array.isArray(value)) return value.map((item) => this.resolveValue(item, results));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolveValue(item, results)]));
    }
    return value;
  }

  private async bumpAndSave(checkpoint: GeneratedExecutionCheckpoint): Promise<void> {
    checkpoint.revision += 1;
    checkpoint.updatedAt = new Date().toISOString();
    await this.store.save(checkpoint);
  }

  private toResult(checkpoint: GeneratedExecutionCheckpoint, plan: ExecutionPlan): GeneratedPlanExecutionResult {
    const pending = checkpoint.pendingApprovalId && checkpoint.pendingStepId
      ? {
          approvalId: checkpoint.pendingApprovalId,
          stepId: checkpoint.pendingStepId,
          title: plan.steps.find((step) => step.id === checkpoint.pendingStepId)?.name ?? checkpoint.pendingStepId,
          risk: plan.steps.find((step) => step.id === checkpoint.pendingStepId)?.risk ?? "medium",
          authorizedStepIds: this.readAuthorizedStepIds(checkpoint, checkpoint.pendingStepId),
        }
      : undefined;
    const pendingInput = checkpoint.pendingInput
      ? {
          ...checkpoint.pendingInput,
          bubble: {
            id: `input_${checkpoint.pendingInput.id}`,
            type: "form" as const,
            title: checkpoint.pendingInput.title,
            subtitle: checkpoint.pendingInput.description,
            layout: { width: "full" as const, rtl: true },
            data: {
              requestId: checkpoint.pendingInput.id,
              taskId: checkpoint.taskId,
              planId: checkpoint.planId,
              stepId: checkpoint.pendingInput.stepId,
              fields: checkpoint.pendingInput.fields,
              expiresAt: checkpoint.pendingInput.expiresAt,
            },
            actions: [{
              id: "submit_generated_input",
              label: checkpoint.pendingInput.submitLabel,
              type: "submit",
              payload: { requestId: checkpoint.pendingInput.id },
            }],
            trust: { level: "system" as const, verified: true as const, badges: ["generated", "input-scoped", "encrypted"] },
            version: "1.0.0",
            metadata: { generated: true, purpose: "runtime_input", connectorId: checkpoint.pendingInput.connectorId },
          },
        }
      : undefined;
    return {
      status: checkpoint.status,
      executionKey: checkpoint.executionKey,
      results: checkpoint.results,
      completedSteps: [...checkpoint.completedSteps],
      pendingAction: pending,
      pendingInput,
      blockedSteps: pending || pendingInput
        ? plan.steps.filter((step) => !checkpoint.completedSteps.includes(step.id) && step.id !== (pending?.stepId ?? pendingInput?.stepId)).map((step) => step.id)
        : undefined,
      error: checkpoint.error,
    };
  }

  private readAuthorizedStepIds(checkpoint: GeneratedExecutionCheckpoint, stepId: string): string[] {
    const value = checkpoint.results[stepId];
    if (!value || typeof value !== "object") return [stepId];
    const ids = (value as Record<string, unknown>).authorizedStepIds;
    return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === "string") : [stepId];
  }

  private canonicalize(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalize(item)).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalize(item)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
