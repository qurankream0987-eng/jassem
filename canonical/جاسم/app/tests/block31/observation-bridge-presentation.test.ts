import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { executionAttempts } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import { submitEffectSignal } from "../../api/runtime/effect-observation-bridge";
import {
  attachObservationToTrack,
  openTrackSession,
  projectTrackForViewer,
} from "../../api/runtime/block2/observations";

/**
 * PART 17 — ONE CANONICAL TRUTH, TWO CONSUMERS.
 *
 * The reason the bridge writes into block 2's `observations` rather than a
 * private evidence table: the SAME row must serve verification and generative
 * UI. If effect evidence lived somewhere else, JASIM would have two versions of
 * what it observed, and the interesting question would become which one is
 * shown.
 *
 * These tests take a row produced by `submitEffectSignal` and push it through
 * the untouched Observation → Freshness → Presentation pipeline.
 */

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
const OWNER = "9400";

async function attemptFor(key: string): Promise<string> {
  const run = await runtime.createRuntimeRun({
    ownerId: OWNER, goal: `present ${key}`, idempotencyKey: `present-${key}`,
  });
  await runtime.createRuntimeDag({
    ownerId: OWNER, runId: run.id,
    nodes: [{ nodeKey: "A", capabilityId: "local-calculation", inputs: { values: [1, 1] }, maxAttempts: 1 }],
  });
  await runtime.driveRunToCompletion(run.id, OWNER, "w");
  const [attempt] = await handle.db.select().from(executionAttempts)
    .where(eq(executionAttempts.runId, run.id));
  return attempt!.id;
}

describe("a bridged observation is consumable by the existing presentation pipeline", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    runtime = await import("../../api/runtime/jasim-runtime");
  });
  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE observations, track_sessions, events CASCADE"));
  });
  afterAll(async () => { await handle.pool.end(); });

  it("a fresh bridged observation drives a visible, fresh projection", async () => {
    const attemptId = await attemptFor("fresh");
    const session = await openTrackSession(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-1",
      purpose: "verification", viewerScope: "owner",
    });
    const observation = await submitEffectSignal(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-1",
      observationType: "position",
      // A real observed coordinate. The projection refuses synthesis, so an
      // absent value would render as unknown rather than as a guess.
      payload: { coordinates: { lat: 31.95, lng: 35.93 } },
      channel: "AUTHENTICATED_TELEMETRY", attemptId, freshnessTtlMs: 60_000,
    });
    await attachObservationToTrack(handle.db, {
      trackSessionId: session.id, ownerId: OWNER, observationId: observation.id,
    });

    const projection = await projectTrackForViewer(handle.db, {
      trackSessionId: session.id, viewerId: OWNER,
    });
    expect(projection.visible).toBe(true);
    if (projection.visible) expect(projection.freshness).toBe("FRESH");
  });

  it("a stale bridged observation keeps stale semantics — the UI is not told it is current", async () => {
    const attemptId = await attemptFor("stale");
    const session = await openTrackSession(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-2",
      purpose: "verification", viewerScope: "owner",
    });
    const observation = await submitEffectSignal(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-2",
      observationType: "position",
      payload: { coordinates: { lat: 31.95, lng: 35.93 } },
      channel: "AUTHENTICATED_TELEMETRY", attemptId,
      observedAt: new Date(Date.now() - 30 * 60_000), freshnessTtlMs: 30_000,
    });
    await attachObservationToTrack(handle.db, {
      trackSessionId: session.id, ownerId: OWNER, observationId: observation.id,
    });

    const projection = await projectTrackForViewer(handle.db, {
      trackSessionId: session.id, viewerId: OWNER,
    });
    if (projection.visible) expect(projection.freshness).toBe("STALE");
  });

  it("the projection does not leak the bridge's provenance to a viewer", async () => {
    // Provenance now carries attemptId, runId and nodeId. That is operational
    // lineage, not something a viewer is owed, and the existing projection
    // already emits only a freshness annotation. Asserted because the bridge
    // put new fields there.
    const attemptId = await attemptFor("leak");
    const session = await openTrackSession(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-3",
      purpose: "verification", viewerScope: "owner",
    });
    const observation = await submitEffectSignal(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-3",
      observationType: "position",
      payload: { coordinates: { lat: 31.95, lng: 35.93 } },
      channel: "AUTHENTICATED_TELEMETRY", attemptId, freshnessTtlMs: 60_000,
      provenance: { providerNote: "internal" },
    });
    await attachObservationToTrack(handle.db, {
      trackSessionId: session.id, ownerId: OWNER, observationId: observation.id,
    });

    const projection = await projectTrackForViewer(handle.db, {
      trackSessionId: session.id, viewerId: OWNER,
    });
    const serialized = JSON.stringify(projection);
    for (const leak of [attemptId, "providerNote", "internal", "claimSource"]) {
      expect(serialized, leak).not.toContain(leak);
    }
  });
});
