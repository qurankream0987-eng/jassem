import { describe, expect, it, vi } from "vitest";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import type { ReviewedExternalConnectorConfig } from "@contracts/external-connector";
import { MemoryConnectorCredentialProvider } from "../../api/core/connector-credentials";
import { ReviewedHttpConnector } from "../../api/core/reviewed-http-connector";

const checkedAt = new Date().toISOString();

function config(overrides: Partial<ReviewedExternalConnectorConfig> = {}): ReviewedExternalConnectorConfig {
  return {
    reviewStatus: "approved",
    manifest: {
      id: "partner.payment.v1",
      name: "Reviewed payment operation",
      version: "1.0.0",
      provider: "partner",
      capabilities: [DNA_PRIMITIVES.BUY],
      scopes: ["external_partner"],
      effect: "financial",
      requiredPermissions: [],
      trust: { level: "verified", score: 0.95 },
      health: { status: "healthy", checkedAt },
      sendsUserDataExternally: true,
      enabled: true,
      priority: 50,
      estimatedLatencyMs: 500,
      costClass: "low",
    },
    origin: "https://payments.example.test/",
    credentialRef: "env:JASIM_TEST_PAYMENT_TOKEN",
    authentication: { type: "bearer" },
    staticHeaders: { "X-Client": "jasim" },
    timeoutMs: 5_000,
    maxResponseBytes: 100_000,
    operation: {
      id: "authorize",
      capabilityId: DNA_PRIMITIVES.BUY,
      method: "POST",
      pathTemplate: "/v1/payments",
      pathFields: [],
      queryFields: {},
      bodyFields: ["operation", "money", "paymentMethodToken", "merchantReference"],
      responseType: "json",
      protocol: "payment",
    },
    ...overrides,
  };
}

const context = {
  taskId: 1,
  userId: 2,
  planId: "plan",
  stepId: "pay",
  idempotencyKey: "idem-123",
  approvalId: "approval-123",
};

describe("ReviewedHttpConnector", () => {
  it("resolves secrets only at invocation and sends approved fields to the fixed origin", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ reference: "pay-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const connector = new ReviewedHttpConnector(
      config(),
      new MemoryConnectorCredentialProvider({ "env:JASIM_TEST_PAYMENT_TOKEN": "secret-token" }),
      fetchImpl,
    );

    const result = await connector.execute({
      operation: "authorize",
      money: { amountMinor: 2500, currency: "SAR" },
      paymentMethodToken: "tokenized-method",
      merchantReference: "order-7",
      url: "https://attacker.example/steal",
      unexpected: "do-not-send",
    }, context) as { data: { reference: string } };

    expect(result.data.reference).toBe("pay-1");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://payments.example.test/v1/payments");
    const headers = init?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(headers.get("X-JASIM-Idempotency-Key")).toBe("idem-123");
    expect(String(init?.body)).not.toContain("attacker");
    expect(String(init?.body)).not.toContain("unexpected");
  });

  it("refuses financial execution without scoped approval", async () => {
    const connector = new ReviewedHttpConnector(
      config(),
      new MemoryConnectorCredentialProvider({ "env:JASIM_TEST_PAYMENT_TOKEN": "secret-token" }),
      vi.fn(),
    );
    await expect(connector.execute({
      operation: "authorize",
      money: { amountMinor: 100, currency: "SAR" },
      paymentMethodToken: "tokenized-method",
      merchantReference: "order-8",
    }, { ...context, approvalId: undefined })).rejects.toThrow(/approval/i);
  });

  it("rejects non-HTTPS and private reviewed origins", () => {
    expect(() => new ReviewedHttpConnector(config({ origin: "http://partner.example.test/" }), new MemoryConnectorCredentialProvider({}))).toThrow(/HTTPS/i);
    expect(() => new ReviewedHttpConnector(config({ origin: "https://127.0.0.1/" }), new MemoryConnectorCredentialProvider({}))).toThrow(/not allowed/i);
  });
});
