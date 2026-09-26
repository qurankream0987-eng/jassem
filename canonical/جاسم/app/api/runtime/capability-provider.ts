/**
 * Block 1.1 — Capability Provider fabric.
 *
 * SEMANTIC CAPABILITY != CAPABILITY PROVIDER.
 *
 * TrustedCapability (api/runtime/capability-registry.ts) remains the semantic
 * contract JASIM owns. A CapabilityProvider is one possible implementation
 * source; a ProviderBinding is the validated relationship between a semantic
 * requirement and a selected provider. Selection is DETERMINISTIC — the LLM
 * may help understand what capability is required, never which provider is
 * trusted.
 *
 * MCP/A2A metadata remains untrusted until deterministic selection and the
 * runtime's remote-execution boundary authorize a binding. Remaining kinds
 * are extensible identifiers only.
 */

import { randomUUID } from "node:crypto";
import type { TypedFieldSpec, TrustedCapability } from "./capability-registry";

// ---------------------------------------------------------------------------
// Provider model
// ---------------------------------------------------------------------------

export type ProviderKind =
  | "NATIVE"
  | "MCP"
  | "A2A"
  | "AGENT_HARNESS"
  | "COMPUTER_USE"
  | "HUMAN";

export type ProviderTrustClass =
  | "TRUSTED_CORE"
  | "TRUSTED_CONFIGURED"
  | "UNTRUSTED_CANDIDATE";

export type OperationalHealth =
  | "AVAILABLE"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "UNKNOWN"
  | "STALE";

export type ProviderAvailabilityState = OperationalHealth;

export type ProviderCostClass = "LOCAL" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
export type ProviderLatencyClass = "LOCAL" | "FAST" | "MEDIUM" | "SLOW" | "UNKNOWN";

export type ProviderProvenanceSource =
  | "NATIVE_REGISTRY"
  | "MCP_CATALOG"
  | "A2A_AGENT_CARD"
  | "MANUAL_CONFIG"
  | "IDENTITY"
  | "PAYMENT"
  | "MERCHANT_OF_RECORD";

export const SENSITIVE_PROVIDER_CLASSES: ReadonlySet<ProviderProvenanceSource> =
  new Set<ProviderProvenanceSource>(["IDENTITY", "PAYMENT", "MERCHANT_OF_RECORD"]);

export type ProviderFreshness = {
  discoveredAt: Date;
  refreshedAt?: Date;
  /** Stale metadata must never silently authorize execution. */
  expiresAt?: Date;
  schemaHash?: string;
};

export type CapabilityProvider = {
  id: string;
  kind: ProviderKind;
  /**
   * Semantic capability reference. Undefined for external candidates that have
   * not been deterministically mapped to a semantic capability yet.
   */
  capabilityId?: string;
  implementationId: string;
  protocol?: string;
  protocolVersion?: string;
  trustClass: ProviderTrustClass;
  availability: { state: ProviderAvailabilityState; observedAt: Date };
  costClass: ProviderCostClass;
  latencyClass: ProviderLatencyClass;
  privacyClass?: string;
  jurisdiction?: string;
  verifiedSuccessCount?: number;
  /** I/O compatibility metadata (same spec shape as semantic contracts). */
  inputSpec?: TypedFieldSpec[];
  outputSpec?: TypedFieldSpec[];
  /**
   * Provider descriptions are DATA. They are never rendered into system
   * instructions and never influence trust, selection, or policy.
   */
  description?: string;
  /**
   * JASIM-controlled exact semantic keys for candidate mapping — sourced from
   * structured metadata fields or explicit JASIM-side configuration, NEVER
   * parsed out of free-text descriptions or remote tool names.
   */
  semanticKeys?: string[];
  /** HTTP transport endpoint retained from normalized remote metadata. */
  endpoint?: string;
  //
  // `receiptSecret` USED TO BE DECLARED HERE, AND IS GONE ON PURPOSE.
  //
  // Nothing ever assigned it. A candidate normalized from MCP tool metadata or
  // an A2A agent card is UNTRUSTED_CANDIDATE by construction, and a candidate
  // is not an account — so there was no honest writer for it and there was
  // never going to be one. Receipt verification material now belongs to the
  // scope's provider BINDING and is resolved from the remote execution that
  // recorded which account it ran through:
  //
  //   api/runtime/receipt-verification.ts
  //
  //   PROVIDER_CANDIDATE != PROVIDER_ACCOUNT
  //   PROVIDER_RECEIPT_SECRET != PUBLIC DISCOVERY METADATA
  //
  provenance: { source: ProviderProvenanceSource; reference?: string };
  freshness?: ProviderFreshness;
  /** Execution binding — NATIVE providers only. */
  nativeHandler?: TrustedCapability["execute"];
};

