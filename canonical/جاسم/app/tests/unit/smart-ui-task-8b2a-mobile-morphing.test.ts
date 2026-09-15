import { describe, expect, it } from 'vitest';
import type {
  ActiveWorkspaceProjection,
  PresentationDefinition,
} from '@workspace/jasim-runtime-contract';
import {
  classifyPresentationTransition,
  derivePresentationIdentity,
} from '@workspace/jasim-runtime-contract';
import {
  isStaleMobileMorphCallback,
  resolveMobileMorphSurface,
  shouldAnimateMobileTransition,
  transitionForConversationChange,
} from '../../../../../artifacts/jasim-mobile/lib/mobile-morphing';

function presentation(
  primitive: PresentationDefinition['primitive'],
  data: Record<string, unknown> = {},
): PresentationDefinition {
  return { primitive, version: 1, data };
}

function projection(
  currentPresentation: PresentationDefinition | null,
  conversationId = 'conversation-a',
): ActiveWorkspaceProjection {
  return {
    kind: 'active_workspace_projection',
    version: 1,
    workspaceId: `workspace:${conversationId}`,
    conversation: {
      id: conversationId,
      title: 'Conversation',
      status: 'active',
      updatedAt: '2026-09-12T08:00:00.000Z',
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
    status: 'active',
    attention: [],
    availablePresentationActions: [],
    updatedAt: '2026-09-12T08:00:00.000Z',
    presentationVersion: 'presentation:1',
  };
}

describe('Task 8B2A — native Mobile presentation morphing', () => {
  it('animates ENTER, UPDATE, MORPH, and EXIT but not NO_CHANGE', () => {
    for (const transition of ['ENTER', 'UPDATE', 'MORPH', 'EXIT'] as const) {
      expect(shouldAnimateMobileTransition(transition)).toBe(true);
    }
    expect(shouldAnimateMobileTransition('NO_CHANGE')).toBe(false);
  });

  it('mounts the current surface for ENTER', () => {
    const current = projection(presentation('SEARCH_RESULTS'));
    const surface = resolveMobileMorphSurface(current, null, 'ENTER');
    expect(surface?.mode).toBe('current');
    expect(surface?.projection).toBe(current);
  });

  it('keeps UPDATE on one current surface without an outgoing copy', () => {
    const current = projection(presentation('STATUS', { state: 'verifying' }));
    const surface = resolveMobileMorphSurface(current, null, 'UPDATE');
    expect(surface?.mode).toBe('current');
    expect(surface?.identity).toBe(derivePresentationIdentity(current)?.key);
  });

  it('replaces the semantic surface for MORPH', () => {
    const current = projection(presentation('COMPARISON'));
    const surface = resolveMobileMorphSurface(current, null, 'MORPH');
    expect(surface?.projection.currentPresentation?.primitive).toBe('COMPARISON');
    expect(surface?.mode).toBe('current');
  });

  it('keeps one temporary outgoing surface for EXIT', () => {
    const previous = projection(presentation('APPROVAL'));
    const surface = resolveMobileMorphSurface(null, previous, 'EXIT');
    expect(surface?.mode).toBe('exiting');
    expect(surface?.projection).toBe(previous);
  });

  it('removes the surface when EXIT has no snapshot', () => {
    expect(resolveMobileMorphSurface(null, null, 'EXIT')).toBeNull();
  });

  it('does not restart motion for NO_CHANGE', () => {
    const current = projection(presentation('STATUS', { state: 'running' }));
    const surface = resolveMobileMorphSurface(current, null, 'NO_CHANGE');
    expect(surface?.mode).toBe('current');
    expect(shouldAnimateMobileTransition('NO_CHANGE')).toBe(false);
  });

  it('classifies SEARCH_RESULTS to COMPARISON as MORPH', () => {
    const search = projection(presentation('SEARCH_RESULTS'));
    const comparison = projection(presentation('COMPARISON'));
    expect(
      classifyPresentationTransition(
        derivePresentationIdentity(search),
        derivePresentationIdentity(comparison),
      ),
    ).toBe('MORPH');
  });

  it('classifies FORM to APPROVAL as MORPH', () => {
    const form = projection(presentation('FORM'));
    const approval = projection(presentation('APPROVAL'));
    expect(
      classifyPresentationTransition(
        derivePresentationIdentity(form),
        derivePresentationIdentity(approval),
      ),
    ).toBe('MORPH');
  });

  it('classifies APPROVAL to STATUS as MORPH only after the new projection', () => {
    const approval = projection(presentation('APPROVAL'));
    const status = projection(presentation('STATUS', { state: 'verifying' }));
    expect(classifyPresentationTransition(derivePresentationIdentity(approval), null)).toBe('EXIT');
    expect(
      classifyPresentationTransition(
        derivePresentationIdentity(approval),
        derivePresentationIdentity(status),
      ),
    ).toBe('MORPH');
  });

  it('classifies STATUS changes as UPDATE', () => {
    const running = projection(presentation('STATUS', { state: 'running' }));
    const verifying = projection(presentation('STATUS', { state: 'verifying' }));
    expect(
      classifyPresentationTransition(
        derivePresentationIdentity(running),
        derivePresentationIdentity(verifying),
      ),
    ).toBe('UPDATE');
  });

  it('blocks a stale visual callback from reviving an older surface', () => {
    expect(isStaleMobileMorphCallback(8, 7)).toBe(true);
    expect(isStaleMobileMorphCallback(8, 8)).toBe(false);
  });

  it('resets the visual transition on conversation switch', () => {
    const previous = projection(presentation('COMPARISON'), 'conversation-a');
    const current = projection(presentation('COMPARISON'), 'conversation-b');
    expect(transitionForConversationChange(previous, current, 'UPDATE')).toBe('ENTER');
    expect(transitionForConversationChange(previous, null, 'EXIT')).toBe('EXIT');
  });

  it('preserves the classified transition within one conversation', () => {
    const previous = projection(presentation('FORM'));
    const current = projection(presentation('APPROVAL'));
    expect(transitionForConversationChange(previous, current, 'MORPH')).toBe('MORPH');
  });
});