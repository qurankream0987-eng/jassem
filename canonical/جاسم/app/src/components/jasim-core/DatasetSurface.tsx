/**
 * JASIM — a CanonicalDataset on screen.
 *
 * One component for both surfaces, because they are one dataset. The runtime
 * decides the columns, the order and the numbers; this file decides nothing
 * about the data and only draws what it is handed.
 *
 * ─── WHY THE CHART IS ONE COLOUR ────────────────────────────────────────────
 *
 * A chart here is ONE measure across categories — a single series. Giving each
 * bar its own hue would be colouring by RANK, which makes the palette change
 * whenever the data reorders and encodes nothing. One hue, direct labels, no
 * legend: identity comes from the axis, magnitude from the bar.
 *
 * `#2196c9` is JASIM's accent re-stepped into the dark-mode lightness band
 * (OKLCH L 0.48–0.67). The product's own `--jasim-accent` sits at L 0.80, which
 * is outside it — validated rather than eyeballed, and the status colours
 * (success / warning / danger) are deliberately not used, because those are
 * reserved for state and reusing one for data would make a green bar look like
 * good news.
 *
 * ─── NO DOMAIN COMPONENTS ───────────────────────────────────────────────────
 *
 * There is no SalesTable and no InventoryChart. A table renders columns and
 * rows; a chart renders a category against a measure.
 */

import { useMemo } from 'react';

// ── What the runtime sends ───────────────────────────────────────────────────

export interface DatasetColumn {
  key: string;
  label: string;
  type: string;
}

export interface TableSurfaceData {
  primitive: 'TABLE';
  datasetId: string;
  revision: number;
  columns: DatasetColumn[];
  rows: { ref: string; position: number; cells: { key: string; value: unknown }[] }[];
  window: { limit: number; offset: number; totalRows?: number };
  sort: { field: string; direction: 'ASC' | 'DESC' }[];
  freshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
  emptyReason?: 'NO_ROWS';
}

export interface ChartSurfaceData {
  primitive: 'CHART';
  datasetId: string;
  revision: number;
  form: 'BAR' | 'LINE' | 'METRIC';
  categoryLabel: string;
  measureLabel: string;
  aggregation: string;
  points: { category: string; value: number }[];
  freshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
  emptyReason?: 'NO_ROWS';
}

export type DatasetSurfaceData = TableSurfaceData | ChartSurfaceData;

/** Validated against the dark surface. See the header. */
const SERIES = '#2196c9';

/**
 * What the runtime can honestly say about how current the rows are.
 *
 * There is no «مباشر» here and there must not be one until realtime makes it
 * true. `UNKNOWN` says «حسب آخر قراءة» — which is a fact — rather than
 * implying a freshness nothing is maintaining.
 */
function FreshnessNote({ freshness }: { freshness: TableSurfaceData['freshness'] }) {
  const text =
    freshness === 'CURRENT'
      ? 'محدّثة الآن'
      : freshness === 'STALE'
        ? 'قد لا تكون محدّثة'
        : 'حسب آخر قراءة';
  return <span className="text-[11px] text-[var(--jasim-text-tertiary)]">{text}</span>;
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-[var(--jasim-text-secondary)]">
      {children}
    </div>
  );
}

/** Values are formatted by the column's declared type, never guessed from the value. */
function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'TIMESTAMP') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (type === 'NUMBER' || type === 'INTEGER') {
    return typeof value === 'number' ? value.toLocaleString('ar') : String(value);
  }
  if (type === 'BOOLEAN') return value ? 'نعم' : 'لا';
  return String(value);
}

// ── TABLE ────────────────────────────────────────────────────────────────────

function TableView({ surface }: { surface: TableSurfaceData }) {
  if (surface.emptyReason === 'NO_ROWS') {
    return <EmptyNote>لا توجد نتائج مطابقة.</EmptyNote>;
  }

  const shown = surface.rows.length;
  const total = surface.window.totalRows;

  return (
    <div className="w-full" dir="rtl">
      {/* Horizontal scroll lives on the table alone, so a wide dataset never
          makes the whole conversation scroll sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--jasim-border)]">
              {surface.columns.map((column) => {
                const sorted = surface.sort.find((entry) => entry.field === column.key);
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-[var(--jasim-text-secondary)]"
                  >
                    {column.label}
                    {sorted && (
                      <span aria-hidden="true" className="ms-1 text-[var(--jasim-text-tertiary)]">
                        {sorted.direction === 'ASC' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {surface.rows.map((row) => (
              <tr
                key={row.ref}
                className="border-b border-[var(--jasim-border)]/50 last:border-0"
              >
                {surface.columns.map((column) => {
                  const cell = row.cells.find((entry) => entry.key === column.key);
                  return (
                    <td
                      key={column.key}
                      className="max-w-[22rem] truncate px-3 py-2 text-right text-[var(--jasim-text)]"
                      title={formatCell(cell?.value, column.type)}
                    >
                      {formatCell(cell?.value, column.type)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] text-[var(--jasim-text-tertiary)]">
          {/* A windowed view says so. Showing 50 of 4000 without saying "of
              4000" is a quiet lie about how much there is. */}
          {total !== undefined && total > shown
            ? `${shown} من ${total} صفاً`
            : `${shown} صفاً`}
        </span>
        <FreshnessNote freshness={surface.freshness} />
      </div>
    </div>
  );
}

