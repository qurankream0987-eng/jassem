import { createHash } from "node:crypto";
import { z } from "zod";
import { FulfillmentDispatchInputSchema, type CredentialReference } from "@contracts/external-connector";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import type {
  ConnectorExecutionContext,
  ConnectorHealthProbeResult,
  ConnectorReconciliationResult,
  RuntimeConnector,
  RuntimeConnectorManifest,
  RuntimeInputRequirement,
} from "@contracts/runtime-connector";
import type { ConnectorCredentialProvider } from "../core/connector-credentials";
import { ConnectorExecutionFailure } from "../core/reviewed-http-connector";
import { providerJsonRequest, type ProviderFetch } from "./provider-http";

const CONNECTOR_ID = "jasim.partner.shipday-fulfillment.v1";
const ORIGIN = "https://api.shipday.com";

const ShipdayDispatchSchema = FulfillmentDispatchInputSchema.extend({
  pickup: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    label: z.string().min(3).max(500),
    contactName: z.string().min(1).max(200),
    contactPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }),
  dropoff: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    label: z.string().min(3).max(500),
  }),
  recipient: z.object({
    name: z.string().min(1).max(200),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }),
  items: z.array(z.object({
    name: z.string().min(1).max(200),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative().optional(),
  })).max(100).default([]),
  totalAmount: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["prepaid", "cash_on_delivery"]).default("prepaid"),
  pickupInstruction: z.string().max(500).optional(),
  deliveryInstruction: z.string().max(500).optional(),
});

