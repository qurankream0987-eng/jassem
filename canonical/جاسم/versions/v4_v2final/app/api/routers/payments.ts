import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { payments, orders } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";
import { EscrowManager } from "../core/escrow";

export const paymentsRouter = createRouter({
  create: authedQuery
    .input(z.object({
      orderId: z.number(),
      amount: z.number().positive(),
      currency: z.string().default("KWD"),
      gateway: z.enum(["knet", "apple_pay", "google_pay", "cash", "card"]),
      merchantId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [payment] = await db.insert(payments).values({
        userId: ctx.user.id,
        orderId: input.orderId,
        merchantId: input.merchantId || null,
        amount: input.amount,
        currency: input.currency,
        gateway: input.gateway,
        status: "pending",
        escrowStatus: "holding",
      }).$returningId();
      return { success: true, paymentId: payment.id };
    }),

  process: authedQuery
    .input(z.object({
      paymentId: z.number(),
      transactionRef: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.update(payments).set({
        status: "completed",
        transactionRef: input.transactionRef,
      }).where(eq(payments.id, input.paymentId));
      return { success: true };
    }),

  // ── ESCROW INTEGRATION ──────────────────────────

  escrowHold: authedQuery
    .input(z.object({
      orderId: z.number(),
      amount: z.number().positive(),
      currency: z.string().default("KWD"),
      gateway: z.enum(["knet", "apple_pay", "google_pay", "cash", "card"]).default("knet"),
      merchantId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      const result = await escrow.hold({
        orderId: input.orderId,
        userId: ctx.user.id,
        merchantId: input.merchantId,
        amount: input.amount,
        currency: input.currency,
        gateway: input.gateway,
        marketCode: ctx.user.market || "KW",
      });
      return { success: true, escrow: result, message: "تم حجز المبلغ في الضمان بنجاح 🔒" };
    }),

  escrowRelease: authedQuery
    .input(z.object({
      orderId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      await escrow.releaseOnDelivery(input.orderId);
      return { success: true, message: "تم تحرير الضمان بعد تأكيد التوصيل ✅" };
    }),

  escrowDispute: authedQuery
    .input(z.object({
      orderId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      await escrow.holdForDispute(input.orderId, input.reason);
      return {
        success: true,
        message: "تم فتح نزاع على الضمان. سيقوم فريقنا بالمراجعة خلال 24 ساعة ⚖️",
      };
    }),

  escrowResolveDispute: authedQuery
    .input(z.object({
      orderId: z.string(),
      winner: z.enum(["buyer", "seller"]),
      resolution: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      await escrow.releaseAfterDispute(input.orderId, input.winner, input.resolution);
      const winnerAr = input.winner === "buyer" ? "المشتري" : "البائع";
      return {
        success: true,
        message: `تم حل النزاع — الفائز: ${winnerAr} ✅`,
      };
    }),

  escrowAutoRelease: authedQuery
    .input(z.object({
      orderId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      await escrow.autoRelease(input.orderId);
      return { success: true, message: "تم التحرير التلقائي بعد 7 أيام ⏱️" };
    }),

  escrowStatus: authedQuery
    .input(z.object({
      orderId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      const status = await escrow.getStatus(input.orderId);
      return status;
    }),

  escrowSplit: authedQuery
    .input(z.object({
      amount: z.number().positive(),
      commission: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      const split = await escrow.calculateSplit(input.amount, input.commission);
      return split;
    }),

  escrowStats: authedQuery
    .query(async ({ ctx }) => {
      const escrow = new EscrowManager(ctx.user.market || "KW");
      const stats = await escrow.getEscrowStats(ctx.user.market || "KW");

      // Also get user-specific stats
      const userPayments = await db.select().from(payments)
        .where(eq(payments.userId, ctx.user.id));

      const holding = userPayments.filter(p => p.escrowStatus === "holding").reduce((s, p) => s + p.amount, 0);
      const released = userPayments.filter(p => p.escrowStatus === "released").reduce((s, p) => s + p.amount, 0);
      const disputed = userPayments.filter(p => p.escrowStatus === "disputed").reduce((s, p) => s + p.amount, 0);

      return { holding, released, disputed, totalPayments: userPayments.length, marketStats: stats };
    }),

  // ── REFUND & AUTH ───────────────────────────────

  refund: authedQuery
    .input(z.object({
      paymentId: z.number(),
      amount: z.number().positive().optional(),
      reason: z.string(),
    }))
    .mutation(async ({ input }) => {
      const updateData: Record<string, unknown> = {
        status: "refunded",
        escrowStatus: "refunded",
        refundReason: input.reason,
      };
      if (input.amount) {
        updateData.refundAmount = input.amount;
      }
      await db.update(payments).set(updateData).where(eq(payments.id, input.paymentId));
      return { success: true, message: "تم معالجة الاسترداد 💰" };
    }),

  biometricAuth: authedQuery
    .input(z.object({
      paymentId: z.number(),
      verified: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await db.update(payments).set({
        biometricVerified: input.verified,
      }).where(eq(payments.id, input.paymentId));
      return { success: true, biometricVerified: input.verified };
    }),

  get: authedQuery
    .input(z.object({ paymentId: z.number() }))
    .query(async ({ input }) => {
      const [payment] = await db.select().from(payments)
        .where(eq(payments.id, input.paymentId)).limit(1);
      return payment || null;
    }),

  list: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(payments.userId, ctx.user.id)];
      if (input?.marketCode) {
        conditions.push(eq(payments.marketCode, input.marketCode));
      }
      if (input?.status) {
        conditions.push(eq(payments.status, input.status as "pending" | "processing" | "completed" | "failed" | "refunded"));
      }
      return await db.select().from(payments)
        .where(and(...conditions))
        .orderBy(desc(payments.createdAt))
        .limit(50);
    }),
});
