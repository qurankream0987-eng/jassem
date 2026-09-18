import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { dagNodes, executionAttempts, observations } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import {
  EffectSignalError,
  claimSourceForChannel,
  observationEvidence,
  submitEffectSignal,
  type EffectSignalChannel,
} from "../../api/runtime/effect-observation-bridge";
import { completionPolicyFor, decideCompletion } from "../../api/runtime/completion-policy";
import { freshnessOf } from "../../api/runtime/block2/observations";

/**
 * THE EFFECT-SIGNAL → OBSERVATION → VERIFICATION BRIDGE.
 *
 * Every case runs against a real database with real attempt rows, because the
 * properties under test — attempt binding, owner scope, replay, freshness —
 * are all properties of persisted rows and cannot be proven in memory.
 *
 * PROVEN_AT_RUNTIME_CONTRACT_LEVEL, not PROVEN_IN_REAL_WORLD: the signals come
 * from deterministic fixtures. No real device, human or messaging provider
 * exists, and none is claimed.
 */

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
const OWNER = "9300";
const OTHER = "9301";

/** A real run with a real attempt, so evidence has something to bind to. */
async function attemptFor(owner: string, key: string): Promise<{ attemptId: string }> {
  const run = await runtime.createRuntimeRun({
    ownerId: owner, goal: `bridge ${key}`, idempotencyKey: `bridge-${key}`,
  });
  await runtime.createRuntimeDag({
    ownerId: owner, runId: run.id,
    nodes: [{ nodeKey: "A", capabilityId: "local-calculation", inputs: { values: [1, 1] }, maxAttempts: 1 }],
  });
  await runtime.driveRunToCompletion(run.id, owner, "bridge-worker");
  const [attempt] = await handle.db.select().from(executionAttempts)
    .where(eq(executionAttempts.runId, run.id));
  return { attemptId: attempt!.id };
}

const SUBJECT = { subjectKind: "runtime_subject", subjectId: "subject-1", observationType: "state" };
const OCCURRED = { occurredWhen: (p: Record<string, unknown>) => p.state === "PRESENT",
                   notOccurredWhen: (p: Record<string, unknown>) => p.state === "ABSENT" };

async function signal(
  attemptId: string,
  channel: EffectSignalChannel,
  payload: Record<string, unknown>,
  extra: Partial<Parameters<typeof submitEffectSignal>[1]> = {},
) {
  return submitEffectSignal(handle.db, {
    ownerId: OWNER, ...SUBJECT, payload, channel, attemptId, ...extra,
  });
}

