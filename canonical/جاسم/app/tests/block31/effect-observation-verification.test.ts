/**
 * JASIM — EFFECT → OBSERVATION → VERIFICATION, on the live runtime.
 *
 * ─── THE GAP THIS CLOSES, TRACED BEFORE IT WAS FILLED ───────────────────────
 *
 *   • `submitEffectSignal` and `observationEffectResolver` existed and were
 *     called by NOTHING in production — only by tests.
 *   • The one registered `resolveEffect` (`notify`) reads JASIM's own
 *     notification ledger, which is an INTERNAL_READBACK of JASIM's own
 *     dispatch, not a reading of the world.
 *   • DEVICE_COMMAND, REMOTE_MUTATION and HUMAN_ACTION accept only
 *     INDEPENDENT_READBACK or OWNER_CONFIRMATION.
 *
 * So on the running runtime, no device command, remote mutation or human
 * action could ever reach VERIFIED. The first test below proves exactly that,
 * and every test after it proves the same runtime with the gap closed.
 *
 * ─── ONE DECLARATION, MANY WORLDS ───────────────────────────────────────────
 *
 * Every scenario here — a message, a device, a person, five unfamiliar
 * holdouts — runs through ONE test capability with ONE `effectExpectation`.
 * The predicate compares the observed state against the state the attempt
 * asked for; it recognises no state, no noun and no domain. If a holdout
 * needed its own capability, its own observation type or its own verifier,
 * that would be the generality failure this file exists to catch.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { events as runEvents, executionAttempts, observations } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let bridge: typeof import("../../api/runtime/effect-observation-bridge");
let CapabilityRegistry: typeof import("../../api/runtime/capability-registry").CapabilityRegistry;
let registry: InstanceType<typeof CapabilityRegistry>;

const OWNER = "effect-owner";
const OTHER_OWNER = "effect-other";

/** Every effect class the completion policy knows, one capability each. */
const KINDS = {
  message: "test-effect-message",
  device: "test-effect-device",
  human: "test-effect-human",
  remote: "test-effect-remote",
  blind: "test-effect-blind",
} as const;

