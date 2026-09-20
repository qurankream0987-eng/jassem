/**
 * JASIM — a CanonicalDataset becomes a surface.
 *
 * One dataset, several ways of looking at it. «أرني مبيعاتي» →
 * «رتبها من الأعلى» → «حولها إلى رسم» is ONE read and three presentations, and
 * the reason that works is that nothing here goes back to a source.
 *
 * ─── NO MODEL-AUTHORED DRAWING ──────────────────────────────────────────────
 *
 * A chart is described by naming a category column, a measure column and one
 * of three forms. That is the entire vocabulary. There is no place to put
 * generated code, no SVG, no expression to evaluate — a chart intent that names
 * a column the dataset does not have is refused rather than approximated.
 *
 * ─── NO DOMAIN COMPONENTS ───────────────────────────────────────────────────
 *
 * There is no SalesChart and no InventoryTable. A table renders columns and
 * rows; a chart renders a category against a measure. What the numbers are
 * about is the dataset's business and never this file's.
 */

import {
  derivedSort,
  type CanonicalDataset,
  type DatasetColumn,
} from "./canonical-dataset";

/** The chart forms that exist. Three, and each is a different question. */
export const CHART_FORMS = ["BAR", "LINE", "METRIC"] as const;
export type ChartForm = (typeof CHART_FORMS)[number];

/** How several rows in one category become one number. */
export const CHART_AGGREGATIONS = ["SUM", "COUNT", "AVG", "MIN", "MAX"] as const;
export type ChartAggregation = (typeof CHART_AGGREGATIONS)[number];

/** Columns a chart can measure. A chart of text is not a chart. */
const MEASURABLE = new Set(["NUMBER", "INTEGER"]);

export type TableSurface = {
  readonly primitive: "TABLE";
  readonly datasetId: string;
  readonly revision: number;
  readonly columns: readonly DatasetColumn[];
  readonly rows: readonly {
    readonly ref: string;
    readonly position: number;
    readonly cells: readonly { readonly key: string; readonly value: unknown }[];
  }[];
  readonly window: { readonly limit: number; readonly offset: number; readonly totalRows?: number };
  readonly sort: readonly { readonly field: string; readonly direction: "ASC" | "DESC" }[];
  readonly freshness: CanonicalDataset["freshness"];
  readonly emptyReason?: "NO_ROWS";
};

export type ChartSurface = {
  readonly primitive: "CHART";
  readonly datasetId: string;
  readonly revision: number;
  readonly form: ChartForm;
  readonly categoryLabel: string;
  readonly measureLabel: string;
  readonly aggregation: ChartAggregation;
  readonly points: readonly { readonly category: string; readonly value: number }[];
  readonly freshness: CanonicalDataset["freshness"];
  readonly emptyReason?: "NO_ROWS";
};

export type ChartIntent = {
  readonly form: ChartForm;
  readonly categoryField: string;
  readonly measureField?: string;
  readonly aggregation: ChartAggregation;
};

export type SurfaceRefusal = {
  readonly status: "REFUSED";
  readonly reason: "UNKNOWN_FIELD" | "NOT_MEASURABLE" | "UNSUPPORTED_FORM";
  readonly message: string;
};

/**
 * Render a dataset as a table.
 *
 * Total, because any dataset is a table: a dataset with no rows is an empty
 * table, which is a real answer and not an error. `emptyReason` lets a surface
 * say «لا توجد نتائج» rather than drawing a header over nothing.
 */
export function tableSurface(dataset: CanonicalDataset): TableSurface {
  return {
    primitive: "TABLE",
    datasetId: dataset.datasetId,
    revision: dataset.revision,
    columns: dataset.columns,
    rows: dataset.rows.map((row) => ({
      ref: row.ref,
      position: row.position,
      // Ordered by the dataset's columns, so the runtime decides column order
      // rather than whatever order a source's object keys happened to take.
      cells: dataset.columns.map((column) => ({
        key: column.key,
        value: row.values[column.key] ?? null,
      })),
    })),
    window: {
      limit: dataset.view.window.limit,
      offset: dataset.view.window.offset,
      ...(dataset.view.totalRows !== undefined ? { totalRows: dataset.view.totalRows } : {}),
    },
    sort: dataset.view.sort,
    freshness: dataset.freshness,
    ...(dataset.rows.length === 0 ? { emptyReason: "NO_ROWS" as const } : {}),
  };
}

