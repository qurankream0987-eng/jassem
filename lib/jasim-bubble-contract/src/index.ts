/**
 * Canonical, domain-neutral Smart Bubble presentation contract.
 *
 * The Runtime owns every value in this contract. Clients may request a
 * presentation transition, but never infer permissions, versions, or
 * lifecycle state locally.
 */

export type SmartBubbleMode = "ephemeral" | "interactive" | "persistent";
export type SmartBubbleStatus = "active" | "archived";
export type SmartBubbleSurface = "compact" | "expanded" | "full_screen";
export type SmartBubbleContentStatus =
  | "ready"
  | "loading"
  | "empty"
  | "error"
  | "blocked";

export type SmartBubblePresentation = {
  surface: SmartBubbleSurface;
  contentStatus: SmartBubbleContentStatus;
  message?: string;
  presentationVersion: number;
};

export type SmartBubbleAction = {
  id:
    | "open"
    | "expand"
    | "full_screen"
    | "minimize"
    | "restore"
    | "archive"
    | "update";
  label: string;
  enabled: boolean;
};

export type SmartBubbleContent = {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
};

/**
 * A durable link to an artifact produced by the Runtime. It never contains
 * object storage paths, bytes, base64, or provider URLs.
 */
export type SmartBubbleArtifactRole =
  | "cover"
  | "logo"
  | "background"
  | "gallery"
  | "illustration"
  | "attachment";

export type SmartBubbleArtifactReference = {
  kind: "runtime_artifact";
  artifactId: string;
  sourceRunId: string;
  role: SmartBubbleArtifactRole;
  targetPath?: string;
  contentType?: string;
  /** Owner-protected, projection-only route. It is never stored durably. */
  renderPath?: string;
};

export type SmartBubbleReference =
  | Record<string, unknown>
  | SmartBubbleArtifactReference;

export type SmartBubbleContract = {
  bubbleId: string;
  ownerId: string;
  conversationId: string | null;
  runtimeWorldId: string | null;
  mode: SmartBubbleMode;
  status: SmartBubbleStatus;
  activeView: string;
  presentation: SmartBubblePresentation;
  permissions: Record<string, boolean>;
  availableActions: SmartBubbleAction[];
  version: string;
  content: SmartBubbleContent;
  references: SmartBubbleReference[];
};

export type SmartBubbleTaskSummary = {
  id: string;
  goal: string;
  status: string;
  worldId: string | null;
  updatedAt: string;
};

export type SmartBubbleRunSummary = {
  id: string;
  goal: string;
  status: string;
  taskId: string | null;
  updatedAt: string;
};

export type SmartBubbleProjection<TBubble extends SmartBubbleContract = SmartBubbleContract> = {
  bubble: TBubble;
  tasks: SmartBubbleTaskSummary[];
  runs: SmartBubbleRunSummary[];
};

export type SmartBubbleRuntimeRecord = SmartBubbleContract & {
  /** `id` remains available during the client migration from the legacy DTO. */
  id: string;
  title: string;
  semanticDescription: string;
  presentationState: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};