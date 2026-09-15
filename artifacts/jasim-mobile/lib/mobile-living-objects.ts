import type {
  LivingObjectProjection,
  LivingObjectsProjection,
  TrustedActionEnvelope,
} from '@workspace/jasim-runtime-contract';
import { createMobileTrustedAction } from './semantic-runtime';

export const MOBILE_LIVING_OBJECT_LIMIT = 8;

export type LivingObjectsProjectionFreshness = {
  generatedAt: string | null;
  timestamp: number | null;
};

export function boundedMobileLivingObjects(
  projection: LivingObjectsProjection | null,
): LivingObjectProjection[] {
  return projection?.objects.slice(0, MOBILE_LIVING_OBJECT_LIMIT) ?? [];
}

export function shouldShowMobileLivingObjects(
  projection: LivingObjectsProjection | null,
): boolean {
  return boundedMobileLivingObjects(projection).length > 0;
}

export function livingObjectsProjectionFreshness(
  projection: LivingObjectsProjection | null,
): LivingObjectsProjectionFreshness {
  const generatedAt = projection?.generatedAt ?? null;
  const timestamp = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  return {
    generatedAt,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
  };
}

export function shouldAcceptLivingObjectsProjection(
  previous: LivingObjectsProjectionFreshness | null,
  incoming: LivingObjectsProjectionFreshness,
): boolean {
  if (!previous) return true;
  if (previous.timestamp === null || incoming.timestamp === null) return true;
  return incoming.timestamp >= previous.timestamp;
}

export function createMobileLivingObjectOpenAction(
  object: LivingObjectProjection,
): TrustedActionEnvelope {
  return createMobileTrustedAction({
    actionId: `mobile-living-open:${object.id}:${object.presentationVersion}`,
    actionType: 'OPEN_REFERENCE',
    intent: 'open',
    source: 'LIVING_OBJECT',
    targetReference: object.underlyingReference,
    presentationReference: { kind: 'living_object', id: object.id },
    expectedPresentationVersion: object.presentationVersion,
    idempotencyKey: `mobile-living-open:${object.id}`,
    payload: {},
  });
}

export function livingObjectStatusLabel(status: LivingObjectProjection['status']): string {
  const labels: Record<LivingObjectProjection['status'], string> = {
    ACTIVE: 'نشط',
    WAITING: 'قيد الانتظار',
    RUNNING: 'جارٍ التنفيذ',
    MONITORING: 'تحت المراقبة',
    WAITING_USER: 'بانتظارك',
    WAITING_APPROVAL: 'بانتظار الموافقة',
    VERIFYING: 'جارٍ التحقق',
    BLOCKED: 'متوقف',
    FAILED: 'يحتاج مراجعة',
    COMPLETED: 'اكتمل',
  };
  return labels[status];
}

export function livingObjectAttentionLabel(
  level: LivingObjectProjection['attention']['level'],
): string {
  const labels: Record<LivingObjectProjection['attention']['level'], string> = {
    NONE: 'هادئ',
    INFO: 'معلومة',
    ACTION_REQUIRED: 'يتطلب إجراء',
    APPROVAL_REQUIRED: 'يتطلب موافقة',
    BLOCKED: 'متوقف',
    FAILED: 'يحتاج مراجعة',
    COMPLETED: 'اكتمل',
  };
  return labels[level];
}

export function livingObjectProgressPercentage(
  object: LivingObjectProjection,
): number | null {
  if (!object.progress || object.progress.total <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, object.progress.ratio)) * 100);
}

export function livingObjectAccessibilityLabel(
  object: LivingObjectProjection,
): string {
  return [
    `فتح ${object.title}`,
    livingObjectAttentionLabel(object.attention.level),
    livingObjectStatusLabel(object.status),
  ].join(' — ');
}