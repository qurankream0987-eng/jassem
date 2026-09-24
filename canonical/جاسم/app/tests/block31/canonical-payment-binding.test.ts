/**
 * JASIM — WHAT EXACT OBLIGATION IS THIS PAYMENT SATISFYING?
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   SELECTION != PROPOSAL · PROPOSAL != AGREEMENT
 *   AGREEMENT != COMMITMENT · COMMITMENT != TRANSACTION
 *   PAYMENT_INTENT != PAYMENT · PAYMENT_AUTHORIZATION != SETTLEMENT
 *   COMMERCIAL_ORDER != PAYABLE_OBLIGATION
 *
 *   NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH
 *
 * A payment surface may not become executable because somebody selected
 * something and said yes to their own draft. Every conversational turn enters
 * through the real boundary; the counterparty is a second real principal.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

// Dynamic, inside beforeAll: a static import here binds the module-level db
// before the test database URL exists, which is the block31 rule.
let external: typeof import("../../api/runtime/external-action-session");

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let fabric: typeof import("../../api/runtime/economic-fabric");
let agreement: typeof import("../../api/runtime/agreement-runtime");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

/** A trusted adapter that never receives a request in this suite. */
const ADAPTER = "http://127.0.0.1:59999";

const HOLDOUTS = [
  "prepared.item",
  "professional.hour",
  "machine.time",
  "storage.capacity",
  "venue.slot",
  // Unfamiliar: appears nowhere else in this repository.
  "survey.transect",
] as const;

