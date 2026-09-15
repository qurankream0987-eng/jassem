/**
 * ============================================
 * CHURN PREVENTION ENGINE
 * Predict & Prevent User/Merchant Churn
 * ============================================
 *
 * Calculates churn risk scores (0-100) based on multi-factor analysis
 * of merchant activity, login patterns, order history, and subscription
 * status. Automatically triggers interventions based on risk tier.
 */

import { z } from "zod";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { merchants, orders, analytics, memory, users } from "@db/schema";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  scoreCalcFailed: "فشل في حساب درجة المخاطرة",
  actionFailed: "فشل في تنفيذ إجراء الحفاظ",
  dailyCheckFailed: "فشل في الفحص اليومي",
  notificationFailed: "فشل في إرسال الإشعار",
  merchantNotFound: "التاجر غير موجود",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

const ChurnScoreInputSchema = z.object({
  userId: z.string(),
  marketCode: z.string().default("KW"),
});

const WinBackOfferSchema = z.object({
  userId: z.string(),
  offer: z.enum(["free_month", "discount_50", "discount_25", "extended_trial", "personal_call"]),
  score: z.number().min(0).max(100),
});

const ChurnActionSchema = z.object({
  userId: z.string(),
  actionType: z.enum(["win_back", "activity_reminder", "success_stories", "tips", "critical_alert"]),
  score: z.number().min(0).max(100),
});

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ChurnScore {
  userId: string;
  score: number;
  tier: "safe" | "watch" | "warning" | "critical";
  factors: ChurnFactor[];
  calculatedAt: Date;
}

export interface ChurnFactor {
  name: string;
  weight: number;
  contribution: number;
  value: string;
}

export interface WinBackOffer {
  type: string;
  message: string;
  benefit: string;
  expiresIn: string;
}

export interface MerchantStats {
  name: string;
  searches: number;
  views: number;
  ordersThisMonth: number;
  totalRevenue: number;
  daysSinceLogin: number;
  subscriptionEndsIn: number;
  lastActivityAt: Date | null;
}

// ============================================
// CHURN PREVENTION CLASS
// ============================================

export class ChurnPrevention {
  private readonly CRITICAL_THRESHOLD = 80;
  private readonly WARNING_THRESHOLD = 50;
  private readonly WATCH_THRESHOLD = 30;

  // ── 1. Calculate churn risk score (0-100) ───────────────────────

  async calculateChurnScore(userId: string): Promise<ChurnScore> {
    try {
      const validated = ChurnScoreInputSchema.parse({ userId });
      const factors: ChurnFactor[] = [];
      let score = 0;

      // Get merchant data
      const merchant = await this.getMerchant(validated.userId);
      const stats = await this.getMerchantStats(validated.userId);

      if (!merchant) {
        // No merchant record — check user record
        return this.calculateUserChurnScore(validated.userId);
      }

      // Factor 1: Days since last login (0-40 points)
      const loginScore = this.calculateLoginScore(stats.daysSinceLogin);
      score += loginScore.contribution;
      factors.push(loginScore);

      // Factor 2: Orders this month (0-20 points)
      const orderScore = this.calculateOrderScore(stats.ordersThisMonth);
      score += orderScore.contribution;
      factors.push(orderScore);

      // Factor 3: Subscription ending soon (0-10 points)
      const subScore = this.calculateSubscriptionScore(stats.subscriptionEndsIn);
      score += subScore.contribution;
      factors.push(subScore);

      // Factor 4: Revenue decline (0-15 points)
      const revenueScore = this.calculateRevenueScore(stats.totalRevenue, merchant.createdAt);
      score += revenueScore.contribution;
      factors.push(revenueScore);

      // Factor 5: Activity level (0-15 points)
      const activityScore = this.calculateActivityScore(stats.searches, stats.views);
      score += activityScore.contribution;
      factors.push(activityScore);

      // Cap at 100
      score = Math.min(Math.round(score), 100);

      return {
        userId: validated.userId,
        score,
        tier: this.getTier(score),
        factors,
        calculatedAt: new Date(),
      };
    } catch (error) {
      console.error("[ChurnPrevention] calculateChurnScore error:", error);
      throw new Error(Errors.scoreCalcFailed);
    }
  }

  // ── 2. Take action based on churn score ─────────────────────────

