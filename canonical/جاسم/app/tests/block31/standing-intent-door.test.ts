/**
 * JASIM — «إذا نزل تحت خمسين، جهّز لي طلباً — ولا تنفّذ بدون موافقتي».
 *
 * ─── THE DOOR, AND WHY IT CAME LAST ─────────────────────────────────────────
 *
 * Three phases built the chain this opens onto, in this order and deliberately:
 *
 *   1. a condition can become true            (the evaluator was never wired)
 *   2. a fired trigger can wake what it names (the wake knew only clocks)
 *   3. an act nobody is watching asks first   (approval was risk alone)
 *
 * The RULE came before the DOOR on purpose. Opening this first would have made
 * a low-risk standing act execute unattended the moment anybody used it.
 *
 * ─── WHAT THIS PROVES ───────────────────────────────────────────────────────
 *
 *   PREPARING IS NOT DOING · PREPARED_ONCE
 *   BEING TOLD != HAVING IT READY
 *   TWO_CONDITION_LANGUAGES = 0
 *   DOMAIN_STANDING_INTENTS_ADDED = 0
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { executionProposals, observations, runs, temporalTriggers } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let standing: typeof import("../../api/runtime/standing-intent");
let temporal: typeof import("../../api/runtime/block2/temporal");
let evaluatorFor: typeof import("../../api/runtime/condition-evaluator").canonicalConditionEvaluator;

const OWNER = "9101";

/** A subject and a reading. Neither means anything to anything below. */
const SUBJECT = { kind: "tracked_quantity", id: "thing-1" };
const READING = "level";

beforeAll(async () => {
  handle = await getTestDb();
  runtime = await import("../../api/runtime/jasim-runtime");
  standing = await import("../../api/runtime/standing-intent");
  temporal = await import("../../api/runtime/block2/temporal");
  ({ canonicalConditionEvaluator: evaluatorFor } = await import(
    "../../api/runtime/condition-evaluator"
  ));
});

beforeEach(async () => {
  await handle.db.execute(
    sql.raw(`TRUNCATE TABLE temporal_triggers, execution_proposals, runs,
      observations, messages, conversations, events CASCADE`),
  );
});

