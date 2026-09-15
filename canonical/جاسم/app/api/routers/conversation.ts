/**
 * JASIM — Conversation / Chat Router
 *
 * Manages conversation lifecycle and message sending.
 * sendMessage delegates to the JASIM orchestration engine.
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { conversations, messages, tasks } from "@db/schema";
import { eq, desc, and, like, or } from "drizzle-orm";
import {
  getTaskRuntime,
  getPlanner,
  getCapabilityRegistry,
} from "../core/runtime";
import { IntentEngine } from "../core/intent-engine";
import {
  JasimError,
  NotFoundError,
  ValidationError,
  ERROR_CODES,
} from "@contracts/errors";
import { TASK_STATUSES } from "@contracts/jasim";

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
// Conversation Router
// ═══════════════════════════════════════════════════════════════════════════════

export const conversationRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // create — Create a new conversation
  // ═══════════════════════════════════════════════════════════════════════════
  create: authedQuery
    .input(z.object({
      title: z.string().max(255).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const [result] = await db.insert(conversations).values({
          userId,
          title: input?.title ?? "New conversation",
          status: "active",
          metadata: input?.metadata ?? {},
        }).returning();

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, Number(result.id)),
        });

        if (!conversation) {
          throw new ValidationError(ERROR_CODES.INTERNAL_ERROR, "Failed to create conversation");
        }

        return { conversation };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // list — List user conversations
  // ═══════════════════════════════════════════════════════════════════════════
  list: authedQuery
    .input(z.object({
      status: z.enum(["active", "archived", "closed", "error"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const limit = input?.limit ?? 20;
        const offset = input?.offset ?? 0;

        const conditions = [eq(conversations.userId, userId)];
        if (input?.status) {
          conditions.push(eq(conversations.status, input.status));
        }

        const convs = await db.query.conversations.findMany({
          where: and(...conditions),
          limit,
          offset,
          orderBy: [desc(conversations.updatedAt)],
        });

        return { conversations: convs };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // get — Get conversation by ID with messages
  // ═══════════════════════════════════════════════════════════════════════════
  get: authedQuery
    .input(z.object({
      id: z.string(),
      messageLimit: z.number().min(1).max(200).default(50),
      messageOffset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const convId = Number(input.id);

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, convId),
        });

        if (!conversation || conversation.userId !== userId) {
          throw new NotFoundError("Conversation", input.id);
        }

        const msgs = await db.query.messages.findMany({
          where: eq(messages.conversationId, convId),
          limit: input.messageLimit,
          offset: input.messageOffset,
          orderBy: [desc(messages.createdAt)],
        });

        return {
          conversation: {
            ...conversation,
            messages: msgs,
          },
        };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // sendMessage — Send message in conversation (orchestrates via JASIM)
  // ═══════════════════════════════════════════════════════════════════════════
  sendMessage: authedQuery
    .input(z.object({
      conversationId: z.string(),
      content: z.string().min(1, "Message content is required"),
      attachments: z.array(z.object({
        type: z.enum(["image", "voice", "location", "file"]),
        url: z.string(),
        name: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const convId = Number(input.conversationId);
        const startTime = Date.now();

        // Verify conversation ownership
        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, convId),
        });
        if (!conversation || conversation.userId !== userId) {
          throw new NotFoundError("Conversation", input.conversationId);
        }

        // Save user message
        await db.insert(messages).values({
          conversationId: convId,
          role: "user",
          content: input.content,
          metadata: { attachments: input.attachments },
        });

        // Classify intent
        const intentEngine = new IntentEngine();
        const intent = await intentEngine.classify(input.content, {
          previousMessages: [],
          accumulatedContext: { conversationId: String(convId) },
          userId: String(userId),
        });

        // Create task
        const taskRuntime = getTaskRuntime();
        const task = await taskRuntime.createTask(input.content, userId, convId);

        // Plan
        const planner = getPlanner();
        const capReg = getCapabilityRegistry();
        const availableCaps = await capReg.list({ isActive: true });
        const dag = await planner.plan(input.content, intent, availableCaps);
        await planner.persistPlan(task.id, dag);

        // Update task intent
        await db.update(tasks).set({
          intent: intent.type,
          context: { intent: intent.type, confidence: intent.confidence },
        }).where(eq(tasks.id, task.id));

        // Execute
        let executedTask = task;
        let executionError: string | undefined;
        try {
          executedTask = await taskRuntime.executePlan(task.id);
        } catch (execErr) {
          executionError = execErr instanceof Error ? execErr.message : String(execErr);
        }

        // Generate assistant response
        const assistantContent = `I processed your request as "${intent.type}". Task #${task.id} is ${executedTask.status}. ${executionError ? `Error: ${executionError}` : ""}`;

        // Save assistant message
        const [msgResult] = await db.insert(messages).values({
          conversationId: convId,
          role: "assistant",
          content: assistantContent,
          taskId: task.id,
          intent: intent.type,
          metadata: {
            confidence: intent.confidence,
            executionError,
            durationMs: Date.now() - startTime,
          },
        }).returning();

        // Update conversation timestamp
        await db.update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, convId));

        return {
          message: {
            id: Number(msgResult.id),
            role: "assistant" as const,
            content: assistantContent,
            intent: intent.type,
            taskId: task.id,
            createdAt: new Date(),
          },
          task: {
            id: task.id,
            status: executedTask.status,
            goal: executedTask.goal,
          },
          conversationId: String(convId),
        };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // delete — Delete conversation (soft or hard)
  // ═══════════════════════════════════════════════════════════════════════════
  delete: authedQuery
    .input(z.object({
      id: z.string(),
      permanent: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const convId = Number(input.id);

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, convId),
        });
        if (!conversation || conversation.userId !== userId) {
          throw new NotFoundError("Conversation", input.id);
        }

        if (input.permanent) {
          // Hard delete: messages first, then conversation
          const allMessages = await db.select().from(messages).where(eq(messages.conversationId, convId));
          for (const msg of allMessages) {
            await db.delete(messages).where(eq(messages.id, msg.id));
          }
          await db.delete(conversations).where(eq(conversations.id, convId));
        } else {
          // Soft delete
          await db.update(conversations)
            .set({ status: "closed" })
            .where(eq(conversations.id, convId));
        }

        return { success: true };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // search — Search conversations
  // ═══════════════════════════════════════════════════════════════════════════
  search: authedQuery
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().min(1).max(50).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const query = input.query.toLowerCase();

        // Search conversation titles
        const convs = await db.select().from(conversations)
          .where(eq(conversations.userId, userId));

        const matched = convs.filter((c) =>
          (c.title ?? "").toLowerCase().includes(query) ||
          JSON.stringify(c.context ?? {}).toLowerCase().includes(query)
        );

        // Also search messages for matching conversation IDs
        const msgs = await db.select().from(messages)
          .where(like(messages.content, `%${input.query}%`));
        const msgConvIds = new Set(msgs.map((m) => m.conversationId));

        for (const convId of msgConvIds) {
          if (!matched.some((c) => c.id === convId)) {
            const conv = convs.find((c) => c.id === convId);
            if (conv) matched.push(conv);
          }
        }

        const sliced = matched.slice(input.offset, input.offset + input.limit);
        return { conversations: sliced, total: matched.length };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // update — Update conversation metadata/title
  // ═══════════════════════════════════════════════════════════════════════════
  update: authedQuery
    .input(z.object({
      id: z.string(),
      title: z.string().max(255).optional(),
      status: z.enum(["active", "archived", "closed", "error"]).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const convId = Number(input.id);

        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, convId),
        });
        if (!conversation || conversation.userId !== userId) {
          throw new NotFoundError("Conversation", input.id);
        }

        const updates: Record<string, unknown> = {};
        if (input.title !== undefined) updates.title = input.title;
        if (input.status !== undefined) updates.status = input.status;
        if (input.metadata !== undefined) updates.metadata = input.metadata;

        await db.update(conversations)
          .set(updates)
          .where(eq(conversations.id, convId));

        const updated = await db.query.conversations.findFirst({
          where: eq(conversations.id, convId),
        });

        return { conversation: updated };
      } catch (err) {
        handleJasimError(err);
      }
    }),
});
