/**
 * JASIM — THE GENERAL REALTIME RUNTIME.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   REALTIME TRANSPORT != TRUTH
 *   TRANSPORT_CONNECTED != DATA_CURRENT
 *
 *   CANONICAL STATE CHANGE
 *     -> DURABLE EVENT
 *       -> AUTHORIZED SUBSCRIPTION
 *         -> TRANSPORT
 *           -> CLIENT CURSOR
 *             -> RECONCILIATION
 *               -> CANONICAL PROJECTION UPDATE
 *
 * Canonical state is truth. A durable event says that truth CHANGED. Realtime
 * carries the notification and nothing else: a socket creates no fact, and a
 * socket that dies erases none.
 *
 * ─── WHAT WAS ALREADY THERE ─────────────────────────────────────────────────
 *
 * `JasimWebSocketServer` — an authenticated upgrade, a per-user connection map
 * and a ping/pong. It is reused, not replaced.
 *
 * `events` — a serial-id ledger every runtime already appends to, scoped by
 * `ownerId` and correlated by `correlationId`. It is the ONE stream.
 *
 *   SECOND_SOCKET_SERVERS_ADDED = 0
 *   SECOND_EVENT_LEDGERS_ADDED  = 0
 *
 * ─── WHAT WAS MISSING ───────────────────────────────────────────────────────
 *
 * The socket authorized a subscription and then DISCARDED it: `handleSubscription`
 * replied «subscribed» and nothing ever routed an event by it. There was no
 * cursor, so a disconnect lost everything between. There was no client at all —
 * nothing in the web app or the mobile app opened a socket. And `clients` held
 * one socket per user id, so a second tab silently closed the first.
 *
 * ─── AND WHAT THIS IS NOT ───────────────────────────────────────────────────
 *
 * Not a channel per subject. «أين وصل طلبي؟» and «أرني مراقبة السعر» are one
 * subscription contract over one ledger.
 *
 *   DOMAIN_REALTIME_CHANNELS_ADDED = 0
 *   DOMAIN_SOCKET_SERVERS_ADDED    = 0
 */

import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../queries/connection";
import { events } from "../../db/schema";
import { resolveActingScope, type ActingScope } from "./actor-scope";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, semantic, and naming no table
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a subscriber may ask for. Three shapes, and every one of them is a
 * question about canonical objects rather than about storage.
 */
export const REALTIME_STREAMS = ["SCOPE", "ENTITY", "CONVERSATION"] as const;
export type RealtimeStream = (typeof REALTIME_STREAMS)[number];

/**
 * The kinds of canonical object a subscription may name.
 *
 * Semantic, not physical: there is no table called `world` and none called
 * `monitor`, and a client that learned one would have learned nothing it could
 * use.
 */
export const REALTIME_ENTITY_KINDS = [
  "world",
  "monitor",
  "run",
  "conversation",
  // A durable handle on a followed subject. It is a SUBJECT of change like any
  // other, not a channel: no socket, no cursor and no reconnect protocol of its
  // own comes with it.
  "living_object",
] as const;
export type RealtimeEntityKind = (typeof REALTIME_ENTITY_KINDS)[number];

export const REALTIME_CONNECTION_STATES = [
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "RECONNECTING",
  "RESYNC_REQUIRED",
  "OFFLINE",
] as const;
export type RealtimeConnectionState = (typeof REALTIME_CONNECTION_STATES)[number];

/** Limits, so a subscriber cannot ask for unbounded work. */
export const REALTIME_LIMITS = Object.freeze({
  /** Topics in one subscription. */
  MAX_TOPICS: 32,
  /** Events returned by one catch-up read. */
  MAX_BATCH: 200,
  /** Events a connection may have queued before it is told to resync. */
  MAX_QUEUE: 256,
  /**
   * How long an event must have existed before a cursor may advance past it.
   *
   * A serial id is assigned before COMMIT, so an event inserted first can
   * become visible second. A cursor that advanced the instant it saw the
   * higher id would skip the lower one forever. Every canonical event is
   * appended as its own statement after its state change has committed, so
   * this window bounds the hazard rather than hiding it.
   */
  STABILITY_LAG_MS: 250,
  /**
   * How long an authorization may stand before it is re-established.
   *
   *   AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER
   *
   * A membership or policy change bumps the scope's authority revision and
   * invalidates an authorization the instant it happens. This bound catches
   * everything a revision cannot see — an entity that left the scope, a
   * conversation that was deleted — and it is checked only when there is
   * something to deliver, so an idle connection costs nothing.
   */
  REAUTH_MAX_AGE_MS: 5_000,
});

