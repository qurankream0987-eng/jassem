/**
 * ============================================
 * PREDICTIVE ENGINE
 * User Behavior Pattern Analysis & Prediction
 * ============================================
 *
 * Analyzes user behavior patterns across 90-day windows to predict
 * next actions and generate proactive bubbles before the user asks.
 * Supports time-based, category, price-range, day-of-week, and
 * seasonal patterns (Ramadan, Eid, etc.) for all 18 Arab markets.
 */

import { z } from "zod";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { memory, orders, products, merchants } from "@db/schema";
import type { BubbleType } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  analysisFailed: "فشل في تحليل أنماط السلوك",
  predictionFailed: "فشل في التنبؤ بالإجراء التالي",
  bubbleGenFailed: "فشل في توليد الفقاعات التنبؤية",
  invalidUserId: "معرف المستخدم غير صالح",
  noInteractions: "لا توجد تفاعلات كافية للتحليل",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

const BehaviorPatternSchema = z.object({
  id: z.string(),
  userId: z.string(),
  intent: z.string(),
  item: z.string().optional(),
  category: z.string().optional(),
  merchantId: z.number().optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  hourOfDay: z.number().min(0).max(23).optional(),
  timeWindow: z.string().optional(),
  confidence: z.number().min(0).max(1),
  frequency: z.number().min(1),
  avgOrderValue: z.number().default(0),
  lastOccurrence: z.date(),
  marketCode: z.string().default("KW"),
});

const PredictionSchema = z.object({
  confidence: z.number().min(0).max(1),
  predictedIntent: z.string(),
  suggestedProduct: z.string().optional(),
  suggestedMerchant: z.string().optional(),
  suggestedCategory: z.string().optional(),
  message: z.string(),
  suggestedBubbles: z.array(z.record(z.string(), z.unknown())).optional(),
});

const PredictiveBubbleSchema = z.object({
  type: z.string(),
  theme: z.string(),
  data: z.record(z.string(), z.unknown()),
  priority: z.number(),
});

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface BehaviorPattern {
  id: string;
  userId: string;
  intent: string;
  item?: string;
  category?: string;
  merchantId?: number;
  dayOfWeek?: number;
  hourOfDay?: number;
  timeWindow?: string;
  confidence: number;
  frequency: number;
  avgOrderValue: number;
  lastOccurrence: Date;
  marketCode: string;
  matchesTime(date: Date): boolean;
}

export interface Prediction {
  confidence: number;
  predictedIntent: string;
  suggestedProduct?: string;
  suggestedMerchant?: string;
  suggestedCategory?: string;
  message: string;
  suggestedBubbles?: Record<string, unknown>[];
}

export interface PredictiveBubble {
  type: string;
  theme: string;
  data: Record<string, unknown>;
  priority: number;
}

// ============================================
// SEASONAL CALENDAR (Hijri / Arab events)
// ============================================

const SEASONAL_EVENTS = [
  { name: "رمضان", monthStart: 9, monthEnd: 9, pattern: "iftar_ordering" },
  { name: "عيد_الفطر", monthStart: 10, monthEnd: 10, pattern: "eid_shopping" },
  { name: "عيد_الأضحى", monthStart: 12, monthEnd: 12, pattern: "eid_shopping" },
  { name: "الحج", monthStart: 12, monthEnd: 12, pattern: "hajj_supplies" },
  { name: "موسم_الرياض", monthStart: 3, monthEnd: 4, pattern: "event_shopping" },
  { name: "دبي_شوبينغ", monthStart: 12, monthEnd: 1, pattern: "sale_shopping" },
];

// ============================================
// PREDICTIVE ENGINE CLASS
// ============================================

export class PredictiveEngine {
  private readonly CONFIDENCE_THRESHOLD = 0.7;
  private readonly PATTERN_WINDOW_DAYS = 90;
  private readonly MIN_FREQUENCY = 3;

  // ── 1. Analyze user behavior patterns ───────────────────────────

  async analyzePatterns(userId: string): Promise<BehaviorPattern[]> {
    try {
      // Validate input
      if (!userId || userId.trim() === "") {
        throw new Error(Errors.invalidUserId);
      }

      // Query memory DB for user's interactions (90 days)
      const interactions = await this.getRecentInteractions(userId, this.PATTERN_WINDOW_DAYS);

      if (interactions.length < this.MIN_FREQUENCY) {
        return [];
      }

      // Detect patterns from interactions
      return this.detectPatterns(interactions, userId);
    } catch (error) {
      console.error("[PredictiveEngine] analyzePatterns error:", error);
      throw new Error(Errors.analysisFailed);
    }
  }

