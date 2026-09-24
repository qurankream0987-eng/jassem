/**
 * JASIM — Runtime Router (merged proven runtime surface)
 *
 * Canonical tRPC transport for the proven general runtime
 * (conversations / messages / Smart Bubbles / tasks / runs / proposals).
 * Durable world state is private to its persistent Smart Bubble and is exposed
 * only through Bubble-scoped procedures below.
 * Identity is the canonical user: ownerId = String(ctx.user.id).
 * Error mapping preserves the proven HTTP semantics:
 *   RuntimeAccessError            -> NOT_FOUND      (was 404)
 *   RuntimeActionError            -> BAD_REQUEST    (was 400)
 *   ModelGatewayUnavailableError  -> PRECONDITION_FAILED (was 503)
 *   ModelGatewayOutputError       -> INTERNAL_SERVER_ERROR (was 502)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedQuery } from "../trpc";
import {
  AuthorityActError,
  approveAuthorityRequest,
  listAuthorityRequests,
  rejectAuthorityRequest,
} from "../runtime/authority-acts";
import {
  ProductActionError,
  cancelProductAction,
  submitProductAction,
} from "../runtime/product-actions";
import {
  WorldError,
  listWorlds,
  projectWorld,
  readWorld,
  readWorldVersion,
  worldEventsSince,
  worldHistory,
} from "../runtime/world-runtime";
import {
  MonitorError,
  listMonitors,
  monitorEvaluationsSince,
  projectMonitor,
  readMonitor,
  transitionMonitor,
} from "../runtime/monitoring-runtime";
import {
  RealtimeError,
  RealtimeTopicSchema,
  authorizeSubscription,
  catchUp,
  head as realtimeHead,
  realtimeMetrics,
} from "../runtime/realtime-runtime";
import { resolveActingScope } from "../runtime/actor-scope";
import {
  actOnRuntimeTask,
  archiveRuntimeConversation,
  attachRuntimeArtifactToBubble,
  createRuntimeBubble,
  createRuntimeSemanticEvent,
  listRuntimeSemanticEvents,
  resumeApprovedPlan,
  executeApprovedRun,
  materializeApprovedRunDag,
  buildRunReceipt,
  reconcileRunToConversation,
  createRuntimeConversation,
  createRuntimeMessage,
  createRuntimeRun,
  createRuntimeTask,
  decideExecutionProposalApproval,
  evolveRuntimeBubbleWorld,
  getExecutionProposal,
  getRuntimeBubble,
  getRuntimeBubbleProjection,
  getRuntimeConversation,
  getRuntimeArtifactLineage,
  getRuntimeOverview,
  getRuntimeRun,
  getRuntimeTask,
  getRuntimeBubbleWorld,
  listRuntimeConversations,
  listRuntimeBubbleRuns,
  listRuntimeBubbleTasks,
  listRuntimeBubbles,
  listRuntimeRuns,
  routeRuntimeConversationTurn,
  updateRuntimeBubblePresentation,
  generateBubbleMutation,
  previewBubbleMutation,
  applyBubbleMutation,
  listBubbleContentVersions,
  RuntimeAccessError,
  RuntimeActionError,
  RuntimeConflictError,
} from "../runtime/jasim-runtime";
import { getActiveWorkspaceProjection } from "../runtime/active-workspace-projection";
import { getLivingObjectsProjection } from "../runtime/living-object-projection";
import {
  LivingObjectError,
  acknowledgeLivingObject,
  livingObjectMetrics,
  projectLivingObjects,
  readLivingObject,
  setLivingObjectState,
} from "../runtime/living-object-runtime";
import { resolveSubjectObservationPresentation } from "../runtime/observation-presentation";
import { resolveObservableSubject } from "../runtime/subject-resolution";
import { decidePresentation } from "../runtime/presentation-fabric";
import { db } from "../queries/connection";
import {
  dispatchCanonicalTrustedAction,
} from "../runtime/trusted-action-dispatcher";
import { TrustedActionEnvelopeSchema } from "@contracts/trusted-action";
import {
  ModelGatewayOutputError,
  ModelGatewayUnavailableError,
} from "../runtime/model-gateway";

// ── Rate limiting (ported from the proven Express layer, unchanged policy) ────

const generationRequestsBySource = new Map<string, number[]>();
const generationRequests: number[] = [];
const generationWindowMs = 60 * 60 * 1000;
const maxTrackedSources = 2_000;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const generationLimit = positiveInt(process.env.JASIM_MODEL_REQUEST_LIMIT, 10);
const serviceGenerationLimit = positiveInt(
  process.env.JASIM_MODEL_SERVICE_REQUEST_LIMIT,
  100,
);

function canGenerate(source: string): boolean {
  const now = Date.now();
  for (const [candidate, timestamps] of generationRequestsBySource) {
    if (timestamps.every((at) => now - at >= generationWindowMs)) {
      generationRequestsBySource.delete(candidate);
    }
  }
  const requests = (generationRequestsBySource.get(source) ?? []).filter(
    (at) => now - at < generationWindowMs,
  );
  const activeServiceRequests = generationRequests.filter(
    (at) => now - at < generationWindowMs,
  );
  if (
    requests.length >= generationLimit ||
    activeServiceRequests.length >= serviceGenerationLimit
  ) {
    if (generationRequestsBySource.has(source)) {
      generationRequestsBySource.set(source, requests);
    }
    return false;
  }
  if (
    !generationRequestsBySource.has(source) &&
    generationRequestsBySource.size >= maxTrackedSources
  ) {
  return false;
  }
  requests.push(now);
  generationRequestsBySource.set(source, requests);
  generationRequests.splice(0, generationRequests.length, ...activeServiceRequests, now);
  return true;
}

/**
 * The scope this request acts as — resolved from MEMBERSHIP, never from what
 * was asked for.
 *
 * A caller may name an organization. Whether it may act as one is decided by
 * `resolveActingScope` against real memberships, and naming a scope one does
 * not belong to is DENIED rather than honoured.
 */
