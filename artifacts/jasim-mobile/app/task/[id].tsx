import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetRuntimeOverviewQueryKey,
  getGetRuntimeTaskQueryKey,
  useActOnRuntimeTask,
  useGetRuntimeTask,
  type RuntimeTask,
} from '@workspace/api-client-react';
import { fonts, palette } from '@/constants/colors';
import {
  eventLabel,
  newIdempotencyKey,
  statusColor,
  statusLabel,
  timeLabel,
} from '@/lib/labels';

type TaskAction = RuntimeTask['actions'][number];
type TaskEvent = RuntimeTask['events'][number];

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: task, isLoading, isError, refetch } = useGetRuntimeTask(id ?? '', {
    query: {
      enabled: !!id,
      queryKey: getGetRuntimeTaskQueryKey(id ?? ''),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        const terminal =
          status === 'completed' || status === 'failed' || status === 'blocked';
        return terminal ? false : 2500;
      },
    },
  });

  const actOnTask = useActOnRuntimeTask();
  const [contextDraft, setContextDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showWorld, setShowWorld] = useState(false);

  const pendingActions = useMemo(
    () =>
      (task?.actions ?? []).filter(
        (action) => action.status === 'ready' || action.status === 'pending',
      ),
    [task],
  );

  const runAction = (
    action: TaskAction,
    payload: { input?: Record<string, unknown>; approval?: boolean },
  ) => {
    if (!task) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionError(null);
    actOnTask.mutate(
      {
        taskId: task.id,
        data: {
          actionId: action.id,
          idempotencyKey: newIdempotencyKey(),
          ...payload,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetRuntimeTaskQueryKey(task.id), updated);
          queryClient.invalidateQueries({
            queryKey: getGetRuntimeOverviewQueryKey(),
          });
          if (action.kind === 'provide_input') setContextDraft('');
        },
        onError: (error) => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setActionError(
            error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء.',
          );
        },
      },
    );
  };

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? insets.bottom + 34 : insets.bottom;

  return (
    <View style={[styles.root, { paddingTop: topPad + 8 }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          testID="task-back"
        >
          <Ionicons name="chevron-forward" size={20} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>عالم المهمة</Text>
        {task ? (
          <View
            style={[
              styles.statusChip,
              { borderColor: `${statusColor(task.status)}66` },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusColor(task.status) },
              ]}
            />
            <Text
              style={[styles.statusText, { color: statusColor(task.status) }]}
            >
              {statusLabel(task.status)}
            </Text>
          </View>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={palette.cyan} size="large" />
          <Text style={styles.centerText}>جارٍ استدعاء حالة العالم…</Text>
        </View>
      ) : isError || !task ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={36} color={palette.red} />
          <Text style={styles.centerText}>تعذر تحميل المهمة.</Text>
          <Pressable onPress={() => refetch()} testID="task-retry">
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: bottomPad + 24,
            gap: 14,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.goalCard}>
            <Text style={styles.goalLabel}>الهدف</Text>
            <Text style={styles.goalText} testID="task-goal">
              {task.goal}
            </Text>
          </View>

          {task.status === 'blocked' ? (
            <View style={styles.blockedCard} testID="task-blocked-banner">
              <Ionicons name="hand-left-outline" size={20} color={palette.orange} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.blockedTitle}>التنفيذ متوقف بأمان</Text>
                <Text style={styles.blockedText}>
                  لم يُنفَّذ أي إجراء حقيقي: لا توجد قدرة موثوقة مُسندة لهذه
                  الخطة بعد. هذا إيقاف صريح وليس نجاحًا.
                </Text>
              </View>
            </View>
          ) : null}

          {pendingActions.length > 0 ? (
            <View style={styles.actionsCard}>
              <Text style={styles.sectionTitle}>يتطلب تدخلك</Text>
              {actionError ? (
                <Text style={styles.actionError} testID="action-error">
                  {actionError}
                </Text>
              ) : null}
              {pendingActions.map((action) => (
                <View key={action.id} style={styles.actionItem}>
                  <Text style={styles.actionLabel}>{action.label}</Text>
                  {action.status !== 'ready' ? (
                    <Text style={styles.actionHint}>
                      هذا الإجراء بانتظار اكتمال المرحلة السابقة.
                    </Text>
                  ) : null}
                  {action.kind === 'provide_input' ? (
                    <View style={styles.actionBody}>
                      <TextInput
                        style={styles.contextInput}
                        placeholder="صف السياق المطلوب: الجمهور، القيود، التفاصيل…"
                        placeholderTextColor="rgba(148,163,184,0.45)"
                        value={contextDraft}
                        onChangeText={setContextDraft}
                        multiline
                        editable={action.status === 'ready'}
                        textAlign="right"
                        testID="action-context-input"
                      />
                      <GlassButton
                        label="إرسال السياق"
                        color={palette.cyan}
                        disabled={
                          action.status !== 'ready' ||
                          contextDraft.trim().length < 3 ||
                          actOnTask.isPending
                        }
                        onPress={() =>
                          runAction(action, {
                            input: { note: contextDraft.trim() },
                          })
                        }
                        testID="action-context-submit"
                      />
                    </View>
                  ) : null}
                  {action.kind === 'approve' ? (
                    <View style={styles.actionBody}>
                      <Text style={styles.actionHint}>
                        بالموافقة تصبح الخطة جاهزة؛ التنفيذ الفعلي لا يتم إلا
                        عبر قدرة موثوقة.
                      </Text>
                      <GlassButton
                        label="أوافق على الخطة"
                        color={palette.green}
                        disabled={action.status !== 'ready' || actOnTask.isPending}
                        onPress={() => runAction(action, { approval: true })}
                        testID="action-approve"
                      />
                    </View>
                  ) : null}
                  {action.kind === 'execute' ? (
                    <View style={styles.actionBody}>
                      <GlassButton
                        label="تأكيد التنفيذ"
                        color={palette.purple}
                        disabled={action.status !== 'ready' || actOnTask.isPending}
                        onPress={() => runAction(action, {})}
                        testID="action-execute"
                      />
                    </View>
                  ) : null}
                </View>
              ))}
              {actOnTask.isPending ? (
                <ActivityIndicator color={palette.cyan} style={{ marginTop: 6 }} />
              ) : null}
            </View>
          ) : null}

          <PlanCard task={task} />

          <View style={styles.sectionCard}>
            <Pressable
              style={styles.collapsibleHeader}
              onPress={() => setShowWorld((value) => !value)}
              testID="world-toggle"
            >
              <Ionicons
                name={showWorld ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={palette.text2}
              />
              <Text style={styles.sectionTitle}>حالة العالم (JSON)</Text>
            </Pressable>
            {showWorld ? (
              <Text style={styles.worldJson} testID="world-json">
                {JSON.stringify(task.world, null, 2)}
              </Text>
            ) : null}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>الأحداث</Text>
            <View style={styles.timeline}>
              {task.events.map((event, index) => (
                <TimelineRow
                  key={event.id}
                  event={event}
                  last={index === task.events.length - 1}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function PlanCard({ task }: { task: RuntimeTask }) {
  const plan = (task.world as { plan?: { status?: string; steps?: string[] } })
    .plan;
  const steps = plan?.steps ?? [];
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>الخطة المرحلية</Text>
      {steps.map((step, index) => (
        <View key={`${index}-${step}`} style={styles.planStep}>
          <View style={styles.planIndex}>
            <Text style={styles.planIndexText}>{index + 1}</Text>
          </View>
          <Text style={styles.planStepText}>{step}</Text>
        </View>
      ))}
      <Text style={styles.planStatus}>حالة الخطة: {plan?.status ?? '—'}</Text>
    </View>
  );
}

function TimelineRow({ event, last }: { event: TaskEvent; last: boolean }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}>
        <View style={styles.timelineDot} />
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <View style={styles.timelineHeader}>
          <Text style={styles.timelineType}>{eventLabel(event.type)}</Text>
          <Text style={styles.timelineTime}>{timeLabel(event.createdAt)}</Text>
        </View>
        <Text style={styles.timelineMessage}>{event.message}</Text>
      </View>
    </View>
  );
}

function GlassButton({
  label,
  color,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.glassButton,
        { borderColor: `${color}55`, backgroundColor: `${color}1f` },
        disabled && { opacity: 0.45 },
      ]}
      testID={testID}
    >
      <Text style={[styles.glassButtonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.black,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: palette.text,
  },
  statusChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  centerText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: palette.text2,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: palette.cyan,
  },
  goalCard: {
    borderRadius: 20,
    padding: 16,
    gap: 6,
    backgroundColor: 'rgba(168,85,247,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.25)',
  },
  goalLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: palette.purple,
    textAlign: 'right',
  },
  goalText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    lineHeight: 26,
    color: palette.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  blockedCard: {
    flexDirection: 'row-reverse',
    gap: 10,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,107,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,0,0.35)',
    alignItems: 'flex-start',
  },
  blockedTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: palette.orange,
    textAlign: 'right',
  },
  blockedText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 20,
    color: palette.text2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actionsCard: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: 'rgba(0,212,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.22)',
  },
  actionItem: {
    gap: 8,
  },
  actionLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: palette.text,
    textAlign: 'right',
  },
  actionBody: {
    gap: 8,
  },
  actionHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 18,
    color: palette.text2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actionError: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: palette.red,
    textAlign: 'right',
  },
  contextInput: {
    minHeight: 76,
    maxHeight: 140,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: palette.text,
    writingDirection: 'rtl',
  },
  glassButton: {
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
  },
  glassButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  sectionCard: {
    borderRadius: 20,
    padding: 16,
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: palette.text,
    textAlign: 'right',
  },
  planStep: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
  },
  planIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,212,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.3)',
  },
  planIndexText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: palette.cyan,
  },
  planStepText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12.5,
    lineHeight: 20,
    color: palette.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  planStatus: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: palette.text2,
    textAlign: 'right',
  },
  collapsibleHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  worldJson: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10.5,
    lineHeight: 16,
    color: palette.text2,
    textAlign: 'left',
  },
  timeline: {
    gap: 0,
  },
  timelineRow: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  timelineRail: {
    alignItems: 'center',
    width: 14,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.cyan,
    marginTop: 5,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginVertical: 2,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: 14,
    gap: 3,
  },
  timelineHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineType: {
    fontFamily: fonts.bold,
    fontSize: 11.5,
    color: palette.cyan,
  },
  timelineTime: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: palette.text2,
  },
  timelineMessage: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 19,
    color: palette.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
