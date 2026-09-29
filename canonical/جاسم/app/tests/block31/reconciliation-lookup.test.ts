/**
 * JASIM — AN UNCERTAIN EFFECT MUST BE ABLE TO BECOME CERTAIN.
 *
 * ─── THE GAP, TRACED ON THE LIVE PATH BEFORE IT WAS FILLED ──────────────────
 *
 *   findUncertainExecutionAttempts   → 0 callers. Not the runtime, not a
 *                                      router, not a job, not even a test.
 *   reconcileUncertainAttempt        → 0 production callers.
 *   a capability declaring a lookup  → impossible; `lookup` was a parameter,
 *                                      so only a test could ever supply one.
 *
 * JASIM's refusal to retry an uncertain effect was real and is proven
 * elsewhere. What was missing is the other half: nothing could ever find out.
 * A process that died mid-execution left an effect uncertain FOREVER, and the
 * one source that can carry an effect to VERIFIED — INDEPENDENT_READBACK —
 * was unreachable from anything JASIM does on its own.
 *
 *   UNCERTAIN_FOREVER = 0
 *
 * Not knowing is honest. Having no way to find out is not.
 *
 * ─── AND THREE DEFECTS INSIDE THE MECHANISM ─────────────────────────────────
 *
 *   NO_ANSWER != NOT_OCCURRED
 *     The answer shape was `occurred | not_occurred`. An authority that could
 *     not tell had to say "it did not happen", and the runtime wrote FAILED
 *     and failed the DAG node. A silence was being converted into a failure.
 *
 *   EXECUTOR_RETURN != INDEPENDENT_READBACK
 *     The assertion took its authority from `attempt.providerReference` — the
 *     executor's OWN return — or from the capability id, which is the executor
 *     itself. Every readback was "independent" of nothing at all.
 *
 *   LOOKUP != RETRY
 *     Nothing stopped a capability from declaring its executor as its lookup,
 *     which would have made every reconciliation pass a second execution — a
 *     blind retry arriving from the one direction nobody watches.
 *
 * ─── ONE DECLARATION, MANY WORLDS ───────────────────────────────────────────
 *
 * Every scenario below runs through ONE lookup signature on ordinary
 * capabilities. A warehouse mutation, a device command and a person's action
 * differ only in the strings travelling through it. There is no
 * ShippingReconciler and no PaymentReconciler:
 *
 *   DOMAIN_RECONCILERS_ADDED = 0
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { events as runEvents } from "@db/schema";
import { dagNodes, executionAttempts } from "@db/schema-runtime";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";
import type {
  ReconciliationAnswer,
  ReconciliationSubject,
} from "../../api/runtime/reconciliation-lookup";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let CapabilityRegistry: typeof import("../../api/runtime/capability-registry").CapabilityRegistry;

const OWNER = "reconcile-owner";
const OTHER_OWNER = "reconcile-other";

/** Three unrelated worlds, one signature. */
const KINDS = {
  /** A stock movement in somebody's inventory system. */
  remote: "test-reconcile-remote",
  /** A command sent to a machine. */
  device: "test-reconcile-device",
  /** Something a person was asked to do. */
  human: "test-reconcile-human",
  /** The control: declares no lookup. Nobody to ask. */
  silent: "test-reconcile-silent",
} as const;

/** What the owning system will say, set per test. */
let answer: ReconciliationAnswer;
/** Every subject the lookup was handed, so LOOKUP != RETRY can be inspected. */
let asked: ReconciliationSubject[] = [];

