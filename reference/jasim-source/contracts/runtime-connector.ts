import { z } from "zod";

export const ConnectorScopeSchema = z.enum([
  "jasim_internal",
  "public_web",
  "private_account",
  "external_partner",
]);

export type ConnectorScope = z.infer<typeof ConnectorScopeSchema>;

export const ConnectorEffectSchema = z.enum([
  "none",
  "read",
  "write",
  "external_change",
  "financial",
]);

export type ConnectorEffect = z.infer<typeof ConnectorEffectSchema>;

export const RuntimeConnectorManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  provider: z.string(),
  capabilities: z.array(z.string()).min(1),
  scopes: z.array(ConnectorScopeSchema).min(1),
  effect: ConnectorEffectSchema,
  requiredPermissions: z.array(z.string()).default([]),
  trust: z.object({
    level: z.enum(["unverified", "reviewed", "verified", "system"]),
    score: z.number().min(0).max(1),
  }),
  health: z.object({
    status: z.enum(["healthy", "degraded", "offline"]),
    checkedAt: z.string().datetime(),
  }),
  sendsUserDataExternally: z.boolean().default(false),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(50),
  estimatedLatencyMs: z.number().int().nonnegative().default(1000),
  costClass: z.enum(["free", "low", "medium", "high"]).default("free"),
}).passthrough();

export type RuntimeConnectorManifest = z.infer<typeof RuntimeConnectorManifestSchema>;

export const RuntimeInputFieldSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.enum([
    "text", "textarea", "number", "currency", "phone", "location",
    "url", "token", "select", "boolean", "datetime",
  ]),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  purpose: z.string().min(1),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export type RuntimeInputField = z.infer<typeof RuntimeInputFieldSchema>;

export const RuntimeInputRequirementSchema = z.object({
  connectorId: z.string().min(1),
  capabilityId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  submitLabel: z.string().default("متابعة"),
  fields: z.array(RuntimeInputFieldSchema).min(1),
});

export type RuntimeInputRequirement = z.infer<typeof RuntimeInputRequirementSchema>;

export interface ConnectorExecutionContext {
  taskId: number;
  userId: number;
  planId: string;
  worldId?: string;
  stepId: string;
  idempotencyKey: string;
  approvalId?: string;
}

export interface ConnectorReconciliationResult {
  status: "confirmed_success" | "confirmed_failure" | "pending" | "not_found";
  providerReference?: string;
  result?: unknown;
  reason?: string;
}

export interface ConnectorHealthProbeResult {
  healthy: boolean;
  latencyMs: number;
  reason?: string;
}

export interface RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest;
  inputRequirements?(
    inputs: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): RuntimeInputRequirement | undefined | Promise<RuntimeInputRequirement | undefined>;
  execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown>;
  reconciliationData?(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Record<string, unknown>;
  providerReference?(result: unknown): string | undefined;
  reconcile?(
    data: Record<string, unknown>,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorReconciliationResult>;
  probeHealth?(): Promise<ConnectorHealthProbeResult>;
}

export interface ConnectorDiscoveryRequest {
  capabilityId: string;
  preferredScopes?: ConnectorScope[];
  grantedPermissions?: string[];
  minimumTrustScore?: number;
  approvalGranted?: boolean;
  allowExternalData?: boolean;
}

export interface ConnectorCandidate {
  connector: RuntimeConnector;
  score: number;
  reasons: string[];
}
