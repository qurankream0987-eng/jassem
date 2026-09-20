/**
 * JASIM — CanonicalDataset. Data that survives its own presentation.
 *
 * ─── WHY THIS IS NOT A TABLE ────────────────────────────────────────────────
 *
 *   Dataset != UI.
 *   Dataset != a SQL result.
 *
 * «أرني مبيعاتي» → «رتبها من الأعلى» → «حولها إلى رسم» is ONE dataset seen
 * three ways. If the rows lived inside the table component, the sort would have
 * to re-ask the source and the chart would have to re-ask it again — three
 * answers to one question, each able to differ from the last. So the rows live
 * here, the surfaces read them, and a presentation change costs no query.
 *
 * ─── STABLE ROW REFERENCES ──────────────────────────────────────────────────
 *
 * Every row carries a `ref` the runtime assigned, and a `position` that is its
 * place in the order the person was SHOWN. «اعرض الثاني فقط» means the second
 * row on their screen — not the second row the database happened to return, and
 * not the runtime's own idea of which is second-best. That distinction is the
 * same one `ordinal-reference.ts` exists to protect, and this is where the
 * presented order becomes a durable fact rather than an accident of rendering.
 *
 * ─── FRESHNESS IS A CLAIM, SO IT IS TYPED ───────────────────────────────────
 *
 * A dataset says `CURRENT`, `STALE` or `UNKNOWN`, and `UNKNOWN` is the default
 * because most sources cannot honestly promise more. Nothing here may render
 * «مباشر» — live — and no field in this file can express it. When realtime
 * lands it will set `CURRENT` and say why; until then, claiming it would be the
 * fabrication the whole architecture refuses.
 */