export type ProviderBinding = {
  id: string;
  capabilityId: string;
  providerId: string;
  implementationId: string;
  kind: ProviderKind;
  validatedAt: string;
  validated: {
    semantic: true;
    inputContract: true;
    outputContract: true;
    trust: true;
    availability: true;
    protocol: true;
  };
};

export type ProviderResolutionStatus =
  | "SELECTED"
  | "NO_PROVIDER"
  | "BLOCKED"
  | "INCOMPATIBLE"
  | "STALE"
  | "UNTRUSTED";

export type ProviderResolutionResult =
  | { status: "SELECTED"; binding: ProviderBinding; candidatesConsidered: number }
  | {
      status: Exclude<ProviderResolutionStatus, "SELECTED">;
      reason: string;
      candidatesConsidered: number;
    };

// ---------------------------------------------------------------------------
// Provider registry (native providers live in code; external catalog entries
// persist in the single capability_provider_catalog table).
// ---------------------------------------------------------------------------

export type ProviderSelectionPolicy = {
  /**
   * Conservative default: trusted local/native before remote providers
   * (latency, cost, privacy, failure surface). Policy semantics, not domain
   * logic — configurable, never hard-coded per kind.
   */
  kindPreference?: ProviderKind[];
  /** Protocols the server is configured to speak, e.g. { mcp: ["2025-06-18"] }. */
  supportedProtocols?: Record<string, string[]>;
  /** Explicit trust approvals for otherwise-untrusted provider ids (fixtures/config). */
  trustApprovals?: ReadonlySet<string>;
  /** When set, providers must declare this exact privacy class. */
  requirePrivacyClass?: string;
  /** When set, providers must declare a jurisdiction in this allowlist. */
  allowedJurisdictions?: string[];
};

export class CapabilityProviderRegistry {
  private readonly providers = new Map<string, CapabilityProvider>();

