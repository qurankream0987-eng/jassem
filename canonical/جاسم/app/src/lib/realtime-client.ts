/**
 * JASIM — the realtime client, as BOTH surfaces use it.
 *
 *   REALTIME TRANSPORT != TRUTH
 *   TRANSPORT_CONNECTED != DATA_CURRENT
 *
 * One state machine, one cursor rule, one deduplication rule. The web app and
 * the mobile app differ in how they open a socket and when the OS suspends
 * them — and in nothing else, which is why this file has no DOM in it and no
 * React in it.
 *
 *   MOBILE_REALTIME_ARCHITECTURES_ADDED = 0
 *
 * ─── WHAT A CLIENT DOES WITH AN EVENT ───────────────────────────────────────
 *
 * It does NOT reconstruct business truth from the event. An event says WHICH
 * canonical object changed; the client re-reads that object's authorized
 * projection. That rule is what keeps a future negotiation, transaction or
 * location surface from inventing state out of a frame it was handed.
 */

export const REALTIME_CONNECTION_STATES = [
  "DISCONNECTED",
  "CONNECTING",
  "CONNECTED",
  "RECONNECTING",
  "RESYNC_REQUIRED",
  "OFFLINE",
] as const;
export type RealtimeConnectionState = (typeof REALTIME_CONNECTION_STATES)[number];

export type RealtimeEvent = {
  cursor: number;
  eventId: string;
  type: string;
  occurredAt: string;
  scopeId: string;
  subject?: { kind: string; id: string };
  revision?: string;
  signal?: Record<string, string>;
};

export type RealtimeTopic =
  | { stream: "SCOPE" }
  | { stream: "ENTITY"; entityKind: "world" | "monitor" | "run" | "conversation"; entityId: string }
  | { stream: "CONVERSATION"; conversationId: string };

/** How many applied event ids are remembered, for deduplication. */
const SEEN_LIMIT = 512;

/**
 * Reconnect backoff.
 *
 * Exponential with jitter, and capped. A tight loop is how one flaky minute
 * becomes a denial of service against your own server, and a client that
 * declares failure after one dropped packet is how a person is told the
 * product is broken when a lift door closed.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, Math.min(attempt, 6)));
  // Full jitter: two clients that dropped together do not return together.
  return Math.round(base / 2 + random() * (base / 2));
}

/**
 * The bounded state machine §10 asks for.
 *
 * `CONNECTED` is a fact about a socket. It is never, on its own, a reason to
 * tell somebody their information is current — that is what `freshness` on the
 * event and on the projection is for.
 */
export class RealtimeSession {
  private state: RealtimeConnectionState = "DISCONNECTED";
  private cursor = 0;
  private attempt = 0;
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  /** Set when the server ended the subscription. Never unset. */
  private terminal = false;

  private readonly onChange: ((state: RealtimeConnectionState) => void) | undefined;

  constructor(onChange?: (state: RealtimeConnectionState) => void) {
    this.onChange = onChange;
  }

  connectionState(): RealtimeConnectionState {
    return this.state;
  }

  currentCursor(): number {
    return this.cursor;
  }

  /**
   * Whether a surface may say «مباشر».
   *
   * It may not, ever, from this class alone. The answer lives with the data's
   * own freshness, and this exists so that a caller asking the transport gets
   * told no rather than yes.
   */
  static readonly transportImpliesFreshness = false;

  private moveTo(next: RealtimeConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.onChange?.(next);
  }

  opening(): void {
    this.moveTo(this.attempt === 0 ? "CONNECTING" : "RECONNECTING");
  }

  opened(cursor: number): void {
    this.attempt = 0;
    this.cursor = cursor;
    this.moveTo("CONNECTED");
  }

  /** A drop is not a failure until it has kept failing. */
  dropped(): number {
    this.attempt += 1;
    this.moveTo(this.attempt >= 6 ? "OFFLINE" : "RECONNECTING");
    return backoffMs(this.attempt);
  }