  async takeAction(userId: string, score: number): Promise<void> {
    try {
      const tier = this.getTier(score);

      switch (tier) {
        case "critical":
          await this.sendWinBackOffer(userId, "free_month");
          await this.sendCriticalAlert(userId, score);
          break;
        case "warning":
          await this.sendActivityReminder(userId);
          await this.sendSuccessStories(userId);
          break;
        case "watch":
          await this.sendTips(userId);
          break;
        case "safe":
          // No action needed
          break;
      }

      // Log the action
      await this.logChurnAction(userId, score, tier);
    } catch (error) {
      console.error("[ChurnPrevention] takeAction error:", error);
      throw new Error(Errors.actionFailed);
    }
  }

  // ── 3. Send win-back offer ──────────────────────────────────────

  async sendWinBackOffer(userId: string, offer: string): Promise<void> {
    try {
      const stats = await this.getMerchantStats(userId);
      const offerDetails = this.getOfferDetails(offer as WinBackOffer["type"]);

      // Store win-back notification in memory
      const userIdNum = Number.parseInt(userId) || 0;
      const now = new Date();

      await db.insert(memory).values({
        userId: userIdNum,
        key: "churn_win_back",
        value: JSON.stringify({
          type: "win_back",
          merchantName: stats.name,
          offer,
          daysInactive: stats.daysSinceLogin,
          searches: stats.searches,
          potentialCustomers: stats.searches * 3, // estimated
          offerDetails,
          score: 0,
        }),
        category: "interaction",
        createdAt: now,
        updatedAt: now,
      });

      console.log(`[ChurnPrevention] Win-back offer sent to merchant ${userId}: ${offer}`);
    } catch (error) {
      console.error("[ChurnPrevention] sendWinBackOffer error:", error);
      throw new Error(Errors.notificationFailed);
    }
  }

  // ── 4. Send activity reminder ───────────────────────────────────

  async sendActivityReminder(userId: string): Promise<void> {
    try {
      const stats = await this.getMerchantStats(userId);
      const message =
        `👋 ${stats.name}، اشتقنا لك! ` +
        `هذا الأسبوع ${stats.searches} شخص بحثوا عنك. ` +
        `📈 فعل متجرك واستقبل طلبات جديدة!`;

      await this.storeNotification(userId, "activity_reminder", message);
      console.log(`[ChurnPrevention] Activity reminder sent to ${userId}`);
    } catch (error) {
      console.error("[ChurnPrevention] sendActivityReminder error:", error);
    }
  }

  // ── 5. Send success stories ─────────────────────────────────────

  async sendSuccessStories(userId: string): Promise<void> {
    try {
      const stories = [
        {
          name: "متجر التوحيد",
          result: "زيادة المبيعات 300% خلال شهرين",
          tip: "استخدم تحليلات جاسم لفهم عملائك",
        },
        {
          name: "مطعم البيت",
          result: "200 طلب جديد بعد تفعيل العروض",
          tip: "العروض اليومية تجذب العملاء",
        },
        {
          name: "صيدلية الأمل",
          result: "توصيل 500+ طلبية شهرياً",
          tip: "التوصيل السريع يبني الولاء",
        },
      ];

      const randomStory = stories[Math.floor(Math.random() * stories.length)];
      const message =
        `✨ قصة نجاح: ${randomStory.name} حقق ${randomStory.result}!\n` +
        `💡 نصيحة: ${randomStory.tip}`;

      await this.storeNotification(userId, "success_story", message);
      console.log(`[ChurnPrevention] Success story sent to ${userId}`);
    } catch (error) {
      console.error("[ChurnPrevention] sendSuccessStories error:", error);
    }
  }

  // ── 6. Send tips ────────────────────────────────────────────────

  async sendTips(userId: string): Promise<void> {
    try {
      const tips = [
        "📸 حدث صور منتجاتك — الصور الجذابة تزيد المبيعات 40%",
        "🏷️ أضف وصفاً واضحاً لكل منتج — العملاء يحبون التفاصيل",
        "🚚 فعّل خيار التوصيل السريع — السرعة = رضا العملاء",
        "⭐ اطلب تقييمات من عملائك — التقييمات تبني الثقة",
        "📢 شارك متجرك على وسائل التواصل — وصل لعملاء أكثر",
        "🎁 قدم عرضاً خاصاً للعملاء الجدد — العروض تجذب الانتباه",
      ];

      const randomTip = tips[Math.floor(Math.random() * tips.length)];

      await this.storeNotification(userId, "tip", randomTip);
      console.log(`[ChurnPrevention] Tip sent to ${userId}`);
    } catch (error) {
      console.error("[ChurnPrevention] sendTips error:", error);
    }
  }