/**
 * Keys a subscriber may never supply. Each one is the request trying to BE the
 * authorization. Mirrored against `AUTHORITY_KEYS`, and a test holds the two
 * together.
 */
export const REALTIME_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "ownerid",
  "scopeid",
  "principalid",
  "actingscopeid",
  "membership",
  "permission",
  "permissions",
  "authorized",
  "authorization",
  "approved",
  "trusted",
  "policydecision",
  "policyoverride",
]);

export class RealtimeError extends Error {
  readonly code: "INVALID" | "FORBIDDEN" | "RESYNC_REQUIRED" | "OVERLOADED";
  constructor(message: string, code: RealtimeError["code"]) {
    super(message);
    this.code = code;
    this.name = "RealtimeError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The subscription contract
// ─────────────────────────────────────────────────────────────────────────────

export const RealtimeTopicSchema = z.union([
  z.object({ stream: z.literal("SCOPE") }).strict(),
  z
    .object({
      stream: z.literal("ENTITY"),
      entityKind: z.enum(REALTIME_ENTITY_KINDS),
      entityId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({ stream: z.literal("CONVERSATION"), conversationId: z.string().trim().min(1).max(64) })
    .strict(),
]);
export type RealtimeTopic = z.infer<typeof RealtimeTopicSchema>;

/**
 * What a client may send. Deliberately small, and `.strict()`.
 *
 * There is no `ownerId`, no `scopeId`, no permission and no trust. A client may
 * REQUEST to act for an organization; whether it may is decided by membership,
 * server-side, exactly as every other scoped read in this runtime decides it.
 */
export const RealtimeSubscribeSchema = z
  .object({
    topics: z.array(RealtimeTopicSchema).min(1).max(REALTIME_LIMITS.MAX_TOPICS),
    cursor: z.number().int().optional(),
    organizationId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type RealtimeSubscribeRequest = z.infer<typeof RealtimeSubscribeSchema>;

/**
 * ONE event, as a subscriber sees it.
 *
 * A signal that canonical state changed — never the state itself. There is no
 * payload passthrough here and cannot be: the fields below are the whole
 * envelope, and each is an id, an instant or a value from a closed vocabulary.
 */
export type RealtimeEvent = {
  /** The ledger position. Ordering and resume are both this number. */
  readonly cursor: number;
  /** Stable identity, so the same event applied twice is one transition. */
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly scopeId: string;
  readonly subject?: { readonly kind: string; readonly id: string };
  /** The version/revision the change produced, when the change has one. */
  readonly revision?: string;
  /**
   * Closed-vocabulary state carried with the signal — a monitor's verdict, a
   * reading's freshness. Never free text and never a payload.
   *
   *   TRANSPORT_CONNECTED != DATA_CURRENT
   *
   * `freshness` is here precisely so a surface can be connected and still say
   * the reading is stale.
   */
  readonly signal?: Readonly<Record<string, string>>;
};

/**
 * The payload keys an envelope may carry out of the ledger, and what each one
 * is allowed to be.
 *
 * An allowlist rather than a denylist: a new event type that happens to carry
 * a private field leaks nothing, because nothing it did not declare is copied.
 */
const SIGNAL_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  result: ["TRUE", "FALSE", "UNKNOWN"],
  transition: ["NONE", "RISING", "FALLING", "REPEAT"],
  freshness: ["CURRENT", "STALE", "UNKNOWN"],
  state: [
    "ACTIVE", "PAUSED", "TRIGGERED", "COMPLETED", "CANCELLED", "BLOCKED",
    "draft", "active", "paused", "deprecated", "archived",
  ],
  // A follower's own state. Neither value says anything about the subject —
  // HIDE != CANCEL and RESOLVED != ERASED hold on the wire too.
  followState: ["FOLLOWING", "RESOLVED", "RELEASED"],
  surfaceState: ["VISIBLE", "HIDDEN"],
});

/** Reference keys that name WHAT changed. Ids only — never contents. */
const SUBJECT_KEYS: Readonly<Record<string, RealtimeEntityKind>> = Object.freeze({
  worldId: "world",
  monitorId: "monitor",
  runId: "run",
  conversationId: "conversation",
  livingObjectId: "living_object",
});

const REVISION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

type LedgerRow = {
  id: number;
  type: string;
  ownerId: string | null;
  correlationId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
};

/**
 * Build the envelope a subscriber receives.
 *
 * Everything that is not explicitly allowed is dropped. A private observation
 * payload, a negotiation reserve, a policy body and a credential all leave the
 * same way: by never being named here.
 */
export function envelopeOf(row: LedgerRow): RealtimeEvent {
  const payload = row.payload ?? {};
  let subject: { kind: string; id: string } | undefined;
  for (const [key, kind] of Object.entries(SUBJECT_KEYS)) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 128) {
      subject = { kind, id: value };
      break;
    }
  }
  if (!subject && row.correlationId) {
    subject = { kind: "reference", id: row.correlationId };
  }

  const signal: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(SIGNAL_FIELDS)) {
    const value = payload[key];
    if (typeof value === "string" && allowed.includes(value)) signal[key] = value;
  }

  const version = payload.version;
  return {
    cursor: row.id,
    eventId: `evt_${row.id}`,
    type: row.type,
    occurredAt: row.createdAt.toISOString(),
    scopeId: row.ownerId ?? "",
    ...(subject ? { subject } : {}),
    ...(typeof version === "string" && REVISION_PATTERN.test(version) ? { revision: version } : {}),
    ...(Object.keys(signal).length > 0 ? { signal } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorization — before a subscription exists, not when an event arrives
// ─────────────────────────────────────────────────────────────────────────────

export type AuthorizedSubscription = {
  readonly scope: ActingScope;
  readonly topics: readonly RealtimeTopic[];
  /** Entity ids this subscription may see, by kind. Empty means scope-wide. */
  readonly entityFilter: ReadonlySet<string>;
  readonly scopeWide: boolean;
};

function walkKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      visit(key);
      walkKeys(item, visit);
    }
  }
}

export function assertNoRealtimeAuthorityClaim(value: unknown): void {
  walkKeys(value, (key) => {
    if (REALTIME_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new RealtimeError(
        `«${key}» is the server's word, not the subscription's. A subscriber may say what it wants to hear about; it may not say whose events those are or that it is allowed to hear them.`,
        "FORBIDDEN",
      );
    }
  });
}

/**
 * Decide what this actor may hear, server-side and once.
 *
 * A guessed worldId, monitorId or conversationId buys nothing: each named
 * entity is looked up UNDER the resolved scope, and a miss is refused rather
 * than reported as missing — telling a stranger an id exists is already
 * telling them something.
 */
export async function authorizeSubscription(input: {
  principalId: string;
  request: unknown;
}): Promise<AuthorizedSubscription> {
  assertNoRealtimeAuthorityClaim(input.request);
  const parsed = RealtimeSubscribeSchema.safeParse(input.request);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RealtimeError(
      `That subscription is not well formed: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "invalid"}.`,
      "INVALID",
    );
  }
  const request = parsed.data;

