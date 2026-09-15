import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { zakatCalculations, zakatAssets, merchants } from "@db/schema";
import { eq, desc, and, gte } from "drizzle-orm";

// Market-specific Nisab configurations (gold price per gram * 85g)
const NISAB_CONFIG: Record<string, { goldPriceGram: number; silverPriceGram: number; currency: string }> = {
  KW: { goldPriceGram: 25.5, silverPriceGram: 0.35, currency: "KWD" },
  SA: { goldPriceGram: 280, silverPriceGram: 3.2, currency: "SAR" },
  AE: { goldPriceGram: 275, silverPriceGram: 3.15, currency: "AED" },
  QA: { goldPriceGram: 270, silverPriceGram: 3.1, currency: "QAR" },
  BH: { goldPriceGram: 28, silverPriceGram: 0.38, currency: "BHD" },
  OM: { goldPriceGram: 29, silverPriceGram: 0.4, currency: "OMR" },
  EG: { goldPriceGram: 3800, silverPriceGram: 42, currency: "EGP" },
  JO: { goldPriceGram: 52, silverPriceGram: 0.6, currency: "JOD" },
  IQ: { goldPriceGram: 125000, silverPriceGram: 1450, currency: "IQD" },
  LB: { goldPriceGram: 95000, silverPriceGram: 1100, currency: "LBP" },
  YE: { goldPriceGram: 18000, silverPriceGram: 210, currency: "YER" },
  SY: { goldPriceGram: 650000, silverPriceGram: 7500, currency: "SYP" },
  PS: { goldPriceGram: 260, silverPriceGram: 3.0, currency: "ILS" },
  SD: { goldPriceGram: 55000, silverPriceGram: 630, currency: "SDG" },
  LY: { goldPriceGram: 400, silverPriceGram: 4.5, currency: "LYD" },
};

function getNisabThreshold(marketCode: string): {
  goldNisab: number;
  silverNisab: number;
  goldPriceGram: number;
  silverPriceGram: number;
  currency: string;
} {
  const config = NISAB_CONFIG[marketCode] || NISAB_CONFIG["KW"];
  // Nisab = 85g gold or 595g silver (use gold standard)
  return {
    goldNisab: Math.round(config.goldPriceGram * 85 * 100) / 100,
    silverNisab: Math.round(config.silverPriceGram * 595 * 100) / 100,
    goldPriceGram: config.goldPriceGram,
    silverPriceGram: config.silverPriceGram,
    currency: config.currency,
  };
}

