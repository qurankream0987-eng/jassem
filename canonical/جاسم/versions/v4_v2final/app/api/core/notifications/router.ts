/**
 * Notification Router - JASIM
 * Central notification dispatcher that routes notifications to appropriate
 * channels based on urgency level, user preferences, and notification type.
 */

import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { deliveryLogs, notificationPreferences } from "@db/schema";
import {
  NotificationSchema,
  NotificationUrgencySchema,
  type NotificationPayload,
  type DeliveryResult,
  type NotificationChannel,
} from "./types";
import { getPushService } from "./push";
import { getWhatsAppService } from "./whatsapp";
import { getSMSService } from "./sms";
import { getEmailService } from "./email";
import { getInAppService } from "./in-app";

// ============================================
// CHANNEL PRIORITY MAP
// ============================================
/** Channel selection priority per urgency level */
const CHANNEL_PRIORITY: Record<string, NotificationChannel[]> = {
  normal: ["in_app", "whatsapp"],
  high: ["in_app", "push", "whatsapp"],
  critical: ["in_app", "push", "whatsapp", "sms"],
};

/** Marketing channels (opt-in based) */
const MARKETING_CHANNELS: NotificationChannel[] = ["email", "whatsapp"];

export class NotificationRouter {
  private pushService = getPushService();
  private whatsappService = getWhatsAppService();
  private smsService = getSMSService();
  private emailService = getEmailService();
  private inAppService = getInAppService();

  // ============================================
  // MAIN DISPATCH
  // ============================================

  /** Main dispatch method - routes to all appropriate channels */
  async dispatch(notification: NotificationPayload): Promise<DeliveryResult[]> {
    // Validate with Zod
    const validated = NotificationSchema.parse(notification);

    // Select channels
    const channels = await this.selectChannels(validated);

    const results: DeliveryResult[] = [];

    // Send to each channel in parallel
    const sendPromises = channels.map(async (channel) => {
      try {
        const result = await this.send(channel, validated);
        results.push(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.push({ channel, status: "failed", error: msg });
      }
    });

    await Promise.all(sendPromises);

    // Store delivery log (fire and forget)
    this.logDelivery(notification, results).catch(() => {
      // Don't fail the request if logging fails
    });

    return results;
  }

  /** Dispatch to a single specific channel */
  async dispatchToChannel(
    notification: NotificationPayload,
    channel: NotificationChannel
  ): Promise<DeliveryResult> {
    NotificationSchema.parse(notification);
    return this.send(channel, notification);
  }

  // ============================================
  // CHANNEL SELECTION
  // ============================================

  /** Select channels based on urgency, type, and user preferences */
  private async selectChannels(notification: NotificationPayload): Promise<NotificationChannel[]> {
    const channels = new Set<NotificationChannel>();

    // Always send in-app
    channels.add("in_app");

    // Add channels based on urgency
    const urgencyChannels = CHANNEL_PRIORITY[notification.urgency] || CHANNEL_PRIORITY.normal;
    for (const ch of urgencyChannels) {
      channels.add(ch);
    }

    // Add marketing channels for marketing type
    if (notification.type === "marketing") {
      for (const ch of MARKETING_CHANNELS) {
        channels.add(ch);
      }
    }

    // Filter by user preferences
    const prefs = await this.getUserPreferences(notification.userId);
    if (prefs) {
      if (!prefs.push) channels.delete("push");
      if (!prefs.whatsapp) channels.delete("whatsapp");
      if (!prefs.sms) channels.delete("sms");
      if (!prefs.email) channels.delete("email");
      if (!prefs.inApp) channels.delete("in_app");

      // Marketing opt-out
      if (!prefs.marketingEmails && notification.type === "marketing") {
        channels.delete("email");
        channels.delete("whatsapp");
      }
    }

    // Remove unavailable services
    if (!this.pushService.isConfigured()) channels.delete("push");
    if (!this.whatsappService.isConfigured()) channels.delete("whatsapp");
    if (!this.smsService.isConfigured()) channels.delete("sms");
    if (!this.emailService.isConfigured()) channels.delete("email");

    return Array.from(channels);
  }

  // ============================================
  // PER-CHANNEL SEND
  // ============================================

  /** Send via a specific channel */
  private async send(
    channel: NotificationChannel,
    notification: NotificationPayload
  ): Promise<DeliveryResult> {
    switch (channel) {
      case "push":
        return this.pushService.send(notification);
      case "whatsapp":
        return this.whatsappService.send(notification);
      case "sms":
        return this.smsService.send(notification);
      case "email":
        return this.emailService.send(notification);
      case "in_app":
        return this.inAppService.send(notification);
      default:
        return { channel, status: "failed", error: `Unknown channel: ${channel}` };
    }
  }

  // ============================================
  // DELIVERY LOGGING
  // ============================================

  /** Log delivery attempt to database */
  private async logDelivery(
    notification: NotificationPayload,
    results: DeliveryResult[]
  ): Promise<void> {
    try {
      const userId = Number(notification.userId);
      if (Number.isNaN(userId)) return;

      // Get the notification ID from the last insert
      const { notifications: notificationsTable } = await import("@db/schema");
      const { desc } = await import("drizzle-orm");

      const latest = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, userId))
        .orderBy(desc(notificationsTable.createdAt))
        .limit(1);

      const notificationId = latest[0]?.id;
      if (!notificationId) return;

      // Insert delivery logs
      for (const result of results) {
        await db.insert(deliveryLogs).values({
          notificationId,
          userId,
          channel: result.channel,
          status: result.status,
          errorMessage: result.error || null,
          providerResponse: result.providerResponse || null,
        });
      }
    } catch {
      // Don't fail if logging fails
    }
  }

  // ============================================
  // USER PREFERENCES
  // ============================================

  /** Get user notification preferences */
  async getUserPreferences(userId: string) {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return null;

    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, uid))
      .limit(1);

    return rows[0] || null;
  }

  /** Set default preferences for a user (creates if not exists) */
  async ensurePreferences(userId: string): Promise<void> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return;

    const existing = await this.getUserPreferences(userId);
    if (!existing) {
      await db.insert(notificationPreferences).values({
        userId: uid,
        inApp: true,
        push: true,
        whatsapp: true,
        sms: true,
        email: true,
        marketingEmails: true,
        language: "ar",
      });
    }
  }

  /** Update user notification preferences */
  async updatePreferences(
    userId: string,
    prefs: Partial<{
      inApp: boolean;
      push: boolean;
      whatsapp: boolean;
      sms: boolean;
      email: boolean;
      marketingEmails: boolean;
      quietHoursStart: number;
      quietHoursEnd: number;
      language: string;
    }>
  ): Promise<void> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return;

    // Ensure preferences exist first
    await this.ensurePreferences(userId);

    await db
      .update(notificationPreferences)
      .set({ ...prefs, updatedAt: new Date() })
      .where(eq(notificationPreferences.userId, uid));
  }

  // ============================================
  // SERVICE STATUS
  // ============================================

  /** Get status of all notification channels */
  getChannelStatus(): Record<string, boolean> {
    return {
      push: this.pushService.isConfigured(),
      whatsapp: this.whatsappService.isConfigured(),
      sms: this.smsService.isConfigured(),
      email: this.emailService.isConfigured(),
      in_app: true, // Always available
    };
  }
}

// Singleton
let _notificationRouter: NotificationRouter | null = null;
export function getNotificationRouter(): NotificationRouter {
  if (!_notificationRouter) _notificationRouter = new NotificationRouter();
  return _notificationRouter;
}
