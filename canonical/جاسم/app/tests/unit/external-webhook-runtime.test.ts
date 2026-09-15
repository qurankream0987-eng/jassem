import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookHmacSha256, verifyWebhookToken } from "../../api/core/external-webhook-auth";
import { MemoryExternalWebhookEventStore } from "../../api/core/external-webhook-event-store";
import {
  ExternalWebhookRuntime,
  normalizeMoyasarWebhook,
  normalizeShipdayWebhook,
} from "../../api/core/external-webhook-runtime";
import { MemoryExternalActionLedger } from "../../api/core/external-action-ledger";

async function openAction(
  ledger: MemoryExternalActionLedger,
  connectorId: string,
  reference: string,
) {
  const action = await ledger.begin({
    connectorId,
    capabilityId: connectorId.includes("moyasar") ? "BUY" : "DELEGATE",
    effect: connectorId.includes("moyasar") ? "financial" : "external_change",
    taskId: 70,
    userId: 12,
    planId: "webhook-plan",
    stepId: "external-step",
    idempotencyKey: `key:${reference}`,
    inputDigest: "input-digest",
    reconciliationData: connectorId.includes("moyasar")
      ? { paymentId: reference }
      : { orderNumber: reference },
  });
  await ledger.transition(action.id, ["prepared"], { status: "executing" });
  return ledger.transition(action.id, ["executing"], { status: "uncertain" });
}

describe("external webhook authentication", () => {
  it("uses constant-time token and HMAC verification and rejects malformed signatures", () => {
    expect(verifyWebhookToken("shipday-secret", "shipday-secret")).toBe(true);
    expect(verifyWebhookToken("wrong", "shipday-secret")).toBe(false);
    const raw = JSON.stringify({ event: "payment_paid" });
    const signature = createHmac("sha256", "moyasar-secret").update(raw).digest("hex");
    expect(verifyWebhookHmacSha256(raw, `sha256=${signature}`, "moyasar-secret")).toBe(true);
    expect(verifyWebhookHmacSha256(`${raw} `, signature, "moyasar-secret")).toBe(false);
    expect(verifyWebhookHmacSha256(raw, "not-a-signature", "moyasar-secret")).toBe(false);
  });
});

describe("external webhook runtime", () => {
  it("applies an authenticated Shipday event once using the deterministic order number", async () => {
    const ledger = new MemoryExternalActionLedger();
    const action = await openAction(ledger, "jasim.partner.shipday-fulfillment.v1", "JASIMABC123");
    const events = new MemoryExternalWebhookEventStore();
    const runtime = new ExternalWebhookRuntime(ledger, events);
    const raw = JSON.stringify({
      timestamp: 1710000000000,
      event: "ORDER_INSERTED",
      order_status: "NOT_ASSIGNED",
      order: { id: 44, order_number: "JASIMABC123" },
    });
    const notification = normalizeShipdayWebhook(raw, JSON.parse(raw));

    expect(await runtime.process(notification)).toMatchObject({ status: "applied", actionId: action.id, externalStatus: "succeeded" });
    expect(await runtime.process(notification)).toMatchObject({ status: "duplicate", actionId: action.id });
    expect((await ledger.get(action.id))?.attempts).toBe(0);
  });

  it("maps a Moyasar failure only to the matching open payment", async () => {
    const ledger = new MemoryExternalActionLedger();
    const action = await openAction(ledger, "jasim.partner.moyasar-payment.v1", "pay_123");
    await openAction(ledger, "jasim.partner.moyasar-payment.v1", "pay_other");
    const runtime = new ExternalWebhookRuntime(ledger, new MemoryExternalWebhookEventStore());
    const raw = JSON.stringify({ type: "payment_failed", data: { id: "pay_123", status: "failed" }, updated_at: "2026-08-18T20:00:00.000Z" });

    expect(await runtime.process(normalizeMoyasarWebhook(raw, JSON.parse(raw)))).toMatchObject({
      status: "applied",
      actionId: action.id,
      externalStatus: "failed",
    });
    expect((await ledger.get(action.id))?.errorCode).toBe("provider_webhook:payment_failed");
  });

  it("records an unknown reference without changing any external action", async () => {
    const ledger = new MemoryExternalActionLedger();
    const action = await openAction(ledger, "jasim.partner.shipday-fulfillment.v1", "JASIMKNOWN");
    const runtime = new ExternalWebhookRuntime(ledger, new MemoryExternalWebhookEventStore());
    const raw = JSON.stringify({ timestamp: 1710000000001, event: "ORDER_INSERTED", order: { order_number: "JASIMUNKNOWN" } });

    expect(await runtime.process(normalizeShipdayWebhook(raw, JSON.parse(raw)))).toEqual({ status: "unmatched" });
    expect((await ledger.get(action.id))?.status).toBe("uncertain");
  });

  it("rejects reuse of one provider event key with a changed payload", async () => {
    const ledger = new MemoryExternalActionLedger();
    await openAction(ledger, "jasim.partner.shipday-fulfillment.v1", "JASIMREPLAY");
    const runtime = new ExternalWebhookRuntime(ledger, new MemoryExternalWebhookEventStore());
    const firstRaw = JSON.stringify({ timestamp: 1, event: "ORDER_INSERTED", order: { order_number: "JASIMREPLAY" } });
    const first = normalizeShipdayWebhook(firstRaw, JSON.parse(firstRaw));
    await runtime.process(first);

    await expect(runtime.process({ ...first, payloadDigest: "f".repeat(64) })).rejects.toThrow(/different payload/i);
  });
});
