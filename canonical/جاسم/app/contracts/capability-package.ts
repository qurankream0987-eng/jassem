/** Contracts for content-addressed, evaluated and signed capability packages. */

import { z } from "zod";

export const PackageRuntimeSchema = z.enum([
  "javascript",
  "typescript",
  "python",
  "http",
  "declarative",
]);
export type PackageRuntime = z.infer<typeof PackageRuntimeSchema>;

export const PackageFileSchema = z.object({
  path: z.string().min(1).max(500),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
});
export type PackageFile = z.infer<typeof PackageFileSchema>;

export const CapabilityPackageManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  packageId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  capabilityName: z.string().min(2).max(160),
  candidateId: z.string().min(1),
  runtime: PackageRuntimeSchema,
  entrypoint: z.string().min(1).max(500),
  exportName: z.string().min(1).max(160).optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  permissions: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  files: z.array(PackageFileSchema).min(1),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  publisher: z.string().min(1),
  license: z.string().min(1).optional(),
  provenance: z.object({
    sourceName: z.string().min(1),
    sourceUri: z.string().min(1),
    ownerConsent: z.boolean(),
  }),
  createdAt: z.string().datetime(),
});
export type CapabilityPackageManifest = z.infer<typeof CapabilityPackageManifestSchema>;

export const EvaluationFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning", "error", "critical"]),
  category: z.enum([
    "integrity",
    "syntax",
    "secret",
    "permission",
    "execution",
    "dependency",
    "license",
    "contract",
  ]),
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});
export type EvaluationFinding = z.infer<typeof EvaluationFindingSchema>;

export const CapabilityEvaluationSchema = z.object({
  id: z.string(),
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["static", "isolated"]),
  passed: z.boolean(),
  eligibleForExecutionRelease: z.boolean(),
  executionPerformed: z.boolean(),
  isolationProvider: z.string().optional(),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    details: z.string().optional(),
  })),
  findings: z.array(EvaluationFindingSchema),
  evaluatedAt: z.string().datetime(),
});
export type CapabilityEvaluation = z.infer<typeof CapabilityEvaluationSchema>;

export const CapabilityPackageSignatureSchema = z.object({
  algorithm: z.literal("Ed25519"),
  keyId: z.string().min(1),
  scope: z.enum(["source_attestation", "execution_release"]),
  signedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  value: z.string().min(32),
  signedAt: z.string().datetime(),
});
export type CapabilityPackageSignature = z.infer<typeof CapabilityPackageSignatureSchema>;

export const CapabilityPackageEnvelopeSchema = z.object({
  manifest: CapabilityPackageManifestSchema,
  evaluation: CapabilityEvaluationSchema.optional(),
  signature: CapabilityPackageSignatureSchema.optional(),
});
export type CapabilityPackageEnvelope = z.infer<typeof CapabilityPackageEnvelopeSchema>;

export interface CapabilityPackageBundle {
  envelope: CapabilityPackageEnvelope;
  contents: Array<PackageFile & { content: string }>;
}
