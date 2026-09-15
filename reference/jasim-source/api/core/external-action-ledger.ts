import { createHash } from "node:crypto";
import {
  ExternalActionRecordSchema,
  type BeginExternalActionInput,
  type ExternalActionLedger,
  type ExternalActionRecord,
  type ExternalActionStatus,
} from "@contracts/external-action";

const nowIso = () => new Date().toISOString();

export function externalActionId(input: Pick<BeginExternalActionInput, "connectorId" | "idempotencyKey">): string {
  return createHash("sha256").update(`${input.connectorId}:${input.idempotencyKey}`).digest("hex");
}

export class MemoryExternalActionLedger implements ExternalActionLedger {
  private readonly records = new Map<string, ExternalActionRecord>();

  async begin(input: BeginExternalActionInput): Promise<ExternalActionRecord> {
    const id = externalActionId(input);
    const existing = this.records.get(id);
    if (existing) {
      if (existing.inputDigest !== input.inputDigest) throw new Error("Idempotency key was reused with different inputs");
      return structuredClone(existing);
    }
    const at = nowIso();
    const record = ExternalActionRecordSchema.parse({
      id,
      ...input,
      status: "prepared",
      attempts: 0,
      createdAt: at,
      updatedAt: at,
    });
    this.records.set(id, record);
    return structuredClone(record);
  }

  async get(id: string): Promise<ExternalActionRecord | undefined> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async listDue(limit = 100, now = new Date()): Promise<ExternalActionRecord[]> {
    return [...this.records.values()]
      .filter((record) => ["uncertain", "reconciling"].includes(record.status))
      .filter((record) => !record.nextReconcileAt || new Date(record.nextReconcileAt) <= now)
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async listForUser(userId: number, limit = 100): Promise<ExternalActionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async listOpenForConnector(connectorId: string, limit = 100): Promise<ExternalActionRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.connectorId === connectorId)
      .filter((record) => ["executing", "uncertain", "reconciling", "manual_review"].includes(record.status))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async transition(
    id: string,
    expected: ExternalActionStatus[],
    update: Partial<Pick<ExternalActionRecord, "status" | "providerReference" | "resultDigest" | "errorCode" | "attempts" | "nextReconcileAt">>,
  ): Promise<ExternalActionRecord> {
    const existing = this.records.get(id);
    if (!existing || !expected.includes(existing.status)) throw new Error(`External action ${id} changed concurrently`);
    const record = ExternalActionRecordSchema.parse({ ...existing, ...update, updatedAt: nowIso() });
    this.records.set(id, record);
    return structuredClone(record);
  }
}