  // ── 2. Predict next action ──────────────────────────────────────

  async predictNextAction(userId: string): Promise<Prediction | null> {
    try {
      const patterns = await this.analyzePatterns(userId);
      const now = new Date();

      // Check if any pattern matches current time
      for (const pattern of patterns) {
        if (pattern.matchesTime(now) && pattern.confidence >= this.CONFIDENCE_THRESHOLD) {
          return {
            confidence: pattern.confidence,
            predictedIntent: pattern.intent,
            suggestedProduct: pattern.item,
            suggestedCategory: pattern.category,
            message: this.generateProactiveMessage(pattern),
            suggestedBubbles: this.generatePredictiveBubblesData(pattern),
          };
        }
      }

      // No time match — return highest confidence pattern
      if (patterns.length > 0) {
        const bestPattern = patterns[0];
        if (bestPattern.confidence >= this.CONFIDENCE_THRESHOLD) {
          return {
            confidence: bestPattern.confidence,
            predictedIntent: bestPattern.intent,
            suggestedProduct: bestPattern.item,
            suggestedCategory: bestPattern.category,
            message: this.generateProactiveMessage(bestPattern),
            suggestedBubbles: this.generatePredictiveBubblesData(bestPattern),
          };
        }
      }

      return null;
    } catch (error) {
      console.error("[PredictiveEngine] predictNextAction error:", error);
      throw new Error(Errors.predictionFailed);
    }
  }

  // ── 3. Generate proactive bubbles ───────────────────────────────

  async generatePredictiveBubbles(userId: string): Promise<PredictiveBubble[]> {
    try {
      const prediction = await this.predictNextAction(userId);
      if (!prediction || prediction.confidence < this.CONFIDENCE_THRESHOLD) {
        return [];
      }

      // Build predictive ad bubble
      const bubble: PredictiveBubble = {
        type: "predictive_ad",
        theme: "proactive_suggestion",
        data: {
          message: prediction.message,
          product: prediction.suggestedProduct,
          category: prediction.suggestedCategory,
          confidence: prediction.confidence,
          intent: prediction.predictedIntent,
          cta: this.generateCTA(prediction),
        },
        priority: 1,
      };

      return [bubble];
    } catch (error) {
      console.error("[PredictiveEngine] generatePredictiveBubbles error:", error);
      return [];
    }
  }

  // ── 4. Get predictive suggestions for a time window ─────────────

