import { describe, expect, it, vi } from "vitest";
import {
  TrustedActionEnvelopeSchema,
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
    actionId: "action-0001",
    actionType: "OPEN_REFERENCE",
    intent: "open durable context",
    source: "LIVING_OBJECT",
    targetReference: { kind: "runtime_run", id: "run-1" },
    presentationReference: { kind: "living_object", id: "living-1" },
    payload: {},
    ...overrides,
  };
}

function target(
  reference: TrustedReference = { kind: "runtime_run", id: "run-1" },
  version = "living:v1",
): { reference: TrustedReference; currentPresentationVersion: string; canonicalState: string } {
  return {
    reference,
    currentPresentationVersion: version,
    canonicalState: "running",
  };
}

function dependencies(
  routeOverrides: TrustedActionDependencies["routes"] = {},
  resolve = vi.fn(async (_ownerId: string, reference: TrustedReference) =>
    target(reference),
  ),
): TrustedActionDependencies {
  return {
    resolveReference: resolve,
    routes: {
      OPEN_REFERENCE: vi.fn(async ({ target: resolved }) => ({
        outcome: "OPENED" as const,
        message: "opened",
        canonicalState: resolved.canonicalState ?? undefined,
        refreshProjection: true,
      })),
      ...routeOverrides,
    },
  };
}

