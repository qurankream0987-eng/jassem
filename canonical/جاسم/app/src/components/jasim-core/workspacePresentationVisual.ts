import { useEffect, useRef, useState } from 'react';
import type { WorkspacePresentationTransition } from './useWorkspacePresentationTransition';

export const WORKSPACE_EXIT_DURATION_MS = 220;

/**
 * Presentation-only DOM policy. These helpers intentionally accept transition
 * metadata only; canonical projection data never enters local visual state.
 */
export function workspaceTransitionClass(
  transition: WorkspacePresentationTransition,
): string {
  return transition === 'NO_CHANGE'
    ? 'workspace-visual-transition'
    : `workspace-visual-transition workspace-visual-${transition.toLowerCase()}`;
}

export function workspaceSurfaceKey(
  transition: WorkspacePresentationTransition,
  presentationIdentity: string | null,
): string {
  // UPDATE keeps one mounted surface so a refetch does not replay the scene.
  // MORPH alone replaces the semantic surface, never stacking two controls.
  return transition === 'MORPH' && presentationIdentity
    ? presentationIdentity
    : 'workspace-current-presentation';
}

export function isWorkspaceTransitionAnimated(
  transition: WorkspacePresentationTransition,
): boolean {
  return transition !== 'NO_CHANGE';
}

export function isWorkspaceExit(
  transition: WorkspacePresentationTransition,
): boolean {
  return transition === 'EXIT';
}

export function useWorkspaceVisualLifecycle({
  conversationId,
  presentationIdentity,
  transition,
}: {
  conversationId?: string;
  presentationIdentity: string | null;
  transition: WorkspacePresentationTransition;
}): { showExitShell: boolean } {
  const [showExitShell, setShowExitShell] = useState(false);
  const transitionTokenRef = useRef(0);

  useEffect(() => {
    const transitionToken = transitionTokenRef.current + 1;
    transitionTokenRef.current = transitionToken;

    if (transition !== 'EXIT') {
      setShowExitShell(false);
      return;
    }

    setShowExitShell(true);
    const timeoutId = setTimeout(() => {
      if (transitionTokenRef.current === transitionToken) {
        setShowExitShell(false);
      }
    }, WORKSPACE_EXIT_DURATION_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [conversationId, presentationIdentity, transition]);

  return { showExitShell };
}