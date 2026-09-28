/**
 * JASIM — تخمين عن شيء يملكه غيرك لا يحسم بيعاً.
 *
 *   INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0
 *   INFERRED_VALUE_ADMITS_A_CANDIDATE = 0
 *   MODEL_GUESS != OWNER_CLAIM · OWNER_CLAIM != VERIFIED_FACT
 *
 * جانب الحاجة يملك هذا القانون منذ زمن: `goal-spec` يسجّل STATED أو INFERRED لكل
 * قيد، ويُنزل المستنتَج من HARD إلى SOFT لأن «الاستنتاج يوجّه ولا يستبعد». جانب
 * العرض لم يملك منه شيئاً — و`evaluateMatch` يقرأ `offering.attributes` كحقيقة.
 * فكان تخمين النموذج عن سيارة شخص آخر يحسم المطابقة في الاتجاهين.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { economicExpressions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fabric: typeof import("../../api/runtime/economic-fabric");
let compose: typeof import("../../api/runtime/seller-composition");
let goals: typeof import("../../api/runtime/goal-spec");

const SELLER = "owner-seller";
const BUYER = "owner-buyer";
const KIND = "مركبة";

describe("where an offered value came from", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    fabric = await import("../../api/runtime/economic-fabric");
    compose = await import("../../api/runtime/seller-composition");
    goals = await import("../../api/runtime/goal-spec");
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

  // ── fixtures ─────────────────────────────────────────────────────────────

  /** An offering whose colour came from wherever the test says. */
  async function offering(input: {
    attributes: Record<string, unknown>;
    provenance?: Record<string, "STATED" | "INFERRED" | "OBSERVED">;
  }) {
    const created = await fabric.createExpression({
      ownerId: SELLER, kind: "offering", semanticType: KIND,
      attributes: input.attributes,
      ...(input.provenance ? { attributeProvenance: input.provenance } : {}),
    });
    return fabric.publishExpression({
      id: created.id, ownerId: SELLER, projection: { semanticType: KIND },
    });
  }

  /** A buyer who cares about the colour, as a wall. */
  const needFor = (constraints: unknown[]) =>
    fabric.createExpression({
      ownerId: BUYER, kind: "need", semanticType: KIND,
      hardConstraints: constraints as never,
    });

  const EQUALS_WHITE = [{ field: "colour", operator: "eq", value: "أبيض" }];

  const stateOf = (result: { results: { field: string; state: string }[] }) =>
    result.results.find((one) => one.field === "colour")!.state;

  // ── 1 · ما قاله المالك يحسم ──────────────────────────────────────────────

  it("a value the owner stated decides, in both directions", async () => {
    const white = await offering({
      attributes: { colour: "أبيض" }, provenance: { colour: "STATED" },
    });
    const black = await offering({
      attributes: { colour: "أسود" }, provenance: { colour: "STATED" },
    });
    const need = await needFor(EQUALS_WHITE);
    expect(stateOf(fabric.evaluateMatch(await raw(need.id), await raw(white.id)))).toBe("PASS");
    expect(stateOf(fabric.evaluateMatch(await raw(need.id), await raw(black.id)))).toBe("FAIL");
  });

  it("a value a connected system observed decides too", async () => {
    // OBSERVED is a reading from a system the owner connected, not a guess.
    const seen = await offering({
      attributes: { colour: "أبيض" }, provenance: { colour: "OBSERVED" },
    });
    const need = await needFor(EQUALS_WHITE);
    expect(stateOf(fabric.evaluateMatch(await raw(need.id), await raw(seen.id)))).toBe("PASS");
  });

  it("a value with no recorded source keeps deciding, as it always did", async () => {
    // Every existing writer is the owner's composition or trusted config. This
    // does not retroactively weaken them.
    const legacy = await offering({ attributes: { colour: "أبيض" } });
    const need = await needFor(EQUALS_WHITE);
    expect(stateOf(fabric.evaluateMatch(await raw(need.id), await raw(legacy.id)))).toBe("PASS");
  });

  // ── 2 · ما استنتجه النموذج لا يحسم ───────────────────────────────────────

  it("an inferred value neither excludes nor admits — it is UNKNOWN", async () => {
    //   INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0
    //   INFERRED_VALUE_ADMITS_A_CANDIDATE = 0
    const guessedWhite = await offering({
      attributes: { colour: "أبيض" }, provenance: { colour: "INFERRED" },
    });
    const guessedBlack = await offering({
      attributes: { colour: "أسود" }, provenance: { colour: "INFERRED" },
    });
    const need = await needFor(EQUALS_WHITE);
    // The guess that would have ADMITTED it does not.
    const admitted = fabric.evaluateMatch(await raw(need.id), await raw(guessedWhite.id));
    expect(stateOf(admitted)).toBe("UNKNOWN");
    expect(admitted.viable).toBe(false);
    // And the guess that would have EXCLUDED it does not either — which is the
    // half that costs the seller, and is just as wrong.
    const excluded = fabric.evaluateMatch(await raw(need.id), await raw(guessedBlack.id));
    expect(stateOf(excluded)).toBe("UNKNOWN");
    expect(excluded.results.some((one) => one.state === "FAIL")).toBe(false);
    // The reason travels, so a person can be told why.
    expect(excluded.results[0]!.detail).toContain("inferred");
  });

  it("only the inferred field is silenced; the stated ones still decide", async () => {
    const mixed = await offering({
      attributes: { colour: "أبيض", year: 2019 },
      provenance: { colour: "INFERRED", year: "STATED" },
    });
    const need = await needFor([
      ...EQUALS_WHITE,
      { field: "year", operator: "gte", value: 2022 },
    ]);
    const result = fabric.evaluateMatch(await raw(need.id), await raw(mixed.id));
    expect(stateOf(result)).toBe("UNKNOWN");
    // The year the owner stated still excludes it. A guess is not a shield.
    expect(result.results.find((one) => one.field === "year")!.state).toBe("FAIL");
    expect(result.viable).toBe(false);
  });

  it("an inferred capacity does not contribute to a composite promise", async () => {
    //   INFERRED_VALUE_CONTRIBUTES_TO_A_CAPACITY_PROMISE = 0
    const needFor120 = () =>
      fabric.createExpression({
        ownerId: BUYER, kind: "need", semanticType: KIND,
        hardConstraints: [{ field: "capacity", operator: "gte", value: 120 }] as never,
        attributes: { splitAllowed: true },
      });

    // Two stated halves DO add up to the promise.
    await offering({ attributes: { capacity: 80 }, provenance: { capacity: "STATED" } });
    await offering({ attributes: { capacity: 80 }, provenance: { capacity: "STATED" } });
    const both = await fabric.matchNeed({
      needId: (await needFor120()).id, requesterOwnerId: BUYER,
    });
    expect(JSON.stringify(both)).not.toBe('{"matches":[]}');

    // Now the same arithmetic with one half GUESSED. 80 stated + 80 guessed
    // would reach 120 — and a guess may not be half of a promise somebody is
    // held to, so nothing here promises anything.
    await handle.db.execute(sql.raw(`DELETE FROM economic_matches`));
    await handle.db.execute(
      sql.raw(`DELETE FROM economic_expressions WHERE kind = 'offering'`),
    );
    await offering({ attributes: { capacity: 80 }, provenance: { capacity: "STATED" } });
    await offering({ attributes: { capacity: 80 }, provenance: { capacity: "INFERRED" } });
    const half = await fabric.matchNeed({
      needId: (await needFor120()).id, requesterOwnerId: BUYER,
    });
    expect(half).toEqual({ matches: [] });
  });

  // ── 3 · نفس القانون على الجانبين ─────────────────────────────────────────

  it("the two sides now say the same thing", async () => {
    // The need side downgrades an inferred wall to a preference…
    const evaluated = goals.evaluateGoalSpec({
      version: 1,
      outcome: "مركبة",
      constraints: [
        {
          dimension: "COST", operator: "AT_MOST", value: 18000, unit: "KWD",
          hardness: "HARD", source: "INFERRED", evidence: "قالها ضمناً",
        },
      ],
      preferences: ["COST"],
      assumptions: [],
      unknowns: [],
    } as never);
    expect(evaluated.adjustments.map((one) => one.code)).toContain(
      "INFERRED_CONSTRAINT_DOWNGRADED",
    );
    expect(evaluated.goal.constraints[0]!.hardness).toBe("SOFT");

    // …and the offer side refuses to let an inferred value answer a wall.
    const guessed = await offering({
      attributes: { colour: "أبيض" }, provenance: { colour: "INFERRED" },
    });
    expect(
      stateOf(fabric.evaluateMatch(await raw((await needFor(EQUALS_WHITE)).id), await raw(guessed.id))),
    ).toBe("UNKNOWN");
  });

  // ── 4 · المالك يرى ما خُمِّن قبل أن يؤكّد ────────────────────────────────

  it("the owner sees which values were guessed, and confirming covers that", async () => {
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND,
      stated: { colour: "أبيض", price: 17800 },
      provenance: { colour: "INFERRED" },
      attachments: ["art_1"],
      willPublish: { semanticType: KIND, summary: "مركبة" },
    });
    // Shown back before anything is public.
    expect(draft.provenance).toEqual({ colour: "INFERRED" });
    expect(draft.stated).toEqual({ colour: "أبيض", price: 17800 });

    // Changing ONLY the provenance moves the fingerprint: «this came from your
    // photo» is part of the statement, not a footnote.
    const corrected = await compose.composeOffering({
      ownerId: SELLER, expressionId: draft.expressionId,
      stated: { colour: "أبيض", price: 17800 },
      provenance: { colour: "STATED" },
    });
    expect(corrected.fingerprint).not.toBe(draft.fingerprint);
    await expect(
      compose.publishComposedOffering({
        expressionId: draft.expressionId, ownerId: SELLER,
        confirmFingerprint: draft.fingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });

    // Confirming the corrected one publishes, and the owner's word now decides.
    const read = await compose.readDraft({ expressionId: draft.expressionId, ownerId: SELLER });
    await compose.publishComposedOffering({
      expressionId: draft.expressionId, ownerId: SELLER, confirmFingerprint: read.fingerprint,
    });
    const need = await needFor(EQUALS_WHITE);
    expect(stateOf(fabric.evaluateMatch(await raw(need.id), await raw(draft.expressionId))))
      .toBe("PASS");
  });

  it("a provenance entry for a field nobody stated, or an invented word, is dropped", async () => {
    //   UNRECOGNIZED_PROVENANCE_READ_AS_STATED = 0
    const draft = await compose.composeOffering({
      ownerId: SELLER, semanticType: KIND,
      stated: { colour: "أبيض" },
      provenance: {
        colour: "INFERRED",
        mileage: "OBSERVED",
        price: "VERIFIED",
      } as never,
    });
    // «mileage» was never stated, and VERIFIED is not a source anybody assigns.
    expect(draft.provenance).toEqual({ colour: "INFERRED" });
    expect(fabric.VALUE_PROVENANCES).not.toContain("VERIFIED");
  });

  // ── 5 · لا مجال، ولا مصدر يمنح نفسه التحقّق ──────────────────────────────

  it("the law names no domain, and nothing calls itself verified", async () => {
    const source = await readFile(
      new URL("../../api/runtime/economic-fabric.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    const start = source.indexOf("function evaluateConstraint");
    const body = source.slice(start, source.indexOf("export function evaluateMatch"));
    expect(body).toContain('=== "INFERRED"');
    for (const forbidden of ["colour", "car", "mileage", "price", "food", "hotel"]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // VERIFIED stays a verdict `evidence-sufficiency` reaches, never a label.
    expect(source).not.toMatch(/VALUE_PROVENANCES\s*=\s*\[[^\]]*VERIFIED/);
    const sufficiency = await readFile(
      new URL("../../api/runtime/evidence-sufficiency.ts", import.meta.url), "utf8",
    );
    expect(sufficiency).toContain("SUFFICIENT");
  });

  async function raw(id: string) {
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, id)).limit(1);
    return row!;
  }
});
