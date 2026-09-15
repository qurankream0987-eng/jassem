import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { availabilityWindows, reservations } from "@db/schema";
import {
  getReservation,
  openAvailabilityWindow,
  reserveCapacity,
  reserveComposite,
} from "../../api/runtime/block2/capacity";
import {
  createTemporalTrigger,
  fireDueTemporalTriggers,
  type ContinuationDispatcher,
} from "../../api/runtime/block2/temporal";
import {
  createDelegationGrant,
  revalidateDelegationGrant,
} from "../../api/runtime/block2/delegation";
import {
  grantMembership,
  makeMembershipReservationAuthorizer,
} from "../../api/runtime/block2/membership";
import {
  offerAssignment,
  respondToAssignment,
} from "../../api/runtime/block2/assignments";
import {
  attachObservationToTrack,
  openTrackSession,
  projectTrackForViewer,
  recordObservation,
} from "../../api/runtime/block2/observations";
import {
  createNotificationIntent,
  deliverNotificationIntent,
  type ChannelAdapter,
} from "../../api/runtime/block2/notifications";
import {
  createRemoteExecution,
  attachRemoteReference,
  transitionRemoteExecution,
} from "../../api/runtime/block2/remote-execution";
import {
  bookCompositeResource,
  dispatchAndTrack,
  multiPartyFulfillment,
} from "../../api/runtime/block2/compositions";
import { getTestDb, resetBlock2, type TestDbHandle } from "./helpers/pg";

const now = new Date("2025-01-01T00:00:00.000Z");
const later = new Date("2025-01-02T00:00:00.000Z");
const runId = "00000000-0000-4000-8000-000000000101";
const nodeId = "00000000-0000-4000-8000-000000000102";

function notificationAdapter(
  channel: string,
  outcome: "SENT" | "DELIVERED" | "INCONCLUSIVE",
): ChannelAdapter {
  return {
    channel,
    configured: true,
    async send() {
      return {
        outcome,
        ...(outcome === "INCONCLUSIVE" ? { error: "provider timeout" } : {}),
      };
    },
  };
}

