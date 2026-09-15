import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { availabilityWindows, reservations } from "@db/schema";
import {
  cancelReservation,
  confirmReservation,
  expireDueReservations,
  openAvailabilityWindow,
  releaseReservation,
  reserveCapacity,
  reserveComposite,
} from "../../api/runtime/block2/capacity";
import { grantMembership, makeMembershipReservationAuthorizer } from "../../api/runtime/block2/membership";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const start = new Date("2025-01-01T00:00:00Z");
const end = new Date("2025-01-02T00:00:00Z");

async function open(resourceId: string, capacity = 5, ownerId = "owner") {
  const { db } = await getTestDb();
  return openAvailabilityWindow(db, {
    ownerId, resourceKind: "resource", resourceId, startsAt: start, endsAt: end,
    capacity, unit: "units",
  });
}

describe("Block 2 capacity", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("opens a window and truthfully reports insufficient capacity without mutation", async () => {
    const { db } = await getTestDb();
    const window = await open("one", 2);
    const held = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "one",
      quantity: 2, unit: "units", idempotencyKey: "held", windowId: window.id,
    });
    const conflict = await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "one",
      quantity: 1, unit: "units", idempotencyKey: "insufficient", windowId: window.id,
    });
    expect(held.outcome).toBe("HELD");
    expect(conflict).toMatchObject({ outcome: "CONFLICT", reason: expect.stringMatching(/Insufficient/) });
    const [current] = await db.select().from(availabilityWindows).where(eq(availabilityWindows.id, window.id));
    expect(Number(current.capacityHeld)).toBe(2);
  });

  it("does not oversell under twenty concurrent database reservations", async () => {
    const { db } = await getTestDb();
    const window = await open("race", 5);
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      reserveCapacity(db, {
        ownerId: "owner", resourceKind: "resource", resourceId: "race",
        quantity: 1, unit: "unit", idempotencyKey: `race-${index}`, windowId: window.id,
      })));
    expect(outcomes.filter((result) => result.outcome === "HELD")).toHaveLength(5);
    expect(outcomes.filter((result) => result.outcome === "CONFLICT")).toHaveLength(15);
    const [current] = await db.select().from(availabilityWindows).where(eq(availabilityWindows.id, window.id));
    expect(Number(current.capacityHeld)).toBe(5);
  });

  it("replays an idempotency key without holding capacity twice", async () => {
    const { db } = await getTestDb();
    const window = await open("idem");
    const input = {
      ownerId: "owner", resourceKind: "resource", resourceId: "idem",
      quantity: 1, unit: "unit", idempotencyKey: "same", windowId: window.id,
    };
    const first = await reserveCapacity(db, input);
    const replay = await reserveCapacity(db, input);
    expect(first.outcome).toBe("HELD");
    expect(replay.outcome).toBe("HELD");
    if (first.outcome === "HELD" && replay.outcome === "HELD") {
      expect(replay.duplicate).toBe(true);
      expect(replay.reservation.id).toBe(first.reservation.id);
    }
    const [current] = await db.select().from(availabilityWindows).where(eq(availabilityWindows.id, window.id));
    expect(Number(current.capacityHeld)).toBe(1);
  });

  it("expires holds and returns capacity", async () => {
    const { db } = await getTestDb();
    const window = await open("expiry");
    await reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "expiry", quantity: 2,
      unit: "units", idempotencyKey: "exp", windowId: window.id, holdExpiresAt: start,
    });
    expect(await expireDueReservations(db, { now: end })).toBe(1);
    const [current] = await db.select().from(availabilityWindows).where(eq(availabilityWindows.id, window.id));
    expect(Number(current.capacityHeld)).toBe(0);
  });

  it("enforces confirm, release, and cancel state guards", async () => {
    const { db } = await getTestDb();
    const window = await open("states");
    const reserve = (key: string) => reserveCapacity(db, {
      ownerId: "owner", resourceKind: "resource", resourceId: "states",
      quantity: 1, unit: "unit", idempotencyKey: key, windowId: window.id,
    });
    const first = await reserve("confirm");
    if (first.outcome !== "HELD") throw new Error("expected hold");
    expect((await confirmReservation(db, first.reservation.id, "owner")).status).toBe("CONFIRMED");
    await expect(confirmReservation(db, first.reservation.id, "owner")).rejects.toThrow();
    expect((await releaseReservation(db, first.reservation.id, "owner")).status).toBe("RELEASED");
    await expect(cancelReservation(db, first.reservation.id, "owner")).rejects.toThrow();
    const second = await reserve("cancel");
    if (second.outcome !== "HELD") throw new Error("expected hold");
    expect((await cancelReservation(db, second.reservation.id, "owner")).status).toBe("CANCELLED");
  });

  it("denies cross-owner reservations until membership grants reserve access", async () => {
    const { db } = await getTestDb();
    const window = await open("shared", 2, "resource-owner");
    const input = {
      ownerId: "requester", resourceKind: "resource", resourceId: "shared",
      quantity: 1, unit: "unit", idempotencyKey: "denied", windowId: window.id,
    };
    expect((await reserveCapacity(db, input)).outcome).toBe("FORBIDDEN");
    await grantMembership(db, {
      ownerId: "resource-owner", subjectId: "requester", resourceKind: "resource",
      resourceId: "shared", permissions: ["reserve"],
    });
    expect((await reserveCapacity(db, { ...input, idempotencyKey: "allowed" }, makeMembershipReservationAuthorizer(db))).outcome).toBe("HELD");
  });

  it("reports a partial composite and compensates a successful first leg", async () => {
    const { db } = await getTestDb();
    const firstWindow = await open("leg-one", 1);
    const secondWindow = await open("leg-two", 1);
    const result = await reserveComposite(db, {
      ownerId: "owner", groupKey: "composite", onLegFailure: "release",
      legs: [
        { legKey: "one", ownerId: "ignored", resourceKind: "resource", resourceId: "leg-one", quantity: 1, unit: "unit", windowId: firstWindow.id },
        { legKey: "two", ownerId: "ignored", resourceKind: "resource", resourceId: "leg-two", quantity: 2, unit: "units", windowId: secondWindow.id },
      ],
    });
    expect(result.outcome).toBe("PARTIAL");
    expect(result.compensated).toHaveLength(1);
    const rows = await db.select().from(reservations);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("RELEASED");
    const [current] = await db.select().from(availabilityWindows).where(eq(availabilityWindows.id, firstWindow.id));
    expect(Number(current.capacityHeld)).toBe(0);
  });
});