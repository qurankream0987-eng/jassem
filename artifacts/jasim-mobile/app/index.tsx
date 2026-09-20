import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fonts, palette } from '@/constants/colors';
import {
  archiveConversation,
  createConversation,
  createTurn,
  dispatchTrustedAction,
  getConversation,
  getLivingObjectsProjection,
  getRunReceipt,
  getWorkspaceProjection,
  runtimeRequestHeaders,
  listBubbles,
  listConversations,
  type RuntimeConversation,
  type RuntimeBubble,
  type RuntimeRunReceipt,
} from '@/lib/runtime-trpc';
import {
  createMobileTrustedAction,
  parseLivingObjectsProjection,
  parseWorkspaceProjection,
  presentationTransition,
  shouldAcceptWorkspaceProjection,
  workspaceProjectionFreshness,
  type WorkspaceProjectionFreshness,
} from '@/lib/semantic-runtime';
import {
  transitionForConversationChange,
} from '@/lib/mobile-morphing';
import {
  createMobileLivingObjectOpenAction,
  livingObjectsProjectionFreshness,
  shouldAcceptLivingObjectsProjection,
  type LivingObjectsProjectionFreshness,
} from '@/lib/mobile-living-objects';
import { MobileWorkspaceSurface } from '@/components/MobileWorkspaceSurface';
import { MobileLivingObjectsSurface } from '@/components/MobileLivingObjectsSurface';
import type { MobilePresentationAction } from '@/components/MobilePresentationRenderer';
import { MobileRoutedNotice, MobileTurnSurface } from '@/components/MobileTurnSurface';
import type {
  ActiveWorkspaceProjection,
  LivingObjectsProjection,
  PresentationTransition,
} from '@workspace/jasim-runtime-contract';
import {
  safePresentationExternalUrl,
  safePresentationPath,
} from '@workspace/jasim-runtime-contract';
import { hasRuntimeEndpoint, runtimeScheme, runtimeUrl } from '@/lib/runtime-endpoint';

interface ChatMessage {
  id: string;
  role: 'user' | 'jasim';
  text: string;
  createdAt: number;
  runId?: string;
  delivery?: 'sending' | 'queued';
  conversationId?: string;
  /**
   * The surface this turn produced — a TABLE, a CHART, and in time every other
   * trusted primitive. Carried opaquely: the phone never inspects what the
   * data MEANS, only which registered primitive draws it.
   */
  surface?: Record<string, unknown>;
  /** A turn that was understood with nothing built to answer it. */
  routed?: { state?: string; cause?: string };
}

const SUGGESTIONS = [
  'أنشئ منصة لبيع الأثاث المستعمل',
  'خطط لإطلاق خدمة توصيل محلية',
  'نظّم عملية توظيف لفريق تقني',
  'ابنِ سوقًا رقميًا للحرفيين',
];

function safeMobileMessageText(message: ChatMessage): string {
  return message.text;
}

function safeExternalUrl(value: unknown): string | null {
  return safePresentationExternalUrl(value);
}

function safeGeneratedRenderUrl(value: unknown): string | null {
  const path = safePresentationPath(value, '/api/runtime/generated-image/');
  if (!path) return null;
  if (!hasRuntimeEndpoint()) return null;
  // The origin is ours, never the payload's: presentation data may name a path
  // under one fixed prefix and nothing else. So the allowed scheme is the one
  // `runtimeBaseUrl` already decided — https in every production build — rather
  // than a guessed 'https:' that breaks against a local dev runtime, or both
  // schemes, which would be the hole this allow-list exists to close.
  return safePresentationExternalUrl(runtimeUrl(path), [runtimeScheme()]);
}

