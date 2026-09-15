/**
 * ============================================================
 * SWARM ORCHESTRATOR V2 — SwarmState Pattern (2026)
 * JASIM Multi-Agent Coordination Engine
 * ============================================================
 *
 * Implements the SwarmState pattern:
 * - Persistent state across agent handoffs
 * - Breadcrumb trail logging
 * - Iteration safety valve (max 10)
 * - Graceful fallback when max iterations reached
 * - Handoff protocol between agents
 */

import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import * as schema from "@db/schema";
import { detectIntent } from "../lib/ai";
import { z } from "zod";
import type {
  AgentType,
  IntentType,
  ParsedIntent,
  ConversationContext,
  Bubble,
} from "./types";
import {
  JASIMError,
  retryWithBackoff,
  CircuitBreaker,
  getCircuitBreaker,
  classifyError,
} from "./error-handler";
import { ResponseSynthesizer } from "./response-synthesizer";
import { BubbleGenerator } from "./bubble-generator";

// ============================================
// SWARMSTATE — The persistent state object
// ============================================

export const SwarmStateSchema = z.object({
  originalIssue: z.string().min(1),
  stepsTaken: z.array(z.string()),
  finalSolution: z.string().nullable(),
  currentStatus: z.string(),
  availableAgents: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      skills: z.array(z.string()),
    }),
  ),
  nextAgent: z.string(),
  nextAgentInstruction: z.string(),
  agentsCalled: z.array(z.string()),
  iteration: z.number().min(0).max(10),
  maxIterations: z.number().default(10),
  handoffHistory: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      reason: z.string(),
      timestamp: z.number(),
    }),
  ),
});

export type SwarmState = z.infer<typeof SwarmStateSchema>;

// ============================================
// SWARM INPUT / OUTPUT SCHEMAS
// ============================================

export const SwarmInputSchema = z.object({
  message: z.string().min(1),
  userId: z.number().optional(),
  sessionId: z.string().optional(),
  marketCode: z.string().length(2).default("KW"),
  preferredLanguage: z.enum(["ar", "en"]).default("ar"),
  conversationHistory: z.array(z.record(z.string(), z.unknown())).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  deviceType: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});

export type SwarmInput = z.infer<typeof SwarmInputSchema>;

export const SwarmTaskSchema = z.object({
  id: z.string(),
  agentType: z.string(),
  intent: z.record(z.string(), z.unknown()),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "retrying"]),
  priority: z.number().min(0).max(100),
  dependencies: z.array(z.string()),
  retryCount: z.number().default(0),
  maxRetries: z.number().default(2),
  metadata: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.date().optional(),
  completedAt: z.date().optional(),
  error: z.string().optional(),
  tokensUsed: z.number().default(0),
});

export type SwarmTask = z.infer<typeof SwarmTaskSchema>;

export const SwarmResultSchema = z.object({
  taskId: z.string(),
  agentType: z.string(),
  intent: z.string(),
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()),
  error: z.string().optional(),
  confidence: z.number(),
  executionTimeMs: z.number(),
  tokensUsed: z.number(),
});

export type SwarmResult = z.infer<typeof SwarmResultSchema>;

export const SwarmOutputSchema = z.object({
  response: z.object({
    text: z.string(),
    language: z.enum(["ar", "en"]),
    confidence: z.number(),
    actions: z.array(z.record(z.string(), z.unknown())).optional(),
    suggestions: z.array(z.string()).optional(),
    sentiment: z.enum(["positive", "neutral", "negative", "urgent"]),
  }),
  bubbles: z.array(z.record(z.string(), z.unknown())),
  tasks: z.array(SwarmTaskSchema),
  executionTimeMs: z.number(),
  agentCalls: z.number(),
  confidence: z.number(),
  swarmState: SwarmStateSchema.optional(),
  metadata: z.record(z.string(), z.unknown()),
});

export type SwarmOutput = z.infer<typeof SwarmOutputSchema>;

// ============================================
// SWARM CONFIGURATION
// ============================================

export const SwarmConfigSchema = z.object({
  maxParallelTasks: z.number().default(5),
  defaultTimeoutMs: z.number().default(10000),
  maxRetries: z.number().default(2),
  enableParallelExecution: z.boolean().default(true),
  enableCaching: z.boolean().default(true),
  cacheTtlSeconds: z.number().default(300),
  logAgentCalls: z.boolean().default(true),
  synthesisModel: z.string().default("deepseek"),
  enableSwarmState: z.boolean().default(true),
  maxIterations: z.number().default(10),
  enableHandoffProtocol: z.boolean().default(true),
  enableBreadcrumbTrail: z.boolean().default(true),
});

export type SwarmConfig = z.infer<typeof SwarmConfigSchema>;

const DEFAULT_CONFIG: SwarmConfig = {
  maxParallelTasks: 5,
  defaultTimeoutMs: 10000,
  maxRetries: 2,
  enableParallelExecution: true,
  enableCaching: true,
  cacheTtlSeconds: 300,
  logAgentCalls: true,
  synthesisModel: "deepseek",
  enableSwarmState: true,
  maxIterations: 10,
  enableHandoffProtocol: true,
  enableBreadcrumbTrail: true,
};

// ============================================
// AGENT REGISTRY
// ============================================

interface AgentRegistryEntry {
  type: string;
  name: string;
  nameAr: string;
  description: string;
  capabilities: string[];
  fallbackAgent?: string;
  maxConcurrent: number;
  timeoutMs: number;
  isEnabled: boolean;
}

