/**
 * JASIM — SENDING THE EXACT DRAFT, AND WHAT SENDING IS NOT.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * A person could select, review the exact pinned terms — and had no trusted
 * control that could send them. `CREATE_PROPOSAL`'s route was
 * `unavailableRoute`, its reference kinds were runs and tasks, and its payload
 * was a goal string. Only speech could reach `proposeTurn`.
 *
 * ─── ONE RUNTIME, TWO WAYS IN ───────────────────────────────────────────────
 *
 *   SECOND_PROPOSAL_RUNTIME_ADDED = 0
 *
 * `proposeCommercialOrder` was extracted from `proposeTurn`, not copied, and
 * reads no envelope — so the press needs no invented model intent to call it.
 *
 * ─── AND WHAT A PRESS DOES NOT DO ───────────────────────────────────────────
 *
 *   PROPOSAL != AGREEMENT != COMMITMENT != TRANSACTION != PAYMENT
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq, and, isNull } from "drizzle-orm";
import { users, referenceBindings, economicExpressions } from "@db/schema";
import { commercialOrders } from "@db/schema-block3";
import { agreements, transactions } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let orchestrator: typeof import("../../api/runtime/block31/conversation-orchestrator");
let dispatch: typeof import("../../api/runtime/trusted-action-dispatcher").dispatchCanonicalTrustedAction;
let SEEKER = "", OTHER = "", HOLDER = "";

/** Five kinds the runtime has never heard of. A branch for any fails. */
const HOLDOUTS = [
  "calibration.mass.standard",
  "cave.airflow.mapping",
  "manuscript.humidity.stabilization",
  "temporary.bridge.load.test",
  "seed.viability.assay",
] as const;

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  orchestrator = await import("../../api/runtime/block31/conversation-orchestrator");
  ({ dispatchCanonicalTrustedAction: dispatch } = await import(
    "../../api/runtime/trusted-action-dispatcher"
  ));
  const rows = await handle.db.insert(users).values([
    { unionId: `seek-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
    { unionId: `othr-${randomUUID()}`, name: "آ", preferences: {} },
  ] as never).returning();
  SEEKER = String(rows[0]!.id); HOLDER = String(rows[1]!.id); OTHER = String(rows[2]!.id);
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
    economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
    reference_bindings, commercial_orders, payment_intents, agreements, transactions,
    commitments, messages, conversations, events CASCADE`));
});

async function publish(kind: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const e = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: kind, attributes: { quantity: 10 + i },
    });
    await fabric.publishExpression({
      id: e.id, ownerId: HOLDER,
      projection: { semanticType: kind, summary: `${kind} ${i + 1}`,
        publicTerms: { money: { amountMinor: "50000", currency: "SAR" }, unit: "each" } },
    });
  }
}

