import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bookCompositeResource,
  dispatchAndTrack,
  multiPartyFulfillment,
} from "../../api/runtime/block2/compositions";
import { openAvailabilityWindow, getReservation } from "../../api/runtime/block2/capacity";
import { getAssignment } from "../../api/runtime/block2/assignments";
import { getTestDb, resetBlock2, type TestDbHandle } from "./helpers/pg";

describe("Block 2 composition recipes", () => {
  let database: TestDbHandle;

  beforeAll(async () => {
    database = await getTestDb();
  });
  beforeEach(async () => {
    await resetBlock2(database.db);
  });

  it("books composite legs with composed idempotency and truthful projection", async () => {
    const ownerId = "composition-owner";
    await openWindow(database, ownerId, "van-1");
    await openWindow(database, ownerId, "van-2");
    const input = {
      ownerId,
      requesterId: ownerId,
      idempotencyKey: "trip-44",
      holdTtlMs: 60_000,
      legs: [
        { resourceKind: "vehicle", resourceId: "van-1", quantity: 1, unit: "vehicle" },
        { resourceKind: "vehicle", resourceId: "van-2", quantity: 1, unit: "vehicle" },
      ],
    };

    const first = await bookCompositeResource(database.db, input);
    const replay = await bookCompositeResource(database.db, input);
    expect(first.outcome).toBe("COMPLETE");
    expect(first.reservations).toHaveLength(2);
    expect(replay.reservations.map((row) => row.id)).toEqual(
      first.reservations.map((row) => row.id),
    );
    expect(replay.legs.every(({ result }) => result.outcome === "HELD" && result.duplicate))
      .toBe(true);
  });

  it("links assignment tracking and compensates when notification creation fails", async () => {
    await expect(
      dispatchAndTrack(database.db, {
        ownerId: "dispatch-owner",
        assignment: {
          subjectKind: "person",
          subjectId: "courier-1",
          idempotencyKey: "dispatch-1",
        },
        track: {
          subjectKind: "person",
          subjectId: "courier-1",
          purpose: "fulfillment",
        },
        notification: {
          recipientId: "courier-1",
          purpose: "assignment",
          content: { title: "", body: "New assignment" },
          idempotencyKey: "notify-dispatch-1",
        },
      }),
    ).rejects.toMatchObject({ step: "notificationIntent" });

    const assignment = await getAssignmentByKey(database, "dispatch-owner", "dispatch-1");
    expect(assignment?.state).toBe("CANCELLED");
    const rows = await database.pool.query(
      `select state, "assignmentId" from track_sessions where "ownerId" = $1`,
      ["dispatch-owner"],
    );
    expect(rows.rows).toEqual([{ state: "closed", assignmentId: assignment!.id }]);
  });

  it("never reports complete after a later failure and reverses compensable work", async () => {
    const ownerId = "fulfillment-owner";
    await openWindow(database, ownerId, "resource-1");
    const result = await multiPartyFulfillment(database.db, {
      ownerId,
      legs: [
        {
          resourceKind: "vehicle",
          resourceId: "resource-1",
          quantity: 1,
          unit: "vehicle",
          idempotencyKey: "reserve-resource-1",
        },
      ],
      assignments: [
        {
          subjectKind: "person",
          subjectId: "worker-1",
          idempotencyKey: "offer-worker-1",
        },
      ],
      notificationIntents: [
        {
          recipientId: "worker-1",
          purpose: "offer",
          content: { title: "", body: "invalid notification" },
          idempotencyKey: "notify-worker-1",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "FAILED",
      failedStep: "notificationIntent:0",
      completedSteps: ["reservations", "assignment:0"],
    });
    const assignment = await getAssignment(database.db, result.assignments[0]!.id);
    const heldResult = result.reservations!.legs[0]!.result;
    expect(assignment?.state).toBe("CANCELLED");
    expect(heldResult.outcome).toBe("HELD");
    if (heldResult.outcome === "HELD") {
      expect((await getReservation(database.db, heldResult.reservation.id))?.status).toBe(
        "RELEASED",
      );
    }
  });
});

async function openWindow(database: TestDbHandle, ownerId: string, resourceId: string) {
  return openAvailabilityWindow(database.db, {
    ownerId,
    resourceKind: "vehicle",
    resourceId,
    startsAt: new Date(Date.now() - 1_000),
    endsAt: new Date(Date.now() + 3_600_000),
    capacity: 1,
    unit: "vehicle",
  });
}

async function getAssignmentByKey(
  database: TestDbHandle,
  ownerId: string,
  idempotencyKey: string,
) {
  const result = await database.pool.query(
    `select id from assignments where "ownerId" = $1 and "idempotencyKey" = $2`,
    [ownerId, idempotencyKey],
  );
  return result.rows[0] ? getAssignment(database.db, result.rows[0].id) : undefined;
}