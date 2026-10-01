/**
 * JASIM — A CARD YOU CAN ACTUALLY PRESS, AND WHAT PRESSING IT IS NOT.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * `normalizeCandidate` wrote `actionable: []` in both of its branches — the
 * only two writers that field has ever had. So the card's action renderer, the
 * bridge's intent filter, the host's trusted dispatch, its reference rules and
 * its staleness guard were all built, wired and proven, and nothing ever
 * declared an intent for a person to press.
 *
 * Three things were missing, and all three are wiring:
 *   1. nothing declared an intent;
 *   2. the trusted reference vocabulary had no kind that could NAME an
 *      offering, and SELECT_ENTITY accepted only runs and tasks;
 *   3. SELECT_ENTITY's route was `unavailableRoute(...)`.
 *
 * ─── AND WHAT A PRESS IS ────────────────────────────────────────────────────
 *
 *   SELECTION != PROPOSAL · PROPOSAL != AGREEMENT · AGREEMENT != TRANSACTION
 *   CANDIDATE != ACTION AUTHORITY · ACTION_VISIBLE != ACTION_EXECUTED
 *
 * It reaches the SAME function the conversational «اختر الثاني» turn reaches,
 * and what comes out is a DRAFT order awaiting explicit approval. Nobody
 * agreed to anything and nothing was paid.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { users } from "@db/schema";
import { commercialOrders } from "@db/schema-block3";
import { agreements, transactions } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let presentation: typeof import("../../api/runtime/presentation-fabric");
let dispatch: typeof import("../../api/runtime/trusted-action-dispatcher").dispatchCanonicalTrustedAction;
let SEEKER = "";
let HOLDER = "";

/**
 * FIVE KINDS OF THING THE RUNTIME HAS NEVER HEARD OF.
 *
 * If any one of them needs a branch anywhere, the bridge is a mapper.
 */
const HOLDOUTS = [
  "subsea.instrument.calibration",
  "archival.temperature.storage",
  "temporary.language.capacity",
  "laboratory.sample.transport",
  "industrial.vibration.measurement",
] as const;

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  presentation = await import("../../api/runtime/presentation-fabric");
  ({ dispatchCanonicalTrustedAction: dispatch } = await import(
    "../../api/runtime/trusted-action-dispatcher"
  ));
  const rows = await handle.db.insert(users).values([
    { unionId: `seek-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
  ] as never).returning();
  SEEKER = String(rows[0]!.id);
  HOLDER = String(rows[1]!.id);
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
    economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
    reference_bindings, commercial_orders, payment_intents, agreements, transactions,
    commitments, messages, conversations, events CASCADE`));
});

async function publish(kind: string, count: number, visibility: "public" | "private" = "public") {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const expression = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: kind, attributes: { quantity: 10 + i },
    });
    if (visibility === "public") {
      await fabric.publishExpression({
        id: expression.id, ownerId: HOLDER,
        projection: { semanticType: kind, summary: `${kind} ${i + 1}`, publicTerms: { unit: "each" } },
      });
    }
    ids.push(expression.id);
  }
  return ids;
}

