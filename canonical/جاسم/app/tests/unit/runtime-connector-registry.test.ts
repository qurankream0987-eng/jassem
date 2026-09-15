import { describe, expect, it } from "vitest";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import type {
  ConnectorExecutionContext,
  RuntimeConnector,
  RuntimeConnectorManifest,
} from "@contracts/runtime-connector";
import { RuntimeConnectorRegistry } from "../../api/core/runtime-connector-registry";
import { ConnectorAwareExecutionPort } from "../../api/core/connector-aware-execution-port";
import type {
  CapabilityExecutionContext,
  ExecutableCapabilityDescriptor,
  GeneratedCapabilityExecutionPort,
} from "../../api/core/generated-plan-executor";
import {
  JasimCommitmentConnector,
  JasimFulfillmentAssignmentConnector,
  JasimInternalDiscoveryConnector,
  JasimOfferPublisherConnector,
  JasimProgressTrackingConnector,
  type DiscoverableEntity,
  type JasimEntityDirectory,
} from "../../api/core/jasim-network-connectors";

const checkedAt = new Date().toISOString();

class FakeConnector implements RuntimeConnector {
  readonly calls: Array<{ inputs: Record<string, unknown>; context: ConnectorExecutionContext }> = [];
  constructor(readonly manifest: RuntimeConnectorManifest, private readonly output: unknown = { ok: true }) {}
  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    this.calls.push({ inputs, context });
    return this.output;
  }
}

function manifest(input: Partial<RuntimeConnectorManifest> & Pick<RuntimeConnectorManifest, "id" | "capabilities" | "scopes" | "effect">): RuntimeConnectorManifest {
  return {
    name: input.id,
    version: "1.0.0",
    provider: "test",
    requiredPermissions: [],
    trust: { level: "verified", score: 0.9 },
    health: { status: "healthy", checkedAt },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 50,
    estimatedLatencyMs: 100,
    costClass: "free",
    ...input,
  };
}

class FallbackPort implements GeneratedCapabilityExecutionPort {
  calls = 0;
  async describe(capabilityId: string): Promise<ExecutableCapabilityDescriptor> {
    return { capabilityId, risk: "low", sideEffects: [] };
  }
  async invoke(_capabilityId: string, _inputs: Record<string, unknown>, _context: CapabilityExecutionContext): Promise<unknown> {
    this.calls += 1;
    return { simulated: true };
  }
}

class MemoryDirectory implements JasimEntityDirectory {
  entities: DiscoverableEntity[] = [];
  sequence = 0;
  async listDiscoverable(): Promise<DiscoverableEntity[]> {
    return this.entities.filter((entity) => entity.metadata.discoverable === true || ["public", "shared"].includes(String(entity.metadata.visibility)));
  }
  async findById(id: string): Promise<DiscoverableEntity | undefined> {
    return this.entities.find((entity) => entity.id === id);
  }
  async findByIdempotency(type: string, key: string): Promise<DiscoverableEntity | undefined> {
    return this.entities.find((entity) => entity.type === type && entity.metadata.idempotencyKey === key);
  }
  async create(input: Omit<DiscoverableEntity, "id">): Promise<DiscoverableEntity> {
    const entity = { ...input, id: String(++this.sequence) };
    this.entities.push(entity);
    return entity;
  }
}

const executionContext: CapabilityExecutionContext = {
  taskId: 1,
  userId: 2,
  planId: "plan",
  worldId: "world",
  stepId: "step",
  idempotencyKey: "idem",
};

