import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { aggregatorPlatforms, aggregatorVendors, orders, products } from "@db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const genAggregatorRouter = createRouter({
  /** Create a new multi-vendor marketplace platform */
  createPlatform: authedQuery
    .input(z.object({
      ownerId: z.number(),
      name: z.string().min(1).max(255),
      slug: z.string().regex(/^[a-z0-9-]+$/),
      description: z.string().optional(),
      logoUrl: z.string().optional(),
      theme: z.record(z.string()).optional(),
      commissionGlobal: z.number().min(0).max(1).default(0.1),
      vendorApprovalMode: z.enum(["auto", "manual"]).default("manual"),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const [platform] = await db.insert(aggregatorPlatforms).values({
        ownerId: input.ownerId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        logoUrl: input.logoUrl,
        theme: input.theme,
        commissionGlobal: input.commissionGlobal,
        vendorApprovalMode: input.vendorApprovalMode,
        status: "setup",
        marketCode: input.marketCode,
        analyticsSnapshot: { vendors: 0, products: 0, orders: 0, revenue: 0, commission: 0 },
      }).$returningId();

      return { success: true, platformId: platform.id, slug: input.slug };
    }),

  /** Get platform details by ID */
  getPlatform: authedQuery
    .input(z.object({
      platformId: z.number(),
    }))
    .query(async ({ input }) => {
      const [platform] = await db.select().from(aggregatorPlatforms)
        .where(eq(aggregatorPlatforms.id, input.platformId))
        .limit(1);

      if (!platform) return null;

      // Get vendor count
      const vendors = await db.select().from(aggregatorVendors)
        .where(eq(aggregatorVendors.platformId, input.platformId));

      return {
        ...platform,
        vendorCount: vendors.length,
        activeVendors: vendors.filter((v) => v.status === "active").length,
      };
    }),

  /** List all platforms for a user/market */
  listPlatforms: authedQuery
    .input(z.object({
      ownerId: z.number().optional(),
      marketCode: z.string().optional(),
      status: z.enum(["setup", "active", "paused", "closed"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.ownerId) {
        conditions.push(eq(aggregatorPlatforms.ownerId, input.ownerId));
      }
      if (input?.marketCode) {
        conditions.push(eq(aggregatorPlatforms.marketCode, input.marketCode));
      }
      if (input?.status) {
        conditions.push(eq(aggregatorPlatforms.status, input.status));
      }

      const platforms = conditions.length > 0
        ? await db.select().from(aggregatorPlatforms)
            .where(and(...conditions))
            .orderBy(desc(aggregatorPlatforms.createdAt))
            .limit(100)
        : await db.select().from(aggregatorPlatforms)
            .orderBy(desc(aggregatorPlatforms.createdAt))
            .limit(100);

      return platforms;
    }),

  /** Add a vendor to a platform */
  addVendor: authedQuery
    .input(z.object({
      platformId: z.number(),
      merchantId: z.number(),
      commissionRate: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      // Get platform to use default commission if not specified
      const [platform] = await db.select().from(aggregatorPlatforms)
        .where(eq(aggregatorPlatforms.id, input.platformId))
        .limit(1);

      if (!platform) {
        throw new Error("Platform not found");
      }

      const commission = input.commissionRate ?? platform.commissionGlobal;
      const isAutoApproved = platform.vendorApprovalMode === "auto";

      const [vendor] = await db.insert(aggregatorVendors).values({
        platformId: input.platformId,
        merchantId: input.merchantId,
        commissionRate: commission,
        isApproved: isAutoApproved,
        status: isAutoApproved ? "active" : "pending",
        productCount: 0,
        orderCount: 0,
        revenue: 0,
      }).$returningId();

      return {
        success: true,
        vendorId: vendor.id,
        status: isAutoApproved ? "active" : "pending",
      };
    }),

  /** Remove a vendor from a platform */
  removeVendor: authedQuery
    .input(z.object({
      platformId: z.number(),
      vendorId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.update(aggregatorVendors)
        .set({ status: "removed" })
        .where(
          and(
            eq(aggregatorVendors.id, input.vendorId),
            eq(aggregatorVendors.platformId, input.platformId),
          ),
        );
      return { success: true };
    }),

  /** Set commission rules for a platform or vendor */
  setCommission: authedQuery
    .input(z.object({
      platformId: z.number(),
      vendorId: z.number().optional(),
      commissionRate: z.number().min(0).max(1),
      applyGlobal: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      if (input.applyGlobal) {
        await db.update(aggregatorPlatforms)
          .set({ commissionGlobal: input.commissionRate })
          .where(eq(aggregatorPlatforms.id, input.platformId));
        return { success: true, scope: "global", commissionRate: input.commissionRate };
      }

      if (input.vendorId) {
        await db.update(aggregatorVendors)
          .set({ commissionRate: input.commissionRate })
          .where(
            and(
              eq(aggregatorVendors.id, input.vendorId),
              eq(aggregatorVendors.platformId, input.platformId),
            ),
          );
        return { success: true, scope: "vendor", commissionRate: input.commissionRate };
      }

      return { success: false, message: "Either vendorId or applyGlobal must be provided" };
    }),

  /** List vendors on a platform */
  getVendors: authedQuery
    .input(z.object({
      platformId: z.number(),
      status: z.enum(["pending", "active", "suspended", "removed"]).optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(aggregatorVendors.platformId, input.platformId)];
      if (input.status) {
        conditions.push(eq(aggregatorVendors.status, input.status));
      }

      const vendors = conditions.length > 1
        ? await db.select().from(aggregatorVendors)
            .where(and(...conditions))
            .orderBy(desc(aggregatorVendors.revenue))
            .limit(200)
        : await db.select().from(aggregatorVendors)
            .where(eq(aggregatorVendors.platformId, input.platformId))
            .orderBy(desc(aggregatorVendors.revenue))
            .limit(200);

      return vendors;
    }),

  /** Get platform revenue summary */
  getRevenue: authedQuery
    .input(z.object({
      platformId: z.number(),
      period: z.enum(["daily", "weekly", "monthly", "yearly"]).default("monthly"),
    }))
    .query(async ({ input }) => {
      const [platform] = await db.select().from(aggregatorPlatforms)
        .where(eq(aggregatorPlatforms.id, input.platformId))
        .limit(1);

      if (!platform) return null;

      const snapshot = platform.analyticsSnapshot || { vendors: 0, products: 0, orders: 0, revenue: 0, commission: 0 };

      const vendors = await db.select().from(aggregatorVendors)
        .where(
          and(
            eq(aggregatorVendors.platformId, input.platformId),
            eq(aggregatorVendors.status, "active"),
          ),
        );

      const totalRevenue = vendors.reduce((sum, v) => sum + (v.revenue || 0), 0);
      const totalCommission = vendors.reduce(
        (sum, v) => sum + (v.revenue || 0) * (v.commissionRate || platform.commissionGlobal || 0.1),
        0,
      );
      const totalOrders = vendors.reduce((sum, v) => sum + (v.orderCount || 0), 0);
      const totalProducts = vendors.reduce((sum, v) => sum + (v.productCount || 0), 0);

      return {
        platformId: input.platformId,
        name: platform.name,
        period: input.period,
        summary: {
          totalRevenue,
          totalCommission,
          totalOrders,
          totalProducts,
          activeVendors: vendors.length,
          averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
          commissionRate: platform.commissionGlobal,
        },
        vendorBreakdown: vendors.map((v) => ({
          vendorId: v.id,
          merchantId: v.merchantId,
          revenue: v.revenue,
          orderCount: v.orderCount,
          productCount: v.productCount,
          commissionRate: v.commissionRate,
          commissionEarned: (v.revenue || 0) * (v.commissionRate || platform.commissionGlobal || 0.1),
        })),
        historical: snapshot,
      };
    }),
});
