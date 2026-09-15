import { useEffect, useRef } from 'react';
import type {
  ActiveWorkspaceProjection,
  PresentationPrimitive,
  PresentationIdentity,
} from '@workspace/jasim-runtime-contract';
import {
  classifyPresentationTransition,
  derivePresentationIdentity,
} from '@workspace/jasim-runtime-contract';

export type WorkspacePresentationTransition =
  | 'ENTER'
  | 'UPDATE'
  | 'MORPH'
  | 'EXIT'
  | 'NO_CHANGE';

export type WorkspacePresentationIdentity = PresentationIdentity;

export interface WorkspacePresentationMetadata {
  previousKey: string | null;
  previousPrimitive: PresentationPrimitive | null;
  previousTransition: WorkspacePresentationTransition;
}

export interface WorkspacePresentationTransitionResult {
  presentationIdentity: string | null;
  semanticPrimitive: PresentationPrimitive | null;
  transition: WorkspacePresentationTransition;
  isStale: boolean;
}

export interface WorkspaceProjectionFreshness {
  conversationId: string | null;
  updatedAt: string | null;
  timestamp: number | null;
}

/**
 * JSON-like values from the projection are serialized with ordered object keys.
 * This is intentionally small and deterministic: the projection remains the
 * only source of rendered truth, while this is used only for presentation
 * identity metadata.
 */
export function stablePresentationSerialization(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stablePresentationSerialization).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stablePresentationSerialization(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function deriveWorkspaceProjectionFreshness(
  projection: ActiveWorkspaceProjection | null | undefined,
  conversationId?: string,
): WorkspaceProjectionFreshness {
  const resolvedConversationId = conversationId ?? projection?.conversation?.id ?? null;
  const updatedAt = projection?.updatedAt ?? projection?.conversation?.updatedAt ?? null;
  const timestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN;

  return {
    conversationId: resolvedConversationId,
    updatedAt,
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
  };
}

/**
 * Freshness rejects older canonical projections for the same conversation.
 * It is stale-response protection, not authorization or business-state truth;
 * the server projection remains the only data source used for rendering.
 */
export function shouldAcceptWorkspaceProjection(
  previous: WorkspaceProjectionFreshness | null,
  incoming: WorkspaceProjectionFreshness,
): boolean {
  if (!previous || previous.conversationId !== incoming.conversationId) return true;
  if (previous.timestamp === null || incoming.timestamp === null) return true;
  return incoming.timestamp >= previous.timestamp;
}

/**
 * Builds a semantic presentation key from canonical projection data. No
 * domain-specific primitive pairs or morph maps belong here.
 */
export function deriveWorkspacePresentationIdentity(
  projection: ActiveWorkspaceProjection | null | undefined,
): WorkspacePresentationIdentity | null {
  return derivePresentationIdentity(projection);
}

export function classifyWorkspacePresentationTransition(
  previous: WorkspacePresentationMetadata | null,
  current: WorkspacePresentationIdentity | null,
): WorkspacePresentationTransition {
  return classifyPresentationTransition(
    previous?.previousKey && previous.previousPrimitive
      ? {
          key: previous.previousKey,
          primitive: previous.previousPrimitive,
        }
      : null,
    current,
  );
}

/**
 * Presentation-only metadata lifecycle. It never caches or returns a
 * projection; every render still reads the current server projection directly.
 */
export function useWorkspacePresentationTransition(
  projection: ActiveWorkspaceProjection | null | undefined,
  conversationId?: string,
): WorkspacePresentationTransitionResult {
  const identity = deriveWorkspacePresentationIdentity(projection);
  const conversationIdentity = conversationId ?? projection?.conversation?.id ?? null;
  const metadataRef = useRef<WorkspacePresentationMetadata | null>(null);
  const freshnessRef = useRef<WorkspaceProjectionFreshness | null>(null);
  const freshness = deriveWorkspaceProjectionFreshness(projection, conversationId);
  const isStale = !shouldAcceptWorkspaceProjection(freshnessRef.current, freshness);
  const latestRenderRef = useRef({
    conversationIdentity,
    presentationIdentity: identity?.key ?? null,
  });

  const previousMetadata =
    metadataRef.current?.previousKey !== null &&
    metadataRef.current?.previousKey !== undefined &&
    metadataRef.current &&
    latestRenderRef.current.conversationIdentity === conversationIdentity
      ? metadataRef.current
      : null;
  const transition = classifyWorkspacePresentationTransition(previousMetadata, identity);

  // This ref makes an older queued effect unable to replace newer metadata.
  if (!isStale) {
    latestRenderRef.current = {
      conversationIdentity,
      presentationIdentity: identity?.key ?? null,
    };
  }

  useEffect(() => {
    if (isStale) return;
    if (
      latestRenderRef.current.conversationIdentity !== conversationIdentity ||
      latestRenderRef.current.presentationIdentity !== (identity?.key ?? null)
    ) {
      return;
    }
    metadataRef.current = {
      previousKey: identity?.key ?? null,
      previousPrimitive: identity?.primitive ?? null,
      previousTransition: transition,
    };
    freshnessRef.current = freshness;
  }, [conversationIdentity, freshness, identity?.key, identity?.primitive, isStale, transition]);

  return {
    presentationIdentity: isStale ? null : identity?.key ?? null,
    semanticPrimitive: isStale ? null : identity?.primitive ?? null,
    transition: isStale ? 'NO_CHANGE' : transition,
    isStale,
  };
}