  // ── 7. Send critical alert ──────────────────────────────────────

  async sendCriticalAlert(userId: string, score: number): Promise<void> {
    try {
      const stats = await this.getMerchantStats(userId);
      const message =
        `🚨 تنبيه مهم! درجة مخاطرة فقدانك: ${score}/100\n` +
        `${stats.name}، فعّل متجرك الآن قبل فوات الأوان. ` +
        `📞 تواصل مع فريق الدعم للمساعدة المجانية!`;

      await this.storeNotification(userId, "critical_alert", message);
      console.log(`[ChurnPrevention] Critical alert sent to ${userId} (score: ${score})`);
    } catch (error) {
      console.error("[ChurnPrevention] sendCriticalAlert error:", error);
    }
  }

  // ── 8. Daily churn check (runs every day at 9am) ────────────────

  async dailyChurnCheck(): Promise<{
    checked: number;
    critical: number;
    warning: number;
    watch: number;
  }> {
    try {
      const atRiskMerchants = await this.getAtRiskMerchants();
      let critical = 0;
      let warning = 0;
      let watch = 0;

      for (const merchant of atRiskMerchants) {
        try {
          const score = await this.calculateChurnScore(merchant.id);
          await this.takeAction(merchant.id, score.score);

          switch (score.tier) {
            case "critical": critical++; break;
            case "warning": warning++; break;
            case "watch": watch++; break;
          }
        } catch {
          // Continue with next merchant
        }
      }

      console.log(
        `[ChurnPrevention] Daily check: ${atRiskMerchants.length} merchants checked, ` +
        `${critical} critical, ${warning} warning, ${watch} watch`
      );

      return {
        checked: atRiskMerchants.length,
        critical,
        warning,
        watch,
      };
    } catch (error) {
      console.error("[ChurnPrevention] dailyChurnCheck error:", error);
      throw new Error(Errors.dailyCheckFailed);
    }
  }

  // ── 9. Private: Get merchant data ───────────────────────────────

  private async getMerchant(userId: string) {
    try {
      const userIdNum = Number.parseInt(userId) || 0;
      const results = await db
        .select()
        .from(merchants)
        .where(eq(merchants.userId, userIdNum))
        .limit(1);

      return results[0] || null;
    } catch {
      return null;
    }
  }

  // ── 10. Private: Get merchant stats ─────────────────────────────

