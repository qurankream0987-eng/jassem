/**
 * JASIM WebSocket Server
 * Real-time communication for in-app notifications, typing indicators, read receipts
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { WebSocketEvent } from "./notifications/types";

// Store connections per user
const clients = new Map<string, WebSocket>();
const userMarkets = new Map<string, string>(); // userId → marketCode

export class JasimWebSocketServer {
  private wss: WebSocketServer | null = null;

  constructor(server?: HttpServer) {
    if (server) {
      this.wss = new WebSocketServer({ server });
      this.setupHandlers();
    }
  }

  private setupHandlers(): void {
    if (!this.wss) return;

    this.wss.on("connection", (ws: WebSocket, _req: unknown) => {
      // Wait for auth message to register user
      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          // Handle auth registration
          if (message.type === "auth" && message.userId) {
            const userId = String(message.userId);
            clients.set(userId, ws);
            if (message.marketCode) {
              userMarkets.set(userId, String(message.marketCode));
            }
            ws.send(JSON.stringify({ type: "connected", data: { userId } }));
          }
          // Handle ping/pong keepalive
          else if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          }
          // Handle read receipts
          else if (message.type === "read_receipt") {
            this.handleReadReceipt(message);
          }
          // Handle typing indicators
          else if (message.type === "typing") {
            this.handleTypingIndicator(message);
          }
        } catch {
          // Invalid message - ignore
        }
      });

      ws.on("close", () => {
        // Remove disconnected client
        for (const [uid, socket] of clients.entries()) {
          if (socket === ws) {
            clients.delete(uid);
            userMarkets.delete(uid);
            break;
          }
        }
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
    for (const [userId, market] of userMarkets.entries()) {
      if (market === marketCode) {
        const ws = clients.get(userId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event));
        }
      }
    }
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
  private handleReadReceipt(message: Record<string, unknown>): void {
    // Acknowledge read receipt - can be extended
    const notificationId = message.notificationId;
    if (notificationId) {
      // Emit back to confirm
      this.emit(String(message.userId), {
        type: "read_confirmed",
        data: { notificationId: String(notificationId) },
      });
    }
  }

  /** Handle typing indicators */
  private handleTypingIndicator(message: Record<string, unknown>): void {
    const toUserId = message.toUserId;
    if (toUserId) {
      this.emit(String(toUserId), {
        type: "typing_indicator",
        data: {
          fromUserId: String(message.userId),
          isTyping: Boolean(message.isTyping),
        },
      });
    }
  }
}

// Singleton instance for shared access
let wsInstance: JasimWebSocketServer | null = null;

export function initWebSocket(server: HttpServer): JasimWebSocketServer {
  wsInstance = new JasimWebSocketServer(server);
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
