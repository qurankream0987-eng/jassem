/**
 * Block 2 — Assignment: generic offer, acceptance, and execution lifecycle.
 * An offered assignment is never treated as accepted implicitly.
 */

import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assignments, type Assignment, type AssignmentState } from "@db/schema";
import type { Block2Db } from "./temporal";

export class AssignmentError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "EXPIRED";

  constructor(
    message: string,
    code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "EXPIRED",
  ) {
    super(message);
    this.code = code;
  }
}

export async function offerAssignment(
  db: Block2Db,
  input: {
    ownerId: string;
    subjectKind: string;
    subjectId: string;
    terms?: Record<string, unknown>;
    matchId?: string;
    runId?: string;
    nodeId?: string;
    offerExpiresAt?: Date;
    idempotencyKey: string;
  },
): Promise<{ assignment: Assignment; duplicate: boolean }> {
  const inserted = await db
    .insert(assignments)
    .values({
      id: `asn_${randomUUID()}`,
      ownerId: input.ownerId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      terms: input.terms ?? {},
      state: "OFFERED",
      matchId: input.matchId ?? null,
      runId: input.runId ?? null,
      nodeId: input.nodeId ?? null,
      offerExpiresAt: input.offerExpiresAt ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [assignments.ownerId, assignments.idempotencyKey],
    })
    .returning();
  if (inserted[0]) return { assignment: inserted[0], duplicate: false };
  const prior = await db
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.ownerId, input.ownerId),
        eq(assignments.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!prior[0]) throw new AssignmentError("Idempotent assignment could not be read", "INVALID_STATE");
  return { assignment: prior[0], duplicate: true };
}

export async function respondToAssignment(
  db: Block2Db,
  input: {
    assignmentId: string;
    subjectId: string;
    response: "ACCEPTED" | "DECLINED";
    now?: Date;
  },
): Promise<Assignment> {
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.id, input.assignmentId))
      .limit(1)
      .for("update");
    const assignment = rows[0];
    if (!assignment) throw new AssignmentError("Assignment not found", "NOT_FOUND");
    if (assignment.subjectId !== input.subjectId) {
      throw new AssignmentError("Only the assigned subject may respond", "FORBIDDEN");
    }
    if (assignment.state !== "OFFERED") {
      throw new AssignmentError(`Cannot respond to assignment in ${assignment.state}`, "INVALID_STATE");
    }
    // One match binds at most one acceptance: accepting is exclusive per
    // (ownerId, matchId) — a second accept fails closed inside the same
    // transaction, so concurrent accepts cannot both succeed.
    if (input.response === "ACCEPTED" && assignment.matchId) {
      const conflict = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(
          and(
            eq(assignments.ownerId, assignment.ownerId),
            eq(assignments.matchId, assignment.matchId),
            ne(assignments.id, assignment.id),
            inArray(assignments.state, ["ACCEPTED", "ACTIVE"]),
          ),
        )
        .limit(1)
        .for("update");
      if (conflict[0]) {
        throw new AssignmentError(
          "Match already accepted by another subject",
          "INVALID_STATE",
        );
      }
    }
    const now = input.now ?? new Date();
    const expired =
      assignment.offerExpiresAt !== null &&
      assignment.offerExpiresAt.getTime() <= now.getTime();
    const updated = await tx
      .update(assignments)
      .set({
        state: expired ? "EXPIRED" : input.response,
        version: assignment.version + 1,
      })
      .where(
        and(
          eq(assignments.id, assignment.id),
          eq(assignments.state, "OFFERED"),
          eq(assignments.version, assignment.version),
        ),
      )
      .returning();
    if (!updated[0]) throw new AssignmentError("Assignment version changed", "INVALID_STATE");
    return { assignment: updated[0], expired };
  });
  if (outcome.expired) throw new AssignmentError("Assignment offer expired", "EXPIRED");
  return outcome.assignment;
}

export async function transitionAssignment(
  db: Block2Db,
  input: {
    assignmentId: string;
    actorOwnerId: string;
    to: "ACTIVE" | "COMPLETED" | "CANCELLED";
  },
): Promise<Assignment> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(assignments)
      .where(eq(assignments.id, input.assignmentId))
      .limit(1)
      .for("update");
    const assignment = rows[0];
    if (!assignment) throw new AssignmentError("Assignment not found", "NOT_FOUND");
    if (assignment.ownerId !== input.actorOwnerId) {
      throw new AssignmentError("Only the assigning owner may transition", "FORBIDDEN");
    }
    const allowedFrom: Record<typeof input.to, AssignmentState[]> = {
      ACTIVE: ["ACCEPTED"],
      COMPLETED: ["ACTIVE"],
      CANCELLED: ["OFFERED", "ACCEPTED", "ACTIVE"],
    };
    if (!allowedFrom[input.to].includes(assignment.state)) {
      throw new AssignmentError(
        `Cannot move assignment from ${assignment.state} to ${input.to}`,
        "INVALID_STATE",
      );
    }
    const updated = await tx
      .update(assignments)
      .set({ state: input.to, version: assignment.version + 1 })
      .where(
        and(
          eq(assignments.id, assignment.id),
          eq(assignments.version, assignment.version),
          eq(assignments.state, assignment.state),
        ),
      )
      .returning();
    if (!updated[0]) throw new AssignmentError("Assignment version changed", "INVALID_STATE");
    return updated[0];
  });
}

export async function expireDueAssignmentOffers(
  db: Block2Db,
  options?: { now?: Date; limit?: number },
): Promise<number> {
  const now = options?.now ?? new Date();
  const due = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.state, "OFFERED"), lte(assignments.offerExpiresAt, now)))
    .limit(options?.limit ?? 100);
  if (due.length === 0) return 0;
  const updated = await db
    .update(assignments)
    .set({ state: "EXPIRED", version: sql`${assignments.version} + 1` })
    .where(
      and(
        inArray(assignments.id, due.map((row) => row.id)),
        eq(assignments.state, "OFFERED"),
        lte(assignments.offerExpiresAt, now),
      ),
    )
    .returning({ id: assignments.id });
  return updated.length;
}

export async function getAssignment(
  db: Block2Db,
  assignmentId: string,
): Promise<Assignment | undefined> {
  const rows = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
  return rows[0];
}

export async function listAssignments(
  db: Block2Db,
  filter: { ownerId?: string; subjectId?: string; runId?: string },
): Promise<Assignment[]> {
  const conditions = [];
  if (filter.ownerId) conditions.push(eq(assignments.ownerId, filter.ownerId));
  if (filter.subjectId) conditions.push(eq(assignments.subjectId, filter.subjectId));
  if (filter.runId) conditions.push(eq(assignments.runId, filter.runId));
  return db
    .select()
    .from(assignments)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}
