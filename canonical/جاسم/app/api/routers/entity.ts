/**
 * JASIM — Generic Entity Router
 *
 * CRUD and matching for generic entities. No domain-specific logic.
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { entities, entityRelationships } from "@db/schema";
import { eq, and, like, desc, or } from "drizzle-orm";
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
// Entity Router
// ═══════════════════════════════════════════════════════════════════════════════

export const entityRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // create — Create a new generic entity
  // ═══════════════════════════════════════════════════════════════════════════
  create: authedQuery
    .input(z.object({
      type: z.string().min(1).max(100),
      name: z.string().min(1).max(500),
      description: z.string().optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
      capabilities: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);

        const [result] = await db.insert(entities).values({
          userId,
          type: input.type,
          name: input.name,
          description: input.description,
          attributes: input.attributes ?? {},
          capabilities: input.capabilities ?? [],
          metadata: { ...input.metadata, createdBy: "api" },
          status: "active",
          activityScore: 0,
          lastInteractionAt: new Date(),
        }).returning();

        const entity = await db.select().from(entities)
          .where(eq(entities.id, Number(result.id)))
          .limit(1);

        return { entity: entity[0] };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // get — Get entity by ID
  // ═══════════════════════════════════════════════════════════════════════════
  get: authedQuery
    .input(z.object({
      id: z.string(),
      includeRelationships: z.boolean().optional().default(false),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const entityId = Number(input.id);

        const entity = await db.query.entities.findFirst({
          where: eq(entities.id, entityId),
        });

        if (!entity || entity.userId !== userId) {
          throw new NotFoundError("Entity", input.id);
        }

        if (input.includeRelationships) {
          const rels = await db.select().from(entityRelationships)
            .where(or(
              eq(entityRelationships.sourceEntityId, entityId),
              eq(entityRelationships.targetEntityId, entityId)
            ));
          return { entity, relationships: rels };
        }

        return { entity };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // list — List entities with optional filters
  // ═══════════════════════════════════════════════════════════════════════════
  list: authedQuery
    .input(z.object({
      type: z.string().optional(),
      name: z.string().optional(),
      status: z.enum(["active", "inactive", "deleted"]).optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const limit = input?.limit ?? 50;
        const offset = input?.offset ?? 0;

        const conditions = [eq(entities.userId, userId)];
        if (input?.type) conditions.push(eq(entities.type, input.type));
        if (input?.name) conditions.push(eq(entities.name, input.name));
        if (input?.status) conditions.push(eq(entities.status, input.status));

        let query = db.select().from(entities).where(and(...conditions));

        // Full-text search override
        if (input?.search) {
          const q = input.search.toLowerCase();
          const all = await db.select().from(entities).where(eq(entities.userId, userId));
          const filtered = all.filter((e) =>
            e.name.toLowerCase().includes(q) ||
            (e.description ?? "").toLowerCase().includes(q) ||
            e.type.toLowerCase().includes(q) ||
            JSON.stringify(e.attributes ?? {}).toLowerCase().includes(q)
          );
          return { entities: filtered.slice(offset, offset + limit), total: filtered.length };
        }

        const all = await query.orderBy(desc(entities.lastInteractionAt));
        const paginated = all.slice(offset, offset + limit);
        return { entities: paginated, total: all.length };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // update — Update entity
  // ═══════════════════════════════════════════════════════════════════════════
  update: authedQuery
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(500).optional(),
      description: z.string().optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
      capabilities: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      status: z.enum(["active", "inactive", "deleted"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const entityId = Number(input.id);

        const entity = await db.query.entities.findFirst({
          where: eq(entities.id, entityId),
        });
        if (!entity || entity.userId !== userId) {
          throw new NotFoundError("Entity", input.id);
        }

        const updates: Record<string, unknown> = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.attributes !== undefined) updates.attributes = input.attributes;
        if (input.capabilities !== undefined) updates.capabilities = input.capabilities;
        if (input.metadata !== undefined) updates.metadata = input.metadata;
        if (input.status !== undefined) updates.status = input.status;
        updates.updatedAt = new Date();
        updates.lastInteractionAt = new Date();

        await db.update(entities).set(updates).where(eq(entities.id, entityId));

        const updated = await db.select().from(entities)
          .where(eq(entities.id, entityId))
          .limit(1);

        return { entity: updated[0] };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // delete — Delete (soft or hard) entity
  // ═══════════════════════════════════════════════════════════════════════════
  delete: authedQuery
    .input(z.object({
      id: z.string(),
      permanent: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);
        const entityId = Number(input.id);

        const entity = await db.query.entities.findFirst({
          where: eq(entities.id, entityId),
        });
        if (!entity || entity.userId !== userId) {
          throw new NotFoundError("Entity", input.id);
        }

        if (input.permanent) {
          // Delete relationships first
          const rels = await db.select().from(entityRelationships)
            .where(or(
              eq(entityRelationships.sourceEntityId, entityId),
              eq(entityRelationships.targetEntityId, entityId)
            ));
          for (const rel of rels) {
            await db.delete(entityRelationships).where(eq(entityRelationships.id, rel.id));
          }
          await db.delete(entities).where(eq(entities.id, entityId));
        } else {
          await db.update(entities)
            .set({ status: "deleted", updatedAt: new Date() })
            .where(eq(entities.id, entityId));
        }

        return { success: true };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // match — Match entities to criteria
  // ═══════════════════════════════════════════════════════════════════════════
  match: authedQuery
    .input(z.object({
      criteria: z.record(z.string(), z.unknown()),
      type: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = Number(ctx.user!.id);

        const conditions = [eq(entities.userId, userId)];
        if (input.type) conditions.push(eq(entities.type, input.type));

        const all = await db.select().from(entities).where(and(...conditions));

        // Simple key-value matching on attributes
        const criteria = input.criteria;
        const matched = all.filter((e) => {
          const attrs = (e.attributes ?? {}) as Record<string, unknown>;
          return Object.entries(criteria).every(([key, value]) => {
            if (key === "name" && typeof value === "string") {
              return e.name.toLowerCase().includes(value.toLowerCase());
            }
            if (key === "type" && typeof value === "string") {
              return e.type.toLowerCase().includes(value.toLowerCase());
            }
            return attrs[key] === value;
          });
        });

        return {
          results: matched.slice(0, input.limit),
          total: matched.length,
        };
      } catch (err) {
        handleJasimError(err);
      }
    }),
});
