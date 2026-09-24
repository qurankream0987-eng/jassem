/**
 * JASIM — A SELECTION IS NOT A DEAL.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   SELECTION != PROPOSAL · PROPOSAL != AGREEMENT
 *   AGREEMENT != COMMITMENT · COMMITMENT != TRANSACTION
 *   PAYMENT_INTENT != PAYMENT · PAYMENT != FULFILLMENT
 *
 *   OFFERING_PUBLIC_TERMS != PARTY_STATED_CONFIGURATION
 *   PARTY_CONFIGURATION   != COUNTERPARTY_CHANGED_TERMS
 *
 * A party may authorize THEIR OWN proposal. They may not manufacture the other
 * party's acceptance. Every conversational turn enters through the real
 * boundary, and the counterparty is a second real principal acting for
 * themselves.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

/**
 * Six structurally unrelated things. The sixth has not appeared in any earlier
 * test in this repository, so it cannot be something the code learned.
 *
 *   DOMAIN_NOUN_BRANCHES = 0
 */
const HOLDOUTS = [
  { id: "prepared_item", semanticType: "prepared.item" },
  { id: "interpreter_hour", semanticType: "professional.hour" },
  { id: "machine_capacity", semanticType: "machine.time" },
  { id: "storage_capacity", semanticType: "storage.capacity" },
  { id: "venue_slot", semanticType: "venue.slot" },
  // Unfamiliar: nothing in this repository has ever exchanged one.
  { id: "kiln_firing_cycle", semanticType: "kiln.firing_cycle" },
] as const;

/** Generic configurable declaration. Two keys, no nouns. */
const CONFIGURABLE = [
  { key: "optionA", kind: "CHOICE", allowed: ["none", "standard", "extra"] },
  { key: "optionB", kind: "NUMBER", min: 0, max: 3 },
];