describe("parking an act behind a condition", () => {
  async function conversation() {
    return runtime.createRuntimeConversation({ ownerId: OWNER, title: "standing" });
  }

  async function park(over: Partial<Parameters<typeof standing.createStandingIntent>[0]> = {}) {
    const conv = await conversation();
    return standing.createStandingIntent({
      ownerId: OWNER,
      conversationId: conv.id,
      goal: "prepare it when the moment comes",
      capability: "notify",
      inputs: { recipientId: OWNER, purpose: "standing", title: "t", body: "b" },
      subjectKind: SUBJECT.kind,
      subjectId: SUBJECT.id,
      observationType: READING,
      when: { op: "less_than", field: "quantity", value: 50 },
      ...over,
    });
  }

  async function observe(quantity: number) {
    await handle.db.insert(observations).values({
      id: `obs_${randomUUID()}`,
      ownerId: OWNER,
      subjectKind: SUBJECT.kind,
      subjectId: SUBJECT.id,
      observationType: READING,
      payload: { quantity },
      observedAt: new Date(),
    });
  }

  /** The real sweep, with the real evaluator, dispatching to the real wake. */
  async function sweep() {
    const woken: Array<{ runId: string; outcome: string }> = [];
    await temporal.fireDueTemporalTriggers(
      handle.db,
      {
        async dispatch(job: { ownerId: string; payload: Record<string, unknown> }) {
          const runId = String(job.payload.runId ?? "");
          const outcome = await runtime.wakeRunFromTrigger({ runId, ownerId: job.ownerId });
          woken.push({ runId, outcome });
          return "enqueued" as const;
        },
      } as never,
      evaluatorFor(handle.db),
      // The trigger polls; make it due.
      { now: new Date(Date.now() + 120_000) },
    );
    return woken;
  }

  const proposalsFor = (runId: string) =>
    handle.db
      .select()
      .from(executionProposals)
      .where(and(eq(executionProposals.runId, runId), eq(executionProposals.ownerId, OWNER)));

  // ── 1. WHAT PARKING CREATES ────────────────────────────────────────────────

  it("a run that carries the act, and a trigger that NAMES it", async () => {
    const intent = await park();

    const [run] = await handle.db.select().from(runs).where(eq(runs.id, intent.runRef));
    expect(run!.requiredCapabilities).toEqual(["notify"]);
    // Created, not started: there is nothing to drive until the condition holds.
    expect(run!.status).toBe("created");

    const [trigger] = await handle.db
      .select().from(temporalTriggers).where(eq(temporalTriggers.id, intent.triggerRef));
    expect(trigger!.kind).toBe("CONDITION");
    //   A RUN A TRIGGER NAMES IS A STANDING RUN — on the row, not in a payload.
    expect(trigger!.runId).toBe(intent.runRef);

    // And nothing has been proposed, let alone run.
    expect(await proposalsFor(intent.runRef)).toHaveLength(0);
  });

  it("a condition nothing can read is refused now, while somebody is here", async () => {
    //   TWO_CONDITION_LANGUAGES = 0 — and refusing late would mean a standing
    //   intent that quietly answers «unknown» forever.
    await expect(park({ when: "quantity < 50" })).rejects.toThrow();
    await expect(park({ when: { op: "explode", field: "quantity" } })).rejects.toThrow();
    await expect(park({ subjectId: "  " })).rejects.toThrow(/about/i);
    await expect(park({ capability: "  " })).rejects.toThrow(/something to do/i);
  });

  // ── 2. NOTHING HAPPENS UNTIL IT HOLDS ──────────────────────────────────────

  it("while the condition does not hold, nothing is prepared", async () => {
    const intent = await park();
    await observe(120);
    const woken = await sweep();
    expect(woken).toHaveLength(0);
    expect(await proposalsFor(intent.runRef)).toHaveLength(0);
  });

  it("with no reading at all, nothing is prepared", async () => {
    const intent = await park();
    const woken = await sweep();
    expect(woken).toHaveLength(0);
    expect(await proposalsFor(intent.runRef)).toHaveLength(0);
  });

  // ── 3. IT HOLDS: PREPARED, AND ASKED ───────────────────────────────────────

  it("when it holds, the act is PREPARED and waits for the person", async () => {
    //   PREPARING IS NOT DOING
    const intent = await park();
    await observe(12);

    const woken = await sweep();
    expect(woken).toEqual([{ runId: intent.runRef, outcome: "PREPARED" }]);

    const proposals = await proposalsFor(intent.runRef);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.capabilityId).toBe("notify");
    // The rule from the phase before this one, doing its work: a low-risk act
    // on a standing run asks first.
    expect(proposals[0]!.approvalRequired).toBe(true);
    expect(proposals[0]!.status).toBe("awaiting_approval");
  });

  it("a condition that keeps holding does not keep asking", async () => {
    //   PREPARED_ONCE — three sweeps is not three purchases.
    const intent = await park();
    await observe(12);
    await sweep();
    const second = await sweep();
    const third = await sweep();
    for (const round of [second, third]) {
      for (const entry of round) expect(entry.outcome).not.toBe("PREPARED");
    }
    expect(await proposalsFor(intent.runRef)).toHaveLength(1);
  });

  it("the person decides, and only then is it authorized", async () => {
    const intent = await park();
    await observe(12);
    await sweep();
    const [proposal] = await proposalsFor(intent.runRef);

    const decided = await runtime.decideExecutionProposalApproval({
      ownerId: OWNER,
      proposalId: proposal!.id,
      decision: "approve",
    });
    // Authorized is not executed, and this runtime has always said so.
    expect(decided.status).toBe("authorized");
  });

  it("and rejecting it leaves nothing behind", async () => {
    const intent = await park();
    await observe(12);
    await sweep();
    const [proposal] = await proposalsFor(intent.runRef);
    const decided = await runtime.decideExecutionProposalApproval({
      ownerId: OWNER,
      proposalId: proposal!.id,
      decision: "reject",
    });
    expect(decided.status).toBe("rejected");
  });

  // ── 4. THE WAKE TELLS THE TWO KINDS APART ──────────────────────────────────

  it("a run with no act is not something this wake prepares", async () => {
    //   PREPARING IS NOT RESUMING
    const conv = await conversation();
    const plain = await runtime.createRuntimeRun({
      ownerId: OWNER,
      goal: "an ordinary run",
      idempotencyKey: `plain-${randomUUID()}`,
      conversationId: conv.id,
    });
    const outcome = await runtime.wakeRunFromTrigger({ runId: plain.id, ownerId: OWNER });
    expect(outcome).toBe("NOTHING");
    expect(await proposalsFor(plain.id)).toHaveLength(0);
  });

  it("somebody else's run is not woken", async () => {
    const intent = await park();
    const outcome = await runtime.wakeRunFromTrigger({
      runId: intent.runRef,
      ownerId: "9102",
    });
    expect(outcome).toBe("NOTHING");
    expect(await proposalsFor(intent.runRef)).toHaveLength(0);
  });

  // ── 5. THE DOOR IS A REQUEST, NEVER AN AUTHORITY ───────────────────────────

  it("the turn branch is checked before monitoring, and promises only preparation", () => {
    //   BEING TOLD != HAVING IT READY
    const source = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    const standingAt = source.indexOf('"standingIntent" in envelope');
    const monitoringAt = source.indexOf('"monitoring" in envelope');
    expect(standingAt).toBeGreaterThan(-1);
    expect(standingAt).toBeLessThan(monitoringAt);
    // What it tells the person is what actually happens.
    expect(source).toContain("willPrepareOnly: true");
    expect(source).toContain("requiresApprovalWhenPrepared: true");
  });

  it("the envelope cannot carry an approval, a decision or an execution", () => {
    const source = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    const schema = source.slice(source.indexOf("const StandingIntentRequestSchema"));
    const body = schema.slice(0, schema.indexOf(".strict();"));
    for (const word of ["approved", "authorize", "execute", "decision", "ownerDirect"]) {
      expect(body, word).not.toMatch(new RegExp(word, "i"));
    }
    // And it is strict, so an unknown key is refused rather than ignored.
    expect(schema.slice(0, schema.indexOf("\n\n"))).toContain(".strict()");
  });

  it("no domain was added", () => {
    //   DOMAIN_STANDING_INTENTS_ADDED = 0
    const body = readFileSync("api/runtime/standing-intent.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of ["stock", "price", "purchase", "reorder", "inventory", "threshold"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});
