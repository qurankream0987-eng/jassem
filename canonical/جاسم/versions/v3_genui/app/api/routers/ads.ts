import { z } from "zod";
import { router, publicQuery, authedQuery } from "../trpc";
import { db } from "@db/queries/connection";
import { ads, merchants, products, orders } from "@db/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";

/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║           INTENT ADS AUCTION ENGINE                          ║
 * ║  Real-time ad auction triggered by user search intent         ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * How it works:
 * 1. User searches for "كبسة"
 * 2. System finds active ads targeting "food" category in "KW" market
 * 3. Ads enter real-time auction (bid price × relevance score)
 * 4. Top 3 ads are returned as "Sponsored" bubbles
 * 5. Winner pays only on click (CPC model)
 */

export const adsRouter = router({
  /** ════════════════════════════════════════════════════════════
   *  CREATE AD — Merchant creates an intent-targeted ad
   * ════════════════════════════════════════════════════════════*/
  create: authedQuery
    .input(z.object({
      merchantId: z.number(),
      title: z.string().min(1).max(100),
      content: z.string().max(500).optional(),
      imageUrl: z.string().optional(),
      targetMarket: z.string().length(2).default("KW"),
      targetCategory: z.string(), // "food", "fashion", "auto_repair", etc.
      targetKeywords: z.array(z.string()), // ["كبسة", "برياني", "مندي"]
      bidAmount: z.number().min(0.1).max(100), // max bid per click in market currency
      dailyBudget: z.number().min(1).max(10000),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [ad] = await db.insert(ads).values({
        merchantId: input.merchantId,
        title: input.title,
        content: input.content || null,
        imageUrl: input.imageUrl || null,
        targetMarket: input.targetMarket,
        // Store targeting as JSON
        targeting: JSON.stringify({
          category: input.targetCategory,
          keywords: input.targetKeywords,
          bidAmount: input.bidAmount,
          dailyBudget: input.dailyBudget,
        }),
        budget: input.dailyBudget,
        spent: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        status: "active",
        startDate: input.startDate ? new Date(input.startDate) : new Date(),
        endDate: input.endDate ? new Date(input.endDate) : null,
      }).$returningId();

      return { success: true, adId: ad.id };
    }),

  /** ════════════════════════════════════════════════════════════
   *  INTENT AUCTION — Real-time ad auction on user search
   * ════════════════════════════════════════════════════════════
   *
   * Algorithm: Ad Rank = Bid × Quality Score
   * Quality Score = relevance(60%) + merchant_rating(25%) + ctr_history(15%)
   */
  intentAuction: publicQuery
    .input(z.object({
      query: z.string(),
      marketCode: z.string().length(2).default("KW"),
      category: z.string().optional(),
      userId: z.number().optional(),
      limit: z.number().min(1).max(5).default(3),
    }))
    .query(async ({ input }) => {
      const { query, marketCode, category, limit } = input;

      // Step 1: Find all active ads for this market
      const activeAds = await db.select({
        id: ads.id,
        merchantId: ads.merchantId,
        title: ads.title,
        content: ads.content,
        imageUrl: ads.imageUrl,
        targeting: ads.targeting,
        budget: ads.budget,
        spent: ads.spent,
        impressions: ads.impressions,
        clicks: ads.clicks,
      })
        .from(ads)
        .where(
          and(
            eq(ads.status, "active"),
            eq(ads.targetMarket, marketCode),
            gte(ads.budget, sql`${ads.spent} + 0.1`), // has remaining budget
          )
        );

      // Step 2: Score each ad for relevance to query
      const scoredAds = activeAds.map((ad) => {
        const targeting = JSON.parse(ad.targeting || "{}");
        const keywords: string[] = targeting.keywords || [];
        const bidAmount: number = targeting.bidAmount || 1;
        const adCategory: string = targeting.category || "";

        // Relevance score (0-100)
        let relevanceScore = 0;

        // Exact keyword match (highest weight)
        const queryWords = query.toLowerCase().split(/\s+/);
        for (const kw of keywords) {
          for (const qw of queryWords) {
            if (kw.toLowerCase().includes(qw) || qw.includes(kw.toLowerCase())) {
              relevanceScore += 40;
            }
          }
        }

        // Category match
        if (category && adCategory === category) {
          relevanceScore += 30;
        }

        // CTR history (click-through rate)
        const ctr = ad.impressions > 0 ? ad.clicks / ad.impressions : 0.05;
        const ctrScore = Math.min(ctr * 100, 30); // max 30 points

        // Cap at 100
        relevanceScore = Math.min(relevanceScore + ctrScore, 100);

        // Calculate Ad Rank = Bid × Quality Score
        const qualityScore = relevanceScore / 100;
        const adRank = bidAmount * qualityScore;

        // Calculate actual CPC (second-price auction: pay $0.01 more than next bidder)
        // Simplified: pay 70% of bid
        const estimatedCpc = bidAmount * 0.7;

        return {
          adId: ad.id,
          merchantId: ad.merchantId,
          title: ad.title,
          content: ad.content,
          imageUrl: ad.imageUrl,
          relevanceScore: Math.round(relevanceScore),
          bidAmount,
          adRank: Math.round(adRank * 100) / 100,
          estimatedCpc: Math.round(estimatedCpc * 100) / 100,
          keywords,
          category: adCategory,
        };
      });

      // Step 3: Sort by Ad Rank and take top N
      const winners = scoredAds
        .filter((ad) => ad.relevanceScore > 10) // minimum relevance threshold
        .sort((a, b) => b.adRank - a.adRank)
        .slice(0, limit);

      // Step 4: Increment impressions for winning ads
      for (const winner of winners) {
        await db.update(ads)
          .set({
            impressions: sql`${ads.impressions} + 1`,
          })
          .where(eq(ads.id, winner.adId));
      }

      return {
        query,
        marketCode,
        auctionId: `auc_${Date.now()}`,
        winners,
        totalParticipants: activeAds.length,
        auctionTimeMs: Date.now(),
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  RECORD CLICK — Track when user clicks an ad
   * ════════════════════════════════════════════════════════════*/
  recordClick: publicQuery
    .input(z.object({
      adId: z.number(),
      auctionId: z.string().optional(),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      // Increment clicks and spent
      await db.update(ads)
        .set({
          clicks: sql`${ads.clicks} + 1`,
          // spent: sql`${ads.spent} + ${}`, // Would need actual CPC from auction
        })
        .where(eq(ads.id, input.adId));

      return { success: true };
    }),

  /** ════════════════════════════════════════════════════════════
   *  RECORD CONVERSION — Track when ad leads to order
   * ════════════════════════════════════════════════════════════*/
  recordConversion: authedQuery
    .input(z.object({
      adId: z.number(),
      orderId: z.number(),
      conversionValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.update(ads)
        .set({
          conversions: sql`${ads.conversions} + 1`,
        })
        .where(eq(ads.id, input.adId));

      return { success: true };
    }),

  /** ════════════════════════════════════════════════════════════
   *  LIST MY ADS — Merchant views their ads
   * ════════════════════════════════════════════════════════════*/
  listMyAds: authedQuery
    .input(z.object({
      merchantId: z.number(),
      status: z.enum(["active", "paused", "ended", "all"]).default("all"),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(ads.merchantId, input.merchantId)];
      if (input.status !== "all") {
        conditions.push(eq(ads.status, input.status));
      }

      const myAds = await db.select()
        .from(ads)
        .where(and(...conditions))
        .orderBy(desc(ads.createdAt));

      return myAds.map((ad) => ({
        ...ad,
        targeting: JSON.parse(ad.targeting || "{}"),
        roi: ad.spent > 0 ? ((ad.conversions * 100) / ad.spent) : 0,
      }));
    }),

  /** ════════════════════════════════════════════════════════════
   *  UPDATE AD — Edit ad settings
   * ════════════════════════════════════════════════════════════*/
  update: authedQuery
    .input(z.object({
      adId: z.number(),
      title: z.string().optional(),
      content: z.string().optional(),
      bidAmount: z.number().optional(),
      dailyBudget: z.number().optional(),
      status: z.enum(["active", "paused", "ended"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { adId, ...updates } = input;
      await db.update(ads).set(updates).where(eq(ads.id, adId));
      return { success: true };
    }),

  /** ════════════════════════════════════════════════════════════
   *  GET AD PERFORMANCE — Analytics for an ad
   * ════════════════════════════════════════════════════════════*/
  getPerformance: authedQuery
    .input(z.object({ adId: z.number() }))
    .query(async ({ input }) => {
      const [ad] = await db.select()
        .from(ads)
        .where(eq(ads.id, input.adId))
        .limit(1);

      if (!ad) return null;

      const ctr = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
      const cvr = ad.clicks > 0 ? (ad.conversions / ad.clicks) * 100 : 0;
      const roi = ad.spent > 0 ? ((ad.conversions * 100) - ad.spent) / ad.spent * 100 : 0;

      return {
        ...ad,
        targeting: JSON.parse(ad.targeting || "{}"),
        metrics: {
          impressions: ad.impressions,
          clicks: ad.clicks,
          conversions: ad.conversions,
          spent: ad.spent,
          budget: ad.budget,
          ctr: Math.round(ctr * 100) / 100,
          cvr: Math.round(cvr * 100) / 100,
          cpc: ad.clicks > 0 ? Math.round((ad.spent / ad.clicks) * 100) / 100 : 0,
          roi: Math.round(roi * 100) / 100,
          remainingBudget: Math.round((ad.budget - ad.spent) * 100) / 100,
        },
      };
    }),

  /** ════════════════════════════════════════════════════════════
   *  GET DASHBOARD — Admin/merchant analytics dashboard
   * ════════════════════════════════════════════════════════════*/
  getDashboard: authedQuery
    .input(z.object({
      merchantId: z.number().optional(),
      marketCode: z.string().optional(),
      period: z.enum(["today", "week", "month", "all"]).default("month"),
    }))
    .query(async ({ input }) => {
      // Aggregate stats
      const stats = await db.select({
        totalAds: sql<number>`COUNT(*)`,
        activeAds: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
        totalImpressions: sql<number>`SUM(impressions)`,
        totalClicks: sql<number>`SUM(clicks)`,
        totalConversions: sql<number>`SUM(conversions)`,
        totalSpent: sql<number>`SUM(spent)`,
        totalBudget: sql<number>`SUM(budget)`,
      }).from(ads);

      const s = stats[0];
      const ctr = s.totalImpressions > 0 ? (s.totalClicks / s.totalImpressions) * 100 : 0;

      return {
        overview: {
          totalAds: Number(s.totalAds),
          activeAds: Number(s.activeAds),
          totalImpressions: Number(s.totalImpressions),
          totalClicks: Number(s.totalClicks),
          totalConversions: Number(s.totalConversions),
          totalSpent: Number(s.totalSpent),
          totalBudget: Number(s.totalBudget),
          ctr: Math.round(ctr * 100) / 100,
          avgCpc: s.totalClicks > 0 ? Math.round((Number(s.totalSpent) / Number(s.totalClicks)) * 100) / 100 : 0,
        },
        topAds: await db.select()
          .from(ads)
          .orderBy(desc(ads.conversions))
          .limit(10),
      };
    }),
});