describe("a payment needs an obligation to be satisfying", () => {
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
    external = await import("../../api/runtime/external-action-session");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE living_objects, events, observations, economic_expressions,
        economic_matches, economic_engagements, economic_proposals, negotiation_envelopes,
        agreements, commitments, transactions, payment_intents, commercial_orders,
        transaction_intents, external_action_sessions, reference_bindings,
        organizations, memberships, scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'pay-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `pay-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    buyer = row!;
    sellerScope = `seller-${randomUUID().slice(0, 8)}`;
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(buyer.id), title: "pay",
    });
    conversationId = conversation.id;
    // A genuinely trusted adapter. If a checkout is refused in this suite it is
    // refused for a canonical reason, never because the provider was unknown.
    external.configureExternalActionProvider("psp-proof", {
      [external.PAYMENT_CHECKOUT_PURPOSE]: { origins: [ADAPTER], pathPrefixes: ["/checkout"] },
    });
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    external.resetExternalActionProviders();
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const me = () => String(buyer.id);

  async function turn(content: string, envelope: Record<string, unknown>) {
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({ version: 1, decisionId: randomUUID(), ...envelope }),
      provider: "openai", model: "stub-for-payment-binding",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(), conversationId, content,
    });
    return result.output as Record<string, unknown>;
  }

  const action = (capabilities: string[], inputs: Record<string, unknown> = {}) => ({
    kind: "direct_action", label: "طلب", goal: "هدف",
    intent: {
      requiredCapabilities: capabilities, missingInputs: [], inputs,
      risk: "low" as const, persistence: "durable" as const, effects: "none" as const,
    },
    confidence: 0.9,
  });

  const payIntent = { provider: "psp-proof", adapterEndpoint: ADAPTER };

  async function offering(semanticType: string, label: string, priceMinor: string) {
    const expression = await fabric.createExpression({
      ownerId: sellerScope, kind: "offering", semanticType, attributes: { priceMinor },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId: sellerScope,
      projection: {
        semanticType, summary: label,
        publicTerms: { label, money: { amountMinor: priceMinor, currency: "KWD" } },
        configurableTerms: [{ key: "optionB", kind: "NUMBER", min: 0, max: 3 }],
      },
    });
    return expression;
  }

  const count = async (table: string) => {
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int n FROM ${table}`));
    return (rows.rows[0] as { n: number }).n;
  };

  async function selectSecond(semanticType = "prepared.item") {
    await offering(semanticType, "alpha", "1500");
    await offering(semanticType, "beta", "2000");
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType }));
    return turn("الثانية", action(["commerce:select"], { position: 2 }));
  }

  /** The counterparty's own authority, through the path it always went through. */
  async function counterpartyAccepts(engagementId: string, proposalId: string) {
    await agreement.setNegotiationEnvelope({
      engagementId, ownerId: sellerScope, principalId: sellerScope,
      bounds: { settlement: { direction: "HIGHER_IS_BETTER", target: 1500, reserve: 1000 } },
      mayConcede: true, mayAcceptWithinReserve: true,
    });
    return agreement.commitAgreement({
      proposalId, ownerId: sellerScope, principalId: sellerScope,
    });
  }

  // ── A · THE BYPASS THAT MUST NOT EXIST ────────────────────────────────────

  it("A · approving a draft then paying cannot open checkout before a proposal", async () => {
    await selectSecond();
    await turn("أوافق", action(["commerce:approve"]));
    // A payment intent may exist as preparation, but it is not authority.
    const out = await turn("ادفع", action(["commerce:pay"], payIntent));

    expect(await count("agreements")).toBe(0);
    expect(await count("commitments")).toBe(0);
    expect(await count("transactions")).toBe(0);
    //   NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH
    expect(await count("external_action_sessions")).toBe(0);
    expect(JSON.stringify(out)).not.toContain("checkoutUrl");
  });

  it("B · a sent proposal is still not a payable obligation", async () => {
    await selectSecond();
    await turn("أوافق", action(["commerce:approve"]));
    await turn("اطلبها", action(["commerce:propose"]));
    const out = await turn("ادفع", action(["commerce:pay"], payIntent));

    expect(await count("economic_proposals")).toBe(1);
    expect(await count("agreements")).toBe(0);
    expect(await count("external_action_sessions")).toBe(0);
    expect(JSON.stringify(out)).not.toContain("checkoutUrl");
  });

  it("C · a rejected proposal never becomes payable", async () => {
    await selectSecond();
    await turn("أوافق", action(["commerce:approve"]));
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const proposalId = (sent.data as { proposalId: string }).proposalId;
    await fabric.respondToProposal({ proposalId, ownerId: sellerScope, action: "reject" });

    const out = await turn("ادفع", action(["commerce:pay"], payIntent));
    expect(await count("agreements")).toBe(0);
    expect(await count("external_action_sessions")).toBe(0);
    expect(JSON.stringify(out)).not.toContain("checkoutUrl");
  });

  // ── B · THE POSITIVE PATH ─────────────────────────────────────────────────

  it("E · an accepted agreement's settlement obligation makes payment eligible", async () => {
    await selectSecond();
    await turn("اضبط", action(["commerce:configure"], { configuration: { optionB: 1 } }));
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const data = sent.data as { proposalId: string; engagementId: string };
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);

    expect(await count("agreements")).toBe(1);
    expect(await count("transactions")).toBe(1);

    // What the ACCEPTED settlement commitment actually says. Asserting a
    // hardcoded number here would test the fixture's ordering, not the source
    // of the money.
    const settled = await handle.db.execute(
      sql.raw(`SELECT settlement, "beneficiaryActorId" FROM commitments
        WHERE "ownerId" = '${me()}' AND settlement IS NOT NULL`),
    );
    const obligation = settled.rows[0] as {
      settlement: { amountMinor: string; currency: string }; beneficiaryActorId: string;
    };
    // No provider named, so no surface opens — and that is the only thing
    // still missing. The canonical basis is resolved and bound.
    const out = await turn("ادفع", action(["commerce:pay"]));
    const body = out.data as {
      transactionId: string; commitmentId: string; amountMinor: string; currency: string;
    };
    expect(body.transactionId).toBe(committed.transaction!.id);
    expect(body.commitmentId).toBeTruthy();

    // Every financial field came from the ACCEPTED settlement commitment.
    const intents = await handle.db.execute(
      sql.raw(`SELECT "transactionId", "amountMinor", currency, "payeeRef", purpose
        FROM payment_intents`),
    );
    expect(intents.rows).toHaveLength(1);
    const intent = intents.rows[0] as {
      transactionId: string; amountMinor: string; currency: string;
      payeeRef: string; purpose: string;
    };
    expect(intent.transactionId).toBe(committed.transaction!.id);
    expect(intent.amountMinor).toBe(obligation.settlement.amountMinor);
    expect(intent.currency).toBe(obligation.settlement.currency);
    expect(intent.payeeRef).toBe(obligation.beneficiaryActorId);
    expect(intent.purpose).toContain("settlement:");
    // Preparing is not paying.
    expect(JSON.stringify(out)).toContain("لم يحدث دفع");
  });

  it("D · an accepted agreement with no money obligation is not payable", async () => {
    //   An obligation owed in something other than money belongs to
    //   fulfillment, not to payment.
    await selectSecond();
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const data = sent.data as { proposalId: string; engagementId: string };
    await counterpartyAccepts(data.engagementId, data.proposalId);
    // Strip the settlement from the money obligation, leaving a live exchange
    // with nothing payable on it.
    await handle.db.execute(sql.raw(`UPDATE commitments SET settlement = NULL`));

    const out = await turn("ادفع", action(["commerce:pay"], payIntent));
    expect((out.data as { reason: string }).reason).toBe("NO_PAYABLE_OBLIGATION");
    expect(await count("payment_intents")).toBe(0);
    expect(await count("external_action_sessions")).toBe(0);
  });

  // ── C · TAMPERING ─────────────────────────────────────────────────────────

  it("F/G/H · amount, currency and recipient cannot be named by the client", async () => {
    await selectSecond();
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const data = sent.data as { proposalId: string; engagementId: string };
    await counterpartyAccepts(data.engagementId, data.proposalId);

    // The client says 1 fils, a different currency and itself as payee.
    await turn("ادفع", action(["commerce:pay"], {
      amountMinor: "1", currency: "USD", payeeRef: me(), amount: 1,
    }));

    const intents = await handle.db.execute(
      sql.raw(`SELECT "amountMinor", currency, "payeeRef" FROM payment_intents`),
    );
    const intent = intents.rows[0] as {
      amountMinor: string; currency: string; payeeRef: string;
    };
    //   AMOUNT_TAMPERING = 0 · CURRENCY_TAMPERING = 0 · RECIPIENT_TAMPERING = 0
    const settled = await handle.db.execute(
      sql.raw(`SELECT settlement FROM commitments
        WHERE "ownerId" = '${me()}' AND settlement IS NOT NULL`),
    );
    const owed = (settled.rows[0] as { settlement: { amountMinor: string; currency: string } })
      .settlement;
    expect(intent.amountMinor).toBe(owed.amountMinor);
    expect(intent.currency).toBe(owed.currency);
    expect(intent.payeeRef).toBe(sellerScope);
    // None of the three is what the client said.
    expect(intent.amountMinor).not.toBe("1");
    expect(intent.currency).not.toBe("USD");
    expect(intent.payeeRef).not.toBe(me());
  });

  it("I · a stale payment reference from the draft era is not executable", async () => {
    //   STALE_CURRENT_PAYMENT_REFERENCE_EXECUTABLE = 0
    await selectSecond();
    // The pre-agreement approval path may still create its own intent and bind
    // `current:payment`. It carries no transaction, and the payment path does
    // not consult it.
    await turn("أوافق", action(["commerce:approve"]));
    const drafts = await handle.db.execute(
      sql.raw(`SELECT id, "transactionId" FROM payment_intents`),
    );
    if (drafts.rows.length > 0) {
      expect((drafts.rows[0] as { transactionId: string | null }).transactionId).toBeNull();
    }
    const out = await turn("ادفع", action(["commerce:pay"], payIntent));
    expect((out.data as { reason: string }).reason).toBe("NO_PAYABLE_OBLIGATION");
    expect(await count("external_action_sessions")).toBe(0);
  });

  it("J · another scope's obligation is not payable from here", async () => {
    //   CROSS_SCOPE_PAYMENT_BINDING = 0
    await selectSecond();
    const sent = await turn("اطلبها", action(["commerce:propose"]));
    const data = sent.data as { proposalId: string; engagementId: string };
    const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
    // Move the obligation to somebody else. Nothing else changes.
    await handle.db.execute(
      sql.raw(`UPDATE commitments SET "ownerId" = 'someone-else'
        WHERE settlement IS NOT NULL`),
    );

    const out = await turn("ادفع", action(["commerce:pay"], payIntent));
    expect((out.data as { reason: string }).reason).toBe("NO_PAYABLE_OBLIGATION");
    // And naming it explicitly is the SAME refusal — a refusal that
    // distinguished them would say whose obligation it is.
    const named = await turn("ادفع هذا", action(["commerce:pay"], {
      ...payIntent, transactionRef: committed.transaction!.id,
    }));
    expect((named.data as { reason: string }).reason).toBe("NO_PAYABLE_OBLIGATION");
  });

  it("K · more than one live obligation asks instead of choosing", async () => {
    //   AMBIGUOUS_PAYMENT_TARGET_GUESS = 0
    for (const semanticType of ["prepared.item", "venue.slot"] as const) {
      const conversation = await runtime.createRuntimeConversation({
        ownerId: me(), title: semanticType,
      });
      conversationId = conversation.id;
      await selectSecond(semanticType);
      const sent = await turn("اطلبها", action(["commerce:propose"]));
      const data = sent.data as { proposalId: string; engagementId: string };
      await counterpartyAccepts(data.engagementId, data.proposalId);
    }
    expect(await count("transactions")).toBe(2);

    const out = await turn("ادفع", action(["commerce:pay"], payIntent));
    expect(JSON.stringify(out)).toContain("حدد أيها");
    expect((out.data as { candidates: unknown[] }).candidates).toHaveLength(2);
    expect(await count("payment_intents")).toBe(0);

    // Naming one resolves it, and only that one.
    const rows = await handle.db.execute(sql.raw(`SELECT id FROM transactions ORDER BY id`));
    const chosen = (rows.rows[0] as { id: string }).id;
    const named = await turn("ادفع هذا", action(["commerce:pay"], { transactionRef: chosen }));
    expect((named.data as { transactionId: string }).transactionId).toBe(chosen);
  });

  // ── D · THE SAME BOUNDARY, SIX UNRELATED EXCHANGES ────────────────────────

  it("the eligibility boundary is identical across six unrelated exchanges", async () => {
    //   DOMAIN_PAYMENT_HANDLERS_ADDED = 0 · DOMAIN_NOUN_BRANCHES = 0
    //
    // Obligations accumulate across the loop, so «not payable before
    // acceptance» is asserted about THIS exchange by naming it, rather than
    // about the scope as a whole — which by the second iteration is legitimately
    // owed something.
    for (const semanticType of HOLDOUTS) {
      const conversation = await runtime.createRuntimeConversation({
        ownerId: me(), title: semanticType,
      });
      conversationId = conversation.id;
      const before = await count("transactions");
      await selectSecond(semanticType);
      const sent = await turn("اطلبها", action(["commerce:propose"]));

      // A proposal is not a payable obligation, whatever is being exchanged.
      expect(await count("transactions"), semanticType).toBe(before);

      const data = sent.data as { proposalId: string; engagementId: string };
      const committed = await counterpartyAccepts(data.engagementId, data.proposalId);
      expect(await count("transactions"), semanticType).toBe(before + 1);

      // After acceptance: payable, bound to that exact transaction, with money
      // read from that exchange's own settlement commitment.
      const after = await turn("ادفع", action(["commerce:pay"], {
        transactionRef: committed.transaction!.id,
      }));
      const body = after.data as { transactionId: string; amountMinor: string };
      expect(body.transactionId, semanticType).toBe(committed.transaction!.id);

      const owed = await handle.db.execute(
        sql.raw(`SELECT settlement FROM commitments
          WHERE "transactionId" = '${committed.transaction!.id}'
          AND settlement IS NOT NULL`),
      );
      const settlement = (owed.rows[0] as {
        settlement: { amountMinor: string };
      }).settlement;
      expect(body.amountMinor, semanticType).toBe(settlement.amountMinor);
    }
  });

  it("and the resolver branches on no noun at all", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("api/runtime/block31/canonical-payable.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const noun of ["food", "meal", "restaurant", "venue", "machine", "storage",
      "interpreter", "survey", "booking", "delivery"]) {
      expect(code.toLowerCase(), `branches on ${noun}`).not.toContain(noun);
    }
    // And it reads the canonical tables, not the draft.
    expect(code).toContain("from(commitments)");
    expect(code).not.toContain("commercialOrders");
  });
});
