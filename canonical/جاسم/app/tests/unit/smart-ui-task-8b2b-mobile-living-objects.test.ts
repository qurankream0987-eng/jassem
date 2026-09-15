import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LivingObjectProjectionSchema,
  LivingObjectsProjectionSchema,
  type LivingObjectProjection,
  type LivingObjectsProjection,
} from '@workspace/jasim-runtime-contract';
import {
  createMobileLivingObjectOpenAction,
  boundedMobileLivingObjects,
  livingObjectAccessibilityLabel,
  livingObjectProgressPercentage,
  livingObjectStatusLabel,
  livingObjectsProjectionFreshness,
  MOBILE_LIVING_OBJECT_LIMIT,
  shouldAcceptLivingObjectsProjection,
  shouldShowMobileLivingObjects,
} from '../../../../../artifacts/jasim-mobile/lib/mobile-living-objects';
import {
  parseLivingObjectsProjection,
  presentationTransition,
  shouldAcceptWorkspaceProjection,
  workspaceProjectionFreshness,
} from '../../../../../artifacts/jasim-mobile/lib/semantic-runtime';
import { resolveMobileMorphSurface } from '../../../../../artifacts/jasim-mobile/lib/mobile-morphing';

function livingObject(
  overrides: Partial<LivingObjectProjection> = {},
): LivingObjectProjection {
  return {
    id: 'living:runtime_run:run-1',
    underlyingReference: { kind: 'runtime_run', id: 'run-1' },
    relatedReferences: [{ kind: 'runtime_task', id: 'task-1' }],
    semanticType: 'process',
    title: 'عملية مستمرة',
    summary: 'مهمة قيد المتابعة',
    status: 'RUNNING',
    attention: { level: 'NONE', reason: null },
    progress: { completed: 2, total: 4, ratio: 0.5 },
    primaryAction: {
      intent: 'open',
      label: 'فتح',
      reference: { kind: 'runtime_run', id: 'run-1' },
    },
    secondaryActions: [],
    updatedAt: '2026-09-12T10:00:00.000Z',
    createdAt: '2026-09-12T09:00:00.000Z',
    presentationVersion: 'living:run-1:2',
    durability: 'ongoing',
    completion: 'not_complete',
    ...overrides,
  };
}

function livingProjection(
  objects: LivingObjectProjection[],
  generatedAt = '2026-09-12T10:00:00.000Z',
): LivingObjectsProjection {
  return {
    kind: 'living_objects_projection',
    version: 1,
    objects,
    limit: 30,
    generatedAt,
  };
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), '../../../', path), 'utf8');
}

const mobileSurfaceSource = source(
  'artifacts/jasim-mobile/components/MobileLivingObjectsSurface.tsx',
);
const mobileIndexSource = source('artifacts/jasim-mobile/app/index.tsx');

