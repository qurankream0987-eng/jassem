import { describe, expect, it, vi } from "vitest";
import {
  type TrustedActionEnvelope,
  type TrustedReference,
} from "../../contracts/trusted-action";
import {
  dispatchTrustedAction,
  type TrustedActionDependencies,
} from "../../api/runtime/trusted-action-dispatcher";

function action(
  overrides: Partial<TrustedActionEnvelope> = {},
): TrustedActionEnvelope {
  return {
    version: 1,
    actionId: "task-7b-action-0001",
    actionType: "OPEN_REFERENCE",
    intent: "open",
    source: "PRESENTATION",
    targetReference: { kind: "smart_bubble", id: "bubble-1" },
    presentationReference: { kind: "bubble", id: "bubble-1" },
    payload: {},
    ...overrides,
  };
}

function dependencies(
  routeOverrides: TrustedActionDependencies["routes"] = {},
  version = "presentation:7",
): TrustedActionDependencies {
  return {
    resolveReference: vi.fn(async (_ownerId: string, reference: TrustedReference) => ({
      reference,
      currentPresentationVersion: version,
      canonicalState: "active",
    })),
    routes: {
      OPEN_REFERENCE: vi.fn(async () => ({
        outcome: "OPENED" as const,
        message: "opened",
        refreshProjection: true,
      })),
      ...routeOverrides,
    },
  };
}

describe("Smart UI Task 7B — Web action wiring boundary", () => {
  it("routes Smart Bubble presentation actions with the canonical presentation version", async () => {
    const route = vi.fn(async () => ({
      outcome: "DISPATCH_ACCEPTED" as const,
      message: "bubble updated",
      refreshProjection: true,
    }));
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionId: "bubble-expand-7",
        actionType: "UPDATE_BUBBLE_PRESENTATION",
        intent: "expand",
        expectedPresentationVersion: "presentation:7",
        payload: { action: "expand" },
      }),
      dependencies({ UPDATE_BUBBLE_PRESENTATION: route }),
    );
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");
    expect(route).toHaveBeenCalledOnce();
  });

  it("blocks a stale Smart Bubble transition before the route executes", async () => {
    const route = vi.fn();
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "UPDATE_BUBBLE_PRESENTATION",
        intent: "expand",
        expectedPresentationVersion: "presentation:6",
        payload: { action: "expand" },
      }),
      dependencies({ UPDATE_BUBBLE_PRESENTATION: route }, "presentation:7"),
    );
    expect(result.outcome).toBe("STALE");
    expect(route).not.toHaveBeenCalled();
  });

  it("rejects artifact payloads that attempt to carry provider-controlled fields", async () => {
    const route = vi.fn();
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "ATTACH_ARTIFACT",
        intent: "attach_artifact",
        expectedPresentationVersion: "presentation:7",
        payload: {
          sourceRunId: "run-1",
          artifactId: "artifact-1",
          role: "cover",
          url: "https://untrusted.example/image.png",
        },
      }),
      dependencies({ ATTACH_ARTIFACT: route }),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
    expect(route).not.toHaveBeenCalled();
  });

  it("routes reconciliation only for the owner-scoped current run version", async () => {
    const route = vi.fn(async () => ({
      outcome: "DISPATCH_ACCEPTED" as const,
      message: "reconciled",
      refreshProjection: true,
    }));
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "RECONCILE_RUN",
        intent: "reconcile",
        targetReference: { kind: "runtime_run", id: "run-1" },
        presentationReference: { kind: "workspace", id: "conversation-1" },
        expectedPresentationVersion: "living:2026-09-12T00:00:00.000Z",
        payload: {},
      }),
      dependencies(
        { RECONCILE_RUN: route },
        "living:2026-09-12T00:00:00.000Z",
      ),
    );
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");
    expect(route).toHaveBeenCalledOnce();
  });

  it("keeps unsupported generated-UI requests fail-closed", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_CHANGE",
        intent: "change",
        targetReference: { kind: "smart_bubble", id: "bubble-1" },
        expectedPresentationVersion: "presentation:7",
        payload: { instruction: "do something else" },
      }),
      dependencies(),
    );
    expect(result.outcome).toBe("BLOCKED");
  });
});