describe("effect signals become canonical observations, and only the runtime grades them", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    runtime = await import("../../api/runtime/jasim-runtime");
  });
  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE observations, events CASCADE"));
  });
  afterAll(async () => { await handle.pool.end(); });

  // ── B-01 ────────────────────────────────────────────────────────────────
  it("B-01 — a provider claim alone becomes an Observation and verifies nothing", async () => {
    const { attemptId } = await attemptFor(OWNER, "b01");
    const row = await signal(attemptId, "PROVIDER_RESPONSE", { state: "PRESENT" });

    // It IS a canonical observation…
    expect(row.id).toMatch(/^obs_/);
    expect(row.sourceKind).toBe("self_report");
    // …and its recorded class is one no effectful policy accepts.
    expect((row.provenance as { claimSource: string }).claimSource).toBe("SELF_REPORTED");

    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(evidence!.assertion.source).toBe("SELF_REPORTED");
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("PENDING");
  });

  // ── B-02 ────────────────────────────────────────────────────────────────
  it("B-02 — an independent readback verifies", async () => {
    const { attemptId } = await attemptFor(OWNER, "b02");
    await signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" });
    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(evidence!.assertion.source).toBe("INDEPENDENT_READBACK");
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("VERIFIED");
  });

  // ── B-03 ────────────────────────────────────────────────────────────────
  it("B-03 — a stale readback is not sufficient, and the run says why", async () => {
    const { attemptId } = await attemptFor(OWNER, "b03");
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60_000);
    // Observed half an hour ago with a 30-second horizon.
    const row = await signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" }, {
      observedAt: thirtyMinutesAgo, freshnessTtlMs: 30_000,
    });
    expect(freshnessOf(row)).toBe("STALE");

    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(evidence!.assertion.state).toBe("UNCERTAIN");
    expect(evidence!.assertion.notes!.join(" ")).toMatch(/stale/i);
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("INCONCLUSIVE");
  });

  it("B-03b — a policy may demand more currency than the row's own horizon", async () => {
    const { attemptId } = await attemptFor(OWNER, "b03b");
    // Fresh by its own TTL (an hour), but five minutes old.
    await signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" }, {
      observedAt: new Date(Date.now() - 5 * 60_000), freshnessTtlMs: 60 * 60_000,
    });
    const lenient = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(lenient!.assertion.state).toBe("OCCURRED");
    // The same row, against a policy needing 30 seconds, is not evidence.
    const strict = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED, maxAgeMs: 30_000,
    });
    expect(strict).toBeUndefined();
  });

  // ── B-04 ────────────────────────────────────────────────────────────────
  it("B-04 — owner A cannot inject evidence for owner B's attempt", async () => {
    const { attemptId } = await attemptFor(OTHER, "b04");
    // A real attempt id, submitted by the wrong owner. A raw id is not authority.
    await expect(
      submitEffectSignal(handle.db, {
        ownerId: OWNER, ...SUBJECT, payload: { state: "PRESENT" },
        channel: "RUNTIME_READBACK", attemptId,
      }),
    ).rejects.toThrow(EffectSignalError);
    expect(await handle.db.select().from(observations)).toHaveLength(0);
  });

  it("B-04b — an unknown attempt id is refused", async () => {
    await expect(
      submitEffectSignal(handle.db, {
        ownerId: OWNER, ...SUBJECT, payload: { state: "PRESENT" },
        channel: "RUNTIME_READBACK", attemptId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/attempt/i);
  });

  // ── B-05 ────────────────────────────────────────────────────────────────
  it("B-05 — evidence for one attempt is not evidence for another", async () => {
    const first = await attemptFor(OWNER, "b05a");
    const second = await attemptFor(OWNER, "b05b");
    await signal(first.attemptId, "RUNTIME_READBACK", { state: "PRESENT" });

    // Same owner, same subject, same value — and bound to a different attempt.
    const replayed = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId: second.attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(replayed).toBeUndefined();
    // The original still resolves, so the row was not merely invisible.
    const original = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId: first.attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(original!.assertion.state).toBe("OCCURRED");
  });

  // ── B-06 ────────────────────────────────────────────────────────────────
  it("B-06 — conflicting observations never produce a quiet success", async () => {
    const { attemptId } = await attemptFor(OWNER, "b06");
    await signal(attemptId, "PROVIDER_RESPONSE", { state: "PRESENT" });
    await signal(attemptId, "AUTHENTICATED_TELEMETRY", { state: "ABSENT" });

    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(evidence!.assertion.state).toBe("UNCERTAIN");
    expect(evidence!.assertion.notes!.join(" ")).toMatch(/disagree/i);
    // Both survive in the ledger — conflicting evidence is preserved, not resolved away.
    expect(evidence!.considered).toHaveLength(2);
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("INCONCLUSIVE");
  });

  // ── B-07 ────────────────────────────────────────────────────────────────
  it("B-07 — a command receipt is not a state observation", async () => {
    const { attemptId } = await attemptFor(OWNER, "b07");
    // The provider acknowledges the command…
    await submitEffectSignal(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "subject-1",
      observationType: "command_receipt", payload: { accepted: true },
      channel: "PROVIDER_RESPONSE", attemptId,
    });
    // …which says nothing about the subject's STATE.
    const stateEvidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(stateEvidence).toBeUndefined();

    // Telemetry then reports the state, and only that verifies.
    await signal(attemptId, "AUTHENTICATED_TELEMETRY", { state: "PRESENT" }, {
      freshnessTtlMs: 60_000,
    });
    const after = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(after!.assertion.source).toBe("INDEPENDENT_READBACK");
    expect(
      decideCompletion({
        policy: completionPolicyFor("DEVICE_COMMAND"),
        outputShapeValid: true,
        assertions: [after!.assertion],
      }).decision,
    ).toBe("VERIFIED");
  });

  // ── B-08 ────────────────────────────────────────────────────────────────
  it("B-08 — DELIVERED is never inferred from SENT", async () => {
    const { attemptId } = await attemptFor(OWNER, "b08");
    await submitEffectSignal(handle.db, {
      ownerId: OWNER, subjectKind: "runtime_subject", subjectId: "msg-1",
      observationType: "sent", payload: { at: "now" },
      channel: "PROVIDER_RESPONSE", attemptId,
    });
    // A policy asking about DELIVERY finds nothing, because nothing observed it.
    const delivery = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId,
      subjectKind: "runtime_subject", subjectId: "msg-1", observationType: "delivered",
      occurredWhen: (p) => p.delivered === true,
    });
    expect(delivery).toBeUndefined();
    expect(
      decideCompletion({
        policy: completionPolicyFor("MESSAGE_DISPATCH"),
        outputShapeValid: true,
        assertions: [],
      }).decision,
    ).toBe("PENDING");
  });

  // ── B-09 ────────────────────────────────────────────────────────────────
  it("B-09 — an HTTP 200 POST is not independent evidence of existence", async () => {
    const { attemptId } = await attemptFor(OWNER, "b09");
    await signal(attemptId, "PROVIDER_RESPONSE", { state: "PRESENT" });
    const claimOnly = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [claimOnly!.assertion],
      }).decision,
    ).toBe("PENDING");

    // A separate readback of the owning authority does verify it.
    await signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" });
    const readback = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(readback!.assertion.source).toBe("INDEPENDENT_READBACK");
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [readback!.assertion],
      }).decision,
    ).toBe("VERIFIED");
  });

  // ── B-10 ────────────────────────────────────────────────────────────────
  it("B-10 — a human provider's report is a claim, not a confirmation", async () => {
    const { attemptId } = await attemptFor(OWNER, "b10");
    await signal(attemptId, "HUMAN_PROVIDER_REPORT", { state: "PRESENT" });
    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(evidence!.assertion.source).toBe("SELF_REPORTED");
    expect(
      decideCompletion({
        policy: completionPolicyFor("HUMAN_ACTION"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("PENDING");

    // The OWNER confirming it is a different channel and a different class.
    await signal(attemptId, "OWNER_CONFIRMATION", { state: "PRESENT" });
    const confirmed = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    expect(confirmed!.assertion.source).toBe("OWNER_CONFIRMATION");
    expect(
      decideCompletion({
        policy: completionPolicyFor("HUMAN_ACTION"),
        outputShapeValid: true,
        assertions: [confirmed!.assertion],
      }).decision,
    ).toBe("VERIFIED");
  });

  // ── B-11 ────────────────────────────────────────────────────────────────
  it("B-11 — the same bridge verifies a compensation's effect", async () => {
    const { attemptId } = await attemptFor(OWNER, "b11");
    // The compensating effect is ABSENCE. No separate infrastructure.
    await signal(attemptId, "RUNTIME_READBACK", { state: "ABSENT" });
    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT,
      occurredWhen: (p) => p.state === "ABSENT",
      notOccurredWhen: (p) => p.state === "PRESENT",
    });
    expect(evidence!.assertion.state).toBe("OCCURRED");
    expect(evidence!.assertion.source).toBe("INDEPENDENT_READBACK");
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("VERIFIED");
  });

  // ── B-12 ────────────────────────────────────────────────────────────────
  it("B-12 — a duplicate callback adds a row without changing the verdict", async () => {
    const { attemptId } = await attemptFor(OWNER, "b12");
    const observedAt = new Date(Date.now() - 1_000);
    await signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" }, { observedAt });
    await signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" }, { observedAt });

    const evidence = await observationEvidence(handle.db, {
      ownerId: OWNER, attemptId, ...SUBJECT, ...OCCURRED,
    });
    // Both rows are kept: an observation is an append-only fact, and a repeated
    // reading is not a lie. Agreement is not conflict, so the verdict stands.
    expect(evidence!.considered.length).toBe(2);
    expect(evidence!.assertion.state).toBe("OCCURRED");
    expect(
      decideCompletion({
        policy: completionPolicyFor("REMOTE_MUTATION"),
        outputShapeValid: true,
        assertions: [evidence!.assertion],
      }).decision,
    ).toBe("VERIFIED");
  });

  // ── Authority ───────────────────────────────────────────────────────────
  it("a submitted payload may never name its own trust class", async () => {
    const { attemptId } = await attemptFor(OWNER, "auth");
    for (const key of ["trustLevel", "verified", "independent", "providerVerified", "effectVerified", "proofClass", "source"]) {
      await expect(
        signal(attemptId, "PROVIDER_RESPONSE", { state: "PRESENT", [key]: true }),
        key,
      ).rejects.toThrow(EffectSignalError);
    }
    expect(await handle.db.select().from(observations)).toHaveLength(0);
  });

  it("no channel can produce a bound provider receipt, and a claim can never self-upgrade", () => {
    const channels: EffectSignalChannel[] = [
      "PROVIDER_RESPONSE", "HUMAN_PROVIDER_REPORT", "AUTHENTICATED_TELEMETRY",
      "RUNTIME_READBACK", "INTERNAL_STATE_READBACK", "OWNER_CONFIRMATION",
    ];
    for (const channel of channels) {
      expect(claimSourceForChannel(channel), channel).not.toBe("BOUND_PROVIDER_RECEIPT");
      expect(claimSourceForChannel(channel), channel).not.toBe("EXECUTOR_RETURN");
    }
    // The two channels that are a party's own word map to the class no
    // effectful policy accepts.
    expect(claimSourceForChannel("PROVIDER_RESPONSE")).toBe("SELF_REPORTED");
    expect(claimSourceForChannel("HUMAN_PROVIDER_REPORT")).toBe("SELF_REPORTED");
  });

  it("an observation from the future is refused", async () => {
    const { attemptId } = await attemptFor(OWNER, "future");
    await expect(
      signal(attemptId, "RUNTIME_READBACK", { state: "PRESENT" }, {
        observedAt: new Date(Date.now() + 10 * 60_000),
      }),
    ).rejects.toThrow(/future/i);
  });

  it("the bridge's rows stay consumable by the existing freshness projection", async () => {
    const { attemptId } = await attemptFor(OWNER, "present");
    const fresh = await signal(attemptId, "AUTHENTICATED_TELEMETRY", { state: "PRESENT" }, {
      freshnessTtlMs: 60_000,
    });
    const stale = await signal(attemptId, "AUTHENTICATED_TELEMETRY", { state: "PRESENT" }, {
      observedAt: new Date(Date.now() - 10 * 60_000), freshnessTtlMs: 1_000,
    });
    // The same canonical rows support verification AND the presentation
    // pipeline, which is the point of bridging into this table rather than a
    // private one.
    expect(freshnessOf(fresh)).toBe("FRESH");
    expect(freshnessOf(stale)).toBe("STALE");
  });
});
