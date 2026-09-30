/**
 * JASIM — A CANONICAL RESULT SET BECOMES A SURFACE, AND INVENTS NOTHING.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * Every part of this already existed. Discovery persists a result set, the
 * orchestrator narrows each row to what may be shown, `decidePresentation`
 * already chooses ENTITY_GRID at six results or more, and the commerce turn
 * already writes the outcome into `metadata.presentation`. The candidates then
 * travelled through VERBATIM — the canonical amount arriving as
 * `observedMoney` and the canonical intents as `actionable`, while the card
 * reads `money` and `actions`.
 *
 *   A NAME THE RENDERER DOES NOT READ IS A FACT NOBODY SEES
 *
 * ─── AND THE LAWS THE BRIDGE MAY NOT BREAK ──────────────────────────────────
 *
 *   MODEL != PRICE AUTHORITY · MODEL != AVAILABILITY AUTHORITY
 *   MODEL != IMAGE AUTHORITY · MODEL != ACTION AUTHORITY
 *   BUTTON != EXECUTION AUTHORITY
 *   SAFE_MEDIA_URL != TRUE IMAGE ASSOCIATION
 *   UNKNOWN != EMPTY != FALSE != ZERO
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decidePresentation,
  projectCandidateForSurface,
  projectStructuredResult,
} from "../../api/runtime/presentation-fabric";

/** Exactly what `safeCandidate` hands on, with nothing added. */
const candidate = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  position: 1,
  title: "عنصر",
  summary: "وصف",
  source: "JASIM_INTERNAL",
  canonicalRef: "expr_1",
  externalRef: null,
  trust: "CANONICAL",
  provenance: {},
  observedMoney: { amountMinor: "125000000", currency: "ريال" },
  availability: "متاح",
  actionable: ["open"],
  ...over,
});

const surfaceFor = (candidates: unknown[]) =>
  projectStructuredResult({
    label: "Discovery results",
    summary: "س",
    data: { resultSetId: "rs1", candidates },
  });

