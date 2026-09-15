import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  BellRing,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Globe2,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { trpc } from '@/providers/trpc';
import type {
  LivingObjectAttentionLevel,
  LivingObjectProjection,
  LivingObjectsProjection,
} from '../../../api/runtime/presentation-fabric';

export interface ActiveObjectsRailProps {
  className?: string;
  onOpen?: (object: LivingObjectProjection) => void;
}

const attentionStyles: Record<
  LivingObjectAttentionLevel,
  { border: string; dot: string; text: string; label: string }
> = {
  NONE: {
    border: 'border-white/10 hover:border-sky-200/25',
    dot: 'bg-slate-500',
    text: 'text-slate-400',
    label: 'Quiet',
  },
  INFO: {
    border: 'border-sky-200/15 hover:border-sky-200/30',
    dot: 'bg-sky-300',
    text: 'text-sky-100',
    label: 'Info',
  },
  ACTION_REQUIRED: {
    border: 'border-amber-200/25 hover:border-amber-200/45',
    dot: 'bg-amber-300',
    text: 'text-amber-100',
    label: 'Action needed',
  },
  APPROVAL_REQUIRED: {
    border: 'border-fuchsia-200/30 hover:border-fuchsia-200/55',
    dot: 'bg-fuchsia-300',
    text: 'text-fuchsia-100',
    label: 'Approval needed',
  },
  BLOCKED: {
    border: 'border-orange-200/30 hover:border-orange-200/55',
    dot: 'bg-orange-300',
    text: 'text-orange-100',
    label: 'Blocked',
  },
  FAILED: {
    border: 'border-rose-200/30 hover:border-rose-200/55',
    dot: 'bg-rose-300',
    text: 'text-rose-100',
    label: 'Needs review',
  },
  COMPLETED: {
    border: 'border-emerald-200/20 hover:border-emerald-200/35',
    dot: 'bg-emerald-300',
    text: 'text-emerald-100',
    label: 'Completed',
  },
};

function statusLabel(status: LivingObjectProjection['status']): string {
  return status.replace(/_/g, ' ');
}

function formatUpdatedAt(value: string): string {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return 'Current state';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(updatedAt);
}

function semanticIcon(semanticType: LivingObjectProjection['semanticType']) {
  if (semanticType === 'world') return Globe2;
  if (semanticType === 'bubble') return Sparkles;
  return Activity;
}

function attentionIcon(level: LivingObjectAttentionLevel) {
  if (level === 'APPROVAL_REQUIRED') return BellRing;
  if (level === 'ACTION_REQUIRED' || level === 'BLOCKED') return CircleAlert;
  if (level === 'FAILED') return AlertCircle;
  if (level === 'COMPLETED') return CircleCheck;
  if (level === 'INFO') return BadgeCheck;
  return CircleDot;
}

function RailLoading({ className = '' }: { className?: string }) {
  return (
    <aside
      aria-label="Loading active objects"
      data-testid="active-objects-rail-loading"
      className={`flex shrink-0 self-start items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs text-slate-400 backdrop-blur-xl ${className}`}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-200" aria-hidden="true" />
      <span>Restoring active objects</span>
    </aside>
  );
}

function RailError({
  className = '',
  onRetry,
}: {
  className?: string;
  onRetry: () => void;
}) {
  return (
    <aside
      aria-label="Active objects error"
      data-testid="active-objects-rail-error"
      className={`flex shrink-0 self-start items-center gap-2 rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] px-3 py-2.5 text-xs text-amber-50 backdrop-blur-xl ${className}`}
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-200" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Active objects are unavailable.</span>
      <button
        type="button"
        onClick={onRetry}
        data-testid="button-active-objects-retry"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-amber-100/20 px-2 text-[10px] font-medium text-amber-50 transition hover:bg-amber-100/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/60"
      >
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        Retry
      </button>
    </aside>
  );
}

