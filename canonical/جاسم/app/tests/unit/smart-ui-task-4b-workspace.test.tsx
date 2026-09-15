import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveWorkspaceProjection, PresentationDefinition } from '../../api/runtime/presentation-fabric';

const queryState = vi.hoisted(() => ({
  current: {
    data: null as ActiveWorkspaceProjection | null,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
}));

vi.mock('../../src/providers/trpc', () => ({
  trpc: {
    runtime: {
      workspaceProjection: {
        useQuery: vi.fn(() => queryState.current),
      },
    },
  },
}));

import {
  ActiveGenerativeWorkspace,
  hasMeaningfulContext,
} from '../../src/components/jasim-core/ActiveGenerativeWorkspace';
import { PresentationRenderer } from '../../src/components/jasim-core/PresentationRenderer';

function presentation(primitive: PresentationDefinition['primitive']): PresentationDefinition {
  return {
    primitive,
    version: 1,
    title: `${primitive} fixture`,
    data: {},
  };
}

function projection(
  currentPresentation: PresentationDefinition | null = null,
): ActiveWorkspaceProjection {
  return {
    kind: 'active_workspace_projection',
    version: 1,
    workspaceId: 'workspace-test',
    conversation: {
      id: 'conversation-test',
      title: 'Test context',
      status: 'active',
      updatedAt: '2026-09-11T18:00:00.000Z',
    },
    activeGoal: null,
    currentPresentation,
    resultSet: null,
    selectedEntityReferences: [],
    activeRun: null,
    activeAction: null,
    approval: null,
    transactionReference: null,
    worldReference: null,
    status: 'idle',
    attention: [],
    availablePresentationActions: [],
    updatedAt: null,
    presentationVersion: 'presentation:1',
  };
}

describe('Smart UI Task 4B — Active Generative Workspace', () => {
  beforeEach(() => {
    queryState.current = {
      data: null,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  });

  it('does not create a large workspace for a safe empty projection', () => {
    const empty = projection();

    expect(hasMeaningfulContext(empty)).toBe(false);
    queryState.current.data = empty;

    const html = renderToStaticMarkup(<ActiveGenerativeWorkspace conversationId="conversation-test" />);

    expect(html).not.toContain('active-generative-workspace');
    expect(html).not.toContain('workspace-loading');
  });

  it('keeps conversation context and stable references visible for meaningful projection', () => {
    const meaningful = projection(presentation('SEARCH_RESULTS'));
    meaningful.resultSet = {
      id: 'result-set-stable',
      version: 3,
      queryText: 'laptop',
      sources: ['trusted-source'],
      candidates: [
        {
          id: 'candidate-stable',
          position: 2,
          title: 'Stable candidate',
          summary: null,
          source: 'trusted-source',
          canonicalRef: 'canonical-candidate',
          externalRef: null,
          attributes: {},
          availability: 'available',
          trust: 'verified',
          actionable: [],
          provenance: {},
          observedAt: null,
        },
      ],
    };
    meaningful.selectedEntityReferences = [
      {
        referenceKey: 'reference-stable',
        targetKind: 'candidate',
        targetId: 'candidate-stable',
        resultSetId: 'result-set-stable',
        position: 2,
      },
    ];
    queryState.current.data = meaningful;

    const html = renderToStaticMarkup(<ActiveGenerativeWorkspace conversationId="conversation-test" />);

    expect(html).toContain('active-generative-workspace');
    expect(html).toContain('workspace-presentation');
    expect(html).toContain('workspace-selected-references');
    expect(html).toContain('Stable candidate');
    expect(html).toContain('Presentation  presentation:1'.replace('  ', ' '));
    expect(html).toContain('candidate-stable');
  });

  it.each(['SEARCH_RESULTS', 'COMPARISON', 'FORM', 'APPROVAL', 'STATUS', 'TIMELINE'] as const)(
    'routes %s through the generic presentation renderer',
    (primitive) => {
      const html = renderToStaticMarkup(
        <PresentationRenderer presentation={presentation(primitive)} />,
      );

      expect(html).toContain(`${primitive} fixture`);
      expect(html).not.toContain('SearchWorkspace');
      expect(html).not.toContain('ComparisonWorkspace');
    },
  );

  it('fails closed for an invalid presentation without leaking runtime details', () => {
    const html = renderToStaticMarkup(
      <PresentationRenderer presentation={{ primitive: 'UNSAFE_RUNTIME_COMPONENT', data: {} }} />,
    );

    expect(html).toContain('presentation was blocked');
    expect(html).not.toContain('UNSAFE_RUNTIME_COMPONENT');
    expect(html).not.toContain('ZodError');
  });

  it('renders safe loading and error states without replacing the conversation', () => {
    queryState.current = {
      ...queryState.current,
      isLoading: true,
    };
    const loading = renderToStaticMarkup(
      <ActiveGenerativeWorkspace conversationId="conversation-test" />,
    );
    expect(loading).toContain('workspace-loading');

    queryState.current = {
      ...queryState.current,
      isLoading: false,
      isError: true,
    };
    const error = renderToStaticMarkup(
      <ActiveGenerativeWorkspace conversationId="conversation-test" />,
    );
    expect(error).toContain('workspace-error');
    expect(error).not.toContain('TRPC');
    expect(error).not.toContain('SQL');
  });

  it('keeps the shell generic and presentation-only', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/jasim-core/ActiveGenerativeWorkspace.tsx'),
      'utf8',
    );

    expect(source).toContain('key={candidate.id}');
    expect(source).toContain('useState(false)');
    expect(source).toContain('PresentationRenderer');
    expect(source).not.toMatch(/SearchWorkspace|ComparisonWorkspace|CheckoutWorkspace|WorldWorkspace/u);
    expect(source).not.toMatch(/set(Goal|Approval|Transaction|Run|ResultSet)/u);
  });
});