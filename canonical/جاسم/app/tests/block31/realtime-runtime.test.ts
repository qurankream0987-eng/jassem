/**
 * JASIM — A SOCKET CARRIES CHANGE. IT DOES NOT CREATE IT.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   REALTIME TRANSPORT != TRUTH
 *   TRANSPORT_CONNECTED != DATA_CURRENT
 *
 *   CANONICAL STATE CHANGE -> DURABLE EVENT -> AUTHORIZED SUBSCRIPTION
 *   -> TRANSPORT -> CLIENT CURSOR -> RECONCILIATION -> PROJECTION UPDATE
 *
 * Real sockets over a real HTTP server, against a real PostgreSQL ledger. A
 * "delivered" event is always one a client actually received on a wire, and a
 * "recovered" one is always read back after the socket that would have carried
 * it was destroyed.
 */

import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { sql } from "drizzle-orm";
import { users } from "@db/schema";
import { getTestDb, resetBlock31, type TestDbHandle } from "./helpers/pg";

let handle: TestDbHandle;
let realtime: typeof import("../../api/runtime/realtime-runtime");
let socketModule: typeof import("../../api/core/websocket");
let monitoring: typeof import("../../api/runtime/monitoring-runtime");
let world: typeof import("../../api/runtime/world-runtime");
let scopes: typeof import("../../api/runtime/actor-scope");

type ActingScope = import("../../api/runtime/actor-scope").ActingScope;

const servers: Server[] = [];
const sockets: WebSocket[] = [];

type Client = {
  socket: WebSocket;
  frames: Array<Record<string, unknown>>;
  /** Every realtime event this client actually received on the wire. */
  events: Array<{ cursor: number; eventId: string; type: string; subject?: { kind: string; id: string }; signal?: Record<string, string>; revision?: string }>;
  /** The cursor the SERVER told this client, which is all a client knows. */
  cursor: () => number | undefined;
};

