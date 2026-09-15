/**
 * Contracts for changes to JASIM's serving kernel.
 *
 * A core patch is never a runtime DNA version. It remains inert until the
 * isolated Core Evolution Lab produces a signed release and a human approves
 * a canary. These contracts deliberately model that separate lifecycle.
 */

import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const KernelBaselineStatusSchema = z.enum(["active", "superseded"]);
export type KernelBaselineStatus = z.infer<typeof KernelBaselineStatusSchema>;

export const KernelBaselineSchema = z.object({
  id: z.string().min(1).max(100),
  version: SemverSchema,
  kernelDigest: Sha256Schema,
  manifestDigest: Sha256Schema,
  testSuiteDigest: Sha256Schema,
  artifactRef: z.string().min(1).max(500).optional(),
  status: KernelBaselineStatusSchema.default("active"),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdBy: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
});
export type KernelBaseline = z.infer<typeof KernelBaselineSchema>;

export const KernelArtifactRoleSchema = z.enum(["kernel", "manifest", "test"]);
export type KernelArtifactRole = z.infer<typeof KernelArtifactRoleSchema>;

export const KernelArtifactSchema = z.object({
  path: z.string().min(1).max(500),
  role: KernelArtifactRoleSchema,
  digest: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
});
export type KernelArtifact = z.infer<typeof KernelArtifactSchema>;

export const KernelBaselineManifestSchema = z.object({
  formatVersion: z.literal(1),
  version: SemverSchema,
  rootLabel: z.string().min(1).max(160),
  artifacts: z.array(KernelArtifactSchema).min(1),
  kernelDigest: Sha256Schema,
  testSuiteDigest: Sha256Schema,
  manifestDigest: Sha256Schema,
  generatedAt: z.string().datetime(),
});
export type KernelBaselineManifest = z.infer<typeof KernelBaselineManifestSchema>;

export const CorePatchStatusSchema = z.enum([
  "submitted",
  "evaluating",
  "rejected",
  "approved_for_build",
  "built",
  "signed",
  "shadow",
  "canary",
  "active",
  "rolled_back",
  "quarantined",
]);
export type CorePatchStatus = z.infer<typeof CorePatchStatusSchema>;

export const CorePatchGateNameSchema = z.enum([
  "static_validation",
  "compile",
  "unit",
  "integration",
  "schema",
  "migration",
  "replay",
  "security",
  "performance",
  "cost",
  "reproducible_build",
]);
export type CorePatchGateName = z.infer<typeof CorePatchGateNameSchema>;

export const RequiredCorePatchGates: CorePatchGateName[] = [
  "static_validation",
  "compile",
  "unit",
  "integration",
  "schema",
  "migration",
  "replay",
  "security",
  "performance",
  "cost",
  "reproducible_build",
];

export const CorePatchGateResultSchema = z.object({
  gate: CorePatchGateNameSchema,
  passed: z.boolean(),
  evaluator: z.string().min(1).max(160),
  summary: z.string().min(1).max(4000),
  evidenceRefs: z.array(z.string().min(1).max(500)).default([]),
  metrics: z.record(z.string(), z.number()).default({}),
  completedAt: z.string().datetime(),
});
export type CorePatchGateResult = z.infer<typeof CorePatchGateResultSchema>;

