import { createHash, randomUUID } from "node:crypto";
import {
  executeImageGenerationProvider,
  executeWebResearchProvider,
} from "./phase11-providers";
import { composeResearchGenerationContext } from "./research-composition";
import {
  CapabilityProviderRegistry,
  registerNativeProvider,
} from "./capability-provider";
import { ModelGatewayUnavailableError, modelGateway } from "./model-gateway";
import { db } from "../queries/connection";
import {
  createNotificationIntent,
  deliverNotificationIntent,
  resolveNotificationEffect,
} from "./block2/notifications";
import { getBlock2Worker } from "./block2/worker";
import {
  effectKindFromSideEffects,
  type EffectClaimSource,
  type EffectKind,
  type EffectResolver,
} from "./completion-policy";
import {
  resolveCompensationPolicy,
  type CompensationPolicy,
} from "./compensation-policy";

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
  attemptId?: string;
};

export type CapabilityEffectClass =
  | "pure"
  | "internal_stateful"
  | "external_effectful"
  | "human_authority";

export type TypedFieldSpec = {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  unit?: string;
  required?: boolean;
  semantic?: string;
};

export type TrustedCapability = {
  id: string;
  version?: string;
  aliases: string[];
  risk: CapabilityRisk;
  sideEffects: "none" | "local_test" | "external";
  testOnly?: boolean;
  inputContract?: {
    requiredKeys?: string[];
  };
  /**
   * Block 1 semantic contract metadata (optional, additive). Allows the
   * universal composer to match CapabilityRequirements to trusted
   * capabilities without relying on exact names.
   */
  semanticPurposes?: string[];
  effectClass?: CapabilityEffectClass;
  inputSpec?: TypedFieldSpec[];
  outputSpec?: TypedFieldSpec[];
  providerRequirements?: string[];
  resourceRequirements?: string[];
  authorityClass?: "human" | "owner" | "regulatory";
  /**
   * What CLASS of real-world effect this capability has. Omitting it is safe
   * but never permissive: `effectKindFromSideEffects` resolves an undeclared
   * `sideEffects: "external"` capability to REMOTE_MUTATION, the strictest kind.
   */
  effectKind?: EffectKind;
  /**
   * How much this capability's own `effect.state` declaration is worth.
   *
   * Fixed HERE, at registration, in trusted code — never read from the
   * capability's output. A provider that could name its own claim source could
   * certify itself, which would make the completion policy decorative.
   */
  effectEvidenceSource?: EffectClaimSource;
  /**
   * Trusted server code that READS THE EFFECT BACK from whatever authority owns
   * it, after the capability has run.
   *
   * This is the only way VERIFIED becomes reachable for an effectful
   * capability, and the reason the completion layer is a verifier rather than a
   * blanket refusal. A resolver is code, registered by a human, so unlike a
   * provider payload it is trusted to state its own claim source honestly.
   *
   * It must fail closed: a resolver that cannot reach its authority returns an
   * UNCERTAIN assertion, never an optimistic one.
   */
  resolveEffect?: EffectResolver;
  /**
   * How a verified effect of this capability can be recovered when the larger
   * goal later fails. Omitting it on an effectful capability resolves to
   * IRREVERSIBLE — a truthful "a person must look at this" rather than a
   * silent skip.
   */
  compensation?: CompensationPolicy;
  execute: (
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ) => Promise<Record<string, unknown>>;
};

export type CanonicalCapabilityResult = {
  result: Record<string, unknown>;
  metadata: {
    capabilityId: string;
    kind?: string;
  };
};

