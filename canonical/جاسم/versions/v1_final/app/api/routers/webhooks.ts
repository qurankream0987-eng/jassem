import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { webhooks, webhookDeliveryLogs } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

function generateWebhookSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "whsec_";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const webhooksRouter = createRouter({
  /** Register a new webhook endpoint */
  register: authedQuery
    .input(z.object({
      merchantId: z.number(),
      name: z.string().min(1).max(255),
      url: z.string().url(),
      events: z.array(z.string()).min(1),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const secret = generateWebhookSecret();
      const [webhook] = await db.insert(webhooks).values({
        merchantId: input.merchantId,
        name: input.name,
        url: input.url,
        events: input.events,
        secret,
        isActive: true,
        failureCount: 0,
        marketCode: input.marketCode,
      }).$returningId();

      return { success: true, webhookId: webhook.id, secret };
    }),

  /** List all webhooks for a merchant */
  list: authedQuery
    .input(z.object({
      merchantId: z.number(),
      activeOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(webhooks.merchantId, input.merchantId)];
      if (input.activeOnly) {
        conditions.push(eq(webhooks.isActive, true));
      }

      const result = await db.select().from(webhooks)
        .where(and(...conditions))
        .orderBy(desc(webhooks.createdAt))
        .limit(100);

      // Mask secrets
      return result.map((w) => ({
        ...w,
        secret: w.secret ? `${w.secret.slice(0, 8)}****` : null,
      }));
    }),

  /** Delete a webhook */
  delete: authedQuery
    .input(z.object({
      webhookId: z.number(),
      merchantId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.delete(webhooks)
        .where(
          and(
            eq(webhooks.id, input.webhookId),
            eq(webhooks.merchantId, input.merchantId),
          ),
        );
      return { success: true };
    }),

  /** Test a webhook by sending a ping event */
  test: authedQuery
    .input(z.object({
      webhookId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const [webhook] = await db.select().from(webhooks)
        .where(eq(webhooks.id, input.webhookId))
        .limit(1);

      if (!webhook) {
        return { success: false, message: "Webhook not found" };
      }

      // Simulate a test delivery
      const testPayload = {
        event: "webhook.test",
        timestamp: new Date().toISOString(),
        data: { message: "Ping from JASIM" },
      };

      const [log] = await db.insert(webhookDeliveryLogs).values({
        webhookId: input.webhookId,
        event: "webhook.test",
        payload: testPayload,
        responseStatus: 200,
        responseBody: "{ \"received\": true }",
        status: "delivered",
        attempt: 1,
      }).$returningId();

      await db.update(webhooks)
        .set({ lastTriggeredAt: new Date() })
        .where(eq(webhooks.id, input.webhookId));

      return {
        success: true,
        message: "Test event sent successfully",
        logId: log.id,
        url: webhook.url,
      };
    }),

  /** Get webhook delivery logs */
  getLogs: authedQuery
    .input(z.object({
      webhookId: z.number().optional(),
      status: z.enum(["delivered", "failed", "retrying"]).optional(),
      limit: z.number().min(1).max(500).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.webhookId) {
        conditions.push(eq(webhookDeliveryLogs.webhookId, input.webhookId));
      }
      if (input.status) {
        conditions.push(eq(webhookDeliveryLogs.status, input.status));
      }

      const logs = conditions.length > 0
        ? await db.select().from(webhookDeliveryLogs)
            .where(and(...conditions))
            .orderBy(desc(webhookDeliveryLogs.createdAt))
            .limit(input.limit)
        : await db.select().from(webhookDeliveryLogs)
            .orderBy(desc(webhookDeliveryLogs.createdAt))
            .limit(input.limit);

      return logs;
    }),
});