export const CorePatchCandidateSchema = z.object({
  id: z.string().min(1).max(100),
  dnaCandidateId: z.string().min(1).max(100),
  baseBaselineId: z.string().min(1).max(100),
  targetVersion: SemverSchema,
  sourceDigest: Sha256Schema,
  title: z.string().min(2).max(200),
  summary: z.string().min(1).max(4000),
  risk: z.literal("critical"),
  status: CorePatchStatusSchema,
  scope: z.array(z.string().min(1).max(500)).min(1),
  declaredEffects: z.array(z.string().min(1).max(500)).default([]),
  testPlan: z.array(z.string().min(1).max(1000)).min(1),
  rollbackPlan: z.array(z.string().min(1).max(1000)).min(1),
  requiredGates: z.array(CorePatchGateNameSchema).min(1),
  gateResults: z.array(CorePatchGateResultSchema).default([]),
  createdBy: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CorePatchCandidate = z.infer<typeof CorePatchCandidateSchema>;

export const SubmitCorePatchSchema = CorePatchCandidateSchema.pick({
  dnaCandidateId: true,
  baseBaselineId: true,
  targetVersion: true,
  sourceDigest: true,
  title: true,
  summary: true,
  scope: true,
  declaredEffects: true,
  testPlan: true,
  rollbackPlan: true,
  createdBy: true,
}).extend({
  requiredGates: z.array(CorePatchGateNameSchema).min(1).default(RequiredCorePatchGates),
});
export type SubmitCorePatch = z.input<typeof SubmitCorePatchSchema>;

export const CorePatchEventSchema = z.object({
  id: z.string().min(1).max(100),
  candidateId: z.string().min(1).max(100),
  eventType: z.enum(["submitted", "gate_recorded", "transitioned"]),
  previousStatus: CorePatchStatusSchema.optional(),
  nextStatus: CorePatchStatusSchema,
  actor: z.string().min(1).max(100),
  evidence: z.record(z.string(), z.unknown()).default({}),
  eventDigest: Sha256Schema,
  createdAt: z.string().datetime(),
});
export type CorePatchEvent = z.infer<typeof CorePatchEventSchema>;

export const CoreReplayStatusSchema = z.enum([
  "completed",
  "waiting_approval",
  "waiting_input",
  "failed",
  "uncertain",
]);

export const CoreReplayObservationSchema = z.object({
  status: CoreReplayStatusSchema,
  outcomeDigest: Sha256Schema.optional(),
  evidenceDigest: Sha256Schema.optional(),
  sideEffectDigest: Sha256Schema.optional(),
  latencyMs: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  safetyIncidents: z.number().int().nonnegative(),
  approvalsRequired: z.number().int().nonnegative(),
});
export type CoreReplayObservation = z.infer<typeof CoreReplayObservationSchema>;

export const CoreReplayCaseSchema = z.object({
  id: z.string().min(1).max(160),
  goalDigest: Sha256Schema,
  baseline: CoreReplayObservationSchema,
  candidate: CoreReplayObservationSchema,
  expectations: z.object({
    requiredStatus: CoreReplayStatusSchema.optional(),
    allowOutcomeChange: z.boolean().default(false),
    allowSideEffectChange: z.boolean().default(false),
    requireEvidence: z.boolean().default(true),
    maxLatencyRatio: z.number().positive().max(10).default(1.25),
    maxCostRatio: z.number().positive().max(10).default(1.25),
    maxSafetyIncidents: z.number().int().nonnegative().default(0),
  }).default({
    allowOutcomeChange: false,
    allowSideEffectChange: false,
    requireEvidence: true,
    maxLatencyRatio: 1.25,
    maxCostRatio: 1.25,
    maxSafetyIncidents: 0,
  }),
});
export type CoreReplayCase = z.infer<typeof CoreReplayCaseSchema>;

export const CoreReplayFixtureSchema = CoreReplayCaseSchema.omit({ candidate: true });
export type CoreReplayFixture = z.infer<typeof CoreReplayFixtureSchema>;

export const CoreReplayCaseResultSchema = z.object({
  caseId: z.string(),
  passed: z.boolean(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), details: z.string() })),
});
export type CoreReplayCaseResult = z.infer<typeof CoreReplayCaseResultSchema>;

export const CoreReplayReportSchema = z.object({
  passed: z.boolean(),
  total: z.number().int().nonnegative(),
  passedCases: z.number().int().nonnegative(),
  failedCases: z.number().int().nonnegative(),
  results: z.array(CoreReplayCaseResultSchema),
});
export type CoreReplayReport = z.infer<typeof CoreReplayReportSchema>;

