import { describe, expect, it } from "vitest";
import {
  ActiveWorkspaceProjectionSchema,
  LivingObjectsProjectionSchema,
  PresentationDefinitionSchema,
  type ActiveWorkspaceProjection,
  type LivingObjectsProjection,
} from "@workspace/jasim-runtime-contract";
import {
  createMobileTrustedAction,
  emptyLivingObjectsProjection,
  isMobileLocalAction,
  parseLivingObjectsProjection,
  parseWorkspaceProjection,
  presentationTransition,
  shouldAcceptWorkspaceProjection,
  workspaceProjectionFreshness,
} from "../../../../../artifacts/jasim-mobile/lib/semantic-runtime";

function projection(overrides: Partial<ActiveWorkspaceProjection> = {}): ActiveWorkspaceProjection {
  return {
    kind: "active_workspace_projection",
    version: 1,
    workspaceId: "conversation:conversation-1",
    conversation: {
      id: "conversation-1",
      title: "Search",
      status: "active",
      updatedAt: "2026-09-12T00:00:02.000Z",
    },
    activeGoal: {
      kind: "runtime_run",
      id: "run-1",
      text: "Find options",
      status: "running",
      taskId: "task-1",
      runId: "run-1",
      presentationVersion: "living:2026-09-12T00:00:02.000Z",
    },
    currentPresentation: {
      primitive: "SEARCH_RESULTS",
      version: 1,
      data: { candidates: [{ id: "candidate-2", title: "Second" }] },
      actions: [{ intent: "open", label: "Open" }],
    },
    resultSet: {
      id: "result-set-1",
      version: 4,
      queryText: "options",
      sources: ["trusted-source"],
      candidates: [{
        id: "candidate-2",
        position: 2,
        title: "Second",
        summary: null,
        source: "trusted-source",
        canonicalRef: "canonical:2",
        externalRef: null,
        attributes: { price: 20 },
        availability: "available",
        trust: "verified",
        actionable: ["open"],
        provenance: {},
        observedAt: null,
      }],
    },
    selectedEntityReferences: [{
      referenceKey: "result-set-1:candidate-2",
      targetKind: "discovery_candidate",
      targetId: "candidate-2",
      resultSetId: "result-set-1",
      position: 2,
    }],
    activeRun: {
      id: "run-1",
      goal: "Find options",
      status: "running",
      taskId: "task-1",
      bubbleId: null,
      updatedAt: "2026-09-12T00:00:02.000Z",
    },
    activeAction: null,
    approval: {
      id: "approval-1",
      proposalId: "proposal-1",
      status: "pending",
      expiresAt: null,
      presentationVersion: "4",
    },
    transactionReference: null,
    worldReference: null,
    status: "awaiting_approval",
    attention: [{
      kind: "approval_required",
      sourceId: "approval-1",
      severity: "warning",
      reason: "Approval required",
      actionIntent: "approve",
    }],
    availablePresentationActions: [{ intent: "approve", label: "Approve", requiresApproval: true }],
    updatedAt: "2026-09-12T00:00:02.000Z",
    presentationVersion: "presentation:1",
    ...overrides,
  };
}

function livingProjection(): LivingObjectsProjection {
  return {
    kind: "living_objects_projection",
    version: 1,
    limit: 30,
    generatedAt: "2026-09-12T00:00:02.000Z",
    objects: [{
      id: "living:runtime_run:run-1",
      underlyingReference: { kind: "runtime_run", id: "run-1" },
      relatedReferences: [{ kind: "runtime_task", id: "task-1" }],
      semanticType: "process",
      title: "Find options",
      summary: "A durable process",
      status: "WAITING_APPROVAL",
      attention: { level: "APPROVAL_REQUIRED", reason: "Approval required" },
      primaryAction: {
        intent: "approve",
        label: "Approve",
        requiresApproval: true,
        reference: { kind: "runtime_run", id: "run-1" },
      },
      secondaryActions: [],
      updatedAt: "2026-09-12T00:00:02.000Z",
      createdAt: "2026-09-12T00:00:01.000Z",
      presentationVersion: "living:2026-09-12T00:00:02.000Z",
      durability: "ongoing",
      completion: "not_complete",
    }],
  };
}

