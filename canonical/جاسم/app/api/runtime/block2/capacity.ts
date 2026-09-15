/**
 * Block 2 — AvailabilityWindow + Reservation.
 *
 * HARD CORRECTNESS GATE: capacity allocation is a single conditional SQL
 * statement (UPDATE ... WHERE capacityHeld + q <= capacityTotal). There is
 * no SELECT → calculate → UPDATE path anywhere in this module; PostgreSQL
 * row locking serializes concurrent allocations, so DOUBLE_BOOKING = 0.
 *
 * Composite reservations across independent resources never pretend to be
 * one transaction: legs allocate sequentially and a failed leg triggers the
 * mapped policy (release prior legs / compensate / truthful PARTIAL).
 */

import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  availabilityWindows,
  reservations,
  type AvailabilityWindow,
  type Reservation,
  type ReservationStatus,
} from "@db/schema";
import { canonicalQuantity } from "./units";
import type { Block2Db } from "./temporal";

export class CapacityError extends Error {
  readonly code:
    | "CONFLICT"
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "INVALID"
    | "UNIT_INCOMPATIBLE"
    | "STALE_VERSION";

  constructor(
    message: string,
    code:
      | "CONFLICT"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID"
      | "UNIT_INCOMPATIBLE"
      | "STALE_VERSION",
  ) {
    super(message);
    this.code = code;
  }
}

/** Authorization seam: can `requesterId` reserve against this resource? */
export interface ReservationAuthorizer {
  canReserve(input: {
    requesterId: string;
    resourceOwnerId: string;
    resourceKind: string;
    resourceId: string;
  }): Promise<boolean>;
}

/** Fail-closed default: only the resource owner may reserve. */
export const ownerOnlyAuthorizer: ReservationAuthorizer = {
  async canReserve(input) {
    return input.requesterId === input.resourceOwnerId;
  },
};

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export async function openAvailabilityWindow(
  db: Block2Db,
  input: {
    ownerId: string;
    resourceKind: string;
    resourceId: string;
    startsAt: Date;
    endsAt: Date;
    timezone?: string;
    capacity: number;
    unit: string;
    attributes?: Record<string, unknown>;
  },
): Promise<AvailabilityWindow> {
  const canonical = canonicalQuantity(input.capacity, input.unit);
  if (!canonical || canonical.value <= 0) {
    throw new CapacityError("Capacity must be a finite positive quantity", "INVALID");
  }
  if (!(input.endsAt.getTime() > input.startsAt.getTime())) {
    throw new CapacityError("Window must end after it starts", "INVALID");
  }
  const rows = await db
    .insert(availabilityWindows)
    .values({
      id: `aw_${randomUUID()}`,
      ownerId: input.ownerId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone ?? null,
      unit: canonical.unit,
      capacityTotal: String(canonical.value),
      capacityHeld: "0",
      state: "open",
      attributes: input.attributes ?? {},
    })
    .returning();
  return rows[0]!;
}

export async function closeAvailabilityWindow(
  db: Block2Db,
  input: { ownerId: string; windowId: string },
): Promise<void> {
  await db
    .update(availabilityWindows)
    .set({ state: "closed" })
    .where(and(eq(availabilityWindows.id, input.windowId), eq(availabilityWindows.ownerId, input.ownerId)));
}

export async function getAvailability(
  db: Block2Db,
  input: { resourceKind: string; resourceId: string; from?: Date; to?: Date },
): Promise<Array<AvailabilityWindow & { available: number }>> {
  const from = input.from ?? new Date(0);
  const to = input.to ?? new Date("9999-01-01T00:00:00Z");
  const rows = await db
    .select()
    .from(availabilityWindows)
    .where(
      and(
        eq(availabilityWindows.resourceKind, input.resourceKind),
        eq(availabilityWindows.resourceId, input.resourceId),
        eq(availabilityWindows.state, "open"),
        lt(availabilityWindows.startsAt, to),
        gt(availabilityWindows.endsAt, from),
      ),
    );
  return rows.map((row) => ({
    ...row,
    available: Number(row.capacityTotal) - Number(row.capacityHeld),
  }));
}

