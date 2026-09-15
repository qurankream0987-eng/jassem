import { z } from "zod";

export const ExternalWebhookOutcomeSchema = z.enum(["succeeded", "failed", "pending"]);

export const ExternalWebhookNotificationSchema = z.object({
  provider: z.string().min(1).max(100),
  connectorId: z.string().min(1).max(160),
  eventKey: z.string().min(1).max(255),
  eventType: z.string().min(1).max(160),
  reference: z.string().min(1).max(255),
  outcome: ExternalWebhookOutcomeSchema,
  occurredAt: z.string().datetime().optional(),
  payloadDigest: z.string().length(64),
  resultDigest: z.string().length(64),
});

export type ExternalWebhookNotification = z.infer<typeof ExternalWebhookNotificationSchema>;

export const ExternalWebhookEventStatusSchema = z.enum(["received", "applied", "unmatched", "ignored"]);

export const ExternalWebhookEventSchema = z.object({
  id: z.string().length(64),
  provider: z.string(),
  connectorId: z.string(),
  eventKey: z.string(),
  eventType: z.string(),
  reference: z.string(),
  payloadDigest: z.string().length(64),
  status: ExternalWebhookEventStatusSchema,
  actionId: z.string().optional(),
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime().optional(),
});

export type ExternalWebhookEvent = z.infer<typeof ExternalWebhookEventSchema>;
export type ExternalWebhookEventStatus = z.infer<typeof ExternalWebhookEventStatusSchema>;

export interface ExternalWebhookEventStore {
  begin(notification: ExternalWebhookNotification): Promise<{ event: ExternalWebhookEvent; duplicate: boolean }>;
  complete(id: string, status: Exclude<ExternalWebhookEventStatus, "received">, actionId?: string): Promise<ExternalWebhookEvent>;
}
