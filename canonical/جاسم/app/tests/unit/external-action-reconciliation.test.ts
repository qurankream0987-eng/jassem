import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import type {
  ConnectorExecutionContext,
  RuntimeConnector,
  RuntimeConnectorManifest,
} from "@contracts/runtime-connector";
import { ConnectorAwareExecutionPort } from "../../api/core/connector-aware-execution-port";
import { MemoryExternalActionLedger } from "../../api/core/external-action-ledger";
import { ExternalActionReconciler } from "../../api/core/external-action-reconciler";
import { RuntimeConnectorRegistry } from "../../api/core/runtime-connector-registry";
import { MemoryConnectorCredentialProvider } from "../../api/core/connector-credentials";
import { MoyasarPaymentConnector } from "../../api/connectors/moyasar-payment";
import { ShipdayFulfillmentConnector, ShipdayTrackingConnector } from "../../api/connectors/shipday-fulfillment";
import type {
  CapabilityExecutionContext,
  ExecutableCapabilityDescriptor,
  GeneratedCapabilityExecutionPort,
} from "../../api/core/generated-plan-executor";

const context: CapabilityExecutionContext = {
  taskId: 1,
  userId: 2,
  planId: "plan",
  worldId: "world",
  stepId: "step",
  idempotencyKey: "a".repeat(64),
  approvalId: "approval-1",
};

class Fallback implements GeneratedCapabilityExecutionPort {
  async describe(capabilityId: string): Promise<ExecutableCapabilityDescriptor> {
    return { capabilityId, risk: "high", sideEffects: [{ type: "payment", reversible: false }] };
  }
  async invoke(): Promise<unknown> { throw new Error("fallback must not run"); }
}

class AmbiguousConnector implements RuntimeConnector {
  calls = 0;
  readonly manifest: RuntimeConnectorManifest = {
    id: "ambiguous",
    name: "ambiguous",
    version: "1",
    provider: "test",
    capabilities: [DNA_PRIMITIVES.BUY],
    scopes: ["external_partner"],
    effect: "financial",
    requiredPermissions: [],
    trust: { level: "verified", score: 1 },
    health: { status: "healthy", checkedAt: new Date().toISOString() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 100,
    estimatedLatencyMs: 1,
    costClass: "free",
  };
  async execute(): Promise<unknown> {
    this.calls += 1;
    throw Object.assign(new Error("connection lost"), { outcomeUncertain: true, countsTowardCircuit: true });
  }
  reconciliationData(): Record<string, unknown> { return { providerKey: "safe-key" }; }
  async reconcile() { return { status: "confirmed_success" as const, providerReference: "provider-1", result: { status: "paid" } }; }
}

describe("external action reconciliation", () => {
  it("never repeats an uncertain financial effect and resolves it through a read probe", async () => {
    const registry = new RuntimeConnectorRegistry();
    const connector = new AmbiguousConnector();
    registry.register(connector);
    const ledger = new MemoryExternalActionLedger();
    const port = new ConnectorAwareExecutionPort(new Fallback(), registry, ledger);

    await expect(port.invoke(DNA_PRIMITIVES.BUY, { connectorScopes: ["external_partner"] }, context)).rejects.toThrow("connection lost");
    const actionId = createHash("sha256").update(`ambiguous:${context.idempotencyKey}`).digest("hex");
    expect((await ledger.get(actionId))?.status).toBe("uncertain");

    await expect(port.invoke(DNA_PRIMITIVES.BUY, { connectorScopes: ["external_partner"] }, context)).rejects.toThrow(/reconciliation/i);
    expect(connector.calls).toBe(1);

    const reconciler = new ExternalActionReconciler(ledger, registry, 3, () => Date.now() + 31_000);
    const summary = await reconciler.runDue();
    expect(summary.succeeded).toBe(1);
    expect(await ledger.get(actionId)).toMatchObject({ status: "succeeded", providerReference: "provider-1", attempts: 1 });
  });

  it("allows only the owner to re-probe a manual-review action without replaying it", async () => {
    const registry = new RuntimeConnectorRegistry();
    const connector = new AmbiguousConnector();
    registry.register(connector);
    const ledger = new MemoryExternalActionLedger();
    const action = await ledger.begin({
      connectorId: connector.manifest.id,
      capabilityId: DNA_PRIMITIVES.BUY,
      effect: "financial",
      taskId: 8,
      userId: 22,
      planId: "manual-plan",
      stepId: "payment",
      idempotencyKey: "manual-key",
      inputDigest: "digest",
      reconciliationData: { providerKey: "safe-key" },
    });
    await ledger.transition(action.id, ["prepared"], { status: "executing" });
    await ledger.transition(action.id, ["executing"], { status: "uncertain" });
    await ledger.transition(action.id, ["uncertain"], { status: "manual_review" });
    const reconciler = new ExternalActionReconciler(ledger, registry);

    await expect(reconciler.reconcileById(action.id, 23)).rejects.toThrow(/not found/i);
    expect(connector.calls).toBe(0);
    const resolved = await reconciler.reconcileById(action.id, 22);
    expect(resolved).toMatchObject({ status: "succeeded", providerReference: "provider-1" });
    expect(connector.calls).toBe(0);
  });
});

describe("reviewed regional provider adapters", () => {
  it("maps tokenized Moyasar authorization and reconciles by deterministic given_id", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ id: body.given_id, status: "authorized", amount: body.amount, currency: body.currency }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: String(url).split("/").at(-1), status: "authorized", amount: 2500, currency: "SAR" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const connector = new MoyasarPaymentConnector(
      "env:JASIM_MOYASAR_TEST_KEY",
      new MemoryConnectorCredentialProvider({ "env:JASIM_MOYASAR_TEST_KEY": "sk_test_secret" }),
      fetchImpl,
    );
    const output = await connector.execute({
      operation: "authorize",
      money: { amountMinor: 2500, currency: "SAR" },
      paymentMethodToken: "token_test_method",
      merchantReference: "order-1",
      callbackUrl: "https://merchant.example/callback",
    }, context as ConnectorExecutionContext) as Record<string, unknown>;
    expect(output).toMatchObject({ status: "authorized", paymentTransferred: false });
    const sent = JSON.parse(String(requests[0]!.init?.body));
    expect(sent.given_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.source).toEqual({ type: "token", token: "token_test_method", manual: true });
    expect(String(requests[0]!.init?.headers)).not.toContain("sk_test_secret");
    const reconciled = await connector.reconcile(connector.reconciliationData({}, context as ConnectorExecutionContext));
    expect(reconciled.status).toBe("confirmed_success");
  });

