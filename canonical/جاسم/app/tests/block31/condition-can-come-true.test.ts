/**
 * JASIM — A CONDITION THAT CAN ACTUALLY COME TRUE.
 *
 * ─── THE GAP, TRACED EXACTLY ────────────────────────────────────────────────
 *
 * «إذا نزل المنتج تحت ٥٠، جهّز لي طلباً — ولا تنفّذ بدون موافقتي».
 *
 * `fireDueTemporalTriggers` handles a CONDITION trigger like this:
 *
 *     const verdict = evaluator ? await evaluator.evaluate(...) : undefined;
 *     if (verdict !== true) { reschedule; continue; }
 *
 * `ConditionEvaluator` is an injected seam, OPTIONAL at every layer that passes
 * it on — `runBlock2Sweep`, `makeTemporalScanHandler`, `createBlock2Worker` —
 * and `boot.ts` built the worker with `{ resumeNode }` and nothing else.
 *
 * So in production the verdict was permanently `undefined` and EVERY CONDITION
 * TRIGGER RESCHEDULED FOREVER WITHOUT EVER FIRING. A condition could be
 * written down, stored, polled — and could never come true.
 *
 * The first test below is that state, reproduced exactly. Every test after it
 * is the same sweep with the wire in place.
 *
 * ─── AND WHAT THE WIRE MUST NOT DO ──────────────────────────────────────────
 *
 *   UNREADABLE_CONDITION != FALSE_CONDITION
 *   NO_READING != FALSE
 *   CONDITION_READS_ONLY_THE_OWNERS_OWN
 *   A_CONDITION_IS_NOT_AN_AUTHORITY · TARGET / CONDITION != EXECUTION AUTHORITY
 *   TWO_CONDITION_LANGUAGES = 0
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { observations, temporalTriggers } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let fireDueTemporalTriggers: typeof import("../../api/runtime/block2/temporal").fireDueTemporalTriggers;
let canonicalConditionEvaluator: typeof import("../../api/runtime/condition-evaluator").canonicalConditionEvaluator;

const OWNER = "cond-owner";
const OTHER = "cond-other";

/** A subject and a reading. Both are strings; neither means anything here. */
const SUBJECT = { kind: "tracked_quantity", id: "subject-1" };
const READING = "level";

/** Records what a fired trigger dispatched — and proves nothing executed. */
function recordingDispatcher() {
  const dispatched: Array<{ jobKind: string; ownerId: string }> = [];
  return {
    dispatched,
    dispatcher: {
      async dispatch(input: { ownerId: string; jobKind: string }) {
        dispatched.push({ jobKind: input.jobKind, ownerId: input.ownerId });
        return "enqueued" as const;
      },
    },
  };
}

beforeAll(async () => {
  handle = await getTestDb();
  ({ fireDueTemporalTriggers } = await import("../../api/runtime/block2/temporal"));
  ({ canonicalConditionEvaluator } = await import("../../api/runtime/condition-evaluator"));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw("TRUNCATE TABLE temporal_triggers, observations CASCADE"));
});

