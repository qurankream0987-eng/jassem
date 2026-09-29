/**
 * JASIM — البائع يتكلّم، فيرى ما سيُنشر باسمه قبل أن يُنشر.
 *
 *   MODEL_EXTRACTION != SELLER_DECLARATION
 *   CONFIRMATION IS WHAT TURNS A PARSE INTO A DECLARATION
 *   DRAFT != PUBLISHED · STALE_CONFIRMATION_PUBLISHES = 0
 *
 * دور النشر كان يأخذ قراءة النموذج لجملة ويكتبها مباشرة في عرض عام باسم البائع،
 * في خطوة واحدة. وبناء المسودّة والتأكيد كان مبنيّاً منذ مرحلتين — ولم يكن
 * يُدرَك بالكلام، وهو الطريق الوحيد الذي يصل به أحد إلى أي شيء هنا.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { economicExpressions, referenceBindings } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;
let compose: typeof import("../../api/runtime/seller-composition");

const OWNER = "seller-turn-owner";
const OTHER = "seller-turn-other";
const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;

const envelope = (capabilities: string[], inputs: Record<string, unknown> = {}) => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: capabilities, missingInputs: [], inputs },
});

describe("a seller publishing by talking", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
    compose = await import("../../api/runtime/seller-composition");
  }, 60_000);

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await handle.db.execute(sql.raw(`
      TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
        commercial_orders, payment_intents, economic_expressions CASCADE
    `));
  });

  const say = (
    conversationId: string,
    content: string,
    capabilities: string[],
    inputs: Record<string, unknown> = {},
    ownerId = OWNER,
  ) =>
    orchestrate({
      db: handle.db, worlds, ownerId, conversationId, content,
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope(capabilities, inputs),
    });

  const OFFER = { subject: "قدرة مورد", priceMinor: "17800", currency: "JOD" };

  const publicRows = () =>
    handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.visibility, "public"));

  const allRows = () => handle.db.select().from(economicExpressions);

  // ── 1 · الدور الأول يعرض ولا ينشر ─────────────────────────────────────────

  it("saying «publish» shows the exact words and publishes nothing", async () => {
    //   MODEL_EXTRACTION != SELLER_DECLARATION
    const shown = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER);
    expect(shown?.label).toBe("Offering ready to publish");
    expect(shown?.status).toBe("awaiting_approval");
    expect(shown?.data.published).toBe(false);
    expect(shown?.data.effects).toBe("none");
    // The seller is shown the statement, not told it happened.
    expect(shown?.data.willPublish).toMatchObject({ semanticType: "قدرة مورد" });
    expect(shown?.data.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    // Nothing is public, and what exists is a private draft.
    expect(await publicRows()).toHaveLength(0);
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ visibility: "private", status: "draft", ownerId: OWNER });
  });

  // ── 2 · التأكيد ينشر ما عُرض بعينه ───────────────────────────────────────

  it("confirming publishes exactly that statement", async () => {
    const shown = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER);
    const done = await say("c1", "أوافق", ["commerce_approve"]);
    expect(done?.label).toBe("Offering published");
    expect(done?.status).toBe("completed");
    expect(done?.data.published).toBe(true);
    expect(done?.data.expressionId).toBe(shown!.data.expressionId);
    expect(done?.data.willPublish).toEqual(shown!.data.willPublish);

    const rows = await publicRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(shown!.data.expressionId);
    expect(rows[0]!.publicProjection).toMatchObject({ semanticType: "قدرة مورد" });
  });

  // ── 3 · تأكيد بلا مسودّة لا ينشر شيئاً ───────────────────────────────────

  it("a confirmation with nothing pending publishes nothing", async () => {
    const stray = await say("c1", "أوافق", ["commerce_approve"]);
    // It falls through to whatever else a confirmation means — and no offering
    // appeared out of a word.
    expect(stray?.label).not.toBe("Offering published");
    expect(await allRows()).toHaveLength(0);
  });

  it("a statement amended after it was shown is not published by the old confirmation", async () => {
    //   STALE_CONFIRMATION_PUBLISHES = 0
    const shown = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER);
    const expressionId = shown!.data.expressionId as string;
    // The seller changes the price through the composition runtime directly,
    // the way any other channel would.
    await compose.composeOffering({
      ownerId: OWNER, expressionId,
      stated: { priceMinor: 19000, currency: "JOD" },
    });
    // The turn re-reads the statement as it IS, so it publishes the CURRENT one
    // rather than a remembered fingerprint — and never the stale words.
    const done = await say("c1", "أوافق", ["commerce_approve"]);
    expect(done?.label).toBe("Offering published");
    const [row] = await publicRows();
    expect(row!.attributes).toMatchObject({ priceMinor: 19000 });
    expect(JSON.stringify(row!.attributes)).not.toContain("17800");
  });

  // ── 4 · عرض ثانٍ يُزيح الأول ─────────────────────────────────────────────

  it("composing again supersedes, so one confirmation publishes one thing", async () => {
    const first = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER);
    const second = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], {
      subject: "قدرة أخرى", priceMinor: "900", currency: "JOD",
    });
    expect(second!.data.expressionId).not.toBe(first!.data.expressionId);
    const done = await say("c1", "أوافق", ["commerce_approve"]);
    // The one that was shown last is the one that was confirmed.
    expect(done?.data.expressionId).toBe(second!.data.expressionId);
    const live = await publicRows();
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(second!.data.expressionId);
    // The earlier draft is still a draft, not quietly published or deleted.
    const rows = await allRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first!.data.expressionId)).toMatchObject({
      visibility: "private", status: "draft",
    });
  });

  // ── 5 · مسودّة أحدهم ليست مسودّة أحد آخر ─────────────────────────────────

  it("one seller's pending statement is not another's to confirm", async () => {
    await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER, OWNER);
    // Another person confirming in their own conversation publishes nothing.
    const theirs = await say("c2", "أوافق", ["commerce_approve"], {}, OTHER);
    expect(theirs?.label).not.toBe("Offering published");
    expect(await publicRows()).toHaveLength(0);
    // And the same conversation id under another owner reaches nothing either.
    const crossed = await say("c1", "أوافق", ["commerce_approve"], {}, OTHER);
    expect(crossed?.label).not.toBe("Offering published");
    expect(await publicRows()).toHaveLength(0);
  });

  // ── 6 · النقص ما زال يُرفض قبل أي شيء ────────────────────────────────────

  it("an incomplete statement is refused before a draft exists", async () => {
    for (const inputs of [
      { priceMinor: "17800", currency: "JOD" },
      { subject: "قدرة مورد" },
      { subject: "قدرة مورد", priceMinor: "17800" },
    ]) {
      const result = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], inputs);
      expect(result?.status, JSON.stringify(inputs)).toBe("awaiting_input");
      expect(result?.data.effects, JSON.stringify(inputs)).toBe("none");
    }
    expect(await allRows()).toHaveLength(0);
  });

  it("saying «publish» again about something new composes, never confirms", async () => {
    //   A_NEW_DESCRIPTION_CONFIRMS_THE_PREVIOUS_STATEMENT = 0
    //
    // Reading a fresh description as a confirmation would publish the previous
    // draft and drop the new one — the seller would watch the wrong thing go
    // out under their name.
    const first = await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER);
    const second = await say("c1", "اعرض هذا أيضاً", ["commerce_publish"], {
      subject: "قدرة أخرى", priceMinor: "900", currency: "JOD",
    });
    expect(second?.status).toBe("awaiting_approval");
    expect(second?.data.published).toBe(false);
    expect(second!.data.expressionId).not.toBe(first!.data.expressionId);
    expect(await publicRows()).toHaveLength(0);

    // Whereas «publish» naming nothing new IS a confirmation of what is pending.
    const done = await say("c1", "انشر", ["commerce_publish"]);
    expect(done?.label).toBe("Offering published");
    expect(done?.data.expressionId).toBe(second!.data.expressionId);
  });

  // ── 7 · المسودّة مربوطة بنوعها الخاص ─────────────────────────────────────

  it("the pending statement is bound under its own kind, and only one at a time", async () => {
    await say("c1", "اعرض هذا للبيع", ["commerce_publish"], OFFER);
    await say("c1", "اعرض هذا للبيع", ["commerce_publish"], {
      subject: "قدرة أخرى", priceMinor: "900", currency: "JOD",
    });
    const bindings = await handle.db.select().from(referenceBindings)
      .where(eq(referenceBindings.conversationId, "c1"));
    const drafts = bindings.filter((row) => row.targetKind === "offering_draft");
    expect(drafts).toHaveLength(2);
    // Exactly one is live; the first was superseded rather than left confirmable.
    expect(drafts.filter((row) => row.supersededAt === null)).toHaveLength(1);
    // And a draft is never bound as a discovery candidate.
    expect(bindings.some((row) => row.targetKind === "discovery_candidate")).toBe(false);
  });
});