/** What a column holds. Presentation reads this; it never guesses from values. */
export const COLUMN_TYPES = [
  "TEXT",
  "NUMBER",
  "INTEGER",
  "BOOLEAN",
  "TIMESTAMP",
  "IDENTIFIER",
  "ENUM",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export type DatasetColumn = {
  readonly key: string;
  /** Arabic, for a person. The key is for machines. */
  readonly label: string;
  readonly type: ColumnType;
};

/**
 * One row, with the identity the runtime gave it.
 *
 * `ref` is opaque and runtime-assigned: a caller may quote it back to say which
 * row it means, and may not construct one. `position` is 1-based in the
 * PRESENTED order.
 */
export type DatasetRow = {
  readonly ref: string;
  readonly position: number;
  readonly values: Readonly<Record<string, unknown>>;
};

/**
 * How much a dataset's contents can be trusted to be now.
 *
 * `UNKNOWN` is not a failure. It is the truthful answer for a source that
 * cannot say, and it is the default precisely so that a better claim has to be
 * earned rather than assumed.
 */
export type Freshness = "CURRENT" | "STALE" | "UNKNOWN";

/** Where the rows came from, kept so an answer can be traced to its origin. */
export type DatasetProvenance = {
  readonly resourceId: string;
  readonly sourceId: string;
  readonly sourceKind: string;
  /** When the source produced them. */
  readonly observedAt: string;
  /** When the runtime assembled this dataset. */
  readonly generatedAt: string;
};

/** The shaping that produced this view, so a later turn can derive from it. */
export type DatasetView = {
  readonly fields: readonly string[];
  readonly sort: readonly { readonly field: string; readonly direction: "ASC" | "DESC" }[];
  readonly filters: readonly {
    readonly field: string;
    readonly operator: string;
    readonly value: unknown;
  }[];
  readonly window: { readonly limit: number; readonly offset: number };
  /** Rows matching the filters, when the source can say. Not the page size. */
  readonly totalRows?: number;
};

/**
 * WHERE an aggregate was computed — the difference between a true answer and a
 * plausible one.
 *
 *   SOURCE           the source grouped and reduced over the whole authorized
 *                    set. «كل العمليات», and it means it.
 *   COMPLETE_WINDOW  computed in memory, over a window that happens to contain
 *                    every matching row. Arithmetically identical to SOURCE.
 *   PARTIAL_WINDOW   computed in memory over SOME of the rows. This is the one
 *                    that lies if it is not said out loud: a bar chart of 50
 *                    rows out of 4000 looks exactly like a bar chart of 4000.
 */
export type AggregationScope = "SOURCE" | "COMPLETE_WINDOW" | "PARTIAL_WINDOW";

export type DatasetAggregation = {
  readonly scope: AggregationScope;
  readonly groupBy: readonly string[];
  readonly measures: readonly { readonly field: string; readonly fn: string }[];
  /** Rows the aggregate actually saw, and how many exist. */
  readonly coverage: { readonly counted: number; readonly total?: number };
};

export type CanonicalDataset = {
  readonly datasetId: string;
  /**
   * Bumped whenever the rows change. A presentation holds a dataset id plus a
   * revision, so "is what I am showing still what you meant" is answerable
   * without comparing every row — the hook realtime will attach to.
   */
  readonly revision: number;
  readonly columns: readonly DatasetColumn[];
  readonly rows: readonly DatasetRow[];
  readonly view: DatasetView;
  readonly provenance: DatasetProvenance;
  readonly freshness: Freshness;
  /** Present when the rows ARE an aggregate rather than records. */
  readonly aggregation?: DatasetAggregation;
  /** Whose data this is. Set by the runtime from the session, never by input. */
  readonly ownerScope: string;
};

/**
 * How an in-memory aggregate over this dataset would have to describe itself.
 *
 * The honest answer depends on whether the window saw everything. When the
 * source already aggregated, that scope stands — reducing an aggregate again
 * does not make it less true.
 */
export function aggregationScopeFor(dataset: CanonicalDataset): AggregationScope {
  if (dataset.aggregation?.scope === "SOURCE") return "SOURCE";
  const total = dataset.view.totalRows;
  if (total === undefined || total <= dataset.rows.length) return "COMPLETE_WINDOW";
  return "PARTIAL_WINDOW";
}

/** Look a row up by the reference the runtime gave it. */
export function rowByRef(
  dataset: CanonicalDataset,
  ref: string,
): DatasetRow | undefined {
  return dataset.rows.find((row) => row.ref === ref);
}

/**
 * The row at a 1-based PRESENTED position.
 *
 * Out of range returns `undefined` rather than the nearest row, for the same
 * reason `resolveOrdinalPositions` refuses to clamp: a position that does not
 * exist is a question the runtime cannot answer, and answering it anyway with
 * something adjacent is a confident wrong answer.
 */
export function rowAtPosition(
  dataset: CanonicalDataset,
  position: number,
): DatasetRow | undefined {
  return dataset.rows.find((row) => row.position === position);
}

/**
 * Re-sort a dataset without going back to the source.
 *
 * This is «رتبها من الأعلى». The rows are the same rows — same refs, same
 * values, same provenance, same freshness — re-positioned. Re-querying here
 * would risk answering with different data than the person is looking at, and
 * would make an ordering request depend on a source being reachable.
 *
 * Returns `undefined` when the field is not in the dataset, so a caller can
 * say so rather than silently returning the original order as though it had
 * sorted.
 */
export function derivedSort(
  dataset: CanonicalDataset,
  field: string,
  direction: "ASC" | "DESC",
): CanonicalDataset | undefined {
  if (!dataset.columns.some((column) => column.key === field)) return undefined;

  const factor = direction === "ASC" ? 1 : -1;
  const sorted = [...dataset.rows].sort((left, right) => {
    const a = left.values[field];
    const b = right.values[field];
    if (a === b) return 0;
    // Absent values sort last in both directions: "no value" is not smaller
    // than every value, it is not on the scale at all.
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
    return String(a).localeCompare(String(b), "ar") * factor;
  });

  return {
    ...dataset,
    // A new revision, because the PRESENTED order changed and positions are
    // part of what a person refers to. The datasetId is the same: this is the
    // same data, seen differently.
    revision: dataset.revision + 1,
    rows: sorted.map((row, index) => ({ ...row, position: index + 1 })),
    view: { ...dataset.view, sort: [{ field, direction }] },
  };
}

/** An empty dataset is a real answer — it is not an error and not a failure. */
export function isEmpty(dataset: CanonicalDataset): boolean {
  return dataset.rows.length === 0;
}
