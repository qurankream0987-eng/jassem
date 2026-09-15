import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../queries/connection";
import { authedQuery, router } from "../trpc";
import {
  cancelReservation,
  confirmReservation,
  getAvailability,
  openAvailabilityWindow,
  releaseReservation,
  reserveCapacity,
} from "../runtime/block2/capacity";
import {
  createDelegationGrant,
  listDelegationGrants,
  revokeDelegationGrant,
} from "../runtime/block2/delegation";
import {
  grantMembership,
  listMemberships,
  makeMembershipReservationAuthorizer,
  revokeMembership,
} from "../runtime/block2/membership";
import {
  createTemporalTrigger,
  TemporalTriggerError,
  transitionTemporalTrigger,
} from "../runtime/block2/temporal";
import {
  closeTrackSession,
  openTrackSession,
  projectTrackForViewer,
} from "../runtime/block2/observations";
import {
  listAssignments,
  offerAssignment,
  respondToAssignment,
  transitionAssignment,
} from "../runtime/block2/assignments";
import {
  listNotificationsForRecipient,
  markNotificationRead,
} from "../runtime/block2/notifications";

function ownerIdOf(ctx: { user?: { id: number } }): string {
  return String(ctx.user!.id);
}

const forbiddenCodes = new Set([
  "FORBIDDEN",
  "REVOKED",
  "EXPIRED",
  "NOT_YET_VALID",
  "CAPABILITY_NOT_DELEGATED",
  "CAPABILITY_DENIED",
  "PURPOSE_MISMATCH",
  "RESOURCE_OUT_OF_SCOPE",
  "MONETARY_LIMIT_EXCEEDED",
  "DEPTH_EXCEEDED",
  "AUTHORITY_EXPANSION",
  "FINGERPRINT_MISMATCH",
]);

function handleBlock2Error(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof TemporalTriggerError) {
    throw new TRPCError({
      code: error.message.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    const code = error.code;
    const trpcCode =
      code === "NOT_FOUND"
        ? "NOT_FOUND"
        : forbiddenCodes.has(code)
          ? "FORBIDDEN"
          : code === "CONFLICT" || code === "STALE_VERSION" || code === "INVALID_STATE"
            ? "CONFLICT"
            : "BAD_REQUEST";
    throw new TRPCError({ code: trpcCode, message: error.message, cause: error });
  }
  if (error instanceof Error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message, cause: error });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown Block 2 error" });
}

async function mapped<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return handleBlock2Error(error);
  }
}

const idSchema = z.string().min(1);
const dateSchema = z.coerce.date();
const emptySchema = z.object({});
const resourceSchema = z.object({
  resourceKind: idSchema,
  resourceId: idSchema,
});
const reservationIdSchema = z.object({ reservationId: idSchema });

const recurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "weekdays"]),
  interval: z.number().int().positive().optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
  byWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  until: z.string().datetime().optional(),
  count: z.number().int().positive().optional(),
});

const viewerScopeSchema = z.object({
  viewers: z
    .array(
      z.object({
        subjectId: idSchema,
        precision: z.enum(["exact", "approximate"]).optional(),
        until: z.string().datetime().optional(),
      }),
    )
    .optional(),
  defaultPrecision: z.enum(["exact", "approximate", "none"]).optional(),
});

