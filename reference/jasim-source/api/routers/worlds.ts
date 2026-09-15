import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedQuery, router } from "../trpc";
import { db } from "../queries/connection";
import { conversations, tasks } from "@db/schema";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import { ExecutionPlanSchema, WorldDNASchema } from "@contracts/dna";
import { GenerativeBubbleCompiler } from "../core/generative-bubble-compiler";
import { getGeneratedPlanExecutor, getGeneratedWorldService, getTaskRuntime } from "../core/runtime";

async function ownedConversation(ownerId: number, conversationId: number) {
  const conversation = await db.query.conversations.findFirst({ where: and(
    eq(conversations.id, conversationId), eq(conversations.userId, ownerId),
  ) });
  if (!conversation) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
  return conversation;
}

export const worldsRouter = router({
  list: authedQuery
    .input(z.object({
      status: z.enum(["draft", "active", "paused", "deprecated", "archived"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const worlds = await getGeneratedWorldService().list(Number(ctx.user!.id));
      return { worlds: input?.status ? worlds.filter((world) => world.status === input.status) : worlds };
    }),

  get: authedQuery
    .input(z.object({ worldId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const world = await getGeneratedWorldService().get(Number(ctx.user!.id), input.worldId);
      if (!world) throw new TRPCError({ code: "NOT_FOUND", message: "Generated world not found" });
      return { world, bubbles: new GenerativeBubbleCompiler().compile(world.activeWorld) };
    }),

  history: authedQuery
    .input(z.object({ worldId: z.string().min(1) }))
    .query(async ({ ctx, input }) => ({
      versions: await getGeneratedWorldService().history(Number(ctx.user!.id), input.worldId),
    })),

  attach: authedQuery
    .input(z.object({ conversationId: z.string(), worldId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ownerId = Number(ctx.user!.id);
      const conversationId = Number(input.conversationId);
      await ownedConversation(ownerId, conversationId);
      await getGeneratedWorldService().attachConversation(ownerId, conversationId, input.worldId);
      return { attached: true, conversationId: input.conversationId, worldId: input.worldId };
    }),

  detach: authedQuery
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ownerId = Number(ctx.user!.id);
      const conversationId = Number(input.conversationId);
      await ownedConversation(ownerId, conversationId);
      await getGeneratedWorldService().attachConversation(ownerId, conversationId, undefined);
      return { attached: false, conversationId: input.conversationId };
    }),

  requestRollback: authedQuery
    .input(z.object({
      worldId: z.string().min(1),
      targetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
      conversationId: z.string().optional(),
      reason: z.string().min(3).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const ownerId = Number(ctx.user!.id);
      const service = getGeneratedWorldService();
      const system = await service.get(ownerId, input.worldId);
      if (!system) throw new TRPCError({ code: "NOT_FOUND", message: "Generated world not found" });
      const target = (await service.history(ownerId, input.worldId)).find((item) => item.version === input.targetVersion);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target world version not found" });
      const conversationId = input.conversationId ? Number(input.conversationId) : system.conversationId;
      if (conversationId) await ownedConversation(ownerId, conversationId);
      const rollbackWorld = WorldDNASchema.parse({
        ...target.world,
        id: system.worldKey,
        version: system.version,
        lineage: {
          parentWorldId: system.worldKey,
          parentVersion: system.version,
          changeRequest: `Rollback to ${target.version}: ${input.reason}`,
        },
      });
      const plan = ExecutionPlanSchema.parse({
        id: `world_rollback_${randomUUID()}`,
        name: `Rollback ${system.name} to ${target.version}`,
        description: input.reason,
        steps: [
          {
            id: "confirm_world_rollback",
            name: `Confirm rollback to ${target.version}`,
            capabilityId: DNA_PRIMITIVES.CONFIRM,
            inputs: { worldId: system.worldKey, fromVersion: system.version, targetVersion: target.version },
            dependencies: [],
            risk: "high",
            requiresApproval: true,
            verification: { type: "manual", config: { actor: "user" } },
          },
          {
            id: "persist_world_rollback",
            name: `Persist rollback of ${system.name}`,
            capabilityId: DNA_PRIMITIVES.PERSIST,
            inputs: { world: rollbackWorld, conversationId },
            dependencies: ["confirm_world_rollback"],
            risk: "high",
            requiresApproval: true,
            verification: { type: "schema", config: { required: ["worldId", "version"] } },
          },
        ],
        edges: [{ from: "confirm_world_rollback", to: "persist_world_rollback" }],
        onFailure: "stop",
        maxRetries: 0,
        worldId: system.worldKey,
        generatedAt: new Date().toISOString(),
      });
      const task = await getTaskRuntime().createTask(plan.name, ownerId, conversationId);
      await db.update(tasks).set({
        plan: plan as unknown as Record<string, unknown>,
        context: { world: rollbackWorld, rollbackTargetVersion: target.version },
        status: "running",
      }).where(eq(tasks.id, Number(task.id)));
      const execution = await getGeneratedPlanExecutor().execute({
        taskId: Number(task.id), userId: ownerId, plan, worldId: system.worldKey,
      });
      return { taskId: String(task.id), execution };
    }),
});
