import { useCallback } from 'react';
import { trpc } from '@/providers/trpc';
import type { BubbleSchema } from '@contracts/jasim';

export interface UseBubbleActionsReturn {
  submitForm: (bubbleId: string, taskId: string | undefined, payload: Record<string, unknown>) => Promise<unknown>;
  updateBubble: (bubbleId: string, data: Record<string, unknown>) => Promise<unknown>;
  closeBubble: (bubbleId: string) => Promise<unknown>;
  minimizeBubble: (bubbleId: string) => Promise<unknown>;
  activateBubble: (bubbleId: string) => Promise<unknown>;
  isLoading: boolean;
}

export function useBubbleActions(): UseBubbleActionsReturn {
  const utils = trpc.useUtils();

  const updateBubbleMutation = trpc.bubble.update.useMutation();
  const closeBubbleMutation = trpc.bubble.close.useMutation();
  const minimizeBubbleMutation = trpc.bubble.minimize.useMutation();
  const activateBubbleMutation = trpc.bubble.activate.useMutation();
  const provideInputMutation = trpc.task.provideInput.useMutation();

  /**
   * Submit a form action from a bubble.
   * If a taskId is available, sends to task.provideInput so the task can resume.
   * Also updates the bubble data in the database.
   */
  const submitForm = useCallback(
    async (bubbleId: string, taskId: string | undefined, payload: Record<string, unknown>) => {
      // Update bubble data in DB
      const bubbleUpdate = updateBubbleMutation.mutateAsync({
        bubbleId,
        data: payload,
      });

      // If we have a task with a waiting step, provide input to resume it
      let taskUpdate: Promise<unknown> | undefined;
      if (taskId) {
        // We need a stepId; fetch steps to find the waiting one
        try {
          const stepsResult = await utils.task.getSteps.fetch({ taskId });
          const steps = (stepsResult as { steps?: Array<{ id: number; status: string }> })?.steps || [];
          const waitingStep = steps.find((s) => s.status === 'waiting_input');
          if (waitingStep) {
            taskUpdate = provideInputMutation.mutateAsync({
              taskId,
              stepId: String(waitingStep.id),
              input: payload,
            });
          }
        } catch {
          // No waiting step or error — bubble update is enough
        }
      }

      await bubbleUpdate;
      if (taskUpdate) await taskUpdate;

      return { success: true };
    },
    [updateBubbleMutation, provideInputMutation, utils]
  );

  const updateBubble = useCallback(
    async (bubbleId: string, data: Record<string, unknown>) => {
      return updateBubbleMutation.mutateAsync({ bubbleId, data });
    },
    [updateBubbleMutation]
  );

  const closeBubble = useCallback(
    async (bubbleId: string) => {
      return closeBubbleMutation.mutateAsync({ bubbleId });
    },
    [closeBubbleMutation]
  );

  const minimizeBubble = useCallback(
    async (bubbleId: string) => {
      return minimizeBubbleMutation.mutateAsync({ bubbleId });
    },
    [minimizeBubbleMutation]
  );

  const activateBubble = useCallback(
    async (bubbleId: string) => {
      return activateBubbleMutation.mutateAsync({ bubbleId });
    },
    [activateBubbleMutation]
  );

  const isLoading =
    updateBubbleMutation.isPending ||
    closeBubbleMutation.isPending ||
    minimizeBubbleMutation.isPending ||
    activateBubbleMutation.isPending ||
    provideInputMutation.isPending;

  return {
    submitForm,
    updateBubble,
    closeBubble,
    minimizeBubble,
    activateBubble,
    isLoading,
  };
}
