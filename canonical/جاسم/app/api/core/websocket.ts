/**
 * JASIM WebSocket Server
 * Real-time communication for in-app notifications, typing indicators, read receipts
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "http";
import type { WebSocketEvent } from "./notifications/types";
import { authenticateRequest } from "../kimi/auth";
import { getRuntimeBubble, getRuntimeRun } from "../runtime/jasim-runtime";

/**
 * Connections per user — a SET, not one socket.
 *
 * It was a `Map<string, WebSocket>`, so a second tab silently replaced the
 * first and the first stopped receiving anything. Two tabs, a phone and a
 * laptop are ordinary; none of them owns the user's connection.
 *
 * This registry is transport infrastructure and NEVER canonical state. A
 * server restart empties it and erases nothing: what happened is in the
 * ledger, and a client reconnects and resumes from its cursor.
 */
const clients = new Map<string, Set<WebSocket>>();

/** What one connection is listening to, and where it has got to. */
type RealtimeAttachment = {
  subscription: import("../runtime/realtime-runtime").AuthorizedSubscription;
  /** WHO holds it, so it can be re-authorized as them rather than trusted. */
  principalId: string;
  cursor: number;
  queued: number;
  /** Set when the socket must resync before it is fed anything else. */
  stalled: boolean;
  /**
   * When the authorization behind this attachment was last established.
   *
   *   AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER
   */
  authorizedAt: number;
};

const attachments = new WeakMap<WebSocket, RealtimeAttachment>();
const liveSockets = new Set<WebSocket>();
/** Sockets that answered the last heartbeat. A silent one is closed. */
const alive = new WeakSet<WebSocket>();

function addClient(userId: string, ws: WebSocket): void {
  const existing = clients.get(userId);
  if (existing) existing.add(ws);
  else clients.set(userId, new Set([ws]));
  liveSockets.add(ws);
}

function removeClient(userId: string, ws: WebSocket): void {
  const existing = clients.get(userId);
  if (existing) {
    existing.delete(ws);
    if (existing.size === 0) clients.delete(userId);
  }
  liveSockets.delete(ws);
}

/** Every open connection listening to realtime, for the ledger tailer. */
export function realtimeAttachments(): ReadonlyArray<{
  socket: WebSocket;
  attachment: RealtimeAttachment;
}> {
  const open: Array<{ socket: WebSocket; attachment: RealtimeAttachment }> = [];
  for (const socket of liveSockets) {
    const attachment = attachments.get(socket);
    if (attachment && socket.readyState === WebSocket.OPEN) open.push({ socket, attachment });
  }
  return open;
}

export interface WebSocketPrincipal {
  userId: string;
}

export type PrivateSubscriptionTarget =
  | { resource: "bubble"; resourceId: string }
  | { resource: "run"; resourceId: string };

export interface JasimWebSocketServerOptions {
  authenticate?: (headers: Headers) => Promise<WebSocketPrincipal>;
  authorizeSubscription?: (
    principal: WebSocketPrincipal,
    target: PrivateSubscriptionTarget,
  ) => Promise<boolean>;
}

function toHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

async function authenticateSocket(headers: Headers): Promise<WebSocketPrincipal> {
  const user = await authenticateRequest(headers);
  return { userId: String(user.id) };
}

async function authorizePrivateSubscription(
  principal: WebSocketPrincipal,
  target: PrivateSubscriptionTarget,
): Promise<boolean> {
  try {
    if (target.resource === "bubble") {
      await getRuntimeBubble(target.resourceId, principal.userId);
    } else {
      await getRuntimeRun(target.resourceId, principal.userId);
    }
    return true;
  } catch {
    // Private-resource lookups deliberately do not disclose whether an ID
    // exists for another principal.
    return false;
  }
}

export class JasimWebSocketServer {
  private wss: WebSocketServer | null = null;
  private readonly principals = new WeakMap<IncomingMessage, WebSocketPrincipal>();
  private readonly authenticate: (headers: Headers) => Promise<WebSocketPrincipal>;
  private readonly authorizeSubscription: (
    principal: WebSocketPrincipal,
    target: PrivateSubscriptionTarget,
  ) => Promise<boolean>;

  constructor(server?: HttpServer, options: JasimWebSocketServerOptions = {}) {
    this.authenticate = options.authenticate ?? authenticateSocket;
    this.authorizeSubscription =
      options.authorizeSubscription ?? authorizePrivateSubscription;
    if (server) {
      this.wss = new WebSocketServer({
        server,
        verifyClient: (info, done) => {
          void this.authenticate(toHeaders(info.req))
            .then((principal) => {
              this.principals.set(info.req, principal);
              done(true);
            })
            .catch(() => done(false, 401, "Unauthorized"));
        },
      });
      this.setupHandlers();
    }
  }

