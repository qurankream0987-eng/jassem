/**
 * JASIM — what a chart is allowed to claim.
 *
 * An aggregate is the one presentation that can be false while every number in
 * it is true: «المجموع ٤٢» is a lie if it is the sum of the fifty rows on
 * screen and the person reads it as the sum of four thousand. FALSE_AGGREGATE
 * = 0 means the surface must know where its numbers came from and say so.
 *
 * Three scopes, three different sentences:
 *   SOURCE           — the source ran the GROUP BY over everything it holds.
 *   COMPLETE_WINDOW  — the window saw every row there is.
 *   PARTIAL_WINDOW   — it did not, and the surface must say that out loud.
 */

import { describe, expect, it } from "vitest";
import {
  aggregationScopeFor,
  derivedSort,
  type CanonicalDataset,
} from "../../api/runtime/canonical-dataset";
import { chartSurface, isRefusal, scopeNote, tableSurface } from "../../api/runtime/dataset-presentation";

const OWNER = "owner-a";

const dataset = (over: Partial<CanonicalDataset> = {}): CanonicalDataset => ({
  datasetId: "ds_scope",
  revision: 1,
  columns: [
    { key: "status", label: "الحالة", type: "ENUM" },
    { key: "amount", label: "القيمة", type: "NUMBER" },
  ],
  rows: [
    { ref: "r1", position: 1, values: { status: "منجزة", amount: 10 } },
    { ref: "r2", position: 2, values: { status: "منجزة", amount: 30 } },
    { ref: "r3", position: 3, values: { status: "معلّقة", amount: 2 } },
  ],
  view: {
    fields: ["status", "amount"],
    sort: [],
    filters: [],
    window: { limit: 50, offset: 0 },
  },
  provenance: {
    resourceId: "test",
    sourceId: "internal-runtime",
    sourceKind: "INTERNAL_RUNTIME",
    observedAt: "2026-09-20T00:00:00.000Z",
    generatedAt: "2026-09-20T00:00:00.000Z",
  },
  freshness: "UNKNOWN",
  ownerScope: OWNER,
  ...over,
});

const windowed = (totalRows: number) =>
  dataset({
    view: {
      fields: ["status", "amount"],
      sort: [],
      filters: [],
      window: { limit: 50, offset: 0 },
      totalRows,
    },
  });

describe("an aggregate knows what it was computed over", () => {
  it("a window that saw everything is COMPLETE_WINDOW", () => {
    expect(aggregationScopeFor(dataset())).toBe("COMPLETE_WINDOW");
    expect(aggregationScopeFor(windowed(3))).toBe("COMPLETE_WINDOW");
  });

  it("a window that saw part of the data is PARTIAL_WINDOW", () => {
    expect(aggregationScopeFor(windowed(4_000))).toBe("PARTIAL_WINDOW");
  });

  it("a source-side GROUP BY stays SOURCE, even in a window", () => {
    // Reducing an already-complete aggregate does not make it less complete.
    const sourceAggregate = dataset({
      aggregation: {
        scope: "SOURCE",
        groupBy: ["status"],
        measures: [{ field: "amount", fn: "SUM" }],
        coverage: { counted: 2 },
      },
      view: {
        fields: ["status", "amount"],
        sort: [],
        filters: [],
        window: { limit: 50, offset: 0 },
        totalRows: 4_000,
      },
    });
    expect(aggregationScopeFor(sourceAggregate)).toBe("SOURCE");
  });
});

describe("the sentence a chart must carry", () => {
  it("a partial window names both counts", () => {
    expect(scopeNote("PARTIAL_WINDOW", { counted: 50, total: 4_000 })).toBe(
      "محسوب على 50 من 4000 صفاً المعروضة، وليس على كامل البيانات.",
    );
  });

  it("a complete window and a source aggregate say nothing extra", () => {
    expect(scopeNote("COMPLETE_WINDOW", { counted: 3, total: 3 })).toBeUndefined();
    expect(scopeNote("SOURCE", { counted: 2 })).toBeUndefined();
  });

  it("a partial window with no known total still refuses to imply completeness", () => {
    expect(scopeNote("PARTIAL_WINDOW", { counted: 50 })).toContain("وليس على كامل البيانات");
  });
});

describe("a chart carries its own scope", () => {
  const intent = { form: "BAR", categoryField: "status", aggregation: "COUNT" } as const;

  it("a complete window produces a chart that claims a complete window", () => {
    const surface = chartSurface(dataset(), intent);
    expect(isRefusal(surface)).toBe(false);
    if (isRefusal(surface)) return;
    expect(surface.scope).toBe("COMPLETE_WINDOW");
    expect(surface.coverage.counted).toBe(3);
  });

  it("a partial window produces a chart that admits it", () => {
    const surface = chartSurface(windowed(4_000), intent);
    if (isRefusal(surface)) throw new Error("expected a chart");
    expect(surface.scope).toBe("PARTIAL_WINDOW");
    expect(surface.coverage).toEqual({ counted: 3, total: 4_000 });
    expect(scopeNote(surface.scope, surface.coverage)).toContain("وليس على كامل البيانات");
  });

  it("an unsupported aggregate is refused rather than coerced", () => {
    // AVG over an ENUM. `Number("منجزة")` is NaN, and a picture of NaN
    // presented as a finding is worse than no picture.
    const refusal = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "status",
      measureField: "status",
      aggregation: "AVG",
    });
    expect(isRefusal(refusal)).toBe(true);
    if (!isRefusal(refusal)) return;
    expect(refusal.reason).toBe("NOT_MEASURABLE");
  });

  it("a chart over a field the dataset does not have is refused, not approximated", () => {
    const refusal = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "revenue",
      aggregation: "COUNT",
    });
    expect(isRefusal(refusal)).toBe(true);
    if (!isRefusal(refusal)) return;
    expect(refusal.reason).toBe("UNKNOWN_FIELD");
  });

  it("the measured numbers are the dataset's numbers", () => {
    const surface = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "status",
      measureField: "amount",
      aggregation: "SUM",
    });
    if (isRefusal(surface)) throw new Error("expected a chart");
    expect(surface.points).toEqual([
      { category: "منجزة", value: 40 },
      { category: "معلّقة", value: 2 },
    ]);
  });
});

describe("CHART → TABLE is the same dataset, seen the other way", () => {
  it("the table of a charted dataset is the dataset, unchanged", () => {
    const source = dataset();
    const chart = chartSurface(source, { form: "BAR", categoryField: "status", aggregation: "COUNT" });
    if (isRefusal(chart)) throw new Error("expected a chart");
    const back = tableSurface(source);

    expect(back.datasetId).toBe(chart.datasetId);
    expect(back.revision).toBe(chart.revision);
    expect(back.rows).toHaveLength(3);
    // The rows are the same rows, by the references the runtime gave them.
    expect(back.rows.map((row) => row.ref)).toEqual(["r1", "r2", "r3"]);
  });

  it("a sort survives the round trip, so «الأول» keeps meaning the same row", () => {
    const sorted = derivedSort(dataset(), "amount", "DESC");
    if (!sorted) throw new Error("expected a sort");
    const chart = chartSurface(sorted, { form: "BAR", categoryField: "status", aggregation: "COUNT" });
    if (isRefusal(chart)) throw new Error("expected a chart");

    const back = tableSurface(sorted);
    expect(back.sort).toEqual([{ field: "amount", direction: "DESC" }]);
    expect(back.rows.map((row) => row.ref)).toEqual(["r2", "r1", "r3"]);
    expect(back.rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });
});
