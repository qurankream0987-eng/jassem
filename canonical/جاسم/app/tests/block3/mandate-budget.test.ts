/**
 * Block 3 §21–§23 / §97 — stateful financial mandate budgets with ATOMIC
 * PostgreSQL enforcement: concurrent spends can never overrun the budget,
 * and a single-use mandate can never be used twice.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createDelegationGrant } from "../../api/runtime/block2/delegation";
import {
  consumeMandateBudget,
  getMandateBudget,
  MandateBudgetError,
  provisionMandateBudget,
  releaseMandateConsumption,
} from "../../api/runtime/block3/financial-mandate";
import { getTestDb, resetBlock3 } from "./helpers/pg";

async function financialGrant(idempotencyTag: string) {
  const { db } = await getTestDb();
  return createDelegationGrant(db, {
    principalOwnerId: "owner-1",
    delegateId: `agent-${idempotencyTag}`,
    purpose: "spend within budget",
    allowedCapabilities: ["pay"],
    maxMonetary: "100.000",
    currency: "KWD",
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    now: new Date("2026-01-01T00:00:00Z"),
  });
}

describe("mandate budgets — provisioning", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("provisions once per grant; refuses unknown grants", async () => {
    const { db } = await getTestDb();
    const grant = await financialGrant("a");
    const budget = await provisionMandateBudget(db, {
      grantId: grant.id, currency: "kwd", budgetMinor: "100000", executionLimit: 5,
    });
    expect(budget.currency).toBe("KWD");
    expect(budget.consumedMinor).toBe("0");
    await expect(provisionMandateBudget(db, { grantId: grant.id, currency: "KWD" }))
      .rejects.toThrow(MandateBudgetError);
    await expect(provisionMandateBudget(db, { grantId: "dlg_missing", currency: "KWD" }))
      .rejects.toThrow(/not found/i);
  });
});

describe("mandate budgets — atomic concurrent enforcement (§97)", () => {
  beforeEach(async () => resetBlock3((await getTestDb()).db));

  it("budget race: two concurrent 60.000 KWD spends against 100.000 KWD ⇒ at most one wins", async () => {
    const { db } = await getTestDb();
    const grant = await financialGrant("race-budget");
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "100000" });

    const spend = () => consumeMandateBudget(db, { grantId: grant.id, amountMinor: "60000", currency: "KWD" });
    const results = await Promise.all([spend(), spend()]);
    const allowed = results.filter((r) => r.outcome === "ALLOWED");
    const rejected = results.filter((r) => r.outcome === "REJECTED");
    expect(allowed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as { code: string }).code).toBe("INSUFFICIENT_BUDGET");

    const final = await getMandateBudget(db, grant.id);
    expect(final?.consumedMinor).toBe("60000"); // never 120000
  });

  it("single-use race: executionLimit=1 ⇒ exactly one concurrent use wins", async () => {
    const { db } = await getTestDb();
    const grant = await financialGrant("race-single");
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", executionLimit: 1 });

    const use = () => consumeMandateBudget(db, { grantId: grant.id, amountMinor: "1000", currency: "KWD" });
    const results = await Promise.all([use(), use(), use()]);
    expect(results.filter((r) => r.outcome === "ALLOWED")).toHaveLength(1);
    const rejected = results.filter((r) => r.outcome === "REJECTED");
    expect(rejected).toHaveLength(2);
    expect((rejected[0] as { code: string }).code).toBe("EXECUTION_LIMIT_EXHAUSTED");
  });

  it("currency mismatch fails closed (INC-1/2 statefully)", async () => {
    const { db } = await getTestDb();
    const grant = await financialGrant("race-fx");
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "100000" });
    const result = await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "1000", currency: "USD" });
    expect(result).toMatchObject({ outcome: "REJECTED", code: "CURRENCY_MISMATCH" });
    expect((await getMandateBudget(db, grant.id))?.consumedMinor).toBe("0");
  });

  it("consumption accumulates exactly and release frees budget", async () => {
    const { db } = await getTestDb();
    const grant = await financialGrant("race-release");
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD", budgetMinor: "100000" });
    expect((await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "60000", currency: "KWD" })).outcome).toBe("ALLOWED");
    expect((await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "60000", currency: "KWD" })).outcome).toBe("REJECTED");
    await releaseMandateConsumption(db, { grantId: grant.id, amountMinor: "60000" });
    const allowed = await consumeMandateBudget(db, { grantId: grant.id, amountMinor: "90000", currency: "KWD" });
    expect(allowed.outcome).toBe("ALLOWED");
    expect((await getMandateBudget(db, grant.id))?.consumedMinor).toBe("90000");
  });

  it("unconstrained budget/limit consumes freely but always atomically", async () => {
    const { db } = await getTestDb();
    const grant = await financialGrant("race-open");
    await provisionMandateBudget(db, { grantId: grant.id, currency: "KWD" });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeMandateBudget(db, { grantId: grant.id, amountMinor: "1", currency: "KWD" })),
    );
    expect(results.every((r) => r.outcome === "ALLOWED")).toBe(true);
    expect((await getMandateBudget(db, grant.id))?.consumedMinor).toBe("5");
  });
});