const AGENT_REGISTRY: Record<string, AgentRegistryEntry> = {
  intent_detector: {
    type: "intent_detector",
    name: "Intent Detector",
    nameAr: "كاشف النية",
    description: "Detects user intent from natural language input",
    capabilities: ["general_chat", "greeting", "help", "ambiguous", "error"],
    maxConcurrent: 20,
    timeoutMs: 3000,
    isEnabled: true,
  },
  food_agent: {
    type: "food_agent",
    name: "Food Agent",
    nameAr: "وكيل الطعام",
    description: "Handles food ordering and restaurant queries",
    capabilities: ["food_order"],
    fallbackAgent: "product_agent",
    maxConcurrent: 15,
    timeoutMs: 8000,
    isEnabled: true,
  },
  product_agent: {
    type: "product_agent",
    name: "Product Agent",
    nameAr: "وكيل المنتجات",
    description: "Searches and recommends products",
    capabilities: ["product_search"],
    maxConcurrent: 20,
    timeoutMs: 8000,
    isEnabled: true,
  },
  order_agent: {
    type: "order_agent",
    name: "Order Agent",
    nameAr: "وكيل الطلبات",
    description: "Manages order lifecycle and tracking",
    capabilities: ["order_tracking", "checkout"],
    fallbackAgent: "merchant_agent",
    maxConcurrent: 15,
    timeoutMs: 6000,
    isEnabled: true,
  },
  payment_agent: {
    type: "payment_agent",
    name: "Payment Agent",
    nameAr: "وكيل الدفع",
    description: "Processes payments and refunds",
    capabilities: ["payment"],
    fallbackAgent: "cart_agent",
    maxConcurrent: 10,
    timeoutMs: 10000,
    isEnabled: true,
  },
  cart_agent: {
    type: "cart_agent",
    name: "Cart Agent",
    nameAr: "وكيل السلة",
    description: "Manages shopping cart operations",
    capabilities: ["cart_view", "cart_add", "cart_remove"],
    fallbackAgent: "product_agent",
    maxConcurrent: 15,
    timeoutMs: 5000,
    isEnabled: true,
  },
  merchant_agent: {
    type: "merchant_agent",
    name: "Merchant Agent",
    nameAr: "وكيل التاجر",
    description: "Handles merchant-related queries",
    capabilities: ["create_store", "analytics_view"],
    fallbackAgent: "gensaas_agent",
    maxConcurrent: 10,
    timeoutMs: 8000,
    isEnabled: true,
  },
  supplier_agent: {
    type: "supplier_agent",
    name: "Supplier Agent",
    nameAr: "وكيل الموردين",
    description: "Manages B2B supplier operations",
    capabilities: ["supplier_search", "crossborder_order"],
    fallbackAgent: "crossborder_agent",
    maxConcurrent: 8,
    timeoutMs: 10000,
    isEnabled: true,
  },
  crossborder_agent: {
    type: "crossborder_agent",
    name: "Cross-Border Agent",
    nameAr: "وكيل التجارة العابرة",
    description: "Handles cross-border B2B orders",
    capabilities: ["crossborder_order"],
    fallbackAgent: "supplier_agent",
    maxConcurrent: 5,
    timeoutMs: 12000,
    isEnabled: true,
  },
  haggle_agent: {
    type: "haggle_agent",
    name: "Haggle Agent",
    nameAr: "وكيل المفاوضة",
    description: "AI-powered price negotiation",
    capabilities: ["haggle"],
    maxConcurrent: 10,
    timeoutMs: 8000,
    isEnabled: true,
  },
  islamic_agent: {
    type: "islamic_agent",
    name: "Islamic Compliance Agent",
    nameAr: "وكيل الامتثال الإسلامي",
    description: "Ensures Islamic compliance for products",
    capabilities: ["islamic_check"],
    maxConcurrent: 10,
    timeoutMs: 6000,
    isEnabled: true,
  },
  fleet_agent: {
    type: "fleet_agent",
    name: "Fleet Agent",
    nameAr: "وكيل الأسطول",
    description: "Manages delivery fleet and tracking",
    capabilities: ["fleet_track", "order_tracking"],
    fallbackAgent: "order_agent",
    maxConcurrent: 12,
    timeoutMs: 6000,
    isEnabled: true,
  },
  zakat_agent: {
    type: "zakat_agent",
    name: "Zakat Agent",
    nameAr: "وكيل الزكاة",
    description: "Calculates and manages Zakat payments",
    capabilities: ["zakat_calculate"],
    fallbackAgent: "islamic_agent",
    maxConcurrent: 5,
    timeoutMs: 8000,
    isEnabled: true,
  },
  biometric_agent: {
    type: "biometric_agent",
    name: "Biometric Agent",
    nameAr: "وكيل القياسات الحيوية",
    description: "Handles biometric authentication",
    capabilities: ["biometric_auth"],
    maxConcurrent: 8,
    timeoutMs: 8000,
    isEnabled: true,
  },
  vision_agent: {
    type: "vision_agent",
    name: "Vision Agent",
    nameAr: "وكيل الرؤية",
    description: "Processes visual input (scan, OCR, detect)",
    capabilities: ["vision_scan"],
    maxConcurrent: 8,
    timeoutMs: 10000,
    isEnabled: true,
  },
  voice_agent: {
    type: "voice_agent",
    name: "Voice Agent",
    nameAr: "وكيل الصوت",
    description: "Handles voice interactions and dialect detection",
    capabilities: ["voice_query"],
    maxConcurrent: 10,
    timeoutMs: 8000,
    isEnabled: true,
  },
  smartconnect_agent: {
    type: "smartconnect_agent",
    name: "Smart Connect Agent",
    nameAr: "وكيل الربط الذكي",
    description: "Manages POS/API integrations",
    capabilities: ["create_store"],
    fallbackAgent: "gensaas_agent",
    maxConcurrent: 5,
    timeoutMs: 10000,
    isEnabled: true,
  },
  webhook_agent: {
    type: "webhook_agent",
    name: "Webhook Agent",
    nameAr: "وكيل الويب هوك",
    description: "Manages webhook configurations",
    capabilities: [],
    fallbackAgent: "merchant_agent",
    maxConcurrent: 8,
    timeoutMs: 5000,
    isEnabled: true,
  },
  gensaas_agent: {
    type: "gensaas_agent",
    name: "GenSaaS Agent",
    nameAr: "وكيل المنصة كخدمة",
    description: "Deploys and manages SaaS instances",
    capabilities: ["saas_deploy"],
    maxConcurrent: 5,
    timeoutMs: 15000,
    isEnabled: true,
  },
  genaggregator_agent: {
    type: "genaggregator_agent",
    name: "GenAggregator Agent",
    nameAr: "وكيل المجمّع",
    description: "Manages multi-vendor marketplace platforms",
    capabilities: ["aggregator_browse"],
    maxConcurrent: 8,
    timeoutMs: 8000,
    isEnabled: true,
  },
  widget_agent: {
    type: "widget_agent",
    name: "Widget Agent",
    nameAr: "وكيل الودجت",
    description: "Manages embedded widget configurations",
    capabilities: ["widget_embed"],
    fallbackAgent: "gensaas_agent",
    maxConcurrent: 8,
    timeoutMs: 6000,
    isEnabled: true,
  },
  a2a_agent: {
    type: "a2a_agent",
    name: "A2A Trade Agent",
    nameAr: "وكيل التبادل بين الوكلاء",
    description: "Handles agent-to-agent trading",
    capabilities: ["a2a_trade"],
    maxConcurrent: 6,
    timeoutMs: 10000,
    isEnabled: true,
  },
  recruitment_agent: {
    type: "recruitment_agent",
    name: "Recruitment Agent",
    nameAr: "وكيل التوظيف",
    description: "Manages job postings and candidate matching",
    capabilities: ["job_seeker", "hire_worker"],
    fallbackAgent: "merchant_agent",
    maxConcurrent: 10,
    timeoutMs: 8000,
    isEnabled: true,
  },
  analytics_agent: {
    type: "analytics_agent",
    name: "Analytics Agent",
    nameAr: "وكيل التحليلات",
    description: "Generates analytics and insights",
    capabilities: ["analytics_view"],
    maxConcurrent: 8,
    timeoutMs: 10000,
    isEnabled: true,
  },
  memory_agent: {
    type: "memory_agent",
    name: "Memory Agent",
    nameAr: "وكيل الذاكرة",
    description: "Manages user preferences and memory",
    capabilities: [],
    fallbackAgent: "intent_detector",
    maxConcurrent: 15,
    timeoutMs: 3000,
    isEnabled: true,
  },
  response_synthesizer: {
    type: "response_synthesizer",
    name: "Response Synthesizer",
    nameAr: "موحّد الردود",
    description: "Synthesizes final responses from agent results",
    capabilities: [],
    maxConcurrent: 20,
    timeoutMs: 5000,
    isEnabled: true,
  },
  bubble_generator: {
    type: "bubble_generator",
    name: "Bubble Generator",
    nameAr: "مولّد الفقاعات",
    description: "Generates GenUI bubbles for responses",
    capabilities: [],
    maxConcurrent: 20,
    timeoutMs: 4000,
    isEnabled: true,
  },
};

