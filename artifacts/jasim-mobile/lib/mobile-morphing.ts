import {
  derivePresentationIdentity,
  type ActiveWorkspaceProjection,
  type PresentationTransition,
} from '@workspace/jasim-runtime-contract';

export type MobileMorphSurface = {
  projection: ActiveWorkspaceProjection;
  mode: 'current' | 'exiting';
  identity: string | null;
};

export function resolveMobileMorphSurface(
  projection: ActiveWorkspaceProjection | null,
  exitProjection: ActiveWorkspaceProjection | null,
  transition: PresentationTransition,
): MobileMorphSurface | null {
  const resolved = projection ?? (
    transition === 'EXIT' ? exitProjection : null
  );
  if (!resolved) return null;
  return {
    projection: resolved,
    mode: projection ? 'current' : 'exiting',
    identity: derivePresentationIdentity(resolved)?.key ?? null,
  };
}

export function shouldAnimateMobileTransition(
  transition: PresentationTransition,
): boolean {
  return transition !== 'NO_CHANGE';
}

export function isStaleMobileMorphCallback(
  currentToken: number,
  callbackToken: number,
): boolean {
  return currentToken !== callbackToken;
}

export function transitionForConversationChange(
  previous: ActiveWorkspaceProjection | null,
  current: ActiveWorkspaceProjection | null,
  classified: PresentationTransition,
): PresentationTransition {
  const previousConversationId = previous?.conversation?.id ?? null;
  const currentConversationId = current?.conversation?.id ?? null;
  if (
    previousConversationId !== null &&
    currentConversationId !== null &&
    previousConversationId !== currentConversationId
  ) {
    return current ? 'ENTER' : 'EXIT';
  }
  return classified;
}