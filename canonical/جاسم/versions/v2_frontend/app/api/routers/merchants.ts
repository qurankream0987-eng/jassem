import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { merchants } from "@db/schema";
import { eq, desc } from "drizzle-orm";

export const merchantsRouter = createRouter({
  create: publicQuery
    .input(z.object({
      userId: z.number(),
      businessName: z.string(),
      businessType: z.enum([
        "restaurant", "pharmacy", "clothing", "grocery",
        "electronics", "salon", "real_estate", "workshop",
        "bookstore", "wholesale", "clinic", "other",
      ]),
      crNumber: z.string().optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const [merchant] = await db.insert(merchants).values(input).$returningId();
      return { success: true, merchantId: merchant.id };
    }),

  list: publicQuery
    .input(z.object({
      marketCode: z.string().optional(),
      type: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      if (input?.marketCode) {
        return await db.select().from(merchants)
          .where(eq(merchants.marketCode, input.marketCode))
          .orderBy(desc(merchants.createdAt))
          .limit(50);
      }
      return await db.select().from(merchants).orderBy(desc(merchants.createdAt)).limit(50);
    }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, input.id)).limit(1);
      return merchant || null;
    }),

  update: publicQuery
    .input(z.object({
      id: z.number(),
      businessName: z.string().optional(),
      subscriptionTier: z.enum(["starter", "pro", "enterprise", "ultimate"]).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(merchants).set(data).where(eq(merchants.id, id));
      return { success: true };
    }),
});