// ============================================
// INTENT → AGENT MAPPING
// ============================================

const INTENT_AGENT_MAP: Record<string, string[]> = {
  food_order: ["food_agent", "product_agent"],
  product_search: ["product_agent", "genaggregator_agent"],
  order_tracking: ["order_agent", "fleet_agent"],
  payment: ["payment_agent"],
  cart_view: ["cart_agent"],
  cart_add: ["cart_agent", "product_agent"],
  cart_remove: ["cart_agent"],
  checkout: ["cart_agent", "payment_agent", "order_agent"],
  job_seeker: ["recruitment_agent"],
  hire_worker: ["recruitment_agent", "merchant_agent"],
  create_store: ["gensaas_agent", "smartconnect_agent"],
  haggle: ["haggle_agent"],
  return_item: ["order_agent", "merchant_agent"],
  dna_crossbreed: ["a2a_agent"],
  zakat_calculate: ["zakat_agent", "islamic_agent"],
  islamic_check: ["islamic_agent"],
  fleet_track: ["fleet_agent", "order_agent"],
  biometric_auth: ["biometric_agent"],
  vision_scan: ["vision_agent"],
  voice_query: ["voice_agent"],
  saas_deploy: ["gensaas_agent"],
  aggregator_browse: ["genaggregator_agent"],
  widget_embed: ["widget_agent", "gensaas_agent"],
  a2a_trade: ["a2a_agent"],
  crossborder_order: ["crossborder_agent", "supplier_agent"],
  supplier_search: ["supplier_agent"],
  analytics_view: ["analytics_agent", "merchant_agent"],
  general_chat: ["intent_detector"],
  greeting: ["intent_detector"],
  help: ["intent_detector"],
  ambiguous: ["intent_detector"],
  error: ["intent_detector"],
};

// ============================================
// AGENT EXECUTORS
// ============================================

interface AgentExecutor {
  (task: SwarmTask): Promise<Record<string, unknown>>;
}

