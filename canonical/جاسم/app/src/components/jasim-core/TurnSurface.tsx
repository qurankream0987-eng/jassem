/**
 * JASIM — the surface a turn produced, mounted into the conversation.
 *
 * ─── THIS IS THE PRESENTATION IR RUNTIME, NOT A DATASET RENDERER ────────────
 *
 *   Presentation IR → schema validation → trusted registry → renderer → lifecycle
 *
 * TABLE and CHART are the first two entries in that registry. STATUS, CHOICE,
 * RESULT_SET, ENTITY, COMPARISON, MAP, TRACKER, FORM, APPROVAL, TIMELINE,
 * TRANSACTION, LIVING_OBJECT, WORLD and SPONSORED_SURFACE will be more entries
 * in the same registry — adding one is adding a key, not rewriting this file.
 *
 * That is why the mounting point takes a `primitive` and looks it up, rather
 * than asking "is this a dataset?". A renderer hardwired for datasets would
 * have to be torn out the first time a MAP arrived.
 *
 * ─── THE CLIENT MAY NOT CHOOSE A PRIMITIVE ──────────────────────────────────
 *
 * The registry is a closed map. An unknown `primitive` renders a truthful
 * notice, never a guess and never raw content — a surface this build does not
 * know how to draw is a surface it must not pretend to draw.
 */

import { useEffect, useRef, useState } from 'react';
import {
  DatasetSurface,
  type ChartSurfaceData,
  type DatasetSurfaceData,
  type TableSurfaceData,
} from './DatasetSurface';

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Semantic state, not animation.
 *
 * What changed between two surfaces is a fact about the data, and it stays a
 * fact whether or not anything moves on screen. `prefers-reduced-motion`
 * removes the transition; it does not remove the state.
 */
export type SurfaceLifecycle = 'ENTER' | 'UPDATE' | 'MORPH' | 'EXIT' | 'NO_CHANGE';

export function classifyLifecycle(
  previous: { primitive: string; datasetId?: string; revision?: number } | undefined,
  current: { primitive: string; datasetId?: string; revision?: number } | undefined,
): SurfaceLifecycle {
  if (!previous && !current) return 'NO_CHANGE';
  if (!previous) return 'ENTER';
  if (!current) return 'EXIT';
  // A different primitive over the same data is a MORPH: the dataset survived,
  // the way of looking at it did not. TABLE → CHART and CHART → TABLE are the
  // same transition in both directions.
  if (previous.primitive !== current.primitive) return 'MORPH';
  if (previous.datasetId !== current.datasetId) return 'ENTER';
  if (previous.revision !== current.revision) return 'UPDATE';
  return 'NO_CHANGE';
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return reduced;
}

// ── The trusted registry ─────────────────────────────────────────────────────

type SurfacePayload = Record<string, unknown>;

/**
 * Shape checks, before anything renders.
 *
 * Not a full schema validator — the runtime already validated the surface it
 * produced. This is the boundary guard: what arrives here has travelled through
 * message metadata, and a renderer that trusts its input to have the right
 * shape crashes a conversation when it does not.
 */
function isTableSurface(value: SurfacePayload): value is SurfacePayload & TableSurfaceData {
  return (
    value.primitive === 'TABLE' &&
    Array.isArray(value.columns) &&
    Array.isArray(value.rows) &&
    typeof value.datasetId === 'string'
  );
}

function isChartSurface(value: SurfacePayload): value is SurfacePayload & ChartSurfaceData {
  return (
    value.primitive === 'CHART' &&
    Array.isArray(value.points) &&
    typeof value.datasetId === 'string'
  );
}

const TRUSTED_SURFACES: Record<
  string,
  (payload: SurfacePayload) => React.ReactNode | null
> = {
  TABLE: (payload) =>
    isTableSurface(payload) ? (
      <DatasetSurface surface={payload as unknown as DatasetSurfaceData} />
    ) : null,
  CHART: (payload) =>
    isChartSurface(payload) ? (
      <DatasetSurface surface={payload as unknown as DatasetSurfaceData} />
    ) : null,
};

/** What this build can draw. Exported so a test can assert the closed set. */
export const TRUSTED_SURFACE_PRIMITIVES = Object.keys(TRUSTED_SURFACES);

function UnknownSurface({ primitive }: { primitive: string }) {
  return (
    <div
      className="my-2 rounded-xl border border-[var(--jasim-border)] bg-[var(--jasim-surface-sunken)] px-4 py-3 text-sm text-[var(--jasim-text-secondary)]"
      dir="rtl"
      role="note"
    >
      {/* Named, so a person can report it and a developer can find it. Never a
          guess at how to draw it, and never the raw payload. */}
      لا يمكن عرض هذا النوع من الأسطح في هذه النسخة ({primitive}).
    </div>
  );
}

// ── The mounting point ───────────────────────────────────────────────────────

export function TurnSurface({ surface }: { surface: unknown }) {
  const reducedMotion = usePrefersReducedMotion();
  const payload = (surface ?? undefined) as SurfacePayload | undefined;
  const previous = useRef<
    { primitive: string; datasetId?: string; revision?: number } | undefined
  >(undefined);

  const descriptor = payload
    ? {
        primitive: String(payload.primitive ?? ''),
        datasetId: typeof payload.datasetId === 'string' ? payload.datasetId : undefined,
        revision: typeof payload.revision === 'number' ? payload.revision : undefined,
      }
    : undefined;

  const lifecycle = classifyLifecycle(previous.current, descriptor);
  useEffect(() => {
    previous.current = descriptor;
  });

  if (!payload || !descriptor) return null;

  const render = TRUSTED_SURFACES[descriptor.primitive];
  const rendered = render ? render(payload) : null;

  return (
    <div
      // The lifecycle is readable in the DOM whether or not it animates, so a
      // test and a screen reader see the same fact a person does.
      data-surface-lifecycle={lifecycle}
      data-surface-primitive={descriptor.primitive}
      className={
        reducedMotion || lifecycle === 'NO_CHANGE'
          ? undefined
          : 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200'
      }
    >
      {rendered ?? <UnknownSurface primitive={descriptor.primitive} />}
    </div>
  );
}

/**
 * A routed turn that produced no surface — UNAVAILABLE, DENIED, NEEDS_INPUT.
 *
 * It renders as a notice rather than as an ordinary reply so that "JASIM
 * answered" and "JASIM understood and has nothing to answer with" do not look
 * the same. The state is in the DOM for the same reason.
 */
export function RoutedNotice({
  state,
  message,
}: {
  state: string;
  message: string;
}) {
  return (
    <div
      className="my-2 rounded-xl border border-[var(--jasim-border)] bg-[var(--jasim-surface-sunken)] px-4 py-3 text-sm text-[var(--jasim-text-secondary)]"
      dir="rtl"
      role="status"
      data-routed-state={state}
    >
      {message}
    </div>
  );
}
