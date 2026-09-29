/**
 * JASIM — A NEED CAN WAIT.
 *
 * ─── THE GAP, TRACED ON THE LIVE PATH ───────────────────────────────────────
 *
 * «أخبرني عندما تظهر واحدة تحت ١٦ ألفاً» · «راقب السعر وإذا نزل أخبرني».
 *
 * `matchNeed` scans every public offering against a need. It has exactly two
 * callers — a router procedure and a capability — and both run because
 * somebody asked AT THAT MOMENT. Nothing re-ran it: not the duty cycle, not a
 * publication, not a trigger.
 *
 * So JASIM could answer «what exists now» and never «tell me when it exists».
 * A request whose answer had not been published yet came back empty and was
 * forgotten — the entire long-running half of the runtime.
 *
 *   A NEED CAN WAIT · ANSWERING_ONLY_WHAT_EXISTS_NOW = 0
 *
 * ─── AND WHAT WAITING IS NOT ────────────────────────────────────────────────
 *
 *   NEW_MATCH != EVERY_SWEEP   — the edge, never the level
 *   WAITING != PUBLISHING      — nobody is shown what this person wants
 *   MATCH != OFFER             — nothing reserved, nobody contacted
 *   WAITING_FOREVER = 0        — every wait carries an end
 *   WAITING_IS_THE_OWNERS_CHOICE
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { notificationIntents } from "@db/schema-block2";
import { getTestDb, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let createExpression: typeof import("../../api/runtime/economic-fabric").createExpression;
let publishExpression: typeof import("../../api/runtime/economic-fabric").publishExpression;
let waiting: typeof import("../../api/runtime/waiting-needs");
let orchestrate: typeof import("../../api/runtime/block31").orchestrateConversationCommerce;

const ME = "wait-me";
const SELLER = "wait-seller";
const OTHER = "wait-other";

const SUBJECT = "kiln.firing.slot";

const worlds = { get: async () => undefined, conversationWorld: async () => undefined } as never;

type Envelope = {
  decisionId: string;
  kind: string;
  intent?: { requiredCapabilities: string[]; missingInputs: string[]; inputs: Record<string, unknown> };
};
const envelope = (capabilities: string[], inputs: Record<string, unknown> = {}): Envelope => ({
  decisionId: randomUUID(),
  kind: "message",
  intent: { requiredCapabilities: capabilities, missingInputs: [], inputs },
});

beforeAll(async () => {
  handle = await getTestDb();
  ({ createExpression, publishExpression } = await import("../../api/runtime/economic-fabric"));
  waiting = await import("../../api/runtime/waiting-needs");
  ({ orchestrateConversationCommerce: orchestrate } = await import("../../api/runtime/block31"));
});

beforeEach(async () => {
  await handle.db.execute(sql.raw(`
    TRUNCATE TABLE reference_bindings, discovery_candidates, discovery_result_sets,
      commercial_orders, waiting_needs, notification_intents, agreements, commitments,
      economic_proposals, economic_engagements, economic_matches,
      economic_expressions CASCADE
  `));
});

describe("a need that keeps looking", () => {
  /** A need with a bound nothing satisfies yet. */
  async function needFor(owner = ME) {
    return createExpression({
      ownerId: owner,
      kind: "need",
      semanticType: SUBJECT,
      attributes: {},
      hardConstraints: [{ field: "chamberVolume", operator: "gte", value: 3, unit: "m3" }],
    });
  }

  async function offeringOf(volume: number, unit: string) {
    const expression = await createExpression({
      ownerId: SELLER,
      kind: "offering",
      semanticType: SUBJECT,
      attributes: { chamberVolume: volume, chamberVolumeUnit: unit },
    });
    return publishExpression({
      id: expression.id,
      ownerId: SELLER,
      projection: { semanticType: SUBJECT, summary: SUBJECT },
    });
  }

  const notices = async () =>
    handle.db.select().from(notificationIntents).where(eq(notificationIntents.ownerId, ME));

  // ── 1. THE GAP ─────────────────────────────────────────────────────────────

  it("nothing exists yet, and the wait survives the sweep in silence", async () => {
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });

    const swept = await waiting.sweepWaitingNeeds(handle.db);
    expect(swept.swept).toBe(1);
    expect(swept.notified).toBe(0);
    // Silence is the correct answer to «nothing appeared», and it is not the
    // same as having stopped looking.
    expect(await notices()).toHaveLength(0);
    const still = await waiting.readWait(handle.db, { needId: need.id, ownerId: ME });
    expect(still!.state).toBe("WAITING");
    expect(still!.lastSweptAt).not.toBeNull();
  });

  it("when it finally appears, the person is told — once", async () => {
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    await waiting.sweepWaitingNeeds(handle.db);

    // Somebody publishes it. Stated in litres against a bound in cubic metres,
    // because a wait that only matched identical scales would be a coincidence
    // detector.
    await offeringOf(4000, "L");

    const found = await waiting.sweepWaitingNeeds(handle.db);
    expect(found.notified).toBe(1);
    expect(found.newMatches).toBeGreaterThanOrEqual(1);
    const sent = await notices();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.purpose).toBe("waiting_need_match");

    //   NEW_MATCH != EVERY_SWEEP — the same candidate is not news twice.
    const again = await waiting.sweepWaitingNeeds(handle.db);
    expect(again.notified).toBe(0);
    expect(await notices()).toHaveLength(1);
  });

  it("a second arrival is news again", async () => {
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    await offeringOf(4000, "L");
    await waiting.sweepWaitingNeeds(handle.db);
    await offeringOf(9, "m3");
    const second = await waiting.sweepWaitingNeeds(handle.db);
    expect(second.notified).toBe(1);
    expect(await notices()).toHaveLength(2);
  });

  it("something that does not meet the bound is not news at all", async () => {
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    // 900 litres is 0.9 m³ — under the bound, whatever scale it is stated in.
    await offeringOf(900, "L");
    const swept = await waiting.sweepWaitingNeeds(handle.db);
    expect(swept.notified).toBe(0);
    expect(await notices()).toHaveLength(0);
  });

  // ── 2. WHAT A NOTICE IS AND IS NOT ─────────────────────────────────────────

  it("the notice says something changed, never what it now says", async () => {
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    await offeringOf(4000, "L");
    await waiting.sweepWaitingNeeds(handle.db);

    const [sent] = await notices();
    const serialized = JSON.stringify(sent!.content);
    // Ids and counts. No terms, no price, no owner, no attributes — reading
    // the thing is a separate authorized act.
    expect(serialized).not.toContain(SELLER);
    expect(serialized).not.toContain("chamberVolume");
    expect(serialized).not.toMatch(/4000|priceMinor/);
  });

  it("a wait reserves nothing and contacts nobody", async () => {
    //   MATCH != OFFER · TARGET / CONDITION != EXECUTION AUTHORITY
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    await offeringOf(4000, "L");
    await waiting.sweepWaitingNeeds(handle.db);

    const engagements = await handle.db.execute(
      sql.raw("SELECT COUNT(*)::int AS count FROM economic_engagements"),
    );
    const proposals = await handle.db.execute(
      sql.raw("SELECT COUNT(*)::int AS count FROM economic_proposals"),
    );
    expect((engagements.rows[0] as { count: number }).count).toBe(0);
    expect((proposals.rows[0] as { count: number }).count).toBe(0);
    // And the seller was told nothing.
    const theirs = await handle.db
      .select().from(notificationIntents).where(eq(notificationIntents.ownerId, SELLER));
    expect(theirs).toHaveLength(0);
  });

  // ── 3. WHOSE WAIT IT IS, AND HOW IT ENDS ───────────────────────────────────

  it("only the owner starts, reads or stops a wait", async () => {
    //   WAITING_IS_THE_OWNERS_CHOICE
    const need = await needFor();
    await expect(
      waiting.waitForMatch(handle.db, { needId: need.id, ownerId: OTHER }),
    ).rejects.toThrow(/owner/i);

    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    await expect(
      waiting.readWait(handle.db, { needId: need.id, ownerId: OTHER }),
    ).rejects.toThrow(/owner/i);
    await expect(
      waiting.stopWaiting(handle.db, { needId: need.id, ownerId: OTHER }),
    ).rejects.toThrow(/owner/i);
  });

  it("an offering never waits — it is already there", async () => {
    const offering = await offeringOf(9, "m3");
    await expect(
      waiting.waitForMatch(handle.db, { needId: offering.id, ownerId: SELLER }),
    ).rejects.toThrow(/need/i);
  });

  it("stopping ends the looking and cancels nothing", async () => {
    const need = await needFor();
    await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    await offeringOf(4000, "L");
    await waiting.sweepWaitingNeeds(handle.db);
    const before = await notices();

    await waiting.stopWaiting(handle.db, { needId: need.id, ownerId: ME });
    await offeringOf(9, "m3");
    const after = await waiting.sweepWaitingNeeds(handle.db);
    expect(after.swept).toBe(0);
    // Nothing new was sent, and what was found before is untouched.
    expect(await notices()).toHaveLength(before.length);
  });

  it("every wait carries an end, and the end is enforced", async () => {
    //   WAITING_FOREVER = 0
    const need = await needFor();
    const wait = await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    expect(wait.expiresAt).toBeInstanceOf(Date);

    // A caller asking for a century gets the ceiling, not the century.
    const far = await waiting.waitForMatch(handle.db, {
      needId: need.id,
      ownerId: ME,
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
    });
    expect(far.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(waiting.MAX_WAIT_MS + 1000);

    // And a wait whose time has come stops being work.
    const later = new Date(far.expiresAt.getTime() + 1000);
    const swept = await waiting.sweepWaitingNeeds(handle.db, { now: later });
    expect(swept.expired).toBe(1);
    expect(swept.swept).toBe(0);
    const ended = await waiting.readWait(handle.db, { needId: need.id, ownerId: ME });
    expect(ended!.state).toBe("EXPIRED");
  });

  it("asking twice is one wait, not two scans", async () => {
    const need = await needFor();
    const first = await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    const again = await waiting.waitForMatch(handle.db, { needId: need.id, ownerId: ME });
    expect(again.id).toBe(first.id);
    const swept = await waiting.sweepWaitingNeeds(handle.db);
    expect(swept.swept).toBe(1);
  });

  // ── 4. FROM A SENTENCE ─────────────────────────────────────────────────────

  it("«أخبرني عندما تظهر» starts it, and «كفى» ends it", async () => {
    const conversationId = `wait-${randomUUID()}`;
    const say = (content: string, env: Envelope) =>
      orchestrate({
        db: handle.db,
        worlds,
        ownerId: ME,
        conversationId,
        content,
        approvalRef: `message-${randomUUID()}`,
        envelope: env,
      });

    // Something of mine for the conversation to be about.
    await say("…", envelope(["self:state"], { field: "kilnSite", value: "north yard", subject: SUBJECT }));
    await say("أوافق", envelope(["commerce:approve"]));

    const started = await say("أخبرني عندما تظهر", envelope(["need:wait"]));
    expect(started?.data.waiting).toBe(true);
    // The three things a standing scan invites confusion about, said plainly.
    expect(started?.data.reservesNothing).toBe(true);
    expect(started?.data.contactsNobody).toBe(true);
    expect(started?.data.published).toBe(false);

    const stopped = await say("كفى", envelope(["need:wait"], { stop: true }));
    expect(stopped?.data.waiting).toBe(false);
  });

  it("«راقب هذا» is somebody else's verb, and this one does not take it", async () => {
    //   WATCHING_A_SUBJECT != WAITING_FOR_ONE_TO_EXIST
    //
    // Caught as a regression while proving this phase. «راقب هذا وأخبرني إذا
    // تغيّر» names a SUBJECT THAT EXISTS and belongs to the monitoring
    // runtime, which watches it durably. «أخبرني عندما تظهر» names nothing —
    // the thing it waits for has no id yet. Claiming the shared word silently
    // took over the older act, which is how a new verb eats an old one.
    const conversationId = `wait-${randomUUID()}`;
    const need = await needFor();
    await handle.db.insert(
      (await import("@db/schema")).referenceBindings,
    ).values({
      id: `ref_${randomUUID()}`,
      ownerId: ME,
      conversationId,
      referenceKey: "current:need",
      targetKind: "economic_expression",
      targetId: need.id,
    });

    const routed = await orchestrate({
      db: handle.db,
      worlds,
      ownerId: ME,
      conversationId,
      content: "راقب هذا وأخبرني إذا تغيّر",
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope([]),
    });
    // Commerce declines it entirely, so the monitoring route still sees it.
    expect(routed).toBeNull();
    expect(await waiting.readWait(handle.db, { needId: need.id, ownerId: ME })).toBeNull();
  });

  it("waiting for nothing in particular is not a wait", async () => {
    const conversationId = `wait-${randomUUID()}`;
    const result = await orchestrate({
      db: handle.db,
      worlds,
      ownerId: ME,
      conversationId,
      content: "أخبرني عندما تظهر",
      approvalRef: `message-${randomUUID()}`,
      envelope: envelope(["need:wait"]),
    });
    expect(result?.status).toBe("awaiting_input");
  });

  // ── 5. STRUCTURE ───────────────────────────────────────────────────────────

  it("it runs in the duty cycle that already exists", () => {
    //   SECOND_SCHEDULERS_ADDED = 0
    const jobs = readFileSync("api/runtime/block2/jobs.ts", "utf8");
    expect(jobs).toContain("sweepWaitingNeeds");
    expect(jobs).not.toMatch(/setInterval\(|new Worker\(/);
  });

  it("no domain watcher was added", () => {
    //   DOMAIN_WATCHERS_ADDED = 0
    const source = readFileSync("api/runtime/waiting-needs.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .toLowerCase();
    for (const word of ["price", "stock", "inventory", "vehicle", "car", "kiln", "alert"]) {
      expect(source, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});
