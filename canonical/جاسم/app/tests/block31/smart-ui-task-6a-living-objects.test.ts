import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { bubbles, generatedSystems, runs, runtimeTasks } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";
import type { RuntimeWorldRecord } from "@db/schema-runtime";

let handle: TestDbHandle;
let getLivingObjectsProjection: typeof import("../../api/runtime/living-object-projection").getLivingObjectsProjection;

const OWNER_ID = "42";
const FOREIGN_OWNER_ID = "99";

const evolvingTaskWorld = {
  id: "monitor-world",
  version: 1,
  taskDNA: {
    objective: "Monitor a durable condition",
    summary: "A durable monitoring process",
    intentType: "monitor",
    actors: [],
    objects: [],
    actions: ["monitor"],
    constraints: {},
    requiredCapabilities: [],
    confidence: 1,
    interpretationSource: "model-gateway",
    model: { provider: "test", model: "fixture" },
    unresolved: [],
  },
  plan: {
    status: "running",
    summary: "Monitor the condition",
    steps: [],
  },
  world: {
    name: "Monitor world",
    description: "A persistent monitoring context.",
    continuity: "evolving",
    participants: [],
    entities: [],
    capabilities: [],
    policies: [],
  },
  executionContext: [],
} as RuntimeWorldRecord;

