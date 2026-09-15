/**
 * Block 3 focused closure — payout architecture.
 * PAYOUT != SETTLEMENT; PAYOUT_REQUESTED != PAYOUT_EXECUTED != PAYOUT_VERIFIED;
 * PROVIDER_RECEIPT != PAYOUT_VERIFIED. No blind retry. No fabricated success.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  executePayout,
  PayoutError,
  reconcilePayout,
  requestPayout,
  changePayoutDestination,
} from "../../api/runtime/block3/payout";
import { getPartyLedger } from "../../api/runtime/block3/economic-ledger";
import { createHttpPspClient } from "../../api/runtime/block3/psp-client";
import { getTestDb, resetBlock3 } from "./helpers/pg";
import { startControlledPsp, type ControlledPsp } from "./helpers/controlled-psp-server";

let psp: ControlledPsp;
let pspClient: ReturnType<typeof createHttpPspClient>;

beforeAll(async () => {
  psp = await startControlledPsp();
  pspClient = createHttpPspClient(psp.url);
});
afterAll(async () => psp.close());
beforeEach(async () => {
  await resetBlock3((await getTestDb()).db);
  psp.payouts.clear();
  psp.setFailureMode("none");
});

describe("payout architecture", () => {
  it("BLOCKED_BY_PROVIDER when no destination/provider bound — never fabricates success", async () => {
    const { db } = await getTestDb();
    const { status, payout } = await requestPayout(db, {
      payoutId: "payout-1", ownerId: "owner-1", amountMinor: "100000", currency: "KWD",
    });
    expect(status).toBe("BLOCKED_BY_PROVIDER");
    expect(payout).toBeNull();
  });

  it("REQUESTED -> EXECUTED (uncertain) -> VERIFIED via authoritative readback only", async () => {
    const { db } = await getTestDb();
    const { status } = await requestPayout(db, {
      payoutId: "payout-2", ownerId: "owner-1", destinationRef: "iban-1",
      amountMinor: "50000", currency: "KWD", providerRef: "psp-controlled",
    });
    expect(status).toBe("REQUESTED");
    const executed = await executePayout(db, { psp: pspClient }, { payoutId: "payout-2" });
    expect(executed?.status).toBe("EXECUTED");
    expect(executed?.status).not.toBe("VERIFIED");

    const verified = await reconcilePayout(db, { psp: pspClient }, "payout-2");
    expect(verified?.status).toBe("VERIFIED");

    const ledger = await getPartyLedger(db, { ownerId: "owner-1", party: "iban-1", kind: "PAYOUT" });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.totalMinor).toBe("50000");
  });

  it("provider receipt alone never verifies a payout without matching readback", async () => {
    const { db } = await getTestDb();
    await requestPayout(db, {
      payoutId: "payout-3", ownerId: "owner-1", destinationRef: "iban-2",
      amountMinor: "10000", currency: "KWD", providerRef: "psp-controlled",
    });
    const executed = await executePayout(db, { psp: pspClient }, { payoutId: "payout-3" });
    expect(executed?.status).toBe("EXECUTED");
    // No reconciliation performed yet: PROVIDER_RECEIPT (EXECUTED) != PAYOUT_VERIFIED.
    expect(executed?.status).not.toBe("VERIFIED");
    const ledger = await getPartyLedger(db, "iban-2");
    expect(ledger.filter((e) => e.kind === "PAYOUT")).toHaveLength(0);
  });

  it("duplicate payout requests do not create duplicate financial effects", async () => {
    const { db } = await getTestDb();
    await requestPayout(db, {
      payoutId: "payout-4", ownerId: "owner-1", destinationRef: "iban-3",
      amountMinor: "20000", currency: "KWD", providerRef: "psp-controlled",
    });
    await requestPayout(db, {
      payoutId: "payout-4", ownerId: "owner-1", destinationRef: "iban-3",
      amountMinor: "20000", currency: "KWD", providerRef: "psp-controlled",
    });
    await executePayout(db, { psp: pspClient }, { payoutId: "payout-4" });
    await executePayout(db, { psp: pspClient }, { payoutId: "payout-4" });
    await reconcilePayout(db, { psp: pspClient }, "payout-4");
    await reconcilePayout(db, { psp: pspClient }, "payout-4");
    const ledger = await getPartyLedger(db, { ownerId: "owner-1", party: "iban-3", kind: "PAYOUT" });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.totalMinor).toBe("20000");
  });

  it("uncertain payout effect goes to INCONCLUSIVE and forbids blind retry", async () => {
    const { db } = await getTestDb();
    await requestPayout(db, {
      payoutId: "payout-5", ownerId: "owner-1", destinationRef: "iban-4",
      amountMinor: "30000", currency: "KWD", providerRef: "psp-controlled",
    });
    psp.setFailureMode("crash_after_capture");
    const executed = await executePayout(db, { psp: pspClient }, { payoutId: "payout-5" });
    expect(executed?.status).toBe("INCONCLUSIVE");
    await expect(executePayout(db, { psp: pspClient }, { payoutId: "payout-5" })).rejects.toThrow(PayoutError);
  });

  it("changing payout destination requires explicit owner approval", async () => {
    const { db } = await getTestDb();
    await requestPayout(db, {
      payoutId: "payout-6", ownerId: "owner-1", destinationRef: "iban-5",
      amountMinor: "40000", currency: "KWD", providerRef: "psp-controlled",
    });
    await expect(
      changePayoutDestination(db, "payout-6", "owner-1", "iban-attacker"),
    ).rejects.toThrow(/approval/i);
    const approved = await changePayoutDestination(db, "payout-6", "owner-1", "iban-6", "approval-xyz");
    expect(approved.destinationRef).toBe("iban-6");
    expect(approved.status).toBe("REQUESTED");
  });
});
