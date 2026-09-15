import { describe, expect, it } from "vitest";
import { parseDeterministicIntent } from "../../api/core/deterministic-intent";
import { DynamicRuntimeComposer } from "../../api/core/dynamic-runtime-composer";
import { GeneratedWorldPersistenceConnector } from "../../api/core/generated-world-connector";
import { MemoryGeneratedWorldRepository } from "../../api/core/generated-world-repository";
import { GeneratedWorldService } from "../../api/core/generated-world-service";
import type { ConnectorExecutionContext } from "@contracts/runtime-connector";

function platformComposition(goal = "أنشئ منصة داخل جاسم لمحل ملابس تتطور مع المحادثة") {
  return new DynamicRuntimeComposer().compose(parseDeterministicIntent(goal));
}

describe("versioned generated world lifecycle", () => {
  it("keeps ephemeral task worlds out of persistent system storage", async () => {
    const composition = new DynamicRuntimeComposer().compose(parseDeterministicIntent("أريد بيع ساعة والدي"));
    expect(composition.world.continuity).toBe("ephemeral");
    const service = new GeneratedWorldService(new MemoryGeneratedWorldRepository());
    await expect(service.persistApproved({ world: composition.world, ownerId: 5 })).rejects.toThrow(/ephemeral/i);
    expect(await service.list(5)).toHaveLength(0);
  });

  it("persists an approved evolving world, attaches it to the conversation, and is request-idempotent", async () => {
    const repository = new MemoryGeneratedWorldRepository();
    const service = new GeneratedWorldService(repository);
    const composition = platformComposition();
    const first = await service.persistApproved({
      world: composition.world,
      ownerId: 7,
      taskId: 81,
      conversationId: 91,
      requestKey: "persist-request-1",
    });
    expect(first).toMatchObject({ version: "1.0.0", status: "active", created: true, unchanged: false });
    expect((await service.conversationWorld(7, 91))?.id).toBe(first.worldId);

    const repeated = await service.persistApproved({
      world: composition.world,
      ownerId: 7,
      taskId: 81,
      conversationId: 91,
      requestKey: "persist-request-1",
    });
    expect(repeated).toMatchObject({ versionId: first.versionId, unchanged: true });
    expect(await service.history(7, first.worldId)).toHaveLength(1);
  });

  it("resumes a draft version after an interrupted activation without inventing 1.0.1", async () => {
    class FailActivationOnceRepository extends MemoryGeneratedWorldRepository {
      private shouldFail = true;

      override async activateVersion(...args: Parameters<MemoryGeneratedWorldRepository["activateVersion"]>): Promise<void> {
        if (this.shouldFail) {
          this.shouldFail = false;
          throw new Error("simulated activation interruption");
        }
        await super.activateVersion(...args);
      }
    }

    const service = new GeneratedWorldService(new FailActivationOnceRepository());
    const world = platformComposition().world;
    await expect(service.persistApproved({ world, ownerId: 71, requestKey: "recoverable-request" }))
      .rejects.toThrow(/interruption/);

    const recovered = await service.persistApproved({ world, ownerId: 71, requestKey: "recoverable-request" });
    expect(recovered).toMatchObject({ version: "1.0.0", status: "active", unchanged: true });
    const history = await service.history(71, world.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("active");
  });

  it("evolves the attached world append-only and keeps a structural change history", async () => {
    const repository = new MemoryGeneratedWorldRepository();
    const service = new GeneratedWorldService(repository);
    const initialComposition = platformComposition();
    const initial = await service.persistApproved({ world: initialComposition.world, ownerId: 8, conversationId: 101, requestKey: "initial" });
    const base = await service.conversationWorld(8, 101);
    expect(base).toBeTruthy();

    const evolution = new DynamicRuntimeComposer().compose(
      parseDeterministicIntent("أضف معرضا جديدا للمنتجات المستدامة داخل المنصة"),
      [],
      { baseWorld: base, conversationId: 101 },
    );
    expect(evolution.world.id).toBe(initial.worldId);
    expect(evolution.world.lineage).toMatchObject({ parentWorldId: initial.worldId, parentVersion: "1.0.0" });
    const persistStep = evolution.plan.steps.find((step) => step.capabilityId === "PERSIST");
    expect((persistStep?.inputs.world as { id?: string })?.id).toBe(initial.worldId);

    const evolved = await service.persistApproved({
      world: evolution.world,
      ownerId: 8,
      conversationId: 101,
      changeRequest: "أضف معرضا جديدا للمنتجات المستدامة داخل المنصة",
      requestKey: "evolution-1",
    });
    expect(evolved.version).toBe("1.1.0");
    expect(evolved.changes.some((change) => change.operation === "add")).toBe(true);
    const history = await service.history(8, initial.worldId);
    expect(history.map((item) => item.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(history.filter((item) => item.status === "active")).toHaveLength(1);
  });

  it("operates inside an attached world without creating a persistence step unless structure changes", () => {
    const base = platformComposition().world;
    const operational = new DynamicRuntimeComposer().compose(
      parseDeterministicIntent("اعرض الطلبات المتأخرة ورتبها حسب الأولوية"),
      [],
      { baseWorld: base, conversationId: 101 },
    );
    expect(operational.world.continuity).toBe("ephemeral");
    expect(operational.world.id).not.toBe(base.id);
    expect(operational.world.lineage).toMatchObject({ parentWorldId: base.id, parentVersion: base.version });
    expect(operational.plan.steps.some((step) => step.capabilityId === "PERSIST")).toBe(false);
  });

  it("creates rollback as a new active version instead of mutating history", async () => {
    const service = new GeneratedWorldService(new MemoryGeneratedWorldRepository());
    const initialWorld = platformComposition().world;
    const initial = await service.persistApproved({ world: initialWorld, ownerId: 9, requestKey: "v1" });
    const base = (await service.get(9, initial.worldId))!.activeWorld;
    const evolvedWorld = new DynamicRuntimeComposer().compose(
      parseDeterministicIntent("أضف مساحة للموردين المحليين"), [], { baseWorld: base },
    ).world;
    await service.persistApproved({ world: evolvedWorld, ownerId: 9, requestKey: "v2" });

    const rollback = await service.rollback(9, initial.worldId, "1.0.0", "العودة إلى التصميم الأول");
    expect(rollback.version).toBe("2.0.0");
    const history = await service.history(9, initial.worldId);
    expect(history).toHaveLength(3);
    expect(history[0]?.world.entities).toEqual(history[2]?.world.entities);
  });

  it("creates a new audit version when generated content returns to a retired snapshot", async () => {
    const service = new GeneratedWorldService(new MemoryGeneratedWorldRepository());
    const original = platformComposition().world;
    const first = await service.persistApproved({ world: original, ownerId: 91, requestKey: "history-v1" });
    const active = (await service.get(91, first.worldId))!.activeWorld;
    const evolved = new DynamicRuntimeComposer().compose(
      parseDeterministicIntent("أضف معرضا جديدا للمنتجات المستدامة داخل المنصة"), [], { baseWorld: active },
    ).world;
    const second = await service.persistApproved({ world: evolved, ownerId: 91, requestKey: "history-v2" });
    expect(second.version).toBe("1.1.0");

    const restored = await service.persistApproved({
      world: { ...original, lineage: { parentWorldId: first.worldId, parentVersion: "1.1.0" } },
      ownerId: 91,
      requestKey: "history-v3",
      changeRequest: "استعد التكوين الأول كبنية جديدة",
    });
    expect(restored).toMatchObject({ version: "2.0.0", unchanged: false });
    expect(await service.history(91, first.worldId)).toHaveLength(3);
  });

  it("persists through the scoped connector and reconciles by the deterministic request key", async () => {
    const service = new GeneratedWorldService(new MemoryGeneratedWorldRepository());
    const connector = new GeneratedWorldPersistenceConnector(service);
    const world = platformComposition().world;
    const context: ConnectorExecutionContext = {
      taskId: 100,
      userId: 10,
      planId: "world-plan",
      worldId: world.id,
      stepId: "persist-world",
      idempotencyKey: "b".repeat(64),
      approvalId: "approval-100",
    };
    const result = await connector.execute({ world, conversationId: 111 }, context) as Record<string, unknown>;
    expect(result).toMatchObject({ worldId: world.id, version: "1.0.0", status: "active" });
    expect(await connector.reconcile(connector.reconciliationData({ world }, context), context)).toMatchObject({
      status: "confirmed_success",
      providerReference: world.id,
    });
  });
});
