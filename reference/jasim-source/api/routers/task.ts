/**
 * JASIM — Task Management Router
 *
 * Lifecycle management for JASIM tasks: create, execute, pause,
 * resume, cancel, retry, approve, provideInput, getSteps.
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { tasks, taskSteps, messages } from "@db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { getTaskRuntime, getPlanner, getCytoplasmInstance, getGeneratedPlanExecutor } from "../core/runtime";
import { ExecutionPlanSchema } from "@contracts/dna";
import {
  JasimError,
  TaskError,
  NotFoundError,
  ValidationError,
  ERROR_CODES,
} from "@contracts/errors";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
} from "@contracts/jasim";

function handleJasimError(err: unknown): never {
  if (err instanceof JasimError) {
    throw new TRPCError({
      code: err.statusCode === 404 ? "NOT_FOUND" : err.statusCode === 400 ? "BAD_REQUEST" : err.statusCode === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof Error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown error" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Task Router
// ═══════════════════════════════════════════════════════════════════════════════

export const taskRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // create — Create a task from a goal
  // ═══════════════════════════════════════════════════════════════════════════
  create: authedQuery
    .input(z.object({
      goal: z.string().min(1, "Goal is required"),
      conversationId: z.string().optional(),
      priority: z.enum(["critical", "high", "normal", "low"]).optional().default("normal"),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const convId = input.conversationId ? Number(input.conversationId) : undefined;

        const taskRuntime = getTaskRuntime();
        const task = await taskRuntime.createTask(input.goal, userId, convId);

        // Override priority if specified
        if (input.priority !== "normal") {
          await db.update(tasks)
            .set({ priority: input.priority })
            .where(eq(tasks.id, task.id));
          task.priority = input.priority;
        }

        if (input.metadata) {
          await db.update(tasks)
            .set({ metadata: input.metadata })
            .where(eq(tasks.id, task.id));
        }

        return { task };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // get — Get task by ID
  // ═══════════════════════════════════════════════════════════════════════════
  get: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const taskRuntime = getTaskRuntime();
        const task = await taskRuntime.getTask(taskId);

        if (task.userId !== userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Not your task" });
        }

        return { task };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // list — List user tasks with optional filters
  // ═══════════════════════════════════════════════════════════════════════════
  list: authedQuery
    .input(z.object({
      status: z.enum([
        "pending", "planning", "running", "paused", "completed",
        "failed", "cancelled", "waiting_approval", "waiting_input",
      ]).optional(),
      priority: z.enum(["critical", "high", "normal", "low"]).optional(),
      goal: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const limit = input?.limit ?? 20;
        const offset = input?.offset ?? 0;

        const conditions = [eq(tasks.userId, userId)];
        if (input?.status) {
          conditions.push(eq(tasks.status, input.status));
        }
        if (input?.priority) {
          conditions.push(eq(tasks.priority, input.priority));
        }
        if (input?.goal) {
          conditions.push(eq(tasks.goal, input.goal));
        }

        const taskList = await db.select().from(tasks)
          .where(and(...conditions))
          .limit(limit)
          .offset(offset)
          .orderBy(desc(tasks.createdAt));

        return { tasks: taskList };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // execute — Execute a task plan by ID
  // ═══════════════════════════════════════════════════════════════════════════
  execute: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.executePlan(taskId);
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // pause — Pause task execution
  // ═══════════════════════════════════════════════════════════════════════════
  pause: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.pause(taskId);
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // resume — Resume task execution
  // ═══════════════════════════════════════════════════════════════════════════
  resume: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.resume(taskId);
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // cancel — Cancel a task
  // ═══════════════════════════════════════════════════════════════════════════
  cancel: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.transition(taskId, TASK_STATUSES.CANCELLED, { reason: "user_cancelled" });
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // retry — Retry a failed/cancelled task
  // ═══════════════════════════════════════════════════════════════════════════
  retry: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        // Reset to pending and re-execute
        await db.update(tasks)
          .set({ status: TASK_STATUSES.PENDING, outputs: {} })
          .where(eq(tasks.id, taskId));

        const taskRuntime = getTaskRuntime();
        const updated = await taskRuntime.executePlan(taskId);
        return { task: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // approve — Approve a pending action in a task
  // ═══════════════════════════════════════════════════════════════════════════
  approve: authedQuery
    .input(z.object({
      taskId: z.string(),
      stepId: z.string(),
      decision: z.boolean(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);
        const stepId = Number(input.stepId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const [stepRow] = await db.select().from(taskSteps)
          .where(and(eq(taskSteps.id, stepId), eq(taskSteps.taskId, taskId)))
          .limit(1);
        if (!stepRow) {
          throw new NotFoundError("TaskStep", input.stepId);
        }

        if (stepRow.status !== "pending") {
          throw new ValidationError(ERROR_CODES.INVALID_REQUEST, "Step is not in pending state");
        }

        const newStatus = input.decision ? "completed" : "failed";
        const completedAt = input.decision ? new Date() : undefined;

        await db.update(taskSteps).set({
          status: newStatus,
          result: input.decision
            ? { approved: true, reason: input.reason }
            : { approved: false, reason: input.reason ?? "User rejected" },
          completedAt,
        }).where(eq(taskSteps.id, stepId));

        const [updatedStep] = await db.select().from(taskSteps).where(eq(taskSteps.id, stepId)).limit(1);
        return { step: updatedStep };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // provideInput — Provide requested input for a step
  // ═══════════════════════════════════════════════════════════════════════════
  provideInput: authedQuery
    .input(z.object({
      taskId: z.string(),
      stepId: z.string(),
      input: z.record(z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);
        const stepId = Number(input.stepId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const [stepRow] = await db.select().from(taskSteps)
          .where(and(eq(taskSteps.id, stepId), eq(taskSteps.taskId, taskId)))
          .limit(1);
        if (!stepRow) {
          throw new NotFoundError("TaskStep", input.stepId);
        }

        if (stepRow.status !== "waiting_input") {
          throw new ValidationError(ERROR_CODES.INVALID_REQUEST, "Step is not waiting for input");
        }

        await db.update(taskSteps).set({
          status: "completed",
          result: input.input,
          completedAt: new Date(),
        }).where(eq(taskSteps.id, stepId));

        // Resume task if it was waiting
        if (taskRow.status === "waiting_input") {
          const taskRuntime = getTaskRuntime();
          await taskRuntime.transition(taskId, TASK_STATUSES.PENDING);
          const updated = await taskRuntime.executePlan(taskId);
          return { step: stepRow, task: updated };
        }

        const [updatedStep] = await db.select().from(taskSteps).where(eq(taskSteps.id, stepId)).limit(1);
        return { step: updatedStep };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // Data requested by a connector-selected, generated runtime bubble. The
  // request id binds values to one plan step; sensitive fields are encrypted.
  provideGeneratedInput: authedQuery
    .input(z.object({
      taskId: z.string(),
      requestId: z.string().uuid(),
      values: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);
        const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
        if (!task || task.userId !== userId) throw new NotFoundError("Task", input.taskId);
        const plan = ExecutionPlanSchema.safeParse(task.plan);
        if (!plan.success) {
          throw new ValidationError(ERROR_CODES.INVALID_REQUEST, "The generated plan cannot be resumed safely");
        }
        const context = task.context as Record<string, unknown> | null;
        const world = context?.world as Record<string, unknown> | undefined;
        const execution = await getGeneratedPlanExecutor().provideInput({
          taskId,
          userId,
          plan: plan.data,
          worldId: typeof world?.id === "string" ? world.id : undefined,
          requestId: input.requestId,
          values: input.values,
        });
        return { execution, bubble: execution.pendingInput?.bubble };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // getSteps — Get all steps for a task
  // ═══════════════════════════════════════════════════════════════════════════
  getSteps: authedQuery
    .input(z.object({
      taskId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const steps = await db.select().from(taskSteps)
          .where(eq(taskSteps.taskId, taskId))
          .orderBy(taskSteps.sequence);

        return { steps };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // update — Update task metadata
  // ═══════════════════════════════════════════════════════════════════════════
  update: authedQuery
    .input(z.object({
      taskId: z.string(),
      goal: z.string().optional(),
      priority: z.enum(["critical", "high", "normal", "low"]).optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const taskId = Number(input.taskId);

        const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        if (!taskRow || taskRow.userId !== userId) {
          throw new NotFoundError("Task", input.taskId);
        }

        const updates: Record<string, unknown> = {};
        if (input.goal !== undefined) updates.goal = input.goal;
        if (input.priority !== undefined) updates.priority = input.priority;
        if (input.metadata !== undefined) updates.metadata = input.metadata;

        await db.update(tasks).set(updates).where(eq(tasks.id, taskId));

        const updated = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
        return { task: updated[0] };
      } catch (err) {
        handleJasimError(err);
      }
    }),
});