export const CoreLabResourcePolicySchema = z.object({
  timeoutMs: z.number().int().min(1_000).max(30 * 60_000).default(10 * 60_000),
  maxMemoryMb: z.number().int().min(128).max(8_192).default(2_048),
  maxOutputBytes: z.number().int().min(1_024).max(16_777_216).default(4_194_304),
  network: z.literal(false).default(false),
  environment: z.literal(false).default(false),
  productionDatabase: z.literal(false).default(false),
});
export type CoreLabResourcePolicy = z.infer<typeof CoreLabResourcePolicySchema>;

const CorePatchPathSchema = z.string().min(1).max(500).refine((value) => {
  if (value.includes("\\") || value.startsWith("/") || value.includes("\0")) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}, "Core patch paths must be normalized relative POSIX paths");

export const CorePatchBundleFileSchema = z.discriminatedUnion("operation", [
  z.object({
    path: CorePatchPathSchema,
    role: KernelArtifactRoleSchema,
    operation: z.literal("upsert"),
    contentBase64: z.string().min(1).max(32 * 1024 * 1024),
    digest: Sha256Schema,
  }),
  z.object({
    path: CorePatchPathSchema,
    role: KernelArtifactRoleSchema,
    operation: z.literal("delete"),
  }),
]);
export type CorePatchBundleFile = z.infer<typeof CorePatchBundleFileSchema>;

export const CorePatchBundleSchema = z.object({
  formatVersion: z.literal(1),
  kind: z.literal("core_patch_bundle"),
  baseManifestDigest: Sha256Schema,
  targetVersion: SemverSchema,
  files: z.array(CorePatchBundleFileSchema).min(1).max(500),
}).superRefine((bundle, context) => {
  const paths = new Set<string>();
  for (const file of bundle.files) {
    if (paths.has(file.path)) context.addIssue({ code: "custom", message: `Duplicate core patch path: ${file.path}` });
    paths.add(file.path);
  }
});
export type CorePatchBundle = z.infer<typeof CorePatchBundleSchema>;

export const CoreLabEvaluationRequestSchema = z.object({
  candidateId: z.string().min(1).max(100),
  baselineId: z.string().min(1).max(100),
  targetVersion: SemverSchema,
  expectedSourceDigest: Sha256Schema,
  expectedKernelDigest: Sha256Schema,
  sourceArtifactRef: z.string().min(1).max(500),
  baselineArtifactRef: z.string().min(1).max(500),
  declaredScope: z.array(CorePatchPathSchema).min(1).max(500),
  requiredGates: z.array(CorePatchGateNameSchema).min(1),
  replayFixtures: z.array(CoreReplayFixtureSchema).min(1).max(500),
  policy: CoreLabResourcePolicySchema,
}).superRefine((request, context) => {
  for (const [label, values] of [
    ["gate", request.requiredGates],
    ["scope path", request.declaredScope],
    ["replay fixture", request.replayFixtures.map((fixture) => fixture.id)],
  ] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `Duplicate ${label} in Core Lab request` });
  }
});
export type CoreLabEvaluationRequest = z.infer<typeof CoreLabEvaluationRequestSchema>;

export const CoreLabEvaluationReportSchema = z.object({
  candidateId: z.string().min(1).max(100),
  baselineId: z.string().min(1).max(100),
  sourceDigest: Sha256Schema,
  baselineKernelDigest: Sha256Schema,
  candidateKernelDigest: Sha256Schema,
  manifestDigest: Sha256Schema,
  mode: z.literal("isolated"),
  isolationProvider: z.string().min(1).max(200),
  gateResults: z.array(CorePatchGateResultSchema),
  replayCases: z.array(CoreReplayCaseSchema).min(1).max(500),
  buildEvidenceRefs: z.array(z.string().min(1).max(500)).min(1),
  evaluatedAt: z.string().datetime(),
});
export type CoreLabEvaluationReport = z.infer<typeof CoreLabEvaluationReportSchema>;
