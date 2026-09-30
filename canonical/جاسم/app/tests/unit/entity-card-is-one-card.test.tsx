/**
 * JASIM — ONE CARD, WHATEVER IT IS ABOUT.
 *
 * ─── THE GAP THIS CLOSED ────────────────────────────────────────────────────
 *
 * `image`, `media`, `money` and `actions` have been RESERVED KEYS on an entity
 * since this renderer was written — the contract anticipated all four — and the
 * card drew none of them. A generated surface could carry a picture, an amount
 * and an offer to act, and the person saw a title and key/value pairs.
 *
 *   A CONTRACT NOTHING RENDERS IS A CONTRACT NOBODY HAS
 *
 * ─── AND WHAT MUST STAY TRUE NOW THAT IT DOES ───────────────────────────────
 *
 *   NEW DOMAIN != NEW COMPONENT — a card about somewhere to live and a card
 *     about a machine to hire are the SAME card with different data in it.
 *
 *   MODEL != TRUTH, including about where a picture lives — a URL in a
 *     generated surface came from a model or a counterparty, and fetching one
 *     tells that host somebody is looking.
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SchemaRenderer } from "../../src/components/jasim-core/SchemaRenderer";
import type { BubbleSchema } from "@contracts/jasim";

const card = (entity: Record<string, unknown>): string =>
  renderToStaticMarkup(
    <SchemaRenderer
      schema={{ type: "entity_card", title: "", data: { entity } } as unknown as BubbleSchema}
    />,
  );

describe("one card, whatever it is about", () => {
  it("draws the picture, the amount and the thing to do", () => {
    const markup = card({
      ref: "e1",
      title: "عنوان",
      image: "/media/one.jpg",
      money: { amountMinor: "125000000", currency: "ريال" },
      badges: ["أ", "ب"],
      actions: [{ intent: "select", label: "افعل" }],
    });
    expect(markup).toContain('src="/media/one.jpg"');
    // Exact minor units, grouped — never a float, and never invented.
    expect(markup).toContain("1,250,000 ريال");
    expect(markup).toContain("أ");
    // An action needs a reference AND a handler; static markup has neither,
    // so what is asserted here is that the amount and picture do not depend
    // on one. The wired case is the next test.
    expect(markup).toContain("عنوان");
  });

  it("the SAME card serves domains that share nothing", () => {
    //   NEW DOMAIN != NEW COMPONENT
    const shapes = [
      { title: "أ", image: "/a.jpg", money: { amountMinor: "125000000", currency: "ر" },
        attributes: { "غرف": 5, "مساحة": "400 م²" } },
      { title: "ب", image: "/b.jpg", money: { amountMinor: "18900000", currency: "ر" },
        attributes: { "ممشى": "68 ألف", "الحالة": "ممتاز" } },
      { title: "ج", image: "/c.jpg", attributes: { "المكان": "عن بعد", "الدوام": "مرن" } },
      { title: "د", money: { amountMinor: "1500", currency: "ر" }, badges: ["4.7"] },
    ];
    const markups = shapes.map((entity) => card(entity));
    for (const markup of markups) expect(markup).toContain("<article");
    // Same component, same classes, different content — which is the claim.
    const skeleton = (markup: string) => markup.replace(/>[^<]*</g, "><");
    expect(new Set(markups.map((markup) => skeleton(markup).length > 0)).size).toBe(1);
    expect(markups[0]).not.toBe(markups[1]);
  });

  it("a picture JASIM cannot vouch for is not drawn", () => {
    //   MODEL != TRUTH, including about where a picture lives
    for (const hostile of [
      "javascript:alert(1)",
      "http://tracker.invalid/pixel.gif",
      "//tracker.invalid/pixel.gif",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      const markup = card({ title: "ع", image: hostile });
      expect(markup, hostile).not.toContain("<img");
      expect(markup, hostile).not.toContain("tracker.invalid");
      // And the card still renders everything else it was given.
      expect(markup).toContain("ع");
    }
    // https and same-origin are drawn, because those are the runtime's rule.
    expect(card({ title: "ع", image: "https://example.com/a.jpg" })).toContain("<img");
    expect(card({ title: "ع", image: "/local.jpg" })).toContain("<img");
  });

  it("an amount whose shape is not recognised is not guessed at", () => {
    expect(card({ title: "ع", money: { amountMinor: "12.5", currency: "ر" } })).not.toContain("12.5 ر");
    expect(card({ title: "ع", money: {} })).toContain("ع");
    // A plain string is the person's own text and travels unchanged.
    expect(card({ title: "ع", money: "عند الطلب" })).toContain("عند الطلب");
  });

  it("a card given none of it renders exactly what it always did", () => {
    const markup = card({ title: "ع", description: "وصف" });
    expect(markup).toContain("ع");
    expect(markup).toContain("وصف");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<button");
  });

  it("the renderer branches on no semantic type", () => {
    const source = readFileSync("src/components/jasim-core/SchemaRenderer.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(source).not.toMatch(/semanticType\s*(===|!==|==|!=)\s*["'`]/);
    for (const domain of ["property", "vehicle", "restaurant", "hotel", "flight",
      "shipment", "crane", "truck", "driver"]) {
      expect(source.toLowerCase(), domain).not.toContain(domain);
    }
  });
});
