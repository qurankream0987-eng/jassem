import { createHash, randomUUID } from "node:crypto";

/**
 * Trusted runtime capabilities.
 *
 * A generated plan may name a capability, but it never supplies executable code
 * or a connector request. Only handlers registered in this module can run.
 */

export type CapabilityRisk = "none" | "low" | "medium" | "high" | "critical";

export type CapabilityExecutionContext = {
  taskId: string;
  ownerId: string;
  planId: string;
  planVersion: number;
  stepId: string;
  idempotencyKey: string;
  runId?: string;
  nodeId?: string;
  proposalId?: string;
};

export type TrustedCapability = {
  id: string;
  version?: string;
  aliases: string[];
  risk: CapabilityRisk;
  sideEffects: "none";
  inputContract?: {
    requiredKeys?: string[];
  };
  execute: (
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ) => Promise<Record<string, unknown>>;
};

export type AssignedCapabilityBinding = {
  type: "capability-binding";
  id: string;
  taskId: string;
  planDigest: string;
  planVersion: number;
  stepId: string;
  capabilityId: string;
  assignedAt: string;
};

export type ExecutionPolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "approval_required" | "sensitive_operation" | "unassigned_capability";
      reason: string;
    };

const sensitiveCapabilityPattern =
  /\b(pay|payment|charge|purchase|refund|transfer|withdraw|delete|destroy|send|email|message|publish|deploy|write|update|create)\b/i;

function normalizeCapabilityName(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function collectValues(value: unknown, values: unknown[], depth = 0): void {
  if (values.length >= 100 || depth > 4) return;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    values.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectValues(item, values, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectValues(item, values, depth + 1),
    );
  }
}

function safeAnalysis(
  inputs: Record<string, unknown>,
  context: CapabilityExecutionContext,
): Record<string, unknown> {
  const values: unknown[] = [];
  collectValues(inputs, values);
  const strings = values.filter((value): value is string => typeof value === "string");
  const numbers = values.filter((value): value is number => typeof value === "number");

  return {
    kind: "local-analysis",
    taskId: context.taskId,
    stepId: context.stepId,
    inputKeys: Object.keys(inputs).sort(),
    metrics: {
      valuesProcessed: values.length,
      textItems: strings.length,
      textCharacters: strings.reduce((total, value) => total + value.length, 0),
      numericItems: numbers.length,
      numericTotal: numbers.reduce((total, value) => total + value, 0),
    },
    summary:
      values.length === 0
        ? "No structured values were supplied for analysis."
        : `Processed ${values.length} structured value${values.length === 1 ? "" : "s"} locally.`,
  };
}