// ── CHART ────────────────────────────────────────────────────────────────────

function BarChart({ surface }: { surface: ChartSurfaceData }) {
  const max = useMemo(
    () => Math.max(...surface.points.map((point) => point.value), 0),
    [surface.points],
  );

  return (
    <div className="flex flex-col gap-2 px-3 py-2" dir="rtl">
      {surface.points.map((point) => {
        const share = max > 0 ? (point.value / max) * 100 : 0;
        return (
          <div key={point.category} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 truncate text-right text-xs text-[var(--jasim-text-secondary)]"
              title={point.category}
            >
              {point.category}
            </span>
            {/* The track is a surface, not a second series — it carries no
                meaning and stays recessive. */}
            <div className="h-5 flex-1 rounded bg-[var(--jasim-surface-sunken)]">
              <div
                className="h-full rounded-s-sm rounded-e"
                style={{ width: `${share}%`, backgroundColor: SERIES }}
              />
            </div>
            {/* Direct labels rather than an axis: with one series the number
                belongs next to its own bar. */}
            <span className="w-16 shrink-0 text-left text-xs tabular-nums text-[var(--jasim-text)]">
              {point.value.toLocaleString('ar')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MetricChart({ surface }: { surface: ChartSurfaceData }) {
  const total = surface.points.reduce((sum, point) => sum + point.value, 0);
  return (
    <div className="px-4 py-6 text-center" dir="rtl">
      <div className="text-3xl font-bold tabular-nums text-[var(--jasim-text)]">
        {total.toLocaleString('ar')}
      </div>
      <div className="mt-1 text-xs text-[var(--jasim-text-secondary)]">
        {surface.measureLabel}
      </div>
    </div>
  );
}

function LineChart({ surface }: { surface: ChartSurfaceData }) {
  const { path, points } = useMemo(() => {
    const values = surface.points.map((point) => point.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const step = surface.points.length > 1 ? 100 / (surface.points.length - 1) : 0;
    // RTL: the first category sits on the RIGHT, which is where an
    // Arabic reader starts. A left-to-right line would read backwards.
    const mapped = surface.points.map((point, index) => ({
      x: 100 - index * step,
      y: 40 - ((point.value - min) / span) * 34 - 3,
      point,
    }));
    return {
      points: mapped,
      path: mapped.map((entry, index) => `${index === 0 ? 'M' : 'L'}${entry.x} ${entry.y}`).join(' '),
    };
  }, [surface.points]);

  return (
    <div className="px-3 py-3" dir="rtl">
      <svg viewBox="0 0 100 40" className="h-32 w-full" role="img" aria-label={surface.measureLabel}>
        <path d={path} fill="none" stroke={SERIES} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {points.map((entry) => (
          <circle
            key={entry.point.category}
            cx={entry.x}
            cy={entry.y}
            r="1.6"
            fill={SERIES}
            // A surface ring, so overlapping markers stay countable.
            stroke="var(--jasim-bg)"
            strokeWidth="0.8"
          >
            <title>{`${entry.point.category}: ${entry.point.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between px-1 text-[10px] text-[var(--jasim-text-tertiary)]">
        <span>{surface.points.at(-1)?.category}</span>
        <span>{surface.points[0]?.category}</span>
      </div>
    </div>
  );
}

function ChartView({ surface }: { surface: ChartSurfaceData }) {
  if (surface.emptyReason === 'NO_ROWS') {
    return <EmptyNote>لا توجد بيانات لرسمها.</EmptyNote>;
  }
  return (
    <div>
      <div className="flex items-center justify-between px-3 pt-2">
        {/* One series, so the title names it and no legend box is needed. */}
        <span className="text-xs text-[var(--jasim-text-secondary)]">
          {surface.measureLabel} حسب {surface.categoryLabel}
        </span>
        <FreshnessNote freshness={surface.freshness} />
      </div>
      {surface.form === 'METRIC' && <MetricChart surface={surface} />}
      {surface.form === 'LINE' && <LineChart surface={surface} />}
      {surface.form === 'BAR' && <BarChart surface={surface} />}
    </div>
  );
}

// ── The surface ──────────────────────────────────────────────────────────────

export function DatasetSurface({ surface }: { surface: DatasetSurfaceData }) {
  return (
    <div
      className="my-2 overflow-hidden rounded-xl border border-[var(--jasim-border)] bg-[var(--jasim-surface)]"
      data-dataset-id={surface.datasetId}
      data-revision={surface.revision}
    >
      {surface.primitive === 'TABLE' ? (
        <TableView surface={surface} />
      ) : (
        <ChartView surface={surface} />
      )}
    </div>
  );
}
