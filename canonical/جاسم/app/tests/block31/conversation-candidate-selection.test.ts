/**
 * JASIM — THE SAME CONTROL, IN A DIFFERENT PLACE, REACHING THE SAME BOUNDARY.
 *
 * ─── THE DEFECT, TRACED ─────────────────────────────────────────────────────
 *
 * Once a draft review takes the host, the discovery grid returns to its own
 * message — and its select controls went to `handleActionClick`, which needs a
 * REGISTERED SMART BUBBLE and otherwise answers «لا يملك سطحًا موثوقًا متاحًا
 * الآن». Six controls that looked exactly as pressable as before, and were not.
 *
 *   VISIBLE_CONTROL != EXECUTION_PERMISSION
 *
 * ─── AND THE BUBBLE WAS NEVER THE SERVER'S IDEA ─────────────────────────────
 *
 * The dispatcher reads the action type, the reference kind, the payload, the
 * presentation version, and whether the reference resolves under this owner.
 * It reads neither `source` nor `presentationReference` and has no notion of a
 * bubble. So the requirement was a CLIENT ROUTING ASSUMPTION, and the fix is
 * to reach the boundary that already existed.
 *
 *   MESSAGE != SMART_BUBBLE · MESSAGE_METADATA != EXECUTION_AUTHORITY
 *
 * Everything below drives that boundary exactly as the browser now does.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq, isNull, and } from "drizzle-orm";
import { users, referenceBindings } from "@db/schema";
import { commercialOrders } from "@db/schema-block3";
import { agreements, transactions } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let dispatch: typeof import("../../api/runtime/trusted-action-dispatcher").dispatchCanonicalTrustedAction;
let SEEKER = "";
let OTHER = "";
let HOLDER = "";

/** Five unrelated kinds. A branch for any of them fails genericity. */
const HOLDOUTS = [
  "acoustic.leak.detection",
  "archival.microfilm.scanning",
  "industrial.rope.access",
  "soil.compaction.testing",
  "temporary.generator.capacity",
] as const;

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  ({ dispatchCanonicalTrustedAction: dispatch } = await import(
    "../../api/runtime/trusted-action-dispatcher"
  ));
  const rows = await handle.db.insert(users).values([
    { unionId: `seek-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
    { unionId: `othr-${randomUUID()}`, name: "آ", preferences: {} },
  ] as never).returning();
  SEEKER = String(rows[0]!.id);
  HOLDER = String(rows[1]!.id);
  OTHER = String(rows[2]!.id);
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
    const expression = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: kind, attributes: { quantity: 10 + i },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId: HOLDER,
      projection: { semanticType: kind, summary: `${kind} ${i + 1}`, publicTerms: { unit: "each" } },
    });
  }
}

async function search(kind: string, ownerId = SEEKER) {
  const conversation = await runtime.createRuntimeConversation({ ownerId, title: "ن" });
  await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId, conversationId: conversation.id, content: `ابحث عن ${kind}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
  } as never);
  const projected = await projection.getActiveWorkspaceProjection({ ownerId, conversationId: conversation.id });
  const cards = (projected.currentPresentation?.data as { candidates?: Record<string, unknown>[] })
    ?.candidates ?? [];
  // The surface as the MESSAGE holds it — the same bytes the bubble renders.
  return { conversationId: conversation.id, cards, surface: projected.currentPresentation };
}

/**
 * A press from the conversation flow, built exactly as `Home` builds it:
 * `source: 'CONVERSATION'`, no presentation reference, and a target resolved
 * from the surface's own canonical references.
 */