// ---------------------------------------------------------------------------
// Atomic reservation
// ---------------------------------------------------------------------------

export type ReserveInput = {
  /** Requester (reservation owner). */
  ownerId: string;
  resourceKind: string;
  resourceId: string;
  quantity: number;
  unit: string;
  idempotencyKey: string;
  /** Optional explicit window; otherwise the first overlapping open window
   *  with capacity is chosen deterministically (earliest start). */
  windowId?: string;
  windowFrom?: Date;
  windowTo?: Date;
  holdExpiresAt?: Date;
  compositeGroupId?: string;
  matchId?: string;
  expressionId?: string;
  runId?: string;
  nodeId?: string;
  now?: Date;
};

export type ReserveResult =
  | { outcome: "HELD"; reservation: Reservation; duplicate: boolean }
  | { outcome: "CONFLICT"; reason: string }
  | { outcome: "FORBIDDEN"; reason: string }
  | { outcome: "NO_WINDOW"; reason: string };

export async function reserveCapacity(
  db: Block2Db,
  input: ReserveInput,
  authorizer: ReservationAuthorizer = ownerOnlyAuthorizer,
): Promise<ReserveResult> {
  const canonical = canonicalQuantity(input.quantity, input.unit);
  if (!canonical || canonical.value <= 0) {
    throw new CapacityError("Quantity must be a finite positive number", "INVALID");
  }

  return db.transaction(async (tx) => {
    // Idempotent replay: same (owner, key) returns the original outcome.
    const prior = await tx
      .select()
      .from(reservations)
      .where(and(eq(reservations.ownerId, input.ownerId), eq(reservations.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (prior[0]) {
      return prior[0].status === "HELD" || prior[0].status === "CONFIRMED"
        ? { outcome: "HELD" as const, reservation: prior[0], duplicate: true }
        : { outcome: "CONFLICT" as const, reason: `Prior attempt is ${prior[0].status}` };
    }

    // Locate candidate windows (earliest start first — deterministic).
    const windowFilter = input.windowId
      ? eq(availabilityWindows.id, input.windowId)
      : and(
          eq(availabilityWindows.resourceKind, input.resourceKind),
          eq(availabilityWindows.resourceId, input.resourceId),
          eq(availabilityWindows.state, "open"),
          input.windowFrom ? gt(availabilityWindows.endsAt, input.windowFrom) : undefined,
          input.windowTo ? lt(availabilityWindows.startsAt, input.windowTo) : undefined,
        );
    const candidates = await tx
      .select()
      .from(availabilityWindows)
      .where(windowFilter)
      .orderBy(availabilityWindows.startsAt)
      .limit(5);
    const window = candidates.find((w) => w.unit === canonical.unit && w.state === "open");
    if (!window) {
      const anyWindow = candidates[0];
      if (anyWindow && anyWindow.unit !== canonical.unit) {
        throw new CapacityError(
          `Unit dimension mismatch: window is ${anyWindow.unit}, request is ${canonical.unit}`,
          "UNIT_INCOMPATIBLE",
        );
      }
      return { outcome: "NO_WINDOW" as const, reason: "No open availability window for resource" };
    }

    // Bind authorization to the SELECTED window's identity — never the
    // caller-supplied resource fields — so a windowId cannot be substituted
    // to spend capacity on a resource the grant does not cover.
    if (
      window.resourceKind !== input.resourceKind ||
      window.resourceId !== input.resourceId
    ) {
      throw new CapacityError(
        "Selected window does not belong to the requested resource",
        "FORBIDDEN",
      );
    }
    // Authorization: owner or an explicit grant (cross-owner deny by default).
    const allowed = await authorizer.canReserve({
      requesterId: input.ownerId,
      resourceOwnerId: window.ownerId,
      resourceKind: window.resourceKind,
      resourceId: window.resourceId,
    });
    if (!allowed) {
      return { outcome: "FORBIDDEN" as const, reason: "No valid grant over this resource" };
    }

    // THE atomic gate: one conditional statement, no read-calc-write.
    const allocated = await tx
      .update(availabilityWindows)
      .set({
        capacityHeld: sql`${availabilityWindows.capacityHeld} + ${canonical.value}::numeric`,
        version: sql`${availabilityWindows.version} + 1`,
      })
      .where(
        and(
          eq(availabilityWindows.id, window.id),
          eq(availabilityWindows.state, "open"),
          sql`${availabilityWindows.capacityHeld} + ${canonical.value}::numeric <= ${availabilityWindows.capacityTotal}`,
        ),
      )
      .returning({ id: availabilityWindows.id });
    if (!allocated[0]) {
      return { outcome: "CONFLICT" as const, reason: "Insufficient remaining capacity" };
    }

    const rows = await tx
      .insert(reservations)
      .values({
        id: `rsv_${randomUUID()}`,
        ownerId: input.ownerId,
        resourceOwnerId: window.ownerId,
        windowId: window.id,
        resourceKind: window.resourceKind,
        resourceId: window.resourceId,
        quantity: String(canonical.value),
        unit: canonical.unit,
        startsAt: input.windowFrom ?? window.startsAt,
        endsAt: input.windowTo ?? window.endsAt,
        status: "HELD",
        expiresAt: input.holdExpiresAt ?? null,
        idempotencyKey: input.idempotencyKey,
        compositeGroupId: input.compositeGroupId ?? null,
        matchId: input.matchId ?? null,
        expressionId: input.expressionId ?? null,
        runId: input.runId ?? null,
        nodeId: input.nodeId ?? null,
      })
      .returning();
    return { outcome: "HELD" as const, reservation: rows[0]!, duplicate: false };
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions (capacity is returned exactly once per reservation)
// ---------------------------------------------------------------------------

async function transitionReservation(
  db: Block2Db,
  input: {
    reservationId: string;
    actorOwnerId: string;
    from: ReservationStatus[];
    to: ReservationStatus;
    returnCapacity: boolean;
    now?: Date;
  },
): Promise<Reservation> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, input.reservationId))
      .limit(1)
      .for("update");
    const reservation = rows[0];
    if (!reservation) throw new CapacityError("Reservation not found", "NOT_FOUND");
    if (
      reservation.ownerId !== input.actorOwnerId &&
      reservation.resourceOwnerId !== input.actorOwnerId
    ) {
      throw new CapacityError("Only requester or resource owner may transition", "FORBIDDEN");
    }
    if (!input.from.includes(reservation.status)) {
      throw new CapacityError(
        `Cannot move reservation from ${reservation.status} to ${input.to}`,
        "INVALID",
      );
    }
    if (input.returnCapacity && reservation.windowId) {
      // Conditional increment-back: never drive capacityHeld below zero.
      await tx
        .update(availabilityWindows)
        .set({
          capacityHeld: sql`GREATEST(${availabilityWindows.capacityHeld} - ${Number(reservation.quantity)}::numeric, 0)`,
          version: sql`${availabilityWindows.version} + 1`,
        })
        .where(eq(availabilityWindows.id, reservation.windowId));
    }
    const updated = await tx
      .update(reservations)
      .set({ status: input.to, version: reservation.version + 1 })
      .where(and(eq(reservations.id, reservation.id), eq(reservations.version, reservation.version)))
      .returning();
    if (!updated[0]) throw new CapacityError("Stale reservation version", "STALE_VERSION");
    return updated[0];
  });
}

export function confirmReservation(db: Block2Db, reservationId: string, actorOwnerId: string) {
  return transitionReservation(db, {
    reservationId,
    actorOwnerId,
    from: ["HELD"],
    to: "CONFIRMED",
    returnCapacity: false,
  });
}

export function releaseReservation(db: Block2Db, reservationId: string, actorOwnerId: string) {
  return transitionReservation(db, {
    reservationId,
    actorOwnerId,
    from: ["HELD", "CONFIRMED"],
    to: "RELEASED",
    returnCapacity: true,
  });
}

export function cancelReservation(db: Block2Db, reservationId: string, actorOwnerId: string) {
  return transitionReservation(db, {
    reservationId,
    actorOwnerId,
    from: ["HELD", "CONFIRMED"],
    to: "CANCELLED",
    returnCapacity: true,
  });
}

/**
 * Held capacity returns automatically after expiry. Driven by the existing
 * temporal/durable machinery — no second reservation scheduler.
 */
export async function expireDueReservations(
  db: Block2Db,
  options?: { now?: Date; limit?: number },
): Promise<number> {
  const now = options?.now ?? new Date();
  const due = await db
    .select({ id: reservations.id, ownerId: reservations.ownerId })
    .from(reservations)
    .where(and(eq(reservations.status, "HELD"), lte(reservations.expiresAt, now)))
    .limit(options?.limit ?? 100);
  let expired = 0;
  for (const row of due) {
    try {
      await transitionReservation(db, {
        reservationId: row.id,
        actorOwnerId: row.ownerId,
        from: ["HELD"],
        to: "EXPIRED",
        returnCapacity: true,
        now,
      });
      expired += 1;
    } catch {
      // Another worker transitioned it first — idempotent by state guard.
    }
  }
  return expired;
}

// ---------------------------------------------------------------------------
// Composite reservation — truthful sequential allocation + compensation
// ---------------------------------------------------------------------------

export type CompositeLeg = Omit<ReserveInput, "compositeGroupId" | "idempotencyKey"> & {
  legKey: string;
};

export type CompositeResult = {
  groupId: string;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  legs: Array<{ legKey: string; result: ReserveResult }>;
  compensated: string[];
};

/**
 * Independent resources do NOT share one transaction. Legs allocate in
 * order; on failure the policy applies (default: release prior legs) and the
 * outcome is truthfully PARTIAL/FAILED — never COMPLETE.
 */
export async function reserveComposite(
  db: Block2Db,
  input: {
    ownerId: string;
    groupKey: string;
    legs: CompositeLeg[];
    onLegFailure?: "release" | "keep";
    runId?: string;
    nodeId?: string;
  },
  authorizer: ReservationAuthorizer = ownerOnlyAuthorizer,
): Promise<CompositeResult> {
  const groupId = `cmp_${createCompositeId(input.ownerId, input.groupKey)}`;
  const legs: CompositeResult["legs"] = [];
  const compensated: string[] = [];
  const held: Reservation[] = [];

  for (const leg of input.legs) {
    const result = await reserveCapacity(
      db,
      {
        ...leg,
        ownerId: input.ownerId,
        compositeGroupId: groupId,
        runId: input.runId,
        nodeId: input.nodeId,
        idempotencyKey: `${input.groupKey}:${leg.legKey}`,
      },
      authorizer,
    );
    legs.push({ legKey: leg.legKey, result });
    if (result.outcome === "HELD") {
      held.push(result.reservation);
      continue;
    }
    // A leg failed: compensate prior legs per policy, report truthfully.
    if ((input.onLegFailure ?? "release") === "release") {
      for (const prior of held) {
        try {
          await releaseReservation(db, prior.id, input.ownerId);
          compensated.push(prior.id);
        } catch {
          // Compensation failure stays visible in leg evidence.
        }
      }
    }
    return {
      groupId,
      outcome: held.length > 0 ? "PARTIAL" : "FAILED",
      legs,
      compensated,
    };
  }
  return { groupId, outcome: "COMPLETE", legs, compensated };
}

function createCompositeId(ownerId: string, groupKey: string): string {
  // Deterministic: replaying the same composite request finds the same group.
  let hash = 0;
  const text = `${ownerId}${groupKey}`;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export async function getCompositeStatus(db: Block2Db, groupId: string): Promise<Reservation[]> {
  return db.select().from(reservations).where(eq(reservations.compositeGroupId, groupId));
}

/** Stale-version guard helper for external mutation paths. */
export async function getReservation(db: Block2Db, id: string): Promise<Reservation | undefined> {
  const rows = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  return rows[0];
}
