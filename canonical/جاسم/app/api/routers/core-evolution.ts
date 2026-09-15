/** Admin-only phase-one API for the isolated Core Evolution Lab. */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CorePatchGateResultSchema,
  CoreLabResourcePolicySchema,
  CoreReplayFixtureSchema,
  KernelBaselineSchema,
  SubmitCorePatchSchema,
} from "@contracts/core-evolution";
import type { TrpcContext } from "../context";
import { authedQuery, router } from "../trpc";
import { getCoreEvolutionEvaluator, getCoreEvolutionService } from "../core/runtime";

function requireCoreEvolutionAdmin(ctx: TrpcContext): string {
  if (!ctx.user || (ctx.user.role !== "admin" && ctx.user.role !== "system")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Core evolution requires an admin or system role" });
  }
  return `${ctx.user.role}:${ctx.user.id}`;
}

export const coreEvolutionRouter = router({
  registerBaseline: authedQuery
    .input(KernelBaselineSchema.omit({ createdBy: true }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { baseline: await getCoreEvolutionService().registerBaseline({ ...input, createdBy: actor }) };
    }),

  getBaseline: authedQuery
    .input(z.object({ id: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      requireCoreEvolutionAdmin(ctx);
      const baseline = await getCoreEvolutionService().getBaseline(input.id);
      if (!baseline) throw new TRPCError({ code: "NOT_FOUND", message: "Kernel baseline not found" });
      return { baseline };
    }),

  submit: authedQuery
    .input(SubmitCorePatchSchema.omit({ createdBy: true }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { candidate: await getCoreEvolutionService().submit({ ...input, createdBy: actor }) };
    }),

  getCandidate: authedQuery
    .input(z.object({ id: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      requireCoreEvolutionAdmin(ctx);
      const candidate = await getCoreEvolutionService().getCandidate(input.id);
      if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "Core patch candidate not found" });
      return { candidate, events: await getCoreEvolutionService().listEvents(candidate.id) };
    }),

  beginEvaluation: authedQuery
    .input(z.object({ id: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { candidate: await getCoreEvolutionService().beginEvaluation(input.id, actor) };
    }),

  recordGate: authedQuery
    .input(z.object({ id: z.string().min(1).max(100), result: CorePatchGateResultSchema }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { candidate: await getCoreEvolutionService().recordGate(input.id, input.result, actor) };
    }),

  submitEvaluation: authedQuery
    .input(z.object({
      id: z.string().min(1).max(100),
      replayFixtures: z.array(CoreReplayFixtureSchema).min(1).max(500),
      policy: CoreLabResourcePolicySchema.default({
        timeoutMs: 10 * 60_000,
        maxMemoryMb: 2_048,
        maxOutputBytes: 4_194_304,
        network: false,
        environment: false,
        productionDatabase: false,
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return getCoreEvolutionEvaluator().submit(input.id, input.replayFixtures, actor, input.policy);
    }),

  evaluationStatus: authedQuery
    .input(z.object({ jobId: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      requireCoreEvolutionAdmin(ctx);
      return { job: await getCoreEvolutionEvaluator().status(input.jobId) };
    }),

  finalizeEvaluation: authedQuery
    .input(z.object({
      id: z.string().min(1).max(100),
      jobId: z.string().min(1).max(100),
      replayFixtures: z.array(CoreReplayFixtureSchema).min(1).max(500),
      policy: CoreLabResourcePolicySchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return getCoreEvolutionEvaluator().finalize(input.jobId, input.id, input.replayFixtures, actor, input.policy);
    }),

  cancelEvaluation: authedQuery
    .input(z.object({ jobId: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { job: await getCoreEvolutionEvaluator().cancel(input.jobId, actor) };
    }),

  approveForBuild: authedQuery
    .input(z.object({ id: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { candidate: await getCoreEvolutionService().approveForBuild(input.id, actor) };
    }),

  reject: authedQuery
    .input(z.object({ id: z.string().min(1).max(100), reason: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireCoreEvolutionAdmin(ctx);
      return { candidate: await getCoreEvolutionService().reject(input.id, actor, input.reason) };
    }),
});