const pressFromConversation = (input: {
  conversationId: string;
  card: Record<string, unknown>;
  ownerId?: string;
  reference?: string;
  version?: string;
}) => {
  const provenance = input.card.provenance as Record<string, unknown>;
  const kind = String(provenance?.canonicalKind ?? "economic_expression");
  const id = input.reference ?? String(input.card.ref);
  const version = input.version ?? `${kind}:${provenance?.version}`;
  return dispatch(input.ownerId ?? SEEKER, {
    version: 1,
    actionId: `conversation:SELECT_ENTITY:${kind}:${id}:${version}`,
    actionType: "SELECT_ENTITY",
    intent: `select:${id}`,
    source: "CONVERSATION",
    targetReference: { kind, id },
    conversationReference: { kind: "conversation", id: input.conversationId },
    expectedPresentationVersion: version,
    idempotencyKey: `conversation:SELECT_ENTITY:${id}`,
    payload: { entityId: id },
  });
};

const reviewOf = async (conversationId: string, ownerId = SEEKER) => {
  const projected = await projection.getActiveWorkspaceProjection({ ownerId, conversationId });
  return {
    primitive: projected.currentPresentation?.primitive,
    orderId: projected.currentPresentationSource?.id,
    entity: (projected.currentPresentation?.data as { entity?: Record<string, unknown> })?.entity,
  };
};

const activeOrderBindings = (conversationId: string) =>
  handle.db.select().from(referenceBindings).where(and(
    eq(referenceBindings.conversationId, conversationId),
    eq(referenceBindings.referenceKey, "current:order"),
    isNull(referenceBindings.supersededAt),
  ));

