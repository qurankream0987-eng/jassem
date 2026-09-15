/**
 * Block 2 — Membership: explicit, fail-closed authorization over a generic
 * owner/resource scope. Possession of a resource URL never grants access.
 */

import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { memberships, type Membership } from "@db/schema";
import type { ReservationAuthorizer } from "./capacity";
import type { Block2Db } from "./temporal";

export class MembershipError extends Error {
  readonly code: "NOT_FOUND" | "FORBIDDEN" | "EXPIRED" | "REVOKED" | "INVALID";

  constructor(
    message: string,
    code: "NOT_FOUND" | "FORBIDDEN" | "EXPIRED" | "REVOKED" | "INVALID",
  ) {
    super(message);
    this.code = code;
  }
}

export async function grantMembership(
  db: Block2Db,
  input: {
    ownerId: string;
    subjectId: string;
    subjectKind?: string;
    resourceKind: string;
    resourceId?: string;
    role?: string;
    permissions: string[];
    purpose?: string;
    expiresAt?: Date;
    invited?: boolean;
  },
): Promise<{ membership: Membership; created: boolean }> {
  if (!input.ownerId || !input.subjectId || !input.resourceKind || input.permissions.length === 0) {
    throw new MembershipError("Owner, subject, resource kind, and permissions are required", "INVALID");
  }
  const resourceId = input.resourceId ?? "*";
  const rows = await db
    .insert(memberships)
    .values({
      id: `mbr_${randomUUID()}`,
      ownerId: input.ownerId,
      subjectId: input.subjectId,
      subjectKind: input.subjectKind ?? "user",
      resourceKind: input.resourceKind,
      resourceId,
      role: input.role ?? null,
      permissions: input.permissions,
      purpose: input.purpose ?? null,
      state: input.invited ? "invited" : "active",
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        memberships.ownerId,
        memberships.subjectId,
        memberships.resourceKind,
        memberships.resourceId,
      ],
      set: {
        subjectKind: input.subjectKind ?? "user",
        role: input.role ?? null,
        permissions: input.permissions,
        purpose: input.purpose ?? null,
        state: input.invited ? "invited" : "active",
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({
      ...getTableColumns(memberships),
      created: sql<boolean>`xmax = 0`,
    });
  const { created, ...membership } = rows[0]!;
  return { membership, created };
}

export async function acceptMembershipInvitation(
  db: Block2Db,
  input: { membershipId: string; subjectId: string },
): Promise<Membership> {
  const current = await getMembership(db, input.membershipId);
  if (!current) throw new MembershipError("Membership not found", "NOT_FOUND");
  if (current.subjectId !== input.subjectId) {
    throw new MembershipError("Only the invited subject may accept", "FORBIDDEN");
  }
  if (current.state === "revoked") {
    throw new MembershipError("Membership revoked", "REVOKED");
  }
  if (current.state === "expired") {
    throw new MembershipError("Membership invitation expired", "EXPIRED");
  }
  if (current.state !== "invited") {
    throw new MembershipError("Membership is not awaiting acceptance", "INVALID");
  }
  if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
    await db
      .update(memberships)
      .set({ state: "expired" })
      .where(and(eq(memberships.id, current.id), eq(memberships.state, "invited")));
    throw new MembershipError("Membership invitation expired", "EXPIRED");
  }
  const rows = await db
    .update(memberships)
    .set({ state: "active" })
    .where(and(eq(memberships.id, current.id), eq(memberships.state, "invited")))
    .returning();
  if (!rows[0]) throw new MembershipError("Membership invitation changed", "INVALID");
  return rows[0];
}

export async function revokeMembership(
  db: Block2Db,
  input: { membershipId: string; actorOwnerId: string },
): Promise<Membership> {
  const current = await getMembership(db, input.membershipId);
  if (!current) throw new MembershipError("Membership not found", "NOT_FOUND");
  if (current.ownerId !== input.actorOwnerId) {
    throw new MembershipError("Only the resource owner may revoke", "FORBIDDEN");
  }
  if (current.state === "revoked") return current;
  const rows = await db
    .update(memberships)
    .set({ state: "revoked", revokedAt: new Date() })
    .where(eq(memberships.id, current.id))
    .returning();
  return rows[0]!;
}

export type MembershipAccessResult =
  | { ok: true; membership: Membership }
  | { ok: false; reason: string; code: MembershipError["code"] };

export async function checkMembershipAccess(
  db: Block2Db,
  input: {
    ownerId: string;
    subjectId: string;
    resourceKind: string;
    resourceId: string;
    permission: string;
    purpose?: string;
    now?: Date;
  },
): Promise<MembershipAccessResult> {
  const now = input.now ?? new Date();
  const find = async (resourceId: string) => {
    const rows = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.ownerId, input.ownerId),
          eq(memberships.subjectId, input.subjectId),
          eq(memberships.resourceKind, input.resourceKind),
          eq(memberships.resourceId, resourceId),
        ),
      )
      .limit(1);
    return rows[0];
  };
  const membership = (await find(input.resourceId)) ?? (input.resourceId === "*" ? undefined : await find("*"));
  if (!membership) return { ok: false, reason: "No membership grant found", code: "NOT_FOUND" };
  if (membership.state === "revoked") {
    return { ok: false, reason: "Membership revoked", code: "REVOKED" };
  }
  if (
    membership.state === "expired" ||
    (membership.expiresAt && membership.expiresAt.getTime() <= now.getTime())
  ) {
    if (membership.state === "active") {
      await db
        .update(memberships)
        .set({ state: "expired" })
        .where(and(eq(memberships.id, membership.id), eq(memberships.state, "active")));
    }
    return { ok: false, reason: "Membership expired", code: "EXPIRED" };
  }
  if (membership.state !== "active") {
    return { ok: false, reason: "Membership is not active", code: "FORBIDDEN" };
  }
  if (!membership.permissions.includes("*") && !membership.permissions.includes(input.permission)) {
    return { ok: false, reason: "Permission not granted", code: "FORBIDDEN" };
  }
  if (membership.purpose !== null && membership.purpose !== input.purpose) {
    return { ok: false, reason: "Purpose mismatch", code: "FORBIDDEN" };
  }
  return { ok: true, membership };
}

export async function getMembership(
  db: Block2Db,
  membershipId: string,
): Promise<Membership | undefined> {
  const rows = await db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
  return rows[0];
}

export async function listMemberships(
  db: Block2Db,
  filter: { ownerId?: string; subjectId?: string },
): Promise<Membership[]> {
  const conditions = [];
  if (filter.ownerId) conditions.push(eq(memberships.ownerId, filter.ownerId));
  if (filter.subjectId) conditions.push(eq(memberships.subjectId, filter.subjectId));
  return db
    .select()
    .from(memberships)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
}

export function makeMembershipReservationAuthorizer(db: Block2Db): ReservationAuthorizer {
  return {
    async canReserve(input) {
      if (input.requesterId === input.resourceOwnerId) return true;
      const result = await checkMembershipAccess(db, {
        ownerId: input.resourceOwnerId,
        subjectId: input.requesterId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        permission: "reserve",
      });
      return result.ok;
    },
  };
}
