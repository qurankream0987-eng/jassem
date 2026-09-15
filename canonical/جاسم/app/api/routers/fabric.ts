/**
 * JASIM — Fabric Router (Block 1)
 *
 * Authenticated tRPC surface for the three generic fabrics:
 * Universal Capability (semantic composition), Generative Interaction
 * (presentation IR), and the Economic Value Network (expressions, matching,
 * engagements, proposals, transaction intents) plus External Action sessions.
 *
 * Identity is the canonical user: ownerId = String(ctx.user.id).
 * No domain-specific procedures exist here — only generic primitives.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedQuery } from "../trpc";
import { getRuntimeCapabilityRegistry } from "../runtime/capability-registry";
import {
  composeRequirementGraph,
  type CapabilityRequirementGraph,
} from "../runtime/semantic-fabric";
import {
  resolveProvider,
  searchProviderCatalog,
} from "../runtime/capability-provider";
import {
  routePresentation,
  type SemanticPresentationInput,
} from "../runtime/presentation-fabric";
import {
  EconomicAuthorizationError,
  EconomicNotFoundError,
  createEngagement,
  createExpression,
  createProposal,
  discoverExpressions,
  getExpression,
  matchNeed,
  matchNeedToOffering,
  publishExpression,
  respondToProposal,
} from "../runtime/economic-fabric";
import {
  ExternalActionSessionError,
  UntrustedExternalUrlError,
  consumeExternalActionSession,
  createExternalActionSession,
} from "../runtime/external-action-session";

function ownerIdOf(ctx: { user?: { id: number } }): string {
  return String(ctx.user!.id);
}

function handleFabricError(error: unknown): never {
  if (error instanceof EconomicAuthorizationError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
  }
  if (error instanceof EconomicNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (error instanceof UntrustedExternalUrlError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof ExternalActionSessionError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
  }
  if (error instanceof Error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message, cause: error });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown fabric error" });
}

const constraintSchema = z.object({
  field: z.string(),
  operator: z.enum(["eq", "neq", "gte", "lte", "gt", "lt", "contains", "within_time", "compatible"]),
  value: z.unknown(),
  unit: z.string().optional(),
});

const requirementSchema = z.object({
  id: z.string(),
  kind: z.string(),
  semanticPurpose: z.string().optional(),
  effectClass: z.enum(["pure", "internal_stateful", "external_effectful"]).optional(),
  authorityClass: z.enum(["none", "human", "owner", "regulatory"]).optional(),
  resourceRequirement: z.string().optional(),
  inputSpec: z.array(z.record(z.string(), z.unknown())).optional(),
  outputSpec: z.array(z.record(z.string(), z.unknown())).optional(),
  dependsOn: z.array(z.string()).optional(),
});

export const fabricRouter = router({
  /** Deterministic semantic composition over the trusted production registry. */
  composeGoal: authedQuery
    .input(
      z.object({
        goalId: z.string(),
        requirements: z.array(requirementSchema),
        knownInputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return composeRequirementGraph(
          input as unknown as CapabilityRequirementGraph,
          getRuntimeCapabilityRegistry(),
          {
            // Truthful by construction: no provider/resource is claimed until
            // the trusted server actually has it configured.
            availableProviders: [],
            availableResources: [],
            knownInputs: input.knownInputs,
          },
        );
      } catch (error) {
        handleFabricError(error);
      }
    }),

  /** Smallest-sufficient-surface presentation routing (shared web/mobile IR). */
  present: authedQuery
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => {
      try {
        return routePresentation(input as unknown as SemanticPresentationInput);
      } catch (error) {
        handleFabricError(error);
      }
    }),

  expressionCreate: authedQuery
    .input(
      z.object({
        kind: z.enum(["offering", "need"]),
        semanticType: z.string().min(1).max(160),
        subjectEntityId: z.string().optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        hardConstraints: z.array(constraintSchema).optional(),
        softPreferences: z.array(constraintSchema).optional(),
        availability: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createExpression({
          ownerId: ownerIdOf(ctx),
          kind: input.kind,
          semanticType: input.semanticType,
          subjectEntityId: input.subjectEntityId,
          attributes: input.attributes,
          hardConstraints: input.hardConstraints as never,
          softPreferences: input.softPreferences as never,
          availability: input.availability,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  expressionPublish: authedQuery
    .input(
      z.object({
        id: z.string(),
        projection: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await publishExpression({
          id: input.id,
          ownerId: ownerIdOf(ctx),
          projection: input.projection,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  expressionGet: authedQuery
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getExpression(input.id, ownerIdOf(ctx));
      } catch (error) {
        handleFabricError(error);
      }
    }),

  expressionsDiscover: authedQuery
    .input(
      z.object({
        kind: z.enum(["offering", "need"]),
        semanticType: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await discoverExpressions({
          kind: input.kind,
          requesterOwnerId: ownerIdOf(ctx),
          semanticType: input.semanticType,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  matchCreate: authedQuery
    .input(z.object({ needId: z.string(), offeringId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await matchNeedToOffering({
          needId: input.needId,
          offeringId: input.offeringId,
          createdByOwnerId: ownerIdOf(ctx),
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  matchForNeed: authedQuery
    .input(z.object({ needId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await matchNeed({ needId: input.needId, requesterOwnerId: ownerIdOf(ctx) });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  engagementCreate: authedQuery
    .input(
      z.object({
        // Engagements are match-backed: participants are derived server-side
        // from an authorized match, never caller-nominated.
        matchId: z.string(),
        participants: z.array(z.string()).min(2),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createEngagement({
          matchId: input.matchId,
          initiatorOwnerId: ownerIdOf(ctx),
          participants: input.participants,
          context: input.context,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  proposalCreate: authedQuery
    .input(
      z.object({
        engagementId: z.string(),
        terms: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProposal({
          engagementId: input.engagementId,
          proposerOwnerId: ownerIdOf(ctx),
          terms: input.terms,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  proposalRespond: authedQuery
    .input(
      z.object({
        proposalId: z.string(),
        action: z.enum(["accept", "reject"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await respondToProposal({
          proposalId: input.proposalId,
          ownerId: ownerIdOf(ctx),
          action: input.action,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  /** Provider origins come from server-owned configuration only. */
  externalActionCreate: authedQuery
    .input(
      z.object({
        provider: z.string().min(1),
        purpose: z.string().min(1),
        url: z.string().url(),
        transactionIntentId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createExternalActionSession({
          ownerId: ownerIdOf(ctx),
          provider: input.provider,
          purpose: input.purpose,
          url: input.url,
          transactionIntentId: input.transactionIntentId,
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  externalActionConsume: authedQuery
    .input(z.object({ id: z.string(), nonce: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await consumeExternalActionSession({
          id: input.id,
          nonce: input.nonce,
          ownerId: ownerIdOf(ctx),
        });
      } catch (error) {
        handleFabricError(error);
      }
    }),

  /**
   * Block 1.1: read-only provider discovery. Cheap candidate summaries plus
   * the deterministic resolution result — never full contracts, never a
   * model-facing catalog dump, and no administrative mutation surface.
   */
  discoverProviders: authedQuery
    .input(z.object({ kind: z.string().min(1).max(128) }))
    .query(({ input }) => {
      const normalize = (v: string) =>
        v.trim().toLowerCase().replace(/[\s_]+/g, "-");
      const kind = normalize(input.kind);
      const capabilityRegistry = getRuntimeCapabilityRegistry();
      const capability = capabilityRegistry.list().find((c) => {
        if (c.testOnly) return false;
        return [c.id, ...c.aliases, ...(c.semanticPurposes ?? [])]
          .map(normalize)
          .includes(kind);
      });
      const candidates = searchProviderCatalog({
        semanticKind: kind,
        registry: capabilityRegistry.providers(),
      });
      const resolution = capability
        ? resolveProvider({
            capabilityId: capability.id,
            registry: capabilityRegistry.providers(),
          })
        : undefined;
      return {
        capabilityId: capability?.id,
        resolution: resolution
          ? resolution.status === "SELECTED"
            ? {
                status: resolution.status,
                providerId: resolution.binding.providerId,
                kind: resolution.binding.kind,
                candidatesConsidered: resolution.candidatesConsidered,
              }
            : {
                status: resolution.status,
                reason: resolution.reason,
                candidatesConsidered: resolution.candidatesConsidered,
              }
          : undefined,
        candidates,
      };
    }),
});
