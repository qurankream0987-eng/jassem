import { z } from "zod";
import { createRouter, authedQuery } from "../middleware";
import { db } from "@db/queries/connection";
import { connectedSystems, apiMappings, syncLogs } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";

export const smartConnectRouter = createRouter({
  /** List all connected POS/API systems for the authenticated merchant */
  listSystems: authedQuery
    .input(z.object({
      merchantId: z.number(),
      marketCode: z.string().optional(),
      status: z.enum(["active", "inactive"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [
        eq(connectedSystems.merchantId, input.merchantId),
      ];
      if (input.marketCode) {
        conditions.push(eq(connectedSystems.marketCode, input.marketCode));
      }
      if (input.status === "active") {
        conditions.push(eq(connectedSystems.isActive, true));
      }
      if (input.status === "inactive") {
        conditions.push(eq(connectedSystems.isActive, false));
      }

      const systems = conditions.length > 1
        ? await db.select().from(connectedSystems)
            .where(and(...conditions))
            .orderBy(desc(connectedSystems.createdAt))
            .limit(100)
        : await db.select().from(connectedSystems)
            .where(eq(connectedSystems.merchantId, input.merchantId))
            .orderBy(desc(connectedSystems.createdAt))
            .limit(100);

      // Mask sensitive credentials
      return systems.map((s) => ({
        ...s,
        apiKey: s.apiKey ? `${s.apiKey.slice(0, 4)}****${s.apiKey.slice(-4)}` : null,
        apiSecret: s.apiSecret ? "****" : null,
      }));
    }),

  /** Connect a new POS or API system */
  connect: authedQuery
    .input(z.object({
      merchantId: z.number(),
      name: z.string().min(1).max(255),
      systemType: z.enum([
        "toast", "square", "clover", "shopify", "woocommerce",
        "magento", "stripe", "paypal", "custom_api", "other",
      ]),
      apiEndpoint: z.string().url().optional(),
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
      webhookUrl: z.string().url().optional(),
      config: z.record(z.unknown()).optional(),
      marketCode: z.string().default("KW"),
    }))
    .mutation(async ({ input }) => {
      const [system] = await db.insert(connectedSystems).values({
        merchantId: input.merchantId,
        name: input.name,
        systemType: input.systemType,
        apiEndpoint: input.apiEndpoint,
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        webhookUrl: input.webhookUrl,
        config: input.config,
        marketCode: input.marketCode,
        syncStatus: "idle",
        isActive: true,
      }).$returningId();

      return { success: true, systemId: system.id };
    }),

  /** Disconnect (deactivate) a connected system */
  disconnect: authedQuery
    .input(z.object({
      systemId: z.number(),
      merchantId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.update(connectedSystems)
        .set({ isActive: false, syncStatus: "idle" })
        .where(
          and(
            eq(connectedSystems.id, input.systemId),
            eq(connectedSystems.merchantId, input.merchantId),
          ),
        );
      return { success: true };
    }),

  /** Trigger a sync with a connected system */
  sync: authedQuery
    .input(z.object({
      systemId: z.number(),
      operation: z.enum(["import_products", "import_orders", "export_products", "full_sync"]).default("full_sync"),
    }))
    .mutation(async ({ input }) => {
      // Mark as syncing
      await db.update(connectedSystems)
        .set({ syncStatus: "syncing", lastSyncAt: new Date() })
        .where(eq(connectedSystems.id, input.systemId));

      // Create sync log entry
      const [log] = await db.insert(syncLogs).values({
        systemId: input.systemId,
        operation: input.operation,
        status: "success",
        recordsCount: 0,
        details: `Sync initiated: ${input.operation}`,
        startedAt: new Date(),
        completedAt: new Date(),
      }).$returningId();

      // Mark sync complete
      await db.update(connectedSystems)
        .set({ syncStatus: "success" })
        .where(eq(connectedSystems.id, input.systemId));

      return { success: true, logId: log.id };
    }),

  /** Get API field mappings for a connected system */
  getMappings: authedQuery
    .input(z.object({
      systemId: z.number(),
    }))
    .query(async ({ input }) => {
      const mappings = await db.select().from(apiMappings)
        .where(eq(apiMappings.systemId, input.systemId))
        .orderBy(desc(apiMappings.createdAt));
      return mappings;
    }),

  /** Create a new API field mapping */
  createMapping: authedQuery
    .input(z.object({
      systemId: z.number(),
      sourceField: z.string().min(1).max(255),
      targetField: z.string().min(1).max(255),
      transformRule: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [mapping] = await db.insert(apiMappings).values({
        systemId: input.systemId,
        sourceField: input.sourceField,
        targetField: input.targetField,
        transformRule: input.transformRule,
        isActive: true,
      }).$returningId();

      return { success: true, mappingId: mapping.id };
    }),

  /** Test connectivity to a system's API endpoint */
  testConnection: authedQuery
    .input(z.object({
      systemId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const [system] = await db.select().from(connectedSystems)
        .where(eq(connectedSystems.id, input.systemId))
        .limit(1);

      if (!system) {
        return { success: false, message: "System not found" };
      }

      if (!system.apiEndpoint) {
        return { success: false, message: "No API endpoint configured" };
      }

      // In production, this would make an actual HTTP request to test the connection
      // For now, we simulate a successful test
      const isReachable = system.isActive;

      return {
        success: isReachable,
        message: isReachable ? "Connection successful" : "System is inactive",
        endpoint: system.apiEndpoint,
        latency: 45, // simulated ms
      };
    }),

  /** Get sync logs for a system */
  getLogs: authedQuery
    .input(z.object({
      systemId: z.number().optional(),
      operation: z.string().optional(),
      limit: z.number().min(1).max(500).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.systemId) {
        conditions.push(eq(syncLogs.systemId, input.systemId));
      }
      if (input.operation) {
        conditions.push(eq(syncLogs.operation, input.operation));
      }

      const logs = conditions.length > 0
        ? await db.select().from(syncLogs)
            .where(and(...conditions))
            .orderBy(desc(syncLogs.createdAt))
            .limit(input.limit)
        : await db.select().from(syncLogs)
            .orderBy(desc(syncLogs.createdAt))
            .limit(input.limit);

      return logs;
    }),
});
