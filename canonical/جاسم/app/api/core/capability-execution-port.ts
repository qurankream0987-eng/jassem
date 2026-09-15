import { randomUUID } from "node:crypto";
import type {
  CapabilityExecutionContext,
  ExecutableCapabilityDescriptor,
  GeneratedCapabilityExecutionPort,
} from "./generated-plan-executor";

interface RegistryCapability {
  id: number;
  riskLevel: "none" | "low" | "medium" | "high" | "critical";
  sideEffects: unknown;
}

interface CapabilityRegistryPort {
  getByName(name: string): Promise<RegistryCapability>;
  execute(
    capabilityId: number,
    inputs: unknown,
    context: {
      taskId: string;
      stepId: string;
      userId: string;
      correlationId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<unknown>;
}

export class CapabilityRegistryExecutionPort implements GeneratedCapabilityExecutionPort {
  constructor(private readonly registry: CapabilityRegistryPort) {}

  async describe(capabilityId: string): Promise<ExecutableCapabilityDescriptor> {
    const capability = await this.registry.getByName(capabilityId);
    return {
      registryId: String(capability.id),
      capabilityId,
      risk: capability.riskLevel,
      sideEffects: ((capability.sideEffects ?? []) as Array<{ type: string; reversible: boolean }>).map((effect) => ({
        type: effect.type,
        reversible: effect.reversible,
      })),
    };
  }

  async invoke(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<unknown> {
    const capability = await this.registry.getByName(capabilityId);
    return this.registry.execute(capability.id, inputs, {
      taskId: String(context.taskId),
      stepId: context.stepId,
      userId: String(context.userId),
      correlationId: randomUUID(),
      metadata: {
        planId: context.planId,
        worldId: context.worldId,
        idempotencyKey: context.idempotencyKey,
        approvalId: context.approvalId,
        generatedRuntime: true,
      },
    });
  }
}
