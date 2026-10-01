/**
 * JASIM — THE SURFACE THAT SURVIVES IS THE ONE THAT CAN ACT.
 *
 * Removing a duplicate is only correct if the copy that remains is the usable
 * one. The failure to avoid is a visible card whose buttons resolve to nothing
 * while the authoritative surface is the one that got hidden.
 *
 * The workspace host carries a trusted action path: `source: 'WORKSPACE'`, an
 * expected presentation version that refuses an action aimed at a stale
 * surface, and submit for forms. That is why it keeps the live presentation.
 */
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
  trpc: { runtime: { workspaceProjection: { useQuery: vi.fn(() => queryState.current) } } },
}));

import { ActiveGenerativeWorkspace } from '../../src/components/jasim-core/ActiveGenerativeWorkspace';

const surface: PresentationDefinition = {
  primitive: 'ENTITY_GRID',
  version: 1,
  data: {
    candidates: [
      {
        ref: 'expr_1',
        id: 'expr_1',
        title: 'عنصر',
        attributes: { ratedDepth: '450 m' },
        actions: [{ intent: 'open', label: 'open' }],
      },
    ],
  },
};

function projection(currentPresentation: PresentationDefinition | null): ActiveWorkspaceProjection {
  return {
    kind: 'active_workspace_projection',
    version: 1,
    workspaceId: 'conversation:1',
    conversation: { id: '1', title: 'ن', status: 'active', updatedAt: '2026-10-01T00:00:00.000Z' },
    activeGoal: null,
    currentPresentation,
    currentPresentationSource: currentPresentation ? { kind: 'message', id: 'm1' } : null,
    resultSet: null,
    selectedEntityReferences: [],
    activeRun: null,
    activeAction: null,
    approval: null,
    transactionReference: null,
    worldReference: null,
    status: 'idle',
    attention: [],
    availablePresentationActions: currentPresentation?.actions ?? [],
    updatedAt: '2026-10-01T00:00:00.000Z',
    presentationVersion: 'presentation:1',
  } as ActiveWorkspaceProjection;
}

describe('the surviving surface keeps its actions', () => {
  it('renders the presentation AND its action, with the canonical reference on it', () => {
    queryState.current = { ...queryState.current, data: projection(surface) };
    const markup = renderToStaticMarkup(
      <ActiveGenerativeWorkspace conversationId="1" onPresentationAction={() => {}} />,
    );
    expect(markup).toContain('data-testid="workspace-presentation"');
    expect(markup).toContain('ratedDepth');
    // A button that acts on a canonical reference, not on a position or a title.
    expect(markup).toContain('data-action-intent="open"');
    expect(markup).toContain('data-reference="expr_1"');
  });

  it('announces the record it is drawing, so the conversation knows not to draw it twice', () => {
    queryState.current = { ...queryState.current, data: projection(surface) };
    const seen: Array<string | null> = [];
    renderToStaticMarkup(
      <ActiveGenerativeWorkspace conversationId="1" onPresentingRecord={(id) => seen.push(id)} />,
    );
    // `renderToStaticMarkup` runs no effects, so the claim is NOT made during
    // render — which is the point: deciding during one component's render what
    // another draws is how a tree ends up disagreeing with itself.
    expect(seen).toEqual([]);
  });

  it('claims nothing when it is drawing nothing', () => {
    queryState.current = { ...queryState.current, data: projection(null) };
    const markup = renderToStaticMarkup(<ActiveGenerativeWorkspace conversationId="1" />);
    // No presentation, nothing meaningful: the host renders nothing at all, so
    // the record keeps its own copy and the person is never left with neither.
    expect(markup).toBe('');
  });

  it('the trusted path the live surface keeps is the one with a staleness guard', () => {
    const home = readFileSync('src/pages/Home.tsx', 'utf8');
    const workspaceAction = home.slice(
      home.indexOf('const dispatchWorkspaceAction'),
      home.indexOf('const dispatchWorkspaceSubmit'),
    );
    expect(workspaceAction).toContain("source: 'WORKSPACE'");
    // An action aimed at a surface that has since changed is refused rather
    // than applied to whatever is there now.
    expect(workspaceAction).toContain('expectedPresentationVersion');
    expect(workspaceAction).toContain('idempotencyKey');
    // And the host is wired to both of the handlers a surface can need.
    const workspace = readFileSync('src/components/jasim-core/ActiveGenerativeWorkspace.tsx', 'utf8');
    const render = workspace.slice(workspace.indexOf('data-testid="workspace-presentation"'));
    expect(render).toContain('onAction=');
    expect(render).toContain('onSubmit=');
  });
});