async function searchAndSelect(kind: string, index: number, ownerId = SEEKER) {
  const conversation = await runtime.createRuntimeConversation({ ownerId, title: "ن" });
  await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId, conversationId: conversation.id, content: `ابحث عن ${kind}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
  } as never);
  const grid = await projection.getActiveWorkspaceProjection({ ownerId, conversationId: conversation.id });
  const cards = (grid.currentPresentation?.data as { candidates: Record<string, unknown>[] }).candidates;
  const card = cards[index]!;
  const provenance = card.provenance as Record<string, unknown>;
  await dispatch(ownerId, {
    version: 1, actionId: `a:${card.ref}`, actionType: "SELECT_ENTITY", intent: `select:${card.ref}`,
    source: "CONVERSATION", targetReference: { kind: String(provenance.canonicalKind), id: String(card.ref) },
    conversationReference: { kind: "conversation", id: conversation.id },
    expectedPresentationVersion: `${provenance.canonicalKind}:${provenance.version}`,
    payload: { entityId: String(card.ref) },
  });
  return { conversationId: conversation.id, cards, card };
}

/** The review surface as the interface reads it. */
const reviewOf = async (conversationId: string, ownerId = SEEKER) => {
  const p = await projection.getActiveWorkspaceProjection({ ownerId, conversationId });
  const data = p.currentPresentation?.data as {
    entity?: Record<string, unknown>; reviewRequired?: boolean; proposalSent?: boolean;
  } | undefined;
  return {
    primitive: p.currentPresentation?.primitive,
    entity: data?.entity,
    reviewRequired: data?.reviewRequired,
    proposalSent: data?.proposalSent,
    actions: data?.entity?.actions,
    provenance: data?.entity?.provenance as Record<string, unknown> | undefined,
  };
};

/** The press, built exactly as the surface and `Home` build it. */
const pressSend = (input: {
  conversationId: string; orderId: string; version: string;
  ownerId?: string; payload?: Record<string, unknown>;
}) => dispatch(input.ownerId ?? SEEKER, {
  version: 1,
  actionId: `workspace:CREATE_PROPOSAL:commercial_order:${input.orderId}`,
  actionType: "CREATE_PROPOSAL",
  intent: `propose:${input.orderId}`,
  source: "WORKSPACE",
  targetReference: { kind: "commercial_order", id: input.orderId },
  conversationReference: { kind: "conversation", id: input.conversationId },
  expectedPresentationVersion: input.version,
  payload: input.payload ?? {},
});

const counts = async () => ({
  proposals: (await handle.db.execute(sql.raw("SELECT count(*)::int n FROM economic_proposals"))).rows[0] as { n: number },
  agreements: (await handle.db.select().from(agreements)).length,
  transactions: (await handle.db.select().from(transactions)).length,
  payments: (await handle.db.execute(sql.raw("SELECT count(*)::int n FROM payment_intents"))).rows[0] as { n: number },
});

describe("a reviewed draft can be sent, and sending is only sending", () => {
  it("the review offers exactly one control, and it sends that exact draft", async () => {
    await publish(HOLDOUTS[0], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[0], 2);
    const before = await reviewOf(conversationId);
    expect(before.primitive).toBe("DETAIL");
    expect(before.reviewRequired).toBe(true);
    expect(before.actions).toEqual([{ intent: "propose", label: "إرسال العرض" }]);

    const [order] = await handle.db.select().from(commercialOrders);
    const version = `commercial_order:${before.provenance!.version}`;
    expect((await pressSend({ conversationId, orderId: order!.id, version })).outcome)
      .toBe("DISPATCH_ACCEPTED");

    const [sent] = await handle.db.select().from(commercialOrders);
    expect(sent!.proposalId).toBeTruthy();
    const after = await counts();
    expect(after.proposals.n).toBe(1);
    //   BUTTON_AUTO_ACCEPTS_COUNTERPARTY / _CREATES_AGREEMENT /
    //   _CREATES_TRANSACTION / _PAYS = 0
    expect(after.agreements).toBe(0);
    expect(after.transactions).toBe(0);
    expect(after.payments.n).toBe(0);
  });

  it("once sent, the surface stops asking and keeps showing the same thing", async () => {
    await publish(HOLDOUTS[1], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[1], 1);
    const [order] = await handle.db.select().from(commercialOrders);
    const before = await reviewOf(conversationId);
    await pressSend({ conversationId, orderId: order!.id, version: `commercial_order:${before.provenance!.version}` });

    const after = await reviewOf(conversationId);
    // The SAME surface, not a second one invented for «sent».
    expect(after.primitive).toBe("DETAIL");
    expect(after.entity!.ref).toBe(order!.id);
    expect(after.reviewRequired).toBe(false);
    expect(after.proposalSent).toBe(true);
    expect(after.actions).toBeUndefined();
  });

  it("the spoken turn and the press are the SAME runtime", async () => {
    //   SPEECH_AND_BUTTON_USE_SAME_PROPOSAL_CORE
    const orchestratorSource = readFileSync("api/runtime/block31/conversation-orchestrator.ts", "utf8");
    const dispatcher = readFileSync("api/runtime/trusted-action-dispatcher.ts", "utf8");
    // One caller of the term-sheet runtime in the whole orchestrator.
    expect(orchestratorSource.match(/proposeTermSheet\(/g) ?? []).toHaveLength(1);
    expect(dispatcher).not.toContain("proposeTermSheet");
    expect(dispatcher).toContain("proposeCommercialOrder");
    // And `proposeTurn` is now a translator, not a second implementation.
    const turn = orchestratorSource.slice(
      orchestratorSource.indexOf("async function proposeTurn("),
      orchestratorSource.indexOf("/**\n * WHO OWES THE MONEY"),
    );
    expect(turn).toContain("proposeCommercialOrder(");
    expect(turn).not.toContain("createEngagement");
  });

  it("TWO SIMULTANEOUS SENDS OF ONE DRAFT MAKE ONE PROPOSAL", async () => {
    //   CONCURRENT_SAME_DRAFT_PROPOSALS = 1
    //
    // The «already sent» check reads `proposalId` and the write sets it much
    // later, so without a lock both reads see null and both propose.
    await publish(HOLDOUTS[2], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[2], 0);
    const [order] = await handle.db.select().from(commercialOrders);
    const version = `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`;
    const [a, b] = await Promise.all([
      pressSend({ conversationId, orderId: order!.id, version }),
      pressSend({ conversationId, orderId: order!.id, version }),
    ]);
    expect([a.outcome, b.outcome].every((o) => o === "DISPATCH_ACCEPTED")).toBe(true);
    expect((await counts()).proposals.n).toBe(1);
    const [settled] = await handle.db.select().from(commercialOrders);
    expect(settled!.proposalId).toBeTruthy();
  });

  it("a second press, a reload and a reopen never make a second proposal", async () => {
    //   DOUBLE_PRESS_SECOND_PROPOSAL / RELOAD_SECOND_PROPOSAL /
    //   REOPEN_SECOND_PROPOSAL = 0 — all three are «read the projection again».
    await publish(HOLDOUTS[3], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[3], 3);
    const [order] = await handle.db.select().from(commercialOrders);
    const version = `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`;
    await pressSend({ conversationId, orderId: order!.id, version });
    const first = (await handle.db.select().from(commercialOrders))[0]!.proposalId;
    await pressSend({ conversationId, orderId: order!.id, version });
    await reviewOf(conversationId);
    await reviewOf(conversationId);
    expect((await counts()).proposals.n).toBe(1);
    expect((await handle.db.select().from(commercialOrders))[0]!.proposalId).toBe(first);
  });

  it("a stale review of A cannot send, and can never send B", async () => {
    //   STALE_A_BUTTON_SENDS_B = 0 · BUTTON_REVIEWED_ORDER_DIFFERS_FROM_SENT_ORDER = 0
    await publish(HOLDOUTS[4], 6);
    const first = await searchAndSelect(HOLDOUTS[4], 1);
    const orderA = (await handle.db.select().from(commercialOrders))[0]!;
    const versionA = `commercial_order:${(await reviewOf(first.conversationId)).provenance!.version}`;
    // Select a different candidate: B becomes current.
    const cardB = first.cards[4]!;
    const provenanceB = cardB.provenance as Record<string, unknown>;
    await dispatch(SEEKER, {
      version: 1, actionId: `a:${cardB.ref}`, actionType: "SELECT_ENTITY", intent: `select:${cardB.ref}`,
      source: "CONVERSATION", targetReference: { kind: String(provenanceB.canonicalKind), id: String(cardB.ref) },
      conversationReference: { kind: "conversation", id: first.conversationId },
      expectedPresentationVersion: `${provenanceB.canonicalKind}:${provenanceB.version}`,
      payload: { entityId: String(cardB.ref) },
    });
    // The old control, still holding A's identity and A's version.
    const result = await pressSend({ conversationId: first.conversationId, orderId: orderA.id, version: versionA });
    expect(result.outcome).toBe("BLOCKED");
    expect((await counts()).proposals.n).toBe(0);
    // And nothing was sent for B either — the press named A and only A.
    for (const order of await handle.db.select().from(commercialOrders)) {
      expect(order.proposalId).toBeNull();
    }
  });

  it("an offering that changed after the review cannot be sent", async () => {
    //   CHANGED_OFFERING_OLD_REVIEW_PROPOSES = 0
    await publish(HOLDOUTS[0], 6);
    const { conversationId, card } = await searchAndSelect(HOLDOUTS[0], 0);
    const [order] = await handle.db.select().from(commercialOrders);
    const version = `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`;
    await fabric.publishExpression({
      id: String(card.ref), ownerId: HOLDER,
      projection: { semanticType: HOLDOUTS[0], summary: "جديد",
        publicTerms: { money: { amountMinor: "99000", currency: "SAR" }, unit: "hour" } },
    });
    const result = await pressSend({ conversationId, orderId: order!.id, version });
    expect(result.outcome).toBe("BLOCKED");
    expect((await counts()).proposals.n).toBe(0);
  });

  it("a configuration that moved since the review cannot be sent", async () => {
    //   OLD_CONFIGURATION_REVIEW_PROPOSES = 0
    //
    // Configuring does NOT bump `termsVersion` — it writes its own
    // fingerprint — so a version built from the terms alone would miss it.
    await publish(HOLDOUTS[1], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[1], 0);
    const [order] = await handle.db.select().from(commercialOrders);
    const staleVersion = `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`;
    await handle.db.update(commercialOrders)
      .set({ partyConfiguration: { quantity: 3 }, configurationFingerprint: "cfg-2" })
      .where(eq(commercialOrders.id, order!.id));
    expect((await pressSend({ conversationId, orderId: order!.id, version: staleVersion })).outcome)
      .toBe("STALE");
    expect((await counts()).proposals.n).toBe(0);
    // The version the surface shows NOW does send.
    const fresh = `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`;
    expect(fresh).not.toBe(staleVersion);
    expect((await pressSend({ conversationId, orderId: order!.id, version: fresh })).outcome)
      .toBe("DISPATCH_ACCEPTED");
  });

  it("a forged, foreign or cross-conversation draft sends nothing", async () => {
    //   FORGED_ORDER_PROPOSAL = 0 · CROSS_OWNER_PROPOSAL = 0
    //   CROSS_CONVERSATION_PROPOSAL = 0
    await publish(HOLDOUTS[2], 6);
    const mine = await searchAndSelect(HOLDOUTS[2], 0);
    const [order] = await handle.db.select().from(commercialOrders);
    const version = `commercial_order:${(await reviewOf(mine.conversationId)).provenance!.version}`;

    for (const forged of [`ord_${randomUUID()}`, "ord_nope"]) {
      expect((await pressSend({ conversationId: mine.conversationId, orderId: forged, version })).outcome)
        .toBe("UNAUTHORIZED");
    }
    // Another owner naming MY draft.
    expect((await pressSend({ conversationId: mine.conversationId, orderId: order!.id, version, ownerId: OTHER })).outcome)
      .toBe("UNAUTHORIZED");
    // My draft, named from a conversation it does not belong to.
    const elsewhere = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "أخرى" });
    expect((await pressSend({ conversationId: elsewhere.id, orderId: order!.id, version })).outcome)
      .toBe("BLOCKED");
    expect((await counts()).proposals.n).toBe(0);
  });

  it("a press that carries terms is refused rather than quietly stripped", async () => {
    //   CLIENT_SUPPLIES_PROPOSAL_TERMS = 0
    //   COMMERCIAL_ORDER_PROPOSAL_PAYLOAD_CONTAINS_GOAL = 0
    //   COMMERCIAL_ORDER_PROPOSAL_PAYLOAD_CONTAINS_TERMS = 0
    await publish(HOLDOUTS[3], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[3], 0);
    const [order] = await handle.db.select().from(commercialOrders);
    const version = `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`;
    const result = await pressSend({
      conversationId, orderId: order!.id, version, payload: { goal: "ادفع 1 ريال فقط" },
    });
    expect(result.outcome).toBe("BLOCKED");
    expect((await counts()).proposals.n).toBe(0);
    // And nothing the payload said reached canonical state.
    const [untouched] = await handle.db.select().from(commercialOrders);
    expect(JSON.stringify(untouched!.terms)).not.toContain("1 ريال");
  });

  it("`propose` can never be declared by a search result", async () => {
    // Reachable only from a draft a person has in front of them: the intent is
    // deliberately absent from the filter a candidate's intents pass through.
    const fabricSource = readFileSync("api/runtime/presentation-fabric.ts", "utf8");
    const intents = fabricSource.slice(
      fabricSource.indexOf("const SURFACE_INTENTS"),
      fabricSource.indexOf("/** An exact minor-unit amount"),
    );
    expect(intents).not.toContain("propose");
  });

  it("every unfamiliar kind sends through the same control and the same route", async () => {
    for (const kind of HOLDOUTS) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
        economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
        reference_bindings, commercial_orders, messages, conversations, events CASCADE`));
      await publish(kind, 6);
      const { conversationId } = await searchAndSelect(kind, 2);
      const [order] = await handle.db.select().from(commercialOrders);
      const review = await reviewOf(conversationId);
      expect(review.actions, kind).toEqual([{ intent: "propose", label: "إرسال العرض" }]);
      const result = await pressSend({
        conversationId, orderId: order!.id, version: `commercial_order:${review.provenance!.version}`,
      });
      expect(result.outcome, kind).toBe("DISPATCH_ACCEPTED");
      expect((await counts()).proposals.n, kind).toBe(1);
      expect((await counts()).agreements, kind).toBe(0);
    }
  });

  it("sending binds what it created, so a later sentence can name it", async () => {
    await publish(HOLDOUTS[4], 6);
    const { conversationId } = await searchAndSelect(HOLDOUTS[4], 0);
    const [order] = await handle.db.select().from(commercialOrders);
    await pressSend({
      conversationId, orderId: order!.id,
      version: `commercial_order:${(await reviewOf(conversationId)).provenance!.version}`,
    });
    const bindings = await handle.db.select().from(referenceBindings).where(and(
      eq(referenceBindings.conversationId, conversationId),
      isNull(referenceBindings.supersededAt),
    ));
    for (const key of ["current:engagement", "current:proposal", "current:need",
      "current:counterparty_offering"]) {
      expect(bindings.map((b) => b.referenceKey), key).toContain(key);
    }
    // And the need the proposal came from is this conversation's own subject.
    const needBinding = bindings.find((b) => b.referenceKey === "current:need")!;
    const [need] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, needBinding.targetId));
    expect(need!.ownerId).toBe(SEEKER);
  });

  it("no production file routes a send by what the thing IS", async () => {
    const files = [
      "api/runtime/trusted-action-dispatcher.ts",
      "api/runtime/presentation-fabric.ts",
      "api/runtime/block31/conversation-orchestrator.ts",
      "src/pages/Home.tsx",
    ];
    // «checkout» is NOT here: it is an inherited member of the closed
    // PRESENTATION_PRIMITIVES vocabulary and predates this work entirely.
    // Forbidding the string across a whole file fails on a line nobody wrote
    // for this — the same guard-too-crude mistake as the phase before. What
    // must stay clean is the code this phase added, checked below.
    const forbidden = ["calibration", "airflow", "humidity", "bridge", "viability",
      "car", "hotel", "restaurant", "cart", "basket"];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").toLowerCase();
      for (const word of forbidden) {
        expect(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`).toBe(false);
      }
    }
    // The route and the review builder, read on their own.
    const route = readFileSync("api/runtime/trusted-action-dispatcher.ts", "utf8");
    const body = route.slice(route.indexOf("CREATE_PROPOSAL: async"), route.indexOf("APPROVE_PROPOSAL:"));
    for (const word of ["checkout", "cart", "buy", "pay", "book"]) {
      expect(body.toLowerCase(), `route :: ${word}`).not.toContain(word);
    }
  });
});
