/**
 * JASIM — الطرف الآخر يرى، ويجيب.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * A proposal could be sent and the person it was sent TO saw nothing. The
 * workspace derives its surface from the latest message or from this
 * conversation's own draft, and an inbound proposal is neither — it is
 * addressed to a PERSON, not to a thread.
 *
 *   A REQUEST ADDRESSED TO ME IS NOT A FACT ABOUT MY THREAD
 *
 * And accepting had no door. `commitAgreement` reserves `ownerDirect` for
 * places a person is provably present, and REFUSES the conversational path on
 * purpose — a model deciding that «أقبل» meant accept would bind somebody to a
 * term sheet by classifying a sentence.
 *
 *   MODEL != AUTHORITY · CLASSIFICATION != ACCEPTANCE
 *
 * So the rule was satisfied and half the brokerage was unreachable.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { users } from "@db/schema";
import { commercialOrders } from "@db/schema-block3";
import { agreements } from "@db/schema-block2";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let runtime: typeof import("../../api/runtime/jasim-runtime");
let projection: typeof import("../../api/runtime/active-workspace-projection");
let dispatch: typeof import("../../api/runtime/trusted-action-dispatcher").dispatchCanonicalTrustedAction;
let BUYER = "", HOLDER = "", STRANGER = "";

const HOLDOUTS = [
  "glacier.core.extraction",
  "textile.colourfastness.testing",
  "orchard.pollination.capacity",
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

/** The whole buyer side, end to end, through the production paths. */
async function buyerSendsProposal(kind: string) {
  for (let i = 0; i < 6; i += 1) {
    const e = await fabric.createExpression({
      ownerId: HOLDER, kind: "offering", semanticType: kind, attributes: { quantity: 10 + i },
    });
    await fabric.publishExpression({
      id: e.id, ownerId: HOLDER,
      projection: { semanticType: kind, summary: `${kind} ${i + 1}`,
        // `money` is the key the term-sheet builder reads. An offering that
        // declares `price` instead produces a proposal with NO settlement
        // term at all — which is how this fixture first produced a term sheet
        // with no amount in it, and is recorded as a real asymmetry.
        publicTerms: { money: { amountMinor: "70000", currency: "SAR" }, unit: "each" } },
    });
  }
  const conversation = await runtime.createRuntimeConversation({ ownerId: BUYER, title: "ن" });
  await runtime.routeRuntimeConversationCommerceEnvelope({
    ownerId: BUYER, conversationId: conversation.id, content: `ابحث عن ${kind}`,
    envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
  } as never);
  const grid = await projection.getActiveWorkspaceProjection({ ownerId: BUYER, conversationId: conversation.id });
  const card = (grid.currentPresentation!.data as { candidates: Record<string, unknown>[] }).candidates[2]!;
  const cp = card.provenance as Record<string, unknown>;
  await dispatch(BUYER, {
    version: 1, actionId: `s:${card.ref}`, actionType: "SELECT_ENTITY", intent: `select:${card.ref}`,
    source: "CONVERSATION", targetReference: { kind: String(cp.canonicalKind), id: String(card.ref) },
    conversationReference: { kind: "conversation", id: conversation.id },
    expectedPresentationVersion: `${cp.canonicalKind}:${cp.version}`,
    payload: { entityId: String(card.ref) },
  });
  const review = await projection.getActiveWorkspaceProjection({ ownerId: BUYER, conversationId: conversation.id });
  const order = (review.currentPresentation!.data as { entity: Record<string, unknown> }).entity;
  const op = order.provenance as Record<string, unknown>;
  await dispatch(BUYER, {
    version: 1, actionId: `p:${order.ref}`, actionType: "CREATE_PROPOSAL", intent: `propose:${order.ref}`,
    source: "WORKSPACE", targetReference: { kind: "commercial_order", id: String(order.ref) },
    conversationReference: { kind: "conversation", id: conversation.id },
    expectedPresentationVersion: `commercial_order:${op.version}`, payload: {},
  });
  return { buyerConversation: conversation.id };
}

/** The holder opens JASIM. They have their own thread, about nothing. */
async function holderOpens(ownerId = HOLDER) {
  const conversation = await runtime.createRuntimeConversation({ ownerId, title: "عندي" });
  const p = await projection.getActiveWorkspaceProjection({ ownerId, conversationId: conversation.id });
  const data = p.currentPresentation?.data as { entity?: Record<string, unknown>; replyRequired?: boolean } | undefined;
  return {
    conversationId: conversation.id,
    primitive: p.currentPresentation?.primitive ?? null,
    source: p.currentPresentationSource,
    entity: data?.entity,
    replyRequired: data?.replyRequired,
  };
}

