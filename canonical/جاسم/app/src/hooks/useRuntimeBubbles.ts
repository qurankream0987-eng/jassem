import { useCallback } from 'react';
import type {
  SmartBubbleAction,
  SmartBubbleArtifactRole,
  SmartBubbleRuntimeRecord,
} from '@workspace/jasim-bubble-contract';
import { trpc } from '@/providers/trpc';
import { useTrustedActionDispatcher } from './useTrustedActionDispatcher';
import {
  createTrustedActionEnvelope,
  trustedActionFailure,
} from '@/lib/trusted-action-dispatcher';

export interface UseRuntimeBubblesReturn {
  bubbles: SmartBubbleRuntimeRecord[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  transition: (
    bubbleId: string,
    action: SmartBubbleAction['id'],
  ) => Promise<SmartBubbleRuntimeRecord>;
  attachArtifact: (input: {
    bubbleId: string;
    sourceRunId: string;
    artifactId: string;
    role: SmartBubbleArtifactRole;
    targetPath?: string;
  }) => Promise<SmartBubbleRuntimeRecord>;
}

export function useRuntimeBubbles(): UseRuntimeBubblesReturn {
  const utils = trpc.useUtils();
  const { dispatch } = useTrustedActionDispatcher();
  const listQuery = trpc.runtime.bubblesList.useQuery(undefined, {
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const refresh = useCallback(async () => {
    await utils.runtime.bubblesList.invalidate();
  }, [utils]);

  const transition = useCallback(
    async (
      bubbleId: string,
      action: SmartBubbleAction['id'],
    ): Promise<SmartBubbleRuntimeRecord> => {
      const currentBubble = (listQuery.data?.bubbles ?? []).find(
        (bubble) => bubble.bubbleId === bubbleId,
      );
      if (!currentBubble) {
        await utils.runtime.bubblesList.invalidate();
        throw new Error('Smart Bubble state is stale. Refresh and try again.');
      }
      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `bubble-presentation:${bubbleId}:${action}:${currentBubble.presentation.presentationVersion}`,
          actionType: 'UPDATE_BUBBLE_PRESENTATION',
          intent: action,
          source: 'SMART_BUBBLE',
          targetReference: { kind: 'smart_bubble', id: bubbleId },
          presentationReference: { kind: 'bubble', id: bubbleId },
          expectedPresentationVersion: `presentation:${String(
            currentBubble.presentation.presentationVersion,
          )}`,
          payload: { action },
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) throw failure;
      const bubble = await utils.runtime.bubblesGet.fetch({ bubbleId });
      await Promise.all([
        utils.runtime.bubblesList.invalidate(),
        utils.runtime.bubblesGet.invalidate({ bubbleId }),
        utils.runtime.bubblesProjection.invalidate({ bubbleId }),
      ]);
      return bubble;
    },
    [dispatch, listQuery.data?.bubbles, utils],
  );

  const attachArtifact = useCallback(
    async (input: {
      bubbleId: string;
      sourceRunId: string;
      artifactId: string;
      role: SmartBubbleArtifactRole;
      targetPath?: string;
    }): Promise<SmartBubbleRuntimeRecord> => {
      const currentBubble = (listQuery.data?.bubbles ?? []).find(
        (bubble) => bubble.bubbleId === input.bubbleId,
      );
      if (!currentBubble) {
        await utils.runtime.bubblesList.invalidate();
        throw new Error('Smart Bubble state is stale. Refresh and try again.');
      }
      const dispatchResult = await dispatch(
        createTrustedActionEnvelope({
          actionId: `bubble-artifact:${input.bubbleId}:${input.artifactId}`,
          actionType: 'ATTACH_ARTIFACT',
          intent: 'attach_artifact',
          source: 'SMART_BUBBLE',
          targetReference: { kind: 'smart_bubble', id: input.bubbleId },
          presentationReference: { kind: 'bubble', id: input.bubbleId },
          expectedPresentationVersion: `presentation:${String(
            currentBubble.presentation.presentationVersion,
          )}`,
          payload: {
            sourceRunId: input.sourceRunId,
            artifactId: input.artifactId,
            role: input.role,
            ...(input.targetPath ? { targetPath: input.targetPath } : {}),
          },
        }),
      );
      const failure = trustedActionFailure(dispatchResult);
      if (failure) throw failure;
      const bubble = await utils.runtime.bubblesGet.fetch({
        bubbleId: input.bubbleId,
      });
      await Promise.all([
        utils.runtime.bubblesList.invalidate(),
        utils.runtime.bubblesGet.invalidate({ bubbleId: input.bubbleId }),
        utils.runtime.bubblesProjection.invalidate({ bubbleId: input.bubbleId }),
      ]);
      return bubble as SmartBubbleRuntimeRecord;
    },
    [dispatch, listQuery.data?.bubbles, utils],
  );

  return {
    bubbles: (listQuery.data?.bubbles ?? []) as SmartBubbleRuntimeRecord[],
    isLoading: listQuery.isLoading,
    error: listQuery.error as unknown as Error | null,
    refresh,
    transition,
    attachArtifact,
  };
}