export const zakatRouter = createRouter({
  // Get Nisab threshold for market
  getNisab: publicQuery
    .input(z.object({
      marketCode: z.string().default("KW"),
    }))
    .query(({ input }) => {
      const nisab = getNisabThreshold(input.marketCode);
      return {
        marketCode: input.marketCode,
        ...nisab,
        // Hijri year approximation (1445-1446)
        yearHijri: 1446,
        note: "Nisab based on 85g gold standard",
      };
    }),

  // Calculate zakat on merchant earnings/assets
  calculate: authedQuery
    .input(z.object({
      merchantId: z.number(),
      yearHijri: z.number().default(1446),
      totalAssets: z.number().default(0),
      totalLiabilities: z.number().default(0),
      marketCode: z.string().default("KW"),
      goldPriceGram: z.number().optional(),
      silverPriceGram: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const nisab = getNisabThreshold(input.marketCode);
      const goldPrice = input.goldPriceGram || nisab.goldPriceGram;
      const silverPrice = input.silverPriceGram || nisab.silverPriceGram;
      const nisabThreshold = Math.round(goldPrice * 85 * 100) / 100;

      const netWealth = input.totalAssets - input.totalLiabilities;
      const zakatRate = 0.025; // 2.5% standard rate
      const zakatPayable = netWealth >= nisabThreshold ? Math.round(netWealth * zakatRate * 100) / 100 : 0;

      const [calculation] = await db.insert(zakatCalculations).values({
        merchantId: input.merchantId,
        yearHijri: input.yearHijri,
        nisabThreshold,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        netWealth: Math.round(netWealth * 100) / 100,
        zakatPayable,
        zakatRate,
        goldPriceGram: goldPrice,
        silverPriceGram: silverPrice,
        marketCode: input.marketCode,
        currency: nisab.currency,
        notes: input.notes,
      }).$returningId();

      return {
        success: true,
        calculationId: calculation.id,
        merchantId: input.merchantId,
        yearHijri: input.yearHijri,
        marketCode: input.marketCode,
        currency: nisab.currency,
        breakdown: {
          totalAssets: input.totalAssets,
          totalLiabilities: input.totalLiabilities,
          netWealth: Math.round(netWealth * 100) / 100,
          nisabThreshold,
          isAboveNisab: netWealth >= nisabThreshold,
          zakatRate: `${zakatRate * 100}%`,
          zakatPayable,
          goldPriceGram: goldPrice,
          silverPriceGram: silverPrice,
        },
      };
    }),

  // Get zakat calculation history
  getHistory: authedQuery
    .input(z.object({
      merchantId: z.number(),
      yearHijri: z.number().optional(),
      marketCode: z.string().optional(),
      status: z.enum(["draft", "confirmed", "paid"]).optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(zakatCalculations.merchantId, input.merchantId)];
      if (input.yearHijri) {
        conditions.push(eq(zakatCalculations.yearHijri, input.yearHijri));
      }
      if (input.marketCode) {
        conditions.push(eq(zakatCalculations.marketCode, input.marketCode));
      }
      if (input.status) {
        conditions.push(eq(zakatCalculations.status, input.status));
      }

      const calculations = conditions.length > 0
        ? await db.select().from(zakatCalculations)
            .where(and(...conditions))
            .orderBy(desc(zakatCalculations.createdAt))
        : await db.select().from(zakatCalculations)
            .orderBy(desc(zakatCalculations.createdAt));

      return calculations;
    }),

  // Generate zakat report
  generateReport: authedQuery
    .input(z.object({
      calculationId: z.number(),
    }))
    .query(async ({ input }) => {
      const [calculation] = await db.select()
        .from(zakatCalculations)
        .where(eq(zakatCalculations.id, input.calculationId))
        .limit(1);

      if (!calculation) {
        return { success: false, error: "Calculation not found" };
      }

      // Get associated assets
      const assets = await db.select()
        .from(zakatAssets)
        .where(eq(zakatAssets.calculationId, input.calculationId));

      const zakatableAssets = assets.filter(a => a.isZakatable);
      const nonZakatableAssets = assets.filter(a => !a.isZakatable);

      return {
        success: true,
        report: {
          title: `Zakat Report ${calculation.yearHijri}H`,
          generatedAt: new Date().toISOString(),
          calculationId: calculation.id,
          merchantId: calculation.merchantId,
          marketCode: calculation.marketCode,
          currency: calculation.currency,
          yearHijri: calculation.yearHijri,
          summary: {
            totalAssets: calculation.totalAssets,
            totalLiabilities: calculation.totalLiabilities,
            netWealth: calculation.netWealth,
            nisabThreshold: calculation.nisabThreshold,
            isAboveNisab: (calculation.netWealth || 0) >= (calculation.nisabThreshold || 0),
            zakatRate: `${(calculation.zakatRate || 0.025) * 100}%`,
            zakatPayable: calculation.zakatPayable,
            status: calculation.status,
          },
          assetBreakdown: {
            zakatable: zakatableAssets.map(a => ({
              type: a.assetType,
              description: a.description,
              value: a.value,
              quantity: a.quantity,
              unitPrice: a.unitPrice,
            })),
            nonZakatable: nonZakatableAssets.map(a => ({
              type: a.assetType,
              description: a.description,
              value: a.value,
            })),
            zakatableTotal: zakatableAssets.reduce((s, a) => s + a.value, 0),
            nonZakatableTotal: nonZakatableAssets.reduce((s, a) => s + a.value, 0),
          },
          pricing: {
            goldPriceGram: calculation.goldPriceGram,
            silverPriceGram: calculation.silverPriceGram,
          },
          notes: calculation.notes,
        },
      };
    }),

  // Track merchant assets for zakat
  trackAssets: authedQuery
    .input(z.object({
      merchantId: z.number(),
      calculationId: z.number().optional(),
      assets: z.array(z.object({
        assetType: z.enum([
          "cash", "gold", "silver", "inventory", "receivables",
          "investments", "real_estate", "crypto", "business_assets", "other",
        ]),
        description: z.string().optional(),
        value: z.number(),
        quantity: z.number().optional(),
        unitPrice: z.number().optional(),
        isZakatable: z.boolean().default(true),
      })),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const results = [];
      for (const asset of input.assets) {
        const [result] = await db.insert(zakatAssets).values({
          merchantId: input.merchantId,
          calculationId: input.calculationId,
          assetType: asset.assetType,
          description: asset.description,
          value: asset.value,
          quantity: asset.quantity,
          unitPrice: asset.unitPrice,
          isZakatable: asset.isZakatable,
          marketCode: input.marketCode,
        }).$returningId();
        results.push({ id: result.id, assetType: asset.assetType, value: asset.value });
      }

      // Calculate totals
      const totalZakatable = input.assets
        .filter(a => a.isZakatable)
        .reduce((sum, a) => sum + a.value, 0);
      const totalNonZakatable = input.assets
        .filter(a => !a.isZakatable)
        .reduce((sum, a) => sum + a.value, 0);

      return {
        success: true,
        merchantId: input.merchantId,
        trackedAssets: results.length,
        summary: {
          totalZakatable,
          totalNonZakatable,
          grandTotal: totalZakatable + totalNonZakatable,
        },
        assets: results,
      };
    }),

  // Update zakat calculation status
  updateStatus: authedQuery
    .input(z.object({
      calculationId: z.number(),
      status: z.enum(["draft", "confirmed", "paid"]),
    }))
    .mutation(async ({ input }) => {
      await db.update(zakatCalculations)
        .set({ status: input.status })
        .where(eq(zakatCalculations.id, input.calculationId));
      return { success: true, calculationId: input.calculationId, status: input.status };
    }),
});
