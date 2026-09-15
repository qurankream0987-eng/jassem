import { z } from "zod";
import { RuntimeConnectorManifestSchema } from "./runtime-connector";

export const CredentialReferenceSchema = z.string()
  .regex(/^env:JASIM_[A-Z0-9_]+$/, "Only JASIM-scoped environment secret references are allowed");

export type CredentialReference = z.infer<typeof CredentialReferenceSchema>;

export const ExternalHttpOperationSchema = z.object({
  id: z.string().min(1),
  capabilityId: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  pathTemplate: z.string().startsWith("/"),
  pathFields: z.array(z.string().min(1)).default([]),
  queryFields: z.record(z.string(), z.string()).default({}),
  bodyFields: z.array(z.string().min(1)).default([]),
  responseType: z.enum(["json", "text"]).default("json"),
  protocol: z.enum([
    "generic",
    "purchase_commitment",
    "payment",
    "fulfillment_dispatch",
    "fulfillment_tracking",
  ]).default("generic"),
});

export type ExternalHttpOperation = z.infer<typeof ExternalHttpOperationSchema>;

export const ReviewedExternalConnectorConfigSchema = z.object({
  reviewStatus: z.literal("approved"),
  manifest: RuntimeConnectorManifestSchema.extend({
    scopes: z.array(z.literal("external_partner")).min(1),
    trust: z.object({
      level: z.enum(["reviewed", "verified"]),
      score: z.number().min(0.7).max(1),
    }),
    sendsUserDataExternally: z.literal(true),
  }),
  origin: z.string().url(),
  credentialRef: CredentialReferenceSchema.optional(),
  authentication: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer") }),
    z.object({
      type: z.literal("header"),
      headerName: z.string().regex(/^[A-Za-z0-9-]+$/),
    }),
  ]).default({ type: "none" }),
  staticHeaders: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
  maxResponseBytes: z.number().int().min(1_024).max(5 * 1024 * 1024).default(1024 * 1024),
  operation: ExternalHttpOperationSchema,
}).superRefine((config, ctx) => {
  if (config.operation.capabilityId !== config.manifest.capabilities[0] || config.manifest.capabilities.length !== 1) {
    ctx.addIssue({ code: "custom", message: "A reviewed connector must bind exactly one capability to one operation" });
  }
  if (config.authentication.type !== "none" && !config.credentialRef) {
    ctx.addIssue({ code: "custom", message: "Authenticated connectors require a credential reference" });
  }
  if (config.manifest.effect === "financial" && config.operation.protocol !== "payment") {
    ctx.addIssue({ code: "custom", message: "Financial connectors must use the payment protocol" });
  }
  if (config.operation.protocol === "payment" && config.manifest.effect !== "financial") {
    ctx.addIssue({ code: "custom", message: "Payment protocol connectors must declare a financial effect" });
  }
  if (config.operation.protocol === "fulfillment_dispatch" && !["write", "external_change"].includes(config.manifest.effect)) {
    ctx.addIssue({ code: "custom", message: "Dispatch connectors must declare a write or external change" });
  }
  if (config.operation.protocol === "fulfillment_tracking" && config.manifest.effect !== "read") {
    ctx.addIssue({ code: "custom", message: "Tracking connectors must be read-only" });
  }
  const placeholders = [...config.operation.pathTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (placeholders.some((field) => !config.operation.pathFields.includes(field))) {
    ctx.addIssue({ code: "custom", message: "Every path placeholder must be explicitly allowlisted" });
  }
});

export type ReviewedExternalConnectorConfig = z.infer<typeof ReviewedExternalConnectorConfigSchema>;

const MoneySchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const PaymentProtocolInputSchema = z.object({
  operation: z.enum(["authorize", "capture", "refund", "status"]),
  money: MoneySchema.optional(),
  paymentMethodToken: z.string().min(8).optional(),
  paymentReference: z.string().min(1).optional(),
  merchantReference: z.string().min(1),
  callbackUrl: z.string().url().optional(),
  description: z.string().max(255).optional(),
}).superRefine((input, ctx) => {
  if (["authorize", "capture", "refund"].includes(input.operation) && !input.money) {
    ctx.addIssue({ code: "custom", message: "Money is required for a financial change" });
  }
  if (input.operation === "authorize" && !input.paymentMethodToken) {
    ctx.addIssue({ code: "custom", message: "A tokenized payment method is required" });
  }
  if (["capture", "refund", "status"].includes(input.operation) && !input.paymentReference) {
    ctx.addIssue({ code: "custom", message: "A payment reference is required" });
  }
});

const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  label: z.string().max(300).optional(),
});

export const FulfillmentDispatchInputSchema = z.object({
  operation: z.literal("dispatch"),
  assignmentReference: z.string().min(1),
  pickup: LocationSchema,
  dropoff: LocationSchema,
  recipient: z.object({
    name: z.string().min(1),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
    phoneToken: z.string().min(1).optional(),
  }).refine((recipient) => recipient.phone || recipient.phoneToken, "A phone or protected phone token is required"),
  package: z.record(z.string(), z.unknown()).default({}),
});

export const FulfillmentTrackingInputSchema = z.object({
  operation: z.enum(["track", "cancel"]),
  assignmentReference: z.string().min(1),
});
