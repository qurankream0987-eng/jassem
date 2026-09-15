/**
 * Block 1 — Universal Capability Fabric (planning IR + deterministic composer).
 *
 * This module is a semantic/planning layer only. It never executes effects
 * and never registers capabilities. It translates Semantic Goals into
 * Capability Requirement Graphs and compiles them against the trusted
 * CapabilityRegistry into the smallest valid composition, or reports a
 * truthful general gap. Execution remains with the canonical durable
 * Run/DAG runtime.
 */
import type {
  CapabilityRegistry,
  TrustedCapability,
  TypedFieldSpec,
} from "./capability-registry";
import { resolveProvider } from "./capability-provider";
import type {
  CapabilityProvider,
  ProviderSelectionPolicy,
} from "./capability-provider";

export type SemanticGoal = {
  actor: string;
  intent: string;
  references: string[];
  desiredOutcomes: DesiredOutcome[];
  hardConstraints: ConstraintExpression[];
  softPreferences: ConstraintExpression[];
  temporalContext?: string;
  locationContext?: string;
  economicContext?: "economic" | "non_economic" | "unknown";
  riskSignals?: string[];
};

export type DesiredOutcome = {
  id: string;
  semantics: string;
  dependsOn: string[];
};

export type ConstraintOperator =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "contains"
  | "within_time"
  | "compatible";

export type ConstraintExpression = {
  field: string;
  operator: ConstraintOperator;
  value: unknown;
  unit?: string;
};

export type CapabilityEffectRequirement =
  | "pure"
  | "internal_stateful"
  | "external_effectful"
  | "human_authority";

export type CapabilityRequirement = {
  id: string;
  /** Semantic action kind, e.g. DISCOVER, MATCH, CREATE_OFFERING, PAY. Open vocabulary. */
  kind: string;
  semanticPurpose: string;
  inputSpec: TypedFieldSpec[];
  outputSpec: TypedFieldSpec[];
  effectClass: CapabilityEffectRequirement;
  providerRequirement?: string;
  resourceRequirement?: string;
  authorityClass?: "human" | "owner" | "regulatory";
  dependsOn: string[];
  condition?: ConstraintExpression;
};

export type CapabilityRequirementGraph = {
  goalId: string;
  requirements: CapabilityRequirement[];
};

export type GapKind =
  | "MISSING_GENERIC_CAPABILITY"
  | "BLOCKED_BY_PROVIDER"
  | "BLOCKED_BY_RESOURCE"
  | "REQUIRES_HUMAN"
  | "REQUIRES_OWNER_DECISION"
  | "REQUIRES_REGULATORY_REVIEW"
  | "INSUFFICIENT_INFORMATION"
  | "INSUFFICIENT_TRUST"
  | "BINDING_VALIDATION_FAILED";

export type CapabilityGap = {
  kind: GapKind;
  requirementId?: string;
  requirementKind?: string;
  detail: string;
  missingInputs?: string[];
  providerClass?: string;
  resourceClass?: string;
  /** Block 1.1: development evidence for genuinely missing capabilities. */
  gapCandidate?: CapabilityGapCandidate;
};

/**
 * Block 1.1 search-before-build evidence record. Development-oriented only:
 * never auto-registered, never execution code, never a Core modification.
 */
export type CapabilityGapCandidate = {
  semanticPurpose: string;
  requiredInputs?: TypedFieldSpec[];
  expectedOutputs?: TypedFieldSpec[];
  effectClass?: string;
  riskClass?: string;
  providerClassesSearched: string[];
  existingCapabilitiesConsidered: string[];
  compositionsAttempted: number;
  compositionFailureReason?: string;
  externalCatalogSourcesSearched: string[];
  possibleGenericPrimitive?: string;
};

export type ComposedNode = {
  requirementId: string;
  capabilityId: string;
  inputs: Record<string, unknown>;
  bindings: TypedBinding[];
  dependsOn: string[];
};

