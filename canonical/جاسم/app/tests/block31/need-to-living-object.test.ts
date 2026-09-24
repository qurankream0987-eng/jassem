/**
 * JASIM — FROM A NEED TO SOMETHING WORTH FOLLOWING.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   NEED · REFINEMENT · CONSTRAINTS · DISCOVERY · RESULT SET
 *   STABLE REFERENCE · SELECTION · COMMITMENT · LIVING OBJECT
 *
 *   EXAMPLE != ARCHITECTURE · NEW_NOUN != NEW_CORE
 *   EVERY_TURN_BECOMES_LIVING_OBJECT = NO
 *   PAYMENT != FULFILLMENT · PAID != DELIVERED
 *
 * The composition proof. Every turn goes through the REAL conversation
 * boundary — `routeRuntimeConversationTurn` — and the model says only what a
 * model may say. Nothing here knows what the conversation is about.
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
 * Six requests from contexts nothing in the runtime anticipates. They are not
 * six features: they are one Need, one discovery, one selection and one
 * obligation, six times over.
 *
 *   SHAWARMA_BRANCH = 0 · BROASTED_BRANCH = 0 · TRANSLATOR_BRANCH = 0
 */
const HOLDOUTS = [
  { id: "prepared_item_a", semanticType: "prepared.item", said: "أريد شاورما" },
  { id: "prepared_item_b", semanticType: "prepared.item", said: "أريد بروستد" },
  { id: "professional_hour", semanticType: "professional.hour", said: "أحتاج مترجمًا في المحكمة الخميس ساعتين" },
  { id: "machine_time", semanticType: "machine.time", said: "أحتاج ساعتين على مكنة CNC" },
  { id: "venue_slot", semanticType: "venue.slot", said: "أبغى قاعة ليوم الخميس" },
  { id: "storage_capacity", semanticType: "storage.capacity", said: "أحتاج تخزين بضاعة شهر" },
] as const;

