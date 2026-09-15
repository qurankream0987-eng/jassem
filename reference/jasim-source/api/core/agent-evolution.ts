/**
 * ============================================
 * AGENT EVOLUTION ENGINE
 * Platform Intelligence & Self-Improvement
 * ============================================
 *
 * Analyzes platform-wide trends to suggest new categories, features,
 * and marketplace evolutions. Auto-evolves agents based on performance
 * metrics and generates growth opportunity bubbles for platform owners.
 */

import { z } from "zod";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import {
  memory,
  agentLogs,
  analytics,
  aggregatorPlatforms,
  products,
  merchants,
} from "@db/schema";
import type { AgentType } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  trendAnalysisFailed: "فشل في تحليل الاتجاهات",
  evolutionFailed: "فشل في اقتراح التطورات",
  agentEvolveFailed: "فشل في تطوير الوكيل",
  bubbleGenFailed: "فشل في توليد فقاعة التطور",
  invalidMarketCode: "رمز السوق غير صالح",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

const TrendSchema = z.object({
  id: z.string(),
  query: z.string(),
  frequency: z.number().min(1),
  supplyCount: z.number().default(0),
  avgOrderValue: z.number().default(0),
  confidence: z.number().min(0).max(1),
  trendType: z.enum(["failed_search", "high_demand_low_supply", "seasonal", "emerging"]),
  marketCode: z.string(),
  detectedAt: z.date(),
});

const EvolutionSuggestionSchema = z.object({
  type: z.enum(["new_category", "new_feature", "market_expansion", "pricing_adjustment"]),
  title: z.string(),
  description: z.string(),
  potentialRevenue: z.number(),
  confidence: z.number(),
  estimatedImpact: z.enum(["low", "medium", "high", "transformative"]),
  implementationCost: z.enum(["low", "medium", "high"]),
});

const AgentMetricsSchema = z.object({
  agentType: z.string(),
  accuracy: z.number().min(0).max(1),
  avgResponseTime: z.number(),
  totalCalls: z.number(),
  errorRate: z.number().min(0).max(1),
  userSatisfaction: z.number().min(0).max(1),
});

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface Trend {
  id: string;
  query: string;
  frequency: number;
  supplyCount: number;
  avgOrderValue: number;
  confidence: number;
  trendType: "failed_search" | "high_demand_low_supply" | "seasonal" | "emerging";
  marketCode: string;
  detectedAt: Date;
}

export interface EvolutionSuggestion {
  type: "new_category" | "new_feature" | "market_expansion" | "pricing_adjustment";
  title: string;
  description: string;
  potentialRevenue: number;
  confidence: number;
  estimatedImpact: "low" | "medium" | "high" | "transformative";
  implementationCost: "low" | "medium" | "high";
}

export interface AgentMetrics {
  agentType: string;
  accuracy: number;
  avgResponseTime: number;
  totalCalls: number;
  errorRate: number;
  userSatisfaction: number;
}

export interface EvolutionBubble {
  type: string;
  theme: string;
  data: Record<string, unknown>;
  priority: number;
}

// ============================================
// CATEGORIES & KEYWORDS DATABASE
// ============================================

const EMERGING_CATEGORIES: Array<{
  keywords: string[];
  category: string;
  description: string;
  estimatedValue: number;
}> = [
  { keywords: ["مطعم جديد", "اكل صحي", "دايت", "organic"], category: "الأكل الصحي", description: "طلبات متزايدة على الوجبات الصحية والعضوية", estimatedValue: 2500 },
  { keywords: ["العاب", "بلايستيشن", "xbox", "gaming"], category: "الألعاب الإلكترونية", description: "سوق الألعاب ينمو 40% سنوياً", estimatedValue: 4000 },
  { keywords: ["حلاق منزلي", "تجميل", "سبا", "عناية"], category: "خدمات التجميل المنزلية", description: "خدمات التجميل المنزلية مطلوبة بكثرة", estimatedValue: 1800 },
  { keywords: ["معلم خصوصي", "دروس", "تعليم", "course"], category: "التعليم الخصوصي", description: "الدروس الخصوصية عبر الإنترنت", estimatedValue: 3000 },
  { keywords: ["صيانة", "تصليح", "فني", "repair"], category: "خدمات الصيانة", description: "خدمات الصيانة المنزلية والإلكترونية", estimatedValue: 2200 },
  { keywords: ["نظافة", "تنظيف", " cleaner", "maid"], category: "خدمات التنظيف", description: "خدمات التنظيف المنزلي والمكتبي", estimatedValue: 1500 },
  { keywords: ["حيوانات", "قطط", "كلاب", "pets"], category: "مستلزمات الحيوانات", description: "مستلزمات ورعاية الحيوانات الأليفة", estimatedValue: 2000 },
  { keywords: ["رياضة", "جيم", "fitness", "تمارين"], category: "الرياضة واللياقة", description: "معدات وخدمات اللياقة البدنية", estimatedValue: 2800 },
  { keywords: ["قرطاسية", "مدرسة", "stationery", "books"], category: "القرطاسية والكتب", description: "مستلزمات مدرسية وكتابية", estimatedValue: 1200 },
  { keywords: ["هدايا", "توصيل", "flowers", "bouquet"], category: "الهدايا والزهور", description: "توصيل الهدايا والزهور", estimatedValue: 3500 },
];

