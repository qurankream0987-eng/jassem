import { describe, expect, it } from "vitest";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import { parseDeterministicIntent } from "../../api/core/deterministic-intent";
import { DynamicRuntimeComposer } from "../../api/core/dynamic-runtime-composer";
import {
  GeneratedPlanExecutor,
  type CapabilityExecutionContext,
  type ExecutableCapabilityDescriptor,
  type GeneratedCapabilityExecutionPort,
} from "../../api/core/generated-plan-executor";
import { MemoryGeneratedExecutionStore } from "../../api/core/generated-execution-store";

class RecordingCapabilityPort implements GeneratedCapabilityExecutionPort {
  readonly calls: Array<{ capabilityId: string; inputs: Record<string, unknown>; context: CapabilityExecutionContext }> = [];

  async describe(capabilityId: string): Promise<ExecutableCapabilityDescriptor> {
    const sideEffecting = [DNA_PRIMITIVES.LIST, DNA_PRIMITIVES.SELL, DNA_PRIMITIVES.BUY, DNA_PRIMITIVES.PERSIST].includes(capabilityId as never);
    return {
      registryId: `registry:${capabilityId}`,
      capabilityId,
      risk: sideEffecting ? "high" : "low",
      sideEffects: sideEffecting ? [{ type: "external_change", reversible: false }] : [],
    };
  }

  async invoke(capabilityId: string, inputs: Record<string, unknown>, context: CapabilityExecutionContext): Promise<unknown> {
    this.calls.push({ capabilityId, inputs, context });
    return { capabilityId, ok: true, inputs, reference: `${capabilityId}:${this.calls.length}` };
  }
}

function watchPlan() {
  const intent = parseDeterministicIntent(
    "أريد بيع ساعة والدي، سأرسل صورة وأريد من جاسم تقييم السعر وإيجاد المهتمين",
  );
  return new DynamicRuntimeComposer().compose(intent);
}

