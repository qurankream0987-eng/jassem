/**
 * Block 2 — append-only Observation evidence and privacy-gated TrackSession
 * projection.
 *
 * An observation is evidence, not verified truth. A track is not a map:
 * coordinates are projected only when the latest attached observation
 * actually contains finite numeric latitude and longitude values.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  observations,
  trackSessions,
  type Observation,
  type TrackSession,
} from "@db/schema";
import type { Block2Db } from "./temporal";

export class ObservationError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "STALE";

  constructor(message: string, code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "STALE") {
    super(message);
    this.code = code;
  }
}

type ViewerPrecision = "exact" | "approximate" | "none";

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ObservationError(`${field} must not be empty`, "INVALID");
  }
}

export type RecordObservationInput = {
  ownerId: string;
  subjectKind: string;
  subjectId: string;
  observationType: string;
  observedAt?: Date;
  sourceKind?: string;
  providerId?: string | null;
  provenance?: Record<string, unknown>;
  payload: Record<string, unknown>;
  freshnessTtlMs?: number;
  freshnessExpiresAt?: Date | null;
};

/** Append evidence. Existing observations are never updated by this module. */
export async function recordObservation(
  db: Block2Db,
  input: RecordObservationInput,
): Promise<Observation> {
  requireText(input.ownerId, "ownerId");
  requireText(input.subjectKind, "subjectKind");
  requireText(input.subjectId, "subjectId");
  requireText(input.observationType, "observationType");

  const observedAt = input.observedAt ?? new Date();
  if (!validDate(observedAt)) {
    throw new ObservationError("observedAt must be a valid date", "INVALID");
  }
  if (input.freshnessTtlMs !== undefined && input.freshnessExpiresAt !== undefined) {
    throw new ObservationError(
      "Specify freshnessTtlMs or freshnessExpiresAt, not both",
      "INVALID",
    );
  }

  let freshnessExpiresAt = input.freshnessExpiresAt ?? null;
  if (input.freshnessTtlMs !== undefined) {
    if (!Number.isFinite(input.freshnessTtlMs) || input.freshnessTtlMs < 0) {
      throw new ObservationError("freshnessTtlMs must be a non-negative finite number", "INVALID");
    }
    freshnessExpiresAt = new Date(observedAt.getTime() + input.freshnessTtlMs);
  }
  if (freshnessExpiresAt && !validDate(freshnessExpiresAt)) {
    throw new ObservationError("freshnessExpiresAt must be a valid date", "INVALID");
  }

  const rows = await db
    .insert(observations)
    .values({
      id: `obs_${randomUUID()}`,
      ownerId: input.ownerId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      observationType: input.observationType,
      observedAt,
      sourceKind: input.sourceKind ?? "system",
      providerId: input.providerId ?? null,
      provenance: input.provenance ?? {},
      payload: input.payload,
      freshnessExpiresAt,
    })
    .returning();
  return rows[0]!;
}

export async function latestObservation(
  db: Block2Db,
  input: {
    subjectKind: string;
    subjectId: string;
    observationType: string;
  },
): Promise<Observation | undefined> {
  const rows = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.subjectKind, input.subjectKind),
        eq(observations.subjectId, input.subjectId),
        eq(observations.observationType, input.observationType),
      ),
    )
    .orderBy(desc(observations.observedAt), desc(observations.createdAt))
    .limit(1);
  return rows[0];
}

export async function listObservations(
  db: Block2Db,
  input: {
    subjectKind: string;
    subjectId: string;
    observationType?: string;
    since?: Date;
    limit?: number;
  },
): Promise<Observation[]> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ObservationError("limit must be a positive integer", "INVALID");
  }
  if (input.since && !validDate(input.since)) {
    throw new ObservationError("since must be a valid date", "INVALID");
  }

  const conditions = [
    eq(observations.subjectKind, input.subjectKind),
    eq(observations.subjectId, input.subjectId),
  ];
  if (input.observationType) {
    conditions.push(eq(observations.observationType, input.observationType));
  }
  if (input.since) {
    conditions.push(gte(observations.observedAt, input.since));
  }

  return db
    .select()
    .from(observations)
    .where(and(...conditions))
    .orderBy(desc(observations.observedAt), desc(observations.createdAt))
    .limit(limit);
}