  register(provider: CapabilityProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered.`);
    }
    if (provider.kind === "NATIVE" && !provider.nativeHandler) {
      throw new Error(`NATIVE provider "${provider.id}" requires an execution binding.`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): CapabilityProvider | undefined {
    return this.providers.get(id);
  }

  list(): CapabilityProvider[] {
    return [...this.providers.values()];
  }

  forCapability(capabilityId: string): CapabilityProvider[] {
    return this.list().filter((p) => p.capabilityId === capabilityId);
  }

  clear(): void {
    this.providers.clear();
  }
}

// Provider registries are instance-scoped: each CapabilityRegistry owns one
// (see capability-registry.ts). There is deliberately NO process-global
// provider registry, so test-only or foreign registrations can never leak
// into the runtime trust domain.

/**
 * Zero-behavior-change native migration: an existing TrustedCapability handler
 * becomes a NATIVE provider bound to the same execute() implementation.
 */
export function registerNativeProvider(
  registry: CapabilityProviderRegistry,
  capability: TrustedCapability,
): CapabilityProvider {
  const provider: CapabilityProvider = {
    id: `native:${capability.id}`,
    kind: "NATIVE",
    capabilityId: capability.id,
    implementationId: capability.id,
    trustClass: "TRUSTED_CORE",
    availability: { state: "AVAILABLE", observedAt: new Date() },
    costClass: "LOCAL",
    latencyClass: "LOCAL",
    inputSpec: capability.inputSpec,
    outputSpec: capability.outputSpec,
    provenance: { source: "NATIVE_REGISTRY" },
    nativeHandler: capability.execute,
  };
  const existing = registry.get(provider.id);
  if (existing) {
    if (existing.nativeHandler !== capability.execute) {
      throw new Error(
        `Native provider "${provider.id}" conflicts with an already-registered handler.`,
      );
    }
    return existing;
  }
  registry.register(provider);
  return provider;
}

// ---------------------------------------------------------------------------
// Catalog freshness
// ---------------------------------------------------------------------------

export function isProviderStale(provider: CapabilityProvider, now = new Date()): boolean {
  if (provider.availability.state === "STALE") return true;
  // NATIVE providers are bound to trusted code at registration. Every other
  // kind requires an explicit, unexpired freshness lease — a missing expiry
  // fails CLOSED as STALE so remote metadata can never authorize
  // indefinitely.
  const expiresAt = provider.freshness?.expiresAt;
  if (provider.kind === "NATIVE") {
    return expiresAt !== undefined && expiresAt.getTime() <= now.getTime();
  }
  return expiresAt === undefined || expiresAt.getTime() <= now.getTime();
}

export function observeProviderHealth(
  provider: CapabilityProvider,
  observed: { state: OperationalHealth; at?: Date },
): CapabilityProvider {
  return {
    ...provider,
    availability: {
      state: observed.state,
      observedAt: observed.at ?? new Date(),
    },
  };
}

function providerPassesTrustGate(
  provider: CapabilityProvider,
  policy?: ProviderSelectionPolicy,
): boolean {
  return (
    provider.trustClass !== "UNTRUSTED_CANDIDATE" ||
    (policy?.trustApprovals?.has(provider.id) ?? false)
  );
}

function providerPassesSelectionConstraints(
  provider: CapabilityProvider,
  policy?: ProviderSelectionPolicy,
): boolean {
  if (
    policy?.requirePrivacyClass !== undefined &&
    provider.privacyClass !== policy.requirePrivacyClass
  ) {
    return false;
  }
  if (
    policy?.allowedJurisdictions !== undefined &&
    (provider.jurisdiction === undefined ||
      !policy.allowedJurisdictions.includes(provider.jurisdiction))
  ) {
    return false;
  }
  return true;
}

export function canFallback(
  from: CapabilityProvider,
  to: CapabilityProvider,
  policy?: ProviderSelectionPolicy,
): { ok: boolean; reason?: string } {
  if (
    from.capabilityId === undefined ||
    to.capabilityId === undefined ||
    from.capabilityId !== to.capabilityId
  ) {
    return { ok: false, reason: "Fallback providers must have the same capability." };
  }

  const fromKeys = from.semanticKeys ?? [];
  const toKeys = to.semanticKeys ?? [];
  const semanticsEquivalent =
    fromKeys.length > 0 || toKeys.length > 0
      ? fromKeys.some((key) => toKeys.includes(key))
      : from.implementationId === to.implementationId;
  if (!semanticsEquivalent) {
    return { ok: false, reason: "Fallback providers are not semantically equivalent." };
  }

  if (!providerPassesTrustGate(from, policy) || !providerPassesTrustGate(to, policy)) {
    return { ok: false, reason: "Fallback providers must both pass the trust gate." };
  }
  const now = new Date();
  if (isProviderStale(from, now) || isProviderStale(to, now)) {
    return { ok: false, reason: "Fallback providers must both have fresh metadata." };
  }
  if (
    !providerPassesSelectionConstraints(from, policy) ||
    !providerPassesSelectionConstraints(to, policy)
  ) {
    return { ok: false, reason: "Fallback providers violate selection policy constraints." };
  }

  if (from.privacyClass !== to.privacyClass) {
    return { ok: false, reason: "Fallback cannot change privacy class." };
  }
  if (from.jurisdiction !== to.jurisdiction) {
    return { ok: false, reason: "Fallback cannot change jurisdiction." };
  }
  if (
    SENSITIVE_PROVIDER_CLASSES.has(from.provenance.source) ||
    SENSITIVE_PROVIDER_CLASSES.has(to.provenance.source)
  ) {
    return { ok: false, reason: "Fallback is disabled for sensitive provider classes." };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deterministic provider resolution
// ---------------------------------------------------------------------------

const DEFAULT_KIND_PREFERENCE: ProviderKind[] = [
  "NATIVE",
  "MCP",
  "A2A",
  "AGENT_HARNESS",
  "COMPUTER_USE",
  "HUMAN",
];

function specCompatible(
  required: TypedFieldSpec[] | undefined,
  offered: TypedFieldSpec[] | undefined,
): boolean {
  // A provider is input-compatible when it can accept every required input,
  // output-compatible when it offers every required output. Missing metadata
  // on the requirement side imposes no constraint.
  if (!required || required.length === 0) return true;
  if (!offered) return false;
  const offeredNames = new Set(offered.map((f) => f.name));
  return required
    .filter((f) => f.required)
    .every((f) => {
      if (!offeredNames.has(f.name)) return false;
      const offeredField = offered.find((o) => o.name === f.name);
      return offeredField?.type === f.type;
    });
}

export function resolveProvider(input: {
  capabilityId: string;
  requirementInputSpec?: TypedFieldSpec[];
  requirementOutputSpec?: TypedFieldSpec[];
  registry: CapabilityProviderRegistry;
  policy?: ProviderSelectionPolicy;
  now?: Date;
}): ProviderResolutionResult {
  const registry = input.registry;
  const now = input.now ?? new Date();
  const candidates = registry.forCapability(input.capabilityId);
  if (candidates.length === 0) {
    return {
      status: "NO_PROVIDER",
      reason: `Capability ${input.capabilityId} exists but no provider is registered.`,
      candidatesConsidered: 0,
    };
  }

  const trustApprovals = input.policy?.trustApprovals ?? new Set<string>();
  const supported = input.policy?.supportedProtocols ?? {};

  // Trust filter: untrusted candidates never execute without explicit approval.
  const trusted = candidates.filter(
    (p) => p.trustClass !== "UNTRUSTED_CANDIDATE" || trustApprovals.has(p.id),
  );
  if (trusted.length === 0) {
    return {
      status: "UNTRUSTED",
      reason: `All ${candidates.length} provider candidate(s) for ${input.capabilityId} are untrusted.`,
      candidatesConsidered: candidates.length,
    };
  }

  // Freshness filter: stale metadata never silently authorizes execution.
  const fresh = trusted.filter((p) => !isProviderStale(p, now));
  if (fresh.length === 0) {
    return {
      status: "STALE",
      reason: `All trusted providers for ${input.capabilityId} have stale catalog metadata.`,
      candidatesConsidered: candidates.length,
    };
  }

  // Operational health: AVAILABLE and DEGRADED are selectable; a catalog entry
  // alone never establishes either state. All other states fail closed.
  const available = fresh.filter(
    (p) => p.availability.state === "AVAILABLE" || p.availability.state === "DEGRADED",
  );
  if (available.length === 0) {
    return {
      status: "BLOCKED",
      reason: `No available provider for ${input.capabilityId} (states: ${fresh.map((p) => p.availability.state).join(", ")}).`,
      candidatesConsidered: candidates.length,
    };
  }

  const policyCompatible = available.filter((p) =>
    providerPassesSelectionConstraints(p, input.policy),
  );
  if (policyCompatible.length === 0) {
    return {
      status: "BLOCKED",
      reason: `No provider for ${input.capabilityId} satisfies the privacy class and jurisdiction constraints.`,
      candidatesConsidered: candidates.length,
    };
  }

  // Protocol compatibility: unsupported/ambiguous versions fail safe.
  const protocolOk = policyCompatible.filter((p) => {
    if (!p.protocol) return true;
    const versions = supported[p.protocol];
    if (!versions) return false;
    return p.protocolVersion !== undefined && versions.includes(p.protocolVersion);
  });
  if (protocolOk.length === 0) {
    return {
      status: "INCOMPATIBLE",
      reason: `No provider for ${input.capabilityId} speaks a supported protocol version.`,
      candidatesConsidered: candidates.length,
    };
  }

  // Contract compatibility (never keyword similarity alone). NATIVE providers
  // carry the capability's own contract — requirement↔capability binding is
  // already validated by the Block 1 composer, so re-filtering them here would
  // change accepted behavior. External candidates are filtered by their
  // declared I/O metadata.
  const compatible = protocolOk.filter(
    (p) =>
      p.kind === "NATIVE" ||
      (specCompatible(input.requirementInputSpec, p.inputSpec) &&
        specCompatible(input.requirementOutputSpec, p.outputSpec)),
  );
  if (compatible.length === 0) {
    return {
      status: "INCOMPATIBLE",
      reason: `No provider for ${input.capabilityId} satisfies the required I/O contract.`,
      candidatesConsidered: candidates.length,
    };
  }

  // Deterministic selection: operational health, configurable kind preference,
  // verified successes (when known for both), cost, latency, most-recently
  // observed availability, then id for stability.
  const preference = input.policy?.kindPreference ?? DEFAULT_KIND_PREFERENCE;
  const rank = (p: CapabilityProvider): number => {
    const i = preference.indexOf(p.kind);
    return i === -1 ? preference.length : i;
  };
  const costRank: Record<ProviderCostClass, number> = { LOCAL: 0, LOW: 1, MEDIUM: 2, HIGH: 3, UNKNOWN: 4 };
  const latencyRank: Record<ProviderLatencyClass, number> = { LOCAL: 0, FAST: 1, MEDIUM: 2, SLOW: 3, UNKNOWN: 4 };
  const healthRank: Record<"AVAILABLE" | "DEGRADED", number> = {
    AVAILABLE: 0,
    DEGRADED: 1,
  };
  const selected = [...compatible].sort((a, b) => {
    const verifiedSuccessRank =
      a.verifiedSuccessCount !== undefined && b.verifiedSuccessCount !== undefined
        ? b.verifiedSuccessCount - a.verifiedSuccessCount
        : 0;
    return (
      healthRank[a.availability.state as "AVAILABLE" | "DEGRADED"] -
        healthRank[b.availability.state as "AVAILABLE" | "DEGRADED"] ||
      rank(a) - rank(b) ||
      verifiedSuccessRank ||
      costRank[a.costClass] - costRank[b.costClass] ||
      latencyRank[a.latencyClass] - latencyRank[b.latencyClass] ||
      b.availability.observedAt.getTime() - a.availability.observedAt.getTime() ||
      a.id.localeCompare(b.id)
    );
  })[0];

  return {
    status: "SELECTED",
    binding: {
      id: randomUUID(),
      capabilityId: input.capabilityId,
      providerId: selected.id,
      implementationId: selected.implementationId,
      kind: selected.kind,
      validatedAt: now.toISOString(),
      validated: {
        semantic: true,
        inputContract: true,
        outputContract: true,
        trust: true,
        availability: true,
        protocol: true,
      },
    },
    candidatesConsidered: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Dynamic discovery: cheap summaries first, full contracts only for finalists
// ---------------------------------------------------------------------------

export type ProviderSummaryMetadata = {
  id: string;
  kind: ProviderKind;
  capabilityId?: string;
  implementationId: string;
  trustClass: ProviderTrustClass;
  availabilityState: ProviderAvailabilityState;
  costClass: ProviderCostClass;
  latencyClass: ProviderLatencyClass;
  protocol?: string;
  protocolVersion?: string;
  /** Normalized semantic keys for deterministic candidate retrieval. */
  semanticKeys: string[];
  provenance: ProviderProvenanceSource;
};

export function toProviderSummary(p: CapabilityProvider): ProviderSummaryMetadata {
  return {
    id: p.id,
    kind: p.kind,
    capabilityId: p.capabilityId,
    implementationId: p.implementationId,
    trustClass: p.trustClass,
    availabilityState: p.availability.state,
    costClass: p.costClass,
    latencyClass: p.latencyClass,
    protocol: p.protocol,
    protocolVersion: p.protocolVersion,
    semanticKeys: [p.capabilityId, p.implementationId].filter(
      (k): k is string => typeof k === "string",
    ),
    provenance: p.provenance.source,
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

/**
 * Candidate retrieval may use semantic metadata; final compatibility remains
 * deterministic (resolveProvider). Retrieval NEVER returns full contracts.
 */
export function searchProviderCatalog(input: {
  semanticKind: string;
  registry: CapabilityProviderRegistry;
  extraCandidates?: CapabilityProvider[];
}): ProviderSummaryMetadata[] {
  const registry = input.registry;
  const kind = normalizeKey(input.semanticKind);
  const all = [...registry.list(), ...(input.extraCandidates ?? [])];
  return all
    .filter((p) => {
      const keys = [p.capabilityId, p.implementationId].filter(
        (k): k is string => typeof k === "string",
      );
      return keys.some((k) => normalizeKey(k) === kind);
    })
    .map(toProviderSummary);
}

/** Full contracts are loaded only for finalists selected from summaries. */
export function loadFullProviderContracts(
  ids: string[],
  registry: CapabilityProviderRegistry,
): CapabilityProvider[] {
  return ids.flatMap((id) => {
    const p = registry.get(id);
    return p ? [p] : [];
  });
}

// ---------------------------------------------------------------------------
// External catalog sources (search-before-build). Default: none registered.
// ---------------------------------------------------------------------------

export interface CatalogSource {
  id: string;
  /** Returns UNTRUSTED normalized candidates only. */
  search(requirement: { kind: string }): Promise<CapabilityProvider[]>;
}

const catalogSources: CatalogSource[] = [];

/** Boot/configuration-time only; request paths can never register sources. */
export function registerCatalogSource(source: CatalogSource): void {
  if (!catalogSources.some((s) => s.id === source.id)) catalogSources.push(source);
}

export function listCatalogSources(): CatalogSource[] {
  return [...catalogSources];
}

/** Test-only reset. */
export function resetCatalogSources(): void {
  catalogSources.length = 0;
}

export async function searchExternalCatalogs(requirement: {
  kind: string;
}): Promise<{ candidates: CapabilityProvider[]; sourcesSearched: string[] }> {
  const sources = listCatalogSources();
  const results = await Promise.all(
    sources.map(async (source) => ({
      sourceId: source.id,
      candidates: await source.search(requirement),
    })),
  );
  return {
    candidates: results.flatMap((r) => r.candidates),
    sourcesSearched: results.map((r) => r.sourceId),
  };
}

// ---------------------------------------------------------------------------
// MCP compatibility boundary (normalization only — no SDK, no network)
// ---------------------------------------------------------------------------

export type McpToolMetadata = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] };
  outputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] };
  serverIdentity?: string;
  endpoint?: string;
  protocolVersion?: string;
};

function jsonSchemaToSpec(
  schema: McpToolMetadata["inputSchema"],
): TypedFieldSpec[] | undefined {
  if (!schema?.properties) return undefined;
  const required = new Set(schema.required ?? []);
  const typeMap: Record<string, TypedFieldSpec["type"]> = {
    string: "string",
    number: "number",
    integer: "number",
    boolean: "boolean",
    array: "array",
    object: "object",
  };
  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: typeMap[prop.type ?? ""] ?? "string",
    required: required.has(name),
  }));
}

/**
 * MCP tool metadata → UNTRUSTED provider candidate. Descriptions are data.
 * Normalization NEVER produces a TrustedCapability and never maps effectful
 * tool names (transfer/pay/...) onto trusted semantic capabilities; semantic
 * mapping is a separate deterministic step.
 */
export function normalizeMcpToolMetadata(
  raw: McpToolMetadata,
  jasimOptions?: { declaredSemantics?: string[] },
): CapabilityProvider {
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("MCP tool metadata requires a name.");
  }
  return {
    id: `mcp:${raw.serverIdentity ?? "unknown"}:${raw.name}`,
    kind: "MCP",
    capabilityId: undefined,
    implementationId: raw.name,
    protocol: "mcp",
    protocolVersion: raw.protocolVersion,
    trustClass: "UNTRUSTED_CANDIDATE",
    availability: { state: "UNKNOWN", observedAt: new Date() },
    costClass: "UNKNOWN",
    latencyClass: "UNKNOWN",
    inputSpec: jsonSchemaToSpec(raw.inputSchema),
    outputSpec: jsonSchemaToSpec(raw.outputSchema),
    description: raw.description,
    semanticKeys: jasimOptions?.declaredSemantics,
    ...(raw.endpoint ? { endpoint: raw.endpoint } : {}),
    provenance: { source: "MCP_CATALOG", reference: raw.endpoint ?? raw.serverIdentity },
    freshness: { discoveredAt: new Date() },
  };
}

// ---------------------------------------------------------------------------
// A2A compatibility boundary (metadata normalization only — no SDK, no network)
// ---------------------------------------------------------------------------

export type A2AAgentCardMetadata = {
  agentId: string;
  name?: string;
  providerIdentity?: string;
  endpoint?: string;
  protocolVersion?: string;
  skills?: Array<{
    id: string;
    description?: string;
    inputModes?: string[];
    outputModes?: string[];
    semantic?: string;
  }>;
  securityRequirements?: Record<string, unknown>;
  /**
   * Any authority/verification claims in a remote card are DATA. They can
   * never grant owner identity, JASIM permissions, approval, Trusted Executor
   * rights, VERIFIED authority, or DB access.
   */
  claims?: Record<string, unknown>;
};

/**
 * Agent Card → untrusted provider candidates (one per skill). Authority and
 * verification claims are discarded — trust is derived only from JASIM-side
 * configuration, never from remote metadata.
 */
export function normalizeAgentCardMetadata(raw: A2AAgentCardMetadata): CapabilityProvider[] {
  if (!raw.agentId || typeof raw.agentId !== "string") {
    throw new Error("Agent Card requires an agentId.");
  }
  const now = new Date();
  return (raw.skills ?? []).map((skill) => ({
    id: `a2a:${raw.agentId}:${skill.id}`,
    kind: "A2A" as const,
    capabilityId: undefined,
    implementationId: skill.id,
    protocol: "a2a",
    protocolVersion: raw.protocolVersion,
    trustClass: "UNTRUSTED_CANDIDATE" as const,
    availability: { state: "UNKNOWN" as const, observedAt: now },
    costClass: "UNKNOWN" as const,
    latencyClass: "UNKNOWN" as const,
    description: skill.description,
    semanticKeys: skill.semantic ? [skill.semantic] : undefined,
    ...(raw.endpoint ? { endpoint: raw.endpoint } : {}),
    provenance: { source: "A2A_AGENT_CARD" as const, reference: raw.endpoint ?? raw.agentId },
    freshness: { discoveredAt: now },
  }));
}

/**
 * Deterministic semantic mapping of an external candidate to a semantic
 * capability. Keyword-only matches are insufficient: the candidate must share
 * a normalized semantic purpose/alias/id with the capability, and the
 * capability must not be authority-bound or external-effectful (those never
 * accept remote implementations automatically).
 */
export function semanticMapCandidate(
  candidate: CapabilityProvider,
  capabilities: TrustedCapability[],
): TrustedCapability | undefined {
  // Exact JASIM-controlled semantic keys only. Free-text descriptions and
  // remote tool names are untrusted data and never serve as semantic proof.
  const keys = (candidate.semanticKeys ?? []).map(normalizeKey);
  if (keys.length === 0) return undefined;
  return capabilities.find((capability) => {
    if (capability.testOnly) return false;
    if (capability.effectClass === "external_effectful") return false;
    if (capability.authorityClass) return false;
    const targets = [
      capability.id,
      ...capability.aliases,
      ...(capability.semanticPurposes ?? []),
    ].map(normalizeKey);
    return targets.some((t) => keys.includes(t));
  });
}