describe("a select control in the conversation reaches the same trusted boundary", () => {
  it("THE DECISIVE CASE — candidate 3 from the host, then candidate 5 from the message", async () => {
    //   SECOND_SELECTION_REVIEWS_EXACT_NEW_ORDER
    await publish(HOLDOUTS[0], 6);
    const { conversationId, cards } = await search(HOLDOUTS[0]);
    const third = cards[2]!;
    const fifth = cards[4]!;

    expect((await pressFromConversation({ conversationId, card: third })).outcome)
      .toBe("DISPATCH_ACCEPTED");
    const reviewA = await reviewOf(conversationId);
    expect(reviewA.primitive).toBe("DETAIL");

    // The grid now lives in the message. Press the FIFTH card there.
    const result = await pressFromConversation({ conversationId, card: fifth });
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");

    const reviewB = await reviewOf(conversationId);
    expect(reviewB.primitive).toBe("DETAIL");
    expect(reviewB.orderId).not.toBe(reviewA.orderId);

    const orders = await handle.db.select().from(commercialOrders);
    //   FIRST_DRAFT_DELETED = NO
    expect(orders).toHaveLength(2);
    expect(orders.find((order) => order.id === reviewB.orderId)!.sellerRef).toBe(fifth.ref);
    expect(orders.find((order) => order.id === reviewA.orderId)!.sellerRef).toBe(third.ref);
    //   CURRENT_ORDER_HAS_TWO_ACTIVE_BINDINGS = 0
    const active = await activeOrderBindings(conversationId);
    expect(active).toHaveLength(1);
    expect(active[0]!.targetId).toBe(reviewB.orderId);
  });

  it("selecting again escalates nothing", async () => {
    //   CONVERSATION_SELECT_AUTO_PROPOSES / _APPROVES / _AGREES /
    //   _TRANSACTS / _PAYS = 0
    await publish(HOLDOUTS[1], 6);
    const { conversationId, cards } = await search(HOLDOUTS[1]);
    await pressFromConversation({ conversationId, card: cards[2]! });
    await pressFromConversation({ conversationId, card: cards[4]! });
    for (const order of await handle.db.select().from(commercialOrders)) {
      expect(order.status).toBe("DRAFT");
      expect(order.proposalId).toBeNull();
    }
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
    expect(await handle.db.select().from(transactions)).toHaveLength(0);
    expect((await handle.db.execute(sql.raw("SELECT * FROM payment_intents"))).rows).toHaveLength(0);
    expect((await handle.db.execute(sql.raw("SELECT * FROM economic_proposals"))).rows).toHaveLength(0);
  });

  it("a candidate id the client made up buys nothing", async () => {
    //   CLIENT_CAN_FORGE_CANDIDATE = 0 · FORGED_MESSAGE_ACTION_CREATES_DRAFT = 0
    //   MODEL_INVENTED_CANDIDATE_ACTION_CREATES_DRAFT = 0
    await publish(HOLDOUTS[2], 6);
    const { conversationId, cards } = await search(HOLDOUTS[2]);
    for (const forged of [randomUUID(), "expr_not_real", "../../etc", cards[0]!.ref + "x"]) {
      const result = await pressFromConversation({
        conversationId, card: cards[0]!, reference: String(forged),
      });
      expect(["UNAUTHORIZED", "INVALID_ACTION", "STALE", "BLOCKED"], String(forged))
        .toContain(result.outcome);
    }
    expect(await handle.db.select().from(commercialOrders)).toHaveLength(0);
  });

  it("a press from another owner's session resolves to nothing", async () => {
    //   CROSS_OWNER_SELECTION = 0
    await publish(HOLDOUTS[3], 6);
    const mine = await search(HOLDOUTS[3]);
    const theirs = await search(HOLDOUTS[3], OTHER);
    // OTHER presses MY card id, inside THEIR own conversation.
    const result = await pressFromConversation({
      conversationId: theirs.conversationId, card: mine.cards[0]!, ownerId: OTHER,
    });
    // A public offering resolves for anyone who may see it — what must not
    // happen is MY order appearing, or THEIR draft landing in MY conversation.
    const orders = await handle.db.select().from(commercialOrders);
    for (const order of orders) expect(order.ownerId).toBe(OTHER);
    expect((await reviewOf(mine.conversationId)).primitive).toBe("ENTITY_GRID");
    expect(result.outcome).toBeTruthy();
  });

  it("a press naming another conversation does not move this one's surface", async () => {
    //   CROSS_CONVERSATION_SELECTION = 0
    await publish(HOLDOUTS[4], 6);
    const first = await search(HOLDOUTS[4]);
    const second = await search(HOLDOUTS[4]);
    await pressFromConversation({ conversationId: second.conversationId, card: first.cards[0]! });
    // The draft belongs to the conversation that was NAMED, and the other
    // conversation is untouched.
    expect((await reviewOf(second.conversationId)).primitive).toBe("DETAIL");
    expect((await reviewOf(first.conversationId)).primitive).toBe("ENTITY_GRID");
    expect(await activeOrderBindings(first.conversationId)).toHaveLength(0);
  });

  it("a card from an older result set still selects the THING, not a position", async () => {
    //   CROSS_RESULT_SET_SELECTION = 0 · SELECT_BY_POSITION = 0
    //
    // A second search re-orders the same offerings. Pressing a card from the
    // FIRST grid must still act on that card's own reference.
    await publish(HOLDOUTS[0], 6);
    const first = await search(HOLDOUTS[0]);
    const stale = first.cards[1]!;
    await runtime.routeRuntimeConversationCommerceEnvelope({
      ownerId: SEEKER, conversationId: first.conversationId, content: `ابحث عن ${HOLDOUTS[0]}`,
      envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
    } as never);
    await pressFromConversation({ conversationId: first.conversationId, card: stale });
    const [order] = await handle.db.select().from(commercialOrders);
    expect(order!.sellerRef).toBe(stale.ref);
    // And the provenance is read from canonical state, not sent by the press.
    expect(order!.resultSetId).toBeTruthy();
  });

  it("pressing the same candidate twice is one selection", async () => {
    //   DOUBLE_PRESS_CORRUPTS_CURRENT_ORDER = 0
    await publish(HOLDOUTS[1], 6);
    const { conversationId, cards } = await search(HOLDOUTS[1]);
    const [a, b] = await Promise.all([
      pressFromConversation({ conversationId, card: cards[2]! }),
      pressFromConversation({ conversationId, card: cards[2]! }),
    ]);
    expect([a.outcome, b.outcome].every((outcome) => outcome === "DISPATCH_ACCEPTED")).toBe(true);
    // Exactly one reference is current, whatever happened underneath.
    const active = await activeOrderBindings(conversationId);
    expect(active).toHaveLength(1);
    const orders = await handle.db.select().from(commercialOrders);
    expect(orders.every((order) => order.sellerRef === cards[2]!.ref)).toBe(true);
    expect((await reviewOf(conversationId)).orderId).toBe(active[0]!.targetId);
  });

  it("two different candidates pressed at once leave exactly one current", async () => {
    //   CONCURRENT_DIFFERENT_SELECTIONS_PRODUCE_TWO_CURRENT_ORDERS = 0
    await publish(HOLDOUTS[2], 6);
    const { conversationId, cards } = await search(HOLDOUTS[2]);
    await Promise.all([
      pressFromConversation({ conversationId, card: cards[1]! }),
      pressFromConversation({ conversationId, card: cards[3]! }),
    ]);
    const active = await activeOrderBindings(conversationId);
    expect(active).toHaveLength(1);
    const review = await reviewOf(conversationId);
    expect(review.orderId).toBe(active[0]!.targetId);
    // Whichever won, the review shows THAT order and not the other.
    const orders = await handle.db.select().from(commercialOrders);
    const current = orders.find((order) => order.id === review.orderId)!;
    expect([cards[1]!.ref, cards[3]!.ref]).toContain(current.sellerRef);
  });

  it("the review is canonical, so it is the same on every read", async () => {
    //   MESSAGE_BUBBLE_SELECTION_SURVIVES_RELOAD / REOPEN — nothing client-side
    //   holds the selection; the server rebuilds it from the binding each time.
    await publish(HOLDOUTS[3], 6);
    const { conversationId, cards } = await search(HOLDOUTS[3]);
    await pressFromConversation({ conversationId, card: cards[4]! });
    const a = await reviewOf(conversationId);
    const b = await reviewOf(conversationId);
    expect(b).toEqual(a);
    expect(a.entity!.title).toBe(cards[4]!.title);
  });

  it("every unfamiliar kind uses the same path", async () => {
    for (const kind of HOLDOUTS) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, discovery_result_sets,
        discovery_candidates, reference_bindings, commercial_orders, messages, conversations,
        events CASCADE`));
      await publish(kind, 6);
      const { conversationId, cards } = await search(kind);
      await pressFromConversation({ conversationId, card: cards[2]! });
      const review = await reviewOf(conversationId);
      expect(review.primitive, kind).toBe("DETAIL");
      expect(review.entity!.title, kind).toBe(cards[2]!.title);
    }
  });

  it("no smart bubble is manufactured to make a press land", async () => {
    //   NEW_SMART_BUBBLE_FOR_EVERY_MESSAGE = 0 · MESSAGE != SMART_BUBBLE
    await publish(HOLDOUTS[0], 6);
    const { conversationId, cards } = await search(HOLDOUTS[0]);
    const before = await handle.db.execute(sql.raw("SELECT count(*)::int AS n FROM bubbles"));
    await pressFromConversation({ conversationId, card: cards[2]! });
    const after = await handle.db.execute(sql.raw("SELECT count(*)::int AS n FROM bubbles"));
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
    // And the client path says so in its own source.
    const home = readFileSync("src/pages/Home.tsx", "utf8");
    const handler = home.slice(
      home.indexOf("const dispatchConversationPresentationAction"),
      home.indexOf("const dispatchWorkspaceSubmit"),
    );
    expect(handler).not.toContain("runtimeBubble");
    expect(handler).not.toContain("smart_bubble");
  });

  it("no production file routes a selection by what the thing IS", async () => {
    //   DOMAIN_SELECTION_HANDLERS_ADDED = 0
    const files = [
      "src/pages/Home.tsx",
      "src/components/chat/ChatMessage.tsx",
      "src/components/jasim-core/candidateActionTarget.ts",
      "api/runtime/trusted-action-dispatcher.ts",
    ];
    const forbidden = ["acoustic", "microfilm", "rope", "compaction", "generator",
      "car", "food", "job", "property", "hotel", "marine", "manuscript", "crane"];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").toLowerCase();
      for (const word of forbidden) {
        expect(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`).toBe(false);
      }
    }
  });
});
