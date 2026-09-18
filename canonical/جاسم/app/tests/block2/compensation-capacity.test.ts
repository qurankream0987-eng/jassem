import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { availabilityWindows, reservations } from "@db/schema";
import {
  getAvailability,
  openAvailabilityWindow,
  releaseReservation,
  reserveCapacity,
} from "../../api/runtime/block2/capacity";
import { getTestDb, resetBlock2 } from "./helpers/pg";

/**
 * CAPACITY RELEASE AS A COMPENSATION.
 *
 * Part 17 of the brief asks for proof of four properties when a reserved
 * capacity is released because a later step failed. The important thing this
 * file establishes is that **nothing new was built to get them**.
 *
 * `transitionReservation` already runs inside a transaction with
 * `SELECT … FOR UPDATE` and a `from`-state guard, so a second release cannot
 * find a releasable row and capacity cannot be returned twice. The compensation
 * layer's contribution is to CALL that, not to reimplement it — a compensating
 * action that invented its own release path would be exactly the parallel
 * execution infrastructure the brief forbids.
 */

const start = new Date("2025-01-01T00:00:00Z");
const end = new Date("2025-01-02T00:00:00Z");

async function open(resourceId: string, capacity = 3) {
  const { db } = await getTestDb();
  return openAvailabilityWindow(db, {
    ownerId: "owner", resourceKind: "resource", resourceId,
    startsAt: start, endsAt: end, capacity, unit: "units",
  });
}

describe("releasing reserved capacity as a compensating effect", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("NO DOUBLE RELEASE — a second release finds nothing releasable", async () => {
    const { db } = await getTestDb();
    await open("r1");
    const held = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r1",
      quantity: 2, unit: "units", idempotencyKey: "k1",
      windowFrom: start, windowTo: end,
    });
    expect(held.outcome).toBe("HELD");
    const reservationId = (held as { reservation: { id: string } }).reservation.id;

    const first = await releaseReservation(db, reservationId, "owner");
    expect(first.status).toBe("RELEASED");
    // The state guard is what makes this safe under a worker restart or a
    // duplicate job delivery — not a flag the caller has to remember.
    await expect(releaseReservation(db, reservationId, "owner")).rejects.toThrow();
  });

  it("NO LEAKED CAPACITY — released capacity returns exactly once", async () => {
    const { db } = await getTestDb();
    await open("r2", 3);
    const before = await getAvailability(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r2", from: start, to: end,
    });
    const held = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r2",
      quantity: 2, unit: "units", idempotencyKey: "k2", windowFrom: start, windowTo: end,
    });
    const reservationId = (held as { reservation: { id: string } }).reservation.id;

    await releaseReservation(db, reservationId, "owner");
    await expect(releaseReservation(db, reservationId, "owner")).rejects.toThrow();

    const after = await getAvailability(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r2", from: start, to: end,
    });
    // Exactly restored: not short (leaked) and not over (resurrected).
    //
    // NOTE: an earlier draft compared `.remaining`, which this projection does
    // not have — so both sides were `undefined` and the test passed vacuously.
    // The field is `available`, and it is a number.
    expect(typeof after[0]!.available).toBe("number");
    expect(after[0]!.available).toBe(before[0]!.available);
  });

  it("NO CAPACITY RESURRECTION — the window never exceeds its own capacity", async () => {
    const { db } = await getTestDb();
    const window = await open("r3", 3);
    const ids: string[] = [];
    for (const key of ["a", "b", "c"]) {
      const held = await reserveCapacity(db, {
        ownerId: "owner", resourceKind: "resource", resourceId: "r3",
        quantity: 1, unit: "units", idempotencyKey: key, windowFrom: start, windowTo: end,
      });
      ids.push((held as { reservation: { id: string } }).reservation.id);
    }
    for (const id of ids) await releaseReservation(db, id, "owner");
    // And every duplicate release attempt is refused.
    for (const id of ids) await expect(releaseReservation(db, id, "owner")).rejects.toThrow();

    const [row] = await db.select().from(availabilityWindows)
      .where(eq(availabilityWindows.id, window.id));
    const availability = await getAvailability(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r3", from: start, to: end,
    });
    // capacityHeld is the authoritative counter; after releasing everything it
    // must be exactly zero — not negative (resurrection) and not positive (leak).
    expect(Number(row!.capacityHeld)).toBe(0);
    expect(availability[0]!.available).toBe(Number(row!.capacityTotal));
  });

  it("NO OVERBOOKING — capacity released by compensation is re-reservable exactly once", async () => {
    const { db } = await getTestDb();
    await open("r4", 1);
    const first = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r4",
      quantity: 1, unit: "units", idempotencyKey: "first", windowFrom: start, windowTo: end,
    });
    expect(first.outcome).toBe("HELD");
    // Full: a second reservation is refused.
    const blocked = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r4",
      quantity: 1, unit: "units", idempotencyKey: "second", windowFrom: start, windowTo: end,
    });
    expect(blocked.outcome).toBe("CONFLICT");

    // Compensation releases the first.
    await releaseReservation(db, (first as { reservation: { id: string } }).reservation.id, "owner");

    const reclaimed = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r4",
      quantity: 1, unit: "units", idempotencyKey: "third", windowFrom: start, windowTo: end,
    });
    expect(reclaimed.outcome).toBe("HELD");
    // And still exactly one: releasing did not create a second slot.
    const overbook = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r4",
      quantity: 1, unit: "units", idempotencyKey: "fourth", windowFrom: start, windowTo: end,
    });
    expect(overbook.outcome).toBe("CONFLICT");
  });

  it("the released reservation stays in history — it is not deleted", async () => {
    const { db } = await getTestDb();
    await open("r5");
    const held = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r5",
      quantity: 1, unit: "units", idempotencyKey: "hist", windowFrom: start, windowTo: end,
    });
    const reservationId = (held as { reservation: { id: string } }).reservation.id;
    await releaseReservation(db, reservationId, "owner");

    // COMPENSATION != DELETE HISTORY. The reservation happened; its status
    // records what became of it.
    const [row] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
    expect(row).toBeDefined();
    expect(row!.status).toBe("RELEASED");
  });

  it("another owner cannot release a reservation as a compensation", async () => {
    const { db } = await getTestDb();
    await open("r6");
    const held = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "r6",
      quantity: 1, unit: "units", idempotencyKey: "own", windowFrom: start, windowTo: end,
    });
    await expect(
      releaseReservation(db, (held as { reservation: { id: string } }).reservation.id, "intruder"),
    ).rejects.toThrow();
  });
});