function LivingObjectRailItem({
  object,
  onOpen,
}: {
  object: LivingObjectProjection;
  onOpen?: (object: LivingObjectProjection) => void;
}) {
  const style = attentionStyles[object.attention.level];
  const StatusIcon = attentionIcon(object.attention.level);
  const SemanticIcon = semanticIcon(object.semanticType);

  return (
    <button
      type="button"
      data-testid={`active-object-${object.id}`}
      data-underlying-reference={`${object.underlyingReference.kind}:${object.underlyingReference.id}`}
      data-status={object.status}
      data-attention={object.attention.level}
      aria-label={`Open ${object.title}`}
      onClick={() => onOpen?.(object)}
      className={`group flex min-w-0 items-start gap-2.5 rounded-2xl border bg-white/[0.035] p-2.5 text-left shadow-lg shadow-black/10 backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:bg-white/[0.065] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/60 ${style.border}`}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.055] text-sky-100"
        aria-hidden="true"
      >
        <SemanticIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-xs font-medium text-slate-100">{object.title}</span>
          <ArrowUpRight
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 transition group-hover:text-sky-200"
            aria-hidden="true"
          />
        </span>
        <span className="mt-1 block truncate text-[10px] leading-4 text-slate-500">{object.summary}</span>
        <span className="mt-2 flex items-center gap-1.5 text-[10px]">
          <StatusIcon className={`h-3 w-3 ${style.text}`} aria-hidden="true" />
          <span className={`truncate capitalize ${style.text}`}>{style.label}</span>
          <span className="text-slate-600">·</span>
          <span className="truncate capitalize text-slate-500">{statusLabel(object.status)}</span>
          <span className="ms-auto shrink-0 text-slate-600">{formatUpdatedAt(object.updatedAt)}</span>
        </span>
        {object.progress ? (
          <span className="mt-2 block" aria-label={`${object.progress.completed} of ${object.progress.total} complete`}>
            <span className="mb-1 flex items-center justify-between text-[9px] text-slate-500">
              <span>Progress</span>
              <span>
                {object.progress.completed}/{object.progress.total}
              </span>
            </span>
            <span className="block h-1 overflow-hidden rounded-full bg-white/10">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-sky-300 to-cyan-200 transition-[width] duration-500"
                style={{ width: `${Math.round(object.progress.ratio * 100)}%` }}
              />
            </span>
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ActiveObjectsRail({ className = '', onOpen }: ActiveObjectsRailProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const query = trpc.runtime.activeLivingObjects.useQuery(
    { limit: 12 },
    {
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: 1,
    },
  );
  const projection = query.data as LivingObjectsProjection | undefined;
  const objects = projection?.objects ?? [];

  if (query.isLoading) return <RailLoading className={className} />;
  if (query.isError) {
    return <RailError className={className} onRetry={() => void query.refetch()} />;
  }
  if (objects.length === 0) return null;

  return (
    <aside
      aria-label="Active objects"
      data-testid="active-objects-rail"
      data-collapsed={isCollapsed}
      className={`flex min-h-0 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-2 shadow-2xl shadow-black/10 backdrop-blur-xl ${className}`}
    >
      <header className="flex shrink-0 items-center gap-2 px-1.5 py-1">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-fuchsia-200/15 bg-fuchsia-200/10 text-fuchsia-100">
          <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {!isCollapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-slate-100">Active objects</span>
            <span className="block text-[10px] text-slate-500">{objects.length} ongoing context{objects.length === 1 ? '' : 's'}</span>
          </span>
        ) : (
          <span className="sr-only">Active objects</span>
        )}
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-controls="active-objects-rail-list"
          aria-label={isCollapsed ? 'Expand active objects' : 'Collapse active objects'}
          data-testid="button-active-objects-toggle"
          onClick={() => setIsCollapsed((current) => !current)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/60"
        >
          {isCollapsed ? (
            <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelRightClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </header>

      {!isCollapsed ? (
        <div id="active-objects-rail-list" data-testid="active-objects-rail-list" className="min-h-0 space-y-2 overflow-y-auto p-1">
          {objects.map((object) => (
            <LivingObjectRailItem key={object.id} object={object} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 overflow-y-auto p-1" aria-label="Collapsed active objects">
          {objects.map((object) => {
            const style = attentionStyles[object.attention.level];
            return (
              <button
                key={object.id}
                type="button"
                aria-label={`Open ${object.title}`}
                data-testid={`active-object-collapsed-${object.id}`}
                onClick={() => onOpen?.(object)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/60"
              >
                <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}