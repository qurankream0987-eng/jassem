import { z } from "zod";
import { RuntimeInputFieldSchema } from "./runtime-connector";

export const GeneratedExecutionStatusSchema = z.enum([
  "running",
  "waiting_approval",
  "waiting_input",
  "completed",
  "failed",
  "rejected",
]);

export type GeneratedExecutionStatus = z.infer<typeof GeneratedExecutionStatusSchema>;

export const GeneratedInvocationSchema = z.object({
  idempotencyKey: z.string(),
  stepId: z.string(),
  capabilityId: z.string(),
  inputDigest: z.string(),
  status: z.enum(["executing", "succeeded", "failed", "uncertain"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type GeneratedInvocation = z.infer<typeof GeneratedInvocationSchema>;

export const GeneratedApprovalTicketSchema = z.object({
  id: z.string(),
  taskId: z.number().int().positive(),
  planId: z.string(),
  stepId: z.string(),
  capabilityId: z.string(),
  title: z.string(),
  risk: z.enum(["none", "low", "medium", "high", "critical"]),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  authorizedStepIds: z.array(z.string()).default([]),
  requestedBy: z.number().int().positive(),
  decidedBy: z.number().int().positive().optional(),
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export type GeneratedApprovalTicket = z.infer<typeof GeneratedApprovalTicketSchema>;

export const GeneratedInputRequestSchema = z.object({
  id: z.string().min(1),
  taskId: z.number().int().positive(),
  planId: z.string().min(1),
  stepId: z.string().min(1),
  capabilityId: z.string().min(1),
  connectorId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  submitLabel: z.string().default("متابعة"),
  fields: z.array(RuntimeInputFieldSchema).min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type GeneratedInputRequest = z.infer<typeof GeneratedInputRequestSchema>;

export const GeneratedCollectedInputSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
  secretRef: z.string().optional(),
  requestId: z.string(),
});

export const GeneratedExecutionCheckpointSchema = z.object({
  executionKey: z.string(),
  taskId: z.number().int().positive(),
  userId: z.number().int().positive(),
  planId: z.string(),
  worldId: z.string().optional(),
  status: GeneratedExecutionStatusSchema,
  completedSteps: z.array(z.string()).default([]),
  results: z.record(z.string(), z.unknown()).default({}),
  invocations: z.record(z.string(), GeneratedInvocationSchema).default({}),
  authorizedSteps: z.record(z.string(), z.string()).default({}),
  collectedInputs: z.record(z.string(), GeneratedCollectedInputSchema).default({}),
  pendingApprovalId: z.string().optional(),
  pendingStepId: z.string().optional(),
  pendingInput: GeneratedInputRequestSchema.optional(),
  error: z.string().optional(),
  revision: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type GeneratedExecutionCheckpoint = z.infer<typeof GeneratedExecutionCheckpointSchema>;

export interface GeneratedPlanExecutionResult {
  status: GeneratedExecutionStatus;
  executionKey: string;
  results: Record<string, unknown>;
  completedSteps: string[];
  pendingAction?: {
    approvalId: string;
    stepId: string;
    title: string;
    risk: string;
    authorizedStepIds: string[];
    expiresAt?: string;
  };
  pendingInput?: GeneratedInputRequest & {
    bubble: {
      id: string;
      type: "form";
      title: string;
      subtitle?: string;
      layout: { width: "full"; rtl: boolean };
      data: Record<string, unknown>;
      actions: Array<Record<string, unknown>>;
      trust: { level: "system"; verified: true; badges: string[] };
      version: string;
      metadata: Record<string, unknown>;
    };
  };
  blockedSteps?: string[];
  error?: string;
}