  const resolution = await resolveActingScope({
    principalId: input.principalId,
    ...(request.organizationId
      ? { request: { intent: "ORGANIZATION" as const, organizationId: request.organizationId } }
      : {}),
  });
  if (resolution.status !== "RESOLVED") {
    throw new RealtimeError(
      resolution.status === "DENIED"
        ? resolution.message
        : "That reference does not identify one scope you may act as.",
      "FORBIDDEN",
    );
  }
  const scope = resolution.scope;

  const entityFilter = new Set<string>();
  let scopeWide = false;
  for (const topic of request.topics) {
    if (topic.stream === "SCOPE") {
      scopeWide = true;
      continue;
    }
    const id = topic.stream === "CONVERSATION" ? topic.conversationId : topic.entityId;
    const kind = topic.stream === "CONVERSATION" ? "conversation" : topic.entityKind;
    if (!(await entityBelongsToScope(kind, id, scope))) {
      throw new RealtimeError(
        "Nothing of that reference is visible in this scope.",
        "FORBIDDEN",
      );
    }
    entityFilter.add(id);
  }

  return { scope, topics: request.topics, entityFilter, scopeWide };
}

/**
 * Is this canonical object the scope's to hear about?
 *
 * Each lookup is the SAME scoped read the rest of the runtime uses, so a
 * subscription can never see further than a query could.
 */
