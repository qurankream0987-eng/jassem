/**
 * JASIM WebSocket Server
 * Real-time communication for in-app notifications, typing indicators, read receipts
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "http";
import type { WebSocketEvent } from "./notifications/types";
import { authenticateRequest } from "../kimi/auth";
import { getRuntimeBubble, getRuntimeRun } from "../runtime/jasim-runtime";

// Store connections per user
const clients = new Map<string, WebSocket>();

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
      clients.set(principal.userId, ws);
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
          } else {
            ws.send(JSON.stringify({ type: "error", code: "UNSUPPORTED_SOCKET_ACTION" }));
          }
        } catch {
          ws.send(JSON.stringify({ type: "error", code: "INVALID_SOCKET_MESSAGE" }));
        }
      });

      ws.on("close", () => {
        if (clients.get(principal.userId) === ws) clients.delete(principal.userId);
      });

      ws.on("error", () => {
        // Handle errors silently
      });
    });
  }

  /** Emit event to a specific user */
  async emit(userId: string, event: WebSocketEvent): Promise<void> {
    const ws = clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /** Broadcast to all users in a market */
  async broadcastToMarket(marketCode: string, event: WebSocketEvent): Promise<void> {
    void marketCode;
    void event;
    // Market-scoped delivery needs a canonical, server-authorized membership
    // projection. It is intentionally unavailable until that primitive exists.
  }

  /** Broadcast to all connected users */
  async broadcast(event: WebSocketEvent): Promise<void> {
    for (const ws of clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    }
  }

  /** Check if user is online */
  isOnline(userId: string): boolean {
    const ws = clients.get(userId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  /** Get connected user count */
  getConnectionCount(): number {
    let count = 0;
    for (const ws of clients.values()) {
      if (ws.readyState === WebSocket.OPEN) count++;
    }
    return count;
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
