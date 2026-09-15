import {
  TrustedActionEnvelopeSchema,
  type TrustedActionEnvelope,
  type TrustedActionType,
  type TrustedDispatchResult,
  type TrustedReference,
  isTrustedCanonicalAction,
  isTrustedLocalAction,
} from "@contracts/trusted-action";
import { z } from "zod";
import {
  actOnRuntimeTask,
  attachRuntimeArtifactToBubble,
  decideExecutionProposalApproval,
  executeApprovedRun,
  getExecutionProposal,
  getRuntimeBubble,
  getRuntimeConversation,
  getRuntimeRun,
  getRuntimeTask,
  reconcileRunToConversation,
  resumeApprovedPlan,
  updateRuntimeBubblePresentation,
  type RuntimeBubblePresentationAction,
} from "./jasim-runtime";
import { getLivingObjectsProjection } from "./living-object-projection";

type AuthorizedTarget = {
  reference: TrustedReference;
  currentPresentationVersion: string | null;
  canonicalState: string | null;
};

type TrustedActionRouteResult = {
  outcome:
    | "OPENED"
    | "PROJECTION_REFRESH_REQUIRED"
    | "DISPATCH_ACCEPTED"
    | "APPROVAL_REQUIRED"
    | "INCONCLUSIVE"
    | "BLOCKED";
  message: string;
  canonicalState?: string;
  refreshProjection?: boolean;
};

export type TrustedActionDependencies = {
  resolveReference: (
    ownerId: string,
    reference: TrustedReference,
  ) => Promise<AuthorizedTarget | null>;
  routes: Partial<
    Record<
      TrustedActionType,
      (input: {
        ownerId: string;
        action: TrustedActionEnvelope;
        target: AuthorizedTarget;
      }) => Promise<TrustedActionRouteResult>
    >
  >;
};

const routeRegistry: Readonly<
  Record<TrustedActionType, keyof TrustedActionDependencies["routes"] | null>
> = {
  WORKSPACE_COLLAPSE: null,
  WORKSPACE_EXPAND: null,
  RAIL_COLLAPSE: null,
  RAIL_EXPAND: null,
  LOCAL_TAB_CHANGE: null,
  OPEN_REFERENCE: "OPEN_REFERENCE",
  RESUME_OPERATION: "RESUME_OPERATION",
  REFRESH_PROJECTION: "REFRESH_PROJECTION",
  UPDATE_BUBBLE_PRESENTATION: "UPDATE_BUBBLE_PRESENTATION",
  ATTACH_ARTIFACT: "ATTACH_ARTIFACT",
  SUBMIT_INPUT: "SUBMIT_INPUT",
  SELECT_ENTITY: "SELECT_ENTITY",
  REQUEST_CHANGE: "REQUEST_CHANGE",
  CREATE_PROPOSAL: "CREATE_PROPOSAL",
  APPROVE_PROPOSAL: "APPROVE_PROPOSAL",
  CANCEL_OPERATION: "CANCEL_OPERATION",
  REQUEST_EXECUTION: "REQUEST_EXECUTION",
  RECONCILE_RUN: "RECONCILE_RUN",
};

const expectedReferenceKinds: Partial<
  Record<TrustedActionType, readonly TrustedReference["kind"][]>
> = {
  OPEN_REFERENCE: [
    "conversation",
    "runtime_task",
    "runtime_run",
    "smart_bubble",
    "generated_system",
    "execution_proposal",
  ],
  RESUME_OPERATION: ["execution_proposal"],
  REFRESH_PROJECTION: [
    "conversation",
    "runtime_task",
    "runtime_run",
    "smart_bubble",
    "generated_system",
    "execution_proposal",
  ],
  UPDATE_BUBBLE_PRESENTATION: ["smart_bubble"],
  ATTACH_ARTIFACT: ["smart_bubble"],
  SUBMIT_INPUT: ["runtime_task"],
  SELECT_ENTITY: ["runtime_run", "runtime_task"],
  REQUEST_CHANGE: ["runtime_run", "runtime_task", "smart_bubble"],
  CREATE_PROPOSAL: ["runtime_run", "runtime_task"],
  APPROVE_PROPOSAL: ["execution_proposal"],
  CANCEL_OPERATION: ["runtime_run", "runtime_task"],
  REQUEST_EXECUTION: ["runtime_run"],
  RECONCILE_RUN: ["runtime_run"],
};

const requiredPresentationVersion = new Set<TrustedActionType>([
  "RESUME_OPERATION",
  "SUBMIT_INPUT",
  "SELECT_ENTITY",
  "REQUEST_CHANGE",
  "CREATE_PROPOSAL",
  "APPROVE_PROPOSAL",
  "CANCEL_OPERATION",
  "REQUEST_EXECUTION",
  "UPDATE_BUBBLE_PRESENTATION",
  "ATTACH_ARTIFACT",
  "RECONCILE_RUN",
]);

