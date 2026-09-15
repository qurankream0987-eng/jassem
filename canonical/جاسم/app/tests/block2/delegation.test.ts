import { beforeEach, describe, expect, it } from "vitest";
import {
  createDelegationGrant,
  delegationFingerprint,
  revalidateDelegationGrant,
  revokeDelegationGrant,
} from "../../api/runtime/block2/delegation";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const now = new Date("2025-01-01T00:00:00Z");
const later = new Date("2025-01-02T00:00:00Z");

describe("Block 2 delegation", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  async function root(maxDepth = 2) {
    return createDelegationGrant((await getTestDb()).db, {
      principalOwnerId: "principal", delegateId: "delegate", purpose: "operate",
      allowedCapabilities: ["read", "write"], resourceScope: { kinds: ["asset"], ids: ["a", "b"] },
      maxMonetary: 100, currency: "USD", maxDepth, now, expiresAt: later,
    });
  }

  it("creates a root grant and accepts narrowed sub-delegation", async () => {
    const { db } = await getTestDb();
    const parent = await root();
    expect(parent.depth).toBe(0);
    const child = await createDelegationGrant(db, {
      principalOwnerId: "delegate", delegateId: "child", purpose: "operate",
      allowedCapabilities: ["read"], resourceScope: { kinds: ["asset"], ids: ["a"] },
      maxMonetary: 50, currency: "USD", maxDepth: 0, parentGrantId: parent.id,
      now, expiresAt: later,
    });
    expect(child.depth).toBe(1);
  });

  it.each([
    ["capability superset", { allowedCapabilities: ["read", "delete"], resourceScope: { kinds: ["asset"], ids: ["a"] }, maxMonetary: 50, maxDepth: 0 }],
    ["monetary increase", { allowedCapabilities: ["read"], resourceScope: { kinds: ["asset"], ids: ["a"] }, maxMonetary: 101, maxDepth: 0 }],
    ["depth overflow", { allowedCapabilities: ["read"], resourceScope: { kinds: ["asset"], ids: ["a"] }, maxMonetary: 50, maxDepth: 2 }],
    ["resource escape", { allowedCapabilities: ["read"], resourceScope: { kinds: ["other"], ids: ["a"] }, maxMonetary: 50, maxDepth: 0 }],
  ])("rejects sub-delegation widening: %s", async (_label, patch) => {
    const { db } = await getTestDb();
    const parent = await root();
    await expect(createDelegationGrant(db, {
      principalOwnerId: "delegate", delegateId: "child", purpose: "operate",
      currency: "USD", parentGrantId: parent.id, now, expiresAt: later, ...patch,
    })).rejects.toThrow();
  });

  it("blocks revalidation and new sub-grants after revocation", async () => {
    const { db } = await getTestDb();
    const parent = await root();
    await revokeDelegationGrant(db, { grantId: parent.id, actorOwnerId: "principal", now });
    expect(await revalidateDelegationGrant(db, {
      grantId: parent.id, delegateId: "delegate", capability: "read", purpose: "operate", now,
    })).toMatchObject({ ok: false, code: "REVOKED" });
    await expect(createDelegationGrant(db, {
      principalOwnerId: "delegate", delegateId: "child", purpose: "operate",
      allowedCapabilities: ["read"], resourceScope: { kinds: ["asset"], ids: ["a"] },
      maxMonetary: 1, currency: "USD", maxDepth: 0, parentGrantId: parent.id, now, expiresAt: later,
    })).rejects.toThrow("revoked");
  });

  it("fails an expired grant and computes deterministic fingerprints", async () => {
    const { db } = await getTestDb();
    const grant = await root();
    expect(await revalidateDelegationGrant(db, {
      grantId: grant.id, delegateId: "delegate", capability: "read", purpose: "operate",
      now: new Date(later.getTime() + 1),
    })).toMatchObject({ ok: false, code: "EXPIRED" });
    const terms = {
      principalOwnerId: grant.principalOwnerId, delegateId: grant.delegateId,
      purpose: grant.purpose, allowedCapabilities: grant.allowedCapabilities,
      deniedCapabilities: grant.deniedCapabilities, resourceScope: grant.resourceScope,
      maxMonetary: grant.maxMonetary, currency: grant.currency,
      validFrom: grant.validFrom.toISOString(), expiresAt: grant.expiresAt?.toISOString() ?? null,
      maxDepth: grant.maxDepth, parentGrantId: grant.parentGrantId,
    };
    expect(delegationFingerprint(terms)).toBe(grant.fingerprint);
    expect(delegationFingerprint({ ...terms, allowedCapabilities: [...terms.allowedCapabilities].reverse() })).toBe(grant.fingerprint);
  });
});