export function freshnessOf(
  observation: Pick<Observation, "freshnessExpiresAt">,
  now: Date = new Date(),
): "FRESH" | "STALE" {
  return observation.freshnessExpiresAt &&
    observation.freshnessExpiresAt.getTime() <= now.getTime()
    ? "STALE"
    : "FRESH";
}

export type OpenTrackSessionInput = {
  ownerId: string;
  subjectKind: string;
  subjectId: string;
  purpose: string;
  viewerScope?: TrackSession["viewerScope"];
  endsAt?: Date | null;
  assignmentId?: string | null;
  runId?: string | null;
};

export async function openTrackSession(
  db: Block2Db,
  input: OpenTrackSessionInput,
): Promise<TrackSession> {
  requireText(input.ownerId, "ownerId");
  requireText(input.subjectKind, "subjectKind");
  requireText(input.subjectId, "subjectId");
  requireText(input.purpose, "purpose");
  if (input.endsAt && !validDate(input.endsAt)) {
    throw new ObservationError("endsAt must be a valid date", "INVALID");
  }

  const rows = await db
    .insert(trackSessions)
    .values({
      id: `trk_${randomUUID()}`,
      ownerId: input.ownerId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      purpose: input.purpose,
      viewerScope: input.viewerScope ?? {},
      state: "active",
      endsAt: input.endsAt ?? null,
      assignmentId: input.assignmentId ?? null,
      runId: input.runId ?? null,
    })
    .returning();
  return rows[0]!;
}

async function getTrackSession(
  db: Block2Db,
  trackSessionId: string,
): Promise<TrackSession | undefined> {
  const rows = await db
    .select()
    .from(trackSessions)
    .where(eq(trackSessions.id, trackSessionId))
    .limit(1);
  return rows[0];
}

export async function attachObservationToTrack(
  db: Block2Db,
  input: { trackSessionId: string; ownerId: string; observationId: string },
): Promise<TrackSession> {
  const session = await getTrackSession(db, input.trackSessionId);
  if (!session) throw new ObservationError("Track session not found", "NOT_FOUND");
  if (session.ownerId !== input.ownerId) {
    throw new ObservationError("Only the track owner may attach evidence", "FORBIDDEN");
  }
  if (session.state !== "active") {
    throw new ObservationError("Track session is no longer active", "STALE");
  }

  const evidenceRows = await db
    .select()
    .from(observations)
    .where(eq(observations.id, input.observationId))
    .limit(1);
  const evidence = evidenceRows[0];
  if (!evidence) throw new ObservationError("Observation not found", "NOT_FOUND");
  if (
    evidence.subjectKind !== session.subjectKind ||
    evidence.subjectId !== session.subjectId
  ) {
    throw new ObservationError("Observation is outside the track subject", "FORBIDDEN");
  }

  const rows = await db
    .update(trackSessions)
    .set({ latestObservationId: evidence.id })
    .where(and(eq(trackSessions.id, session.id), eq(trackSessions.state, "active")))
    .returning();
  if (!rows[0]) {
    throw new ObservationError("Track session is no longer active", "STALE");
  }
  return rows[0];
}

export async function closeTrackSession(
  db: Block2Db,
  input: { trackSessionId: string; actorOwnerId: string },
): Promise<TrackSession> {
  const session = await getTrackSession(db, input.trackSessionId);
  if (!session) throw new ObservationError("Track session not found", "NOT_FOUND");
  if (session.ownerId !== input.actorOwnerId) {
    throw new ObservationError("Only the track owner may close it", "FORBIDDEN");
  }
  if (session.state !== "active") return session;

  const rows = await db
    .update(trackSessions)
    .set({ state: "closed", endedAt: new Date() })
    .where(and(eq(trackSessions.id, session.id), eq(trackSessions.state, "active")))
    .returning();
  return rows[0] ?? session;
}