  closed(): void {
    this.attempt = 0;
    this.moveTo("DISCONNECTED");
  }

  /**
   * The server could not honour the cursor.
   *
   * Nothing is guessed and nothing is skipped: the caller re-reads the
   * canonical projection and resumes from the cursor it was handed.
   */
  resyncRequired(cursor: number): void {
    this.cursor = cursor;
    this.seen.clear();
    this.order.length = 0;
    this.moveTo("RESYNC_REQUIRED");
  }

  resynced(cursor: number): void {
    this.cursor = cursor;
    this.moveTo("CONNECTED");
  }

  /**
   * The authority behind this subscription ended.
   *
   *   AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER
   *
   * Terminal. Reconnecting would be a client arguing with a refusal, and the
   * surface's own authorized reads are where that answer belongs — they will
   * refuse too, and say so in the words the runtime uses for it.
   */
  revoked(): void {
    this.terminal = true;
    this.attempt = 0;
    this.cursor = 0;
    this.seen.clear();
    this.order.length = 0;
    this.moveTo("DISCONNECTED");
  }

  /** Whether this session may open another socket. */
  mayReconnect(): boolean {
    return !this.terminal;
  }

  /**
   * Apply a batch, in order and once each.
   *
   * Out-of-order and duplicate frames are both ordinary — a retry, a reconnect
   * overlapping a live push — and both produce ONE projection transition.
   */
  accept(events: readonly RealtimeEvent[]): RealtimeEvent[] {
    const applied: RealtimeEvent[] = [];
    for (const event of [...events].sort((left, right) => left.cursor - right.cursor)) {
      if (this.seen.has(event.eventId)) continue;
      // A frame at or behind the cursor has already been accounted for.
      if (event.cursor <= this.cursor) continue;
      this.remember(event.eventId);
      this.cursor = event.cursor;
      applied.push(event);
    }
    return applied;
  }

  private remember(eventId: string): void {
    this.seen.add(eventId);
    this.order.push(eventId);
    while (this.order.length > SEEN_LIMIT) {
      const evicted = this.order.shift();
      if (evicted) this.seen.delete(evicted);
    }
  }
}

/**
 * Which canonical objects a batch says to re-read.
 *
 *   EVENT -> IDENTIFY CHANGED OBJECT -> FETCH AUTHORIZED PROJECTION
 *
 * Deliberately the whole of what a client derives from an event body. The
 * revision and the signal travel with it so a surface can tell a stale reading
 * from a current one WITHOUT asking the socket.
 */
export function changedSubjects(
  events: readonly RealtimeEvent[],
): Array<{ kind: string; id: string; revision?: string; signal?: Record<string, string> }> {
  const byRef = new Map<
    string,
    { kind: string; id: string; revision?: string; signal?: Record<string, string> }
  >();
  for (const event of events) {
    if (!event.subject) continue;
    const key = `${event.subject.kind}:${event.subject.id}`;
    // The LAST event for an object wins: re-reading once after three changes
    // is the same projection, fetched three times fewer.
    byRef.set(key, {
      kind: event.subject.kind,
      id: event.subject.id,
      ...(event.revision ? { revision: event.revision } : {}),
      ...(event.signal ? { signal: event.signal } : {}),
    });
  }
  return [...byRef.values()];
}

/**
 * What a person is told, and nothing more.
 *
 *   DO NOT TURN JASIM INTO A NETWORK-DEBUG DASHBOARD
 *
 * No cursor, no stream id, no event type, and no permanent badge saying
 * CONNECTED — being connected is the ordinary case and needs no announcement.
 */
export function connectionNotice(state: RealtimeConnectionState): string | null {
  switch (state) {
    case "RECONNECTING":
    case "RESYNC_REQUIRED":
      return "جارٍ إعادة الاتصال — قد تتأخر المعلومات قليلاً.";
    case "OFFLINE":
      return "لا يوجد اتصال. ما تراه قد لا يكون محدّثاً.";
    default:
      return null;
  }
}
