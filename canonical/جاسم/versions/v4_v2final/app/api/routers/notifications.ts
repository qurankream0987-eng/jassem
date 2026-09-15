/**
 * Notifications tRPC Router - JASIM
 * Endpoints for in-app notifications, preferences, device tokens
 */

import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { router, publicQuery, authedQuery } from "../trpc";
import { db } from "../queries/connection";
import { notifications, notificationPreferences, deviceTokens } from "@db/schema";
import {
  getNotificationRouter,
  getInAppService,
  getPushService,
  onUserWelcome,
} from "../core/notifications";

export const notificationsRouter = router({
  // ============================================
  // LIST NOTIFICATIONS
  // ============================================

  /** Get all notifications for the current user */
  list: authedQuery
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).default(50),
          unreadOnly: z.boolean().default(false),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const limit = input?.limit || 50;

      if (input?.unreadOnly) {
        return getInAppService().getUnread(String(userId), limit);
      }
      return getInAppService().getAll(String(userId), limit);
    }),

  /** Get notification counts */
  counts: authedQuery.query(async ({ ctx }) => {
    return getInAppService().getCounts(String(ctx.user!.id));
  }),

  // ============================================
  // MARK AS READ
  // ============================================

  /** Mark a specific notification as read */
  markAsRead: authedQuery
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ input }) => {
      await getInAppService().markAsRead(input.notificationId);
      return { success: true };
    }),

  /** Mark all notifications as read */
  markAllAsRead: authedQuery.mutation(async ({ ctx }) => {
    const count = await getInAppService().markAllAsRead(String(ctx.user!.id));
    return { success: true, count };
    }),

  // ============================================
  // PREFERENCES
  // ============================================

  /** Get user notification preferences */
  getPreferences: authedQuery.query(async ({ ctx }) => {
    const router = getNotificationRouter();
    return router.getUserPreferences(String(ctx.user!.id));
    }),

  /** Update notification preferences */
  updatePreferences: authedQuery
    .input(
      z.object({
        inApp: z.boolean().optional(),
        push: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        sms: z.boolean().optional(),
        email: z.boolean().optional(),
        marketingEmails: z.boolean().optional(),
        quietHoursStart: z.number().min(0).max(23).optional(),
        quietHoursEnd: z.number().min(0).max(23).optional(),
        language: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const router = getNotificationRouter();
      await router.updatePreferences(String(ctx.user!.id), input);
      return { success: true };
    }),

  // ============================================
  // DEVICE TOKENS (PUSH)
  // ============================================

  /** Register a device token for push notifications */
  registerToken: authedQuery
    .input(
      z.object({
        token: z.string().min(1),
        platform: z.enum(["android", "ios", "web"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await getPushService().registerToken(String(ctx.user!.id), input.token, input.platform);
      return { success: true };
    }),

  /** Deactivate a device token */
  deactivateToken: authedQuery
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await getPushService().deactivateToken(input.token);
      return { success: true };
    }),

  // ============================================
  // ADMIN: DISPATCH (for testing/admin use)
  // ============================================

  /** Dispatch a notification (admin only) */
  dispatch: authedQuery
    .input(
      z.object({
        targetUserId: z.string(),
        type: z.string(),
        title: z.string(),
        body: z.string(),
        urgency: z.enum(["normal", "high", "critical"]).default("normal"),
        actionUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const router = getNotificationRouter();
      const results = await router.dispatch({
        userId: input.targetUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        urgency: input.urgency,
        actionUrl: input.actionUrl,
      });
      return { success: true, results };
    }),

  // ============================================
  // CHANNEL STATUS
  // ============================================

  /** Get status of all notification channels */
  channelStatus: publicQuery.query(() => {
    const router = getNotificationRouter();
    return router.getChannelStatus();
  }),
});
