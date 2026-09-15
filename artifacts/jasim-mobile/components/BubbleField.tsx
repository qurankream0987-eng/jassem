import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useGetRuntimeOverview } from '@workspace/api-client-react';
import { fonts, palette } from '@/constants/colors';
import { statusLabel, timeLabel } from '@/lib/labels';
import { SoapBubble, type SoapBubbleSpec } from '@/components/SoapBubble';
import { GlassWindow } from '@/components/GlassWindow';
import { Pressable } from 'react-native';

interface TaskSummary {
  id: string;
  goal: string;
  status: string;
  updatedAt: string;
}

/**
 * The floating soap-bubble space behind the main chat. Bubbles visualize the
 * live runtime overview (truthful counters) and the most recent worlds; a
 * short tap opens a glass window, a long press pops the bubble and it
 * respawns after a few seconds.
 */
export function BubbleField() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const { data: overview } = useGetRuntimeOverview();
  const [openBubble, setOpenBubble] = useState<SoapBubbleSpec | null>(null);

  const bubbles = useMemo<SoapBubbleSpec[]>(() => {
    const list: SoapBubbleSpec[] = [
      {
        id: 'metric-total',
        label: 'كل المهام',
        value: String(overview?.total ?? 0),
        x: 0.16,
        y: 0.2,
        radius: 44,
        colors: [palette.cyan, palette.blue] as const,
      },
      {
        id: 'metric-input',
        label: 'بانتظار السياق',
        value: String(overview?.awaitingInput ?? 0),
        x: 0.82,
        y: 0.16,
        radius: 40,
        colors: [palette.orange, palette.gold] as const,
      },
      {
        id: 'metric-approval',
        label: 'بانتظار الموافقة',
        value: String(overview?.awaitingApproval ?? 0),
        x: 0.5,
        y: 0.1,
        radius: 38,
        colors: [palette.pink, palette.purple] as const,
      },
      {
        id: 'metric-done',
        label: 'مكتملة',
        value: String(overview?.completed ?? 0),
        x: 0.86,
        y: 0.52,
        radius: 36,
        colors: [palette.green, palette.cyan] as const,
      },
    ];

    const recent = (overview?.recent ?? []).slice(0, 3) as TaskSummary[];
    const slots = [
      { x: 0.14, y: 0.56 },
      { x: 0.5, y: 0.32 },
      { x: 0.84, y: 0.34 },
    ];
    recent.forEach((task, index) => {
      const slot = slots[index % slots.length];
      list.push({
        id: `task-${task.id}`,
        label:
          task.goal.length > 22 ? `${task.goal.slice(0, 22)}…` : task.goal,
        value: statusLabel(task.status),
        x: slot.x,
        y: slot.y,
        radius: 46,
        colors: [palette.purple, palette.pink] as const,
      });
    });
    return list;
  }, [overview]);

  const openTaskId = openBubble?.id.startsWith('task-')
    ? openBubble.id.slice('task-'.length)
    : null;
  const openTask = openTaskId
    ? ((overview?.recent ?? []) as TaskSummary[]).find(
        (task) => task.id === openTaskId,
      )
    : null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <LinearGradient
        colors={[palette.space2, palette.space1, palette.space0, palette.black]}
        locations={[0, 0.4, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.glow, styles.glowCyan]} />
      <View style={[styles.glow, styles.glowPurple]} />
      {bubbles.map((spec) => (
        <SoapBubble
          key={spec.id}
          spec={spec}
          width={width}
          height={height}
          onOpen={setOpenBubble}
        />
      ))}
      <GlassWindow
        visible={openBubble !== null}
        title={openBubble?.label ?? ''}
        subtitle={openTask ? statusLabel(openTask.status) : 'مؤشر مباشر من نواة جاسم'}
        accentColor={openBubble?.colors[0] ?? palette.cyan}
        onClose={() => setOpenBubble(null)}
      >
        {openTask ? (
          <View style={styles.taskWindow}>
            <Text style={styles.taskGoal}>{openTask.goal}</Text>
            <Text style={styles.taskMeta}>
              آخر تحديث {timeLabel(openTask.updatedAt)} ·{' '}
              {statusLabel(openTask.status)}
            </Text>
            <Pressable
              style={styles.openButton}
              onPress={() => {
                setOpenBubble(null);
                router.push(`/task/${openTask.id}`);
              }}
              testID="window-open-task"
            >
              <Text style={styles.openButtonText}>فتح العالم</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.taskWindow}>
            <Text style={styles.metricValue}>{openBubble?.value ?? '0'}</Text>
            <Text style={styles.taskMeta}>
              عدد حقيقي من حالة الـRuntime الحالية، يتحدث تلقائيًا مع كل مهمة
              جديدة.
            </Text>
          </View>
        )}
      </GlassWindow>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    opacity: 0.16,
  },
  glowCyan: {
    top: '8%',
    left: -80,
    backgroundColor: palette.cyan,
  },
  glowPurple: {
    bottom: '12%',
    right: -90,
    backgroundColor: palette.purple,
  },
  taskWindow: {
    alignItems: 'flex-end',
    gap: 10,
  },
  taskGoal: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: palette.text,
    textAlign: 'right',
    lineHeight: 24,
  },
  taskMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: palette.text2,
    textAlign: 'right',
    lineHeight: 20,
  },
  metricValue: {
    fontFamily: fonts.extraBold,
    fontSize: 40,
    color: palette.text,
    alignSelf: 'center',
  },
  openButton: {
    marginTop: 6,
    alignSelf: 'stretch',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(0,212,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.4)',
  },
  openButtonText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: palette.cyan,
  },
});
