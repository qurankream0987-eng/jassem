import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { haggleSessions, haggleOffers } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";

export const haggleRouter = createRouter({
  start: authedQuery
    .input(z.object({
      merchantId: z.number(),
      productId: z.number(),
      originalPrice: z.number().positive(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ ctx, input }) => {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      const [session] = await db.insert(haggleSessions).values({
        buyerId: ctx.user.id,
        merchantId: input.merchantId,
        productId: input.productId,
        originalPrice: input.originalPrice,
        currentPrice: input.originalPrice,
        concessionRange: { min: 0.02, max: 0.08 },
        status: "active",
        expiresAt,
        marketCode: input.marketCode,
      }).$returningId();

      return { success: true, sessionId: session.id, expiresAt };
    }),

  offer: authedQuery
    .input(z.object({
      sessionId: z.number(),
      offerPrice: z.number().positive(),
      message: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await db.select().from(haggleSessions)
        .where(and(
          eq(haggleSessions.id, input.sessionId),
          eq(haggleSessions.buyerId, ctx.user.id),
        )).limit(1);
      if (!session) throw new Error("جلسة التفاوض غير موجودة");
      if (session.status !== "active") throw new Error("الجلسة غير نشطة");

      // AI counter-offer using diminishing concession (2% -> 8%)
      const range = session.concessionRange as { min: number; max: number } | null;
      const minConcession = range?.min || 0.02;
      const maxConcession = range?.max || 0.08;
      const randomConcession = minConcession + Math.random() * (maxConcession - minConcession);
      const counterPrice = Math.round(input.offerPrice * (1 - randomConcession) * 100) / 100;

      await db.insert(haggleOffers).values({
        sessionId: input.sessionId,
        offeredBy: "buyer",
        offerPrice: input.offerPrice,
        counterPrice,
        message: input.message || null,
        concessionPercent: Math.round(randomConcession * 10000) / 100,
      });

      await db.update(haggleSessions)
        .set({ currentPrice: counterPrice })
        .where(eq(haggleSessions.id, input.sessionId));

      return {
        success: true,
        buyerOffer: input.offerPrice,
        aiCounterOffer: counterPrice,
        concessionPercent: Math.round(randomConcession * 10000) / 100,
        message: "الذكاء الاصطناعي قدم عرضاً مضاداً",
      };
    }),

  respond: authedQuery
    .input(z.object({
      sessionId: z.number(),
      counterPrice: z.number().positive(),
      message: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.insert(haggleOffers).values({
        sessionId: input.sessionId,
        offeredBy: "merchant",
        offerPrice: input.counterPrice,
        message: input.message || null,
      });

      await db.update(haggleSessions)
        .set({ currentPrice: input.counterPrice })
        .where(eq(haggleSessions.id, input.sessionId));

      return { success: true, merchantCounter: input.counterPrice };
    }),

  accept: authedQuery
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await db.select().from(haggleSessions)
        .where(and(
          eq(haggleSessions.id, input.sessionId),
          eq(haggleSessions.buyerId, ctx.user.id),
        )).limit(1);
      if (!session) throw new Error("جلسة التفاوض غير موجودة");

      await db.update(haggleSessions)
        .set({ status: "accepted", finalPrice: session.currentPrice })
        .where(eq(haggleSessions.id, input.sessionId));

      return { success: true, finalPrice: session.currentPrice, message: "تم قبول الصفقة" };
    }),

  reject: authedQuery
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [session] = await db.select().from(haggleSessions)
        .where(and(
          eq(haggleSessions.id, input.sessionId),
          eq(haggleSessions.buyerId, ctx.user.id),
        )).limit(1);
      if (!session) throw new Error("جلسة التفاوض غير موجودة");

      await db.update(haggleSessions)
        .set({ status: "rejected" })
        .where(eq(haggleSessions.id, input.sessionId));

      return { success: true, message: "تم رفض الصفقة" };
    }),

  history: authedQuery
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const [session] = await db.select().from(haggleSessions)
        .where(eq(haggleSessions.id, input.sessionId)).limit(1);
      if (!session) throw new Error("جلسة التفاوض غير موجودة");

      const offers = await db.select().from(haggleOffers)
        .where(eq(haggleOffers.sessionId, input.sessionId))
        .orderBy(haggleOffers.createdAt);

      return { session, offers };
    }),

  list: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(haggleSessions.buyerId, ctx.user.id)];
      if (input?.marketCode) {
        conditions.push(eq(haggleSessions.marketCode, input.marketCode));
      }
      if (input?.status) {
        conditions.push(eq(haggleSessions.status, input.status as "active" | "accepted" | "rejected" | "expired"));
      }
      return await db.select().from(haggleSessions)
        .where(and(...conditions))
        .orderBy(desc(haggleSessions.createdAt))
        .limit(50);
    }),
});