  private setupHandlers(): void {
    if (!this.wss) return;

    this.wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      const principal = this.principals.get(request);
      if (!principal) {
        ws.close(1008, "Unauthorized");
        return;
      }
      addClient(principal.userId, ws);
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      ws.send(JSON.stringify({ type: "connected" }));

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as Record<string, unknown>;
          if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          } else if (message.type === "read_receipt") {
            this.handleReadReceipt(principal, message);
          } else if (message.type === "subscribe") {
            void this.handleSubscription(ws, principal, message);
          } else if (message.type === "realtime.subscribe") {
            void this.handleRealtimeSubscribe(ws, principal, message);
          } else if (message.type === "realtime.ack") {
            handleRealtimeAck(ws, message);
          } else {
            ws.send(JSON.stringify({ type: "error", code: "UNSUPPORTED_SOCKET_ACTION" }));
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", code: "INVALID_SOCKET_MESSAGE" }));
        }
      });

      ws.on("close", () => {
        removeClient(principal.userId, ws);
        attachments.delete(ws);
      });

      ws.on("error", () => {
        // Handle errors silently
      });
    });
  }

  /** Emit event to every connection this user has open. */
  async emit(userId: string, event: WebSocketEvent): Promise<void> {
    const sockets = clients.get(userId);
    if (!sockets) return;
    const frame = JSON.stringify(event);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }

  /** Broadcast to all users in a market */
  async broadcastToMarket(marketCode: string, event: WebSocketEvent): Promise<void> {
    void marketCode;
    void event;
    // Market-scoped delivery needs a canonical, server-authorized membership
    // projection. It is intentionally unavailable until that primitive exists.
  }

  /**
   * Broadcast to every connected user.
   *
   * Deliberately unimplemented, for the same reason `broadcastToMarket` is: a
   * frame that reaches everybody has been authorized for nobody. Realtime
   * delivery goes through an AUTHORIZED subscription and the ledger tailer,
   * where scope is checked before anything is sent.
   */
  async broadcast(event: WebSocketEvent): Promise<void> {
    void event;
  }

  /** Check if user is online */
  isOnline(userId: string): boolean {
    const sockets = clients.get(userId);
    if (!sockets) return false;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /** Get connected socket count. */
  getConnectionCount(): number {
    let count = 0;
    for (const sockets of clients.values()) {
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) count++;
      }
    }
    return count;
  }

  /**
   * Close connections that stopped answering.
   *
   *   HEARTBEAT PROVES TRANSPORT LIVENESS, AND NOTHING ELSE
   *
   * A socket whose peer vanished without a FIN stays OPEN forever otherwise,
   * and a connection that is dead but registered is worse than one that is
   * gone: the client reconnects from its cursor, and a phantom never does.
   */
  sweepHeartbeats(): { pinged: number; closed: number } {
    let pinged = 0;
    let closed = 0;
    for (const ws of [...liveSockets]) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!alive.has(ws)) {
        closed += 1;
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
      pinged += 1;
    }
    return { pinged, closed };
  }

  /** Handle read receipts */
  private handleReadReceipt(principal: WebSocketPrincipal, message: Record<string, unknown>): void {
    // Acknowledge read receipt - can be extended
    const notificationId = message.notificationId;
    if (notificationId) {
      this.emit(principal.userId, {
        type: "read_confirmed",
        data: { notificationId: String(notificationId) },
      });
    }
  }

  /**
   * The canonical realtime subscription.
   *
   *   AUTHORIZATION BEFORE SUBSCRIPTION
   *
   * The request says what to hear about. It cannot say whose events those are,
   * what permission it holds, or that it is allowed — the server derives all
   * of that from the handshake principal, and a guessed id is refused rather
   * than reported as missing.
   */
  private async handleRealtimeSubscribe(
    ws: WebSocket,
    principal: WebSocketPrincipal,
    message: Record<string, unknown>,
  ): Promise<void> {
    const realtime = await import("../runtime/realtime-runtime");
    try {
      const subscription = await realtime.authorizeSubscription({
        principalId: principal.userId,
        request: message.subscription,
      });
      const requested = (message.subscription as { cursor?: unknown } | undefined)?.cursor;
      // A subscriber with no cursor starts at the HEAD. Replaying the ledger
      // at a client that has just fetched a projection would be a second
      // telling of facts it is already showing.
      const cursor =
        typeof requested === "number" && Number.isInteger(requested) && requested >= 0
          ? requested
          : await realtime.head();
      attachments.set(ws, {
        subscription,
        principalId: principal.userId,
        cursor,
        queued: 0,
        stalled: false,
        authorizedAt: Date.now(),
      });
      realtime.recordMetric("subscriptions");
      ws.send(JSON.stringify({ type: "realtime.subscribed", cursor }));
    } catch (error) {
      realtime.recordMetric("authorizationRejects");
      ws.send(
        JSON.stringify({
          type: "realtime.error",
          code: error instanceof realtime.RealtimeError ? error.code : "INVALID",
          // The message is the runtime's own sentence, which never names an
          // id the caller was not already holding.
          message: error instanceof Error ? error.message : "Subscription refused.",
        }),
      );
    }
  }

  private async handleSubscription(
    ws: WebSocket,
    principal: WebSocketPrincipal,
    message: Record<string, unknown>,
  ): Promise<void> {
    const resource = message.resource;
    const resourceId = message.resourceId;
    if (
      (resource !== "bubble" && resource !== "run") ||
      typeof resourceId !== "string" ||
      resourceId.length === 0 ||
      resourceId.length > 128
    ) {
      ws.send(JSON.stringify({ type: "error", code: "INVALID_SUBSCRIPTION" }));
      return;
    }

    const target: PrivateSubscriptionTarget = { resource, resourceId };
    if (!(await this.authorizeSubscription(principal, target))) {
      ws.send(JSON.stringify({ type: "error", code: "SUBSCRIPTION_FORBIDDEN" }));
      return;
    }
    ws.send(JSON.stringify({ type: "subscribed", resource, resourceId }));
  }
}

