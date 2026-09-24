/**
 * JASIM — A STANDING CONDITION, EVALUATED DURABLY.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   CONVERSATION · MONITORING INTENT · STANDING CONDITION
 *   AUTHORIZED OBSERVATION · DURABLE EVALUATION · STATE TRANSITION
 *   NOTIFICATION INTENT
 *
 *   CONDITION_MATCHED != USER_NOTIFIED
 *   LEVEL != EDGE · UNKNOWN != FALSE · UNKNOWN != ABSENT
 *
 * Everything runs against a real PostgreSQL database with the real migrations.
 * "Triggered" always means a row read back after the call that wrote it
 * returned — never a value still in a response.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let runtime: typeof import("../../api/runtime/jasim-runtime");
let monitoring: typeof import("../../api/runtime/monitoring-runtime");
let scopes: typeof import("../../api/runtime/actor-scope");
let jobs: typeof import("../../api/runtime/block2/jobs");
let notifications: typeof import("../../api/runtime/block2/notifications");
let ModelGateway: typeof import("../../api/runtime/model-gateway").ModelGateway;

type ActingScope = import("../../api/runtime/actor-scope").ActingScope;
type MonitorRequest = import("../../api/runtime/monitoring-runtime").MonitorRequest;

/**
 * Five operational contexts nothing in the engine anticipated, plus a sixth
 * that is not physical at all. If any needed a branch, a type or a watcher of
 * its own, generality has failed.
 *
 *   DOMAIN_MONITOR_TYPES_ADDED = 0 · DOMAIN_WATCHERS_ADDED = 0
 */
const HOLDOUTS = [
  {
    id: "industrial_valve",
    label: "صمام خط الإنتاج",
    observationType: "valve.position",
    condition: { op: "entered_state", field: "position", value: "CLOSED" },
    quiet: { position: "OPEN" },
    matching: { position: "CLOSED" },
  },
  {
    id: "cold_storage",
    label: "حرارة المبرّد",
    observationType: "sensor.reading",
    condition: { op: "greater_than", field: "celsius", value: 5 },
    quiet: { celsius: 2 },
    matching: { celsius: 9 },
  },
  {
    id: "laboratory_calibration",
    label: "معايرة الجهاز",
    observationType: "procedure.state",
    condition: { op: "equals", field: "phase", value: "CALIBRATED" },
    quiet: { phase: "RUNNING" },
    matching: { phase: "CALIBRATED" },
  },
  {
    id: "generator_supply",
    label: "إمداد المولّد",
    observationType: "supply.state",
    condition: { op: "left_state", field: "supplying", value: "YES" },
    quiet: { supplying: "YES" },
    matching: { supplying: "NO" },
  },
  {
    id: "community_resource",
    label: "توفر المورد المشترك",
    observationType: "availability.state",
    condition: { op: "equals", field: "available", value: true },
    quiet: { available: false },
    matching: { available: true },
  },
  {
    // Commercial, and by the same engine: a price threshold is a comparison
    // over a payload field and nothing else.
    id: "offer_price",
    label: "سعر العرض",
    observationType: "offering.price",
    condition: { op: "less_than", field: "value", value: 50 },
    quiet: { value: 80 },
    matching: { value: 40 },
  },
] as const;