function buildRegistry(overrides?: {
  lookupIsExecutor?: boolean;
}): InstanceType<typeof CapabilityRegistry> {
  const registry = new CapabilityRegistry({
    allowTestOnly: true,
    allowedTestCapabilityIds: new Set(Object.values(KINDS)),
  });

  const execute = async (inputs: Record<string, unknown>) => ({
    subjectId: String(inputs.subjectId ?? ""),
    // The reference the EXECUTOR returns. Carried so the owning system can be
    // asked about the right row — never so it can be quoted back as the
    // authority that answered.
    providerReference: String(inputs.subjectId ?? ""),
    effect: { state: "PENDING" as const },
  });

  /**
   * THE declaration. It reads and returns; it recognises no noun, no state and
   * no domain. Three effect classes share it unchanged.
   */
  const reconciliationLookup = async (
    subject: ReconciliationSubject,
  ): Promise<ReconciliationAnswer> => {
    asked.push(subject);
    return answer;
  };

  for (const [name, id] of Object.entries(KINDS)) {
    registry.register({
      id,
      aliases: [],
      risk: "low",
      sideEffects: "local_test",
      testOnly: true,
      effectKind:
        name === "device"
          ? "DEVICE_COMMAND"
          : name === "human"
            ? "HUMAN_ACTION"
            : "REMOTE_MUTATION",
      ...(name === "silent"
        ? {}
        : { reconciliationLookup: overrides?.lookupIsExecutor ? execute : reconciliationLookup }),
      execute,
    });
  }
  return registry;
}