export class ShipdayFulfillmentConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: CONNECTOR_ID,
    name: "Shipday delivery dispatch and tracking",
    version: "1.0.0",
    provider: "shipday",
    capabilities: [DNA_PRIMITIVES.DELEGATE],
    scopes: ["external_partner"],
    effect: "external_change",
    requiredPermissions: [],
    trust: { level: "reviewed", score: 0.88 },
    health: { status: "healthy", checkedAt: new Date().toISOString() },
    sendsUserDataExternally: true,
    enabled: true,
    priority: 86,
    estimatedLatencyMs: 1600,
    costClass: "medium",
  };

  constructor(
    private readonly credentialRef: CredentialReference,
    private readonly credentials: ConnectorCredentialProvider,
    private readonly fetchImpl: ProviderFetch = fetch,
  ) {}

  inputRequirements(inputs: Record<string, unknown>): RuntimeInputRequirement | undefined {
    const definitions: Array<{ path: string; label: string; type: "text" | "number" | "phone" | "location"; purpose: string }> = [
      { path: "assignmentReference", label: "مرجع الطلب", type: "text", purpose: "ربط مهمة التوصيل بالطلب" },
      { path: "pickup.latitude", label: "خط عرض الاستلام", type: "location", purpose: "تحديد موقع الاستلام" },
      { path: "pickup.longitude", label: "خط طول الاستلام", type: "location", purpose: "تحديد موقع الاستلام" },
      { path: "pickup.label", label: "عنوان الاستلام", type: "text", purpose: "إرشاد السائق إلى مكان الاستلام" },
      { path: "pickup.contactName", label: "اسم جهة الاستلام", type: "text", purpose: "التواصل عند الاستلام" },
      { path: "pickup.contactPhone", label: "هاتف جهة الاستلام", type: "phone", purpose: "التواصل عند الاستلام" },
      { path: "dropoff.latitude", label: "خط عرض التسليم", type: "location", purpose: "تحديد موقع التسليم" },
      { path: "dropoff.longitude", label: "خط طول التسليم", type: "location", purpose: "تحديد موقع التسليم" },
      { path: "dropoff.label", label: "عنوان التسليم", type: "text", purpose: "إرشاد السائق إلى مكان التسليم" },
      { path: "recipient.name", label: "اسم المستلم", type: "text", purpose: "تسليم الطلب للشخص الصحيح" },
      { path: "recipient.phone", label: "هاتف المستلم", type: "phone", purpose: "التواصل أثناء التسليم" },
    ];
    const fields = definitions.filter((field) => !this.has(inputs, field.path)).map((field) => ({
      ...field,
      type: field.type === "location" ? "number" as const : field.type,
      required: true,
      sensitive: field.type === "phone",
    }));
    if (fields.length === 0) return undefined;
    return {
      connectorId: this.manifest.id,
      capabilityId: DNA_PRIMITIVES.DELEGATE,
      title: "بيانات الاستلام والتسليم",
      description: "ولّد جاسم هذه الفقاعة من الحقول الناقصة لدى خدمة التوصيل المختارة.",
      submitLabel: "البحث عن سائق",
      fields,
    };
  }

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    if (!context.approvalId) throw new ConnectorExecutionFailure("Shipday dispatch requires scoped user approval", false);
    const input = ShipdayDispatchSchema.parse(inputs);
    const orderNumber = this.orderNumber(context.idempotencyKey);
    const response = await providerJsonRequest(CONNECTOR_ID, this.fetchImpl, `${ORIGIN}/orders`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        orderNumber,
        additionalId: input.assignmentReference,
        customerName: input.recipient.name,
        customerAddress: input.dropoff.label,
        customerPhoneNumber: input.recipient.phone,
        restaurantName: input.pickup.contactName,
        restaurantAddress: input.pickup.label,
        restaurantPhoneNumber: input.pickup.contactPhone,
        pickupLatitude: input.pickup.latitude,
        pickupLongitude: input.pickup.longitude,
        deliveryLatitude: input.dropoff.latitude,
        deliveryLongitude: input.dropoff.longitude,
        orderItem: input.items,
        totalOrderCost: input.totalAmount,
        paymentMethod: input.paymentMethod === "cash_on_delivery" ? "cash" : "credit_card",
        pickupInstruction: input.pickupInstruction,
        deliveryInstruction: input.deliveryInstruction,
        orderSource: "JASIM",
      }),
    }, { sideEffect: true });
    const value = response.data as Record<string, unknown> | null;
    if (!value || value.success !== true || value.orderId === undefined) {
      throw new ConnectorExecutionFailure("Shipday did not confirm order creation", true, true);
    }
    return {
      assignmentId: String(value.orderId),
      providerOrderNumber: orderNumber,
      status: "submitted",
      paymentTransferred: false,
    };
  }

  reconciliationData(_inputs: Record<string, unknown>, context: ConnectorExecutionContext): Record<string, unknown> {
    return { orderNumber: this.orderNumber(context.idempotencyKey) };
  }

  providerReference(result: unknown): string | undefined {
    if (!result || typeof result !== "object") return undefined;
    const value = (result as Record<string, unknown>).assignmentId;
    return typeof value === "string" ? value : undefined;
  }

  async reconcile(data: Record<string, unknown>): Promise<ConnectorReconciliationResult> {
    const orderNumber = typeof data.orderNumber === "string" ? data.orderNumber : undefined;
    if (!orderNumber) return { status: "not_found", reason: "missing_order_number" };
    try {
      const response = await providerJsonRequest(CONNECTOR_ID, this.fetchImpl, `${ORIGIN}/orders/${encodeURIComponent(orderNumber)}`, {
        method: "GET",
        headers: await this.headers(),
      });
      const first = Array.isArray(response.data) ? response.data[0] : response.data;
      if (!first || typeof first !== "object") return { status: "not_found" };
      const order = first as Record<string, unknown>;
      const state = this.orderState(order);
      const providerReference = order.orderId === undefined ? undefined : String(order.orderId);
      if (["ALREADY_DELIVERED", "COMPLETED", "DELIVERED"].includes(state)) {
        return { status: "confirmed_success", providerReference, result: this.publicStatus(order, state) };
      }
      if (["FAILED_DELIVERY", "INCOMPLETE", "CANCELLED", "CANCELED"].includes(state)) {
        return { status: "confirmed_failure", providerReference, result: this.publicStatus(order, state), reason: state };
      }
      return { status: "pending", providerReference, result: this.publicStatus(order, state) };
    } catch (error) {
      if (error && typeof error === "object" && [400, 404].includes(Number((error as { statusCode?: unknown }).statusCode))) {
        return { status: "not_found" };
      }
      throw error;
    }
  }

  async probeHealth(): Promise<ConnectorHealthProbeResult> {
    const started = Date.now();
    try {
      await providerJsonRequest(CONNECTOR_ID, this.fetchImpl, `${ORIGIN}/orders/JASIM_HEALTH_CHECK_DO_NOT_CREATE`, {
        method: "GET",
        headers: await this.headers(),
      });
      return { healthy: true, latencyMs: Date.now() - started };
    } catch (error) {
      const status = Number((error as { statusCode?: unknown } | undefined)?.statusCode);
      return {
        healthy: status === 400 || status === 404,
        latencyMs: Date.now() - started,
        reason: status === 400 || status === 404 ? undefined : "probe_failed",
      };
    }
  }

  private async headers(): Promise<Headers> {
    const key = await this.credentials.resolve(this.credentialRef);
    return new Headers({ Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${key}` });
  }

  private orderNumber(idempotencyKey: string): string {
    return `JASIM${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24).toUpperCase()}`;
  }

  private orderState(order: Record<string, unknown>): string {
    const status = order.orderStatus;
    if (typeof status === "string") return status.toUpperCase();
    if (status && typeof status === "object") {
      const nested = status as Record<string, unknown>;
      return String(nested.status ?? nested.orderState ?? nested.state ?? "UNKNOWN").toUpperCase();
    }
    return String(order.status ?? "UNKNOWN").toUpperCase();
  }

  private publicStatus(order: Record<string, unknown>, status: string): Record<string, unknown> {
    return {
      assignmentId: order.orderId === undefined ? undefined : String(order.orderId),
      providerOrderNumber: order.orderNumber,
      status,
      trackingLink: order.trackingLink,
      assigned: Number(order.assignedCarrierId ?? -1) >= 0,
    };
  }

  private has(inputs: Record<string, unknown>, path: string): boolean {
    const value = path.split(".").reduce<unknown>((current, part) => current && typeof current === "object"
      ? (current as Record<string, unknown>)[part]
      : undefined, inputs);
    return value !== undefined && value !== null && value !== "";
  }
}

export class ShipdayTrackingConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.partner.shipday-tracking.v1",
    name: "Shipday delivery tracking",
    version: "1.0.0",
    provider: "shipday",
    capabilities: [DNA_PRIMITIVES.TRACK],
    scopes: ["external_partner"],
    effect: "read",
    requiredPermissions: [],
    trust: { level: "reviewed", score: 0.88 },
    health: { status: "healthy", checkedAt: new Date().toISOString() },
    sendsUserDataExternally: true,
    enabled: true,
    priority: 86,
    estimatedLatencyMs: 900,
    costClass: "low",
  };

  constructor(
    private readonly credentialRef: CredentialReference,
    private readonly credentials: ConnectorCredentialProvider,
    private readonly fetchImpl: ProviderFetch = fetch,
  ) {}

  async execute(inputs: Record<string, unknown>): Promise<unknown> {
    const orderNumber = this.findOrderNumber(inputs.target ?? inputs);
    if (!orderNumber) throw new ConnectorExecutionFailure("Shipday tracking requires a provider order number", false);
    const response = await providerJsonRequest(this.manifest.id, this.fetchImpl, `${ORIGIN}/orders/${encodeURIComponent(orderNumber)}`, {
      method: "GET",
      headers: await this.headers(),
    });
    const first = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!first || typeof first !== "object") return { status: "not_found", providerOrderNumber: orderNumber };
    const order = first as Record<string, unknown>;
    const orderStatus = order.orderStatus;
    const status = typeof orderStatus === "string"
      ? orderStatus
      : String((orderStatus as Record<string, unknown> | undefined)?.status ?? order.status ?? "UNKNOWN");
    return {
      status,
      assignmentId: order.orderId === undefined ? undefined : String(order.orderId),
      providerOrderNumber: order.orderNumber ?? orderNumber,
      trackingLink: order.trackingLink,
      assignedCarrier: order.assignedCarrier,
      updatedAt: new Date().toISOString(),
    };
  }

  private async headers(): Promise<Headers> {
    const key = await this.credentials.resolve(this.credentialRef);
    return new Headers({ Accept: "application/json", Authorization: `Basic ${key}` });
  }

  private findOrderNumber(value: unknown): string | undefined {
    if (typeof value === "string" && /^JASIM[A-F0-9]{24}$/.test(value)) return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findOrderNumber(item);
        if (found) return found;
      }
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.providerOrderNumber === "string") return record.providerOrderNumber;
      for (const item of Object.values(record)) {
        const found = this.findOrderNumber(item);
        if (found) return found;
      }
    }
    return undefined;
  }
}