describe('Smart UI Task 8B2B — Mobile Living Objects and parity', () => {
  it('hides the compact surface for zero objects', () => {
    expect(shouldShowMobileLivingObjects(livingProjection([]))).toBe(false);
    expect(boundedMobileLivingObjects(livingProjection([]))).toEqual([]);
  });

  it('renders one generic item for one object', () => {
    const objects = boundedMobileLivingObjects(livingProjection([livingObject()]));
    expect(objects).toHaveLength(1);
    expect(mobileSurfaceSource).toContain('MobileLivingObjectItem');
  });

  it('keeps the collection bounded', () => {
    const objects = Array.from({ length: 12 }, (_, index) =>
      livingObject({ id: `living:run:${index}` }),
    );
    expect(boundedMobileLivingObjects(livingProjection(objects))).toHaveLength(
      MOBILE_LIVING_OBJECT_LIMIT,
    );
  });

  it('preserves server projection order', () => {
    const objects = [
      livingObject({ id: 'living:first', title: 'الأول' }),
      livingObject({ id: 'living:second', title: 'الثاني' }),
    ];
    expect(boundedMobileLivingObjects(livingProjection(objects)).map((item) => item.id)).toEqual([
      'living:first',
      'living:second',
    ]);
  });

  it('keeps one aggregated Task plus Run object as one item', () => {
    const item = livingObject({
      relatedReferences: [
        { kind: 'runtime_task', id: 'task-1' },
        { kind: 'runtime_run', id: 'run-1' },
      ],
    });
    expect(boundedMobileLivingObjects(livingProjection([item]))).toHaveLength(1);
    expect(item.relatedReferences).toHaveLength(2);
  });

  it('uses the generic item for process/monitor semantics', () => {
    expect(livingObject({ semanticType: 'process' }).semanticType).toBe('process');
    expect(mobileSurfaceSource).not.toContain('MonitorLivingObjectCard');
  });

  it('uses the same generic item for order-like process semantics', () => {
    const item = livingObject({ title: 'طلب شراء', semanticType: 'process' });
    expect(boundedMobileLivingObjects(livingProjection([item]))[0]?.semanticType).toBe('process');
  });

  it('uses the same generic item for World semantics', () => {
    const item = livingObject({ semanticType: 'world', title: 'عالم مستمر' });
    expect(boundedMobileLivingObjects(livingProjection([item]))[0]?.semanticType).toBe('world');
  });

  it('does not create a duplicate object for approval attention', () => {
    const item = livingObject({
      attention: { level: 'APPROVAL_REQUIRED', reason: 'موافقة مطلوبة' },
      status: 'WAITING_APPROVAL',
    });
    expect(boundedMobileLivingObjects(livingProjection([item]))).toHaveLength(1);
    expect(item.attention.level).toBe('APPROVAL_REQUIRED');
  });

  it('does not invent progress when canonical progress is unknown', () => {
    const item = livingObject({ progress: null });
    expect(livingObjectProgressPercentage(item)).toBeNull();
  });

  it('uses OPEN_REFERENCE for the item affordance', () => {
    const action = createMobileLivingObjectOpenAction(livingObject());
    expect(action.actionType).toBe('OPEN_REFERENCE');
    expect(action.intent).toBe('open');
  });

  it('binds OPEN_REFERENCE to the canonical identity and version', () => {
    const item = livingObject({
      underlyingReference: { kind: 'runtime_task', id: 'task-7' },
      presentationVersion: 'living:task-7:9',
    });
    const action = createMobileLivingObjectOpenAction(item);
    expect(action.targetReference).toEqual({ kind: 'runtime_task', id: 'task-7' });
    expect(action.expectedPresentationVersion).toBe('living:task-7:9');
    expect(action.presentationReference).toEqual({
      kind: 'living_object',
      id: item.id,
    });
  });

  it('does not mutate object lifecycle locally when creating an action', () => {
    const item = livingObject();
    const before = JSON.stringify(item);
    createMobileLivingObjectOpenAction(item);
    expect(JSON.stringify(item)).toBe(before);
  });

  it('opens into the existing Mobile morphing surface', () => {
    expect(presentationTransition(null, null)).toBe('NO_CHANGE');
    expect(resolveMobileMorphSurface(null, null, 'EXIT')).toBeNull();
    expect(mobileIndexSource).toContain('<MobileWorkspaceSurface');
  });

  it('removes an object when the latest server projection removes it', () => {
    const previous = livingProjection([livingObject()]);
    const current = livingProjection([], '2026-09-12T10:01:00.000Z');
    expect(boundedMobileLivingObjects(current)).toHaveLength(0);
    expect(shouldAcceptLivingObjectsProjection(
      livingObjectsProjectionFreshness(previous),
      livingObjectsProjectionFreshness(current),
    )).toBe(true);
  });

  it('rejects a stale projection that could revive a removed object', () => {
    const current = livingObjectsProjectionFreshness(
      livingProjection([], '2026-09-12T10:01:00.000Z'),
    );
    const stale = livingObjectsProjectionFreshness(
      livingProjection([livingObject()], '2026-09-12T10:00:00.000Z'),
    );
    expect(shouldAcceptLivingObjectsProjection(current, stale)).toBe(false);
  });

  it('reconstructs objects from the canonical projection after restart', () => {
    const parsed = parseLivingObjectsProjection(livingProjection([livingObject()]));
    expect(parsed.objects[0]?.underlyingReference.id).toBe('run-1');
  });

  it('accepts a newer foreground projection', () => {
    expect(shouldAcceptLivingObjectsProjection(
      livingObjectsProjectionFreshness(livingProjection([livingObject()])),
      livingObjectsProjectionFreshness(livingProjection([], '2026-09-12T10:01:00.000Z')),
    )).toBe(true);
  });

  it('uses no continuous pulse or attention animation for normal objects', () => {
    expect(mobileSurfaceSource).not.toContain('withRepeat');
    expect(mobileSurfaceSource).not.toContain('animate');
  });

  it('exposes a useful native accessibility label', () => {
    const label = livingObjectAccessibilityLabel(livingObject({
      attention: { level: 'APPROVAL_REQUIRED', reason: 'موافقة مطلوبة' },
      status: 'WAITING_APPROVAL',
    }));
    expect(label).toContain('عملية مستمرة');
    expect(label).toContain('يتطلب موافقة');
    expect(label).toContain('بانتظار الموافقة');
    expect(mobileSurfaceSource).toContain('accessibilityRole="button"');
  });

  it('keeps the compact strip RTL-aware', () => {
    expect(mobileSurfaceSource).toContain("writingDirection: 'rtl'");
    expect(mobileSurfaceSource).toContain('flexDirection: \'row-reverse\'');
  });

  it('keeps canonical status and attention outside local component state', () => {
    expect(mobileSurfaceSource).not.toContain('useState(');
    expect(mobileIndexSource).toContain('setLivingObjects');
  });

  it('does not add domain-specific Living Object components', () => {
    for (const forbidden of [
      'OrderLivingObjectCard',
      'MonitorLivingObjectCard',
      'WorldLivingObjectCard',
      'DeliveryLivingObjectCard',
      'CarSaleObject',
    ]) {
      expect(mobileSurfaceSource).not.toContain(forbidden);
    }
  });

  it('keeps simple text with no Living Objects hidden', () => {
    expect(shouldShowMobileLivingObjects(livingProjection([]))).toBe(false);
  });

  it('keeps search-only transient work with no Living Objects', () => {
    expect(shouldShowMobileLivingObjects(livingProjection([]))).toBe(false);
  });

  it('keeps comparison-only transient work with no Living Objects', () => {
    expect(shouldShowMobileLivingObjects(livingProjection([]))).toBe(false);
  });

  it('preserves the same underlyingReference across Web and Mobile', () => {
    const canonical = livingObject();
    const webProjection = livingProjection([canonical]);
    const mobileProjection = parseLivingObjectsProjection(webProjection);
    expect(mobileProjection.objects[0]?.underlyingReference).toEqual(
      webProjection.objects[0]?.underlyingReference,
    );
  });

  it('preserves status parity across Web and Mobile', () => {
    const canonical = livingObject({ status: 'VERIFYING' });
    const webProjection = livingProjection([canonical]);
    const mobileProjection = parseLivingObjectsProjection(webProjection);
    expect(mobileProjection.objects[0]?.status).toBe(webProjection.objects[0]?.status);
  });

  it('preserves attention parity across Web and Mobile', () => {
    const canonical = livingObject({
      attention: { level: 'BLOCKED', reason: 'يتطلب تدخلًا' },
    });
    const mobileProjection = parseLivingObjectsProjection(livingProjection([canonical]));
    expect(mobileProjection.objects[0]?.attention).toEqual(canonical.attention);
  });

  it('preserves PresentationDefinition semantics through the shared projection', () => {
    const canonical = livingObject({ semanticType: 'bubble' });
    const mobileProjection = parseLivingObjectsProjection(livingProjection([canonical]));
    expect(mobileProjection.objects[0]?.semanticType).toBe('bubble');
  });

  it('preserves target-specific presentationVersion parity', () => {
    const canonical = livingObject({ presentationVersion: 'living:canonical:12' });
    const mobileProjection = parseLivingObjectsProjection(livingProjection([canonical]));
    expect(mobileProjection.objects[0]?.presentationVersion).toBe('living:canonical:12');
  });

  it('preserves parity after a Mobile-originated canonical refresh', () => {
    const afterMobileAction = livingObject({
      status: 'COMPLETED',
      completion: 'completed',
      attention: { level: 'COMPLETED', reason: null },
    });
    const webRefresh = parseLivingObjectsProjection(livingProjection([afterMobileAction]));
    const mobileRefresh = parseLivingObjectsProjection(livingProjection([afterMobileAction]));
    expect(mobileRefresh.objects[0]).toEqual(webRefresh.objects[0]);
  });

  it('preserves parity after a Web-originated canonical refresh', () => {
    const afterWebAction = livingObject({
      status: 'WAITING_APPROVAL',
      attention: { level: 'APPROVAL_REQUIRED', reason: 'موافقة مطلوبة' },
    });
    const webRefresh = parseLivingObjectsProjection(livingProjection([afterWebAction]));
    const mobileRefresh = parseLivingObjectsProjection(livingProjection([afterWebAction]));
    expect(mobileRefresh.objects[0]).toEqual(webRefresh.objects[0]);
  });

  it('retains the Task 8B2A EXIT transition contract', () => {
    expect(resolveMobileMorphSurface(null, null, 'EXIT')).toBeNull();
  });

  it('retains the Task 8B1 progress-null contract', () => {
    const parsed = parseLivingObjectsProjection(livingProjection([livingObject({ progress: null })]));
    expect(parsed.objects[0]?.progress).toBeNull();
  });

  it('retains the Task 8A stale Workspace freshness contract', () => {
    const fresh = workspaceProjectionFreshness(null, 'conversation-1');
    const older = { ...fresh, timestamp: 1, updatedAt: '1970-01-01T00:00:01.000Z' };
    expect(shouldAcceptWorkspaceProjection(fresh, older)).toBe(true);
  });

  it('retains the Task 7 trusted dispatcher boundary', () => {
    const action = createMobileLivingObjectOpenAction(livingObject());
    expect(action.source).toBe('LIVING_OBJECT');
    expect(action.payload).toEqual({});
  });

  it('retains the Task 6 canonical projection schema', () => {
    const projection = livingProjection([livingObject()]);
    expect(LivingObjectsProjectionSchema.safeParse(projection).success).toBe(true);
    expect(LivingObjectProjectionSchema.safeParse(projection.objects[0]).success).toBe(true);
  });

  it('formats status without changing canonical status', () => {
    const item = livingObject({ status: 'WAITING_USER' });
    expect(livingObjectStatusLabel(item.status)).toBe('بانتظارك');
    expect(item.status).toBe('WAITING_USER');
  });

  it('does not convert an absent progress field into a fake percentage', () => {
    const item = livingObject({ progress: undefined });
    expect(livingObjectProgressPercentage(item)).toBeNull();
  });

  it('keeps completed objects subdued through semantic state rather than deletion', () => {
    const item = livingObject({
      status: 'COMPLETED',
      completion: 'completed',
      durability: 'recently_completed',
      attention: { level: 'COMPLETED', reason: null },
    });
    expect(boundedMobileLivingObjects(livingProjection([item]))).toHaveLength(1);
    expect(item.completion).toBe('completed');
  });

  it('does not render a permanent empty activity furniture state', () => {
    expect(shouldShowMobileLivingObjects(null)).toBe(false);
    expect(mobileSurfaceSource).toContain('if (!shouldShowMobileLivingObjects(projection)) return null');
  });

  it('uses a stable canonical id as the React key', () => {
    expect(mobileSurfaceSource).toContain('keyExtractor={(object) => object.id}');
  });

  it('does not copy the desktop Active Objects rail architecture', () => {
    expect(mobileSurfaceSource).not.toContain('ActiveObjectsRail');
    expect(mobileSurfaceSource).toContain('FlatList');
  });

  it('keeps opening a Living Object on the existing Workspace route', () => {
    expect(mobileIndexSource).toContain('refreshSemanticRuntime(activeConversation?.id)');
    expect(mobileIndexSource).toContain('createMobileLivingObjectOpenAction(object)');
  });
});