function normalizeCapabilityResult(
  capabilityId: string,
  output: Record<string, unknown>,
): CanonicalCapabilityResult {
  const result = JSON.parse(canonicalJson(output)) as Record<string, unknown>;
  return {
    result,
    metadata: {
      capabilityId,
      ...(typeof result.kind === "string" ? { kind: result.kind } : {}),
    },
  };
}

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
  /**
   * Block 1.1: each registry instance owns its provider registry, so
   * test-only or foreign registries can never leak providers into the
   * runtime trust domain.
   */
  private readonly providerRegistry = new CapabilityProviderRegistry();
  private readonly options: {
    allowTestOnly?: boolean;
    allowedTestCapabilityIds?: ReadonlySet<string>;
  };

  constructor(options: {
    allowTestOnly?: boolean;
    allowedTestCapabilityIds?: ReadonlySet<string>;
  } = {}) {
    this.options = options;
  }

  /** Providers bound to this registry's own capabilities. */
  providers(): CapabilityProviderRegistry {
    return this.providerRegistry;
  }

  register(capability: TrustedCapability): void {
    if (capability.testOnly || capability.sideEffects === "local_test") {
      if (
        !this.options.allowTestOnly ||
        !capability.testOnly ||
        capability.sideEffects !== "local_test" ||
        (this.options.allowedTestCapabilityIds &&
          !this.options.allowedTestCapabilityIds.has(capability.id))
      ) {
        throw new Error(`Capability "${capability.id}" is not allowed in this registry.`);
      }
    }
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
    // Block 1.1: every trusted handler automatically becomes a NATIVE provider
    // bound to the same execute() implementation, scoped to THIS registry
    // instance (zero behavior change, no cross-instance pollution).
    registerNativeProvider(this.providerRegistry, capability);
  }

  resolveForAssignment(name: string): TrustedCapability | undefined {
    const id = this.aliases.get(normalizeCapabilityName(name));
    return id ? this.capabilities.get(id) : undefined;
  }

  /** Block 1: enumerate trusted descriptors for semantic matching (read-only). */
  list(): TrustedCapability[] {
    return [...this.capabilities.values()];
  }

  /**
   * Block 1.1: cheap summary view for discovery surfaces. Full contracts are
   * loaded only for viable finalists via list()/getTrustedCapability.
   */
  listSummaries(): Array<{
    id: string;
    aliases: string[];
    semanticPurposes: string[];
    effectClass?: string;
    risk: CapabilityRisk;
  }> {
    return this.list().map((c) => ({
      id: c.id,
      aliases: c.aliases,
      semanticPurposes: c.semanticPurposes ?? [],
      effectClass: c.effectClass,
      risk: c.risk,
    }));
  }

  getTrustedCapability(name: string): Pick<
    TrustedCapability,
    "id" | "version" | "risk" | "sideEffects" | "inputContract" | "testOnly"
    | "effectKind" | "effectEvidenceSource"
  > | undefined {
    const capability = this.resolveForAssignment(name);
    if (!capability) return undefined;
    return {
      id: capability.id,
      version: capability.version ?? "1",
      risk: capability.risk,
      sideEffects: capability.sideEffects,
      inputContract: capability.inputContract,
      ...(capability.testOnly ? { testOnly: true } : {}),
      // Resolved rather than passed through, so a caller reads the kind that
      // will actually be enforced instead of an absent field it might read
      // as "no effect".
      effectKind: effectKindFromSideEffects(capability.sideEffects, capability.effectKind),
      ...(capability.effectEvidenceSource
        ? { effectEvidenceSource: capability.effectEvidenceSource }
        : {}),
    };
  }

  /**
   * The effect contract for a capability the runtime is about to verify.
   *
   * An UNKNOWN capability id resolves to REMOTE_MUTATION with no evidence
   * source. That is the fail-closed choice: the runtime cannot verify the
   * effect of something it cannot identify, so it must not claim to.
   */
  effectContract(name: string): {
    effectKind: EffectKind;
    effectEvidenceSource?: EffectClaimSource;
    resolveEffect?: EffectResolver;
    compensation: CompensationPolicy;
  } {
    const capability = this.resolveForAssignment(name);
    if (!capability) {
      // An unidentified capability fails closed on both axes: its effect is
      // assumed remote, and its recovery is assumed impossible.
      return {
        effectKind: "REMOTE_MUTATION",
        compensation: resolveCompensationPolicy("REMOTE_MUTATION"),
      };
    }
    const effectKind = effectKindFromSideEffects(capability.sideEffects, capability.effectKind);
    return {
      effectKind,
      ...(capability.effectEvidenceSource
        ? { effectEvidenceSource: capability.effectEvidenceSource }
        : {}),
      ...(capability.resolveEffect ? { resolveEffect: capability.resolveEffect } : {}),
      compensation: resolveCompensationPolicy(effectKind, capability.compensation),
    };
  }

  validateInputs(
    name: string,
    inputs: Record<string, unknown>,
  ):
    | { valid: true; normalizedInputs: Record<string, unknown> }
    | { valid: false; missingKeys: string[]; reason: string } {
    const capability = this.resolveForAssignment(name);
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

  assignPlanCapabilities(input: {
    taskId: string;
    planVersion: number;
    plan: { steps: Array<{ id: string; capability: string }> };
  }): AssignedCapabilityBinding[] {
    const digest = planDigest(input.plan);
    const assignedAt = new Date().toISOString();
    return input.plan.steps.flatMap((step) => {
      const capability = this.resolveForAssignment(step.capability);
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

  async executeBinding(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<Record<string, unknown>> {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) {
      throw new Error(`Assigned capability "${capabilityId}" is no longer trusted.`);
    }
    const validation = this.validateInputs(capabilityId, inputs);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
    const output = normalizeCapabilityResult(
      capability.id,
      await capability.execute(inputs, context),
    );
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

/** The trusted production registry (read-only accessor for composition). */
export function getRuntimeCapabilityRegistry(): CapabilityRegistry {
  return runtimeCapabilityRegistry;
}

/** The runtime registry's instance-scoped provider registry. */
export function getRuntimeProviderRegistry(): CapabilityProviderRegistry {
  return runtimeCapabilityRegistry.providers();
}

export function hasTrustedCapability(name: string): boolean {
  return Boolean(runtimeCapabilityRegistry.resolveForAssignment(name));
}

export function getTrustedCapability(name: string): Pick<
  TrustedCapability,
  "id" | "version" | "risk" | "sideEffects" | "inputContract" | "testOnly"
  | "effectKind" | "effectEvidenceSource"
> | undefined {
  return runtimeCapabilityRegistry.getTrustedCapability(name);
}

export function capabilityEffectContract(
  name: string,
): {
  effectKind: EffectKind;
  effectEvidenceSource?: EffectClaimSource;
  resolveEffect?: EffectResolver;
  compensation: CompensationPolicy;
} {
  return runtimeCapabilityRegistry.effectContract(name);
}

export function validateTrustedCapabilityInputs(
  name: string,
  inputs: Record<string, unknown>,
):
  | { valid: true; normalizedInputs: Record<string, unknown> }
  | { valid: false; missingKeys: string[]; reason: string } {
  return runtimeCapabilityRegistry.validateInputs(name, inputs);
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
  return runtimeCapabilityRegistry.assignPlanCapabilities(input);
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

const notifyCapability: TrustedCapability = {
  id: "notify",
  version: "1",
  aliases: ["notification", "remind", "notify-user"],
  risk: "medium",
  sideEffects: "external",
  // Something leaves the system towards a person. Dispatching is not
  // delivering, and before the completion policy existed this capability
  // reached VERIFIED while its own state said BLOCKED_BY_PROVIDER.
  effectKind: "MESSAGE_DISPATCH",
  // The capability's returned `state` is a snapshot taken before any
  // redelivery ran, so it is worth no more than the executor's word.
  effectEvidenceSource: "EXECUTOR_RETURN",
  /**
   * COMPENSATION != INVERSE OPERATION, and this is the clearest case of it.
   *
   * You cannot unsend a message by changing a row. What recovery means here is
   * a SECOND message telling the recipient to disregard the first — a new
   * effect with its own delivery truth, which is why the compensating
   * capability is `notify` itself rather than some `notify-undo`.
   *
   * PARTIALLY_COMPENSATABLE, not COMPENSATABLE: the correction offsets the
   * instruction, and the recipient still read the original. Claiming full
   * recovery would be the small lie this whole module exists to prevent.
   */
  compensation: {
    reversibility: "PARTIALLY_COMPENSATABLE",
    compensationCapabilityId: "notify",
    residualNote:
      "The original message was already delivered; a correction cannot unsee it.",
    deriveInputs: (context) => {
      const recipientId = context.sourceInputs.recipientId;
      if (typeof recipientId !== "string" || !recipientId) return undefined;
      const title = typeof context.sourceInputs.title === "string" ? context.sourceInputs.title : "";
      return {
        recipientId,
        purpose: "correction",
        title: "تصحيح",
        body: `تم التراجع عن الطلب السابق${title ? `: ${title}` : ""}. يرجى تجاهل الرسالة السابقة.`,
        // A correction is at least as urgent as the thing it corrects.
        urgency: "high",
      };
    },
  },
  // The verdict comes from here: a fresh read of the durable notification
  // ledger, owner-scoped, after the fact.
  resolveEffect: async (context) => {
    const intentId = context.result?.intentId;
    if (typeof intentId !== "string" || !intentId) return undefined;
    return resolveNotificationEffect(db, { ownerId: context.ownerId, intentId });
  },
  inputContract: {
    requiredKeys: ["recipientId", "purpose", "title", "body"],
  },
  execute: async (inputs, context) => {
    if (
      !context.runId ||
      !context.nodeId ||
      !context.attemptId ||
      context.attemptId.startsWith("job:")
    ) {
      throw new Error("notify requires canonical run, node, and execution-attempt lineage.");
    }
    const recipientId = String(inputs.recipientId ?? "").trim();
    const purpose = String(inputs.purpose ?? "").trim();
    const title = String(inputs.title ?? "").trim();
    const body = String(inputs.body ?? "").trim();
    const urgency = inputs.urgency;
    const privacyClass = inputs.privacyClass;
    const channels = inputs.channels;

    if (urgency !== undefined && !["normal", "high", "critical"].includes(String(urgency))) {
      throw new Error("notify urgency must be normal, high, or critical.");
    }
    if (
      privacyClass !== undefined &&
      !["public", "standard", "sensitive"].includes(String(privacyClass))
    ) {
      throw new Error("notify privacyClass must be public, standard, or sensitive.");
    }
    if (
      channels !== undefined &&
      (!Array.isArray(channels) || channels.some((channel) => typeof channel !== "string"))
    ) {
      throw new Error("notify channels must be an array of strings.");
    }

    const intent = await createNotificationIntent(db, {
      ownerId: context.ownerId,
      recipientId,
      purpose,
      content: { title, body },
      urgency: urgency as "normal" | "high" | "critical" | undefined,
      privacyClass: privacyClass as "public" | "standard" | "sensitive" | undefined,
      channels: channels as string[] | undefined,
      runId: context.runId,
      nodeId: context.nodeId,
      idempotencyKey: context.idempotencyKey,
    });
    const deliveredIntent = await deliverNotificationIntent(db, {
      intentId: intent.id,
      attemptContext: {
        runId: context.runId,
        nodeId: context.nodeId,
        attemptId: context.attemptId,
      },
    });
    const terminal = new Set(["DELIVERED", "READ", "FAILED"]);
    const delivery = terminal.has(deliveredIntent.state)
      ? undefined
      : await getBlock2Worker().dispatcher.dispatch({
          ownerId: context.ownerId,
          jobKind: "block2.notify-deliver",
          payload: {
            intentId: intent.id,
            runId: context.runId,
            nodeId: context.nodeId,
            attemptId: context.attemptId,
          },
          idempotencyKey: `notify-redelivery:${context.ownerId}:${intent.id}:${context.attemptId}`,
          runId: context.runId,
          nodeId: context.nodeId,
        });
    return {
      kind: "notification-intent",
      intentId: intent.id,
      state: deliveredIntent.state,
      ...(delivery ? { redelivery: delivery } : {}),
    };
  },
};

runtimeCapabilityRegistry.register(notifyCapability);

// ─── Phase K — One Real Provider ────────────────────────────────────────────
// OpenAI chat completion capability.
// Side effects are "none" from the perspective of user data (read-only LLM call).
// Uses AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY env vars.
// Fails truthfully when the env vars are missing; callers must render the
// provider-unavailable state instead of treating a local stub as a result.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A capability that invokes a language model.
 *
 * It used to `fetch` the provider directly. That made it a second, ungoverned
 * model path: no tier policy, no usage ledger, no cost estimate, and — once the
 * call budget existed — no ceiling, so a plan step could spend without limit
 * while every runtime path was bounded. A budget that one code path can walk
 * around is not a budget.
 *
 * It now goes through `modelGateway`, which means this capability is subject to
 * the same policy, the same ledger and the same budget as everything else. The
 * returned shape is unchanged, because `execution-verifier.ts` verifies it.
 */
function allowedCapabilityModel(requested: unknown): string | undefined {
  if (typeof requested !== "string" || !requested.trim()) return undefined;
  // A plan step's inputs are model-authored. Letting them name a model would let
  // an untrusted proposal pick the most expensive one available, so a requested
  // model is honoured only when the deployment has explicitly allowed it.
  // Otherwise the gateway's own tier policy chooses.
  const allowlist = (process.env.JASIM_CAPABILITY_MODEL_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist.includes(requested.trim()) ? requested.trim() : undefined;
}

async function callOpenAiChat(
  inputs: Record<string, unknown>,
  context: CapabilityExecutionContext,
): Promise<Record<string, unknown>> {
  const systemPrompt =
    typeof inputs.systemPrompt === "string"
      ? inputs.systemPrompt
      : "You are JASIM, a helpful generative runtime assistant. Answer concisely.";
  const userPrompt = typeof inputs.prompt === "string" ? inputs.prompt : "";
  if (!userPrompt.trim()) {
    throw new ModelGatewayUnavailableError(
      "The chat capability received no prompt; nothing was sent to a model.",
    );
  }
  const maxTokens = typeof inputs.maxTokens === "number" ? inputs.maxTokens : 512;
  const requestedModel = allowedCapabilityModel(inputs.model);

  const response = await modelGateway.generate({
    prompt: userPrompt,
    systemPrompt,
    maxTokens,
    // Prose, not a JSON envelope: this capability's product is the completion.
    responseFormat: "text",
    ...(requestedModel ? { selection: { model: requestedModel } } : {}),
    taskProfile: {
      purpose: "CAPABILITY_EXECUTION",
      complexity: 0.35,
      estimatedContextSize: systemPrompt.length + userPrompt.length,
      requiresStructuredOutput: false,
      userFacing: true,
    },
    usageContext: { promptVersion: "capability-chat:v2" },
  });

  return {
    kind: "openai-chat",
    taskId: context.taskId,
    stepId: context.stepId,
    model: response.model,
    prompt: userPrompt,
    completion: response.text,
    // Normalized by the gateway across provider vocabularies. "unknown" when the
    // provider said nothing — never silently "stop".
    finishReason: response.finishReason,
    usage: {
      promptTokens: response.inputTokens ?? 0,
      completionTokens: response.outputTokens ?? 0,
      totalTokens: response.totalTokens ?? 0,
    },
  };
}

runtimeCapabilityRegistry.register({
  id: "openai-chat",
  version: "1",
  aliases: [
    "ai-chat", "llm-chat", "ai-completion", "ai-generate", "ai-write",
    "generate-text", "ai-answer", "ai-response", "ai-reply", "ai-assist",
  ],
  risk: "low",
  sideEffects: "none",
  inputContract: {
    requiredKeys: ["prompt"],
  },
  execute: async (inputs, context) => callOpenAiChat(inputs, context),
});

// Phase 11 — provider-neutral, durable capabilities. Provider requests happen
// only inside these trusted handlers after proposal approval and DAG materialization.
runtimeCapabilityRegistry.register({
  id: "web-research",
  version: "1",
  aliases: ["research-web", "web-search", "research", "find-sources"],
  risk: "medium",
  sideEffects: "none",
  inputContract: { requiredKeys: ["query"] },
  execute: async (inputs, context) => executeWebResearchProvider(inputs, context),
});

runtimeCapabilityRegistry.register({
  id: "image-generation",
  version: "1",
  aliases: ["generate-image", "create-image", "ai-image", "image-create"],
  risk: "medium",
  sideEffects: "none",
  inputContract: { requiredKeys: ["prompt"] },
  execute: async (inputs, context) => executeImageGenerationProvider(inputs, context),
});

runtimeCapabilityRegistry.register({
  id: "research-context",
  version: "1",
  aliases: ["evidence-context", "research-findings", "generation-context"],
  risk: "low",
  sideEffects: "none",
  inputContract: { requiredKeys: ["research", "userGoal"] },
  execute: async (inputs, context) => {
    const research = inputs.research;
    if (!research || typeof research !== "object" || Array.isArray(research)) {
      throw new Error("research-context requires a canonical research result.");
    }
    const sourceRunId = typeof inputs.sourceRunId === "string" ? inputs.sourceRunId : context.runId ?? "";
    const sourceNodeId = typeof inputs.sourceNodeId === "string" ? inputs.sourceNodeId : "";
    const userGoal = typeof inputs.userGoal === "string" ? inputs.userGoal : "";
    if (!sourceRunId || !sourceNodeId || !userGoal) {
      throw new Error("research-context is missing durable source identity or user goal.");
    }
    const requestedOrdinals = Array.isArray(inputs.requestedOrdinals)
      ? inputs.requestedOrdinals.filter((value): value is number => Number.isInteger(value) && value > 0)
      : [];
    const generationContext = composeResearchGenerationContext({
      research: research as Record<string, unknown>,
      sourceRunId,
      sourceNodeId,
      requestedOrdinals,
      userGoal,
    });
    return {
      kind: "research-context",
      generationContext,
      selectedEvidence: generationContext.selectedEvidence,
      findings: generationContext.findings,
      contentPolicy: generationContext.policy,
    };
  },
});