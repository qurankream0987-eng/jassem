/**
 * Block 3 prerequisite proofs — the three mapped DelegationGrant
 * compatibility fixes (INC-1/2/3). These are the ONLY Block-2 behavioral
 * changes authorized by the Block 3 execution order.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDelegationGrant,
  revalidateDelegationGrant,
} from "../../api/runtime/block2/delegation";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const now = new Date("2025-01-01T00:00:00Z");
const later = new Date("2025-01-02T00:00:00Z");

function baseGrant(patch: Record<string, unknown> = {}) {
  return {
    principalOwnerId: "principal",
    delegateId: "delegate",
    purpose: "operate",
    allowedCapabilities: ["pay"],
    resourceScope: { kinds: ["asset"], ids: ["a"] },
    maxDepth: 0,
    now,
    expiresAt: later,
    ...patch,
  };
}

describe("INC-1 — monetary authority requires explicit currency", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  it("rejects maxMonetary without currency", async () => {
    const { db } = await getTestDb();
    await expect(
      createDelegationGrant(db, baseGrant({ maxMonetary: 100 })),
    ).rejects.toThrow(/currency/i);
    await expect(
      createDelegationGrant(db, baseGrant({ maxMonetary: 100, currency: "  " })),
    ).rejects.toThrow(/currency/i);
  });

  it("accepts monetary authority with currency and normalizes it", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(
      db,
      baseGrant({ maxMonetary: 100, currency: "kwd" }),
    );
    expect(grant.currency).toBe("KWD");
  });

  it("still permits non-monetary grants without currency", async () => {
    const { db } = await getTestDb();
    const grant = await createDelegationGrant(db, baseGrant());
    expect(grant.maxMonetary).toBeNull();
    expect(grant.currency).toBeNull();
  });
});

describe("INC-2 — child delegation inherits currency", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  async function parent() {
    return createDelegationGrant((await getTestDb()).db, {
      ...baseGrant({ maxMonetary: 100, currency: "KWD" }),
      maxDepth: 2,
    });
  }

  it("rejects a currency-less child under a currency-bound parent", async () => {
    const { db } = await getTestDb();
    const root = await parent();
    await expect(
      createDelegationGrant(db, {
        ...baseGrant({ maxMonetary: 50 }),
        principalOwnerId: "delegate",
        delegateId: "child",
        parentGrantId: root.id,
      }),
    ).rejects.toThrow(/currency/i);
  });

  it("rejects a child switching currency even at a lower amount", async () => {
    const { db } = await getTestDb();
    const root = await parent();
    await expect(
      createDelegationGrant(db, {
        ...baseGrant({ maxMonetary: 50, currency: "USD" }),
        principalOwnerId: "delegate",
        delegateId: "child",
        parentGrantId: root.id,
      }),
    ).rejects.toThrow(/currency|authority/i);
  });

  it("accepts a child carrying the parent currency", async () => {
    const { db } = await getTestDb();
    const root = await parent();
    const child = await createDelegationGrant(db, {
      ...baseGrant({ maxMonetary: 50, currency: "kwd" }),
      principalOwnerId: "delegate",
      delegateId: "child",
      parentGrantId: root.id,
    });
    expect(child.currency).toBe("KWD");
    expect(child.depth).toBe(1);
  });
});

describe("INC-3 — financial constraints revalidate at execution time", () => {
  beforeEach(async () => resetBlock2((await getTestDb()).db));

  async function grantWith(constraints: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return createDelegationGrant((await getTestDb()).db, baseGrant({ constraints, ...extra }));
  }

  it("enforces allowedPayees at execution and fails closed without context", async () => {
    const { db } = await getTestDb();
    const grant = await grantWith({ allowedPayees: ["merchant-a"] });
    const common = {
      grantId: grant.id, delegateId: "delegate", capability: "pay", purpose: "operate", now,
    };
    expect(await revalidateDelegationGrant(db, { ...common, context: { payeeRef: "merchant-a" } }))
      .toMatchObject({ ok: true });
    expect(await revalidateDelegationGrant(db, { ...common, context: { payeeRef: "merchant-b" } }))
      .toMatchObject({ ok: false, code: "CONSTRAINT_VIOLATION" });
    expect(await revalidateDelegationGrant(db, common))
      .toMatchObject({ ok: false, code: "CONSTRAINT_UNVERIFIABLE" });
  });

  it("enforces deniedProviders at execution", async () => {
    const { db } = await getTestDb();
    const grant = await grantWith({ deniedProviders: ["psp-evil"] });
    const common = {
      grantId: grant.id, delegateId: "delegate", capability: "pay", purpose: "operate", now,
    };
    expect(await revalidateDelegationGrant(db, { ...common, context: { providerRef: "psp-evil" } }))
      .toMatchObject({ ok: false, code: "CONSTRAINT_VIOLATION" });
    expect(await revalidateDelegationGrant(db, { ...common, context: { providerRef: "psp-ok" } }))
      .toMatchObject({ ok: true });
  });

  it("enforces maxQuantity at execution", async () => {
    const { db } = await getTestDb();
    const grant = await grantWith({ maxQuantity: 2 });
    const common = {
      grantId: grant.id, delegateId: "delegate", capability: "pay", purpose: "operate", now,
    };
    expect(await revalidateDelegationGrant(db, { ...common, context: { quantity: 10 } }))
      .toMatchObject({ ok: false, code: "QUANTITY_EXCEEDED" });
    expect(await revalidateDelegationGrant(db, { ...common, context: { quantity: 1 } }))
      .toMatchObject({ ok: true });
    expect(await revalidateDelegationGrant(db, common))
      .toMatchObject({ ok: false, code: "CONSTRAINT_UNVERIFIABLE" });
  });

  it("rejects currency mismatch and currency-less monetary execution", async () => {
    const { db } = await getTestDb();
    const grant = await grantWith({}, { maxMonetary: 100, currency: "KWD" });
    const common = {
      grantId: grant.id, delegateId: "delegate", capability: "pay", purpose: "operate", now,
    };
    expect(
      await revalidateDelegationGrant(db, {
        ...common, monetaryAmountExact: "50", context: { currency: "USD" },
      }),
    ).toMatchObject({ ok: false, code: "CURRENCY_MISMATCH" });
    expect(
      await revalidateDelegationGrant(db, { ...common, monetaryAmountExact: "50" }),
    ).toMatchObject({ ok: false, code: "CURRENCY_MISMATCH" });
    expect(
      await revalidateDelegationGrant(db, {
        ...common, monetaryAmountExact: "50", context: { currency: "KWD" },
      }),
    ).toMatchObject({ ok: true });
  });

  it("compares monetary limits exactly, without float collapse", async () => {
    const { db } = await getTestDb();
    // Beyond float53 precision: Number() collapses limit and limit+1 to the
    // same float; exact scaled comparison must still distinguish them. The
    // limit enters as an exact decimal string so no precision is lost.
    const big = "9007199254740993";
    const grant = await createDelegationGrant(
      (await getTestDb()).db,
      baseGrant({ maxMonetary: big, currency: "KWD" }),
    );
    expect(grant.maxMonetary).toBe("9007199254740993.000000");
    const common = {
      grantId: grant.id, delegateId: "delegate", capability: "pay", purpose: "operate",
      context: { currency: "KWD" }, now,
    };
    expect(await revalidateDelegationGrant(db, { ...common, monetaryAmountExact: big }))
      .toMatchObject({ ok: true });
    expect(
      await revalidateDelegationGrant(db, { ...common, monetaryAmountExact: "9007199254740994" }),
    ).toMatchObject({ ok: false, code: "MONETARY_LIMIT_EXCEEDED" });
    // Sub-unit exactness at the numeric(24,6) scale (KWD-style 3 decimals).
    const sub = await createDelegationGrant(
      (await getTestDb()).db,
      baseGrant({ delegateId: "delegate-2", maxMonetary: 0.001, currency: "KWD" }),
    );
    expect(
      await revalidateDelegationGrant(db, {
        grantId: sub.id, delegateId: "delegate-2", capability: "pay", purpose: "operate",
        monetaryAmountExact: "0.0015", context: { currency: "KWD" }, now,
      }),
    ).toMatchObject({ ok: false, code: "MONETARY_LIMIT_EXCEEDED" });
  });
});
