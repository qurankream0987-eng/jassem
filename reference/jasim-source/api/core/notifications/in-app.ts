/**
 * In-App Notification Service - JASIM
 * Real-time notifications via WebSocket + persistent DB storage
 */

import { eq, desc, and } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { notifications } from "@db/schema";
import type { Notification } from "@db/schema";
import {
  NotificationSchema,
  type NotificationPayload,
  type DeliveryResult,
} from "./types";
import { emitToUser } from "../websocket";

export class InAppService {
  /** Store notification and emit via WebSocket */
  async send(notification: NotificationPayload): Promise<DeliveryResult> {
    // Validate input
    NotificationSchema.parse(notification);

    try {
      const userId = Number(notification.userId);
      if (Number.isNaN(userId)) {
        return {
          channel: "in_app",
          status: "failed",
          error: "Invalid userId",
        };
      }

      // Store in database
      const [result] = await db.insert(notifications).values({
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        urgency: notification.urgency,
        channels: ["in_app"],
        read: false,
        actionUrl: notification.actionUrl,
      });

      // Emit via WebSocket for real-time delivery
      try {
        await emitToUser(notification.userId, {
          type: "notification",
          data: {
            id: result.insertId,
            type: notification.type,
            title: notification.title,
            body: notification.body,
            urgency: notification.urgency,
            data: notification.data,
            actionUrl: notification.actionUrl,
            createdAt: new Date().toISOString(),
          },
        });
      } catch {
        // WebSocket may not be available - notification is still persisted
      }

      return {
        channel: "in_app",
        status: "delivered",
        delivered: 1,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "in_app",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Get unread notifications for a user */
  async getUnread(userId: string, limit = 50): Promise<Notification[]> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return [];

    return db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, uid), eq(notifications.read, false)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  /** Get all notifications for a user */
  async getAll(userId: string, limit = 100): Promise<Notification[]> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return [];

    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, uid))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  /** Get notification count (unread and total) */
  async getCounts(userId: string): Promise<{ unread: number; total: number }> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return { unread: 0, total: 0 };

    const allNotifications = await db
      .select({ read: notifications.read })
      .from(notifications)
      .where(eq(notifications.userId, uid));

    return {
      unread: allNotifications.filter((n) => !n.read).length,
      total: allNotifications.length,
    };
  }

  /** Mark a notification as read */
  async markAsRead(notificationId: string): Promise<void> {
    const nid = Number(notificationId);
    if (Number.isNaN(nid)) return;

    await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(eq(notifications.id, nid));
  }

  /** Mark all notifications as read for a user */
  async markAllAsRead(userId: string): Promise<number> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return 0;

    const result = await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, uid), eq(notifications.read, false)));

    return result[0]?.affectedRows || 0;
  }

  /** Delete old read notifications (cleanup) */
  async cleanupRead(daysOld = 30): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = await db
      .delete(notifications)
      .where(and(eq(notifications.read, true)));

    return result[0]?.affectedRows || 0;
  }
}

// Singleton
let _inAppService: InAppService | null = null;
export function getInAppService(): InAppService {
  if (!_inAppService) _inAppService = new InAppService();
  return _inAppService;
}
