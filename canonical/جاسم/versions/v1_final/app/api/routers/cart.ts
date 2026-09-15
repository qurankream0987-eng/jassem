import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { cartItems, products } from "@db/schema";
import { eq, and } from "drizzle-orm";

export const cartRouter = createRouter({
  get: authedQuery
    .input(z.object({ marketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const items = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, ctx.user.id), eq(cartItems.marketId, input.marketId)));
      return { items };
    }),

  add: authedQuery
    .input(z.object({
      marketId: z.string(),
      productId: z.number(),
      quantity: z.number().min(1),
      variantId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.insert(cartItems).values({
        userId: ctx.user.id,
        marketId: input.marketId,
        productId: input.productId,
        quantity: input.quantity,
        variantId: input.variantId || null,
      });
      return { success: true };
    }),

  update: authedQuery
    .input(z.object({
      itemId: z.number(),
      quantity: z.number().min(0),
    }))
    .mutation(async ({ input }) => {
      if (input.quantity === 0) {
        await db.delete(cartItems).where(eq(cartItems.id, input.itemId));
      } else {
        await db.update(cartItems).set({ quantity: input.quantity })
          .where(eq(cartItems.id, input.itemId));
      }
      return { success: true };
    }),

  remove: authedQuery
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(cartItems).where(eq(cartItems.id, input.itemId));
      return { success: true };
    }),

  clear: authedQuery
    .input(z.object({ marketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db.delete(cartItems).where(
        and(eq(cartItems.userId, ctx.user.id), eq(cartItems.marketId, input.marketId))
      );
      return { success: true };
    }),

  checkout: authedQuery
    .input(z.object({
      marketId: z.string(),
      deliveryAddress: z.record(z.string(), z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      const items = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, ctx.user.id), eq(cartItems.marketId, input.marketId)));

      if (items.length === 0) throw new Error("السلة فارغة");

      // TODO: Create order from cart items, then clear cart
      return { success: true, orderId: "temp-order-id" };
    }),
});
