/**
 * JASIM — the generic bridge from a canonical observation to a presentation
 * input.
 *
 * WHY THIS FILE EXISTS
 *
 * Every piece of the tracking experience already existed and none of them were
 * connected. Block 2 persists observations against a `(subjectKind, subjectId)`
 * pair. `decidePresentation` emits `TRACKER`, and a child `MAP`, when it is
 * given `interactionNeed: "track"` together with finite coordinates. But no
 * production caller ever produced that input, so `MAP` was unreachable: the
 * system could model a live surface it could never show.
 *
 * This module is the missing link and nothing more. It reads a trusted
 * observation, decides how much of it may honestly be presented, and returns a
 * `SemanticPresentationInput`. It renders nothing and decides no primitive —
 * `decidePresentation` remains the single selector.
 *
 * DOMAIN NEUTRALITY IS STRUCTURAL, NOT A PROMISE
 *
 * A subject here is `{ kind, id }` and the kind is never inspected. A driver, a
 * technician, a vehicle, a shipment, a robot or a resource not yet imagined all
 * travel the same path, because the only question asked is "does this subject
 * have a trusted, fresh observation carrying coordinates?" No file in this
 * module may ever branch on what the subject is.
 *
 * THE FRESHNESS RULE THAT MAKES THIS HONEST
 *
 * A position observed three hours ago is not a position now. Block 2's own
 * `freshnessOf` answers FRESH/STALE from `freshnessExpiresAt`, which is correct
 * for evidence — but an observation with no expiry set is FRESH there forever,
 * and "forever" is not a fact anyone observed. Presentation therefore applies a
 * stricter policy on top: an observation with no declared horizon is fresh only
 * for a bounded default age.
 *
 * Coordinates are emitted ONLY while FRESH. A stale observation still produces
 * a truthful tracking surface — it keeps its status, its timestamp and its
 * source — but it loses its coordinates, so `decidePresentation` cannot build a
 * `MAP` from it. That is the whole point: a stale location must never render as
 * a live one, and the guarantee is enforced by withholding the data rather than
 * by asking a renderer to behave.
 */

import { and, desc, eq } from "drizzle-orm";
import { observations, type Observation } from "@db/schema";
import type { Block2Db } from "./block2/temporal";
import type { SemanticPresentationInput } from "./presentation-fabric";

/**
 * How present the subject's reality is, from the point of view of something
 * that is about to be shown to a person.
 *
 * `UNAVAILABLE` is deliberately distinct from `STALE`: "we have never been told
 * where this is" and "we were told, a while ago" are different truths, and
 * collapsing them would hide which one the user is looking at.
 */
export type ObservationPresence = "FRESH" | "STALE" | "UNAVAILABLE";

export type ObservationPresentationPolicy = {
  /**
   * How long an observation that declares no `freshnessExpiresAt` may still be
   * presented as current. The column is nullable, and a null there means the
   * provider never committed to a horizon — not that the reading is eternal.
   */
  defaultMaxAgeMs: number;
};

/**
 * Two minutes. Short enough that a moving subject cannot appear frozen in a
 * place it has left, long enough to survive ordinary polling gaps. Callers with
 * a slower-moving subject can widen it; nothing here assumes a vehicle.
 */
export const DEFAULT_OBSERVATION_PRESENTATION_POLICY: ObservationPresentationPolicy = {
  defaultMaxAgeMs: 120_000,
};

export type SubjectReference = {
  kind: string;
  id: string;
};

export type ObservationPresenceAssessment = {
  presence: ObservationPresence;
  /** Age of the reading in milliseconds, when there is a reading at all. */
  ageMs?: number;
  /** Why it was classified this way — carried into the surface, never hidden. */
  reason:
    | "NO_OBSERVATION"
    | "WITHIN_DECLARED_HORIZON"
    | "WITHIN_DEFAULT_MAX_AGE"
    | "DECLARED_HORIZON_PASSED"
    | "EXCEEDS_DEFAULT_MAX_AGE"
    | "OBSERVED_IN_FUTURE";
};

type ObservationLike = Pick<
  Observation,
  "observedAt" | "freshnessExpiresAt" | "payload" | "sourceKind" | "providerId"
>;

/**
 * Classifies one observation for presentation.
 *
 * An observation timestamped in the future is treated as STALE rather than
 * fresh. A clock that disagrees with ours is not evidence of currency, and
 * trusting it would let a wrong or hostile source pin a subject as permanently
 * live.
 */
export function classifyObservationPresence(
  observation: ObservationLike | undefined,
  now: Date = new Date(),
  policy: ObservationPresentationPolicy = DEFAULT_OBSERVATION_PRESENTATION_POLICY,
): ObservationPresenceAssessment {
  if (!observation) return { presence: "UNAVAILABLE", reason: "NO_OBSERVATION" };

  const observedAtMs = observation.observedAt?.getTime();
  if (typeof observedAtMs !== "number" || Number.isNaN(observedAtMs)) {
    return { presence: "UNAVAILABLE", reason: "NO_OBSERVATION" };
  }

  const nowMs = now.getTime();
  const ageMs = nowMs - observedAtMs;
  if (ageMs < 0) {
    return { presence: "STALE", ageMs, reason: "OBSERVED_IN_FUTURE" };
  }

  const horizon = observation.freshnessExpiresAt?.getTime();
  if (typeof horizon === "number" && !Number.isNaN(horizon)) {
    return horizon > nowMs
      ? { presence: "FRESH", ageMs, reason: "WITHIN_DECLARED_HORIZON" }
      : { presence: "STALE", ageMs, reason: "DECLARED_HORIZON_PASSED" };
  }

  return ageMs <= policy.defaultMaxAgeMs
    ? { presence: "FRESH", ageMs, reason: "WITHIN_DEFAULT_MAX_AGE" }
    : { presence: "STALE", ageMs, reason: "EXCEEDS_DEFAULT_MAX_AGE" };
}

