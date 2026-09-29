/**
 * JASIM — WHO ASKED IS NOT WHO PAYS.
 *
 * ─── THE GAP, TRACED IN ONE LINE ────────────────────────────────────────────
 *
 * `termSheetFor` built the settlement term as:
 *
 *     owedBy: input.proposer,
 *     owedTo: input.counterparty,
 *
 * unconditionally. THE MONEY ALWAYS FLOWED FROM WHOEVER ASKED.
 *
 * So «عندي ١٨٠ لتر زيت مستعمل، أريد من يجمعه» — where the collector may PAY
 * the owner of the oil — could not be expressed at all. Asking made you the
 * payer. The same is true of anybody buying something back, paying a deposit,
 * or taking waste away for money.
 *
 *   WHO_ASKED != WHO_PAYS · ECONOMICS_IS_DATA
 *
 * ─── AND WHOSE DATA IT IS ───────────────────────────────────────────────────
 *
 *   THE OFFERING DECLARES THE DIRECTION. THE REQUEST NEVER DOES.
 *
 * Read from the offering's OWN published terms, never from the merged terms a
 * requester contributed configuration to — otherwise the person asking could
 * flip who pays whom by stating a value. An unreadable direction falls back to
 * the requester paying: the status quo, and the one direction that cannot hand
 * somebody money they were never promised.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { economicProposals, referenceBindings } from "@db/schema";
import { commitments } from "@db/schema-block2";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let setNegotiationEnvelope: typeof import("../../api/runtime/agreement-runtime").setNegotiationEnvelope;
let resolvePayable: typeof import("../../api/runtime/block31/canonical-payable").resolvePayable;

/** Whoever asks. In the oil case, the person who HAS the thing. */
const ASKER = "pays-asker";
/** Whoever published the offering. In the oil case, the collector. */
const OWNER = "pays-owner";

const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;

