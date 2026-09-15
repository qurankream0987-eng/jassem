import { z } from "zod";
import { ConnectorEffectSchema } from "./runtime-connector";

export const ExternalActionStatusSchema = z.enum([
  "prepared",
  "executing",
  "succeeded",
  "failed",
  "uncertain",
  "reconciling",
  "manual_review",
]);

export type ExternalActionStatus = z.infer<typeof ExternalActionStatusSchema>;

export const ExternalActionRecordSchema = z.object({
  id: z.string().min(1),
  connectorId: z.string().min(1),
  capabilityId: z.string().min(1),
  effect: ConnectorEffectSchema,
  taskId: z.number().int().positive(),
  userId: z.number().int().positive(),
  planId: z.string().min(1),
  worldId: z.string().optional(),
  stepId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  approvalId: z.string().optional(),
  inputDigest: z.string().min(1),
  reconciliationData: z.record(z.string(), z.unknown()).default({}),
  status: ExternalActionStatusSchema,
  providerReference: z.string().optional(),
  resultDigest: z.string().optional(),
  errorCode: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  nextReconcileAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ExternalActionRecord = z.infer<typeof ExternalActionRecordSchema>;

export interface BeginExternalActionInput {
  connectorId: string;
  capabilityId: string;
  effect: z.infer<typeof ConnectorEffectSchema>;
  taskId: number;
  userId: number;
  planId: string;
  worldId?: string;
  stepId: string;
  idempotencyKey: string;
  approvalId?: string;
  inputDigest: string;
  reconciliationData: Record<string, unknown>;
}

export interface ExternalActionLedger {
  begin(input: BeginExternalActionInput): Promise<ExternalActionRecord>;
  get(id: string): Promise<ExternalActionRecord | undefined>;
  listDue(limit?: number, now?: Date): Promise<ExternalActionRecord[]>;
  listForUser(userId: number, limit?: number): Promise<ExternalActionRecord[]>;
  listOpenForConnector(connectorId: string, limit?: number): Promise<ExternalActionRecord[]>;
  transition(
    id: string,
    expected: ExternalActionStatus[],
    update: Partial<Pick<ExternalActionRecord,
      "status" | "providerReference" | "resultDigest" | "errorCode" |
      "attempts" | "nextReconcileAt">>,
  ): Promise<ExternalActionRecord>;
}
