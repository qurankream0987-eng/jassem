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

// ── Error mapping ─────────────────────────────────────────────────────────────

function handleRuntimeError(error: unknown): never {
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
});