export default function MainChatScreen() {
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<RuntimeConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<RuntimeConversation | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [runtimeBubbles, setRuntimeBubbles] = useState<RuntimeBubble[]>([]);
  const [workspaceProjection, setWorkspaceProjection] =
    useState<ActiveWorkspaceProjection | null>(null);
  const [previousWorkspaceProjection, setPreviousWorkspaceProjection] =
    useState<ActiveWorkspaceProjection | null>(null);
  const workspaceProjectionRef = useRef<ActiveWorkspaceProjection | null>(null);
  const semanticRequestRef = useRef(0);
  const [livingObjects, setLivingObjects] = useState<LivingObjectsProjection | null>(null);
  const livingObjectsFreshnessRef = useRef<LivingObjectsProjectionFreshness | null>(null);
  const [semanticTransition, setSemanticTransition] =
    useState<PresentationTransition>('NO_CHANGE');
  const workspaceFreshnessRef = useRef<WorkspaceProjectionFreshness | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(false);
  const messages: ChatMessage[] = [
    ...(activeConversation?.messages ?? []).map((message) => ({
      id: message.id,
      role: message.role === 'user' ? 'user' as const : 'jasim' as const,
      text: message.content,
      createdAt: new Date(message.createdAt).getTime(),
      runId: typeof message.metadata?.runId === 'string' ? message.metadata.runId : undefined,
      surface:
        message.metadata?.surface && typeof message.metadata.surface === 'object'
          ? (message.metadata.surface as Record<string, unknown>)
          : undefined,
      routed:
        message.metadata?.routed && typeof message.metadata.routed === 'object'
          ? (message.metadata.routed as { state?: string; cause?: string })
          : undefined,
    })),
    ...localMessages.filter(
      (message) =>
        !message.conversationId || message.conversationId === activeConversation?.id,
    ),
  ].sort((left, right) => left.createdAt - right.createdAt);
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const activeConversationIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id;
  }, [activeConversation?.id]);

  const refreshConversations = useCallback(async (preferredId?: string | null) => {
    const next = await listConversations();
    setConversations(next);
    const selectedId =
      preferredId === null
        ? next[0]?.id
        : preferredId ?? activeConversationIdRef.current ?? next[0]?.id;
    if (!selectedId) {
      setActiveConversation(null);
      return;
    }
    const conversation = await getConversation(selectedId);
    setActiveConversation(conversation);
  }, []);

  const refreshBubbles = useCallback(async () => {
    setRuntimeBubbles(await listBubbles());
  }, []);

  const refreshSemanticRuntime = useCallback(async (conversationId?: string) => {
    const requestToken = semanticRequestRef.current + 1;
    semanticRequestRef.current = requestToken;
    const [workspaceResult, livingObjectsResult] = await Promise.all([
      getWorkspaceProjection(conversationId),
      getLivingObjectsProjection(),
    ]);
    if (requestToken !== semanticRequestRef.current) return;
    const nextWorkspace = parseWorkspaceProjection(workspaceResult);
    const nextLivingObjects = parseLivingObjectsProjection(livingObjectsResult);
    const nextFreshness = workspaceProjectionFreshness(nextWorkspace, conversationId);
    const nextLivingObjectsFreshness = livingObjectsProjectionFreshness(nextLivingObjects);
    if (shouldAcceptWorkspaceProjection(workspaceFreshnessRef.current, nextFreshness)) {
      const previousWorkspace = workspaceProjectionRef.current;
      const classifiedTransition = presentationTransition(previousWorkspace, nextWorkspace);
      const nextTransition = transitionForConversationChange(
        previousWorkspace,
        nextWorkspace,
        classifiedTransition,
      );
      setPreviousWorkspaceProjection(previousWorkspace);
      setSemanticTransition(
        nextTransition,
      );
      workspaceFreshnessRef.current = nextFreshness;
      workspaceProjectionRef.current = nextWorkspace;
      setWorkspaceProjection(nextWorkspace);
    }
    if (shouldAcceptLivingObjectsProjection(
      livingObjectsFreshnessRef.current,
      nextLivingObjectsFreshness,
    )) {
      livingObjectsFreshnessRef.current = nextLivingObjectsFreshness;
      setLivingObjects(nextLivingObjects);
    }
  }, []);

  useEffect(() => {
    const conversationId = activeConversation?.id;
    semanticRequestRef.current += 1;
    workspaceProjectionRef.current = null;
    workspaceFreshnessRef.current = null;
    setPreviousWorkspaceProjection(null);
    setWorkspaceProjection(null);
    setSemanticTransition('NO_CHANGE');
    if (!conversationId) return;
    void refreshSemanticRuntime(conversationId).catch((error) => {
      setSendError(error instanceof Error ? error.message : 'تعذر تحديث مساحة العمل.');
    });
  }, [activeConversation?.id, refreshSemanticRuntime]);

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([
          refreshConversations(),
          refreshBubbles(),
          refreshSemanticRuntime(),
        ]);
        setOnline(true);
      } catch (error) {
        setSendError(error instanceof Error ? error.message : 'تعذر الاتصال بخادم جاسم.');
        setOnline(false);
      } finally {
        setConversationsLoading(false);
      }
    })();
  }, [refreshBubbles, refreshConversations, refreshSemanticRuntime]);

  const send = useCallback(
    async (rawGoal: string) => {
      const goal = rawGoal.trim();
      if (goal.length < 3 || isSending) {
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const localId = `local-${Date.now()}`;
      setLocalMessages((current) => [
        ...current,
        {
          id: localId,
          role: 'user',
          text: goal,
          createdAt: Date.now(),
          delivery: 'sending',
          conversationId: activeConversation?.id,
        },
      ]);
      setInput('');
      setSendError(null);
      setIsSending(true);
      try {
        const conversation =
          activeConversation ?? (await createConversation(goal.slice(0, 80)));
        if (!activeConversation) {
          setActiveConversation(conversation);
          activeConversationIdRef.current = conversation.id;
          setConversations((current) =>
            current.some((item) => item.id === conversation.id)
              ? current
              : [conversation, ...current],
          );
          setLocalMessages((current) =>
            current.map((message) =>
              message.id === localId
                ? { ...message, conversationId: conversation.id }
                : message,
            ),
          );
        }
        const result = await createTurn(conversation.id, goal);
        setLocalMessages((current) => current.filter((message) => message.id !== localId));
        setActiveConversation({
          ...conversation,
          messages: [
            ...(conversation.messages ?? []),
            result.userMessage,
            result.assistantMessage,
          ],
          updatedAt: result.assistantMessage.createdAt,
        });
        setOnline(true);
        try {
          await Promise.all([
            refreshConversations(conversation.id),
            refreshBubbles(),
            refreshSemanticRuntime(conversation.id),
          ]);
        } catch (refreshError) {
          setOnline(false);
          setSendError(
            refreshError instanceof Error
              ? `حُفظت الرسالة، لكن تعذر تحديث الشاشة: ${refreshError.message}`
              : 'حُفظت الرسالة، لكن تعذر تحديث الشاشة.',
          );
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setLocalMessages((current) =>
          current.map((message) =>
            message.id === localId ? { ...message, delivery: 'queued' } : message,
          ),
        );
        setOnline(false);
        setSendError(error instanceof Error ? error.message : 'تعذر معالجة رسالتك.');
      } finally {
        setIsSending(false);
      }
    },
    [
      activeConversation,
      isSending,
      refreshBubbles,
      refreshConversations,
      refreshSemanticRuntime,
    ],
  );

  const transitionBubble = useCallback(
    async (
      bubbleId: string,
      action: RuntimeBubble['availableActions'][number]['id'],
    ) => {
      try {
        const bubble = runtimeBubbles.find((item) => item.bubbleId === bubbleId);
        if (!bubble) {
          throw new Error('حالة سطح جاسم قديمة. حدّث الشاشة ثم حاول مجددًا.');
        }
        const result = await dispatchTrustedAction(
          createMobileTrustedAction({
            actionId: `mobile-bubble:${bubbleId}:${action}:${bubble.presentation.presentationVersion}`,
            actionType: 'UPDATE_BUBBLE_PRESENTATION',
            intent: action,
            source: 'SMART_BUBBLE',
            targetReference: { kind: 'smart_bubble', id: bubbleId },
            presentationReference: { kind: 'bubble', id: bubbleId },
            expectedPresentationVersion: `presentation:${bubble.presentation.presentationVersion}`,
            idempotencyKey: `mobile-bubble:${bubbleId}:${action}`,
            payload: { action },
          }),
        );
        if (
          !['DISPATCH_ACCEPTED', 'OPENED', 'PROJECTION_REFRESH_REQUIRED'].includes(
            result.outcome,
          )
        ) {
          throw new Error(result.message);
        }
        await Promise.all([
          refreshBubbles(),
          refreshSemanticRuntime(activeConversation?.id),
        ]);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        setSendError(
          error instanceof Error ? error.message : 'تعذر تحديث حالة سطح جاسم.',
        );
      }
    },
    [activeConversation?.id, dispatchTrustedAction, refreshBubbles, refreshSemanticRuntime, runtimeBubbles],
  );

  const dispatchPresentationAction = useCallback(
    async (action: MobilePresentationAction) => {
      const projection = workspaceProjectionRef.current ?? workspaceProjection;
      if (!projection?.currentPresentation) {
        throw new Error('لا يوجد سطح موثّق متاح لهذا الإجراء.');
      }
      const activeGoal = projection.activeGoal;
      const actionType =
        action.intent === 'approve'
          ? 'APPROVE_PROPOSAL'
          : action.intent === 'reject'
            ? 'REQUEST_CHANGE'
            : action.intent === 'select'
              ? 'SELECT_ENTITY'
              : action.intent === 'cancel'
                ? 'CANCEL_OPERATION'
                : action.intent === 'retry'
                  ? 'RESUME_OPERATION'
                  : action.intent === 'open' || action.intent === 'open_external'
                    ? 'OPEN_REFERENCE'
                    : action.intent === 'update'
                      ? 'REQUEST_CHANGE'
                      : 'SUBMIT_INPUT';
      const reference =
        activeGoal?.kind === 'runtime_task' || activeGoal?.kind === 'runtime_run'
          ? { kind: activeGoal.kind, id: activeGoal.id }
          : undefined;
      const result = await dispatchTrustedAction(
        createMobileTrustedAction({
          actionId: `mobile-presentation:${projection.workspaceId}:${action.intent}:${projection.presentationVersion}`,
          actionType,
          intent: action.intent,
          source: 'PRESENTATION',
          targetReference: reference,
          conversationReference: projection.conversation
            ? { kind: 'conversation', id: projection.conversation.id }
            : undefined,
          presentationReference: { kind: 'workspace', id: projection.workspaceId },
          expectedPresentationVersion: projection.presentationVersion,
          idempotencyKey: `mobile-presentation:${projection.workspaceId}:${action.intent}:${projection.presentationVersion}`,
          payload: {
            ...(action.payload ?? {}),
            primitive: projection.currentPresentation.primitive,
          },
        }),
      );
      if (
        ![
          'DISPATCH_ACCEPTED',
          'OPENED',
          'PROJECTION_REFRESH_REQUIRED',
          'APPROVAL_REQUIRED',
        ].includes(result.outcome)
      ) {
        throw new Error(result.message);
      }
      await refreshSemanticRuntime(activeConversation?.id);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [
      activeConversation?.id,
      dispatchTrustedAction,
      refreshSemanticRuntime,
      workspaceProjection,
    ],
  );

  const submitPresentation = useCallback(
    (values: Record<string, unknown>) =>
      dispatchPresentationAction({ intent: 'submit', payload: { values } }),
    [dispatchPresentationAction],
  );

  const openLivingObject = useCallback(
    async (object: NonNullable<LivingObjectsProjection>['objects'][number]) => {
      setSendError(null);
      try {
        const result = await dispatchTrustedAction(createMobileLivingObjectOpenAction(object));
        if (
          !['OPENED', 'PROJECTION_REFRESH_REQUIRED', 'DISPATCH_ACCEPTED'].includes(
            result.outcome,
          )
        ) {
          throw new Error(result.message);
        }
        await refreshSemanticRuntime(activeConversation?.id);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (error) {
        setSendError(
          error instanceof Error ? error.message : 'تعذر فتح المرجع الحالي.',
        );
      }
    },
    [activeConversation?.id, refreshSemanticRuntime],
  );

  const archiveActiveConversation = useCallback(() => {
    if (!activeConversation) return;
    void (async () => {
      try {
        await archiveConversation(activeConversation.id);
        activeConversationIdRef.current = undefined;
        setActiveConversation(null);
        await refreshConversations(null);
      } catch (error) {
        setSendError(error instanceof Error ? error.message : 'تعذر أرشفة المحادثة.');
      }
    })();
  }, [activeConversation, refreshConversations]);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? insets.bottom + 34 : insets.bottom;
  const conversationBubbles = runtimeBubbles.filter(
    (bubble) =>
      (activeConversation === null || bubble.conversationId === activeConversation.id),
  );
  return (
    <View style={styles.root}>
      <KeyboardAvoidingView behavior="padding" style={styles.chatLayer}>
        <View style={[styles.titlePill, { top: topPad + 10 }]}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: online ? palette.cyan : palette.red },
            ]}
          />
          <Text style={styles.title}>جاسم</Text>
        </View>
        <View style={[styles.conversationActions, { top: topPad + 12 }]}>
          <Pressable
            style={styles.headerAction}
            onPress={() => {
              activeConversationIdRef.current = undefined;
              setActiveConversation(null);
            }}
            testID="new-conversation"
          >
            <Ionicons name="add" size={18} color={palette.cyan} />
          </Pressable>
          {activeConversation ? (
            <Pressable
              style={styles.headerAction}
              onPress={archiveActiveConversation}
              testID="archive-conversation"
            >
              <Ionicons name="archive-outline" size={16} color={palette.text2} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={[...messages].reverse()}
          keyExtractor={(item) => item.id}
          inverted
          scrollEnabled={messages.length > 0}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.chatContent,
            { paddingTop: 16, paddingBottom: topPad + 72 },
          ]}
          renderItem={({ item }) => (
            <MessageRow message={item} />
          )}
          ListEmptyComponent={
            !conversationsLoading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>مساحتك فارغة</Text>
                <Text style={styles.emptyText}>
                  اكتب طلبك بلغتك الطبيعية. ستُحفظ المحادثة أولًا، ثم يقرر
                  Runtime إن كانت تحتاج مهمة أو Bubble أو ردًا مباشرًا.
                </Text>
              </View>
            ) : null
          }
        />
        <MobileWorkspaceSurface
          projection={workspaceProjection}
          livingObjects={livingObjects}
          transition={semanticTransition}
          exitProjection={previousWorkspaceProjection}
          onAction={dispatchPresentationAction}
          onSubmit={submitPresentation}
          onForeground={() => {
            void refreshSemanticRuntime(activeConversation?.id).catch((error) =>
              setSendError(error instanceof Error ? error.message : 'تعذر تحديث مساحة العمل.'),
            );
          }}
        />
        <MobileLivingObjectsSurface
          projection={livingObjects}
          onOpen={openLivingObject}
        />
        {sendError ? (
          <View style={styles.errorNotice} testID="composer-error">
            <Text style={styles.errorText}>{sendError}</Text>
          </View>
        ) : null}
        {conversations.length > 0 ? (
          <FlatList
            horizontal
            data={conversations}
            keyExtractor={(item) => item.id}
            style={styles.conversationStrip}
            contentContainerStyle={styles.conversationStripContent}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.conversationChip,
                  item.id === activeConversation?.id && styles.conversationChipActive,
                ]}
                onPress={() => {
                  void refreshConversations(item.id).catch((error) =>
                    setSendError(error instanceof Error ? error.message : 'تعذر فتح المحادثة.'),
                  );
                }}
              >
                <Text numberOfLines={1} style={styles.conversationChipText}>
                  {item.title || 'محادثة جديدة'}
                </Text>
              </Pressable>
            )}
          />
        ) : null}

        <MobileBubbleSurface
          bubbles={conversationBubbles}
          onTransition={transitionBubble}
        />

        <View style={styles.suggestions}>
          <FlatList
            horizontal
            inverted
            data={SUGGESTIONS}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable
                style={styles.chip}
                onPress={() => {
                  setInput(item);
                  inputRef.current?.focus();
                }}
                testID={`chip-${item.slice(0, 8)}`}
              >
                <Text style={styles.chipText}>{item}</Text>
              </Pressable>
            )}
          />
        </View>

        <View style={[styles.composerWrap, { paddingBottom: bottomPad + 10 }]}>
          <View style={styles.composer}>
            <Pressable
              style={[
                styles.sendButton,
                (input.trim().length < 3 ||
                  isSending) &&
                  styles.sendButtonDisabled,
              ]}
              disabled={
                input.trim().length < 3 ||
                isSending
              }
              onPress={() => send(input)}
              testID="composer-send"
            >
              <LinearGradient
                colors={[palette.cyan, palette.blue]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendGradient}
              >
                <Ionicons
                  name={
                    isSending
                      ? 'hourglass'
                      : 'arrow-back'
                  }
                  size={18}
                  color="#02131c"
                />
              </LinearGradient>
            </Pressable>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="اكتب هدفك هنا…"
              placeholderTextColor="rgba(148,163,184,0.45)"
              value={input}
              onChangeText={setInput}
              multiline
              textAlign="right"
              returnKeyType="send"
              onSubmitEditing={() => send(input)}
              blurOnSubmit
              testID="composer-input"
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function bubbleStatusCopy(bubble: RuntimeBubble): string {
  switch (bubble.presentation.contentStatus) {
    case 'loading':
      return bubble.presentation.message ?? 'جاري تجهيز هذا السطح.';
    case 'empty':
      return bubble.presentation.message ?? 'لا توجد بيانات لعرضها بعد.';
    case 'error':
      return bubble.presentation.message ?? 'تعذر استرداد بيانات هذا السطح.';
    case 'blocked':
      return bubble.presentation.message ?? 'هذا السطح مقيد في الوقت الحالي.';
    case 'ready':
    default:
      return bubble.semanticDescription || 'سطح جاسم جاهز للتفاعل.';
  }
}

