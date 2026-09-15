import { createHash } from "node:crypto";
import { ExternalWebhookNotificationSchema, type ExternalWebhookEventStore, type ExternalWebhookNotification } from "@contracts/external-webhook";
import type { ExternalActionLedger, ExternalActionRecord } from "@contracts/external-action";

export interface ExternalWebhookProcessingResult {
  status: "applied" | "unmatched" | "ignored" | "duplicate";
  actionId?: string;
  externalStatus?: ExternalActionRecord["status"];
}

export class ExternalWebhookRuntime {
  constructor(
    private readonly ledger: ExternalActionLedger,
    private readonly events: ExternalWebhookEventStore,
  ) {}

  async process(input: ExternalWebhookNotification): Promise<ExternalWebhookProcessingResult> {
    const notification = ExternalWebhookNotificationSchema.parse(input);
    const claimed = await this.events.begin(notification);
    if (claimed.duplicate && claimed.event.status !== "received") {
      return { status: "duplicate", actionId: claimed.event.actionId };
    }

    const open = await this.ledger.listOpenForConnector(notification.connectorId, 200);
    const action = open.find((candidate) => this.matches(candidate, notification.reference));
    if (!action) {
      await this.events.complete(claimed.event.id, "unmatched");
      return { status: "unmatched" };
    }
    if (notification.outcome === "pending") {
      await this.events.complete(claimed.event.id, "ignored", action.id);
      return { status: "ignored", actionId: action.id, externalStatus: action.status };
    }

    const target = notification.outcome === "succeeded" ? "succeeded" : "failed";
    let updated: ExternalActionRecord;
    try {
      updated = await this.ledger.transition(action.id, [action.status], {
        status: target,
        resultDigest: notification.resultDigest,
        errorCode: target === "failed" ? `provider_webhook:${notification.eventType}` : undefined,
        nextReconcileAt: undefined,
      });
    } catch {
      const current = await this.ledger.get(action.id);
      if (!current || current.status !== target) throw new Error("External action changed while applying webhook");
      updated = current;
    }
    await this.events.complete(claimed.event.id, "applied", action.id);
    return { status: "applied", actionId: action.id, externalStatus: updated.status };
  }

  private matches(record: ExternalActionRecord, reference: string): boolean {
    if (record.providerReference === reference) return true;
    return this.containsReference(record.reconciliationData, reference);
  }

  private containsReference(value: unknown, reference: string): boolean {
    if (typeof value === "string") return value === reference;
    if (Array.isArray(value)) return value.some((item) => this.containsReference(item, reference));
    if (value && typeof value === "object") return Object.values(value).some((item) => this.containsReference(item, reference));
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : undefined;
}

function iso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeMoyasarWebhook(rawBody: string, payload: unknown): ExternalWebhookNotification {
  const root = record(payload);
  if (!root) throw new Error("Moyasar webhook payload must be an object");
  const data = record(root.data) ?? record(root.payment) ?? root;
  const eventType = text(root.type) ?? text(root.event) ?? text(root.event_type);
  const reference = text(data.id) ?? text(data.payment_id) ?? text(root.payment_id);
  if (!eventType || !reference) throw new Error("Moyasar webhook is missing event type or payment reference");
  const payloadDigest = digest(rawBody);
  const occurredAt = iso(root.created_at) ?? iso(root.updated_at) ?? iso(data.updated_at);
  const explicitEventId = text(root.event_id) ?? text(root.delivery_id);
  const eventKey = explicitEventId ?? `${eventType}:${reference}:${occurredAt ?? payloadDigest.slice(0, 24)}`;
  const status = (text(data.status) ?? eventType).toLowerCase();
  const failed = status.includes("faild") || status.includes("failed");
  const succeeded = ["paid", "authorized", "captured", "refunded", "voided", "verified"].some((item) => status.includes(item));
  return ExternalWebhookNotificationSchema.parse({
    provider: "moyasar",
    connectorId: "jasim.partner.moyasar-payment.v1",
    eventKey,
    eventType,
    reference,
    outcome: failed ? "failed" : succeeded ? "succeeded" : "pending",
    occurredAt,
    payloadDigest,
    resultDigest: digest(JSON.stringify({ eventType, reference, status })),
  });
}

export function normalizeShipdayWebhook(rawBody: string, payload: unknown): ExternalWebhookNotification {
  const root = record(payload);
  const order = record(root?.order);
  if (!root || !order) throw new Error("Shipday webhook payload must contain an order");
  const eventType = text(root.event);
  const reference = text(order.order_number) ?? text(order.orderNumber);
  if (!eventType || !reference) throw new Error("Shipday webhook is missing event type or order number");
  const occurredAt = iso(root.timestamp);
  const payloadDigest = digest(rawBody);
  return ExternalWebhookNotificationSchema.parse({
    provider: "shipday",
    connectorId: "jasim.partner.shipday-fulfillment.v1",
    eventKey: `${text(root.timestamp) ?? payloadDigest.slice(0, 24)}:${eventType}:${reference}`,
    eventType,
    reference,
    // Any authenticated event containing JASIM's deterministic order number
    // proves the dispatch insertion happened. Delivery lifecycle is tracked by
    // the separate read-only TRACK connector.
    outcome: "succeeded",
    occurredAt,
    payloadDigest,
    resultDigest: digest(JSON.stringify({ eventType, reference, status: text(root.order_status) })),
  });
}