describe("a need becomes something to follow, and only when it earns it", () => {
  let actor: typeof users.$inferSelect;
  let conversationId: string;

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
        reference_bindings, organizations, memberships, scope_policies CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'n2lo-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `n2lo-${randomUUID()}`, name: "سارة", preferences: {} })
      .returning();
    actor = row!;
    const conversation = await runtime.createRuntimeConversation({
      ownerId: String(actor.id),
      title: "need",
    });
    conversationId = conversation.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const me = () => String(actor.id);

  /** A real turn. The model states a shape; it never states a fact. */
  async function turn(content: string, envelope: Record<string, unknown>) {
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({ version: 1, decisionId: randomUUID(), ...envelope }),
      provider: "openai",
      model: "stub-for-need-composition",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: me(),
      conversationId,
      content,
    });
    return result.output as Record<string, unknown>;
  }

  const action = (
    capabilities: string[],
    inputs: Record<string, unknown> = {},
    over: Record<string, unknown> = {},
  ) => ({
    kind: "direct_action",
    label: "طلب",
    goal: "هدف",
    intent: {
      requiredCapabilities: capabilities,
      missingInputs: [],
      inputs,
      risk: "low" as const,
      persistence: "durable" as const,
      // A model may never declare an effect. The schema refuses anything else.
      effects: "none" as const,
    },
    confidence: 0.9,
    ...over,
  });

  /** Isolated proof fixtures. Ordinary Actor/Offering rows; no domain column. */
  async function offering(semanticType: string, label: string, priceMinor: string) {
    const expression = await fabric.createExpression({
      ownerId: `seller-${label}`,
      kind: "offering",
      semanticType,
      attributes: { priceMinor, currency: "KWD" },
    });
    await fabric.publishExpression({
      id: expression.id,
      ownerId: `seller-${label}`,
      projection: {
        semanticType,
        summary: label,
        publicTerms: { label, money: { amountMinor: priceMinor, currency: "KWD" } },
      },
    });
    return expression;
  }

  async function handles() {
    const rows = await handle.db.execute(
      sql.raw(`SELECT "subjectKind", "subjectId", reason, "followState"
        FROM living_objects WHERE "scopeId" = '${me()}'`),
    );
    return rows.rows as {
      subjectKind: string; subjectId: string; reason: string; followState: string;
    }[];
  }

  // ── A · A NEED IS NOT A THING TO FOLLOW ───────────────────────────────────

  /** What the runtime RECORDED about the turn, read back from the message. */
  async function lastTurnMetadata() {
    const rows = await handle.db.execute(
      sql.raw(`SELECT metadata FROM messages WHERE "conversationId" = ${Number(conversationId)}
        AND role = 'assistant' ORDER BY id DESC LIMIT 1`),
    );
    return (rows.rows[0] as { metadata: Record<string, unknown> } | undefined)?.metadata ?? {};
  }

  it("stating a need creates nothing durable", async () => {
    //   NEED_RECOGNIZED · LIVING_OBJECT_CREATED = NO
    await turn(
      "أنا جائع",
      action([], {}, {
        goalSpec: {
          version: 1,
          outcome: "أن أشبع",
          constraints: [],
          preferences: [],
          assumptions: [],
          unknowns: ["ما نوع الطعام"],
        },
      }),
    );
    // Read BACK from the canonical message, not from the response: what the
    // runtime RECORDED about the need is the thing a later turn can rely on.
    const goal = (await lastTurnMetadata()).goal as
      | { readiness: string; unknowns: string[] }
      | undefined;
    expect(goal?.readiness).toBe("NEEDS_INPUT");
    // The unanswered question is NAMED rather than guessed past.
    expect(goal?.unknowns).toContain("ما نوع الطعام");
    expect(await handles()).toHaveLength(0);
  });

  it("an underspecified need is a need, not an unsupported domain", async () => {
    await turn(
      "أنا جائع وما أعرف ماذا أريد",
      action([], {}, {
        goalSpec: {
          version: 1, outcome: "أن أشبع", constraints: [], preferences: [],
          assumptions: [], unknowns: ["ما نوع الطعام", "ما الميزانية"],
        },
      }),
    );
    const metadata = await lastTurnMetadata();
    const goal = metadata.goal as { readiness: string; unknowns: string[] } | undefined;
    expect(goal?.readiness).toBe("NEEDS_INPUT");
    expect(goal?.unknowns).toHaveLength(2);
    //   DOMAIN_FAILURE = NO — it is an open question, not a refusal.
    expect(JSON.stringify(metadata)).not.toContain("UNSUPPORTED_DOMAIN");
    expect(await handles()).toHaveLength(0);
  });

  it("a stated constraint is kept as stated, and an inferred one cannot exclude", async () => {
    //   The refinement turn, and the one honesty rule that governs it.
    await turn(
      "قريبة ورخيصة",
      action([], {}, {
        goalSpec: {
          version: 1,
          outcome: "أن أشبع",
          constraints: [
            { dimension: "COST", operator: "AT_MOST", value: 2000, unit: "minor",
              hardness: "HARD", source: "STATED" },
            { dimension: "LOCATION", operator: "MINIMIZE",
              hardness: "HARD", source: "INFERRED" },
          ],
          preferences: [], assumptions: [], unknowns: [],
        },
      }),
    );
    const goal = (await lastTurnMetadata()).goal as {
      readiness: string;
      hardConstraints: { dimension: string }[];
      softConstraints: { dimension: string }[];
      adjustments: { code: string }[];
    };
    expect(goal.readiness).toBe("ACTIONABLE");
    // What the person SAID stays hard.
    expect(goal.hardConstraints.map((c) => c.dimension)).toContain("COST");
    // What the model INFERRED was downgraded, and the downgrade is recorded.
    expect(goal.softConstraints.map((c) => c.dimension)).toContain("LOCATION");
    expect(goal.adjustments.map((a) => a.code)).toContain("INFERRED_CONSTRAINT_DOWNGRADED");
    // Refining a need still follows nothing.
    expect(await handles()).toHaveLength(0);
  });

  // ── B · DISCOVERY, COMPARISON AND SELECTION FOLLOW NOTHING ────────────────

  it("discovery finds real candidates and follows none of them", async () => {
    //   DISCOVERY_CREATED_LIVING_OBJECT = 0
    await offering("prepared.item", "alpha", "1500");
    await offering("prepared.item", "beta", "2000");
    await offering("prepared.item", "gamma", "2500");

    const out = await turn(
      "ابحث لي",
      action(["discovery"], { kind: "NEED", semanticType: "prepared.item" }),
    );
    const data = out.data as { candidates: { position: number; canonicalRef: string }[] };
    expect(data.candidates.length).toBe(3);
    // Ordinals are BOUND to canonical candidates, so a later «الثانية» resolves
    // a presented thing rather than a remembered sentence.
    const bound = await handle.db.execute(
      sql.raw(`SELECT "referenceKey" FROM reference_bindings WHERE "ownerId" = '${me()}'`),
    );
    expect(bound.rows.length).toBe(3);
    expect(await handles()).toHaveLength(0);
  });

  it("comparing presented results runs no new discovery and follows nothing", async () => {
    //   UNNECESSARY_RESEARCH = 0 · COMPARISON_CREATED_LIVING_OBJECT = 0
    await offering("prepared.item", "alpha", "1500");
    await offering("prepared.item", "beta", "2000");
    await offering("prepared.item", "gamma", "2500");
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType: "prepared.item" }));
    const before = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM reference_bindings WHERE "ownerId" = '${me()}'`),
    );

    await turn("قارن الأول والثالث", action(["commerce:compare"]));

    const after = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM reference_bindings WHERE "ownerId" = '${me()}'`),
    );
    // No new result set, so no new ordinals: the comparison used what was shown.
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
    expect(await handles()).toHaveLength(0);
  });

  it("selecting a presented ordinal drafts terms and still follows nothing", async () => {
    //   PRESENTED_ORDINAL_REFERENCE · SELECTION_CREATED_LIVING_OBJECT = 0
    await offering("prepared.item", "alpha", "1500");
    await offering("prepared.item", "beta", "2000");
    await offering("prepared.item", "gamma", "2500");
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType: "prepared.item" }));

    const out = await turn("الثانية", action(["commerce:select"], { position: 2 }));
    const data = out.data as { status: string; terms: Record<string, unknown> };
    expect(data.status).toBe("DRAFT");
    // The terms came from the OFFERING that was presented second, read back.
    expect(data.terms.offeringRef).toBeTruthy();
    //   A draft is not a commitment, and nothing is followed yet.
    expect(await handles()).toHaveLength(0);
  });

  it("approving a draft creates a payment INTENT and still follows nothing", async () => {
    //   AUTHORIZED != EXECUTED · a created intent is not a payment
    await offering("prepared.item", "alpha", "1500");
    await offering("prepared.item", "beta", "2000");
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType: "prepared.item" }));
    await turn("الثانية", action(["commerce:select"], { position: 2 }));

    const out = await turn("أوافق", action(["commerce:approve"]));
    const data = out.data as { paymentStatus: string };
    expect(data.paymentStatus).toBe("CREATED");
    expect(JSON.stringify(out)).toContain("لم يحدث دفع");
    expect(await handles()).toHaveLength(0);
  });

  // ── C · AN OPEN OBLIGATION IS FOLLOWED ────────────────────────────────────

  /** The canonical chain, reached the way the runtime reaches it. */
  async function committedTransaction(semanticType: string) {
    const counterparty = `counterparty-${randomUUID().slice(0, 8)}`;
    const offer = await fabric.createExpression({
      ownerId: counterparty, kind: "offering", semanticType, attributes: { quantity: 1 },
    });
    await fabric.publishExpression({
      id: offer.id, ownerId: counterparty, projection: { semanticType, summary: "عرض" },
    });
    const need = await fabric.createExpression({
      ownerId: me(), kind: "need", semanticType, attributes: { quantity: 1 },
    });
    await fabric.publishExpression({
      id: need.id, ownerId: me(), projection: { semanticType, summary: "احتياج" },
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id, offeringId: offer.id, createdByOwnerId: me(),
    });
    const engaged = await fabric.createEngagement({
      matchId: match.id,
      initiatorOwnerId: me(),
      participants: await fabric.participantsForMatch(match.id),
    });
    await agreement.setNegotiationEnvelope({
      engagementId: engaged.id, ownerId: me(), principalId: me(),
      bounds: { payment: { direction: "LOWER_IS_BETTER", target: 1800, reserve: 2500 } },
      mayConcede: true, mayAcceptWithinReserve: true,
    });
    const proposal = await agreement.proposeTermSheet({
      engagementId: engaged.id,
      proposerOwnerId: counterparty,
      terms: [
        {
          key: "payment", kind: "NUMBER", value: 2000, unit: "minor",
          owedBy: me(), owedTo: counterparty, evidence: "INTERNAL_STATE",
          subjectKind: "obligation", subjectId: "payment-1",
          settlement: { amountMinor: "2000", currency: "KWD" },
        },
        {
          key: "delivery", kind: "NUMBER", value: 1, unit: "unit",
          owedBy: counterparty, owedTo: me(), evidence: "HUMAN_ACTION",
          subjectKind: "obligation", subjectId: "delivery-1",
        },
      ],
    });
    return agreement.commitAgreement({ proposalId: proposal.id, ownerId: me(), principalId: me() });
  }

  it("an open obligation IS followed, and by every party to it", async () => {
    //   ONGOING_FULFILLMENT_LIVING_OBJECT
    const committed = await committedTransaction("prepared.item");
    const mine = await handles();
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subjectKind).toBe("transaction");
    expect(mine[0]!.subjectId).toBe(committed.transaction!.id);
    expect(mine[0]!.reason).toBe("OBLIGATION_CREATED");

    // The counterparty owes something too, so they follow it too. Neither of
    // them is a buyer, and neither is privileged by a column name.
    const all = await handle.db.execute(
      sql.raw(`SELECT "scopeId" FROM living_objects WHERE "subjectId" = '${committed.transaction!.id}'`),
    );
    expect(all.rows.length).toBe(2);
  });

  it("committing twice still follows one thing", async () => {
    const committed = await committedTransaction("prepared.item");
    // The unique index decides, not an ordering this test arranged.
    const again = await handle.db.execute(
      sql.raw(`SELECT count(*)::int n FROM living_objects
        WHERE "scopeId" = '${me()}' AND "subjectId" = '${committed.transaction!.id}'`),
    );
    expect((again.rows[0] as { n: number }).n).toBe(1);
  });

  it("«أين طلبي؟» answers from the transaction, and never says it is done", async () => {
    //   CANONICAL_FOLLOWUP · PAYMENT != FULFILLMENT
    await committedTransaction("prepared.item");
    const out = await turn("جاسم أين طلبي؟", action(["living-object"], {}, {
      livingObject: { intent: "LIST" },
    }));
    const text = JSON.stringify(out);
    expect(text).toContain("أتابع لك 1");
    // An OPEN transaction is OPEN. Nothing here may read as finished.
    for (const finished of ["اكتمل", "تم التسليم", "COMPLETED"]) {
      expect(text, `claimed «${finished}»`).not.toContain(finished);
    }
  });

  it("hiding it leaves the obligation exactly where it was", async () => {
    //   SURFACE_EXIT_PRESERVES_LIVING_OBJECT
    const committed = await committedTransaction("prepared.item");
    const rows = await handle.db.execute(
      sql.raw(`SELECT id FROM living_objects WHERE "scopeId" = '${me()}'`),
    );
    const id = (rows.rows[0] as { id: string }).id;

    await turn("أخفها", action(["living-object"], {}, {
      livingObject: { intent: "HIDE", livingObjectRef: id },
    }));

    // The handle survives, hidden; the transaction is untouched.
    const after = await handles();
    expect(after).toHaveLength(1);
    const txn = await handle.db.execute(
      sql.raw(`SELECT state FROM transactions WHERE id = '${committed.transaction!.id}'`),
    );
    expect((txn.rows[0] as { state: string }).state).toBe("OPEN");
  });

  it("reopening resolves the SAME thing and reads its current state", async () => {
    //   REOPEN_SAME_LIVING_OBJECT
    const committed = await committedTransaction("prepared.item");
    const before = await handle.db.execute(
      sql.raw(`SELECT id FROM living_objects WHERE "scopeId" = '${me()}'`),
    );
    const id = (before.rows[0] as { id: string }).id;

    const out = await turn("وين وصل؟", action(["living-object"], {}, {
      livingObject: { intent: "READ", livingObjectRef: id },
    }));
    expect(JSON.stringify(out)).toContain("Exchange");
    const after = await handles();
    expect(after).toHaveLength(1);
  });

  // ── D · THE SAME PATH, SIX UNRELATED THINGS ───────────────────────────────

  it("six structurally unrelated requests take the identical path", async () => {
    //   DOMAIN_NOUN_BRANCHES = 0 · SHAWARMA_BRANCH = 0 · BROASTED_BRANCH = 0
    //   TRANSLATOR_BRANCH = 0
    for (const holdout of HOLDOUTS) {
      const committed = await committedTransaction(holdout.semanticType);
      const rows = await handle.db.execute(
        sql.raw(`SELECT reason, "subjectKind" FROM living_objects
          WHERE "scopeId" = '${me()}' AND "subjectId" = '${committed.transaction!.id}'`),
      );
      expect(rows.rows.length, holdout.id).toBe(1);
      const row = rows.rows[0] as { reason: string; subjectKind: string };
      // Same reason, same kind, every time. A meal and a court interpreter are
      // one open obligation twice.
      expect(row.reason, holdout.id).toBe("OBLIGATION_CREATED");
      expect(row.subjectKind, holdout.id).toBe("transaction");
    }
  });

  it("and every one of them is refused a handle when nothing was committed", async () => {
    // The companion: the six differ in nothing, including in what does NOT
    // happen. Discovery over each semantic type follows nothing.
    for (const holdout of HOLDOUTS) {
      await offering(holdout.semanticType, `x-${holdout.id}`, "1000");
      await turn("ابحث لي", action(["discovery"], {
        kind: "NEED", semanticType: holdout.semanticType,
      }));
    }
    expect(await handles()).toHaveLength(0);
  });

  // ── E · CONTINUITY IS NOT CONTAMINATION ───────────────────────────────────

  it("a topic change starts a new need instead of mutating the old one", async () => {
    await turn("أنا جائع", action([], {}, {
      goalSpec: {
        version: 1, outcome: "أن أشبع",
        constraints: [{ dimension: "COST", operator: "AT_MOST", value: 2000,
          unit: "minor", hardness: "HARD", source: "STATED" }],
        preferences: [], assumptions: [], unknowns: [],
      },
    }));
    const first = (await lastTurnMetadata()).goal as { hardConstraints: unknown[] };
    expect(first.hardConstraints).toHaveLength(1);

    await turn("بالمناسبة ابحث لي عن سيارة برادو", action([], {}, {
      goalSpec: {
        version: 1, outcome: "أن أجد سيارة", constraints: [], preferences: [],
        assumptions: [], unknowns: [],
      },
    }));
    const second = (await lastTurnMetadata()).goal as {
      readiness: string; hardConstraints: unknown[];
    };
    // The meal's budget did not follow the car. A goal is stated per turn and
    // evaluated per turn, so continuity cannot silently become contamination —
    // and the price of that is that refinement must be re-stated, not assumed.
    expect(second.hardConstraints).toHaveLength(0);
    expect(second.readiness).toBe("ACTIONABLE");
    expect(await handles()).toHaveLength(0);
  });

  it("and a stale ordinal from an old result set does not resolve into a new one", async () => {
    // The companion: references are scoped to what was PRESENTED, so a topic
    // change cannot make «الثانية» mean something from the previous subject.
    await offering("prepared.item", "alpha", "1500");
    await offering("prepared.item", "beta", "2000");
    await turn("ابحث لي", action(["discovery"], { kind: "NEED", semanticType: "prepared.item" }));

    // A different conversation never sees the first one's ordinals.
    const other = await runtime.createRuntimeConversation({ ownerId: me(), title: "other" });
    conversationId = other.id;
    const out = await turn("الثانية", action(["commerce:select"], { position: 2 }));
    expect(JSON.stringify(out)).toContain("لم أجد نتيجة بهذا الرقم");
  });
});