function MobileBubbleSurface({
  bubbles,
  onTransition,
}: {
  bubbles: RuntimeBubble[];
  onTransition: (
    bubbleId: string,
    action: RuntimeBubble['availableActions'][number]['id'],
  ) => void;
}) {
  const expanded = bubbles.filter(
    (bubble) =>
      bubble.status === 'active' &&
      (bubble.presentation.surface === 'expanded' ||
        bubble.presentation.surface === 'full_screen'),
  );
  const compact = bubbles.filter(
    (bubble) => bubble.status === 'active' && bubble.presentation.surface === 'compact',
  );
  const archived = bubbles.filter((bubble) => bubble.status === 'archived');

  if (expanded.length === 0 && compact.length === 0 && archived.length === 0) return null;

  return (
    <View style={styles.bubbleSurfaceWrap} testID="smart-bubble-surface">
      {expanded.map((bubble) => {
        const isBlocked = bubble.presentation.contentStatus === 'blocked';
        const isError = bubble.presentation.contentStatus === 'error';
        const actionButtons = bubble.availableActions.filter(
          (action) =>
            action.enabled &&
            ['minimize', 'full_screen', 'archive', 'restore'].includes(action.id),
        );
        return (
          <View
            key={bubble.bubbleId}
            style={[
              styles.mobileBubbleCard,
              bubble.presentation.surface === 'full_screen' &&
                styles.mobileBubbleFullscreen,
              isBlocked && styles.mobileBubbleBlocked,
              isError && styles.mobileBubbleError,
            ]}
          >
            <View style={styles.mobileBubbleHeader}>
              <View style={styles.mobileBubbleTitleGroup}>
                <View
                  style={[
                    styles.mobileBubbleDot,
                    isError
                      ? styles.mobileBubbleErrorDot
                      : isBlocked
                        ? styles.mobileBubbleBlockedDot
                        : null,
                  ]}
                />
                <Text numberOfLines={1} style={styles.mobileBubbleTitle}>
                  {bubble.title}
                </Text>
              </View>
              <Text style={styles.mobileBubbleVersion}>
                {bubble.presentation.contentStatus}
              </Text>
            </View>
            <Text style={styles.mobileBubbleDescription}>
              {bubbleStatusCopy(bubble)}
            </Text>
            <BubbleArtifactPreviews bubble={bubble} />
            <View style={styles.mobileBubbleActions}>
              {actionButtons.map((action) => (
                <Pressable
                  key={action.id}
                  style={styles.mobileBubbleAction}
                  onPress={() => onTransition(bubble.bubbleId, action.id)}
                  testID={`bubble-${bubble.bubbleId}-${action.id}`}
                >
                  <Text style={styles.mobileBubbleActionText}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
      {compact.length > 0 ? (
        <FlatList
          horizontal
          inverted
          data={compact}
          keyExtractor={(bubble) => bubble.bubbleId}
          style={styles.compactBubbleStrip}
          contentContainerStyle={styles.compactBubbleStripContent}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: bubble }) => {
            const expandAction = bubble.availableActions.find(
              (action) => action.enabled && action.id === 'expand',
            );
            return (
              <Pressable
                style={styles.compactBubbleChip}
                onPress={() => {
                  if (expandAction) {
                    onTransition(bubble.bubbleId, expandAction.id);
                  }
                }}
                testID={`bubble-${bubble.bubbleId}-compact`}
              >
                <View style={styles.mobileBubbleDot} />
                <Text numberOfLines={1} style={styles.compactBubbleText}>
                  {bubble.title}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : null}
      {archived.length > 0 ? (
        <View style={styles.archivedBubbleList}>
          <Text style={styles.archivedBubbleHeading}>الأسطح المؤرشفة</Text>
          {archived.map((bubble) => {
            const restoreAction = bubble.availableActions.find(
              (action) => action.id === 'restore' && action.enabled,
            );
            return (
              <View key={bubble.bubbleId} style={styles.archivedBubbleRow}>
                <Text numberOfLines={1} style={styles.archivedBubbleTitle}>
                  {bubble.title}
                </Text>
                {restoreAction ? (
                  <Pressable
                    style={styles.mobileBubbleAction}
                    onPress={() => onTransition(bubble.bubbleId, restoreAction.id)}
                    testID={`bubble-${bubble.bubbleId}-restore`}
                  >
                    <Text style={styles.mobileBubbleActionText}>
                      {restoreAction.label}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function BubbleArtifactPreviews({ bubble }: { bubble: RuntimeBubble }) {
  const artifacts = bubble.references.flatMap((reference) => {
    if (
      !reference ||
      typeof reference !== 'object' ||
      Array.isArray(reference) ||
      (reference as Record<string, unknown>).kind !== 'runtime_artifact' ||
      typeof (reference as Record<string, unknown>).renderPath !== 'string'
    ) {
      return [];
    }
    const value = reference as Record<string, unknown>;
    const url = safeGeneratedRenderUrl(value.renderPath);
    return url
      ? [{
        id: `${String(value.sourceRunId)}:${String(value.artifactId)}:${String(value.role)}`,
        role: typeof value.role === 'string' ? value.role : 'artifact',
        url,
      }]
      : [];
  });
  if (artifacts.length === 0) return null;
  return (
    <View style={styles.bubbleArtifacts}>
      {artifacts.map((artifact) => (
        <View key={artifact.id} style={styles.bubbleArtifact}>
          <Image
            source={{ uri: artifact.url, headers: runtimeRequestHeaders() }}
            style={styles.bubbleArtifactImage}
          />
          <Text style={styles.bubbleArtifactRole}>{artifact.role}</Text>
        </View>
      ))}
    </View>
  );
}

function MessageRow({
  message,
}: {
  message: ChatMessage;
}) {
  const displayText = safeMobileMessageText(message);
  if (message.role === 'user') {
    return (
      <View style={[styles.messageRow, styles.userRow]}>
        <View style={[styles.bubbleMessage, styles.userBubble]}>
          <Text style={styles.messageText}>{displayText}</Text>
          {message.delivery ? (
            <Text style={styles.deliveryText}>
              {message.delivery === 'sending'
                ? 'جارٍ الإرسال إلى الخادم…'
                : 'محفوظة محليًا — لم يؤكدها الخادم'}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.messageRow, styles.jasimRow]}>
      <View style={[styles.bubbleMessage, styles.jasimBubble]}>
        {/* A routed turn produced no surface: understood, with nothing to
            answer it with. Its words are drawn as a notice rather than as an
            ordinary reply, exactly as on the web, so «لا يوجد مصدر بيانات»
            never reads as a finding. */}
        {message.routed?.state ? (
          <MobileRoutedNotice message={displayText} state={message.routed.state} />
        ) : (
          <Text style={styles.messageText}>{displayText}</Text>
        )}
        {/* The same semantic surface contract the web receives. Mobile adapts
            presentation only — there is no second data system here. */}
        <MobileTurnSurface surface={message.surface} />
        {message.runId ? <RunResultPreview runId={message.runId} /> : null}
      </View>
    </View>
  );
}

function RunResultPreview({ runId }: { runId: string }) {
  const [receipt, setReceipt] = useState<RuntimeRunReceipt | null>(null);
  const [bubbles, setBubbles] = useState<RuntimeBubble[]>([]);
  const [artifactPickerId, setArtifactPickerId] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void getRunReceipt(runId)
      .then((next) => { if (mounted) setReceipt(next); })
      .catch(() => { if (mounted) setReceipt(null); });
    return () => { mounted = false; };
  }, [runId]);
  useEffect(() => {
    let mounted = true;
    void listBubbles()
      .then((next) => { if (mounted) setBubbles(next.filter((bubble) => bubble.status !== 'archived')); })
      .catch(() => { if (mounted) setBubbles([]); });
    return () => { mounted = false; };
  }, [runId]);

  const values = Object.values(receipt?.aggregatedOutput ?? {}).filter(
    (value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object',
  );
  const sources: Array<Record<string, unknown> & { url: string }> = values.flatMap((value) =>
    Array.isArray(value.sources)
      ? value.sources
      : Array.isArray(value.selectedEvidence)
        ? value.selectedEvidence
        : [],
  )
    .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === 'object')
    .flatMap((source) => {
      const url = safeExternalUrl(source.url);
      return url ? [{ ...source, url }] : [];
    })
    .slice(0, 3);
  const images = values.flatMap((value) => Array.isArray(value.images) ? value.images : [])
    .filter((image): image is Record<string, unknown> => Boolean(image) && typeof image === 'object')
    .flatMap((image) => {
      const signedUrl = safeExternalUrl(image.renderUrl);
      const url = signedUrl ?? safeGeneratedRenderUrl(image.renderPath);
      return url
          ? [{
            displayUrl: url,
            artifactId: typeof image.artifactId === 'string' ? image.artifactId : undefined,
            sourceCount: (() => {
              const lineage = image.lineage;
              const research = lineage && typeof lineage === 'object'
                ? (lineage as Record<string, unknown>).research
                : null;
              const selected = research && typeof research === 'object'
                ? (research as Record<string, unknown>).selectedSourceReferences
                : null;
              return Array.isArray(selected) ? selected.length : 0;
            })(),
          }]
        : [];
    })
    .slice(0, 2);
  if (sources.length === 0 && images.length === 0) return null;

  const attachToBubble = async (bubble: RuntimeBubble) => {
    if (!artifactPickerId) return;
    setAttachmentError(null);
    try {
      const result = await dispatchTrustedAction(
        createMobileTrustedAction({
          actionId: `mobile-artifact:${bubble.bubbleId}:${artifactPickerId}:${bubble.presentation.presentationVersion}`,
          actionType: 'ATTACH_ARTIFACT',
          intent: 'attach_artifact',
          source: 'SMART_BUBBLE',
          targetReference: { kind: 'smart_bubble', id: bubble.bubbleId },
          presentationReference: { kind: 'bubble', id: bubble.bubbleId },
          expectedPresentationVersion: `presentation:${bubble.presentation.presentationVersion}`,
          idempotencyKey: `mobile-artifact:${bubble.bubbleId}:${artifactPickerId}`,
          payload: {
            sourceRunId: runId,
            artifactId: artifactPickerId,
            role: 'cover',
          },
        }),
      );
      if (
        !['DISPATCH_ACCEPTED', 'OPENED', 'PROJECTION_REFRESH_REQUIRED'].includes(
          result.outcome,
        )
      ) {
        throw new Error(result.message);
      }
      setArtifactPickerId(null);
      setBubbles(await listBubbles());
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'تعذر ربط الصورة بالـBubble.');
    }
  };

  return (
    <View style={styles.runResult}>
      {sources.map((source) => (
        <Pressable
          key={String(source.url)}
          onPress={() => void Linking.openURL(String(source.url))}
          style={styles.sourceLink}
        >
          <Ionicons name="open-outline" size={12} color={palette.text2} />
          <Text numberOfLines={1} style={styles.sourceLinkText}>
            {typeof source.title === 'string' ? source.title : String(source.url)}
          </Text>
        </Pressable>
      ))}
      {images.length > 0 ? (
        <View style={styles.generatedImages}>
          {images.map((image) => {
            const artifactId = typeof image.artifactId === 'string' ? image.artifactId : null;
            return (
              <View key={String(artifactId ?? image.displayUrl)} style={styles.generatedImageCard}>
                <Pressable onPress={() => void Linking.openURL(String(image.displayUrl))}>
                  <Image source={{ uri: String(image.displayUrl), headers: runtimeRequestHeaders() }} style={styles.generatedImage} />
                </Pressable>
                 {image.sourceCount > 0 ? (
                   <Text style={styles.sourceLinkText}>
                     استندت إلى {image.sourceCount} مصادر كإلهام، وليست شهادة تحقق.
                   </Text>
                 ) : null}
                {artifactId ? (
                  <Pressable
                    style={styles.attachArtifactButton}
                    onPress={() => setArtifactPickerId(artifactId)}
                  >
                    <Text style={styles.attachArtifactButtonText}>استخدم في Bubble</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {artifactPickerId ? (
        <View style={styles.artifactPicker}>
          <Text style={styles.artifactPickerTitle}>اختر Smart Bubble موجودة</Text>
          {bubbles.length > 0 ? bubbles.map((bubble) => (
            <Pressable
              key={bubble.bubbleId}
              style={styles.artifactPickerOption}
              onPress={() => void attachToBubble(bubble)}
            >
              <Text style={styles.artifactPickerOptionText}>{bubble.title}</Text>
            </Pressable>
          )) : (
            <Text style={styles.artifactPickerEmpty}>أنشئ Smart Bubble أولاً ثم أعد المحاولة.</Text>
          )}
          <Pressable onPress={() => setArtifactPickerId(null)}>
            <Text style={styles.artifactPickerCancel}>إلغاء</Text>
          </Pressable>
        </View>
      ) : null}
      {attachmentError ? <Text style={styles.artifactPickerError}>{attachmentError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.black,
  },
  runResult: {
    marginTop: 10,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.10)',
    paddingTop: 8,
  },
  sourceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sourceLinkText: {
    flex: 1,
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 11,
    textAlign: 'right',
  },
  generatedImages: {
    flexDirection: 'row',
    gap: 8,
  },
  generatedImageCard: {
    gap: 5,
  },
  generatedImage: {
    width: 104,
    height: 104,
    borderRadius: 10,
    backgroundColor: palette.space2,
  },
  attachArtifactButton: {
    width: 104,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 229, 216, 0.45)',
    paddingVertical: 5,
    alignItems: 'center',
  },
  attachArtifactButtonText: {
    color: palette.cyan,
    fontFamily: fonts.medium,
    fontSize: 9,
  },
  artifactPicker: {
    marginTop: 4,
    gap: 5,
    borderRadius: 10,
    backgroundColor: palette.space2,
    padding: 8,
  },
  artifactPickerTitle: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 11,
    textAlign: 'right',
  },
  artifactPickerOption: {
    borderRadius: 7,
    backgroundColor: 'rgba(92, 229, 216, 0.10)',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  artifactPickerOptionText: {
    color: palette.text,
    fontFamily: fonts.medium,
    fontSize: 11,
    textAlign: 'right',
  },
  artifactPickerEmpty: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right',
  },
  artifactPickerCancel: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 10,
    textAlign: 'center',
    paddingTop: 3,
  },
  artifactPickerError: {
    color: '#fb7185',
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right',
  },
  bubbleArtifacts: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  bubbleArtifact: {
    overflow: 'hidden',
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 229, 216, 0.25)',
  },
  bubbleArtifactImage: {
    width: 96,
    height: 96,
    backgroundColor: palette.space2,
  },
  bubbleArtifactRole: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 9,
    paddingHorizontal: 6,
    paddingVertical: 4,
    textAlign: 'right',
  },
  chatLayer: {
    flex: 1,
  },
  conversationActions: {
    position: 'absolute',
    right: 16,
    zIndex: 30,
    flexDirection: 'row',
    gap: 8,
  },
  headerAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,19,28,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.24)',
  },
  titlePill: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 20,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  title: {
    fontFamily: fonts.extraBold,
    fontSize: 15,
    letterSpacing: 2,
    color: palette.cyan,
    textShadowColor: 'rgba(0,212,255,0.45)',
    textShadowRadius: 12,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chatContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    gap: 10,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 40,
    transform: [{ scaleY: -1 }],
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: palette.text,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 22,
    color: palette.text2,
    textAlign: 'center',
  },
  messageRow: {
    flexDirection: 'row',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  jasimRow: {
    justifyContent: 'flex-start',
  },
  bubbleMessage: {
    maxWidth: '86%',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: 'rgba(0,180,255,0.14)',
    borderColor: 'rgba(0,212,255,0.25)',
    borderBottomRightRadius: 6,
  },
  jasimBubble: {
    backgroundColor: 'rgba(168,85,247,0.12)',
    borderColor: 'rgba(168,85,247,0.22)',
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 24,
    color: palette.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  deliveryText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: '#fbbf24',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  messageTime: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: palette.text2,
    alignSelf: 'flex-start',
  },
  taskCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.35)',
    backgroundColor: 'rgba(10,14,26,0.65)',
    padding: 12,
    gap: 8,
  },
  taskCardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskStatusChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  taskStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  taskStatusText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  taskCardGoal: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 21,
    color: palette.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  taskCardCta: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: palette.cyan,
    textAlign: 'right',
  },
  suggestions: {
    paddingBottom: 6,
  },
  conversationStrip: {
    maxHeight: 42,
    marginBottom: 4,
  },
  conversationStripContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  bubbleSurfaceWrap: {
    gap: 8,
    marginBottom: 6,
  },
  compactBubbleStrip: {
    maxHeight: 48,
  },
  compactBubbleStripContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  compactBubbleChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    maxWidth: 200,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.32)',
    backgroundColor: 'rgba(0,132,180,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  compactBubbleText: {
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    writingDirection: 'rtl',
  },
  mobileBubbleCard: {
    marginHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.34)',
    backgroundColor: 'rgba(2,19,28,0.88)',
    padding: 14,
    gap: 10,
  },
  mobileBubbleFullscreen: {
    borderColor: 'rgba(20,184,166,0.64)',
    backgroundColor: 'rgba(5,28,34,0.94)',
  },
  mobileBubbleBlocked: {
    borderColor: 'rgba(245,158,11,0.48)',
  },
  mobileBubbleError: {
    borderColor: 'rgba(244,63,94,0.48)',
  },
  mobileBubbleHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  mobileBubbleTitleGroup: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  mobileBubbleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.cyan,
  },
  mobileBubbleErrorDot: {
    backgroundColor: palette.red,
  },
  mobileBubbleBlockedDot: {
    backgroundColor: '#f59e0b',
  },
  mobileBubbleTitle: {
    flex: 1,
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 14,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  mobileBubbleVersion: {
    color: palette.cyan,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  mobileBubbleDescription: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  mobileBubbleActions: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  mobileBubbleAction: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.36)',
    backgroundColor: 'rgba(0,132,180,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  mobileBubbleActionText: {
    color: palette.cyan,
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  archivedBubbleList: {
    marginHorizontal: 14,
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.24)',
    backgroundColor: 'rgba(15,23,42,0.76)',
    padding: 10,
  },
  archivedBubbleHeading: {
    color: palette.text2,
    fontFamily: fonts.semiBold,
    fontSize: 11,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  archivedBubbleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  archivedBubbleTitle: {
    flex: 1,
    color: palette.text,
    fontFamily: fonts.medium,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  conversationChip: {
    maxWidth: 180,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(15,23,42,0.68)',
  },
  conversationChipActive: {
    borderColor: 'rgba(0,212,255,0.52)',
    backgroundColor: 'rgba(0,132,180,0.22)',
  },
  conversationChipText: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 12,
    writingDirection: 'rtl',
  },
  errorNotice: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.42)',
    backgroundColor: 'rgba(127,29,29,0.32)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    color: '#fecaca',
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  intentNotice: {
    marginHorizontal: 20,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.34)',
    backgroundColor: 'rgba(0,85,120,0.28)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  intentHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  intentTitle: {
    color: palette.cyan,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  intentText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  proposalCard: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    borderRadius: 9,
    padding: 9,
    gap: 4,
    backgroundColor: 'rgba(2,19,28,0.34)',
  },
  proposalTitle: {
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  proposalActions: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 3,
  },
  approveButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: palette.cyan,
  },
  approveButtonText: {
    color: '#02131c',
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  rejectButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.6)',
  },
  rejectButtonText: {
    color: '#fecaca',
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  chip: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: palette.text2,
  },
  composerWrap: {
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  composer: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: 10,
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    fontFamily: fonts.regular,
    fontSize: 14.5,
    lineHeight: 22,
    color: palette.text,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    writingDirection: 'rtl',
  },
  sendButton: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