/**
 * The client saying it applied up to a cursor.
 *
 * It may only move FORWARD, and never past what the server has sent. A client
 * that could acknowledge the future could skip the range in between.
 */
function handleRealtimeAck(ws: WebSocket, message: Record<string, unknown>): void {
  const attachment = attachments.get(ws);
  if (!attachment) return;
  const cursor = message.cursor;
  if (typeof cursor !== "number" || !Number.isInteger(cursor)) return;
  if (cursor < 0 || cursor > attachment.cursor) return;
  attachment.queued = Math.max(0, attachment.queued - 1);
  if (attachment.queued === 0) attachment.stalled = false;
}

// Singleton instance for shared access
let wsInstance: JasimWebSocketServer | null = null;

export function initWebSocket(
  server: HttpServer,
  options?: JasimWebSocketServerOptions,
): JasimWebSocketServer {
  wsInstance = new JasimWebSocketServer(server, options);
  return wsInstance;
}

export function getWebSocketInstance(): JasimWebSocketServer | null {
  return wsInstance;
}

// Standalone emit function for use outside WS context
export async function emitToUser(userId: string, event: WebSocketEvent): Promise<void> {
  if (wsInstance) {
    await wsInstance.emit(userId, event);
  }
}

/**
 * Carry the ledger to every open subscription.
 *
 * The socket layer's only job here is to be a sink: it holds no cursor
 * history, no event copy and no authorization decision of its own. All three
 * live in `realtime-runtime.ts` and in the durable ledger, which is why a
 * restart of this process costs a reconnect and nothing else.
 */
export async function deliverRealtime(options?: { now?: Date }): Promise<{
  connections: number;
  delivered: number;
  resyncRequired: number;
  revoked: number;
}> {
  const open = realtimeAttachments();
  if (open.length === 0) {
    return { connections: 0, delivered: 0, resyncRequired: 0, revoked: 0 };
  }
  const { tailRealtime } = await import("../runtime/realtime-runtime");
  return tailRealtime(
    open.map(({ socket, attachment }) => ({
      socketId: socket,
      scopeId: attachment.subscription.scope.scopeId,
      principalId: attachment.principalId,
      cursor: attachment.cursor,
      queued: attachment.queued,
      stalled: attachment.stalled,
      subscription: attachment.subscription,
      authorizedAt: attachment.authorizedAt,
      deliver: (batch, cursor) => {
        attachment.cursor = cursor;
        if (batch.length === 0) return;
        attachment.queued += 1;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "realtime.events", events: batch, cursor }));
        }
      },
      requireResync: (cursor, reason) => {
        attachment.stalled = true;
        if (socket.readyState === WebSocket.OPEN) {
          // Not a subset, and not silence. The client re-reads the canonical
          // projection and comes back with a cursor that means something.
          socket.send(JSON.stringify({ type: "realtime.resync", cursor, reason }));
        }
      },
      reauthorized: (subscription, at) => {
        attachment.subscription = subscription;
        attachment.authorizedAt = at;
      },
      revoke: () => {
        // The subscription ends here. The attachment is removed FIRST, so a
        // sweep that overlaps this one has nothing left to deliver to.
        attachments.delete(socket);
        if (socket.readyState === WebSocket.OPEN) {
          // A code, and nothing else: not the object that became forbidden,
          // not whether it still exists, not which permission was lost. A
          // client that reconnects will be told the same by the subscribe
          // path, which is the only place that answer belongs.
          socket.send(JSON.stringify({ type: "realtime.revoked", code: "ACCESS_REVOKED" }));
        }
      },
    })),
    options,
  );
}
