/**
 * JASIM — the generic ordinal vocabulary.
 *
 * The rule under test is short: a position is a position in what was shown,
 * every named position must exist, and nothing here knows what a domain is.
 */

import { describe, expect, it } from "vitest";
import {
  ORDINAL_CUE_SOURCE,
  hasOrdinalReference,
  outOfRangeClarification,
  parseOrdinalReferences,
  resolveOrdinalPositions,
  type OrdinalReference,
} from "../../api/runtime/ordinal-reference";

const positions = (text: string): number[] =>
  parseOrdinalReferences(text).flatMap((reference) =>
    reference.kind === "POSITION" ? [reference.position] : [],
  );

describe("Arabic ordinals", () => {
  it.each([
    ["الأول", 1],
    ["الاول", 1],
    ["الأولى", 1],
    ["الثاني", 2],
    ["الثانية", 2],
    ["الثالث", 3],
    ["الثالثة", 3],
    ["الرابع", 4],
    ["الخامس", 5],
    ["السادس", 6],
    ["السابع", 7],
    ["الثامن", 8],
    ["التاسع", 9],
    ["العاشر", 10],
  ])("«%s» is position %i", (word, expected) => {
    expect(positions(`اعرض ${word}`)).toEqual([expected]);
  });

  it("reads an ordinal with no article", () => {
    expect(positions("خذ ثاني خيار")).toEqual([2]);
  });

  it.each([
    ["الخيار الثاني", 2],
    ["النتيجة الثالثة", 3],
    ["العنصر الرابع", 4],
  ])("«%s» — the noun before it changes nothing", (phrase, expected) => {
    expect(positions(phrase)).toEqual([expected]);
  });
});

describe("counting from the end", () => {
  it.each(["اعرض الأخير", "اعرض الاخيرة", "show me the last one", "the final one"])(
    "«%s» is the last position",
    (text) => {
      expect(parseOrdinalReferences(text)).toEqual([{ kind: "FROM_END", back: 0 }]);
    },
  );

  it.each([
    "الذي قبله",
    "التي قبلها",
    "قبل الأخير",
    "ما قبل الأخير",
    "second to last",
    "the penultimate one",
  ])("«%s» is one before the last", (text) => {
    expect(parseOrdinalReferences(text)).toEqual([{ kind: "FROM_END", back: 1 }]);
  });

  it("«قبل الأخير» is not read as «الأخير»", () => {
    // The longer phrase contains the shorter one. Matching the shorter first
    // would answer with the last item when the person asked for the one
    // before it — a wrong answer delivered confidently.
    expect(parseOrdinalReferences("أعطني ما قبل الأخير")).toEqual([
      { kind: "FROM_END", back: 1 },
    ]);
  });

  it("leaves «السابق» to the recency path", () => {
    // «السابق» already means "the previous thing" elsewhere in the resolver.
    // Claiming it here would change answers in a mechanism nobody asked to
    // change.
    expect(parseOrdinalReferences("افتح السابق")).toEqual([]);
  });
});

describe("explicit numbers", () => {
  it.each([
    ["رقم 3", 3],
    ["رقم ٣", 3],
    ["العنصر 7", 7],
    ["item 2", 2],
    ["position 5", 5],
  ])("«%s» is position %i", (text, expected) => {
    expect(positions(text)).toEqual([expected]);
  });

  it.each(["2nd", "3rd", "10th"])("English «%s» is read", (text) => {
    expect(positions(`take the ${text}`)).toHaveLength(1);
  });

  it("a bare number is a quantity, not a position", () => {
    // «أريد 3 نتائج» asks for three results. Reading the 3 as a position
    // would manufacture a reference out of arithmetic.
    expect(parseOrdinalReferences("أريد 3 نتائج")).toEqual([]);
    expect(parseOrdinalReferences("اعرض 5 خيارات")).toEqual([]);
  });
});

describe("several positions in one sentence", () => {
  it("«قارن الثاني والرابع» keeps the order written", () => {
    expect(positions("قارن الثاني والرابع")).toEqual([2, 4]);
  });

  it("«قارن الرابع بالثاني» keeps THAT order", () => {
    // The pairing is the person's, not the parser's. Sorting would silently
    // rewrite which one is being compared to which.
    expect(positions("قارن الرابع بالثاني")).toEqual([4, 2]);
  });

  it("collapses a repeat", () => {
    expect(positions("الثاني ثم الثاني مرة أخرى")).toEqual([2]);
  });

  it("mixes a position and an end-relative reference in order", () => {
    expect(parseOrdinalReferences("قارن الأول بالأخير")).toEqual([
      { kind: "POSITION", position: 1 },
      { kind: "FROM_END", back: 0 },
    ]);
  });
});

