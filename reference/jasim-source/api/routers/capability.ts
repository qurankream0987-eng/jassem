/**
 * JASIM — Capability Registry Router
 *
 * Exposes the CapabilityRegistry to the frontend for discovery,
 * listing, filtering, and execution.
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "@db/queries/connection";
import { capabilities } from "@db/schema";
import { eq, and, like } from "drizzle-orm";
import { getCapabilityRegistry, getCytoplasmInstance } from "../core/runtime";
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
// Capability Router
// ═══════════════════════════════════════════════════════════════════════════════

export const capabilityRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // list — List all capabilities with optional filtering
  // ═══════════════════════════════════════════════════════════════════════════
  list: publicQuery
    .input(z.object({
      category: z.string().optional(),
      riskLevel: z.enum(["critical", "high", "medium", "low", "minimal"]).optional(),
      isActive: z.boolean().optional().default(true),
      search: z.string().optional(),
      limit: z.number().min(1).max(200).default(100),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      try {
        const limit = input?.limit ?? 100;
        const offset = input?.offset ?? 0;

        // Use the in-memory registry for speed, but DB for filtering
        const capReg = getCapabilityRegistry();
        const all = await capReg.list({
          category: input?.category,
          riskLevel: input?.riskLevel,
          isActive: input?.isActive,
        });

        let filtered = all;
        if (input?.search) {
          const q = input.search.toLowerCase();
          filtered = all.filter((c) =>
            c.name.toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q)
          );
        }

        const paginated = filtered.slice(offset, offset + limit);
        return { capabilities: paginated, total: filtered.length };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // get — Get capability by ID
  // ═══════════════════════════════════════════════════════════════════════════
  get: publicQuery
    .input(z.object({
      capabilityId: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const capId = Number(input.capabilityId);
        const capReg = getCapabilityRegistry();
        const cap = await capReg.get(capId);
        return { capability: cap };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // discover — Discover capabilities for a goal
  // ═══════════════════════════════════════════════════════════════════════════
  discover: authedQuery
    .input(z.object({
      goal: z.string().min(1, "Goal is required"),
      includeInactive: z.boolean().optional().default(false),
    }))
    .query(async ({ input }) => {
      try {
        const capReg = getCapabilityRegistry();
        const discovered = await capReg.discoverForGoal(input.goal);
        const filtered = input.includeInactive
          ? discovered
          : discovered.filter((c) => c.isActive);
        return { capabilities: filtered };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // execute — Execute a capability directly
  // ═══════════════════════════════════════════════════════════════════════════
  execute: authedQuery
    .input(z.object({
      capabilityId: z.string(),
      inputs: z.record(z.unknown()).default({}),
      timeoutMs: z.number().min(1000).max(300000).optional().default(30000),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const capId = Number(input.capabilityId);
        const capReg = getCapabilityRegistry();
        const cap = await capReg.get(capId);

        if (!cap.isActive) {
          throw new ValidationError(ERROR_CODES.INVALID_REQUEST, "Capability is not active");
        }

        const cytoplasm = getCytoplasmInstance();
        cytoplasm.learnCapability(cap);

        const result = await capReg.execute(capId, input.inputs);
        return { result, capability: cap };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // categories — Get all capability categories
  // ═══════════════════════════════════════════════════════════════════════════
  categories: publicQuery
    .query(async () => {
      try {
        const capReg = getCapabilityRegistry();
        const all = await capReg.list({});
        const cats = [...new Set(all.map((c) => c.category))].filter(Boolean);
        return { categories: cats };
      } catch (err) {
        handleJasimError(err);
      }
    }),
});