async function entityBelongsToScope(
  kind: RealtimeEntityKind,
  id: string,
  scope: ActingScope,
): Promise<boolean> {
  if (kind === "world") {
    const { readWorld } = await import("./world-runtime");
    return (await readWorld({ worldId: id, scope })) !== undefined;
  }
  if (kind === "monitor") {
    const { readMonitor } = await import("./monitoring-runtime");
    return (await readMonitor({ monitorId: id, scope })) !== undefined;
  }
  if (kind === "run") {
    const { getRuntimeRun } = await import("./jasim-runtime");
    try {
      await getRuntimeRun(id, scope.principalId);
      return true;
    } catch {
      return false;
    }
  }
  // A conversation belongs to the PRINCIPAL, which is why it is checked
  // against them rather than against the acting scope.
  const { conversations } = await import("../../db/schema");
  const conversationId = Number(id);
  const principalId = Number(scope.principalId);
  if (!Number.isInteger(conversationId) || !Number.isInteger(principalId)) return false;
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, principalId)))
    .limit(1);
  return row !== undefined;
}

/** Does this authorized subscription want this event? */
export function subscriptionWants(
  subscription: AuthorizedSubscription,
  event: RealtimeEvent,
): boolean {
  // Scope first, always. An entity filter narrows; it never widens.
  if (event.scopeId !== subscription.scope.scopeId) return false;
  if (subscription.scopeWide) return true;
  if (!event.subject) return false;
  return subscription.entityFilter.has(event.subject.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Authority that can be taken away
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When this scope's authority last changed.
 *
 *   AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER
 *
 * The canonical sources the rest of JASIM already authorizes from, and no
 * second permission model: a membership's own `updatedAt` (which its
 * `$onUpdate` moves on every grant, narrowing and revocation) and a scope
 * policy's `createdAt` (a policy is versioned by appending, so a new row IS
 * the change).
 *
 * ONE query per scope per sweep — not one per frame, and not one per socket.
 * A hundred tabs on one scope ask this once.
 *
 * Returns epoch milliseconds, and 0 when a scope has never had either. A
 * personal scope usually has neither, and cannot be revoked by a membership
 * that does not exist — which is why the bounded re-authorization above is the
 * other half of this and not an optimization.
 */
export async function authorityRevisionOf(scopeId: string): Promise<number> {
  const { memberships, scopePolicies } = await import("../../db/schema");
  const [row] = await db
    .select({
      revised: sql<string | null>`GREATEST(
        (SELECT MAX(GREATEST(m."updatedAt", COALESCE(m."revokedAt", m."updatedAt")))
           FROM ${memberships} m WHERE m."ownerId" = ${scopeId}),
        (SELECT MAX(p."createdAt") FROM ${scopePolicies} p WHERE p."scopeId" = ${scopeId})
      )`,
    })
    .from(sql`(SELECT 1) AS one`);
  const revised = row?.revised ? new Date(row.revised).getTime() : 0;
  return Number.isFinite(revised) ? revised : 0;
}

/**
 * Is this subscription still the one the server agreed to?
 *
 *   FAIL CLOSED
 *
 * Re-authorization is the SAME function that authorized it in the first place,
 * so live delivery and catch-up can never diverge about what a principal may
 * hear. A failure is not a retry and not a silence: the caller is told its
 * access ended and nothing further is sent.
 */
