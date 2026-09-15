import { beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { events, reservations, temporalTriggers } from "@db/schema";
import {
  createTemporalTrigger,
  fireDueTemporalTriggers,
  transitionTemporalTrigger,
  type ContinuationDispatcher,
} from "../../api/runtime/block2/temporal";
import {
  confirmReservation,
  expireDueReservations,
  openAvailabilityWindow,
  reserveCapacity,
  reserveComposite,
} from "../../api/runtime/block2/capacity";
import {
  createDelegationGrant,
  revalidateDelegationGrant,
  revokeDelegationGrant,
} from "../../api/runtime/block2/delegation";
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
import { ingestExternalEvent } from "../../api/runtime/block2/events";
import {
  attachRemoteReference,
  createRemoteExecution,
  recordProviderCallback,
} from "../../api/runtime/block2/remote-execution";
import { canonicalQuantity } from "../../api/runtime/block2/units";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const start = new Date("2025-01-01T00:00:00.000Z");
const end = new Date("2025-01-02T00:00:00.000Z");

function dispatcher(calls: string[]): ContinuationDispatcher {
  return {
    async dispatch(input) {
      if (calls.includes(input.idempotencyKey)) return "duplicate";
      calls.push(input.idempotencyKey);
      return "enqueued";
    },
  };
}

async function windowFor(
  resourceId: string,
  capacity: number,
  unit: string,
  ownerId = "owner",
) {
  return openAvailabilityWindow((await getTestDb()).db, {
    ownerId,
    resourceKind: "resource",
    resourceId,
    startsAt: start,
    endsAt: end,
    capacity,
    unit,
  });
}

describe("Block 2 unseen operational goals", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("goal 01: a paused recurring weekday continuation resumes at the next occurrence without a retroactive double wake", async () => {
    const { db } = await getTestDb();
    const calls: string[] = [];
    const created = await createTemporalTrigger(db, {
      ownerId: "owner",
      kind: "RECURRING",
      timezone: "UTC",
      recurrence: { freq: "weekdays", timeOfDay: "09:00", count: 2 },
      continuation: { jobKind: "resume-node" },
      idempotencyKey: "weekday-sequence",
      now: new Date("2025-01-03T10:00:00.000Z"),
    });
    await transitionTemporalTrigger(db, {
      ownerId: "owner",
      triggerId: created.trigger.id,
      action: "pause",
    });
    expect((await fireDueTemporalTriggers(
      db,
      dispatcher(calls),
      undefined,
      { now: new Date("2025-01-06T10:00:00.000Z") },
    )).fired).toBe(0);
    await transitionTemporalTrigger(db, {
      ownerId: "owner",
      triggerId: created.trigger.id,
      action: "resume",
      now: new Date("2025-01-06T10:00:00.000Z"),
    });
    await Promise.all([
      fireDueTemporalTriggers(db, dispatcher(calls), undefined, {
        now: new Date("2025-01-07T09:00:00.000Z"),
      }),
      fireDueTemporalTriggers(db, dispatcher(calls), undefined, {
        now: new Date("2025-01-07T09:00:00.000Z"),
      }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("goal 02: expiry during a multi-leg attempt remains PARTIAL and compensates every acquired leg", async () => {
    const { db } = await getTestDb();
    const first = await windowFor("expiring-first", 1, "unit");
    const second = await windowFor("blocked-second", 1, "unit");
    const expiring = await reserveCapacity(db, {
      ownerId: "owner",
      resourceKind: "resource",
      resourceId: "expiring-first",
      quantity: 1,
      unit: "unit",
      windowId: first.id,
      holdExpiresAt: start,
      idempotencyKey: "preflight-hold",
    });
    expect(expiring.outcome).toBe("HELD");
    expect(await expireDueReservations(db, { now: end })).toBe(1);
    const result = await reserveComposite(db, {
      ownerId: "owner",
      groupKey: "expiry-during-composite",
      legs: [
        {
          legKey: "reacquired",
          ownerId: "ignored",
          resourceKind: "resource",
          resourceId: "expiring-first",
          quantity: 1,
          unit: "unit",
          windowId: first.id,
        },
        {
          legKey: "unavailable",
          ownerId: "ignored",
          resourceKind: "resource",
          resourceId: "blocked-second",
          quantity: 2,
          unit: "units",
          windowId: second.id,
        },
      ],
    });
    expect(result.outcome).toBe("PARTIAL");
    expect(result.compensated).toHaveLength(1);
    const rows = await db.select().from(reservations).where(eq(reservations.compositeGroupId, result.groupId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("RELEASED");
  });

  it("goal 03: a delegated viewer loses the track projection at the exact grant boundary without leaking prior evidence", async () => {
    const { db } = await getTestDb();
    const session = await openTrackSession(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "tracked",
      purpose: "coordination",
      viewerScope: {
        viewers: [{
          subjectId: "viewer",
          precision: "approximate",
          until: "2025-01-01T00:10:00.000Z",
        }],
      },
    });
    const evidence = await recordObservation(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "tracked",
      observationType: "state",
      observedAt: start,
      payload: { lat: 24.7136, lng: 46.6753, secret: "must-not-leak" },
    });
    await attachObservationToTrack(db, {
      trackSessionId: session.id,
      ownerId: "owner",
      observationId: evidence.id,
    });
    expect(await projectTrackForViewer(db, {
      trackSessionId: session.id,
      viewerId: "viewer",
      now: new Date("2025-01-01T00:09:59.999Z"),
    })).toMatchObject({ visible: true, precision: "approximate" });
    expect(await projectTrackForViewer(db, {
      trackSessionId: session.id,
      viewerId: "viewer",
      now: new Date("2025-01-01T00:10:00.000Z"),
    })).toEqual({ visible: false, reason: "No active viewer grant" });
  });

  it("goal 04: capacity rejects a mass-versus-count mismatch before creating a reservation", async () => {
    const { db } = await getTestDb();
    const window = await windowFor("typed-capacity", 100, "kg");
    expect(canonicalQuantity(2, "seats")).toMatchObject({ unit: "count", dimension: "count" });
    await expect(reserveCapacity(db, {
      ownerId: "owner",
      resourceKind: "resource",
      resourceId: "typed-capacity",
      quantity: 2,
      unit: "seats",
      windowId: window.id,
      idempotencyKey: "wrong-dimension",
    })).rejects.toThrow("Unit dimension mismatch");
    expect(await db.select().from(reservations)).toHaveLength(0);
  });

  it("goal 05: fifty duplicate external deliveries create one event and exactly one temporal wake", async () => {
    const { db } = await getTestDb();
    const calls: string[] = [];
    await createTemporalTrigger(db, {
      ownerId: "owner",
      kind: "EVENT",
      eventFilter: { eventType: "external.changed", match: { ready: true } },
      continuation: { jobKind: "resume-node" },
      maxFires: 1,
      idempotencyKey: "storm-trigger",
    });
    const input = {
      provider: "provider",
      connectorId: "connector",
      eventKey: "one-provider-key",
      eventType: "external.changed",
      reference: "reference",
      payload: { ready: true },
      ownerId: "owner",
    };
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () => ingestExternalEvent(db, dispatcher(calls), input)),
    );
    expect(outcomes.filter((entry) => entry.outcome === "ACCEPTED")).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.outcome === "DUPLICATE")).toHaveLength(49);
    expect(calls).toHaveLength(1);
    expect((await db.select({ value: count() }).from(events))[0].value).toBe(1);
  });

  it("goal 06: two levels of tightening are revalidated through the complete ancestor chain at execution time", async () => {
    const { db } = await getTestDb();
    const root = await createDelegationGrant(db, {
      principalOwnerId: "principal",
      delegateId: "middle",
      purpose: "operate",
      allowedCapabilities: ["read", "write"],
      resourceScope: { kinds: ["resource"], ids: ["one", "two"] },
      maxMonetary: 100,
      currency: "USD",
      maxDepth: 3,
      expiresAt: end,
      now: start,
    });
    const child = await createDelegationGrant(db, {
      principalOwnerId: "middle",
      delegateId: "near-leaf",
      purpose: "operate",
      allowedCapabilities: ["read"],
      resourceScope: { kinds: ["resource"], ids: ["one"] },
      maxMonetary: 50,
      currency: "USD",
      maxDepth: 2,
      parentGrantId: root.id,
      expiresAt: end,
      now: start,
    });
    const leaf = await createDelegationGrant(db, {
      principalOwnerId: "near-leaf",
      delegateId: "leaf",
      purpose: "operate",
      allowedCapabilities: ["read"],
      resourceScope: { kinds: ["resource"], ids: ["one"] },
      maxMonetary: 10,
      currency: "USD",
      maxDepth: 0,
      parentGrantId: child.id,
      expiresAt: end,
      now: start,
    });
    expect(await revalidateDelegationGrant(db, {
      grantId: leaf.id,
      delegateId: "leaf",
      capability: "read",
      purpose: "operate",
      resourceRef: { kind: "resource", id: "one" },
      monetaryAmount: 10,
      context: { currency: "USD" },
      now: start,
    })).toEqual({ ok: true });
    await revokeDelegationGrant(db, { grantId: root.id, actorOwnerId: "principal", now: start });
    expect(await revalidateDelegationGrant(db, {
      grantId: leaf.id,
      delegateId: "leaf",
      capability: "read",
      purpose: "operate",
      resourceRef: { kind: "resource", id: "one" },
      now: start,
    })).toMatchObject({ ok: false, code: "REVOKED" });
  });

  it("goal 07: an inconclusive external notification attempt does not hide truthful in-app evidence", async () => {
    const { db } = await getTestDb();
    const priorKey = process.env.SENDGRID_API_KEY;
    process.env.SENDGRID_API_KEY = "configured-for-injected-adapter";
    try {
      const intent = await createNotificationIntent(db, {
        ownerId: "owner",
        recipientId: "recipient",
        purpose: "private update",
        privacyClass: "standard",
        channels: ["email"],
        content: { title: "Update", body: "Restricted details" },
        idempotencyKey: "mixed-channel-truth",
      });
      const adapters: ChannelAdapter[] = [
        {
          channel: "in_app",
          configured: true,
          async send() { return { outcome: "DELIVERED" }; },
        },
        {
          channel: "email",
          configured: true,
          async send() { return { outcome: "INCONCLUSIVE", error: "provider timed out" }; },
        },
      ];
      const delivered = await deliverNotificationIntent(db, {
        intentId: intent.id,
        attemptContext: { attemptId: "attempt" },
        adapters,
      });
      // Aggregate is DELIVERED (truthful in-app evidence); the inconclusive
      // external channel stays INCONCLUSIVE at channel level — never hidden.
      expect(delivered.state).toBe("DELIVERED");
      expect(delivered.channelStates).toMatchObject({
        in_app: { state: "DELIVERED" },
        email: { state: "INCONCLUSIVE", error: "provider timed out" },
      });
    } finally {
      if (priorKey === undefined) delete process.env.SENDGRID_API_KEY;
      else process.env.SENDGRID_API_KEY = priorKey;
    }
  });

  it("goal 08: two offers for one match are exclusive after the first subject accepts", async () => {
    const { db } = await getTestDb();
    const first = await offerAssignment(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "first",
      matchId: "shared-match",
      idempotencyKey: "offer-first",
    });
    const second = await offerAssignment(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "second",
      matchId: "shared-match",
      idempotencyKey: "offer-second",
    });
    expect((await respondToAssignment(db, {
      assignmentId: first.assignment.id,
      subjectId: "first",
      response: "ACCEPTED",
    })).state).toBe("ACCEPTED");
    await expect(respondToAssignment(db, {
      assignmentId: second.assignment.id,
      subjectId: "second",
      response: "ACCEPTED",
    })).rejects.toThrow("already accepted");
  });

  it("goal 09: composite legs normalize hours and seconds into one canonical capacity dimension", async () => {
    const { db } = await getTestDb();
    const first = await windowFor("duration-one", 2, "hours");
    const second = await windowFor("duration-two", 7200, "seconds");
    const result = await reserveComposite(db, {
      ownerId: "owner",
      groupKey: "normalized-duration",
      legs: [
        {
          legKey: "hours",
          ownerId: "ignored",
          resourceKind: "resource",
          resourceId: "duration-one",
          quantity: 7200,
          unit: "seconds",
          windowId: first.id,
        },
        {
          legKey: "seconds",
          ownerId: "ignored",
          resourceKind: "resource",
          resourceId: "duration-two",
          quantity: 2,
          unit: "hours",
          windowId: second.id,
        },
      ],
    });
    expect(result.outcome).toBe("COMPLETE");
    expect(result.legs.every((leg) => leg.result.outcome === "HELD")).toBe(true);
  });

  it("goal 10: duplicate remote callbacks with conflicting states cannot reorder provider truth", async () => {
    const { db } = await getTestDb();
    const created = await createRemoteExecution(db, {
      ownerId: "owner",
      runId: "00000000-0000-4000-8000-000000000001",
      nodeId: "00000000-0000-4000-8000-000000000002",
      providerId: "provider",
      protocolKind: "MCP",
      requestDigest: "a".repeat(64),
      idempotencyKey: "callback-ordering",
    });
    const running = await attachRemoteReference(db, {
      id: created.id,
      ownerId: "owner",
      remoteReference: "remote-reference",
      expectedVersion: created.version,
    });
    const completed = await recordProviderCallback(db, {
      providerId: "provider",
      remoteReference: "remote-reference",
      callbackId: "callback-one",
      state: "COMPLETED",
      evidence: { providerConfirmed: true },
      observedVersion: running.version,
    });
    const replay = await recordProviderCallback(db, {
      providerId: "provider",
      remoteReference: "remote-reference",
      callbackId: "callback-one",
      state: "FAILED",
      evidence: { providerConfirmed: true },
      observedVersion: running.version,
    });
    expect(completed).toMatchObject({ applied: true, execution: { state: "COMPLETED" } });
    expect(replay).toMatchObject({
      applied: false,
      duplicate: true,
      execution: { state: "COMPLETED" },
    });
  });

  it("goal 11: exact projection with status-only evidence keeps exact authorization while fabricating no location", async () => {
    const { db } = await getTestDb();
    const session = await openTrackSession(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "tracked",
      purpose: "status visibility",
      viewerScope: {
        viewers: [{
          subjectId: "viewer",
          precision: "exact",
          until: end.toISOString(),
        }],
      },
    });
    const observation = await recordObservation(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "tracked",
      observationType: "state",
      observedAt: start,
      payload: { status: "active" },
    });
    await attachObservationToTrack(db, {
      trackSessionId: session.id,
      ownerId: "owner",
      observationId: observation.id,
    });
    expect(await projectTrackForViewer(db, {
      trackSessionId: session.id,
      viewerId: "viewer",
      now: start,
    })).toMatchObject({
      visible: true,
      // No coordinate evidence exists, so the projection degrades to "none"
      // rather than fabricating a location under an "exact" grant.
      precision: "none",
      location: null,
    });
  });

  it("goal 12: cross-owner reads of reservations, tracks, and grants all fail closed", async () => {
    const { db } = await getTestDb();
    const window = await windowFor("owner-private", 1, "unit");
    const held = await reserveCapacity(db, {
      ownerId: "owner",
      resourceKind: "resource",
      resourceId: "owner-private",
      quantity: 1,
      unit: "unit",
      windowId: window.id,
      idempotencyKey: "private-reservation",
    });
    if (held.outcome !== "HELD") throw new Error("reservation setup failed");
    const track = await openTrackSession(db, {
      ownerId: "owner",
      subjectKind: "subject",
      subjectId: "tracked",
      purpose: "private",
    });
    const grant = await createDelegationGrant(db, {
      principalOwnerId: "owner",
      delegateId: "delegate",
      purpose: "private",
      allowedCapabilities: ["read"],
      now: start,
      expiresAt: end,
    });

    // Owner isolation: cross-owner mutations on another owner's rows fail
    // closed at the primitive boundary (routers bind ctx.user as owner).
    await expect(confirmReservation(db, held.reservation.id, "other-owner"))
      .rejects.toThrow(/forbidden|not found|owner/i);
    expect(await projectTrackForViewer(db, {
      trackSessionId: track.id,
      viewerId: "other-owner",
      now: start,
    })).toEqual({ visible: false, reason: "No active viewer grant" });
    await expect(revokeDelegationGrant(db, {
      grantId: grant.id,
      actorOwnerId: "other-owner",
    })).rejects.toThrow(/forbidden|not found|owner|principal/i);

    const trigger = await createTemporalTrigger(db, {
      ownerId: "owner",
      kind: "AT",
      fireAt: end,
      idempotencyKey: "private-trigger",
    });
    await expect(transitionTemporalTrigger(db, {
      ownerId: "other-owner",
      triggerId: trigger.trigger.id,
      action: "cancel",
    })).rejects.toThrow("Trigger not found");
    expect((await db.select().from(temporalTriggers)).length).toBe(1);
  });
});