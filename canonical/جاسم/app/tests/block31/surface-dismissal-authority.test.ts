/**
 * JASIM — الإخفاء لا يُلغي، ولا يُخفي ما ينتظرك أنت.
 *
 *   HIDE != CANCEL · SURFACE_EXIT != SUBJECT_DELETE     (مُغلق سابقاً)
 *   HIDING_WHAT_WAITS_ON_YOU = 0                        (هذه المرحلة)
 *   RELEASE_ABANDONS_AN_OBLIGATION = 0
 *   SURFACE_STATE_SUPPRESSES_A_NEW_DEMAND_ON_YOU = 0
 *
 * «شيل الخريطة» يجب أن يُخفي المنظر ويترك التوصيل يمضي — وهذا مُغلق. لكن
 * `projectLivingObjects` يُسقط المخفيّ افتراضياً، فإخفاء شيء توقّف وينتظر صاحبه
 * يسحب الشيء الوحيد الذي يقول له إن النظام واقف عليه. و«أطلقه» أسوأ: المصالحة
 * تمشي على المتابَع فقط، فلا يعود أبداً.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let living: typeof import("../../api/runtime/living-object-runtime");
let actor: typeof users.$inferSelect;

/** Statuses where the subject has stopped and is waiting for this person. */
const WAITING_ON_ME = [
  { state: "proposed", status: "WAITING_APPROVAL" },
  { state: "awaiting_input", status: "WAITING_USER" },
  { state: "blocked", status: "BLOCKED" },
] as const;

/** Statuses that carry on perfectly well unseen. */
const CARRIES_ON = [
  { state: "running", status: "RUNNING" },
  { state: "active", status: "ACTIVE" },
  { state: "monitoring", status: "MONITORING" },
  { state: "verifying", status: "VERIFYING" },
] as const;