describe("an effect becomes verified only when the world says so", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    runtime = await import("../../api/runtime/jasim-runtime");
    bridge = await import("../../api/runtime/effect-observation-bridge");
    ({ CapabilityRegistry } = await import("../../api/runtime/capability-registry"));

    registry = new CapabilityRegistry({
      allowTestOnly: true,
      allowedTestCapabilityIds: new Set(Object.values(KINDS)),
    });

    /**
     * THE declaration. Four lines, no domain, reused by every scenario.
     *
     * `subject` takes an opaque (kind, id) out of the result; `occurredWhen`
     * compares the observed state to the requested one. A valve, a calibration
     * cycle and a generator differ only in the strings that travel through it.
     */
    const expectation = {
      observationType: "state",
      subject: (context: { result: Record<string, unknown> | null }) => {
        const subjectId = context.result?.subjectId;
        return typeof subjectId === "string" && subjectId
          ? { subjectKind: "effect-subject", subjectId }
          : undefined;
      },
      occurredWhen: (
        payload: Record<string, unknown>,
        context: { result: Record<string, unknown> | null },
      ) => payload.state === context.result?.targetState,
      notOccurredWhen: (payload: Record<string, unknown>) => payload.abandoned === true,
    };

    const execute = async (inputs: Record<string, unknown>) => ({
      subjectId: String(inputs.subjectId ?? ""),
      targetState: String(inputs.targetState ?? ""),
      // «Accepted, in flight» — the honest shape of a command that has been
      // issued and not yet observed. A capability declaring OCCURRED here
      // would still not verify anything: its word is EXECUTOR_RETURN, which no
      // effectful policy accepts. PENDING is simply the true statement.
      effect: { state: "PENDING" as const },
      accepted: true,
    });

    for (const [name, id] of Object.entries(KINDS)) {
      registry.register({
        id,
        aliases: [],
        risk: "low",
        sideEffects: "local_test",
        testOnly: true,
        effectKind:
          name === "message"
            ? "MESSAGE_DISPATCH"
            : name === "device"
              ? "DEVICE_COMMAND"
              : name === "human"
                ? "HUMAN_ACTION"
                : "REMOTE_MUTATION",
        // `blind` declares no expectation: the control for everything below.
        ...(name === "blind" ? {} : { effectExpectation: expectation }),
        execute,
      });
    }
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events, observations CASCADE"));
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Driving the real executor ──────────────────────────────────────────────

  async function runNode(input: {
    capabilityId: string;
    subjectId: string;
    targetState: string;
    owner?: string;
  }) {
    const owner = input.owner ?? OWNER;
    const run = await runtime.createRuntimeRun({
      ownerId: owner,
      goal: `effect: ${input.subjectId}`,
      idempotencyKey: `effect-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId: owner,
      runId: run.id,
      nodes: [
        {
          nodeKey: "act",
          capabilityId: input.capabilityId,
          inputs: { subjectId: input.subjectId, targetState: input.targetState },
          maxAttempts: 1,
        },
      ],
      capabilityRegistry: registry,
    });
    await runtime.executeRuntimeDagNode({
      ownerId: owner,
      runId: run.id,
      workerId: "effect-worker",
      capabilityRegistry: registry,
      // The real executor, pointed at the test registry. Everything it does
      // around the call — attempts, leases, gathering, verification,
      // persistence — is the shipped code.
      capabilityExecutor: async ({ capabilityId, inputs, context }) =>
        registry.executeTrusted(capabilityId, inputs, context),
    });
    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    return { run, attempt: attempt! };
  }

  async function observe(input: {
    attemptId: string;
    subjectId: string;
    state: string;
    channel: Parameters<typeof bridge.submitEffectSignal>[1]["channel"];
    owner?: string;
    correlationId?: string;
    freshnessTtlMs?: number;
    extra?: Record<string, unknown>;
  }) {
    return bridge.submitEffectSignal(handle.db, {
      ownerId: input.owner ?? OWNER,
      subjectKind: "effect-subject",
      subjectId: input.subjectId,
      observationType: "state",
      payload: { state: input.state, ...(input.extra ?? {}) },
      channel: input.channel,
      attemptId: input.attemptId,
      freshnessTtlMs: input.freshnessTtlMs ?? 10 * 60_000,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
  }

  const reconcile = (attemptId: string, owner = OWNER) =>
    runtime.reconcileUncertainAttempt(attemptId, owner, undefined, registry);

  // ── 1. THE GAP ─────────────────────────────────────────────────────────────

  it("without an observation an executed effect is never VERIFIED", async () => {
    // This is the state the whole runtime was in: the capability ran, returned
    // cleanly, and the world was never consulted.
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "subject-gap",
      targetState: "REACHED",
    });
    expect(attempt.executionStatus).toBe("COMPLETED");
    // The step ran; the effect is in flight and unconfirmed.
    expect(attempt.verificationStatus).toBe("PENDING");

    const after = await reconcile(attempt.id);
    expect(after.status).not.toBe("VERIFIED");
    expect(after.completion?.reasonCode).toBe("EFFECT_NOT_INDEPENDENTLY_CONFIRMED");
  });

  it("a capability that declares no expectation can never be independently confirmed", async () => {
    // The control. Nothing about the observation machinery reaches a
    // capability that never said what would count as evidence.
    const { attempt } = await runNode({
      capabilityId: KINDS.blind,
      subjectId: "subject-blind",
      targetState: "REACHED",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "subject-blind",
      state: "REACHED",
      channel: "RUNTIME_READBACK",
    });
    const after = await reconcile(attempt.id);
    expect(after.status).not.toBe("VERIFIED");
  });

  // ── 2. The five acceptance classes ────────────────────────────────────────

  it("A · MESSAGE — dispatch is not delivery; an independent status is", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.message,
      subjectId: "message-1",
      targetState: "DELIVERED",
    });
    expect(attempt.verificationStatus).not.toBe("VERIFIED");

    await observe({
      attemptId: attempt.id,
      subjectId: "message-1",
      state: "DELIVERED",
      channel: "RUNTIME_READBACK",
    });
    const after = await reconcile(attempt.id);
    expect(after.status).toBe("VERIFIED");
    expect(after.completion?.confirmedBy).toBe("INDEPENDENT_READBACK");
  });

  it("B · DEVICE — a command accepted is not a command performed; telemetry is", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-1",
      targetState: "ON",
    });
    expect(attempt.verificationStatus).not.toBe("VERIFIED");

    await observe({
      attemptId: attempt.id,
      subjectId: "device-1",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
    });
    const after = await reconcile(attempt.id);
    expect(after.status).toBe("VERIFIED");
  });

  it("C · HUMAN — the person's own report does not verify their own work", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.human,
      subjectId: "human-1",
      targetState: "DONE",
    });
    // The acting party says it is done. That is SELF_REPORTED.
    await observe({
      attemptId: attempt.id,
      subjectId: "human-1",
      state: "DONE",
      channel: "HUMAN_PROVIDER_REPORT",
    });
    const selfReported = await reconcile(attempt.id);
    expect(selfReported.status).not.toBe("VERIFIED");
    expect(selfReported.completion?.reasonCode).toBe("EFFECT_CLAIM_SOURCE_INSUFFICIENT");

    // The owner confirms it. A second observation, not a correction of the first.
    await observe({
      attemptId: attempt.id,
      subjectId: "human-1",
      state: "DONE",
      channel: "OWNER_CONFIRMATION",
    });
    const confirmed = await reconcile(attempt.id);
    expect(confirmed.status).toBe("VERIFIED");
    expect(confirmed.completion?.confirmedBy).toBe("OWNER_CONFIRMATION");
  });

  it("D · RECEIPT WITHOUT OBSERVATION stays unconfirmed", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.remote,
      subjectId: "remote-1",
      targetState: "CREATED",
    });
    // The provider's own response, recorded honestly as its own word.
    await observe({
      attemptId: attempt.id,
      subjectId: "remote-1",
      state: "CREATED",
      channel: "PROVIDER_RESPONSE",
    });
    const after = await reconcile(attempt.id);
    expect(after.status).not.toBe("VERIFIED");
    expect(after.completion?.decision).not.toBe("VERIFIED");
  });

  it("E · CONFLICT — an independent reading that contradicts the claim does not verify", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-conflict",
      targetState: "ON",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "device-conflict",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
    });
    // A second independent authority disagrees. Two authorities in conflict is
    // a stronger signal than one being unsure.
    await observe({
      attemptId: attempt.id,
      subjectId: "device-conflict",
      state: "OFF",
      channel: "RUNTIME_READBACK",
      extra: { abandoned: true },
    });
    const after = await reconcile(attempt.id);
    expect(after.status).not.toBe("VERIFIED");
    expect(after.completion?.retryPermitted).toBe(false);
  });

  it("an observation that the effect did NOT occur fails the attempt rather than leaving it open", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.remote,
      subjectId: "remote-abandoned",
      targetState: "CREATED",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "remote-abandoned",
      state: "NONE",
      channel: "RUNTIME_READBACK",
      extra: { abandoned: true },
    });
    const after = await reconcile(attempt.id);
    expect(after.status).toBe("FAILED");
    expect(after.completion?.reasonCode).toBe("EFFECT_DID_NOT_OCCUR");
  });

  // ── 3. Freshness ──────────────────────────────────────────────────────────

  it("a stale observation is not current evidence", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-stale",
      targetState: "ON",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "device-stale",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
      // Already expired when it was written.
      freshnessTtlMs: 0,
    });
    const after = await reconcile(attempt.id);
    expect(after.status).not.toBe("VERIFIED");
  });

  it("freshness is CURRENT, STALE or UNKNOWN — never «recently received»", async () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const observedAt = new Date(now.getTime() - 1_000);
    expect(
      bridge.observationFreshness(
        { observedAt, freshnessExpiresAt: new Date(now.getTime() + 60_000) },
        now,
      ),
    ).toBe("CURRENT");
    expect(
      bridge.observationFreshness(
        { observedAt, freshnessExpiresAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe("STALE");
    // One second old and declaring no horizon: how long it stays true is
    // unknown, so the runtime says UNKNOWN rather than guessing.
    expect(bridge.observationFreshness({ observedAt, freshnessExpiresAt: null }, now)).toBe(
      "UNKNOWN",
    );
  });

  // ── 4. Replay ─────────────────────────────────────────────────────────────

  it("a repeated provider callback records one observation, not two", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-replay",
      targetState: "ON",
    });
    const first = await observe({
      attemptId: attempt.id,
      subjectId: "device-replay",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
      correlationId: "callback-7",
    });
    const second = await observe({
      attemptId: attempt.id,
      subjectId: "device-replay",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
      correlationId: "callback-7",
    });
    expect(second.id).toBe(first.id);

    const rows = await handle.db
      .select()
      .from(observations)
      .where(eq(observations.subjectId, "device-replay"));
    expect(rows).toHaveLength(1);

    // And one event, not two: a replay is not a new fact.
    const recorded = await handle.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.type, "OBSERVATION_RECORDED"));
    expect(recorded).toHaveLength(1);
  });

  it("a different correlation id is a different fact and is appended", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-two",
      targetState: "ON",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "device-two",
      state: "OFF",
      channel: "AUTHENTICATED_TELEMETRY",
      correlationId: "reading-1",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "device-two",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
      correlationId: "reading-2",
    });
    const rows = await handle.db
      .select()
      .from(observations)
      .where(eq(observations.subjectId, "device-two"));
    expect(rows).toHaveLength(2);
  });

  // ── 5. Security ───────────────────────────────────────────────────────────

  it("another owner cannot attach evidence to this attempt", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-owned",
      targetState: "ON",
    });
    await expect(
      observe({
        attemptId: attempt.id,
        subjectId: "device-owned",
        state: "ON",
        channel: "AUTHENTICATED_TELEMETRY",
        owner: OTHER_OWNER,
      }),
    ).rejects.toThrow(/ATTEMPT_NOT_FOUND|attempt/i);
  });

  it("evidence for one attempt is not evidence for another", async () => {
    const first = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-shared",
      targetState: "ON",
    });
    const second = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-shared",
      targetState: "ON",
    });
    // A real, valid observation — bound to the FIRST attempt.
    await observe({
      attemptId: first.attempt.id,
      subjectId: "device-shared",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
    });
    const other = await reconcile(second.attempt.id);
    expect(other.status).not.toBe("VERIFIED");
  });

  it("a payload cannot grade its own evidence", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-claim",
      targetState: "ON",
    });
    for (const key of ["verified", "trustLevel", "claimSource", "independent"]) {
      await expect(
        bridge.submitEffectSignal(handle.db, {
          ownerId: OWNER,
          subjectKind: "effect-subject",
          subjectId: "device-claim",
          observationType: "state",
          payload: { state: "ON", [key]: true },
          channel: "PROVIDER_RESPONSE",
          attemptId: attempt.id,
        }),
      ).rejects.toThrow(/AUTHORITY_REJECTED/);
    }
    const rows = await handle.db
      .select()
      .from(observations)
      .where(eq(observations.subjectId, "device-claim"));
    expect(rows).toHaveLength(0);
  });

  it("a capability output cannot verify itself", async () => {
    // The model and the executor both live on the far side of this line: the
    // capability's own return value is EXECUTOR_RETURN whatever it contains.
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-self",
      targetState: "ON",
    });
    const detail = attempt.verificationDetail as {
      completion?: { assertions?: Array<{ source: string }> };
    };
    for (const assertion of detail.completion?.assertions ?? []) {
      expect(["EXECUTOR_RETURN", "SELF_REPORTED"]).toContain(assertion.source);
    }
    expect(attempt.verificationStatus).not.toBe("VERIFIED");
  });

  // ── 6. Durable, auditable history ─────────────────────────────────────────

  it("verification transitions are appended, never overwritten", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-history",
      targetState: "ON",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "device-history",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
    });
    await reconcile(attempt.id);

    const changes = await handle.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.type, "VERIFICATION_CHANGED"));
    expect(changes.length).toBeGreaterThanOrEqual(2);

    const payloads = changes.map((row) => row.payload as { from: string | null; to: string });
    // The first verdict, and the transition to it. Both survive.
    expect(payloads[0]!.from).toBeNull();
    expect(payloads.at(-1)!.to).toBe("VERIFIED");
    // Each one carries the evidence it rested on.
    for (const row of changes) {
      expect((row.payload as { assertions?: unknown[] }).assertions).toBeInstanceOf(Array);
    }
  });

  it("an observation is recorded as an event a realtime subscriber can resume from", async () => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: "device-event",
      targetState: "ON",
    });
    await observe({
      attemptId: attempt.id,
      subjectId: "device-event",
      state: "ON",
      channel: "AUTHENTICATED_TELEMETRY",
      correlationId: "telemetry-1",
    });
    const [event] = await handle.db
      .select()
      .from(runEvents)
      .where(eq(runEvents.type, "OBSERVATION_RECORDED"));
    expect(event).toBeTruthy();
    expect(event!.ownerId).toBe(OWNER);
    expect(event!.correlationId).toBe("telemetry-1");
    // A cursor exists, and the event says nothing that could be read as a verdict.
    expect(typeof event!.id).toBe("number");
    expect(JSON.stringify(event!.payload)).not.toContain("VERIFIED");
  });

  // ── 7. Holdout generality ─────────────────────────────────────────────────

  /**
   * Unfamiliar domains, run through the SAME capability and the SAME
   * declaration. Nothing below required a new branch, a new observation type
   * or a new verifier — which is the whole test.
   */
  const HOLDOUTS = [
    { subject: "valve-77", target: "CLOSED", label: "an industrial valve changed state" },
    { subject: "instrument-3", target: "CALIBRATED", label: "a laboratory instrument finished a calibration cycle" },
    { subject: "generator-12", target: "SUPPLYING", label: "a temporary generator started supplying power" },
    { subject: "chamber-4", target: "AT_TEMPERATURE", label: "a cold-storage chamber reached its target" },
    { subject: "lent-item-9", target: "RETURNED", label: "a community resource was physically returned" },
  ] as const;

  it.each(HOLDOUTS)("holdout: $label verifies with no new domain code", async (holdout) => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: holdout.subject,
      targetState: holdout.target,
    });
    expect(attempt.verificationStatus).not.toBe("VERIFIED");

    await observe({
      attemptId: attempt.id,
      subjectId: holdout.subject,
      state: holdout.target,
      channel: "AUTHENTICATED_TELEMETRY",
    });
    const after = await reconcile(attempt.id);
    expect(after.status).toBe("VERIFIED");
  });

  it.each(HOLDOUTS)("holdout: $label is NOT verified by the wrong reading", async (holdout) => {
    const { attempt } = await runNode({
      capabilityId: KINDS.device,
      subjectId: `${holdout.subject}-neg`,
      targetState: holdout.target,
    });
    await observe({
      attemptId: attempt.id,
      subjectId: `${holdout.subject}-neg`,
      state: "SOMETHING_ELSE",
      channel: "AUTHENTICATED_TELEMETRY",
    });
    const after = await reconcile(attempt.id);
    expect(after.status).not.toBe("VERIFIED");
  });
});