describe("an uncertain effect can be asked about, and only a real authority answers", () => {
  let registry: InstanceType<typeof CapabilityRegistry>;

  beforeAll(async () => {
    handle = await getTestDb();
    runtime = await import("../../api/runtime/jasim-runtime");
    ({ CapabilityRegistry } = await import("../../api/runtime/capability-registry"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(sql.raw("TRUNCATE TABLE events CASCADE"));
    asked = [];
    answer = { outcome: "UNKNOWN" };
    registry = buildRegistry();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Producing a genuinely uncertain attempt ────────────────────────────────
  //
  // The supported crash simulation: the capability ran, and the process died
  // before anything recorded what came of it. Both the immutable attempt and
  // the leased node are left RUNNING — exactly the state a killed container
  // leaves behind.

  async function crashedAttempt(input: {
    capabilityId: string;
    subjectId: string;
    owner?: string;
    ageMs?: number;
    providerReference?: string;
  }) {
    const owner = input.owner ?? OWNER;
    const run = await runtime.createRuntimeRun({
      ownerId: owner,
      goal: `reconcile: ${input.subjectId}`,
      idempotencyKey: `reconcile-${randomUUID()}`,
    });
    await runtime.createRuntimeDag({
      ownerId: owner,
      runId: run.id,
      nodes: [
        {
          nodeKey: "act",
          capabilityId: input.capabilityId,
          inputs: { subjectId: input.subjectId },
          maxAttempts: 1,
        },
      ],
      capabilityRegistry: registry,
    });
    await expect(
      runtime.executeRuntimeDagNode({
        ownerId: owner,
        runId: run.id,
        workerId: "reconcile-worker",
        capabilityRegistry: registry,
        simulateCrashAfterCapability: true,
        capabilityExecutor: async ({ capabilityId, inputs, context }) =>
          registry.executeTrusted(capabilityId, inputs, context),
      }),
    ).rejects.toThrow(/CRASH/i);

    // Age it past the staleness cutoff, the way wall-clock time would.
    const startedAt = new Date(Date.now() - (input.ageMs ?? 30 * 60_000));
    await handle.db
      .update(executionAttempts)
      .set({
        startedAt,
        // What the EXECUTOR said about itself, recorded before the process
        // died. It is a pointer for the owning system and never evidence.
        ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      })
      .where(eq(executionAttempts.runId, run.id));

    const [attempt] = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, run.id));
    const [node] = await handle.db
      .select()
      .from(dagNodes)
      .where(eq(dagNodes.runId, run.id));
    expect(attempt!.executionStatus).toBe("RUNNING");
    expect(node!.status).toBe("RUNNING");
    return { run, attempt: attempt!, node: node! };
  }

  const readAttempt = async (attemptId: string) =>
    (await handle.db.select().from(executionAttempts).where(eq(executionAttempts.id, attemptId)))[0]!;
  const readNode = async (nodeId: string) =>
    (await handle.db.select().from(dagNodes).where(eq(dagNodes.id, nodeId)))[0]!;

  async function reconciliationAssertions(runId: string) {
    const rows = await handle.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "VERIFICATION_CHANGED")));
    return rows.flatMap((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      if (payload.stage !== "RECONCILIATION") return [];
      return (payload.assertions ?? []) as Array<Record<string, unknown>>;
    });
  }

  // ── 1. THE GAP ITSELF ──────────────────────────────────────────────────────

  it("a capability with nobody to ask is visited, left alone, and counted as unanswerable", async () => {
    // This is the state EVERY uncertain attempt was in before this phase: the
    // refusal to guess was right, and there was no second half to it.
    const { attempt, node } = await crashedAttempt({
      capabilityId: KINDS.silent,
      subjectId: "subject-silent",
    });

    const swept = await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    expect(swept.examined).toBe(1);
    expect(swept.unanswerable).toBe(1);
    expect(swept.resolved).toBe(0);
    // Untouched. An attempt nobody can answer for is not a failed attempt.
    expect((await readAttempt(attempt.id)).executionStatus).toBe("RUNNING");
    expect((await readNode(node.id)).status).toBe("RUNNING");
    expect(asked).toHaveLength(0);
  });

  // ── 2. UNCERTAIN_FOREVER = 0 ───────────────────────────────────────────────

  it("the owning system is asked, and the effect reaches VERIFIED without any caller supplying a lookup", async () => {
    answer = {
      outcome: "OCCURRED",
      authority: "the-inventory-system",
      reference: "movement-88213",
      result: { moved: true },
    };
    const { run, attempt, node } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-remote",
      providerReference: "subject-remote",
    });

    // NOBODY passes a lookup here. It is read off the capability contract, the
    // way `effectKind` and `compensation` already are.
    const swept = await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    expect(swept.resolved).toBe(1);
    expect(swept.unanswerable).toBe(0);
    expect(asked).toHaveLength(1);
    // The owning system was told WHICH row to look at — the executor's own
    // returned reference, handed over as a pointer and not as evidence.
    expect(asked[0]!.providerReference).toBe("subject-remote");
    expect(asked[0]!.capabilityId).toBe(KINDS.remote);

    const reconciled = await readAttempt(attempt.id);
    expect(reconciled.executionStatus).toBe("COMPLETED");
    expect(reconciled.verificationStatus).toBe("VERIFIED");
    expect((await readNode(node.id)).status).toBe("COMPLETED");

    const independentDetail = (reconciled.verificationDetail ?? {}) as Record<string, unknown>;
    expect(((independentDetail.completion ?? {}) as Record<string, unknown>).confirmedBy).toBe(
      "INDEPENDENT_READBACK",
    );

    const assertions = await reconciliationAssertions(run.id);
    const independent = assertions.find((entry) => entry.source === "INDEPENDENT_READBACK");
    expect(independent).toBeDefined();
    // The authority is the SYSTEM, named by the answer.
    expect(independent!.authority).toBe("the-inventory-system");
    // OCCURRED_WITHOUT_A_REFERENCE = 0 — it named what it was confirming.
    expect(independent!.reference).toBe("movement-88213");
  });

  it("the same declaration resolves a device command and a person's action, with no code of their own", async () => {
    for (const capabilityId of [KINDS.device, KINDS.human]) {
      await resetBlock31(handle.db);
      asked = [];
      answer = {
        outcome: "OCCURRED",
        authority: `authority-for-${capabilityId}`,
        reference: `ref-${capabilityId}`,
        result: { confirmedState: "REACHED" },
      };
      const { attempt } = await crashedAttempt({ capabilityId, subjectId: `s-${capabilityId}` });
      await runtime.reconcileUncertainAttemptsForScope({
        ownerId: OWNER,
        capabilityRegistry: registry,
      });
      expect((await readAttempt(attempt.id)).verificationStatus, capabilityId).toBe("VERIFIED");
    }
  });

  // ── 3. NO_ANSWER != NOT_OCCURRED ───────────────────────────────────────────

  it("an authority that cannot tell leaves the attempt uncertain and never writes a failure", async () => {
    // Under the old two-outcome shape this answer was UNREPRESENTABLE: the
    // lookup had to claim `not_occurred`, the runtime wrote FAILED, and the
    // DAG node was failed. A silence was manufactured into a failure.
    answer = { outcome: "UNKNOWN", notes: ["the system is reachable and has no record either way"] };
    const { attempt, node } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-silence",
    });

    const swept = await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    expect(asked).toHaveLength(1);
    expect(swept.unresolved).toBe(1);
    expect(swept.resolved).toBe(0);
    // Not a resolution and NOT a failure.
    const after = await readAttempt(attempt.id);
    expect(after.executionStatus).toBe("INCONCLUSIVE");
    expect(after.executionStatus).not.toBe("FAILED");
    expect(after.verificationStatus).not.toBe("VERIFIED");
    // The node keeps its lease. Failing it on a silence would invent the
    // failure this whole layer exists to avoid inventing.
    expect((await readNode(node.id)).status).toBe("RUNNING");
    const detail = (after.verificationDetail ?? {}) as Record<string, unknown>;
    expect(detail.reconciliationLookup).toBe("UNKNOWN");
  });

  it("an authority that says it did not happen does close it", async () => {
    answer = { outcome: "NOT_OCCURRED", authority: "the-inventory-system" };
    const { attempt, node } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-no",
    });

    const swept = await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    expect(swept.resolved).toBe(1);
    expect((await readAttempt(attempt.id)).executionStatus).toBe("FAILED");
    expect((await readNode(node.id)).status).not.toBe("RUNNING");
  });

  it("a confirmation carrying no record does not verify, and says exactly why", async () => {
    //   CONFIRMED_WITHOUT_A_RECORD = 0
    //
    // Found while proving this file. An authority that confirms and hands back
    // nothing leaves an empty canonical payload; the verifier's OUTPUT half
    // reads OUTPUT_SHAPE_NOT_VALID and the effect stays INCONCLUSIVE. That is
    // the right verdict and it used to be silent. The type now requires a
    // record, and an EMPTY one still fails here rather than being padded into
    // something that looks like one.
    answer = {
      outcome: "OCCURRED",
      authority: "the-inventory-system",
      reference: "movement-empty",
      result: {},
    };
    const { attempt } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-empty",
    });

    await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    const after = await readAttempt(attempt.id);
    expect(after.verificationStatus).not.toBe("VERIFIED");
    const detail = (after.verificationDetail ?? {}) as Record<string, unknown>;
    const completion = (detail.completion ?? {}) as Record<string, unknown>;
    expect(completion.reasonCode).toBe("OUTPUT_SHAPE_NOT_VALID");
  });

  // ── 4. EXECUTOR_RETURN != INDEPENDENT_READBACK ─────────────────────────────

  it("an answer whose authority is the capability itself is SELF_REPORTED and verifies nothing", async () => {
    // The executor answering about the executor. Before this phase the
    // authority was LITERALLY `attempt.capabilityId` when no provider
    // reference existed, and the source was granted INDEPENDENT_READBACK
    // unconditionally — so this exact shape verified a remote mutation.
    answer = {
      outcome: "OCCURRED",
      authority: KINDS.remote,
      reference: "movement-88213",
      result: { moved: true },
    };
    const { attempt } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-self",
    });

    await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    // Read from the attempt itself, not from the event ledger: a verification
    // that did not MOVE appends no event on purpose ("unchanged is not a
    // transition"), and the whole point here is that it did not move.
    const after = await readAttempt(attempt.id);
    const detail = (after.verificationDetail ?? {}) as Record<string, unknown>;
    const completion = (detail.completion ?? {}) as Record<string, unknown>;
    // The answer WAS heard — it is on the row — and it bought nothing.
    expect(detail.reconciliationLookup).toBe("OCCURRED");
    expect(completion.confirmedBy).toBeUndefined();
    expect(after.verificationStatus).not.toBe("VERIFIED");
  });

  it("an answer whose authority is the executor's own returned reference is SELF_REPORTED too", async () => {
    // Subtler, and it was the DEFAULT before this phase: `providerReference`
    // is what the executor said about itself, so an authority equal to it is
    // the claim under examination wearing the authority's clothes.
    answer = {
      outcome: "OCCURRED",
      authority: "subject-echo",
      reference: "movement-1",
      result: { moved: true },
    };
    const { attempt } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-echo",
      providerReference: "subject-echo",
    });

    await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    const after = await readAttempt(attempt.id);
    const detail = (after.verificationDetail ?? {}) as Record<string, unknown>;
    const completion = (detail.completion ?? {}) as Record<string, unknown>;
    expect(detail.reconciliationLookup).toBe("OCCURRED");
    expect(completion.confirmedBy).toBeUndefined();
    expect(after.verificationStatus).not.toBe("VERIFIED");
  });

  // ── 5. LOOKUP != RETRY ─────────────────────────────────────────────────────

  it("a capability cannot declare its own executor as its lookup", () => {
    expect(() => buildRegistry({ lookupIsExecutor: true })).toThrow(
      /must never cause it to happen/,
    );
  });

  it("asking never runs the capability again", async () => {
    answer = {
      outcome: "OCCURRED",
      authority: "the-inventory-system",
      reference: "m-1",
      result: { moved: true },
    };
    const { attempt } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-once",
    });

    await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });
    await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    // One attempt row, ever. Reconciliation resolves an attempt; it never
    // opens another one.
    const rows = await handle.db
      .select()
      .from(executionAttempts)
      .where(eq(executionAttempts.runId, attempt.runId));
    expect(rows).toHaveLength(1);
  });

  // ── 6. SCOPE, AND FRESHNESS ────────────────────────────────────────────────

  it("one scope's sweep never touches another scope's uncertain attempt", async () => {
    answer = {
      outcome: "OCCURRED",
      authority: "the-inventory-system",
      reference: "m-2",
      result: { moved: true },
    };
    const mine = await crashedAttempt({ capabilityId: KINDS.remote, subjectId: "mine" });
    const theirs = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "theirs",
      owner: OTHER_OWNER,
    });

    const swept = await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    expect(swept.examined).toBe(1);
    expect((await readAttempt(mine.attempt.id)).verificationStatus).toBe("VERIFIED");
    expect((await readAttempt(theirs.attempt.id)).executionStatus).toBe("RUNNING");
  });

  it("an attempt that is merely in flight is not treated as uncertain", async () => {
    answer = {
      outcome: "OCCURRED",
      authority: "the-inventory-system",
      reference: "m-3",
      result: { moved: true },
    };
    const { attempt } = await crashedAttempt({
      capabilityId: KINDS.remote,
      subjectId: "subject-fresh",
      ageMs: 0,
    });

    const swept = await runtime.reconcileUncertainAttemptsForScope({
      ownerId: OWNER,
      capabilityRegistry: registry,
    });

    expect(swept.examined).toBe(0);
    expect(asked).toHaveLength(0);
    expect((await readAttempt(attempt.id)).executionStatus).toBe("RUNNING");
  });

  // ── 7. STRUCTURE ───────────────────────────────────────────────────────────

  it("the duty cycle that already exists is the one that asks", () => {
    //   SECOND_SCHEDULERS_ADDED = 0
    const jobs = readFileSync("api/runtime/block2/jobs.ts", "utf8");
    expect(jobs).toContain("sweepUncertainAttempts");
    expect(jobs).toContain("uncertainAttempts");
    // No timer, no worker and no restart story of reconciliation's own.
    expect(jobs).not.toMatch(/setInterval\(|new Worker\(/);
  });

  it("a lookup is trusted registration code and nothing on a request path names one", () => {
    //   MODEL_SUPPLIES_A_LOOKUP = 0
    const sources = [
      "api/routers/runtime.ts",
      "api/runtime/block31/conversation-orchestrator.ts",
      "api/runtime/model-proposal.ts",
    ];
    for (const path of sources) {
      expect(readFileSync(path, "utf8"), path).not.toContain("reconciliationLookup");
    }
  });

  it("no domain reconciler was added", () => {
    //   DOMAIN_RECONCILERS_ADDED = 0
    // Comments are stripped first. The prose says out loud that there is no
    // ShippingReconciler and no WarehouseReconciler; the rule is about what
    // the CODE recognises, and naming what was refused is not a domain branch.
    const module = readFileSync("api/runtime/reconciliation-lookup.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of [
      "shipping", "payment", "warehouse", "inventory", "invoice", "stripe",
      "shopify", "restaurant", "vehicle", "doctor", "flight", "hotel",
    ]) {
      expect(module, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});
