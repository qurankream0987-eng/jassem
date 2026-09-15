/**
 * ============================================
 * ESCROW SMART CONTRACT LOGIC
 * Complete escrow system with conditional release
 * ============================================
 *
 * Release conditions:
 * 1. Delivery confirmed by buyer
 * 2. Service completed (for B2B)
 * 3. Time-based auto-release (7 days)
 * 4. Dispute resolution completed
 *
 * Split: seller, platform, JASIM
 */

import { z } from "zod";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import * as schema from "@db/schema";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  holdFailed: "فشل في حجز المبلغ",
  releaseFailed: "فشل في تحرير المبلغ",
  alreadyReleased: "المبلغ محرر مسبقاً",
  alreadyDisputed: "الطلب تحت نزاع مسبقاً",
  orderNotFound: "الطلب غير موجود",
  paymentNotFound: "الدفعة غير موجودة",
  invalidWinner: "الفائز غير صالح",
  unauthorized: "غير مصرح",
  disputeFailed: "فشل في فتح النزاع",
  autoReleaseFailed: "فشل في التحرير التلقائي",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

export const PaymentDataSchema = z.object({
  orderId: z.number(),
  userId: z.number(),
  merchantId: z.number().optional(),
  amount: z.number().positive(),
  currency: z.string().default("KWD"),
  gateway: z.enum(["knet", "apple_pay", "google_pay", "cash", "card"]).default("knet"),
  commission: z.number().default(0),
  marketCode: z.string().default("KW"),
});

