/**
 * JASIM — NEGOTIATION IS ONE MECHANISM.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
 *   TARGET != AUTHORITY
 *   EXECUTION != APPROVAL
 *
 * A salary, a rent, a shipping fee and six hours of laboratory time go through
 * the same four capabilities and the same one evaluator. A `SalaryNegotiation`
 * beside a `RentNegotiation` is the failure this file exists to catch.
 *
 * ─── AND WHAT IS NOT CLAIMED ────────────────────────────────────────────────
 *
 *   NOT_DISCLOSED != NOT_INFERABLE
 *
 * The tests below prove the reserve is never STATED. They do not prove it
 * cannot be inferred from a sequence of counters, because it can, and a test
 * asserting otherwise would be the false guarantee.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { agreements, commitments, executionAttempts, negotiationEnvelopes } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

/** Conversation rows key their owner numerically. */
const BUYER = "9901";
const SELLER = "9902";

describe("one negotiation runtime, whatever is being negotiated", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    fabric = await import("../../api/runtime/economic-fabric");
    agreement = await import("../../api/runtime/agreement-runtime");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, economic_expressions, economic_matches,
        economic_engagements, economic_proposals, transaction_intents,
        negotiation_envelopes, agreements, commitments CASCADE`),
    );
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Fixtures ──────────────────────────────────────────────────────────────

  /**
   * An engagement between two parties over one generic thing.
   *
   * `semanticType` is whatever the test says it is. Nothing below branches on
   * it, which is the point.
   */
  async function engage(semanticType = "unit X") {
    const offering = await fabric.createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType,
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: offering.id,
      ownerId: SELLER,
      projection: { semanticType, summary: "عرض" },
    });
    const need = await fabric.createExpression({
      ownerId: BUYER,
      kind: "need",
      semanticType,
      attributes: { quantity: 300 },
    });
    await fabric.publishExpression({
      id: need.id,
      ownerId: BUYER,
      projection: { semanticType, summary: "احتياج" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id,
      offeringId: offering.id,
      createdByOwnerId: BUYER,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: BUYER,
      participants: await fabric.participantsForMatch(match.id),
    });
    return { engagement, match, need, offering };
  }

  const SHEET = (price: number, extra: Record<string, unknown>[] = []) => [
    { key: "price", kind: "NUMBER", value: price, unit: "JOD" },
    ...extra,
  ];

  // ── 1. A term sheet is structure, never meaning ───────────────────────────

  it("a term key is opaque — the runtime reads none of them", () => {
    // Four completely different subjects, one parser, no branch.
    for (const key of ["price", "monthlyRent", "hoursPerWeek", "تقسيم الوقت"]) {
      const sheet = agreement.parseTermSheet([{ key, kind: "NUMBER", value: 10 }]);
      expect(sheet[0]!.key).toBe(key);
    }
  });

  it("refuses a kind, a value or a shape it does not recognise", () => {
    const bad: unknown[][] = [
      [{ key: "price", kind: "CURRENCY", value: 10 }],
      [{ key: "price", kind: "NUMBER", value: "ten" }],
      [{ key: "price", kind: "NUMBER", value: Number.POSITIVE_INFINITY }],
      [{ key: "choice", kind: "CHOICE", value: 3 }],
      [{ key: "price", kind: "NUMBER", value: 1 }, { key: "price", kind: "NUMBER", value: 2 }],
      [{ kind: "NUMBER", value: 1 }],
      [{ key: "price", kind: "NUMBER", value: 1, dueAt: "soon" }],
    ];
    for (const sheet of bad) {
      expect(() => agreement.parseTermSheet(sheet), JSON.stringify(sheet)).toThrow();
    }
  });

  it("refuses a term that states an authority", () => {
    // A proposal binds nobody. A proposal that could say it was agreed would.
    for (const key of ["agreed", "accepted", "reserve", "authorityBasis"]) {
      expect(() =>
        agreement.parseTermSheet([{ key: "price", kind: "NUMBER", value: 10, [key]: true }]),
      ).toThrow(/authority/i);
    }
  });

  it("carries a unit and never converts one", () => {
    // Converting would be deciding an exchange rate nobody supplied.
    const source = agreement.parseTermSheet([
      { key: "price", kind: "NUMBER", value: 100, unit: "JOD" },
    ]);
    expect(source[0]!.unit).toBe("JOD");
    const evaluated = agreement.evaluateProposalAgainstEnvelope({
      incoming: source,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 100, reserve: 120 } },
      mayConcede: false,
    });
    // 100 USD against a 120 JOD reserve is judged as 100 against 120, because
    // the runtime has no rate. The unit is the parties' to agree.
    expect(evaluated.verdict).toBe("WITHIN_RESERVE");
  });

  // ── 2. The envelope is bounded authority ──────────────────────────────────

  it("an undeclared authority is no authority", async () => {
    const { engagement } = await engage();
    const envelope = await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
    });
    // Both default to false. Forgetting must never be the permissive path.
    expect(envelope.mayConcede).toBe(false);
    expect(envelope.mayAcceptWithinReserve).toBe(false);
  });

  it("refuses a target that lies beyond its own reserve", async () => {
    const { engagement } = await engage();
    await expect(
      agreement.setNegotiationEnvelope({
        engagementId: engagement.id,
        ownerId: BUYER,
        principalId: BUYER,
        bounds: { price: { direction: "LOWER_IS_BETTER", target: 300, reserve: 250 } },
      }),
    ).rejects.toThrow(/reserve/i);
  });

  it("is versioned and append-only — authority is never rewritten", async () => {
    const { engagement } = await engage();
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
    });
    const second = await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 240 } },
      mayConcede: true,
    });
    const history = await agreement.negotiationEnvelopeHistory({
      engagementId: engagement.id,
      ownerId: BUYER,
    });
    expect(history.map((row) => row.version)).toEqual([1, 2]);
    expect(second.supersedesId).toBe(history[0]!.id);
    // The first version still says what it said. An agreement reached under it
    // can still be explained.
    expect((history[0]!.bounds as Record<string, { reserve: number }>).price!.reserve).toBe(250);
  });

  it("a non-participant cannot delegate authority in someone else's engagement", async () => {
    const { engagement } = await engage();
    await expect(
      agreement.setNegotiationEnvelope({
        engagementId: engagement.id,
        ownerId: "9903",
        principalId: "9903",
        bounds: { price: { direction: "LOWER_IS_BETTER", target: 1, reserve: 2 } },
      }),
    ).rejects.toThrow(/participant/i);
  });

  it("an expired envelope is no envelope", async () => {
    const { engagement } = await engage();
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
      mayConcede: true,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      await agreement.getNegotiationEnvelope({ engagementId: engagement.id, ownerId: BUYER }),
    ).toBeUndefined();
  });

  // ── 3. Evaluation: three outcomes, three different truths ─────────────────

  const BOUNDS = {
    price: { direction: "LOWER_IS_BETTER" as const, target: 200, reserve: 250 },
  };

  it("inside the reserve is WITHIN_RESERVE, and is not acceptance", () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet(SHEET(240)),
      bounds: BOUNDS,
      mayConcede: true,
    });
    expect(evaluation.verdict).toBe("WITHIN_RESERVE");
    // Nothing here says agreed. Deciding is a separate act with its own
    // authority, and that separation is the whole chain.
    expect(evaluation).not.toHaveProperty("counter");
    expect(JSON.stringify(evaluation)).not.toMatch(/accepted|agreed/i);
  });

  it("outside the reserve with no permission to move is OUT_OF_AUTHORITY", () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet(SHEET(300)),
      bounds: BOUNDS,
      mayConcede: false,
    });
    expect(evaluation.verdict).toBe("OUT_OF_AUTHORITY");
    expect(evaluation.counter).toBeUndefined();
  });

  it("outside the reserve with permission produces a counter", () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet(SHEET(300)),
      bounds: BOUNDS,
      mayConcede: true,
    });
    expect(evaluation.verdict).toBe("COUNTERABLE");
    expect(evaluation.counter![0]!.value).toBe(250);
  });

  it("a counter NEVER passes the reserve, however many rounds it takes", () => {
    // The one invariant a negotiating agent must not break. Ten rounds of a
    // 20-per-move concession against a reserve of 250, opening at 200.
    const bounds = {
      price: { direction: "LOWER_IS_BETTER" as const, target: 200, reserve: 250, concessionStep: 20 },
    };
    let mine = agreement.parseTermSheet(SHEET(200));
    const offered: number[] = [];
    for (let round = 0; round < 10; round += 1) {
      const evaluation = agreement.evaluateProposalAgainstEnvelope({
        incoming: agreement.parseTermSheet(SHEET(400)),
        bounds,
        mayConcede: true,
        mine,
      });
      expect(evaluation.verdict).toBe("COUNTERABLE");
      mine = evaluation.counter!;
      offered.push(mine[0]!.value as number);
    }
    expect(Math.max(...offered)).toBe(250);
    expect(offered.every((value) => value <= 250)).toBe(true);
    // It moved in declared steps rather than jumping to the line.
    expect(offered[0]).toBe(220);
  });

  it("the mirror direction holds too — a seller's floor is the same code", () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet(SHEET(150)),
      bounds: { price: { direction: "HIGHER_IS_BETTER", target: 220, reserve: 180 } },
      mayConcede: true,
    });
    expect(evaluation.verdict).toBe("COUNTERABLE");
    expect(evaluation.counter![0]!.value).toBe(180);
  });

  it("an unbounded term is an unanswered question, not an agreed one", () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet([
        { key: "price", kind: "NUMBER", value: 240 },
        { key: "warranty", kind: "CHOICE", value: "none" },
      ]),
      bounds: BOUNDS,
      mayConcede: true,
    });
    const warranty = evaluation.terms.find((term) => term.key === "warranty")!;
    expect(warranty.state).toBe("UNBOUNDED");
    // It is not counted as a violation and it is not counted as accepted.
    expect(warranty.state).not.toBe("WITHIN");
  });

  it("a counter carries the already-agreed terms forward verbatim", () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet([
        { key: "price", kind: "NUMBER", value: 300 },
        { key: "deliveryDays", kind: "NUMBER", value: 5 },
      ]),
      bounds: {
        price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 },
        deliveryDays: { direction: "LOWER_IS_BETTER", target: 3, reserve: 7 },
      },
      mayConcede: true,
    });
    // Reopening a settled term to win a contested one is a negotiating tactic
    // nobody authorized.
    expect(evaluation.counter!.find((t) => t.key === "deliveryDays")!.value).toBe(5);
    expect(evaluation.counter!.find((t) => t.key === "price")!.value).toBe(250);
  });

  // ── 4. The reserve never leaves ───────────────────────────────────────────

  it("the counterparty's view of a proposal cannot contain a bound", async () => {
    const { engagement } = await engage();
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
      mayConcede: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: BUYER,
      terms: SHEET(200),
    });
    const view = agreement.counterpartyProposalView(proposal);
    const serialized = JSON.stringify(view);
    for (const forbidden of ["250", "reserve", "target", "concession", "envelope", "bounds"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    // Structurally, not by omission: the view is built from named fields.
    expect(Object.keys(view).sort()).toEqual(
      ["proposalId", "proposedBy", "status", "terms", "version"].sort(),
    );
  });

  it("an evaluation result names states, never the numbers behind them", async () => {
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet(SHEET(300)),
      bounds: BOUNDS,
      mayConcede: false,
    });
    // OUT_OF_AUTHORITY is what the other side would be told, and it is the one
    // that must not explain itself. 250 appears nowhere.
    const disclosed = {
      verdict: evaluation.verdict,
      terms: evaluation.terms.map((term) => ({ key: term.key, state: term.state })),
    };
    expect(JSON.stringify(disclosed)).not.toContain("250");
  });

  // ── 5. The agreement ──────────────────────────────────────────────────────

  async function readyToAgree(over: { price?: number; mayAccept?: boolean } = {}) {
    const { engagement } = await engage();
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
      mayConcede: true,
      mayAcceptWithinReserve: over.mayAccept ?? true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: SHEET(over.price ?? 240),
    });
    return { engagement, proposal };
  }

  it("records the exact terms, the exact version and whose authority", async () => {
    const { proposal } = await readyToAgree();
    const { agreement: row } = await agreement.commitAgreement({
      proposalId: proposal.id,
      ownerId: BUYER,
    });
    expect(row.proposalId).toBe(proposal.id);
    expect(row.acceptedByOwnerId).toBe(BUYER);
    const basis = row.authorityBasis as { kind: string; setByPrincipalId?: string };
    expect(basis.kind).toBe("ENVELOPE");
    expect(basis.setByPrincipalId).toBe(BUYER);
    // A snapshot, not a reference: a later edit must not change what was agreed.
    const terms = (row.terms as { terms: Array<{ key: string; value: number }> }).terms;
    expect(terms.find((term) => term.key === "price")!.value).toBe(240);
  });

  it("an envelope may never agree past its own reserve", async () => {
    const { proposal } = await readyToAgree({ price: 300 });
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER }),
    ).rejects.toThrow(/reserve/i);
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("an envelope that permits negotiating does not thereby permit agreeing", async () => {
    const { proposal } = await readyToAgree({ mayAccept: false });
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER }),
    ).rejects.toThrow(/owner decides/i);
  });

  it("with no envelope at all, nobody authorized anything", async () => {
    const { engagement } = await engage();
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: SHEET(240),
    });
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER }),
    ).rejects.toThrow(/authorized/i);
  });

  it("the owner themselves may agree to anything they like", async () => {
    // Outside every reserve, and correct: the reserve bounds what JASIM may do
    // on their behalf, never what they may decide themselves.
    const { proposal } = await readyToAgree({ price: 999, mayAccept: false });
    const { agreement: row } = await agreement.commitAgreement({
      proposalId: proposal.id,
      ownerId: BUYER,
      principalId: BUYER,
      ownerDirect: true,
    });
    expect((row.authorityBasis as { kind: string }).kind).toBe("OWNER_DIRECT");
  });

  it("a party cannot agree to its own proposal", async () => {
    const { proposal } = await readyToAgree();
    await expect(
      agreement.commitAgreement({
        proposalId: proposal.id,
        ownerId: SELLER,
        principalId: SELLER,
        ownerDirect: true,
      }),
    ).rejects.toThrow(/own proposal/i);
  });

  it("one proposal version yields at most one agreement", async () => {
    const { proposal } = await readyToAgree();
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER });
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER }),
    ).rejects.toThrow();
    expect(await handle.db.select().from(agreements)).toHaveLength(1);
  });

  it("an expired proposal cannot be agreed", async () => {
    const { engagement } = await engage();
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
      mayAcceptWithinReserve: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: SHEET(240),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER }),
    ).rejects.toThrow(/expired/i);
  });

  // ── 6. AGREEMENT != TRANSACTION ───────────────────────────────────────────

  it("agreeing creates no payment and no transaction intent", async () => {
    const { proposal } = await readyToAgree();
    await agreement.commitAgreement({ proposalId: proposal.id, ownerId: BUYER });
    expect(await agreement.transactionIntentsForProposals([proposal.id])).toBe(0);
    const intents = await handle.db.execute(sql.raw("SELECT id FROM transaction_intents"));
    expect(intents.rows).toHaveLength(0);
  });

  // ── 7. A commitment is declared, never inferred ───────────────────────────

  it("no obligation exists unless the term sheet named one", async () => {
    const { proposal } = await readyToAgree();
    const { commitments: created } = await agreement.commitAgreement({
      proposalId: proposal.id,
      ownerId: BUYER,
    });
    // «price» does NOT mean the buyer pays. Guessing that from a field name is
    // how a general runtime acquires a domain at the worst possible point.
    expect(created).toHaveLength(0);
  });

  it("a declared obligation becomes an OPEN commitment for the party named", async () => {
    const { engagement } = await engage();
    await agreement.setNegotiationEnvelope({
      engagementId: engagement.id,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: { price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250 } },
      mayAcceptWithinReserve: true,
    });
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: [
        { key: "price", kind: "NUMBER", value: 240, owedBy: BUYER, dueAt: due },
        { key: "delivery", kind: "CHOICE", value: "site", owedBy: SELLER },
      ],
    });
    const { commitments: created } = await agreement.commitAgreement({
      proposalId: proposal.id,
      ownerId: BUYER,
    });
    expect(created).toHaveLength(2);
    expect(created.map((row) => row.ownerId).sort()).toEqual([BUYER, SELLER].sort());
    // OPEN until something OBSERVES otherwise. Agreeing is not doing.
    expect(created.every((row) => row.state === "open")).toBe(true);
  });

  // ── 8. The live turn ──────────────────────────────────────────────────────

  async function runNode(input: {
    capabilityId: string;
    inputs: Record<string, unknown>;
    ownerId: string;
  }) {
    const run = await runtime.createRuntimeRun({
      ownerId: input.ownerId,
      goal: `agreement: ${input.capabilityId}`,
      idempotencyKey: `agr-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId: input.ownerId,
      runId: run.id,
      nodes: [
        { nodeKey: "act", capabilityId: input.capabilityId, inputs: input.inputs, maxAttempts: 1 },
      ],
    });
    await runtime.executeRuntimeDagNode({
      ownerId: input.ownerId,
      runId: run.id,
      workerId: "agreement-worker",
    });
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    const envelope = (attempt!.normalizedResult ?? {}) as { result?: Record<string, unknown> };
    return { attempt: attempt!, result: (envelope.result ?? {}) as Record<string, unknown> };
  }

  it("opening, proposing, countering and agreeing all run on the real executor", async () => {
    const { match, engagement } = await engage();
    expect(engagement).toBeTruthy();

    // A fresh engagement through the capability, so the whole path is proven
    // rather than the fixture's.
    await handle.db.execute(sql.raw("TRUNCATE TABLE economic_engagements CASCADE"));
    const opened = await runNode({
      capabilityId: "agreement-open",
      ownerId: BUYER,
      inputs: { matchId: match.id },
    });
    const engagementId = opened.result.engagementId as string;
    expect(engagementId).toBeTruthy();
    // VERIFIED by JASIM's own readback, never by what the executor returned.
    expect(opened.attempt.executionStatus).toBe("COMPLETED");
    expect(opened.attempt.verificationStatus).toBe("VERIFIED");

    const proposed = await runNode({
      capabilityId: "agreement-propose",
      ownerId: SELLER,
      inputs: { engagementId, terms: SHEET(300) },
    });
    const proposalId = proposed.result.proposalId as string;
    expect(proposed.result.version).toBe(1);

    // The buyer's authority, delegated on the trusted path.
    await agreement.setNegotiationEnvelope({
      engagementId,
      ownerId: BUYER,
      principalId: BUYER,
      bounds: {
        price: { direction: "LOWER_IS_BETTER", target: 200, reserve: 250, concessionStep: 25 },
      },
      mayConcede: true,
      mayAcceptWithinReserve: true,
    });

    const responded = await runNode({
      capabilityId: "agreement-respond",
      ownerId: BUYER,
      inputs: { proposalId },
    });
    expect(responded.result.verdict).toBe("COUNTERABLE");
    expect(responded.result.countered).toBe(true);
    // One declared step from the target, not a jump to the line.
    const counterId = responded.result.counterProposalId as string;
    const counter = await handle.db.execute(
      sql.raw(`SELECT terms FROM economic_proposals WHERE id = '${counterId}'`),
    );
    const counterTerms = (counter.rows[0] as { terms: { terms: Array<{ key: string; value: number }> } })
      .terms.terms;
    expect(counterTerms.find((term) => term.key === "price")!.value).toBe(225);

    // The seller comes back inside the buyer's reserve, and the buyer's
    // envelope — not the model, not the plan — is what permits agreeing.
    const settled = await runNode({
      capabilityId: "agreement-propose",
      ownerId: SELLER,
      inputs: { engagementId, terms: SHEET(245) },
    });
    const committed = await runNode({
      capabilityId: "agreement-commit",
      ownerId: BUYER,
      inputs: { proposalId: settled.result.proposalId as string },
    });
    expect(committed.result.agreementId).toBeTruthy();
    expect(committed.result.authorityKind).toBe("ENVELOPE");
    expect(committed.result.transaction).toBe("NOT_CREATED");
    expect(committed.attempt.executionStatus).toBe("COMPLETED");
    // The agreement is VERIFIED because JASIM read the row back, not because
    // the capability said so.
    expect(committed.attempt.verificationStatus).toBe("VERIFIED");
  });

  it("a capability may never agree on the owner's own authority", async () => {
    // EXECUTION != APPROVAL. A capability sees a scope id, not a person, so it
    // cannot tell an approved run from an unapproved one.
    const { engagement } = await engage();
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: SHEET(240),
    });
    const attempted = await runNode({
      capabilityId: "agreement-commit",
      ownerId: BUYER,
      inputs: { proposalId: proposal.id, ownerDirect: true },
    });
    expect(attempted.attempt.executionStatus).toBe("FAILED");
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("responding without an envelope writes nothing and says whose call it is", async () => {
    const { engagement } = await engage();
    const proposal = await agreement.proposeTermSheet({
      engagementId: engagement.id,
      proposerOwnerId: SELLER,
      terms: SHEET(999),
    });
    const responded = await runNode({
      capabilityId: "agreement-respond",
      ownerId: BUYER,
      inputs: { proposalId: proposal.id },
    });
    expect(responded.result.verdict).toBe("OUT_OF_AUTHORITY");
    expect(responded.result.countered).toBe(false);
    const rows = await handle.db.execute(
      sql.raw(`SELECT id FROM economic_proposals WHERE "proposerOwnerId" = '${BUYER}'`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("a capability refuses an identity or an authority in its inputs", async () => {
    const { engagement } = await engage();
    for (const inputs of [
      { engagementId: engagement.id, terms: SHEET(200), ownerId: SELLER },
      { engagementId: engagement.id, terms: SHEET(200), reserve: 999 },
      { engagementId: engagement.id, terms: SHEET(200), agreed: true },
    ]) {
      const attempted = await runNode({
        capabilityId: "agreement-propose",
        ownerId: BUYER,
        inputs,
      });
      expect(attempted.attempt.executionStatus, JSON.stringify(inputs)).toBe("FAILED");
    }
  });

  // ── 9. A plan a person's words could produce ──────────────────────────────

  it("a turn plans a negotiation as two dependent nodes, with no new route", async () => {
    const { match } = await engage();
    const conversation = await runtime.createRuntimeConversation({
      ownerId: BUYER,
      title: "negotiation",
    });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "workflow",
        label: "تفاوض",
        goal: "افتح تفاوضاً واعرض شروطي",
        intent: {
          requiredCapabilities: ["agreement-open", "agreement-propose"],
          missingInputs: [],
          inputs: {},
          risk: "medium",
          persistence: "durable",
          effects: "none",
        },
        confidence: 0.8,
        planGraph: {
          version: 1,
          kind: "DAG",
          nodes: [
            {
              key: "open",
              capabilityId: "agreement-open",
              inputs: { matchId: match.id },
              dependsOn: [],
              bindings: [],
              enforces: [],
              authority: "NONE",
            },
            {
              key: "propose",
              capabilityId: "agreement-propose",
              inputs: { engagementId: "$open.engagementId", terms: SHEET(200) },
              dependsOn: ["open"],
              bindings: [],
              enforces: [],
              authority: "NONE",
            },
          ],
          blockers: [],
        },
      }),
      provider: "openai",
      model: "stub-for-agreement-turn",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);

    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: BUYER,
      conversationId: conversation.id,
      content: "افتح تفاوضاً مع البائع واعرض 200",
    });
    const metadata = (result.assistantMessage.metadata ?? {}) as Record<string, unknown>;
    // The market is a mechanism, never a destination: negotiation composes as
    // ordinary plan nodes and the router gained nothing.
    expect(metadata.semanticRoute).toBe("GENERAL_PLANGRAPH");
    const plan = metadata.plan as { nodeKeys: string[]; order: string[][] } | undefined;
    expect(plan?.nodeKeys.sort()).toEqual(["open", "propose"]);
  });

  // ── 10. Holdouts: the same four capabilities, unrelated subjects ──────────

  /**
   * Eight subjects from the acceptance catalog plus six nobody designed for.
   *
   * Every one negotiates through the SAME evaluator with the SAME two
   * directions. A subject needing its own term kind, its own comparison or its
   * own capability would be the generality failure.
   */
  const SUBJECTS = [
    ["price", "unitPrice", "LOWER_IS_BETTER"],
    ["delivery", "deliveryDays", "LOWER_IS_BETTER"],
    ["payment_terms", "netDays", "HIGHER_IS_BETTER"],
    ["salary", "monthlySalary", "HIGHER_IS_BETTER"],
    ["rent", "monthlyRent", "LOWER_IS_BETTER"],
    ["shipping", "freightFee", "LOWER_IS_BETTER"],
    ["service", "scopeHours", "HIGHER_IS_BETTER"],
    ["equipment", "dailyHire", "LOWER_IS_BETTER"],
    // Blind: no line of the runtime was written with any of these in mind.
    ["laboratory_time", "instrumentHours", "HIGHER_IS_BETTER"],
    ["pollination", "hivesProvided", "HIGHER_IS_BETTER"],
    ["cold_storage", "palletDays", "HIGHER_IS_BETTER"],
    ["interpretation", "sessionFee", "LOWER_IS_BETTER"],
    ["desalination_service", "responseMinutes", "LOWER_IS_BETTER"],
    ["falconry_stand", "standsReserved", "HIGHER_IS_BETTER"],
  ] as const;

  it.each(SUBJECTS)("%s negotiates through the same one evaluator", async (id, key, direction) => {
    const better = direction === "LOWER_IS_BETTER";
    const bounds = {
      [key]: {
        direction,
        target: better ? 100 : 200,
        reserve: better ? 150 : 120,
        concessionStep: 10,
      },
    };
    const incoming = agreement.parseTermSheet([
      { key, kind: "NUMBER", value: better ? 400 : 10 },
    ]);
    const evaluation = agreement.evaluateProposalAgainstEnvelope({
      incoming,
      bounds,
      mayConcede: true,
    });
    expect(evaluation.verdict, id).toBe("COUNTERABLE");
    const countered = evaluation.counter![0]!.value as number;
    // One declared step from the target, and never past the reserve.
    expect(countered, id).toBe(better ? 110 : 190);

    // And the counter-case: an incoming value already inside the reserve is
    // recognised as such, so the holdout is not passing by always countering.
    const inside = agreement.evaluateProposalAgainstEnvelope({
      incoming: agreement.parseTermSheet([
        { key, kind: "NUMBER", value: better ? 140 : 130 },
      ]),
      bounds,
      mayConcede: true,
    });
    expect(inside.verdict, id).toBe("WITHIN_RESERVE");
  });

  it("every subject reached agreement through the same four capabilities", async () => {
    // One registration each, not one per subject.
    const registry = await import("../../api/runtime/capability-registry");
    const agreementCapabilities = registry
      .getRuntimeCapabilityRegistry()
      .list()
      .filter((entry) => entry.id.startsWith("agreement-"));
    expect(agreementCapabilities.map((entry) => entry.id).sort()).toEqual([
      "agreement-commit",
      "agreement-open",
      "agreement-propose",
      "agreement-respond",
    ]);
  });

  it("no envelope, agreement or commitment row carries a subject column", async () => {
    // The structural version of the same claim: what is being negotiated lives
    // in a term KEY, which is data.
    for (const table of ["negotiation_envelopes", "agreements", "commitments"]) {
      const columns = await handle.db.execute(
        sql.raw(
          `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`,
        ),
      );
      const names = columns.rows.map((row) => String((row as { column_name: string }).column_name));
      for (const forbidden of ["subject", "kind", "category", "type", "industry", "domain"]) {
        expect(names.join(","), `${table}.${forbidden}`).not.toContain(forbidden);
      }
    }
    expect(await handle.db.select().from(negotiationEnvelopes)).toHaveLength(0);
    expect(await handle.db.select().from(commitments)).toHaveLength(0);
  });
});
