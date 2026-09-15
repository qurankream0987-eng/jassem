/**
 * Push Notification Service - JASIM
 * Firebase Cloud Messaging (FCM) for Android + APNs for iOS
 */

import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { deviceTokens, users } from "@db/schema";
import {
  NotificationSchema,
  type NotificationPayload,
  type DeliveryResult,
} from "./types";
import { z } from "zod";

// Lazy-loaded Firebase Admin SDK
let messaging: unknown | null = null;
let firebaseApp: unknown = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }

    // Dynamic import to avoid crash when env vars not set
    const { initializeApp, cert } = require("firebase-admin/app");
    const { getMessaging } = require("firebase-admin/messaging");

    firebaseApp = initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
      },
      "jasim-push"
    );
    messaging = getMessaging(firebaseApp);
    return firebaseApp;
  } catch {
    return null;
  }
}

/** Get device tokens for a user */
async function getDeviceTokens(userId: string): Promise<string[]> {
  const uid = Number(userId);
  if (Number.isNaN(uid)) return [];

  const rows = await db
    .select({ token: deviceTokens.token })
    .from(deviceTokens)
    .where(eq(deviceTokens.userId, uid))
    .limit(500);

  return rows.map((r) => r.token);
}

export class PushService {
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = !!(
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    );
  }

  /** Check if push service is configured */
  isConfigured(): boolean {
    return this.isAvailable;
  }

  /** Send push notification via FCM (Android + iOS) */
  async send(notification: NotificationPayload): Promise<DeliveryResult> {
    // Validate input
    NotificationSchema.parse(notification);

    if (!this.isAvailable) {
      return {
        channel: "push",
        status: "failed",
        error: "Firebase not configured - set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY",
      };
    }

    try {
      const app = getFirebaseApp();
      if (!app || !messaging) {
        return {
          channel: "push",
          status: "failed",
          error: "Failed to initialize Firebase",
        };
      }

      const tokens = await getDeviceTokens(notification.userId);
      if (tokens.length === 0) {
        return {
          channel: "push",
          status: "delivered",
          delivered: 0,
        };
      }

      const { getMessaging } = require("firebase-admin/messaging");
      const fcm = getMessaging(app);

      // Determine priority based on urgency
      const isHighPriority = notification.urgency === "critical" || notification.urgency === "high";

      const message = {
        tokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          type: notification.type,
          action: notification.actionUrl || "",
          bubble: JSON.stringify(notification.bubble || {}),
          ...notification.data,
        } as Record<string, string>,
        android: {
          priority: isHighPriority ? ("high" as const) : ("normal" as const),
          notification: {
            channelId: "jasim_notifications",
            sound: "default",
            priority: isHighPriority ? ("high" as const) : ("default" as const),
          },
        },
        apns: {
          headers: {
            "apns-priority": isHighPriority ? "10" : "5",
          },
          payload: {
            aps: {
              alert: { title: notification.title, body: notification.body },
              badge: 1,
              sound: "default",
            },
          },
        },
      };

      const response = await fcm.sendEachForMulticast(message);
      return {
        channel: "push",
        status: response.failureCount > 0 && response.successCount === 0 ? "failed" : "delivered",
        delivered: response.successCount,
        providerResponse: `success=${response.successCount}, failure=${response.failureCount}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "push",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Subscribe user to a topic (for broadcast notifications) */
  async subscribeToTopic(userId: string, topic: string): Promise<void> {
    if (!this.isAvailable) return;

    try {
      const app = getFirebaseApp();
      if (!app) return;

      const tokens = await getDeviceTokens(userId);
      if (tokens.length === 0) return;

      const { getMessaging } = require("firebase-admin/messaging");
      const fcm = getMessaging(app);
      await fcm.subscribeToTopic(tokens, `jasim_${topic}`);
    } catch {
      // Silently fail if not configured
    }
  }

  /** Unsubscribe user from a topic */
  async unsubscribeFromTopic(userId: string, topic: string): Promise<void> {
    if (!this.isAvailable) return;

    try {
      const app = getFirebaseApp();
      if (!app) return;

      const tokens = await getDeviceTokens(userId);
      if (tokens.length === 0) return;

      const { getMessaging } = require("firebase-admin/messaging");
      const fcm = getMessaging(app);
      await fcm.unsubscribeFromTopic(tokens, `jasim_${topic}`);
    } catch {
      // Silently fail if not configured
    }
  }

  /** Register a device token for a user */
  async registerToken(userId: string, token: string, platform: "android" | "ios" | "web"): Promise<void> {
    const uid = Number(userId);
    if (Number.isNaN(uid)) return;

    // Check if token already exists
    const existing = await db
      .select({ id: deviceTokens.id })
      .from(deviceTokens)
      .where(eq(deviceTokens.token, token))
      .limit(1);

    if (existing.length > 0) {
      // Update last used
      await db
        .update(deviceTokens)
        .set({ lastUsedAt: new Date(), platform, userId: uid })
        .where(eq(deviceTokens.id, existing[0].id));
    } else {
      // Insert new token
      await db.insert(deviceTokens).values({
        userId: uid,
        token,
        platform,
        isActive: true,
        lastUsedAt: new Date(),
      });
    }
  }

  /** Deactivate a device token */
  async deactivateToken(token: string): Promise<void> {
    await db
      .update(deviceTokens)
      .set({ isActive: false })
      .where(eq(deviceTokens.token, token));
  }
}

// Singleton
let _pushService: PushService | null = null;
export function getPushService(): PushService {
  if (!_pushService) _pushService = new PushService();
  return _pushService;
}