export async function expireDueTrackSessions(
  db: Block2Db,
  input: { now?: Date } = {},
): Promise<TrackSession[]> {
  const now = input.now ?? new Date();
  if (!validDate(now)) throw new ObservationError("now must be a valid date", "INVALID");
  return db
    .update(trackSessions)
    .set({ state: "expired", endedAt: now })
    .where(
      and(
        eq(trackSessions.state, "active"),
        lte(trackSessions.endsAt, now),
      ),
    )
    .returning();
}

export function roundCoordinate(value: number, decimals: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(decimals) || decimals < 0) {
    throw new ObservationError("Coordinate and decimals must be finite and valid", "INVALID");
  }
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

type ProjectionProvenance = Record<string, unknown> & { unbounded?: true };

export type TrackProjection =
  | { visible: false; reason: string }
  | {
      visible: true;
      precision: "none";
      status: unknown;
      location: null;
      freshness: "FRESH" | "STALE";
      provenance: ProjectionProvenance;
    }
  | {
      visible: true;
      precision: "exact" | "approximate";
      location: {
        lat: number;
        lng: number;
        accuracy?: number;
        observedAt: Date;
      };
      freshness: "FRESH" | "STALE";
      provenance: ProjectionProvenance;
    };

function projectionProvenance(observation?: Observation): ProjectionProvenance {
  // Provenance is arbitrary provider data and may itself contain sensitive
  // fields. The viewer projection emits only the freshness annotation.
  return !observation?.freshnessExpiresAt ? { unbounded: true } : {};
}

export async function projectTrackForViewer(
  db: Block2Db,
  input: { trackSessionId: string; viewerId: string; now?: Date },
): Promise<TrackProjection> {
  const now = input.now ?? new Date();
  if (!validDate(now)) throw new ObservationError("now must be a valid date", "INVALID");

  const session = await getTrackSession(db, input.trackSessionId);
  if (!session) throw new ObservationError("Track session not found", "NOT_FOUND");

  const viewerEntry = session.viewerScope.viewers?.find((entry) => {
    if (entry.subjectId !== input.viewerId || !entry.until) return false;
    const until = new Date(entry.until);
    return validDate(until) && until.getTime() > now.getTime();
  });
  const inherentlyAllowed =
    input.viewerId === session.ownerId || input.viewerId === session.subjectId;
  if (!inherentlyAllowed && !viewerEntry) {
    return { visible: false, reason: "No active viewer grant" };
  }

  const precision: ViewerPrecision =
    viewerEntry?.precision ?? session.viewerScope.defaultPrecision ?? "none";
  let observation: Observation | undefined;
  if (session.latestObservationId) {
    const rows = await db
      .select()
      .from(observations)
      .where(eq(observations.id, session.latestObservationId))
      .limit(1);
    observation = rows[0];
  }
  const freshness = observation ? freshnessOf(observation, now) : "STALE";
  const provenance = projectionProvenance(observation);
  const payload = observation?.payload;
  const lat = payload?.lat;
  const lng = payload?.lng;
  const hasCoordinates =
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng);

  if (precision === "none" || !observation || !hasCoordinates) {
    return {
      visible: true,
      precision: "none",
      status: payload?.status,
      location: null,
      freshness,
      provenance,
    };
  }

  const rawAccuracy = payload?.accuracy;
  const accuracy =
    typeof rawAccuracy === "number" && Number.isFinite(rawAccuracy) && rawAccuracy >= 0
      ? rawAccuracy
      : undefined;
  if (precision === "approximate") {
    return {
      visible: true,
      precision,
      location: {
        lat: roundCoordinate(lat, 2),
        lng: roundCoordinate(lng, 2),
        ...(accuracy !== undefined ? { accuracy: Math.max(accuracy, 100) } : {}),
        observedAt: observation.observedAt,
      },
      freshness,
      provenance,
    };
  }
  return {
    visible: true,
    precision,
    location: {
      lat,
      lng,
      ...(accuracy !== undefined ? { accuracy } : {}),
      observedAt: observation.observedAt,
    },
    freshness,
    provenance,
  };
}