export const block2Router = router({
  membership: router({
    grant: authedQuery
      .input(
        z.object({
          subjectId: idSchema,
          resourceKind: idSchema,
          resourceId: idSchema.optional(),
          role: idSchema.optional(),
          permissions: z.array(idSchema).min(1),
          purpose: idSchema.optional(),
          expiresAt: dateSchema.optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() => grantMembership(db, { ...input, ownerId: ownerIdOf(ctx) })),
      ),
    revoke: authedQuery
      .input(z.object({ membershipId: idSchema }))
      .mutation(({ ctx, input }) =>
        mapped(() =>
          revokeMembership(db, {
            membershipId: input.membershipId,
            actorOwnerId: ownerIdOf(ctx),
          }),
        ),
      ),
    list: authedQuery
      .input(emptySchema)
      .query(({ ctx }) => mapped(() => listMemberships(db, { ownerId: ownerIdOf(ctx) }))),
  }),

  delegation: router({
    create: authedQuery
      .input(
        z.object({
          delegateId: idSchema,
          delegateKind: z.enum(["user", "agent", "remote_agent"]).optional(),
          purpose: idSchema,
          allowedCapabilities: z.array(idSchema).min(1),
          deniedCapabilities: z.array(idSchema).optional(),
          resourceScope: z
            .object({ kinds: z.array(idSchema).optional(), ids: z.array(idSchema).optional() })
            .optional(),
          constraints: z.record(z.string(), z.unknown()).optional(),
          maxMonetary: z.number().nonnegative().nullable().optional(),
          currency: idSchema.nullable().optional(),
          validFrom: dateSchema.optional(),
          expiresAt: dateSchema.nullable().optional(),
          maxDepth: z.number().int().nonnegative().optional(),
          parentGrantId: idSchema.nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() =>
          createDelegationGrant(db, { ...input, principalOwnerId: ownerIdOf(ctx) }),
        ),
      ),
    revoke: authedQuery
      .input(z.object({ grantId: idSchema }))
      .mutation(({ ctx, input }) =>
        mapped(() =>
          revokeDelegationGrant(db, { grantId: input.grantId, actorOwnerId: ownerIdOf(ctx) }),
        ),
      ),
    list: authedQuery
      .input(emptySchema)
      .query(({ ctx }) =>
        mapped(() => listDelegationGrants(db, { principalOwnerId: ownerIdOf(ctx) })),
      ),
  }),

  availability: router({
    open: authedQuery
      .input(
        resourceSchema.extend({
          startsAt: dateSchema,
          endsAt: dateSchema,
          timezone: idSchema.optional(),
          capacity: z.number().positive(),
          unit: idSchema,
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() => openAvailabilityWindow(db, { ...input, ownerId: ownerIdOf(ctx) })),
      ),
    get: authedQuery
      .input(resourceSchema.extend({ from: dateSchema.optional(), to: dateSchema.optional() }))
      .query(({ input }) => mapped(() => getAvailability(db, input))),
  }),

  reservation: router({
    create: authedQuery
      .input(
        resourceSchema.extend({
          quantity: z.number().positive(),
          unit: idSchema,
          idempotencyKey: idSchema,
          windowId: idSchema.optional(),
          holdExpiresAt: dateSchema.optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() =>
          reserveCapacity(
            db,
            { ...input, ownerId: ownerIdOf(ctx) },
            makeMembershipReservationAuthorizer(db),
          ),
        ),
      ),
    confirm: authedQuery.input(reservationIdSchema).mutation(({ ctx, input }) =>
      mapped(() => confirmReservation(db, input.reservationId, ownerIdOf(ctx))),
    ),
    release: authedQuery.input(reservationIdSchema).mutation(({ ctx, input }) =>
      mapped(() => releaseReservation(db, input.reservationId, ownerIdOf(ctx))),
    ),
    cancel: authedQuery.input(reservationIdSchema).mutation(({ ctx, input }) =>
      mapped(() => cancelReservation(db, input.reservationId, ownerIdOf(ctx))),
    ),
  }),

  trigger: router({
    create: authedQuery
      .input(
        z.object({
          kind: z.enum(["AT", "AFTER", "DEADLINE", "RECURRING", "CONDITION", "EVENT"]),
          idempotencyKey: idSchema,
          runId: z.string().uuid().nullable().optional(),
          nodeId: z.string().uuid().nullable().optional(),
          fireAt: z.string().datetime().transform((value) => new Date(value)).optional(),
          afterMs: z.number().nonnegative().optional(),
          timezone: idSchema.optional(),
          recurrence: recurrenceSchema.optional(),
          condition: z.record(z.string(), z.unknown()).optional(),
          conditionPollMs: z.number().int().positive().optional(),
          eventFilter: z
            .object({
              eventType: idSchema.optional(),
              match: z.record(z.string(), z.unknown()).optional(),
            })
            .optional(),
          continuation: z
            .object({
              jobKind: idSchema.optional(),
              jobPayload: z.record(z.string(), z.unknown()).optional(),
              resumeNode: z.boolean().optional(),
            })
            .optional(),
          maxFires: z.number().int().positive().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() => createTemporalTrigger(db, { ...input, ownerId: ownerIdOf(ctx) })),
      ),
    pause: authedQuery.input(z.object({ triggerId: idSchema })).mutation(({ ctx, input }) =>
      mapped(() =>
        transitionTemporalTrigger(db, { ...input, ownerId: ownerIdOf(ctx), action: "pause" }),
      ),
    ),
    resume: authedQuery.input(z.object({ triggerId: idSchema })).mutation(({ ctx, input }) =>
      mapped(() =>
        transitionTemporalTrigger(db, { ...input, ownerId: ownerIdOf(ctx), action: "resume" }),
      ),
    ),
    cancel: authedQuery.input(z.object({ triggerId: idSchema })).mutation(({ ctx, input }) =>
      mapped(() =>
        transitionTemporalTrigger(db, { ...input, ownerId: ownerIdOf(ctx), action: "cancel" }),
      ),
    ),
  }),

  track: router({
    open: authedQuery
      .input(
        z.object({
          subjectKind: idSchema,
          subjectId: idSchema,
          purpose: idSchema,
          viewerScope: viewerScopeSchema.optional(),
          endsAt: dateSchema.nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() => openTrackSession(db, { ...input, ownerId: ownerIdOf(ctx) })),
      ),
    view: authedQuery
      .input(z.object({ trackSessionId: idSchema }))
      .query(({ ctx, input }) =>
        mapped(() =>
          projectTrackForViewer(db, { ...input, viewerId: ownerIdOf(ctx) }),
        ),
      ),
    close: authedQuery
      .input(z.object({ trackSessionId: idSchema }))
      .mutation(({ ctx, input }) =>
        mapped(() =>
          closeTrackSession(db, { ...input, actorOwnerId: ownerIdOf(ctx) }),
        ),
      ),
  }),

  assignment: router({
    offer: authedQuery
      .input(
        z.object({
          subjectKind: idSchema,
          subjectId: idSchema,
          terms: z.record(z.string(), z.unknown()).optional(),
          matchId: idSchema.optional(),
          runId: z.string().uuid().optional(),
          nodeId: z.string().uuid().optional(),
          offerExpiresAt: dateSchema.optional(),
          idempotencyKey: idSchema,
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() => offerAssignment(db, { ...input, ownerId: ownerIdOf(ctx) })),
      ),
    respond: authedQuery
      .input(
        z.object({
          assignmentId: idSchema,
          response: z.enum(["ACCEPTED", "DECLINED"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() => respondToAssignment(db, { ...input, subjectId: ownerIdOf(ctx) })),
      ),
    transition: authedQuery
      .input(
        z.object({
          assignmentId: idSchema,
          to: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        mapped(() =>
          transitionAssignment(db, { ...input, actorOwnerId: ownerIdOf(ctx) }),
        ),
      ),
    list: authedQuery
      .input(z.object({ runId: z.string().uuid().optional() }))
      .query(({ ctx, input }) =>
        mapped(() => listAssignments(db, { ...input, ownerId: ownerIdOf(ctx) })),
      ),
  }),

  notification: router({
    listMine: authedQuery
      .input(z.object({ unreadOnly: z.boolean().optional() }))
      .query(({ ctx, input }) =>
        mapped(() =>
          listNotificationsForRecipient(db, {
            ...input,
            recipientId: ownerIdOf(ctx),
          }),
        ),
      ),
    markRead: authedQuery
      .input(z.object({ intentId: idSchema }))
      .mutation(({ ctx, input }) =>
        mapped(() =>
          markNotificationRead(db, { ...input, recipientId: ownerIdOf(ctx) }),
        ),
      ),
  }),
});