/**
 * useRunLifecycle — Phase 9 / Phase 10
 *
 * Manages the full lifecycle of a durable run.
 * Phase 9: tracks verification status from receipt.
 * Phase 10: exposes canRetry and retryRun for safe failure recovery.
 */
import { useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { useTrustedActionDispatcher } from "./useTrustedActionDispatcher";
import {
  createTrustedActionEnvelope,
  trustedActionFailure,
} from "@/lib/trusted-action-dispatcher";

export interface RunLifecycleState {
  run: {
    id: string;
    status: string;
    goal: string;
    outputs: Record<string, unknown>;
    events: Array<{ type: string; payload: Record<string, unknown> }>;
    updatedAt?: string;
  } | undefined;
  proposals: Array<{
    id: string;
    status: string;
    intentType: string;
    riskLevel: string;
    approvalRequired: boolean;
    fingerprint: string;
    version?: string;
  }>;
  receipt: {
    status: string;
    completedNodes: number;
    nodeCount: number;
    aggregatedOutput: Record<string, unknown>;
    /** Phase 9: verification status from independent verifier */
    verificationStatus?: string;
  } | null;
  isLoading: boolean;
  canApprove: boolean;
  canResume: boolean;
  canExecute: boolean;
  canReconcile: boolean;
  /** Phase 10: true when the server determines a retry is safe (no external effects) */
  canRetry: boolean;
  approveProposal: (proposalId: string) => Promise<void>;
  rejectProposal: (proposalId: string) => Promise<void>;
  resumePlan: (proposalId: string) => Promise<void>;
  executeRun: () => Promise<void>;
  reconcileRun: () => Promise<void>;
  /** Phase 10: retry after a safe failure */
  retryRun: () => Promise<void>;
}

export function useRunLifecycle(
  runId: string | undefined,
  proposalIds: string[] = [],
): RunLifecycleState {
  const utils = trpc.useUtils();
  const { dispatch, isPending: isDispatchPending } = useTrustedActionDispatcher();

  // Poll run status every 3 seconds while not terminal
  const runQuery = trpc.runtime.runsGet.useQuery(
    { runId: runId ?? "" },
    {
      enabled: Boolean(runId),
      refetchInterval: (query) => {
        const status = (query.state.data as { status?: string } | undefined)?.status;
        if (!status) return 3000;
        if (["completed", "failed", "cancelled", "blocked"].includes(status)) return false;
        return 3000;
      },
      refetchOnWindowFocus: false,
    },
  );

  // Load first proposal to check approval state
  const firstProposalQuery = trpc.runtime.proposalsGet.useQuery(
    { proposalId: proposalIds[0] ?? "" },
    { enabled: proposalIds.length > 0, refetchOnWindowFocus: false },
  );

  // Receipt — load terminal runs so retry decisions have an explicit
  // verification state instead of treating a missing value as safe.
  const runStatus = (runQuery.data as { status?: string } | undefined)?.status;
  const receiptQuery = trpc.runtime.runsReceipt.useQuery(
    { runId: runId ?? "" },
    {
      enabled:
        Boolean(runId) && (runStatus === "completed" || runStatus === "failed"),
      refetchOnWindowFocus: false,
    },
  );

  const run = runQuery.data as RunLifecycleState["run"];
  const proposal = firstProposalQuery.data as
    | RunLifecycleState["proposals"][0]
    | undefined;
  const receipt =
    (receiptQuery.data as RunLifecycleState["receipt"] | undefined) ?? null;

  const invalidate = useCallback(async () => {
    await Promise.all([
      runId ? utils.runtime.runsGet.invalidate({ runId }) : null,
      proposalIds.length > 0
        ? utils.runtime.proposalsGet.invalidate({ proposalId: proposalIds[0] })
        : null,
    ]);
  }, [runId, proposalIds, utils]);

  const approveProposal = useCallback(
    async (proposalId: string) => {
      try {
        const currentProposal =
          proposalId === proposal?.id ? proposal : undefined;
        if (!currentProposal?.version) {
          throw new Error("The proposal version is unavailable. Refresh and try again.");
        }
        const result = await dispatch(
          createTrustedActionEnvelope({
            actionId: `proposal-approve:${proposalId}:${currentProposal.version}`,
            actionType: "APPROVE_PROPOSAL",
            intent: "approve",
            source: "PRESENTATION",
            targetReference: { kind: "execution_proposal", id: proposalId },
            expectedPresentationVersion: currentProposal.version,
            idempotencyKey: `proposal-approve:${proposalId}`,
            payload: { decision: "approve" },
          }),
        );
        const failure = trustedActionFailure(result);
        if (failure) throw failure;
        toast.success("تمت الموافقة على الخطة.");
        await invalidate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشلت الموافقة. حاول مجدداً.");
      }
    },
    [dispatch, invalidate, proposal],
  );

  const rejectProposal = useCallback(
    async (proposalId: string) => {
      try {
        const currentProposal =
          proposalId === proposal?.id ? proposal : undefined;
        if (!currentProposal?.version) {
          throw new Error("The proposal version is unavailable. Refresh and try again.");
        }
        const result = await dispatch(
          createTrustedActionEnvelope({
            actionId: `proposal-reject:${proposalId}:${currentProposal.version}`,
            actionType: "APPROVE_PROPOSAL",
            intent: "reject",
            source: "PRESENTATION",
            targetReference: { kind: "execution_proposal", id: proposalId },
            expectedPresentationVersion: currentProposal.version,
            idempotencyKey: `proposal-reject:${proposalId}`,
            payload: { decision: "reject" },
          }),
        );
        const failure = trustedActionFailure(result);
        if (failure) throw failure;
        toast.info("تم رفض الخطة.");
        await invalidate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشل الرفض. حاول مجدداً.");
      }
    },
    [dispatch, invalidate, proposal],
  );

  const resumePlan = useCallback(
    async (proposalId: string) => {
      try {
        const currentProposal =
          proposalId === proposal?.id ? proposal : undefined;
        if (!currentProposal?.version) {
          throw new Error("The proposal version is unavailable. Refresh and try again.");
        }
        const result = await dispatch(
          createTrustedActionEnvelope({
            actionId: `proposal-resume:${proposalId}:${currentProposal.version}`,
            actionType: "RESUME_OPERATION",
            intent: "resume",
            source: "PRESENTATION",
            targetReference: { kind: "execution_proposal", id: proposalId },
            expectedPresentationVersion: currentProposal.version,
            idempotencyKey: `proposal-resume:${proposalId}`,
            payload: {},
          }),
        );
        const failure = trustedActionFailure(result);
        if (failure) throw failure;
        toast.success("تم تفعيل الخطة المعتمدة.");
        await invalidate();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "فشل تفعيل الخطة.");
      }
    },
    [dispatch, invalidate, proposal],
  );

  const executeRun = useCallback(async () => {
    if (!runId) return;
    try {
      if (!run?.updatedAt) {
        throw new Error("The run version is unavailable. Refresh and try again.");
      }
      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `run-execute:${runId}:${run.updatedAt}`,
          actionType: "REQUEST_EXECUTION",
          intent: "execute",
          source: "PRESENTATION",
          targetReference: { kind: "runtime_run", id: runId },
          expectedPresentationVersion: `living:${run.updatedAt}`,
          idempotencyKey: `run-execute:${runId}`,
          payload: {},
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) throw failure;
        toast.info(
          result.outcome === "DISPATCH_ACCEPTED"
            ? "تم قبول طلب التنفيذ. ستظهر النتيجة بعد تحديث الحالة والتحقق منها."
            : "تم تحديث حالة طلب التنفيذ.",
        );
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشلت المعالجة. راجع حالة الخطة.");
    }
  }, [dispatch, invalidate, run, runId]);

  const reconcileRun = useCallback(async () => {
    if (!runId) return;
    try {
      if (!run?.updatedAt) {
        throw new Error("The run version is unavailable. Refresh and try again.");
      }
      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `run-reconcile:${runId}:${run.updatedAt}`,
          actionType: "RECONCILE_RUN",
          intent: "reconcile",
          source: "PRESENTATION",
          targetReference: { kind: "runtime_run", id: runId },
          expectedPresentationVersion: `living:${run.updatedAt}`,
          idempotencyKey: `run-reconcile:${runId}`,
          payload: {},
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) throw failure;
      toast.success("تم نشر نتائج المعالجة في المحادثة.");
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "فشل نشر النتائج.");
    }
  }, [dispatch, invalidate, run, runId]);

  /**
   * Phase 10: Retry a failed run.
   * We reuse runsExecute — the DAG executor is idempotent for READY nodes.
   * The server only allows retry on runs with no external side effects.
   */
  const retryRun = useCallback(async () => {
    if (!runId) return;
    try {
      if (!run?.updatedAt) {
        throw new Error("The run version is unavailable. Refresh and try again.");
      }
      const result = await dispatch(
        createTrustedActionEnvelope({
          actionId: `run-retry:${runId}:${run.updatedAt}`,
          actionType: "REQUEST_EXECUTION",
          intent: "retry",
          source: "PRESENTATION",
          targetReference: { kind: "runtime_run", id: runId },
          expectedPresentationVersion: `living:${run.updatedAt}`,
          idempotencyKey: `run-retry:${runId}`,
          payload: {},
        }),
      );
      const failure = trustedActionFailure(result);
      if (failure) throw failure;
      toast.success("جارٍ إعادة المحاولة…");
      await invalidate();
    } catch (err) {
      const msg =
        err instanceof Error && err.message ? err.message : "فشلت إعادة المحاولة.";
      toast.error(msg);
    }
  }, [dispatch, invalidate, run, runId]);

  const proposals = proposal ? [proposal] : [];

  const status = run?.status;
  const canApprove =
    status === "blocked" && proposal?.status === "awaiting_approval";
  const canResume =
    status === "blocked" && proposal?.status === "authorized";
  const canExecute = status === "ready";
  const canReconcile = status === "completed" && !receipt;

  // Phase 10: canRetry = run failed AND verification was not INCONCLUSIVE
  // (INCONCLUSIVE means we don't know if external effects occurred — don't offer retry).
  const receiptVerification = (receipt as { verificationStatus?: string } | null)?.verificationStatus;
  const canRetry =
    status === "failed" && receiptVerification === "FAILED";

  return {
    run,
    proposals,
    receipt,
    isLoading:
      runQuery.isLoading ||
      isDispatchPending,
    canApprove,
    canResume,
    canExecute,
    canReconcile,
    canRetry,
    approveProposal,
    rejectProposal,
    resumePlan,
    executeRun,
    reconcileRun,
    retryRun,
  };
}