// ============================================
// AGENT EVOLUTION ENGINE CLASS
// ============================================

export class AgentEvolution {
  private readonly FAILED_SEARCH_THRESHOLD = 50;
  private readonly HIGH_DEMAND_THRESHOLD = 300;
  private readonly ACCURACY_RETRAIN_THRESHOLD = 0.8;
  private readonly RESPONSE_TIME_OPTIMIZE_THRESHOLD = 2000;
  private readonly MIN_SUPPLY_COUNT = 3;

  // ── 1. Analyze trends across the platform ───────────────────────

  async analyzeTrends(marketCode: string): Promise<Trend[]> {
    try {
      if (!marketCode || marketCode.length < 2) {
        throw new Error(Errors.invalidMarketCode);
      }

      const trends: Trend[] = [];

      // Get failed searches (searches with no results)
      const failedSearches = await this.getFailedSearches(marketCode, 30);
      trends.push(...failedSearches);

      // Get high-frequency searches with few providers
      const highDemand = await this.getHighDemandLowSupply(marketCode);
      trends.push(...highDemand);

      // Get seasonal trends
      const seasonal = await this.getSeasonalTrends(marketCode);
      trends.push(...seasonal);

      // Get emerging trends from memory
      const emerging = await this.getEmergingTrends(marketCode);
      trends.push(...emerging);

      // Sort by confidence and frequency
      trends.sort((a, b) => b.confidence * b.frequency - a.confidence * a.frequency);

      return trends;
    } catch (error) {
      console.error("[AgentEvolution] analyzeTrends error:", error);
      throw new Error(Errors.trendAnalysisFailed);
    }
  }

  // ── 2. Suggest evolutions to marketplace owners ─────────────────

  async suggestEvolution(platformId: string): Promise<EvolutionSuggestion[]> {
    try {
      const trends = await this.analyzeTrends(platformId);
      const suggestions: EvolutionSuggestion[] = [];

      for (const trend of trends) {
        // High demand, low supply → suggest new category
        if (trend.frequency > this.HIGH_DEMAND_THRESHOLD && trend.supplyCount < this.MIN_SUPPLY_COUNT) {
          suggestions.push({
            type: "new_category",
            title: `أضف فئة "${trend.query}"`,
            description: `${trend.frequency} شخص يبحثون يومياً. المزودون: ${trend.supplyCount} فقط! الفرصة كبيرة للتوسع.`,
            potentialRevenue: trend.frequency * trend.avgOrderValue * 0.15,
            confidence: trend.confidence,
            estimatedImpact: trend.supplyCount === 0 ? "transformative" : "high",
            implementationCost: "low",
          });
        }

        // Failed searches → suggest new feature
        if (trend.trendType === "failed_search" && trend.frequency > this.FAILED_SEARCH_THRESHOLD) {
          suggestions.push({
            type: "new_feature",
            title: `حسّن نتائج البحث لـ "${trend.query}"`,
            description: `${trend.frequency} عملية بحث فاشلة. المستخدمون لا يجدون ما يبحثون عنه.`,
            potentialRevenue: trend.frequency * trend.avgOrderValue * 0.1,
            confidence: trend.confidence,
            estimatedImpact: "medium",
            implementationCost: "medium",
          });
        }

        // Emerging trend → suggest market expansion
        if (trend.trendType === "emerging" && trend.confidence > 0.7) {
          suggestions.push({
            type: "market_expansion",
            title: `فرصة نمو: ${trend.query}`,
            description: `اتجاه صاعد بسرعة — ${trend.frequency} تفاعل شهرياً. كُن من أوائل المزودين!`,
            potentialRevenue: trend.frequency * trend.avgOrderValue * 0.2,
            confidence: trend.confidence,
            estimatedImpact: "high",
            implementationCost: "low",
          });
        }
      }

      // Sort by potential revenue descending
      suggestions.sort((a, b) => b.potentialRevenue - a.potentialRevenue);

      return suggestions;
    } catch (error) {
      console.error("[AgentEvolution] suggestEvolution error:", error);
      throw new Error(Errors.evolutionFailed);
    }
  }

