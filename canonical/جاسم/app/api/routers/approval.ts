/** Human decisions for generated-runtime side-effect boundaries. */

import { router, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { approvals, tasks } from "@db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { ExecutionPlanSchema } from "@contracts/dna";
import { getGeneratedPlanExecutor } from "../core/runtime";

type ApprovalRow = typeof approvals.$inferSelect;

function statusOf(row: ApprovalRow): "pending" | "approved" | "rejected" | "expired" {
  if (row.approved === true) return "approved";
  if (row.approved === false) return "rejected";
  if (row.expiresAt && row.expiresAt <= new Date()) return "expired";
  return "pending";
}

function present(row: ApprovalRow) {
  const metadata = row.metadata as Record<string, unknown> | null;
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    stepId: String(metadata?.stepId ?? row.stepId ?? ""),
    type: String(metadata?.capabilityName ?? row.permission ?? "generated_action"),
    title: row.action,
    description: typeof metadata?.description === "string" ? metadata.description : row.action,
    status: statusOf(row),
    riskLevel: row.riskLevel,
    authorizedStepIds: Array.isArray(metadata?.authorizedStepIds) ? metadata.authorizedStepIds : [],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    decidedAt: row.approvedAt,
    metadata: metadata ?? {},
  };
}

async function ownedTask(taskId: number, userId: number) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  if (task.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your approval" });
  return task;
}

export const approvalRouter = router({
  list: authedQuery
    .input(z.object({
      status: z.enum(["pending", "approved", "rejected", "expired"]).optional().default("pending"),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const userTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, userId));
      if (userTasks.length === 0) return { approvals: [], total: 0 };
      const rows = await db.select().from(approvals)
        .where(inArray(approvals.taskId, userTasks.map((task) => task.id)))
        .orderBy(desc(approvals.createdAt));
      const status = input?.status ?? "pending";
      const filtered = rows.filter((row) => statusOf(row) === status).map(present);
      const offset = input?.offset ?? 0;
      const limit = input?.limit ?? 20;
      return { approvals: filtered.slice(offset, offset + limit), total: filtered.length };
    }),

  get: authedQuery
    .input(z.object({ approvalId: z.string() }))
    .query(async ({ ctx, input }) => {
      const id = Number(input.approvalId);
      const row = await db.query.approvals.findFirst({ where: eq(approvals.id, id) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Approval not found" });
      await ownedTask(row.taskId, Number(ctx.user!.id));
      return { approval: present(row) };
    }),

  process: authedQuery
    .input(z.object({
      approvalId: z.string(),
      decision: z.boolean(),
      reason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const approvalId = Number(input.approvalId);
      const row = await db.query.approvals.findFirst({ where: eq(approvals.id, approvalId) });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Approval not found" });
      const task = await ownedTask(row.taskId, userId);
      if (statusOf(row) !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Approval is no longer pending" });
      }
      const plan = ExecutionPlanSchema.safeParse(task.plan);
      if (!plan.success) {
        throw new TRPCError({ code: "CONFLICT", message: "The generated plan cannot be resumed safely" });
      }
      const metadata = row.metadata as Record<string, unknown> | null;
      const execution = await getGeneratedPlanExecutor().decideApproval({
        approvalId: input.approvalId,
        taskId: task.id,
        userId,
        approved: input.decision,
        reason: input.reason,
        plan: plan.data,
        worldId: typeof metadata?.worldId === "string" ? metadata.worldId : undefined,
      });
      const updated = await db.query.approvals.findFirst({ where: eq(approvals.id, approvalId) });
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Approval update failed" });
      return { approval: present(updated), execution };
    }),
});
