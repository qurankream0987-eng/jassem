import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LivingObjectProjection,
  LivingObjectsProjection,
} from '../../api/runtime/presentation-fabric';

const queryState = vi.hoisted(() => ({
  current: {
    data: undefined as LivingObjectsProjection | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../../src/providers/trpc', () => ({
  trpc: {
    runtime: {
      activeLivingObjects: {
        useQuery: vi.fn(() => queryState.current),
      },
    },
  },
}));

import { ActiveObjectsRail } from '../../src/components/jasim-core/ActiveObjectsRail';

const reference = (kind: LivingObjectProjection['underlyingReference']['kind'], id: string) => ({
  kind,
  id,
});

function objectFixture(
  overrides: Partial<LivingObjectProjection> = {},
): LivingObjectProjection {
  return {
    id: 'living:runtime_task:task-1',
    underlyingReference: reference('runtime_task', 'task-1'),
    relatedReferences: [reference('runtime_task', 'task-1')],
    semanticType: 'process',
    title: 'Continue a durable process',
    summary: 'The process remains available after the current response.',
    status: 'RUNNING',
    attention: { level: 'NONE', reason: null },
    primaryAction: {
      intent: 'open',
      label: 'Open',
      reference: reference('runtime_task', 'task-1'),
    },
    secondaryActions: [],
    updatedAt: '2026-09-12T04:00:00.000Z',
    createdAt: '2026-09-12T03:00:00.000Z',
    presentationVersion: 'living:2026-09-12T04:00:00.000Z',
    durability: 'ongoing',
    completion: 'not_complete',
    ...overrides,
  };
}

function projection(objects: LivingObjectProjection[]): LivingObjectsProjection {
  return {
    kind: 'living_objects_projection',
    version: 1,
    objects,
    limit: 12,
    generatedAt: '2026-09-12T04:00:01.000Z',
  };
}

function renderRail(): string {
  return renderToStaticMarkup(<ActiveObjectsRail onOpen={vi.fn()} />);
}

describe('Smart UI Task 6B — Active Objects Rail', () => {
  beforeEach(() => {
    queryState.current = {
      data: projection([]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it('keeps the Rail hidden when the authorized projection is empty', () => {
    const html = renderRail();
    expect(html).not.toContain('active-objects-rail');
    expect(html).not.toContain('active-object-');
  });

  it('renders safe loading and error states without replacing conversation UI', () => {
    queryState.current.isLoading = true;
    expect(renderRail()).toContain('active-objects-rail-loading');

    queryState.current = {
      ...queryState.current,
      isLoading: false,
      isError: true,
    };
    const html = renderRail();
    expect(html).toContain('active-objects-rail-error');
    expect(html).toContain('button-active-objects-retry');
    expect(html).not.toContain('SQL');
  });

  it('renders one generic Rail item for one Living Object', () => {
    queryState.current.data = projection([objectFixture()]);
    const html = renderRail();
    expect(html).toContain('active-objects-rail');
    expect(html).toContain('active-object-living:runtime_task:task-1');
    expect(html).toContain('Continue a durable process');
    expect(html).toContain('The process remains available');
    expect(html).toContain('data-underlying-reference="runtime_task:task-1"');
  });

  it('uses server projection order and does not render unbounded history', () => {
    const approval = objectFixture({
      id: 'living:runtime_run:approval',
      title: 'Approval process',
      attention: { level: 'APPROVAL_REQUIRED', reason: 'Approval is required.' },
      underlyingReference: reference('runtime_run', 'approval'),
    });
    const quiet = objectFixture({
      id: 'living:generated_system:quiet',
      title: 'Quiet world',
      semanticType: 'world',
      underlyingReference: reference('generated_system', 'quiet'),
    });
    queryState.current.data = projection([approval, quiet]);
    const html = renderRail();
    expect(html.indexOf('Approval process')).toBeLessThan(html.indexOf('Quiet world'));
    expect((html.match(/data-testid="active-object-/g) ?? []).length).toBe(2);
  });

  it('uses the same generic item for process, World, and Smart Bubble semantics', () => {
    queryState.current.data = projection([
      objectFixture({ title: 'Monitor-like process' }),
      objectFixture({
        id: 'living:generated_system:world-1',
        title: 'Persistent World',
        semanticType: 'world',
        underlyingReference: reference('generated_system', 'world-1'),
      }),
      objectFixture({
        id: 'living:smart_bubble:bubble-1',
        title: 'Persistent Bubble',
        semanticType: 'bubble',
        underlyingReference: reference('smart_bubble', 'bubble-1'),
      }),
    ]);
    const html = renderRail();
    expect((html.match(/data-underlying-reference=/g) ?? []).length).toBe(3);
    expect(html).not.toContain('MonitorRailItem');
    expect(html).not.toContain('OrderRailItem');
    expect(html).not.toContain('WorldRailItem');
  });

  it('emphasizes attention without creating a second approval object', () => {
    queryState.current.data = projection([
      objectFixture({
        attention: { level: 'APPROVAL_REQUIRED', reason: 'Approval is required.' },
        status: 'WAITING_APPROVAL',
      }),
    ]);
    const html = renderRail();
    expect(html).toContain('Approval needed');
    expect(html).toContain('data-status="WAITING_APPROVAL"');
    expect((html.match(/data-testid="active-object-/g) ?? []).length).toBe(1);
  });

  it('renders real progress and omits unknown progress', () => {
    queryState.current.data = projection([
      objectFixture({
        title: 'Known progress',
        progress: { completed: 2, total: 4, ratio: 0.5 },
      }),
      objectFixture({
        id: 'living:runtime_run:unknown',
        title: 'Unknown progress',
        underlyingReference: reference('runtime_run', 'unknown'),
      }),
    ]);
    const html = renderRail();
    expect(html).toContain('2/4');
    expect(html).toContain('aria-label="2 of 4 complete"');
    expect(html).toContain('Unknown progress');
    expect(html.match(/Progress/g)?.length).toBe(1);
  });

  it('renders completed objects as subdued generic lifecycle state', () => {
    queryState.current.data = projection([
      objectFixture({
        title: 'Recently completed',
        status: 'COMPLETED',
        completion: 'completed',
        durability: 'recently_completed',
        attention: { level: 'COMPLETED', reason: 'Completed recently.' },
      }),
    ]);
    const html = renderRail();
    expect(html).toContain('Recently completed');
    expect(html).toContain('Completed');
    expect(html).toContain('COMPLETED');
  });

  it('supports a visual collapse boundary without changing canonical objects', () => {
    queryState.current.data = projection([objectFixture()]);
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/jasim-core/ActiveObjectsRail.tsx'),
      'utf8',
    );
    expect(renderRail()).toContain('button-active-objects-toggle');
    expect(source).toContain('useState(false)');
    expect(source).toContain('setIsCollapsed');
    expect(source).not.toMatch(/set(Status|Progress|Attention|Completion)/u);
  });

  it('keeps keyboard, accessible names, RTL-safe logical spacing, and narrow layout hooks', () => {
    queryState.current.data = projection([objectFixture()]);
    const html = renderRail();
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/jasim-core/ActiveObjectsRail.tsx'),
      'utf8',
    );
    const homeSource = readFileSync(resolve(process.cwd(), 'src/pages/Home.tsx'), 'utf8');
    expect(html).toContain('aria-label="Active objects"');
    expect(html).toContain('<button');
    expect(html).toContain('focus-visible:ring-2');
    expect(source).toContain('ms-auto');
    // UI-1 narrowed this rail from 22vw/16rem. Living Objects are meant to be
    // visually secondary, and at the old width they read as a second panel
    // beside the workspace rather than as a rail beside the conversation.
    // The assertion still pins a narrow desktop layout hook — just a narrower one.
    expect(homeSource).toContain('lg:w-[min(13vw,11rem)]');
    expect(source).not.toMatch(/position:\s*(left|right)/u);
  });

  it('uses the real Task 6A query and keeps the client presentation generic', () => {
    const railSource = readFileSync(
      resolve(process.cwd(), 'src/components/jasim-core/ActiveObjectsRail.tsx'),
      'utf8',
    );
    const homeSource = readFileSync(resolve(process.cwd(), 'src/pages/Home.tsx'), 'utf8');
    expect(railSource).toContain('trpc.runtime.activeLivingObjects.useQuery');
    expect(railSource).toContain('{ limit: 12 }');
    expect(railSource).toContain('object.attention.level');
    expect(railSource).toContain('object.progress');
    expect(homeSource).toContain('<ActiveObjectsRail');
    expect(homeSource).toContain('<JasimChat');
    expect(homeSource).toContain('<ActiveGenerativeWorkspace');
    expect(homeSource).toContain('scrollIntoView');
    expect(homeSource).not.toMatch(/set(Status|Progress|Attention|World|Order|Monitor)/u);
  });

  it('replaces stale projection items on the next server render', () => {
    const first = objectFixture({ title: 'Old object' });
    queryState.current.data = projection([first]);
    expect(renderRail()).toContain('Old object');
    queryState.current.data = projection([
      objectFixture({
        id: 'living:runtime_run:new',
        title: 'Current object',
        underlyingReference: reference('runtime_run', 'new'),
      }),
    ]);
    const current = renderRail();
    expect(current).toContain('Current object');
    expect(current).not.toContain('Old object');
  });

  it('preserves Smart Bubble identity as one projection reference', () => {
    queryState.current.data = projection([
      objectFixture({
        id: 'living:smart_bubble:bubble-1',
        title: 'One Bubble identity',
        semanticType: 'bubble',
        underlyingReference: reference('smart_bubble', 'bubble-1'),
        relatedReferences: [reference('smart_bubble', 'bubble-1')],
      }),
    ]);
    const html = renderRail();
    expect((html.match(/data-testid="active-object-/g) ?? []).length).toBe(1);
    expect(html).toContain('smart_bubble:bubble-1');
  });
});