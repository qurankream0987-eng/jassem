/**
 * JASIM — A CONDITION THAT CAME TRUE CAN WAKE SOMETHING.
 *
 * ─── THE GAP, TRACED ────────────────────────────────────────────────────────
 *
 * The condition can now become true and dispatch its continuation. What the
 * continuation reaches is `resumeScheduledRuntimeRun`, and its eligibility was
 * `resumeAt <= now` — A CLOCK. A run parked on a CONDITION rather than a time
 * has no `resumeAt`, so the wake arrived and there was no rule under which it
 * could resume anything.
 *
 *   A CONDITION THAT CAME TRUE COULD WAKE NOTHING
 *
 * ─── AND THE TWO RULES THAT MUST SURVIVE IT ─────────────────────────────────
 *
 *   A_RUN_IS_WOKEN_BY_A_TRIGGER_THAT_NAMES_IT
 *     The function's standing law is that it "does not infer authority from a
 *     worker payload". A fired trigger is now its own evidence, and it is
 *     STRICTER than the clock ever was: the trigger must carry this run on its
 *     own row, owned by the same scope, and must actually have fired. A run
 *     named only inside a continuation payload wakes nothing.
 *
 *   WAKING_IS_NOT_APPROVING
 *     The `status = "waiting"` filter is untouched. A run parked on a PERSON —
 *     awaiting_input, awaiting_approval — is as unreachable from here as it
 *     ever was. A condition may say the world changed; it may never say a
 *     person agreed.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { runs, temporalTriggers } from "@db/schema";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");

const OWNER = "wake-owner";
const OTHER = "wake-other";

beforeAll(async () => {
  handle = await getTestDb();
  runtime = await import("../../api/runtime/jasim-runtime");
});

beforeEach(async () => {
  await handle.db.execute(
    sql.raw("TRUNCATE TABLE temporal_triggers, runs, events CASCADE"),
  );
});

describe("a condition that came true can wake something", () => {
  /** A run parked in the state the runtime puts it in while it waits. */
  async function parkedRun(input: {
    status: string;
    resumeAt?: Date | null;
    owner?: string;
  }) {
    const [row] = await handle.db
      .insert(runs)
      .values({
        ownerId: input.owner ?? OWNER,
        goal: "waiting for the world to change",
        status: input.status,
        resumeAt: input.resumeAt ?? null,
        idempotencyKey: `wake-${randomUUID()}`,
      } as never)
      .returning();
    return row!;
  }

  /** A trigger that has already fired, naming the run ON ITS OWN ROW. */
  async function firedTrigger(input: { runId?: string; owner?: string; fireCount?: number }) {
    const [row] = await handle.db
      .insert(temporalTriggers)
      .values({
        id: `trg_${randomUUID()}`,
        ownerId: input.owner ?? OWNER,
        kind: "CONDITION",
        state: "active",
        fireAt: new Date(),
        runId: input.runId ?? null,
        condition: {},
        continuation: { jobKind: "block2.resume_node" },
        fireCount: input.fireCount ?? 1,
        idempotencyKey: `wake-${randomUUID()}`,
      } as never)
      .returning();
    return row!;
  }

  const wake = (runId: string, wokenBy?: "SCHEDULE" | "TRIGGER", owner = OWNER) =>
    runtime.resumeScheduledRuntimeRun({
      runId,
      ownerId: owner,
      ...(wokenBy ? { wokenBy } : {}),
    });

  // ── 1. THE GAP ─────────────────────────────────────────────────────────────

  it("a run parked on a condition has no clock, and the old rule refused it", async () => {
    const run = await parkedRun({ status: "waiting", resumeAt: null });
    await firedTrigger({ runId: run.id });
    // The scheduled path — the only one that existed — still refuses, exactly
    // as it did. Nothing about this phase loosened the clock rule.
    expect(await wake(run.id, "SCHEDULE")).toBe(false);
    expect(await wake(run.id)).toBe(false);
  });

  it("the same run, woken by the trigger that named it, resumes", async () => {
    const run = await parkedRun({ status: "waiting", resumeAt: null });
    await firedTrigger({ runId: run.id });
    expect(await wake(run.id, "TRIGGER")).toBe(true);
  });

  // ── 2. THE TRIGGER IS THE AUTHORITY, NOT THE PAYLOAD ───────────────────────

  it("a run no trigger names wakes nothing, however it was asked", async () => {
    //   A_RUN_IS_WOKEN_BY_A_TRIGGER_THAT_NAMES_IT
    const run = await parkedRun({ status: "waiting", resumeAt: null });
    // A trigger exists and has fired — it simply does not name this run on its
    // own row. That is the payload-authority case, refused.
    await firedTrigger({ runId: null });
    expect(await wake(run.id, "TRIGGER")).toBe(false);
  });

  it("a trigger that has not fired wakes nothing", async () => {
    const run = await parkedRun({ status: "waiting", resumeAt: null });
    await firedTrigger({ runId: run.id, fireCount: 0 });
    expect(await wake(run.id, "TRIGGER")).toBe(false);
  });

  it("somebody else's trigger never wakes your run", async () => {
    const run = await parkedRun({ status: "waiting", resumeAt: null, owner: OWNER });
    await firedTrigger({ runId: run.id, owner: OTHER });
    expect(await wake(run.id, "TRIGGER", OWNER)).toBe(false);
  });

  // ── 3. WAKING IS NOT APPROVING ─────────────────────────────────────────────

  it("a run waiting on a PERSON stays parked, trigger or no trigger", async () => {
    //   WAKING_IS_NOT_APPROVING
    //
    // The whole point of «لا تنفّذ بدون موافقتي». A condition may say the
    // world changed. It may never say a person agreed.
    for (const status of ["awaiting_approval", "awaiting_input"]) {
      await handle.db.execute(sql.raw("TRUNCATE TABLE temporal_triggers, runs CASCADE"));
      const run = await parkedRun({ status, resumeAt: null });
      await firedTrigger({ runId: run.id });
      expect(await wake(run.id, "TRIGGER"), status).toBe(false);
    }
  });

  it("and a run that already finished is not restarted by a late wake", async () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      await handle.db.execute(sql.raw("TRUNCATE TABLE temporal_triggers, runs CASCADE"));
      const run = await parkedRun({ status, resumeAt: null });
      await firedTrigger({ runId: run.id });
      expect(await wake(run.id, "TRIGGER"), status).toBe(false);
    }
  });

  // ── 4. THE SCHEDULED PATH IS UNCHANGED ─────────────────────────────────────

  it("a timed wait still resumes on its clock and consumes it", async () => {
    const run = await parkedRun({
      status: "waiting",
      resumeAt: new Date(Date.now() - 60_000),
    });
    expect(await wake(run.id, "SCHEDULE")).toBe(true);
    const [after] = await handle.db.select().from(runs).where(eq(runs.id, run.id));
    // The clock was consumed, so the same wake cannot be replayed.
    expect(after!.resumeAt).toBeNull();
  });

  it("a timed wait whose time has not come is refused", async () => {
    const run = await parkedRun({
      status: "waiting",
      resumeAt: new Date(Date.now() + 60 * 60_000),
    });
    expect(await wake(run.id, "SCHEDULE")).toBe(false);
  });

  // ── 5. STRUCTURE ───────────────────────────────────────────────────────────

  it("the wake reads the trigger from canonical state, not from the job", () => {
    const source = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    const fn = source.slice(source.indexOf("export async function resumeScheduledRuntimeRun"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    // The trigger row, the owner, and the firing — all three read back.
    expect(body).toContain("temporalTriggers.runId");
    expect(body).toContain("temporalTriggers.ownerId");
    expect(body).toContain("temporalTriggers.fireCount");
    // And the person-waits filter is still the first thing it asks.
    expect(body).toContain('eq(jasimRuntimeRuns.status, "waiting")');
  });

  it("only the trigger wake claims to be one", () => {
    //
    // ── AN EXPECTATION I WROTE, THEN MOVED ─────────────────────────────────
    //
    // OLD_EXPECTATION: `boot.ts` contains `wokenBy: "TRIGGER"`.
    // WHY_IT_IS_WRONG: it pinned the reason to the file that HAPPENED to pass
    //   it. The standing-intent phase put a dispatcher between them —
    //   `wakeRunFromTrigger`, which tells a standing act apart from a paused
    //   run — so boot now says «a trigger fired» by calling that, and the flag
    //   travels one layer in. The rule was never about boot.
    // NEW_EXPECTATION: exactly ONE place in the runtime claims a wake is
    //   trigger-driven, and it is the function whose whole job is to handle a
    //   fired trigger.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: the old assertion could not notice
    //   a SECOND caller granting itself the trigger exemption — which is the
    //   thing that would actually matter, since that flag is what lets a wake
    //   skip the clock. This one fails on any such caller appearing, wherever
    //   it lives.
    const source = readFileSync("api/runtime/jasim-runtime.ts", "utf8");
    const claims = source.split('wokenBy: "TRIGGER"').length - 1;
    expect(claims).toBe(1);
    const dispatcher = source.slice(source.indexOf("export async function wakeRunFromTrigger"));
    // To the next top-level declaration, not to the first closing brace — the
    // body has nested blocks and the claim sits past them.
    expect(dispatcher.slice(0, dispatcher.indexOf("\nexport "))).toContain('wokenBy: "TRIGGER"');
    // And boot reaches the wake through it rather than around it.
    const boot = readFileSync("api/boot.ts", "utf8");
    expect(boot).toContain("wakeRunFromTrigger(");
    expect(boot).not.toContain("resumeScheduledRuntimeRun(");
  });
});
