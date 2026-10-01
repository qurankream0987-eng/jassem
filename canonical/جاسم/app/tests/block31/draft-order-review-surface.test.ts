/**
 * JASIM — THE TERMS YOU MUST REVIEW, WHERE YOU CAN SEE THEM.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * Pressing a card already created a canonical draft order and bound it into
 * the conversation as `current:order`. And the workspace went on showing the
 * search grid, because `currentPresentation` was read out of the LATEST
 * MESSAGE's metadata and a trusted press writes no message. So the terms a
 * person must review before approving were canonical, pinned, and nowhere.
 *
 *   PRESENTATION != CANONICAL STATE
 *
 * ─── AND WHAT THE SURFACE IS NOT ────────────────────────────────────────────
 *
 *   SHOWING TERMS != ACCEPTING TERMS · DRAFT_SURFACE != AUTHORITY
 *   DRAFT != AGREEMENT != TRANSACTION != PAYMENT
 *
 * Nothing is stored for it. The canonical order already exists and this reads
 * it, so leaving the surface cannot touch the draft.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { users } from "@db/schema";
import { commercialOrders } from "@db/schema-block3";
import { agreements, transactions } from "@db/schema-block2";
import { referenceBindings } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let dispatch: typeof import("../../api/runtime/trusted-action-dispatcher").dispatchCanonicalTrustedAction;
let SEEKER = "";
let OTHER = "";
let HOLDER = "";

/** Five unrelated things through one surface. A branch for any of them fails. */
const HOLDOUTS = [
  "marine.sensor.rental",
  "temporary.cold.storage",
  "manuscript.restoration.service",
  "crane.lifting.capacity",
  "mobile.water.testing",
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

async function publish(kind: string, count: number, terms: Record<string, unknown> = {}) {
  for (let i = 0; i < count; i += 1) {
    const expression = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: kind, attributes: { quantity: 10 + i },
    });
    await fabric.publishExpression({
      id: expression.id, ownerId: HOLDER,
      projection: { semanticType: kind, summary: `${kind} ${i + 1}`, publicTerms: terms },
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
  return { conversationId: conversation.id, cards };
}

const pressSelect = (conversationId: string, card: Record<string, unknown>, ownerId = SEEKER) => {
  const provenance = card.provenance as Record<string, unknown>;
  return dispatch(ownerId, {
    version: 1,
    actionId: `workspace:SELECT_ENTITY:${card.ref}`,
    actionType: "SELECT_ENTITY",
    intent: `select:${card.ref}`,
    source: "WORKSPACE",
    targetReference: { kind: String(provenance.canonicalKind), id: String(card.ref) },
    conversationReference: { kind: "conversation", id: conversationId },
    expectedPresentationVersion: `${provenance.canonicalKind}:${provenance.version}`,
    idempotencyKey: `select:${card.ref}:${randomUUID()}`,
    payload: { entityId: String(card.ref) },
  });
};

const surfaceOf = async (conversationId: string, ownerId = SEEKER) =>
  projection.getActiveWorkspaceProjection({ ownerId, conversationId });

describe("a draft becomes the surface the person must review", () => {
  it("the grid gives way to the draft, built from the canonical order", async () => {
    //   DRAFT_REVIEW_READS_CANONICAL_ORDER
    await publish(HOLDOUTS[0], 6, { money: { amountMinor: "125000", currency: "SAR" }, depth: 450, depthUnit: "m" });
    const { conversationId, cards } = await search(HOLDOUTS[0]);
    const before = await surfaceOf(conversationId);
    expect(before.currentPresentation!.primitive).toBe("ENTITY_GRID");

    const chosen = cards[2]!;
    expect((await pressSelect(conversationId, chosen)).outcome).toBe("DISPATCH_ACCEPTED");

    const after = await surfaceOf(conversationId);
    expect(after.currentPresentation!.primitive).toBe("DETAIL");
    const [order] = await handle.db.select().from(commercialOrders);
    const data = after.currentPresentation!.data as {
      reviewRequired: boolean; orderStatus: string; entity: Record<string, unknown>;
    };
    expect(data.reviewRequired).toBe(true);
    expect(data.orderStatus).toBe("DRAFT");
    expect(data.entity.ref).toBe(order!.id);
    // The pinned terms, shown as generic property rows.
    expect(data.entity.attributes).toEqual({ depth: "450 m" });
    expect(data.entity.money).toEqual({ amountMinor: "125000", currency: "SAR" });
    // And the surface is owned by the order, so the message keeps its own grid.
    expect(after.currentPresentationSource).toEqual({ kind: "commercial_order", id: order!.id });
  });

  it("nothing was proposed, agreed, transacted or paid", async () => {
    //   SELECT_PRESS_COUNTS_AS_APPROVAL = 0 · DRAFT_SURFACE_AUTO_* = 0
    await publish(HOLDOUTS[1], 6);
    const { conversationId, cards } = await search(HOLDOUTS[1]);
    await pressSelect(conversationId, cards[0]!);
    await surfaceOf(conversationId);
    const [order] = await handle.db.select().from(commercialOrders);
    expect(order!.status).toBe("DRAFT");
    expect(order!.proposalId).toBeNull();
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
    expect(await handle.db.select().from(transactions)).toHaveLength(0);
    expect((await handle.db.execute(sql.raw("SELECT * FROM payment_intents"))).rows).toHaveLength(0);
    expect((await handle.db.execute(sql.raw("SELECT * FROM economic_proposals"))).rows).toHaveLength(0);
  });

  it("the surface carries exactly one control, and it has a real route", async () => {
    //
    // ── AN INHERITED EXPECTATION, REPLACED ────────────────────────────────
    //
    // OLD_EXPECTATION
    //   The review surface carries NO control at all, evidenced by
    //   `CREATE_PROPOSAL: unavailableRoute` in the dispatcher.
    //
    // WHY_IT_IS_WRONG
    //   True when written — no trusted action type could propose a draft, so a
    //   control would have been a button with nothing behind it. The next
    //   phase changed that premise by building the route and proving it. Left
    //   as it stood, the assertion pins the product to a missing capability:
    //   it passes only while the review stays unusable, and it asserts the
    //   ABSENCE of a feature rather than the correctness of one.
    //
    // NEW_EXPECTATION
    //   Exactly one control on an unsent draft, carrying an intent the
    //   dispatcher actually routes, and acting on the draft's own canonical
    //   reference — never on a position.
    //
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER
    //   An invented approval button still fails it (wrong intent, and a second
    //   control fails the count), and it additionally catches a control whose
    //   route does not exist and one that acts on the wrong thing — neither of
    //   which the old assertion could see.
    //
    await publish(HOLDOUTS[2], 6);
    const { conversationId, cards } = await search(HOLDOUTS[2]);
    await pressSelect(conversationId, cards[0]!);
    const after = await surfaceOf(conversationId);
    const entity = (after.currentPresentation!.data as { entity: Record<string, unknown> }).entity;
    expect(entity.actions).toEqual([{ intent: "propose", label: "إرسال العرض" }]);
    // It acts on the draft itself, at the draft's own version.
    const [order] = await handle.db.select().from(commercialOrders);
    expect(entity.ref).toBe(order!.id);
    expect((entity.provenance as Record<string, unknown>).canonicalKind).toBe("commercial_order");
    const dispatcher = readFileSync("api/runtime/trusted-action-dispatcher.ts", "utf8");
    expect(dispatcher).toContain("CREATE_PROPOSAL: async");
    expect(dispatcher).not.toContain("CREATE_PROPOSAL: unavailableRoute");
  });

  it("a holder who changes the offering afterwards does not change what was selected", async () => {
    //   LATEST_OFFERING_TERMS_REPLACE_DRAFT_TERMS = 0
    //   COUNTERPARTY_CHANGE_MUTATES_DRAFT_TERMS = 0
    await publish(HOLDOUTS[3], 6, { capacity: 20, capacityUnit: "t" });
    const { conversationId, cards } = await search(HOLDOUTS[3]);
    const chosen = cards[0]!;
    await pressSelect(conversationId, chosen);
    await fabric.publishExpression({
      id: String(chosen.ref), ownerId: HOLDER,
      projection: { semanticType: HOLDOUTS[3], summary: "جديد", publicTerms: { capacity: 99, capacityUnit: "t" } },
    });
    const after = await surfaceOf(conversationId);
    const entity = (after.currentPresentation!.data as { entity: Record<string, unknown> }).entity;
    // What the buyer chose, not what the holder now says.
    expect(entity.attributes).toEqual({ capacity: "20 t" });
    const [order] = await handle.db.select().from(commercialOrders);
    expect(order!.terms).toMatchObject({ capacity: 20 });
  });

  it("every unfamiliar kind uses the SAME surface, with no branch anywhere", async () => {
    for (const kind of HOLDOUTS) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, discovery_result_sets,
        discovery_candidates, reference_bindings, commercial_orders, messages, conversations,
        events CASCADE`));
      await publish(kind, 6, { unit: "each" });
      const { conversationId, cards } = await search(kind);
      await pressSelect(conversationId, cards[1]!);
      const after = await surfaceOf(conversationId);
      expect(after.currentPresentation!.primitive, kind).toBe("DETAIL");
      const entity = (after.currentPresentation!.data as { entity: Record<string, unknown> }).entity;
      // Named the way the person SAW it — a frozen discovery row, not a re-read.
      expect(entity.title, kind).toBe(cards[1]!.title);
      expect(entity.attributes, kind).toEqual({ unit: "each" });
    }
  });

  it("a second selection reviews the SECOND order, and the first still exists", async () => {
    //   SECOND_SELECTION_REVIEWS_WRONG_ORDER = 0 · HIDING_REVIEW_DELETES_DRAFT = 0
    await publish(HOLDOUTS[4], 6);
    const { conversationId, cards } = await search(HOLDOUTS[4]);
    await pressSelect(conversationId, cards[0]!);
    const first = (await surfaceOf(conversationId)).currentPresentationSource!.id;
    await pressSelect(conversationId, cards[3]!);
    const second = (await surfaceOf(conversationId)).currentPresentationSource!.id;

    expect(second).not.toBe(first);
    const orders = await handle.db.select().from(commercialOrders);
    // Two canonical drafts, nothing deleted; one of them is current.
    expect(orders).toHaveLength(2);
    expect(orders.find((order) => order.id === second)!.sellerRef).toBe(cards[3]!.ref);
    // And the superseded binding is marked, not removed.
    const bindings = await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.referenceKey, "current:order"));
    expect(bindings).toHaveLength(2);
    expect(bindings.filter((binding) => binding.supersededAt === null)).toHaveLength(1);
  });

  it("a draft in one conversation is not the surface of another", async () => {
    //   CROSS_CONVERSATION_DRAFT_SURFACE = 0 · OLD_DRAFT_HIJACKS_NEW_CONVERSATION = 0
    await publish(HOLDOUTS[0], 6);
    const first = await search(HOLDOUTS[0]);
    await pressSelect(first.conversationId, first.cards[0]!);
    expect((await surfaceOf(first.conversationId)).currentPresentation!.primitive).toBe("DETAIL");

    const second = await search(HOLDOUTS[0]);
    const other = await surfaceOf(second.conversationId);
    expect(other.currentPresentation!.primitive).toBe("ENTITY_GRID");
    expect(other.currentPresentationSource!.kind).toBe("message");
  });

  it("another owner's conversation never shows this draft", async () => {
    //   CROSS_OWNER_DRAFT_SURFACE = 0
    await publish(HOLDOUTS[0], 6);
    const mine = await search(HOLDOUTS[0]);
    await pressSelect(mine.conversationId, mine.cards[0]!);
    const theirs = await search(HOLDOUTS[0], OTHER);
    const surface = await surfaceOf(theirs.conversationId, OTHER);
    expect(surface.currentPresentation!.primitive).not.toBe("DETAIL");
    const [order] = await handle.db.select().from(commercialOrders);
    expect(JSON.stringify(surface)).not.toContain(order!.id);
  });

  it("the review is canonical, so reading it twice gives the same thing", async () => {
    //   DRAFT_REVIEW_SURVIVES_RELOAD / REOPEN — the server builds it from the
    //   order every time; there is no client memory to lose.
    await publish(HOLDOUTS[1], 6);
    const { conversationId, cards } = await search(HOLDOUTS[1]);
    await pressSelect(conversationId, cards[0]!);
    const a = await surfaceOf(conversationId);
    const b = await surfaceOf(conversationId);
    expect(b.currentPresentation).toEqual(a.currentPresentation);
    expect(b.currentPresentationSource).toEqual(a.currentPresentationSource);
  });

  it("machinery stays off the property rows", async () => {
    await publish(HOLDOUTS[0], 6, { unit: "each" });
    const { conversationId, cards } = await search(HOLDOUTS[0]);
    await pressSelect(conversationId, cards[0]!);
    const entity = ((await surfaceOf(conversationId)).currentPresentation!.data as {
      entity: Record<string, unknown>;
    }).entity;
    const attributes = entity.attributes as Record<string, unknown>;
    for (const machinery of ["offeringRef", "offeringVersion", "termsFingerprint",
      "resultSetId", "candidateId", "termsVersion"]) {
      expect(attributes, machinery).not.toHaveProperty(machinery);
    }
    // Carried for whoever needs it, never drawn as a fact ABOUT the thing.
    expect(entity.provenance).toMatchObject({ offeringRef: cards[0]!.ref });
  });

  it("no production file builds this surface from what the thing IS", async () => {
    //   DOMAIN_ORDER_REVIEW_COMPONENTS_ADDED = 0
    const files = [
      "api/runtime/presentation-fabric.ts",
      "api/runtime/active-workspace-projection.ts",
      "src/components/jasim-core/SchemaRenderer.tsx",
    ];
    const forbidden = ["marine", "manuscript", "crane", "restoration", "sensor",
      "car", "hotel", "restaurant", "food", "warehouse", "سيارة", "فندق"];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").toLowerCase();
      for (const word of forbidden) {
        expect(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`).toBe(false);
      }
    }
    //
    // ── «CHECKOUT» AND «CART», AND WHY THEY ARE NOT IN THAT LIST ──────────
    //
    // `CHECKOUT` is an inherited member of the closed PRESENTATION_PRIMITIVES
    // vocabulary and predates this phase by a long way. Forbidding the string
    // across the whole file would have failed on a line this phase never
    // touched — a guard that cannot tell a vocabulary entry from a new branch.
    // What this phase must not do is BUILD the review from such a notion, so
    // the review builder itself is read, and it must name none of them.
    const builder = readFileSync("api/runtime/presentation-fabric.ts", "utf8");
    const body = builder.slice(
      builder.indexOf("export function projectDraftOrderForReview"),
      builder.indexOf("export function projectStructuredResult"),
    );
    for (const word of ["checkout", "cart", "payment", "invoice", "basket"]) {
      expect(body.toLowerCase(), `review builder :: ${word}`).not.toContain(word);
    }
  });
});