describe("RuntimeConnectorRegistry", () => {
  it("selects by capability, scope, trust and health instead of domain name", () => {
    const registry = new RuntimeConnectorRegistry();
    const internal = new FakeConnector(manifest({ id: "internal", capabilities: [DNA_PRIMITIVES.SEARCH], scopes: ["jasim_internal"], effect: "read", trust: { level: "system", score: 1 } }));
    const web = new FakeConnector(manifest({ id: "web", capabilities: [DNA_PRIMITIVES.SEARCH], scopes: ["public_web"], effect: "read" }));
    registry.register(web);
    registry.register(internal);

    const selected = registry.discover({ capabilityId: DNA_PRIMITIVES.SEARCH, preferredScopes: ["jasim_internal"] });
    expect(selected.map((candidate) => candidate.connector.manifest.id)).toEqual(["internal"]);
  });

  it("fails closed for external personal data and writes without approval", () => {
    const registry = new RuntimeConnectorRegistry();
    registry.register(new FakeConnector(manifest({
      id: "vision",
      capabilities: [DNA_PRIMITIVES.VISION],
      scopes: ["external_partner"],
      effect: "read",
      sendsUserDataExternally: true,
    })));
    registry.register(new FakeConnector(manifest({
      id: "publisher",
      capabilities: [DNA_PRIMITIVES.LIST],
      scopes: ["jasim_internal"],
      effect: "write",
    })));

    expect(registry.discover({ capabilityId: DNA_PRIMITIVES.VISION, preferredScopes: ["external_partner"] })).toHaveLength(0);
    expect(registry.discover({ capabilityId: DNA_PRIMITIVES.LIST, preferredScopes: ["jasim_internal"] })).toHaveLength(0);
    expect(registry.discover({ capabilityId: DNA_PRIMITIVES.VISION, preferredScopes: ["external_partner"], allowExternalData: true })).toHaveLength(1);
    expect(registry.discover({ capabilityId: DNA_PRIMITIVES.LIST, preferredScopes: ["jasim_internal"], approvalGranted: true })).toHaveLength(1);
  });

  it("opens a failing connector circuit and allows a degraded probe after cooldown", () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const registry = new RuntimeConnectorRegistry({ failureThreshold: 2, circuitOpenMs: 1_000, now: () => clock });
    const connector = new FakeConnector(manifest({ id: "fragile", capabilities: [DNA_PRIMITIVES.SEARCH], scopes: ["jasim_internal"], effect: "read" }));
    registry.register(connector);
    registry.recordFailure("fragile");
    expect(registry.health("fragile")?.status).toBe("degraded");
    registry.recordFailure("fragile");
    expect(registry.health("fragile")?.status).toBe("open");
    expect(registry.discover({ capabilityId: DNA_PRIMITIVES.SEARCH })).toHaveLength(0);

    clock += 1_001;
    expect(registry.discover({ capabilityId: DNA_PRIMITIVES.SEARCH })).toHaveLength(1);
    expect(registry.health("fragile")?.status).toBe("degraded");
    registry.recordSuccess("fragile");
    expect(registry.health("fragile")?.status).toBe("healthy");
  });

  it("never falls back to simulated intelligence for a required real connector", async () => {
    const fallback = new FallbackPort();
    const port = new ConnectorAwareExecutionPort(fallback, new RuntimeConnectorRegistry());
    await expect(port.invoke(DNA_PRIMITIVES.SELL, { connectorScopes: ["jasim_internal"] }, executionContext)).rejects.toThrow(/not simulated/i);
    expect(fallback.calls).toBe(0);
  });

  it("federates read-only search across JASIM and the public web", async () => {
    const registry = new RuntimeConnectorRegistry();
    const internal = new FakeConnector(manifest({ id: "internal", capabilities: [DNA_PRIMITIVES.SEARCH], scopes: ["jasim_internal"], effect: "read" }), { items: [{ id: "inside" }] });
    const web = new FakeConnector(manifest({ id: "web", capabilities: [DNA_PRIMITIVES.SEARCH], scopes: ["public_web"], effect: "read", sendsUserDataExternally: true }), { results: [{ id: "outside" }] });
    registry.register(internal);
    registry.register(web);
    const port = new ConnectorAwareExecutionPort(new FallbackPort(), registry);

    const output = await port.invoke(DNA_PRIMITIVES.SEARCH, {
      query: "ساعة تراثية",
      searchScopes: ["jasim_internal", "public_web"],
      allowExternalData: true,
    }, executionContext) as { result: { items: Array<{ id: string }> }; provenance: unknown[] };

    expect(output.result.items.map((item) => item.id)).toEqual(expect.arrayContaining(["inside", "outside"]));
    expect(output.provenance).toHaveLength(2);
    expect(internal.calls).toHaveLength(1);
    expect(web.calls).toHaveLength(1);
  });

  it("uses nested connector provenance to keep tracking on the selected external provider", async () => {
    const registry = new RuntimeConnectorRegistry();
    const internal = new FakeConnector(manifest({ id: "internal-track", capabilities: [DNA_PRIMITIVES.TRACK], scopes: ["jasim_internal"], effect: "read", trust: { level: "system", score: 1 } }), { status: "internal" });
    const external = new FakeConnector(manifest({ id: "external-track", capabilities: [DNA_PRIMITIVES.TRACK], scopes: ["external_partner"], effect: "read", sendsUserDataExternally: true }), { status: "external" });
    registry.register(internal);
    registry.register(external);
    const port = new ConnectorAwareExecutionPort(new FallbackPort(), registry);

    const output = await port.invoke(DNA_PRIMITIVES.TRACK, {
      target: {
        result: { providerOrderNumber: "JASIM123" },
        provenance: { connectorId: "dispatch", scope: ["external_partner"] },
      },
      connectorScopes: ["jasim_internal", "external_partner"],
      allowExternalData: true,
    }, executionContext) as { result: { status: string } };
    expect(output.result.status).toBe("external");
    expect(external.calls).toHaveLength(1);
    expect(internal.calls).toHaveLength(0);
  });
});

