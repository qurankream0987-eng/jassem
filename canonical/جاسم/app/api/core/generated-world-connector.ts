import { DNA_PRIMITIVES } from "@contracts/jasim";
import { WorldDNASchema } from "@contracts/dna";
import type {
  ConnectorExecutionContext,
  ConnectorReconciliationResult,
  RuntimeConnector,
  RuntimeConnectorManifest,
} from "@contracts/runtime-connector";
import type { GeneratedWorldService } from "./generated-world-service";

export class GeneratedWorldPersistenceConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.internal.generated-world-persistence.v1",
    name: "Versioned generated world persistence",
    version: "1.0.0",
    provider: "jasim",
    capabilities: [DNA_PRIMITIVES.PERSIST],
    scopes: ["jasim_internal"],
    effect: "write",
    requiredPermissions: [],
    trust: { level: "system", score: 1 },
    health: { status: "healthy", checkedAt: new Date().toISOString() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 100,
    estimatedLatencyMs: 30,
    costClass: "free",
  };

  constructor(private readonly worlds: GeneratedWorldService) {}

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    if (!context.approvalId) throw Object.assign(new Error("Generated world persistence requires scoped user approval"), { countsTowardCircuit: false });
    const world = WorldDNASchema.parse(inputs.world);
    if (world.continuity === "ephemeral") throw Object.assign(new Error("Ephemeral worlds cannot enter persistent storage"), { countsTowardCircuit: false });
    const conversationId = typeof inputs.conversationId === "number" && Number.isInteger(inputs.conversationId)
      ? inputs.conversationId
      : undefined;
    try {
      return await this.worlds.persistApproved({
        world,
        ownerId: context.userId,
        taskId: context.taskId,
        conversationId,
        changeRequest: world.lineage.changeRequest ?? world.generatedFrom,
        requestKey: context.idempotencyKey,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/archived|ephemeral|not found|already exists/i.test(message)) {
        throw Object.assign(new Error(message), { countsTowardCircuit: false });
      }
      throw Object.assign(new Error("Generated world persistence outcome requires reconciliation"), {
        outcomeUncertain: true,
        countsTowardCircuit: false,
        cause: error,
      });
    }
  }

  reconciliationData(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Record<string, unknown> {
    const parsed = WorldDNASchema.safeParse(inputs.world);
    const worldKey = parsed.success ? parsed.data.lineage.parentWorldId ?? parsed.data.id : context.worldId;
    return { worldKey, requestKey: context.idempotencyKey };
  }

  providerReference(result: unknown): string | undefined {
    if (!result || typeof result !== "object") return undefined;
    const value = (result as Record<string, unknown>).worldId;
    return typeof value === "string" ? value : undefined;
  }

  async reconcile(data: Record<string, unknown>, context: ConnectorExecutionContext): Promise<ConnectorReconciliationResult> {
    const worldKey = typeof data.worldKey === "string" ? data.worldKey : undefined;
    const requestKey = typeof data.requestKey === "string" ? data.requestKey : undefined;
    if (!worldKey || !requestKey) return { status: "not_found", reason: "missing_world_reconciliation_key" };
    const version = await this.worlds.hasRequestKey(context.userId, worldKey, requestKey);
    if (!version) return { status: "not_found" };
    return {
      status: "confirmed_success",
      providerReference: worldKey,
      result: { worldId: worldKey, version: version.version, status: version.status },
    };
  }
}
