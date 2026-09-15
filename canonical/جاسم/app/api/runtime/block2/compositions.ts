/**
 * Block 2 composition recipes. These functions add ordering, idempotency-key
 * composition, and best-effort compensation; lifecycle truth remains in the
 * underlying primitives.
 */

import type { Assignment, NotificationIntent, Reservation, TrackSession } from "@db/schema";
import {
  reserveComposite,
  releaseReservation,
  ownerOnlyAuthorizer,
  type CompositeResult,
  type ReservationAuthorizer,
} from "./capacity";
import { offerAssignment, transitionAssignment } from "./assignments";
import {
  openTrackSession,
  closeTrackSession,
  type OpenTrackSessionInput,
} from "./observations";
import {
  createNotificationIntent,
  type CreateNotificationIntentInput,
} from "./notifications";
import type { Block2Db } from "./temporal";

export type BookCompositeResourceInput = {
  ownerId: string;
  requesterId: string;
  legs: Array<{
    resourceKind: string;
    resourceId: string;
    quantity: number;
    unit: string;
    windowId?: string;
  }>;
  idempotencyKey: string;
  holdTtlMs?: number;
  authorizer?: ReservationAuthorizer;
};

export type BookCompositeResourceResult = CompositeResult & {
  reservations: Reservation[];
};

export async function bookCompositeResource(
  db: Block2Db,
  input: BookCompositeResourceInput,
): Promise<BookCompositeResourceResult> {
  const holdExpiresAt =
    input.holdTtlMs === undefined ? undefined : new Date(Date.now() + input.holdTtlMs);
  const authorizer: ReservationAuthorizer = {
    canReserve: (request) =>
      (input.authorizer ?? ownerOnlyAuthorizer).canReserve({
        ...request,
        requesterId: input.requesterId,
      }),
  };
  const result = await reserveComposite(
    db,
    {
      ownerId: input.ownerId,
      groupKey: input.idempotencyKey,
      onLegFailure: "release",
      legs: input.legs.map((leg, index) => ({
        ...leg,
        ownerId: input.ownerId,
        legKey: String(index),
        ...(holdExpiresAt ? { holdExpiresAt } : {}),
      })),
    },
    authorizer,
  );
  return {
    ...result,
    reservations: result.legs.flatMap(({ result: leg }) =>
      leg.outcome === "HELD" ? [leg.reservation] : [],
    ),
  };
}

export type AssignmentOffer = Omit<Parameters<typeof offerAssignment>[1], "ownerId">;
export type TrackFields = Omit<OpenTrackSessionInput, "ownerId" | "assignmentId">;
export type NotificationFields = Omit<CreateNotificationIntentInput, "ownerId">;
export type DispatchAndTrackInput = {
  ownerId: string;
  assignment: AssignmentOffer;
  track: TrackFields;
  notification?: NotificationFields;
};
export type DispatchAndTrackResult = {
  assignment: Assignment;
  trackSession: TrackSession;
  notificationIntent?: NotificationIntent;
};

export class CompositionStepError extends Error {
  readonly failedStep: "assignment" | "trackSession" | "notificationIntent";

