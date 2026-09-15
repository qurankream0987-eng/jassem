/** Review-gated API for JASIM Generative DNA. */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  AssimilationArtifactSchema,
  GeneKindSchema,
  GeneStatusSchema,
} from "@contracts/generative-dna";
import { PackageRuntimeSchema } from "@contracts/capability-package";
import { CapabilityTestCaseSchema, SandboxResourcePolicySchema } from "@contracts/capability-sandbox";
import type { TrpcContext } from "../context";
import { authedQuery, router } from "../trpc";
import {
  getCapabilityPackageBuilder,
  getCapabilityPackageEvaluator,
  getCapabilityPackageSigner,
  getCapabilityReleaseService,
  getGenerativeDNAService,
} from "../core/runtime";

function requireDNAAdmin(ctx: TrpcContext): string {
  if (!ctx.user || (ctx.user.role !== "admin" && ctx.user.role !== "system")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "DNA review requires an admin or system role" });
  }
  return `${ctx.user.role}:${ctx.user.id}`;
}

const artifactInput = AssimilationArtifactSchema.omit({ submittedBy: true });
const packageInput = z.object({
  candidateId: z.string(),
  packageId: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default("0.1.0"),
  runtime: PackageRuntimeSchema.optional(),
  entrypoint: z.string().optional(),
  exportName: z.string().optional(),
});

async function buildEvaluatedPackage(input: z.infer<typeof packageInput>, publisher: string) {
  const candidate = await getGenerativeDNAService().getCandidate(input.candidateId);
  if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "DNA candidate not found" });
  const bundle = await getCapabilityPackageBuilder().build(candidate, {
    packageId: input.packageId,
    version: input.version,
    runtime: input.runtime,
    entrypoint: input.entrypoint,
    exportName: input.exportName,
    publisher,
  });
  bundle.envelope.evaluation = await getCapabilityPackageEvaluator().evaluate(bundle);
  return bundle;
}

