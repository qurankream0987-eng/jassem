/**
 * JASIM — ما قاله البائع، لا ما فهمه النموذج.
 *
 *   MODEL_EXTRACTION != SELLER_DECLARATION
 *   IMAGE_INTERPRETATION != SELLER_DECLARATION
 *   DRAFT != PUBLISHED
 *   PUBLISH_CONFIRMS_EXACT_CONTENT · STALE_CONFIRMATION_PUBLISHES = 0
 *
 * A public listing binds its owner. A colour a model inferred from a photo, a
 * year it read out of a filename — the seller answers for all of it, to a buyer
 * and later to whoever adjudicates the sale. So publishing confirms an exact
 * statement, not merely the wish to publish.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { economicExpressions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let compose: typeof import("../../api/runtime/seller-composition");
let fabric: typeof import("../../api/runtime/economic-fabric");
let broker: typeof import("../../api/runtime/cross-party-brokering");

const SELLER = "owner-seller";
const BUYER = "owner-buyer";
const STRANGER = "owner-stranger";
const KIND = "سيارة برادو";

describe("what a seller publishes", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    compose = await import("../../api/runtime/seller-composition");
    fabric = await import("../../api/runtime/economic-fabric");
    broker = await import("../../api/runtime/cross-party-brokering");
  }, 60_000);

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE cross_party_questions, economic_proposals, economic_engagements,
        economic_matches, economic_expressions, transaction_intents, memberships CASCADE`),
    );
  });

  const rowOf = async (id: string) => {
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, id)).limit(1);
    return row!;
  };

  const publicRows = () =>
    handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.visibility, "public"));

  // ── 1 · النشر يؤكّد نصّاً بعينه ───────────────────────────────────────────

  it("composing across turns stays private, and publishing quotes what was read", async () => {
    // The seller starts. Nothing is public.
    const first = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { year: 2019 },
    });
    expect(first.stated).toEqual({ year: 2019 });
    expect(await publicRows()).toHaveLength(0);
    expect((await rowOf(first.expressionId)).visibility).toBe("private");
    expect((await rowOf(first.expressionId)).status).toBe("draft");

    // They say more, over another turn.
    const second = await compose.composeOffering({
      ownerId: SELLER, expressionId: first.expressionId,
      stated: { year: 2019, colour: "أبيض" },
      willPublish: { semanticType: KIND, summary: "برادو ٢٠١٩ أبيض" },
    });
    expect(second.stated).toEqual({ year: 2019, colour: "أبيض" });
    expect(second.willPublish).toEqual({ semanticType: KIND, summary: "برادو ٢٠١٩ أبيض" });
    // Amending moved the fingerprint.
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(await publicRows()).toHaveLength(0);

    // The seller reads exactly what will be published, then confirms THAT.
    const read = await compose.readDraft({
      expressionId: first.expressionId, ownerId: SELLER,
    });
    expect(read.fingerprint).toBe(second.fingerprint);
    const published = await compose.publishComposedOffering({
      expressionId: first.expressionId, ownerId: SELLER,
      confirmFingerprint: read.fingerprint,
    });
    const live = await rowOf(published.expressionId);
    expect(live.visibility).toBe("public");
    expect(live.status).toBe("active");
    expect(live.publicProjection).toEqual({ semanticType: KIND, summary: "برادو ٢٠١٩ أبيض" });
  });

  // ── 2 · تأكيد قديم لا ينشر نصّاً جديداً ──────────────────────────────────

  it("a confirmation of what it used to say publishes nothing", async () => {
    //   STALE_CONFIRMATION_PUBLISHES = 0
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { price: 100 },
      willPublish: { semanticType: KIND, summary: "برادو" },
    });
    const seen = await compose.readDraft({
      expressionId: draft.expressionId, ownerId: SELLER,
    });

    // One more sentence arrives before the seller confirms.
    await compose.composeOffering({
      ownerId: SELLER, expressionId: draft.expressionId,
      stated: { price: 100, accidents: "لا يوجد" },
      willPublish: { semanticType: KIND, summary: "برادو — بدون حوادث" },
    });

    await expect(
      compose.publishComposedOffering({
        expressionId: draft.expressionId, ownerId: SELLER,
        confirmFingerprint: seen.fingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await publicRows()).toHaveLength(0);

    // Reading again, and confirming that, works.
    const again = await compose.readDraft({
      expressionId: draft.expressionId, ownerId: SELLER,
    });
    await compose.publishComposedOffering({
      expressionId: draft.expressionId, ownerId: SELLER,
      confirmFingerprint: again.fingerprint,
    });
    expect((await rowOf(draft.expressionId)).publicProjection).toMatchObject({
      summary: "برادو — بدون حوادث",
    });
  });

  it("a fingerprint from another draft, or invented, publishes nothing", async () => {
    const a = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { n: 1 },
      willPublish: { semanticType: KIND, summary: "أ" },
    });
    const b = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { n: 2 },
      willPublish: { semanticType: KIND, summary: "ب" },
    });
    for (const wrong of [b.fingerprint, "0".repeat(64), ""]) {
      await expect(
        compose.publishComposedOffering({
          expressionId: a.expressionId, ownerId: SELLER, confirmFingerprint: wrong,
        }),
      ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    }
    expect(await publicRows()).toHaveLength(0);
  });

  // ── 3 · مسودّة ليست منشوراً، ومنشور ليس مسودّة ───────────────────────────

  it("a published offering cannot be quietly amended, and cannot be published twice", async () => {
    //   DRAFT != PUBLISHED
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { price: 100 },
      willPublish: { semanticType: KIND, summary: "برادو" },
    });
    const read = await compose.readDraft({ expressionId: draft.expressionId, ownerId: SELLER });
    await compose.publishComposedOffering({
      expressionId: draft.expressionId, ownerId: SELLER, confirmFingerprint: read.fingerprint,
    });
    const live = await rowOf(draft.expressionId);

    // Buyers are looking at this now. Composing over it is refused.
    await expect(
      compose.composeOffering({
        ownerId: SELLER, expressionId: draft.expressionId, stated: { price: 1 },
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    await expect(
      compose.publishComposedOffering({
        expressionId: draft.expressionId, ownerId: SELLER, confirmFingerprint: read.fingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await rowOf(draft.expressionId)).toEqual(live);
  });

  it("an empty statement is not a listing", async () => {
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { year: 2019 },
    });
    await expect(
      compose.publishComposedOffering({
        expressionId: draft.expressionId, ownerId: SELLER,
        confirmFingerprint: draft.fingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await publicRows()).toHaveLength(0);
  });

  it("an offering with no kind is not an offering", async () => {
    for (const semanticType of [undefined, "", "   "]) {
      await expect(
        compose.composeOffering({ ownerId: SELLER, semanticType, stated: { a: 1 } }),
      ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    }
    expect(await handle.db.select().from(economicExpressions)).toHaveLength(0);
  });

  // ── 4 · مسودّة أحدهم ليست مسودّة أحد آخر ─────────────────────────────────

  it("nobody reads, amends or publishes somebody else's draft", async () => {
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { price: 100 },
      willPublish: { semanticType: KIND, summary: "برادو" },
    });
    for (const outsider of [BUYER, STRANGER]) {
      await expect(
        compose.readDraft({ expressionId: draft.expressionId, ownerId: outsider }),
      ).rejects.toMatchObject({ name: "EconomicNotFoundError" });
      await expect(
        compose.composeOffering({
          ownerId: outsider, expressionId: draft.expressionId, stated: { price: 1 },
        }),
      ).rejects.toMatchObject({ name: "EconomicNotFoundError" });
      await expect(
        compose.publishComposedOffering({
          expressionId: draft.expressionId, ownerId: outsider,
          confirmFingerprint: draft.fingerprint,
        }),
      ).rejects.toMatchObject({ name: "EconomicNotFoundError" });
    }
    expect((await rowOf(draft.expressionId)).visibility).toBe("private");
  });

  // ── 5 · الصورة ليست تصريحاً ──────────────────────────────────────────────

  it("photos are carried, never read, and never become what the offering says", async () => {
    //   IMAGE_INTERPRETATION != SELLER_DECLARATION
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND,
      stated: { year: 2019 },
      attachments: ["art_front", "art_interior"],
      willPublish: { semanticType: KIND, summary: "برادو ٢٠١٩" },
    });
    expect(draft.attachments).toEqual(["art_front", "art_interior"]);
    // An attachment is not one of the stated values.
    expect(draft.stated).toEqual({ year: 2019 });
    expect(Object.keys(draft.stated)).not.toContain("attachments");
    // Nothing was derived from them: the colour nobody stated is not there.
    expect(JSON.stringify(draft.willPublish)).not.toMatch(/أبيض|white|colour|color/i);

    const read = await compose.readDraft({ expressionId: draft.expressionId, ownerId: SELLER });
    await compose.publishComposedOffering({
      expressionId: draft.expressionId, ownerId: SELLER, confirmFingerprint: read.fingerprint,
    });
    // And the public words still carry only what the seller said.
    expect(await rowOf(draft.expressionId)).toMatchObject({
      publicProjection: { semanticType: KIND, summary: "برادو ٢٠١٩" },
    });
  });

  // ── 6 · الناقص يظهر بالسؤال، لا بقالب مجال ───────────────────────────────

  it("what the seller did not state stays unstated until somebody asks", async () => {
    //   MISSING_DETAIL_INVENTED_FROM_A_DOMAIN_TEMPLATE = 0
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND, stated: { year: 2019 },
      willPublish: { semanticType: KIND, summary: "برادو ٢٠١٩" },
    });
    const read = await compose.readDraft({ expressionId: draft.expressionId, ownerId: SELLER });
    await compose.publishComposedOffering({
      expressionId: draft.expressionId, ownerId: SELLER, confirmFingerprint: read.fingerprint,
    });
    // Nothing invented a mileage because cars usually have one.
    const live = await rowOf(draft.expressionId);
    expect(JSON.stringify(live)).not.toMatch(/mileage|ممشى/i);

    // A buyer reaches the seller and asks — the honest way a gap surfaces.
    const need = await fabric.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
    });
    const match = await fabric.matchNeedToOffering({
      needId: need.id, offeringId: draft.expressionId, createdByOwnerId: BUYER,
    });
    const engagement = await fabric.createEngagement({
      matchId: match.id, initiatorOwnerId: BUYER, participants: [BUYER, SELLER],
    });
    const asked = await broker.askCounterparty({
      engagementId: engagement.id, askedByOwnerId: BUYER,
      subjectExpressionId: draft.expressionId, property: "mileage",
    });
    const answered = await broker.answerQuestion({
      questionId: asked.questionId, answeringOwnerId: SELLER, value: 120_000,
    });
    expect(answered.answer).toMatchObject({ value: 120_000, source: "SELF_REPORTED" });
    // The answer is evidence, and still not something the listing declares.
    const after = await rowOf(draft.expressionId);
    expect(JSON.stringify(after.attributes)).not.toContain("120000");
    expect(JSON.stringify(after.publicProjection)).not.toContain("120000");
  });

  // ── 7 · الوحدة لا تستشير نموذجاً ولا تعرف مجالاً ─────────────────────────

  it("composition consults no model and knows no domain", async () => {
    const source = await readFile(
      new URL("../../api/runtime/seller-composition.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    for (const forbidden of [
      "ModelGateway", "model-gateway", "generate", "prompt", "complete(", "infer",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    for (const forbidden of [
      "car", "سيارة", "vehicle", "mileage", "colour", "year", "price",
      "restaurant", "laptop", "phone",
    ]) {
      expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // One road to public, and it is the owner-gated one that already existed.
    expect(source).toContain("publishExpression");
    expect(source).not.toMatch(/visibility:\s*"public"|status:\s*"active"/);
  });
});