export const EscrowHoldSchema = z.object({
  id: z.number(),
  orderId: z.number(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(["holding", "released", "disputed", "refunded", "auto_released"]),
  createdAt: z.date(),
  releaseConditions: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type PaymentData = z.infer<typeof PaymentDataSchema>;
export type EscrowHold = z.infer<typeof EscrowHoldSchema>;

export interface EscrowStatus {
  orderId: number;
  status: "holding" | "released" | "disputed" | "refunded" | "auto_released";
  amount: number;
  currency: string;
  heldSince: Date;
  canAutoRelease: boolean;
  autoReleaseDate: Date;
  releaseConditions: string[];
  split?: {
    seller: number;
    platform: number;
    jasim: number;
  };
}

// ============================================
// ESCROW SPLIT CONFIGURATION
// ============================================

interface SplitConfig {
  platformRate: number; // 0-1
  jasimRate: number;    // 0-1
  sellerRate: number;   // 0-1 (calculated as 1 - platform - jasim)
}

const DEFAULT_SPLIT: SplitConfig = {
  platformRate: 0.025,  // 2.5% platform commission
  jasimRate: 0.005,     // 0.5% JASIM AI fee
  sellerRate: 0.0,      // calculated: 0.97 (97%)
};

// Market-specific overrides
const MARKET_SPLITS: Record<string, SplitConfig> = {
  KW: { platformRate: 0.025, jasimRate: 0.005, sellerRate: 0.0 },
  SA: { platformRate: 0.03, jasimRate: 0.005, sellerRate: 0.0 },
  AE: { platformRate: 0.025, jasimRate: 0.005, sellerRate: 0.0 },
  QA: { platformRate: 0.025, jasimRate: 0.005, sellerRate: 0.0 },
  BH: { platformRate: 0.025, jasimRate: 0.005, sellerRate: 0.0 },
  OM: { platformRate: 0.025, jasimRate: 0.005, sellerRate: 0.0 },
  EG: { platformRate: 0.04, jasimRate: 0.005, sellerRate: 0.0 },
  JO: { platformRate: 0.035, jasimRate: 0.005, sellerRate: 0.0 },
};

const AUTO_RELEASE_DAYS = 7;

// ============================================
// ESCROW MANAGER CLASS
// ============================================

export class EscrowManager {
  private splitConfig: SplitConfig;

  constructor(marketCode: string = "KW") {
    this.splitConfig = MARKET_SPLITS[marketCode] || DEFAULT_SPLIT;
  }

  // ───────────────────────────────────────────
  // HOLD: Create escrow hold
  // ───────────────────────────────────────────

  /**
   * Create an escrow hold for a payment
   * Locks the funds until release conditions are met
   */
  async hold(payment: PaymentData): Promise<EscrowHold> {
    try {
      const validated = PaymentDataSchema.parse(payment);

      // Check if order exists
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, validated.orderId))
        .limit(1);

      if (!order) {
        throw new Error(Errors.orderNotFound);
      }

      // Check if payment already exists for this order
      const [existingPayment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, validated.orderId))
        .limit(1);

      let paymentId: number;

      if (existingPayment) {
        // Update existing payment
        paymentId = Number(existingPayment.id);
        await db
          .update(schema.payments)
          .set({
            status: "processing",
            escrowStatus: "holding",
            amount: validated.amount,
            currency: validated.currency,
            gateway: validated.gateway,
            merchantId: validated.merchantId || null,
            metadata: {
              ...((existingPayment.metadata as Record<string, unknown>) || {}),
              heldAt: new Date().toISOString(),
              releaseConditions: ["delivery_confirmed", "auto_release_7d", "dispute_resolution"],
              split: this.calculateSplitRaw(validated.amount, validated.commission),
            },
          })
          .where(eq(schema.payments.id, paymentId));
      } else {
        // Create new payment
        const [result] = await db.insert(schema.payments).values({
          userId: validated.userId,
          orderId: validated.orderId,
          merchantId: validated.merchantId || null,
          amount: validated.amount,
          currency: validated.currency,
          gateway: validated.gateway,
          status: "processing",
          escrowStatus: "holding",
          marketCode: validated.marketCode,
          metadata: {
            heldAt: new Date().toISOString(),
            releaseConditions: ["delivery_confirmed", "auto_release_7d", "dispute_resolution"],
            split: this.calculateSplitRaw(validated.amount, validated.commission),
          },
        }).$returningId();

        paymentId = Number(result.id);
      }

      // Update order escrow status
      await db
        .update(schema.orders)
        .set({
          escrowStatus: "holding",
          paymentStatus: "paid",
          commission: validated.commission || validated.amount * this.splitConfig.platformRate,
        })
        .where(eq(schema.orders.id, validated.orderId));

      return {
        id: paymentId,
        orderId: validated.orderId,
        amount: validated.amount,
        currency: validated.currency,
        status: "holding",
        createdAt: new Date(),
        releaseConditions: [
          "تأكيد الاستلام من المشتري",
          `التحرير التلقائي بعد ${AUTO_RELEASE_DAYS} أيام`,
          "حل النزاع",
        ],
        metadata: {
          split: this.calculateSplitRaw(validated.amount, validated.commission),
        },
      };
    } catch (error) {
      console.error("[Escrow] hold error:", error);
      throw new Error(Errors.holdFailed);
    }
  }

  // ───────────────────────────────────────────
  // RELEASE: Delivery confirmed by buyer
  // ───────────────────────────────────────────

  /**
   * Release escrow on delivery confirmation
   * Condition 1: Delivery confirmed by buyer
   */
  async releaseOnDelivery(orderId: string): Promise<void> {
    try {
      const orderIdNum = Number(orderId);

      // Verify order is delivered
      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderIdNum))
        .limit(1);

      if (!order) {
        throw new Error(Errors.orderNotFound);
      }

      if (order.status !== "delivered") {
        throw new Error("الطلب لم يتم توصيله بعد — لا يمكن التحرير");
      }

      if (order.escrowStatus === "released") {
        throw new Error(Errors.alreadyReleased);
      }

      // Get payment
      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderIdNum))
        .limit(1);

      if (!payment) {
        throw new Error(Errors.paymentNotFound);
      }

      // Calculate split
      const split = this.calculateSplitRaw(payment.amount, order.commission || 0);

      // Release escrow
      await db
        .update(schema.payments)
        .set({
          escrowStatus: "released",
          status: "completed",
          metadata: {
            ...((payment.metadata as Record<string, unknown>) || {}),
            releasedAt: new Date().toISOString(),
            releaseReason: "delivery_confirmed",
            split,
          },
        })
        .where(eq(schema.payments.orderId, orderIdNum));

      // Update order
      await db
        .update(schema.orders)
        .set({
          escrowStatus: "released",
        })
        .where(eq(schema.orders.id, orderIdNum));

      // Log the release
      await this.logEscrowEvent(orderIdNum, "released", "delivery_confirmed", split);
    } catch (error) {
      console.error("[Escrow] releaseOnDelivery error:", error);
      throw new Error(Errors.releaseFailed);
    }
  }

  // ───────────────────────────────────────────
  // RELEASE: Service completed (B2B)
  // ───────────────────────────────────────────

  /**
   * Release escrow on service completion
   * Condition 2: Service completed (for B2B)
   */
  async releaseOnServiceComplete(serviceId: string): Promise<void> {
    try {
      // For B2B services, serviceId could be a crossborder order or supplier contract
      const serviceIdNum = Number(serviceId);

      // Check crossborder orders
      const [cbOrder] = await db
        .select()
        .from(schema.crossborderOrders)
        .where(eq(schema.crossborderOrders.id, serviceIdNum))
        .limit(1);

      if (!cbOrder) {
        throw new Error("خدمة غير موجودة");
      }

      if (cbOrder.status !== "delivered") {
        throw new Error("الخدمة لم تكتمل بعد");
      }

      // Release the associated payment
      await db
        .update(schema.payments)
        .set({
          escrowStatus: "released",
          status: "completed",
        })
        .where(eq(schema.payments.orderId, serviceIdNum));

      await this.logEscrowEvent(serviceIdNum, "released", "service_completed");
    } catch (error) {
      console.error("[Escrow] releaseOnServiceComplete error:", error);
      throw new Error(Errors.releaseFailed);
    }
  }

  // ───────────────────────────────────────────
  // RELEASE: Time-based auto-release (7 days)
  // ───────────────────────────────────────────

  /**
   * Auto-release escrow after 7 days
   * Condition 3: Time-based auto-release
   */
  async autoRelease(orderId: string): Promise<void> {
    try {
      const orderIdNum = Number(orderId);

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderIdNum))
        .limit(1);

      if (!order) {
        throw new Error(Errors.orderNotFound);
      }

      if (order.escrowStatus !== "holding") {
        return; // Already released or disputed
      }

      // Check if 7 days have passed
      const heldAt = order.createdAt;
      const now = new Date();
      const daysDiff = (now.getTime() - heldAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysDiff < AUTO_RELEASE_DAYS) {
        throw new Error(`لم تمر ${AUTO_RELEASE_DAYS} أيام بعد — باقي ${(AUTO_RELEASE_DAYS - daysDiff).toFixed(1)} يوم`);
      }

      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderIdNum))
        .limit(1);

      if (!payment) {
        throw new Error(Errors.paymentNotFound);
      }

      const split = this.calculateSplitRaw(payment.amount, order.commission || 0);

      // Auto-release
      await db
        .update(schema.payments)
        .set({
          escrowStatus: "released",
          status: "completed",
          metadata: {
            ...((payment.metadata as Record<string, unknown>) || {}),
            releasedAt: new Date().toISOString(),
            releaseReason: "auto_release_7d",
            autoReleased: true,
            split,
          },
        })
        .where(eq(schema.payments.orderId, orderIdNum));

      await db
        .update(schema.orders)
        .set({ escrowStatus: "released" })
        .where(eq(schema.orders.id, orderIdNum));

      await this.logEscrowEvent(orderIdNum, "auto_released", "auto_release_7d", split);
    } catch (error) {
      console.error("[Escrow] autoRelease error:", error);
      throw new Error(Errors.autoReleaseFailed);
    }
  }

  /**
   * Process all pending auto-releases
   * Should be called by a cron job every hour
   */
  async processAutoReleases(): Promise<{
    processed: number;
    released: number;
    errors: number;
  }> {
    const result = { processed: 0, released: 0, errors: 0 };

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - AUTO_RELEASE_DAYS);

      // Find orders held for more than 7 days
      const heldOrders = await db
        .select()
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.escrowStatus, "holding"),
            eq(schema.orders.status, "delivered"),
            lte(schema.orders.createdAt, cutoff)
          )
        )
        .limit(100);

      for (const order of heldOrders) {
        result.processed++;
        try {
          await this.autoRelease(String(order.id));
          result.released++;
        } catch {
          result.errors++;
        }
      }

      return result;
    } catch (error) {
      console.error("[Escrow] processAutoReleases error:", error);
      return result;
    }
  }

  // ───────────────────────────────────────────
  // DISPUTE: Hold for dispute resolution
  // ───────────────────────────────────────────

  /**
   * Hold escrow for dispute resolution
   * Condition 4: Dispute resolution
   */
  async holdForDispute(orderId: string, reason?: string): Promise<void> {
    try {
      const orderIdNum = Number(orderId);

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderIdNum))
        .limit(1);

      if (!order) {
        throw new Error(Errors.orderNotFound);
      }

      if (order.escrowStatus === "disputed") {
        throw new Error(Errors.alreadyDisputed);
      }

      if (order.escrowStatus === "released") {
        throw new Error(Errors.alreadyReleased);
      }

      // Move to disputed status
      await db
        .update(schema.payments)
        .set({
          escrowStatus: "disputed",
          metadata: sql`JSON_SET(COALESCE(metadata, '{}'), '$.disputeOpenedAt', ${new Date().toISOString()})`,
        })
        .where(eq(schema.payments.orderId, orderIdNum));

      await db
        .update(schema.orders)
        .set({ escrowStatus: "disputed" })
        .where(eq(schema.orders.id, orderIdNum));

      await this.logEscrowEvent(orderIdNum, "disputed", "dispute_opened", undefined, reason);
    } catch (error) {
      console.error("[Escrow] holdForDispute error:", error);
      throw new Error(Errors.disputeFailed);
    }
  }

  // ───────────────────────────────────────────
  // RELEASE: After dispute resolution
  // ───────────────────────────────────────────

  /**
   * Release escrow after dispute is resolved
   * @param winner - 'buyer' (refund) or 'seller' (release)
   */
  async releaseAfterDispute(
    orderId: string,
    winner: "buyer" | "seller",
    resolution?: string
  ): Promise<void> {
    try {
      const orderIdNum = Number(orderId);

      if (!["buyer", "seller"].includes(winner)) {
        throw new Error(Errors.invalidWinner);
      }

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderIdNum))
        .limit(1);

      if (!order) {
        throw new Error(Errors.orderNotFound);
      }

      if (order.escrowStatus !== "disputed") {
        throw new Error("الطلب ليس تحت نزاع");
      }

      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderIdNum))
        .limit(1);

      if (!payment) {
        throw new Error(Errors.paymentNotFound);
      }

      if (winner === "buyer") {
        // Refund buyer
        await db
          .update(schema.payments)
          .set({
            escrowStatus: "refunded",
            status: "refunded",
            refundAmount: payment.amount,
            refundReason: resolution || "dispute_resolved_buyer",
            metadata: {
              ...((payment.metadata as Record<string, unknown>) || {}),
              releasedAt: new Date().toISOString(),
              releaseReason: "dispute_buyer_wins",
              resolution,
            },
          })
          .where(eq(schema.payments.orderId, orderIdNum));

        await db
          .update(schema.orders)
          .set({ escrowStatus: "refunded" })
          .where(eq(schema.orders.id, orderIdNum));

        await this.logEscrowEvent(orderIdNum, "refunded", "dispute_buyer_wins");
      } else {
        // Release to seller
        const split = this.calculateSplitRaw(payment.amount, order.commission || 0);

        await db
          .update(schema.payments)
          .set({
            escrowStatus: "released",
            status: "completed",
            metadata: {
              ...((payment.metadata as Record<string, unknown>) || {}),
              releasedAt: new Date().toISOString(),
              releaseReason: "dispute_seller_wins",
              resolution,
              split,
            },
          })
          .where(eq(schema.payments.orderId, orderIdNum));

        await db
          .update(schema.orders)
          .set({ escrowStatus: "released" })
          .where(eq(schema.orders.id, orderIdNum));

        await this.logEscrowEvent(orderIdNum, "released", "dispute_seller_wins", split);
      }
    } catch (error) {
      console.error("[Escrow] releaseAfterDispute error:", error);
      throw new Error(Errors.releaseFailed);
    }
  }

  // ───────────────────────────────────────────
  // GET STATUS
  // ───────────────────────────────────────────

  /**
   * Get escrow status for an order
   */
  async getStatus(orderId: string): Promise<EscrowStatus> {
    try {
      const orderIdNum = Number(orderId);

      const [order] = await db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderIdNum))
        .limit(1);

      if (!order) {
        throw new Error(Errors.orderNotFound);
      }

      const [payment] = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.orderId, orderIdNum))
        .limit(1);

      const heldSince = payment?.createdAt || order.createdAt;
      const autoReleaseDate = new Date(heldSince);
      autoReleaseDate.setDate(autoReleaseDate.getDate() + AUTO_RELEASE_DAYS);

      const now = new Date();
      const canAutoRelease =
        order.escrowStatus === "holding" &&
        now >= autoReleaseDate;

      const split = payment
        ? this.calculateSplitRaw(payment.amount, order.commission || 0)
        : undefined;

      return {
        orderId: orderIdNum,
        status: (order.escrowStatus || "holding") as EscrowStatus["status"],
        amount: payment?.amount || order.totalAmount,
        currency: payment?.currency || "KWD",
        heldSince,
        canAutoRelease,
        autoReleaseDate,
        releaseConditions: [
          "تأكيد الاستلام من المشتري",
          `التحرير التلقائي بعد ${AUTO_RELEASE_DAYS} أيام (${autoReleaseDate.toLocaleDateString("ar-KW")})`,
          "حل النزاع",
        ],
        split,
      };
    } catch (error) {
      console.error("[Escrow] getStatus error:", error);
      throw error;
    }
  }

  // ───────────────────────────────────────────
  // CALCULATE SPLIT
  // ───────────────────────────────────────────

  /**
   * Calculate escrow split: seller, platform, JASIM
   */
  async calculateSplit(
    amount: number,
    commission: number = 0
  ): Promise<{
    seller: number;
    platform: number;
    jasim: number;
  }> {
    return this.calculateSplitRaw(amount, commission);
  }

  private calculateSplitRaw(
    amount: number,
    commission: number = 0
  ): {
    seller: number;
    platform: number;
    jasim: number;
  } {
    const platformAmount = commission > 0
      ? commission
      : amount * this.splitConfig.platformRate;
    const jasimAmount = amount * this.splitConfig.jasimRate;
    const sellerAmount = amount - platformAmount - jasimAmount;

    return {
      seller: Math.round(sellerAmount * 100) / 100,
      platform: Math.round(platformAmount * 100) / 100,
      jasim: Math.round(jasimAmount * 100) / 100,
    };
  }

  // ───────────────────────────────────────────
  // HELPER METHODS
  // ───────────────────────────────────────────

  private async logEscrowEvent(
    orderId: number,
    event: string,
    reason: string,
    split?: { seller: number; platform: number; jasim: number },
    details?: string
  ): Promise<void> {
    try {
      await db.insert(schema.agentLogs).values({
        agentName: "escrow",
        intent: event,
        input: `order:${orderId}`,
        output: JSON.stringify({ reason, split, details }),
        createdAt: new Date(),
      });
    } catch (error) {
      console.error("[Escrow] logEscrowEvent error:", error);
    }
  }

  /**
   * Get all pending escrows (for admin/ops)
   */
  async getPendingEscrows(marketCode?: string): Promise<{
    orderId: number;
    amount: number;
    currency: string;
    heldSince: Date;
    daysHeld: number;
  }[]> {
    try {
      const conditions = [eq(schema.orders.escrowStatus, "holding")];

      if (marketCode) {
        // We need to join with payments for marketCode
      }

      const orders = await db
        .select()
        .from(schema.orders)
        .where(and(...conditions))
        .orderBy(schema.orders.createdAt);

      return orders.map((o) => {
        const heldSince = o.createdAt;
        const daysHeld = (new Date().getTime() - heldSince.getTime()) / (1000 * 60 * 60 * 24);

        return {
          orderId: Number(o.id),
          amount: o.totalAmount,
          currency: "KWD",
          heldSince,
          daysHeld: Math.floor(daysHeld),
        };
      });
    } catch (error) {
      console.error("[Escrow] getPendingEscrows error:", error);
      return [];
    }
  }

  /**
   * Get escrow statistics for a market
   */
  async getEscrowStats(marketCode: string): Promise<{
    totalHeld: number;
    totalReleased: number;
    totalDisputed: number;
    totalRefunded: number;
    avgHoldDays: number;
  }> {
    try {
      const payments = await db
        .select()
        .from(schema.payments)
        .where(eq(schema.payments.marketCode, marketCode));

      let totalHeld = 0;
      let totalReleased = 0;
      let totalDisputed = 0;
      let totalRefunded = 0;
      let totalHoldDays = 0;
      let countHeld = 0;

      for (const p of payments) {
        switch (p.escrowStatus) {
          case "holding":
            totalHeld += p.amount;
            totalHoldDays += (new Date().getTime() - p.createdAt.getTime()) / (1000 * 60 * 60 * 24);
            countHeld++;
            break;
          case "released":
            totalReleased += p.amount;
            break;
          case "disputed":
            totalDisputed += p.amount;
            break;
          case "refunded":
            totalRefunded += p.amount;
            break;
        }
      }

      return {
        totalHeld: Math.round(totalHeld * 100) / 100,
        totalReleased: Math.round(totalReleased * 100) / 100,
        totalDisputed: Math.round(totalDisputed * 100) / 100,
        totalRefunded: Math.round(totalRefunded * 100) / 100,
        avgHoldDays: countHeld > 0 ? Math.round((totalHoldDays / countHeld) * 10) / 10 : 0,
      };
    } catch (error) {
      console.error("[Escrow] getEscrowStats error:", error);
      return { totalHeld: 0, totalReleased: 0, totalDisputed: 0, totalRefunded: 0, avgHoldDays: 0 };
    }
  }
}