describe("one realtime runtime over one durable ledger", () => {
  let actor: typeof users.$inferSelect;
  let other: typeof users.$inferSelect;
  let scope: ActingScope;
  let otherScope: ActingScope;

  beforeAll(async () => {
    handle = await getTestDb();
    process.env.JASIM_DISABLE_MEMORY_EXTRACTION = "1";
    realtime = await import("../../api/runtime/realtime-runtime");
    socketModule = await import("../../api/core/websocket");
    monitoring = await import("../../api/runtime/monitoring-runtime");
    world = await import("../../api/runtime/world-runtime");
    scopes = await import("../../api/runtime/actor-scope");
  });

  beforeEach(async () => {
    await resetBlock31(handle.db);
    await handle.db.execute(
      sql.raw(`TRUNCATE TABLE events, monitor_evaluations, standing_monitors, observations,
        system_versions, generated_systems, memberships, organizations CASCADE`),
    );
    await handle.db.execute(sql.raw(`DELETE FROM users WHERE "unionId" LIKE 'rt-%'`));
    const inserted = await handle.db
      .insert(users)
      .values([
        { unionId: `rt-${randomUUID()}`, name: "سارة", preferences: {} },
        { unionId: `rt-${randomUUID()}`, name: "فهد", preferences: {} },
      ])
      .returning();
    actor = inserted[0]!;
    other = inserted[1]!;
    scope = { kind: "PERSONAL", scopeId: String(actor.id), principalId: String(actor.id) };
    otherScope = { kind: "PERSONAL", scopeId: String(other.id), principalId: String(other.id) };
    realtime.resetRealtimeMetrics();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  // ── Harness ───────────────────────────────────────────────────────────────

  /** A real server, authenticating exactly as production does minus the JWT. */
  async function startServer(): Promise<string> {
    const server = createServer();
    servers.push(server);
    new socketModule.JasimWebSocketServer(server, {
      authenticate: async (headers) => {
        const token = headers.get("authorization");
        if (token === `Bearer ${actor.id}`) return { userId: String(actor.id) };
        if (token === `Bearer ${other.id}`) return { userId: String(other.id) };
        throw new Error("invalid credential");
      },
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    return `ws://127.0.0.1:${address.port}`;
  }

  async function connect(
    url: string,
    as: typeof users.$inferSelect,
    subscription: Record<string, unknown>,
  ): Promise<Client> {
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${as.id}` } });
    sockets.push(socket);
    const frames: Array<Record<string, unknown>> = [];
    const events: Client["events"] = [];
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      frames.push(frame);
      if (frame.type === "realtime.events") {
        for (const entry of frame.events as Client["events"]) events.push(entry);
        socket.send(JSON.stringify({ type: "realtime.ack", cursor: frame.cursor }));
      }
    });
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    // Wait for the server's VERDICT rather than for a timeout. A fixed sleep
    // turns "the subscription was refused" and "the subscription had not
    // finished" into the same observation, which is the one distinction these
    // tests exist to make.
    const settled = new Promise<void>((done) => {
      const check = (raw: Buffer): void => {
        const frame = JSON.parse(raw.toString()) as { type?: string };
        if (frame.type === "realtime.subscribed" || frame.type === "realtime.error") {
          socket.off("message", check);
          done();
        }
      };
      socket.on("message", check);
      setTimeout(() => {
        socket.off("message", check);
        done();
      }, 2_000);
    });
    socket.send(JSON.stringify({ type: "realtime.subscribe", subscription }));
    await settled;
    return {
      socket,
      frames,
      events,
      cursor: () => {
        // The last cursor the server sent — the subscription's own, then each
        // delivery's. A client has no other source for it, which is the point.
        for (let index = frames.length - 1; index >= 0; index -= 1) {
          const frame = frames[index]!;
          if (frame.type === "realtime.subscribed" || frame.type === "realtime.events") {
            return Number(frame.cursor);
          }
        }
        return undefined;
      },
    };
  }

  const settle = () => new Promise((done) => setTimeout(done, 40));

  /**
   * Carry the ledger, honouring the stability lag.
   *
   * The lag is real — a cursor may not advance past an event young enough that
   * an older sibling might still be committing — so the tests move the clock
   * forward rather than sleeping through it.
   */
  const deliver = async () => {
    const now = new Date(Date.now() + realtime.REALTIME_LIMITS.STABILITY_LAG_MS + 50);
    const result = await socketModule.deliverRealtime({ now });
    await settle();
    return result;
  };

  const scopeTopics = [{ stream: "SCOPE" as const }];

  const watch = (subjectId: string, as: ActingScope = scope) =>
    monitoring.createMonitor({
      request: {
        label: "مراقبة",
        subjectKind: "resource",
        subjectId,
        observationType: "sensor.reading",
        condition: { op: "greater_than", field: "value", value: 5 },
        evaluationMode: "EDGE",
        repeatPolicy: "REPEATING",
      },
      scope: as,
      conversationId: "c-rt",
    });

  const observe = (subjectId: string, value: number, as: ActingScope = scope) =>
    monitoring.recordObservationAndEvaluate({
      ownerId: as.scopeId,
      subjectKind: "resource",
      subjectId,
      observationType: "sensor.reading",
      payload: { value },
      freshnessTtlMs: 3_600_000,
    });

  const materialize = (title: string, as: ActingScope = scope) =>
    world.materializeWorld({
      proposal: { title, entities: [{ key: "thing", label: "شيء", fields: [] }] },
      scope: as,
      requestKey: randomUUID(),
      statedAs: "test",
    });

  // ── 1. Authorization, before a subscription exists ────────────────────────

  it("a subscription is authorized server-side, and a guessed id buys nothing", async () => {
    const { record } = await materialize("عالم سارة");
    const monitor = await watch("subj-a");
    const url = await startServer();

    // The owner may name them.
    const owner = await connect(url, actor, {
      topics: [
        { stream: "ENTITY", entityKind: "world", entityId: record.worldId },
        { stream: "ENTITY", entityKind: "monitor", entityId: monitor.monitorId },
      ],
    });
    expect(owner.frames.some((frame) => frame.type === "realtime.subscribed")).toBe(true);

    // A stranger naming the SAME ids is refused — and told nothing about them.
    const stranger = await connect(url, other, {
      topics: [{ stream: "ENTITY", entityKind: "world", entityId: record.worldId }],
    });
    const refusal = stranger.frames.find((frame) => frame.type === "realtime.error");
    expect(refusal?.code).toBe("FORBIDDEN");
    expect(String(refusal?.message)).not.toContain(record.worldId);
    expect(stranger.cursor()).toBeUndefined();
  });

  it("a subscriber cannot grant itself a scope, a permission or a trust", async () => {
    const url = await startServer();
    for (const claim of [
      { topics: scopeTopics, scopeId: String(other.id) },
      { topics: scopeTopics, ownerId: String(other.id) },
      { topics: scopeTopics, authorized: true },
    ]) {
      const client = await connect(url, actor, claim);
      expect(client.frames.find((frame) => frame.type === "realtime.error")?.code).toBe("FORBIDDEN");
    }
  });

  it("an organization outsider cannot subscribe to the organization's events", async () => {
    const organization = await scopes.createOrganization({
      principalId: String(actor.id),
      displayName: "شركة",
    });
    const url = await startServer();
    const outsider = await connect(url, other, {
      topics: scopeTopics,
      organizationId: organization.id,
    });
    expect(outsider.frames.find((frame) => frame.type === "realtime.error")?.code).toBe("FORBIDDEN");
    // The member may.
    const member = await connect(url, actor, {
      topics: scopeTopics,
      organizationId: organization.id,
    });
    expect(member.frames.some((frame) => frame.type === "realtime.subscribed")).toBe(true);
  });

  it("a malformed or oversized subscription is refused, not truncated", async () => {
    const url = await startServer();
    for (const bad of [
      { topics: [] },
      { topics: [{ stream: "EVERYTHING" }] },
      { topics: [{ stream: "ENTITY", entityKind: "secrets", entityId: "x" }] },
      { topics: Array.from({ length: 64 }, () => ({ stream: "SCOPE" })) },
      "not-an-object",
    ]) {
      const client = await connect(url, actor, bad as never);
      expect(client.frames.some((frame) => frame.type === "realtime.error")).toBe(true);
      expect(client.frames.some((frame) => frame.type === "realtime.subscribed")).toBe(false);
    }
  });

  // ── 2. Cross-owner isolation on the wire ──────────────────────────────────

  it("one owner's events never reach another owner's socket", async () => {
    const url = await startServer();
    const mine = await connect(url, actor, { topics: scopeTopics });
    const theirs = await connect(url, other, { topics: scopeTopics });

    const monitor = await watch("subj-a");
    await observe("subj-a", 9);
    await deliver();

    expect(mine.events.length).toBeGreaterThan(0);
    expect(mine.events.some((event) => event.subject?.id === monitor.monitorId)).toBe(true);
    expect(theirs.events).toHaveLength(0);
  });

  // ── 3. Monitor realtime (§17) ─────────────────────────────────────────────

  it("a monitor evaluation reaches a connected client with no refresh", async () => {
    const url = await startServer();
    const monitor = await watch("subj-a");
    const client = await connect(url, actor, {
      topics: [{ stream: "ENTITY", entityKind: "monitor", entityId: monitor.monitorId }],
    });

    await observe("subj-a", 9);
    await deliver();

    const delivered = client.events.filter((event) => event.type === "MONITOR_EVALUATED");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.subject).toEqual({ kind: "monitor", id: monitor.monitorId });
    expect(delivered[0]!.signal?.result).toBe("TRUE");
    expect(delivered[0]!.signal?.transition).toBe("RISING");
    // The reading itself never travels.
    expect(JSON.stringify(client.events)).not.toContain("\"value\"");
  });

  it("a missed evaluation is recovered from the cursor after a reconnect", async () => {
    const url = await startServer();
    const monitor = await watch("subj-a");
    const first = await connect(url, actor, {
      topics: [{ stream: "ENTITY", entityKind: "monitor", entityId: monitor.monitorId }],
    });
    await observe("subj-a", 9);
    await deliver();
    const cursor = first.cursor()!;
    expect(first.events).toHaveLength(1);

    // The socket is DESTROYED, not closed politely. Then the world moves.
    first.socket.terminate();
    await settle();
    await observe("subj-a", 1);
    await observe("subj-a", 20);

    // A new connection, resuming from where the old one stopped.
    const resumed = await connect(url, actor, {
      topics: [{ stream: "ENTITY", entityKind: "monitor", entityId: monitor.monitorId }],
      cursor,
    });
    await deliver();
    expect(resumed.events.length).toBeGreaterThanOrEqual(2);
    expect(resumed.events.map((event) => event.signal?.transition)).toContain("FALLING");
    expect(resumed.events.map((event) => event.signal?.transition)).toContain("RISING");
    // Strictly increasing, with no repeats.
    const cursors = resumed.events.map((event) => event.cursor);
    expect([...cursors].sort((a, b) => a - b)).toEqual(cursors);
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  // ── 4. World realtime (§18) ───────────────────────────────────────────────

  it("a world mutation advances a subscriber to the correct version", async () => {
    const url = await startServer();
    const { record } = await materialize("عالم");
    const client = await connect(url, actor, {
      topics: [{ stream: "ENTITY", entityKind: "world", entityId: record.worldId }],
    });

    const applied = await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [{ operation: "add", target: "entity", key: "bay", value: { label: "خانة", fields: [] } }],
      expectedVersion: record.version,
      requestKey: randomUUID(),
    });
    await deliver();

    const versionEvent = client.events.find((event) => event.type === "WORLD_VERSION_CREATED");
    expect(versionEvent?.revision).toBe(applied.record.version);
    // The client re-reads the canonical projection; the event only said which.
    const reread = await world.readWorld({ worldId: record.worldId, scope });
    expect(reread!.version).toBe(versionEvent!.revision);
  });

  it("realtime does not let a stale writer past the version precondition", async () => {
    //   REALTIME DOES NOT BYPASS expectedVersion
    const url = await startServer();
    const { record } = await materialize("عالم");
    await connect(url, actor, { topics: scopeTopics });
    const stale = record.version;

    await world.applyWorldChangeSet({
      worldId: record.worldId,
      scope,
      changes: [{ operation: "add", target: "entity", key: "a", value: { label: "أ", fields: [] } }],
      expectedVersion: stale,
      requestKey: randomUUID(),
    });
    await deliver();

    // A client that watched the first change land and wrote from what it had
    // BEFORE it is still refused. A socket is not a lock.
    await expect(
      world.applyWorldChangeSet({
        worldId: record.worldId,
        scope,
        changes: [{ operation: "add", target: "entity", key: "b", value: { label: "ب", fields: [] } }],
        expectedVersion: stale,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ── 5. Observation realtime (§19) ─────────────────────────────────────────

  it("an observation updates an authorized status through the same runtime", async () => {
    const url = await startServer();
    const client = await connect(url, actor, { topics: scopeTopics });
    await observe("subj-x", 3);
    await deliver();

    const recorded = client.events.find((event) => event.type === "OBSERVATION_RECORDED");
    expect(recorded).toBeTruthy();
    expect(recorded!.signal?.freshness).toBe("CURRENT");
    // The reading is not in it. A subscriber that needs it reads it.
    expect(JSON.stringify(recorded)).not.toContain("\"value\"");
    expect(recorded).not.toHaveProperty("payload");
  });

  // ── 6. Cursor semantics (§6, §9) ──────────────────────────────────────────

  it("a cursor that cannot be honoured returns a typed reconciliation, never a guess", async () => {
    const subscription = await realtime.authorizeSubscription({
      principalId: String(actor.id),
      request: { topics: scopeTopics },
    });
    await observe("subj-a", 1);
    const bounds = await realtime.ledgerBounds();

    for (const bad of [-1, 1.5, Number.NaN, bounds.newest + 5_000]) {
      const result = await realtime.catchUp({ subscription, cursor: bad as number });
      expect(result.status, String(bad)).toBe("RESYNC_REQUIRED");
    }
    // And a valid one does not.
    expect((await realtime.catchUp({ subscription, cursor: 0 })).status).toBe("OK");
  });

  it("a cursor older than what the ledger still holds asks for a resync", async () => {
    await observe("subj-a", 1);
    await handle.db.execute(sql.raw(`DELETE FROM events WHERE id <= (SELECT MIN(id) FROM events)`));
    const subscription = await realtime.authorizeSubscription({
      principalId: String(actor.id),
      request: { topics: scopeTopics },
    });
    const bounds = await realtime.ledgerBounds();
    const result = await realtime.catchUp({ subscription, cursor: 1 });
    if (bounds.oldest > 2) {
      expect(result.status).toBe("RESYNC_REQUIRED");
      if (result.status === "RESYNC_REQUIRED") expect(result.reason).toBe("CURSOR_BEHIND_RETENTION");
    }
  });

  it("a new subscriber starts at the head, not at the beginning of time", async () => {
    await observe("subj-a", 1);
    await observe("subj-a", 2);
    const url = await startServer();
    const client = await connect(url, actor, { topics: scopeTopics });
    await deliver();
    // Everything before it connected is already on its screen.
    expect(client.events).toHaveLength(0);
    expect(client.cursor()).toBe((await realtime.ledgerBounds()).newest);
  });

  // ── 7. Ordering and deduplication (§7, §8) ────────────────────────────────

  it("events arrive in ledger order and never twice", async () => {
    const url = await startServer();
    const client = await connect(url, actor, { topics: scopeTopics });
    for (const value of [9, 1, 9, 1, 9]) await observe("subj-a", value);
    // Delivered in two passes, so the second overlaps the first's range.
    await deliver();
    await deliver();

    const cursors = client.events.map((event) => event.cursor);
    expect([...cursors].sort((a, b) => a - b)).toEqual(cursors);
    expect(new Set(cursors).size).toBe(cursors.length);
    const ids = client.events.map((event) => event.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── 8. Server restart (§26) ───────────────────────────────────────────────

  it("a server restart costs a reconnect and erases nothing", async () => {
    const monitor = await watch("subj-a");
    const first = await startServer();
    const before = await connect(first, actor, { topics: scopeTopics });
    await observe("subj-a", 9);
    await deliver();
    const cursor = before.cursor()!;
    expect(before.events.length).toBeGreaterThan(0);

    // The whole process's transport goes away, connections and registry with it.
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
    // And the world keeps moving while there is nothing listening.
    await observe("subj-a", 1);
    await materialize("عالم بعد إعادة التشغيل");

    const after = await startServer();
    const resumed = await connect(after, actor, { topics: scopeTopics, cursor });
    await deliver();
    expect(resumed.events.length).toBeGreaterThanOrEqual(2);
    expect(resumed.events.some((event) => event.type === "WORLD_MATERIALIZED")).toBe(true);
    expect(resumed.events.every((event) => event.cursor > cursor)).toBe(true);
    void monitor;
  });

  // ── 9. Multi-tab and multi-device (§24) ───────────────────────────────────

  it("two connections for one person both receive, with independent cursors", async () => {
    const url = await startServer();
    const tab = await connect(url, actor, { topics: scopeTopics });
    await observe("subj-a", 9);
    await deliver();

    // A second device joins later, at the head, and does not close the first.
    const phone = await connect(url, actor, { topics: scopeTopics });
    expect(tab.socket.readyState).toBe(WebSocket.OPEN);

    await observe("subj-a", 1);
    await deliver();
    expect(tab.events.length).toBeGreaterThanOrEqual(2);
    expect(phone.events.length).toBeGreaterThanOrEqual(1);
    // Different cursors, same canonical truth.
    expect(phone.events.every((event) => tab.events.some((seen) => seen.eventId === event.eventId))).toBe(true);
  });

  // ── 10. Backpressure (§23) ────────────────────────────────────────────────

  it("a subscriber that cannot keep up is told to resync, never quietly skipped", async () => {
    const subscription = await realtime.authorizeSubscription({
      principalId: String(actor.id),
      request: { topics: scopeTopics },
    });
    const decision = realtime.decideDelivery({
      queued: realtime.REALTIME_LIMITS.MAX_QUEUE,
      incoming: [
        {
          cursor: 9,
          eventId: "evt_9",
          type: "X",
          occurredAt: new Date().toISOString(),
          scopeId: scope.scopeId,
        },
      ],
      cursor: 4,
    });
    expect(decision.action).toBe("RESYNC_REQUIRED");
    void subscription;
  });

  // ── 11. Permission revocation during a live connection (§27) ──────────────

  it("a revoked member stops receiving the organization's events", async () => {
    const organization = await scopes.createOrganization({
      principalId: String(actor.id),
      displayName: "شركة",
    });
    const orgScope: ActingScope = {
      kind: "ORGANIZATION",
      scopeId: scopes.organizationScopeId(organization.id),
      principalId: String(other.id),
      organizationId: organization.id,
      displayName: "شركة",
    };
    const { grantMembership, revokeMembership } = await import("../../api/runtime/block2/membership");
    const granted = await grantMembership(handle.db, {
      ownerId: orgScope.scopeId,
      subjectId: String(other.id),
      resourceKind: "organization",
      resourceId: "*",
      permissions: ["view"],
      purpose: undefined,
    });

    const url = await startServer();
    const member = await connect(url, other, {
      topics: scopeTopics,
      organizationId: organization.id,
    });
    expect(member.frames.some((frame) => frame.type === "realtime.subscribed")).toBe(true);

    await revokeMembership(handle.db, {
      membershipId: granted.membership.id,
      actorOwnerId: orgScope.scopeId,
    });

    // The long-lived connection may not keep the authority it had. Re-running
    // the authorization is what the reconnect path does, and it now refuses.
    await expect(
      realtime.authorizeSubscription({
        principalId: String(other.id),
        request: { topics: scopeTopics, organizationId: organization.id },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── 12. Nothing sensitive on the wire (§15, §27) ──────────────────────────

  it("no private reading, policy or secret reaches a socket", async () => {
    const sentinel = `s3cr3t-${randomUUID()}`;
    const url = await startServer();
    const client = await connect(url, actor, { topics: scopeTopics });

    await monitoring.recordObservationAndEvaluate({
      ownerId: scope.scopeId,
      subjectKind: "resource",
      subjectId: "subj-secret",
      observationType: "sensor.reading",
      payload: { value: 9, note: sentinel },
      freshnessTtlMs: 3_600_000,
    });
    const { record } = await materialize(`عالم ${sentinel}`);
    await deliver();

    // Asserted as an absence: the sentinel is never printed.
    expect(JSON.stringify(client.frames).includes(sentinel)).toBe(false);
    expect(client.events.length).toBeGreaterThan(0);
    // What DID travel is the reference and the closed-vocabulary signal.
    expect(client.events.some((event) => event.subject?.id === record.worldId)).toBe(true);
  });

  // ── 13. Heartbeat (§11) ───────────────────────────────────────────────────

  it("a connection that stopped answering is closed, not left CONNECTED forever", async () => {
    const server = createServer();
    servers.push(server);
    const jasim = new socketModule.JasimWebSocketServer(server, {
      authenticate: async () => ({ userId: String(actor.id) }),
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      headers: { authorization: `Bearer ${actor.id}` },
    });
    sockets.push(socket);
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", fail);
    });
    await settle();

    // A sweep pings. A LIVE peer answers, so the next sweep finds it alive.
    expect(jasim.sweepHeartbeats().pinged).toBeGreaterThan(0);
    await settle();
    expect(jasim.sweepHeartbeats().closed).toBe(0);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    // A peer that stops ANSWERING — not one that closed. Pausing the
    // underlying TCP stream means ping frames are never read and no pong is
    // ever sent, while the connection stays OPEN on both sides. That is
    // exactly the silent death a heartbeat exists to find, and without it the
    // server would hold this connection as CONNECTED forever.
    (socket as unknown as { _socket: { pause(): void } })._socket.pause();
    let closed = 0;
    // Two sweeps: one to send a ping that will never be answered, one to find
    // that it was not. Summed, because whichever sweep notices is the same
    // fact — the connection did not survive being silent.
    for (let sweep = 0; sweep < 2; sweep += 1) {
      closed += jasim.sweepHeartbeats().closed;
      await settle();
    }
    expect(closed).toBeGreaterThan(0);
    expect(jasim.getConnectionCount()).toBe(0);
  });

  // ── 14. Generality holdouts (§28) ─────────────────────────────────────────

  it("unrelated object types ride the same subscription and the same cursor", async () => {
    //   DOMAIN_REALTIME_CHANNELS_ADDED = 0
    const url = await startServer();
    const client = await connect(url, actor, { topics: scopeTopics });

    // A world, a monitor, a device-shaped reading, a calibration and a shared
    // resource — none of which the transport has heard of.
    await materialize("نظام");
    await watch("valve-7");
    await observe("valve-7", 9);
    for (const [subject, type] of [
      ["calibrator-2", "procedure.state"],
      ["resource-9", "availability.state"],
    ] as const) {
      await monitoring.recordObservationAndEvaluate({
        ownerId: scope.scopeId,
        subjectKind: "resource",
        subjectId: subject,
        observationType: type,
        payload: { phase: "CALIBRATED" },
        freshnessTtlMs: 3_600_000,
      });
    }
    await deliver();

    const types = new Set(client.events.map((event) => event.type));
    expect(types.has("WORLD_MATERIALIZED")).toBe(true);
    expect(types.has("MONITOR_EVALUATED")).toBe(true);
    expect(types.has("OBSERVATION_RECORDED")).toBe(true);
    // ONE ordered cursor across all of them.
    const cursors = client.events.map((event) => event.cursor);
    expect([...cursors].sort((a, b) => a - b)).toEqual(cursors);
  });

  // ── 15. Metrics (§34) ─────────────────────────────────────────────────────

  it("records counters and one latency, and nothing that was said", async () => {
    const url = await startServer();
    await connect(url, actor, { topics: scopeTopics });
    await observe("subj-a", 9);
    await deliver();
    const metrics = realtime.realtimeMetrics();
    expect(metrics.subscriptions).toBeGreaterThan(0);
    expect(metrics.eventsDelivered).toBeGreaterThan(0);
    expect(metrics.lastDeliveryLatencyMs).toBeGreaterThanOrEqual(0);
    // Counters only. No identity, no payload, no message.
    expect(JSON.stringify(metrics)).not.toContain(scope.scopeId);
  });
});
