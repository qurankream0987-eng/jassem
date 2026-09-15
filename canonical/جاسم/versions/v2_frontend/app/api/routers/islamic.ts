import { z } from "zod";
import { createRouter, publicQuery, authedQuery, adminQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { islamicProductChecks, products, nisabSettings, zakatCalculations } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";

// Non-halal keywords for product scanning
const NON_HALAL_KEYWORDS = [
  "pork", "ham", "bacon", "lard", "gelatin", "wine", "beer", "alcohol",
  "whiskey", "rum", "vodka", "interest", "riba", "لحم خنزير", "خمر", "نبيذ", "كحول",
];

function checkHalalByName(name: string): { isHalal: boolean; flagged: string[] } {
  const lowerName = name.toLowerCase();
  const flagged = NON_HALAL_KEYWORDS.filter(kw => lowerName.includes(kw.toLowerCase()));
  return { isHalal: flagged.length === 0, flagged };
}

export const islamicRouter = createRouter({
  checkProduct: publicQuery
    .input(z.object({
      productId: z.number(),
    }))
    .query(async ({ input }) => {
      const [product] = await db.select().from(products)
        .where(eq(products.id, input.productId)).limit(1);
      if (!product) throw new Error("المنتج غير موجود");

      const nameCheck = checkHalalByName(product.name);
      const categoryFlagged = product.category
        ? NON_HALAL_KEYWORDS.some(kw => product.category!.toLowerCase().includes(kw))
        : false;
      const tags = (product.tags as string[]) || [];
      const tagFlagged = tags.some(tag =>
        NON_HALAL_KEYWORDS.some(kw => tag.toLowerCase().includes(kw))
      );

      const isHalal = nameCheck.isHalal && !categoryFlagged && !tagFlagged;
      const allFlagged = [...nameCheck.flagged];
      if (categoryFlagged && product.category) allFlagged.push(product.category);
      if (tagFlagged) allFlagged.push(...tags.filter(t => NON_HALAL_KEYWORDS.some(kw => t.toLowerCase().includes(kw))));

      // Record the check
      await db.insert(islamicProductChecks).values({
        productId: product.id,
        productName: product.name,
        category: product.category || null,
        tags: product.tags,
        isHalal,
        confidence: isHalal ? 1.0 : 0.7,
        flaggedIngredients: allFlagged.length > 0 ? allFlagged : null,
        checkMethod: "scan",
        marketCode: "KW",
      }).$returningId();

      return { productId: product.id, productName: product.name, isHalal, flagged: allFlagged, confidence: isHalal ? 1.0 : 0.7 };
    }),

  calculateZakat: authedQuery
    .input(z.object({
      totalAssets: z.number().nonnegative(),
      totalLiabilities: z.number().nonnegative().default(0),
      goldPriceGram: z.number().positive(),
      silverPriceGram: z.number().positive(),
      marketCode: z.string().default("KW"),
      yearHijri: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [nisab] = await db.select().from(nisabSettings)
        .where(eq(nisabSettings.marketCode, input.marketCode))
        .orderBy(desc(nisabSettings.effectiveDate))
        .limit(1);

      const nisabThreshold = nisab?.nisabThreshold || (input.goldPriceGram * 85);
      const netWealth = input.totalAssets - input.totalLiabilities;
      const zakatRate = 0.025;
      const zakatPayable = netWealth >= nisabThreshold ? netWealth * zakatRate : 0;
      const qualifies = netWealth >= nisabThreshold;

      const [calc] = await db.insert(zakatCalculations).values({
        merchantId: ctx.user.id,
        yearHijri: input.yearHijri,
        nisabThreshold,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        netWealth,
        zakatPayable,
        zakatRate,
        goldPriceGram: input.goldPriceGram,
        silverPriceGram: input.silverPriceGram,
        marketCode: input.marketCode,
        status: "draft",
      }).$returningId();

      return {
        success: true,
        calculationId: calc.id,
        netWealth,
        nisabThreshold,
        qualifies,
        zakatRate,
        zakatPayable,
        currency: "KWD",
      };
    }),

  getNisab: publicQuery
    .input(z.object({ marketCode: z.string() }))
    .query(async ({ input }) => {
      const [nisab] = await db.select().from(nisabSettings)
        .where(eq(nisabSettings.marketCode, input.marketCode))
        .orderBy(desc(nisabSettings.effectiveDate))
        .limit(1);

      if (!nisab) {
        return {
          marketCode: input.marketCode,
          nisabThreshold: 0,
          goldPriceGram: 0,
          silverPriceGram: 0,
          goldNisabGrams: 85,
          silverNisabGrams: 595,
          currency: "KWD",
        };
      }

      return {
        marketCode: nisab.marketCode,
        nisabThreshold: nisab.nisabThreshold,
        goldPriceGram: nisab.goldPriceGram,
        silverPriceGram: nisab.silverPriceGram,
        goldNisabGrams: nisab.goldNisabGrams,
        silverNisabGrams: nisab.silverNisabGrams,
        currency: nisab.currency,
      };
    }),

  halalFilter: publicQuery
    .input(z.object({
      mode: z.enum(["strict", "lenient"]).default("strict"),
      marketCode: z.string().optional(),
      category: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.marketCode) {
        conditions.push(eq(islamicProductChecks.marketCode, input.marketCode));
      }
      if (input.category) {
        conditions.push(eq(islamicProductChecks.category, input.category));
      }
      if (input.mode === "strict") {
        conditions.push(eq(islamicProductChecks.isHalal, true));
        conditions.push(eq(islamicProductChecks.confidence, 1.0));
      } else {
        conditions.push(eq(islamicProductChecks.isHalal, true));
      }

      if (conditions.length > 0) {
        return await db.select().from(islamicProductChecks)
          .where(and(...conditions))
          .orderBy(desc(islamicProductChecks.createdAt))
          .limit(100);
      }
      return await db.select().from(islamicProductChecks)
        .orderBy(desc(islamicProductChecks.createdAt))
        .limit(100);
    }),

  murabahaCalc: publicQuery
    .input(z.object({
      principal: z.number().positive(),
      profitRate: z.number().nonnegative().default(5),
      periodMonths: z.number().int().positive().default(12),
    }))
    .query(async ({ input }) => {
      // Islamic murabaha: cost + agreed profit margin, no riba (interest)
      const profitAmount = input.principal * (input.profitRate / 100);
      const totalRepayment = input.principal + profitAmount;
      const monthlyInstallment = totalRepayment / input.periodMonths;

      return {
        principal: input.principal,
        profitRate: input.profitRate,
        profitAmount: Math.round(profitAmount * 100) / 100,
        totalRepayment: Math.round(totalRepayment * 100) / 100,
        periodMonths: input.periodMonths,
        monthlyInstallment: Math.round(monthlyInstallment * 100) / 100,
        isRibaFree: true,
        structure: "murabaha",
      };
    }),

  markZakatPaid: authedQuery
    .input(z.object({
      calculationId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.update(zakatCalculations)
        .set({ status: "paid" })
        .where(eq(zakatCalculations.id, input.calculationId));
      return { success: true, message: "تم تسجيل الزكاة كمدفوعة" };
    }),

  listZakat: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(zakatCalculations.merchantId, ctx.user.id)];
      if (input?.marketCode) {
        conditions.push(eq(zakatCalculations.marketCode, input.marketCode));
      }
      if (input?.status) {
        conditions.push(eq(zakatCalculations.status, input.status as "draft" | "confirmed" | "paid"));
      }
      return await db.select().from(zakatCalculations)
        .where(and(...conditions))
        .orderBy(desc(zakatCalculations.createdAt))
        .limit(50);
    }),

  updateNisab: adminQuery
    .input(z.object({
      marketCode: z.string(),
      goldPriceGram: z.number().positive(),
      silverPriceGram: z.number().positive(),
      goldNisabGrams: z.number().positive().default(85),
      silverNisabGrams: z.number().positive().default(595),
      currency: z.string().default("KWD"),
    }))
    .mutation(async ({ ctx, input }) => {
      const goldNisabValue = input.goldPriceGram * input.goldNisabGrams;
      const silverNisabValue = input.silverPriceGram * input.silverNisabGrams;
      const nisabThreshold = Math.min(goldNisabValue, silverNisabValue);

      const [nisab] = await db.insert(nisabSettings).values({
        marketCode: input.marketCode,
        goldPriceGram: input.goldPriceGram,
        silverPriceGram: input.silverPriceGram,
        goldNisabGrams: input.goldNisabGrams,
        silverNisabGrams: input.silverNisabGrams,
        nisabThreshold,
        currency: input.currency,
        updatedBy: ctx.user.id,
      }).$returningId();

      return {
        success: true,
        nisabId: nisab.id,
        nisabThreshold,
        goldNisabValue,
        silverNisabValue,
      };
    }),
});
