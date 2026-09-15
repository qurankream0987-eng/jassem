import type { RuntimeConnectorRegistry } from "./runtime-connector-registry";

export interface ConnectorHealthRun {
  connectorId: string;
  healthy: boolean;
  latencyMs: number;
  reason?: string;
}

export class ConnectorHealthMonitor {
  constructor(private readonly registry: RuntimeConnectorRegistry) {}

  async runOnce(): Promise<ConnectorHealthRun[]> {
    const probeable = this.registry.list().filter((connector) => connector.manifest.enabled && connector.probeHealth);
    return Promise.all(probeable.map(async (connector) => {
      const started = Date.now();
      try {
        const probe = await connector.probeHealth!();
        if (probe.healthy) this.registry.recordSuccess(connector.manifest.id);
        else this.registry.recordFailure(connector.manifest.id, { countsTowardCircuit: true });
        return { connectorId: connector.manifest.id, ...probe };
      } catch {
        const latencyMs = Date.now() - started;
        this.registry.recordFailure(connector.manifest.id, { countsTowardCircuit: true });
        return { connectorId: connector.manifest.id, healthy: false, latencyMs, reason: "probe_failed" };
      }
    }));
  }
}
