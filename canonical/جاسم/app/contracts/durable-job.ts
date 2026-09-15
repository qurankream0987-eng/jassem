/**
 * Domain-neutral durable work contract.
 *
 * `kind` is intentionally an open, versioned identifier. JASIM must be able to
 * schedule a future capability without adding a domain-specific enum or table.
 */
import { z } from "zod";
import { ImmutableArtifactSchema, Sha256DigestSchema } from "./immutable-artifact";

export const DurableJobKindSchema = z.string()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);
export type DurableJobKind = z.infer<typeof DurableJobKindSchema>;

export const DurableJobStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "quarantined",
]);
export type DurableJobStatus = z.infer<typeof DurableJobStatusSchema>;

export const TerminalDurableJobStatuses = new Set<DurableJobStatus>([
  "succeeded", "failed", "timed_out", "cancelled", "quarantined",
]);

export const DurableJobSchema = z.object({
  id: z.string().min(1).max(100),
  kind: DurableJobKindSchema,
  subjectType: z.string().min(1).max(100),
  subjectId: z.string().min(1).max(160),
  payloadSchemaVersion: z.number().int().positive(),
  payload: ImmutableArtifactSchema,
  idempotencyKey: z.string().min(8).max(200),
  status: DurableJobStatusSchema,
  priority: z.number().int().min(-100).max(100).default(0),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1).max(20),
  timeoutMs: z.number().int().min(1_000).max(30 * 60_000),
  availableAt: z.string().datetime(),
  leaseOwner: z.string().min(1).max(160).nullable(),
  leaseToken: z.string().min(32).max(160).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  cancellationRequestedAt: z.string().datetime().nullable(),
  result: ImmutableArtifactSchema.nullable(),
  errorCode: z.string().min(1).max(160).nullable(),
  errorSummary: z.string().min(1).max(2000).nullable(),
  revision: z.number().int().nonnegative(),
  createdBy: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type DurableJob = z.infer<typeof DurableJobSchema>;

export const CreateDurableJobSchema = z.object({
  kind: DurableJobKindSchema,
  subjectType: z.string().min(1).max(100),
  subjectId: z.string().min(1).max(160),
  payloadSchemaVersion: z.number().int().positive(),
  payload: ImmutableArtifactSchema,
  idempotencyKey: z.string().min(8).max(200),
  priority: z.number().int().min(-100).max(100).default(0),
  maxAttempts: z.number().int().min(1).max(20).default(3),
  timeoutMs: z.number().int().min(1_000).max(30 * 60_000).default(10 * 60_000),
  availableAt: z.string().datetime().optional(),
  createdBy: z.string().min(1).max(100),
});
export type CreateDurableJob = z.input<typeof CreateDurableJobSchema>;

export const DurableJobEventTypeSchema = z.enum([
  "created", "claimed", "started", "heartbeat", "retry_scheduled",
  "succeeded", "failed", "timed_out", "cancel_requested", "cancelled",
  "lease_recovered", "quarantined",
]);

export const DurableJobEventSchema = z.object({
  id: z.string().min(1).max(100),
  jobId: z.string().min(1).max(100),
  type: DurableJobEventTypeSchema,
  actor: z.string().min(1).max(160),
  previousStatus: DurableJobStatusSchema.nullable(),
  nextStatus: DurableJobStatusSchema,
  detail: z.record(z.string(), z.unknown()).default({}),
  previousEventDigest: Sha256DigestSchema.nullable(),
  eventDigest: Sha256DigestSchema,
  createdAt: z.string().datetime(),
});
export type DurableJobEvent = z.infer<typeof DurableJobEventSchema>;

export const ClaimedDurableJobSchema = z.object({
  job: DurableJobSchema,
  leaseToken: z.string().min(32),
});
export type ClaimedDurableJob = z.infer<typeof ClaimedDurableJobSchema>;
