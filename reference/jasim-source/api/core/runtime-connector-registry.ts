import {
  RuntimeConnectorManifestSchema,
  type ConnectorCandidate,
  type ConnectorDiscoveryRequest,
  type RuntimeConnector,
} from "@contracts/runtime-connector";

const TRUST_WEIGHT = { unverified: 0, reviewed: 8, verified: 16, system: 22 } as const;
const HEALTH_WEIGHT = { offline: -100, degraded: 2, healthy: 10 } as const;
const COST_PENALTY = { free: 0, low: 2, medium: 6, high: 12 } as const;

export interface ConnectorRuntimeHealth {
  status: "healthy" | "degraded" | "open";
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  openUntil?: string;
}

export interface RuntimeConnectorRegistryOptions {
  failureThreshold?: number;
  circuitOpenMs?: number;
  now?: () => number;
}

export class RuntimeConnectorRegistry {
  private readonly connectors = new Map<string, RuntimeConnector>();
  private readonly runtimeHealth = new Map<string, ConnectorRuntimeHealth>();
  private readonly failureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly now: () => number;

  constructor(options: RuntimeConnectorRegistryOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.circuitOpenMs = options.circuitOpenMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  register(connector: RuntimeConnector): void {
    const manifest = RuntimeConnectorManifestSchema.parse(connector.manifest);
    if (this.connectors.has(manifest.id)) throw new Error(`Connector ${manifest.id} is already registered`);
    const registered: RuntimeConnector = {
      manifest,
      execute: connector.execute.bind(connector),
    };
    if (connector.inputRequirements) registered.inputRequirements = connector.inputRequirements.bind(connector);
    if (connector.reconciliationData) registered.reconciliationData = connector.reconciliationData.bind(connector);
    if (connector.providerReference) registered.providerReference = connector.providerReference.bind(connector);
    if (connector.reconcile) registered.reconcile = connector.reconcile.bind(connector);
    if (connector.probeHealth) registered.probeHealth = connector.probeHealth.bind(connector);
    this.connectors.set(manifest.id, registered);
    this.runtimeHealth.set(manifest.id, { status: "healthy", consecutiveFailures: 0 });
  }

  unregister(connectorId: string): boolean {
    this.runtimeHealth.delete(connectorId);
    return this.connectors.delete(connectorId);
  }

  list(): RuntimeConnector[] {
    return [...this.connectors.values()];
  }

  get(connectorId: string): RuntimeConnector | undefined {
    return this.connectors.get(connectorId);
  }

  health(connectorId: string): ConnectorRuntimeHealth | undefined {
    const current = this.runtimeHealth.get(connectorId);
    if (!current) return undefined;
    if (current.status === "open" && current.openUntil && Date.parse(current.openUntil) <= this.now()) {
      const halfOpen = { ...current, status: "degraded" as const, openUntil: undefined };
      this.runtimeHealth.set(connectorId, halfOpen);
      return { ...halfOpen };
    }
    return { ...current };
  }

  recordSuccess(connectorId: string): void {
    if (!this.connectors.has(connectorId)) return;
    this.runtimeHealth.set(connectorId, {
      status: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: new Date(this.now()).toISOString(),
    });
  }

  recordFailure(connectorId: string, error?: unknown): void {
    if (!this.connectors.has(connectorId)) return;
    if (error && typeof error === "object" && "countsTowardCircuit" in error &&
      (error as { countsTowardCircuit?: unknown }).countsTowardCircuit === false) return;
    const previous = this.runtimeHealth.get(connectorId) ?? { status: "healthy", consecutiveFailures: 0 };
    const consecutiveFailures = previous.consecutiveFailures + 1;
    const opened = consecutiveFailures >= this.failureThreshold;
    this.runtimeHealth.set(connectorId, {
      ...previous,
      status: opened ? "open" : "degraded",
      consecutiveFailures,
      lastFailureAt: new Date(this.now()).toISOString(),
      openUntil: opened ? new Date(this.now() + this.circuitOpenMs).toISOString() : undefined,
    });
  }

  discover(request: ConnectorDiscoveryRequest): ConnectorCandidate[] {
    const preferredScopes = request.preferredScopes ?? [];
    const permissions = new Set(request.grantedPermissions ?? []);
    const minimumTrust = request.minimumTrustScore ?? 0.5;

    return this.list().flatMap((connector): ConnectorCandidate[] => {
      const manifest = connector.manifest;
      const runtimeHealth = this.health(manifest.id);
      if (!manifest.enabled || manifest.health.status === "offline") return [];
      if (runtimeHealth?.status === "open") return [];
      if (!manifest.capabilities.includes(request.capabilityId)) return [];
      if (manifest.trust.score < minimumTrust) return [];
      if (manifest.requiredPermissions.some((permission) => !permissions.has(permission))) return [];
      if (["write", "external_change", "financial"].includes(manifest.effect) && !request.approvalGranted) return [];
      if (manifest.sendsUserDataExternally && !request.allowExternalData) return [];
      if (preferredScopes.length > 0 && !manifest.scopes.some((scope) => preferredScopes.includes(scope))) return [];

      const scopeMatches = manifest.scopes.filter((scope) => preferredScopes.includes(scope)).length;
      const reasons = [
        `trust:${manifest.trust.level}`,
        `health:${runtimeHealth?.status ?? manifest.health.status}`,
        ...(scopeMatches > 0 ? [`scope_matches:${scopeMatches}`] : []),
      ];
      const score = Math.round((
        manifest.trust.score * 45 +
        TRUST_WEIGHT[manifest.trust.level] +
        HEALTH_WEIGHT[runtimeHealth?.status === "degraded" ? "degraded" : manifest.health.status] +
        manifest.priority / 5 +
        scopeMatches * 8 -
        COST_PENALTY[manifest.costClass] -
        Math.min(manifest.estimatedLatencyMs / 1000, 10)
      ) * 100) / 100;
      return [{ connector, score, reasons }];
    }).sort((left, right) => right.score - left.score || left.connector.manifest.id.localeCompare(right.connector.manifest.id));
  }
}