  async getSuggestionsForTime(userId: string, date: Date): Promise<Prediction[]> {
    const patterns = await this.analyzePatterns(userId);
    const suggestions: Prediction[] = [];

    for (const pattern of patterns) {
      if (pattern.matchesTime(date) && pattern.confidence >= 0.5) {
        suggestions.push({
          confidence: pattern.confidence,
          predictedIntent: pattern.intent,
          suggestedProduct: pattern.item,
          suggestedCategory: pattern.category,
          message: this.generateProactiveMessage(pattern),
        });
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  // ── 5. Private: Detect patterns from interactions ───────────────

  private detectPatterns(interactions: InteractionRecord[], userId: string): BehaviorPattern[] {
    const patterns: BehaviorPattern[] = [];

    // Group interactions by intent
    const byIntent = this.groupBy(interactions, "intent");

    for (const [intent, intentInteractions] of Object.entries(byIntent)) {
      if (intentInteractions.length < this.MIN_FREQUENCY) continue;

      // Time-based patterns
      const timePattern = this.extractTimePattern(intent, intentInteractions, userId);
      if (timePattern) patterns.push(timePattern);

      // Category preference patterns
      const categoryPattern = this.extractCategoryPattern(intent, intentInteractions, userId);
      if (categoryPattern) patterns.push(categoryPattern);

      // Day-of-week patterns
      const dowPattern = this.extractDayOfWeekPattern(intent, intentInteractions, userId);
      if (dowPattern) patterns.push(dowPattern);

      // Price range patterns
      const pricePattern = this.extractPriceRangePattern(intent, intentInteractions, userId);
      if (pricePattern) patterns.push(pricePattern);
    }

    // Seasonal patterns
    const seasonalPatterns = this.extractSeasonalPatterns(interactions, userId);
    patterns.push(...seasonalPatterns);

    // Sort by confidence descending
    patterns.sort((a, b) => b.confidence - a.confidence);

    return patterns;
  }

  // ── 6. Private: Time pattern extraction ─────────────────────────

  private extractTimePattern(
    intent: string,
    interactions: InteractionRecord[],
    userId: string
  ): BehaviorPattern | null {
    const hourCounts = new Map<number, number>();

    for (const ix of interactions) {
      const hour = new Date(ix.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    // Find peak hour
    let peakHour = -1;
    let peakCount = 0;
    for (const [hour, count] of hourCounts) {
      if (count > peakCount) {
        peakHour = hour;
        peakCount = count;
      }
    }

    if (peakCount < this.MIN_FREQUENCY) return null;

    const confidence = Math.min(peakCount / interactions.length, 1);
    const mostCommonItem = this.getMostCommon(interactions.map((i) => i.item).filter(Boolean) as string[]);

    return {
      id: `time_${intent}_${userId}`,
      userId,
      intent,
      item: mostCommonItem,
      hourOfDay: peakHour,
      timeWindow: `${peakHour}:00-${peakHour + 1}:00`,
      confidence,
      frequency: peakCount,
      avgOrderValue: this.calculateAvgOrderValue(interactions),
      lastOccurrence: new Date(interactions[interactions.length - 1].timestamp),
      marketCode: interactions[0].marketCode || "KW",
      matchesTime(date: Date): boolean {
        const hour = date.getHours();
        return hour === this.hourOfDay;
      },
    };
  }

  // ── 7. Private: Category pattern extraction ─────────────────────

  private extractCategoryPattern(
    intent: string,
    interactions: InteractionRecord[],
    userId: string
  ): BehaviorPattern | null {
    const categories = interactions
      .map((i) => i.category)
      .filter((c): c is string => Boolean(c));

    if (categories.length < this.MIN_FREQUENCY) return null;

    const mostCommonCategory = this.getMostCommon(categories);
    const categoryCount = categories.filter((c) => c === mostCommonCategory).length;
    const confidence = Math.min(categoryCount / categories.length, 1);

    return {
      id: `cat_${intent}_${userId}`,
      userId,
      intent,
      category: mostCommonCategory,
      confidence,
      frequency: categoryCount,
      avgOrderValue: this.calculateAvgOrderValue(interactions),
      lastOccurrence: new Date(interactions[interactions.length - 1].timestamp),
      marketCode: interactions[0].marketCode || "KW",
      matchesTime(): boolean {
        return true; // Category patterns always match
      },
    };
  }

  // ── 8. Private: Day-of-week pattern extraction ──────────────────

  private extractDayOfWeekPattern(
    intent: string,
    interactions: InteractionRecord[],
    userId: string
  ): BehaviorPattern | null {
    const dowCounts = new Map<number, number>();

    for (const ix of interactions) {
      const dow = new Date(ix.timestamp).getDay();
      dowCounts.set(dow, (dowCounts.get(dow) || 0) + 1);
    }

    let peakDow = -1;
    let peakCount = 0;
    for (const [dow, count] of dowCounts) {
      if (count > peakCount) {
        peakDow = dow;
        peakCount = count;
      }
    }

    if (peakCount < this.MIN_FREQUENCY) return null;

    const confidence = Math.min(peakCount / interactions.length, 1);
    const mostCommonItem = this.getMostCommon(interactions.map((i) => i.item).filter(Boolean) as string[]);

    return {
      id: `dow_${intent}_${userId}`,
      userId,
      intent,
      item: mostCommonItem,
      dayOfWeek: peakDow,
      confidence,
      frequency: peakCount,
      avgOrderValue: this.calculateAvgOrderValue(interactions),
      lastOccurrence: new Date(interactions[interactions.length - 1].timestamp),
      marketCode: interactions[0].marketCode || "KW",
      matchesTime(date: Date): boolean {
        return date.getDay() === this.dayOfWeek;
      },
    };
  }

  // ── 9. Private: Price range pattern ─────────────────────────────

  private extractPriceRangePattern(
    intent: string,
    interactions: InteractionRecord[],
    userId: string
  ): BehaviorPattern | null {
    const prices = interactions
      .map((i) => i.orderValue)
      .filter((v): v is number => typeof v === "number" && v > 0);

    if (prices.length < this.MIN_FREQUENCY) return null;

    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceRange = avgPrice > 50 ? "high" : avgPrice > 20 ? "medium" : "low";

    return {
      id: `price_${intent}_${userId}`,
      userId,
      intent,
      confidence: 0.6,
      frequency: prices.length,
      avgOrderValue: avgPrice,
      lastOccurrence: new Date(interactions[interactions.length - 1].timestamp),
      marketCode: interactions[0].marketCode || "KW",
      matchesTime(): boolean {
        return true;
      },
    };
  }

  // ── 10. Private: Seasonal pattern extraction ────────────────────

  private extractSeasonalPatterns(
    interactions: InteractionRecord[],
    userId: string
  ): BehaviorPattern[] {
    const patterns: BehaviorPattern[] = [];
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // Approximate Hijri month check

    for (const event of SEASONAL_EVENTS) {
      // Check if we're in or approaching a seasonal event
      if (currentMonth >= event.monthStart && currentMonth <= event.monthEnd) {
        const relevantInteractions = interactions.filter((ix) => {
          const ixMonth = new Date(ix.timestamp).getMonth() + 1;
          return ixMonth >= event.monthStart && ixMonth <= event.monthEnd;
        });

        if (relevantInteractions.length >= 2) {
          patterns.push({
            id: `seasonal_${event.name}_${userId}`,
            userId,
            intent: event.pattern,
            confidence: Math.min(relevantInteractions.length / 5, 0.9),
            frequency: relevantInteractions.length,
            avgOrderValue: this.calculateAvgOrderValue(relevantInteractions),
            lastOccurrence: new Date(relevantInteractions[relevantInteractions.length - 1].timestamp),
            marketCode: relevantInteractions[0].marketCode || "KW",
            matchesTime(): boolean {
              return true; // Seasonal patterns are time-bounded by caller
            },
          });
        }
      }
    }

    return patterns;
  }

  // ── 11. Private: Generate proactive message ─────────────────────

  private generateProactiveMessage(pattern: BehaviorPattern): string {
    const dowNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

    // Food ordering patterns
    if (pattern.intent === "food_order" && pattern.item) {
      const dowText = pattern.dayOfWeek !== undefined ? dowNames[pattern.dayOfWeek] : "";
      return `${dowText ? dowText + " = " : ""}${pattern.item}! 😋 جرب عروض اليوم — توصيل سريع`;
    }

    // Product search patterns
    if (pattern.intent === "product_search" && pattern.category) {
      return `تبحث عن ${pattern.category}؟ 🔍 لقينا لك أحسن الخيارات والأسعار!`;
    }

    // Order tracking patterns
    if (pattern.intent === "order_tracking") {
      return `طلباتك واصلة قريب! 📦 تابع حالة شحنتك الآن`;
    }

    // Payment patterns
    if (pattern.intent === "payment") {
      return `حاب تدفع بسرعة؟ 💳 عندك طرق دفع آمنة ومتعددة`;
    }

    // Ramadan / seasonal patterns
    if (pattern.intent === "iftar_ordering") {
      return "رمضان كريم! 🌙 اطلب إفطارك الآن — عروض خاصة للشهر الفضيل";
    }

    if (pattern.intent === "eid_shopping") {
      return "عيد مبارك! 🎁 اكتشف هدايا العيد وعروضنا الحصرية";
    }

    // Default proactive message
    const timeText = pattern.hourOfDay !== undefined
      ? `الساعة ${pattern.hourOfDay}:00`
      : "";
    return `حاب تسوي نشاطك المعتاد ${timeText}? ✨ نحن جاهزين نساعدك!`;
  }

  // ── 12. Private: Generate predictive bubble data ────────────────

  private generatePredictiveBubblesData(pattern: BehaviorPattern): Record<string, unknown>[] {
    const bubbles: Record<string, unknown>[] = [];

    bubbles.push({
      type: "predictive_ad",
      title: "اقتراح ذكي",
      subtitle: this.generateProactiveMessage(pattern),
      item: pattern.item,
      category: pattern.category,
      confidence: pattern.confidence,
      cta: this.generateCTA({
        predictedIntent: pattern.intent,
        suggestedProduct: pattern.item,
        confidence: pattern.confidence,
        message: "",
      }),
    });

    return bubbles;
  }

  // ── 13. Private: Generate CTA ───────────────────────────────────

  private generateCTA(prediction: { predictedIntent: string; suggestedProduct?: string; confidence: number; message: string }): Record<string, unknown> {
    const ctaMap: Record<string, { label: string; action: string }> = {
      food_order: { label: "اطلب الآن", action: "quick_order" },
      product_search: { label: "تصفح المنتجات", action: "browse_products" },
      order_tracking: { label: "تتبع الطلب", action: "track_order" },
      payment: { label: "ادفع الآن", action: "quick_pay" },
      iftar_ordering: { label: "اطلب الإفطار", action: "ramadan_order" },
      eid_shopping: { label: "تسوق العيد", action: "eid_shop" },
    };

    return ctaMap[prediction.predictedIntent] || { label: "اكتشف المزيد", action: "explore" };
  }

  // ── 14. Private: Fetch recent interactions ──────────────────────

  private async getRecentInteractions(userId: string, days: number): Promise<InteractionRecord[]> {
    try {
      const userIdNum = Number.parseInt(userId) || 0;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Get interaction memories
      const interactionMemories = await db
        .select()
        .from(memory)
        .where(
          and(
            eq(memory.userId, userIdNum),
            eq(memory.category, "interaction"),
            gte(memory.createdAt, cutoffDate)
          )
        )
        .orderBy(desc(memory.createdAt));

      // Get order history
      const orderHistory = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.userId, userIdNum),
            gte(orders.createdAt, cutoffDate)
          )
        )
        .orderBy(desc(orders.createdAt));

      // Convert to interaction records
      const records: InteractionRecord[] = [];

      for (const mem of interactionMemories) {
        let parsedValue: Record<string, unknown> = {};
        try {
          parsedValue = JSON.parse(mem.value) as Record<string, unknown>;
        } catch {
          parsedValue = { raw: mem.value };
        }

        records.push({
          id: String(mem.id),
          userId: String(mem.userId),
          intent: (parsedValue.intent as string) || mem.key,
          item: (parsedValue.item as string) || (parsedValue.product as string),
          category: (parsedValue.category as string) || mem.key,
          orderValue: typeof parsedValue.orderValue === "number" ? parsedValue.orderValue : 0,
          timestamp: mem.createdAt,
          marketCode: (parsedValue.market as string) || "KW",
        });
      }

      // Add order records
      for (const order of orderHistory) {
        records.push({
          id: `order_${order.id}`,
          userId: String(order.userId),
          intent: "food_order",
          item: `order_${order.productIds.join(",")}`,
          category: "order",
          merchantId: order.merchantId,
          orderValue: order.totalAmount,
          timestamp: order.createdAt,
          marketCode: "KW",
        });
      }

      // Sort by timestamp descending
      records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return records;
    } catch (error) {
      console.error("[PredictiveEngine] getRecentInteractions error:", error);
      return [];
    }
  }

  // ── 15. Private: Utility functions ──────────────────────────────

  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    const result: Record<string, T[]> = {};
    for (const item of array) {
      const groupKey = String(item[key] || "unknown");
      if (!result[groupKey]) result[groupKey] = [];
      result[groupKey].push(item);
    }
    return result;
  }

  private getMostCommon(array: string[]): string {
    const counts = new Map<string, number>();
    for (const item of array) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let mostCommon = array[0] || "";
    let maxCount = 0;
    for (const [item, count] of counts) {
      if (count > maxCount) {
        mostCommon = item;
        maxCount = count;
      }
    }
    return mostCommon;
  }

  private calculateAvgOrderValue(interactions: InteractionRecord[]): number {
    const values = interactions
      .map((i) => i.orderValue)
      .filter((v): v is number => typeof v === "number" && v > 0);

    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

// ============================================
// INTERACTION RECORD TYPE
// ============================================

interface InteractionRecord {
  id: string;
  userId: string;
  intent: string;
  item?: string;
  category?: string;
  merchantId?: number;
  orderValue: number;
  timestamp: Date;
  marketCode: string;
}

// ============================================
// STANDALONE FUNCTIONS (for direct use)
// ============================================

/**
 * Quick pattern analysis wrapper
 */
export async function analyzeUserPatterns(userId: string): Promise<BehaviorPattern[]> {
  const engine = new PredictiveEngine();
  return engine.analyzePatterns(userId);
}

/**
 * Quick prediction wrapper
 */
export async function predictUserNextAction(userId: string): Promise<Prediction | null> {
  const engine = new PredictiveEngine();
  return engine.predictNextAction(userId);
}

/**
 * Quick bubble generation wrapper
 */
export async function getPredictiveBubbles(userId: string): Promise<PredictiveBubble[]> {
  const engine = new PredictiveEngine();
  return engine.generatePredictiveBubbles(userId);
}