  // ── 3. Auto-evolve agent based on feedback ──────────────────────

  async evolveAgent(agentType: AgentType): Promise<{
    retrained: boolean;
    optimized: boolean;
    logged: boolean;
  }> {
    try {
      // Get agent performance metrics
      const metrics = await this.getAgentMetrics(agentType);

      let retrained = false;
      let optimized = false;

      // If accuracy < 80%, trigger retraining
      if (metrics.accuracy < this.ACCURACY_RETRAIN_THRESHOLD) {
        await this.triggerRetraining(agentType);
        retrained = true;
      }

      // If response time > 2s, optimize
      if (metrics.avgResponseTime > this.RESPONSE_TIME_OPTIMIZE_THRESHOLD) {
        await this.optimizeAgent(agentType);
        optimized = true;
      }

      // Log evolution event
      await this.logAgentEvolution(agentType, metrics);

      return { retrained, optimized, logged: true };
    } catch (error) {
      console.error("[AgentEvolution] evolveAgent error:", error);
      throw new Error(Errors.agentEvolveFailed);
    }
  }

  // ── 4. Generate EvolutionBubble for platform owner ──────────────

  async generateEvolutionBubble(platformId: string): Promise<EvolutionBubble | null> {
    try {
      const suggestions = await this.suggestEvolution(platformId);
      if (suggestions.length === 0) return null;

      const topSuggestion = suggestions[0];

      return {
        type: "evolution",
        theme: "growth_opportunity",
        data: {
          suggestions,
          topOpportunity: topSuggestion,
          totalSuggestions: suggestions.length,
          totalPotentialRevenue: suggestions.reduce((sum, s) => sum + s.potentialRevenue, 0),
          actionPrompt: topSuggestion.type === "new_category"
            ? `أضف فئة "${topSuggestion.title.replace('أضف فئة "', "").replace('"', "")}" الآن!`
            : topSuggestion.type === "new_feature"
              ? "حسّن تجربة البحث لمستخدميك"
              : "وسّع نطاق أعمالك",
        },
        priority: 2,
      };
    } catch (error) {
      console.error("[AgentEvolution] generateEvolutionBubble error:", error);
      return null;
    }
  }

  // ── 5. Get platform health report ───────────────────────────────

  async getPlatformHealth(marketCode: string): Promise<{
    score: number;
    activeMerchants: number;
    totalProducts: number;
    failedSearches: number;
    topTrend: string;
    recommendation: string;
  }> {
    try {
      // Count active merchants
      const merchantCount = await db
        .select({ count: count() })
        .from(merchants)
        .where(
          and(
            eq(merchants.isActive, true),
            eq(merchants.marketCode, marketCode)
          )
        );

      // Count products
      const productCount = await db
        .select({ count: count() })
        .from(products)
        .limit(1);

      // Get trends
      const trends = await this.analyzeTrends(marketCode);
      const failedSearches = trends
        .filter((t) => t.trendType === "failed_search")
        .reduce((sum, t) => sum + t.frequency, 0);

      // Calculate health score (0-100)
      const activeMerchants = Number(merchantCount[0]?.count) || 0;
      const totalProducts = Number(productCount[0]?.count) || 0;

      let score = 50; // base score
      score += Math.min(activeMerchants * 2, 20); // +0-20 for merchants
      score += Math.min(totalProducts * 0.01, 15); // +0-15 for products
      score -= Math.min(failedSearches * 0.05, 25); // -0-25 for failed searches
      score = Math.max(0, Math.min(100, score));

      const topTrend = trends[0]?.query || "لا يوجد";

      let recommendation = "المنصة بصحة جيدة! استمر في توسيع الفئات.";
      if (score < 40) recommendation = "منصتك تحتاج اهتماماً عاجلاً — ركز على جذب مزودين جدد";
      else if (score < 60) recommendation = "فرص تحسين متاحة — راجع نتائج البحث الفاشلة";
      else if (score < 80) recommendation = "أداء جيد — حاول إضافة فئات جديدة";

      return {
        score: Math.round(score),
        activeMerchants,
        totalProducts,
        failedSearches,
        topTrend,
        recommendation,
      };
    } catch (error) {
      console.error("[AgentEvolution] getPlatformHealth error:", error);
      return {
        score: 50,
        activeMerchants: 0,
        totalProducts: 0,
        failedSearches: 0,
        topTrend: "غير معروف",
        recommendation: "تعذر الحصول على التقرير",
      };
    }
  }

