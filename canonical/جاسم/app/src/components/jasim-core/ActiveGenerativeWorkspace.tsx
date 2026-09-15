import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BubbleSchema } from '@contracts/jasim';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  ExternalLink,
  Loader2,
  Sparkles,
  Target,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/providers/trpc';
import type {
  ActiveWorkspaceAttention,
  ActiveWorkspaceProjection,
} from '@workspace/jasim-runtime-contract';
import { PresentationRenderer } from './PresentationRenderer';
import { useWorkspacePresentationTransition } from './useWorkspacePresentationTransition';
import {
  isWorkspaceExit,
  useWorkspaceVisualLifecycle,
  workspaceSurfaceKey,
  workspaceTransitionClass,
} from './workspacePresentationVisual';

export interface ActiveGenerativeWorkspaceProps {
  conversationId?: string;
  onPresentationAction?: (
    intent: string,
    context: WorkspacePresentationContext,
  ) => void;
  onPresentationSubmit?: (
    data: Record<string, unknown>,
    schema: BubbleSchema,
    context: WorkspacePresentationContext,
  ) => void | Promise<void>;
  className?: string;
}

export type WorkspacePresentationReference = {
  kind:
    | 'conversation'
    | 'runtime_task'
    | 'runtime_run'
    | 'smart_bubble'
    | 'generated_system'
    | 'execution_proposal';
  id: string;
};

export type WorkspacePresentationContext = {
  targetReference?: WorkspacePresentationReference;
  conversationReference?: WorkspacePresentationReference;
  goalReference?: WorkspacePresentationReference;
  approvalReference?: WorkspacePresentationReference;
  expectedPresentationVersion: string;
  targetExpectedPresentationVersion?: string;
  approvalExpectedPresentationVersion?: string;
};

function safeLabel(value: string | null | undefined, fallback: string): string {
  const label = value?.trim();
  return label || fallback;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function attentionClasses(severity: ActiveWorkspaceAttention['severity']): string {
  if (severity === 'error') return 'border-rose-400/25 bg-rose-400/10 text-rose-100';
  if (severity === 'warning') return 'border-amber-300/25 bg-amber-300/10 text-amber-100';
  return 'border-sky-300/20 bg-sky-300/10 text-sky-100';
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return 'Waiting for a current update';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Current state';
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)}`;
}

export function hasMeaningfulContext(
  projection: ActiveWorkspaceProjection | null | undefined,
): boolean {
  if (!projection) return false;
  return Boolean(
    projection.currentPresentation ||
      projection.attention.length > 0 ||
      projection.activeGoal ||
      projection.activeRun ||
      projection.resultSet ||
      projection.worldReference,
  );
}

function WorkspaceSkeleton({ className = '' }: { className?: string }) {
  return (
    <section
      aria-label="Loading active workspace"
      data-testid="workspace-loading"
      className={`flex h-full min-h-[15rem] flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl ${className}`}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl bg-white/10" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-32 bg-white/10" />
          <Skeleton className="h-2.5 w-20 bg-white/10" />
        </div>
      </div>
      <Skeleton className="h-20 w-full rounded-xl bg-white/10" />
      <Skeleton className="h-28 w-full rounded-xl bg-white/10" />
    </section>
  );
}

function WorkspaceError({
  onRetry,
  className = '',
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <section
      aria-label="Active workspace error"
      data-testid="workspace-error"
      className={`rounded-2xl border border-amber-300/20 bg-amber-200/[0.06] p-4 text-amber-50 backdrop-blur-xl ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Workspace context is unavailable</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/70">
            Conversation is still available. JASIM can try to restore the current context.
          </p>
          <button
            type="button"
            onClick={onRetry}
            data-testid="button-workspace-retry"
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-amber-200/25 bg-amber-100/10 px-3 text-xs font-medium text-amber-50 transition hover:bg-amber-100/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/60"
          >
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}

