/** Contracts for executing learned code beyond JASIM's kernel boundary. */

import { z } from "zod";
import { CapabilityPackageEnvelopeSchema, PackageRuntimeSchema } from "./capability-package";

export const SandboxResourcePolicySchema = z.object({
  timeoutMs: z.number().int().min(100).max(10_000).default(3_000),
  memoryMb: z.number().int().min(16).max(256).default(64),
  maxOutputBytes: z.number().int().min(1_024).max(1_048_576).default(262_144),
  maxProcesses: z.literal(1).default(1),
  network: z.literal(false).default(false),
  filesystem: z.literal(false).default(false),
  environment: z.literal(false).default(false),
  readOnlyRoot: z.literal(true).default(true),
});
export type SandboxResourcePolicy = z.infer<typeof SandboxResourcePolicySchema>;

export const CapabilityTestCaseSchema = z.object({
  name: z.string().min(1).max(160),
  input: z.record(z.string(), z.unknown()),
  expectedOutput: z.unknown().optional(),
  expectError: z.boolean().default(false),
});
export type CapabilityTestCase = z.infer<typeof CapabilityTestCaseSchema>;

export const SandboxExecutionResultSchema = z.object({
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["success", "error", "timeout", "policy_violation"]),
  output: z.unknown().optional(),
  errorCode: z.string().max(160).optional(),
  errorMessage: z.string().max(2_000).optional(),
  metrics: z.object({
    durationMs: z.number().int().nonnegative(),
    peakMemoryMb: z.number().nonnegative().max(512),
    outputBytes: z.number().int().nonnegative(),
  }),
  logsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type SandboxExecutionResult = z.infer<typeof SandboxExecutionResultSchema>;

export const SignedCapabilityBindingSchema = z.object({
  id: z.string().min(1),
  packageId: z.string().min(1),
  packageVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  candidateId: z.string().min(1),
  geneVersionId: z.string().min(1).optional(),
  capabilityId: z.string().regex(/^package:[a-zA-Z0-9._-]{2,160}$/),
  runtime: PackageRuntimeSchema,
  sandboxProvider: z.string().min(1),
  signingKeyId: z.string().min(1),
  status: z.enum(["canary", "active", "disabled", "quarantined"]),
  resourcePolicy: SandboxResourcePolicySchema,
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  executions: z.number().int().nonnegative().default(0),
  failures: z.number().int().nonnegative().default(0),
  safetyIncidents: z.number().int().nonnegative().default(0),
  lastExecutedAt: z.string().datetime().optional(),
});
export type SignedCapabilityBinding = z.infer<typeof SignedCapabilityBindingSchema>;

export const StoredCapabilityReleaseSchema = z.object({
  binding: SignedCapabilityBindingSchema,
  envelope: CapabilityPackageEnvelopeSchema,
  storedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StoredCapabilityRelease = z.infer<typeof StoredCapabilityReleaseSchema>;
