/**
 * JASIM — A DECLARED PROPERTY REACHES THE CARD, AND NOTHING ELSE DOES.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * `NormalizedCandidate.attributes` has always existed, `discovery_candidates`
 * has always persisted it, `projectCandidateForSurface` already passed it on,
 * and the card has always had a generic `<dl>` for it. The one break was
 * `safeCandidate`, which narrowed a row to what may be shown and dropped the
 * bag on the way. So every card showed a title, an amount and a source, and
 * never the thing's own declared properties.
 *
 *   A NAME THE RENDERER DOES NOT READ IS A FACT NOBODY SEES
 *
 * ─── AND THE DISTINCTION THE TRACE TURNED UP ────────────────────────────────
 *
 *   MATCHED_ON != PUBLISHED
 *
 * TWO bags carry the name `attributes`. Discovery FILTERS on the owner's
 * private declared facts; a candidate row carries the AUTHORIZED PUBLIC
 * PROJECTION. A candidate may therefore have been selected on a fact its card
 * must not show, and only the published one may ever leave.
 *
 * ─── WHAT MAY NOT HAPPEN BECAUSE A CARD CAN NOW SHOW A PROPERTY ─────────────
 *
 *   MODEL != ATTRIBUTE AUTHORITY · ATTRIBUTE != EXECUTION AUTHORITY
 *   CARD != DOMAIN SCHEMA · PRESENTATION != TRUTH SOURCE
 *   UNKNOWN != EMPTY != FALSE != ZERO
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectCandidateForSurface, projectStructuredResult } from "../../api/runtime/presentation-fabric";
import { SchemaRenderer } from "../../src/components/jasim-core/SchemaRenderer";
import type { BubbleSchema } from "@contracts/jasim";

/** Exactly what `safeCandidate` hands on, with nothing added. */
const candidate = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  position: 1,
  title: "عنصر",
  summary: "وصف",
  source: "JASIM_INTERNAL",
  canonicalRef: "expr_1",
  externalRef: null,
  trust: "canonical_internal",
  provenance: { canonicalKind: "economic_expression", version: 2 },
  observedMoney: null,
  availability: null,
  actionable: ["open"],
  ...over,
});

const attrs = (over: Record<string, unknown>): Record<string, unknown> =>
  projectCandidateForSurface(candidate({ attributes: over })).attributes as Record<string, unknown>;

const cardMarkup = (entity: Record<string, unknown>): string =>
  renderToStaticMarkup(
    <SchemaRenderer
      schema={{ type: "entity_card", title: "", data: { entity } } as unknown as BubbleSchema}
    />,
  );

/**
 * UNFAMILIAR BY CONSTRUCTION.
 *
 * Five kinds of thing that share no vocabulary with each other, with no word in
 * common, declared the way an owner declares them: a scalar plus the sibling
 * `<field>Unit` the fabric's own constraint evaluator already reads. If any of
 * these needs production code to render, the implementation is a mapper.
 */
const HOLDOUTS = [
  {
    semanticType: "seabed.survey.instrument",
    publicTerms: { ratedDepth: 450, ratedDepthUnit: "m", mass: 19, massUnit: "kg" },
    expect: { ratedDepth: "450 m", mass: "19 kg" },
  },
  {
    semanticType: "acoustic.isolation.chamber",
    publicTerms: { attenuation: 65, attenuationUnit: "dB", internalVolume: 12, internalVolumeUnit: "m3" },
    expect: { attenuation: "65 dB", internalVolume: "12 m3" },
  },
  {
    semanticType: "industrial.drying.capacity",
    publicTerms: { throughput: 800, throughputUnit: "kg/h", maxTemperature: 220, maxTemperatureUnit: "C" },
    expect: { throughput: "800 kg/h", maxTemperature: "220 C" },
  },
  {
    semanticType: "archival.cold.storage",
    publicTerms: { capacity: 48, capacityUnit: "m3", minimumTemperature: -25, minimumTemperatureUnit: "C" },
    expect: { capacity: "48 m3", minimumTemperature: "-25 C" },
  },
  {
    semanticType: "temporary.interpreter.capacity",
    publicTerms: { language: "Mandarin", duration: 2, durationUnit: "h" },
    expect: { language: "Mandarin", duration: "2 h" },
  },
] as const;

