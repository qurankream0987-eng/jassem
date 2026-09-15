import { z } from "zod";
import { router, authedQuery } from "../trpc";
import { db } from "@db/queries/connection";
import { aggregatorPlatforms, aggregatorVendors, orders, payments } from "@db/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           COMMISSION & PAYOUT ENGINE                         ║
 * ║  Automatic commission calculation and vendor payouts          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Flow:
 * 1. Order completed on aggregator platform
 * 2. Commission % calculated from platform settings
 * 3. Split: Vendor (85-90%) + Platform Owner (5-10%) + JASIM (2.5-5%)
 * 4. Payout queued for vendor
 * 5. Auto-transfer on scheduled date
 */

export const commissionsRouter = router({
  /** ════════════════════════════════════════════════════════════
   *  CALCULATE ORDER SPLIT — When order completes
   * ════════════════════════════════════════════════════════════*/
  calculateSplit: authedQuery
    .input(z.object({
      orderId: z.number(),
      platformId: z.number(),
      vendorId: z.number(),
      orderTotal: z.number(), // in fils/smallest currency unit
    }))
    .mutation(async ({ input }) => {
      // Get platform commission settings
      const [platform] = await db.select()
        .from(aggregatorPlatforms)
        .where(eq(aggregatorPlatforms.id, input.platformId))
        .limit(1);

      if (!platform) throw new Error("Platform not found");

      const globalRate = platform.commissionGlobal || 0.10; // 10% default

      // Get vendor-specific commission rate
      const [vendor] = await db.select()
        .from(aggregatorVendors)
        .where(eq(aggregatorVendors.id, input.vendorId))
        .limit(1);

      const vendorRate = vendor?.commissionRate || globalRate;

      // Calculate splits
      const totalAmount = input.orderTotal;
      const platformCommission = Math.round(totalAmount * vendorRate);
      const jasimFee = Math.round(totalAmount * 0.025); // 2.5% JASIM platform fee
      const vendorPayout = totalAmount - platformCommission - jasimFee;

      // Store the split record
      const [split] = await db.insert(commissionSplits).values({
        orderId: input.orderId,
        platformId: input.platformId,
        vendorId: input.vendorId,
        totalAmount,
        vendorPayout,
        platformCommission,
        jasimFee,
        status: "pending",
        payoutDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days hold
      }).$returningId();

      return {
        success: true,
        splitId: split.id,
        breakdown: {
          total: totalAmount / 1000, // convert back to main currency
          vendor: vendorPayout / 1000,
          platform: platformCommission / 1000,
          jasim: jasimFee / 1000,
        },
        rates: {
          vendor: vendorRate,
          jasim: 0.025,
        },
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  GET VENDOR PAYOUTS — List all pending/completed payouts
   * ════════════════════════════════════════════════════════════*/
  getVendorPayouts: authedQuery
    .input(z.object({
      vendorId: z.number(),
      status: z.enum(["pending", "ready", "processing", "completed", "failed", "all"]).default("all"),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(commissionSplits.vendorId, input.vendorId)];
      if (input.status !== "all") {
        conditions.push(eq(commissionSplits.status, input.status));
      }

      const payouts = await db.select()
        .from(commissionSplits)
        .where(and(...conditions))
        .orderBy(desc(commissionSplits.createdAt))
        .limit(input.limit);

      // Calculate totals
      const totalPending = payouts
        .filter((p) => p.status === "pending" || p.status === "ready")
        .reduce((sum, p) => sum + p.vendorPayout, 0);

      const totalPaid = payouts
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + p.vendorPayout, 0);

      return {
        payouts,
        summary: {
          totalPending: totalPending / 1000,
          totalPaid: totalPaid / 1000,
          totalOrders: payouts.length,
        },
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  PROCESS PAYOUT — Transfer funds to vendor
   * ════════════════════════════════════════════════════════════*/
  processPayout: authedQuery
    .input(z.object({
      splitId: z.number(),
      paymentMethod: z.enum(["bank_transfer", "knet", "paypal", "crypto"]).default("bank_transfer"),
    }))
    .mutation(async ({ input }) => {
      const [split] = await db.select()
        .from(commissionSplits)
        .where(eq(commissionSplits.id, input.splitId))
        .limit(1);

      if (!split) throw new Error("Split not found");
      if (split.status !== "ready" && split.status !== "pending") {
        throw new Error(`Cannot process payout with status: ${split.status}`);
      }

      // Mark as processing
      await db.update(commissionSplits)
        .set({ status: "processing" })
        .where(eq(commissionSplits.id, input.splitId));

      // TODO: Integrate with actual payment gateway
      // For now, mark as completed (manual process)
      await db.update(commissionSplits)
        .set({
          status: "completed",
          processedAt: new Date(),
          paymentMethod: input.paymentMethod,
          transactionRef: `PAYOUT_${Date.now()}`,
        })
        .where(eq(commissionSplits.id, input.splitId));

      return {
        success: true,
        amount: split.vendorPayout / 1000,
        method: input.paymentMethod,
        ref: `PAYOUT_${Date.now()}`,
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  GET PLATFORM REVENUE — Owner's dashboard
   * ════════════════════════════════════════════════════════════*/
  getPlatformRevenue: authedQuery
    .input(z.object({
      platformId: z.number(),
      period: z.enum(["today", "week", "month", "quarter", "year"]).default("month"),
    }))
    .query(async ({ input }) => {
      // Get all splits for this platform
      const splits = await db.select()
        .from(commissionSplits)
        .where(eq(commissionSplits.platformId, input.platformId));

      const totalCommission = splits.reduce((s, r) => s + r.platformCommission, 0);
      const totalJasimFee = splits.reduce((s, r) => s + r.jasimFee, 0);
      const totalVendorPayout = splits.reduce((s, r) => s + r.vendorPayout, 0);
      const totalVolume = splits.reduce((s, r) => s + r.totalAmount, 0);

      // Top vendors by revenue
      const vendorRevenue = await db.select({
        vendorId: commissionSplits.vendorId,
        totalSales: sql<number>`SUM(${commissionSplits.totalAmount})`,
        totalPayout: sql<number>`SUM(${commissionSplits.vendorPayout})`,
        orderCount: sql<number>`COUNT(*)`,
      })
        .from(commissionSplits)
        .where(eq(commissionSplits.platformId, input.platformId))
        .groupBy(commissionSplits.vendorId)
        .orderBy(desc(sql`SUM(${commissionSplits.totalAmount})`))
        .limit(10);

      return {
        summary: {
          totalVolume: totalVolume / 1000,
          platformCommission: totalCommission / 1000,
          jasimFees: totalJasimFee / 1000,
          vendorPayouts: totalVendorPayout / 1000,
          totalOrders: splits.length,
          avgOrderValue: splits.length > 0 ? Math.round((totalVolume / splits.length)) / 1000 : 0,
        },
        vendorBreakdown: vendorRevenue.map((v) => ({
          ...v,
          totalSales: v.totalSales / 1000,
          totalPayout: v.totalPayout / 1000,
        })),
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  BATCH PROCESS — Process all ready payouts (daily cron)
   * ════════════════════════════════════════════════════════════*/
  batchProcess: authedQuery
    .mutation(async () => {
      const readyPayouts = await db.select()
        .from(commissionSplits)
        .where(
          and(
            eq(commissionSplits.status, "ready"),
            gte(commissionSplits.payoutDate, new Date()),
          )
        );

      const results = [];
      for (const payout of readyPayouts) {
        try {
          // Process each payout
          await db.update(commissionSplits)
            .set({
              status: "completed",
              processedAt: new Date(),
              transactionRef: `BATCH_${Date.now()}_${payout.id}`,
            })
            .where(eq(commissionSplits.id, payout.id));

          results.push({ splitId: payout.id, status: "completed" });
        } catch (err) {
          results.push({ splitId: payout.id, status: "failed", error: err.message });
        }
      }

      return {
        processed: results.length,
        results,
      };
    }),
});

// Commission splits table (would need to be added to schema.ts)
export const commissionSplits = db.table("commission_splits", {
  id: serial("id").primaryKey(),
  orderId: int("order_id").notNull(),
  platformId: int("platform_id").notNull(),
  vendorId: int("vendor_id").notNull(),
  totalAmount: int("total_amount").notNull(), // in fils/smallest unit
  vendorPayout: int("vendor_payout").notNull(),
  platformCommission: int("platform_commission").notNull(),
  jasimFee: int("jasim_fee").notNull(),
  status: varchar("status", { length: 20 }).default("pending"), // pending, ready, processing, completed, failed
  payoutDate: timestamp("payout_date"),
  processedAt: timestamp("processed_at"),
  paymentMethod: varchar("payment_method", { length: 20 }),
  transactionRef: varchar("transaction_ref", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});
