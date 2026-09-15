/**
 * Database Query Router - JASIM
 * Routes queries to correct tables based on agent type and intent
 * Uses Drizzle ORM with sql tag for complex queries
 */

import { z } from "zod";
import { eq, and, desc, sql, like, gte, lte } from "drizzle-orm";
import { db } from "@db/queries/connection";
import * as schema from "@db/schema";
import type { AgentType, IntentType, ParsedIntent } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  invalidAgent: "نوع الوكيل غير صالح",
  queryFailed: "فشل في تنفيذ الاستعلام",
  tableNotFound: "الجدول غير موجود",
  invalidIntent: "النية غير صالحة",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

export const QueryRouterInputSchema = z.object({
  agentType: z.string(),
  intent: z.object({
    type: z.string(),
    entities: z.record(z.string()),
    marketCode: z.string(),
  }),
  marketCode: z.string().default("KW"),
  limit: z.number().default(20),
});

// ============================================
// AGENT → TABLE MAPPING
// ============================================

interface TableMapping {
  primaryTable: keyof typeof schema;
  relatedTables: Array<keyof typeof schema>;
  defaultColumns: string[];
  filters: Record<string, string>;
}

const AGENT_TABLE_MAP: Record<string, TableMapping> = {
  food: {
    primaryTable: "merchants",
    relatedTables: ["products", "orders"],
    defaultColumns: ["id", "businessName", "businessType", "marketCode", "isActive"],
    filters: { businessType: "restaurant" },
  },
  fashion: {
    primaryTable: "products",
    relatedTables: ["merchants"],
    defaultColumns: ["id", "name", "price", "currency", "category", "stock", "isHalal"],
    filters: { category: "clothing" },
  },
  grocery: {
    primaryTable: "products",
    relatedTables: ["merchants", "cartItems"],
    defaultColumns: ["id", "name", "price", "currency", "category", "stock"],
    filters: { category: "grocery" },
  },
  pharmacy: {
    primaryTable: "products",
    relatedTables: ["merchants", "orders"],
    defaultColumns: ["id", "name", "price", "currency", "category", "stock"],
    filters: { category: "pharmacy" },
  },
  delivery: {
    primaryTable: "orders",
    relatedTables: ["driverAssignments", "drivers"],
    defaultColumns: ["id", "status", "totalAmount", "trackingNumber", "deliveryEta"],
    filters: {},
  },
  b2b_supplier: {
    primaryTable: "suppliers",
    relatedTables: ["crossborderOrders", "products"],
    defaultColumns: ["id", "businessName", "businessType", "country", "rating"],
    filters: {},
  },
  cross_border: {
    primaryTable: "crossborderOrders",
    relatedTables: ["suppliers"],
    defaultColumns: ["id", "status", "totalCost", "originCountry", "destinationCountry"],
    filters: {},
  },
  haggle: {
    primaryTable: "haggleSessions",
    relatedTables: ["haggleOffers", "products"],
    defaultColumns: ["id", "originalPrice", "currentPrice", "finalPrice", "status"],
    filters: {},
  },
  fleet: {
    primaryTable: "drivers",
    relatedTables: ["driverAssignments", "sosAlerts"],
    defaultColumns: ["id", "fullName", "status", "vehicleType", "rating", "currentLat", "currentLng"],
    filters: {},
  },
  recruitment: {
    primaryTable: "jobPosts",
    relatedTables: ["candidates", "jobApplications"],
    defaultColumns: ["id", "title", "salaryMin", "salaryMax", "location", "isActive"],
    filters: {},
  },
  financial: {
    primaryTable: "payments",
    relatedTables: ["orders", "zakatCalculations"],
    defaultColumns: ["id", "amount", "currency", "gateway", "status", "escrowStatus"],
    filters: {},
  },
  smart_connect: {
    primaryTable: "connectedSystems",
    relatedTables: ["apiMappings", "syncLogs"],
    defaultColumns: ["id", "name", "systemType", "syncStatus", "lastSyncAt"],
    filters: {},
  },
  gen_saas: {
    primaryTable: "saasTemplates",
    relatedTables: ["saasInstances", "saasWorkflows"],
    defaultColumns: ["id", "name", "category", "pricingMonthly", "isActive"],
    filters: {},
  },
  gen_aggregator: {
    primaryTable: "aggregatorPlatforms",
    relatedTables: ["aggregatorVendors"],
    defaultColumns: ["id", "name", "status", "commissionGlobal", "marketCode"],
    filters: {},
  },
  widget: {
    primaryTable: "widgets",
    relatedTables: ["widgetEvents"],
    defaultColumns: ["id", "name", "widgetType", "isActive", "marketCode"],
    filters: {},
  },
  a2a: {
    primaryTable: "a2aAgents",
    relatedTables: ["a2aListings", "a2aTransactions"],
    defaultColumns: ["id", "name", "agentType", "listingPrice", "isListed"],
    filters: {},
  },
  analytics: {
    primaryTable: "analytics",
    relatedTables: ["merchants", "orders"],
    defaultColumns: ["id", "metric", "value", "category", "date"],
    filters: {},
  },
  mentor: {
    primaryTable: "users",
    relatedTables: ["memory", "chats"],
    defaultColumns: ["id", "name", "email", "role", "market"],
    filters: {},
  },
  vision: {
    primaryTable: "visionScans",
    relatedTables: ["products"],
    defaultColumns: ["id", "scanType", "confidence", "status"],
    filters: {},
  },
  voice: {
    primaryTable: "voiceSessions",
    relatedTables: [],
    defaultColumns: ["id", "sessionType", "detectedDialect", "confidence"],
    filters: {},
  },
};

