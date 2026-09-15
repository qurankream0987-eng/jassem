import { PaymentProtocolInputSchema, type CredentialReference } from "@contracts/external-connector";
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

const CONNECTOR_ID = "jasim.partner.moyasar-payment.v1";
const ORIGIN = "https://api.moyasar.com/v1";

export class MoyasarPaymentConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: CONNECTOR_ID,
    name: "Moyasar tokenized payment",
    version: "1.0.0",
    provider: "moyasar",
    capabilities: [DNA_PRIMITIVES.BUY],
    scopes: ["external_partner"],
    effect: "financial",
    requiredPermissions: [],
    trust: { level: "reviewed", score: 0.9 },
    health: { status: "healthy", checkedAt: new Date().toISOString() },
    sendsUserDataExternally: true,
    enabled: true,
    priority: 88,
    estimatedLatencyMs: 1800,
    costClass: "medium",
  };

  constructor(
    private readonly credentialRef: CredentialReference,
    private readonly credentials: ConnectorCredentialProvider,
    private readonly fetchImpl: ProviderFetch = fetch,
  ) {}

  inputRequirements(inputs: Record<string, unknown>): RuntimeInputRequirement | undefined {
    const operation = typeof inputs.operation === "string" ? inputs.operation : undefined;
    const candidates = [
      !operation && { path: "operation", label: "نوع عملية الدفع", type: "select" as const, required: true, sensitive: false, purpose: "تحديد التفويض أو التحصيل أو الاسترداد", options: [
        { label: "تفويض الدفع", value: "authorize" },
        { label: "تحصيل مبلغ مفوض", value: "capture" },
        { label: "استرداد", value: "refund" },
      ] },
      operation === "authorize" && !this.has(inputs, "money.amountMinor") && { path: "money.amountMinor", label: "المبلغ بالوحدة الصغرى", type: "currency" as const, required: true, sensitive: false, purpose: "تحديد مبلغ العملية" },
      operation === "authorize" && !this.has(inputs, "money.currency") && { path: "money.currency", label: "العملة", type: "select" as const, required: true, sensitive: false, purpose: "تحديد عملة الدفع", options: [{ label: "ريال سعودي", value: "SAR" }] },
      operation === "authorize" && !this.has(inputs, "merchantReference") && { path: "merchantReference", label: "مرجع الطلب", type: "text" as const, required: true, sensitive: false, purpose: "ربط الدفع بطلب جاسم" },
      operation === "authorize" && !this.has(inputs, "callbackUrl") && { path: "callbackUrl", label: "رابط عودة الدفع الآمن", type: "url" as const, required: true, sensitive: false, purpose: "إكمال تحقق مزود الدفع" },
      operation === "authorize" && !this.has(inputs, "paymentMethodToken") && { path: "paymentMethodToken", label: "رمز وسيلة الدفع", description: "رمز مؤقت مولّد من واجهة مزود الدفع؛ لا تُدخل رقم البطاقة مباشرة.", type: "token" as const, required: true, sensitive: true, purpose: "تنفيذ الدفع دون حفظ بيانات البطاقة" },
      ["capture", "refund"].includes(operation ?? "") && !this.has(inputs, "paymentReference") && { path: "paymentReference", label: "مرجع عملية الدفع", type: "text" as const, required: true, sensitive: false, purpose: "تحديد العملية السابقة" },
      ["capture", "refund"].includes(operation ?? "") && !this.has(inputs, "money.amountMinor") && { path: "money.amountMinor", label: "المبلغ بالوحدة الصغرى", type: "currency" as const, required: true, sensitive: false, purpose: "تحديد مبلغ التحصيل أو الاسترداد" },
    ].filter((field): field is Exclude<typeof field, false | undefined> => Boolean(field));
    if (candidates.length === 0) return undefined;
    return {
      connectorId: this.manifest.id,
      capabilityId: DNA_PRIMITIVES.BUY,
      title: "بيانات الدفع المطلوبة",
      description: "جاسم يحتاج هذه القيم لإكمال خطوة الدفع الحالية فقط.",
      submitLabel: "متابعة الدفع",
      fields: candidates,
    };
  }

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    if (!context.approvalId) throw new ConnectorExecutionFailure("Moyasar payment requires scoped user approval", false);
    const input = PaymentProtocolInputSchema.parse(inputs);
    const paymentId = this.paymentId(context.idempotencyKey);
    if (input.operation === "status") throw new ConnectorExecutionFailure("Payment status is a read/reconciliation operation", false);
    let path: string;
    let body: Record<string, unknown> | undefined;
    if (input.operation === "authorize") {
      if (!input.paymentMethodToken?.startsWith("token_") || !input.callbackUrl?.startsWith("https://")) {
        throw new ConnectorExecutionFailure("Moyasar requires a tokenized method and HTTPS callback", false);
      }
      path = "/payments";
      body = {
        given_id: paymentId,
        amount: input.money!.amountMinor,
        currency: input.money!.currency,
        description: input.description ?? input.merchantReference,
        callback_url: input.callbackUrl,
        source: { type: "token", token: input.paymentMethodToken, manual: true },
        metadata: { jasim_reference: input.merchantReference },
      };
    } else {
      path = `/payments/${encodeURIComponent(input.paymentReference!)}/${input.operation}`;
      body = { amount: input.money!.amountMinor };
    }
    const response = await providerJsonRequest(CONNECTOR_ID, this.fetchImpl, `${ORIGIN}${path}`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    }, { sideEffect: true });
    return this.normalize(response.data);
  }

  reconciliationData(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Record<string, unknown> {
    const operation = typeof inputs.operation === "string" ? inputs.operation : undefined;
    const existingReference = typeof inputs.paymentReference === "string" ? inputs.paymentReference : undefined;
    return {
      paymentId: operation === "authorize" || !existingReference
        ? this.paymentId(context.idempotencyKey)
        : existingReference,
      operation: operation ?? "unknown",
    };
  }

  providerReference(result: unknown): string | undefined {
    if (!result || typeof result !== "object") return undefined;
    const value = (result as Record<string, unknown>).transaction;
    return typeof value === "string" ? value : undefined;
  }

  async reconcile(data: Record<string, unknown>): Promise<ConnectorReconciliationResult> {
    const paymentId = typeof data.paymentId === "string" ? data.paymentId : undefined;
    if (!paymentId) return { status: "not_found", reason: "missing_payment_id" };
    try {
      const response = await providerJsonRequest(CONNECTOR_ID, this.fetchImpl, `${ORIGIN}/payments/${encodeURIComponent(paymentId)}`, {
        method: "GET",
        headers: await this.headers(),
      });
      const normalized = this.normalize(response.data) as Record<string, unknown>;
      const status = String(normalized.status ?? "unknown");
      if (["authorized", "paid", "captured", "refunded", "voided"].includes(status)) {
        return { status: "confirmed_success", providerReference: paymentId, result: normalized };
      }
      if (status === "failed") return { status: "confirmed_failure", providerReference: paymentId, result: normalized };
      return { status: "pending", providerReference: paymentId, result: normalized };
    } catch (error) {
      if (error && typeof error === "object" && (error as { statusCode?: unknown }).statusCode === 404) return { status: "not_found" };
      throw error;
    }
  }

  async probeHealth(): Promise<ConnectorHealthProbeResult> {
    const started = Date.now();
    try {
      await providerJsonRequest(CONNECTOR_ID, this.fetchImpl, `${ORIGIN}/payments?page=1&per=1`, { method: "GET", headers: await this.headers() });
      return { healthy: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - started, reason: error instanceof Error ? error.name : "probe_failed" };
    }
  }

  private async headers(): Promise<Headers> {
    const secret = await this.credentials.resolve(this.credentialRef);
    return new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
    });
  }

  private paymentId(idempotencyKey: string): string {
    const hex = idempotencyKey.replace(/[^a-fA-F0-9]/g, "").padEnd(32, "0").slice(0, 32).toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  private normalize(value: unknown): unknown {
    if (!value || typeof value !== "object") throw new ConnectorExecutionFailure("Moyasar returned an invalid payment", true, true);
    const payment = value as Record<string, unknown>;
    return {
      transaction: String(payment.id ?? ""),
      status: String(payment.status ?? "unknown"),
      paymentTransferred: ["paid", "captured"].includes(String(payment.status)),
      amountMinor: payment.amount,
      currency: payment.currency,
      actionRequired: payment.status === "initiated",
      actionUrl: (payment.source as Record<string, unknown> | undefined)?.transaction_url,
    };
  }

  private has(inputs: Record<string, unknown>, path: string): boolean {
    const value = path.split(".").reduce<unknown>((current, part) => current && typeof current === "object"
      ? (current as Record<string, unknown>)[part]
      : undefined, inputs);
    return value !== undefined && value !== null && value !== "";
  }
}
