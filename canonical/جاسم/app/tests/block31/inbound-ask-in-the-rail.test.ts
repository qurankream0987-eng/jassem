/**
 * JASIM — الطلبُ يصل إلى من لم يفتح محادثةً أصلاً.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * The previous phase gave the counterparty a surface, and it was
 * conversation-scoped: the term sheet appeared in a thread they opened. But an
 * ask is addressed to a PERSON, and a person who has never started a thread
 * was never told that anybody had asked them for anything — measured in a real
 * browser: workspace absent, nothing on screen.
 *
 *   A REQUEST ADDRESSED TO ME IS NOT A FACT ABOUT MY THREAD
 *
 * The rail is the only person-scoped thing JASIM draws, and the only surface
 * present before a conversation exists.
 *
 * ─── AND WHAT THE RAIL IS NOT ───────────────────────────────────────────────
 *
 *   RAIL != A PLACE TO AGREE FROM
 *
 * It notifies and opens. Agreeing happens where the terms are legible, through
 * the authority path that already exists.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { agreements } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let living: typeof import("../../api/runtime/living-object-projection");
let dispatch: typeof import("../../api/runtime/trusted-action-dispatcher").dispatchCanonicalTrustedAction;
let BUYER = "", HOLDER = "", STRANGER = "";

const HOLDOUTS = ["tidal.turbine.survey", "herbarium.specimen.digitisation"] as const;

beforeAll(async () => {
  handle = await getTestDb();
  process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
  fabric = await import("../../api/runtime/economic-fabric");
  runtime = await import("../../api/runtime/jasim-runtime");
  projection = await import("../../api/runtime/active-workspace-projection");
  living = await import("../../api/runtime/living-object-projection");
  ({ dispatchCanonicalTrustedAction: dispatch } = await import(
    "../../api/runtime/trusted-action-dispatcher"
  ));
  const rows = await handle.db.insert(users).values([
    { unionId: `buy-${randomUUID()}`, name: "ط", preferences: {} },
    { unionId: `hold-${randomUUID()}`, name: "ح", preferences: {} },
    { unionId: `str-${randomUUID()}`, name: "غ", preferences: {} },
  ] as never).returning();
  BUYER = String(rows[0]!.id); HOLDER = String(rows[1]!.id); STRANGER = String(rows[2]!.id);
});

beforeEach(async () => {
  await resetBlock31(handle.db);
  await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
    economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
    reference_bindings, commercial_orders, payment_intents, agreements, transactions,
    commitments, messages, conversations, events CASCADE`));
});

/** The whole buyer side, through the production paths. */
async function buyerSendsProposal(kind: string) {
  for (let i = 0; i < 6; i += 1) {
    const e = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: kind, attributes: { quantity: 10 + i },
    });
    await fabric.publishExpression({
      id: e.id, ownerId: HOLDER,
      projection: { semanticType: kind, summary: `${kind} ${i + 1}`,
        publicTerms: { money: { amountMinor: "40000", currency: "SAR" }, unit: "each" } },
    });
  }
  const c = await runtime.createRuntimeConversation({ ownerId: BUYER, title: "طلب" });
  await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId: BUYER, conversationId: c.id, content: `ابحث عن ${kind}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
  } as never);
  const grid = await projection.getActiveWorkspaceProjection({ ownerId: BUYER, conversationId: c.id });
  const card = (grid.currentPresentation!.data as { candidates: Record<string, unknown>[] }).candidates[2]!;
  const cp = card.provenance as Record<string, unknown>;
  await dispatch(BUYER, {
    version: 1, actionId: "s", actionType: "SELECT_ENTITY", intent: `select:${card.ref}`,
    source: "CONVERSATION", targetReference: { kind: String(cp.canonicalKind), id: String(card.ref) },
    conversationReference: { kind: "conversation", id: c.id },
    expectedPresentationVersion: `${cp.canonicalKind}:${cp.version}`,
    payload: { entityId: String(card.ref) },
  });
  const review = await projection.getActiveWorkspaceProjection({ ownerId: BUYER, conversationId: c.id });
  const order = (review.currentPresentation!.data as { entity: Record<string, unknown> }).entity;
  await dispatch(BUYER, {
    version: 1, actionId: "p", actionType: "CREATE_PROPOSAL", intent: `propose:${order.ref}`,
    source: "WORKSPACE", targetReference: { kind: "commercial_order", id: String(order.ref) },
    conversationReference: { kind: "conversation", id: c.id },
    expectedPresentationVersion:
      `commercial_order:${(order.provenance as Record<string, unknown>).version}`,
    payload: {},
  });
}

const railOf = (ownerId: string) => living.getLivingObjectsProjection({ ownerId, limit: 30 });

describe("an ask reaches a person who has opened nothing", () => {
  it("THE GAP CLOSED — the holder has no conversation at all, and the rail still tells them", async () => {
    await buyerSendsProposal(HOLDOUTS[0]);
    // Not one conversation of their own. Before this, they learned nothing.
    const rail = await railOf(HOLDER);
    const ask = rail.objects.find((object) => object.semanticType === "ask");
    expect(ask).toBeDefined();
    expect(ask!.underlyingReference.kind).toBe("economic_proposal");
    expect(ask!.title).toBe(HOLDOUTS[0]);
    //   The existing vocabulary, unchanged: `awaiting_approval` already means
    //   WAITING_APPROVAL, which already raises APPROVAL_REQUIRED.
    expect(ask!.status).toBe("WAITING_APPROVAL");
    expect(ask!.attention.level).toBe("APPROVAL_REQUIRED");
  });

  it("it sorts to the top, because somebody is waiting on an answer", async () => {
    await buyerSendsProposal(HOLDOUTS[1]);
    const rail = await railOf(HOLDER);
    expect(rail.objects[0]!.semanticType).toBe("ask");
  });

  it("the rail offers no way to agree from it", async () => {
    //   RAIL != A PLACE TO AGREE FROM
    await buyerSendsProposal(HOLDOUTS[0]);
    const ask = (await railOf(HOLDER)).objects.find((o) => o.semanticType === "ask")!;
    expect(ask.secondaryActions).toEqual([]);
    //
    // `primaryAction` is derived GENERICALLY from status — every
    // waiting-approval object in the rail carries one, and an ask is not
    // special-cased out of it. What matters is that the rail cannot act on it:
    // the component takes a single `onOpen` and dispatches nothing else, so
    // there is no control to press and therefore no dead one.
    //
    //   RAIL != A PLACE TO AGREE FROM · VISIBLE_CONTROL != EXECUTION_PERMISSION
    const rail = readFileSync("src/components/jasim-core/ActiveObjectsRail.tsx", "utf8");
    expect(rail).not.toContain("primaryAction");
    expect(rail).not.toContain("APPROVE_PROPOSAL");
    expect(rail).not.toContain("commitAgreement");
    const props = rail.slice(rail.indexOf("export interface ActiveObjectsRailProps"));
    expect(props.slice(0, props.indexOf("}"))).not.toContain("onAction");
  });

  it("opening it is a READ, and its version is one the dispatcher understands", async () => {
    //   A VERSION ONLY ONE SIDE UNDERSTANDS IS NOT A VERSION
    //
    // The rail stamps everything `living:<updatedAt>`; the dispatcher resolves
    // a term sheet by the proposal's own version. A rail entry carrying the
    // wrong one would be refused as stale the moment somebody pressed it.
    await buyerSendsProposal(HOLDOUTS[1]);
    const ask = (await railOf(HOLDER)).objects.find((o) => o.semanticType === "ask")!;
    expect(ask.presentationVersion).toMatch(/^economic_proposal:\d+$/);
    const opened = await dispatch(HOLDER, {
      version: 1, actionId: `living-open:${ask.id}`, actionType: "OPEN_REFERENCE", intent: "open",
      source: "LIVING_OBJECT", targetReference: ask.underlyingReference,
      presentationReference: { kind: "living_object", id: ask.id },
      expectedPresentationVersion: ask.presentationVersion, payload: {},
    });
    expect(opened.outcome).toBe("OPENED");
    // Opening creates nothing.
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("the buyer's own ask is not in the buyer's rail", async () => {
    //   A PARTY CANNOT AGREE TO ITS OWN PROPOSAL
    await buyerSendsProposal(HOLDOUTS[0]);
    expect((await railOf(BUYER)).objects.some((o) => o.semanticType === "ask")).toBe(false);
  });

  it("a stranger's rail is empty of it", async () => {
    await buyerSendsProposal(HOLDOUTS[1]);
    expect((await railOf(STRANGER)).objects.some((o) => o.semanticType === "ask")).toBe(false);
  });

  it("once agreed, it leaves the rail", async () => {
    await buyerSendsProposal(HOLDOUTS[0]);
    const ask = (await railOf(HOLDER)).objects.find((o) => o.semanticType === "ask")!;
    const conversation = await runtime.createRuntimeConversation({ ownerId: HOLDER, title: "لي" });
    const accepted = await dispatch(HOLDER, {
      version: 1, actionId: "a", actionType: "APPROVE_PROPOSAL",
      intent: `approve:${ask.underlyingReference.id}`, source: "WORKSPACE",
      targetReference: ask.underlyingReference,
      conversationReference: { kind: "conversation", id: conversation.id },
      expectedPresentationVersion: ask.presentationVersion, payload: { decision: "approve" },
    });
    expect(accepted.outcome).toBe("DISPATCH_ACCEPTED");
    expect((await railOf(HOLDER)).objects.some((o) => o.semanticType === "ask")).toBe(false);
    expect(await handle.db.select().from(agreements)).toHaveLength(1);
  });

  it("TWO asks are TWO entries — the rail does not collapse what the workspace hides", async () => {
    //   The workspace shows ONE inbound ask: it owns a single
    //   `currentPresentation`, so a second ask is invisible there — a gap I
    //   recorded in the previous phase and have NOT closed. What I claim here
    //   is narrower and measured: the rail does not inherit that loss.
    await buyerSendsProposal(HOLDOUTS[0]);
    await buyerSendsProposal(HOLDOUTS[1]);
    const asks = (await railOf(HOLDER)).objects.filter((o) => o.semanticType === "ask");
    expect(asks).toHaveLength(2);
    // Two DISTINCT term sheets, each nameable on its own — not one row
    // standing in for both, which would make answering either ambiguous.
    expect(new Set(asks.map((a) => a.underlyingReference.id)).size).toBe(2);
    expect(new Set(asks.map((a) => a.title))).toEqual(new Set([HOLDOUTS[0], HOLDOUTS[1]]));
    // And each carries the version the dispatcher knows it by, so opening
    // either is never refused as stale.
    for (const ask of asks) {
      expect(ask.presentationVersion).toMatch(/^economic_proposal:\d+$/);
    }
    // Meanwhile the thread-scoped surface still shows exactly one.
    const conversation = await runtime.createRuntimeConversation({ ownerId: HOLDER, title: "لي" });
    const grid = await projection.getActiveWorkspaceProjection({
      ownerId: HOLDER, conversationId: conversation.id,
    });
    expect(grid.currentPresentationSource!.kind).toBe("economic_proposal");
    expect(asks.map((a) => a.underlyingReference.id))
      .toContain(grid.currentPresentationSource!.id);
  });

  it("the rail and the conversation surface read ONE source", async () => {
    //   TWO_READERS_OF_ONE_ASK = 0
    const railSource = readFileSync("api/runtime/living-object-projection.ts", "utf8");
    const workspace = readFileSync("api/runtime/active-workspace-projection.ts", "utf8");
    for (const source of [railSource, workspace]) {
      expect(source).toContain("inboundAsksFor");
      // Neither re-implements the filter that decides what is waiting.
      expect(source).not.toContain('eq(economicProposals.status, "proposed")');
    }
  });

  it("no production file decides any of this from what the thing IS", async () => {
    const files = [
      "api/runtime/inbound-asks.ts",
      "api/runtime/living-object-projection.ts",
      "src/components/jasim-core/ActiveObjectsRail.tsx",
    ];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").toLowerCase();
      for (const word of ["tidal", "turbine", "herbarium", "car", "hotel", "restaurant"]) {
        expect(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`).toBe(false);
      }
    }
  });
});