describe("what a follower may put out of sight", () => {
  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    living = await import("../../api/runtime/living-object-runtime");
  }, 60_000);

  afterAll(async () => {
    await handle.pool.end();
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE living_objects, commitments, events, memberships,
        organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'sd-%'`));
    const [row] = await handle.db.insert(users)
      .values({ unionId: `sd-${randomUUID()}`, name: "صاحب", preferences: {} })
      .returning();
    actor = row!;
  });

  const me = () => String(actor.id);

  async function commitment(state: string) {
    const id = `cmt_${randomUUID().slice(0, 16)}`;
    await handle.db.execute(
      sql.raw(`INSERT INTO commitments (id, "agreementId", "ownerId", "termKey", state,
        "beneficiaryActorId", verification, "evidenceKind", terms, "updatedAt", "createdAt")
        VALUES ('${id}', 'agr_${randomUUID().slice(0, 12)}', '${me()}', 'تسليم', '${state}',
        '${me()}', 'PENDING', 'HUMAN_ACTION', '{}', now(), now())`),
    );
    return id;
  }

  /**
   * `verification` is passed through because CLAIMED_COMPLETE != VERIFIED_COMPLETE:
   * a commitment saying it is done with `verification = PENDING` reads as
   * VERIFYING, not COMPLETED, and is therefore not terminal. That is the
   * runtime's law, not a detail of this fixture.
   */
  const advance = (id: string, state: string, verification = "PENDING") =>
    handle.db.execute(
      sql.raw(`UPDATE commitments SET state = '${state}', verification = '${verification}',
        "updatedAt" = now() + interval '1 second' WHERE id = '${id}'`),
    );

  async function follow(subjectId: string) {
    const made = await living.materializeLivingObject({
      principalId: me(), subjectKind: "commitment", subjectId,
      sideEffect: "INTERNAL_STATE", durability: "ONGOING", conversationId: "c-sd",
    });
    if (!made.materialized) throw new Error(`not materialized: ${made.decline}`);
    return made.object.id;
  }

  const rowOf = async (id: string) => {
    const rows = await handle.db.execute(
      sql.raw(`SELECT "followState", "surfaceState" FROM living_objects WHERE id = '${id}'`),
    );
    return rows.rows[0] as { followState: string; surfaceState: string };
  };

  const visible = async () =>
    (await living.projectLivingObjects({ principalId: me() })).objects;

  // ── 1 · ما يمضي وحده، يُخفى بحرّية ────────────────────────────────────────

  it("anything that carries on unseen may be hidden, and carries on", async () => {
    //   HIDE != CANCEL — «شيل الخريطة» والتوصيل يكمل
    for (const { state, status } of CARRIES_ON) {
      const subject = await commitment(state);
      const id = await follow(subject);
      const before = await living.readLivingObject({ principalId: me(), id });
      expect(before.status, state).toBe(status);

      await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
      expect((await rowOf(id)).surfaceState, state).toBe("HIDDEN");
      // It left the surface and nothing else moved.
      expect((await rowOf(id)).followState, state).toBe("FOLLOWING");
      const subjectRow = await handle.db.execute(
        sql.raw(`SELECT state FROM commitments WHERE id = '${subject}'`),
      );
      expect((subjectRow.rows[0] as { state: string }).state, state).toBe(state);
      // And it is still there for anyone who asks for it.
      const all = await living.projectLivingObjects({ principalId: me(), includeHidden: true });
      expect(all.objects.some((one) => one.id === id), state).toBe(true);
    }
  });

  // ── 2 · ما ينتظرك، لا يُخفى ولا يُطلَق ────────────────────────────────────

  it("what has stopped and is waiting on you cannot be hidden or released", async () => {
    //   HIDING_WHAT_WAITS_ON_YOU = 0 · RELEASE_ABANDONS_AN_OBLIGATION = 0
    for (const { state, status } of WAITING_ON_ME) {
      const subject = await commitment(state);
      const id = await follow(subject);
      expect((await living.readLivingObject({ principalId: me(), id })).status, state)
        .toBe(status);

      for (const change of [
        { surfaceState: "HIDDEN" as const },
        { followState: "RELEASED" as const },
      ]) {
        await expect(
          living.setLivingObjectState({ principalId: me(), id, ...change }),
          `${state} ${JSON.stringify(change)}`,
        ).rejects.toMatchObject({ name: "LivingObjectError", code: "STATE" });
      }
      // Nothing moved, and it is still on the surface asking.
      expect(await rowOf(id), state).toMatchObject({
        followState: "FOLLOWING", surfaceState: "VISIBLE",
      });
      expect((await visible()).some((one) => one.id === id), state).toBe(true);
    }
  });

  it("it is not a trap: deal with it and it stops asking", async () => {
    const subject = await commitment("proposed");
    const id = await follow(subject);
    await expect(
      living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" }),
    ).rejects.toMatchObject({ code: "STATE" });

    // The person acts on the subject through the subject's own runtime.
    await advance(subject, "active");
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
    expect((await rowOf(id)).surfaceState).toBe("HIDDEN");
  });

  it("resolving and re-showing are never refused, whatever it is waiting for", async () => {
    // The rule is about LEAVING the surface. Saying «I have dealt with this»
    // and bringing something back are the follower's own business.
    const subject = await commitment("proposed");
    const id = await follow(subject);
    await living.setLivingObjectState({ principalId: me(), id, followState: "RESOLVED" });
    expect((await rowOf(id)).followState).toBe("RESOLVED");
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "VISIBLE" });
    expect((await rowOf(id)).surfaceState).toBe("VISIBLE");
  });

  // ── 3 · لا يمكن الالتفاف بالتوقيت ────────────────────────────────────────

  it("hiding it first does not spare you: a new demand comes back into view", async () => {
    //   SURFACE_STATE_SUPPRESSES_A_NEW_DEMAND_ON_YOU = 0
    const subject = await commitment("running");
    const id = await follow(subject);
    // Hidden while it was still running — perfectly allowed.
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
    expect(await visible()).toHaveLength(0);

    // And then it stops, and turns to this person.
    await advance(subject, "proposed");
    const swept = await living.reconcileLivingObjects({ scopeId: me() });
    expect(swept.changed).toBeGreaterThan(0);

    expect((await rowOf(id)).surfaceState).toBe("VISIBLE");
    expect((await visible()).map((one) => one.id)).toContain(id);
    // Nothing about the subject was touched to achieve it.
    const subjectRow = await handle.db.execute(
      sql.raw(`SELECT state FROM commitments WHERE id = '${subject}'`),
    );
    expect((subjectRow.rows[0] as { state: string }).state).toBe("proposed");
  });

  it("a hidden handle whose subject merely moves on stays hidden", async () => {
    // Re-surfacing is for a DEMAND, not for every change — otherwise hiding
    // would mean nothing at all.
    const subject = await commitment("running");
    const id = await follow(subject);
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
    await advance(subject, "verifying");
    await living.reconcileLivingObjects({ scopeId: me() });
    expect((await rowOf(id)).surfaceState).toBe("HIDDEN");
    expect(await visible()).toHaveLength(0);
  });

  it("a finished subject resolves and does not come back to be dealt with", async () => {
    const subject = await commitment("running");
    const id = await follow(subject);
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
    // Done AND verified — a claim of completion alone reads as VERIFYING.
    await advance(subject, "completed", "VERIFIED");
    const swept = await living.reconcileLivingObjects({ scopeId: me() });
    expect(swept.resolved).toBe(1);
    expect(await rowOf(id)).toMatchObject({ followState: "RESOLVED", surfaceState: "HIDDEN" });
  });

  // ── 4 · ما زال لا سبيل لإلغاء الموضوع من هنا ─────────────────────────────

  it("the surface still offers no way to cancel or delete the subject", async () => {
    //   HIDE != CANCEL · SURFACE_EXIT != SUBJECT_DELETE
    const source = await readFile(
      new URL("../../api/runtime/living-object-runtime.ts", import.meta.url), "utf8",
    ).then((text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    const start = source.indexOf("export async function setLivingObjectState");
    const body = source.slice(start, source.indexOf("export type ProjectedLivingObject"));
    // It writes two columns and reads one snapshot. It cannot reach a subject.
    expect(body).toContain("surfaceState");
    expect(body).toContain("followState");
    expect(body).not.toMatch(/delete\(|\.delete|cancel|CANCELLED/i);
    expect(body).toContain("AWAITING_THE_FOLLOWER");
    // And the vocabulary of «waiting on you» names no domain.
    const vocabulary = source.slice(
      source.indexOf("const AWAITING_THE_FOLLOWER"),
      source.indexOf("export class LivingObjectError"),
    );
    for (const forbidden of ["payment", "order", "delivery", "car", "food", "invoice"]) {
      expect(vocabulary.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("an unreadable subject is not evidence that anything waits on anybody", async () => {
    //   UNKNOWN != WAITING · a refusal built on nothing would be a lock
    const subject = await commitment("running");
    const id = await follow(subject);
    await handle.db.execute(sql.raw(`DELETE FROM commitments WHERE id = '${subject}'`));
    await living.setLivingObjectState({ principalId: me(), id, surfaceState: "HIDDEN" });
    expect((await rowOf(id)).surfaceState).toBe("HIDDEN");
  });
});
