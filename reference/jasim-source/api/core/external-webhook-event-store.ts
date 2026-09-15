import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { externalWebhookEvents } from "@db/schema";
import {
  ExternalWebhookEventSchema,
  type ExternalWebhookEvent,
  type ExternalWebhookEventStatus,
  type ExternalWebhookEventStore,
  type ExternalWebhookNotification,
} from "@contracts/external-webhook";

function eventId(notification: ExternalWebhookNotification): string {
  return createHash("sha256").update(`${notification.provider}:${notification.eventKey}`).digest("hex");
}

export class MemoryExternalWebhookEventStore implements ExternalWebhookEventStore {
  private readonly events = new Map<string, ExternalWebhookEvent>();

  async begin(notification: ExternalWebhookNotification): Promise<{ event: ExternalWebhookEvent; duplicate: boolean }> {
    const id = eventId(notification);
    const existing = this.events.get(id);
    if (existing) {
      if (existing.payloadDigest !== notification.payloadDigest) throw new Error("Webhook event key was reused with a different payload");
      return { event: structuredClone(existing), duplicate: true };
    }
    const event = ExternalWebhookEventSchema.parse({
      id,
      provider: notification.provider,
      connectorId: notification.connectorId,
      eventKey: notification.eventKey,
      eventType: notification.eventType,
      reference: notification.reference,
      payloadDigest: notification.payloadDigest,
      status: "received",
      receivedAt: new Date().toISOString(),
    });
    this.events.set(id, event);
    return { event: structuredClone(event), duplicate: false };
  }

  async complete(id: string, status: Exclude<ExternalWebhookEventStatus, "received">, actionId?: string): Promise<ExternalWebhookEvent> {
    const existing = this.events.get(id);
    if (!existing) throw new Error("Webhook event not found");
    if (existing.status !== "received") return structuredClone(existing);
    const updated = ExternalWebhookEventSchema.parse({
      ...existing,
      status,
      actionId,
      processedAt: new Date().toISOString(),
    });
    this.events.set(id, updated);
    return structuredClone(updated);
  }
}

export class DrizzleExternalWebhookEventStore implements ExternalWebhookEventStore {
  async begin(notification: ExternalWebhookNotification): Promise<{ event: ExternalWebhookEvent; duplicate: boolean }> {
    const id = eventId(notification);
    const existing = await this.get(id);
    if (existing) return this.assertDuplicate(existing, notification);
    try {
      await db.insert(externalWebhookEvents).values({
        id,
        provider: notification.provider,
        connectorId: notification.connectorId,
        eventKey: notification.eventKey,
        eventType: notification.eventType,
        reference: notification.reference,
        payloadDigest: notification.payloadDigest,
        status: "received",
      });
    } catch {
      const concurrent = await this.get(id);
      if (concurrent) return this.assertDuplicate(concurrent, notification);
      throw new Error("Webhook event could not be recorded");
    }
    const created = await this.get(id);
    if (!created) throw new Error("Webhook event insert failed");
    return { event: created, duplicate: false };
  }

  async complete(id: string, status: Exclude<ExternalWebhookEventStatus, "received">, actionId?: string): Promise<ExternalWebhookEvent> {
    const existing = await this.get(id);
    if (!existing) throw new Error("Webhook event not found");
    if (existing.status !== "received") return existing;
    await db.update(externalWebhookEvents).set({ status, actionId, processedAt: new Date() }).where(and(
      eq(externalWebhookEvents.id, id),
      eq(externalWebhookEvents.status, "received"),
    ));
    const updated = await this.get(id);
    if (!updated) throw new Error("Webhook event disappeared during update");
    return updated;
  }

  private async get(id: string): Promise<ExternalWebhookEvent | undefined> {
    const row = await db.query.externalWebhookEvents.findFirst({ where: eq(externalWebhookEvents.id, id) });
    return row ? ExternalWebhookEventSchema.parse({
      ...row,
      actionId: row.actionId ?? undefined,
      receivedAt: row.receivedAt.toISOString(),
      processedAt: row.processedAt?.toISOString(),
    }) : undefined;
  }

  private assertDuplicate(existing: ExternalWebhookEvent, notification: ExternalWebhookNotification) {
    if (existing.payloadDigest !== notification.payloadDigest) throw new Error("Webhook event key was reused with a different payload");
    return { event: existing, duplicate: true };
  }
}