const forbiddenPayloadKeys = new Set([
  "ownerId",
  "userId",
  "providerSecret",
  "handler",
  "handlerPath",
  "serverHandler",
  "sql",
  "providerUrl",
  "url",
  "policyOverride",
  "verification",
  "verified",
  "trustedReceiptStatus",
  "providerReceiptTrusted",
  "paymentStatus",
  "paid",
  "isPaid",
]);

const emptyPayloadSchema = z.object({}).strict();
const localPayloadSchema = z.record(z.string().max(120), z.unknown());
const actionPayloadSchemas: Partial<Record<TrustedActionType, z.ZodType>> = {
  WORKSPACE_COLLAPSE: emptyPayloadSchema,
  WORKSPACE_EXPAND: emptyPayloadSchema,
  RAIL_COLLAPSE: emptyPayloadSchema,
  RAIL_EXPAND: emptyPayloadSchema,
  LOCAL_TAB_CHANGE: z.object({ tab: z.string().trim().min(1).max(120) }).strict(),
  OPEN_REFERENCE: emptyPayloadSchema,
  RESUME_OPERATION: emptyPayloadSchema,
  REFRESH_PROJECTION: emptyPayloadSchema,
  UPDATE_BUBBLE_PRESENTATION: z
    .object({
      action: z.enum([
        "open",
        "expand",
        "full_screen",
        "minimize",
        "restore",
        "archive",
        "update",
      ]),
    })
    .strict(),
  ATTACH_ARTIFACT: z
    .object({
      sourceRunId: z.string().trim().min(1).max(240),
      artifactId: z.string().trim().min(1).max(240),
      role: z.enum([
        "cover",
        "logo",
        "background",
        "gallery",
        "illustration",
        "attachment",
      ]),
      targetPath: z.string().trim().min(1).max(300).optional(),
    })
    .strict(),
  SUBMIT_INPUT: z
    .object({
      actionId: z.string().trim().min(1).max(200),
      input: z.record(z.string().max(120), z.unknown()),
    })
    .strict(),
  SELECT_ENTITY: z
    .object({ entityId: z.string().trim().min(1).max(240) })
    .strict(),
  REQUEST_CHANGE: z
    .object({ instruction: z.string().trim().min(1).max(2_000) })
    .strict(),
  CREATE_PROPOSAL: z
    .object({ goal: z.string().trim().min(1).max(4_000) })
    .strict(),
  APPROVE_PROPOSAL: z
    .object({ decision: z.enum(["approve", "reject"]) })
    .strict(),
  CANCEL_OPERATION: z
    .object({ reason: z.string().trim().min(1).max(1_000).optional() })
    .strict(),
  REQUEST_EXECUTION: emptyPayloadSchema,
  RECONCILE_RUN: emptyPayloadSchema,
};

function validateActionPayload(action: TrustedActionEnvelope): boolean {
  const schema = actionPayloadSchemas[action.actionType] ?? localPayloadSchema;
  return schema.safeParse(action.payload).success;
}

function hasForbiddenPayloadKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenPayloadKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      forbiddenPayloadKeys.has(key) || hasForbiddenPayloadKey(nested),
  );
}

function invalid(
  message: string,
  action?: Partial<TrustedActionEnvelope>,
): TrustedDispatchResult {
  return {
    outcome: "INVALID_ACTION",
    actionId: action?.actionId,
    actionType: action?.actionType,
    message,
  };
}

