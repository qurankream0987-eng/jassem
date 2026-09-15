import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  findNodeHandle,
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type {
  ActiveWorkspaceProjection,
  LivingObjectsProjection,
  PresentationTransition,
} from '@workspace/jasim-runtime-contract';
import {
  MobilePresentationRenderer,
  type MobilePresentationAction,
} from './MobilePresentationRenderer';
import {
  resolveMobilePresentationPolicy,
  type MobilePresentationPolicy,
} from '@/lib/mobile-presentation';
import { KeyboardAwareScrollViewCompat } from './KeyboardAwareScrollViewCompat';
import { fonts, palette } from '@/constants/colors';
import {
  isStaleMobileMorphCallback,
  resolveMobileMorphSurface,
  shouldAnimateMobileTransition,
} from '@/lib/mobile-morphing';

type Props = {
  projection: ActiveWorkspaceProjection | null;
  livingObjects: LivingObjectsProjection | null;
  transition: PresentationTransition;
  exitProjection: ActiveWorkspaceProjection | null;
  onAction: (action: MobilePresentationAction) => void | Promise<void>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onForeground?: () => void;
};

function statusLabel(status: ActiveWorkspaceProjection['status']): string {
  switch (status) {
    case 'awaiting_input':
      return 'بانتظار إدخالك';
    case 'awaiting_approval':
      return 'بانتظار موافقتك';
    case 'running':
      return 'جارٍ التنفيذ';
    case 'blocked':
      return 'متوقف مؤقتًا';
    case 'failed':
      return 'تعذر الإكمال';
    case 'completed':
      return 'اكتمل';
    case 'active':
      return 'نشط';
    default:
      return 'جاهز';
  }
}

function policyLabel(policy: MobilePresentationPolicy): string {
  switch (policy) {
    case 'BOTTOM_SHEET':
      return 'يفتح في لوحة سفلية';
    case 'EXPANDED':
      return 'عرض موسّع';
    case 'FULL_SCREEN_TEMPORARY':
      return 'عرض مؤقت';
    default:
      return 'عرض مباشر';
  }
}

function referenceLabel(projection: ActiveWorkspaceProjection): string {
  if (projection.activeGoal) return `${projection.activeGoal.kind}:${projection.activeGoal.id}`;
  if (projection.activeRun) return `runtime_run:${projection.activeRun.id}`;
  if (projection.worldReference) return `${projection.worldReference.kind}:${projection.worldReference.id}`;
  return projection.workspaceId;
}

