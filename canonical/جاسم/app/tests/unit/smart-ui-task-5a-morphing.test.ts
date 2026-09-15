import { describe, expect, it } from 'vitest';
import type {
  ActiveWorkspaceProjection,
  PresentationDefinition,
} from '../../api/runtime/presentation-fabric';
import {
  classifyWorkspacePresentationTransition,
  deriveWorkspaceProjectionFreshness,
  deriveWorkspacePresentationIdentity,
  shouldAcceptWorkspaceProjection,
  type WorkspacePresentationMetadata,
} from '../../src/components/jasim-core/useWorkspacePresentationTransition';

function presentation(
  primitive: PresentationDefinition['primitive'],
  data: Record<string, unknown> = {},
): PresentationDefinition {
  return { primitive, version: 1, data };
}

function projection(
  currentPresentation: PresentationDefinition | null,
  options: {
    conversationId?: string;
    updatedAt?: string | null;
  } = {},
): ActiveWorkspaceProjection {
  return {
    kind: 'active_workspace_projection',
    version: 1,
    workspaceId: 'workspace-transition-test',
    conversation: {
      id: options.conversationId ?? 'conversation-transition-test',
      title: null,
      status: 'active',
      updatedAt: options.updatedAt ?? '2026-09-11T18:00:00.000Z',
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

function metadata(
  projectionValue: ActiveWorkspaceProjection,
): WorkspacePresentationMetadata {
  const identity = deriveWorkspacePresentationIdentity(projectionValue);
  return {
    previousKey: identity?.key ?? null,
    previousPrimitive: identity?.primitive ?? null,
    previousTransition: 'ENTER',
  };
}

describe('Task 5A workspace presentation morphing', () => {
  it('classifies ENTER, UPDATE, MORPH, EXIT, and NO_CHANGE', () => {
    const form = projection(presentation('FORM', { field: 'email' }));
    const changedForm = projection(presentation('FORM', { field: 'name' }));
    const approval = projection(presentation('APPROVAL', { action: 'publish' }));

    expect(classifyWorkspacePresentationTransition(null, deriveWorkspacePresentationIdentity(form))).toBe(
      'ENTER',
    );
    expect(
      classifyWorkspacePresentationTransition(metadata(form), deriveWorkspacePresentationIdentity(changedForm)),
    ).toBe('UPDATE');
    expect(
      classifyWorkspacePresentationTransition(metadata(form), deriveWorkspacePresentationIdentity(approval)),
    ).toBe('MORPH');
    expect(classifyWorkspacePresentationTransition(metadata(form), null)).toBe('EXIT');
    expect(classifyWorkspacePresentationTransition(metadata(form), deriveWorkspacePresentationIdentity(form))).toBe(
      'NO_CHANGE',
    );
  });

  it('classifies SEARCH_RESULTS to COMPARISON and APPROVAL to STATUS generically', () => {
    const search = projection(presentation('SEARCH_RESULTS', { query: 'laptops' }));
    const comparison = projection(presentation('COMPARISON', { candidateIds: ['e2', 'e4'] }));
    const approval = projection(presentation('APPROVAL', { action: 'publish' }));
    const status = projection(presentation('STATUS', { state: 'running' }));

    expect(
      classifyWorkspacePresentationTransition(
        metadata(search),
        deriveWorkspacePresentationIdentity(comparison),
      ),
    ).toBe('MORPH');
    expect(
      classifyWorkspacePresentationTransition(
        metadata(approval),
        deriveWorkspacePresentationIdentity(status),
      ),
    ).toBe('MORPH');
  });

  it('includes goal, ResultSet, references, selection, approval, run, action, transaction, and World context', () => {
    const base = projection(presentation('STATUS', { state: 'ready' }));
    const identity = deriveWorkspacePresentationIdentity(base);
    const contexts: Array<(value: ActiveWorkspaceProjection) => void> = [
      (value) => {
        value.activeGoal = { kind: 'runtime_task', id: 'goal-1', text: 'Goal', status: 'active' };
      },
      (value) => {
        value.resultSet = {
          id: 'result-1',
          version: 2,
          queryText: 'query',
          sources: [],
          candidates: [],
        };
      },
      (value) => {
        value.selectedEntityReferences = [
          {
            referenceKey: 'reference-1',
            targetKind: 'entity',
            targetId: 'entity-1',
            resultSetId: null,
            position: null,
          },
        ];
      },
      (value) => {
        value.approval = { id: 'approval-1', proposalId: 'proposal-1', status: 'pending', expiresAt: null };
      },
      (value) => {
        value.activeRun = {
          id: 'run-1',
          goal: 'Run',
          status: 'running',
          taskId: null,
          bubbleId: null,
          updatedAt: '2026-09-11T18:00:00.000Z',
        };
      },
      (value) => {
        value.activeAction = {
          id: 'action-1',
          intentType: 'submit',
          status: 'ready',
          runId: null,
          targetReferences: [],
          approvalRequired: false,
        };
      },
      (value) => {
        value.transactionReference = { kind: 'transaction', id: 'transaction-1' };
      },
      (value) => {
        value.worldReference = {
          kind: 'runtime_world',
          id: 'world-1',
          worldKey: 'world',
          version: 1,
          status: 'ready',
        };
      },
    ];

    for (const change of contexts) {
      const next = projection(presentation('STATUS', { state: 'ready' }));
      change(next);
      expect(deriveWorkspacePresentationIdentity(next)?.key).not.toBe(identity?.key);
    }
  });

  it('keeps refetches stable and preserves identity after reload', () => {
    const firstLoad = projection(presentation('COMPARISON', { candidateIds: ['e2', 'e4'] }));
    const secondLoad = projection(presentation('COMPARISON', { candidateIds: ['e2', 'e4'] }));

    expect(deriveWorkspacePresentationIdentity(secondLoad)?.key).toBe(
      deriveWorkspacePresentationIdentity(firstLoad)?.key,
    );
    expect(
      classifyWorkspacePresentationTransition(
        metadata(firstLoad),
        deriveWorkspacePresentationIdentity(secondLoad),
      ),
    ).toBe('NO_CHANGE');
  });

  it('resets identity across conversation changes without leaking the prior Workspace', () => {
    const firstConversation = projection(presentation('COMPARISON', { candidateIds: ['e2', 'e4'] }));
    const otherConversation = projection(
      presentation('COMPARISON', { candidateIds: ['e2', 'e4'] }),
      { conversationId: 'conversation-other' },
    );

    expect(deriveWorkspacePresentationIdentity(otherConversation)?.key).not.toBe(
      deriveWorkspacePresentationIdentity(firstConversation)?.key,
    );
    expect(
      classifyWorkspacePresentationTransition(
        null,
        deriveWorkspacePresentationIdentity(otherConversation),
      ),
    ).toBe('ENTER');
  });

  it('rejects an older projection while accepting a newer projection or conversation switch', () => {
    const older = projection(presentation('SEARCH_RESULTS', { query: 'laptops' }), {
      updatedAt: '2026-09-11T18:01:00.000Z',
    });
    const newer = projection(presentation('COMPARISON', { candidateIds: ['e2', 'e4'] }), {
      updatedAt: '2026-09-11T18:02:00.000Z',
    });
    const otherConversation = projection(presentation('FORM', { field: 'date' }), {
      conversationId: 'conversation-other',
      updatedAt: '2026-09-11T18:00:00.000Z',
    });
    const newerFreshness = deriveWorkspaceProjectionFreshness(newer);

    expect(shouldAcceptWorkspaceProjection(null, newerFreshness)).toBe(true);
    expect(
      shouldAcceptWorkspaceProjection(newerFreshness, deriveWorkspaceProjectionFreshness(older)),
    ).toBe(false);
    expect(
      shouldAcceptWorkspaceProjection(newerFreshness, deriveWorkspaceProjectionFreshness(newer)),
    ).toBe(true);
    expect(
      shouldAcceptWorkspaceProjection(
        newerFreshness,
        deriveWorkspaceProjectionFreshness(otherConversation),
      ),
    ).toBe(true);
  });
});