import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { suppliers, products } from "@db/schema";
import { eq, and, desc, like } from "drizzle-orm";

export const suppliersRouter = createRouter({
  list: publicQuery
    .input(z.object({
      marketCode: z.string().optional(),
      country: z.string().optional(),
      businessType: z.string().optional(),
      search: z.string().optional(),
      isVerified: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.marketCode) {
        conditions.push(eq(suppliers.marketCode, input.marketCode));
      }
      if (input?.country) {
        conditions.push(eq(suppliers.country, input.country));
      }
      if (input?.businessType) {
        conditions.push(eq(suppliers.businessType, input.businessType as "manufacturer" | "distributor" | "wholesaler" | "importer" | "exporter" | "other"));
      }
      if (input?.isVerified !== undefined) {
        conditions.push(eq(suppliers.isVerified, input.isVerified));
      }
      if (input?.search) {
        conditions.push(like(suppliers.businessName, `%${input.search}%`));
      }

      if (conditions.length > 0) {
        return await db.select().from(suppliers)
          .where(and(...conditions))
          .orderBy(desc(suppliers.createdAt))
          .limit(50);
      }
      return await db.select().from(suppliers).orderBy(desc(suppliers.createdAt)).limit(50);
    }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [supplier] = await db.select().from(suppliers)
        .where(eq(suppliers.id, input.id)).limit(1);
      return supplier || null;
    }),

  register: authedQuery
    .input(z.object({
      businessName: z.string().min(1),
      contactName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      country: z.string().default("KW"),
      marketCode: z.string().default("KW"),
      businessType: z.enum(["manufacturer", "distributor", "wholesaler", "importer", "exporter", "other"]).default("other"),
      documents: z.array(z.record(z.string(), z.string())).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const docs = input.documents ? input.documents as Record<string, string>[] : null;
      const [supplier] = await db.insert(suppliers).values({
        userId: ctx.user.id,
        businessName: input.businessName,
        contactName: input.contactName || null,
        email: input.email || null,
        phone: input.phone || null,
        country: input.country,
        marketCode: input.marketCode,
        businessType: input.businessType,
        kycStatus: "pending",
        documents: docs,
      }).$returningId();
      return { success: true, supplierId: supplier.id };
    }),

  products: publicQuery
    .input(z.object({
      supplierId: z.number(),
      category: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const [supplier] = await db.select().from(suppliers)
        .where(eq(suppliers.id, input.supplierId)).limit(1);
      if (!supplier) throw new Error("المورد غير موجود");

      const conditions = [eq(products.merchantId, supplier.userId)];
      if (input.category) {
        conditions.push(eq(products.category, input.category));
      }
      return await db.select().from(products)
        .where(and(...conditions))
        .limit(50);
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      businessName: z.string().min(1).optional(),
      contactName: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      country: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const updateData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) updateData[key] = value;
      }

      await db.update(suppliers).set(updateData)
        .where(and(eq(suppliers.id, id), eq(suppliers.userId, ctx.user.id)));
      return { success: true };
    }),

  verify: authedQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["pending", "approved", "rejected"]),
    }))
    .mutation(async ({ input }) => {
      await db.update(suppliers).set({
        kycStatus: input.status,
        isVerified: input.status === "approved",
      }).where(eq(suppliers.id, input.id));
      return { success: true, verified: input.status === "approved" };
    }),

  stats: authedQuery
    .query(async ({ ctx }) => {
      const userSuppliers = await db.select().from(suppliers)
        .where(eq(suppliers.userId, ctx.user.id));

      const totalSuppliers = userSuppliers.length;
      const verifiedSuppliers = userSuppliers.filter(s => s.isVerified).length;
      const totalRevenue = userSuppliers.reduce((sum, s) => sum + (s.totalRevenue || 0), 0);
      const totalOrders = userSuppliers.reduce((sum, s) => sum + (s.totalOrders || 0), 0);

      return { totalSuppliers, verifiedSuppliers, totalRevenue, totalOrders };
    }),
});
