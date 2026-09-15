import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { fulfillmentObservations } from "../../../db/schema";
import type { Block31Db } from "./discovery";

export const PROOF_CLASSES = [
  "self_report",
  "counterparty_confirm",
  "authenticated_webhook",
  "signed_proof",
] as const;
export type ProofClass = (typeof PROOF_CLASSES)[number];

function validLocation(
  value: unknown,
): value is { lat: number; lng: number; accuracyM?: number } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const location = value as Record<string, unknown>;
  return (
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    typeof location.lng === "number" &&
    Number.isFinite(location.lng) &&
    location.lng >= -180 &&
    location.lng <= 180 &&
    (location.accuracyM === undefined ||
      (typeof location.accuracyM === "number" &&
        Number.isFinite(location.accuracyM) &&
        location.accuracyM >= 0))
  );
}

export async function recordObservation(
  db: Block31Db,
  input: {
    ownerId: string;
    subjectKind: string;
    subjectId: string;
    observerOwnerId: string;
    observationKind: string;
    proofClass: ProofClass | string;
    location?: unknown;
    note?: string;
  },
) {
  if (!(PROOF_CLASSES as readonly string[]).includes(input.proofClass)) {
    throw new Error(`Invalid proofClass: ${input.proofClass}`);
  }
  if (input.location !== undefined && !validLocation(input.location)) {
    throw new Error("Location must be an observed numeric lat/lng object; synthesis is forbidden.");
  }
  const [row] = await db
    .insert(fulfillmentObservations)
    .values({
      id: `obs_${randomUUID()}`,
      ownerId: input.ownerId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      observerOwnerId: input.observerOwnerId,
      observationKind: input.observationKind,
      proofClass: input.proofClass,
      location: input.location,
      note: input.note,
    })
    .returning();
  return row;
}

export async function latestObservations(
  db: Block31Db,
  ownerId: string,
  subjectKind: string,
  subjectId: string,
) {
  return db
    .select()
    .from(fulfillmentObservations)
    .where(
      and(
        eq(fulfillmentObservations.ownerId, ownerId),
        eq(fulfillmentObservations.subjectKind, subjectKind),
        eq(fulfillmentObservations.subjectId, subjectId),
      ),
    )
    .orderBy(desc(fulfillmentObservations.createdAt));
}