beforeAll(async () => {
  handle = await getTestDb();
  ({ getLivingObjectsProjection } = await import(
    "../../api/runtime/living-object-projection"
  ));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE runtime_tasks, runs, bubbles, generated_systems CASCADE
  `));
});

describe("Smart UI Task 6A Living Object projection", () => {
  it("does not create objects for response-only work", async () => {
    const empty = await getLivingObjectsProjection({ ownerId: OWNER_ID });
    expect(empty.objects).toEqual([]);

    const responseOnlyCases = ["simple text", "search only", "comparison", "document summary"];
    for (const ignoredCase of responseOnlyCases) {
      expect(
        (await getLivingObjectsProjection({ ownerId: OWNER_ID, limit: 100 })).objects,
        ignoredCase,
      ).toEqual([]);
    }
  });

  it("projects durable processes, worlds, and persistent bubbles with stable references", async () => {
    const [task] = await handle.db
      .insert(runtimeTasks)
      .values({
        userId: Number(OWNER_ID),
        goal: "Monitor the durable condition",
        status: "running",
        world: evolvingTaskWorld,
        actions: [
          {
            id: "step-1",
            label: "Collect first observation",
            kind: "execute",
            requiresApproval: false,
            status: "completed",
          },
          {
            id: "step-2",
            label: "Continue monitoring",
            kind: "execute",
            requiresApproval: false,
            status: "ready",
          },
        ],
      })
      .returning();

    const [approvalRun] = await handle.db
      .insert(runs)
      .values({
        ownerId: OWNER_ID,
        taskId: task.id,
        goal: "Monitor the durable condition",
        status: "awaiting_approval",
        idempotencyKey: "living-object-approval-run",
      })
      .returning();

    await handle.db.insert(generatedSystems).values({
      ownerId: Number(OWNER_ID),
      worldKey: "persistent-company",
      name: "Persistent company",
      description: "A durable generated world.",
      version: "1.0.0",
      continuity: "persistent",
      visibility: "private",
      status: "active",
    });

    await handle.db.insert(bubbles).values({
      userId: Number(OWNER_ID),
      type: "runtime",
      label: "Persistent process bubble",
      mode: "persistent",
      semanticDescription: "A durable Smart Bubble process.",
      status: "active",
    });

    await handle.db.insert(runtimeTasks).values({
      userId: Number(FOREIGN_OWNER_ID),
      goal: "Foreign process",
      status: "running",
      world: evolvingTaskWorld,
      actions: [],
    });

    const first = await getLivingObjectsProjection({ ownerId: OWNER_ID, limit: 100 });
    const second = await getLivingObjectsProjection({ ownerId: OWNER_ID, limit: 100 });

    expect(first.objects).toHaveLength(3);
    expect(first.objects[0]?.attention.level).toBe("APPROVAL_REQUIRED");

    const process = first.objects.find(
      (object) => object.underlyingReference.kind === "runtime_task",
    );
    expect(process).toMatchObject({
      semanticType: "process",
      status: "WAITING_APPROVAL",
      completion: "not_complete",
      durability: "persistent",
      progress: { completed: 1, total: 2, ratio: 0.5 },
      primaryAction: {
        intent: "approve",
        requiresApproval: true,
        reference: { kind: "runtime_task", id: task.id },
      },
    });
    expect(process?.relatedReferences).toEqual(
      expect.arrayContaining([
        { kind: "runtime_task", id: task.id },
        { kind: "runtime_run", id: approvalRun.id },
      ]),
    );

    const world = first.objects.find(
      (object) => object.underlyingReference.kind === "generated_system",
    );
    expect(world).toMatchObject({
      semanticType: "world",
      status: "ACTIVE",
      completion: "not_complete",
      progress: undefined,
    });

    const bubble = first.objects.find(
      (object) => object.underlyingReference.kind === "smart_bubble",
    );
    expect(bubble).toMatchObject({
      semanticType: "bubble",
      status: "ACTIVE",
      durability: "persistent",
    });

    expect(first.objects.some((object) => object.title === "Foreign process")).toBe(false);
    expect(
      (await getLivingObjectsProjection({ ownerId: OWNER_ID, limit: 1 })).objects,
    ).toHaveLength(1);
    expect(first.objects.map(({ id, underlyingReference, status, relatedReferences }) => ({
      id,
      underlyingReference,
      status,
      relatedReferences,
    }))).toEqual(
      second.objects.map(({ id, underlyingReference, status, relatedReferences }) => ({
        id,
        underlyingReference,
        status,
        relatedReferences,
      })),
    );
  });

  it("deduplicates a task and its run into one user-facing object", async () => {
    const [task] = await handle.db
      .insert(runtimeTasks)
      .values({
        userId: Number(OWNER_ID),
        goal: "Continue the ongoing process",
        status: "running",
        world: evolvingTaskWorld,
        actions: [],
      })
      .returning();

    await handle.db.insert(runs).values({
      ownerId: OWNER_ID,
      taskId: task.id,
      goal: "Continue the ongoing process",
      status: "running",
      idempotencyKey: "living-object-dedup-run",
    });

    const projection = await getLivingObjectsProjection({ ownerId: OWNER_ID });
    expect(projection.objects).toHaveLength(1);
    expect(projection.objects[0]?.underlyingReference).toEqual({
      kind: "runtime_task",
      id: task.id,
    });
    expect(projection.objects[0]?.relatedReferences).toEqual(
      expect.arrayContaining([{ kind: "runtime_run", id: expect.any(String) }]),
    );
  });

  it("derives waiting, failed, and completed attention from canonical status", async () => {
    const [task] = await handle.db
      .insert(runtimeTasks)
      .values({
        userId: Number(OWNER_ID),
        goal: "Review the ongoing process",
        status: "awaiting_input",
        world: evolvingTaskWorld,
        actions: [],
      })
      .returning();

    let projection = await getLivingObjectsProjection({ ownerId: OWNER_ID });
    expect(projection.objects[0]).toMatchObject({
      status: "WAITING_USER",
      attention: { level: "ACTION_REQUIRED" },
      completion: "not_complete",
    });

    await handle.db
      .update(runtimeTasks)
      .set({ status: "failed" })
      .where(eq(runtimeTasks.id, task.id));
    projection = await getLivingObjectsProjection({ ownerId: OWNER_ID });
    expect(projection.objects[0]).toMatchObject({
      status: "FAILED",
      attention: { level: "FAILED" },
      completion: "failed",
    });

    await handle.db
      .update(runtimeTasks)
      .set({ status: "completed" })
      .where(eq(runtimeTasks.id, task.id));
    projection = await getLivingObjectsProjection({ ownerId: OWNER_ID });
    expect(projection.objects[0]).toMatchObject({
      status: "COMPLETED",
      attention: { level: "COMPLETED" },
      completion: "completed",
      durability: "recently_completed",
    });
  });

  it("supports a generic active run without inventing a domain-specific model", async () => {
    await handle.db.insert(runs).values({
      ownerId: OWNER_ID,
      goal: "Continue an active order process",
      status: "running",
      idempotencyKey: "living-object-generic-run",
    });

    const projection = await getLivingObjectsProjection({ ownerId: OWNER_ID });
    expect(projection.objects).toHaveLength(1);
    expect(projection.objects[0]).toMatchObject({
      semanticType: "process",
      status: "RUNNING",
      underlyingReference: { kind: "runtime_run" },
      progress: undefined,
    });
  });
});