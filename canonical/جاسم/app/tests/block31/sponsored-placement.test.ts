/**
 * JASIM — المعلن يشتري أن يُرى، لا أن يُوصى به.
 *
 *   SPONSORED != BEST
 *   ADVERTISER_BUYS_JASIM_OPINION = 0
 *   SPONSORED_RESULT_IS_UNLABELLED = 0
 *   MONEY_BUYS_AN_EXEMPTION_FROM_A_BUYERS_REQUIREMENT = 0
 *   MODEL_NOMINATES_A_SPONSORED_RESULT = 0
 *
 * مسار الترتيب مبنيّ بالاتجاه الصحيح أصلاً: `searchInternal` يُصفّي بقيود
 * المشتري الصلبة قبل حساب أي درجة. الإعلان يجب ألّا يصل خلف ذلك.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { asc, eq, sql } from "drizzle-orm";
import { discoveryCandidates } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let discovery: typeof import("../../api/runtime/block31/discovery");
let economic: typeof import("../../api/runtime/economic-fabric");

const BUYER = "ads-buyer";
const HONEST = "ads-honest-seller";
const PAYING = "ads-paying-seller";
const KIND = "قدرة مورد";

describe("what an advertiser may buy", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    discovery = await import("../../api/runtime/block31/discovery");
    economic = await import("../../api/runtime/economic-fabric");
  }, 60_000);

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await handle.db.execute(sql.raw(`
      TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
        economic_expressions CASCADE
    `));
  });

  // ── fixtures ─────────────────────────────────────────────────────────────

  /** A published offering whose summary decides how well it matches the query. */
  async function offering(input: {
    ownerId: string;
    summary: string;
    attributes?: Record<string, unknown>;
  }) {
    const created = await economic.createExpression({
      ownerId: input.ownerId, kind: "offering", semanticType: KIND,
      attributes: input.attributes ?? {},
    });
    return economic.publishExpression({
      id: created.id, ownerId: input.ownerId,
      projection: { semanticType: KIND, summary: input.summary },
    });
  }

  const find = (over: Partial<Parameters<typeof discovery.discover>[1]> = {}) =>
    discovery.discover(handle.db, {
      ownerId: BUYER, conversationId: `c-${randomUUID()}`, query: KIND,
      kind: "offering", ...over,
    });

  const rowsOf = (resultSetId: string) =>
    handle.db.select().from(discoveryCandidates)
      .where(eq(discoveryCandidates.resultSetId, resultSetId))
      .orderBy(asc(discoveryCandidates.position));

  // ── 1 · الترتيب لا يرى من دفع ────────────────────────────────────────────

  it("paying does not change the order by a single position", async () => {
    //   SPONSORED != BEST
    //
    // The test does not assume WHICH candidate merit prefers — that is the
    // ranking function's business and it may change. It asserts the thing that
    // must never change: the order is identical whoever paid, and paying does
    // not make somebody first.
    await offering({ ownerId: HONEST, summary: KIND });
    await offering({ ownerId: HONEST, summary: `${KIND} آخر` });
    await offering({ ownerId: PAYING, summary: "شيء بعيد الصلة" });

    const orderOf = (rows: { canonicalRef: string | null }[]) => rows.map((r) => r.canonicalRef);
    const baseline = orderOf(await rowsOf((await find()).resultSet.id));
    expect(baseline).toHaveLength(3);

    // Sponsor whichever one merit put LAST — the strongest case for a bribe.
    const last = baseline[2]!;
    const paid = await rowsOf((await find({ sponsoredRefs: [last] })).resultSet.id);
    expect(orderOf(paid)).toEqual(baseline);
    expect(paid[0]!.canonicalRef).not.toBe(last);
    // It is still last, and now labelled.
    expect(paid[2]).toMatchObject({ canonicalRef: last, sponsored: true });

    // Sponsoring every one of them changes the order too: not at all.
    const all = await rowsOf((await find({ sponsoredRefs: baseline as string[] })).resultSet.id);
    expect(orderOf(all)).toEqual(baseline);
    expect(all.every((row) => row.sponsored)).toBe(true);
  });

  // ── 2 · الوسم يسافر دائماً ───────────────────────────────────────────────

  it("a sponsored candidate is labelled even when it earned its place", async () => {
    //   SPONSORED_RESULT_IS_UNLABELLED = 0
    //
    // Hiding the label on the ones that also rank well is the oldest way of
    // laundering an advertisement.
    const paid = await offering({ ownerId: PAYING, summary: KIND });
    const free = await offering({ ownerId: HONEST, summary: KIND });
    const found = await find({ sponsoredRefs: [paid.id] });
    const rows = await rowsOf(found.resultSet.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.canonicalRef === paid.id)!.sponsored).toBe(true);
    expect(rows.find((r) => r.canonicalRef === free.id)!.sponsored).toBe(false);
  });

  it("with nobody paying, nothing is labelled", async () => {
    await offering({ ownerId: HONEST, summary: KIND });
    await offering({ ownerId: PAYING, summary: KIND });
    const rows = await rowsOf((await find()).resultSet.id);
    expect(rows.every((row) => row.sponsored === false)).toBe(true);
  });

  // ── 3 · المال لا يشتري إعفاءً من شرط المشتري ─────────────────────────────

  it("a sponsored offering that fails the buyer's requirement does not appear at all", async () => {
    //   MONEY_BUYS_AN_EXEMPTION_FROM_A_BUYERS_REQUIREMENT = 0
    const cheap = await offering({
      ownerId: HONEST, summary: KIND, attributes: { priceMinor: 100 },
    });
    const expensive = await offering({
      ownerId: PAYING, summary: KIND, attributes: { priceMinor: 999_999 },
    });
    const found = await find({
      hardConstraints: [{ field: "priceMinor", operator: "max", value: 500 }],
      sponsoredRefs: [expensive.id],
    });
    const rows = await rowsOf(found.resultSet.id);
    // Not first, not last, not labelled — absent.
    expect(rows.map((r) => r.canonicalRef)).toEqual([cheap.id]);
    expect(rows.some((r) => r.canonicalRef === expensive.id)).toBe(false);
  });

  // ── 4 · ما يشتريه المعلن فعلاً: أن يُرى ──────────────────────────────────

  it("an eligible candidate merit left out may be shown, behind the merit list", async () => {
    // Being seen is a real thing to sell. Being recommended is not.
    await offering({ ownerId: HONEST, summary: KIND });
    await offering({ ownerId: HONEST, summary: `${KIND} أيضاً` });
    await offering({ ownerId: PAYING, summary: "شيء آخر تماماً" });

    // Whichever one merit leaves outside a limit of two is the one to promote.
    const cutRows = await rowsOf((await find({ limit: 2 })).resultSet.id);
    expect(cutRows).toHaveLength(2);
    const full = await rowsOf((await find()).resultSet.id);
    const outside = full.map((r) => r.canonicalRef).find(
      (id) => !cutRows.some((r) => r.canonicalRef === id),
    )!;
    expect(outside).toBeTruthy();

    const rows = await rowsOf((await find({ limit: 2, sponsoredRefs: [outside] })).resultSet.id);
    expect(rows).toHaveLength(3);
    // The merit list is untouched, still first, and still unlabelled.
    expect(rows.slice(0, 2).map((r) => r.canonicalRef)).toEqual(
      cutRows.map((r) => r.canonicalRef),
    );
    expect(rows.slice(0, 2).every((r) => r.sponsored === false)).toBe(true);
    // And the paid one is last, and marked.
    expect(rows[2]).toMatchObject({ canonicalRef: outside, sponsored: true, position: 3 });
  });

  it("sponsoring something already in the merit list adds no second copy", async () => {
    const one = await offering({ ownerId: PAYING, summary: KIND });
    const found = await find({ sponsoredRefs: [one.id] });
    const rows = await rowsOf(found.resultSet.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ canonicalRef: one.id, sponsored: true, position: 1 });
  });

  it("sponsoring something that is not eligible at all adds nothing", async () => {
    await offering({ ownerId: HONEST, summary: KIND });
    const found = await find({ sponsoredRefs: [`exp_${randomUUID()}`, "not-a-thing"] });
    const rows = await rowsOf(found.resultSet.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sponsored).toBe(false);
  });

  // ── 5 · المواضع تبقى مستقرّة ─────────────────────────────────────────────

  it("positions stay dense and unique, so «الثاني» never drifts", async () => {
    await offering({ ownerId: HONEST, summary: KIND });
    await offering({ ownerId: HONEST, summary: `${KIND} ثانٍ` });
    await offering({ ownerId: PAYING, summary: "غير ذي صلة" });
    const cutRows = await rowsOf((await find({ limit: 2 })).resultSet.id);
    const full = await rowsOf((await find()).resultSet.id);
    const outside = full.map((r) => r.canonicalRef).find(
      (id) => !cutRows.some((r) => r.canonicalRef === id),
    )!;
    const rows = await rowsOf(
      (await find({ limit: 2, sponsoredRefs: [outside] })).resultSet.id,
    );
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
  });

  // ── 6 · الإعلان لا يُقرَّر من نموذج ولا يعرف مجالاً ──────────────────────

  it("sponsorship is runtime-supplied, reads after eligibility, and names no domain", async () => {
    const source = await readFile(
      new URL("../../api/runtime/block31/discovery.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    // The ordering query never sees it.
    const ranking = source.slice(
      source.indexOf("const ranked = await db"),
      source.indexOf("export async function discover"),
    );
    expect(ranking).not.toContain("sponsor");
    // Eligibility is computed before sponsorship is read.
    expect(source.indexOf("satisfiesHardConstraints")).toBeLessThan(
      source.indexOf("sponsoredRefs"),
    );
    // No model, and no domain.
    for (const forbidden of ["ModelGateway", "generate", "prompt"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    for (const forbidden of ["laptop", "car", "restaurant", "hotel", "brand"]) {
      expect(source.toLowerCase(), forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
