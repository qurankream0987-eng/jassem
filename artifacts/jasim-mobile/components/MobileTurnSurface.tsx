/**
 * JASIM mobile — the surface a turn produced.
 *
 * The same trusted-registry shape the web uses, for the same reason: TABLE and
 * CHART are the first two entries, and STATUS, CHOICE, MAP, TRACKER and the
 * rest become more entries rather than a rewrite. The phone adapts
 * presentation; it does not get its own data architecture, its own primitives
 * or its own idea of what a surface is.
 *
 * An unknown primitive renders a named notice — never a guess, never the raw
 * payload. A surface this build cannot draw is one it must not pretend to.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/colors';
import { DatasetSurface, type DatasetSurfaceData } from '@/components/DatasetSurface';

type SurfacePayload = Record<string, unknown>;

function isTable(value: SurfacePayload): boolean {
  return (
    value.primitive === 'TABLE' &&
    Array.isArray(value.columns) &&
    Array.isArray(value.rows) &&
    typeof value.datasetId === 'string'
  );
}

function isChart(value: SurfacePayload): boolean {
  return (
    value.primitive === 'CHART' &&
    Array.isArray(value.points) &&
    typeof value.datasetId === 'string'
  );
}

const TRUSTED_SURFACES: Record<string, (payload: SurfacePayload) => React.ReactElement | null> = {
  TABLE: (payload) =>
    isTable(payload) ? <DatasetSurface surface={payload as unknown as DatasetSurfaceData} /> : null,
  CHART: (payload) =>
    isChart(payload) ? <DatasetSurface surface={payload as unknown as DatasetSurfaceData} /> : null,
};

export const MOBILE_TRUSTED_SURFACE_PRIMITIVES = Object.keys(TRUSTED_SURFACES);

export function MobileTurnSurface({ surface }: { surface?: SurfacePayload }) {
  if (!surface || typeof surface !== 'object') return null;
  const primitive = String(surface.primitive ?? '');
  const render = TRUSTED_SURFACES[primitive];
  const rendered = render ? render(surface) : null;

  if (!rendered) {
    return (
      <View style={styles.notice} accessibilityRole="text">
        <Text style={styles.noticeText}>
          لا يمكن عرض هذا النوع من الأسطح في هذه النسخة ({primitive}).
        </Text>
      </View>
    );
  }
  return <View>{rendered}</View>;
}

/**
 * A routed turn with nothing built to answer it. A notice, not a reply.
 *
 * The state travels with it for the same reason the web writes
 * `data-routed-state`: UNAVAILABLE and DENIED are different facts, and a
 * person, a test and a log should all be able to tell which one happened.
 */
export function MobileRoutedNotice({ message, state }: { message: string; state?: string }) {
  return (
    <View style={styles.notice} accessibilityRole="text" testID={`routed-${state ?? 'STATE'}`}>
      <Text style={styles.noticeText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  noticeText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'right',
  },
});
