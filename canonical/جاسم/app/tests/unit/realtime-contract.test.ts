/**
 * JASIM — TRANSPORT IS NOT TRUTH.
 *
 * ─── WHAT IS UNDER TEST ─────────────────────────────────────────────────────
 *
 *   REALTIME TRANSPORT != TRUTH
 *   TRANSPORT_CONNECTED != DATA_CURRENT
 *
 * The contract half: the envelope's redaction, the subscription filter, the
 * client state machine, ordering, deduplication and backpressure. The live
 * half — a real socket, a real ledger and a real reconnect — is
 * `tests/block31/realtime-runtime.test.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REALTIME_AUTHORITY_KEYS,
  REALTIME_ENTITY_KINDS,
  REALTIME_LIMITS,
  REALTIME_STREAMS,
  RealtimeError,
  RealtimeSubscribeSchema,
  assertNoRealtimeAuthorityClaim,
  decideDelivery,
  envelopeOf,
  subscriptionWants,
  type AuthorizedSubscription,
  type RealtimeEvent,
} from "../../api/runtime/realtime-runtime";
import {
  RealtimeSession,
  backoffMs,
  changedSubjects,
  connectionNotice,
} from "../../src/lib/realtime-client";
import { AUTHORITY_KEYS } from "../../api/runtime/model-output-trust";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

const row = (over: Partial<Parameters<typeof envelopeOf>[0]> = {}) => ({
  id: 10,
  type: "MONITOR_EVALUATED",
  ownerId: "7",
  correlationId: "mon_1",
  payload: {} as Record<string, unknown>,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...over,
});

const subscription = (over: Partial<AuthorizedSubscription> = {}): AuthorizedSubscription => ({
  scope: { kind: "PERSONAL", scopeId: "7", principalId: "7" },
  topics: [{ stream: "SCOPE" }],
  entityFilter: new Set<string>(),
  scopeWide: true,
  ...over,
});

const event = (over: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  cursor: 1,
  eventId: "evt_1",
  type: "WORLD_VERSION_CREATED",
  occurredAt: "2026-01-01T00:00:00.000Z",
  scopeId: "7",
  ...over,
});

// ── One system, and it names nothing ────────────────────────────────────────

describe("there is one realtime system", () => {
  it("adds no socket server, no ledger and no channel per subject", () => {
    //   SECOND_SOCKET_SERVERS_ADDED = 0 · SECOND_EVENT_LEDGERS_ADDED = 0
    const runtime = source("api/runtime/realtime-runtime.ts");
    expect(runtime).not.toMatch(/new WebSocketServer\(/);
    expect(runtime).not.toMatch(/pgTable\(/);
    for (const forbidden of ["WorldRealtime", "MonitorRealtime", "OrderRealtime", "MapRealtime", "MobileRealtime", "NegotiationRealtime"]) {
      expect(runtime, forbidden).not.toContain(forbidden);
    }
    // It reuses the socket server and the ledger that already existed.
    const socket = source("api/core/websocket.ts");
    expect(socket).toContain("JasimWebSocketServer");
    expect(runtime).toContain('from "../../db/schema"');
  });

  it("declares no domain channel and no domain event kind", () => {
    //   DOMAIN_REALTIME_CHANNELS_ADDED = 0
    const DOMAIN = ["restaurant", "factory", "driver", "job", "payment", "warehouse", "order", "delivery"];
    for (const entry of [...REALTIME_STREAMS, ...REALTIME_ENTITY_KINDS]) {
      for (const word of DOMAIN) {
        expect(entry.toLowerCase(), entry).not.toContain(word);
      }
    }
  });

  it("names no database table in the subscription vocabulary", () => {
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // WHAT IT ASSERTED: that no entity kind contained any of four hand-listed
    //   table names, or the character `_`.
    // WHY IT MUST CHANGE: `_` was a PROXY for "looks like a table name", and
    //   the living object phase added the entity kind `living_object` — a
    //   semantic name for a canonical subject, not a table. The table is
    //   `living_objects`. The proxy fired on a correct name.
    // WHAT IT ASSERTS NOW: that no entity kind matches ANY table this schema
    //   actually declares, read from the schema files themselves.
    // WHY THIS IS NOT WEAKER: the old list named four tables and would have
    //   missed `runs`, `bubbles`, `commitments`, `transactions` and every
    //   table added after it was written. This one cannot miss any of them,
    //   and it keeps catching new ones for free. The `_` heuristic is the only
    //   thing lost, and it was never the rule — the rule is "no table names",
    //   and the rule is now checked directly.
    //
    const schema = [
      readFileSync(resolve(process.cwd(), "db/schema.ts"), "utf8"),
      readFileSync(resolve(process.cwd(), "db/schema-block2.ts"), "utf8"),
    ].join("\n");
    const tables = [...schema.matchAll(/pgTable\(\s*\n?\s*"([^"]+)"/g)].map((match) => match[1]!);
    expect(tables.length).toBeGreaterThan(40);
    expect(tables).toContain("living_objects");
    for (const entry of REALTIME_ENTITY_KINDS) {
      for (const table of tables) {
        expect(entry, `${entry} names the table ${table}`).not.toBe(table);
      }
    }
  });

  it("the client state machine is shared by both surfaces, not duplicated", () => {
    //   MOBILE_REALTIME_ARCHITECTURES_ADDED = 0
    const web = source("src/lib/realtime-client.ts");
    const mobile = source("../../../artifacts/jasim-mobile/lib/realtime.ts");
    for (const text of [web, mobile]) {
      // Same state names, same backoff shape, same dedupe limit, same rule.
      for (const token of ["RESYNC_REQUIRED", "OFFLINE", "backoffMs", "changedSubjects", "SEEN_LIMIT"]) {
        expect(text, token).toContain(token);
      }
    }
    expect(mobile).toContain("MOBILE_REALTIME_ARCHITECTURES_ADDED = 0");
  });

  it("every realtime authority key is also refused in model output", () => {
    for (const key of REALTIME_AUTHORITY_KEYS) {
      expect(AUTHORITY_KEYS, key).toContain(key);
    }
  });
});

// ── The subscription contract ───────────────────────────────────────────────

describe("a subscription says what to hear, never that it may", () => {
  it("refuses a request that grants itself anything", () => {
    for (const claim of [
      { scopeId: "9" },
      { ownerId: "9" },
      { topics: [{ stream: "SCOPE", permissions: ["view"] }] },
      { authorized: true },
    ]) {
      expect(() => assertNoRealtimeAuthorityClaim(claim), JSON.stringify(claim)).toThrow(
        RealtimeError,
      );
    }
  });

  it("refuses an undeclared key rather than dropping it", () => {
    expect(
      RealtimeSubscribeSchema.safeParse({ topics: [{ stream: "SCOPE" }], sneaky: 1 }).success,
    ).toBe(false);
    expect(
      RealtimeSubscribeSchema.safeParse({ topics: [{ stream: "SCOPE", extra: 1 }] }).success,
    ).toBe(false);
  });

  it("refuses an unknown stream and an unknown entity kind", () => {
    expect(RealtimeSubscribeSchema.safeParse({ topics: [{ stream: "EVERYTHING" }] }).success).toBe(false);
    expect(
      RealtimeSubscribeSchema.safeParse({
        topics: [{ stream: "ENTITY", entityKind: "secrets", entityId: "x" }],
      }).success,
    ).toBe(false);
  });

  it("refuses an oversized topic list", () => {
    const topics = Array.from({ length: REALTIME_LIMITS.MAX_TOPICS + 1 }, () => ({
      stream: "SCOPE" as const,
    }));
    expect(RealtimeSubscribeSchema.safeParse({ topics }).success).toBe(false);
  });

  it("an entity filter narrows and never widens", () => {
    const scoped = subscription({ scopeWide: false, entityFilter: new Set(["wld_1"]) });
    expect(subscriptionWants(scoped, event({ subject: { kind: "world", id: "wld_1" } }))).toBe(true);
    expect(subscriptionWants(scoped, event({ subject: { kind: "world", id: "wld_2" } }))).toBe(false);
    // No subject at all cannot match a filter that names one.
    expect(subscriptionWants(scoped, event())).toBe(false);
  });

  it("scope is checked before anything else, even for a named entity", () => {
    const scoped = subscription({ scopeWide: false, entityFilter: new Set(["wld_1"]) });
    const foreign = event({ scopeId: "8", subject: { kind: "world", id: "wld_1" } });
    expect(subscriptionWants(scoped, foreign)).toBe(false);
    // And a scope-wide subscription still cannot cross scopes.
    expect(subscriptionWants(subscription(), foreign)).toBe(false);
  });
});

// ── The envelope carries a signal, never a payload ──────────────────────────

describe("an event envelope", () => {
  it("copies nothing it did not declare", () => {
    const envelope = envelopeOf(
      row({
        payload: {
          monitorId: "mon_1",
          result: "TRUE",
          // Everything below must NOT survive.
          celsius: 41,
          reserve: 250,
          buyerMaximum: 900,
          password: "hunter2",
          accessToken: "tok_live_x",
          policy: { effect: "DENY" },
          note: "private",
        },
      }),
    );
    const serialized = JSON.stringify(envelope);
    for (const secret of ["41", "250", "900", "hunter2", "tok_live_x", "DENY", "private"]) {
      expect(serialized.includes(secret), secret).toBe(false);
    }
    expect(envelope.subject).toEqual({ kind: "monitor", id: "mon_1" });
    expect(envelope.signal).toEqual({ result: "TRUE" });
  });

  it("refuses a signal value outside its closed vocabulary", () => {
    const envelope = envelopeOf(
      row({ payload: { monitorId: "m", result: "PROBABLY", transition: "RISING" } }),
    );
    expect(envelope.signal).toEqual({ transition: "RISING" });
  });

  it("carries freshness, which is the whole point", () => {
    //   TRANSPORT_CONNECTED != DATA_CURRENT
    // A surface can be connected and STILL say the reading is stale, because
    // the staleness travels with the event rather than with the socket.
    const envelope = envelopeOf(row({ payload: { monitorId: "m", freshness: "STALE" } }));
    expect(envelope.signal).toEqual({ freshness: "STALE" });
  });

  it("carries a revision only when it is one", () => {
    expect(envelopeOf(row({ payload: { worldId: "w", version: "1.2.0" } })).revision).toBe("1.2.0");
    expect(envelopeOf(row({ payload: { worldId: "w", version: "../../etc" } })).revision).toBeUndefined();
  });

  it("is identified by the ledger position, so two copies are one event", () => {
    expect(envelopeOf(row({ id: 42 })).eventId).toBe("evt_42");
    expect(envelopeOf(row({ id: 42 })).cursor).toBe(42);
  });
});

// ── The client ──────────────────────────────────────────────────────────────

describe("the client state machine", () => {
  it("applies out-of-order frames in order", () => {
    const session = new RealtimeSession();
    session.opened(0);
    const applied = session.accept([event({ cursor: 43, eventId: "evt_43" }), event({ cursor: 41, eventId: "evt_41" }), event({ cursor: 42, eventId: "evt_42" })]);
    expect(applied.map((entry) => entry.cursor)).toEqual([41, 42, 43]);
    expect(session.currentCursor()).toBe(43);
  });

  it("applies the same event once, however often it arrives", () => {
    const session = new RealtimeSession();
    session.opened(0);
    expect(session.accept([event({ cursor: 5, eventId: "evt_5" })])).toHaveLength(1);
    expect(session.accept([event({ cursor: 5, eventId: "evt_5" })])).toHaveLength(0);
    expect(session.currentCursor()).toBe(5);
  });

  it("never goes backwards", () => {
    const session = new RealtimeSession();
    session.opened(10);
    expect(session.accept([event({ cursor: 3, eventId: "evt_3" })])).toHaveLength(0);
    expect(session.currentCursor()).toBe(10);
  });

  it("does not declare failure after one interruption", () => {
    const states: string[] = [];
    const session = new RealtimeSession((state) => states.push(state));
    session.opening();
    session.opened(0);
    session.dropped();
    expect(session.connectionState()).toBe("RECONNECTING");
    expect(states).not.toContain("OFFLINE");
  });

  it("backs off, with jitter, and never tightly", () => {
    expect(backoffMs(0, () => 0)).toBeGreaterThanOrEqual(250);
    expect(backoffMs(1, () => 0)).toBeGreaterThan(backoffMs(0, () => 1) - 1);
    // Bounded: a long outage does not become a thirty-minute wait.
    expect(backoffMs(99, () => 1)).toBeLessThanOrEqual(30_000);
    // Two clients that dropped together do not return together.
    expect(backoffMs(3, () => 0)).not.toBe(backoffMs(3, () => 1));
  });

  it("forgets what it had seen when it is told to resync", () => {
    const session = new RealtimeSession();
    session.opened(0);
    session.accept([event({ cursor: 5, eventId: "evt_5" })]);
    session.resyncRequired(0);
    expect(session.connectionState()).toBe("RESYNC_REQUIRED");
    // After a resync the client has re-read the projection, so an event it
    // had applied before is applied again against fresh state.
    session.resynced(0);
    expect(session.accept([event({ cursor: 5, eventId: "evt_5" })])).toHaveLength(1);
  });

  it("never lets transport state imply freshness", () => {
    expect(RealtimeSession.transportImpliesFreshness).toBe(false);
    const session = new RealtimeSession();
    session.opened(0);
    expect(connectionNotice(session.connectionState())).toBeNull();
    // Connected says NOTHING to a person — not «مباشر», not a badge.
    for (const state of ["RECONNECTING", "OFFLINE"] as const) {
      expect(connectionNotice(state)).not.toContain("مباشر");
    }
  });

  it("re-reads one projection per changed object, not one per event", () => {
    const changes = changedSubjects([
      event({ cursor: 1, eventId: "e1", subject: { kind: "world", id: "w" }, revision: "1.0.0" }),
      event({ cursor: 2, eventId: "e2", subject: { kind: "world", id: "w" }, revision: "1.1.0" }),
      event({ cursor: 3, eventId: "e3", subject: { kind: "monitor", id: "m" } }),
    ]);
    expect(changes).toHaveLength(2);
    // The LAST revision wins: re-reading once after three changes is the same
    // projection, fetched twice fewer.
    expect(changes.find((change) => change.id === "w")?.revision).toBe("1.1.0");
  });
});

// ── Backpressure ────────────────────────────────────────────────────────────

describe("a subscriber that cannot keep up", () => {
  it("is told to resync rather than handed an arbitrary subset", () => {
    const incoming = Array.from({ length: 10 }, (_, index) =>
      event({ cursor: index + 1, eventId: `evt_${index + 1}` }),
    );
    expect(decideDelivery({ queued: 0, incoming, cursor: 0 }).action).toBe("DELIVER");
    const overflowing = decideDelivery({
      queued: REALTIME_LIMITS.MAX_QUEUE,
      incoming,
      cursor: 7,
    });
    expect(overflowing.action).toBe("RESYNC_REQUIRED");
    if (overflowing.action === "RESYNC_REQUIRED") expect(overflowing.cursor).toBe(7);
  });
});

// ── Authority can be taken away ─────────────────────────────────────────────

describe("an authorization does not outlive the authority behind it", () => {
  it("is re-established on a bound, not trusted forever", () => {
    //   AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER
    expect(REALTIME_LIMITS.REAUTH_MAX_AGE_MS).toBeGreaterThan(0);
    expect(REALTIME_LIMITS.REAUTH_MAX_AGE_MS).toBeLessThanOrEqual(30_000);
  });

  it("re-authorizes through the SAME function that authorized it", () => {
    // Live push and catch-up cannot diverge about what a principal may hear
    // if there is one answer to the question.
    const runtime = source("api/runtime/realtime-runtime.ts");
    const reauth = runtime.slice(
      runtime.indexOf("export async function stillAuthorized"),
      runtime.indexOf("export async function stillAuthorized") + 900,
    );
    expect(reauth).toContain("authorizeSubscription(");
    // Any refusal at all ends it. There is no partial re-authorization.
    expect(reauth).toContain("return null");
  });

  it("checks only when there is something to deliver", () => {
    // An idle connection must not become a permission poll loop.
    //   ONE PERMISSION POLL LOOP PER CLIENT = 0
    const runtime = source("api/runtime/realtime-runtime.ts");
    const tail = runtime.slice(runtime.indexOf("export async function tailRealtime"));
    expect(tail).toContain("if (wanted.length > 0)");
    // And asks the scope's revision ONCE per bucket, not once per sink.
    const perBucket = tail.indexOf("const revision = await authorityRevisionOf(scopeId)");
    const perSink = tail.indexOf("for (const sink of bucket)");
    expect(perBucket).toBeGreaterThan(0);
    expect(perBucket).toBeLessThan(perSink);
  });

  it("re-filters against the NARROWER authorization, not the original", () => {
    const runtime = source("api/runtime/realtime-runtime.ts");
    expect(runtime).toContain("subscriptionWants(reauthorized, event)");
  });

  it("adds no scheduler, no stream and no revocation type of its own", () => {
    //   SECOND_SCHEDULERS_ADDED = 0 · DOMAIN_REVOCATION_TYPES_ADDED = 0
    const runtime = source("api/runtime/realtime-runtime.ts");
    for (const forbidden of ["setInterval(", "setTimeout(", "new WebSocketServer(", "pgTable("]) {
      expect(runtime, forbidden).not.toContain(forbidden);
    }
    for (const forbidden of ["OrderRevocation", "NegotiationRevocation", "DriverRevocation", "WorldRevocation"]) {
      expect(runtime, forbidden).not.toContain(forbidden);
    }
    // And it reads the canonical authorization sources, not a second model.
    expect(runtime).toContain("memberships");
    expect(runtime).toContain("scopePolicies");
  });

  it("the client stops rather than arguing with a refusal", () => {
    const session = new RealtimeSession();
    session.opened(5);
    session.accept([event({ cursor: 6, eventId: "evt_6" })]);
    expect(session.mayReconnect()).toBe(true);

    session.revoked();
    expect(session.mayReconnect()).toBe(false);
    expect(session.connectionState()).toBe("DISCONNECTED");
    // The cursor is dropped too: resuming a subscription it may not have would
    // be asking the same refused question with a position attached.
    expect(session.currentCursor()).toBe(0);
  });

  it("both surfaces stop the same way", () => {
    const web = source("src/lib/realtime-client.ts");
    const mobile = source("../../../artifacts/jasim-mobile/lib/realtime.ts");
    for (const text of [web, mobile]) {
      expect(text).toContain("revoked()");
      expect(text).toContain("mayReconnect()");
      expect(text).toContain("AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER");
    }
    // The web hook honours it: a revoked session never reopens.
    const hook = source("src/hooks/use-realtime.ts");
    expect(hook).toContain("!session.mayReconnect()");
    expect(hook).toContain("realtime.revoked");
  });

  it("the ending frame carries a code and nothing else", () => {
    //   NO DATA LEAK IN ERROR FRAMES
    const socket = source("api/core/websocket.ts");
    const start = socket.indexOf("revoke: () => {");
    expect(start).toBeGreaterThan(0);
    // The FRAME, not the comment above it: what is actually put on the wire.
    const frame = socket.slice(start, start + 900).match(/socket\.send\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(frame).toContain('code: "ACCESS_REVOKED"');
    for (const key of ["entityId", "worldId", "monitorId", "permission", "scopeId", "events", "cursor"]) {
      expect(frame, key).not.toContain(key);
    }
    // And the attachment is dropped BEFORE the frame, so an overlapping sweep
    // has nothing left to deliver to.
    const body = socket.slice(start, start + 900);
    expect(body.indexOf("attachments.delete(socket)")).toBeLessThan(body.indexOf("socket.send("));
  });
});

// ── The web product ─────────────────────────────────────────────────────────

describe("the active web product", () => {
  const chat = source("src/hooks/useJasimChat.ts");

  it("subscribes from the conversation, in the real app", () => {
    // `canonical/جاسم/app/src`, not `artifacts/jasim`.
    expect(chat).toContain("useRealtime");
    expect(chat).toContain("REALTIME_SCOPE_TOPICS");
  });

  it("re-reads the canonical projection rather than rebuilding it", () => {
    //   EVENT -> IDENTIFY CHANGED OBJECT -> FETCH AUTHORIZED PROJECTION
    expect(chat).toContain("utils.runtime.worldRead.invalidate");
    expect(chat).toContain("utils.runtime.monitorRead.invalidate");
    // It never constructs runtime state out of an event body.
    expect(chat).not.toMatch(/setMessages\(.*event\./);
  });

  it("shows a sentence, not a network dashboard", () => {
    expect(chat).toContain("connectionNotice");
    const hook = source("src/hooks/use-realtime.ts");
    for (const forbidden of ["cursor badge", "WS:", "socket id", "stream id"]) {
      expect(hook, forbidden).not.toContain(forbidden);
    }
  });
});