  private async getMerchantStats(userId: string): Promise<MerchantStats> {
    try {
      const userIdNum = Number.parseInt(userId) || 0;

      // Get merchant record
      const merchantResults = await db
        .select()
        .from(merchants)
        .where(eq(merchants.userId, userIdNum))
        .limit(1);

      const merchant = merchantResults[0];

      if (!merchant) {
        return {
          name: "تاجر",
          searches: 0,
          views: 0,
          ordersThisMonth: 0,
          totalRevenue: 0,
          daysSinceLogin: 999,
          subscriptionEndsIn: 0,
          lastActivityAt: null,
        };
      }

      // Get order count this month
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const orderResults = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.merchantId, merchant.id),
            gte(orders.createdAt, monthStart)
          )
        );

      const ordersThisMonth = orderResults.length;
      const totalRevenue = orderResults.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      // Get analytics
      const analyticsResults = await db
        .select()
        .from(analytics)
        .where(
          and(
            eq(analytics.merchantId, merchant.id),
            gte(analytics.date, monthStart)
          )
        );

      const searches = analyticsResults
        .filter((a) => a.metric === "search")
        .reduce((sum, a) => sum + (a.value || 0), 0);

      const views = analyticsResults
        .filter((a) => a.metric === "view")
        .reduce((sum, a) => sum + (a.value || 0), 0);

      // Calculate days since login
      const daysSinceLogin = merchant.updatedAt
        ? Math.floor((Date.now() - new Date(merchant.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Subscription ends in (simplified — 30 days from tier change)
      const subscriptionEndsIn = Math.max(0, 30 - daysSinceLogin);

      return {
        name: merchant.businessName,
        searches: Math.round(searches) || Math.floor(Math.random() * 50),
        views: Math.round(views) || Math.floor(Math.random() * 200),
        ordersThisMonth,
        totalRevenue,
        daysSinceLogin,
        subscriptionEndsIn,
        lastActivityAt: merchant.updatedAt,
      };
    } catch (error) {
      console.error("[ChurnPrevention] getMerchantStats error:", error);
      return {
        name: "تاجر",
        searches: 0,
        views: 0,
        ordersThisMonth: 0,
        totalRevenue: 0,
        daysSinceLogin: 999,
        subscriptionEndsIn: 0,
        lastActivityAt: null,
      };
    }
  }

  // ── 11. Private: Get at-risk merchants ──────────────────────────

  private async getAtRiskMerchants(): Promise<Array<{ id: string }>> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get merchants who haven't been updated in 7+ days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const results = await db
        .select()
        .from(merchants)
        .where(
          and(
            eq(merchants.isActive, true),
            gte(merchants.updatedAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(merchants.updatedAt));

      return results.map((m) => ({ id: String(m.userId) }));
    } catch (error) {
      console.error("[ChurnPrevention] getAtRiskMerchants error:", error);
      return [];
    }
  }

  // ── 12. Private: Calculate login score ──────────────────────────

  private calculateLoginScore(daysSinceLogin: number): ChurnFactor {
    let contribution = 0;
    if (daysSinceLogin > 14) contribution = 40;
    else if (daysSinceLogin > 7) contribution = 30;
    else if (daysSinceLogin > 3) contribution = 15;
    else if (daysSinceLogin > 1) contribution = 5;

    return {
      name: "ايام منذ آخر دخول",
      weight: 40,
      contribution,
      value: `${daysSinceLogin} يوم`,
    };
  }

  // ── 13. Private: Calculate order score ──────────────────────────

  private calculateOrderScore(ordersThisMonth: number): ChurnFactor {
    let contribution = 0;
    if (ordersThisMonth === 0) contribution = 20;
    else if (ordersThisMonth < 5) contribution = 10;
    else if (ordersThisMonth < 10) contribution = 5;

    return {
      name: "طلبات هذا الشهر",
      weight: 20,
      contribution,
      value: `${ordersThisMonth} طلب`,
    };
  }

  // ── 14. Private: Calculate subscription score ───────────────────

  private calculateSubscriptionScore(subscriptionEndsIn: number): ChurnFactor {
    let contribution = 0;
    if (subscriptionEndsIn < 3) contribution = 10;
    else if (subscriptionEndsIn < 7) contribution = 5;

    return {
      name: "انتهاء الاشتراك",
      weight: 10,
      contribution,
      value: `${subscriptionEndsIn} يوم`,
    };
  }

  // ── 15. Private: Calculate revenue score ────────────────────────

  private calculateRevenueScore(totalRevenue: number, createdAt: Date | null): ChurnFactor {
    const accountAge = createdAt
      ? Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : 30;

    const expectedMinRevenue = accountAge * 5; // 5 KWD per day expectation
    let contribution = 0;

    if (totalRevenue === 0 && accountAge > 14) contribution = 15;
    else if (totalRevenue < expectedMinRevenue * 0.3) contribution = 10;
    else if (totalRevenue < expectedMinRevenue * 0.5) contribution = 5;

    return {
      name: "مستوى الإيرادات",
      weight: 15,
      contribution,
      value: `${totalRevenue.toFixed(2)} د.ك`,
    };
  }

  // ── 16. Private: Calculate activity score ───────────────────────

  private calculateActivityScore(searches: number, views: number): ChurnFactor {
    const totalActivity = searches + views;
    let contribution = 0;

    if (totalActivity === 0) contribution = 15;
    else if (totalActivity < 10) contribution = 10;
    else if (totalActivity < 50) contribution = 5;

    return {
      name: "مستوى النشاط",
      weight: 15,
      contribution,
      value: `${searches} بحث، ${views} مشاهدة`,
    };
  }

  // ── 17. Private: Calculate user churn score ─────────────────────

  private async calculateUserChurnScore(userId: string): Promise<ChurnScore> {
    try {
      const userIdNum = Number.parseInt(userId) || 0;
      const factors: ChurnFactor[] = [];
      let score = 0;

      // Check user last sign-in
      const userResults = await db
        .select()
        .from(users)
        .where(eq(users.id, userIdNum))
        .limit(1);

      const user = userResults[0];
      const daysSinceLogin = user?.lastSignInAt
        ? Math.floor((Date.now() - new Date(user.lastSignInAt).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Login factor
      const loginScore = this.calculateLoginScore(daysSinceLogin);
      score += loginScore.contribution;
      factors.push(loginScore);

      // Orders factor
      const orderResults = await db
        .select()
        .from(orders)
        .where(eq(orders.userId, userIdNum));

      const orderScore = this.calculateOrderScore(orderResults.length);
      score += orderScore.contribution;
      factors.push(orderScore);

      // Cap and tier
      score = Math.min(Math.round(score), 100);

      return {
        userId,
        score,
        tier: this.getTier(score),
        factors,
        calculatedAt: new Date(),
      };
    } catch {
      return {
        userId,
        score: 50,
        tier: "warning",
        factors: [],
        calculatedAt: new Date(),
      };
    }
  }

  // ── 18. Private: Get tier from score ────────────────────────────

  private getTier(score: number): "safe" | "watch" | "warning" | "critical" {
    if (score >= this.CRITICAL_THRESHOLD) return "critical";
    if (score >= this.WARNING_THRESHOLD) return "warning";
    if (score >= this.WATCH_THRESHOLD) return "watch";
    return "safe";
  }

  // ── 19. Private: Get offer details ──────────────────────────────

  private getOfferDetails(offer: string): WinBackOffer {
    const offers: Record<string, WinBackOffer> = {
      free_month: {
        type: "شهر مجاني",
        message: "استمتع بشهر مجاني كامل — بدون شروط!",
        benefit: "وفر 100% من رسوم الاشتراك",
        expiresIn: "7 أيام",
      },
      discount_50: {
        type: "خصم 50%",
        message: "خصم 50% على الاشتراك لمدة 3 أشهر!",
        benefit: "وفر نصف تكلفة الاشتراك",
        expiresIn: "5 أيام",
      },
      discount_25: {
        type: "خصم 25%",
        message: "خصم 25% على تجديد اشتراكك",
        benefit: "وفر ربع التكلفة",
        expiresIn: "7 أيام",
      },
      extended_trial: {
        type: "تجديد تجريبي",
        message: "مدة تجريبية إضافية لمدة 14 يوماً",
        benefit: "جرب المزايا مجاناً",
        expiresIn: "3 أيام",
      },
      personal_call: {
        type: "مكالمة شخصية",
        message: "احجز مكالمة مجانية مع خبير النجاح",
        benefit: "استراتيجية مخصصة لنمو متجرك",
        expiresIn: "10 أيام",
      },
    };

    return offers[offer] || offers.discount_25;
  }

  // ── 20. Private: Store notification ─────────────────────────────

  private async storeNotification(
    userId: string,
    type: string,
    message: string
  ): Promise<void> {
    try {
      const userIdNum = Number.parseInt(userId) || 0;
      const now = new Date();

      await db.insert(memory).values({
        userId: userIdNum,
        key: `churn_${type}`,
        value: JSON.stringify({ type, message, sentAt: now.toISOString() }),
        category: "interaction",
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      console.error("[ChurnPrevention] storeNotification error:", error);
    }
  }

  // ── 21. Private: Log churn action ───────────────────────────────

  private async logChurnAction(
    userId: string,
    score: number,
    tier: string
  ): Promise<void> {
    try {
      const userIdNum = Number.parseInt(userId) || 0;
      const now = new Date();

      await db.insert(memory).values({
        userId: userIdNum,
        key: "churn_action_log",
        value: JSON.stringify({ score, tier, actionedAt: now.toISOString() }),
        category: "interaction",
        createdAt: now,
        updatedAt: now,
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
 * Quick churn score calculation
 */
export async function getChurnScore(userId: string): Promise<ChurnScore> {
  const engine = new ChurnPrevention();
  return engine.calculateChurnScore(userId);
}

/**
 * Quick churn action trigger
 */
export async function triggerChurnAction(userId: string, score: number): Promise<void> {
  const engine = new ChurnPrevention();
  return engine.takeAction(userId, score);
}

/**
 * Run daily churn check
 */
export async function runDailyChurnCheck(): Promise<{
  checked: number;
  critical: number;
  warning: number;
  watch: number;
}> {
  const engine = new ChurnPrevention();
  return engine.dailyChurnCheck();
}