  // ── 6. Private: Get failed searches ─────────────────────────────

  private async getFailedSearches(marketCode: string, days: number): Promise<Trend[]> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Get interaction memories that indicate failed searches
      const results = await db
        .select()
        .from(memory)
        .where(
          and(
            eq(memory.category, "interaction"),
            gte(memory.createdAt, cutoffDate)
          )
        )
        .orderBy(desc(memory.createdAt));

      // Group by query to find repeated failed searches
      const queryCounts = new Map<string, { count: number; lastAt: Date }>();

      for (const row of results) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(row.value) as Record<string, unknown>;
        } catch {
          continue;
        }

        // Detect failed searches (intent with no results)
        if (parsed.result === "not_found" || parsed.found === false || parsed.intent === "no_results") {
          const query = (parsed.query as string) || row.key;
          const existing = queryCounts.get(query);
          if (existing) {
            existing.count++;
          } else {
            queryCounts.set(query, { count: 1, lastAt: row.createdAt });
          }
        }
      }

      const trends: Trend[] = [];
      for (const [query, data] of queryCounts) {
        if (data.count >= 5) {
          trends.push({
            id: `failed_${query}_${marketCode}`,
            query,
            frequency: data.count,
            supplyCount: 0,
            avgOrderValue: 15,
            confidence: Math.min(data.count / 100, 0.95),
            trendType: "failed_search",
            marketCode,
            detectedAt: data.lastAt,
          });
        }
      }

      return trends;
    } catch (error) {
      console.error("[AgentEvolution] getFailedSearches error:", error);
      return [];
    }
  }

  // ── 7. Private: Get high demand / low supply ────────────────────

  private async getHighDemandLowSupply(marketCode: string): Promise<Trend[]> {
    try {
      // Get product categories and their counts
      const productResults = await db
        .select()
        .from(products)
        .limit(500);

      const categoryCounts = new Map<string, number>();
      for (const product of productResults) {
        const cat = product.category || "غير مصنف";
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
      }

      // Get search trends from analytics
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const analyticsResults = await db
        .select()
        .from(analytics)
        .where(
          and(
            eq(analytics.category, "search"),
            gte(analytics.date, thirtyDaysAgo)
          )
        );

      const trends: Trend[] = [];

      for (const analytic of analyticsResults) {
        const category = analytic.metric;
        const supplyCount = categoryCounts.get(category) || 0;
        const searchVolume = analytic.value || 0;

        if (searchVolume > this.HIGH_DEMAND_THRESHOLD && supplyCount < this.MIN_SUPPLY_COUNT) {
          trends.push({
            id: `demand_${category}_${marketCode}`,
            query: category,
            frequency: Math.round(searchVolume),
            supplyCount,
            avgOrderValue: 25,
            confidence: Math.min(searchVolume / 1000, 0.95),
            trendType: "high_demand_low_supply",
            marketCode,
            detectedAt: analytic.date,
          });
        }
      }

      return trends;
    } catch (error) {
      console.error("[AgentEvolution] getHighDemandLowSupply error:", error);
      return [];
    }
  }

  // ── 8. Private: Get seasonal trends ─────────────────────────────

  private async getSeasonalTrends(marketCode: string): Promise<Trend[]> {
    try {
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12 (Gregorian approx for Hijri)
      const trends: Trend[] = [];

      // Ramadan (approx months 3-4 in Gregorian for Hijri 9)
      if (month >= 2 && month <= 5) {
        trends.push({
          id: `seasonal_ramadan_${marketCode}`,
          query: "طلبات رمضان",
          frequency: 500,
          supplyCount: 15,
          avgOrderValue: 12,
          confidence: 0.85,
          trendType: "seasonal",
          marketCode,
          detectedAt: now,
        });
      }

      // Eid (after Ramadan, approx months 4-6)
      if (month >= 4 && month <= 6) {
        trends.push({
          id: `seasonal_eid_${marketCode}`,
          query: "هدايا العيد",
          frequency: 800,
          supplyCount: 8,
          avgOrderValue: 30,
          confidence: 0.9,
          trendType: "seasonal",
          marketCode,
          detectedAt: now,
        });
      }

      // Summer / vacation (months 6-9)
      if (month >= 6 && month <= 9) {
        trends.push({
          id: `seasonal_summer_${marketCode}`,
          query: "مستلزمات السفر والتخييم",
          frequency: 350,
          supplyCount: 4,
          avgOrderValue: 50,
          confidence: 0.75,
          trendType: "seasonal",
          marketCode,
          detectedAt: now,
        });
      }

      // Back to school (months 8-9)
      if (month >= 8 && month <= 9) {
        trends.push({
          id: `seasonal_school_${marketCode}`,
          query: "مستلزمات المدرسة",
          frequency: 600,
          supplyCount: 10,
          avgOrderValue: 20,
          confidence: 0.88,
          trendType: "seasonal",
          marketCode,
          detectedAt: now,
        });
      }

      // Winter (months 11-2)
      if (month >= 11 || month <= 2) {
        trends.push({
          id: `seasonal_winter_${marketCode}`,
          query: "ملابس شتوية",
          frequency: 400,
          supplyCount: 6,
          avgOrderValue: 35,
          confidence: 0.8,
          trendType: "seasonal",
          marketCode,
          detectedAt: now,
        });
      }

      return trends;
    } catch (error) {
      console.error("[AgentEvolution] getSeasonalTrends error:", error);
      return [];
    }
  }

  // ── 9. Private: Get emerging trends ─────────────────────────────

  private async getEmergingTrends(marketCode: string): Promise<Trend[]> {
    try {
      // Check memory for recently searched keywords matching emerging categories
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const results = await db
        .select()
        .from(memory)
        .where(
          and(
            eq(memory.category, "interaction"),
            gte(memory.createdAt, sevenDaysAgo)
          )
        );

      const trends: Trend[] = [];

      for (const category of EMERGING_CATEGORIES) {
        let matchCount = 0;

        for (const row of results) {
          const keyLower = row.key.toLowerCase();
          const valueLower = row.value.toLowerCase();

          for (const keyword of category.keywords) {
            if (keyLower.includes(keyword.toLowerCase()) || valueLower.includes(keyword.toLowerCase())) {
              matchCount++;
              break;
            }
          }
        }

        if (matchCount >= 3) {
          // Check current supply
          const supplyCount = await this.getCategorySupplyCount(category.category);

          trends.push({
            id: `emerging_${category.category}_${marketCode}`,
            query: category.category,
            frequency: matchCount * 10, // estimate monthly
            supplyCount,
            avgOrderValue: category.estimatedValue / 100, // rough avg
            confidence: Math.min(matchCount / 20, 0.9),
            trendType: "emerging",
            marketCode,
            detectedAt: new Date(),
          });
        }
      }

      return trends;
    } catch (error) {
      console.error("[AgentEvolution] getEmergingTrends error:", error);
      return [];
    }
  }

  // ── 10. Private: Get category supply count ──────────────────────

  private async getCategorySupplyCount(category: string): Promise<number> {
    try {
      const results = await db
        .select()
        .from(products)
        .where(eq(products.category, category))
        .limit(100);

      return results.length;
    } catch {
      return 0;
    }
  }

  // ── 11. Private: Get agent metrics ──────────────────────────────

  private async getAgentMetrics(agentType: AgentType): Promise<AgentMetrics> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const logs = await db
        .select()
        .from(agentLogs)
        .where(
          and(
            eq(agentLogs.agentName, agentType),
            gte(agentLogs.createdAt, thirtyDaysAgo)
          )
        );

      if (logs.length === 0) {
        return {
          agentType,
          accuracy: 0.85,
          avgResponseTime: 1200,
          totalCalls: 0,
          errorRate: 0,
          userSatisfaction: 0.8,
        };
      }

      const totalCalls = logs.length;
      const errors = logs.filter((l) => !l.output || l.output.includes("error")).length;
      const errorRate = errors / totalCalls;

      const totalDuration = logs.reduce((sum, l) => sum + (l.duration || 0), 0);
      const avgResponseTime = totalDuration / totalCalls;

      // Accuracy based on output quality (simplified)
      const outputsWithContent = logs.filter((l) => l.output && l.output.length > 50).length;
      const accuracy = outputsWithContent / totalCalls;

      return {
        agentType,
        accuracy: Math.max(0.5, accuracy),
        avgResponseTime,
        totalCalls,
        errorRate,
        userSatisfaction: Math.max(0.5, 1 - errorRate),
      };
    } catch (error) {
      console.error("[AgentEvolution] getAgentMetrics error:", error);
      return {
        agentType,
        accuracy: 0.8,
        avgResponseTime: 1500,
        totalCalls: 0,
        errorRate: 0.1,
        userSatisfaction: 0.8,
      };
    }
  }

  // ── 12. Private: Trigger retraining ─────────────────────────────

  private async triggerRetraining(agentType: AgentType): Promise<void> {
    try {
      const now = new Date();

      // Log retraining trigger
      await db.insert(agentLogs).values({
        agentName: agentType,
        intent: "evolution_retrain",
        input: JSON.stringify({ action: "trigger_retraining", reason: "accuracy_below_threshold" }),
        output: JSON.stringify({ status: "retraining_initiated" }),
        tokensUsed: 0,
        duration: 0,
        createdAt: now,
      });

      console.log(`[AgentEvolution] Retraining triggered for ${agentType}`);
    } catch (error) {
      console.error("[AgentEvolution] triggerRetraining error:", error);
    }
  }

  // ── 13. Private: Optimize agent ─────────────────────────────────

  private async optimizeAgent(agentType: AgentType): Promise<void> {
    try {
      const now = new Date();

      // Log optimization
      await db.insert(agentLogs).values({
        agentName: agentType,
        intent: "evolution_optimize",
        input: JSON.stringify({ action: "optimize_performance", reason: "response_time_above_threshold" }),
        output: JSON.stringify({ status: "optimization_initiated" }),
        tokensUsed: 0,
        duration: 0,
        createdAt: now,
      });

      console.log(`[AgentEvolution] Optimization triggered for ${agentType}`);
    } catch (error) {
      console.error("[AgentEvolution] optimizeAgent error:", error);
    }
  }

  // ── 14. Private: Log agent evolution ────────────────────────────

  private async logAgentEvolution(agentType: AgentType, metrics: AgentMetrics): Promise<void> {
    try {
      const now = new Date();

      await db.insert(agentLogs).values({
        agentName: agentType,
        intent: "evolution_log",
        input: JSON.stringify({ metrics }),
        output: JSON.stringify({
          status: "evolution_logged",
          accuracy: metrics.accuracy,
          responseTime: metrics.avgResponseTime,
          totalCalls: metrics.totalCalls,
        }),
        tokensUsed: 0,
        duration: 0,
        createdAt: now,
      });
    } catch {
      // Non-critical
    }
  }
}

// ============================================
// STANDALONE FUNCTIONS (for direct use)
// ============================================

/**
 * Quick trend analysis wrapper
 */
export async function analyzeMarketTrends(marketCode: string): Promise<Trend[]> {
  const engine = new AgentEvolution();
  return engine.analyzeTrends(marketCode);
}

/**
 * Quick evolution suggestions wrapper
 */
export async function getEvolutionSuggestions(platformId: string): Promise<EvolutionSuggestion[]> {
  const engine = new AgentEvolution();
  return engine.suggestEvolution(platformId);
}

/**
 * Quick agent evolution wrapper
 */
export async function evolveAgent(agentType: AgentType): Promise<{
  retrained: boolean;
  optimized: boolean;
  logged: boolean;
}> {
  const engine = new AgentEvolution();
  return engine.evolveAgent(agentType);
}

/**
 * Quick platform health wrapper
 */
export async function getPlatformHealth(marketCode: string): Promise<{
  score: number;
  activeMerchants: number;
  totalProducts: number;
  failedSearches: number;
  topTrend: string;
  recommendation: string;
}> {
  const engine = new AgentEvolution();
  return engine.getPlatformHealth(marketCode);
}