export async function dispatchTrustedAction(
  ownerId: string,
  input: unknown,
  dependencies: TrustedActionDependencies,
): Promise<TrustedDispatchResult> {
  const parsed = TrustedActionEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return invalid("The trusted action envelope is malformed.");
  }
  const action = parsed.data;

  if (hasForbiddenPayloadKey(action.payload)) {
    return invalid("The action payload contains a privileged field.", action);
  }
  if (!validateActionPayload(action)) {
    return invalid("The action payload does not match its typed action.", action);
  }

  if (isTrustedLocalAction(action.actionType)) {
    return {
      outcome: "LOCAL_ONLY",
      actionId: action.actionId,
      actionType: action.actionType,
      message: "This presentation action remains local and is not dispatched.",
    };
  }
  if (!isTrustedCanonicalAction(action.actionType)) {
    return invalid("The action type is not trusted.", action);
  }

  const routeKey = routeRegistry[action.actionType];
  if (!routeKey) {
    return {
      outcome: "BLOCKED",
      actionId: action.actionId,
      actionType: action.actionType,
      message: "No trusted route exists for this action.",
    };
  }

  const targetReference = action.targetReference;
  if (!targetReference) {
    return invalid("A stable target reference is required.", action);
  }
  const allowedKinds = expectedReferenceKinds[action.actionType] ?? [];
  if (!allowedKinds.includes(targetReference.kind)) {
    return invalid("The target reference kind is not valid for this action.", action);
  }

  const target = await dependencies.resolveReference(ownerId, targetReference);
  if (!target) {
    return {
      outcome: "UNAUTHORIZED",
      actionId: action.actionId,
      actionType: action.actionType,
      reference: targetReference,
      message: "The referenced object is unavailable to this owner.",
    };
  }

  if (requiredPresentationVersion.has(action.actionType)) {
    if (!action.expectedPresentationVersion) {
      return invalid("A current presentation version is required.", action);
    }
    if (
      !target.currentPresentationVersion ||
      target.currentPresentationVersion !== action.expectedPresentationVersion
    ) {
      return {
        outcome: "STALE",
        actionId: action.actionId,
        actionType: action.actionType,
        reference: targetReference,
        message: "The action came from a stale presentation. Refresh first.",
      };
    }
  } else if (
    action.expectedPresentationVersion &&
    target.currentPresentationVersion &&
    action.expectedPresentationVersion !== target.currentPresentationVersion
  ) {
    return {
      outcome: "STALE",
      actionId: action.actionId,
      actionType: action.actionType,
      reference: targetReference,
      message: "The action came from a stale presentation. Refresh first.",
    };
  }

  const route = dependencies.routes[routeKey];
  if (!route) {
    return {
      outcome: "BLOCKED",
      actionId: action.actionId,
      actionType: action.actionType,
      reference: targetReference,
      message: "The trusted route is not available.",
    };
  }

  const result = await route({ ownerId, action, target });
  return {
    outcome: result.outcome,
    actionId: action.actionId,
    actionType: action.actionType,
    reference: targetReference,
    message: result.message,
    canonicalState: result.canonicalState,
    refreshProjection: result.refreshProjection ?? false,
  };
}