/**
 * Render a dataset as a chart, or refuse and say why.
 *
 * `COUNT` needs no measure — counting rows per category is a question about the
 * category alone. Every other aggregation needs a numeric column, and asking
 * for the average of a title is refused rather than coerced: a chart built from
 * a silent `Number("قيد التنفيذ")` would be a picture of `NaN` presented as a
 * finding.
 */
export function chartSurface(
  dataset: CanonicalDataset,
  intent: ChartIntent,
): ChartSurface | SurfaceRefusal {
  const category = dataset.columns.find((column) => column.key === intent.categoryField);
  if (!category) {
    return {
      status: "REFUSED",
      reason: "UNKNOWN_FIELD",
      message: `لا يوجد حقل «${intent.categoryField}» في هذه البيانات.`,
    };
  }

  const needsMeasure = intent.aggregation !== "COUNT";
  const measure = intent.measureField
    ? dataset.columns.find((column) => column.key === intent.measureField)
    : undefined;

  if (needsMeasure) {
    if (!measure) {
      return {
        status: "REFUSED",
        reason: "UNKNOWN_FIELD",
        message: `لا يوجد حقل رقمي «${intent.measureField ?? ""}» لرسمه.`,
      };
    }
    if (!MEASURABLE.has(measure.type)) {
      return {
        status: "REFUSED",
        reason: "NOT_MEASURABLE",
        message: `الحقل «${measure.label}» ليس رقمياً، ولا يمكن رسمه.`,
      };
    }
  }

  const buckets = new Map<string, number[]>();
  for (const row of dataset.rows) {
    const key = String(row.values[category.key] ?? "—");
    const raw = measure ? row.values[measure.key] : 1;
    const value = typeof raw === "number" ? raw : Number(raw);
    if (needsMeasure && !Number.isFinite(value)) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), Number.isFinite(value) ? value : 1]);
  }

  const points = [...buckets.entries()].map(([categoryValue, values]) => ({
    category: categoryValue,
    value: reduce(values, intent.aggregation),
  }));

  return {
    primitive: "CHART",
    datasetId: dataset.datasetId,
    revision: dataset.revision,
    form: intent.form,
    categoryLabel: category.label,
    measureLabel: measure?.label ?? "العدد",
    aggregation: intent.aggregation,
    points,
    freshness: dataset.freshness,
    ...(points.length === 0 ? { emptyReason: "NO_ROWS" as const } : {}),
  };
}

function reduce(values: readonly number[], aggregation: ChartAggregation): number {
  if (values.length === 0) return 0;
  if (aggregation === "COUNT") return values.length;
  if (aggregation === "SUM") return values.reduce((total, value) => total + value, 0);
  if (aggregation === "AVG") {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  if (aggregation === "MIN") return Math.min(...values);
  return Math.max(...values);
}

/**
 * «رتبها من الأعلى» — a new view of the SAME dataset.
 *
 * Re-querying would risk answering with different rows than the person is
 * looking at, and would make an ordering request depend on a source being
 * reachable. The refusal path matters as much: sorting by a field the dataset
 * does not have returns the reason, not the original order pretending to be
 * sorted.
 */
export function resortedTable(
  dataset: CanonicalDataset,
  field: string,
  direction: "ASC" | "DESC",
): { dataset: CanonicalDataset; surface: TableSurface } | SurfaceRefusal {
  const sorted = derivedSort(dataset, field, direction);
  if (!sorted) {
    return {
      status: "REFUSED",
      reason: "UNKNOWN_FIELD",
      message: `لا يوجد حقل «${field}» لأرتب به.`,
    };
  }
  return { dataset: sorted, surface: tableSurface(sorted) };
}

export function isRefusal(
  value: TableSurface | ChartSurface | SurfaceRefusal | { dataset: CanonicalDataset; surface: TableSurface },
): value is SurfaceRefusal {
  return "status" in value && value.status === "REFUSED";
}
