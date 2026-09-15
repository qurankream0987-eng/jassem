import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  LivingObjectAttentionLevel,
  LivingObjectProjection,
  LivingObjectsProjection,
} from '@workspace/jasim-runtime-contract';
import { fonts, palette } from '@/constants/colors';
import {
  boundedMobileLivingObjects,
  livingObjectAccessibilityLabel,
  livingObjectAttentionLabel,
  livingObjectProgressPercentage,
  livingObjectStatusLabel,
  shouldShowMobileLivingObjects,
} from '@/lib/mobile-living-objects';

type Props = {
  projection: LivingObjectsProjection | null;
  onOpen: (object: LivingObjectProjection) => void | Promise<void>;
};

const attentionTokens: Record<
  LivingObjectAttentionLevel,
  { color: string; border: string; background: string }
> = {
  NONE: {
    color: palette.text2,
    border: 'rgba(148,163,184,0.2)',
    background: 'rgba(148,163,184,0.06)',
  },
  INFO: {
    color: palette.cyan,
    border: 'rgba(0,212,255,0.28)',
    background: 'rgba(0,132,180,0.12)',
  },
  ACTION_REQUIRED: {
    color: palette.amber,
    border: 'rgba(255,193,7,0.38)',
    background: 'rgba(255,193,7,0.1)',
  },
  APPROVAL_REQUIRED: {
    color: palette.purple,
    border: 'rgba(168,85,247,0.45)',
    background: 'rgba(168,85,247,0.12)',
  },
  BLOCKED: {
    color: palette.orange,
    border: 'rgba(255,107,0,0.42)',
    background: 'rgba(255,107,0,0.1)',
  },
  FAILED: {
    color: palette.red,
    border: 'rgba(255,107,107,0.42)',
    background: 'rgba(255,107,107,0.1)',
  },
  COMPLETED: {
    color: palette.green,
    border: 'rgba(0,200,150,0.3)',
    background: 'rgba(0,200,150,0.08)',
  },
};

function semanticIcon(semanticType: LivingObjectProjection['semanticType']) {
  if (semanticType === 'world') return 'globe-outline' as const;
  if (semanticType === 'bubble') return 'sparkles-outline' as const;
  return 'pulse-outline' as const;
}

export function MobileLivingObjectItem({
  object,
  onOpen,
}: {
  object: LivingObjectProjection;
  onOpen: (object: LivingObjectProjection) => void | Promise<void>;
}) {
  const attention = attentionTokens[object.attention.level];
  const progress = livingObjectProgressPercentage(object);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={livingObjectAccessibilityLabel(object)}
      accessibilityHint="يفتح المرجع الحالي في مساحة العمل"
      onPress={() => void onOpen(object)}
      style={({ pressed }) => [
        styles.item,
        {
          borderColor: attention.border,
          backgroundColor: pressed ? attention.background : 'rgba(255,255,255,0.035)',
        },
      ]}
      testID={`mobile-living-object-${object.id}`}
    >
      <View style={[styles.icon, { borderColor: attention.border, backgroundColor: attention.background }]}>
        <Ionicons name={semanticIcon(object.semanticType)} size={17} color={attention.color} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.title}>{object.title}</Text>
          <Ionicons name="open-outline" size={14} color={palette.text2} />
        </View>
        <Text numberOfLines={1} style={styles.summary}>{object.summary}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.attentionDot, { backgroundColor: attention.color }]} />
          <Text numberOfLines={1} style={[styles.metaText, { color: attention.color }]}>
            {livingObjectAttentionLabel(object.attention.level)}
          </Text>
          <Text style={styles.separator}>·</Text>
          <Text numberOfLines={1} style={styles.metaText}>
            {livingObjectStatusLabel(object.status)}
          </Text>
        </View>
        {progress !== null ? (
          <View
            accessibilityLabel={`${progress}% مكتمل`}
            style={styles.progressTrack}
          >
            <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: attention.color }]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function MobileLivingObjectsSurface({ projection, onOpen }: Props) {
  const objects = boundedMobileLivingObjects(projection);
  if (!shouldShowMobileLivingObjects(projection)) return null;

  return (
    <View
      accessibilityLabel="العناصر المستمرة"
      style={styles.surface}
      testID="active-living-objects-surface"
    >
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="radio-outline" size={14} color={palette.cyan} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>نشاط مستمر</Text>
          <Text style={styles.headerSubtitle}>
            {objects.length === 1 ? 'مرجع واحد متاح' : `${objects.length} مراجع متاحة`}
          </Text>
        </View>
      </View>
      <FlatList
        accessibilityLabel="قائمة العناصر المستمرة"
        data={objects}
        horizontal
        inverted
        keyExtractor={(object) => object.id}
        renderItem={({ item }) => <MobileLivingObjectItem object={item} onOpen={onOpen} />}
        contentContainerStyle={styles.listContent}
        showsHorizontalScrollIndicator={false}
        testID="active-living-objects-list"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.18)',
    backgroundColor: 'rgba(4,13,25,0.72)',
    paddingVertical: 9,
    gap: 7,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
  },
  headerIcon: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.24)',
    backgroundColor: 'rgba(0,132,180,0.11)',
  },
  headerCopy: {
    flex: 1,
    alignItems: 'flex-end',
  },
  headerTitle: {
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    writingDirection: 'rtl',
  },
  headerSubtitle: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    writingDirection: 'rtl',
  },
  listContent: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingHorizontal: 10,
  },
  item: {
    width: 232,
    minHeight: 95,
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 9,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.035)',
    padding: 10,
  },
  icon: {
    width: 31,
    height: 31,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  title: {
    flex: 1,
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  summary: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  metaRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  attentionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaText: {
    maxWidth: 85,
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 9,
    writingDirection: 'rtl',
  },
  separator: {
    color: palette.text2,
    fontSize: 9,
  },
  progressTrack: {
    height: 3,
    marginTop: 3,
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
});