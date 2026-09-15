import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { products } from "@db/schema";
import { eq, desc, like, and } from "drizzle-orm";

export const productsRouter = createRouter({
  create: publicQuery
    .input(z.object({
      merchantId: z.number(),
      name: z.string(),
      description: z.string().optional(),
      price: z.number(),
      currency: z.string().default("KWD"),
      category: z.string().optional(),
      imageUrl: z.string().optional(),
      stock: z.number().default(0),
      barcode: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const [product] = await db.insert(products).values(input).$returningId();
      return { success: true, productId: product.id };
    }),

  list: publicQuery
    .input(z.object({
      merchantId: z.number().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.merchantId) {
        conditions.push(eq(products.merchantId, input.merchantId));
      }
      if (input?.category) {
        conditions.push(eq(products.category, input.category));
      }
      if (input?.search) {
        conditions.push(like(products.name, `%${input.search}%`));
      }
      
      if (conditions.length > 0) {
        return await db.select().from(products)
          .where(and(...conditions))
          .orderBy(desc(products.createdAt))
          .limit(50);
      }
      return await db.select().from(products).orderBy(desc(products.createdAt)).limit(50);
    }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [product] = await db.select().from(products).where(eq(products.id, input.id)).limit(1);
      return product || null;
    }),
});