describe("JASIM internal generic connectors", () => {
  it("publishes once, discovers without fixed membership types, and creates a non-payment commitment", async () => {
    const directory = new MemoryDirectory();
    directory.entities.push({
      id: "person-1",
      type: "arbitrary_interested_party",
      name: "مهتم بالساعات التراثية",
      attributes: { intent: "شراء ساعة تراثية" },
      capabilities: ["exchange_interest"],
      reputation: { score: 4.8, reviews: 12, trustLevel: "high" },
      availability: { available: true },
      metadata: { visibility: "shared", ownerUserId: 99 },
    });
    const publisher = new JasimOfferPublisherConnector(directory);
    const discovery = new JasimInternalDiscoveryConnector(directory);
    const commitment = new JasimCommitmentConnector(directory);
    const assignment = new JasimFulfillmentAssignmentConnector(directory);
    const tracking = new JasimProgressTrackingConnector(directory);
    const approvedContext = { ...executionContext, approvalId: "approval-1" };

    const first = await publisher.execute({ presentation: { title: "ساعة الوالد" } }, approvedContext);
    const repeated = await publisher.execute({ presentation: { title: "ساعة الوالد" } }, approvedContext);
    expect(first).toEqual(repeated);
    expect(directory.entities.filter((entity) => entity.type === "generated_offer")).toHaveLength(1);

    const matches = await discovery.execute({ query: "ساعة تراثية" }, executionContext) as { items: unknown[] };
    expect(matches.items.length).toBeGreaterThan(0);

    const result = await commitment.execute({ offer: first, terms: { price: 1000 } }, { ...approvedContext, idempotencyKey: "commit" }) as Record<string, unknown>;
    expect(result.status).toBe("committed_inside_jasim");
    expect(result.paymentTransferred).toBe(false);

    const delegated = await assignment.execute({ assignee: { id: "person-1" }, task: result }, { ...approvedContext, idempotencyKey: "dispatch" }) as Record<string, unknown>;
    expect(delegated.status).toBe("assigned");
    expect(delegated.paymentTransferred).toBe(false);
    const progress = await tracking.execute({ target: delegated }, approvedContext) as Record<string, unknown>;
    expect(progress.status).toBe("assigned");
  });
});
