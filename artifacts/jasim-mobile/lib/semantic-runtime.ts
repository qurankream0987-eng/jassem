import {
  ActiveWorkspaceProjectionSchema,
  classifyPresentationTransition,
  derivePresentationIdentity,
  LivingObjectsProjectionSchema,
  TrustedActionEnvelopeSchema,
  isTrustedCanonicalAction,
  type ActiveWorkspaceProjection,
  type LivingObjectsProjection,
  type PresentationDefinition,
  type PresentationIdentity,
  type PresentationTransition,
  type TrustedActionEnvelope,
  type TrustedActionType,
} from "@workspace/jasim-runtime-contract";

export type WorkspaceProjectionFreshness = {
  conversationId: string | null;
  updatedAt: string | null;
  timestamp: number | null;
};

export type MobileSemanticSnapshot = {
  workspace: ActiveWorkspaceProjection | null;
  livingObjects: LivingObjectsProjection;
  presentation: PresentationDefinition | null;
  presentationIdentity: PresentationIdentity | null;
  transition: PresentationTransition;
  freshness: WorkspaceProjectionFreshness | null;
};

export function presentationTransition(
  previous: ActiveWorkspaceProjection | null,
  current: ActiveWorkspaceProjection | null,
): PresentationTransition {
  return classifyPresentationTransition(
    derivePresentationIdentity(previous),
    derivePresentationIdentity(current),
  );
}

export function emptyLivingObjectsProjection(): LivingObjectsProjection {
  return {
    kind: "living_objects_projection",
    version: 1,
    objects: [],
    limit: 30,
    generatedAt: new Date(0).toISOString(),
  };
}

export function parseWorkspaceProjection(
  value: unknown,
): ActiveWorkspaceProjection | null {
  const parsed = ActiveWorkspaceProjectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseLivingObjectsProjection(
  value: unknown,
): LivingObjectsProjection {
  const parsed = LivingObjectsProjectionSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyLivingObjectsProjection();
}

export function workspaceProjectionFreshness(
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

export function shouldAcceptWorkspaceProjection(
  previous: WorkspaceProjectionFreshness | null,
  incoming: WorkspaceProjectionFreshness,
): boolean {
  if (!previous || previous.conversationId !== incoming.conversationId) return true;
  if (previous.timestamp === null || incoming.timestamp === null) return true;
  return incoming.timestamp >= previous.timestamp;
}

export function createMobileTrustedAction(
  input: Omit<TrustedActionEnvelope, "version" | "payload"> & {
    payload?: Record<string, unknown>;
  },
): TrustedActionEnvelope {
  const payload = input.payload ?? {};
  const forbiddenClientFields = [
    "ownerId",
    "policyOverride",
    "handler",
    "providerUrl",
    "paid",
    "verified",
    "settled",
    "payoutCompleted",
  ] as const;
  const forbiddenField = Object.keys(payload).find((key) =>
    (forbiddenClientFields as readonly string[]).includes(key),
  );
  if (forbiddenField) {
    throw new Error(`Mobile cannot set protected field: ${forbiddenField}`);
  }
  if (
    isTrustedCanonicalAction(input.actionType) &&
    input.actionType !== "REFRESH_PROJECTION" &&
    !input.expectedPresentationVersion
  ) {
    throw new Error("Canonical Mobile actions require expectedPresentationVersion.");
  }
  return TrustedActionEnvelopeSchema.parse({
    version: 1,
    ...input,
    payload,
  });
}

export function isMobileLocalAction(actionType: TrustedActionType): boolean {
  return ([
    "WORKSPACE_COLLAPSE",
    "WORKSPACE_EXPAND",
    "RAIL_COLLAPSE",
    "RAIL_EXPAND",
    "LOCAL_TAB_CHANGE",
  ] as readonly string[]).includes(actionType);
}