function WorkspaceStale({ className = '' }: { className?: string }) {
  return (
    <section
      aria-label="Refreshing active workspace"
      data-testid="workspace-stale"
      className={`flex items-center gap-3 rounded-2xl border border-sky-200/15 bg-sky-200/[0.05] p-4 text-sky-50 backdrop-blur-xl ${className}`}
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-200" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Refreshing current workspace</p>
        <p className="mt-1 text-xs leading-5 text-sky-100/70">
          An older response was ignored while the latest context is restored.
        </p>
      </div>
    </section>
  );
}

function AttentionItem({ attention }: { attention: ActiveWorkspaceAttention }) {
  return (
    <li
      data-testid={`workspace-attention-${attention.sourceId}`}
      className={`rounded-xl border px-3 py-2.5 ${attentionClasses(attention.severity)}`}
    >
      <div className="flex items-start gap-2">
        <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-medium capitalize">{statusLabel(attention.kind)}</p>
          <p className="mt-0.5 text-xs leading-5 opacity-80">{attention.reason}</p>
        </div>
      </div>
    </li>
  );
}

function GoalSummary({ projection }: { projection: ActiveWorkspaceProjection }) {
  const goal = projection.activeGoal ?? projection.activeRun;
  if (!goal) {
    return (
      <div
        data-testid="workspace-neutral-goal"
        className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-400"
      >
        No active goal is currently attached to this context.
      </div>
    );
  }

  const goalText = 'text' in goal ? goal.text : goal.goal;
  return (
    <div
      data-testid="workspace-goal-summary"
      className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3"
    >
      <div className="flex items-start gap-2.5">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
            Active goal
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-100">{safeLabel(goalText, 'Current runtime goal')}</p>
          <p className="mt-1 text-[11px] capitalize text-slate-500">{statusLabel(goal.status)}</p>
        </div>
      </div>
    </div>
  );
}