type Envelope = {
  decisionId: string;
  kind: string;
  intent?: { requiredCapabilities: string[]; missingInputs: string[]; inputs: Record<string, unknown> };
};
const envelope = (capabilities: string[], inputs: Record<string, unknown> = {}): Envelope => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: capabilities, missingInputs: [], inputs },
});

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
  ({ setNegotiationEnvelope } = await import("../../api/runtime/agreement-runtime"));
  ({ resolvePayable } = await import("../../api/runtime/block31/canonical-payable"));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      commercial_orders, payment_intents, agreements, commitments,
      negotiation_envelopes, economic_proposals, economic_engagements,
      economic_matches, economic_expressions CASCADE
  `));
});

describe("who asked is not who pays", () => {
  /**
   * An offering that declares which way the money runs.
   *
   * `owedBy` is inside the offering's own published terms. Absent means the
   * requester pays, which is what every offering written before this meant.
   */
  async function offering(input: {
    semanticType: string;
    amountMinor: string;
    owedBy?: string;
    configurableTerms?: Record<string, unknown>;
  }) {
    const expression = await createExpression({
      ownerId: OWNER,
      kind: "offering",
      semanticType: input.semanticType,
      attributes: { priceMinor: input.amountMinor, currency: "SAR" },
    });
    return publishExpression({
      id: expression.id,
      ownerId: OWNER,
      projection: {
        semanticType: input.semanticType,
        summary: input.semanticType,
        publicTerms: {
          money: {
            amountMinor: input.amountMinor,
            currency: "SAR",
            ...(input.owedBy === undefined ? {} : { owedBy: input.owedBy }),
          },
        },
        ...(input.configurableTerms ? { configurableTerms: input.configurableTerms } : {}),
      },
    });
  }

  /** search → take the first → send the request. */
  async function request(semanticType: string, configuration?: Record<string, unknown>) {
    const conversationId = `pays-${randomUUID()}`;
    const say = (ownerId: string, content: string, env: Envelope) =>
      orchestrate({
        db: handle.db,
        worlds,
        ownerId,
        conversationId,
        content,
        approvalRef: `message-${randomUUID()}`,
        envelope: env,
      });
    await say(ASKER, `ابحث عن ${semanticType}`, envelope(["discovery"], { query: semanticType }));
    await say(ASKER, "خذ الأولى", envelope(["commerce:select"], { position: 1 }));
    if (configuration) {
      await say(ASKER, "اضبط", envelope(["commerce:configure"], { configuration }));
    }
    const sent = await say(ASKER, "اطلبها", envelope(["commerce:propose"]));
    return { conversationId, say, sent };
  }

  /** The settlement term as the proposal actually stored it. */
  async function settlementTerm(conversationId: string) {
    const rows = await handle.db.select().from(economicProposals);
    expect(rows.length, "one proposal").toBe(1);
    const terms = (rows[0]!.terms as { terms?: Array<Record<string, unknown>> }).terms ?? [];
    return terms.find((term) => term.key === "settlement");
  }

  // ── 1. THE DEFAULT, UNCHANGED ──────────────────────────────────────────────

  it("an offering that says nothing means the requester pays, exactly as before", async () => {
    await offering({ semanticType: "workspace.seat", amountMinor: "5000" });
    const { conversationId, sent } = await request("workspace.seat");

    const settlement = await settlementTerm(conversationId);
    expect(settlement!.owedBy).toBe(ASKER);
    expect(settlement!.owedTo).toBe(OWNER);
    expect(sent?.data.settlementOwedBy).toBe("REQUESTER");
  });

  it("and saying REQUESTER means the same thing", async () => {
    await offering({ semanticType: "workspace.seat", amountMinor: "5000", owedBy: "REQUESTER" });
    const { conversationId } = await request("workspace.seat");
    const settlement = await settlementTerm(conversationId);
    expect(settlement!.owedBy).toBe(ASKER);
  });

  // ── 2. THE GAP ─────────────────────────────────────────────────────────────

  it("an offering may declare that ITS OWNER pays whoever asks", async () => {
    //   «أجمع زيتك المستعمل وأدفع لك» — impossible before this.
    await offering({
      semanticType: "residue.collection",
      amountMinor: "5000",
      owedBy: "PROVIDER",
    });
    const { conversationId, sent } = await request("residue.collection");

    const settlement = await settlementTerm(conversationId);
    expect(settlement!.owedBy).toBe(OWNER);
    expect(settlement!.owedTo).toBe(ASKER);
    expect(sent?.data.settlementOwedBy).toBe("PROVIDER");
    // And it is said out loud, because having asked is exactly what makes a
    // person assume they are the one paying.
    expect(sent?.summary).toContain("هو");
  });

  it("the direction of the PROVISION is untouched either way", async () => {
    // Whoever published the offering still does the thing, whichever way the
    // money runs. Only the settlement moved.
    for (const owedBy of ["REQUESTER", "PROVIDER"]) {
      await handle.db.execute(sql.raw(`
        TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
          commercial_orders, economic_proposals, economic_engagements,
          economic_matches, economic_expressions CASCADE
      `));
      await offering({ semanticType: "residue.collection", amountMinor: "5000", owedBy });
      await request("residue.collection");
      const rows = await handle.db.select().from(economicProposals);
      const terms = (rows[0]!.terms as { terms?: Array<Record<string, unknown>> }).terms ?? [];
      const provision = terms.find((term) => term.key === "provision");
      expect(provision!.owedBy, owedBy).toBe(OWNER);
      expect(provision!.owedTo, owedBy).toBe(ASKER);
    }
  });

  // ── 3. IT REACHES CANONICAL OBLIGATIONS ────────────────────────────────────

  it("the obligation that materializes is owed by the owner, and the asker owes nothing", async () => {
    await offering({
      semanticType: "residue.collection",
      amountMinor: "5000",
      owedBy: "PROVIDER",
    });
    const { conversationId, say } = await request("residue.collection");

    // The offering's owner accepts inside bounds they set in advance. They are
    // the PAYER here, so their reserve runs the other way — which is their
    // business and, again, data.
    const engagement = (
      await handle.db.select().from(referenceBindings)
        .where(eq(referenceBindings.conversationId, conversationId))
    ).find((row) => row.referenceKey === "current:engagement");
    await setNegotiationEnvelope({
      engagementId: engagement!.targetId,
      ownerId: OWNER,
      principalId: OWNER,
      bounds: {
        settlement: { direction: "LOWER_IS_BETTER", target: 5000, reserve: 6000 },
        provision: { direction: "LOWER_IS_BETTER", target: 1, reserve: 2 },
      },
      mayAcceptWithinReserve: true,
    });
    const accepted = await say(OWNER, "أقبل", envelope(["proposal:accept"]));
    expect(accepted?.data.agreementId).toBeTruthy();

    const owed = await handle.db.select().from(commitments);
    const settlement = owed.filter((row) => row.termKey === "settlement");
    expect(settlement).toHaveLength(1);
    // Declared by the term, never inferred from a field name — and the term
    // now says the owner owes it.
    expect(settlement[0]!.ownerId).toBe(OWNER);
    expect(settlement[0]!.beneficiaryActorId).toBe(ASKER);

    // And the payoff: «ادفع» from the person who asked finds nothing to pay.
    const payable = await resolvePayable(handle.db, { scopeId: ASKER });
    expect(payable.status).toBe("NONE");
  });

  // ── 4. THE REQUEST CANNOT FLIP IT ──────────────────────────────────────────

  it("a requester cannot make somebody pay them by configuring a term", async () => {
    //   THE OFFERING DECLARES THE DIRECTION. THE REQUEST NEVER DOES.
    await offering({
      semanticType: "workspace.seat",
      amountMinor: "5000",
      configurableTerms: { money: { kind: "OBJECT" } },
    });
    const { conversationId } = await request("workspace.seat", {
      money: { owedBy: "PROVIDER", amountMinor: "5000", currency: "SAR" },
    });
    const settlement = await settlementTerm(conversationId);
    // Still the requester. The direction was read from the offering's own
    // published terms, which the configuring party never touches.
    expect(settlement!.owedBy).toBe(ASKER);
  });

  it("a direction nobody can read falls back to the requester paying", async () => {
    for (const owedBy of ["", "   ", "SOMEBODY", "true", "provider "]) {
      await handle.db.execute(sql.raw(`
        TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
          commercial_orders, economic_proposals, economic_engagements,
          economic_matches, economic_expressions CASCADE
      `));
      await offering({ semanticType: "workspace.seat", amountMinor: "5000", owedBy });
      const { conversationId } = await request("workspace.seat");
      const settlement = await settlementTerm(conversationId);
      // `provider ` with whitespace IS readable and must flip; the rest are
      // not, and fall back to the direction that cannot hand somebody money
      // they were never promised.
      const expected = owedBy.trim().toUpperCase() === "PROVIDER" ? OWNER : ASKER;
      expect(settlement!.owedBy, JSON.stringify(owedBy)).toBe(expected);
    }
  });

  // ── 5. IT IS DATA, NOT A DOMAIN ────────────────────────────────────────────

  it("the same declaration works for anything at all", async () => {
    //   ECONOMICS_IS_DATA
    const subjects = [
      "residue.collection", "scrap.buyback", "deposit.refund",
      "salvage.recovery", "surplus.uplift",
    ];
    for (const semanticType of subjects) {
      await handle.db.execute(sql.raw(`
        TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
          commercial_orders, economic_proposals, economic_engagements,
          economic_matches, economic_expressions CASCADE
      `));
      await offering({ semanticType, amountMinor: "5000", owedBy: "PROVIDER" });
      const { conversationId } = await request(semanticType);
      const settlement = await settlementTerm(conversationId);
      expect(settlement!.owedBy, semanticType).toBe(OWNER);
    }
  });

  it("no noun decides who pays", () => {
    const source = readFileSync("api/runtime/block31/conversation-orchestrator.ts", "utf8");
    const fn = source.slice(source.indexOf("function settlementDirectionOf"));
    const body = fn
      .slice(0, fn.indexOf("\n}"))
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const word of ["oil", "waste", "scrap", "buy", "sell", "rent", "collect"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
    }
    // And the direction is never taken from the merged record.
    const sheet = source.slice(source.indexOf("function termSheetFor"));
    expect(sheet.slice(0, sheet.indexOf("\n}\n"))).not.toContain("merged.money.owedBy");
  });
});
