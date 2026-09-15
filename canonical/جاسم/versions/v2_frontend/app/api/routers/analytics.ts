import { z } from "zod";
import { router, authedQuery } from "../trpc";
import { db } from "@db/queries/connection";
import { orders, products, merchants, users, agentLogs } from "@db/schema";
import { eq, desc, and, sql, gte, between } from "drizzle-orm";

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           REAL-TIME ANALYTICS ENGINE                         ║
 * ║  Live dashboards with time-series tracking                   ║
 * ╚════════════════════════════════════════════════════════════════╝
 */

export const analyticsRouter = router({
  /** ════════════════════════════════════════════════════════════
   *  REAL-TIME OVERVIEW — Live system stats
   * ════════════════════════════════════════════════════════════*/
  realtime: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Today's orders
      const todayOrders = await db.select({
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(total_amount), 0)`,
      })
        .from(orders)
        .where(gte(orders.createdAt, todayStart));

      // Active users (logged in today)
      const activeUsers = await db.select({ count: sql<number>`COUNT(DISTINCT id)` })
        .from(users)
        .where(gte(users.lastLogin, todayStart));

      // Active merchants
      const activeMerchants = await db.select({ count: sql<number>`COUNT(*)` })
        .from(merchants)
        .where(eq(merchants.status, "active"));

      // This week's trend
      const weekTrend = await db.select({
        date: sql<string>`DATE(created_at)`,
        orders: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(total_amount), 0)`,
      })
        .from(orders)
        .where(gte(orders.createdAt, weekAgo))
        .groupBy(sql`DATE(created_at)`)
        .orderBy(sql`DATE(created_at)`);

      // Top products today
      const topProducts = await db.select({
        productId: orders.productId,
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(total_amount), 0)`,
      })
        .from(orders)
        .where(gte(orders.createdAt, todayStart))
        .groupBy(orders.productId)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(5);

      return {
        live: {
          onlineUsers: Number(activeUsers[0]?.count) || 0,
          todayOrders: Number(todayOrders[0]?.count) || 0,
          todayRevenue: Number(todayOrders[0]?.revenue) || 0,
          activeMerchants: Number(activeMerchants[0]?.count) || 0,
        },
        weekTrend,
        topProducts,
        timestamp: Date.now(),
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  MERCHANT ANALYTICS — Per-merchant dashboard
   * ════════════════════════════════════════════════════════════*/
  merchant: authedQuery
    .input(z.object({
      merchantId: z.number(),
      period: z.enum(["today", "week", "month", "year"]).default("month"),
    }))
    .query(async ({ input }) => {
      const periods = {
        today: new Date(Date.now() - 24 * 60 * 60 * 1000),
        week: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        month: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        year: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      };
      const start = periods[input.period];

      // Orders stats
      const orderStats = await db.select({
        totalOrders: sql<number>`COUNT(*)`,
        totalRevenue: sql<number>`COALESCE(SUM(total_amount), 0)`,
        avgOrderValue: sql<number>`COALESCE(AVG(total_amount), 0)`,
        completedOrders: sql<number>`SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END)`,
        cancelledOrders: sql<number>`SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)`,
      })
        .from(orders)
        .where(
          and(
            eq(orders.merchantId, input.merchantId),
            gte(orders.createdAt, start),
          )
        );

      // Daily breakdown
      const daily = await db.select({
        date: sql<string>`DATE(created_at)`,
        orders: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(total_amount), 0)`,
      })
        .from(orders)
        .where(
          and(
            eq(orders.merchantId, input.merchantId),
            gte(orders.createdAt, start),
          )
        )
        .groupBy(sql`DATE(created_at)`)
        .orderBy(sql`DATE(created_at)`);

      // Product performance
      const productPerformance = await db.select({
        productId: orders.productId,
        orderCount: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(total_amount), 0)`,
      })
        .from(orders)
        .where(
          and(
            eq(orders.merchantId, input.merchantId),
            gte(orders.createdAt, start),
          )
        )
        .groupBy(orders.productId)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(10);

      const stats = orderStats[0];
      return {
        summary: {
          totalOrders: Number(stats.totalOrders),
          totalRevenue: Number(stats.totalRevenue),
          avgOrderValue: Math.round(Number(stats.avgOrderValue) * 100) / 100,
          completionRate: stats.totalOrders > 0
            ? Math.round((Number(stats.completedOrders) / Number(stats.totalOrders)) * 100)
            : 0,
          cancellationRate: stats.totalOrders > 0
            ? Math.round((Number(stats.cancelledOrders) / Number(stats.totalOrders)) * 100)
            : 0,
        },
        daily,
        productPerformance,
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  TRACK EVENT — Record analytics event
   * ════════════════════════════════════════════════════════════*/
  track: authedQuery
    .input(z.object({
      eventType: z.enum([
        "page_view", "product_view", "add_to_cart", "checkout_start",
        "purchase", "search", "ad_click", "ad_impression", "bubble_open",
        "chat_start", "agent_use", "error", "custom",
      ]),
      entityType: z.enum(["user", "merchant", "product", "order", "ad", "platform", "agent"]),
      entityId: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      await db.insert(agentLogs).values({
        agentType: input.eventType,
        status: "completed",
        input: JSON.stringify({ entityType: input.entityType, entityId: input.entityId }),
        output: JSON.stringify(input.metadata),
        marketCode: input.marketCode,
        latency: 0,
        tokensUsed: 0,
      });

      return { success: true };
    }),

  /** ════════════════════════════════════════════════════════════
   *  CONVERSION FUNNEL — Track user journey
   * ════════════════════════════════════════════════════════════*/
  funnel: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
      period: z.enum(["week", "month"]).default("month"),
    }))
    .query(async ({ input }) => {
      const start = new Date(Date.now() - (input.period === "week" ? 7 : 30) * 24 * 60 * 60 * 1000);

      // Search → Product View → Add to Cart → Checkout → Purchase
      const searches = await db.select({ count: sql<number>`COUNT(*)` })
        .from(agentLogs)
        .where(
          and(
            eq(agentLogs.agentType, "search"),
            gte(agentLogs.createdAt, start),
          )
        );

      const productViews = await db.select({ count: sql<number>`COUNT(*)` })
        .from(agentLogs)
        .where(
          and(
            eq(agentLogs.agentType, "product_view"),
            gte(agentLogs.createdAt, start),
          )
        );

      const addToCarts = await db.select({ count: sql<number>`COUNT(*)` })
        .from(agentLogs)
        .where(
          and(
            eq(agentLogs.agentType, "add_to_cart"),
            gte(agentLogs.createdAt, start),
          )
        );

      const purchases = await db.select({ count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(gte(orders.createdAt, start));

      return {
        funnel: [
          { stage: "البحث", count: Number(searches[0]?.count) || 0 },
          { stage: "عرض المنتج", count: Number(productViews[0]?.count) || 0 },
          { stage: "إضافة للسلة", count: Number(addToCarts[0]?.count) || 0 },
          { stage: "الشراء", count: Number(purchases[0]?.count) || 0 },
        ],
        conversionRate: Number(searches[0]?.count) > 0
          ? Math.round((Number(purchases[0]?.count) / Number(searches[0]?.count)) * 10000) / 100
          : 0,
      };
    }),
});