// ============================================
// INTENT → FILTER MAPPING
// ============================================

function buildFilters(
  mapping: TableMapping,
  intent: ParsedIntent,
  marketCode: string
): SQL[] {
  const conditions: SQL[] = [];

  // Market filter (always applied)
  const marketField = sql`${schema[mapping.primaryTable]}.marketCode`;
  conditions.push(sql`${marketField} = ${marketCode}`);

  // Agent-specific filters
  for (const [key, value] of Object.entries(mapping.filters)) {
    const col = sql`${schema[mapping.primaryTable]}.${sql.raw(key)}`;
    conditions.push(sql`${col} = ${value}`);
  }

  // Intent entity filters
  if (intent.entities.price) {
    const priceMatch = intent.entities.price.match(/(\d+(?:\.\d+)?)/);
    if (priceMatch) {
      const price = parseFloat(priceMatch[1]);
      conditions.push(sql`${schema[mapping.primaryTable]}.price <= ${price}`);
    }
  }

  if (intent.entities.product) {
    conditions.push(
      sql`${schema[mapping.primaryTable]}.name LIKE ${`%${intent.entities.product}%`}`
    );
  }

  if (intent.entities.location) {
    conditions.push(
      sql`${schema[mapping.primaryTable]}.location = ${intent.entities.location}`
    );
  }

  return conditions;
}

// ============================================
// MAIN QUERY FUNCTIONS
// ============================================

import type { SQL } from "drizzle-orm";

/**
 * Query the database based on agent type and intent
 * Routes to the correct tables and applies appropriate filters
 */
export async function queryDatabase(
  agentType: AgentType,
  intent: ParsedIntent,
  marketCode: string
): Promise<Record<string, unknown>> {
  try {
    const mapping = AGENT_TABLE_MAP[agentType];
    if (!mapping) {
      // Fallback: query products table
      return queryFallback(intent, marketCode);
    }

    const conditions = buildFilters(mapping, intent, marketCode);

    // Execute primary query
    const primaryResults = await db
      .select()
      .from(schema[mapping.primaryTable])
      .where(and(...conditions))
      .limit(20);

    // Execute related queries in parallel
    const relatedResults: Record<string, unknown[]> = {};
    if (mapping.relatedTables.length > 0) {
      const relatedPromises = mapping.relatedTables.map(async (tableName) => {
        const tbl = schema[tableName];
        const hasMarketCode = "marketCode" in tbl;
        const results = await db
          .select()
          .from(tbl)
          .where(
            hasMarketCode
              ? and(sql`${tbl}.marketCode = ${marketCode}`)
              : sql`1=1`
          )
          .limit(10);
        return { table: tableName as string, results };
      });

      const settled = await Promise.allSettled(relatedPromises);
      for (const result of settled) {
        if (result.status === "fulfilled") {
          relatedResults[result.value.table] = result.value.results;
        }
      }
    }

    return {
      primary: primaryResults,
      related: relatedResults,
      agentType,
      intent: intent.type,
      marketCode,
      totalCount: primaryResults.length,
    };
  } catch (error) {
    console.error("[DatabaseQuery] queryDatabase error:", error);
    return queryFallback(intent, marketCode);
  }
}

/**
 * Execute a raw SQL query with proper parameterization
 * Uses Drizzle's sql tag for type safety
 */
export async function executeRawQuery<T = Record<string, unknown>>(
  queryTemplate: SQL,
  params?: unknown[]
): Promise<T[]> {
  try {
    const result = await db.execute(queryTemplate);
    return result[0] as T[] || [];
  } catch (error) {
    console.error("[DatabaseQuery] executeRawQuery error:", error);
    return [];
  }
}

