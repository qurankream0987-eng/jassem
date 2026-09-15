import type { ConnectorHealthMonitor } from "./connector-health-monitor";
import type { ExternalActionReconciler } from "./external-action-reconciler";

export interface ExternalReliabilityWorkerOptions {
  reconciliationIntervalMs?: number;
  healthIntervalMs?: number;
  onError?: (phase: "reconciliation" | "health", error: unknown) => void;
}

export class ExternalReliabilityWorker {
  private reconciliationTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private reconciliationRunning = false;
  private healthRunning = false;

  constructor(
    private readonly reconciler: ExternalActionReconciler,
    private readonly health: ConnectorHealthMonitor,
    private readonly options: ExternalReliabilityWorkerOptions = {},
  ) {}

  start(): void {
    if (this.reconciliationTimer || this.healthTimer) return;
    const reconciliationInterval = Math.max(this.options.reconciliationIntervalMs ?? 30_000, 5_000);
    const healthInterval = Math.max(this.options.healthIntervalMs ?? 5 * 60_000, 30_000);
    this.reconciliationTimer = setInterval(() => void this.runReconciliation(), reconciliationInterval);
    this.healthTimer = setInterval(() => void this.runHealth(), healthInterval);
    this.reconciliationTimer.unref();
    this.healthTimer.unref();
    void this.runReconciliation();
  }

  stop(): void {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.reconciliationTimer = undefined;
    this.healthTimer = undefined;
  }

  private async runReconciliation(): Promise<void> {
    if (this.reconciliationRunning) return;
    this.reconciliationRunning = true;
    try {
      await this.reconciler.runDue();
    } catch (error) {
      this.options.onError?.("reconciliation", error);
    } finally {
      this.reconciliationRunning = false;
    }
  }

  private async runHealth(): Promise<void> {
    if (this.healthRunning) return;
    this.healthRunning = true;
    try {
      await this.health.runOnce();
    } catch (error) {
      this.options.onError?.("health", error);
    } finally {
      this.healthRunning = false;
    }
  }
}
