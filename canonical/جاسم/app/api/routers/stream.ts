/**
 * JASIM Streaming Router — Real-time SSE Streaming via tRPC Subscriptions
 *
 * Provides:
 *   - `stream.subscribe` — tRPC subscription that yields chunks from EventEmitter
 *   - `stream.sendChunk` — mutation to push chunks into an active stream
 *
 * In-memory event emitters are used for streaming. Production should use Redis/RabbitMQ.
 */

import { router, authedQuery } from "../trpc";
import { z } from "zod";
import { EventEmitter } from "node:events";
import { on } from "node:events";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type StreamChunk =
  | { type: "chunk"; data: string }
  | { type: "status"; data: string }
  | { type: "bubble"; data: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; data: string };

// ═══════════════════════════════════════════════════════════════════════════════
// In-memory stream registry (use Redis for production multi-node)
// ═══════════════════════════════════════════════════════════════════════════════

const streamEmitters = new Map<string, EventEmitter>();

export function createStream(streamId: string): EventEmitter {
  const emitter = new EventEmitter();
  // Prevent memory leak warnings for high-frequency streaming
  emitter.setMaxListeners(100);
  streamEmitters.set(streamId, emitter);
  return emitter;
}

export function getStreamEmitter(streamId: string): EventEmitter | undefined {
  return streamEmitters.get(streamId);
}

export function emitStreamChunk(streamId: string, chunk: StreamChunk): void {
  const emitter = streamEmitters.get(streamId);
  if (emitter) {
    emitter.emit("chunk", chunk);
  }
}

export function closeStream(streamId: string, error?: string): void {
  const emitter = streamEmitters.get(streamId);
  if (emitter) {
    if (error) {
      emitter.emit("chunk", { type: "error", data: error } as StreamChunk);
    }
    emitter.emit("chunk", { type: "done" } as StreamChunk);
    // Small delay before cleanup to ensure consumer receives the done event
    setTimeout(() => {
      emitter.removeAllListeners();
      streamEmitters.delete(streamId);
    }, 5000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stream Router
// ═══════════════════════════════════════════════════════════════════════════════

export const streamRouter = router({
  // ── Subscribe to a stream (tRPC subscription → SSE) ────────────────────────
  subscribe: authedQuery
    .input(z.object({ streamId: z.string() }))
    .subscription(async function* ({ input }) {
      const emitter = streamEmitters.get(input.streamId);
      if (!emitter) {
        yield { type: "error", data: "Stream not found or already closed" } as StreamChunk;
        return;
      }

      try {
        for await (const [event] of on(emitter, "chunk", {
          signal: AbortSignal.timeout(300000), // 5-minute timeout
        })) {
          const chunk = event as StreamChunk;
          yield chunk;

          // End iteration on done/error to free the generator
          if (chunk.type === "done" || chunk.type === "error") {
            return;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // If the error is abort from timeout, just close cleanly
        if (msg.includes("timeout") || msg.includes("aborted")) {
          yield { type: "done" } as StreamChunk;
        } else {
          yield { type: "error", data: msg } as StreamChunk;
        }
      } finally {
        // Clean up emitter if still registered
        const stillThere = streamEmitters.get(input.streamId);
        if (stillThere) {
          stillThere.removeAllListeners();
          streamEmitters.delete(input.streamId);
        }
      }
    }),

  // ── Send a chunk to a stream (used internally by backend) ──────────────────
  sendChunk: authedQuery
    .input(
      z.object({
        streamId: z.string(),
        chunk: z.string(),
      })
    )
    .mutation(({ input }) => {
      emitStreamChunk(input.streamId, { type: "chunk", data: input.chunk });
      return { success: true };
    }),

  // ── Send a status update to a stream ───────────────────────────────────────
  sendStatus: authedQuery
    .input(
      z.object({
        streamId: z.string(),
        status: z.string(),
      })
    )
    .mutation(({ input }) => {
      emitStreamChunk(input.streamId, { type: "status", data: input.status });
      return { success: true };
    }),

  // ── Send a bubble update to a stream ────────────────────────────────────────
  sendBubble: authedQuery
    .input(
      z.object({
        streamId: z.string(),
        bubble: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ input }) => {
      emitStreamChunk(input.streamId, { type: "bubble", data: input.bubble });
      return { success: true };
    }),
});