const pressAccept = (input: {
  conversationId: string; proposalId: string; version: string;
  ownerId?: string; decision?: string;
}) => dispatch(input.ownerId ?? HOLDER, {
  version: 1,
  actionId: `workspace:APPROVE_PROPOSAL:${input.proposalId}`,
  actionType: "APPROVE_PROPOSAL",
  intent: `approve:${input.proposalId}`,
  source: "WORKSPACE",
  targetReference: { kind: "economic_proposal", id: input.proposalId },
  conversationReference: { kind: "conversation", id: input.conversationId },
  expectedPresentationVersion: input.version,
  payload: { decision: input.decision ?? "approve" },
});

describe("the other party sees what was asked of them, and can answer it", () => {
  it("THE WHOLE DEAL — the holder opens JASIM and the term sheet is there", async () => {
    await buyerSendsProposal(HOLDOUTS[0]);
    const seen = await holderOpens();
    expect(seen.primitive).toBe("DETAIL");
    expect(seen.source!.kind).toBe("economic_proposal");
    expect(seen.replyRequired).toBe(true);
    // WHO PAYS WHOM, stated rather than left to be inferred. The holder owns
    // the offering, so under the default direction the money comes TO them —
    // and the one fact a person must not have to work out before agreeing is
    // on the surface.
    //
    //   WHO_ASKED != WHO_PAYS
    expect(seen.entity!.badges).toEqual(["بانتظار ردّك", "الدفع لك"]);
    expect(seen.entity!.actions).toEqual([{ intent: "approve", label: "قبول العرض" }]);
    // The terms as PROPOSED, read from the proposal's own row.
    expect(seen.entity!.money).toEqual({ amountMinor: "70000", currency: "SAR" });

    const provenance = seen.entity!.provenance as Record<string, unknown>;
    const result = await pressAccept({
      conversationId: seen.conversationId,
      proposalId: String(seen.entity!.ref),
      version: `economic_proposal:${provenance.version}`,
    });
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");

    // An agreement exists, held by BOTH parties.
    const made = await handle.db.select().from(agreements);
    expect(made).toHaveLength(1);
    expect(made[0]!.participants.sort()).toEqual([BUYER, HOLDER].sort());
  });

  it("the buyer is never shown their own proposal to accept", async () => {
    //   A PARTY CANNOT AGREE TO ITS OWN PROPOSAL
    const { buyerConversation } = await buyerSendsProposal(HOLDOUTS[1]);
    const buyerSees = await projection.getActiveWorkspaceProjection({
      ownerId: BUYER, conversationId: buyerConversation,
    });
    // Their own sent draft, not an inbound ask.
    expect(buyerSees.currentPresentationSource!.kind).toBe("commercial_order");
    const proposalId = (await holderOpens()).entity!.ref;
    const result = await pressAccept({
      conversationId: buyerConversation, proposalId: String(proposalId),
      version: "economic_proposal:1", ownerId: BUYER,
    });
    expect(result.outcome).toBe("UNAUTHORIZED");
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("a stranger sees nothing and can accept nothing", async () => {
    await buyerSendsProposal(HOLDOUTS[2]);
    const stranger = await holderOpens(STRANGER);
    expect(stranger.source?.kind).not.toBe("economic_proposal");
    const proposalId = (await holderOpens()).entity!.ref;
    const result = await pressAccept({
      conversationId: stranger.conversationId, proposalId: String(proposalId),
      version: "economic_proposal:1", ownerId: STRANGER,
    });
    expect(result.outcome).toBe("UNAUTHORIZED");
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("what I am doing outranks what somebody asks of me", async () => {
    // The holder is themselves mid-decision on a draft of their own. An
    // inbound ask does not interrupt it.
    await buyerSendsProposal(HOLDOUTS[0]);
    const e = await fabric.createExpression({
      ownerId: STRANGER, kind: "offering", semanticType: "quarry.dust.suppression",
      attributes: { quantity: 1 },
    });
    await fabric.publishExpression({
      id: e.id, ownerId: STRANGER,
      projection: { semanticType: "quarry.dust.suppression", summary: "س", publicTerms: { unit: "each" } },
    });
    const own = await runtime.createRuntimeConversation({ ownerId: HOLDER, title: "لي" });
    await runtime.routeRuntimeConversationCommerceEnvelope({
      ownerId: HOLDER, conversationId: own.id, content: "ابحث عن quarry.dust.suppression",
      envelope: { kind: "direct_action", capability: "discovery-search", confidence: 0.8 },
    } as never);
    const grid = await projection.getActiveWorkspaceProjection({ ownerId: HOLDER, conversationId: own.id });
    const card = (grid.currentPresentation!.data as { candidates: Record<string, unknown>[] }).candidates[0]!;
    const cp = card.provenance as Record<string, unknown>;
    await dispatch(HOLDER, {
      version: 1, actionId: `s:${card.ref}`, actionType: "SELECT_ENTITY", intent: `select:${card.ref}`,
      source: "CONVERSATION", targetReference: { kind: String(cp.canonicalKind), id: String(card.ref) },
      conversationReference: { kind: "conversation", id: own.id },
      expectedPresentationVersion: `${cp.canonicalKind}:${cp.version}`,
      payload: { entityId: String(card.ref) },
    });
    const mine = await projection.getActiveWorkspaceProjection({ ownerId: HOLDER, conversationId: own.id });
    expect(mine.currentPresentationSource!.kind).toBe("commercial_order");
    // And in a thread with nothing of their own, the ask is what they see.
    expect((await holderOpens()).source!.kind).toBe("economic_proposal");
  });

  it("declining is not this action, and is refused rather than read as assent", async () => {
    await buyerSendsProposal(HOLDOUTS[1]);
    const seen = await holderOpens();
    const provenance = seen.entity!.provenance as Record<string, unknown>;
    const result = await pressAccept({
      conversationId: seen.conversationId, proposalId: String(seen.entity!.ref),
      version: `economic_proposal:${provenance.version}`, decision: "reject",
    });
    expect(result.outcome).toBe("BLOCKED");
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("a stale version cannot accept", async () => {
    await buyerSendsProposal(HOLDOUTS[2]);
    const seen = await holderOpens();
    const result = await pressAccept({
      conversationId: seen.conversationId, proposalId: String(seen.entity!.ref),
      version: "economic_proposal:99",
    });
    expect(result.outcome).toBe("STALE");
    expect(await handle.db.select().from(agreements)).toHaveLength(0);
  });

  it("two presses on one term sheet make one agreement", async () => {
    await buyerSendsProposal(HOLDOUTS[0]);
    const seen = await holderOpens();
    const provenance = seen.entity!.provenance as Record<string, unknown>;
    const press = () => pressAccept({
      conversationId: seen.conversationId, proposalId: String(seen.entity!.ref),
      version: `economic_proposal:${provenance.version}`,
    });
    await Promise.all([press(), press()]);
    expect(await handle.db.select().from(agreements)).toHaveLength(1);
  });

  it("once agreed, the ask is no longer waiting on anybody", async () => {
    await buyerSendsProposal(HOLDOUTS[1]);
    const seen = await holderOpens();
    const provenance = seen.entity!.provenance as Record<string, unknown>;
    await pressAccept({
      conversationId: seen.conversationId, proposalId: String(seen.entity!.ref),
      version: `economic_proposal:${provenance.version}`,
    });
    const after = await projection.getActiveWorkspaceProjection({
      ownerId: HOLDER, conversationId: seen.conversationId,
    });
    expect(after.currentPresentationSource?.kind).not.toBe("economic_proposal");
  });

  it("every unfamiliar kind travels the same path", async () => {
    for (const kind of HOLDOUTS) {
      await handle.db.execute(sql.raw(`TRUNCATE TABLE economic_expressions, economic_matches,
        economic_engagements, economic_proposals, discovery_result_sets, discovery_candidates,
        reference_bindings, commercial_orders, agreements, commitments, transactions,
        messages, conversations, events CASCADE`));
      await buyerSendsProposal(kind);
      const seen = await holderOpens();
      expect(seen.primitive, kind).toBe("DETAIL");
      const provenance = seen.entity!.provenance as Record<string, unknown>;
      expect((await pressAccept({
        conversationId: seen.conversationId, proposalId: String(seen.entity!.ref),
        version: `economic_proposal:${provenance.version}`,
      })).outcome, kind).toBe("DISPATCH_ACCEPTED");
      expect((await handle.db.select().from(agreements)).length, kind).toBe(1);
    }
  });

  it("the conversational path still cannot accept for anybody", async () => {
    //   MODEL != AUTHORITY — unchanged by this phase, and asserted so.
    const orchestrator = readFileSync("api/runtime/block31/conversation-orchestrator.ts", "utf8");
    expect(orchestrator).not.toContain("ownerDirect");
    const files = ["api/runtime/presentation-fabric.ts", "api/runtime/active-workspace-projection.ts"];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").toLowerCase();
      for (const word of ["glacier", "textile", "orchard", "quarry", "car", "hotel"]) {
        expect(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`).toBe(false);
      }
    }
  });
});
