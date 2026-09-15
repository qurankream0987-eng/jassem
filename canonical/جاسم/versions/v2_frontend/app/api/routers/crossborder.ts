import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { crossborderOrders, products, suppliers } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";

export const crossborderRouter = createRouter({
  listProducts: publicQuery
    .input(z.object({
      originCountry: z.string().optional(),
      category: z.string().optional(),
      marketCode: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.marketCode) {
        conditions.push(eq(products.merchantId, 0)); // placeholder: filter by cross-border enabled
      }
      if (input?.category) {
        conditions.push(eq(products.category, input.category));
      }
      if (conditions.length > 0) {
        return await db.select().from(products)
          .where(and(...conditions))
          .orderBy(desc(products.createdAt))
          .limit(50);
      }
      return await db.select().from(products).orderBy(desc(products.createdAt)).limit(50);
    }),

  createOrder: authedQuery
    .input(z.object({
      supplierId: z.number(),
      productIds: z.array(z.number()).min(1),
      totalAmount: z.number().positive(),
      originCountry: z.string(),
      destinationCountry: z.string(),
      currency: z.string().default("KWD"),
      marketCode: z.string().default("KW"),
      murabahaRate: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const customsRate = 0.05;
      const shippingRate = 0.03;
      const customsFees = input.totalAmount * customsRate;
      const shippingFees = input.totalAmount * shippingRate;
      const murabahaAmount = input.totalAmount * (input.murabahaRate / 100);
      const totalCost = input.totalAmount + customsFees + shippingFees + murabahaAmount;

      const [order] = await db.insert(crossborderOrders).values({
        buyerId: ctx.user.id,
        supplierId: input.supplierId,
        productIds: input.productIds,
        totalAmount: input.totalAmount,
        currency: input.currency,
        customsFees,
        shippingFees,
        murabahaRate: input.murabahaRate,
        murabahaAmount,
        totalCost,
        status: "draft",
        trackingStage: "order_placed",
        originCountry: input.originCountry,
        destinationCountry: input.destinationCountry,
        marketCode: input.marketCode,
      }).$returningId();

      return {
        success: true,
        orderId: order.id,
        breakdown: { subtotal: input.totalAmount, customsFees, shippingFees, murabahaAmount, totalCost },
      };
    }),

  calculateFees: publicQuery
    .input(z.object({
      amount: z.number().positive(),
      murabahaRate: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const customsRate = 0.05;
      const shippingRate = 0.03;
      const customsFees = input.amount * customsRate;
      const shippingFees = input.amount * shippingRate;
      const murabahaAmount = input.amount * (input.murabahaRate / 100);
      const totalCost = input.amount + customsFees + shippingFees + murabahaAmount;

      return {
        subtotal: input.amount,
        customsFees,
        shippingFees,
        murabahaAmount,
        totalCost,
        customsRate,
        shippingRate,
      };
    }),

  track: publicQuery
    .input(z.object({ orderId: z.number() }))
    .query(async ({ input }) => {
      const [order] = await db.select().from(crossborderOrders)
        .where(eq(crossborderOrders.id, input.orderId)).limit(1);
      if (!order) throw new Error("الطلب غير موجود");

      const pipeline = [
        { stage: "order_placed", label: "تم تقديم الطلب", completed: true },
        { stage: "payment_received", label: "تم استلام الدفع", completed: ["payment_received", "customs_cleared", "origin_shipped", "in_transit", "destination_arrived", "delivered"].includes(order.trackingStage || "") },
        { stage: "customs_cleared", label: "تم تخليص الجمارك", completed: ["customs_cleared", "origin_shipped", "in_transit", "destination_arrived", "delivered"].includes(order.trackingStage || "") },
        { stage: "origin_shipped", label: "تم الشحن من المصدر", completed: ["origin_shipped", "in_transit", "destination_arrived", "delivered"].includes(order.trackingStage || "") },
        { stage: "in_transit", label: "في مرحلة النقل", completed: ["in_transit", "destination_arrived", "delivered"].includes(order.trackingStage || "") },
        { stage: "destination_arrived", label: "وصل إلى الوجهة", completed: ["destination_arrived", "delivered"].includes(order.trackingStage || "") },
        { stage: "delivered", label: "تم التسليم", completed: order.trackingStage === "delivered" },
      ];

      return { orderId: order.id, currentStage: order.trackingStage, pipeline };
    }),

  documents: authedQuery
    .input(z.object({
      orderId: z.number(),
      documentTypes: z.array(z.enum([
        "proforma", "commercial", "origin", "customs", "packing", "murabaha"
      ])),
    }))
    .mutation(async ({ input }) => {
      const [order] = await db.select().from(crossborderOrders)
        .where(eq(crossborderOrders.id, input.orderId)).limit(1);
      if (!order) throw new Error("الطلب غير موجود");

      const docs: Record<string, string> = {};
      for (const docType of input.documentTypes) {
        docs[docType] = `doc_${docType}_${order.id}_${Date.now()}.pdf`;
      }

      await db.update(crossborderOrders)
        .set({ tradeDocumentUrls: docs })
        .where(eq(crossborderOrders.id, input.orderId));

      return { success: true, documents: docs };
    }),

  confirm: authedQuery
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ input }) => {
      await db.update(crossborderOrders)
        .set({ status: "confirmed" })
        .where(eq(crossborderOrders.id, input.orderId));
      return { success: true, message: "تم تأكيد الطلب" };
    }),

  list: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(crossborderOrders.buyerId, ctx.user.id)];
      if (input?.marketCode) {
        conditions.push(eq(crossborderOrders.marketCode, input.marketCode));
      }
      if (input?.status) {
        conditions.push(eq(crossborderOrders.status, input.status as "draft" | "proforma" | "confirmed" | "customs_processing" | "in_transit" | "arrived" | "delivered" | "cancelled"));
      }
      return await db.select().from(crossborderOrders)
        .where(and(...conditions))
        .orderBy(desc(crossborderOrders.createdAt))
        .limit(50);
    }),
});
