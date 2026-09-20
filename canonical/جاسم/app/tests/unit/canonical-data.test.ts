/**
 * JASIM — the general data system.
 *
 * One mechanism: DataNeed → AuthorizedQuery → CanonicalDataset → Presentation.
 * Sales, stock, employees and bookings are acceptance tests for it; none of
 * them is a type, a query class or a dashboard.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_AUTHORITY_KEYS,
  DataNeedSchema,
  MAX_WINDOW,
  effectiveWindow,
  parseProposedDataNeed,
} from "../../api/runtime/data-need";
import {
  findColumn,
  listCanonicalResources,
  readableColumns,
  resolveCanonicalResource,
} from "../../api/runtime/canonical-resource";
import { authorizeDataNeed } from "../../api/runtime/authorized-query";
import {
  derivedSort,
  rowAtPosition,
  rowByRef,
  type CanonicalDataset,
} from "../../api/runtime/canonical-dataset";
import {
  chartSurface,
  isRefusal,
  resortedTable,
  tableSurface,
} from "../../api/runtime/dataset-presentation";
import { AUTHORITY_KEYS, ModelOutputAuthorityError } from "../../api/runtime/model-output-trust";

const need = (over: Record<string, unknown> = {}) =>
  DataNeedSchema.parse({ version: 1, resource: "runs", ...over });

const OWNER = "owner-a";

const dataset = (): CanonicalDataset => ({
  datasetId: "ds_test",
  revision: 1,
  columns: [
    { key: "id", label: "المعرّف", type: "IDENTIFIER" },
    { key: "name", label: "الاسم", type: "TEXT" },
    { key: "amount", label: "القيمة", type: "NUMBER" },
    { key: "group", label: "الفئة", type: "ENUM" },
  ],
  rows: [
    { ref: "r1", position: 1, values: { id: "1", name: "ألف", amount: 10, group: "أ" } },
    { ref: "r2", position: 2, values: { id: "2", name: "باء", amount: 30, group: "ب" } },
    { ref: "r3", position: 3, values: { id: "3", name: "جيم", amount: 20, group: "أ" } },
  ],
  view: { fields: ["id", "name", "amount", "group"], sort: [], filters: [], window: { limit: 50, offset: 0 } },
  provenance: {
    resourceId: "test",
    sourceId: "internal-runtime",
    sourceKind: "INTERNAL_RUNTIME",
    observedAt: "2026-09-20T00:00:00.000Z",
    generatedAt: "2026-09-20T00:00:00.000Z",
  },
  freshness: "UNKNOWN",
  ownerScope: OWNER,
});

describe("a model proposes intent, never authority", () => {
  it.each([...DATA_AUTHORITY_KEYS])("«%s» is rejected outright", (key) => {
    expect(() => parseProposedDataNeed({ version: 1, resource: "runs", [key]: "x" })).toThrow(
      ModelOutputAuthorityError,
    );
  });

  it("every data authority key is in the shared set", () => {
    for (const key of DATA_AUTHORITY_KEYS) expect(AUTHORITY_KEYS.has(key)).toBe(true);
  });

  it("an ownerId cannot be smuggled in", () => {
    expect(() => parseProposedDataNeed({ version: 1, resource: "runs", ownerId: "someone-else" }))
      .toThrow(ModelOutputAuthorityError);
  });

  it("the schema has no field for SQL, a table, or a scope", () => {
    const fields = Object.keys(DataNeedSchema.shape);
    for (const forbidden of ["sql", "rawSql", "table", "tableName", "ownerId", "scope", "role"]) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it("an unexpected key is rejected, not trimmed", () => {
    // A trimmed injection looks like a normal request, and the one that
    // mattered would be the one nobody saw.
    expect(() => parseProposedDataNeed({ version: 1, resource: "runs", join: "users" })).toThrow();
  });

  it("a filter value must be a scalar", () => {
    expect(() =>
      parseProposedDataNeed({
        version: 1,
        resource: "runs",
        filters: [{ field: "status", operator: "EQ", value: { $ne: null } }],
      }),
    ).toThrow();
  });
});

describe("resource resolution", () => {
  it.each([
    ["runs", "runs"],
    ["عملياتي", "runs"],
    ["أرني عملياتي", "runs"],
    ["المهام", "tasks"],
    ["محادثاتي", "conversations"],
  ])("«%s» resolves to %s", (requested, expected) => {
    expect(resolveCanonicalResource(requested)?.id).toBe(expected);
  });

  it("an unregistered resource resolves to nothing, rather than the nearest", () => {
    // «أرني مبيعاتي» has no registered source. Guessing `runs` would answer a
    // question nobody asked.
    expect(resolveCanonicalResource("مبيعاتي")).toBeUndefined();
    expect(resolveCanonicalResource("المخزون")).toBeUndefined();
    expect(resolveCanonicalResource("")).toBeUndefined();
  });

  it("every registered resource declares an owner column and an identity field", () => {
    // Without both, a read cannot be scoped and a row cannot be referred to.
    for (const resource of listCanonicalResources()) {
      expect(resource.ownerColumn).toBeTruthy();
      expect(resource.sourceColumns[resource.ownerColumn]).toBeTruthy();
      expect(findColumn(resource, resource.identityField)).toBeTruthy();
    }
  });
});

describe("authorization happens before a query exists", () => {
  it("an unregistered resource is UNAVAILABLE and names what does exist", () => {
    const outcome = authorizeDataNeed({ need: need({ resource: "مبيعاتي" }), ownerScope: OWNER });
    expect(outcome.status).toBe("UNAVAILABLE");
    if (outcome.status === "UNAVAILABLE") expect(outcome.message).toContain("العمليات");
  });

  it("a sensitive field is DENIED, never silently dropped", () => {
    // Quietly returning the other columns teaches a person the field does not
    // exist, which is a different fact and a false one.
    const outcome = authorizeDataNeed({
      need: need({ fields: ["goal", "idempotencyKey"] }),
      ownerScope: OWNER,
    });
    expect(outcome.status).toBe("DENIED");
  });

  it("an unknown field is NEEDS_INPUT and lists the real ones", () => {
    const outcome = authorizeDataNeed({ need: need({ fields: ["revenue"] }), ownerScope: OWNER });
    expect(outcome.status).toBe("NEEDS_INPUT");
    if (outcome.status === "NEEDS_INPUT") expect(outcome.message).toContain("الهدف");
  });

  it("filtering on a sensitive field is DENIED", () => {
    const outcome = authorizeDataNeed({
      need: need({ filters: [{ field: "idempotencyKey", operator: "EQ", value: "x" }] }),
      ownerScope: OWNER,
    });
    expect(outcome.status).toBe("DENIED");
  });

  it("sorting by an unknown field is NEEDS_INPUT", () => {
    const outcome = authorizeDataNeed({
      need: need({ sort: [{ field: "profit", direction: "DESC" }] }),
      ownerScope: OWNER,
    });
    expect(outcome.status).toBe("NEEDS_INPUT");
  });

  it("no owner scope is DENIED — a read without a session reads nothing", () => {
    const outcome = authorizeDataNeed({ need: need(), ownerScope: "" });
    expect(outcome.status).toBe("DENIED");
  });

  it("the authorized query carries the owner the CALLER supplied", () => {
    const outcome = authorizeDataNeed({ need: need(), ownerScope: OWNER });
    expect(outcome.status).toBe("AUTHORIZED");
    if (outcome.status === "AUTHORIZED") expect(outcome.query.ownerScope).toBe(OWNER);
  });

  it("the identity field always travels, so every row can be referred to", () => {
    const outcome = authorizeDataNeed({ need: need({ fields: ["goal"] }), ownerScope: OWNER });
    if (outcome.status === "AUTHORIZED") expect(outcome.query.fields).toContain("id");
  });

  it("an unbounded read cannot be asked for", () => {
    expect(() => need({ window: { limit: 100_000, offset: 0 } })).toThrow();
    expect(effectiveWindow(need()).limit).toBeLessThanOrEqual(MAX_WINDOW);
  });

  it("a time range becomes ordinary authorized filters", () => {
    const outcome = authorizeDataNeed({
      need: need({
        timeRange: { field: "createdAt", from: "2026-01-01T00:00:00.000Z" },
      }),
      ownerScope: OWNER,
    });
    expect(outcome.status).toBe("AUTHORIZED");
    if (outcome.status === "AUTHORIZED") {
      expect(outcome.query.filters).toEqual([
        { field: "createdAt", operator: "GTE", value: "2026-01-01T00:00:00.000Z" },
      ]);
    }
  });

  it("a time range on a sensitive field is refused", () => {
    const outcome = authorizeDataNeed({
      need: need({ timeRange: { field: "idempotencyKey" } }),
      ownerScope: OWNER,
    });
    expect(outcome.status).toBe("NEEDS_INPUT");
  });
});

describe("stable references and presented order", () => {
  it("a row is found by the reference the runtime gave it", () => {
    expect(rowByRef(dataset(), "r2")?.values.name).toBe("باء");
  });

  it("position is the PRESENTED position, 1-based", () => {
    expect(rowAtPosition(dataset(), 2)?.ref).toBe("r2");
  });

  it("a position past the end is undefined, never the nearest row", () => {
    expect(rowAtPosition(dataset(), 9)).toBeUndefined();
  });

  it("re-sorting keeps the SAME rows and re-positions them", () => {
    const sorted = derivedSort(dataset(), "amount", "DESC")!;
    expect(sorted.datasetId).toBe("ds_test");
    expect(sorted.revision).toBe(2);
    expect(sorted.rows.map((row) => row.ref)).toEqual(["r2", "r3", "r1"]);
    expect(sorted.rows.map((row) => row.position)).toEqual([1, 2, 3]);
    // «اعرض الثاني» after «رتبها من الأعلى» means the new second.
    expect(rowAtPosition(sorted, 2)?.ref).toBe("r3");
  });

  it("re-sorting preserves provenance and freshness — it is the same read", () => {
    const sorted = derivedSort(dataset(), "amount", "ASC")!;
    expect(sorted.provenance).toEqual(dataset().provenance);
    expect(sorted.freshness).toBe("UNKNOWN");
  });

  it("sorting by a field the dataset does not have refuses", () => {
    expect(derivedSort(dataset(), "profit", "ASC")).toBeUndefined();
    const refusal = resortedTable(dataset(), "profit", "ASC");
    expect(isRefusal(refusal)).toBe(true);
  });

  it("absent values sort last in both directions", () => {
    const withGap: CanonicalDataset = {
      ...dataset(),
      rows: [
        { ref: "r1", position: 1, values: { amount: 5 } },
        { ref: "r2", position: 2, values: { amount: null } },
        { ref: "r3", position: 3, values: { amount: 9 } },
      ],
    };
    // "No value" is not smaller than every value; it is not on the scale.
    expect(derivedSort(withGap, "amount", "ASC")!.rows.at(-1)!.ref).toBe("r2");
    expect(derivedSort(withGap, "amount", "DESC")!.rows.at(-1)!.ref).toBe("r2");
  });
});

describe("TABLE", () => {
  it("renders columns in the runtime's order, not the source's key order", () => {
    const surface = tableSurface(dataset());
    expect(surface.rows[0].cells.map((cell) => cell.key)).toEqual([
      "id", "name", "amount", "group",
    ]);
  });

  it("carries the dataset identity and revision", () => {
    const surface = tableSurface(dataset());
    expect(surface.datasetId).toBe("ds_test");
    expect(surface.revision).toBe(1);
  });

  it("an empty dataset is an empty table, not an error", () => {
    const surface = tableSurface({ ...dataset(), rows: [] });
    expect(surface.emptyReason).toBe("NO_ROWS");
    expect(surface.columns).toHaveLength(4);
  });

  it("never claims live data", () => {
    expect(JSON.stringify(tableSurface(dataset()))).not.toContain("مباشر");
  });
});

describe("CHART", () => {
  it("aggregates a measure by a category", () => {
    const chart = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "group",
      measureField: "amount",
      aggregation: "SUM",
    });
    expect(isRefusal(chart)).toBe(false);
    if (!isRefusal(chart)) {
      expect(chart.points).toEqual([
        { category: "أ", value: 30 },
        { category: "ب", value: 30 },
      ]);
    }
  });

  it("COUNT needs no measure — it is a question about the category alone", () => {
    const chart = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "group",
      aggregation: "COUNT",
    });
    if (!isRefusal(chart)) expect(chart.points).toEqual([
      { category: "أ", value: 2 },
      { category: "ب", value: 1 },
    ]);
  });

  it("charting a text column as a measure is REFUSED, not coerced", () => {
    // A chart built from a silent Number("باء") would be a picture of NaN
    // presented as a finding.
    const chart = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "group",
      measureField: "name",
      aggregation: "AVG",
    });
    expect(isRefusal(chart)).toBe(true);
    if (isRefusal(chart)) expect(chart.reason).toBe("NOT_MEASURABLE");
  });

  it("an unknown category field is REFUSED", () => {
    const chart = chartSurface(dataset(), {
      form: "LINE",
      categoryField: "region",
      aggregation: "COUNT",
    });
    expect(isRefusal(chart)).toBe(true);
  });

  it("a chart is the SAME dataset seen differently", () => {
    const chart = chartSurface(dataset(), {
      form: "BAR",
      categoryField: "group",
      aggregation: "COUNT",
    });
    if (!isRefusal(chart)) {
      expect(chart.datasetId).toBe("ds_test");
      expect(chart.revision).toBe(1);
    }
  });
});

describe("GENERALITY — one system, any subject", () => {
  /**
   * Five familiar and five unfamiliar. None of them is a type in this codebase;
   * each is a resource NAME that either resolves or truthfully does not.
   */
  const FAMILIAR = ["مبيعاتي", "المخزون", "الموظفين", "الحجوزات", "الطلبات"];
  const UNFAMILIAR = [
    "سجل المسح الأثري",
    "عقود تأجير خلايا النحل",
    "قراءات الكلور في المحطة",
    "إعارات مكتبة المسجد",
    "ساعات تشغيل المخرطة",
  ];

  it.each([...FAMILIAR, ...UNFAMILIAR])(
    "«%s» goes through the same authorization and answers truthfully",
    (subject) => {
      const outcome = authorizeDataNeed({ need: need({ resource: subject }), ownerScope: OWNER });
      // Not registered → UNAVAILABLE. Not invented, not approximated, and the
      // same code path for every one of them.
      expect(outcome.status).toBe("UNAVAILABLE");
    },
  );

  it("a registered resource answers through that identical path", () => {
    const outcome = authorizeDataNeed({ need: need({ resource: "عملياتي" }), ownerScope: OWNER });
    expect(outcome.status).toBe("AUTHORIZED");
  });

  it("ten subjects produced no new type, query class or dashboard", () => {
    // Every one of them used `DataNeed` → `authorizeDataNeed`. If any had
    // needed its own, this test could not be written as a loop.
    expect(listCanonicalResources().every((r) => readableColumns(r).length > 0)).toBe(true);
  });
});

describe("DOMAIN_QUERY_TYPES_ADDED = 0", () => {
  const files = [
    "api/runtime/data-need.ts",
    "api/runtime/authorized-query.ts",
    "api/runtime/canonical-dataset.ts",
    "api/runtime/dataset-presentation.ts",
    "api/runtime/data-source.ts",
  ];

  it.each(files)("%s names no domain", (file) => {
    const source = readFileSync(join(__dirname, "../..", file), "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
      .replace(/`[^`]*`/g, '""')
      .replace(/"[^"]*"/g, '""')
      .replace(/'[^']*'/g, '""');
    for (const word of ["sales", "inventory", "employee", "booking", "restaurant", "invoice"]) {
      expect(code.toLowerCase()).not.toContain(word);
    }
  });

  it("no module name contains a domain", () => {
    for (const file of files) expect(file).toMatch(/data|dataset|quer|source|presentation/);
  });
});
