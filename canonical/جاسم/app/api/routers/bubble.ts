/**
 * JASIM — Bubble Management Router
 *
 * Handles JASIM bubbles: persistent interactive UI units
 * that can be shown/hidden/updated independently of messages.
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { bubbles } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  JasimError,
  NotFoundError,
  ValidationError,
  ERROR_CODES,
} from "@contracts/errors";

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
// Bubble Router
// ═══════════════════════════════════════════════════════════════════════════════

export const bubbleRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // list — List active bubbles for user
  // ═══════════════════════════════════════════════════════════════════════════
  list: authedQuery
    .input(z.object({
      status: z.enum(["active", "minimized", "closed"]).optional(),
      type: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const limit = input?.limit ?? 50;
        const offset = input?.offset ?? 0;

        const conditions = [eq(bubbles.userId, userId)];
        if (input?.status) conditions.push(eq(bubbles.status, input.status));
        if (input?.type) conditions.push(eq(bubbles.type, input.type));

        const bubbleList = await db.select().from(bubbles)
          .where(and(...conditions))
          .limit(limit)
          .offset(offset)
          .orderBy(desc(bubbles.updatedAt));

        return { bubbles: bubbleList };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // get — Get bubble by ID
  // ═══════════════════════════════════════════════════════════════════════════
  get: authedQuery
    .input(z.object({
      bubbleId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const bubbleId = Number(input.bubbleId);

        const bubble = await db.select().from(bubbles)
          .where(eq(bubbles.id, bubbleId))
          .limit(1);

        if (!bubble[0] || bubble[0].userId !== userId) {
          throw new NotFoundError("Bubble", input.bubbleId);
        }

        return { bubble: bubble[0] };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // create — Create bubble from schema
  // ═══════════════════════════════════════════════════════════════════════════
  create: authedQuery
    .input(z.object({
      type: z.string().min(1),
      label: z.string().min(1),
      schema: z.record(z.string(), z.unknown()).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
      taskId: z.string().optional(),
      conversationId: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);

        const [result] = await db.insert(bubbles).values({
          userId,
          type: input.type,
          label: input.label,
          schema: input.schema ?? {},
          data: input.data ?? {},
          taskId: input.taskId ? Number(input.taskId) : undefined,
          conversationId: input.conversationId ? Number(input.conversationId) : undefined,
          status: "active",
          metadata: input.metadata ?? {},
        }).returning();

        const bubble = await db.select().from(bubbles)
          .where(eq(bubbles.id, Number(result.id)))
          .limit(1);

        return { bubble: bubble[0] };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // update — Update bubble data/schema/label
  // ═══════════════════════════════════════════════════════════════════════════
  update: authedQuery
    .input(z.object({
      bubbleId: z.string(),
      label: z.string().optional(),
      schema: z.record(z.string(), z.unknown()).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const bubbleId = Number(input.bubbleId);

        const [existing] = await db.select().from(bubbles)
          .where(eq(bubbles.id, bubbleId))
          .limit(1);

        if (!existing || existing.userId !== userId) {
          throw new NotFoundError("Bubble", input.bubbleId);
        }

        const updates: Record<string, unknown> = {};
        if (input.label !== undefined) updates.label = input.label;
        if (input.schema !== undefined) updates.schema = input.schema;
        if (input.data !== undefined) updates.data = input.data;
        if (input.metadata !== undefined) updates.metadata = input.metadata;
        updates.updatedAt = new Date();

        await db.update(bubbles).set(updates).where(eq(bubbles.id, bubbleId));

        const updated = await db.select().from(bubbles)
          .where(eq(bubbles.id, bubbleId))
          .limit(1);

        return { bubble: updated[0] };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // close — Close a bubble (mark as closed)
  // ═══════════════════════════════════════════════════════════════════════════
  close: authedQuery
    .input(z.object({
      bubbleId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const bubbleId = Number(input.bubbleId);

        const [existing] = await db.select().from(bubbles)
          .where(eq(bubbles.id, bubbleId))
          .limit(1);

        if (!existing || existing.userId !== userId) {
          throw new NotFoundError("Bubble", input.bubbleId);
        }

        await db.update(bubbles).set({
          status: "closed",
          updatedAt: new Date(),
        }).where(eq(bubbles.id, bubbleId));

        return { success: true, bubbleId: input.bubbleId };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // minimize — Minimize a bubble
  // ═══════════════════════════════════════════════════════════════════════════
  minimize: authedQuery
    .input(z.object({
      bubbleId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const bubbleId = Number(input.bubbleId);

        const [existing] = await db.select().from(bubbles)
          .where(eq(bubbles.id, bubbleId))
          .limit(1);

        if (!existing || existing.userId !== userId) {
          throw new NotFoundError("Bubble", input.bubbleId);
        }

        await db.update(bubbles).set({
          status: "minimized",
          updatedAt: new Date(),
        }).where(eq(bubbles.id, bubbleId));

        return { success: true, bubbleId: input.bubbleId };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // activate — Activate a minimized/closed bubble
  // ═══════════════════════════════════════════════════════════════════════════
  activate: authedQuery
    .input(z.object({
      bubbleId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const bubbleId = Number(input.bubbleId);

        const [existing] = await db.select().from(bubbles)
          .where(eq(bubbles.id, bubbleId))
          .limit(1);

        if (!existing || existing.userId !== userId) {
          throw new NotFoundError("Bubble", input.bubbleId);
        }

        await db.update(bubbles).set({
          status: "active",
          updatedAt: new Date(),
        }).where(eq(bubbles.id, bubbleId));

        return { success: true, bubbleId: input.bubbleId };
      } catch (err) {
        handleJasimError(err);
      }
    }),
});