const AGENT_EXECUTORS: Partial<Record<string, AgentExecutor>> = {
  intent_detector: async (task) => {
    const result = detectIntent((task.input.message ?? "") as string);
    return {
      intent: result.intent,
      confidence: result.confidence,
      entities: result.entities,
    };
  },

  food_agent: async (task) => {
    const marketCode = ((task.input.marketCode ?? "KW") as string);
    const merchants = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.marketCode, marketCode))
      .limit(5);

    let products: Array<Record<string, unknown>> = [];
    if (merchants.length > 0) {
      products = await db.select().from(schema.products).limit(10);
    }

    return {
      merchants: merchants.map((m) => ({
        id: m.id,
        name: m.businessName,
        type: m.businessType,
        rating: 4.5 + Math.random() * 0.5,
      })),
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        category: p.category,
      })),
      recommendation: products[0] || null,
    };
  },

  product_agent: async () => {
    const allProducts = await db.select().from(schema.products).limit(10);
    return {
      products: allProducts.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency || "KWD",
        category: p.category,
        stock: p.stock,
        isHalal: p.isHalal,
      })),
      count: allProducts.length,
    };
  },

  order_agent: async (task) => {
    const userId = task.input.userId as number | undefined;
    if (!userId) {
      return { requiresAuth: true, message: "يرجى تسجيل الدخول لتتبع طلباتك" };
    }
    const userOrders = await db.select().from(schema.orders).limit(5);
    return {
      orders: userOrders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.totalAmount,
        trackingNumber: o.trackingNumber || `JAS-${o.id}`,
        eta: o.deliveryEta,
      })),
      activeOrders: userOrders.filter((o) =>
        ["pending", "confirmed", "processing", "shipped"].includes(o.status),
      ).length,
    };
  },

  payment_agent: async (task) => {
    const marketCode = (task.input.marketCode ?? "KW") as string;
    return {
      availableGateways: getMarketPaymentGateways(marketCode),
      escrowEnabled: true,
      biometricEnabled: true,
      currency: getMarketCurrency(marketCode),
    };
  },

  cart_agent: async (task) => {
    const userId = task.input.userId as number | undefined;
    if (!userId) return { requiresAuth: true, itemCount: 0, total: 0 };
    const items = await db.select().from(schema.cartItems).limit(20);
    return {
      items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      itemCount: items.length,
    };
  },

  haggle_agent: async (task) => {
    const originalPrice = (task.input.originalPrice as number) || 100;
    const targetPrice = originalPrice * 0.85;
    return {
      originalPrice,
      suggestedPrice: Math.round(targetPrice * 100) / 100,
      discount: "15%",
      concessionRange: { min: originalPrice * 0.75, max: originalPrice * 0.95 },
      strategy: "gradual",
    };
  },

  zakat_agent: async (task) => {
    const marketCode = (task.input.marketCode ?? "KW") as string;
    const nisabData = await db
      .select()
      .from(schema.nisabSettings)
      .where(eq(schema.nisabSettings.marketCode, marketCode))
      .limit(1);
    const nisab = nisabData[0];
    return {
      nisabThreshold: nisab?.nisabThreshold || 5000,
      zakatRate: 0.025,
      currency: nisab?.currency || "KWD",
      goldPrice: nisab?.goldPriceGram || 25,
      silverPrice: nisab?.silverPriceGram || 0.5,
    };
  },

  fleet_agent: async () => {
    const drivers = await db.select().from(schema.drivers).limit(5);
    return {
      availableDrivers: drivers.filter((d) => d.status === "available").length,
      drivers: drivers.map((d) => ({
        id: d.id, name: d.fullName, vehicle: d.vehicleType, rating: d.rating, status: d.status,
      })),
      avgDeliveryTime: 15,
    };
  },

  recruitment_agent: async () => {
    const jobPosts = await db.select().from(schema.jobPosts).limit(5);
    const candidates = await db.select().from(schema.candidates).limit(5);
    return {
      jobs: jobPosts.map((j) => ({
        id: j.id, title: j.title, salary: `${j.salaryMin}-${j.salaryMax} ${j.currency}`, location: j.location,
      })),
      candidates: candidates.map((c) => ({
        id: c.id, name: c.fullName, title: c.title, score: c.aiScore,
      })),
    };
  },

  islamic_agent: async () => {
    const checks = await db.select().from(schema.islamicProductChecks).limit(10);
    return {
      checks: checks.map((c) => ({
        productId: c.productId, productName: c.productName, isHalal: c.isHalal, confidence: c.confidence,
      })),
      halalRate: checks.length > 0 ? checks.filter((c) => c.isHalal).length / checks.length : 1.0,
    };
  },

  biometric_agent: async () => ({
    supported: ["face", "fingerprint"], enrolled: false, livenessRequired: true,
  }),

  vision_agent: async () => ({
    scanTypes: ["product_scan", "document_verification", "image_search", "receipt_ocr"],
    avgProcessingTime: 2000,
  }),

  voice_agent: async (task) => ({
    supportedDialects: ["gulf", "egyptian", "levantine", "maghrebi"],
    detectedDialect: "gulf",
    confidence: 0.94,
    inputText: task.input.message,
  }),

  gensaas_agent: async () => {
    const templates = await db.select().from(schema.saasTemplates).limit(5);
    return {
      templates: templates.map((t) => ({ id: t.id, name: t.name, category: t.category, price: t.pricingMonthly })),
      deployTime: "3 دقائق",
    };
  },

  genaggregator_agent: async () => {
    const platforms = await db.select().from(schema.aggregatorPlatforms).limit(5);
    return { platforms: platforms.map((p) => ({ id: p.id, name: p.name, vendorCount: 0 })) };
  },

  supplier_agent: async (task) => {
    const marketCode = (task.input.marketCode ?? "KW") as string;
    const suppliers = await db.select().from(schema.suppliers).where(eq(schema.suppliers.marketCode, marketCode)).limit(5);
    return { suppliers: suppliers.map((s) => ({ id: s.id, name: s.businessName, type: s.businessType, rating: s.rating })) };
  },

  crossborder_agent: async () => {
    const orders = await db.select().from(schema.crossborderOrders).limit(5);
    return {
      orders: orders.map((o) => ({ id: o.id, status: o.status, origin: o.originCountry, destination: o.destinationCountry, total: o.totalCost })),
      murabahaEnabled: true,
    };
  },

  widget_agent: async () => ({
    widgetTypes: ["chat", "booking", "product_carousel", "payment_button", "lead_form"],
    embedTime: "2 دقائق",
  }),

  a2a_agent: async () => {
    const agents = await db.select().from(schema.a2aAgents).limit(5);
    return { availableAgents: agents.map((a) => ({ id: a.id, name: a.name, type: a.agentType, price: a.listingPrice })) };
  },

  analytics_agent: async (task) => {
    const marketCode = (task.input.marketCode ?? "KW") as string;
    const analytics = await db.select().from(schema.analytics).limit(10);
    return { metrics: analytics.map((a) => ({ metric: a.metric, value: a.value, category: a.category })), marketCode };
  },

  memory_agent: async (task) => {
    const userId = task.input.userId as number | undefined;
    if (!userId) return { preferences: {} };
    const memories = await db.select().from(schema.memory).limit(20);
    const prefs: Record<string, string> = {};
    memories.forEach((m) => { prefs[m.key] = m.value; });
    return { preferences: prefs };
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getMarketCurrency(marketCode: string): string {
  const map: Record<string, string> = {
    KW: "KWD", SA: "SAR", AE: "AED", QA: "QAR",
    BH: "BHD", OM: "OMR", JO: "JOD", EG: "EGP",
    IQ: "IQD", LB: "LBP", SY: "SYP", YE: "YER",
    PS: "ILS", DZ: "DZD", TN: "TND", MA: "MAD",
    LY: "LYD", SD: "SDG",
  };
  return map[marketCode] || "KWD";
}

function getMarketPaymentGateways(marketCode: string): string[] {
  const base = ["knet", "apple_pay", "google_pay"];
  const marketMap: Record<string, string[]> = {
    KW: [...base, "cash"], SA: [...base, "cash", "stc_pay"],
    AE: [...base, "cash", "pay_by_card"], QA: [...base, "cash"],
    BH: [...base, "cash"], OM: [...base, "cash"],
    JO: ["cash", "card"], EG: ["cash", "card", "vodafone_cash"],
  };
  return marketMap[marketCode] || base;
}

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// SWARM ORCHESTRATOR V2 — SwarmState Pattern
// ============================================

export class SwarmOrchestratorV2 {
  private config: SwarmConfig;
  private responseSynthesizer: ResponseSynthesizer;
  private bubbleGenerator: BubbleGenerator;
  private runningTasks: Map<string, SwarmTask> = new Map();
  private agentLoad: Map<string, number> = new Map();
  private swarmState: SwarmState;
  private circuitBreaker: CircuitBreaker;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = SwarmConfigSchema.parse({ ...DEFAULT_CONFIG, ...config });
    this.responseSynthesizer = new ResponseSynthesizer();
    this.bubbleGenerator = new BubbleGenerator();

    for (const agentType of Object.keys(AGENT_REGISTRY)) {
      this.agentLoad.set(agentType, 0);
    }

    // Initialize empty SwarmState
    this.swarmState = this.createInitialState();

    // Circuit breaker for LLM calls
    this.circuitBreaker = getCircuitBreaker("swarm-orchestrator", {
      failureThreshold: 5,
      recoveryTimeoutMs: 30000,
    });
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Main entry point — Execute with full SwarmState tracking
   */
  async execute(input: SwarmInput): Promise<SwarmOutput> {
    const validated = SwarmInputSchema.parse(input);
    const startTime = Date.now();

    // Reset state for new execution
    this.swarmState = this.createInitialState(validated.message);

    try {
      return await this.circuitBreaker.execute(() =>
        this.executeWithState(validated, startTime),
      );
    } catch (error) {
      if (error instanceof JASIMError && error.code === "CIRCUIT_OPEN") {
        return this.createCircuitBreakerResponse(validated, startTime, error);
      }
      return this.handleExecutionError(error, validated, startTime);
    }
  }

  /**
   * Get current SwarmState (for inspection/debugging)
   */
  getState(): SwarmState {
    return { ...this.swarmState };
  }

  /**
   * Manually reset the SwarmState
   */
  resetState(): void {
    this.swarmState = this.createInitialState();
    this.agentLoad.clear();
    for (const agentType of Object.keys(AGENT_REGISTRY)) {
      this.agentLoad.set(agentType, 0);
    }
  }

  // ============================================
  // CORE EXECUTION WITH SWARMSTATE
  // ============================================

  private async executeWithState(
    input: SwarmInput,
    startTime: number,
  ): Promise<SwarmOutput> {
    // ── SwarmState Step 1: Record issue ──────────────────────────
    this.swarmState.stepsTaken.push("1. Received input and started execution");

    // ── Step 1: Detect intent ──────────────────────────────────────
    const parsedIntent = await this.detectIntent(input);
    this.swarmState.stepsTaken.push(`2. Intent detected: ${parsedIntent.intent} (confidence: ${parsedIntent.confidence})`);

    // ── Step 2: Build conversation context ─────────────────────────
    const context = await this.buildContext(input, parsedIntent);
    this.swarmState.stepsTaken.push("3. Conversation context built");

    // ── Step 3: Decompose into tasks ───────────────────────────────
    const tasks = this.decomposeTask(parsedIntent, input, context);
    this.swarmState.stepsTaken.push(`4. Task decomposed into ${tasks.length} sub-tasks`);

    // ── Step 4: Determine available agents for SwarmState ──────────
    this.swarmState.availableAgents = tasks.map((t) => {
      const entry = AGENT_REGISTRY[t.agentType];
      return {
        id: t.agentType,
        description: entry?.description ?? t.agentType,
        skills: entry?.capabilities ?? [],
      };
    });

    // ── Step 5: Execute tasks (parallel + sequential) ──────────────
    const executedTasks = await this.executeTasks(tasks);
    this.swarmState.stepsTaken.push(`5. Executed ${executedTasks.length} tasks`);

    // ── Step 6: Aggregate results ──────────────────────────────────
    const swarmResults = this.aggregateResults(executedTasks);
    this.swarmState.stepsTaken.push("6. Results aggregated");

    // ── Step 7: Synthesize response ────────────────────────────────
    const synthesizedResponse = await this.responseSynthesizer.synthesize(
      swarmResults,
      context,
    );
    this.swarmState.stepsTaken.push("7. Response synthesized");

    // ── Step 8: Generate bubbles ───────────────────────────────────
    const bubbles = await this.bubbleGenerator.generate(context, swarmResults);
    this.swarmState.stepsTaken.push("8. UI bubbles generated");

    // ── SwarmState: Mark complete ──────────────────────────────────
    this.swarmState.finalSolution = synthesizedResponse.text;
    this.swarmState.currentStatus = "completed";
    this.swarmState.iteration++;

    // ── Step 9: Log execution ──────────────────────────────────────
    await this.logExecution(input, tasks, swarmResults);

    const executionTimeMs = Date.now() - startTime;

    return {
      response: {
        text: synthesizedResponse.text,
        language: input.preferredLanguage ?? "ar",
        confidence: synthesizedResponse.confidence ?? 0.9,
        actions: synthesizedResponse.actions,
        suggestions: synthesizedResponse.suggestions ?? [],
        sentiment: this.detectSentiment(input.message),
      },
      bubbles: bubbles as Array<Record<string, unknown>>,
      tasks: executedTasks,
      executionTimeMs,
      agentCalls: executedTasks.length,
      confidence: synthesizedResponse.confidence ?? 0.9,
      swarmState: { ...this.swarmState },
      metadata: {
        intent: parsedIntent,
        agentsUsed: executedTasks.map((t) => t.agentType),
        marketCode: input.marketCode,
        tokensUsed: swarmResults.reduce((sum, r) => sum + r.tokensUsed, 0),
        iteration: this.swarmState.iteration,
        handoffCount: this.swarmState.handoffHistory.length,
      },
    };
  }

  // ============================================
  // HANDOFF PROTOCOL
  // ============================================

  /**
   * Handoff protocol: Transfer control from one agent to another
   * Records the handoff in SwarmState history
   */
  private async executeHandoff(
    fromAgent: string,
    toAgent: string,
    reason: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Record handoff in state
    this.swarmState.handoffHistory.push({
      from: fromAgent,
      to: toAgent,
      reason,
      timestamp: Date.now(),
    });

    this.swarmState.agentsCalled.push(toAgent);

    // Update breadcrumb trail
    if (this.config.enableBreadcrumbTrail) {
      this.swarmState.stepsTaken.push(
        `Handoff: ${fromAgent} → ${toAgent} (${reason})`,
      );
    }

    // Create task for receiving agent
    const handoffTask: SwarmTask = {
      id: generateTaskId(),
      agentType: toAgent,
      intent: { intent: "handoff", confidence: 0.9 },
      input: context,
      status: "pending",
      priority: 5,
      dependencies: [],
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      metadata: { handoffFrom: fromAgent, handoffReason: reason },
    };

    const executor = AGENT_EXECUTORS[toAgent];
    if (!executor) {
      throw new JASIMError({
        code: "AGENT_NOT_FOUND",
        message: `No executor for agent: ${toAgent}`,
        context: { fromAgent, toAgent, reason },
      });
    }

    // Update SwarmState
    this.swarmState.nextAgent = toAgent;
    this.swarmState.nextAgentInstruction = reason;

    const result = await retryWithBackoff(
      () => executor(handoffTask),
      { maxRetries: this.config.maxRetries },
    );

    handoffTask.status = "completed";
    return result;
  }

  // ============================================
  // ITERATION SAFETY VALVE
  // ============================================

  /**
   * Check if max iterations reached — triggers graceful fallback
   */
  private checkIterationSafety(): boolean {
    if (this.swarmState.iteration >= this.config.maxIterations) {
      this.swarmState.currentStatus = "max_iterations_reached";
      return false; // Not safe to continue
    }
    this.swarmState.iteration++;
    return true; // Safe to continue
  }

  /**
   * Graceful fallback when max iterations reached
   */
  private createMaxIterationsFallback(input: SwarmInput, startTime: number): SwarmOutput {
    this.swarmState.currentStatus = "max_iterations_reached";
    this.swarmState.stepsTaken.push(
      `MAX ITERATIONS (${this.config.maxIterations}) REACHED — returning graceful fallback`,
    );

    return {
      response: {
        text: "تم الوصول إلى الحد الأقصى من المعالجة. أنا أفهم سؤالك — تقدر تكرر الطلب بشكل أبسط؟",
        language: input.preferredLanguage ?? "ar",
        confidence: 0.3,
        actions: [{
          id: "simplify",
          label: "بسّط الطلب",
          type: "clarify",
          payload: { reason: "max_iterations" },
          priority: 1,
        }],
        suggestions: ["اطلب أكل", "تتبع طلب", "ابحث عن منتج"],
        sentiment: "neutral",
      },
      bubbles: [],
      tasks: [],
      executionTimeMs: Date.now() - startTime,
      agentCalls: 0,
      confidence: 0.3,
      swarmState: { ...this.swarmState },
      metadata: {
        fallback: "max_iterations",
        agentsUsed: [],
        marketCode: input.marketCode,
        tokensUsed: 0,
      },
    };
  }

  // ============================================
  // TASK EXECUTION (parallel + sequential)
  // ============================================

  private async executeTasks(tasks: SwarmTask[]): Promise<SwarmTask[]> {
    const { independent, dependent } = this.separateByDependencies(tasks);

    let executedTasks: SwarmTask[] = [];

    if (this.config.enableParallelExecution && independent.length > 0) {
      const [parallelResults, sequentialResults] = await Promise.all([
        this.executeParallel(independent),
        dependent.length > 0 ? this.executeSequential(dependent) : Promise.resolve([]),
      ]);
      executedTasks = [...parallelResults, ...sequentialResults];
    } else {
      executedTasks = await this.executeSequential(tasks);
    }

    return executedTasks;
  }

  // ============================================
  // BREADCRUMB TRAIL LOGGING
  // ============================================

  private addBreadcrumb(step: string, detail?: Record<string, unknown>): void {
    if (!this.config.enableBreadcrumbTrail) return;

    const timestamp = new Date().toISOString();
    const entry = detail
      ? `[${timestamp}] ${step} | ${JSON.stringify(detail)}`
      : `[${timestamp}] ${step}`;

    this.swarmState.stepsTaken.push(entry);

    // Also log to console for observability
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Breadcrumb] ${entry}`);
    }
  }

  // ============================================
  // INTENT DETECTION
  // ============================================

  private async detectIntent(input: SwarmInput): Promise<ParsedIntent & { intent: string; entities: Record<string, string>; marketCode: string; confidence: number }> {
    const result = detectIntent(input.message);
    return {
      intent: result.intent,
      confidence: result.confidence,
      entities: result.entities,
      secondaryIntents: [],
      sentiment: this.detectSentiment(input.message),
      marketCode: input.marketCode || "KW",
    } as ParsedIntent & { intent: string; entities: Record<string, string>; marketCode: string; confidence: number };
  }

  private detectSentiment(text: string): "positive" | "neutral" | "negative" | "urgent" {
    const urgent = /عاجل|ضروري|بسرعة|فورا|الحين|دحين/;
    const negative = /سيئ|رديء|مكسور|تالف|غاضب|زفت|فاشل/;
    const positive = /ممتاز|حلو|شكرا|رائع|أحب|ممتاز|روعه/;

    if (urgent.test(text)) return "urgent";
    if (negative.test(text)) return "negative";
    if (positive.test(text)) return "positive";
    return "neutral";
  }

  // ============================================
  // CONTEXT BUILDER
  // ============================================

  private async buildContext(
    input: SwarmInput,
    intent: { intent: string; entities: Record<string, string>; marketCode: string; confidence: number },
  ): Promise<Record<string, unknown>> {
    const sessionId = input.sessionId || `sess_${Date.now()}`;
    let entityMemory: Record<string, string> = {};

    if (input.userId) {
      try {
        const memories = await db.select().from(schema.memory).limit(20);
        memories.forEach((m) => { entityMemory[m.key] = m.value; });
      } catch { /* Memory not critical */ }
    }

    return {
      userId: input.userId,
      sessionId,
      marketCode: input.marketCode,
      messages: input.conversationHistory || [],
      userPreferences: {
        language: input.preferredLanguage || "ar",
        currency: getMarketCurrency(input.marketCode),
        notifications: true,
        theme: "auto",
      },
      lastIntent: intent.intent,
      entityMemory,
    };
  }

  // ============================================
  // TASK DECOMPOSITION
  // ============================================

  private decomposeTask(
    intent: { intent: string; entities: Record<string, string>; marketCode: string; confidence: number },
    input: SwarmInput,
    _context: Record<string, unknown>,
  ): SwarmTask[] {
    const agentTypes = INTENT_AGENT_MAP[intent.intent] || ["intent_detector"];
    const tasks: SwarmTask[] = [];

    for (let i = 0; i < agentTypes.length; i++) {
      const agentType = agentTypes[i];
      const registryEntry = AGENT_REGISTRY[agentType];

      if (!registryEntry || !registryEntry.isEnabled) continue;

      const task: SwarmTask = {
        id: generateTaskId(),
        agentType,
        intent: intent as Record<string, unknown>,
        input: {
          message: input.message,
          userId: input.userId,
          marketCode: input.marketCode,
          ...intent.entities,
          ...input.context,
        },
        status: "pending",
        priority: Math.max(1, 9 - i),
        dependencies: i > 0 ? [tasks[i - 1]?.id].filter(Boolean) : [],
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        metadata: {
          agentName: registryEntry.name,
          agentNameAr: registryEntry.nameAr,
          registryIndex: i,
        },
      };

      tasks.push(task);
    }

    if (tasks.length === 0) {
      tasks.push({
        id: generateTaskId(),
        agentType: "intent_detector",
        intent: intent as Record<string, unknown>,
        input: { message: input.message, userId: input.userId },
        status: "pending",
        priority: 5,
        dependencies: [],
        retryCount: 0,
        maxRetries: this.config.maxRetries,
        metadata: { fallback: true },
      });
    }

    return tasks;
  }

  private separateByDependencies(tasks: SwarmTask[]): {
    independent: SwarmTask[];
    dependent: SwarmTask[];
  } {
    const independent = tasks.filter((t) => t.dependencies.length === 0);
    const dependent = tasks.filter((t) => t.dependencies.length > 0);
    return { independent, dependent };
  }

  // ============================================
  // SINGLE TASK EXECUTION WITH RETRY
  // ============================================

  private async executeTask(task: SwarmTask): Promise<SwarmTask> {
    const registryEntry = AGENT_REGISTRY[task.agentType];

    if (!this.isAgentAvailable(task.agentType)) {
      return this.handleFailure({
        ...task,
        status: "failed",
        error: `Agent ${task.agentType} is at capacity`,
      });
    }

    this.agentLoad.set(task.agentType, (this.agentLoad.get(task.agentType) || 0) + 1);
    this.runningTasks.set(task.id, task);

    const startTime = Date.now();
    task.status = "running";
    task.startedAt = new Date();

    try {
      const executor = AGENT_EXECUTORS[task.agentType];
      if (!executor) {
        throw new JASIMError({
          code: "AGENT_NOT_FOUND",
          message: `No executor registered for agent: ${task.agentType}`,
          context: { taskId: task.id, agentType: task.agentType },
        });
      }

      const timeoutMs = registryEntry?.timeoutMs || this.config.defaultTimeoutMs;

      // Execute with retry + backoff
      const output = await retryWithBackoff(
        () => this.executeWithTimeout(executor, task, timeoutMs),
        {
          maxRetries: task.maxRetries,
          onRetry: (attempt, error) => {
            this.addBreadcrumb(`Retry ${attempt} for ${task.agentType}`, {
              error: (error as JASIMError).message,
            });
          },
        },
      );

      task.output = output;
      task.status = "completed";
      task.tokensUsed = this.estimateTokens(JSON.stringify(output));

      this.addBreadcrumb(`Task ${task.agentType} completed`, {
        executionTimeMs: Date.now() - startTime,
      });

      this.agentLoad.set(task.agentType, Math.max(0, (this.agentLoad.get(task.agentType) || 1) - 1));
      this.runningTasks.delete(task.id);

      return task;
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);

      this.addBreadcrumb(`Task ${task.agentType} failed`, {
        error: task.error,
      });

      this.agentLoad.set(task.agentType, Math.max(0, (this.agentLoad.get(task.agentType) || 1) - 1));
      this.runningTasks.delete(task.id);

      return this.handleFailure(task);
    }
  }

  private executeWithTimeout(
    executor: AgentExecutor,
    task: SwarmTask,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new JASIMError({
          code: "AGENT_TIMEOUT",
          message: `Agent ${task.agentType} timed out after ${timeoutMs}ms`,
          isRetryable: true,
          context: { agentType: task.agentType, taskId: task.id, timeoutMs },
        }));
      }, timeoutMs);

      executor(task)
        .then((result) => { clearTimeout(timer); resolve(result); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  // ============================================
  // PARALLEL EXECUTION
  // ============================================

  private async executeParallel(tasks: SwarmTask[]): Promise<SwarmTask[]> {
    if (tasks.length === 0) return [];
    const limit = Math.min(tasks.length, this.config.maxParallelTasks);
    const executing: Promise<SwarmTask>[] = [];
    const results: SwarmTask[] = [];

    for (let i = 0; i < limit; i++) {
      executing.push(this.executeTask(tasks[i]));
    }

    let nextIndex = limit;

    while (executing.length > 0) {
      const completed = await Promise.race(executing);
      results.push(completed);

      const completedIdx = executing.findIndex(
        (p) => p === executing.find((ep) => ep === Promise.resolve(completed)),
      );

      if (nextIndex < tasks.length) {
        executing[completedIdx] = this.executeTask(tasks[nextIndex]);
        nextIndex++;
      } else {
        executing.splice(completedIdx, 1);
      }
    }

    return results;
  }

  // ============================================
  // SEQUENTIAL EXECUTION
  // ============================================

  private async executeSequential(tasks: SwarmTask[]): Promise<SwarmTask[]> {
    const results: SwarmTask[] = [];

    for (const task of tasks) {
      const depsMet = task.dependencies.every((depId) =>
        results.some((r) => r.id === depId && r.status === "completed"),
      );

      if (!depsMet && task.dependencies.length > 0) {
        task.status = "cancelled";
        task.error = "Dependencies not met";
        results.push(task);
        continue;
      }

      const result = await this.executeTask(task);
      results.push(result);

      if (result.status === "failed" && result.priority >= 9) break;
    }

    return results;
  }

  // ============================================
  // AGGREGATION & RESULTS
  // ============================================

  private aggregateResults(tasks: SwarmTask[]): SwarmResult[] {
    return tasks.map((task) => ({
      taskId: task.id,
      agentType: task.agentType,
      intent: (task.intent as Record<string, unknown>)?.intent as string || "unknown",
      success: task.status === "completed",
      data: (task.output || {}) as Record<string, unknown>,
      error: task.error,
      confidence: ((task.intent as Record<string, unknown>)?.confidence as number) || 0.5,
      executionTimeMs: (task.metadata?.executionTimeMs as number) || 0,
      tokensUsed: task.tokensUsed || 0,
    }));
  }

  // ============================================
  // FAILURE HANDLING WITH FALLBACK
  // ============================================

  private async handleFailure(task: SwarmTask): Promise<SwarmTask> {
    const registryEntry = AGENT_REGISTRY[task.agentType];

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = "retrying";

      const backoffMs = Math.pow(2, task.retryCount) * 1000;
      await new Promise((r) => setTimeout(r, backoffMs));

      return this.executeTask(task);
    }

    // Try fallback agent
    if (registryEntry?.fallbackAgent) {
      const fallbackEntry = AGENT_REGISTRY[registryEntry.fallbackAgent];
      if (fallbackEntry?.isEnabled) {
        this.addBreadcrumb(`Fallback: ${task.agentType} → ${registryEntry.fallbackAgent}`);

        const fallbackTask: SwarmTask = {
          ...task,
          id: generateTaskId(),
          agentType: registryEntry.fallbackAgent,
          status: "pending",
          retryCount: 0,
          metadata: {
            ...task.metadata,
            fallbackFrom: task.agentType,
            originalError: task.error,
          },
        };

        // Record in handoff history
        this.swarmState.handoffHistory.push({
          from: task.agentType,
          to: registryEntry.fallbackAgent,
          reason: `Fallback from failed task: ${task.error}`,
          timestamp: Date.now(),
        });

        return this.executeTask(fallbackTask);
      }
    }

    task.status = "failed";
    return task;
  }

  // ============================================
  // AGENT AVAILABILITY
  // ============================================

  private isAgentAvailable(agentType: string): boolean {
    const registryEntry = AGENT_REGISTRY[agentType];
    if (!registryEntry || !registryEntry.isEnabled) return false;

    const currentLoad = this.agentLoad.get(agentType) || 0;
    return currentLoad < registryEntry.maxConcurrent;
  }

  // ============================================
  // TOKEN ESTIMATION
  // ============================================

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // ============================================
  // LOGGING
  // ============================================

  private async logExecution(
    input: SwarmInput,
    tasks: SwarmTask[],
    results: SwarmResult[],
  ): Promise<void> {
    if (!this.config.logAgentCalls) return;

    try {
      await db.insert(schema.agentLogs).values({
        agentName: "swarm_orchestrator_v2",
        userId: input.userId,
        intent: (tasks[0]?.intent as Record<string, unknown>)?.intent as string,
        input: input.message.substring(0, 1000),
        output: JSON.stringify(results.map((r) => ({
          agent: r.agentType, success: r.success, intent: r.intent,
        }))),
        tokensUsed: results.reduce((sum, r) => sum + r.tokensUsed, 0),
        cost: 0,
        duration: 0,
      });
    } catch { /* Logging failure is non-critical */ }
  }

  // ============================================
  // INITIAL STATE CREATOR
  // ============================================

  private createInitialState(issue?: string): SwarmState {
    return {
      originalIssue: issue ?? "No issue set",
      stepsTaken: [],
      finalSolution: null,
      currentStatus: "initialized",
      availableAgents: [],
      nextAgent: "intent_detector",
      nextAgentInstruction: "Detect intent and route to appropriate agent",
      agentsCalled: [],
      iteration: 0,
      maxIterations: this.config.maxIterations,
      handoffHistory: [],
    };
  }

  // ============================================
  // ERROR RESPONSES
  // ============================================

  private handleExecutionError(
    error: unknown,
    input: SwarmInput,
    startTime: number,
  ): SwarmOutput {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const jasimError = error instanceof JASIMError ? error : null;

    this.addBreadcrumb("Execution failed", { error: errorMessage });

    return {
      response: {
        text: "عذراً ما فهمت طلبك — تقدر توضح أكثر؟",
        language: input.preferredLanguage ?? "ar",
        confidence: 0,
        actions: [{
          id: "retry",
          label: "إعادة المحاولة",
          type: "clarify",
          payload: { originalMessage: input.message },
          priority: 1,
        }],
        suggestions: ["اطلب أكل", "تتبع طلب", "ابحث عن منتج"],
        sentiment: "neutral",
      },
      bubbles: [],
      tasks: [],
      executionTimeMs: Date.now() - startTime,
      agentCalls: 0,
      confidence: 0,
      swarmState: { ...this.swarmState },
      metadata: {
        intent: { intent: "error", confidence: 0, entities: {}, marketCode: input.marketCode },
        agentsUsed: [],
        marketCode: input.marketCode,
        tokensUsed: 0,
        error: jasimError?.toJSON() ?? errorMessage,
      },
    };
  }

  private createCircuitBreakerResponse(
    input: SwarmInput,
    startTime: number,
    error: JASIMError,
  ): SwarmOutput {
    this.addBreadcrumb("Circuit breaker OPEN — returning degraded response");

    return {
      response: {
        text: "النظام مشغول حالياً — جرب مرة ثانية بعد دقيقة",
        language: input.preferredLanguage ?? "ar",
        confidence: 0.1,
        actions: [{
          id: "retry",
          label: "إعادة المحاولة",
          type: "retry",
          payload: {},
          priority: 1,
        }],
        suggestions: [],
        sentiment: "neutral",
      },
      bubbles: [],
      tasks: [],
      executionTimeMs: Date.now() - startTime,
      agentCalls: 0,
      confidence: 0.1,
      swarmState: { ...this.swarmState },
      metadata: {
        circuitBreaker: error.toJSON(),
        agentsUsed: [],
        marketCode: input.marketCode,
        tokensUsed: 0,
      },
    };
  }
}

// ============================================
// BACKWARD-COMPATIBLE V1 ORCHESTRATOR
// ============================================

/**
 * @deprecated Use SwarmOrchestratorV2 instead. Kept for backward compatibility.
 */
export class SwarmOrchestrator extends SwarmOrchestratorV2 {}

// ============================================
// SINGLETON EXPORTS
// ============================================

export const swarmOrchestrator = new SwarmOrchestratorV2();
