import { createHash } from "node:crypto";
import type { ExternalActionLedger, ExternalActionRecord } from "@contracts/external-action";
import type { RuntimeConnectorRegistry } from "./runtime-connector-registry";

export interface ReconciliationRunResult {
  checked: number;
  succeeded: number;
  failed: number;
  pending: number;
  manualReview: number;
}

export class ExternalActionReconciler {
  constructor(
    private readonly ledger: ExternalActionLedger,
    private readonly connectors: RuntimeConnectorRegistry,
    private readonly maxAttempts = 5,
    private readonly now: () => number = Date.now,
  ) {}

  async runDue(limit = 100): Promise<ReconciliationRunResult> {
    const records = await this.ledger.listDue(limit, new Date(this.now()));
    const summary: ReconciliationRunResult = { checked: records.length, succeeded: 0, failed: 0, pending: 0, manualReview: 0 };
    for (const record of records) {
      const outcome = await this.reconcileRecord(record);
      summary[outcome] += 1;
    }
    return summary;
  }

  /** Runs a provider status probe for one user-owned action. It never replays the side effect. */
  async reconcileById(id: string, userId: number): Promise<ExternalActionRecord> {
    let record = await this.ledger.get(id);
    if (!record || record.userId !== userId) throw new Error("External action not found");
    if (!["uncertain", "reconciling", "manual_review"].includes(record.status)) {
      throw new Error("External action does not require reconciliation");
    }
    if (record.status === "manual_review") {
      record = await this.ledger.transition(record.id, ["manual_review"], {
        status: "uncertain",
        attempts: 0,
        nextReconcileAt: new Date(this.now()).toISOString(),
        errorCode: "user_requested_probe",
      });
    }
    await this.reconcileRecord(record);
    const updated = await this.ledger.get(id);
    if (!updated) throw new Error("External action disappeared during reconciliation");
    return updated;
  }

  private async reconcileRecord(record: ExternalActionRecord): Promise<"succeeded" | "failed" | "pending" | "manualReview"> {
    const connector = this.connectors.get(record.connectorId);
    if (!connector?.reconcile) {
      await this.ledger.transition(record.id, ["uncertain", "reconciling"], {
        status: "manual_review",
        errorCode: "reconciliation_not_supported",
        nextReconcileAt: undefined,
      });
      return "manualReview";
    }

    const attempts = record.attempts + 1;
    await this.ledger.transition(record.id, ["uncertain", "reconciling"], {
      status: "reconciling",
      attempts,
      nextReconcileAt: undefined,
    });
    try {
      const result = await connector.reconcile(record.reconciliationData, {
        taskId: record.taskId,
        userId: record.userId,
        planId: record.planId,
        worldId: record.worldId,
        stepId: record.stepId,
        idempotencyKey: record.idempotencyKey,
        approvalId: record.approvalId,
      });
      if (result.status === "confirmed_success") {
        await this.ledger.transition(record.id, ["reconciling"], {
          status: "succeeded",
          providerReference: result.providerReference,
          resultDigest: this.digest(result.result),
          errorCode: undefined,
        });
        return "succeeded";
      }
      if (result.status === "confirmed_failure") {
        await this.ledger.transition(record.id, ["reconciling"], {
          status: "failed",
          providerReference: result.providerReference,
          errorCode: result.reason ?? "provider_confirmed_failure",
        });
        return "failed";
      }
      if (attempts >= this.maxAttempts) {
        await this.ledger.transition(record.id, ["reconciling"], {
          status: "manual_review",
          errorCode: result.status === "not_found" ? "provider_record_not_found" : "reconciliation_exhausted",
        });
        return "manualReview";
      }
      await this.defer(record.id, attempts, result.status);
      return "pending";
    } catch {
      if (attempts >= this.maxAttempts) {
        await this.ledger.transition(record.id, ["reconciling"], {
          status: "manual_review",
          errorCode: "reconciliation_transport_exhausted",
        });
        return "manualReview";
      }
      await this.defer(record.id, attempts, "probe_failed");
      return "pending";
    }
  }

  private async defer(id: string, attempts: number, reason: string): Promise<void> {
    const delayMs = Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
    await this.ledger.transition(id, ["reconciling"], {
      status: "uncertain",
      errorCode: reason,
      nextReconcileAt: new Date(this.now() + delayMs).toISOString(),
    });
  }

  private digest(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
}