describe("GeneratedPlanExecutor", () => {
  it("generates a scoped input bubble, encrypts sensitive values, and resumes the same step", async () => {
    class InputAwarePort extends RecordingCapabilityPort {
      async inputRequirements(_capabilityId: string, inputs: Record<string, unknown>) {
        const delivery = inputs.delivery as Record<string, unknown> | undefined;
        if (typeof delivery?.phone === "string") return undefined;
        return {
          connectorId: "test.delivery.v1",
          capabilityId: DNA_PRIMITIVES.DELEGATE,
          title: "Delivery details",
          submitLabel: "Continue",
          fields: [{
            path: "delivery.phone",
            label: "Phone",
            type: "phone" as const,
            required: true,
            sensitive: true,
            purpose: "Contact the recipient",
          }],
        };
      }
    }

    const port = new InputAwarePort();
    const store = new MemoryGeneratedExecutionStore();
    const executor = new GeneratedPlanExecutor(port, store);
    const plan = {
      id: "input-plan",
      name: "Input plan",
      steps: [{
        id: "dispatch",
        name: "Dispatch",
        capabilityId: DNA_PRIMITIVES.DELEGATE,
        inputs: { delivery: {} },
        outputs: {},
        dependencies: [],
        parallel: false,
        optional: false,
        risk: "low" as const,
        requiresApproval: false,
        verification: { type: "none" as const, config: {} },
      }],
      edges: [],
      onFailure: "stop" as const,
      maxRetries: 0,
    };
    const execution = { taskId: 50, userId: 11, plan };

    const waiting = await executor.execute(execution);
    expect(waiting.status).toBe("waiting_input");
    expect(waiting.pendingInput?.bubble.type).toBe("form");
    expect(waiting.pendingInput?.fields[0]?.path).toBe("delivery.phone");
    expect(port.calls).toHaveLength(0);

    const completed = await executor.provideInput({
      ...execution,
      requestId: waiting.pendingInput!.id,
      values: { delivery: { phone: "+966500000000" } },
    });
    expect(completed.status).toBe("completed");
    expect(port.calls[0]?.inputs).toEqual({ delivery: { phone: "+966500000000" } });
    const stored = await store.load(50, "input-plan");
    expect(JSON.stringify(stored)).not.toContain("+966500000000");
    expect(stored?.collectedInputs.dispatch?.secretRef).toBeTruthy();
  });

  it("resumes a generated sale through scoped approvals without duplicating external effects", async () => {
    const composition = watchPlan();
    const port = new RecordingCapabilityPort();
    const store = new MemoryGeneratedExecutionStore();
    const executor = new GeneratedPlanExecutor(port, store);
    const input = { taskId: 41, userId: 7, plan: composition.plan, worldId: composition.world.id };

    const beforePublishing = await executor.execute(input);
    expect(beforePublishing.status).toBe("waiting_approval");
    expect(beforePublishing.pendingAction?.stepId).toBe("step_confirm_commitment");
    expect(beforePublishing.pendingAction?.authorizedStepIds).toContain("step_publish_offer");
    expect(beforePublishing.pendingAction?.authorizedStepIds).not.toContain("step_commit_exchange");
    expect(port.calls.some((call) => call.capabilityId === DNA_PRIMITIVES.LIST)).toBe(false);

    const beforeSale = await executor.decideApproval({
      ...input,
      approvalId: beforePublishing.pendingAction!.approvalId,
      approved: true,
    });
    expect(beforeSale.status).toBe("waiting_approval");
    expect(beforeSale.pendingAction?.stepId).toBe("step_confirm_exchange");
    expect(port.calls.filter((call) => call.capabilityId === DNA_PRIMITIVES.LIST)).toHaveLength(1);
    expect(port.calls.some((call) => call.capabilityId === DNA_PRIMITIVES.SELL)).toBe(false);

    const completed = await executor.decideApproval({
      ...input,
      approvalId: beforeSale.pendingAction!.approvalId,
      approved: true,
    });
    expect(completed.status).toBe("completed");
    expect(port.calls.filter((call) => call.capabilityId === DNA_PRIMITIVES.SELL)).toHaveLength(1);

    const repeated = await executor.execute(input);
    expect(repeated.status).toBe("completed");
    expect(port.calls.filter((call) => call.capabilityId === DNA_PRIMITIVES.LIST)).toHaveLength(1);
    expect(port.calls.filter((call) => call.capabilityId === DNA_PRIMITIVES.SELL)).toHaveLength(1);
  });

  it("stops permanently when the owner rejects an approval", async () => {
    const composition = watchPlan();
    const port = new RecordingCapabilityPort();
    const executor = new GeneratedPlanExecutor(port, new MemoryGeneratedExecutionStore());
    const input = { taskId: 42, userId: 8, plan: composition.plan, worldId: composition.world.id };

    const waiting = await executor.execute(input);
    const rejected = await executor.decideApproval({
      ...input,
      approvalId: waiting.pendingAction!.approvalId,
      approved: false,
      reason: "السعر غير مناسب",
    });

    expect(rejected.status).toBe("rejected");
    expect(rejected.error).toBe("السعر غير مناسب");
    expect(port.calls.some((call) => call.capabilityId === DNA_PRIMITIVES.LIST)).toBe(false);
    expect(port.calls.some((call) => call.capabilityId === DNA_PRIMITIVES.SELL)).toBe(false);
  });

  it("rejects a decision from a different user", async () => {
    const composition = watchPlan();
    const executor = new GeneratedPlanExecutor(new RecordingCapabilityPort(), new MemoryGeneratedExecutionStore());
    const input = { taskId: 43, userId: 9, plan: composition.plan, worldId: composition.world.id };
    const waiting = await executor.execute(input);

    await expect(executor.decideApproval({
      ...input,
      userId: 10,
      approvalId: waiting.pendingAction!.approvalId,
      approved: true,
    })).rejects.toThrow(/belong/i);
  });
});
