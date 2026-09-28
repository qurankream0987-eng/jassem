/**
 * JASIM — ألف صف يُقترَح، ولا واحد منها يَصير حقيقة وحده.
 *
 *   BULK_ROW_PUBLISHES_ITSELF = 0
 *   SPREADSHEET_ROW != TRUSTED_LIVE_STOCK
 *   BATCH_CONFIRMATION_COVERS_EXACT_ROWS · ONE_CHANGED_ROW_VOIDS_THE_BATCH
 *   GAP_DETECTION_USES_A_DOMAIN_TEMPLATE = 0
 *
 * صاحب ألف سلعة لا يُطلب منه أن يقولها ألف مرة — ولا يُسمح لألف صف أن تصير ألف
 * وعد عام. القانون لا يلين للحجم.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { economicExpressions } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let intake: typeof import("../../api/runtime/bulk-offer-intake");
let compose: typeof import("../../api/runtime/seller-composition");

const OWNER = "owner-trader";
const STRANGER = "owner-stranger";

/**
 * Six rows from six unrelated worlds, and not one of them is a kind of thing the
 * runtime knows. They differ in the words somebody wrote and nothing else.
 *
 *   DOMAIN_BRANCHES = 0 · FORMAT_BRANCHES = 0
 */
const ROWS = [
  { ref: "r1", semanticType: "زيت زيتون", stated: { priceMinor: 3500, currency: "JOD" } },
  { ref: "r2", semanticType: "ساعة تصوير", stated: { priceMinor: 15000, currency: "KWD" } },
  { ref: "r3", semanticType: "مسح بالسونار", stated: { areaMinor: 4000, currency: "JOD" } },
  { ref: "r4", semanticType: "سعة تخزين", stated: { capacity: 600, capacityUnit: "m3" } },
  { ref: "r5", semanticType: "نقل بحري", stated: { load: 7, loadUnit: "ton" } },
  { ref: "r6", semanticType: "مسح جوّي", stated: { area: 40, areaUnit: "hectare" } },
] as const;

const publishable = (row: (typeof ROWS)[number]) => ({
  ...row,
  willPublish: { semanticType: row.semanticType, summary: row.semanticType },
});