function stringPayload(action: TrustedActionEnvelope, key: string): string | null {
  const value = action.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordPayload(
  action: TrustedActionEnvelope,
  key: string,
): Record<string, unknown> | undefined {
  const value = action.payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function resolveCanonicalReference(
  ownerId: string,
  reference: TrustedReference,
): Promise<AuthorizedTarget | null> {
  try {
    switch (reference.kind) {
      case "conversation": {
        const conversation = await getRuntimeConversation(reference.id, ownerId);
        return {
          reference,
          currentPresentationVersion: conversation.updatedAt,
          canonicalState: conversation.status,
        };
      }
      case "runtime_task": {
        const task = await getRuntimeTask(reference.id, ownerId);
        return {
          reference,
          currentPresentationVersion:
            task.world && "version" in task.world ? String(task.world.version) : null,
          canonicalState: task.status,
        };
      }
      case "runtime_run": {
        const run = await getRuntimeRun(reference.id, ownerId);
        return {
          reference,
          currentPresentationVersion: `living:${run.updatedAt}`,
          canonicalState: run.status,
        };
      }
      case "smart_bubble": {
        const bubble = await getRuntimeBubble(reference.id, ownerId);
        return {
          reference,
          currentPresentationVersion: `presentation:${bubble.presentation.presentationVersion}`,
          canonicalState: bubble.status,
        };
      }
      case "execution_proposal": {
        const proposal = await getExecutionProposal(reference.id, ownerId);
        return {
          reference,
          currentPresentationVersion: proposal.version,
          canonicalState: proposal.status,
        };
      }
      case "generated_system": {
        const projection = await getLivingObjectsProjection({ ownerId, limit: 100 });
        const object = projection.objects.find(
          (candidate) =>
            candidate.underlyingReference.kind === reference.kind &&
            candidate.underlyingReference.id === reference.id,
        );
        return object
          ? {
              reference,
              currentPresentationVersion: object.presentationVersion,
              canonicalState: object.status,
            }
          : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function unavailableRoute(message: string) {
  return async (): Promise<TrustedActionRouteResult> => ({
    outcome: "BLOCKED",
    message,
  });
}

export function createCanonicalTrustedActionDependencies(): TrustedActionDependencies {
  return {
    resolveReference: resolveCanonicalReference,
    routes: {
      OPEN_REFERENCE: async ({ target }) => ({
        outcome: "OPENED",
        message: "The authorized reference is ready for the current Workspace.",
        canonicalState: target.canonicalState ?? undefined,
        refreshProjection: true,
      }),
      REFRESH_PROJECTION: async () => ({
        outcome: "PROJECTION_REFRESH_REQUIRED",
        message: "Refresh the current canonical projection.",
        refreshProjection: true,
      }),
      UPDATE_BUBBLE_PRESENTATION: async ({ ownerId, action, target }) => {
        const expectedVersion = Number(
          action.expectedPresentationVersion?.replace(/^presentation:/, ""),
        );
        const requestedAction = action.payload.action;
        if (
          target.reference.kind !== "smart_bubble" ||
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 1
        ) {
          return {
            outcome: "INCONCLUSIVE",
            message: "A valid Smart Bubble presentation version is required.",
          };
        }
        const bubble = await updateRuntimeBubblePresentation({
          bubbleId: target.reference.id,
          ownerId,
          action: requestedAction as RuntimeBubblePresentationAction,
          expectedPresentationVersion: expectedVersion,
        });
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "The Smart Bubble presentation was updated by the trusted runtime.",
          canonicalState: bubble.status,
          refreshProjection: true,
        };
      },
      ATTACH_ARTIFACT: async ({ ownerId, action, target }) => {
        const sourceRunId = stringPayload(action, "sourceRunId");
        const artifactId = stringPayload(action, "artifactId");
        const role = action.payload.role;
        const targetPath = stringPayload(action, "targetPath") ?? undefined;
        const expectedVersion = Number(
          action.expectedPresentationVersion?.replace(/^presentation:/, ""),
        );
        if (
          target.reference.kind !== "smart_bubble" ||
          !sourceRunId ||
          !artifactId ||
          typeof role !== "string" ||
          !Number.isSafeInteger(expectedVersion) ||
          expectedVersion < 1
        ) {
          return {
            outcome: "INCONCLUSIVE",
            message: "A valid Smart Bubble artifact attachment is required.",
          };
        }
        const result = await attachRuntimeArtifactToBubble({
          ownerId,
          bubbleId: target.reference.id,
          sourceRunId,
          artifactId,
          role: role as Parameters<typeof attachRuntimeArtifactToBubble>[0]["role"],
          targetPath,
          expectedPresentationVersion: expectedVersion,
        });
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "The artifact attachment was accepted by the trusted runtime.",
          canonicalState: result.bubble.status,
          refreshProjection: true,
        };
      },
      SUBMIT_INPUT: async ({ ownerId, action, target }) => {
        const actionId = stringPayload(action, "actionId");
        const actionInput = recordPayload(action, "input");
        if (!actionId || !actionInput || target.reference.kind !== "runtime_task") {
          return {
            outcome: "INCONCLUSIVE",
            message: "A typed task action and structured input are required.",
          };
        }
        const task = await actOnRuntimeTask({
          taskId: target.reference.id,
          ownerId,
          actionId,
          idempotencyKey: action.idempotencyKey,
          actionInput,
        });
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "The structured input was accepted by the trusted runtime.",
          canonicalState: task.status,
          refreshProjection: true,
        };
      },
      APPROVE_PROPOSAL: async ({ ownerId, action, target }) => {
        const decision = action.payload.decision;
        if (
          target.reference.kind !== "execution_proposal" ||
          (decision !== "approve" && decision !== "reject")
        ) {
          return {
            outcome: "INCONCLUSIVE",
            message: "A typed proposal decision is required.",
          };
        }
        const proposal = await decideExecutionProposalApproval({
          ownerId,
          proposalId: target.reference.id,
          decision,
        });
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "The proposal decision was accepted by the trusted runtime.",
          canonicalState: proposal.status,
          refreshProjection: true,
        };
      },
      RESUME_OPERATION: async ({ ownerId, target }) => {
        const run = await resumeApprovedPlan(target.reference.id, ownerId);
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "The approved operation was handed back to the trusted runtime.",
          canonicalState: run.status,
          refreshProjection: true,
        };
      },
      REQUEST_EXECUTION: async ({ ownerId, target }) => {
        const run = await executeApprovedRun(target.reference.id, ownerId);
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "Execution was accepted by the trusted runtime.",
          canonicalState: run.status,
          refreshProjection: true,
        };
      },
      RECONCILE_RUN: async ({ ownerId, target }) => {
        const receipt = await reconcileRunToConversation(target.reference.id, ownerId);
        return {
          outcome: "DISPATCH_ACCEPTED",
          message: "The run result was handed to the trusted reconciliation path.",
          canonicalState: receipt.status,
          refreshProjection: true,
        };
      },
      SELECT_ENTITY: unavailableRoute("Entity selection has no trusted canonical route yet."),
      REQUEST_CHANGE: unavailableRoute("Change requests require an existing trusted route."),
      CREATE_PROPOSAL: unavailableRoute("Proposal creation requires an existing trusted route."),
      CANCEL_OPERATION: unavailableRoute("Cancellation is not exposed by the current runtime."),
    },
  };
}

export async function dispatchCanonicalTrustedAction(
  ownerId: string,
  input: unknown,
): Promise<TrustedDispatchResult> {
  return dispatchTrustedAction(
    ownerId,
    input,
    createCanonicalTrustedActionDependencies(),
  );
}

export { routeRegistry };