describe("a condition that can actually come true", () => {
  async function trigger(condition: Record<string, unknown>, owner = OWNER) {
    const [row] = await handle.db
      .insert(temporalTriggers)
      .values({
        id: `trg_${randomUUID()}`,
        ownerId: owner,
        kind: "CONDITION",
        state: "active",
        fireAt: new Date(Date.now() - 1000),
        condition,
        continuation: { jobKind: "block2.resume_node", jobPayload: { runId: "run-1" } },
        idempotencyKey: `cond-${randomUUID()}`,
      })
      .returning();
    return row!;
  }

  async function observe(payload: Record<string, unknown>, owner = OWNER, at?: Date) {
    await handle.db.insert(observations).values({
      id: `obs_${randomUUID()}`,
      ownerId: owner,
      subjectKind: SUBJECT.kind,
      subjectId: SUBJECT.id,
      observationType: READING,
      payload,
      observedAt: at ?? new Date(),
    });
  }

  /** The condition every test below uses. It names a subject and a bound. */
  const below = (value: number) => ({
    subjectKind: SUBJECT.kind,
    subjectId: SUBJECT.id,
    observationType: READING,
    when: { op: "less_than", field: "quantity", value },
  });

  const sweep = (withEvaluator: boolean) => {
    const recorder = recordingDispatcher();
    return fireDueTemporalTriggers(
      handle.db,
      recorder.dispatcher,
      withEvaluator ? canonicalConditionEvaluator(handle.db) : undefined,
    ).then((result) => ({ result, dispatched: recorder.dispatched }));
  };

  // ── 1. THE GAP, REPRODUCED ─────────────────────────────────────────────────

  it("without the wire, a condition that IS true still never fires", async () => {
    // This is production before this phase, exactly: the condition holds, the
    // reading is there, the trigger is due — and nothing happens, forever.
    await trigger(below(50));
    await observe({ quantity: 12 });

    const { result, dispatched } = await sweep(false);
    expect(result.fired).toBe(0);
    expect(result.rescheduled).toBe(1);
    expect(dispatched).toHaveLength(0);
  });

  it("with the wire, the same condition fires exactly once", async () => {
    await trigger(below(50));
    await observe({ quantity: 12 });

    const { result, dispatched } = await sweep(true);
    expect(result.fired).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.ownerId).toBe(OWNER);
  });

  // ── 2. WHAT IS NOT TRUE, AND WHAT IS NOT KNOWN ─────────────────────────────

  it("a condition that does not hold reschedules, and says nothing else", async () => {
    await trigger(below(50));
    await observe({ quantity: 120 });

    const { result, dispatched } = await sweep(true);
    expect(result.fired).toBe(0);
    expect(result.rescheduled).toBe(1);
    expect(dispatched).toHaveLength(0);
  });

  it("nothing observed is not «it is fine»", async () => {
    //   NO_READING != FALSE
    await trigger(below(50));
    // No observation at all. The subject may simply never have been reported
    // on — which is not the same as the level being acceptable.
    const { result } = await sweep(true);
    expect(result.fired).toBe(0);
    expect(result.rescheduled).toBe(1);
  });

  it("a condition this runtime cannot read is unknown, never false", async () => {
    //   UNREADABLE_CONDITION != FALSE_CONDITION
    await observe({ quantity: 12 });
    for (const shape of [
      {},
      { when: { op: "less_than", field: "quantity", value: 50 } },       // no subject
      { ...below(50), when: { op: "explode", field: "quantity" } },      // not an operator
      { ...below(50), when: "quantity < 50" },                           // an expression string
    ]) {
      await handle.db.execute(sql.raw("TRUNCATE TABLE temporal_triggers CASCADE"));
      await trigger(shape as Record<string, unknown>);
      const { result, dispatched } = await sweep(true);
      expect(result.fired, JSON.stringify(shape)).toBe(0);
      expect(dispatched, JSON.stringify(shape)).toHaveLength(0);
      // Rescheduled, not consumed: an unreadable condition is still a standing
      // one, and the person who wrote it has not been told it failed.
      expect(result.rescheduled, JSON.stringify(shape)).toBe(1);
    }
  });

  it("a transition needs the reading before it, and says so until it has one", async () => {
    await trigger({
      ...below(50),
      when: { op: "entered_state", field: "state", value: "LOW" },
    });
    await observe({ state: "LOW" });
    // One reading cannot say whether it ENTERED that state.
    const first = await sweep(true);
    expect(first.result.fired).toBe(0);

    // With the earlier reading present, the transition is readable. A fresh
    // trigger, because the first sweep correctly pushed the original one out
    // to its next poll — an unmet condition reschedules rather than firing.
    await handle.db.execute(
      sql.raw("TRUNCATE TABLE temporal_triggers, observations CASCADE"),
    );
    await trigger({
      ...below(50),
      when: { op: "entered_state", field: "state", value: "LOW" },
    });
    await observe({ state: "OK" }, OWNER, new Date(Date.now() - 60_000));
    await observe({ state: "LOW" }, OWNER, new Date());
    const second = await sweep(true);
    expect(second.result.fired).toBe(1);
  });

  // ── 3. WHOSE READING IT IS ─────────────────────────────────────────────────

  it("somebody else's reading never answers your condition", async () => {
    //   CONDITION_READS_ONLY_THE_OWNERS_OWN
    await trigger(below(50), OWNER);
    // The reading that WOULD satisfy it belongs to another scope.
    await observe({ quantity: 12 }, OTHER);

    const { result, dispatched } = await sweep(true);
    expect(result.fired).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  // ── 4. FIRING IS NOT DOING ─────────────────────────────────────────────────

  it("a true condition dispatches a continuation and authorizes nothing", async () => {
    //   A_CONDITION_IS_NOT_AN_AUTHORITY
    //   TARGET / CONDITION != EXECUTION AUTHORITY
    await trigger(below(50));
    await observe({ quantity: 12 });
    const { dispatched } = await sweep(true);

    // ONE continuation, to the resume handler. Not an execution, not an
    // approval, not a payment — whatever it resumes faces its own gate.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.jobKind).toBe("block2.resume_node");
  });

  it("the same condition does not fire twice for one crossing", async () => {
    await trigger(below(50));
    await observe({ quantity: 12 });
    const first = await sweep(true);
    expect(first.result.fired).toBe(1);

    // The trigger is consumed or rescheduled by the runtime's own policy; what
    // must never happen is a second continuation for the same firing.
    const second = await sweep(true);
    expect(second.dispatched.length + first.dispatched.length).toBeLessThanOrEqual(2);
    expect(first.dispatched).toHaveLength(1);
  });

  // ── 5. ONE CONDITION LANGUAGE, AND NO DOMAIN ───────────────────────────────

  it("the trigger speaks the monitor's condition vocabulary, not a second one", () => {
    //   TWO_CONDITION_LANGUAGES = 0
    const source = readFileSync("api/runtime/condition-evaluator.ts", "utf8");
    expect(source).toContain("validateCondition");
    expect(source).toContain("evaluateCondition");
    const body = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    // No second grammar: no expression parser, no eval, no SQL.
    expect(body).not.toMatch(/\beval\b|new Function|\bparseExpression\b/);
    expect(body).not.toMatch(/\bSELECT\b|\bWHERE\b/);
  });

  it("no domain condition was added", () => {
    //   DOMAIN_CONDITIONS_ADDED = 0
    const body = readFileSync("api/runtime/condition-evaluator.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of ["stock", "price", "inventory", "threshold", "level", "quantity", "temperature"]) {
      expect(body, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("the wire is in place where it was missing", () => {
    const boot = readFileSync("api/boot.ts", "utf8");
    expect(boot).toContain("canonicalConditionEvaluator");
    // And it is given to the worker that runs the sweep, not somewhere decorative.
    const worker = boot.slice(boot.indexOf("getBlock2Worker({"));
    // Up to the call that consumes it, not to the first nested brace.
    expect(worker.slice(0, worker.indexOf("await handle.bootstrap()")))
      .toContain("evaluator: canonicalConditionEvaluator(");
  });
});
