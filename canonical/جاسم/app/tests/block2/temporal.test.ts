import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { temporalTriggers } from "@db/schema";
import {
  createTemporalTrigger,
  fireDueTemporalTriggers,
  transitionTemporalTrigger,
  zonedWallToUtc,
  type ContinuationDispatcher,
} from "../../api/runtime/block2/temporal";
import { getTestDb, resetBlock2 } from "./helpers/pg";

const base = new Date("2025-01-01T00:00:00.000Z");
const dispatched: string[] = [];
const dispatcher: ContinuationDispatcher = {
  async dispatch(input) {
    if (dispatched.includes(input.idempotencyKey)) return "duplicate";
    dispatched.push(input.idempotencyKey);
    return "enqueued";
  },
};

describe("Block 2 temporal triggers", () => {
  beforeEach(async () => {
    const { db } = await getTestDb();
    await resetBlock2(db);
    dispatched.length = 0;
  });

  it("creates AT, AFTER, and RECURRING triggers deterministically", async () => {
    const { db } = await getTestDb();
    const at = await createTemporalTrigger(db, { ownerId: "o", kind: "AT", fireAt: base, idempotencyKey: "at" });
    const after = await createTemporalTrigger(db, { ownerId: "o", kind: "AFTER", afterMs: 5_000, now: base, idempotencyKey: "after" });
    const recurring = await createTemporalTrigger(db, {
      ownerId: "o", kind: "RECURRING", timezone: "Asia/Riyadh",
      recurrence: { freq: "daily", timeOfDay: "09:00" }, now: base, idempotencyKey: "rec",
    });
    expect(at.trigger.fireAt).toEqual(base);
    expect(after.trigger.fireAt).toEqual(new Date(base.getTime() + 5_000));
    expect(recurring.trigger.fireAt?.toISOString()).toBe("2025-01-01T06:00:00.000Z");
  });

  it("handles a New York spring-forward wall-clock edge deterministically", () => {
    expect(zonedWallToUtc(
      { year: 2025, month: 3, day: 9, hour: 2, minute: 30 },
      "America/New_York",
    ).toISOString()).toBe("2025-03-09T07:30:00.000Z");
  });

  it("CAS-claims one firing across parallel sweeps and uses one continuation key", async () => {
    const { db } = await getTestDb();
    await createTemporalTrigger(db, {
      ownerId: "o", kind: "AT", fireAt: base, idempotencyKey: "race",
      continuation: { jobKind: "resume" },
    });
    const results = await Promise.all([
      fireDueTemporalTriggers(db, dispatcher, undefined, { now: base }),
      fireDueTemporalTriggers(db, dispatcher, undefined, { now: base }),
    ]);
    expect(results.reduce((sum, result) => sum + result.fired, 0)).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatch(/^trigger:tt_.+:0$/);
  });

  it("keeps trigger creation idempotent and guards pause/resume/cancel", async () => {
    const { db } = await getTestDb();
    const first = await createTemporalTrigger(db, { ownerId: "o", kind: "AFTER", afterMs: 100, now: base, idempotencyKey: "idem" });
    const replay = await createTemporalTrigger(db, { ownerId: "o", kind: "AFTER", afterMs: 999, now: base, idempotencyKey: "idem" });
    expect(replay.created).toBe(false);
    expect(replay.trigger.id).toBe(first.trigger.id);
    expect((await transitionTemporalTrigger(db, { ownerId: "o", triggerId: first.trigger.id, action: "pause" })).state).toBe("paused");
    await expect(transitionTemporalTrigger(db, { ownerId: "o", triggerId: first.trigger.id, action: "pause" })).rejects.toThrow();
    expect((await transitionTemporalTrigger(db, { ownerId: "o", triggerId: first.trigger.id, action: "resume", now: base })).state).toBe("active");
    expect((await transitionTemporalTrigger(db, { ownerId: "o", triggerId: first.trigger.id, action: "cancel" })).state).toBe("cancelled");
    await expect(transitionTemporalTrigger(db, { ownerId: "o", triggerId: first.trigger.id, action: "resume" })).rejects.toThrow();
  });

  it("polls false conditions and fires true conditions", async () => {
    const { db } = await getTestDb();
    for (const [key, truth] of [["false", false], ["true", true]] as const) {
      await createTemporalTrigger(db, {
        ownerId: "o", kind: "CONDITION", condition: { truth, pollMs: 10 },
        conditionPollMs: 0, now: base, idempotencyKey: key, continuation: { jobKind: "resume" },
      });
    }
    const result = await fireDueTemporalTriggers(db, dispatcher, {
      async evaluate(condition) { return condition.truth as boolean; },
    }, { now: base });
    expect(result.fired).toBe(1);
    expect(result.rescheduled).toBe(1);
  });

  it("allows only the owner to cancel a DEADLINE and fires a past trigger after restart", async () => {
    const { db } = await getTestDb();
    const deadline = await createTemporalTrigger(db, { ownerId: "owner", kind: "DEADLINE", fireAt: base, idempotencyKey: "deadline" });
    await expect(transitionTemporalTrigger(db, { ownerId: "other", triggerId: deadline.trigger.id, action: "cancel" })).rejects.toThrow("not found");
    await transitionTemporalTrigger(db, { ownerId: "owner", triggerId: deadline.trigger.id, action: "cancel" });
    const restart = await createTemporalTrigger(db, {
      ownerId: "owner", kind: "AT", fireAt: new Date(base.getTime() - 1), idempotencyKey: "restart",
      continuation: { jobKind: "resume" },
    });
    const freshDispatcher: ContinuationDispatcher = { async dispatch() { return "enqueued"; } };
    expect((await fireDueTemporalTriggers(db, freshDispatcher, undefined, { now: base })).fired).toBe(1);
    const [row] = await db.select().from(temporalTriggers).where(eq(temporalTriggers.id, restart.trigger.id));
    expect(row.state).toBe("fired");
  });
});