describe.sequential("Block 2 — 15 known operational scenarios", () => {
  let database: TestDbHandle;

  beforeAll(async () => {
    database = await getTestDb();
  });

  beforeEach(async () => {
    await resetBlock2(database.db);
  });

  it("1 technician dispatch — composes an assignment and track without claiming acceptance", async () => {
    const result = await dispatchAndTrack(database.db, {
      ownerId: "dispatch-company",
      assignment: {
        subjectKind: "technician",
        subjectId: "tech-1",
        terms: { job: "repair" },
        idempotencyKey: "dispatch-1",
      },
      track: {
        subjectKind: "technician",
        subjectId: "tech-1",
        purpose: "service-dispatch",
      },
    });

    expect(result.assignment.state).toBe("OFFERED");
    expect(result.assignment.state).not.toBe("ACCEPTED");
    expect(result.trackSession.assignmentId).toBe(result.assignment.id);
  });

  it("2 technician tracking — an observation remains stale evidence and owner location stays private", async () => {
    const observation = await recordObservation(database.db, {
      ownerId: "dispatch-company",
      subjectKind: "technician",
      subjectId: "tech-1",
      observationType: "location",
      observedAt: now,
      freshnessExpiresAt: now,
      payload: { lat: 24.713612, lng: 46.675296 },
    });
    const track = await openTrackSession(database.db, {
      ownerId: "dispatch-company",
      subjectKind: "technician",
      subjectId: "tech-1",
      purpose: "service-dispatch",
      viewerScope: {
        viewers: [{
          subjectId: "customer",
          precision: "approximate",
          until: later.toISOString(),
        }],
      },
    });
    await attachObservationToTrack(database.db, {
      trackSessionId: track.id,
      ownerId: "dispatch-company",
      observationId: observation.id,
    });

    expect(await projectTrackForViewer(database.db, {
      trackSessionId: track.id,
      viewerId: "customer",
      now,
    })).toMatchObject({
      visible: true,
      precision: "approximate",
      freshness: "STALE",
      location: { lat: 24.71, lng: 46.68 },
    });
    expect(await projectTrackForViewer(database.db, {
      trackSessionId: track.id,
      viewerId: "stranger",
      now,
    })).toMatchObject({ visible: false });
  });

  it("3 cold-storage reservation — concurrent requests cannot double-book capacity", async () => {
    const window = await openWindow("cold-store", "cold-room", 10, "ton");
    const [seven, five] = await Promise.all([
      reserveCapacity(database.db, {
        ownerId: "cold-store",
        resourceKind: "room",
        resourceId: "cold-room",
        quantity: 7,
        unit: "ton",
        idempotencyKey: "cold-7",
        windowId: window.id,
      }),
      reserveCapacity(database.db, {
        ownerId: "cold-store",
        resourceKind: "room",
        resourceId: "cold-room",
        quantity: 5,
        unit: "ton",
        idempotencyKey: "cold-5",
        windowId: window.id,
      }),
    ]);

    expect([seven.outcome, five.outcome].sort()).toEqual(["CONFLICT", "HELD"]);
    const [stored] = await database.db
      .select()
      .from(availabilityWindows)
      .where(eq(availabilityWindows.id, window.id));
    expect(Number(stored.capacityHeld)).toBeLessThanOrEqual(10_000);
  });

  it("4 composite capacity — second-leg failure is PARTIAL and compensates, never COMPLETE", async () => {
    const first = await openWindow("storage-owner", "warehouse-a", 6, "ton");
    const second = await openWindow("storage-owner", "warehouse-b", 3, "ton");
    const result = await reserveComposite(database.db, {
      ownerId: "storage-owner",
      groupKey: "ten-ton-load",
      onLegFailure: "release",
      legs: [
        {
          legKey: "six",
          ownerId: "storage-owner",
          resourceKind: "warehouse",
          resourceId: "warehouse-a",
          quantity: 6,
          unit: "ton",
          windowId: first.id,
        },
        {
          legKey: "four",
          ownerId: "storage-owner",
          resourceKind: "warehouse",
          resourceId: "warehouse-b",
          quantity: 4,
          unit: "ton",
          windowId: second.id,
        },
      ],
    });

    expect(result.outcome).toBe("PARTIAL");
    expect(result.outcome).not.toBe("COMPLETE");
    expect(result.compensated).toHaveLength(1);
    expect((await database.db.select().from(reservations))[0]?.status).toBe("RELEASED");
  });

  it("5 recurring bus — one due recurrence is claimed once across concurrent sweeps", async () => {
    const dispatched: string[] = [];
    const dispatcher: ContinuationDispatcher = {
      async dispatch(input) {
        if (dispatched.includes(input.idempotencyKey)) return "duplicate";
        dispatched.push(input.idempotencyKey);
        return "enqueued";
      },
    };
    await createTemporalTrigger(database.db, {
      ownerId: "bus-operator",
      kind: "RECURRING",
      timezone: "Asia/Riyadh",
      recurrence: { freq: "daily", timeOfDay: "03:00" },
      now: new Date("2024-12-31T23:00:00.000Z"),
      idempotencyKey: "route-1-daily",
      continuation: { jobKind: "dispatch-bus" },
    });
    const results = await Promise.all([
      fireDueTemporalTriggers(database.db, dispatcher, undefined, { now }),
      fireDueTemporalTriggers(database.db, dispatcher, undefined, { now }),
    ]);

    expect(results.reduce((total, result) => total + result.fired, 0)).toBe(1);
    expect(dispatched).toHaveLength(1);
  });

  it("6 recurring notification — recurrence creates one intent and SENT is not DELIVERED", async () => {
    const sentIntentIds: string[] = [];
    const dispatcher: ContinuationDispatcher = {
      async dispatch(input) {
        const intent = await createNotificationIntent(database.db, {
          ownerId: input.ownerId,
          recipientId: "subscriber",
          purpose: "daily-reminder",
          content: { title: "Reminder", body: "Daily operation" },
          idempotencyKey: input.idempotencyKey,
        });
        sentIntentIds.push(intent.id);
        return "enqueued";
      },
    };
    await createTemporalTrigger(database.db, {
      ownerId: "reminder-owner",
      kind: "RECURRING",
      timezone: "UTC",
      recurrence: { freq: "daily", timeOfDay: "00:00" },
      now: new Date("2024-12-31T23:59:00.000Z"),
      idempotencyKey: "daily-notification",
      continuation: { jobKind: "notify" },
    });
    await fireDueTemporalTriggers(database.db, dispatcher, undefined, { now });
    const delivered = await deliverNotificationIntent(database.db, {
      intentId: sentIntentIds[0]!,
      attemptContext: { attemptId: "daily-attempt" },
      adapters: [notificationAdapter("in_app", "SENT")],
    });

    expect(sentIntentIds).toHaveLength(1);
    expect(delivered.state).toBe("SENT");
    expect(delivered.state).not.toBe("DELIVERED");
  });

  it("7 delegated negotiation without purchase — delegated authority cannot expand to PAY", async () => {
    const grant = await createDelegationGrant(database.db, {
      principalOwnerId: "buyer",
      delegateId: "negotiator",
      purpose: "supplier-negotiation",
      allowedCapabilities: ["NEGOTIATE"],
      deniedCapabilities: ["PAY"],
      resourceScope: { kinds: ["supplier-offer"] },
      maxMonetary: 1000,
      currency: "USD",
      now,
      expiresAt: later,
    });

    expect(await revalidateDelegationGrant(database.db, {
      grantId: grant.id,
      delegateId: "negotiator",
      capability: "NEGOTIATE",
      purpose: "supplier-negotiation",
      now,
    })).toMatchObject({ ok: true });
    expect(await revalidateDelegationGrant(database.db, {
      grantId: grant.id,
      delegateId: "negotiator",
      capability: "PAY",
      purpose: "supplier-negotiation",
      now,
    })).toMatchObject({ ok: false, code: "CAPABILITY_DENIED" });
  });

  it("8 supplier timeout/fallback — timeout stays CANCEL_REQUESTED without provider confirmation", async () => {
    const execution = await createRemoteExecution(database.db, {
      ownerId: "buyer",
      runId,
      nodeId,
      providerId: "supplier",
      protocolKind: "A2A",
      requestDigest: "a".repeat(64),
      idempotencyKey: "supplier-request",
    });
    const running = await attachRemoteReference(database.db, {
      id: execution.id,
      ownerId: "buyer",
      remoteReference: "supplier-task-1",
      expectedVersion: execution.version,
    });
    const requested = await transitionRemoteExecution(database.db, {
      id: running.id,
      ownerId: "buyer",
      to: "CANCEL_REQUESTED",
      expectedVersion: running.version,
      evidence: { reason: "supplier timeout; fallback selected" },
    });
    const fallback = await createRemoteExecution(database.db, {
      ownerId: "buyer",
      runId,
      nodeId,
      providerId: "supplier-fallback",
      protocolKind: "A2A",
      requestDigest: "b".repeat(64),
      idempotencyKey: "supplier-fallback-request",
    });

    expect(requested.state).toBe("CANCEL_REQUESTED");
    expect(requested.state).not.toBe("CANCEL_CONFIRMED");
    expect(fallback).toMatchObject({ state: "INVOKED", providerId: "supplier-fallback" });
    expect(fallback.id).not.toBe(requested.id);
    await expect(transitionRemoteExecution(database.db, {
      id: requested.id,
      ownerId: "buyer",
      to: "CANCEL_CONFIRMED",
      expectedVersion: requested.version,
      evidence: { reason: "local timeout only" },
    })).rejects.toThrow(/provider evidence/);
  });

  it("9 shared equipment — owner isolation denies use until an explicit membership grant", async () => {
    const window = await openWindow("equipment-owner", "shared-equipment", 1, "unit");
    const request = {
      ownerId: "neighbor",
      resourceKind: "equipment",
      resourceId: "shared-equipment",
      quantity: 1,
      unit: "unit",
      windowId: window.id,
    };
    expect((await reserveCapacity(database.db, {
      ...request,
      idempotencyKey: "equipment-denied",
    })).outcome).toBe("FORBIDDEN");

    await grantMembership(database.db, {
      ownerId: "equipment-owner",
      subjectId: "neighbor",
      resourceKind: "equipment",
      resourceId: "shared-equipment",
      permissions: ["reserve"],
    });
    expect((await reserveCapacity(database.db, {
      ...request,
      idempotencyKey: "equipment-granted",
    }, makeMembershipReservationAuthorizer(database.db))).outcome).toBe("HELD");
  });

  it("10 booking — an idempotency replay returns the same booking without allocating twice", async () => {
    await openWindow("hotel", "room-10", 1, "unit");
    const input = {
      ownerId: "hotel",
      requesterId: "hotel",
      idempotencyKey: "booking-10",
      legs: [{
        resourceKind: "room",
        resourceId: "room-10",
        quantity: 1,
        unit: "unit",
      }],
    };
    const first = await bookCompositeResource(database.db, input);
    const replay = await bookCompositeResource(database.db, input);

    expect(first.outcome).toBe("COMPLETE");
    expect(replay.reservations[0]?.id).toBe(first.reservations[0]?.id);
    expect(replay.legs[0]?.result).toMatchObject({ outcome: "HELD", duplicate: true });
    const [window] = await database.db.select().from(availabilityWindows);
    expect(Number(window.capacityHeld)).toBe(1);
  });

  it("11 post-sale delivery — provider acceptance is SENT, not delivery or read proof", async () => {
    const intent = await createNotificationIntent(database.db, {
      ownerId: "merchant",
      recipientId: "customer",
      purpose: "post-sale-delivery-update",
      content: { title: "Order shipped", body: "Carrier accepted the parcel" },
      idempotencyKey: "order-11-update",
    });
    const result = await deliverNotificationIntent(database.db, {
      intentId: intent.id,
      attemptContext: { attemptId: "carrier-update" },
      adapters: [notificationAdapter("in_app", "SENT")],
    });

    expect(result.state).toBe("SENT");
    expect(result.state).not.toBe("DELIVERED");
    expect(result.state).not.toBe("READ");
  });

  it("12 job application approval boundary — OFFERED remains distinct and only applicant may accept", async () => {
    const { assignment } = await offerAssignment(database.db, {
      ownerId: "employer",
      subjectKind: "applicant",
      subjectId: "applicant-1",
      terms: { requiresApproval: true },
      idempotencyKey: "application-12",
    });

    expect(assignment.state).toBe("OFFERED");
    expect(assignment.state).not.toBe("ACCEPTED");
    await expect(respondToAssignment(database.db, {
      assignmentId: assignment.id,
      subjectId: "employer",
      response: "ACCEPTED",
      now,
    })).rejects.toThrow(/Only the assigned subject/);
  });

  it("13 farm→restaurant→transport→storage — late failure compensates all prior work", async () => {
    await openWindow("supply-chain", "farm-load", 1, "ton");
    await openWindow("supply-chain", "cold-storage", 1, "ton");
    const result = await multiPartyFulfillment(database.db, {
      ownerId: "supply-chain",
      legs: [
        {
          resourceKind: "produce",
          resourceId: "farm-load",
          quantity: 1,
          unit: "ton",
          idempotencyKey: "farm",
        },
        {
          resourceKind: "warehouse",
          resourceId: "cold-storage",
          quantity: 1,
          unit: "ton",
          idempotencyKey: "storage",
        },
      ],
      assignments: [{
        subjectKind: "transporter",
        subjectId: "truck-1",
        idempotencyKey: "transport",
      }],
      notificationIntents: [{
        recipientId: "restaurant",
        purpose: "delivery",
        content: { title: "", body: "invalid title forces truthful failure" },
        idempotencyKey: "restaurant-notice",
      }],
    });

    expect(result.status).toBe("FAILED");
    expect(result.status).not.toBe("COMPLETE");
    for (const leg of result.reservations?.legs ?? []) {
      if (leg.result.outcome === "HELD") {
        expect((await getReservation(database.db, leg.result.reservation.id))?.status)
          .toBe("RELEASED");
      }
    }
  });

  it("14 elderly medical transport — regulatory review is explicit, not a completed ride", async () => {
    const { assignment } = await offerAssignment(database.db, {
      ownerId: "care-coordinator",
      subjectKind: "medical-driver",
      subjectId: "driver-14",
      terms: {
        patientDataDisclosure: "minimum",
        decision: "REQUIRES_REGULATORY_REVIEW",
      },
      idempotencyKey: "medical-transport-14",
    });

    expect(assignment.terms).toMatchObject({
      decision: "REQUIRES_REGULATORY_REVIEW",
      patientDataDisclosure: "minimum",
    });
    expect(assignment.state).toBe("OFFERED");
    expect(assignment.state).not.toBe("COMPLETED");
  });

  it("15 unknown idle-resource example — generic primitives handle an unseen kind without inventing verified truth", async () => {
    const window = await openWindow("idle-owner", "unseen-idle-resource", 2, "unit");
    const reservation = await reserveCapacity(database.db, {
      ownerId: "idle-owner",
      resourceKind: "future-unknown-kind",
      resourceId: "unseen-idle-resource",
      quantity: 1,
      unit: "unit",
      idempotencyKey: "unknown-15",
      windowId: window.id,
    });
    const observation = await recordObservation(database.db, {
      ownerId: "idle-owner",
      subjectKind: "future-unknown-kind",
      subjectId: "unseen-idle-resource",
      observationType: "idle-status",
      observedAt: now,
      payload: { reportedState: "idle" },
      provenance: { source: "unverified-sensor" },
    });

    expect(reservation.outcome).toBe("HELD");
    expect(observation.payload).toEqual({ reportedState: "idle" });
    expect(observation.provenance).toEqual({ source: "unverified-sensor" });
    expect(observation).not.toHaveProperty("verified", true);
  });

  async function openWindow(
    ownerId: string,
    resourceId: string,
    capacity: number,
    unit: string,
  ) {
    return openAvailabilityWindow(database.db, {
      ownerId,
      resourceKind: resourceId === "unseen-idle-resource"
        ? "future-unknown-kind"
        : resourceId.includes("room")
          ? "room"
          : resourceId.includes("equipment")
            ? "equipment"
            : resourceId.includes("warehouse") || resourceId.includes("cold")
              ? "warehouse"
              : resourceId.includes("farm")
                ? "produce"
                : "resource",
      resourceId,
      startsAt: now,
      endsAt: later,
      capacity,
      unit,
    });
  }
});