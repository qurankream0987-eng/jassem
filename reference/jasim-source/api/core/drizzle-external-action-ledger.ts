import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../queries/connection";
import { externalActionLedger } from "@db/schema";
import {
  ExternalActionRecordSchema,
  type BeginExternalActionInput,
  type ExternalActionLedger,
  type ExternalActionRecord,
  type ExternalActionStatus,
} from "@contracts/external-action";
import { externalActionId } from "./external-action-ledger";

export class DrizzleExternalActionLedger implements ExternalActionLedger {
  async begin(input: BeginExternalActionInput): Promise<ExternalActionRecord> {
    const id = externalActionId(input);
    const existing = await this.get(id);
    if (existing) {
      if (existing.inputDigest !== input.inputDigest) throw new Error("Idempotency key was reused with different inputs");
      return existing;
    }
    await db.insert(externalActionLedger).values({
      id,
      connectorId: input.connectorId,
      capabilityId: input.capabilityId,
      effect: input.effect,
      taskId: input.taskId,
      userId: input.userId,
      planId: input.planId,
      worldId: input.worldId,
      stepId: input.stepId,
      idempotencyKey: input.idempotencyKey,
      approvalId: input.approvalId,
      inputDigest: input.inputDigest,
      reconciliationData: input.reconciliationData,
      status: "prepared",
      attempts: 0,
    });
    const created = await this.get(id);
    if (!created) throw new Error("External action ledger insert failed");
    return created;
  }

  async get(id: string): Promise<ExternalActionRecord | undefined> {
    const row = await db.query.externalActionLedger.findFirst({ where: eq(externalActionLedger.id, id) });
    return row ? this.fromRow(row) : undefined;
  }

  async listDue(limit = 100, now = new Date()): Promise<ExternalActionRecord[]> {
    const rows = await db.select().from(externalActionLedger).where(and(
      inArray(externalActionLedger.status, ["uncertain", "reconciling"]),
      or(isNull(externalActionLedger.nextReconcileAt), lte(externalActionLedger.nextReconcileAt, now)),
    )).limit(limit);
    return rows.map((row) => this.fromRow(row));
  }

  async listForUser(userId: number, limit = 100): Promise<ExternalActionRecord[]> {
    const rows = await db.select().from(externalActionLedger)
      .where(eq(externalActionLedger.userId, userId))
      .orderBy(desc(externalActionLedger.createdAt))
      .limit(limit);
    return rows.map((row) => this.fromRow(row));
  }

  async listOpenForConnector(connectorId: string, limit = 100): Promise<ExternalActionRecord[]> {
    const rows = await db.select().from(externalActionLedger).where(and(
      eq(externalActionLedger.connectorId, connectorId),
      inArray(externalActionLedger.status, ["executing", "uncertain", "reconciling", "manual_review"]),
    )).orderBy(desc(externalActionLedger.createdAt)).limit(limit);
    return rows.map((row) => this.fromRow(row));
  }

  async transition(
    id: string,
    expected: ExternalActionStatus[],
    update: Partial<Pick<ExternalActionRecord, "status" | "providerReference" | "resultDigest" | "errorCode" | "attempts" | "nextReconcileAt">>,
  ): Promise<ExternalActionRecord> {
    const before = await this.get(id);
    if (!before || !expected.includes(before.status)) throw new Error(`External action ${id} changed concurrently`);
    const result = await db.update(externalActionLedger).set({
      ...update,
      nextReconcileAt: update.nextReconcileAt ? new Date(update.nextReconcileAt) : update.nextReconcileAt === undefined ? undefined : null,
      updatedAt: new Date(),
    }).where(and(eq(externalActionLedger.id, id), inArray(externalActionLedger.status, expected)));
    const header = Array.isArray(result) ? result[0] : result;
    const affected = (header as { affectedRows?: number } | undefined)?.affectedRows;
    if (affected !== undefined && affected !== 1) throw new Error(`External action ${id} changed concurrently`);
    const updated = await this.get(id);
    if (!updated) throw new Error(`External action ${id} was not updated`);
    return updated;
  }

  private fromRow(row: typeof externalActionLedger.$inferSelect): ExternalActionRecord {
    return ExternalActionRecordSchema.parse({
      ...row,
      reconciliationData: row.reconciliationData ?? {},
      providerReference: row.providerReference ?? undefined,
      resultDigest: row.resultDigest ?? undefined,
      errorCode: row.errorCode ?? undefined,
      worldId: row.worldId ?? undefined,
      approvalId: row.approvalId ?? undefined,
      nextReconcileAt: row.nextReconcileAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