describe("Smart UI Task 7A — trusted action dispatcher core", () => {
  it("accepts a valid typed action envelope", async () => {
    const result = await dispatchTrustedAction("owner-a", action(), dependencies());
    expect(result.outcome).toBe("OPENED");
    expect(result.actionType).toBe("OPEN_REFERENCE");
  });

  it("rejects a malformed envelope before routing", async () => {
    const route = vi.fn();
    const result = await dispatchTrustedAction(
      "owner-a",
      { actionType: "OPEN_REFERENCE", payload: {} },
      dependencies({ OPEN_REFERENCE: route }),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
    expect(route).not.toHaveBeenCalled();
  });

  it("rejects an unknown action type", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      { ...action(), actionType: "execute_arbitrary_server_function" },
      dependencies(),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
  });

  it("blocks an allowlisted action with no registered trusted handler", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_CHANGE",
        intent: "request change",
        targetReference: { kind: "runtime_task", id: "task-1" },
        expectedPresentationVersion: "living:v1",
        payload: { instruction: "change the task context" },
      }),
      dependencies(),
    );
    expect(result.outcome).toBe("BLOCKED");
    expect(result.message).toContain("trusted route");
  });

  it("preserves stable references instead of using labels or array positions", async () => {
    const reference = { kind: "runtime_run" as const, id: "run-stable-7" };
    const result = await dispatchTrustedAction(
      "owner-a",
      action({ targetReference: reference }),
      dependencies({}, vi.fn(async (_ownerId, resolved) => target(resolved))),
    );
    expect(result.reference).toEqual(reference);
  });

  it("rejects an invalid or unavailable reference", async () => {
    const resolve = vi.fn(async () => null);
    const result = await dispatchTrustedAction(
      "owner-a",
      action(),
      dependencies({}, resolve),
    );
    expect(result.outcome).toBe("UNAUTHORIZED");
  });

  it("passes authenticated owner identity to reference resolution", async () => {
    const resolve = vi.fn(async (ownerId: string, reference: TrustedReference) => {
      if (ownerId !== "owner-a") return null;
      return target(reference);
    });
    const result = await dispatchTrustedAction("owner-a", action(), dependencies({}, resolve));
    expect(result.outcome).toBe("OPENED");
    expect(resolve).toHaveBeenCalledWith("owner-a", action().targetReference);
  });

  it("accepts the current expected presentation version", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_EXECUTION",
        intent: "request execution",
        expectedPresentationVersion: "living:v1",
      }),
      dependencies({
        REQUEST_EXECUTION: vi.fn(async () => ({
          outcome: "DISPATCH_ACCEPTED" as const,
          message: "accepted",
          refreshProjection: true,
        })),
      }),
    );
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");
  });

  it("blocks a stale presentation version", async () => {
    const route = vi.fn();
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_EXECUTION",
        intent: "request execution",
        expectedPresentationVersion: "living:v0",
      }),
      dependencies({ REQUEST_EXECUTION: route }),
    );
    expect(result.outcome).toBe("STALE");
    expect(route).not.toHaveBeenCalled();
  });

  it("blocks a stale morph action before any canonical route", async () => {
    const route = vi.fn();
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "APPROVE_PROPOSAL",
        intent: "approve proposal",
        targetReference: { kind: "execution_proposal", id: "proposal-1" },
        expectedPresentationVersion: "proposal:old",
        payload: { decision: "approve" },
      }),
      dependencies({ APPROVE_PROPOSAL: route }),
      vi.fn(async (_ownerId, reference) => target(reference, "proposal:new")),
    );
    expect(result.outcome).toBe("STALE");
    expect(route).not.toHaveBeenCalled();
  });

  it("keeps the explicit local presentation allowlist local", async () => {
    const resolve = vi.fn();
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "RAIL_COLLAPSE",
        intent: "collapse rail",
        targetReference: undefined,
      }),
      dependencies({}, resolve),
    );
    expect(result.outcome).toBe("LOCAL_ONLY");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("never classifies a consequential action as local", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "APPROVE_PROPOSAL",
        intent: "approve proposal",
        targetReference: { kind: "execution_proposal", id: "proposal-1" },
        expectedPresentationVersion: "proposal:v1",
        payload: { decision: "approve" },
      }),
      dependencies({}, async (_ownerId, reference) =>
        target(reference, "proposal:v1"),
      ),
    );
    expect(result.outcome).toBe("BLOCKED");
    expect(result.outcome).not.toBe("LOCAL_ONLY");
  });

  it("routes approval through the injected existing approval mechanism", async () => {
    const approve = vi.fn(async () => ({
      outcome: "DISPATCH_ACCEPTED" as const,
      message: "approval routed",
      refreshProjection: true,
    }));
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "APPROVE_PROPOSAL",
        intent: "approve proposal",
        targetReference: { kind: "execution_proposal", id: "proposal-1" },
        expectedPresentationVersion: "proposal:v1",
        payload: { decision: "approve" },
      }),
      dependencies({ APPROVE_PROPOSAL: approve }, async (_ownerId, reference) =>
        target(reference, "proposal:v1"),
      ),
    );
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");
    expect(approve).toHaveBeenCalled();
  });

  it("routes structured form input through the existing trusted runtime", async () => {
    const submit = vi.fn(async ({ action }: { action: TrustedActionEnvelope }) => ({
      outcome: "DISPATCH_ACCEPTED" as const,
      message: "submitted",
      canonicalState: String(action.payload.actionId),
      refreshProjection: true,
    }));
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "SUBMIT_INPUT",
        intent: "submit input",
        targetReference: { kind: "runtime_task", id: "task-1" },
        expectedPresentationVersion: "1",
        payload: { actionId: "provide-context", input: { city: "Riyadh" } },
      }),
      dependencies({ SUBMIT_INPUT: submit }, async (_ownerId, reference) =>
        target(reference, "1"),
      ),
    );
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");
    expect(submit).toHaveBeenCalled();
  });

  it("opens a reference without cloning or mutating its canonical object", async () => {
    const open = vi.fn(async () => ({
      outcome: "OPENED" as const,
      message: "opened",
      refreshProjection: true,
    }));
    const result = await dispatchTrustedAction(
      "owner-a",
      action(),
      dependencies({ OPEN_REFERENCE: open }),
    );
    expect(result.outcome).toBe("OPENED");
    expect(open).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("clone");
    expect(result).not.toHaveProperty("statusMutation");
  });

  it.each([
    "paymentStatus",
    "verification",
    "providerReceiptTrusted",
    "trustedReceiptStatus",
  ])("rejects client financial/trust claim %s", async (key) => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({ payload: { [key]: key === "paymentStatus" ? "PAID" : "VERIFIED" } }),
      dependencies(),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
  });

  it("rejects client ownership and policy overrides recursively", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({ payload: { input: { ownerId: "owner-b", policyOverride: true } } }),
      dependencies(),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
  });

  it("rejects arbitrary handler names and provider URLs", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({ payload: { handlerPath: "db.dropAll", providerUrl: "https://evil.test" } }),
      dependencies(),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
  });

  it("requires the presentation version for consequential actions", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_EXECUTION",
        intent: "request execution",
        payload: {},
      }),
      dependencies(),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
  });

  it("rejects a target kind that does not match the action route", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "APPROVE_PROPOSAL",
        intent: "approve proposal",
        targetReference: { kind: "runtime_run", id: "run-1" },
        expectedPresentationVersion: "living:v1",
      }),
      dependencies(),
    );
    expect(result.outcome).toBe("INVALID_ACTION");
  });

  it("preserves the existing idempotency key for consequential routing", async () => {
    const submit = vi.fn(async ({ action: routedAction }: { action: TrustedActionEnvelope }) => ({
      outcome: "DISPATCH_ACCEPTED" as const,
      message: "accepted",
      refreshProjection: true,
      canonicalState: routedAction.idempotencyKey,
    }));
    const envelope = action({
      actionType: "SUBMIT_INPUT",
      intent: "submit input",
      targetReference: { kind: "runtime_task", id: "task-1" },
      expectedPresentationVersion: "1",
      idempotencyKey: "idempotency-001",
      payload: { actionId: "provide-context", input: { value: "same" } },
    });
    const routeDeps = dependencies({ SUBMIT_INPUT: submit }, async (_ownerId, reference) =>
      target(reference, "1"),
    );
    const first = await dispatchTrustedAction("owner-a", envelope, routeDeps);
    const second = await dispatchTrustedAction("owner-a", envelope, routeDeps);
    expect(first.outcome).toBe("DISPATCH_ACCEPTED");
    expect(second.outcome).toBe("DISPATCH_ACCEPTED");
    expect(submit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: expect.objectContaining({ idempotencyKey: "idempotency-001" }) }),
    );
    expect(submit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: expect.objectContaining({ idempotencyKey: "idempotency-001" }) }),
    );
  });

  it("does not call an external effect for dispatch acceptance", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_EXECUTION",
        intent: "request execution",
        expectedPresentationVersion: "living:v1",
      }),
      dependencies({
        REQUEST_EXECUTION: vi.fn(async () => ({
          outcome: "DISPATCH_ACCEPTED" as const,
          message: "queued",
          refreshProjection: true,
        })),
      }),
    );
    expect(result.outcome).toBe("DISPATCH_ACCEPTED");
    expect(result).not.toHaveProperty("verified");
    expect(result).not.toHaveProperty("success");
  });

  it("returns an explicit projection refresh signal after accepted mutation", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "REQUEST_EXECUTION",
        intent: "request execution",
        expectedPresentationVersion: "living:v1",
      }),
      dependencies({
        REQUEST_EXECUTION: vi.fn(async () => ({
          outcome: "DISPATCH_ACCEPTED" as const,
          message: "accepted",
          refreshProjection: true,
        })),
      }),
    );
    expect(result.refreshProjection).toBe(true);
  });

  it("fails closed when a canonical route is not registered", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "CANCEL_OPERATION",
        intent: "cancel operation",
        expectedPresentationVersion: "living:v1",
      }),
      dependencies(),
    );
    expect(result.outcome).toBe("BLOCKED");
  });

  it("keeps the registry static and contains no domain-specific action route", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        actionType: "CREATE_PROPOSAL",
        intent: "create proposal",
        expectedPresentationVersion: "living:v1",
        payload: { goal: "create a proposal" },
      }),
      dependencies(),
    );
    expect(result.outcome).toBe("BLOCKED");
    expect(result.actionType).not.toMatch(/CAR|HOTEL|JOB|ORDER/u);
  });

  it("validates the shared contract independently of dispatcher routing", () => {
    expect(TrustedActionEnvelopeSchema.safeParse(action()).success).toBe(true);
    expect(
      TrustedActionEnvelopeSchema.safeParse({
        ...action(),
        presentationReference: { kind: "arbitrary_component", id: "x" },
      }).success,
    ).toBe(false);
  });

  it("supports a current Living Object reference without requiring a lifecycle mutation", async () => {
    const result = await dispatchTrustedAction(
      "owner-a",
      action({
        targetReference: { kind: "generated_system", id: "world-1" },
      }),
      dependencies({}, async (_ownerId, reference) => target(reference, "living:v1")),
    );
    expect(result.outcome).toBe("OPENED");
    expect(result.reference).toEqual({ kind: "generated_system", id: "world-1" });
  });
});