import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptMembershipInvitation,
  checkMembershipAccess,
  getMembership,
  grantMembership,
  revokeMembership,
} from "../../api/runtime/block2/membership";
import {
  expireDueAssignmentOffers,
  getAssignment,
  offerAssignment,
  respondToAssignment,
  transitionAssignment,
} from "../../api/runtime/block2/assignments";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const now = new Date("2025-01-01T00:00:00Z");

describe("Block 2 memberships and assignments", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("runs membership grant, accept, and revoke lifecycle", async () => {
    const { db } = await getTestDb();
    const { membership } = await grantMembership(db, {
      ownerId: "owner", subjectId: "subject", resourceKind: "asset",
      resourceId: "one", permissions: ["read"], invited: true,
    });
    expect(membership.state).toBe("invited");
    expect((await acceptMembershipInvitation(db, { membershipId: membership.id, subjectId: "subject" })).state).toBe("active");
    expect((await revokeMembership(db, { membershipId: membership.id, actorOwnerId: "owner" })).state).toBe("revoked");
  });

  it("fails closed, prefers exact scope over wildcard, and lazily expires", async () => {
    const { db } = await getTestDb();
    const check = (resourceId: string, permission = "read", at = now) => checkMembershipAccess(db, {
      ownerId: "owner", subjectId: "subject", resourceKind: "asset",
      resourceId, permission, now: at,
    });
    expect((await check("missing")).ok).toBe(false);
    await grantMembership(db, {
      ownerId: "owner", subjectId: "subject", resourceKind: "asset",
      permissions: ["read"],
    });
    const { membership: exact } = await grantMembership(db, {
      ownerId: "owner", subjectId: "subject", resourceKind: "asset",
      resourceId: "one", permissions: ["write"],
    });
    expect((await check("one", "read")).ok).toBe(false);
    expect((await check("one", "write")).ok).toBe(true);
    const { membership: expiring } = await grantMembership(db, {
      ownerId: "owner", subjectId: "subject", resourceKind: "asset",
      resourceId: "old", permissions: ["read"], expiresAt: now,
    });
    expect(await check("old", "read", new Date(now.getTime() + 1))).toMatchObject({ ok: false, code: "EXPIRED" });
    expect((await getMembership(db, expiring.id))?.state).toBe("expired");
    expect(exact.resourceId).toBe("one");
  });

  it("keeps OFFERED distinct from ACCEPTED and permits only the subject response", async () => {
    const { db } = await getTestDb();
    const { assignment } = await offerAssignment(db, {
      ownerId: "owner", subjectKind: "user", subjectId: "subject", idempotencyKey: "offer",
    });
    expect(assignment.state).toBe("OFFERED");
    await expect(respondToAssignment(db, {
      assignmentId: assignment.id, subjectId: "other", response: "ACCEPTED", now,
    })).rejects.toThrow();
    const accepted = await respondToAssignment(db, {
      assignmentId: assignment.id, subjectId: "subject", response: "ACCEPTED", now,
    });
    expect(accepted.state).toBe("ACCEPTED");
    expect(accepted.state).not.toBe("OFFERED");
  });

  it("persists EXPIRED before throwing on late acceptance", async () => {
    const { db } = await getTestDb();
    const { assignment } = await offerAssignment(db, {
      ownerId: "owner", subjectKind: "user", subjectId: "subject",
      offerExpiresAt: now, idempotencyKey: "late",
    });
    await expect(respondToAssignment(db, {
      assignmentId: assignment.id, subjectId: "subject", response: "ACCEPTED",
      now: new Date(now.getTime() + 1),
    })).rejects.toThrow("expired");
    expect((await getAssignment(db, assignment.id))?.state).toBe("EXPIRED");
  });

  it("applies owner-only legal transitions with version increments", async () => {
    const { db } = await getTestDb();
    const { assignment } = await offerAssignment(db, {
      ownerId: "owner", subjectKind: "user", subjectId: "subject", idempotencyKey: "flow",
    });
    const accepted = await respondToAssignment(db, {
      assignmentId: assignment.id, subjectId: "subject", response: "ACCEPTED", now,
    });
    await expect(transitionAssignment(db, {
      assignmentId: assignment.id, actorOwnerId: "other", to: "ACTIVE",
    })).rejects.toThrow();
    const active = await transitionAssignment(db, {
      assignmentId: assignment.id, actorOwnerId: "owner", to: "ACTIVE",
    });
    expect(active.version).toBe(accepted.version + 1);
    expect((await transitionAssignment(db, {
      assignmentId: assignment.id, actorOwnerId: "owner", to: "COMPLETED",
    })).state).toBe("COMPLETED");
  });

  it("expires all due assignment offers", async () => {
    const { db } = await getTestDb();
    await offerAssignment(db, {
      ownerId: "owner", subjectKind: "user", subjectId: "one",
      offerExpiresAt: now, idempotencyKey: "due",
    });
    await offerAssignment(db, {
      ownerId: "owner", subjectKind: "user", subjectId: "two",
      offerExpiresAt: new Date(now.getTime() + 10_000), idempotencyKey: "future",
    });
    expect(await expireDueAssignmentOffers(db, { now })).toBe(1);
  });
});