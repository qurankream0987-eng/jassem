/**
 * JASIM — the active web product's realtime connection.
 *
 *   REALTIME TRANSPORT != TRUTH
 *   TRANSPORT_CONNECTED != DATA_CURRENT
 *
 * One socket for the whole session, carrying authorized change notifications
 * for the scope the person is acting as. What it does with an event is
 * re-read the canonical projection that changed — never rebuild it from the
 * frame.
 *
 * The state machine, the cursor rule and the deduplication rule live in
 * `src/lib/realtime-client.ts` and are shared with the mobile app verbatim.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RealtimeSession,
  changedSubjects,
  connectionNotice,
  type RealtimeConnectionState,
  type RealtimeEvent,
  type RealtimeTopic,
} from "../lib/realtime-client";

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Same origin, so the session cookie rides the upgrade. The socket
  // authenticates at the handshake and never from a message a client sends.
  return `${protocol}//${window.location.host}`;
}

export type RealtimeChange = {
  kind: string;
  id: string;
  revision?: string;
  signal?: Record<string, string>;
};

export type UseRealtimeResult = {
  readonly state: RealtimeConnectionState;
  /** A sentence for a person, or null. Never a badge, never a cursor. */
  readonly notice: string | null;
  /** The canonical objects that changed since the last render. */
  readonly changes: readonly RealtimeChange[];
  readonly acknowledge: () => void;
};

/**
 * Subscribe for as long as this component is mounted.
 *
 * `onChange` is called with the canonical objects that changed. The caller
 * re-reads each through its normal authorized query — which is the whole
 * point: a projection the server produced beats one a frame implied.
 */
export function useRealtime(input: {
  topics: readonly RealtimeTopic[];
  enabled?: boolean;
  onChange?: (changes: readonly RealtimeChange[]) => void;
  /** Re-read everything: called when the server says the cursor is unusable. */
  onResync?: () => void;
}): UseRealtimeResult {
  const { topics, enabled = true, onChange, onResync } = input;
  const [state, setState] = useState<RealtimeConnectionState>("DISCONNECTED");
  const [changes, setChanges] = useState<readonly RealtimeChange[]>([]);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeRef = useRef(onChange);
  const resyncRef = useRef(onResync);
  changeRef.current = onChange;
  resyncRef.current = onResync;

  const topicKey = JSON.stringify(topics);

  useEffect(() => {
    if (!enabled || topics.length === 0) return;
    if (typeof window === "undefined" || typeof WebSocket === "undefined") return;

    let disposed = false;
    const session = new RealtimeSession(setState);
    sessionRef.current = session;

    const open = (): void => {
      if (disposed) return;
      session.opening();
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "realtime.subscribe",
            // No cursor on a first connect: the page has just read its
            // projections, so replaying the ledger at it would re-tell facts
            // already on screen. A RECONNECT sends the cursor it reached.
            subscription: {
              topics,
              ...(session.currentCursor() > 0 ? { cursor: session.currentCursor() } : {}),
            },
          }),
        );
      };

      socket.onmessage = (frame) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(frame.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === "realtime.subscribed") {
          session.opened(Number(message.cursor ?? 0));
          return;
        }
        if (message.type === "realtime.resync") {
          session.resyncRequired(Number(message.cursor ?? 0));
          resyncRef.current?.();
          session.resynced(Number(message.cursor ?? 0));
          return;
        }
        if (message.type === "realtime.events") {
          const applied = session.accept((message.events ?? []) as RealtimeEvent[]);
          if (applied.length === 0) return;
          const next = changedSubjects(applied);
          setChanges(next);
          changeRef.current?.(next);
          socket.send(JSON.stringify({ type: "realtime.ack", cursor: session.currentCursor() }));
        }
      };

      const reopen = (): void => {
        if (disposed) return;
        const delay = session.dropped();
        timerRef.current = setTimeout(open, delay);
      };
      socket.onclose = reopen;
      socket.onerror = () => socket.close();
    };

    open();
    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      session.closed();
    };
    // `topicKey` is the value that matters; `topics` is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, topicKey]);

  const acknowledge = useCallback(() => setChanges([]), []);

  return { state, notice: connectionNotice(state), changes, acknowledge };
}