describe("what a batch of proposed rows becomes", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    intake = await import("../../api/runtime/bulk-offer-intake");
    compose = await import("../../api/runtime/seller-composition");
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

  const publicRows = () =>
    handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.visibility, "public"));

  const allRows = () => handle.db.select().from(economicExpressions);

  const rowOf = async (id: string) => {
    const [row] = await handle.db.select().from(economicExpressions)
      .where(eq(economicExpressions.id, id)).limit(1);
    return row!;
  };

  // ── 1 · الاستيعاب لا ينشر ─────────────────────────────────────────────────

  it("every row becomes a private draft and nothing at all becomes public", async () => {
    //   BULK_ROW_PUBLISHES_ITSELF = 0 · SPREADSHEET_ROW != TRUSTED_LIVE_STOCK
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: ROWS.map(publishable),
    });
    expect(report.ready).toHaveLength(6);
    expect(report.gaps).toEqual([]);
    expect(await publicRows()).toHaveLength(0);
    for (const one of report.ready) {
      expect(await rowOf(one.expressionId)).toMatchObject({
        visibility: "private", status: "draft", ownerId: OWNER,
      });
    }
    // The references come back so a row is addressable.
    expect(report.ready.map((one) => one.ref).sort()).toEqual(
      ROWS.map((one) => one.ref).slice().sort(),
    );
  });

  // ── 2 · النقص يُبلَّغ ولا يُملأ ───────────────────────────────────────────

  it("what is structurally unusable is reported per row, and never filled in", async () => {
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER,
      rows: [
        publishable(ROWS[0]!),
        // A number of minor units with no currency: an amount alone is not one.
        { ref: "g1", semanticType: "شيء", stated: { priceMinor: 900 },
          willPublish: { semanticType: "شيء" } },
        { ref: "g2", semanticType: "شيء", stated: { priceMinor: 900, currency: "ZZ" },
          willPublish: { semanticType: "شيء" } },
        // A quantity whose unit nothing can place: it can never answer anything.
        // A row that says a quantity has a unit and supplies none.
        { ref: "g3", semanticType: "شيء", stated: { volume: 30, volumeUnit: "  " },
          willPublish: { semanticType: "شيء" } },
        // Nothing to say publicly.
        { ref: "g4", semanticType: "شيء", stated: { n: 1 } },
        // No kind at all.
        { ref: "g5", stated: { n: 1 }, willPublish: { semanticType: "شيء" } },
      ],
    });
    expect(report.ready.map((one) => one.ref)).toEqual(["r1"]);
    const byRef = new Map(report.gaps.map((one) => [one.ref, one]));
    expect(byRef.get("g1")).toMatchObject({ reason: "MONEY_WITHOUT_CURRENCY", field: "priceMinor" });
    expect(byRef.get("g2")).toMatchObject({ reason: "MONEY_WITHOUT_CURRENCY" });
    expect(byRef.get("g3")).toMatchObject({
      reason: "QUANTITY_UNIT_DECLARED_BUT_EMPTY", field: "volume",
    });
    expect(byRef.get("g4")).toMatchObject({ reason: "NOTHING_TO_PUBLISH" });
    expect(byRef.get("g5")).toMatchObject({ reason: "NO_KIND" });

    // Nothing was invented to close a gap.
    const g3 = await allRows().then((rows) =>
      rows.find((row) => row.semanticType === "شيء" && row.attributes?.volume === 30),
    );
    expect(g3!.attributes).toEqual({ volume: 30, volumeUnit: "  " });
    // A row with no kind produced no expression at all.
    expect((await allRows()).some((row) => row.attributes?.n === 1 && row.semanticType === "شيء"))
      .toBe(true);
    expect(await publicRows()).toHaveLength(0);
  });

  it("a unit the table cannot place is not a gap, because it still works", async () => {
    // A rule that flagged «m3» and «hectare» was tried and withdrawn:
    // `evaluateConstraint` normalizes only when the two unit strings DIFFER, so
    // a need in m3 against an offering in m3 compares its numbers and works.
    //
    //   A GAP NOBODY HAS IS A GAP NOBODY SHOULD BE ASKED TO FILL.
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: [ROWS[3], ROWS[4], ROWS[5]].map((one) => publishable(one!)),
    });
    expect(report.gaps).toEqual([]);
    expect(report.ready).toHaveLength(3);
  });

  // ── 3 · التأكيد الجماعي يغطّي هذه الصفوف بعينها ──────────────────────────

  it("confirming the batch publishes exactly what was read", async () => {
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: ROWS.map(publishable),
    });
    const done = await intake.publishIntakeBatch({
      ownerId: OWNER, entries: report.ready,
      confirmBatchFingerprint: report.batchFingerprint,
    });
    expect(done.published).toHaveLength(6);
    expect(await publicRows()).toHaveLength(6);
    for (const id of done.published) {
      expect(await rowOf(id)).toMatchObject({ visibility: "public", status: "active" });
    }
  });

  it("one amended row voids the whole batch, and nothing is published", async () => {
    //   ONE_CHANGED_ROW_VOIDS_THE_BATCH
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: ROWS.map(publishable),
    });
    // The owner corrects a single price after reading the batch.
    await compose.composeOffering({
      ownerId: OWNER, expressionId: report.ready[2]!.expressionId,
      stated: { priceMinor: 4000, currency: "JOD" },
    });
    await expect(
      intake.publishIntakeBatch({
        ownerId: OWNER, entries: report.ready,
        confirmBatchFingerprint: report.batchFingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    // ALL of it, or none. Not five out of six.
    expect(await publicRows()).toHaveLength(0);

    // Reading again and confirming that publishes everything.
    const again = await intake.intakeOfferedRows({ ownerId: OWNER, rows: [] });
    expect(again.ready).toEqual([]);
    const fresh = await Promise.all(
      report.ready.map(async (one) => ({
        ref: one.ref,
        expressionId: one.expressionId,
        fingerprint: (
          await compose.readDraft({ expressionId: one.expressionId, ownerId: OWNER })
        ).fingerprint,
      })),
    );
    // The batch fingerprint is recomputed from the drafts as they are now.
    const recomputed = await intake.intakeOfferedRows({ ownerId: OWNER, rows: [] });
    expect(recomputed.batchFingerprint).not.toBe(report.batchFingerprint);
    expect(fresh).toHaveLength(6);
  });

  it("a batch naming a different set than was read publishes nothing", async () => {
    //   BATCH_CONFIRMATION_COVERS_EXACT_ROWS
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: ROWS.map(publishable),
    });
    for (const entries of [report.ready.slice(0, 5), report.ready.slice(1)]) {
      await expect(
        intake.publishIntakeBatch({
          ownerId: OWNER, entries,
          confirmBatchFingerprint: report.batchFingerprint,
        }),
      ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    }
    await expect(
      intake.publishIntakeBatch({
        ownerId: OWNER, entries: [], confirmBatchFingerprint: report.batchFingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await publicRows()).toHaveLength(0);
  });

  it("an invented or borrowed batch fingerprint publishes nothing", async () => {
    const mine = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: [publishable(ROWS[0]!)],
    });
    const other = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: [publishable(ROWS[1]!)],
    });
    for (const wrong of [other.batchFingerprint, "0".repeat(64), ""]) {
      await expect(
        intake.publishIntakeBatch({
          ownerId: OWNER, entries: mine.ready, confirmBatchFingerprint: wrong,
        }),
      ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    }
    expect(await publicRows()).toHaveLength(0);
  });

  // ── 4 · صفوف غيرك ليست صفوفك ──────────────────────────────────────────────

  it("nobody publishes somebody else's batch", async () => {
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER, rows: ROWS.map(publishable),
    });
    await expect(
      intake.publishIntakeBatch({
        ownerId: STRANGER, entries: report.ready,
        confirmBatchFingerprint: report.batchFingerprint,
      }),
    ).rejects.toMatchObject({ name: "EconomicNotFoundError" });
    expect(await publicRows()).toHaveLength(0);
  });

  it("two rows with one reference are refused before anything is drafted", async () => {
    await expect(
      intake.intakeOfferedRows({
        ownerId: OWNER,
        rows: [publishable(ROWS[0]!), { ...publishable(ROWS[1]!), ref: "r1" }],
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await allRows()).toHaveLength(0);
    await expect(
      intake.intakeOfferedRows({
        ownerId: OWNER, rows: [{ ...publishable(ROWS[0]!), ref: "  " }],
      }),
    ).rejects.toMatchObject({ name: "EconomicAuthorizationError" });
    expect(await allRows()).toHaveLength(0);
  });

  // ── 5 · الأصل يسافر مع الصف ───────────────────────────────────────────────

  it("a row may say a value was inferred, and that value then decides nothing", async () => {
    const report = await intake.intakeOfferedRows({
      ownerId: OWNER,
      rows: [{
        ref: "r1", semanticType: "مركبة",
        stated: { colour: "أبيض", priceMinor: 17800, currency: "JOD" },
        provenance: { colour: "INFERRED" },
        attachments: ["art_1", "art_2"],
        willPublish: { semanticType: "مركبة", summary: "مركبة" },
      }],
    });
    const draft = await compose.readDraft({
      expressionId: report.ready[0]!.expressionId, ownerId: OWNER,
    });
    expect(draft.provenance).toEqual({ colour: "INFERRED" });
    expect(draft.attachments).toEqual(["art_1", "art_2"]);
    // The volume channel behaves exactly like one row: same law, same door.
    expect(draft.stated).toEqual({ colour: "أبيض", priceMinor: 17800, currency: "JOD" });
  });

  // ── 6 · لا صيغة ولا مجال في المحرّك ──────────────────────────────────────

  it("intake names no file format and no domain", async () => {
    const source = await readFile(
      new URL("../../api/runtime/bulk-offer-intake.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    // Whole words only: «pos» lives inside `composeOffering` and «erp» inside
    // `fingerprint`, and a substring match would fail on its own vocabulary.
    for (const forbidden of [
      "excel", "xlsx", "csv", "catalog", "catalogue", "erp", "pos", "sheet",
      "spreadsheet", "upload", "car", "food", "hotel", "driver", "translator",
    ]) {
      expect(source.toLowerCase(), forbidden).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
    // It consults no model, and reaches public only through the one door.
    for (const forbidden of ["ModelGateway", "generate", "prompt", "infer("]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    expect(source).toContain("publishComposedOffering");
    expect(source).not.toMatch(/visibility:\s*"public"/);
    // Every gap reason comes from a primitive that already existed, or from the
    // row contradicting itself. Nothing consults a table of what a KIND needs.
    expect(source).toContain("CURRENCY_CODE");
    expect(source).toContain("QUANTITY_UNIT_DECLARED_BUT_EMPTY");
    expect(source).not.toMatch(/schemaRef|requiredFields|template|expectedAttributes/i);
  });
});