/**
 * Get aggregated analytics for a merchant
 */
export async function getMerchantAnalytics(
  merchantId: number,
  metric: string,
  days: number = 30
): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await db
      .select({
        total: sql<number>`SUM(${schema.analytics.value})`,
      })
      .from(schema.analytics)
      .where(
        and(
          eq(schema.analytics.merchantId, merchantId),
          eq(schema.analytics.metric, metric),
          gte(schema.analytics.date, cutoff)
        )
      );

    return result[0]?.total || 0;
  } catch (error) {
    console.error("[DatabaseQuery] getMerchantAnalytics error:", error);
    return 0;
  }
}

/**
 * Search products across merchants with filters
 */
export async function searchProducts(
  query: string,
  marketCode: string,
  options?: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    isHalal?: boolean;
    limit?: number;
  }
): Promise<schema.Product[]> {
  try {
    const conditions: SQL[] = [
      eq(schema.products.marketCode, marketCode),
      like(schema.products.name, `%${query}%`),
    ];

    if (options?.category) {
      conditions.push(eq(schema.products.category, options.category));
    }
    if (options?.minPrice !== undefined) {
      conditions.push(gte(schema.products.price, options.minPrice));
    }
    if (options?.maxPrice !== undefined) {
      conditions.push(lte(schema.products.price, options.maxPrice));
    }
    if (options?.isHalal !== undefined) {
      conditions.push(eq(schema.products.isHalal, options.isHalal));
    }

    return await db
      .select()
      .from(schema.products)
      .where(and(...conditions))
      .limit(options?.limit || 20);
  } catch (error) {
    console.error("[DatabaseQuery] searchProducts error:", error);
    return [];
  }
}

/**
 * Get order summary for a user
 */
export async function getUserOrderSummary(
  userId: number,
  marketCode: string
): Promise<{
  totalOrders: number;
  activeOrders: number;
  totalSpent: number;
  recentOrders: schema.Order[];
}> {
  try {
    const userOrders = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.userId, userId),
          eq(schema.orders.marketCode, marketCode)
        )
      )
      .orderBy(desc(schema.orders.createdAt));

    const activeStatuses = ["pending", "confirmed", "processing", "shipped"];
    const activeOrders = userOrders.filter((o) =>
      activeStatuses.includes(o.status)
    );

    const totalSpent = userOrders
      .filter((o) => o.status === "delivered" || o.status === "shipped")
      .reduce((sum, o) => sum + o.totalAmount, 0);

    return {
      totalOrders: userOrders.length,
      activeOrders: activeOrders.length,
      totalSpent,
      recentOrders: userOrders.slice(0, 5),
    };
  } catch (error) {
    console.error("[DatabaseQuery] getUserOrderSummary error:", error);
    return { totalOrders: 0, activeOrders: 0, totalSpent: 0, recentOrders: [] };
  }
}

/**
 * Get nearby available drivers
 */
export async function getNearbyDrivers(
  marketCode: string,
  lat?: number,
  lng?: number,
  radiusKm: number = 10
): Promise<schema.Driver[]> {
  try {
    const conditions = [
      eq(schema.drivers.marketCode, marketCode),
      eq(schema.drivers.status, "available"),
      eq(schema.drivers.isActive, true),
    ];

    // If coordinates provided, use distance approximation
    if (lat && lng) {
      // Approximate: 1 degree ~ 111km
      const degRadius = radiusKm / 111;
      return await db
        .select()
        .from(schema.drivers)
        .where(
          and(
            ...conditions,
            sql`${schema.drivers.currentLat} BETWEEN ${lat - degRadius} AND ${lat + degRadius}`,
            sql`${schema.drivers.currentLng} BETWEEN ${lng - degRadius} AND ${lng + degRadius}`
          )
        )
        .limit(20);
    }

    return await db
      .select()
      .from(schema.drivers)
      .where(and(...conditions))
      .limit(20);
  } catch (error) {
    console.error("[DatabaseQuery] getNearbyDrivers error:", error);
    return [];
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function queryFallback(
  intent: ParsedIntent,
  marketCode: string
): Promise<Record<string, unknown>> {
  try {
    // Try products as the most general fallback
    const results = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.marketCode, marketCode))
      .limit(10);

    return {
      primary: results,
      agentType: "unknown",
      intent: intent.type,
      marketCode,
      fallback: true,
    };
  } catch (error) {
    console.error("[DatabaseQuery] queryFallback error:", error);
    return {
      primary: [],
      agentType: "unknown",
      intent: intent.type,
      marketCode,
      error: true,
    };
  }
}