export type ObservationCoordinates = { lat: number; lng: number };

/**
 * Extracts coordinates only when both values are genuinely finite numbers.
 *
 * Payloads are provider data. A string "24.7", a null, a NaN or a missing key
 * must all produce "no coordinates" rather than a coerced point, because a
 * coerced point is a fabricated location.
 */
export function coordinatesFromPayload(
  payload: Record<string, unknown> | undefined,
): ObservationCoordinates | undefined {
  const lat = payload?.lat;
  const lng = payload?.lng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return undefined;
  }
  // Out-of-range values are not a location either; they are corrupt data.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

export type ObservationPresentationResult = {
  presence: ObservationPresence;
  assessment: ObservationPresenceAssessment;
  /** True only when the decision layer will be able to build a MAP from this. */
  mapEligible: boolean;
  input: SemanticPresentationInput;
};

function statusFor(
  assessment: ObservationPresenceAssessment,
  payloadStatus: unknown,
): string {
  if (typeof payloadStatus === "string" && payloadStatus.trim().length > 0) {
    return assessment.presence === "FRESH"
      ? payloadStatus
      : `${payloadStatus} (${assessment.presence.toLowerCase()})`;
  }
  return assessment.presence.toLowerCase();
}

/**
 * Builds the presentation input for a subject's tracking surface.
 *
 * The three cases are deliberately all `interactionNeed: "track"`. The surface
 * a person is looking at does not disappear because reality went quiet — it
 * keeps its identity and tells the truth about what it knows. What changes is
 * whether coordinates are attached, and only a FRESH observation attaches them.
 */
export function buildObservationPresentationInput(input: {
  subject: SubjectReference;
  observation?: ObservationLike;
  observationType: string;
  now?: Date;
  policy?: ObservationPresentationPolicy;
  /** Extra, already-authorized projection data for the surface. */
  data?: Record<string, unknown>;
}): ObservationPresentationResult {
  const now = input.now ?? new Date();
  const policy = input.policy ?? DEFAULT_OBSERVATION_PRESENTATION_POLICY;
  const assessment = classifyObservationPresence(input.observation, now, policy);

  const coordinates =
    assessment.presence === "FRESH"
      ? coordinatesFromPayload(input.observation?.payload)
      : undefined;
  const mapEligible = coordinates !== undefined;

  const locationDescription = (() => {
    const value = input.observation?.payload?.locationDescription;
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  })();

  const data: Record<string, unknown> = {
    ...input.data,
    // The reference the surface is about. It is an opaque pair — the renderer
    // never learns what kind of thing this is, only that it is the subject.
    entityRef: `${input.subject.kind}:${input.subject.id}`,
    subjectKind: input.subject.kind,
    subjectId: input.subject.id,
    observationType: input.observationType,
    observationPresence: assessment.presence,
    observationReason: assessment.reason,
    ...(assessment.ageMs !== undefined ? { observationAgeMs: assessment.ageMs } : {}),
  };

  const semanticInput: SemanticPresentationInput = {
    interactionNeed: "track",
    ongoing: true,
    data,
    ...(input.observation
      ? {
          observation: {
            status: statusFor(assessment, input.observation.payload?.status),
            ...(locationDescription ? { locationDescription } : {}),
            // Withheld unless FRESH. This single omission is what prevents a
            // stale reading from becoming a live map.
            ...(coordinates ? { coordinates } : {}),
            observedAt: input.observation.observedAt.toISOString(),
            source: input.observation.providerId ?? input.observation.sourceKind,
          },
        }
      : {
          observation: { status: "unavailable" },
        }),
  };

  return { presence: assessment.presence, assessment, mapEligible, input: semanticInput };
}

/**
 * Reads the subject's latest trusted observation and builds its presentation
 * input.
 *
 * Owner scope is part of the query, not a check afterwards. A caller cannot
 * hand in an observation: the only way to reach this surface is through a row
 * the trusted runtime already owns, which is what keeps a client from
 * fabricating a location by supplying one.
 */
export async function resolveSubjectObservationPresentation(
  db: Block2Db,
  input: {
    ownerId: string;
    subject: SubjectReference;
    observationType: string;
    now?: Date;
    policy?: ObservationPresentationPolicy;
    data?: Record<string, unknown>;
  },
): Promise<ObservationPresentationResult> {
  const rows = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.ownerId, input.ownerId),
        eq(observations.subjectKind, input.subject.kind),
        eq(observations.subjectId, input.subject.id),
        eq(observations.observationType, input.observationType),
      ),
    )
    .orderBy(desc(observations.observedAt), desc(observations.createdAt))
    .limit(1);

  return buildObservationPresentationInput({
    subject: input.subject,
    observation: rows[0],
    observationType: input.observationType,
    now: input.now,
    policy: input.policy,
    data: input.data,
  });
}