export type TypedBinding = {
  fromRequirementId: string;
  fromField: string;
  toRequirementId: string;
  toField: string;
};

export type CompositionResult =
  | { status: "COMPOSED"; nodes: ComposedNode[]; gaps: [] }
  | { status: "BLOCKED"; nodes: ComposedNode[]; gaps: CapabilityGap[] };

export type CompositionContext = {
  availableProviders: string[];
  availableResources: string[];
  /** Inputs already known/validated for the goal, keyed by requirement id. */
  knownInputs?: Record<string, Record<string, unknown>>;
  /** Block 1.1: untrusted external candidates discovered via catalog sources. */
  externalCandidates?: CapabilityProvider[];
  /** Block 1.1: catalog source ids searched (gap-candidate evidence). */
  catalogSourcesSearched?: string[];
  /** Block 1.1: provider selection policy forwarded to the resolver. */
  providerPolicy?: ProviderSelectionPolicy;
  /** Block 1.1: evaluation time for catalog freshness. */
  now?: Date;
};

function normalizeSemantic(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

// ---------------------------------------------------------------------------
// Unit normalization (deterministic, no LLM reasoning over trusted numerics)
// ---------------------------------------------------------------------------

const UNIT_TABLE: Record<string, { dimension: string; factor: number }> = {
  g: { dimension: "mass", factor: 0.001 },
  kg: { dimension: "mass", factor: 1 },
  ton: { dimension: "mass", factor: 1000 },
  tonne: { dimension: "mass", factor: 1000 },
  second: { dimension: "time", factor: 1 },
  seconds: { dimension: "time", factor: 1 },
  minute: { dimension: "time", factor: 60 },
  minutes: { dimension: "time", factor: 60 },
  hour: { dimension: "time", factor: 3600 },
  hours: { dimension: "time", factor: 3600 },
  day: { dimension: "time", factor: 86400 },
  days: { dimension: "time", factor: 86400 },
  week: { dimension: "time", factor: 604800 },
  weeks: { dimension: "time", factor: 604800 },
  seat: { dimension: "count", factor: 1 },
  seats: { dimension: "count", factor: 1 },
  unit: { dimension: "count", factor: 1 },
  units: { dimension: "count", factor: 1 },
  count: { dimension: "count", factor: 1 },
};

export function normalizeUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
): number | undefined {
  const from = UNIT_TABLE[normalizeSemantic(fromUnit)];
  const to = UNIT_TABLE[normalizeSemantic(toUnit)];
  if (!from || !to || from.dimension !== to.dimension) return undefined;
  return (value * from.factor) / to.factor;
}

export function unitsCompatible(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return true;
  const ua = UNIT_TABLE[normalizeSemantic(a)];
  const ub = UNIT_TABLE[normalizeSemantic(b)];
  if (!ua || !ub) return normalizeSemantic(a) === normalizeSemantic(b);
  return ua.dimension === ub.dimension;
}

// ---------------------------------------------------------------------------
// Typed field validation
// ---------------------------------------------------------------------------

export type FieldValidation =
  | { ok: true }
  | { ok: false; missing: string[]; invalid: string[] };

export function validateTypedFields(
  spec: TypedFieldSpec[],
  value: Record<string, unknown>,
): FieldValidation {
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const field of spec) {
    const present = Object.prototype.hasOwnProperty.call(value, field.name);
    const fieldValue = value[field.name];
    if (!present || fieldValue === undefined || fieldValue === null) {
      if (field.required) missing.push(field.name);
      continue;
    }
    if (!fieldTypeMatches(field, fieldValue)) invalid.push(field.name);
  }
  return missing.length === 0 && invalid.length === 0
    ? { ok: true }
    : { ok: false, missing, invalid };
}