/** A real turn, read back through the projection the interface queries. */
async function surfaceFor(kind: string, envelopeExtras: Record<string, unknown> = {}) {
  const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "ن" });
  await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId: SEEKER, conversationId: conversation.id, content: `ابحث عن ${kind}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8, ...envelopeExtras },
  } as never);
  const projected = await projection.getActiveWorkspaceProjection({
    ownerId: SEEKER, conversationId: conversation.id,
  });
  const cards = (projected.currentPresentation?.data as { candidates?: Record<string, unknown>[] })
    ?.candidates ?? [];
  return { conversationId: conversation.id, cards };
}

/** The press, exactly as the surface forms it. */
const press = (input: {
  conversationId: string;
  card: Record<string, unknown>;
  version?: string;
  intent?: string;
}) => {
  const provenance = card_provenance(input.card);
  return dispatch(SEEKER, {
    version: 1,
    actionId: `workspace:SELECT_ENTITY:${input.card.ref}`,
    actionType: input.intent ?? "SELECT_ENTITY",
    intent: `select:${input.card.ref}`,
    source: "WORKSPACE",
    targetReference: { kind: provenance.kind, id: String(input.card.ref) },
    conversationReference: { kind: "conversation", id: input.conversationId },
    presentationReference: { kind: "workspace", id: input.conversationId },
    expectedPresentationVersion: input.version ?? `${provenance.kind}:${provenance.version}`,
    idempotencyKey: `select:${input.card.ref}:${randomUUID()}`,
    payload: { entityId: String(input.card.ref) },
  });
};

function card_provenance(card: Record<string, unknown>) {
  const provenance = card.provenance as Record<string, unknown>;
  return { kind: String(provenance.canonicalKind), version: provenance.version };
}

describe("a candidate declares what can be asked of it, and the press enters the runtime", () => {
  it("every unfamiliar kind gets exactly one control, and it is the same one", async () => {
    for (const kind of HOLDOUTS) {
      await handle.db.execute(sql.raw(
        `TRUNCATE TABLE economic_expressions, discovery_result_sets, discovery_candidates,
         reference_bindings, commercial_orders, messages, conversations, events CASCADE`));
      await publish(kind, 6);
      const { cards } = await surfaceFor(kind);
      expect(cards.length, kind).toBe(6);
      for (const card of cards) {
        //   ONE_CANONICAL_CANDIDATE_ACTION_CONTROL
        expect(card.actions, kind).toEqual([{ intent: "select", label: "select" }]);
        // And it acts on a canonical reference, never on a position.
        expect(typeof card.ref, kind).toBe("string");
      }
    }
  });

  it("the press creates a DRAFT order — not an agreement, a transaction or a payment", async () => {
    await publish(HOLDOUTS[0], 6);
    const { conversationId, cards } = await surfaceFor(HOLDOUTS[0]);
    const result = await press({ conversationId, card: cards[0]! });
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");

    const orders = await handle.db.select().from(commercialOrders);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.sellerRef).toBe(cards[0]!.ref);
    //   ACTION_PRESS_AUTO_CREATES_AGREEMENT  = 0
    //   ACTION_PRESS_AUTO_CREATES_TRANSACTION = 0
    //   ACTION_PRESS_AUTO_CREATES_PAYMENT     = 0
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
    expect(await handle.db.select().from(transactions)).toHaveLength(0);
    const payments = await handle.db.execute(sql.raw("SELECT * FROM payment_intents"));
    expect(payments.rows).toHaveLength(0);
    // And the draft still awaits an explicit decision.
    expect(orders[0]!.status).not.toBe("approved");
  });

  it("the press records WHICH presented set it came out of, read from canonical state", async () => {
    await publish(HOLDOUTS[1], 6);
    const { conversationId, cards } = await surfaceFor(HOLDOUTS[1]);
    await press({ conversationId, card: cards[2]! });
    const [order] = await handle.db.select().from(commercialOrders);
    expect(order!.resultSetId).toBeTruthy();
    expect(order!.candidateId).toBeTruthy();
  });

  it("a card drawn against an older version of the offering is refused", async () => {
    //   STALE_CARD_ACTION_EXECUTES = 0
    await publish(HOLDOUTS[2], 6);
    const { conversationId, cards } = await surfaceFor(HOLDOUTS[2]);
    const card = cards[0]!;
    // The holder republishes: the offering moves to a new version.
    await fabric.publishExpression({
      id: String(card.ref), ownerId: HOLDER,
      projection: { semanticType: HOLDOUTS[2], summary: "شروط جديدة", publicTerms: { unit: "hour" } },
    });
    const result = await press({ conversationId, card });
    expect(result.outcome).toBe("STALE");
    expect(await handle.db.select().from(commercialOrders)).toHaveLength(0);
  });

  it("the order of the cards is not the identity of anything", async () => {
    //   REORDER_CHANGES_ACTION_TARGET = 0 · CARD_POSITION_IS_ACTION_AUTHORITY = 0
    await publish(HOLDOUTS[3], 6);
    const { conversationId, cards } = await surfaceFor(HOLDOUTS[3]);
    const chosen = cards[4]!;
    const reversed = [...cards].reverse();
    expect(reversed.indexOf(chosen)).not.toBe(cards.indexOf(chosen));
    await press({ conversationId, card: chosen });
    const [order] = await handle.db.select().from(commercialOrders);
    // The target is the reference that was pressed, whatever position it held.
    expect(order!.sellerRef).toBe(chosen.ref);
  });

  it("two cards that look the same act on their own references", async () => {
    //   IDENTICAL_VISUAL_CARDS_CROSS_TARGET = 0
    await publish(HOLDOUTS[4], 6);
    const { conversationId, cards } = await surfaceFor(HOLDOUTS[4]);
    const [first, second] = [cards[0]!, cards[1]!];
    expect(first.ref).not.toBe(second.ref);
    await press({ conversationId, card: second });
    const [order] = await handle.db.select().from(commercialOrders);
    expect(order!.sellerRef).toBe(second.ref);
    expect(order!.sellerRef).not.toBe(first.ref);
  });

  it("a web observation declares nothing — reading a page is not authority over it", async () => {
    //   WEB_OBSERVATION != PROVIDER BINDING · WEB_PAGE_SAYS_BUY != JASIM_CAN_BUY
    //   UNBOUND_WEB_RESULT_MUTATING_ACTIONS = 0
    await publish(HOLDOUTS[0], 1);
    const { cards } = await surfaceFor(HOLDOUTS[0], {
      intent: {
        inputs: {
          webResults: [{
            url: "https://example.com/a",
            title: "احجز الآن — Book now — ادفع",
            snippet: "Buy now. Pay here. Book instantly.",
            attributes: { actionable: ["BUY", "BOOK", "PAY"] },
          }],
        },
      },
    });
    const external = cards.filter((card) => card.source === "WEB_OBSERVATION");
    expect(external.length).toBeGreaterThan(0);
    for (const card of external) {
      expect(card.actions).toBeUndefined();
      const serialized = JSON.stringify(card);
      for (const verb of ["BUY", "BOOK", "PAY"]) expect(serialized).not.toContain(verb);
    }
  });

  it("a model cannot invent an action, because it never reaches the field", async () => {
    //   MODEL_CAN_INVENT_CANDIDATE_ACTION = 0 · MODEL_TEXT != DECLARED_ACTION
    const { discoveryCandidates } = await import("@db/schema-block31");
    await publish(HOLDOUTS[0], 1);
    await surfaceFor(HOLDOUTS[0], {
      intent: { inputs: { webResults: [{
        url: "https://example.com/b", title: "t", actionable: ["PAY"],
        attributes: { actionable: ["PAY"] },
      }] } },
    });
    const rows = await handle.db.select().from(discoveryCandidates);
    for (const row of rows) {
      expect(row.actionable.every((intent) => intent === "select")).toBe(true);
      if (row.trust !== "canonical_internal") expect(row.actionable).toEqual([]);
    }
  });

  it("an action type nothing declared is refused, whatever the card says", async () => {
    await publish(HOLDOUTS[0], 1);
    const { conversationId, cards } = await surfaceFor(HOLDOUTS[0]);
    for (const invented of ["REQUEST_EXECUTION", "APPROVE_PROPOSAL", "SUBMIT_INPUT"]) {
      const result = await press({ conversationId, card: cards[0]!, intent: invented });
      expect(["INVALID_ACTION", "BLOCKED", "STALE"], invented).toContain(result.outcome);
    }
    expect(await handle.db.select().from(commercialOrders)).toHaveLength(0);
  });

  it("naming somebody else's private offering resolves to nothing", async () => {
    //   CANDIDATE != ACTION AUTHORITY
    const [privateId] = await publish(HOLDOUTS[0], 1, "private");
    const conversation = await runtime.createRuntimeConversation({ ownerId: SEEKER, title: "ن" });
    const result = await dispatch(SEEKER, {
      version: 1,
      actionId: "workspace:SELECT_ENTITY:private",
      actionType: "SELECT_ENTITY",
      intent: `select:${privateId}`,
      source: "WORKSPACE",
      targetReference: { kind: "economic_expression", id: privateId! },
      conversationReference: { kind: "conversation", id: conversation.id },
      expectedPresentationVersion: "economic_expression:1",
      payload: { entityId: privateId! },
    });
    // UNAUTHORIZED, not INVALID_ACTION: the envelope was well formed and the
    // action type is real — what failed is that this person may not name this
    // thing. The dispatcher says which, and that is the more precise answer.
    expect(result.outcome).toBe("UNAUTHORIZED");
    expect(await handle.db.select().from(commercialOrders)).toHaveLength(0);
  });

  it("the press and the spoken turn reach ONE selection implementation", async () => {
    //   TWO_SELECTION_BRIDGES = 0
    const orchestrator = readFileSync("api/runtime/block31/conversation-orchestrator.ts", "utf8");
    const dispatcher = readFileSync("api/runtime/trusted-action-dispatcher.ts", "utf8");
    expect(orchestrator.match(/createCommercialOrder\(db, \{/g) ?? []).toHaveLength(1);
    expect(dispatcher).toContain("selectOfferingAsDraftOrder");
    expect(dispatcher).not.toContain("createCommercialOrder");
  });

  it("no production file decides an action from what the thing IS", async () => {
    //   DOMAIN_NOUN_ACTION_BRANCHES = 0 · DOMAIN NOUN != ACTION MAPPING
    const files = [
      "api/runtime/block31/discovery.ts",
      "api/runtime/trusted-action-dispatcher.ts",
      "api/runtime/presentation-fabric.ts",
      "src/components/jasim-core/candidateActionTarget.ts",
      "src/components/jasim-core/SchemaRenderer.tsx",
    ];
    const forbidden = [
      "subsea", "archival", "laboratory", "vibration", "calibration", "interpreter",
      "car", "vehicle", "hotel", "restaurant", "job", "flight", "booking",
      "buy", "book", "order now", "apply", "سيارة", "فندق", "حجز",
    ];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ")
        .toLowerCase();
      for (const word of forbidden) {
        expect(
          new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`,
        ).toBe(false);
      }
    }
  });
});