describe("a standing condition is one engine, evaluated durably", () => {
  let actor: typeof users.$inferSelect;
  let scope: ActingScope;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    runtime = await import("../../api/runtime/jasim-runtime");
    monitoring = await import("../../api/runtime/monitoring-runtime");
    scopes = await import("../../api/runtime/actor-scope");
    jobs = await import("../../api/runtime/block2/jobs");
    notifications = await import("../../api/runtime/block2/notifications");
    ({ ModelGateway } = await import("../../api/runtime/model-gateway"));
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE monitor_evaluations, standing_monitors, observations,
        notification_intents, events, scope_policies, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'mon-%'`));
    const [row] = await handle.db
      .insert(users)
      .values({ unionId: `mon-${randomUUID()}`, name: "نورة", preferences: {} })
      .returning();
    actor = row!;
    scope = { kind: "PERSONAL", scopeId: String(actor.id), principalId: String(actor.id) };
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const subjectId = () => `subj_${randomUUID().slice(0, 12)}`;

  const watch = (over: Partial<MonitorRequest> & { subjectId: string }) =>
    monitoring.createMonitor({
      request: {
        label: "مراقبة",
        subjectKind: "resource",
        observationType: "sensor.reading",
        sourceClass: "OBSERVATION",
        condition: { op: "greater_than", field: "celsius", value: 5 },
        evaluationMode: "EDGE",
        repeatPolicy: "ONE_SHOT",
        freshnessRequirement: "CURRENT",
        actionKind: "NOTIFY",
        actionChannels: [],
        ...over,
      },
      scope,
      conversationId: "c-test",
    });

  /** A real canonical observation, with a declared freshness horizon. */
  const observe = (
    subject: string,
    payload: Record<string, unknown>,
    over: { observationType?: string; freshnessTtlMs?: number; observedAt?: Date } = {},
  ) =>
    monitoring.recordObservationAndEvaluate({
      ownerId: scope.scopeId,
      subjectKind: "resource",
      subjectId: subject,
      observationType: over.observationType ?? "sensor.reading",
      payload,
      freshnessTtlMs: over.freshnessTtlMs ?? 3_600_000,
      ...(over.observedAt ? { observedAt: over.observedAt } : {}),
    });

  async function monitorRow(monitorId: string) {
    const rows = await handle.db.execute(
      sql.raw(`SELECT state, "triggerCount", "lastResult", "lastFreshness", version
        FROM standing_monitors WHERE id = '${monitorId}'`),
    );
    return rows.rows[0] as {
      state: string;
      triggerCount: number;
      lastResult: string;
      lastFreshness: string;
      version: number;
    };
  }

  async function evaluationRows(monitorId: string) {
    const rows = await handle.db.execute(
      sql.raw(`SELECT cursor, result, freshness, transition, triggered
        FROM monitor_evaluations WHERE "monitorId" = '${monitorId}' ORDER BY cursor`),
    );
    return rows.rows as {
      cursor: number;
      result: string;
      freshness: string;
      transition: string;
      triggered: boolean;
    }[];
  }

  /** A real turn, with the model saying only what a model may say. */
  async function turn(content: string, payload: Record<string, unknown>, conversationId?: string) {
    const conversation = conversationId
      ? { id: conversationId }
      : await runtime.createRuntimeConversation({ ownerId: String(actor.id), title: "monitors" });
    vi.spyOn(ModelGateway.prototype, "generate").mockResolvedValue({
      text: JSON.stringify({
        version: 1,
        decisionId: randomUUID(),
        kind: "direct_action",
        label: "مراقبة",
        goal: "شرط دائم",
        intent: {
          requiredCapabilities: [], missingInputs: [], inputs: {},
          risk: "low", persistence: "durable", effects: "none",
        },
        confidence: 0.9,
        monitoring: payload,
      }),
      provider: "openai",
      model: "stub-for-monitoring",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } as never);
    const result = await runtime.routeRuntimeConversationTurn({
      ownerId: String(actor.id),
      conversationId: conversation.id,
      content,
    });
    return {
      conversationId: conversation.id,
      output: result.output as Record<string, unknown>,
    };
  }

  // ── A · CREATE, from a real conversation ──────────────────────────────────

  it("A · «راقب هذا وأخبرني إذا تغيّر» creates a durable monitor", async () => {
    const subject = subjectId();
    const { output } = await turn("راقب حرارة المبرّد وأخبرني إذا تجاوزت ٥", {
      intent: "CREATE",
      monitor: {
        label: "حرارة المبرّد",
        subjectKind: "resource",
        subjectId: subject,
        observationType: "sensor.reading",
        condition: { op: "greater_than", field: "celsius", value: 5 },
        evaluationMode: "EDGE",
        repeatPolicy: "ONE_SHOT",
      },
    });
    expect(output.state).toBe("WATCHING");
    expect(output.cause).toBe("MONITOR_CREATED");
    const projected = (output.monitoring as { monitor: Record<string, unknown> }).monitor;
    expect(projected.state).toBe("ACTIVE");
    // No fake live, and the condition read back as a comparison.
    expect(projected.live).toBe(false);
    expect(String(projected.condition)).toContain(">");

    // A surface gets a generic STATUS built from canonical state — not an
    // invented tracker, and not a claim to be subscribed to anything.
    const presentation = output.presentation as { primitive: string; data: Record<string, unknown> };
    expect(["STATUS", "TRACKER", "PROGRESS"]).toContain(presentation.primitive);
    expect(presentation.data.state).toBe("ACTIVE");
    expect(presentation.data.lastResult).toBe("UNKNOWN");
    expect(JSON.stringify(presentation)).not.toMatch(/<script|function\s*\(|=>/);

    const rows = await handle.db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM standing_monitors WHERE "scopeId" = '${scope.scopeId}'`),
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
    // And no run, no DAG.
    const runs = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM runs`));
    expect((runs.rows[0] as { n: number }).n).toBe(0);
  });

  // ── B · NO MATCH ──────────────────────────────────────────────────────────

  it("B · an observation that does not satisfy the condition triggers nothing", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    const { outcomes } = await observe(subject, { celsius: 2 });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.result).toBe("FALSE");
    expect(outcomes[0]!.triggered).toBe(false);
    const row = await monitorRow(monitor.monitorId);
    expect(row.state).toBe("ACTIVE");
    expect(row.triggerCount).toBe(0);
  });

  // ── C · MATCH ─────────────────────────────────────────────────────────────

  it("C · a transition from false to true triggers exactly once", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    await observe(subject, { celsius: 2 });
    const { outcomes } = await observe(subject, { celsius: 9 });
    expect(outcomes[0]!.result).toBe("TRUE");
    expect(outcomes[0]!.transition).toBe("RISING");
    expect(outcomes[0]!.triggered).toBe(true);

    const row = await monitorRow(monitor.monitorId);
    expect(row.triggerCount).toBe(1);
    // ONE_SHOT, so it is finished rather than still watching.
    expect(row.state).toBe("TRIGGERED");
    const ledger = await evaluationRows(monitor.monitorId);
    expect(ledger.filter((entry) => entry.triggered)).toHaveLength(1);
  });

  // ── D · REPLAY ────────────────────────────────────────────────────────────

  it("D · the same observation replayed is not a second trigger", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, repeatPolicy: "REPEATING" });
    const { observation } = await observe(subject, { celsius: 9 });
    const first = await monitorRow(monitor.monitorId);
    expect(first.triggerCount).toBe(1);

    // The SAME canonical observation arriving again, as a redelivery would.
    const replay = await monitoring.evaluateMonitor({
      monitorId: monitor.monitorId,
      observation,
      sourceClass: "EVENT",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.triggered).toBe(false);
    const after = await monitorRow(monitor.monitorId);
    expect(after.triggerCount).toBe(1);
    expect(await evaluationRows(monitor.monitorId)).toHaveLength(1);
  });

  // ── E · REPEATING LEVEL ───────────────────────────────────────────────────

  it("E · a condition that stays true does not notify again", async () => {
    //   LEVEL != EDGE — the storm §10 exists to prevent.
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, repeatPolicy: "REPEATING" });
    await observe(subject, { celsius: 9 });
    await observe(subject, { celsius: 11 });
    await observe(subject, { celsius: 12 });

    const row = await monitorRow(monitor.monitorId);
    expect(row.triggerCount).toBe(1);
    const ledger = await evaluationRows(monitor.monitorId);
    expect(ledger.map((entry) => entry.transition)).toEqual(["RISING", "REPEAT", "REPEAT"]);
    expect(ledger.filter((entry) => entry.triggered)).toHaveLength(1);

    // It rises again only after actually falling.
    await observe(subject, { celsius: 1 });
    await observe(subject, { celsius: 20 });
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(2);
  });

  it("a LEVEL condition that repeats and notifies is refused, and says what to ask for", async () => {
    await expect(
      watch({ subjectId: subjectId(), evaluationMode: "LEVEL", repeatPolicy: "REPEATING" }),
    ).rejects.toThrow(/EDGE/);
  });

  // ── F · PAUSE ─────────────────────────────────────────────────────────────

  it("F · a paused monitor does not evaluate a matching observation", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    await monitoring.transitionMonitor({ monitorId: monitor.monitorId, scope, action: "pause" });
    const { outcomes } = await observe(subject, { celsius: 40 });
    expect(outcomes[0]).toBeUndefined();
    const row = await monitorRow(monitor.monitorId);
    expect(row.state).toBe("PAUSED");
    expect(row.triggerCount).toBe(0);
    expect(await evaluationRows(monitor.monitorId)).toHaveLength(0);
  });

  // ── G · RESUME ────────────────────────────────────────────────────────────

  it("G · resuming, then a new qualifying transition, triggers", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    await monitoring.transitionMonitor({ monitorId: monitor.monitorId, scope, action: "pause" });
    await observe(subject, { celsius: 40 });
    await monitoring.transitionMonitor({ monitorId: monitor.monitorId, scope, action: "resume" });
    const { outcomes } = await observe(subject, { celsius: 41 });
    expect(outcomes[0]!.triggered).toBe(true);
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(1);
  });

  // ── H · CROSS OWNER ───────────────────────────────────────────────────────

  it("H · another owner can neither read, change nor reach this monitor", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    const [other] = await handle.db
      .insert(users)
      .values({ unionId: `mon-${randomUUID()}`, name: "غريب", preferences: {} })
      .returning();
    const intruder: ActingScope = {
      kind: "PERSONAL",
      scopeId: String(other!.id),
      principalId: String(other!.id),
    };
    expect(await monitoring.readMonitor({ monitorId: monitor.monitorId, scope: intruder })).toBeUndefined();
    expect(await monitoring.listMonitors(intruder)).toHaveLength(0);
    for (const action of ["pause", "resume", "cancel"] as const) {
      await expect(
        monitoring.transitionMonitor({ monitorId: monitor.monitorId, scope: intruder, action }),
      ).rejects.toThrow(/No such monitor/);
    }
    await expect(
      monitoring.monitorEvaluationsSince({ monitorId: monitor.monitorId, scope: intruder }),
    ).rejects.toThrow(/No such monitor/);
  });

  it("an observation owned by another scope never reaches this monitor", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    const { recordObservation } = await import("../../api/runtime/block2/observations");
    const foreign = await recordObservation(handle.db, {
      ownerId: "someone-else",
      subjectKind: "resource",
      subjectId: subject,
      observationType: "sensor.reading",
      payload: { celsius: 99 },
      freshnessTtlMs: 3_600_000,
    });
    const outcomes = await monitoring.evaluateMonitorsForObservation({ observation: foreign });
    expect(outcomes).toHaveLength(0);
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(0);
  });

  it("a monitoring request cannot name its own scope or say it matched", async () => {
    for (const claim of [{ scopeId: "1" }, { ownerId: "1" }, { triggered: true }, { notified: true }]) {
      await expect(
        monitoring.createMonitor({
          request: { ...claim, label: "x", subjectKind: "resource", subjectId: subjectId(), observationType: "sensor.reading", condition: { op: "exists", field: "celsius" } },
          scope,
        }),
      ).rejects.toThrow(/runtime's word/);
    }
  });

  it("a monitor cannot widen its scope after it is created", async () => {
    const monitor = await watch({ subjectId: subjectId() });
    const organization = await scopes.createOrganization({
      principalId: String(actor.id),
      displayName: "شركة",
    });
    const orgScope: ActingScope = {
      kind: "ORGANIZATION",
      scopeId: scopes.organizationScopeId(organization.id),
      principalId: String(actor.id),
      organizationId: organization.id,
      displayName: "شركة",
    };
    // The same person, acting for a scope the monitor does not belong to.
    expect(await monitoring.readMonitor({ monitorId: monitor.monitorId, scope: orgScope })).toBeUndefined();
    await expect(
      monitoring.transitionMonitor({ monitorId: monitor.monitorId, scope: orgScope, action: "cancel" }),
    ).rejects.toThrow(/No such monitor/);
  });

  // ── I · RESTART / RELOAD ──────────────────────────────────────────────────

  it("I · a monitor's state, cursor and previous verdict survive a reload", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, repeatPolicy: "REPEATING" });
    await observe(subject, { celsius: 9 });

    // A read that shares nothing with the calls above: no cached module state,
    // no response object, straight out of Postgres.
    const reread = await monitoring.readMonitor({ monitorId: monitor.monitorId, scope });
    expect(reread!.lastResult).toBe("TRUE");
    expect(reread!.triggerCount).toBe(1);
    const ledger = await monitoring.monitorEvaluationsSince({ monitorId: monitor.monitorId, scope });
    expect(ledger).toHaveLength(1);
    // Resumable from the cursor, which is what a later transport subscribes on.
    const resumed = await monitoring.monitorEvaluationsSince({
      monitorId: monitor.monitorId,
      scope,
      after: ledger[0]!.cursor,
    });
    expect(resumed).toHaveLength(0);

    // A one-shot that already fired does not fire again after the reload.
    const oneShot = await watch({ subjectId: subject });
    await observe(subject, { celsius: 30 });
    expect((await monitorRow(oneShot.monitorId)).state).toBe("TRIGGERED");
    await observe(subject, { celsius: 31 });
    expect((await monitorRow(oneShot.monitorId)).triggerCount).toBe(1);
  });

  // ── J · MISSING PROVIDER ──────────────────────────────────────────────────

  it("J · a match with no delivery provider keeps the trigger and claims nothing", async () => {
    //   CONDITION_MATCHED != USER_NOTIFIED
    const subject = subjectId();
    const monitor = await watch({
      subjectId: subject,
      actionChannels: ["email", "sms"],
    });
    const { outcomes } = await observe(subject, { celsius: 9 });
    expect(outcomes[0]!.triggered).toBe(true);

    // The trigger is durable and did not evaporate with the delivery.
    const row = await monitorRow(monitor.monitorId);
    expect(row.triggerCount).toBe(1);
    expect(row.state).toBe("TRIGGERED");

    // And the projection says which channels have no provider, rather than
    // letting a person assume an email is on its way.
    const record = await monitoring.readMonitor({ monitorId: monitor.monitorId, scope });
    const projection = await monitoring.projectMonitor(record!);
    const delivery = projection.delivery as {
      unconfiguredChannels: string[];
      deliveryConfigured: boolean;
    };
    expect(delivery.deliveryConfigured).toBe(false);
    expect(delivery.unconfiguredChannels.sort()).toEqual(["email", "sms"]);

    // The notification is an INTENT, and its own state is the truth about
    // whether anybody was told. Nothing here says DELIVERED.
    const intents = await handle.db.execute(
      sql.raw(`SELECT state FROM notification_intents WHERE "ownerId" = '${scope.scopeId}'`),
    );
    expect(intents.rows).toHaveLength(1);
    expect((intents.rows[0] as { state: string }).state).not.toBe("DELIVERED");
  });

  it("an unconfigured channel reads BLOCKED_BY_PROVIDER at delivery, never SENT", async () => {
    const intent = await notifications.createNotificationIntent(handle.db, {
      ownerId: scope.scopeId,
      recipientId: String(actor.id),
      purpose: "standing-monitor-match",
      content: { title: "t", body: "b" },
      channels: ["email"],
      idempotencyKey: `t:${randomUUID()}`,
    });
    const delivered = await notifications.deliverNotificationIntent(handle.db, {
      intentId: intent.id,
      attemptContext: { runId: randomUUID(), nodeId: randomUUID(), attemptId: randomUUID() },
      adapters: [{ channel: "email", configured: false, async send() { return { outcome: "SENT" as const }; } }],
    });
    const states = delivered.channelStates as Record<string, { state: string }>;
    if (states.email) expect(states.email.state).toBe("BLOCKED_BY_PROVIDER");
  });

  // ── Freshness ─────────────────────────────────────────────────────────────

  it("yesterday's reading does not decide a question about now", async () => {
    //   UNKNOWN != FALSE, and a stale reading is not a current one.
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    await observe(subject, { celsius: 40 }, { observedAt: yesterday, freshnessTtlMs: 60_000 });
    const row = await monitorRow(monitor.monitorId);
    expect(row.lastFreshness).toBe("STALE");
    expect(row.lastResult).toBe("UNKNOWN");
    expect(row.triggerCount).toBe(0);
  });

  it("a reading with no declared horizon is UNKNOWN, never CURRENT", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject });
    const { recordObservation } = await import("../../api/runtime/block2/observations");
    const bare = await recordObservation(handle.db, {
      ownerId: scope.scopeId,
      subjectKind: "resource",
      subjectId: subject,
      observationType: "sensor.reading",
      payload: { celsius: 40 },
    });
    await monitoring.evaluateMonitorsForObservation({ observation: bare });
    const row = await monitorRow(monitor.monitorId);
    expect(row.lastFreshness).toBe("UNKNOWN");
    expect(row.triggerCount).toBe(0);
  });

  it("a monitor that explicitly permits history is decided by history", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, freshnessRequirement: "ANY" });
    const yesterday = new Date(Date.now() - 24 * 3_600_000);
    await observe(subject, { celsius: 40 }, { observedAt: yesterday, freshnessTtlMs: 60_000 });
    const row = await monitorRow(monitor.monitorId);
    expect(row.lastFreshness).toBe("STALE");
    expect(row.lastResult).toBe("TRUE");
    expect(row.triggerCount).toBe(1);
  });

  // ── Absence ───────────────────────────────────────────────────────────────

  it("absence needs a window, and is not inferred from silence", async () => {
    //   UNKNOWN != ABSENT
    await expect(
      watch({ subjectId: subjectId(), sourceClass: "ABSENCE" }),
    ).rejects.toThrow(/window/);

    const subject = subjectId();
    const monitor = await watch({
      subjectId: subject,
      sourceClass: "ABSENCE",
      windowMs: 3_600_000,
      condition: { op: "exists", field: "celsius" },
    });
    // A reading just arrived — nothing is absent.
    await observe(subject, { celsius: 2 });
    expect((await monitorRow(monitor.monitorId)).lastResult).toBe("FALSE");

    // Two hours later, with nothing since, the absence is a fact rather than
    // a guess: an expected observation, a window, and a clock.
    const later = new Date(Date.now() + 2 * 3_600_000);
    const outcome = await monitoring.evaluateMonitor({
      monitorId: monitor.monitorId,
      sourceClass: "ABSENCE_WINDOW",
      now: later,
    });
    expect(outcome.result).toBe("TRUE");
    expect(outcome.triggered).toBe(true);
  });

  // ── Concurrency ───────────────────────────────────────────────────────────

  it("two workers evaluating the same monitor produce one trigger", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, repeatPolicy: "REPEATING" });
    const { recordObservation } = await import("../../api/runtime/block2/observations");
    const observation = await recordObservation(handle.db, {
      ownerId: scope.scopeId,
      subjectKind: "resource",
      subjectId: subject,
      observationType: "sensor.reading",
      payload: { celsius: 9 },
      freshnessTtlMs: 3_600_000,
    });
    const [a, b] = await Promise.all([
      monitoring.evaluateMonitor({ monitorId: monitor.monitorId, observation }),
      monitoring.evaluateMonitor({ monitorId: monitor.monitorId, observation }),
    ]);
    expect([a.triggered, b.triggered].filter(Boolean)).toHaveLength(1);
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(1);
    expect(await evaluationRows(monitor.monitorId)).toHaveLength(1);
  });

  // ── Scheduled evaluation, on the existing duty cycle ──────────────────────

  it("the scheduled sweep evaluates a monitor with no event to wake it", async () => {
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, pollMs: 1_000 });
    const { recordObservation } = await import("../../api/runtime/block2/observations");
    await recordObservation(handle.db, {
      ownerId: scope.scopeId,
      subjectKind: "resource",
      subjectId: subject,
      observationType: "sensor.reading",
      payload: { celsius: 9 },
      freshnessTtlMs: 3_600_000,
    });
    // Nothing has evaluated it — the observation went in through the raw
    // primitive, which knows nothing about monitoring.
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(0);

    const swept = await monitoring.sweepDueMonitors({ now: new Date() });
    expect(swept.evaluated).toBeGreaterThan(0);
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(1);
  });

  it("the sweep is a step in the duty cycle that already existed", async () => {
    //   SECOND_SCHEDULERS_ADDED = 0
    const subject = subjectId();
    const monitor = await watch({ subjectId: subject, pollMs: 1_000 });
    const { recordObservation } = await import("../../api/runtime/block2/observations");
    await recordObservation(handle.db, {
      ownerId: scope.scopeId,
      subjectKind: "resource",
      subjectId: subject,
      observationType: "sensor.reading",
      payload: { celsius: 9 },
      freshnessTtlMs: 3_600_000,
    });
    const sweep = await jobs.runBlock2Sweep(handle.db, {
      dispatcher: { async dispatch() { return "enqueued" as const; } },
    });
    expect(sweep.monitors.evaluated).toBeGreaterThan(0);
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(1);
  });

  // ── Conversational lifecycle ──────────────────────────────────────────────

  it("«أوقف المراقبة» · «استأنفها» · «ما الذي تراقبه لي؟» all work across turns", async () => {
    const subject = subjectId();
    const created = await turn("راقب الحرارة", {
      intent: "CREATE",
      monitor: {
        label: "الحرارة",
        subjectKind: "resource",
        subjectId: subject,
        observationType: "sensor.reading",
        condition: { op: "greater_than", field: "celsius", value: 5 },
      },
    });
    const monitorId = ((created.output.monitoring as { monitor: { monitorId: string } }).monitor)
      .monitorId;

    // No reference given: it resolves from THIS conversation, not an ordinal.
    const paused = await turn("أوقف المراقبة", { intent: "PAUSE" }, created.conversationId);
    expect(paused.output.cause).toBe("MONITOR_PAUSED");
    expect((await monitorRow(monitorId)).state).toBe("PAUSED");

    const resumed = await turn("استأنفها", { intent: "RESUME" }, created.conversationId);
    expect(resumed.output.cause).toBe("MONITOR_ACTIVE");
    expect((await monitorRow(monitorId)).state).toBe("ACTIVE");

    const listed = await turn("ما الذي تراقبه لي؟", { intent: "LIST" }, created.conversationId);
    expect(listed.output.cause).toBe("MONITORS_LISTED");
    expect((listed.output.monitoring as { monitors: unknown[] }).monitors).toHaveLength(1);
  });

  it("a routed monitoring turn with no subject creates nothing", async () => {
    const { output } = await turn("راقب شيئاً", { intent: "CREATE" });
    expect(output.state).toBe("NEEDS_INPUT");
    expect(output.cause).toBe("MONITOR_SUBJECT_MISSING");
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM standing_monitors`));
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  // ── Policy ────────────────────────────────────────────────────────────────

  it("a rule of the scope can forbid watching, and nothing is created past it", async () => {
    await scopes.setScopePolicy({
      principalId: String(actor.id),
      scopeId: scope.scopeId,
      policyKey: "no_watching",
      value: {
        policySchema: "jasim.policy/1",
        actions: ["monitor.create"],
        conditions: [],
        effect: "DENY",
      },
    });
    await expect(watch({ subjectId: subjectId() })).rejects.toThrow(/forbids/);
    const rows = await handle.db.execute(sql.raw(`SELECT count(*)::int AS n FROM standing_monitors`));
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  // ── World monitors, on the cursor the last phase built ────────────────────

  it("a monitor watches world events by cursor, and never replays them", async () => {
    const worldId = `wld_${randomUUID().slice(0, 12)}`;
    const monitor = await watch({
      subjectId: worldId,
      subjectKind: "world",
      sourceClass: "WORLD_EVENT",
      observationType: "world.event",
      repeatPolicy: "REPEATING",
      condition: { op: "equals", field: "event_type", value: "WORLD_VERSION_CREATED" },
      freshnessRequirement: "ANY",
    });
    const insert = (type: string) =>
      handle.db.execute(
        sql.raw(`INSERT INTO events (type, source, payload, "ownerId", "correlationId", priority, processed)
          VALUES ('${type}', 'runtime', '{"version":"1.1.0"}'::jsonb, '${scope.scopeId}', '${worldId}', 'normal', true)`),
      );
    await insert("WORLD_MATERIALIZED");
    await insert("WORLD_VERSION_CREATED");

    const first = await monitoring.advanceWorldMonitors({ scopeId: scope.scopeId });
    expect(first.filter((outcome) => outcome.triggered)).toHaveLength(1);

    // Running again consumes nothing: the cursor moved past both.
    const second = await monitoring.advanceWorldMonitors({ scopeId: scope.scopeId });
    expect(second).toHaveLength(0);
    expect((await monitorRow(monitor.monitorId)).triggerCount).toBe(1);
  });

  // ── Holdout generality ────────────────────────────────────────────────────

  it("six unrelated subjects run through one engine with no branch", async () => {
    //   DOMAIN_MONITOR_TYPES_ADDED = 0
    for (const holdout of HOLDOUTS) {
      const subject = subjectId();
      const monitor = await watch({
        subjectId: subject,
        label: holdout.label,
        observationType: holdout.observationType,
        condition: holdout.condition as never,
        repeatPolicy: "REPEATING",
      });
      await observe(subject, holdout.quiet, { observationType: holdout.observationType });
      expect((await monitorRow(monitor.monitorId)).triggerCount, holdout.id).toBe(0);
      await observe(subject, holdout.matching, { observationType: holdout.observationType });
      expect((await monitorRow(monitor.monitorId)).triggerCount, holdout.id).toBe(1);
    }
    const rows = await handle.db.execute(
      sql.raw(`SELECT count(DISTINCT "observationType")::int AS n FROM standing_monitors`),
    );
    expect((rows.rows[0] as { n: number }).n).toBe(
      new Set(HOLDOUTS.map((holdout) => holdout.observationType)).size,
    );
  });

  // ── Observability ─────────────────────────────────────────────────────────

  it("the ledger records the verdict and never the reading", async () => {
    const subject = subjectId();
    const secret = `private-${randomUUID()}`;
    const monitor = await watch({
      subjectId: subject,
      condition: { op: "equals", field: "note", value: secret },
      freshnessRequirement: "ANY",
    });
    await observe(subject, { note: secret, celsius: 9 });
    const ledger = await handle.db.execute(
      sql.raw(`SELECT to_jsonb(t) AS row FROM monitor_evaluations t WHERE "monitorId" = '${monitor.monitorId}'`),
    );
    // Asserted as an absence: the private payload is not in the audit record.
    expect(JSON.stringify(ledger.rows).includes(secret)).toBe(false);
    const rows = ledger.rows as { row: { result: string; freshness: string; transition: string } }[];
    expect(rows[0]!.row.result).toBe("TRUE");
    expect(rows[0]!.row.transition).toBe("RISING");
  });
});