export function MobileWorkspaceSurface({
  projection,
  livingObjects,
  transition,
  exitProjection,
  onAction,
  onSubmit,
  onForeground,
}: Props) {
  const [exitDismissed, setExitDismissed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const animationTokenRef = useRef(0);
  const surfaceRef = useRef<View>(null);
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const surface = resolveMobileMorphSurface(
    projection,
    exitDismissed ? null : exitProjection,
    transition,
  );
  const displayProjection = surface?.projection ?? null;
  const presentation = displayProjection?.currentPresentation ?? null;
  const policy = presentation ? resolveMobilePresentationPolicy(presentation) : 'INLINE';
  const [modalOpen, setModalOpen] = useState(false);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  useEffect(() => {
    setExitDismissed(false);
  }, [
    exitProjection?.presentationVersion,
    projection?.presentationVersion,
    projection?.workspaceId,
    transition,
  ]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setModalOpen(false);
  }, [displayProjection?.presentationVersion, presentation?.primitive]);

  const finishAnimation = useCallback(
    (token: number, exiting: boolean) => {
      if (isStaleMobileMorphCallback(animationTokenRef.current, token)) return;
      setTransitioning(false);
      if (exiting) setExitDismissed(true);
    },
    [],
  );

  useEffect(() => {
    const token = animationTokenRef.current + 1;
    animationTokenRef.current = token;
    cancelAnimation(opacity);
    cancelAnimation(translateY);
    cancelAnimation(scale);

    if (!surface) {
      setTransitioning(false);
      return;
    }

    if (!shouldAnimateMobileTransition(transition)) {
      opacity.value = 1;
      translateY.value = 0;
      scale.value = 1;
      setTransitioning(false);
      return;
    }

    const exiting = surface.mode === 'exiting';
    const duration = reduceMotion ? 0 : exiting ? 170 : transition === 'UPDATE' ? 150 : 210;
    setTransitioning(true);

    if (exiting) {
      opacity.value = withTiming(
        0,
        { duration, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishAnimation)(token, true);
        },
      );
      return () => {
        animationTokenRef.current += 1;
        cancelAnimation(opacity);
      };
    }

    opacity.value = reduceMotion ? 1 : transition === 'UPDATE' ? 0.72 : 0;
    translateY.value = reduceMotion ? 0 : transition === 'UPDATE' ? 3 : 12;
    scale.value = reduceMotion ? 1 : transition === 'UPDATE' ? 0.995 : 0.985;
    opacity.value = withTiming(
      1,
      { duration, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishAnimation)(token, false);
      },
    );
    translateY.value = withTiming(0, { duration, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration, easing: Easing.out(Easing.cubic) });

    return () => {
      animationTokenRef.current += 1;
      cancelAnimation(opacity);
      cancelAnimation(translateY);
      cancelAnimation(scale);
    };
  }, [
    displayProjection?.presentationVersion,
    presentation?.primitive,
    reduceMotion,
    surface?.identity,
    surface?.mode,
    transition,
    finishAnimation,
  ]);

  useEffect(() => {
    if (!surface || (transition !== 'ENTER' && transition !== 'MORPH')) return;
    const token = animationTokenRef.current;
    const timeout = setTimeout(() => {
      if (isStaleMobileMorphCallback(animationTokenRef.current, token)) return;
      const node = findNodeHandle(surfaceRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, reduceMotion ? 0 : 220);
    return () => clearTimeout(timeout);
  }, [reduceMotion, surface?.identity, transition]);

  const handleForeground = useCallback(() => {
    animationTokenRef.current += 1;
    cancelAnimation(opacity);
    cancelAnimation(translateY);
    cancelAnimation(scale);
    opacity.value = 1;
    translateY.value = 0;
    scale.value = 1;
    setTransitioning(false);
    if (transition === 'EXIT') setExitDismissed(true);
    onForeground?.();
  }, [onForeground, opacity, scale, translateY, transition]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') handleForeground();
    });
    return () => subscription.remove();
  }, [handleForeground]);

  if (!displayProjection) return null;

  const attention = displayProjection.attention.slice(0, 3);
  const presentationContent = (
    <MobilePresentationRenderer
      presentation={presentation}
      onAction={onAction}
      onSubmit={onSubmit}
    />
  );

  return (
    <Animated.View
      ref={surfaceRef}
      accessible={transition === 'ENTER' || transition === 'MORPH'}
      accessibilityLabel={presentation?.title ?? 'مساحة العمل'}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: transitioning }}
      style={[styles.shell, animatedStyle]}
      testID="mobile-workspace-shell"
    >
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          <View style={[styles.statusDot, displayProjection.status === 'failed' && styles.errorDot]} />
          <View style={styles.shellTitleCopy}>
            <Text style={styles.shellTitle}>مساحة العمل</Text>
            <Text style={styles.shellSubtitle} numberOfLines={1}>
              {displayProjection.conversation?.title ?? 'المحادثة الحالية'}
            </Text>
          </View>
        </View>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{statusLabel(displayProjection.status)}</Text>
        </View>
      </View>

      {attention.length > 0 ? (
        <View style={styles.attentionList} testID="mobile-workspace-attention">
          {attention.map((item) => (
            <View key={`${item.sourceId}-${item.kind}`} style={[styles.attention, item.severity === 'error' && styles.attentionError]}>
              <Text style={styles.attentionText}>{item.reason}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.referenceRow}>
        <Text style={styles.referenceValue} numberOfLines={1}>{referenceLabel(displayProjection)}</Text>
        <Text style={styles.referenceLabel}>مرجع ثابت</Text>
      </View>
      {livingObjects && livingObjects.objects.length > 0 ? (
        <Text style={styles.objectsText}>
          {livingObjects.objects.length} مرجع مستمر متاح في هذا السياق
        </Text>
      ) : null}

      {presentation ? (
        policy === 'INLINE' || policy === 'EXPANDED' ? (
          <View testID={`mobile-policy-${policy.toLowerCase()}`}>
            <View style={styles.policyRow}>
              <Text style={styles.policyText}>{policyLabel(policy)}</Text>
                <Text style={styles.policyVersion}>{displayProjection.presentationVersion}</Text>
            </View>
            {presentationContent}
          </View>
        ) : (
          <View style={styles.preview} testID={`mobile-policy-${policy.toLowerCase()}`}>
            <View style={styles.policyRow}>
              <Text style={styles.policyText}>{policyLabel(policy)}</Text>
              <Text style={styles.policyVersion}>{presentation.title ?? presentation.primitive}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="فتح سطح مساحة العمل"
              onPress={() => setModalOpen(true)}
              style={styles.openButton}
              testID="mobile-workspace-open-presentation"
            >
              <Text style={styles.openButtonText}>فتح السطح</Text>
            </Pressable>
            <Modal
              animationType="slide"
              transparent
              visible={modalOpen}
              onRequestClose={() => setModalOpen(false)}
            >
              <View style={[styles.modalBackdrop, policy === 'FULL_SCREEN_TEMPORARY' && styles.modalBackdropFull]}>
                <View style={[styles.modalCard, policy === 'FULL_SCREEN_TEMPORARY' && styles.modalCardFull]}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{presentation.title ?? 'سطح مساحة العمل'}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="إغلاق"
                      onPress={() => setModalOpen(false)}
                      style={styles.closeButton}
                    >
                      <Text style={styles.closeButtonText}>إغلاق</Text>
                    </Pressable>
                  </View>
                  <KeyboardAwareScrollViewCompat
                    contentContainerStyle={styles.modalScrollContent}
                    keyboardDismissMode="interactive"
                    showsVerticalScrollIndicator={false}
                  >
                    {presentationContent}
                  </KeyboardAwareScrollViewCompat>
                </View>
              </View>
            </Modal>
          </View>
        )
      ) : (
        <View style={styles.noPresentation}>
          <Text style={styles.noPresentationTitle}>المحادثة هي السطح الأساسي</Text>
          <Text style={styles.noPresentationText}>ستظهر هنا النتيجة المنظمة عندما يثبتها Runtime.</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = {
  shell: {
    marginHorizontal: 14,
    marginBottom: 8,
    gap: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.32)',
    backgroundColor: 'rgba(10,14,26,0.82)',
    padding: 12,
  },
  shellHeader: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  shellTitleGroup: {
    flex: 1,
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  shellTitleCopy: {
    flex: 1,
    gap: 2,
  },
  shellTitle: {
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 14,
    textAlign: 'right' as const,
  },
  shellSubtitle: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right' as const,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.cyan,
  },
  errorDot: {
    backgroundColor: palette.red,
  },
  statusChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(92,229,216,0.32)',
    backgroundColor: 'rgba(92,229,216,0.09)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusChipText: {
    color: palette.cyan,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  attentionList: {
    gap: 5,
  },
  attention: {
    borderRadius: 9,
    backgroundColor: 'rgba(245,158,11,0.1)',
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  attentionError: {
    backgroundColor: 'rgba(244,63,94,0.12)',
  },
  attentionText: {
    color: '#fde68a',
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
  referenceRow: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  referenceLabel: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  referenceValue: {
    flex: 1,
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 10,
    textAlign: 'right' as const,
  },
  objectsText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 10,
    textAlign: 'right' as const,
  },
  policyRow: {
    flexDirection: 'row-reverse' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6,
  },
  policyText: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  policyVersion: {
    flex: 1,
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 9,
    textAlign: 'right' as const,
  },
  preview: {
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(92,229,216,0.18)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 10,
  },
  openButton: {
    alignItems: 'center' as const,
    borderRadius: 10,
    backgroundColor: palette.cyan,
    paddingVertical: 9,
  },
  openButtonText: {
    color: '#02131c',
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  modalBackdropFull: {
    justifyContent: 'center' as const,
    padding: 10,
  },
  modalCard: {
    maxHeight: '92%' as const,
    gap: 10,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: palette.black,
    padding: 14,
  },
  modalCardFull: {
    maxHeight: '100%' as const,
    minHeight: '82%' as const,
    borderRadius: 22,
  },
  modalScrollContent: {
    gap: 10,
    paddingBottom: 18,
  },
  modalHeader: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
  },
  modalTitle: {
    flex: 1,
    color: palette.text,
    fontFamily: fonts.bold,
    fontSize: 15,
    textAlign: 'right' as const,
  },
  closeButton: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.25)',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  closeButtonText: {
    color: palette.text2,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  noPresentation: {
    gap: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 10,
  },
  noPresentationTitle: {
    color: palette.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    textAlign: 'right' as const,
  },
  noPresentationText: {
    color: palette.text2,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right' as const,
    writingDirection: 'rtl' as const,
  },
};