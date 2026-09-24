/**
 * JASIM — WHAT CAME OF WHAT YOU WANTED?
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   PROVENANCE != AUTHORITY · != VERIFICATION · != COMPLETION
 *   TRANSACTION_CREATED != NEED_SATISFIED
 *   PAYMENT_VERIFIED    != NEED_SATISFIED
 *   FULFILLMENT_CLAIMED != NEED_SATISFIED
 *   NO_PROVENANCE → NO_AUTOMATIC_NEED_RESOLUTION
 *
 * The chain is WALKED, never guessed: every step is a stored id on a canonical
 * immutable row. Nothing here consults a transcript, a semantic type, an
 * amount, a timestamp, or «the most recent need».
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { executionAttempts, users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let provenance: typeof import("../../api/runtime/need-provenance");
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let txn: typeof import("../../api/runtime/transaction-runtime");
let bridge: typeof import("../../api/runtime/effect-observation-bridge");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

const HOLDOUTS = [
  "prepared.item", "used.vehicle", "professional.hour",
  "machine.time", "storage.capacity", "venue.slot",
  // Unfamiliar: appears nowhere else in this repository.
  "seabed.survey_line",
] as const;

describe("what the user wanted, and what actually came of it", () => {
  let buyer: typeof users.$inferSelect;
  let conversationId: string;
  let sellerScope: string;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    provenance = await import("../../api/runtime/need-provenance");
    fabric = await import("../../api/runtime/economic-fabric");
    agreement = await import("../../api/runtime/agreement-runtime");
    txn = await import("../../api/runtime/transaction-runtime");
    bridge = await import("../../api/runtime/effect-observation-bridge");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE conversation_needs, living_objects, events, observations,
        discovery_result_sets, discovery_candidates, economic_expressions,
        economic_matches, economic_engagements, economic_proposals,
        negotiation_envelopes, agreements, commitments, transactions,
        payment_intents, commercial_orders, reference_bindings,
        organizations, memberships, scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'prov-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `prov-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    buyer = row!;
    sellerScope = `seller-${randomUUID().slice(0, 8)}`;
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(buyer.id), title: "prov",
    });
    conversationId = conversation.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const me = () => String(buyer.id);

  async function turn(content: string, envelope: Record<string, unknown>) {
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({ version: 1, decisionId: randomUUID(), ...envelope }),
      provider: "openai", model: "stub-for-provenance",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(), conversationId, content,
    });
    return result.output as Record<string, unknown>;
  }

  const base = (over: Record<string, unknown> = {}) => ({
    kind: "direct_action", label: "قول", goal: "هدف",
    intent: {
      requiredCapabilities: [], missingInputs: [], inputs: {},
      risk: "low" as const, persistence: "durable" as const, effects: "none" as const,
    },
    confidence: 0.9, ...over,
  });

  const act = (capabilities: string[], inputs: Record<string, unknown> = {}) =>
    base({
      intent: {
        requiredCapabilities: capabilities, missingInputs: [], inputs,
        risk: "low" as const, persistence: "durable" as const, effects: "none" as const,
      },
    });

  async function offering(semanticType: string, label: string, priceMinor: string) {
    const expression = await fabric.createExpression({
      ownerId: sellerScope, kind: "offering", semanticType, attributes: { priceMinor },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId: sellerScope,
      projection: {
        semanticType, summary: label,
        publicTerms: { label, money: { amountMinor: priceMinor, currency: "KWD" } },
      },
    });
    return expression;
  }

  /** Turns 1–7 of the journey, through the real boundary. */
  async function journey(semanticType = "prepared.item") {
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    await turn("شاورما", { ...base(), need: { intent: "REFINE", addPreferences: ["QUALITY"] } });
    await turn("أقل من 3", {
      ...base(),
      need: {
        intent: "REFINE",
        addConstraints: [{
          dimension: "COST", operator: "AT_MOST", value: 3000, unit: "minor",
          hardness: "HARD", source: "STATED",
        }],
      },
    });
    await offering(semanticType, "alpha", "1500");
    await offering(semanticType, "beta", "2000");
    await turn("ابحث", act(["discovery"], { kind: "NEED", semanticType }));
    await turn("الثانية", act(["commerce:select"], { position: 2 }));
    const sent = await turn("اطلبها", act(["commerce:propose"]));
    return sent.data as { proposalId: string; engagementId: string };
  }

  async function counterpartyAccepts(engagementId: string, proposalId: string) {
    await agreement.setNegotiationEnvelope({
      engagementId, ownerId: sellerScope, principalId: sellerScope,
      bounds: { settlement: { direction: "HIGHER_IS_BETTER", target: 1000, reserve: 500 } },
      mayConcede: true, mayAcceptWithinReserve: true,
    });
    return agreement.commitAgreement({
      proposalId, ownerId: sellerScope, principalId: sellerScope,
    });
  }

  async function theNeed() {
    const rows = await handle.db.execute(
      sql.raw(`SELECT id, revision, state FROM conversation_needs
        WHERE "conversationId" = '${conversationId}' ORDER BY "createdAt"`),
    );
    return rows.rows as { id: string; revision: number; state: string }[];
  }

  /** A real execution attempt, as the fulfillment runtime requires. */
  async function attemptFor(ownerId: string) {
    const run = await runtime.createRuntimeRun({
      ownerId, goal: "fulfillment", idempotencyKey: `prov-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId, runId: run.id,
      nodes: [{
        nodeKey: "act", capabilityId: "opportunity-discover",
        inputs: { kind: "OFFERING" }, maxAttempts: 1,
      }],
    });
    await runtime.executeRuntimeDagNode({ ownerId, runId: run.id, workerId: "prov-worker" });
    const [attempt] = await handle.db
      .select().from(executionAttempts).where(eq(executionAttempts.runId, run.id));
    return attempt!;
  }

  /**
   * Verify every obligation through the REAL evidence path.
   *
   * The evidence is scoped to the TRANSACTION's scope — here the counterparty,
   * because they are the party who concluded the agreement. Submitting it as
   * the buyer would be the buyer verifying their own delivery.
   */
  async function verifyEverything(transactionId: string) {
    const obligations = await txn.obligationsOf(transactionId);
    const [row] = await handle.db.execute(
      sql.raw(`SELECT "scopeId" FROM transactions WHERE id = '${transactionId}'`),
    ).then((result) => result.rows as { scopeId: string }[]);
    const evidenceScope = row!.scopeId;
    for (const obligation of obligations) {
      const attempt = await attemptFor(evidenceScope);
      await bridge.submitEffectSignal(handle.db, {
        ownerId: evidenceScope, attemptId: attempt.id,
        // Not the party's own report: an owner's confirmation and an internal
        // read-back are the two the policies accept.
        channel: obligation.termKey === "settlement"
          ? "INTERNAL_STATE_READBACK"
          : "OWNER_CONFIRMATION",
        subjectKind: "obligation",
        subjectId: obligation.subjectId ?? obligation.termKey,
        observationType: "fulfillment",
        payload: { termKey: obligation.termKey, state: "COMPLETE" },
        observedAt: new Date(),
        freshnessExpiresAt: new Date(Date.now() + 600_000),
      });
      await txn.settleObligation({ obligationId: obligation.id, attemptId: attempt.id });
    }
    return txn.obligationsOf(transactionId);
  }

  // ── A · THE CHAIN IS STORED, NOT INFERRED ─────────────────────────────────

  it("a transaction traces deterministically back to the need it came from", async () => {
    //   TRANSACTION_TO_NEED_PROVENANCE · TRANSACTION_LINEAGE_DETERMINISTIC
    const data = await journey();
    const [need] = await theNeed();
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);

    const lineage = await provenance.lineageOfTransaction(committed.transaction!.id);
    expect(lineage).not.toBeNull();
    expect(lineage!.needId).toBe(need!.id);
    // The revision the need had WHEN the attempt was made.
    expect(lineage!.needRevision).toBe(need!.revision);
    expect(lineage!.proposalId).toBe(data.proposalId);
    expect(lineage!.engagementId).toBe(data.engagementId);
  });

  it("the search records which need, at which revision, caused it", async () => {
    //   RESULTSET_NEED_PROVENANCE · NEED_REVISION_PROVENANCE
    await journey();
    const [need] = await theNeed();
    const sets = await handle.db.execute(
      sql.raw(`SELECT "needId", "needRevision" FROM discovery_result_sets`),
    );
    expect(sets.rows).toHaveLength(1);
    const set = sets.rows[0] as { needId: string; needRevision: number };
    expect(set.needId).toBe(need!.id);
    expect(set.needRevision).toBe(3);
  });

  it("the selection records which presented set and item it came out of", async () => {
    //   SELECTION_TO_NEED_PROVENANCE · REFERENCE_SYSTEM_REUSED
    await journey();
    const orders = await handle.db.execute(
      sql.raw(`SELECT "resultSetId", "candidateId", "proposalId" FROM commercial_orders`),
    );
    const order = orders.rows[0] as {
      resultSetId: string; candidateId: string; proposalId: string;
    };
    expect(order.resultSetId).toBeTruthy();
    expect(order.candidateId).toBeTruthy();
    // And the candidate really belongs to that set — the binding system's own
    // relation, not a second one.
    const candidate = await handle.db.execute(
      sql.raw(`SELECT "resultSetId" FROM discovery_candidates WHERE id = '${order.candidateId}'`),
    );
    expect((candidate.rows[0] as { resultSetId: string }).resultSetId).toBe(order.resultSetId);
  });

  it("a transaction created outside any need traces to nothing", async () => {
    //   NO_PROVENANCE → NO_AUTOMATIC_NEED_RESOLUTION
    await turn("أنا جائع", { ...base(), need: { intent: "NEW", outcome: "أن أشبع" } });
    // An ordinary exchange built straight from the fabric, with no conversation
    // behind it.
    const offer = await offering("prepared.item", "direct", "1500");
    const need = await fabric.createExpression({
      ownerId: me(), kind: "need", semanticType: "prepared.item", attributes: {},
    });
    await fabric.publishExpression({
      id: need.id, ownerId: me(), projection: { semanticType: "prepared.item", summary: "n" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id, offeringId: offer.id, createdByOwnerId: me(),
    });
    const engaged = await fabric.createEngagement({
      matchId: match.id, initiatorOwnerId: me(),
      participants: await fabric.participantsForMatch(match.id),
    });
    await agreement.setNegotiationEnvelope({
      engagementId: engaged.id, ownerId: me(), principalId: me(),
      bounds: { settlement: { direction: "LOWER_IS_BETTER", target: 1500, reserve: 2000 } },
      mayConcede: true, mayAcceptWithinReserve: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engaged.id, proposerOwnerId: sellerScope,
      terms: [
        { key: "settlement", kind: "NUMBER", value: 1500, unit: "minor",
          owedBy: me(), owedTo: sellerScope, evidence: "INTERNAL_STATE",
          subjectKind: "obligation", subjectId: "settlement",
          settlement: { amountMinor: "1500", currency: "KWD" } },
        { key: "provision", kind: "NUMBER", value: 1, unit: "unit",
          owedBy: sellerScope, owedTo: me(), evidence: "HUMAN_ACTION",
          subjectKind: "obligation", subjectId: "provision" },
      ],
    });
    const committed = await agreement.commitAgreement({
      proposalId: proposal.id, ownerId: me(), principalId: me(),
    });

    expect(await provenance.lineageOfTransaction(committed.transaction!.id)).toBeNull();
    //   CROSS_NEED_SATISFACTION = 0 — it speaks to no conversational need.
    const [conversational] = await theNeed();
    const verdict = await provenance.evaluateNeedSatisfaction({
      needId: conversational!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("NO_TRANSACTION");
  });

  // ── B · THE RESOLUTION GATE ───────────────────────────────────────────────

  it("a rejected attempt resolves nothing and creates no second need", async () => {
    //   REJECTED_PROPOSAL_RESOLVES_NEED = 0 · FAILED_ATTEMPT_CREATES_NEW_NEED = 0
    const data = await journey();
    const [need] = await theNeed();
    await fabric.respondToProposal({
      proposalId: data.proposalId, ownerId: sellerScope, action: "reject",
    });
    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("NO_TRANSACTION");
    const after = await theNeed();
    expect(after).toHaveLength(1);
    expect(after[0]!.state).toBe("ACTIVE");
  });

  it("an agreed transaction with open fulfillment resolves nothing", async () => {
    //   TRANSACTION_CREATED != NEED_SATISFIED
    const data = await journey();
    const [need] = await theNeed();
    await counterpartyAccepts(data.engagementId, data.proposalId);
    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("FULFILLMENT_INCOMPLETE");
    expect((await theNeed())[0]!.state).toBe("ACTIVE");
  });

  it("money verified and delivery open still resolves nothing", async () => {
    //   PAYMENT_ONLY_NEED_RESOLUTION = 0 · PAYMENT != FULFILLMENT
    const data = await journey();
    const [need] = await theNeed();
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);

    // Verify ONLY the money obligation, through the real evidence path.
    const obligations = await txn.obligationsOf(committed.transaction!.id);
    const settlement = obligations.find((row) => row.termKey === "settlement")!;
    const [scopeRow] = await handle.db.execute(
      sql.raw(`SELECT "scopeId" FROM transactions WHERE id = '${committed.transaction!.id}'`),
    ).then((result) => result.rows as { scopeId: string }[]);
    const attempt = await attemptFor(scopeRow!.scopeId);
    await bridge.submitEffectSignal(handle.db, {
      ownerId: scopeRow!.scopeId, attemptId: attempt.id, channel: "INTERNAL_STATE_READBACK",
      subjectKind: "obligation", subjectId: settlement.subjectId ?? "settlement",
      observationType: "fulfillment",
      payload: { termKey: "settlement", state: "COMPLETE" },
      observedAt: new Date(), freshnessExpiresAt: new Date(Date.now() + 600_000),
    });
    await txn.settleObligation({ obligationId: settlement.id, attemptId: attempt.id });

    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("FULFILLMENT_INCOMPLETE");
    expect((await theNeed())[0]!.state).toBe("ACTIVE");
  });

  it("a claim that is not verified resolves nothing", async () => {
    //   HUMAN_CLAIM_ALONE_RESOLVES_NEED = 0 · CLAIMED_COMPLETE != VERIFIED_COMPLETE
    const data = await journey();
    const [need] = await theNeed();
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    const obligations = await txn.obligationsOf(committed.transaction!.id);
    const provision = obligations.find((row) => row.termKey === "provision")!;
    await txn.claimObligation({ obligationId: provision.id, actorId: sellerScope });

    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("FULFILLMENT_INCOMPLETE");
    expect((await theNeed())[0]!.state).toBe("ACTIVE");
  });

  it("verified fulfillment of every obligation resolves the need", async () => {
    //   VERIFIED_SIMPLE_NEED_RESOLUTION
    const data = await journey();
    const [need] = await theNeed();
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    const obligations = await verifyEverything(committed.transaction!.id);
    expect(obligations.every((row) => row.verification === "VERIFIED")).toBe(true);

    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("SATISFIED");
    expect(verdict.lineage[0]!.needId).toBe(need!.id);
    expect((await theNeed())[0]!.state).toBe("RESOLVED");
  });

  // ── C · WHAT MUST NOT HAPPEN ──────────────────────────────────────────────

  it("finishing one need leaves the other exactly as it was", async () => {
    //   CROSS_NEED_SATISFACTION = 0 · LATEST_NEED_RESOLUTION_GUESS = 0
    const data = await journey();
    const [meal] = await theNeed();
    // A second, unrelated need in the same conversation.
    await turn("بالمناسبة أبي برادو", {
      ...base(), need: { intent: "NEW", outcome: "أن أجد سيارة" },
    });
    const both = await theNeed();
    expect(both).toHaveLength(2);
    const car = both[1]!;

    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    await verifyEverything(committed.transaction!.id);
    await provenance.resolveNeedIfSatisfied({
      needId: meal!.id, conversationId, scopeId: me(),
    });

    const after = await theNeed();
    expect(after[0]!.state).toBe("RESOLVED");
    // Untouched: not its state, not its revision.
    expect(after[1]!.state).toBe(car.state);
    expect(after[1]!.revision).toBe(car.revision);

    // And the car's own verdict is that nothing came of it.
    const verdict = await provenance.evaluateNeedSatisfaction({
      needId: car.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("NO_TRANSACTION");
  });

  it("a need corrected after the attempt is not satisfied by the old attempt", async () => {
    //   OLD_REVISION_TRANSACTION_AUTO_SATISFIES_NEW_REVISION = 0
    //   HISTORICAL_PROVENANCE_MUTATION = 0
    const data = await journey();
    const [need] = await theNeed();
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    await verifyEverything(committed.transaction!.id);

    // The person changes their mind AFTER the attempt.
    await turn("لا، بروستد", {
      ...base(), need: { intent: "CORRECT", addAssumptions: ["بروستد بدل الشاورما"] },
    });

    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("SUPERSEDED_BY_REVISION");
    expect((await theNeed())[0]!.state).not.toBe("RESOLVED");

    // The history did not move: the engagement still records the revision the
    // attempt was actually made for.
    const engagement = await handle.db.execute(
      sql.raw(`SELECT "needRevision" FROM economic_engagements WHERE id = '${data.engagementId}'`),
    );
    expect((engagement.rows[0] as { needRevision: number }).needRevision).toBe(3);
  });

  it("more than one traced transaction is inconclusive, never resolved", async () => {
    //   ONE_TRANSACTION_ALWAYS_RESOLVES_NEED = NO
    //   INCONCLUSIVE_NEED_SATISFACTION != RESOLVED
    const first = await journey();
    const [need] = await theNeed();
    const one = await counterpartyAccepts(first.engagementId, first.proposalId);
    await verifyEverything(one.transaction!.id);

    // A second attempt for the SAME need, at the same revision.
    await turn("الأولى", act(["commerce:select"], { position: 1 }));
    const second = (await turn("اطلبها", act(["commerce:propose"]))).data as {
      proposalId: string; engagementId: string;
    };
    const two = await counterpartyAccepts(second.engagementId, second.proposalId);
    await verifyEverything(two.transaction!.id);

    const verdict = await provenance.resolveNeedIfSatisfied({
      needId: need!.id, conversationId, scopeId: me(),
    });
    expect(verdict.verdict).toBe("INCONCLUSIVE");
    expect(verdict.lineage).toHaveLength(2);
    expect((await theNeed())[0]!.state).not.toBe("RESOLVED");
  });

  // ── D · SECURITY ──────────────────────────────────────────────────────────

  it("provenance never bridges a conversation or a scope", async () => {
    //   CROSS_CONVERSATION_PROVENANCE_LEAK = 0 · CROSS_SCOPE_PROVENANCE_LEAK = 0
    await journey();
    const [need] = await theNeed();

    const other = await runtime.createRuntimeConversation({ ownerId: me(), title: "other" });
    await expect(
      provenance.evaluateNeedSatisfaction({
        needId: need!.id, conversationId: other.id, scopeId: me(),
      }),
    ).rejects.toThrow(/No such need/);
    await expect(
      provenance.evaluateNeedSatisfaction({
        needId: need!.id, conversationId, scopeId: "another-scope",
      }),
    ).rejects.toThrow(/No such need/);
  });

  it("a forged lineage is refused because nothing reads a supplied need id", async () => {
    //   FORGED_PROVENANCE_ACCEPTED = 0 · MODEL_CAN_BIND_TRANSACTION_TO_NEED = NO
    const data = await journey();
    const [need] = await theNeed();
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    await verifyEverything(committed.transaction!.id);

    // A second need that had nothing to do with this exchange.
    await turn("وأبي برادو", { ...base(), need: { intent: "NEW", outcome: "أن أجد سيارة" } });
    const car = (await theNeed())[1]!;
    const verdict = await provenance.evaluateNeedSatisfaction({
      needId: car.id, conversationId, scopeId: me(),
    });
    // The verified transaction cannot be claimed by it.
    expect(verdict.verdict).toBe("NO_TRANSACTION");

    // And no model input anywhere names a need on the transaction path.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/need-provenance.ts", "utf8"),
    );
    // The CODE, not the prose: this module's comments discuss what a model may
    // not do, and a search that flagged that would be testing spelling.
    const bare = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(bare).not.toMatch(/envelope|patch|ModelGateway/i);
    expect(need!.id).toBeTruthy();
  });

  it("recording where something came from grants nobody anything", async () => {
    //   PROVENANCE != AUTHORITY · != VERIFICATION
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/need-provenance.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // It never authorizes, never evaluates policy, and the only row it ever
    // writes is the need's own state.
    expect(code).not.toMatch(/resolveActingScope|evaluatePolicies|authoriz/i);
    const updates = [...code.matchAll(/\.update\((\w+)\)/g)].map((m) => m[1]!);
    expect(new Set(updates)).toEqual(new Set(["conversationNeeds"]));
  });

  it("provenance makes no living object", async () => {
    //   NEED_LIVING_OBJECT_CREATED_FOR_PROVENANCE = 0
    const data = await journey();
    const before = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM living_objects`),
    );
    expect((before.rows[0] as { n: number }).n).toBe(0);
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    // The TRANSACTION gets a handle, as it always did. The need gets none.
    const after = await handle.db.execute(
      sql.raw(`SELECT "subjectKind" FROM living_objects`),
    );
    expect(after.rows.length).toBeGreaterThan(0);
    for (const row of after.rows) {
      expect((row as { subjectKind: string }).subjectKind).toBe("transaction");
    }
    expect(committed.transaction).toBeTruthy();
  });

  // ── E · SEVEN UNRELATED THINGS ────────────────────────────────────────────

  it("the identical chain holds over seven unrelated exchanges", async () => {
    //   DOMAIN_PROVENANCE_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    for (const semanticType of HOLDOUTS) {
      const conversation = await runtime.createRuntimeConversation({
        ownerId: me(), title: semanticType,
      });
      conversationId = conversation.id;
      const data = await journey(semanticType);
      const [need] = await theNeed();
      const committed = await counterpartyAccepts(data.engagementId, data.proposalId);

      const lineage = await provenance.lineageOfTransaction(committed.transaction!.id);
      expect(lineage!.needId, semanticType).toBe(need!.id);
      expect(lineage!.needRevision, semanticType).toBe(need!.revision);

      // Before verification, no resolution — whatever was being exchanged.
      const verdict = await provenance.evaluateNeedSatisfaction({
        needId: need!.id, conversationId, scopeId: me(),
      });
      expect(verdict.verdict, semanticType).toBe("FULFILLMENT_INCOMPLETE");
    }
  });

  it("and the chain names no noun at all", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/need-provenance.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const noun of ["food", "meal", "car", "vehicle", "translator", "storage",
      "venue", "survey", "restaurant", "booking"]) {
      expect(code.toLowerCase(), `branches on ${noun}`)
        .not.toMatch(new RegExp(`\\b${noun}s?\\b`));
    }
    expect(code).not.toMatch(/\bswitch\s*\(/);
  });
});
