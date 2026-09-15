import { beforeEach, describe, expect, it } from "vitest";
import {
  attachObservationToTrack,
  freshnessOf,
  listObservations,
  openTrackSession,
  projectTrackForViewer,
  recordObservation,
} from "../../api/runtime/block2/observations";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const now = new Date("2025-01-01T00:00:00Z");
const until = new Date(now.getTime() + 60_000).toISOString();

describe("Block 2 observations", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("records append-only evidence and labels freshness", async () => {
    const { db } = await getTestDb();
    const fresh = await recordObservation(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one",
      observationType: "location", observedAt: now, freshnessTtlMs: 1_000,
      payload: { status: "moving" },
    });
    const stale = await recordObservation(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one",
      observationType: "location", observedAt: new Date(now.getTime() + 1),
      freshnessExpiresAt: now, payload: { status: "stopped" },
    });
    expect((await listObservations(db, { subjectKind: "asset", subjectId: "one" }))).toHaveLength(2);
    expect(freshnessOf(fresh, now)).toBe("FRESH");
    expect(freshnessOf(stale, now)).toBe("STALE");
  });

  it("denies unauthorized viewers and projects exact or approximate precision", async () => {
    const { db } = await getTestDb();
    const observation = await recordObservation(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one",
      observationType: "location", observedAt: now,
      payload: { lat: 24.713612, lng: 46.675296, accuracy: 5 },
    });
    const track = await openTrackSession(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one", purpose: "track",
      viewerScope: { viewers: [
        { subjectId: "exact", precision: "exact", until },
        { subjectId: "approx", precision: "approximate", until },
      ] },
    });
    await attachObservationToTrack(db, { trackSessionId: track.id, ownerId: "owner", observationId: observation.id });
    expect(await projectTrackForViewer(db, { trackSessionId: track.id, viewerId: "stranger", now })).toMatchObject({ visible: false });
    const exact = await projectTrackForViewer(db, { trackSessionId: track.id, viewerId: "exact", now });
    const approximate = await projectTrackForViewer(db, { trackSessionId: track.id, viewerId: "approx", now });
    expect(exact).toMatchObject({ visible: true, precision: "exact", location: { lat: 24.713612, lng: 46.675296 } });
    expect(approximate).toMatchObject({ visible: true, precision: "approximate", location: { lat: 24.71, lng: 46.68, accuracy: 100 } });
  });

  it("emits no coordinates for precision none or absent coordinate evidence", async () => {
    const { db } = await getTestDb();
    const observation = await recordObservation(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one",
      observationType: "status", observedAt: now, payload: { status: "ready" },
    });
    const track = await openTrackSession(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one", purpose: "track",
      viewerScope: { viewers: [{ subjectId: "viewer", precision: "exact", until }] },
    });
    await attachObservationToTrack(db, { trackSessionId: track.id, ownerId: "owner", observationId: observation.id });
    expect(await projectTrackForViewer(db, { trackSessionId: track.id, viewerId: "viewer", now }))
      .toMatchObject({ visible: true, precision: "none", location: null });
    const none = await openTrackSession(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one", purpose: "private",
      viewerScope: { defaultPrecision: "none" },
    });
    await attachObservationToTrack(db, { trackSessionId: none.id, ownerId: "owner", observationId: observation.id });
    expect(await projectTrackForViewer(db, { trackSessionId: none.id, viewerId: "owner", now }))
      .toMatchObject({ visible: true, precision: "none", location: null });
  });

  it("labels stale projection and expires viewer grants", async () => {
    const { db } = await getTestDb();
    const observation = await recordObservation(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one",
      observationType: "location", observedAt: now, freshnessExpiresAt: now,
      payload: { lat: 1, lng: 2 },
    });
    const track = await openTrackSession(db, {
      ownerId: "owner", subjectKind: "asset", subjectId: "one", purpose: "track",
      viewerScope: { viewers: [{ subjectId: "viewer", precision: "exact", until }] },
    });
    await attachObservationToTrack(db, { trackSessionId: track.id, ownerId: "owner", observationId: observation.id });
    expect(await projectTrackForViewer(db, { trackSessionId: track.id, viewerId: "viewer", now }))
      .toMatchObject({ visible: true, freshness: "STALE" });
    expect(await projectTrackForViewer(db, {
      trackSessionId: track.id, viewerId: "viewer", now: new Date(Date.parse(until) + 1),
    })).toMatchObject({ visible: false });
  });
});