export const dnaRouter = router({
  ingest: authedQuery
    .input(artifactInput)
    .mutation(async ({ ctx, input }) => {
      const service = getGenerativeDNAService();
      return service.ingest({ ...input, submittedBy: `user:${ctx.user!.id}` });
    }),

  listCandidates: authedQuery
    .input(z.object({
      kind: GeneKindSchema.optional(),
      status: GeneStatusSchema.optional(),
      search: z.string().max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      const candidates = await getGenerativeDNAService().listCandidates(input ?? {});
      return { candidates, total: candidates.length };
    }),

  getCandidate: authedQuery
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      const candidate = await getGenerativeDNAService().getCandidate(input.id);
      if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "DNA candidate not found" });
      return { candidate };
    }),

  reviseExecutor: authedQuery
    .input(z.object({
      id: z.string(),
      executorRef: z.string().min(1).max(500),
      inputSchema: z.record(z.string(), z.unknown()).optional(),
      outputSchema: z.record(z.string(), z.unknown()).optional(),
      dependencies: z.array(z.string()).max(100).optional(),
      permissions: z.array(z.string()).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      const { id, ...revision } = input;
      return { candidate: await getGenerativeDNAService().reviseCandidate(id, revision) };
    }),

  evaluate: authedQuery
    .input(z.object({
      id: z.string(),
      passed: z.boolean(),
      score: z.number().min(0).max(1),
      checks: z.array(z.object({
        name: z.string().min(1),
        passed: z.boolean(),
        details: z.string().optional(),
      })).min(1),
      evidence: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireDNAAdmin(ctx);
      const { id, ...evaluation } = input;
      const candidate = await getGenerativeDNAService().evaluateCandidate(id, {
        ...evaluation,
        evaluator: actor,
      });
      return { candidate };
    }),

  approve: authedQuery
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => ({
      candidate: await getGenerativeDNAService().approveCandidate(input.id, requireDNAAdmin(ctx)),
    })),

  reject: authedQuery
    .input(z.object({ id: z.string(), reason: z.string().min(3).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      return { candidate: await getGenerativeDNAService().rejectCandidate(input.id, input.reason) };
    }),

  activate: authedQuery
    .input(z.object({
      id: z.string(),
      version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
      canary: z.boolean().default(true),
      parentVersionIds: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireDNAAdmin(ctx);
      const version = await getGenerativeDNAService().activateCandidate(input.id, actor, input);
      return { version };
    }),

  promoteCanary: authedQuery
    .input(z.object({ versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      const current = await getGenerativeDNAService().getVersion(input.versionId);
      if (current?.proposal.kind === "capability") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Executable capabilities must be promoted through their signed release binding",
        });
      }
      return { version: await getGenerativeDNAService().promoteCanary(input.versionId) };
    }),

  recordEvidence: authedQuery
    .input(z.object({
      versionId: z.string(),
      success: z.boolean(),
      verified: z.boolean(),
      latencyMs: z.number().int().nonnegative(),
      cost: z.number().nonnegative().optional(),
      safetyIncident: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      const { versionId, ...evidence } = input;
      return { version: await getGenerativeDNAService().recordEvidence(versionId, evidence) };
    }),

  snapshot: authedQuery
    .mutation(async ({ ctx }) => {
      requireDNAAdmin(ctx);
      return { snapshot: await getGenerativeDNAService().createGenomeSnapshot() };
    }),

  resolve: authedQuery
    .input(z.object({ goal: z.string().min(1), kinds: z.array(GeneKindSchema).optional() }))
    .query(async ({ input }) => ({
      genes: await getGenerativeDNAService().findActiveGenes(input.goal, input.kinds),
    })),

  evaluatePackage: authedQuery
    .input(packageInput)
    .mutation(async ({ ctx, input }) => {
      const actor = requireDNAAdmin(ctx);
      const bundle = await buildEvaluatedPackage(input, actor);
      return { envelope: bundle.envelope };
    }),

  attestPackage: authedQuery
    .input(packageInput)
    .mutation(async ({ ctx, input }) => {
      const actor = requireDNAAdmin(ctx);
      const privateKeyValue = process.env.JASIM_PACKAGE_SIGNING_PRIVATE_KEY;
      const keyId = process.env.JASIM_PACKAGE_SIGNING_KEY_ID;
      if (!privateKeyValue || !keyId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Package signing key is not configured",
        });
      }
      const bundle = await buildEvaluatedPackage(input, actor);
      const privateKey = privateKeyValue.replace(/\\n/g, "\n");
      const signed = getCapabilityPackageSigner().sign(bundle, privateKey, {
        keyId,
        scope: "source_attestation",
      });
      return { envelope: signed.envelope };
    }),

  releasePackage: authedQuery
    .input(packageInput.extend({
      testCases: z.array(CapabilityTestCaseSchema).min(1).max(50),
      policy: SandboxResourcePolicySchema.partial().optional(),
      canary: z.boolean().default(true),
      parentVersionIds: z.array(z.string()).max(50).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const actor = requireDNAAdmin(ctx);
      try {
        const released = await getCapabilityReleaseService().release({ ...input, publisher: actor });
        return { envelope: released.bundle.envelope, binding: released.binding, version: released.version };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const configuration = /not configured|verification key|signing key/i.test(message);
        throw new TRPCError({ code: configuration ? "PRECONDITION_FAILED" : "BAD_REQUEST", message });
      }
    }),

  promoteReleasedCapability: authedQuery
    .input(z.object({ bindingId: z.string().regex(/^binding-[a-f0-9]{24}$/) }))
    .mutation(async ({ ctx, input }) => {
      requireDNAAdmin(ctx);
      try {
        return await getCapabilityReleaseService().promote(input.bindingId);
      } catch (error) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: error instanceof Error ? error.message : String(error) });
      }
    }),
});