describe("a canonical result set becomes a surface", () => {
  it("six canonical candidates choose the grid; fewer choose the smaller surface", () => {
    const six = surfaceFor(Array.from({ length: 6 }, (_, i) => candidate({ id: `c${i}` })));
    expect(six.primitive).toBe("ENTITY_GRID");
    expect((six.data as { resultCount: number }).resultCount).toBe(6);
    const three = surfaceFor(Array.from({ length: 3 }, (_, i) => candidate({ id: `c${i}` })));
    expect(three.primitive).toBe("SEARCH_RESULTS");
  });

  it("the canonical amount and intents arrive under the names a card reads", () => {
    const surface = surfaceFor([candidate()]);
    const [card] = (surface.data as { candidates: Record<string, unknown>[] }).candidates;
    expect(card!.money).toEqual({ amountMinor: "125000000", currency: "ريال" });
    expect(card!.actions).toEqual([{ intent: "open", label: "open" }]);
    expect(card!.badges).toEqual(["متاح"]);
    expect(card!.description).toBe("وصف");
  });

  it("selection identity comes from a canonical reference, never a guess", () => {
    //   CARD_SELECTION_BY_TITLE_GUESS = 0 · CARD_SELECTION_BY_GLOBAL_LATEST = 0
    expect(projectCandidateForSurface(candidate()).ref).toBe("expr_1");
    expect(projectCandidateForSurface(candidate({ canonicalRef: null, externalRef: "ext_9" })).ref)
      .toBe("ext_9");
    expect(projectCandidateForSurface(candidate({ canonicalRef: null, externalRef: null })).ref)
      .toBe("c1");
    // A candidate with no identity at all offers none, rather than one made
    // from its title or its place in the list.
    const anonymous = projectCandidateForSurface(
      candidate({ id: null, canonicalRef: null, externalRef: null }),
    );
    expect(anonymous.ref).toBeUndefined();
    expect(JSON.stringify(anonymous)).not.toContain("عنصر-1");
  });

  it("no image is ever projected, because a canonical candidate has none", () => {
    //   MODEL != IMAGE AUTHORITY · SAFE_MEDIA_URL != TRUE IMAGE ASSOCIATION
    for (const hostile of [
      { image: "https://example.com/looks-safe.png" },
      { media: "/local.png" },
      { thumbnail: "https://example.com/a.png" },
      { attributes: { image: "https://example.com/b.png" } },
    ]) {
      const card = projectCandidateForSurface(candidate(hostile));
      expect(card.image, JSON.stringify(hostile)).toBeUndefined();
      expect(card.media, JSON.stringify(hostile)).toBeUndefined();
    }
    // Not even in the bridge's own source.
    const source = readFileSync("api/runtime/presentation-fabric.ts", "utf8");
    const fn = source.slice(source.indexOf("export function projectCandidateForSurface"));
    expect(fn.slice(0, fn.indexOf("\n}"))).not.toMatch(/image|media|thumbnail/);
  });

  it("money renders only from an exact canonical amount", () => {
    //   MODEL_INVENTED_PRICE_RENDERED = 0 · no float money, no inferred scale
    for (const bad of [
      { observedMoney: null },
      { observedMoney: { amountMinor: "12.50", currency: "ر" } },
      { observedMoney: { amountMinor: "125000000" } },
      { observedMoney: { currency: "ر" } },
      { observedMoney: "١٢٥ ألف" },
      { observedMoney: { amount: 125, currency: "ر" } },
    ]) {
      expect(projectCandidateForSurface(candidate(bad)).money, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("an unknown availability is absent, not a claim", () => {
    //   UNVERIFIED_MODEL_AVAILABILITY_RENDERED = 0 · UNKNOWN != FALSE
    for (const value of [null, undefined, "", "   "]) {
      expect(projectCandidateForSurface(candidate({ availability: value })).badges).toBeUndefined();
    }
  });

  it("only intents the trusted path accepts become buttons", () => {
    //   BUTTON != EXECUTION AUTHORITY · MODEL_CAN_INVENT_CARD_ACTION = 0
    const invented = projectCandidateForSurface(
      candidate({ actionable: ["BUY_CAR", "ORDER_FOOD", "APPLY_JOB", "BOOK_HOTEL", "delete_everything"] }),
    );
    expect(invented.actions).toBeUndefined();
    // And a real one still works, alongside the invented ones.
    const mixed = projectCandidateForSurface(candidate({ actionable: ["BUY_CAR", "open", "select"] }));
    expect(mixed.actions).toEqual([
      { intent: "open", label: "open" },
      { intent: "select", label: "select" },
    ]);
  });

  it("a claim about more candidates than canonical state holds changes nothing", () => {
    // Whatever a sentence said, the surface carries exactly the canonical rows.
    const surface = projectStructuredResult({
      label: "L", summary: "قال النموذج إن هناك عشرة",
      data: { resultSetId: "rs1", candidates: [candidate(), candidate({ id: "c2" })], resultCount: 10 },
    });
    expect((surface.data as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it("zero candidates produce no cards at all", () => {
    //   EMPTY_RESULT_FAKE_CARDS = 0
    const surface = surfaceFor([]);
    expect((surface.data as { candidates: unknown[] }).candidates).toEqual([]);
    expect(surface.primitive).toBe("SEARCH_RESULTS");
    expect(JSON.stringify(surface)).not.toMatch(/skeleton|placeholder/i);
  });

  // ── PRECEDENCE: a result set does not outrank what the person must decide ──

  it("approval outranks the grid", () => {
    const surface = decidePresentation({
      interactionNeed: "authorize",
      semanticOutput: "candidates",
      resultCount: 6,
      resultSetPresent: true,
      data: { candidates: Array.from({ length: 6 }, () => candidate()) },
    });
    expect(surface.primitive).not.toBe("ENTITY_GRID");
  });

  it("missing input outranks the grid", () => {
    const surface = decidePresentation({
      interactionNeed: "collect_input",
      requiresStructuredInput: true,
      semanticOutput: "candidates",
      resultCount: 6,
      resultSetPresent: true,
      data: { candidates: Array.from({ length: 6 }, () => candidate()) },
    });
    expect(surface.primitive).not.toBe("ENTITY_GRID");
  });

  it("an explicit comparison outranks the grid", () => {
    const surface = decidePresentation({
      interactionNeed: "compare",
      semanticOutput: "candidates",
      resultCount: 6,
      resultSetPresent: true,
      data: { candidates: Array.from({ length: 6 }, () => candidate()) },
    });
    expect(surface.primitive).toBe("COMPARISON");
  });

  it("the same bridge serves semantic types that share nothing", () => {
    //   DOMAIN_PRESENTATION_BRANCHES = 0 · DOMAIN_RESULT_MAPPERS_ADDED = 0
    const worlds = [
      Array.from({ length: 6 }, (_, i) => candidate({ id: `a${i}`, title: `فحص ${i}` })),
      Array.from({ length: 3 }, (_, i) => candidate({ id: `b${i}`, title: `مترجم ${i}` })),
      Array.from({ length: 8 }, (_, i) => candidate({ id: `c${i}`, title: `سعة ${i}` })),
      Array.from({ length: 7 }, (_, i) => candidate({ id: `d${i}`, title: `معايرة ${i}` })),
    ];
    const primitives = worlds.map((w) => surfaceFor(w).primitive);
    expect(primitives).toEqual(["ENTITY_GRID", "SEARCH_RESULTS", "ENTITY_GRID", "ENTITY_GRID"]);
    // And the decision file names no business at all.
    const code = readFileSync("api/runtime/presentation-fabric.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const domain of ["car", "food", "job", "hotel", "property", "vehicle",
      "restaurant", "flight", "interpreter", "warehouse"]) {
      expect(code, domain).not.toMatch(new RegExp(`\\b${domain}s?\\b`, "i"));
    }
  });

  it("no second result state machine was created", () => {
    //   NEW_PRESENTATION_TABLE_ADDED = NO · SECOND_RESULT_STATE_MACHINE = 0
    const code = readFileSync("api/runtime/presentation-fabric.ts", "utf8");
    expect(code).not.toMatch(/pgTable|insert\(|update\(|delete\(/);
    expect(code).not.toMatch(/presentation_result_sets|entity_grid_rows|rendered_candidates/);
  });
});

describe("the surface a real projection produces actually renders", () => {
  it("six canonical candidates render as six cards, with no invented picture", async () => {
    const React = (await import("react")).default;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SchemaRenderer } = await import("../../src/components/jasim-core/SchemaRenderer");

    const surface = surfaceFor(
      Array.from({ length: 6 }, (_, i) =>
        candidate({
          id: `c${i + 1}`,
          canonicalRef: `expr_${i + 1}`,
          title: `عنصر ${i + 1}`,
          // Half carry an amount, a third an availability, half an intent —
          // every combination the card must survive without inventing.
          observedMoney: i % 2 === 0 ? { amountMinor: String(125000 * (i + 1)), currency: "ريال" } : null,
          availability: i % 3 === 0 ? "متاح" : null,
          actionable: i % 2 === 0 ? ["open"] : [],
        }),
      ),
    );
    expect(surface.primitive).toBe("ENTITY_GRID");

    const markup = renderToStaticMarkup(
      React.createElement(SchemaRenderer, {
        schema: {
          type: "entity_grid",
          title: "النتائج",
          data: surface.data,
        } as never,
        onAction: () => {},
      }),
    );
    expect((markup.match(/<article/g) ?? [])).toHaveLength(6);
    expect(markup).toContain("عنصر 1");
    expect(markup).toContain("عنصر 6");
    // The amounts that exist are shown, grouped from exact minor units.
    // Grouped from exact minor units, and a .00 fraction is not printed.
    expect(markup).toContain("1,250 ريال");
    // What the runtime knows ABOUT a row is not a fact about the thing.
    expect(markup).not.toContain("CANONICAL");
    expect(markup).not.toContain(">position<");
    // And nothing anybody could not vouch for.
    expect(markup).not.toContain("<img");
  });
});
