/**
 * JASIM — ONE TRANSACTION FOR EVERY EXCHANGE THERE IS.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   OPPORTUNITY != PROPOSAL != AGREEMENT != COMMITMENT != TRANSACTION
 *   TRANSACTION != PAYMENT  != FULFILLMENT != VERIFICATION
 *
 *   ACCEPTED OFFER   != EXECUTED TRANSACTION
 *   PAID             != DELIVERED
 *   PROVIDER RECEIPT != VERIFIED FULFILLMENT
 *   CLAIMED_COMPLETE != VERIFIED_COMPLETE
 *
 * There is no buyer column and no seller column, and the same rows carry
 * goods, laboratory hours, generator capacity, warehouse pallets, a
 * translation and a fabrication job.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { commitments, executionAttempts, paymentIntents, transactions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let txn: typeof import("../../api/runtime/transaction-runtime");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let fabric: typeof import("../../api/runtime/economic-fabric");
let authority: typeof import("../../api/runtime/authority-acts");
let bridge: typeof import("../../api/runtime/effect-observation-bridge");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const A = "9501";
const B = "9502";

describe("a transaction is what a commitment becomes, and nothing more", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    txn = await import("../../api/runtime/transaction-runtime");
    agreement = await import("../../api/runtime/agreement-runtime");
    fabric = await import("../../api/runtime/economic-fabric");
    authority = await import("../../api/runtime/authority-acts");
    bridge = await import("../../api/runtime/effect-observation-bridge");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, observations, authority_requests, organizations,
        memberships, scope_policies, economic_expressions, economic_matches,
        economic_engagements, economic_proposals, negotiation_envelopes,
        agreements, commitments, transactions, payment_intents CASCADE`),
    );
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Fixtures: an opportunity that becomes an agreement ────────────────────

  /**
   * The whole chain, from the internal exchange. Nothing about matching was
   * changed to fit transactions, and there is no second "commerce opportunity".
   */
  async function engagement(semanticType: string) {
    const offering = await fabric.createExpression({
      ownerId: B,
      kind: "offering",
      semanticType,
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: offering.id,
      ownerId: B,
      projection: { semanticType, summary: "عرض" },
    });
    const need = await fabric.createExpression({
      ownerId: A,
      kind: "need",
      semanticType,
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: need.id,
      ownerId: A,
      projection: { semanticType, summary: "احتياج" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id,
      offeringId: offering.id,
      createdByOwnerId: A,
    });
    return fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: A,
      participants: await fabric.participantsForMatch(match.id),
    });
  }

  /** Two obligations: one each way. Neither party is a "buyer". */
  const TWO_SIDED = (over: Record<string, unknown> = {}) => [
    {
      key: "payment",
      kind: "NUMBER",
      value: 9500,
      unit: "minor",
      owedBy: A,
      owedTo: B,
      // INTERNAL_STATE: JASIM owns a payment record and can read it back.
      evidence: "INTERNAL_STATE",
      subjectKind: "obligation",
      subjectId: "payment-1",
      settlement: { amountMinor: "9500", currency: "KWD" },
    },
    {
      key: "delivery",
      kind: "NUMBER",
      value: 100,
      unit: "unit",
      owedBy: B,
      owedTo: A,
      evidence: "INDEPENDENT" in over ? "REMOTE_MUTATION" : "HUMAN_ACTION",
      subjectKind: "obligation",
      subjectId: "delivery-1",
    },
  ];

  async function committedAgreement(
    semanticType = "unit X",
    terms: unknown[] = TWO_SIDED(),
  ) {
    const engaged = await engagement(semanticType);
    await agreement.setNegotiationEnvelope({
      engagementId: engaged.id,
      ownerId: A,
      principalId: A,
      bounds: { payment: { direction: "LOWER_IS_BETTER", target: 9000, reserve: 10000 } },
      mayConcede: true,
      mayAcceptWithinReserve: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engaged.id,
      proposerOwnerId: B,
      terms,
    });
    return { engaged, proposal };
  }

  // ── 1. The chain stays separate ───────────────────────────────────────────

  it("a proposal alone creates no transaction", async () => {
    await committedAgreement();
    expect(await handle.db.select().from(transactions)).toHaveLength(0);
    expect(await handle.db.select().from(commitments)).toHaveLength(0);
  });

  it("an agreement with no authority creates no transaction", async () => {
    const engaged = await engagement("unit X");
    const proposal = await agreement.proposeTermSheet({
      engagementId: engaged.id,
      proposerOwnerId: B,
      terms: TWO_SIDED(),
    });
    // No envelope, so nobody authorized accepting.
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: A }),
    ).rejects.toThrow(/authorized/i);
    expect(await handle.db.select().from(transactions)).toHaveLength(0);
  });

  it("a commitment materializes exactly one transaction", async () => {
    const { proposal } = await committedAgreement();
    const committed = await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    expect(committed.transaction).toBeTruthy();
    const rows = await handle.db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agreementId).toBe(committed.agreement.id);
    // The parties are a LIST. Neither is a buyer and neither is a seller.
    expect([...rows[0]!.parties].sort()).toEqual([A, B].sort());
    expect(Object.keys(rows[0]!)).not.toContain("buyerRef");
    expect(Object.keys(rows[0]!)).not.toContain("sellerRef");
  });

  it("the transaction snapshots the committed terms", async () => {
    const { proposal } = await committedAgreement();
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [before] = await handle.db.select().from(transactions);

    // The proposal is edited afterwards. The snapshot does not move.
    await handle.db.execute(
      sql.raw(
        `UPDATE economic_proposals SET terms = '{"terms":[{"key":"payment","kind":"NUMBER","value":1}]}'::jsonb WHERE id = '${proposal.id}'`,
      ),
    );
    const [after] = await handle.db.select().from(transactions);
    expect(after!.termsDigest).toBe(before!.termsDigest);
    const snapshot = (after!.termsSnapshot as { terms: Array<{ key: string; value: number }> }).terms;
    expect(snapshot.find((term) => term.key === "payment")!.value).toBe(9500);
  });

  // ── 2. Idempotency ────────────────────────────────────────────────────────

  it("replaying the commitment does not create a second transaction", async () => {
    const { proposal } = await committedAgreement();
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    // The proposal is accepted, so a second commit is refused outright — and
    // even the materializer itself is idempotent, proven below.
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: A }),
    ).rejects.toThrow();
    expect(await handle.db.select().from(transactions)).toHaveLength(1);
  });

  it("concurrent materialization of one agreement yields one transaction", async () => {
    const { proposal } = await committedAgreement();
    const committed = await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [existing] = await handle.db.select().from(transactions);

    // Ten simultaneous attempts. The unique index is what holds, not a lock
    // somebody remembered to take.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        txn.materializeTransaction({
          agreement: committed.agreement,
          scopeId: A,
          commitments: committed.commitments,
        }),
      ),
    );
    expect(await handle.db.select().from(transactions)).toHaveLength(1);
    expect(new Set(results.map((result) => result.transaction.id))).toEqual(
      new Set([existing!.id]),
    );
    expect(results.filter((result) => result.created)).toHaveLength(0);
  });

  it("binding a payment twice returns the same payable", async () => {
    const { proposal } = await committedAgreement();
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [payment] = await handle.db
      .select()
      .from(commitments)
      .where(eq(commitments.termKey, "payment"));
    const first = await txn.bindPaymentObligation({ obligationId: payment!.id, actorId: A });
    const second = await txn.bindPaymentObligation({ obligationId: payment!.id, actorId: A });
    expect(second.paymentIntentId).toBe(first.paymentIntentId);
    expect(second.created).toBe(false);
    expect(await handle.db.select().from(paymentIntents)).toHaveLength(1);
  });

  // ── 3. Obligations, with no hardcoded roles ───────────────────────────────

  it("each obligation names who owes it and who it is owed to", async () => {
    const { proposal } = await committedAgreement();
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const rows = await handle.db.select().from(commitments);
    const byKey = new Map(rows.map((row) => [row.termKey, row]));
    expect(byKey.get("payment")!.ownerId).toBe(A);
    expect(byKey.get("payment")!.beneficiaryActorId).toBe(B);
    // The other way round in the same transaction. "Seller ships, buyer pays"
    // is nowhere in the runtime.
    expect(byKey.get("delivery")!.ownerId).toBe(B);
    expect(byKey.get("delivery")!.beneficiaryActorId).toBe(A);
  });

  it("with two parties the beneficiary is determinate without being declared", async () => {
    const { proposal } = await committedAgreement("unit X", [
      { key: "work", kind: "NUMBER", value: 6, unit: "hour", owedBy: B, evidence: "HUMAN_ACTION" },
    ]);
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [row] = await handle.db.select().from(commitments);
    expect(row!.beneficiaryActorId).toBe(A);
  });

  it("undeclared evidence is the strictest kind, never the easiest", async () => {
    const { proposal } = await committedAgreement("unit X", [
      { key: "work", kind: "NUMBER", value: 6, owedBy: B },
    ]);
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [row] = await handle.db.select().from(commitments);
    // HUMAN_ACTION: a person's own word about their own work settles nothing.
    expect(row!.evidenceKind).toBe("HUMAN_ACTION");
  });

  // ── 4. CLAIMED != VERIFIED ────────────────────────────────────────────────

  async function committed(terms: unknown[] = TWO_SIDED()) {
    const { proposal } = await committedAgreement("unit X", terms);
    const result = await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [transaction] = await handle.db.select().from(transactions);
    const obligations = await handle.db.select().from(commitments);
    return { result, transaction: transaction!, obligations };
  }

  it("a party saying it is done is a claim and only a claim", async () => {
    const { transaction, obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    const claimed = await txn.claimObligation({ obligationId: delivery.id, actorId: B });
    expect(claimed.state).toBe("CLAIMED");
    // The column that matters did not move.
    expect(claimed.verification).toBe("PENDING");
    const [after] = await handle.db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transaction.id));
    expect(after!.state).toBe("OPEN");
  });

  it("only the party who owes an obligation may claim it", async () => {
    const { obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    await expect(
      txn.claimObligation({ obligationId: delivery.id, actorId: A }),
    ).rejects.toThrow(/owes/i);
  });

  // ── 5. Observation and verification ───────────────────────────────────────

  /** A real attempt, so a signal has something to bind to. */
  async function attemptFor(ownerId: string) {
    const run = await runtime.createRuntimeRun({
      ownerId,
      goal: "fulfillment",
      idempotencyKey: `txn-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId,
      runId: run.id,
      nodes: [
        {
          nodeKey: "act",
          capabilityId: "opportunity-discover",
          inputs: { kind: "OFFERING" },
          maxAttempts: 1,
        },
      ],
    });
    await runtime.executeRuntimeDagNode({ ownerId, runId: run.id, workerId: "txn-worker" });
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    return attempt!;
  }

  async function observe(input: {
    ownerId: string;
    attemptId: string;
    subjectId: string;
    termKey: string;
    state: "COMPLETE" | "NOT_COMPLETE";
    channel: "AUTHENTICATED_TELEMETRY" | "PROVIDER_RESPONSE" | "OWNER_CONFIRMATION" | "INTERNAL_STATE_READBACK";
  }) {
    return bridge.submitEffectSignal(handle.db, {
      ownerId: input.ownerId,
      attemptId: input.attemptId,
      channel: input.channel,
      subjectKind: "obligation",
      subjectId: input.subjectId,
      observationType: "fulfillment",
      payload: { termKey: input.termKey, state: input.state },
      observedAt: new Date(),
      freshnessExpiresAt: new Date(Date.now() + 600_000),
    });
  }

  it("an obligation with no observation is never verified", async () => {
    const { obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    const attempt = await attemptFor(A);
    const settled = await txn.settleObligation({
      obligationId: delivery.id,
      attemptId: attempt.id,
    });
    expect(settled.obligation.verification).not.toBe("VERIFIED");
    expect(settled.transaction.state).toBe("OPEN");
  });

  it("the party's own report does not verify their own work", async () => {
    // PROVIDER_RESPONSE → SELF_REPORTED, which HUMAN_ACTION does not accept.
    const { obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    const attempt = await attemptFor(A);
    await observe({
      ownerId: A,
      attemptId: attempt.id,
      subjectId: "delivery-1",
      termKey: "delivery",
      state: "COMPLETE",
      channel: "PROVIDER_RESPONSE",
    });
    const settled = await txn.settleObligation({
      obligationId: delivery.id,
      attemptId: attempt.id,
    });
    expect(settled.obligation.verification).not.toBe("VERIFIED");
  });

  it("the owner's confirmation does verify a human obligation", async () => {
    const { obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    const attempt = await attemptFor(A);
    await observe({
      ownerId: A,
      attemptId: attempt.id,
      subjectId: "delivery-1",
      termKey: "delivery",
      state: "COMPLETE",
      channel: "OWNER_CONFIRMATION",
    });
    const settled = await txn.settleObligation({
      obligationId: delivery.id,
      attemptId: attempt.id,
    });
    expect(settled.obligation.verification).toBe("VERIFIED");
  });

  it("an observation that says it did NOT happen fails it", async () => {
    const { obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    const attempt = await attemptFor(A);
    await observe({
      ownerId: A,
      attemptId: attempt.id,
      subjectId: "delivery-1",
      termKey: "delivery",
      state: "NOT_COMPLETE",
      channel: "OWNER_CONFIRMATION",
    });
    const settled = await txn.settleObligation({
      obligationId: delivery.id,
      attemptId: attempt.id,
    });
    expect(settled.obligation.verification).toBe("FAILED");
    expect(settled.transaction.state).toBe("FAILED");
  });

  // ── 6. PARTIAL FULFILLMENT ────────────────────────────────────────────────

  it("one obligation verified and another pending is NOT a complete transaction", async () => {
    // The sentence this whole file exists for.
    const { transaction, obligations } = await committed();
    const payment = obligations.find((row) => row.termKey === "payment")!;
    const attempt = await attemptFor(A);
    await observe({
      ownerId: A,
      attemptId: attempt.id,
      subjectId: "payment-1",
      termKey: "payment",
      state: "COMPLETE",
      channel: "INTERNAL_STATE_READBACK",
    });
    const settled = await txn.settleObligation({
      obligationId: payment.id,
      attemptId: attempt.id,
    });
    expect(settled.obligation.verification).toBe("VERIFIED");
    // PAID != DELIVERED.
    expect(settled.transaction.state).toBe("OPEN");

    const view = await txn.projectTransaction({ transactionId: transaction.id, actorId: A });
    expect(view.state).toBe("OPEN");
    expect(view.outstanding).toBe(1);
  });

  it("a transaction settles only when every obligation is verified", async () => {
    const { transaction, obligations } = await committed();
    const attempt = await attemptFor(A);
    for (const [termKey, subjectId] of [
      ["payment", "payment-1"],
      ["delivery", "delivery-1"],
    ] as const) {
      await observe({
        ownerId: A,
        attemptId: attempt.id,
        subjectId,
        termKey,
        state: "COMPLETE",
        channel: termKey === "payment" ? "INTERNAL_STATE_READBACK" : "OWNER_CONFIRMATION",
      });
      await txn.settleObligation({
        obligationId: obligations.find((row) => row.termKey === termKey)!.id,
        attemptId: attempt.id,
      });
    }
    const view = await txn.projectTransaction({ transactionId: transaction.id, actorId: A });
    expect(view.state).toBe("SETTLED");
    expect(view.outstanding).toBe(0);
  });

  it("nothing can write SETTLED — the state is derived", async () => {
    const { obligations } = await committed();
    expect(txn.deriveTransactionState(obligations)).toBe("OPEN");
    expect(
      txn.deriveTransactionState(
        obligations.map((row) => ({ ...row, verification: "VERIFIED" as const })),
      ),
    ).toBe("SETTLED");
    expect(
      txn.deriveTransactionState(
        obligations.map((row, index) =>
          index === 0 ? { ...row, verification: "VERIFIED" as const } : row,
        ),
      ),
    ).toBe("OPEN");
  });

  // ── 7. Payment: reused, never faked ───────────────────────────────────────

  it("creating a payable is not paying", async () => {
    const { transaction, obligations } = await committed();
    const payment = obligations.find((row) => row.termKey === "payment")!;
    const bound = await txn.bindPaymentObligation({ obligationId: payment.id, actorId: A });
    const [intent] = await handle.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, bound.paymentIntentId));
    // Block 3's own runtime, its own status, exact minor units.
    expect(intent!.status).toBe("CREATED");
    expect(intent!.amountMinor).toBe("9500");
    expect(intent!.currency).toBe("KWD");
    expect(intent!.transactionId).toBe(transaction.id);
    // And the transaction has not moved: TRANSACTION != PAYMENT.
    const view = await txn.projectTransaction({ transactionId: transaction.id, actorId: A });
    expect(view.state).toBe("OPEN");
  });

  it("an obligation that declared no money has nothing to pay", async () => {
    const { obligations } = await committed();
    const delivery = obligations.find((row) => row.termKey === "delivery")!;
    await expect(
      txn.bindPaymentObligation({ obligationId: delivery.id, actorId: A }),
    ).rejects.toThrow(/no money/i);
  });

  it("money is exact and never derived from a display unit", async () => {
    // «9500 minor» in a term's unit is not a payable amount. The settlement is
    // a separate declared fact, and there is no conversion anywhere.
    const { proposal } = await committedAgreement("unit X", [
      { key: "payment", kind: "NUMBER", value: 95.5, unit: "KWD", owedBy: A, owedTo: B },
    ]);
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [row] = await handle.db.select().from(commitments);
    expect(row!.settlement).toBeNull();
    await expect(
      txn.bindPaymentObligation({ obligationId: row!.id, actorId: A }),
    ).rejects.toThrow(/no money/i);
  });

  it("a float or a bad currency is refused at the term", async () => {
    for (const settlement of [
      { amountMinor: "95.5", currency: "KWD" },
      { amountMinor: "0", currency: "KWD" },
      { amountMinor: "9500", currency: "kuwaiti dinar" },
    ]) {
      expect(() =>
        agreement.parseTermSheet([
          { key: "payment", kind: "NUMBER", value: 1, owedBy: A, settlement },
        ]),
      ).toThrow();
    }
  });

  // ── 8. Cancellation and compensation ──────────────────────────────────────

  it("cancelling before anything happened is a cancellation", async () => {
    const { transaction } = await committed();
    const result = await txn.cancelTransaction({
      transactionId: transaction.id,
      actorId: A,
      reason: "تغيّرت الخطة",
    });
    expect(result.transaction.state).toBe("CANCELLED");
    expect(result.compensation).toHaveLength(0);
  });

  it("after something is verified, cancelling becomes compensating", async () => {
    // Do not pretend an irreversible effect vanished.
    const { transaction, obligations } = await committed();
    const attempt = await attemptFor(A);
    await observe({
      ownerId: A,
      attemptId: attempt.id,
      subjectId: "payment-1",
      termKey: "payment",
      state: "COMPLETE",
      channel: "INTERNAL_STATE_READBACK",
    });
    await txn.settleObligation({
      obligationId: obligations.find((row) => row.termKey === "payment")!.id,
      attemptId: attempt.id,
    });
    const result = await txn.cancelTransaction({
      transactionId: transaction.id,
      actorId: A,
      reason: "تعذّر التسليم",
    });
    expect(result.transaction.state).toBe("COMPENSATING");
    expect(result.compensation).toHaveLength(1);
    expect(result.compensation[0]!.termKey).toBe("payment");
    // A compensation is a NEW effect; nothing was deleted.
    const rows = await handle.db.select().from(commitments);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.termKey === "payment")!.verification).toBe("VERIFIED");
  });

  // ── 9. Provenance, privacy, projection ────────────────────────────────────

  it("provenance travels and changes nothing about execution", async () => {
    // The transaction does not care where the opportunity came from. Two
    // identical agreements, one marked internal and one marked as an external
    // marketplace, settle through exactly the same path.
    const internal = await committed();
    expect((internal.transaction.origin as { source: string }).source).toBe("INTERNAL_EXCHANGE");
    await handle.db.execute(sql.raw("TRUNCATE TABLE transactions, commitments CASCADE"));

    const { proposal } = await committedAgreement("unit Y");
    const result = await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    const [external] = await handle.db.select().from(transactions);
    await handle.db
      .update(transactions)
      .set({ origin: { source: "EXTERNAL_DISCOVERY", marketplace: "somewhere-else" } })
      .where(eq(transactions.id, external!.id));

    const obligations = await handle.db.select().from(commitments);
    const attempt = await attemptFor(A);
    for (const [termKey, subjectId, channel] of [
      ["payment", "payment-1", "INTERNAL_STATE_READBACK"],
      ["delivery", "delivery-1", "OWNER_CONFIRMATION"],
    ] as const) {
      await observe({ ownerId: A, attemptId: attempt.id, subjectId, termKey, state: "COMPLETE", channel });
      await txn.settleObligation({
        obligationId: obligations.find((row) => row.termKey === termKey)!.id,
        attemptId: attempt.id,
      });
    }
    const view = await txn.projectTransaction({ transactionId: result.transaction!.id, actorId: A });
    expect(view.state).toBe("SETTLED");
    // Provenance is carried, not consulted.
    expect((view.origin as { source: string }).source).toBe("EXTERNAL_DISCOVERY");
  });

  it("a party sees committed terms and nobody's private bound", async () => {
    const { transaction } = await committed();
    const view = await txn.projectTransaction({ transactionId: transaction.id, actorId: B });
    const serialized = JSON.stringify(view);
    // The envelope's reserve of 10000 steered the acceptance and is not here.
    expect(serialized).not.toContain("10000");
    expect(serialized).not.toContain("reserve");
    expect(serialized).not.toContain("bounds");
    // Built from named fields, so a later column cannot leak by being added.
    expect(Object.keys(view).sort()).toEqual(
      [
        "authority", "createdAt", "obligations", "origin", "outstanding",
        "parties", "payments", "policy", "state", "terms", "transactionId",
        "updatedAt",
      ].sort(),
    );
  });

  it("a stranger sees nothing", async () => {
    const { transaction } = await committed();
    await expect(
      txn.projectTransaction({ transactionId: transaction.id, actorId: "9999" }),
    ).rejects.toThrow(/not a party/i);
    await expect(
      txn.cancelTransaction({ transactionId: transaction.id, actorId: "9999", reason: "x" }),
    ).rejects.toThrow(/not a party/i);
  });

  it("the timeline is durable and resumes from a cursor", async () => {
    const { transaction, obligations } = await committed();
    await txn.claimObligation({
      obligationId: obligations.find((row) => row.termKey === "delivery")!.id,
      actorId: B,
    });
    const all = await txn.transactionTimeline({ transactionId: transaction.id, actorId: A });
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.map((entry) => entry.type)).toContain("TRANSACTION_MATERIALIZED");
    const after = await txn.transactionTimeline({
      transactionId: transaction.id,
      actorId: A,
      afterId: all[0]!.id,
    });
    expect(after.every((entry) => entry.id > all[0]!.id)).toBe(true);
  });

  // ── 10. Policy at the transaction boundary ────────────────────────────────

  it("a policy forbidding execution leaves the agreement standing and no transaction", async () => {
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies (id, "scopeId", "policyKey", value, version, "setByPrincipalId")
        VALUES ('pol_${randomUUID()}', '${A}', 'ceiling',
        '{"policySchema":"jasim.policy/1","actions":["transaction.execute"],"effect":"DENY","conditions":[{"field":"settlements.payment","operator":"gt","value":5000}]}'::jsonb,
        1, '${A}')`),
    );
    const { proposal } = await committedAgreement();
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: A }),
    ).rejects.toThrow(/forbids executing/i);
    // AGREEMENT != TRANSACTION, including when only one of them is possible.
    expect(await handle.db.select().from(transactions)).toHaveLength(0);
  });

  it("the policy decision that allowed it is on the record", async () => {
    await handle.db.execute(
      sql.raw(`INSERT INTO scope_policies (id, "scopeId", "policyKey", value, version, "setByPrincipalId")
        VALUES ('pol_${randomUUID()}', '${A}', 'ceiling',
        '{"policySchema":"jasim.policy/1","actions":["transaction.execute"],"effect":"ALLOW"}'::jsonb,
        1, '${A}')`),
    );
    const { transaction } = await committed();
    const decision = transaction.policyDecision as { outcome: string; policies: unknown[] };
    expect(decision.outcome).toBe("ALLOWED");
    expect(decision.policies).toHaveLength(1);
    // Ids, versions and codes — never the rule.
    expect(JSON.stringify(decision)).not.toContain("jasim.policy");
  });

  // ── 11. Authority ─────────────────────────────────────────────────────────

  it("a model cannot state an outcome", async () => {
    for (const key of ["settled", "fulfilled", "verified", "paid", "receipt", "transactionId"]) {
      expect(() =>
        txn.assertNoTransactionAuthorityClaim({ [key]: true }, "inputs"),
      ).toThrow(/establishes from evidence/i);
    }
  });

  // ── 12. The live conversational path ──────────────────────────────────────

  it("«اتفقنا» → agreement → commitment → transaction → obligations, by talking", async () => {
    const { engaged } = await committedAgreement();
    const [proposal] = await handle.db.execute(
      sql.raw(`SELECT id FROM economic_proposals WHERE "engagementId" = '${engaged.id}'`),
    ).then((result) => result.rows as Array<{ id: string }>);

    const conversation = await runtime.createRuntimeConversation({ ownerId: A, title: "txn" });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "اتفاق",
        goal: "تثبيت",
        intent: {
          requiredCapabilities: [],
          missingInputs: [],
          inputs: {},
          risk: "high",
          persistence: "ephemeral",
          effects: "none",
        },
        confidence: 0.9,
        authorityRequest: {
          actType: "agreement.commit",
          params: { proposalId: proposal!.id },
        },
      }),
      provider: "openai",
      model: "stub-for-transaction-turn",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);

    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: A,
      conversationId: conversation.id,
      content: "اتفقنا — ثبّت الاتفاق",
    });
    const output = result.output as Record<string, unknown>;
    expect(output.state).toBe("NEEDS_APPROVAL");
    // Nothing exists yet. Asking is not doing.
    expect(await handle.db.select().from(transactions)).toHaveLength(0);

    const carried = output.authority as { requestId: string; statementDigest: string };
    const approved = await authority.approveAuthorityRequest({
      requestId: carried.requestId,
      principalId: A,
      statementDigest: carried.statementDigest,
    });
    expect(approved.state).toBe("PERFORMED");

    const [transaction] = await handle.db.select().from(transactions);
    expect(transaction).toBeTruthy();
    const obligations = await handle.db.select().from(commitments);
    expect(obligations).toHaveLength(2);

    // One obligation completes through a real observation; the other does not.
    const attempt = await attemptFor(A);
    await observe({
      ownerId: A,
      attemptId: attempt.id,
      subjectId: "payment-1",
      termKey: "payment",
      state: "COMPLETE",
      channel: "INTERNAL_STATE_READBACK",
    });
    await txn.settleObligation({
      obligationId: obligations.find((row) => row.termKey === "payment")!.id,
      attemptId: attempt.id,
    });

    const view = await txn.projectTransaction({
      transactionId: transaction!.id,
      actorId: A,
    });
    // What was agreed, what is committed, what is paid, what remains.
    expect(view.state).toBe("OPEN");
    expect(view.outstanding).toBe(1);
    const shown = view.obligations as Array<{ termKey: string; verification: string; state: string }>;
    expect(shown.find((row) => row.termKey === "payment")!.verification).toBe("VERIFIED");
    expect(shown.find((row) => row.termKey === "delivery")!.verification).toBe("PENDING");
  });

  // ── 13. Holdouts: one runtime, seven unrelated exchanges ──────────────────

  /**
   * No line of the transaction runtime was written with any of these in mind.
   * Each is two obligations pointing opposite ways, which is all an exchange
   * ever is.
   */
  const HOLDOUTS = [
    ["goods", "units", 100],
    ["laboratory instrument time", "instrumentHours", 6],
    ["temporary generator capacity", "kilowatts", 40],
    ["warehouse pallet capacity", "palletDays", 24],
    ["human translation service", "sessionHours", 3],
    ["machine fabrication time", "runMinutes", 180],
    ["falconry stand reservation", "standsReserved", 4],
  ] as const;

  it.each(HOLDOUTS)("%s settles through the same one runtime", async (label, key, value) => {
    const { proposal } = await committedAgreement(`holdout:${key}`, [
      {
        key: "payment",
        kind: "NUMBER",
        value: 9500,
        owedBy: A,
        owedTo: B,
        evidence: "INTERNAL_STATE",
        subjectKind: "obligation",
        subjectId: `pay-${key}`,
        settlement: { amountMinor: "9500", currency: "KWD" },
      },
      {
        key,
        kind: "NUMBER",
        value,
        owedBy: B,
        owedTo: A,
        evidence: "REMOTE_MUTATION",
        subjectKind: "obligation",
        subjectId: `deliver-${key}`,
      },
    ]);
    const result = await agreement.commitAgreement({ proposalId: proposal.id, ownerId: A });
    expect(result.transaction, label).toBeTruthy();

    const obligations = await handle.db
      .select()
      .from(commitments)
      .where(eq(commitments.transactionId, result.transaction!.id));
    expect(obligations, label).toHaveLength(2);

    const attempt = await attemptFor(A);
    for (const [termKey, subjectId, channel] of [
      ["payment", `pay-${key}`, "INTERNAL_STATE_READBACK"],
      [key, `deliver-${key}`, "AUTHENTICATED_TELEMETRY"],
    ] as const) {
      await observe({
        ownerId: A,
        attemptId: attempt.id,
        subjectId,
        termKey,
        state: "COMPLETE",
        channel,
      });
      await txn.settleObligation({
        obligationId: obligations.find((row) => row.termKey === termKey)!.id,
        attemptId: attempt.id,
      });
    }
    const view = await txn.projectTransaction({
      transactionId: result.transaction!.id,
      actorId: A,
    });
    expect(view.state, label).toBe("SETTLED");

    await handle.db.execute(sql.raw("TRUNCATE TABLE transactions, commitments CASCADE"));
  });
});
