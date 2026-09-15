import {
  FulfillmentDispatchInputSchema,
  FulfillmentTrackingInputSchema,
  PaymentProtocolInputSchema,
  ReviewedExternalConnectorConfigSchema,
  type ReviewedExternalConnectorConfig,
} from "@contracts/external-connector";
import type {
  ConnectorExecutionContext,
  RuntimeConnector,
  RuntimeConnectorManifest,
} from "@contracts/runtime-connector";
import type { ConnectorCredentialProvider } from "./connector-credentials";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1"]);
const RESERVED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "x-forwarded-for",
  "x-jasim-idempotency-key",
]);

export class ConnectorExecutionFailure extends Error {
  constructor(
    message: string,
    readonly countsTowardCircuit: boolean,
    readonly outcomeUncertain = false,
  ) {
    super(message);
    this.name = "ConnectorExecutionFailure";
  }
}

/** A reviewed declarative adapter. Runtime input cannot choose its URL, auth or headers. */
export class ReviewedHttpConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest;
  private readonly config: ReviewedExternalConnectorConfig;

  constructor(
    config: ReviewedExternalConnectorConfig,
    private readonly credentials: ConnectorCredentialProvider,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {
    this.config = ReviewedExternalConnectorConfigSchema.parse(config);
    this.manifest = this.config.manifest;
    this.assertSafeConfiguration();
  }

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    this.assertExecutionAuthority(context);
    let validatedInputs: Record<string, unknown>;
    let url: string;
    try {
      validatedInputs = this.validateProtocol(inputs);
      url = this.buildUrl(validatedInputs);
    } catch {
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} input is invalid`, false);
    }
    const headers = await this.buildHeaders(context);
    const body = this.buildBody(validatedInputs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: this.config.operation.method,
        headers,
        body,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} timed out`, true, true);
      }
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} transport failed`, true, true);
    } finally {
      clearTimeout(timeout);
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > this.config.maxResponseBytes) {
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} response exceeded its reviewed limit`, true, true);
    }
    const raw = await this.readLimitedBody(response);
    if (!response.ok) {
      const providerFailure = response.status >= 500 || response.status === 408 || response.status === 429;
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} returned HTTP ${response.status}`, providerFailure, providerFailure);
    }

    if (this.config.operation.responseType === "text") {
      return { status: response.status, data: raw };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} returned an unexpected content type`, true, true);
    }
    try {
      return { status: response.status, data: raw ? JSON.parse(raw) : null };
    } catch {
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} returned invalid JSON`, true, true);
    }
  }

  private assertSafeConfiguration(): void {
    const origin = new URL(this.config.origin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) {
      throw new Error("Reviewed connector origins must be clean HTTPS origins");
    }
    if (origin.pathname !== "/" || this.isPrivateHost(origin.hostname)) {
      throw new Error("Reviewed connector origin is not allowed");
    }
    for (const name of Object.keys(this.config.staticHeaders)) {
      if (RESERVED_HEADERS.has(name.toLowerCase())) throw new Error(`Static header ${name} is reserved`);
      if (/(?:api[-_]?key|token|secret|credential)/i.test(name)) throw new Error(`Sensitive static header ${name} must use a credential reference`);
    }
    if (this.config.authentication.type === "header" && RESERVED_HEADERS.has(this.config.authentication.headerName.toLowerCase())) {
      throw new Error(`Authentication header ${this.config.authentication.headerName} is reserved`);
    }
    if (["GET", "DELETE"].includes(this.config.operation.method) && this.config.operation.bodyFields.length > 0) {
      throw new Error(`${this.config.operation.method} connectors cannot declare a request body`);
    }
  }

  private assertExecutionAuthority(context: ConnectorExecutionContext): void {
    if (["write", "external_change", "financial"].includes(this.manifest.effect) && !context.approvalId) {
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} requires scoped user approval`, false);
    }
    if (["write", "external_change", "financial"].includes(this.manifest.effect) && !context.idempotencyKey) {
      throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} requires an idempotency key`, false);
    }
  }

  private validateProtocol(inputs: Record<string, unknown>): Record<string, unknown> {
    switch (this.config.operation.protocol) {
      case "payment":
        if (this.manifest.effect !== "financial") throw new Error("Payment protocol connectors must declare a financial effect");
        return PaymentProtocolInputSchema.parse(inputs);
      case "fulfillment_dispatch":
        return FulfillmentDispatchInputSchema.parse(inputs);
      case "fulfillment_tracking":
        return FulfillmentTrackingInputSchema.parse(inputs);
      default:
        return inputs;
    }
  }

  private buildUrl(inputs: Record<string, unknown>): string {
    let path = this.config.operation.pathTemplate;
    for (const field of this.config.operation.pathFields) {
      const value = inputs[field];
      if (typeof value !== "string" && typeof value !== "number") throw new Error(`Missing reviewed path field ${field}`);
      path = path.replaceAll(`{${field}}`, encodeURIComponent(String(value)));
    }
    if (/\{[^}]+\}/.test(path)) throw new Error("Unresolved path placeholder");
    const url = new URL(path, this.config.origin);
    if (url.origin !== new URL(this.config.origin).origin) throw new Error("Connector path escaped its reviewed origin");
    for (const [inputField, queryName] of Object.entries(this.config.operation.queryFields)) {
      const value = inputs[inputField];
      if (value !== undefined && value !== null) url.searchParams.set(queryName, String(value));
    }
    return url.toString();
  }

  private async buildHeaders(context: ConnectorExecutionContext): Promise<Headers> {
    const headers = new Headers({ Accept: "application/json", ...this.config.staticHeaders });
    if (this.config.operation.bodyFields.length > 0) headers.set("Content-Type", "application/json");
    if (["write", "external_change", "financial"].includes(this.manifest.effect)) {
      headers.set("X-JASIM-Idempotency-Key", context.idempotencyKey);
    }
    if (this.config.authentication.type !== "none") {
      const secret = await this.credentials.resolve(this.config.credentialRef!);
      if (this.config.authentication.type === "bearer") headers.set("Authorization", `Bearer ${secret}`);
      else headers.set(this.config.authentication.headerName, secret);
    }
    return headers;
  }

  private buildBody(inputs: Record<string, unknown>): string | undefined {
    if (this.config.operation.bodyFields.length === 0) return undefined;
    return JSON.stringify(Object.fromEntries(this.config.operation.bodyFields
      .filter((field) => inputs[field] !== undefined)
      .map((field) => [field, inputs[field]])));
  }

  private async readLimitedBody(response: Response): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let output = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.config.maxResponseBytes) {
          await reader.cancel();
          throw new ConnectorExecutionFailure(`Connector ${this.manifest.id} response exceeded its reviewed limit`, true, true);
        }
        output += decoder.decode(value, { stream: true });
      }
      return output + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  private isPrivateHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (BLOCKED_HOSTS.has(normalized) || normalized.endsWith(".local")) return true;
    if (/^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized)) return true;
    const match = normalized.match(/^172\.(\d+)\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  }
}