function ResultReferences({ projection }: { projection: ActiveWorkspaceProjection }) {
  const resultSet = projection.resultSet;
  const selectedKeys = useMemo(
    () =>
      new Set(
        projection.selectedEntityReferences.flatMap((reference) => [
          reference.referenceKey,
          reference.targetId,
        ]),
      ),
    [projection.selectedEntityReferences],
  );

  if (!resultSet) {
    return (
      <div
        data-testid="workspace-neutral-references"
        className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-400"
      >
        No selected references in the current context.
      </div>
    );
  }

  return (
    <div data-testid="workspace-selected-references" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
          Context references
        </p>
        <span className="text-[11px] text-slate-500">{resultSet.candidates.length} available</span>
      </div>
      {resultSet.candidates.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-400">
          The current result set has no references to show.
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Workspace result references">
          {resultSet.candidates.slice(0, 8).map((candidate) => {
            const isSelected =
              selectedKeys.has(candidate.id) ||
              (candidate.canonicalRef ? selectedKeys.has(candidate.canonicalRef) : false) ||
              (candidate.externalRef ? selectedKeys.has(candidate.externalRef) : false);
            return (
              <li
                key={candidate.id}
                data-testid={`workspace-reference-${candidate.id}`}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-2"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    isSelected
                      ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                      : 'border-white/10 text-slate-600'
                  }`}
                  aria-label={isSelected ? 'Selected reference' : 'Available reference'}
                >
                  {isSelected ? <Check className="h-3 w-3" aria-hidden="true" /> : candidate.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{candidate.title}</span>
                <span className="max-w-[7rem] truncate text-[10px] text-slate-500">{candidate.source}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WorkspaceStatus({ projection }: { projection: ActiveWorkspaceProjection }) {
  const statusTone =
    projection.status === 'failed' || projection.status === 'blocked'
      ? 'text-rose-200 bg-rose-300/10 border-rose-300/20'
      : projection.status === 'completed'
        ? 'text-emerald-200 bg-emerald-300/10 border-emerald-300/20'
        : 'text-sky-100 bg-sky-300/10 border-sky-300/20';

  return (
    <div data-testid="workspace-status" className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full border px-2 py-1 text-[10px] font-medium capitalize ${statusTone}`}>
        {statusLabel(projection.status)}
      </span>
      <span className="text-[11px] text-slate-500">{formatUpdatedAt(projection.updatedAt)}</span>
      <span
        data-testid="workspace-presentation-version"
        className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-500"
      >
        Presentation {projection.presentationVersion}
      </span>
    </div>
  );
}

export function ActiveGenerativeWorkspace({
  conversationId,
  onPresentationAction,
  onPresentationSubmit,
  className = '',
}: ActiveGenerativeWorkspaceProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreWorkspaceFocusRef = useRef(false);
  const workspaceQuery = trpc.runtime.workspaceProjection.useQuery(
    { conversationId },
    {
      enabled: Boolean(conversationId),
      refetchOnWindowFocus: false,
      retry: 1,
    },
  );

  const projection = workspaceQuery.data as ActiveWorkspaceProjection | null | undefined;
  const meaningful = hasMeaningfulContext(projection);
  const presentationTransition = useWorkspacePresentationTransition(projection, conversationId);
  const { showExitShell } = useWorkspaceVisualLifecycle({
    conversationId,
    presentationIdentity: presentationTransition.presentationIdentity,
    transition: presentationTransition.transition,
  });

  const presentationContext: WorkspacePresentationContext | undefined = projection
    ? {
        targetReference: projection.activeGoal
          ? { kind: projection.activeGoal.kind, id: projection.activeGoal.id }
          : projection.activeRun
            ? { kind: 'runtime_run', id: projection.activeRun.id }
            : projection.worldReference
              ? { kind: 'generated_system', id: projection.worldReference.id }
              : projection.conversation
                ? { kind: 'conversation', id: projection.conversation.id }
                : undefined,
        conversationReference: projection.conversation
          ? { kind: 'conversation', id: projection.conversation.id }
          : undefined,
        goalReference: projection.activeGoal
          ? { kind: projection.activeGoal.kind, id: projection.activeGoal.id }
          : undefined,
        approvalReference: projection.approval
          ? { kind: 'execution_proposal', id: projection.approval.proposalId }
          : undefined,
        expectedPresentationVersion: projection.presentationVersion,
        targetExpectedPresentationVersion: projection.activeGoal?.presentationVersion ??
          (projection.conversation ? projection.conversation.updatedAt : undefined),
        approvalExpectedPresentationVersion: projection.approval?.presentationVersion,
      }
    : undefined;

  useLayoutEffect(() => {
    return () => {
      const activeElement = document.activeElement;
      restoreWorkspaceFocusRef.current =
        activeElement instanceof HTMLElement &&
        Boolean(workspaceRef.current?.contains(activeElement));
    };
  }, [conversationId, presentationTransition.presentationIdentity]);

  useLayoutEffect(() => {
    if (
      restoreWorkspaceFocusRef.current &&
      (presentationTransition.transition === 'MORPH' ||
        (presentationTransition.transition === 'EXIT' && showExitShell))
    ) {
      workspaceHeadingRef.current?.focus({ preventScroll: true });
      restoreWorkspaceFocusRef.current = false;
    }
  }, [
    presentationTransition.presentationIdentity,
    presentationTransition.transition,
    showExitShell,
  ]);

  if (!conversationId) return null;
  if (workspaceQuery.isLoading) return <WorkspaceSkeleton className={className} />;
  if (workspaceQuery.isError) {
    return <WorkspaceError className={className} onRetry={() => void workspaceQuery.refetch()} />;
  }
  if (presentationTransition.isStale) return <WorkspaceStale className={className} />;
  if (!meaningful || !projection) {
    if (!isWorkspaceExit(presentationTransition.transition) || !showExitShell) return null;

    return (
      <section
        ref={workspaceRef}
        aria-label="Closing active generative workspace"
        data-testid="workspace-closing-shell"
        data-presentation-transition="EXIT"
        className={`${workspaceTransitionClass('EXIT')} flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] shadow-2xl shadow-black/10 backdrop-blur-xl ${className}`}
      >
        <div className="flex items-center gap-2.5 px-3.5 py-3 text-xs text-slate-400">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-slate-500/70"
          />
          <h2
            ref={workspaceHeadingRef}
            tabIndex={-1}
            className="outline-none"
          >
            Closing current workspace
          </h2>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={workspaceRef}
      id="active-generative-workspace"
      aria-label="Active generative workspace"
      data-testid="active-generative-workspace"
      data-presentation-transition={presentationTransition.transition}
      data-presentation-primitive={presentationTransition.semanticPrimitive ?? undefined}
      data-presentation-identity={presentationTransition.presentationIdentity ?? undefined}
      className={`${workspaceTransitionClass(presentationTransition.transition)} flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/10 backdrop-blur-xl ${className}`}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-200/15 bg-sky-200/10 text-sky-100">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2
              ref={workspaceHeadingRef}
              tabIndex={-1}
              className="truncate text-sm font-medium text-slate-100 outline-none"
            >
              Active workspace
            </h2>
            <p className="truncate text-[11px] text-slate-500">Current context, kept beside the conversation</p>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-controls="active-generative-workspace-content"
          aria-label={isCollapsed ? 'Expand active workspace' : 'Collapse active workspace'}
          data-testid="button-workspace-toggle"
          onClick={() => setIsCollapsed((current) => !current)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/60"
        >
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </header>

      {!isCollapsed && (
        <div
          id="active-generative-workspace-content"
          data-testid="workspace-content"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5"
        >
          <WorkspaceStatus projection={projection} />
          <GoalSummary projection={projection} />

          {projection.attention.length > 0 && (
            <div data-testid="workspace-attention" className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
                Attention
              </p>
              <ul className="space-y-1.5" aria-label="Workspace attention">
                {projection.attention.map((item) => (
                  <AttentionItem key={item.sourceId} attention={item} />
                ))}
              </ul>
            </div>
          )}

          <ResultReferences projection={projection} />

          {projection.currentPresentation ? (
            <div
              key={workspaceSurfaceKey(
                presentationTransition.transition,
                presentationTransition.presentationIdentity,
              )}
              data-testid="workspace-presentation"
              data-presentation-transition={presentationTransition.transition}
              data-presentation-primitive={presentationTransition.semanticPrimitive ?? undefined}
              data-presentation-identity={presentationTransition.presentationIdentity ?? undefined}
              className={`${workspaceTransitionClass(presentationTransition.transition)} border-t border-white/10 pt-1`}
            >
              <PresentationRenderer
                presentation={projection.currentPresentation}
                onAction={(intent) => {
                  if (presentationContext) {
                    onPresentationAction?.(intent, presentationContext);
                  }
                }}
                onSubmit={(data, schema) => {
                  if (presentationContext) {
                    return onPresentationSubmit?.(data, schema, presentationContext);
                  }
                }}
              />
            </div>
          ) : (
            <div
              data-testid="workspace-neutral-presentation"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-3 text-xs text-slate-400"
            >
              <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No presentation is needed for this context yet.
            </div>
          )}

          {projection.worldReference && (
            <div
              data-testid="workspace-world-reference"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs text-slate-300"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {projection.worldReference.kind === 'runtime_world' ? 'Runtime world context' : 'Generated system context'}
              </span>
              <span className="text-[10px] capitalize text-slate-500">
                {statusLabel(projection.worldReference.status)}
              </span>
            </div>
          )}
        </div>
      )}

      {workspaceQuery.isFetching && !workspaceQuery.isLoading && (
        <div
          data-testid="workspace-refreshing"
          className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3.5 py-2 text-[10px] text-slate-500"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Refreshing current context
        </div>
      )}
    </section>
  );
}