async function requireScope(
  ctx: { user?: { id: string | number } | null },
  organizationId?: string,
) {
  const principalId = String(ctx.user!.id);
  const resolution = await resolveActingScope({
    principalId,
    ...(organizationId ? { request: { intent: "ORGANIZATION" as const, organizationId } } : {}),
  });
  if (resolution.status !== "RESOLVED") {
    throw new WorldError(
      resolution.status === "DENIED"
        ? resolution.message
        : "That reference does not identify one scope you may act as.",
      "FORBIDDEN",
    );
  }
  return resolution.scope;
}

// ── Error mapping ─────────────────────────────────────────────────────────────

function handleRuntimeError(error: unknown): never {
  if (error instanceof LivingObjectError) {
    throw new TRPCError({
      code:
        error.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : error.code === "NOT_FOUND"
            ? "NOT_FOUND"
            : error.code === "CONFLICT" || error.code === "STATE"
              ? "CONFLICT"
              : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof RealtimeError) {
    throw new TRPCError({
      code:
        error.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : error.code === "OVERLOADED"
            ? "TOO_MANY_REQUESTS"
            : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof MonitorError) {
    throw new TRPCError({
      code:
        error.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : error.code === "NOT_FOUND"
            ? "NOT_FOUND"
            : error.code === "CONFLICT" || error.code === "STATE"
              ? "CONFLICT"
              : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof WorldError) {
    throw new TRPCError({
      code:
        error.code === "FORBIDDEN" || error.code === "NEEDS_AUTHORITY"
          ? "FORBIDDEN"
          : error.code === "NOT_FOUND"
            ? "NOT_FOUND"
            : error.code === "CONFLICT" || error.code === "STATE"
              ? "CONFLICT"
              : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof ProductActionError) {
    throw new TRPCError({
      code:
        error.code === "UNAUTHENTICATED"
          ? "UNAUTHORIZED"
          : error.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : error.code === "UNKNOWN_ACTION"
              ? "NOT_FOUND"
              : error.code === "EXPIRED" || error.code === "STATE"
                ? "CONFLICT"
                : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof AuthorityActError) {
    throw new TRPCError({
      code:
        error.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : error.code === "NOT_FOUND" || error.code === "UNKNOWN_ACT"
            ? "NOT_FOUND"
            : error.code === "STATE"
              ? "CONFLICT"
              : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof RuntimeAccessError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (error instanceof RuntimeActionError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof RuntimeConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  if (error instanceof ModelGatewayUnavailableError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof ModelGatewayOutputError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof Error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
      cause: error,
    });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown runtime error" });
}

// ── Shared input schemas ──────────────────────────────────────────────────────

const idParam = z.string().min(1).max(128);
const metadataSchema = z.record(z.string(), z.unknown());

const worldChangeSchema = z.union([
  z.object({
    op: z.literal("upsert_entity"),
    entity: z.object({
      id: z.string().min(1).max(200),
      name: z.string().min(1).max(240),
      type: z.string().min(1).max(120),
      attributes: metadataSchema,
    }),
  }),
  z.object({
    op: z.literal("remove_entity"),
    entityId: z.string().min(1).max(200),
  }),
  z.object({
    op: z.literal("upsert_policy"),
    policy: z.object({
      id: z.string().min(1).max(200),
      text: z.string().min(1).max(2000),
      enabled: z.boolean(),
    }),
  }),
  z.object({
    op: z.literal("remove_policy"),
    policyId: z.string().min(1).max(200),
  }),
  z.object({
    op: z.literal("set_state"),
    key: z.string().min(1).max(200),
    value: z.unknown(),
  }),
  z.object({
    op: z.literal("upsert_view"),
    view: z.object({
      id: z.string().min(1).max(200),
      type: z.string().min(1).max(120),
      title: z.string().min(1).max(240),
      config: metadataSchema,
    }),
  }),
  z.object({
    op: z.literal("remove_view"),
    viewId: z.string().min(1).max(200),
  }),
]);

function requestSource(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function ownerIdOf(ctx: { user?: { id: number } }): string {
  return String(ctx.user!.id);
}

function assertGenerationAllowed(req: Request, kind: string): void {
  if (!canGenerate(requestSource(req))) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Too many ${kind} requests. Try again after ${Math.ceil(
        generationWindowMs / 60_000,
      )} minutes.`,
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const runtimeRouter = router({
  // Conversations
  conversationsList: authedQuery.query(async ({ ctx }) => {
    try {
      return await listRuntimeConversations(ownerIdOf(ctx));
    } catch (error) {
      handleRuntimeError(error);
    }
  }),

  conversationsCreate: authedQuery
    .input(
      z
        .object({ title: z.string().min(1).max(255).optional() })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createRuntimeConversation({
          ownerId: ownerIdOf(ctx),
          ...input,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  conversationsGet: authedQuery
    .input(z.object({ conversationId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeConversation(input.conversationId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  conversationsArchive: authedQuery
    .input(z.object({ conversationId: idParam }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await archiveRuntimeConversation(input.conversationId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  messagesCreate: authedQuery
    .input(
      z.object({
        conversationId: idParam,
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string().min(1).max(10_000),
        outputKind: z.string().max(50).optional(),
        metadata: metadataSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { conversationId, ...body } = input;
        return await createRuntimeMessage({
          ownerId: ownerIdOf(ctx),
          conversationId,
          ...body,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  turnsCreate: authedQuery
    .input(
      z.object({
        conversationId: idParam,
        content: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGenerationAllowed(ctx.req, "generation");
      try {
        const result = await routeRuntimeConversationTurn({
          ownerId: ownerIdOf(ctx),
          conversationId: input.conversationId,
          content: input.content,
          // Who is actually signed in, from the request. A product action that
          // needs an actor gets this one or none: a turn never names whose
          // account it is about.
          ...(ctx.user ? { actorUser: ctx.user } : {}),
        });
        // Phase E — emit CONVERSATION_TURN_ROUTED semantic event (fire-and-forget)
        void createRuntimeSemanticEvent({
          type: 'CONVERSATION_TURN_ROUTED',
          ownerId: ownerIdOf(ctx),
          conversationId: input.conversationId,
          payload: {
            outputKind: result?.output?.kind,
            confidence: (result?.output as { confidence?: number })?.confidence,
            userMessageId: result?.userMessage?.id,
            assistantMessageId: result?.assistantMessage?.id,
          },
          message: `Routed to ${result?.output?.kind}`,
        }).catch(() => {});
        return result;
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // Bubbles
  bubblesCreate: authedQuery
    .input(
      z.object({
        conversationId: idParam,
        mode: z.enum(["ephemeral", "interactive", "persistent"]),
        title: z.string().min(1).max(255),
        semanticDescription: z.string().min(1).max(2_000),
        runtimeWorldId: idParam.optional(),
        activeView: z.string().min(1).max(100).optional(),
        references: z.array(metadataSchema).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { conversationId, ...body } = input;
        return await createRuntimeBubble({
          ownerId: ownerIdOf(ctx),
          conversationId,
          ...body,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesGet: authedQuery
    .input(z.object({ bubbleId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeBubble(input.bubbleId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesList: authedQuery
    .input(
      z
        .object({
          status: z.enum(["active", "archived"]).optional(),
          mode: z.enum(["ephemeral", "interactive", "persistent"]).optional(),
          cursor: idParam.optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listRuntimeBubbles({ ownerId: ownerIdOf(ctx), ...input });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesProjection: authedQuery
    .input(z.object({ bubbleId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeBubbleProjection(input.bubbleId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  workspaceProjection: authedQuery
    .input(z.object({ conversationId: idParam.optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await getActiveWorkspaceProjection({
          ownerId: ownerIdOf(ctx),
          conversationId: input?.conversationId,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Generic observation-driven tracking surface.
   *
   * The subject is an opaque `(kind, id)` pair and is never interpreted: a
   * driver, a technician, a vehicle, a shipment or a resource that does not
   * exist yet all reach the same code. The observation is read from canonical
   * owner-scoped state, so a caller can ask *about* a subject but can never
   * supply where it is — a client-declared position is not an observation.
   *
   * Coordinates survive into the presentation only while the reading is fresh,
   * which is what stops a stale position from rendering as a live one.
   */
  subjectObservationPresentation: authedQuery
    .input(
      z.object({
        subjectKind: z.string().trim().min(1).max(64),
        subjectId: z.string().trim().min(1).max(64),
        observationType: z.string().trim().min(1).max(64).default("location"),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const resolved = await resolveSubjectObservationPresentation(db, {
          ownerId: ownerIdOf(ctx),
          subject: { kind: input.subjectKind, id: input.subjectId },
          observationType: input.observationType,
        });
        return {
          presence: resolved.presence,
          reason: resolved.assessment.reason,
          observationAgeMs: resolved.assessment.ageMs ?? null,
          mapEligible: resolved.mapEligible,
          presentation: decidePresentation(resolved.input),
        };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Conversation → canonical subject → observation → presentation.
   *
   * This is the same generic path as `subjectObservationPresentation`, entered
   * one step earlier: instead of naming a subject, the caller names the
   * conversation, and the runtime resolves which observable subject that
   * conversation is currently referring to.
   *
   * Nothing here interprets free text. Resolution runs over durable
   * `reference_bindings` this owner already created, so the model — when one
   * exists — will be able to propose a referent, never to be one. An ambiguous
   * reference produces a clarification surface rather than a guess, because the
   * thing being guessed at is a person's location.
   */
  conversationSubjectTracking: authedQuery
    .input(
      z.object({
        conversationId: idParam,
        observationType: z.string().trim().min(1).max(64).default("location"),
        referenceKey: z.string().trim().min(1).max(128).optional(),
        targetKind: z.string().trim().min(1).max(48).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const ownerId = ownerIdOf(ctx);
        const resolution = await resolveObservableSubject(db, {
          ownerId,
          conversationId: input.conversationId,
          observationType: input.observationType,
          referenceKey: input.referenceKey,
          targetKind: input.targetKind,
        });

        if (resolution.status === "NOT_FOUND") {
          return {
            resolution: "NOT_FOUND" as const,
            reason: resolution.reason,
            subject: null,
            presence: "UNAVAILABLE" as const,
            mapEligible: false,
            presentation: decidePresentation({
              interactionNeed: "show_state",
              ongoing: true,
              data: {
                subjectResolution: "NOT_FOUND",
                subjectResolutionReason: resolution.reason,
                observationType: input.observationType,
              },
            }),
          };
        }

        if (resolution.status === "AMBIGUOUS") {
          // A clarification surface, not a choice made on the user's behalf.
          // Only the stable reference key and the opaque subject pair are
          // exposed — enough to pick, never enough to read a position.
          return {
            resolution: "AMBIGUOUS" as const,
            reason: null,
            subject: null,
            presence: "UNAVAILABLE" as const,
            mapEligible: false,
            candidates: resolution.candidates.map((candidate) => ({
              referenceKey: candidate.referenceKey,
              subjectKind: candidate.subject.kind,
              subjectId: candidate.subject.id,
            })),
            // A bounded set of alternatives the runtime already holds and has
            // already authorized — so it is a selection, not data entry, and
            // the decision layer resolves it to CHOICE. No `missingFields` is
            // supplied precisely because nothing is missing: the answer is one
            // of these, not a value the user has to invent.
            //
            // Each option carries only its stable reference key and the opaque
            // subject pair. That is enough to pick and never enough to read a
            // position; coordinates reach no branch of this path.
            presentation: decidePresentation({
              interactionNeed: "collect_input",
              data: {
                subjectResolution: "AMBIGUOUS",
                observationType: input.observationType,
                candidates: resolution.candidates.map((candidate) => ({
                  referenceKey: candidate.referenceKey,
                  entityRef: `${candidate.subject.kind}:${candidate.subject.id}`,
                })),
              },
            }),
          };
        }

        const resolved = await resolveSubjectObservationPresentation(db, {
          ownerId,
          subject: resolution.subject,
          observationType: input.observationType,
          data: { resolvedVia: resolution.referenceKey },
        });
        return {
          resolution: "RESOLVED" as const,
          reason: resolved.assessment.reason,
          subject: {
            kind: resolution.subject.kind,
            id: resolution.subject.id,
            referenceKey: resolution.referenceKey,
          },
          presence: resolved.presence,
          mapEligible: resolved.mapEligible,
          presentation: decidePresentation(resolved.input),
        };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  activeLivingObjects: authedQuery
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getLivingObjectsProjection({
          ownerId: ownerIdOf(ctx),
          limit: input?.limit,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── LIVING OBJECTS ────────────────────────────────────────────────────────
  //
  // The DURABLE handles, scoped to the acting scope. The rail above stays what
  // it always was — a derivation over this person's own execution artifacts —
  // and these are the things a scope is following, whatever kind they are.
  //
  // Every read re-asks the subject; none of them trusts the handle.

  /** What this scope is following, with each subject's truth read live. */
  livingObjects: authedQuery
    .input(
      z
        .object({
          organizationId: z.string().trim().min(1).max(64).optional(),
          includeHidden: z.boolean().optional(),
          includeResolved: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await projectLivingObjects({
          principalId: String(ctx.user!.id),
          ...(input?.organizationId ? { organizationId: input.organizationId } : {}),
          ...(input?.includeHidden === undefined ? {} : { includeHidden: input.includeHidden }),
          ...(input?.includeResolved === undefined
            ? {}
            : { includeResolved: input.includeResolved }),
          ...(input?.limit === undefined ? {} : { limit: input.limit }),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** One handle. A handle in another scope is NOT_FOUND, never FORBIDDEN. */
  livingObjectRead: authedQuery
    .input(
      z.object({
        id: z.string().trim().min(1).max(80),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await readLivingObject({
          principalId: String(ctx.user!.id),
          id: input.id,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * What the SURFACE does with a handle, and what the FOLLOWER says about it.
   *
   *   HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED
   *
   * There is no `cancel` and no `delete` here, and that is not an omission:
   * cancelling the subject belongs to the subject's own runtime, and nothing a
   * surface does may reach it through this door.
   */
  livingObjectSetState: authedQuery
    .input(
      z
        .object({
          id: z.string().trim().min(1).max(80),
          organizationId: z.string().trim().min(1).max(64).optional(),
          surfaceState: z.enum(["VISIBLE", "HIDDEN"]).optional(),
          followState: z.enum(["FOLLOWING", "RESOLVED", "RELEASED"]).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setLivingObjectState({
          principalId: String(ctx.user!.id),
          id: input.id,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          ...(input.surfaceState ? { surfaceState: input.surfaceState } : {}),
          ...(input.followState ? { followState: input.followState } : {}),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** Mark how far this follower has been reconciled. Never the subject's state. */
  livingObjectAcknowledge: authedQuery
    .input(
      z
        .object({
          id: z.string().trim().min(1).max(80),
          organizationId: z.string().trim().min(1).max(64).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await acknowledgeLivingObject({
          principalId: String(ctx.user!.id),
          id: input.id,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** Totals for an operator. Ids and counts; never contents. */
  livingObjectMetrics: authedQuery
    .input(
      z
        .object({ organizationId: z.string().trim().min(1).max(64).optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input?.organizationId);
        return await livingObjectMetrics(scope.scopeId);
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Task 7A — the single trusted server boundary for generated/presentation
   * actions. The dispatcher validates again, resolves owner-scoped references,
   * enforces presentation versions, and delegates to existing runtime paths.
   */
  dispatchAction: authedQuery
    .input(TrustedActionEnvelopeSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await dispatchCanonicalTrustedAction(ownerIdOf(ctx), input);
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesTasksList: authedQuery
    .input(z.object({ bubbleId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await listRuntimeBubbleTasks(input.bubbleId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesRunsList: authedQuery
    .input(z.object({ bubbleId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await listRuntimeBubbleRuns(input.bubbleId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesPresentation: authedQuery
    .input(
      z.object({
        bubbleId: idParam,
        action: z.enum([
          "open",
          "expand",
          "full_screen",
          "minimize",
          "restore",
          "archive",
          "update",
        ]),
        expectedPresentationVersion: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateRuntimeBubblePresentation({
          ...input,
          ownerId: ownerIdOf(ctx),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesArtifactAttach: authedQuery
    .input(
      z.object({
        bubbleId: idParam,
        sourceRunId: z.string().uuid(),
        artifactId: z.string().min(1).max(200),
        role: z.enum([
          "cover",
          "logo",
          "background",
          "gallery",
          "illustration",
          "attachment",
        ]),
        targetPath: z.string().trim().min(1).max(300).optional(),
        expectedPresentationVersion: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await attachRuntimeArtifactToBubble({
          ...input,
          ownerId: ownerIdOf(ctx),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // Overview
  overview: authedQuery.query(async ({ ctx }) => {
    try {
      return await getRuntimeOverview(ownerIdOf(ctx));
    } catch (error) {
      handleRuntimeError(error);
    }
  }),

  // Tasks
  tasksCreate: authedQuery
    .input(
      z.object({
        goal: z.string().min(1).max(4_000),
        conversationId: idParam.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGenerationAllowed(ctx.req, "planning");
      try {
        return await createRuntimeTask({ ...input, ownerId: ownerIdOf(ctx) });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  tasksGet: authedQuery
    .input(z.object({ taskId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeTask(input.taskId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  tasksAct: authedQuery
    .input(
      z.object({
        taskId: idParam,
        actionId: z.string().min(1).max(200),
        idempotencyKey: z.string().min(8).max(200).optional(),
        input: metadataSchema.optional(),
        approval: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await actOnRuntimeTask({
          taskId: input.taskId,
          actionId: input.actionId,
          idempotencyKey: input.idempotencyKey,
          actionInput: input.input,
          approval: input.approval,
          ownerId: ownerIdOf(ctx),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // Runs
  runsList: authedQuery.query(async ({ ctx }) => {
    try {
      return await listRuntimeRuns(ownerIdOf(ctx));
    } catch (error) {
      handleRuntimeError(error);
    }
  }),

  runsCreate: authedQuery
    .input(
      z.object({
        goal: z.string().min(1).max(4_000),
        idempotencyKey: z.string().min(8).max(200),
        conversationId: idParam.optional(),
        bubbleId: idParam.optional(),
        taskId: idParam.optional(),
        status: z
          .enum([
            "created",
            "awaiting_input",
            "ready",
            "awaiting_approval",
            "scheduled",
            "running",
            "waiting",
            "blocked",
            "verifying",
            "completed",
            "failed",
            "cancelled",
          ])
          .optional(),
        executionGraph: metadataSchema.optional(),
        currentState: metadataSchema.optional(),
        inputs: metadataSchema.optional(),
        requiredCapabilities: z.array(z.string().min(1).max(120)).max(30).optional(),
        resumeAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createRuntimeRun({ ...input, ownerId: ownerIdOf(ctx) });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  runsGet: authedQuery
    .input(z.object({ runId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeRun(input.runId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // Execution proposals
  proposalsGet: authedQuery
    .input(z.object({ proposalId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getExecutionProposal(input.proposalId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  proposalsDecide: authedQuery
    .input(
      z.object({
        proposalId: idParam,
        decision: z.enum(["approve", "reject"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await decideExecutionProposalApproval({
          ownerId: ownerIdOf(ctx),
          proposalId: input.proposalId,
          decision: input.decision,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Phase H — Build a receipt for a completed/failed run (read-only).
   */
  runsReceipt: authedQuery
    .input(z.object({ runId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await buildRunReceipt(input.runId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  artifactsLineage: authedQuery
    .input(
      z.object({
        artifactId: z.string().min(1).max(200),
        sourceRunId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeArtifactLineage({
          ownerId: ownerIdOf(ctx),
          ...input,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Phase H — Reconcile a completed run back to its conversation
   * (persist outputs + post assistant message).
   */
  runsReconcile: authedQuery
    .input(z.object({ runId: idParam }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await reconcileRunToConversation(input.runId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Phase G — Materialize the DAG for a ready run from its authorized proposals.
   */
  runsMaterializeDag: authedQuery
    .input(z.object({ runId: idParam }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await materializeApprovedRunDag(input.runId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Phase G — Execute an approved run end-to-end (materialize DAG + drive to completion).
   */
  runsExecute: authedQuery
    .input(z.object({ runId: idParam }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await executeApprovedRun(input.runId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Phase F — Resume an approved execution plan.
   * Transitions the linked run from blocked → "ready" and consumes the approval.
   */
  proposalsResume: authedQuery
    .input(z.object({ proposalId: idParam }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await resumeApprovedPlan(input.proposalId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // Durable state is only reachable through its persistent Smart Bubble.
  bubblesGetRuntimeState: authedQuery
    .input(z.object({ bubbleId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await getRuntimeBubbleWorld(input.bubbleId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  bubblesEvolveRuntimeState: authedQuery
    .input(
      z.object({
        bubbleId: idParam,
        baseVersion: z.number().int().min(1),
        summary: z.string().min(1).max(1_000),
        changes: z.array(worldChangeSchema).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await evolveRuntimeBubbleWorld({
          bubbleId: input.bubbleId,
          ownerId: ownerIdOf(ctx),
          baseVersion: input.baseVersion,
          summary: input.summary,
          changes: input.changes,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── Phase E — Semantic Events ──────────────────────────────────────────────

  /**
   * List semantic events for the current user, optionally filtered by type or conversationId.
   */
  eventsListSemantic: authedQuery
    .input(
      z.object({
        eventType: z
          .enum([
            'CONVERSATION_TURN_ROUTED',
            'BUBBLE_MUTATION_GENERATED',
            'BUBBLE_MUTATION_APPLIED',
            'BUBBLE_MUTATION_PREVIEWED',
            'CONVERSATION_MEMORY_STORED',
          ])
          .optional(),
        conversationId: idParam.optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listRuntimeSemanticEvents({
          ownerId: ownerIdOf(ctx),
          eventType: input.eventType as Parameters<typeof listRuntimeSemanticEvents>[0]['eventType'],
          conversationId: input.conversationId,
          limit: input.limit,
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── Smart Bubble Generative Mutation ──────────────────────────────────────

  /**
   * Generate a mutation ChangeSet from a natural-language instruction.
   * Returns the ChangeSet for preview/approval before applying.
   */
  bubblesMutateGenerate: authedQuery
    .input(
      z.object({
        bubbleId: idParam,
        nlInstruction: z.string().min(1).max(2_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateBubbleMutation(
          input.bubbleId,
          ownerIdOf(ctx),
          input.nlInstruction,
        );
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Preview what a ChangeSet would produce without applying it.
   */
  bubblesMutatePreview: authedQuery
    .input(
      z.object({
        bubbleId: idParam,
        changeset: z.object({
          id: z.string().uuid(),
          mutationType: z.enum([
            'DATA_MUTATION',
            'STRUCTURAL_MUTATION',
            'POLICY_MUTATION',
            'VIEW_MUTATION',
            'PERMISSION_MUTATION',
          ]),
          description: z.string(),
          nlInstruction: z.string(),
          fromVersion: z.string(),
          newSchema: z.record(z.string(), z.unknown()),
          estimatedImpact: z.enum(['low', 'medium', 'high']),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await previewBubbleMutation(
          input.bubbleId,
          ownerIdOf(ctx),
          input.changeset,
        );
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Atomically apply a ChangeSet and record the content version.
   */
  bubblesMutateApply: authedQuery
    .input(
      z.object({
        bubbleId: idParam,
        changeset: z.object({
          id: z.string().uuid(),
          mutationType: z.enum([
            'DATA_MUTATION',
            'STRUCTURAL_MUTATION',
            'POLICY_MUTATION',
            'VIEW_MUTATION',
            'PERMISSION_MUTATION',
          ]),
          description: z.string(),
          nlInstruction: z.string(),
          fromVersion: z.string(),
          newSchema: z.record(z.string(), z.unknown()),
          estimatedImpact: z.enum(['low', 'medium', 'high']),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await applyBubbleMutation(
          input.bubbleId,
          ownerIdOf(ctx),
          input.changeset,
          ownerIdOf(ctx),
        );
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * List all content versions for a bubble in chronological order.
   */
  bubblesMutateVersionsList: authedQuery
    .input(z.object({ bubbleId: idParam }))
    .query(async ({ ctx, input }) => {
      try {
        return await listBubbleContentVersions(input.bubbleId, ownerIdOf(ctx));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── Authority acts ────────────────────────────────────────────────────────
  //
  //   APPROVAL != CLICK
  //
  // Approving cites the DIGEST of the statement that was read. The runtime
  // re-renders from current canonical state before performing, so an approval
  // cannot outlive the words it was given for. There is deliberately no
  // "approve all pending" and no "approve by act type": a blanket approval is
  // an approval of something nobody read.

  /** What is waiting for this person to decide. */
  authorityRequestsList: authedQuery
    .input(
      z
        .object({
          state: z.enum(["PENDING", "PERFORMED", "REJECTED", "VOID"]).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const rows = await listAuthorityRequests({
          principalId: ownerIdOf(ctx),
          ...(input?.state ? { state: input.state } : {}),
          ...(input?.limit ? { limit: input.limit } : {}),
        });
        return rows.map((row) => ({
          requestId: row.id,
          actType: row.actType,
          scopeId: row.scopeId,
          state: row.state,
          resolution: row.resolution,
          // The statement and its digest, so the surface shows exactly what
          // will be approved and the client cites it back.
          statement: row.statement,
          statementDigest: row.statementDigest,
          expiresAt: row.expiresAt,
          decidedAt: row.decidedAt,
          createdAt: row.createdAt,
        }));
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * Decide one request, citing the words that were read.
   *
   * `statementDigest` is required, not optional. An approval that did not have
   * to name what it approved would be a click.
   */
  authorityRequestApprove: authedQuery
    .input(
      z.object({
        requestId: z.string().trim().min(1).max(64),
        statementDigest: z.string().trim().length(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const outcome = await approveAuthorityRequest({
          requestId: input.requestId,
          principalId: ownerIdOf(ctx),
          statementDigest: input.statementDigest,
        });
        return outcome.state === "PERFORMED"
          ? { state: outcome.state, requestId: outcome.request.id, result: outcome.result }
          : {
              state: outcome.state,
              requestId: outcome.request.id,
              resolution: outcome.resolution,
              message: outcome.message,
            };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  authorityRequestReject: authedQuery
    .input(z.object({ requestId: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const row = await rejectAuthorityRequest({
          requestId: input.requestId,
          principalId: ownerIdOf(ctx),
        });
        return { requestId: row.id, state: row.state, resolution: row.resolution };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── The trusted product-action surface ────────────────────────────────────
  //
  //   TRUSTED SURFACE COLLECTS · SERVER VALIDATES · RUNTIME MUTATES
  //
  // This is the ONLY place a collected value enters, and it is a mutation
  // rather than a query so nothing lands in a URL or a cache. Sensitive fields
  // are used inside the trusted boundary and dropped: they are never returned,
  // never stored on the session row, and never put in an event.

  /**
   * Submit what a trusted surface collected.
   *
   * `values` is an opaque record here on purpose — the SCHEMA is the
   * registry's, and validating it against a shape declared in the transport
   * would be a second definition of what a field is.
   *
   * AUTHENTICATED ONLY, deliberately. `initiateProductAction` and
   * `submitProductAction` both support an anonymous caller bound by
   * `anonymousRef`, because login and signup must work for somebody who is
   * nobody yet. But every ANONYMOUS_ALLOWED action registered today is
   * `BLOCKED_BY_PROVIDER`, so an unauthenticated mutation endpoint here would
   * be reachable attack surface serving no working flow. It is added with the
   * identity provider that makes those flows real, not before.
   */
  productActionSubmit: authedQuery
    .input(
      z.object({
        actionSessionId: z.string().trim().min(1).max(64),
        actionVersion: z.number().int().positive().optional(),
        values: z.record(z.string(), z.unknown()).default({}),
        confirmation: z.union([z.string().max(200), z.boolean()]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const outcome = await submitProductAction({
          actionSessionId: input.actionSessionId,
          actor: ctx.user!,
          values: input.values,
          ...(input.actionVersion !== undefined ? { actionVersion: input.actionVersion } : {}),
          ...(input.confirmation !== undefined ? { confirmation: input.confirmation } : {}),
        });
        // The outcome and nothing else. No echo of what was typed.
        return {
          status: outcome.status,
          outcome: outcome.outcome,
          detail: outcome.detail,
          actionSessionId: outcome.session.id,
        };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── The persistent world, read back ──────────────────────────────────────
  //
  //   UI != WORLD · UI != CANONICAL STATE
  //
  // Reads only. A world is CHANGED through the conversation or through the
  // `world.evolve` authority act, and a second mutation door beside those
  // would be a second answer to "who decided this".
  //
  // The same procedures serve the web app and the mobile app. Presentation
  // adapts; semantics do not, and neither surface has a runtime of its own.

  /** The world as canonical state says it is, now, after any reload. */
  worldRead: authedQuery
    .input(
      z.object({
        worldId: z.string().trim().min(1).max(80),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        const record = await readWorld({ worldId: input.worldId, scope });
        if (!record) throw new WorldError("No such world in this scope.", "NOT_FOUND");
        return { world: record, projection: projectWorld(record) };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  worldList: authedQuery
    .input(z.object({ organizationId: z.string().trim().min(1).max(64).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input?.organizationId);
        return { worlds: await listWorlds(scope) };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** Every version, including the superseded ones. Nothing was erased. */
  worldHistory: authedQuery
    .input(
      z.object({
        worldId: z.string().trim().min(1).max(80),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        return { versions: await worldHistory({ worldId: input.worldId, scope }) };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** One superseded version, still readable. */
  worldVersion: authedQuery
    .input(
      z.object({
        worldId: z.string().trim().min(1).max(80),
        version: z.string().trim().regex(/^\d+\.\d+\.\d+$/),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        const definition = await readWorldVersion({
          worldId: input.worldId,
          scope,
          version: input.version,
        });
        if (!definition) throw new WorldError("No such version of this world.", "NOT_FOUND");
        return { version: input.version, definition };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * The durable ledger, oldest first, resumable from a cursor.
   *
   * This is the realtime PREPARATION and none of the transport: a later
   * subscriber resumes from `after` and misses nothing. Today a surface polls
   * it, and neither surface claims «مباشر».
   */
  worldEvents: authedQuery
    .input(
      z.object({
        worldId: z.string().trim().min(1).max(80),
        after: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        const ledger = await worldEventsSince({
          scope,
          worldId: input.worldId,
          ...(input.after !== undefined ? { after: input.after } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        return { events: ledger, cursor: ledger.at(-1)?.cursor ?? input.after ?? 0 };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── Standing monitors ────────────────────────────────────────────────────
  //
  //   NO FAKE «LIVE»
  //
  // The same procedures serve the web app and the mobile app. A monitor is
  // CREATED by talking — that is the whole conversational path — and these
  // read it back and drive its lifecycle. There is no MobileMonitorRuntime
  // and no web-only authority.

  monitorList: authedQuery
    .input(z.object({ organizationId: z.string().trim().min(1).max(64).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input?.organizationId);
        const monitors = await listMonitors(scope);
        return { monitors: await Promise.all(monitors.map(projectMonitor)) };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  monitorRead: authedQuery
    .input(
      z.object({
        monitorId: z.string().trim().min(1).max(80),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        const monitor = await readMonitor({ monitorId: input.monitorId, scope });
        if (!monitor) throw new MonitorError("No such monitor in this scope.", "NOT_FOUND");
        return { monitor, projection: await projectMonitor(monitor) };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /**
   * The evaluation ledger, ordered and resumable from a cursor.
   *
   * The realtime preparation and none of the transport: a later subscriber
   * resumes from `after` and misses nothing. Today a surface polls it.
   */
  monitorEvaluations: authedQuery
    .input(
      z.object({
        monitorId: z.string().trim().min(1).max(80),
        after: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        const ledger = await monitorEvaluationsSince({
          monitorId: input.monitorId,
          scope,
          ...(input.after !== undefined ? { after: input.after } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        return {
          evaluations: ledger.map((entry) => ({
            cursor: entry.cursor,
            evaluatedAt: entry.evaluatedAt,
            sourceClass: entry.sourceClass,
            result: entry.result,
            freshness: entry.freshness,
            transition: entry.transition,
            triggered: entry.triggered,
          })),
          cursor: ledger.at(-1)?.cursor ?? input.after ?? 0,
        };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** «أوقف المراقبة» · «استأنفها» · «ألغها», for a surface that has a button. */
  monitorTransition: authedQuery
    .input(
      z.object({
        monitorId: z.string().trim().min(1).max(80),
        action: z.enum(["pause", "resume", "cancel"]),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const scope = await requireScope(ctx, input.organizationId);
        const monitor = await transitionMonitor({
          monitorId: input.monitorId,
          scope,
          action: input.action,
        });
        return { monitor, projection: await projectMonitor(monitor) };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  // ── Realtime ─────────────────────────────────────────────────────────────
  //
  //   REALTIME TRANSPORT != TRUTH
  //   TRANSPORT_CONNECTED != DATA_CURRENT
  //
  // The catch-up read is the resume path, the reconnect path, the poll path
  // and the mobile cold-start path — ONE procedure, so a client that never
  // opens a socket is still correct, only later. There is deliberately no
  // procedure that PUBLISHES: a client creates no event.

  /** Where the ledger is now, for a client that has just read a projection. */
  realtimeHead: authedQuery.query(async () => ({ cursor: await realtimeHead() })),

  realtimeCatchUp: authedQuery
    .input(
      z.object({
        topics: z.array(RealtimeTopicSchema).min(1).max(32),
        cursor: z.number().int().min(0),
        limit: z.number().int().min(1).max(200).optional(),
        organizationId: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const subscription = await authorizeSubscription({
          principalId: String(ctx.user!.id),
          request: {
            topics: input.topics,
            ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          },
        });
        return catchUp({
          subscription,
          cursor: input.cursor,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
      } catch (error) {
        handleRuntimeError(error);
      }
    }),

  /** Counters and one latency. No message, no payload, no identity. */
  realtimeMetrics: authedQuery.query(async () => realtimeMetrics()),

  /** «خلاص لا تغيّر كلمة السر». Nothing happened, and the row says so. */
  productActionCancel: authedQuery
    .input(z.object({ actionSessionId: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const session = await cancelProductAction({
          actionSessionId: input.actionSessionId,
          actor: ctx.user!,
        });
        return { actionSessionId: session.id, status: session.status };
      } catch (error) {
        handleRuntimeError(error);
      }
    }),
});
