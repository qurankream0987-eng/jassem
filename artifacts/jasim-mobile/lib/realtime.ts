/**
 * JASIM mobile — realtime, with the SAME semantics as the web.
 *
 *   REALTIME TRANSPORT != TRUTH
 *   TRANSPORT_CONNECTED != DATA_CURRENT
 *   MOBILE_REALTIME_ARCHITECTURES_ADDED = 0
 *
 * The subscription contract, the cursor rule, the deduplication rule and the
 * resync rule are the server's and are identical on both surfaces. What
 * differs here is the OS, and only the OS:
 *
 * ─── BACKGROUND IS NOT A LIE WE TELL ────────────────────────────────────────
 *
 * iOS and Android suspend a backgrounded app, and its socket dies with it. So
 * this does not pretend to stay connected. On resume it reconnects and catches
 * up FROM ITS CURSOR, and a cold reopen with no cursor at all re-reads the
 * canonical projection — which is the same thing the web does after a long
 * sleep, arrived at from a different direction.
 *
 * A correct app that was asleep beats a connected app that was lying.
 */

import { runtimeBaseUrl, runtimeScheme } from "./runtime-endpoint";

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

const SEEN_LIMIT = 512;

/** Exponential with full jitter, capped. Never a tight loop. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, Math.min(attempt, 6)));
  return Math.round(base / 2 + random() * (base / 2));
}

/** The socket address, from the ONE place the runtime's address is decided. */
export function realtimeSocketUrl(): string {
  const base = runtimeBaseUrl();
  const scheme = runtimeScheme() === "https:" ? "wss:" : "ws:";
  return base.replace(/^https?:/, scheme);
}

export class MobileRealtimeSession {
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

  dropped(): number {
    this.attempt += 1;
    this.moveTo(this.attempt >= 6 ? "OFFLINE" : "RECONNECTING");
    return backoffMs(this.attempt);
  }

  /**
   * The OS suspended us. Not a failure, and not a reconnect attempt either.
   *
   * The cursor is kept, so resuming costs one catch-up read rather than a
   * re-read of everything.
   */
  backgrounded(): void {
    this.attempt = 0;
    this.moveTo("DISCONNECTED");
  }

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
   * Terminal, exactly as on the web: reconnecting would be a client arguing
   * with a refusal, and the surface's own authorized reads are where that
   * answer belongs.
   */
  revoked(): void {
    this.terminal = true;
    this.attempt = 0;
    this.cursor = 0;
    this.seen.clear();
    this.order.length = 0;
    this.moveTo("DISCONNECTED");
  }

  mayReconnect(): boolean {
    return !this.terminal;
  }

  /** In order, and once each. A replay produces one projection transition. */
  accept(events: readonly RealtimeEvent[]): RealtimeEvent[] {
    const applied: RealtimeEvent[] = [];
    for (const event of [...events].sort((left, right) => left.cursor - right.cursor)) {
      if (this.seen.has(event.eventId)) continue;
      if (event.cursor <= this.cursor) continue;
      this.seen.add(event.eventId);
      this.order.push(event.eventId);
      while (this.order.length > SEEN_LIMIT) {
        const evicted = this.order.shift();
        if (evicted) this.seen.delete(evicted);
      }
      this.cursor = event.cursor;
      applied.push(event);
    }
    return applied;
  }
}

/** Which canonical objects to re-read. The whole of what a client derives. */
export function changedSubjects(
  events: readonly RealtimeEvent[],
): Array<{ kind: string; id: string; revision?: string; signal?: Record<string, string> }> {
  const byRef = new Map<
    string,
    { kind: string; id: string; revision?: string; signal?: Record<string, string> }
  >();
  for (const event of events) {
    if (!event.subject) continue;
    byRef.set(`${event.subject.kind}:${event.subject.id}`, {
      kind: event.subject.kind,
      id: event.subject.id,
      ...(event.revision ? { revision: event.revision } : {}),
      ...(event.signal ? { signal: event.signal } : {}),
    });
  }
  return [...byRef.values()];
}

/** One sentence, and only when something is wrong. Never a technical badge. */
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

/**
 * The catch-up read lives with every other procedure call, in
 * `runtime-trpc.ts`. There is one HTTP client on this surface and this file
 * adds none: see `catchUpRealtime` there.
 */