  constructor(
    readonly step: "assignment" | "trackSession" | "notificationIntent",
    readonly cause: unknown,
  ) {
    super(
      `Composition step ${step} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
    this.failedStep = step;
  }
}

export async function dispatchAndTrack(
  db: Block2Db,
  input: DispatchAndTrackInput,
): Promise<DispatchAndTrackResult> {
  let assignment: Assignment;
  try {
    assignment = (await offerAssignment(db, { ...input.assignment, ownerId: input.ownerId }))
      .assignment;
  } catch (error) {
    throw new CompositionStepError("assignment", error);
  }

  let trackSession: TrackSession;
  try {
    trackSession = await openTrackSession(db, {
      ...input.track,
      ownerId: input.ownerId,
      assignmentId: assignment.id,
    });
  } catch (error) {
    await compensateAssignment(db, assignment, input.ownerId);
    throw new CompositionStepError("trackSession", error);
  }

  if (!input.notification) return { assignment, trackSession };
  try {
    const notificationIntent = await createNotificationIntent(db, {
      ...input.notification,
      ownerId: input.ownerId,
      entityRef: input.notification.entityRef ?? { kind: "assignment", id: assignment.id },
    });
    return { assignment, trackSession, notificationIntent };
  } catch (error) {
    await ignoreFailure(() =>
      closeTrackSession(db, { trackSessionId: trackSession.id, actorOwnerId: input.ownerId }),
    );
    await compensateAssignment(db, assignment, input.ownerId);
    throw new CompositionStepError("notificationIntent", error);
  }
}

export type MultiPartyFulfillmentResult =
  | {
      status: "COMPLETE";
      completedSteps: string[];
      reservations: CompositeResult;
      assignments: Assignment[];
      notificationIntents: NotificationIntent[];
    }
  | {
      status: "FAILED";
      completedSteps: string[];
      failedStep: string;
      reservations?: CompositeResult;
      assignments: Assignment[];
      notificationIntents: NotificationIntent[];
    };

export type MultiPartyFulfillmentInput = {
  ownerId: string;
  legs: Array<BookCompositeResourceInput["legs"][number] & { idempotencyKey: string }>;
  assignments: AssignmentOffer[];
  notificationIntents: NotificationFields[];
  requesterId?: string;
  holdTtlMs?: number;
  authorizer?: ReservationAuthorizer;
};

export async function multiPartyFulfillment(
  db: Block2Db,
  input: MultiPartyFulfillmentInput,
): Promise<MultiPartyFulfillmentResult> {
  const completedSteps: string[] = [];
  const offered: Assignment[] = [];
  const notifications: NotificationIntent[] = [];
  let reservationResult: CompositeResult | undefined;

  try {
    const booked = await bookCompositeResource(db, {
      ownerId: input.ownerId,
      requesterId: input.requesterId ?? input.ownerId,
      legs: input.legs.map(({ idempotencyKey: _key, ...leg }) => leg),
      idempotencyKey: `fulfillment:${input.legs.map((leg) => leg.idempotencyKey).join("|")}`,
      holdTtlMs: input.holdTtlMs,
      authorizer: input.authorizer,
    });
    reservationResult = booked;
    if (booked.outcome !== "COMPLETE") {
      return {
        status: "FAILED",
        completedSteps,
        failedStep: "reservations",
        reservations: booked,
        assignments: offered,
        notificationIntents: notifications,
      };
    }
    completedSteps.push("reservations");
  } catch {
    return {
      status: "FAILED",
      completedSteps,
      failedStep: "reservations",
      assignments: offered,
      notificationIntents: notifications,
    };
  }

  try {
    for (let index = 0; index < input.assignments.length; index += 1) {
      const assignment = (
        await offerAssignment(db, {
          ...input.assignments[index]!,
          ownerId: input.ownerId,
        })
      ).assignment;
      offered.push(assignment);
      completedSteps.push(`assignment:${index}`);
    }

    for (let index = 0; index < input.notificationIntents.length; index += 1) {
      const notification = await createNotificationIntent(db, {
        ...input.notificationIntents[index]!,
        ownerId: input.ownerId,
      });
      notifications.push(notification);
      completedSteps.push(`notificationIntent:${index}`);
    }
    return {
      status: "COMPLETE",
      completedSteps,
      reservations: reservationResult,
      assignments: offered,
      notificationIntents: notifications,
    };
  } catch {
    const failedStep =
      offered.length < input.assignments.length
        ? `assignment:${offered.length}`
        : `notificationIntent:${notifications.length}`;
    await compensate(db, input.ownerId, offered, reservationResult);
    return {
      status: "FAILED",
      completedSteps,
      failedStep,
      reservations: reservationResult,
      assignments: offered,
      notificationIntents: notifications,
    };
  }
}

async function compensate(
  db: Block2Db,
  ownerId: string,
  assignments: Assignment[],
  reservations?: CompositeResult,
): Promise<void> {
  for (const assignment of [...assignments].reverse()) {
    await compensateAssignment(db, assignment, ownerId);
  }
  const held =
    reservations?.legs.flatMap(({ result }) =>
      result.outcome === "HELD" ? [result.reservation] : [],
    ) ?? [];
  for (const reservation of held.reverse()) {
    await ignoreFailure(() => releaseReservation(db, reservation.id, ownerId));
  }
}

async function compensateAssignment(
  db: Block2Db,
  assignment: Assignment,
  ownerId: string,
): Promise<void> {
  if (!["OFFERED", "ACCEPTED", "ACTIVE"].includes(assignment.state)) return;
  await ignoreFailure(() =>
    transitionAssignment(db, {
      assignmentId: assignment.id,
      actorOwnerId: ownerId,
      to: "CANCELLED",
    }),
  );
}

async function ignoreFailure(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // The primary failure remains authoritative; durable state shows any
    // compensation that could not be completed.
  }
}