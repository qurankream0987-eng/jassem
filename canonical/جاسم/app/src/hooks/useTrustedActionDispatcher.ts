import { useCallback, useRef } from "react";
import type {
  TrustedActionEnvelope,
  TrustedDispatchResult,
} from "@contracts/trusted-action";
import { trpc } from "@/providers/trpc";
import { isDispatchRefreshOutcome } from "@/lib/trusted-action-dispatcher";

export function useTrustedActionDispatcher(): {
  dispatch: (action: TrustedActionEnvelope) => Promise<TrustedDispatchResult>;
  isPending: boolean;
} {
  const utils = trpc.useUtils();
  const mutation = trpc.runtime.dispatchAction.useMutation();
  const inFlightActionIds = useRef(new Set<string>());

  const dispatch = useCallback(
    async (action: TrustedActionEnvelope) => {
      if (inFlightActionIds.current.has(action.actionId)) {
        return {
          outcome: "INCONCLUSIVE" as const,
          actionId: action.actionId,
          actionType: action.actionType,
          reference: action.targetReference,
          message: "This action is already being processed.",
        };
      }
      inFlightActionIds.current.add(action.actionId);
      try {
        const result = await mutation.mutateAsync(action);
        if (isDispatchRefreshOutcome(result)) {
          await Promise.all([
            utils.runtime.workspaceProjection.invalidate(),
            utils.runtime.activeLivingObjects.invalidate(),
            utils.runtime.bubblesList.invalidate(),
            utils.runtime.runsList.invalidate(),
          ]);
        }
        return result;
      } finally {
        inFlightActionIds.current.delete(action.actionId);
      }
    },
    [inFlightActionIds, mutation, utils],
  );

  return { dispatch, isPending: mutation.isPending };
}