describe("a declared property reaches the card", () => {
  it("every unfamiliar kind of thing renders through the SAME path, with zero domain branches", () => {
    //   NEW DOMAIN != NEW COMPONENT · NEW ATTRIBUTE != NEW UI COMPONENT
    for (const holdout of HOLDOUTS) {
      const projected = attrs({
        semanticType: holdout.semanticType,
        summary: "ملخّص",
        publicTerms: holdout.publicTerms,
      });
      for (const [key, value] of Object.entries(holdout.expect)) {
        expect(projected[key], `${holdout.semanticType} :: ${key}`).toBe(value);
      }
      // And it survives to actual markup, in one card, unchanged.
      const markup = cardMarkup({ ref: "e1", title: "ع", attributes: projected });
      for (const [key, value] of Object.entries(holdout.expect)) {
        expect(markup, `${holdout.semanticType} :: ${key}`).toContain(key);
        expect(markup, `${holdout.semanticType} :: ${value}`).toContain(String(value));
      }
    }
  });

  it("a nested declared term is reachable at all — which before this it was not", () => {
    // The card's renderer reads scalars, and an object renders as nothing. So a
    // term the owner published under `publicTerms` was present, authorized and
    // INVISIBLE. One level is flattened, generically, for any container.
    const projected = attrs({ publicTerms: { depth: 450 }, publicEvidence: { method: "مقاس" } });
    expect(projected.depth).toBe(450);
    expect(projected.method).toBe("مقاس");
    // The container itself never renders as `[object Object]`.
    expect(projected.publicTerms).toBeUndefined();
    expect(JSON.stringify(projected)).not.toContain("object");
  });

  it("flattening never makes two different facts look like one", () => {
    const projected = attrs({
      publicTerms: { depth: 1 },
      publicEvidence: { depth: 2 },
    });
    // Whichever took the bare name, BOTH values survive under distinct names.
    const values = Object.values(projected);
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(Object.keys(projected)).toHaveLength(2);
  });

  it("a bare number stays a bare number — no unit, no currency, no scale", () => {
    //   PRESENTATION != TRUTH SOURCE
    const projected = attrs({ publicTerms: { weight: 300, amount: 12 } });
    expect(projected.weight).toBe(300);
    expect(projected.amount).toBe(12);
    // A unit attaches ONLY where its owner declared one.
    expect(attrs({ publicTerms: { weight: 300, weightUnit: "kg" } }).weight).toBe("300 kg");
  });

  it("a declared unit is never a property row of its own", () => {
    const projected = attrs({ publicTerms: { depth: 9, depthUnit: "m" } });
    expect(projected.depth).toBe("9 m");
    expect(projected.depthUnit).toBeUndefined();
    // A unit with nothing to belong to is just a declared value, and stays one.
    expect(attrs({ publicTerms: { depthUnit: "m" } }).depthUnit).toBe("m");
  });

  // ── THE ABSENCE CASES ───────────────────────────────────────────────────

  it("a thing that declared nothing gets no property block at all", () => {
    //   ABSENT_ATTRIBUTE_INVENTED = 0 · UNKNOWN != EMPTY
    for (const nothing of [undefined, null, {}, { publicTerms: {} }, "لا شيء", 7, []]) {
      const card = projectCandidateForSurface(candidate({ attributes: nothing }));
      expect(card.attributes, JSON.stringify(nothing) ?? "undefined").toBeUndefined();
    }
    // And the card renders without a `<dl>` rather than an empty one.
    expect(cardMarkup({ ref: "e1", title: "ع" })).not.toContain("<dl");
  });

  it("an unreadable value renders nothing rather than wreckage", () => {
    const projected = attrs({
      publicTerms: {
        good: "نعم",
        nested: { deeper: { deepest: 1 } },
        blank: "   ",
        nothing: null,
        notANumber: Number.NaN,
      },
    });
    expect(projected.good).toBe("نعم");
    // Two levels down is past the one level that is flattened, and an unreadable
    // value is not a value. None of them becomes an empty or fake row.
    expect(Object.keys(projected)).toEqual(["good"]);
  });

  // ── THE DUPLICATION CASES ───────────────────────────────────────────────

  it("money, availability and the description keep their own paths and are never repeated", () => {
    //   MONEY_DUPLICATED_AS_ATTRIBUTE = 0
    //   AVAILABILITY_DUPLICATED_AS_ATTRIBUTE = 0
    const card = projectCandidateForSurface(
      candidate({
        observedMoney: { amountMinor: "125000000", currency: "ريال" },
        availability: "متاح",
        attributes: {
          semanticType: "a.b.c",
          summary: "وصف",
          availability: { from: "غداً" },
          publicTerms: {
            price: 99,
            priceMinor: "9900",
            money: { amountMinor: "9900", currency: "ر" },
            currency: "ر",
            title: "عنوان آخر",
            description: "وصف آخر",
            depth: 5,
          },
        },
      }),
    );
    expect(card.money).toEqual({ amountMinor: "125000000", currency: "ريال" });
    expect(card.badges).toEqual(["متاح"]);
    expect(card.description).toBe("وصف");
    // The ONLY property row is the one no other path renders.
    expect(card.attributes).toEqual({ depth: 5 });
  });

  it("an attribute is not permission to do anything", () => {
    //   ATTRIBUTE != EXECUTION AUTHORITY · BUTTON != EXECUTION AUTHORITY
    const card = projectCandidateForSurface(
      candidate({
        actionable: [],
        attributes: {
          publicTerms: { available: true, bookable: true },
          engagementAction: "BOOK",
          actions: [{ intent: "pay", label: "ادفع" }],
          actionable: ["pay"],
        },
      }),
    );
    expect(card.actions).toBeUndefined();
    expect(JSON.stringify(card)).not.toContain("BOOK");
    expect(JSON.stringify(card)).not.toContain("pay");
    // The declared booleans are facts and stay facts — they are not buttons.
    expect(card.attributes).toEqual({ available: true, bookable: true });
  });

  it("no image is attached because a card may now show a property", () => {
    //   SAFE_MEDIA_URL != TRUE IMAGE ASSOCIATION
    const card = projectCandidateForSurface(
      candidate({ attributes: { publicTerms: { image: "https://example.com/a.png" } } }),
    );
    expect(card.image).toBeUndefined();
    expect(card.media).toBeUndefined();
    // Rendered, the owner's own published text is text. Nothing is fetched.
    expect(cardMarkup({ ref: "e1", title: "ع", attributes: card.attributes as Record<string, unknown> }))
      .not.toContain("<img");
  });

  // ── THE MACHINERY CASES ─────────────────────────────────────────────────

  it("how the runtime describes a row never becomes a property of the thing", () => {
    //   TRUST / PROVENANCE / POSITION / CANONICAL_REF RENDERED AS ATTRIBUTE = 0
    const card = projectCandidateForSurface(
      candidate({
        attributes: {
          publicTerms: {
            trust: "canonical_internal",
            provenance: { url: "x" },
            position: 1,
            id: "expr_1",
            canonicalRef: "expr_1",
            externalRef: "https://x",
            resultSetId: "drs_1",
            scopeId: "scope_1",
            principalId: "user_1",
            executionRef: "run_1",
            accessToken: "t",
            apiKey: "k",
            clientSecret: "s",
            password: "p",
            credentials: { user: "u" },
            callbackUrl: "https://x",
            webhookSecret: "w",
            raw: "dump",
            debugInfo: "d",
            rankScore: 0.9,
            score: 0.9,
            policy: "open",
            internal: "yes",
            private: "yes",
            depth: 5,
          },
        },
      }),
    );
    expect(card.attributes).toEqual({ depth: 5 });
  });

  it("but a declared fact whose NAME merely resembles machinery survives", () => {
    //
    // ── WHY THIS ASSERTION EXISTS ────────────────────────────────────────
    //
    // The first draft of the guard matched these words as SEGMENTS of any key,
    // and it hid `internalVolume` — a chamber's declared internal volume, which
    // is precisely the kind of owner-published fact this phase exists to show.
    //
    //   A GUARD THAT CANNOT TELL THE FACT FROM THE MACHINERY DELETES THE FACT
    //
    const projected = attrs({
      publicTerms: {
        internalVolume: 12,
        maxPayload: 800,
        rawMaterial: "فولاذ",
        refractiveIndex: 1.5,
        keyLength: 40,
        traceWidth: 3,
        scoreRange: "1-10",
        privateRoom: true,
      },
    });
    expect(Object.keys(projected).sort()).toEqual([
      "internalVolume", "keyLength", "maxPayload", "privateRoom",
      "rawMaterial", "refractiveIndex", "scoreRange", "traceWidth",
    ]);
  });

  it("a bag nobody capped cannot become the payload", () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`f${i}`, i + 1]));
    const projected = attrs({ publicTerms: many });
    expect(Object.keys(projected).length).toBeLessThanOrEqual(24);
  });

  // ── THE GRID AND THE LIST ───────────────────────────────────────────────

  it("the same properties arrive on the grid and on the smaller surface alike", () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      candidate({ id: `c${i}`, canonicalRef: `expr_${i}`, attributes: { publicTerms: { depth: i } } }));
    const grid = projectStructuredResult({
      label: "ن", summary: "س", data: { resultSetId: "rs1", candidates: six },
    });
    expect(grid.primitive).toBe("ENTITY_GRID");
    const list = projectStructuredResult({
      label: "ن", summary: "س", data: { resultSetId: "rs1", candidates: six.slice(0, 3) },
    });
    expect(list.primitive).toBe("SEARCH_RESULTS");
    for (const surface of [grid, list]) {
      for (const card of (surface.data as { candidates: Record<string, unknown>[] }).candidates) {
        expect(card.attributes).toBeDefined();
      }
    }
  });

  // ── THE ANTI-CHEATING SCAN ──────────────────────────────────────────────

  it("no production file decides how a property works from what the thing IS", () => {
    //   DOMAIN_ATTRIBUTE_BRANCHES_ADDED = 0 · TEST_SEMANTIC_TYPE_IN_PRODUCTION = 0
    //
    // Comments stripped, because prose ABOUT the rule is not an encoding of it —
    // a check that cannot tell those apart forces the rule to be deleted.
    const production = [
      "api/runtime/presentation-fabric.ts",
      "api/runtime/block31/conversation-orchestrator.ts",
      "src/components/jasim-core/SchemaRenderer.tsx",
    ];
    const forbidden = [
      // The fixtures' own vocabulary, which production may never learn.
      "seabed", "acoustic", "isolation", "chamber", "drying", "archival", "interpreter",
      "rateddepth", "attenuation", "internalvolume", "throughput", "maxtemperature",
      "minimumtemperature", "mandarin",
      // And the domains a mapper would be written for.
      "car", "vehicle", "mileage", "gearbox", "hotel", "bedroom", "restaurant",
      "cuisine", "salary", "horsepower", "productionrate", "سيارة", "فندق", "راتب",
    ];
    for (const file of production) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ")
        .toLowerCase();
      for (const word of forbidden) {
        // Whole words only: `entity_card` is not the noun «car».
        expect(new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, "u").test(code),
          `${file} :: ${word}`).toBe(false);
      }
    }
  });

  it("an attribute nobody has ever seen needs no production code", () => {
    //   UNKNOWN_ATTRIBUTE_REQUIRES_NEW_CODE = NO
    //
    // Two kinds of thing invented in this assertion and named nowhere else,
    // through the unmodified renderer.
    for (const invented of [
      { glyphSet: "Nastaliq", strokeCount: 41 },
      { fermentationStage: "ثانوي", brixDelta: 1.4 },
    ]) {
      const projected = attrs({ publicTerms: invented });
      expect(projected).toEqual(invented);
      const markup = cardMarkup({ ref: "e1", title: "ع", attributes: projected });
      for (const [key, value] of Object.entries(invented)) {
        expect(markup).toContain(key);
        expect(markup).toContain(String(value));
      }
    }
  });
});