describe("Smart UI Task 8A — Mobile semantic/runtime parity", () => {
  it("uses the same PresentationDefinition schema and fails safely for invalid data", () => {
    const valid = PresentationDefinitionSchema.safeParse({
      primitive: "SEARCH_RESULTS",
      version: 1,
      data: { candidates: [] },
    });
    expect(valid.success).toBe(true);
    expect(parseWorkspaceProjection({ primitive: "SCRIPT", version: 99 })).toBeNull();
  });

  it("preserves workspace goal, ResultSet, selected references, and target versions", () => {
    const parsed = parseWorkspaceProjection(projection());
    expect(parsed?.activeGoal?.id).toBe("run-1");
    expect(parsed?.resultSet?.id).toBe("result-set-1");
    expect(parsed?.resultSet?.version).toBe(4);
    expect(parsed?.selectedEntityReferences[0]?.referenceKey).toBe(
      "result-set-1:candidate-2",
    );
    expect(parsed?.activeGoal?.presentationVersion).toBe(
      "living:2026-09-12T00:00:02.000Z",
    );
    expect(parsed?.approval?.presentationVersion).toBe("4");
    expect(parsed?.presentationVersion).toBe("presentation:1");
  });

  it("rejects an older response for the same conversation but accepts a new conversation", () => {
    const current = workspaceProjectionFreshness(projection());
    const older = workspaceProjectionFreshness(
      projection({
        updatedAt: "2026-09-12T00:00:01.000Z",
        conversation: {
          id: "conversation-1",
          title: "Search",
          status: "active",
          updatedAt: "2026-09-12T00:00:01.000Z",
        },
      }),
    );
    expect(shouldAcceptWorkspaceProjection(current, older)).toBe(false);
    expect(
      shouldAcceptWorkspaceProjection(current, {
        ...older,
        conversationId: "conversation-2",
      }),
    ).toBe(true);
  });

  it("classifies semantic transitions without requiring a native animation layer", () => {
    expect(presentationTransition(null, projection())).toBe("ENTER");
    expect(presentationTransition(projection(), projection())).toBe("NO_CHANGE");
    expect(
      presentationTransition(
        projection(),
        projection({
          currentPresentation: {
            primitive: "COMPARISON",
            version: 1,
            data: { rows: [] },
            actions: [],
          },
        }),
      ),
    ).toBe("MORPH");
    expect(presentationTransition(projection(), null)).toBe("EXIT");
  });

  it("preserves Living Object identity and safely falls back to an empty projection", () => {
    const parsed = parseLivingObjectsProjection(livingProjection());
    expect(LivingObjectsProjectionSchema.parse(parsed).objects[0]?.underlyingReference).toEqual({
      kind: "runtime_run",
      id: "run-1",
    });
    expect(parseLivingObjectsProjection({ kind: "not-a-projection" }).objects).toHaveLength(0);
    expect(emptyLivingObjectsProjection().objects).toHaveLength(0);
  });

  it("keeps local presentation actions local and canonical actions version-bound", () => {
    expect(isMobileLocalAction("LOCAL_TAB_CHANGE")).toBe(true);
    expect(isMobileLocalAction("APPROVE_PROPOSAL")).toBe(false);
    expect(() =>
      createMobileTrustedAction({
        actionId: "mobile-approval-1",
        actionType: "APPROVE_PROPOSAL",
        intent: "approve",
        source: "PRESENTATION",
        targetReference: { kind: "execution_proposal", id: "proposal-1" },
        payload: { decision: "approve" },
      }),
    ).toThrow("expectedPresentationVersion");
    expect(
      createMobileTrustedAction({
        actionId: "mobile-approval-2",
        actionType: "APPROVE_PROPOSAL",
        intent: "approve",
        source: "PRESENTATION",
        targetReference: { kind: "execution_proposal", id: "proposal-1" },
        expectedPresentationVersion: "4",
        payload: { decision: "approve" },
      }).actionType,
    ).toBe("APPROVE_PROPOSAL");
  });

  it("fails closed when Mobile tries to set protected truth or privileged handlers", () => {
    for (const key of ["ownerId", "policyOverride", "providerUrl", "handler", "paid", "verified"]) {
      expect(() =>
        createMobileTrustedAction({
          actionId: `mobile-protected-${key}`,
          actionType: "SUBMIT_INPUT",
          intent: "submit",
          source: "PRESENTATION",
          targetReference: { kind: "runtime_task", id: "task-1" },
          expectedPresentationVersion: "7",
          payload: { [key]: true },
        }),
      ).toThrow(key);
    }
  });

  it("does not manufacture rich UI for a simple text response", () => {
    const simple = projection({
      activeGoal: null,
      currentPresentation: null,
      resultSet: null,
      selectedEntityReferences: [],
      activeRun: null,
      approval: null,
      status: "active",
      attention: [],
      availablePresentationActions: [],
    });
    expect(simple.currentPresentation).toBeNull();
    expect(emptyLivingObjectsProjection().objects).toHaveLength(0);
  });

  it("uses shared schemas for the Web/Mobile action boundary", () => {
    const action = createMobileTrustedAction({
      actionId: "mobile-bubble-1",
      actionType: "UPDATE_BUBBLE_PRESENTATION",
      intent: "expand",
      source: "SMART_BUBBLE",
      targetReference: { kind: "smart_bubble", id: "bubble-1" },
      presentationReference: { kind: "bubble", id: "bubble-1" },
      expectedPresentationVersion: "presentation:7",
      payload: { action: "expand" },
    });
    expect(ActiveWorkspaceProjectionSchema.safeParse(projection()).success).toBe(true);
    expect(action.targetReference?.kind).toBe("smart_bubble");
  });
});