function safeCalculation(
  inputs: Record<string, unknown>,
  context: CapabilityExecutionContext,
): Record<string, unknown> {
  const candidates = Array.isArray(inputs.values)
    ? inputs.values
    : Object.values(inputs);
  const values = candidates.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    kind: "local-calculation",
    taskId: context.taskId,
    stepId: context.stepId,
    count: values.length,
    sum: total,
    average: values.length === 0 ? null : total / values.length,
    minimum: values.length === 0 ? null : Math.min(...values),
    maximum: values.length === 0 ? null : Math.max(...values),
  };
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, TrustedCapability>();
  private readonly aliases = new Map<string, string>();

  register(capability: TrustedCapability): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability "${capability.id}" is already registered.`);
    }

    this.capabilities.set(capability.id, capability);
    for (const name of [capability.id, ...capability.aliases]) {
      const normalized = normalizeCapabilityName(name);
      if (this.aliases.has(normalized)) {
        throw new Error(`Capability alias "${name}" is already registered.`);
      }
      this.aliases.set(normalized, capability.id);
    }
  }

  resolveForAssignment(name: string): TrustedCapability | undefined {
    const id = this.aliases.get(normalizeCapabilityName(name));
    return id ? this.capabilities.get(id) : undefined;
  }

  async executeBinding(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<Record<string, unknown>> {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) {
      throw new Error(`Assigned capability "${capabilityId}" is no longer trusted.`);
    }
    const validation = validateTrustedCapabilityInputs(capabilityId, inputs);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
    const output = await capability.execute(inputs, context);
    const encoded = JSON.stringify(output);
    if (encoded.length > 64_000) {
      throw new Error(`Capability "${capability.id}" produced an oversized result.`);
    }
    return output;
  }

  async executeTrusted(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<Record<string, unknown>> {
    return this.executeBinding(capabilityId, inputs, context);
  }
}

const runtimeCapabilityRegistry = new CapabilityRegistry();

export function hasTrustedCapability(name: string): boolean {
  return Boolean(runtimeCapabilityRegistry.resolveForAssignment(name));
}

export function getTrustedCapability(name: string): Pick<
  TrustedCapability,
  "id" | "version" | "risk" | "sideEffects" | "inputContract"
> | undefined {
  const capability = runtimeCapabilityRegistry.resolveForAssignment(name);
  if (!capability) return undefined;
  return {
    id: capability.id,
    version: capability.version ?? "1",
    risk: capability.risk,
    sideEffects: capability.sideEffects,
    inputContract: capability.inputContract,
  };
}

export function validateTrustedCapabilityInputs(
  name: string,
  inputs: Record<string, unknown>,
):
  | { valid: true; normalizedInputs: Record<string, unknown> }
  | { valid: false; missingKeys: string[]; reason: string } {
  const capability = runtimeCapabilityRegistry.resolveForAssignment(name);
  if (!capability) {
    return { valid: false, missingKeys: [], reason: "Unknown capability." };
  }
  const encoded = canonicalJson(inputs);
  if (encoded.length > 64_000) {
    return { valid: false, missingKeys: [], reason: "Inputs exceed the trusted capability limit." };
  }
  const missingKeys = (capability.inputContract?.requiredKeys ?? []).filter(
    (key) => inputs[key] === undefined || inputs[key] === null || inputs[key] === "",
  );
  if (missingKeys.length > 0) {
    return { valid: false, missingKeys, reason: "Required capability inputs are missing." };
  }
  return { valid: true, normalizedInputs: JSON.parse(encoded) as Record<string, unknown> };
}

export function planDigest(plan: unknown): string {
  const executablePlan =
    plan && typeof plan === "object" && !Array.isArray(plan)
      ? Object.fromEntries(
          Object.entries(plan as Record<string, unknown>).filter(([key]) => key !== "status"),
        )
      : plan;
  return createHash("sha256").update(canonicalJson(executablePlan)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return "null";
}

export function assignPlanCapabilities(input: {
  taskId: string;
  planVersion: number;
  plan: { steps: Array<{ id: string; capability: string }> };
}): AssignedCapabilityBinding[] {
  const digest = planDigest(input.plan);
  const assignedAt = new Date().toISOString();
  return input.plan.steps.flatMap((step) => {
    const capability = runtimeCapabilityRegistry.resolveForAssignment(step.capability);
    if (!capability) return [];
    return [{
      type: "capability-binding" as const,
      id: randomUUID(),
      taskId: input.taskId,
      planDigest: digest,
      planVersion: input.planVersion,
      stepId: step.id,
      capabilityId: capability.id,
      assignedAt,
    }];
  });
}

export async function executeAssignedCapability(input: {
  binding: AssignedCapabilityBinding;
  plan: unknown;
  inputs: Record<string, unknown>;
  context: CapabilityExecutionContext;
}): Promise<Record<string, unknown>> {
  if (
    input.binding.taskId !== input.context.taskId ||
    input.binding.stepId !== input.context.stepId ||
    input.binding.planVersion !== input.context.planVersion ||
    input.binding.planDigest !== planDigest(input.plan)
  ) {
    throw new Error("Capability binding does not match this plan execution.");
  }
  return runtimeCapabilityRegistry.executeBinding(
    input.binding.capabilityId,
    input.inputs,
    input.context,
  );
}

export async function executeTrustedCapability(input: {
  capabilityId: string;
  inputs: Record<string, unknown>;
  context: CapabilityExecutionContext;
}): Promise<Record<string, unknown>> {
  return runtimeCapabilityRegistry.executeTrusted(
    input.capabilityId,
    input.inputs,
    input.context,
  );
}

export function evaluateExecutionPolicy(input: {
  requestedCapability: string;
  binding?: AssignedCapabilityBinding;
  planApproved: boolean;
}): ExecutionPolicyDecision {
  if (sensitiveCapabilityPattern.test(input.requestedCapability)) {
    return {
      allowed: false,
      code: "sensitive_operation",
      reason:
        "Payment, destructive, messaging, publishing, deployment, and data-changing operations are not executable by generated plans.",
    };
  }
  if (!input.binding) {
    return {
      allowed: false,
      code: "unassigned_capability",
      reason: "No trusted capability is assigned to this plan step.",
    };
  }
  if (!input.planApproved) {
    return {
      allowed: false,
      code: "approval_required",
      reason: "A recorded plan approval is required before a capability can run.",
    };
  }
  return { allowed: true };
}

runtimeCapabilityRegistry.register({
  id: "local-analysis",
  aliases: ["analyze", "analysis", "summarize", "summary", "assess", "classify", "validate", "review"],
  risk: "low",
  sideEffects: "none",
  execute: async (inputs, context) => safeAnalysis(inputs, context),
});

runtimeCapabilityRegistry.register({
  id: "local-calculation",
  aliases: ["calculate", "calculation", "estimate", "math"],
  risk: "low",
  sideEffects: "none",
  execute: async (inputs, context) => safeCalculation(inputs, context),
});