describe("it does not see ordinals that are not there", () => {
  it.each([
    "ما هي الأولوية؟",
    "رتب لي موعداً",
    "firstly, explain the plan",
    "",
    "   ",
  ])("«%s» names no position", (text) => {
    expect(parseOrdinalReferences(text)).toEqual([]);
    expect(hasOrdinalReference(text)).toBe(false);
  });

  it("survives a non-string", () => {
    expect(parseOrdinalReferences(undefined as unknown as string)).toEqual([]);
  });
});

describe("resolving against a list", () => {
  const second: OrdinalReference[] = [{ kind: "POSITION", position: 2 }];

  it("returns 1-based positions", () => {
    expect(resolveOrdinalPositions(second, 5)).toEqual({ status: "RESOLVED", positions: [2] });
  });

  it("counts FROM_END against the real length", () => {
    expect(resolveOrdinalPositions([{ kind: "FROM_END", back: 0 }], 4)).toEqual({
      status: "RESOLVED",
      positions: [4],
    });
    expect(resolveOrdinalPositions([{ kind: "FROM_END", back: 1 }], 4)).toEqual({
      status: "RESOLVED",
      positions: [3],
    });
  });

  it("reports NONE when nothing was named", () => {
    expect(resolveOrdinalPositions([], 5)).toEqual({ status: "NONE" });
  });

  it("refuses a position past the end instead of clamping", () => {
    const resolution = resolveOrdinalPositions([{ kind: "POSITION", position: 5 }], 3);
    expect(resolution.status).toBe("OUT_OF_RANGE");
  });

  it("refuses the WHOLE request when one position is missing", () => {
    // Answering about the second alone would drop half of what was asked with
    // nothing to show that it had been dropped.
    const resolution = resolveOrdinalPositions(
      [
        { kind: "POSITION", position: 2 },
        { kind: "POSITION", position: 5 },
      ],
      3,
    );
    expect(resolution).toEqual({ status: "OUT_OF_RANGE", requested: [2, 5], available: 3 });
  });

  it("an end-relative reference against an empty list is out of range", () => {
    expect(resolveOrdinalPositions([{ kind: "FROM_END", back: 0 }], 0).status).toBe(
      "OUT_OF_RANGE",
    );
  });

  it("«الذي قبله» against a one-item list is out of range, not item one", () => {
    expect(resolveOrdinalPositions([{ kind: "FROM_END", back: 1 }], 1).status).toBe(
      "OUT_OF_RANGE",
    );
  });
});

describe("the clarification says what is actually wrong", () => {
  it("names the requested position and the real length", () => {
    const message = outOfRangeClarification({ requested: [5], available: 3 });
    expect(message).toContain("5");
    expect(message).toContain("3");
  });

  it("says so plainly when there is no list at all", () => {
    expect(outOfRangeClarification({ requested: [2], available: 0 })).toMatch(/لا توجد قائمة/);
  });
});

describe("the cue fragment is usable by another pattern", () => {
  const cue = new RegExp(ORDINAL_CUE_SOURCE, "iu");

  it.each(["قارن الثاني والرابع", "اعرض الأخير", "take the third", "رقم ٣", "الذي قبله"])(
    "«%s» is cued",
    (text) => {
      expect(cue.test(text)).toBe(true);
    },
  );

  it("does not cue on ordinary prose", () => {
    expect(cue.test("رتب لي موعداً غداً")).toBe(false);
  });
});

describe("nothing here knows a domain", () => {
  // Grepping the source for domain words was the first version of this test
  // and it was a bad one: it failed on the identifier `ordered`, which
  // contains "order". Behaviour is the honest check — the module is generic
  // if and only if the subject of the sentence changes nothing.
  it.each([
    "المصدر",
    "النتيجة",
    "الخيار",
    "العنصر",
    "السائق",
    "المنتج",
    "الطلب",
    "الرحلة",
    "المرشح",
    "الفقاعة",
  ])("«اعرض %s الثالث» is position 3 whatever the noun is", (noun) => {
    expect(positions(`اعرض ${noun} الثالث`)).toEqual([3]);
  });

  it("the same holds for an end-relative reference", () => {
    for (const noun of ["المصدر", "السائق", "الطلب", "النتيجة"]) {
      expect(parseOrdinalReferences(`اعرض ${noun} الأخير`)).toEqual([
        { kind: "FROM_END", back: 0 },
      ]);
    }
  });
});