export async function stillAuthorized(input: {
  principalId: string;
  subscription: AuthorizedSubscription;
}): Promise<AuthorizedSubscription | null> {
  try {
    return await authorizeSubscription({
      principalId: input.principalId,
      request: {
        topics: input.subscription.topics,
        ...(input.subscription.scope.kind === "ORGANIZATION"
          ? { organizationId: input.subscription.scope.organizationId }
          : {}),
      },
    });
  } catch {
    // Any refusal at all — a lost membership, a vanished entity, a policy that
    // now denies — ends the subscription. There is no partial re-authorization.
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The cursor — durable, and the only resume truth
// ─────────────────────────────────────────────────────────────────────────────

export type CatchUpResult =
  | {
      readonly status: "OK";
      readonly events: readonly RealtimeEvent[];
      /** Where to resume. Advances only past events past the stability lag. */
      readonly cursor: number;
      /** More is waiting: read again rather than assuming this was all. */
      readonly more: boolean;
    }
  | {
      /**
       * The cursor cannot be honoured, so nothing is guessed.
       *
       * The client re-fetches the canonical projection and resumes from
       * `cursor`. Silently skipping the missing range would be the one failure
       * mode a cursor exists to prevent.
       */
      readonly status: "RESYNC_REQUIRED";
      readonly reason: "CURSOR_INVALID" | "CURSOR_BEHIND_RETENTION" | "CURSOR_AHEAD_OF_LEDGER";
      readonly cursor: number;
    };

/** The oldest position still readable, and the newest that exists. */
export async function ledgerBounds(): Promise<{ oldest: number; newest: number }> {
  const [row] = await db
    .select({
      oldest: sql<number>`COALESCE(MIN(${events.id}), 0)::int`,
      newest: sql<number>`COALESCE(MAX(${events.id}), 0)::int`,
    })
    .from(events);
  return { oldest: row?.oldest ?? 0, newest: row?.newest ?? 0 };
}

/**
 * Read what a subscription missed.
 *
 * This is the resume path, the reconnect path, the poll path and the mobile
 * cold-start path — ONE function, so none of them can drift from the others.
 */
export async function catchUp(input: {
  subscription: AuthorizedSubscription;
  cursor: number;
  limit?: number;
  now?: Date;
}): Promise<CatchUpResult> {
  const now = input.now ?? new Date();
  const cursor = input.cursor;

  if (!Number.isInteger(cursor) || cursor < 0 || cursor > Number.MAX_SAFE_INTEGER) {
    return { status: "RESYNC_REQUIRED", reason: "CURSOR_INVALID", cursor: 0 };
  }
  const bounds = await ledgerBounds();
  if (cursor > bounds.newest) {
    // A cursor from the future is not a cursor. It is a client that has been
    // told something this ledger never said.
    return { status: "RESYNC_REQUIRED", reason: "CURSOR_AHEAD_OF_LEDGER", cursor: bounds.newest };
  }
  // 0 means «from here», not «from the beginning of time».
  if (cursor > 0 && bounds.oldest > 0 && cursor < bounds.oldest - 1) {
    return {
      status: "RESYNC_REQUIRED",
      reason: "CURSOR_BEHIND_RETENTION",
      cursor: bounds.oldest - 1,
    };
  }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), REALTIME_LIMITS.MAX_BATCH);
  const stableBefore = new Date(now.getTime() - REALTIME_LIMITS.STABILITY_LAG_MS);
  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      ownerId: events.ownerId,
      correlationId: events.correlationId,
      payload: events.payload,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(
      and(
        gt(events.id, cursor),
        eq(events.ownerId, input.subscription.scope.scopeId),
        // The stability lag. A cursor never advances past an event young
        // enough that an older sibling might still be committing.
        lte(events.createdAt, stableBefore),
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const delivered = page
    .map((row) => envelopeOf(row as LedgerRow))
    .filter((event) => subscriptionWants(input.subscription, event));

  return {
    status: "OK",
    events: delivered,
    // The cursor advances past everything READ, not everything delivered — an
    // event this subscription did not want is still an event it has passed.
    cursor: page.at(-1)?.id ?? cursor,
    more: rows.length > limit,
  };
}

/**
 * Where a new subscriber starts.
 *
 * At the head, not at zero. A client that has just fetched a projection has
 * already seen everything before now; replaying the ledger at it would be a
 * second telling of facts it is already displaying.
 */
export async function head(): Promise<number> {
  return (await ledgerBounds()).newest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backpressure — a bounded queue, and the truth when it overflows
// ─────────────────────────────────────────────────────────────────────────────

export type DeliveryDecision =
  | { readonly action: "DELIVER"; readonly events: readonly RealtimeEvent[] }
  /**
   * The subscriber fell too far behind to be caught up event by event.
   *
   * It is told to resync rather than handed an arbitrary subset. A final
   * canonical projection is worth more than the pretence that every missed
   * event was applied.
   */
  | { readonly action: "RESYNC_REQUIRED"; readonly cursor: number };

export function decideDelivery(input: {
  queued: number;
  incoming: readonly RealtimeEvent[];
  cursor: number;
}): DeliveryDecision {
  if (input.queued + input.incoming.length > REALTIME_LIMITS.MAX_QUEUE) {
    return { action: "RESYNC_REQUIRED", cursor: input.cursor };
  }
  return { action: "DELIVER", events: input.incoming };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observability — safe, and nothing else
// ─────────────────────────────────────────────────────────────────────────────

export type RealtimeMetrics = {
  connections: number;
  subscriptions: number;
  reconnects: number;
  resyncRequired: number;
  eventsDelivered: number;
  replays: number;
  authorizationRejects: number;
  /** Milliseconds from the event being written to it being handed to a socket. */
  lastDeliveryLatencyMs: number;
};

const metrics: RealtimeMetrics = {
  connections: 0,
  subscriptions: 0,
  reconnects: 0,
  resyncRequired: 0,
  eventsDelivered: 0,
  replays: 0,
  authorizationRejects: 0,
  lastDeliveryLatencyMs: 0,
};

export function recordMetric<K extends keyof RealtimeMetrics>(key: K, delta = 1): void {
  if (key === "lastDeliveryLatencyMs") {
    metrics.lastDeliveryLatencyMs = delta;
    return;
  }
  metrics[key] = (metrics[key] as number) + delta;
}

/** Counters and one latency. No message, no payload, no identity. */
export function realtimeMetrics(): Readonly<RealtimeMetrics> {
  return { ...metrics };
}

export function resetRealtimeMetrics(): void {
  for (const key of Object.keys(metrics) as (keyof RealtimeMetrics)[]) {
    metrics[key] = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The tailer — ONE reader, so push and resume cannot disagree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliver what every open subscription has not seen.
 *
 * There is exactly one place events are read from the ledger, and both the
 * live push and the reconnect resume go through it. That is what makes
 * ordering, deduplication and the stability lag ONE behaviour instead of three
 * that drift.
 *
 * It runs as a step in the Block 2 sweep — the duty cycle that is itself a
 * durable job re-enqueueing its next tick — and again immediately after a
 * canonical append, so a change is carried in milliseconds without a timer of
 * its own.
 *
 *   SECOND_SCHEDULERS_ADDED = 0
 */
export type TailResult = {
  readonly connections: number;
  readonly delivered: number;
  readonly resyncRequired: number;
  /** Subscriptions ended because the authority behind them had gone. */
  readonly revoked: number;
};

export type TailSink = {
  socketId: unknown;
  scopeId: string;
  /** WHO this subscription belongs to, so it can be re-authorized as them. */
  principalId: string;
  cursor: number;
  queued: number;
  stalled: boolean;
  subscription: AuthorizedSubscription;
  /** When the authorization behind this sink was last established. */
  authorizedAt: number;
  deliver: (events: readonly RealtimeEvent[], cursor: number) => void;
  requireResync: (cursor: number, reason: string) => void;
  /**
   * The authority ended. Nothing further is sent on this subscription.
   *
   * The frame carries a code and nothing else — not the object that became
   * forbidden, not whether it still exists, not which permission was lost.
   */
  revoke: () => void;
  /** Accept a re-established authorization and the instant it was made. */
  reauthorized: (subscription: AuthorizedSubscription, at: number) => void;
};

/**
 * The generic tail, over any set of sinks.
 *
 * Sinks are grouped by SCOPE and read once per scope rather than once per
 * connection: a hundred tabs on one scope is one query, not a hundred. That is
 * the N+1 this design is most likely to have grown.
 */
export async function tailRealtime(
  sinks: readonly TailSink[],
  options?: { now?: Date; limit?: number },
): Promise<TailResult> {
  const now = options?.now ?? new Date();
  const result = { connections: sinks.length, delivered: 0, resyncRequired: 0, revoked: 0 };
  if (sinks.length === 0) return result;

  const byScope = new Map<string, TailSink[]>();
  for (const sink of sinks) {
    const bucket = byScope.get(sink.scopeId);
    if (bucket) bucket.push(sink);
    else byScope.set(sink.scopeId, [sink]);
  }

  const stableBefore = new Date(now.getTime() - REALTIME_LIMITS.STABILITY_LAG_MS);
  const limit = Math.min(Math.max(options?.limit ?? REALTIME_LIMITS.MAX_BATCH, 1), REALTIME_LIMITS.MAX_BATCH);

  for (const [scopeId, bucket] of byScope) {
    const behind = Math.min(...bucket.map((sink) => sink.cursor));
    const rows = await db
      .select({
        id: events.id,
        type: events.type,
        ownerId: events.ownerId,
        correlationId: events.correlationId,
        payload: events.payload,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(
        and(gt(events.id, behind), eq(events.ownerId, scopeId), lte(events.createdAt, stableBefore)),
      )
      .orderBy(asc(events.id))
      .limit(limit);
    if (rows.length === 0) continue;

    const envelopes = rows.map((row) => envelopeOf(row as LedgerRow));
    const head = rows.at(-1)!.id;

    // There is something to deliver to this scope, so ask — ONCE for the whole
    // bucket — whether the authority behind it has moved since.
    const revision = await authorityRevisionOf(scopeId);

    for (const sink of bucket) {
      if (sink.stalled) continue;
      const fresh = envelopes.filter((event) => event.cursor > sink.cursor);
      const wanted = fresh.filter((event) => subscriptionWants(sink.subscription, event));

      // Re-authorize BEFORE deciding anything about these events.
      //
      //   AUTHORIZATION TO OBSERVE AN EVENT IS EVALUATED AGAINST CURRENT
      //   AUTHORITY, NOT AGAINST THE AUTHORITY THE SUBSCRIPTION WAS MADE WITH
      //
      // An event written before a revocation is not delivered after it merely
      // because it is older than the revocation. Only checked when there is
      // something to send, so an idle connection costs nothing.
      if (wanted.length > 0) {
        const stale =
          revision > sink.authorizedAt ||
          now.getTime() - sink.authorizedAt > REALTIME_LIMITS.REAUTH_MAX_AGE_MS;
        if (stale) {
          const reauthorized = await stillAuthorized({
            principalId: sink.principalId,
            subscription: sink.subscription,
          });
          if (!reauthorized) {
            sink.revoke();
            recordMetric("authorizationRejects");
            result.revoked += 1;
            continue;
          }
          sink.reauthorized(reauthorized, now.getTime());
          // The re-established authorization may be NARROWER than the one that
          // selected these events. Filter again against what it says now.
          const permitted = wanted.filter((event) => subscriptionWants(reauthorized, event));
          wanted.length = 0;
          wanted.push(...permitted);
        }
      }

      const decision = decideDelivery({
        queued: sink.queued,
        incoming: wanted,
        cursor: sink.cursor,
      });
      if (decision.action === "RESYNC_REQUIRED") {
        sink.requireResync(sink.cursor, "SUBSCRIBER_BEHIND");
        recordMetric("resyncRequired");
        result.resyncRequired += 1;
        continue;
      }
      // The cursor advances past everything READ, not everything delivered.
      // An event this subscription did not want is still one it has passed.
      sink.deliver(decision.events, head);
      result.delivered += decision.events.length;
      recordMetric("eventsDelivered", decision.events.length);
      const oldest = rows[0]!.createdAt.getTime();
      recordMetric("lastDeliveryLatencyMs", Math.max(0, now.getTime() - oldest));
    }
  }
  return result;
}
