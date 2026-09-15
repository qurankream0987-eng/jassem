import { z } from "zod";
import { DurableJobStatusSchema } from "./durable-job";
import { CoreLabEvaluationReportSchema } from "./core-evolution";
import { ImmutableArtifactSchema } from "./immutable-artifact";

export const CORE_EVOLUTION_EVALUATION_JOB_KIND = "core_evolution.evaluate" as const;

export const CoreLabJobViewSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.literal(CORE_EVOLUTION_EVALUATION_JOB_KIND),
  candidateId: z.string().min(1).max(100),
  status: DurableJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  cancellationRequested: z.boolean(),
  result: ImmutableArtifactSchema.nullable(),
  errorCode: z.string().nullable(),
  errorSummary: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type CoreLabJobView = z.infer<typeof CoreLabJobViewSchema>;

export const CoreLabJobSubmissionSchema = z.object({ job: CoreLabJobViewSchema });
export const CoreLabJobReportResponseSchema = z.object({
  job: CoreLabJobViewSchema,
  report: CoreLabEvaluationReportSchema,
});
