import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { orders, payments } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";
import { EscrowManager } from "../core/escrow";

export const ordersRouter = createRouter({
  create: publicQuery
    .input(z.object({
      userId: z.number(),
      merchantId: z.number(),
      productIds: z.array(z.number()),
      totalAmount: z.number(),
      paymentMethod: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const commission = input.totalAmount * 0.025;
      const [order] = await db.insert(orders).values({
        ...input,
        commission,
        status: "pending",
        escrowStatus: "holding",
        paymentStatus: "pending",
      }).$returningId();
      return { success: true, orderId: order.id, commission };
    }),

  list: publicQuery
    .input(z.object({
      userId: z.number().optional(),
      merchantId: z.number().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      if (input?.userId) {
        return await db.select().from(orders)
          .where(eq(orders.userId, input.userId))
          .orderBy(desc(orders.createdAt))
          .limit(50);
      }
      if (input?.merchantId) {
        return await db.select().from(orders)
          .where(eq(orders.merchantId, input.merchantId))
          .orderBy(desc(orders.createdAt))
          .limit(50);
      }
      return await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(50);
    }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [order] = await db.select().from(orders).where(eq(orders.id, input.id)).limit(1);
      return order || null;
    }),

  // ── STATUS UPDATE WITH ESCROW TRIGGERS ──────────────────

  updateStatus: authedQuery
    .input(z.object({
      id: z.number(),
      status: z.enum([
        "pending", "confirmed", "processing", "shipped",
        "delivered", "cancelled", "returned",
      ]),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      // Get current order state
      const [order] = await db.select().from(orders)
        .where(eq(orders.id, input.id))
        .limit(1);

      if (!order) {
        throw new Error("الطلب غير موجود");
      }

      const previousStatus = order.status;
      const escrow = new EscrowManager(input.marketCode);

      // Update order status
      await db.update(orders).set({
        status: input.status,
        updatedAt: new Date(),
      }).where(eq(orders.id, input.id));

      // ── ESCROW TRIGGERS ──────────────────────────────

      // Trigger 1: Auto-release on delivery
      if (input.status === "delivered" && previousStatus !== "delivered") {
        try {
          // Auto-release escrow
          await escrow.releaseOnDelivery(String(input.id));
        } catch (err) {
          // If release fails, still allow status update
          console.error("[Orders] Escrow release failed:", err);
        }
      }

      // Trigger 2: Auto-release after shipped (initiate timer)
      if (input.status === "shipped" && previousStatus !== "shipped") {
        try {
          // Update delivery ETA
          const eta = new Date();
          eta.setDate(eta.getDate() + 1); // Next day delivery estimate
          await db.update(orders).set({
            deliveryEta: eta,
          }).where(eq(orders.id, input.id));
        } catch (err) {
          console.error("[Orders] Shipping update failed:", err);
        }
      }

      // Trigger 3: Handle cancellation
      if (input.status === "cancelled" && previousStatus !== "cancelled") {
        try {
          // Refund the escrow
          const [payment] = await db.select().from(payments)
            .where(eq(payments.orderId, input.id))
            .limit(1);

          if (payment && payment.escrowStatus === "holding") {
            await db.update(payments).set({
              escrowStatus: "refunded",
              status: "refunded",
              refundReason: "order_cancelled",
              refundAmount: payment.amount,
            }).where(eq(payments.id, payment.id));
          }
        } catch (err) {
          console.error("[Orders] Cancellation refund failed:", err);
        }
      }

      // Trigger 4: Handle returns
      if (input.status === "returned" && previousStatus !== "returned") {
        try {
          // Open dispute for return
          await escrow.holdForDispute(String(input.id), "order_returned");
        } catch (err) {
          console.error("[Orders] Return dispute failed:", err);
        }
      }

      return {
        success: true,
        orderId: input.id,
        previousStatus,
        newStatus: input.status,
        escrowAction: getEscrowActionMessage(input.status, previousStatus),
      };
    }),

  // ── ESCROW-SPECIFIC ORDER OPERATIONS ────────────────────

  confirmDelivery: authedQuery
    .input(z.object({
      orderId: z.number(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      // Update order to delivered
      await db.update(orders).set({
        status: "delivered",
        updatedAt: new Date(),
      }).where(eq(orders.id, input.orderId));

      // Release escrow
      const escrow = new EscrowManager(input.marketCode);
      try {
        await escrow.releaseOnDelivery(String(input.orderId));
      } catch {
        // May already be released or not held
      }

      return {
        success: true,
        message: "تم تأكيد الاستلام وتحرير الضمان ✅",
        orderId: input.orderId,
      };
    }),

  cancelWithRefund: authedQuery
    .input(z.object({
      orderId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Update order to cancelled
      await db.update(orders).set({
        status: "cancelled",
        updatedAt: new Date(),
      }).where(eq(orders.id, input.orderId));

      // Refund payment
      const [payment] = await db.select().from(payments)
        .where(eq(payments.orderId, input.orderId))
        .limit(1);

      if (payment) {
        await db.update(payments).set({
          escrowStatus: "refunded",
          status: "refunded",
          refundReason: input.reason || "order_cancelled_by_user",
          refundAmount: payment.amount,
        }).where(eq(payments.id, payment.id));
      }

      return {
        success: true,
        message: "تم إلغاء الطلب واسترداد المبلغ 💰",
        orderId: input.orderId,
        refundAmount: payment?.amount || 0,
      };
    }),

  requestReturn: authedQuery
    .input(z.object({
      orderId: z.number(),
      reason: z.string(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      // Update order to returned
      await db.update(orders).set({
        status: "returned",
        updatedAt: new Date(),
      }).where(eq(orders.id, input.orderId));

      // Open dispute
      const escrow = new EscrowManager(input.marketCode);
      try {
        await escrow.holdForDispute(String(input.orderId), input.reason);
      } catch {
        // May already be disputed
      }

      return {
        success: true,
        message: "تم تقديم طلب الإرجاع وفتح نزاع — فريقنا سيراجع خلال 24 ساعة 📦",
        orderId: input.orderId,
      };
    }),

  // ── ADMIN OPERATIONS ────────────────────────────────────

  processAutoReleases: authedQuery
    .input(z.object({
      marketCode: z.string().default("KW"),
    }).optional())
    .mutation(async ({ input }) => {
      const escrow = new EscrowManager(input?.marketCode || "KW");
      const result = await escrow.processAutoReleases();
      return {
        success: true,
        processed: result.processed,
        released: result.released,
        errors: result.errors,
        message: `تم معالجة ${result.processed} ضمان — تحرير ${result.released} بنجاح`,
      };
    }),

  pendingEscrows: authedQuery
    .query(async ({ ctx }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      const pending = await escrow.getPendingEscrows(ctx.user.market || undefined);
      return pending;
    }),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getEscrowActionMessage(
  newStatus: string,
  previousStatus: string
): string | null {
  const transitions: Record<string, string> = {
    "pending-delivered": "تحرير الضمان بعد التوصيل ✅",
    "confirmed-delivered": "تحرير الضمان بعد التوصيل ✅",
    "processing-delivered": "تحرير الضمان بعد التوصيل ✅",
    "shipped-delivered": "تحرير الضمان بعد التوصيل ✅",
    "pending-cancelled": "استرداد المبلغ بعد الإلغاء 💰",
    "confirmed-cancelled": "استرداد المبلغ بعد الإلغاء 💰",
    "processing-cancelled": "استرداد المبلغ بعد الإلغاء 💰",
    "pending-returned": "فتح نزاع بعد الإرجاع ⚖️",
    "confirmed-returned": "فتح نزاع بعد الإرجاع ⚖️",
    "processing-returned": "فتح نزاع بعد الإرجاع ⚖️",
    "shipped-returned": "فتح نزاع بعد الإرجاع ⚖️",
    "delivered-returned": "فتح نزاع بعد الإرجاع ⚖️",
  };

  return transitions[`${previousStatus}-${newStatus}`] || null;
}