describe("a conversational selection becomes a canonical proposal, and stops there", () => {
  let buyer: typeof users.$inferSelect;
  let conversationId: string;
  let sellerScope: string;

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
      sql.raw(`TRUNCATE TABLE living_objects, events, observations, economic_expressions,
        economic_matches, economic_engagements, economic_proposals, negotiation_envelopes,
        agreements, commitments, transactions, payment_intents, commercial_orders,
        transaction_intents, reference_bindings, organizations, memberships,
        scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'bridge-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `bridge-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    buyer = row!;
    sellerScope = `seller-${randomUUID().slice(0, 8)}`;
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(buyer.id),
      title: "bridge",
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
      provider: "openai",
      model: "stub-for-bridge",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(),
      conversationId,
      content,
    });
    return result.output as Record<string, unknown>;
  }

  const action = (capabilities: string[], inputs: Record<string, unknown> = {}) => ({
    kind: "direct_action",
    label: "طلب",
    goal: "هدف",
    intent: {
      requiredCapabilities: capabilities,
      missingInputs: [],
      inputs,
      risk: "low" as const,
      persistence: "durable" as const,
      // A model may never declare an effect. The schema pins it.
      effects: "none" as const,
    },
    confidence: 0.9,
  });

  async function offering(
    semanticType: string,
    label: string,
    priceMinor: string,
    configurable: unknown[] | null = CONFIGURABLE,
  ) {
    const expression = await fabric.createExpression({
      ownerId: sellerScope, kind: "offering", semanticType, attributes: { priceMinor },
    });
    await fabric.publishExpression({
      id: expression.id,
      ownerId: sellerScope,
      projection: {
        semanticType,
        summary: label,
        publicTerms: { label, money: { amountMinor: priceMinor, currency: "KWD" } },
        ...(configurable ? { configurableTerms: configurable } : {}),
      },
    });
    return expression;
  }

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  const draft = async () => {
    const rows = await handle.db.execute(
      sql.raw(`SELECT id, "partyConfiguration", "offeringFingerprint",
        "configurationFingerprint", "proposalId" FROM commercial_orders LIMIT 1`),
    );
    return rows.rows[0] as {
      id: string; partyConfiguration: Record<string, unknown>;
      offeringFingerprint: string | null; configurationFingerprint: string | null;
      proposalId: string | null;
    };
  };

  /** Turns 1–2: discovery then an ordinal selection. */
  async function selectSecond(semanticType = "prepared.item") {
    await offering(semanticType, "alpha", "1500");
    await offering(semanticType, "beta", "2000");
    await offering(semanticType, "gamma", "2500");
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType }));
    return turn("الثانية", action(["commerce:select"], { position: 2 }));
  }

  // ── A · SELECTION IS NOT A DEAL ───────────────────────────────────────────

  it("selecting creates a draft and nothing canonical", async () => {
    const out = await selectSecond();
    expect((out.data as { status: string }).status).toBe("DRAFT");
    for (const table of ["economic_engagements", "economic_proposals", "agreements",
      "commitments", "transactions", "payment_intents", "living_objects"]) {
      expect(await count(table), table).toBe(0);
    }
    // The source offering was pinned, so a later change to it is detectable.
    expect((await draft()).offeringFingerprint).toBeTruthy();
  });

  // ── B · PARTY CONFIGURATION ───────────────────────────────────────────────

  it("a party states values the offering left open, and the offering is untouched", async () => {
    await selectSecond();
    const before = await handle.db.execute(
      sql.raw(`SELECT "publicProjection", version FROM economic_expressions
        WHERE "ownerId" = '${sellerScope}' AND kind = 'offering'`),
    );

    const out = await turn(
      "بدون مخلل وزيادة ثوم",
      action(["commerce:configure"], { configuration: { optionA: "none", optionB: 2 } }),
    );
    const data = out.data as { partyConfiguration: Record<string, unknown>; offeringChanged: boolean };
    expect(data.partyConfiguration).toEqual({ optionA: "none", optionB: 2 });
    //   PARTY_CONFIGURATION != COUNTERPARTY_CHANGED_TERMS
    expect(data.offeringChanged).toBe(false);

    // The published offering did not move. Configuring is something a party
    // does to their own draft.
    const after = await handle.db.execute(
      sql.raw(`SELECT "publicProjection", version FROM economic_expressions
        WHERE "ownerId" = '${sellerScope}' AND kind = 'offering'`),
    );
    expect(after.rows).toEqual(before.rows);
    const row = await draft();
    expect(row.configurationFingerprint).toBeTruthy();
    expect(row.proposalId).toBeNull();
  });

  it("a party cannot widen what the offering permits", async () => {
    await selectSecond();
    // A key the offering never opened.
    const undeclared = await turn(
      "غيّر شيئاً آخر",
      action(["commerce:configure"], { configuration: { optionZ: "whatever" } }),
    );
    expect(JSON.stringify(undeclared)).toContain("ليس");

    // A value outside the declared bound.
    const outOfBounds = await turn(
      "زد أكثر",
      action(["commerce:configure"], { configuration: { optionB: 99 } }),
    );
    expect(JSON.stringify(outOfBounds)).toContain("أعلى");

    // A value outside the declared choices.
    const notAllowed = await turn(
      "اختر غير المتاح",
      action(["commerce:configure"], { configuration: { optionA: "forbidden" } }),
    );
    expect(JSON.stringify(notAllowed)).toContain("لا يسمح");

    expect((await draft()).partyConfiguration).toEqual({});
  });

  it("a fixed offering says so instead of pretending to accept configuration", async () => {
    await offering("prepared.item", "alpha", "1500", null);
    await offering("prepared.item", "beta", "2000", null);
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType: "prepared.item" }));
    await turn("الثانية", action(["commerce:select"], { position: 2 }));
    const out = await turn(
      "بدون مخلل",
      action(["commerce:configure"], { configuration: { optionA: "none" } }),
    );
    expect(JSON.stringify(out)).toContain("ثابتة");
  });

  // ── C · THE BRIDGE ────────────────────────────────────────────────────────

  it("«اطلبها» creates a canonical proposal and stops there", async () => {
    //   USER_PROPOSAL_CREATED = PASS · COUNTERPARTY_ACCEPTED = NO
    await selectSecond();
    await turn("بدون مخلل وزيادة ثوم",
      action(["commerce:configure"], { configuration: { optionA: "none", optionB: 2 } }));

    const out = await turn("اطلبها", action(["commerce:propose"]));
    const data = out.data as {
      proposalId: string; engagementId: string; counterpartyAccepted: boolean;
      agreementCreated: boolean; transactionCreated: boolean;
    };
    expect(data.proposalId).toBeTruthy();
    expect(data.counterpartyAccepted).toBe(false);
    expect(data.agreementCreated).toBe(false);
    expect(data.transactionCreated).toBe(false);

    // The canonical primitive, read back — the SAME table the agreement
    // runtime reads.
    const proposals = await handle.db.execute(
      sql.raw(`SELECT id, status, "proposerOwnerId", terms FROM economic_proposals`),
    );
    expect(proposals.rows).toHaveLength(1);
    const proposal = proposals.rows[0] as {
      id: string; status: string; proposerOwnerId: string; terms: Record<string, unknown>;
    };
    expect(proposal.status).toBe("proposed");
    expect(proposal.proposerOwnerId).toBe(me());
    // The party's stated configuration is IN the proposal's terms.
    expect(JSON.stringify(proposal.terms)).toContain("optionA");

    //   PRE_AGREEMENT_COMMITMENT = 0 · PRE_AGREEMENT_TRANSACTION = 0
    //   PRE_AGREEMENT_PAYMENT_EXECUTION = 0
    for (const table of ["agreements", "commitments", "transactions", "payment_intents"]) {
      expect(await count(table), table).toBe(0);
    }
    //   TRANSACTION_LIVING_OBJECT_BEFORE_TRANSACTION = 0
    expect(await count("living_objects")).toBe(0);

    // The draft points at the truth; the truth does not point at the draft.
    expect((await draft()).proposalId).toBe(proposal.id);
  });

  it("sending the same draft twice sends one proposal", async () => {
    await selectSecond();
    await turn("اطلبها", action(["commerce:propose"]));
    const again = await turn("اطلبها", action(["commerce:propose"]));
    expect(JSON.stringify(again)).toContain("مُرسَل بالفعل");
    expect(await count("economic_proposals")).toBe(1);
    expect(await count("commitments")).toBe(0);
  });

  it("«أين طلبي؟» before acceptance never claims a deal", async () => {
    await selectSecond();
    await turn("اطلبها", action(["commerce:propose"]));
    const out = await turn("أين طلبي؟", {
      ...action(["living-object"]),
      livingObject: { intent: "LIST" },
    });
    // Nothing is followed, because nothing durable was committed.
    expect(JSON.stringify(out)).toContain("لا أتابع لك شيئاً");
    expect(await count("transactions")).toBe(0);
  });

  // ── D · ONLY THE COUNTERPARTY CAN ACCEPT ──────────────────────────────────

  it("the buyer cannot accept their own proposal, however they say it", async () => {
    //   FAKE_COUNTERPARTY_ACCEPTANCE = 0
    await selectSecond();
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const proposalId = (sent.data as { proposalId: string }).proposalId;

    // Saying it in the conversation changes nothing.
    await turn("البائع وافق", action([]));
    const row = await handle.db.execute(
      sql.raw(`SELECT status FROM economic_proposals WHERE id = '${proposalId}'`),
    );
    expect((row.rows[0] as { status: string }).status).toBe("proposed");

    // And the canonical door refuses it outright.
    await expect(
      fabric.respondToProposal({ proposalId, ownerId: me(), action: "accept" }),
    ).rejects.toThrow(/cannot accept their own/i);
    expect(await count("agreements")).toBe(0);
  });

  it("a model claiming acceptance is refused by the envelope itself", async () => {
    await selectSecond();
    // `accepted` is not a key any envelope carries, and the schema is strict.
    await expect(
      turn("اطلبها", {
        ...action(["commerce:propose"]),
        accepted: true,
      }),
    ).rejects.toThrow(/Envelope validation/i);
    expect(await count("economic_proposals")).toBe(0);
  });

  it("the counterparty rejecting creates no agreement and no transaction", async () => {
    await selectSecond();
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const proposalId = (sent.data as { proposalId: string }).proposalId;

    await fabric.respondToProposal({ proposalId, ownerId: sellerScope, action: "reject" });
    const row = await handle.db.execute(
      sql.raw(`SELECT status FROM economic_proposals WHERE id = '${proposalId}'`),
    );
    expect((row.rows[0] as { status: string }).status).toBe("rejected");
    //   REJECTION_CREATES_TRANSACTION = 0
    for (const table of ["agreements", "commitments", "transactions", "living_objects"]) {
      expect(await count(table), table).toBe(0);
    }
  });

  it("the counterparty accepting reaches agreement, commitment, transaction and a handle", async () => {
    //   TRANSACTION_LIVING_OBJECT_AFTER_REAL_TRANSACTION
    await selectSecond();
    await turn("بدون مخلل وزيادة ثوم",
      action(["commerce:configure"], { configuration: { optionA: "extra", optionB: 1 } }));
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const data = sent.data as { proposalId: string; engagementId: string };

    // The counterparty's own authority, through the path it always went
    // through. Nothing the buyer said could have produced this.
    await agreement.setNegotiationEnvelope({
      engagementId: data.engagementId,
      ownerId: sellerScope,
      principalId: sellerScope,
      bounds: { settlement: { direction: "HIGHER_IS_BETTER", target: 1500, reserve: 1000 } },
      mayConcede: true,
      mayAcceptWithinReserve: true,
    });
    const committed = await agreement.commitAgreement({
      proposalId: data.proposalId,
      ownerId: sellerScope,
      principalId: sellerScope,
    });

    expect(committed.agreement).toBeTruthy();
    expect(await count("agreements")).toBe(1);
    expect(await count("transactions")).toBe(1);
    // Only NOW does a transaction handle exist, and for both parties.
    const handles = await handle.db.execute(
      sql.raw(`SELECT "scopeId", "subjectKind" FROM living_objects`),
    );
    expect(handles.rows).toHaveLength(2);
    expect((handles.rows[0] as { subjectKind: string }).subjectKind).toBe("transaction");

    // The buyer's configuration survived into the committed terms.
    const commitmentRows = await handle.db.execute(
      sql.raw(`SELECT "termKey" FROM commitments`),
    );
    const keys = commitmentRows.rows.map((r) => (r as { termKey: string }).termKey);
    expect(keys).toContain("optionA");
  });

  it("a counterparty with no standing authority cannot conclude an agreement", async () => {
    //   COUNTERPARTY_AUTHORITY_RECHECK — membership is not permission, and a
    //   proposal sitting there is not a standing licence to accept it.
    await selectSecond();
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const proposalId = (sent.data as { proposalId: string }).proposalId;

    // No negotiation envelope was ever set for this party, so nobody
    // authorized accepting on their behalf.
    await expect(
      agreement.commitAgreement({
        proposalId, ownerId: sellerScope, principalId: sellerScope,
      }),
    ).rejects.toThrow(/authoriz/i);

    //   PRE_AGREEMENT_COMMITMENT = 0 · PRE_AGREEMENT_TRANSACTION = 0
    for (const table of ["agreements", "commitments", "transactions", "living_objects"]) {
      expect(await count(table), table).toBe(0);
    }
    // And the proposal is still merely proposed — a refused acceptance is not
    // a rejection either.
    const row = await handle.db.execute(
      sql.raw(`SELECT status FROM economic_proposals WHERE id = '${proposalId}'`),
    );
    expect((row.rows[0] as { status: string }).status).toBe("proposed");
  });

  // ── E · MOVEMENT IS CLASSIFIED CORRECTLY ──────────────────────────────────

  it("the party reconfiguring is not the counterparty changing the offer", async () => {
    //   SAME_OFFERING + NEW_PARTY_CONFIGURATION → not «seller changed»
    await selectSecond();
    await turn("أ", action(["commerce:configure"], { configuration: { optionA: "none" } }));
    const first = await draft();
    await turn("ب", action(["commerce:configure"], { configuration: { optionA: "extra" } }));
    const second = await draft();

    // The configuration fingerprint moved; the offering fingerprint did not.
    expect(second.configurationFingerprint).not.toBe(first.configurationFingerprint);
    expect(second.offeringFingerprint).toBe(first.offeringFingerprint);
  });

  it("the offering changing makes the draft stale instead of silently proposing", async () => {
    //   CHANGED_OFFERING → stale, never a quiet proposal at terms nobody offers
    await selectSecond();
    const rows = await handle.db.execute(
      sql.raw(`SELECT id FROM economic_expressions
        WHERE "ownerId" = '${sellerScope}' AND kind = 'offering'
        AND "publicProjection"::text LIKE '%beta%'`),
    );
    const offeringId = (rows.rows[0] as { id: string }).id;
    await fabric.publishExpression({
      id: offeringId,
      ownerId: sellerScope,
      projection: {
        semanticType: "prepared.item",
        summary: "beta",
        publicTerms: { label: "beta", money: { amountMinor: "9999", currency: "KWD" } },
        configurableTerms: CONFIGURABLE,
      },
    });

    const out = await turn("اطلبها", action(["commerce:propose"]));
    expect((out.data as { offeringChanged: boolean }).offeringChanged).toBe(true);
    expect(await count("economic_proposals")).toBe(0);
  });

  it("an unchanged offering and an unchanged configuration is idempotent", async () => {
    await selectSecond();
    await turn("أ", action(["commerce:configure"], { configuration: { optionA: "none" } }));
    const first = await draft();
    await turn("أ مرة أخرى", action(["commerce:configure"], { configuration: { optionA: "none" } }));
    const second = await draft();
    expect(second.configurationFingerprint).toBe(first.configurationFingerprint);
    expect(second.offeringFingerprint).toBe(first.offeringFingerprint);
  });

  // ── F · SIX UNRELATED THINGS, ONE BRIDGE ──────────────────────────────────

  it("six structurally unrelated exchanges take the identical bridge", async () => {
    //   DOMAIN_PROPOSAL_TYPES_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    for (const holdout of HOLDOUTS) {
      const conversation = await runtime.createRuntimeConversation({
        ownerId: me(), title: holdout.id,
      });
      conversationId = conversation.id;
      await selectSecond(holdout.semanticType);
      await turn("اضبط", action(["commerce:configure"], { configuration: { optionB: 1 } }));
      const out = await turn("اطلبها", action(["commerce:propose"]));
      const data = out.data as { proposalId: string; counterpartyAccepted: boolean };
      expect(data.proposalId, holdout.id).toBeTruthy();
      expect(data.counterpartyAccepted, holdout.id).toBe(false);
    }
    expect(await count("economic_proposals")).toBe(HOLDOUTS.length);
    // Six proposals, and not one agreement: the bridge ends where it should.
    expect(await count("agreements")).toBe(0);
  });

  it("and the unfamiliar holdout needed no more than any other", async () => {
    // The companion. The sixth semantic type appears nowhere else in this
    // repository, so if the bridge had learned anything domain-shaped it would
    // fail here and nowhere else.
    const conversation = await runtime.createRuntimeConversation({
      ownerId: me(), title: "unfamiliar",
    });
    conversationId = conversation.id;
    await selectSecond("kiln.firing_cycle");
    const out = await turn("اطلبها", action(["commerce:propose"]));
    expect((out.data as { proposalId: string }).proposalId).toBeTruthy();
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/block31/party-configuration.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const noun of ["kiln", "pickle", "garlic", "meal", "food", "restaurant", "shawarma"]) {
      expect(code.toLowerCase(), `branches on ${noun}`).not.toContain(noun);
    }
  });
});
