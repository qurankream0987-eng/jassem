/**
 * JASIM mobile — the same CanonicalDataset, adapted to a phone.
 *
 * Same dataset, same columns, same rows, same freshness. Not a second data
 * architecture and not a second set of rules: the runtime decides everything
 * about the data, and this file decides how much of it fits on a small screen.
 *
 * ─── WHAT CHANGES ON A PHONE, AND WHAT DOES NOT ─────────────────────────────
 *
 * A wide table does not become a narrow table by dropping columns silently —
 * that would show a person less than they asked for without saying so. It
 * scrolls horizontally, the way a table does, and the row count and freshness
 * stay visible.
 *
 * The one colour is `#2196c9`, JASIM's accent re-stepped into the dark-mode
 * lightness band and validated against the dark surface. Status colours are
 * not used for data: a green bar would read as good news.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/colors';

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
  scope?: 'SOURCE' | 'COMPLETE_WINDOW' | 'PARTIAL_WINDOW';
  coverage?: { counted: number; total?: number };
  emptyReason?: 'NO_ROWS';
}

export type DatasetSurfaceData = TableSurfaceData | ChartSurfaceData;

const SERIES = '#2196c9';

function freshnessLabel(freshness: TableSurfaceData['freshness']): string {
  // No «مباشر». Nothing maintains that claim yet.
  if (freshness === 'CURRENT') return 'محدّثة الآن';
  if (freshness === 'STALE') return 'قد لا تكون محدّثة';
  return 'حسب آخر قراءة';
}

function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'TIMESTAMP') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleDateString('ar', { dateStyle: 'short' });
  }
  if (type === 'NUMBER' || type === 'INTEGER') {
    return typeof value === 'number' ? value.toLocaleString('ar') : String(value);
  }
  if (type === 'BOOLEAN') return value ? 'نعم' : 'لا';
  return String(value);
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function TableView({ surface }: { surface: TableSurfaceData }) {
  if (surface.emptyReason === 'NO_ROWS') return <Empty text="لا توجد نتائج مطابقة." />;

  const shown = surface.rows.length;
  const total = surface.window.totalRows;

  return (
    <View>
      {/* Horizontal scroll rather than hidden columns. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.headerRow}>
            {surface.columns.map((column) => (
              <Text key={column.key} style={[styles.cell, styles.headerCell]} numberOfLines={1}>
                {column.label}
              </Text>
            ))}
          </View>
          {surface.rows.map((row) => (
            <View key={row.ref} style={styles.row}>
              {surface.columns.map((column) => {
                const cell = row.cells.find((entry) => entry.key === column.key);
                return (
                  <Text key={column.key} style={styles.cell} numberOfLines={1}>
                    {formatCell(cell?.value, column.type)}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {total !== undefined && total > shown ? `${shown} من ${total} صفاً` : `${shown} صفاً`}
        </Text>
        <Text style={styles.footerText}>{freshnessLabel(surface.freshness)}</Text>
      </View>
    </View>
  );
}

function ChartView({ surface }: { surface: ChartSurfaceData }) {
  const max = useMemo(
    () => Math.max(...surface.points.map((point) => point.value), 0),
    [surface.points],
  );

  if (surface.emptyReason === 'NO_ROWS') return <Empty text="لا توجد بيانات لرسمها." />;

  if (surface.form === 'METRIC') {
    const total = surface.points.reduce((sum, point) => sum + point.value, 0);
    return (
      <View style={styles.metric}>
        <Text style={styles.metricValue}>{total.toLocaleString('ar')}</Text>
        <Text style={styles.footerText}>{surface.measureLabel}</Text>
      </View>
    );
  }

  // BAR and LINE both draw as bars on a phone: a 100px-wide line chart of five
  // points is less readable than five labelled bars, and the honest adaptation
  // is to show the same numbers in the form that fits.
  return (
    <View>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {surface.measureLabel} حسب {surface.categoryLabel}
        </Text>
        <Text style={styles.footerText}>{freshnessLabel(surface.freshness)}</Text>
      </View>
      {/* A partial window says so, in text. A bar chart of 50 rows out of
          4000 looks exactly like a bar chart of 4000. */}
      {surface.scope === 'PARTIAL_WINDOW' ? (
        <Text style={styles.scopeNote}>
          محسوب على {surface.coverage?.counted ?? 0} من{' '}
          {surface.coverage?.total ?? surface.coverage?.counted ?? 0} صفاً المعروضة، وليس على
          كامل البيانات.
        </Text>
      ) : null}
      {surface.points.map((point) => (
        <View
          key={point.category}
          style={styles.barRow}
          accessible
          // Identity never depends on colour: the label and the number are
          // what a screen reader reads, and every bar shares one hue.
          accessibilityLabel={`${point.category}: ${point.value.toLocaleString('ar')}`}
        >
          <Text style={styles.barLabel} numberOfLines={1}>
            {point.category}
          </Text>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                { width: `${max > 0 ? (point.value / max) * 100 : 0}%` },
              ]}
            />
          </View>
          <Text style={styles.barValue}>{point.value.toLocaleString('ar')}</Text>
        </View>
      ))}
    </View>
  );
}

export function DatasetSurface({ surface }: { surface: DatasetSurfaceData }) {
  return (
    <View style={styles.container}>
      {surface.primitive === 'TABLE' ? (
        <TableView surface={surface} />
      ) : (
        <ChartView surface={surface} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.045)',
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row-reverse',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  row: {
    flexDirection: 'row-reverse',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  cell: {
    width: 128,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'right',
    color: palette.text,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  headerCell: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  footerText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  empty: {
    paddingVertical: 36,
    paddingHorizontal: 16,
  },
  emptyText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  metric: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  metricValue: {
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 30,
  },
  barRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  barLabel: {
    width: 96,
    textAlign: 'right',
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  barTrack: {
    flex: 1,
    height: 18,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: SERIES,
  },
  scopeNote: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 11,
    textAlign: 'right',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  barValue: {
    width: 56,
    textAlign: 'left',
    color: palette.text,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
});