  it("maps a generic dispatch to Shipday and tracks it by JASIM order number", async () => {
    let orderNumber = "";
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        orderNumber = body.orderNumber;
        expect(body.customerPhoneNumber).toBe("+966500000001");
        return new Response(JSON.stringify({ success: true, orderId: 77, response: "created" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([{ orderId: 77, orderNumber, orderStatus: { status: "ALREADY_DELIVERED" }, trackingLink: "https://track.example/77" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const connector = new ShipdayFulfillmentConnector(
      "env:JASIM_SHIPDAY_TEST_KEY",
      new MemoryConnectorCredentialProvider({ "env:JASIM_SHIPDAY_TEST_KEY": "shipday-key" }),
      fetchImpl,
    );
    const input = {
      operation: "dispatch",
      assignmentReference: "assignment-1",
      pickup: { latitude: 24.7, longitude: 46.7, label: "Riyadh restaurant", contactName: "Restaurant", contactPhone: "+966500000000" },
      dropoff: { latitude: 24.71, longitude: 46.71, label: "Riyadh customer" },
      recipient: { name: "Customer", phone: "+966500000001" },
      items: [{ name: "Meal", quantity: 1, unitPrice: 25 }],
      totalAmount: 25,
      paymentMethod: "prepaid",
    };
    const output = await connector.execute(input, context as ConnectorExecutionContext) as Record<string, unknown>;
    expect(output).toMatchObject({ assignmentId: "77", paymentTransferred: false });
    expect(orderNumber).toMatch(/^JASIM[A-F0-9]{24}$/);
    const reconciled = await connector.reconcile(connector.reconciliationData(input, context as ConnectorExecutionContext));
    expect(reconciled).toMatchObject({ status: "confirmed_success", providerReference: "77" });
    const tracking = new ShipdayTrackingConnector(
      "env:JASIM_SHIPDAY_TEST_KEY",
      new MemoryConnectorCredentialProvider({ "env:JASIM_SHIPDAY_TEST_KEY": "shipday-key" }),
      fetchImpl,
    );
    expect(await tracking.execute({ target: output })).toMatchObject({
      status: "ALREADY_DELIVERED",
      assignmentId: "77",
    });
  });
});
