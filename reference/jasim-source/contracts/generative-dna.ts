/**
 * JASIM Generative DNA contracts.
 *
 * The kernel remains stable while it is serving traffic. New knowledge,
 * capabilities and even core improvements enter the system as versioned
 * candidates. Nothing in this contract authorizes a candidate to execute.
 */

import { z } from "zod";

export const GeneKindSchema = z.enum([
  "knowledge",
  "workflow",
  "capability",
  "policy",
  "ui",
  "world",
  "core_patch",
]);
export type GeneKind = z.infer<typeof GeneKindSchema>;

export const GeneStatusSchema = z.enum([
  "candidate",
  "evaluating",
  "approved",
  "canary",
  "active",
  "rejected",
  "retired",
]);
export type GeneStatus = z.infer<typeof GeneStatusSchema>;

export const GeneRiskSchema = z.enum(["none", "low", "medium", "high", "critical"]);
export type GeneRisk = z.infer<typeof GeneRiskSchema>;

export const ArtifactKindSchema = z.enum([
  "text",
  "source_code",
  "api_schema",
  "data_schema",
  "world_dna",
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const DNASourceSchema = z.object({
  artifactKind: ArtifactKindSchema,
  name: z.string().min(1),
  digest: z.string().min(16),
  submittedBy: z.string().min(1),
  uri: z.string().optional(),
  mediaType: z.string().optional(),
  license: z.string().optional(),
  ownerConsent: z.boolean().default(false),
  receivedAt: z.string().datetime(),
  contentIsDataOnly: z.literal(true),
});
export type DNASource = z.infer<typeof DNASourceSchema>;

export const GeneProposalSchema = z.object({
  kind: GeneKindSchema,
  name: z.string().min(2).max(160),
  summary: z.string().min(1).max(2000),
  specification: z.record(z.string(), z.unknown()).default({}),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  executorRef: z.string().min(1).optional(),
  dependencies: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  risk: GeneRiskSchema.default("low"),
  tags: z.array(z.string()).default([]),
});
export type GeneProposal = z.infer<typeof GeneProposalSchema>;

export const GeneEvaluationSchema = z.object({
  id: z.string(),
  evaluator: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    details: z.string().optional(),
  })),
  evidence: z.array(z.string()).default([]),
  evaluatedAt: z.string().datetime(),
});
export type GeneEvaluation = z.infer<typeof GeneEvaluationSchema>;

export const GeneCandidateSchema = z.object({
  id: z.string(),
  proposal: GeneProposalSchema,
  source: DNASourceSchema,
  status: GeneStatusSchema,
  warnings: z.array(z.string()),
  evaluations: z.array(GeneEvaluationSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectionReason: z.string().optional(),
});
export type GeneCandidate = z.infer<typeof GeneCandidateSchema>;

export const GeneFitnessSchema = z.object({
  executions: z.number().int().nonnegative(),
  verifiedSuccesses: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative(),
  averageCost: z.number().nonnegative(),
  safetyIncidents: z.number().int().nonnegative(),
  score: z.number().min(0).max(1),
});
export type GeneFitness = z.infer<typeof GeneFitnessSchema>;

export const GeneVersionSchema = z.object({
  id: z.string(),
  geneId: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  proposal: GeneProposalSchema,
  source: DNASourceSchema,
  status: z.enum(["canary", "active", "retired"]),
  lineage: z.object({
    parentVersionIds: z.array(z.string()).default([]),
    candidateId: z.string(),
  }),
  fitness: GeneFitnessSchema,
  activatedBy: z.string(),
  activatedAt: z.string().datetime(),
});
export type GeneVersion = z.infer<typeof GeneVersionSchema>;

export const GenomeSnapshotSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  geneVersionIds: z.array(z.string()),
  digest: z.string(),
});
export type GenomeSnapshot = z.infer<typeof GenomeSnapshotSchema>;

export const AssimilationArtifactSchema = z.object({
  artifactKind: ArtifactKindSchema,
  name: z.string().min(1),
  content: z.string().min(1),
  submittedBy: z.string().min(1),
  uri: z.string().optional(),
  mediaType: z.string().optional(),
  license: z.string().optional(),
  ownerConsent: z.boolean().default(false),
  requestedKind: GeneKindSchema.optional(),
});
export type AssimilationArtifact = z.input<typeof AssimilationArtifactSchema>;

export interface AssimilationResult {
  candidate: GeneCandidate;
  duplicate: boolean;
  detectedSymbols: string[];
  warnings: string[];
}



