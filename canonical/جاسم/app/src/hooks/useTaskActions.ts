import { useCallback } from 'react';
import { trpc } from '@/providers/trpc';

export interface UseTaskActionsReturn {
  approve: (taskId: string, stepId: string, decision: boolean, reason?: string) => Promise<unknown>;
  provideInput: (taskId: string, stepId: string, input: Record<string, unknown>) => Promise<unknown>;
  execute: (taskId: string) => Promise<unknown>;
  pause: (taskId: string) => Promise<unknown>;
  resume: (taskId: string) => Promise<unknown>;
  cancel: (taskId: string) => Promise<unknown>;
  retry: (taskId: string) => Promise<unknown>;
  getSteps: (taskId: string) => Promise<unknown>;
  isLoading: boolean;
}

export function useTaskActions(): UseTaskActionsReturn {
  const utils = trpc.useUtils();

  const approveMutation = trpc.task.approve.useMutation();
  const provideInputMutation = trpc.task.provideInput.useMutation();
  const executeMutation = trpc.task.execute.useMutation();
  const pauseMutation = trpc.task.pause.useMutation();
  const resumeMutation = trpc.task.resume.useMutation();
  const cancelMutation = trpc.task.cancel.useMutation();
  const retryMutation = trpc.task.retry.useMutation();

  const approve = useCallback(
    async (taskId: string, stepId: string, decision: boolean, reason?: string) => {
      return approveMutation.mutateAsync({ taskId, stepId, decision, reason });
    },
    [approveMutation]
  );

  const provideInput = useCallback(
    async (taskId: string, stepId: string, input: Record<string, unknown>) => {
      return provideInputMutation.mutateAsync({ taskId, stepId, input });
    },
    [provideInputMutation]
  );

  const execute = useCallback(
    async (taskId: string) => {
      return executeMutation.mutateAsync({ taskId });
    },
    [executeMutation]
  );

  const pause = useCallback(
    async (taskId: string) => {
      return pauseMutation.mutateAsync({ taskId });
    },
    [pauseMutation]
  );

  const resume = useCallback(
    async (taskId: string) => {
      return resumeMutation.mutateAsync({ taskId });
    },
    [resumeMutation]
  );

  const cancel = useCallback(
    async (taskId: string) => {
      return cancelMutation.mutateAsync({ taskId });
    },
    [cancelMutation]
  );

  const retry = useCallback(
    async (taskId: string) => {
      return retryMutation.mutateAsync({ taskId });
    },
    [retryMutation]
  );

  const getSteps = useCallback(
    async (taskId: string) => {
      return utils.task.getSteps.fetch({ taskId });
    },
    [utils]
  );

  const isLoading =
    approveMutation.isPending ||
    provideInputMutation.isPending ||
    executeMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    cancelMutation.isPending ||
    retryMutation.isPending;

  return {
    approve,
    provideInput,
    execute,
    pause,
    resume,
    cancel,
    retry,
    getSteps,
    isLoading,
  };
}