function fieldTypeMatches(field: TypedFieldSpec, value: unknown): boolean {
  switch (field.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

// ---------------------------------------------------------------------------
// Capability matching: requirement -> trusted capability
// ---------------------------------------------------------------------------

export function matchRequirement(
  requirement: CapabilityRequirement,
  registry: CapabilityRegistry,
  context: CompositionContext,
): { capability?: TrustedCapability; gap?: CapabilityGap } {
  const kind = normalizeSemantic(requirement.kind);
  const candidates = registry.list();
  const capability = candidates.find((candidate) => {
    if (candidate.testOnly) return false;
    if (normalizeSemantic(candidate.id) === kind) return true;
    if (candidate.aliases.some((alias) => normalizeSemantic(alias) === kind)) return true;
    return (candidate.semanticPurposes ?? []).some(
      (purpose) => normalizeSemantic(purpose) === kind,
    );
  });

  if (!capability) {
    // Block 1.1 search-before-build: an untrusted external provider candidate
    // matching this requirement means provider-blocked, not a true semantic
    // gap. The candidate never becomes trusted through matching alone.
    const externalCandidate = (context.externalCandidates ?? []).find(
      (candidate) => normalizeSemantic(candidate.implementationId) === kind,
    );
    if (externalCandidate) {
      return {
        gap: {
          kind: "BLOCKED_BY_PROVIDER",
          requirementId: requirement.id,
          requirementKind: requirement.kind,
          detail: `External provider candidate ${externalCandidate.id} (${externalCandidate.kind}) matches ${requirement.kind} but is untrusted/unapproved.`,
          providerClass: externalCandidate.kind,
        },
      };
    }
    return {
      gap: {
        kind: "MISSING_GENERIC_CAPABILITY",
        requirementId: requirement.id,
        requirementKind: requirement.kind,
        detail: `No trusted capability satisfies semantic requirement ${requirement.kind}`,
        providerClass: requirement.providerRequirement,
        resourceClass: requirement.resourceRequirement,
        gapCandidate: {
          semanticPurpose: requirement.semanticPurpose,
          requiredInputs: requirement.inputSpec,
          expectedOutputs: requirement.outputSpec,
          effectClass: requirement.effectClass,
          providerClassesSearched: [
            ...new Set((context.externalCandidates ?? []).map((c) => c.kind)),
          ],
          existingCapabilitiesConsidered: candidates
            .filter((c) => !c.testOnly)
            .map((c) => c.id),
          compositionsAttempted: 0,
          compositionFailureReason:
            "No composable candidate satisfied the requirement.",
          externalCatalogSourcesSearched: context.catalogSourcesSearched ?? [],
          possibleGenericPrimitive: requirement.kind,
        },
      },
    };
  }

  if (
    requirement.authorityClass ||
    capability.effectClass === "human_authority" ||
    capability.authorityClass
  ) {
    const authority =
      requirement.authorityClass ?? capability.authorityClass ?? "human";
    const gapKind: GapKind =
      authority === "owner"
        ? "REQUIRES_OWNER_DECISION"
        : authority === "regulatory"
          ? "REQUIRES_REGULATORY_REVIEW"
          : "REQUIRES_HUMAN";
    return {
      gap: {
        kind: gapKind,
        requirementId: requirement.id,
        requirementKind: requirement.kind,
        detail: `Requirement ${requirement.kind} is authority-bound (${authority})`,
      },
    };
  }

  const providerNeeds = new Set([
    ...(capability.providerRequirements ?? []),
    ...(requirement.providerRequirement ? [requirement.providerRequirement] : []),
  ]);
  for (const provider of providerNeeds) {
    if (!context.availableProviders.includes(provider)) {
      return {
        gap: {
          kind: "BLOCKED_BY_PROVIDER",
          requirementId: requirement.id,
          requirementKind: requirement.kind,
          detail: `Capability ${capability.id} requires unavailable provider ${provider}`,
          providerClass: provider,
        },
      };
    }
  }

  const resourceNeeds = new Set([
    ...(capability.resourceRequirements ?? []),
    ...(requirement.resourceRequirement ? [requirement.resourceRequirement] : []),
  ]);
  for (const resource of resourceNeeds) {
    if (!context.availableResources.includes(resource)) {
      return {
        gap: {
          kind: "BLOCKED_BY_RESOURCE",
          requirementId: requirement.id,
          requirementKind: requirement.kind,
          detail: `Capability ${capability.id} requires unavailable resource ${resource}`,
          resourceClass: resource,
        },
      };
    }
  }

  // Block 1.1: the semantic capability exists — a provider must implement it.
  // Native handlers auto-register as NATIVE providers, so accepted Block 1
  // behavior is unchanged; truthful BLOCKED_BY_PROVIDER appears only when a
  // known capability has no servable provider.
  const resolution = resolveProvider({
    capabilityId: capability.id,
    registry: registry.providers(),
    policy: context.providerPolicy,
    now: context.now,
  });
  if (resolution.status !== "SELECTED") {
    return {
      gap: {
        kind: "BLOCKED_BY_PROVIDER",
        requirementId: requirement.id,
        requirementKind: requirement.kind,
        detail: `Capability ${capability.id} exists but provider resolution is ${resolution.status}: ${resolution.reason}`,
        providerClass: requirement.providerRequirement,
      },
    };
  }

  return { capability };
}

// ---------------------------------------------------------------------------
// Typed binding validation between composed nodes
// ---------------------------------------------------------------------------

export function validateBinding(
  source: CapabilityRequirement | TrustedCapability,
  target: CapabilityRequirement | TrustedCapability,
): { ok: true; bindings: TypedBinding[] } | { ok: false; reason: string; missing: string[] } {
  const outputSpec = source.outputSpec ?? [];
  const inputSpec = target.inputSpec ?? [];
  const missing: string[] = [];
  const bindings: TypedBinding[] = [];

  for (const input of inputSpec) {
    if (!input.required) continue;
    const output = outputSpec.find(
      (candidate) =>
        normalizeSemantic(candidate.name) === normalizeSemantic(input.name) ||
        (candidate.semantic !== undefined &&
          input.semantic !== undefined &&
          normalizeSemantic(candidate.semantic) === normalizeSemantic(input.semantic)),
    );
    if (!output) {
      missing.push(input.name);
      continue;
    }
    if (output.type !== input.type) {
      return {
        ok: false,
        reason: `Type mismatch on ${input.name}: ${output.type} -> ${input.type}`,
        missing,
      };
    }
    if (!unitsCompatible(output.unit, input.unit)) {
      return {
        ok: false,
        reason: `Incompatible units on ${input.name}: ${output.unit} -> ${input.unit}`,
        missing,
      };
    }
    bindings.push({
      fromRequirementId: source.id,
      fromField: output.name,
      toRequirementId: target.id,
      toField: input.name,
    });
  }

  if (missing.length > 0) {
    return { ok: false, reason: "Required inputs have no typed binding", missing };
  }
  return { ok: true, bindings };
}

// ---------------------------------------------------------------------------
// Composer: requirement graph -> smallest valid composition or truthful gaps
// ---------------------------------------------------------------------------

export function composeRequirementGraph(
  graph: CapabilityRequirementGraph,
  registry: CapabilityRegistry,
  context: CompositionContext,
): CompositionResult {
  const gaps: CapabilityGap[] = [];
  const nodes: ComposedNode[] = [];
  const byId = new Map(graph.requirements.map((req) => [req.id, req]));
  const resolved = new Map<string, TrustedCapability>();

  // Topological order (dependencies first); cycles are a validation failure.
  const ordered: CapabilityRequirement[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (req: CapabilityRequirement): boolean => {
    if (done.has(req.id)) return true;
    if (visiting.has(req.id)) return false;
    visiting.add(req.id);
    for (const dep of req.dependsOn) {
      const depReq = byId.get(dep);
      if (depReq && !visit(depReq)) return false;
    }
    visiting.delete(req.id);
    done.add(req.id);
    ordered.push(req);
    return true;
  };
  for (const req of graph.requirements) {
    if (!visit(req)) {
      return {
        status: "BLOCKED",
        nodes: [],
        gaps: [
          {
            kind: "BINDING_VALIDATION_FAILED",
            requirementId: req.id,
            requirementKind: req.kind,
            detail: "Dependency cycle detected in requirement graph",
          },
        ],
      };
    }
  }

  for (const requirement of ordered) {
    const { capability, gap } = matchRequirement(requirement, registry, context);
    if (gap) {
      gaps.push(gap);
      continue;
    }
    if (!capability) continue;
    resolved.set(requirement.id, capability);

    // A requirement may omit its spec; inherit the matched capability's contract.
    const effectiveInputSpec =
      requirement.inputSpec.length > 0 ? requirement.inputSpec : capability.inputSpec ?? [];

    // Typed bindings from dependencies: bind what matches by name/semantic,
    // reject unsafe type/unit coercion, then cover the rest from known inputs.
    const bindings: TypedBinding[] = [];
    const boundFields = new Set<string>();
    let mismatch: string | undefined;
    for (const depId of requirement.dependsOn) {
      const depReq = byId.get(depId);
      if (!depReq) continue;
      const depOutputs =
        depReq.outputSpec && depReq.outputSpec.length > 0
          ? depReq.outputSpec
          : resolved.get(depId)?.outputSpec ?? [];
      for (const input of effectiveInputSpec) {
        if (!input.required || boundFields.has(input.name)) continue;
        const output = depOutputs.find(
          (candidate) =>
            normalizeSemantic(candidate.name) === normalizeSemantic(input.name) ||
            (candidate.semantic !== undefined &&
              input.semantic !== undefined &&
              normalizeSemantic(candidate.semantic) === normalizeSemantic(input.semantic)),
        );
        if (!output) continue;
        if (output.type !== input.type) {
          mismatch = `Type mismatch on ${input.name}: ${output.type} -> ${input.type}`;
          break;
        }
        if (!unitsCompatible(output.unit, input.unit)) {
          mismatch = `Incompatible units on ${input.name}: ${output.unit} -> ${input.unit}`;
          break;
        }
        bindings.push({
          fromRequirementId: depId,
          fromField: output.name,
          toRequirementId: requirement.id,
          toField: input.name,
        });
        boundFields.add(input.name);
      }
      if (mismatch) break;
    }
    if (mismatch) {
      gaps.push({
        kind: "BINDING_VALIDATION_FAILED",
        requirementId: requirement.id,
        requirementKind: requirement.kind,
        detail: mismatch,
      });
      continue;
    }

    // Minimum required information for the next safe step.
    const known = context.knownInputs?.[requirement.id] ?? {};
    const validation = validateTypedFields(effectiveInputSpec, known);
    if (!validation.ok) {
      if (validation.invalid.length > 0) {
        gaps.push({
          kind: "BINDING_VALIDATION_FAILED",
          requirementId: requirement.id,
          requirementKind: requirement.kind,
          detail: `Invalid typed inputs: ${validation.invalid.join(", ")}`,
        });
        continue;
      }
      const stillMissing = validation.missing.filter((name) => !boundFields.has(name));
      if (stillMissing.length > 0) {
        gaps.push({
          kind: "INSUFFICIENT_INFORMATION",
          requirementId: requirement.id,
          requirementKind: requirement.kind,
          detail: `Requirement ${requirement.kind} is missing required typed inputs`,
          missingInputs: stillMissing,
        });
        continue;
      }
    }

    nodes.push({
      requirementId: requirement.id,
      capabilityId: capability.id,
      inputs: known,
      bindings,
      dependsOn: requirement.dependsOn,
    });
  }

  return gaps.length > 0
    ? { status: "BLOCKED", nodes, gaps }
    : { status: "COMPOSED", nodes, gaps: [] };
}
