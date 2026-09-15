/**
 * ============================================
 * SWARM ORCHESTRATOR
 * JASIM Multi-Agent Coordination Engine
 * ============================================
 * 
 * The brain of the multi-agent system. Decomposes complex tasks,
 * assigns them to specialized agents, executes in parallel/sequence,
 * aggregates results, and handles failures with fallback strategies.
 */

import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import * as schema from "@db/schema";
import { detectIntent, generateResponse } from "../lib/ai";
import type {
  AgentType,
  IntentType,
  ParsedIntent,
  SwarmConfig,
  SwarmErrorCode,
  SwarmInput,
  SwarmOutput,
  SwarmResult,
  SwarmTask,
  TaskStatus,
  ConversationContext,
  AgentRegistryEntry,
  Bubble,
} from "./types";
import { SwarmError } from "./types";
import { ResponseSynthesizer } from "./response-synthesizer";
import { BubbleGenerator } from "./bubble-generator";

// ============================================
// DEFAULT CONFIGURATION
// ============================================
const DEFAULT_CONFIG: SwarmConfig = {
  maxParallelTasks: 5,
  defaultTimeoutMs: 10000,
  maxRetries: 2,
  enableParallelExecution: true,
  enableCaching: true,
  cacheTtlSeconds: 300,
  logAgentCalls: true,
  synthesisModel: "deepseek",
};

// ============================================
// AGENT REGISTRY — Maps intents → agents
// ============================================
const AGENT_REGISTRY: Record<AgentType, AgentRegistryEntry> = {
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
const INTENT_AGENT_MAP: Record<IntentType, AgentType[]> = {
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
// AGENT EXECUTOR — Simulates tRPC router calls
// ============================================
interface AgentExecutor {
  (task: SwarmTask): Promise<Record<string, unknown>>;
}

const AGENT_EXECUTORS: Partial<Record<AgentType, AgentExecutor>> = {
  // Intent Detection — uses existing AI lib
  intent_detector: async (task) => {
    const result = detectIntent(task.input.message as string);
    return {
      intent: result.intent,
      confidence: result.confidence,
      entities: result.entities,
    };
  },

  // Food Agent — queries restaurants/products from DB
  food_agent: async (task) => {
    const marketCode = task.intent.marketCode || "KW";
    const merchants = await db
      .select()
      .from(schema.merchants)
      .where(eq(schema.merchants.marketCode, marketCode))
      .limit(5);

    const merchantIds = merchants.map((m) => m.id);
    let products: schema.Product[] = [];

    if (merchantIds.length > 0) {
      products = await db
        .select()
        .from(schema.products)
        .limit(10);
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

  // Product Agent — searches products
  product_agent: async (task) => {
    const allProducts = await db
      .select()
      .from(schema.products)
      .limit(10);

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

  // Order Agent — tracks and manages orders
  order_agent: async (task) => {
    const userId = task.input.userId as number | undefined;
    if (!userId) {
      return { requiresAuth: true, message: "يرجى تسجيل الدخول لتتبع طلباتك" };
    }

    const userOrders = await db
      .select()
      .from(schema.orders)
      .limit(5);

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

  // Payment Agent — processes payments
  payment_agent: async (task) => {
    const marketCode = task.intent.marketCode || "KW";

    // Check market payment methods
    const marketGateways = getMarketPaymentGateways(marketCode);

    return {
      availableGateways: marketGateways,
      escrowEnabled: true,
      biometricEnabled: true,
      currency: getMarketCurrency(marketCode),
    };
  },

  // Cart Agent — manages cart
  cart_agent: async (task) => {
    const userId = task.input.userId as number | undefined;
    if (!userId) {
      return { requiresAuth: true, itemCount: 0, total: 0 };
    }

    const items = await db
      .select()
      .from(schema.cartItems)
      .limit(20);

    return {
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      itemCount: items.length,
    };
  },

  // Haggle Agent — price negotiation
  haggle_agent: async (task) => {
    const originalPrice = task.input.originalPrice as number || 100;
    const targetPrice = originalPrice * 0.85; // AI suggests 15% off

    return {
      originalPrice,
      suggestedPrice: Math.round(targetPrice * 100) / 100,
      discount: "15%",
      concessionRange: { min: originalPrice * 0.75, max: originalPrice * 0.95 },
      strategy: "gradual",
    };
  },

  // Zakat Agent — zakat calculations
  zakat_agent: async (task) => {
    const marketCode = task.intent.marketCode || "KW";

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

  // Fleet Agent — delivery tracking
  fleet_agent: async (task) => {
    const drivers = await db
      .select()
      .from(schema.drivers)
      .limit(5);

    return {
      availableDrivers: drivers.filter((d) => d.status === "available").length,
      drivers: drivers.map((d) => ({
        id: d.id,
        name: d.fullName,
        vehicle: d.vehicleType,
        rating: d.rating,
        status: d.status,
      })),
      avgDeliveryTime: 15, // minutes
    };
  },

  // Recruitment Agent — jobs and candidates
  recruitment_agent: async (task) => {
    const jobPosts = await db
      .select()
      .from(schema.jobPosts)
      .limit(5);

    const candidates = await db
      .select()
      .from(schema.candidates)
      .limit(5);

    return {
      jobs: jobPosts.map((j) => ({
        id: j.id,
        title: j.title,
        salary: `${j.salaryMin}-${j.salaryMax} ${j.currency}`,
        location: j.location,
      })),
      candidates: candidates.map((c) => ({
        id: c.id,
        name: c.fullName,
        title: c.title,
        score: c.aiScore,
      })),
    };
  },

  // Islamic Agent — halal compliance
  islamic_agent: async (task) => {
    const checks = await db
      .select()
      .from(schema.islamicProductChecks)
      .limit(10);

    return {
      checks: checks.map((c) => ({
        productId: c.productId,
        productName: c.productName,
        isHalal: c.isHalal,
        confidence: c.confidence,
      })),
      halalRate: checks.length > 0
        ? checks.filter((c) => c.isHalal).length / checks.length
        : 1.0,
    };
  },

  // Biometric Agent
  biometric_agent: async () => {
    return {
      supported: ["face", "fingerprint"],
      enrolled: false,
      livenessRequired: true,
    };
  },

  // Vision Agent
  vision_agent: async () => {
    return {
      scanTypes: ["product_scan", "document_verification", "image_search", "receipt_ocr"],
      avgProcessingTime: 2000,
    };
  },

  // Voice Agent
  voice_agent: async (task) => {
    return {
      supportedDialects: ["gulf", "egyptian", "levantine", "maghrebi"],
      detectedDialect: "gulf",
      confidence: 0.94,
      inputText: task.input.message,
    };
  },

  // GenSaaS Agent
  gensaas_agent: async () => {
    const templates = await db
      .select()
      .from(schema.saasTemplates)
      .limit(5);

    return {
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        price: t.pricingMonthly,
      })),
      deployTime: "3 دقائق",
    };
  },

  // GenAggregator Agent
  genaggregator_agent: async () => {
    const platforms = await db
      .select()
      .from(schema.aggregatorPlatforms)
      .limit(5);

    return {
      platforms: platforms.map((p) => ({
        id: p.id,
        name: p.name,
        vendorCount: 0,
      })),
    };
  },

  // Supplier Agent
  supplier_agent: async (task) => {
    const marketCode = task.intent.marketCode || "KW";
    const suppliers = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.marketCode, marketCode))
      .limit(5);

    return {
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.businessName,
        type: s.businessType,
        rating: s.rating,
      })),
    };
  },

  // Cross-Border Agent
  crossborder_agent: async () => {
    const orders = await db
      .select()
      .from(schema.crossborderOrders)
      .limit(5);

    return {
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        origin: o.originCountry,
        destination: o.destinationCountry,
        total: o.totalCost,
      })),
      murabahaEnabled: true,
    };
  },

  // Widget Agent
  widget_agent: async () => {
    return {
      widgetTypes: ["chat", "booking", "product_carousel", "payment_button", "lead_form"],
      embedTime: "2 دقائق",
    };
  },

  // A2A Agent
  a2a_agent: async () => {
    const agents = await db
      .select()
      .from(schema.a2aAgents)
      .limit(5);

    return {
      availableAgents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.agentType,
        price: a.listingPrice,
      })),
    };
  },

  // Analytics Agent
  analytics_agent: async (task) => {
    const marketCode = task.intent.marketCode || "KW";
    const analytics = await db
      .select()
      .from(schema.analytics)
      .limit(10);

    return {
      metrics: analytics.map((a) => ({
        metric: a.metric,
        value: a.value,
        category: a.category,
      })),
      marketCode,
    };
  },

  // Memory Agent
  memory_agent: async (task) => {
    const userId = task.input.userId as number | undefined;
    if (!userId) return { preferences: {} };

    const memories = await db
      .select()
      .from(schema.memory)
      .limit(20);

    const prefs: Record<string, string> = {};
    memories.forEach((m) => {
      prefs[m.key] = m.value;
    });

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
    KW: [...base, "cash"],
    SA: [...base, "cash", "stc_pay"],
    AE: [...base, "cash", "pay_by_card"],
    QA: [...base, "cash"],
    BH: [...base, "cash"],
    OM: [...base, "cash"],
    JO: ["cash", "card"],
    EG: ["cash", "card", "vodafone_cash"],
  };
  return marketMap[marketCode] || base;
}

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// SWARM ORCHESTRATOR CLASS
// ============================================
export class SwarmOrchestrator {
  private config: SwarmConfig;
  private responseSynthesizer: ResponseSynthesizer;
  private bubbleGenerator: BubbleGenerator;
  private runningTasks: Map<string, SwarmTask> = new Map();
  private agentLoad: Map<AgentType, number> = new Map();

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.responseSynthesizer = new ResponseSynthesizer();
    this.bubbleGenerator = new BubbleGenerator();

    // Initialize agent load tracking
    for (const agentType of Object.keys(AGENT_REGISTRY) as AgentType[]) {
      this.agentLoad.set(agentType, 0);
    }
  }

  /**
   * Execute a task using the swarm
   * Main entry point for multi-agent task processing
   */
  async execute(input: SwarmInput): Promise<SwarmOutput> {
    const startTime = Date.now();

    try {
      // ── Step 1: Detect intent ──────────────────────────────────────
      const parsedIntent = await this.detectIntent(input);

      // ── Step 2: Build conversation context ─────────────────────────
      const context = await this.buildContext(input, parsedIntent);

      // ── Step 3: Decompose task into sub-tasks ──────────────────────
      const tasks = this.decomposeTask(parsedIntent, input, context);

      // ── Step 4: Execute tasks (parallel for independent) ───────────
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

      // ── Step 5: Aggregate results ──────────────────────────────────
      const swarmResults = this.aggregateResults(executedTasks);

      // ── Step 6: Synthesize response ────────────────────────────────
      const synthesizedResponse = await this.responseSynthesizer.synthesize(
        swarmResults,
        context,
      );

      // ── Step 7: Generate bubbles ───────────────────────────────────
      const bubbles = await this.bubbleGenerator.generate(context, swarmResults);

      // ── Step 8: Log execution ──────────────────────────────────────
      await this.logExecution(input, tasks, swarmResults);

      const executionTimeMs = Date.now() - startTime;

      return {
        response: synthesizedResponse,
        bubbles,
        tasks: executedTasks,
        executionTimeMs,
        agentCalls: executedTasks.length,
        confidence: synthesizedResponse.confidence,
        metadata: {
          intent: parsedIntent,
          agentsUsed: executedTasks.map((t) => t.agentType),
          marketCode: input.marketCode,
          tokensUsed: swarmResults.reduce((sum, r) => sum + r.tokensUsed, 0),
        },
      };
    } catch (error) {
      return this.handleExecutionError(error, input, startTime);
    }
  }

  /**
   * Step 1: Detect user intent using AI
   */
  private async detectIntent(input: SwarmInput): Promise<ParsedIntent> {
    const result = detectIntent(input.message);

    return {
      intent: result.intent as IntentType,
      confidence: result.confidence,
      entities: result.entities,
      secondaryIntents: [],
      sentiment: this.detectSentiment(input.message),
      marketCode: input.marketCode || "KW",
    };
  }

  /**
   * Detect sentiment from Arabic text
   */
  private detectSentiment(text: string): "positive" | "neutral" | "negative" | "urgent" {
    const urgent = /عاجل|ضروري|بسرعة|فورا|الحين|دحين/;
    const negative = /سيئ|رديء|مكسور|تالف|غاضب|زفت|فاشل/;
    const positive = /ممتاز|حلو|شكرا|رائع|أحب|ممتاز|روعه/;

    if (urgent.test(text)) return "urgent";
    if (negative.test(text)) return "negative";
    if (positive.test(text)) return "positive";
    return "neutral";
  }

  /**
   * Step 2: Build conversation context from input
   */
  private async buildContext(
    input: SwarmInput,
    intent: ParsedIntent,
  ): Promise<ConversationContext> {
    const sessionId = input.sessionId || `sess_${Date.now()}`;

    // Load user memory if available
    let entityMemory: Record<string, string> = {};
    if (input.userId) {
      try {
        const memories = await db
          .select()
          .from(schema.memory)
          .limit(20);
        memories.forEach((m) => {
          entityMemory[m.key] = m.value;
        });
      } catch {
        // Memory not critical
      }
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
        savedAddresses: [],
        dietaryRestrictions: [],
        favoriteMerchants: [],
      },
      market: this.getMarketConfig(input.marketCode),
      lastIntent: intent.intent,
      entityMemory,
    };
  }

  /**
   * Get market configuration for one of 18 Arab markets
   */
  private getMarketConfig(code: string): ConversationContext["market"] {
    const configs: Record<string, ConversationContext["market"]> = {
      KW: { code: "KW", nameAr: "الكويت", nameEn: "Kuwait", currency: "KWD", currencySymbol: "د.ك", timezone: "Asia/Kuwait", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: true, supportsApplePay: true, supportsGooglePay: true, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا والله" },
      SA: { code: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", currency: "SAR", currencySymbol: "ر.س", timezone: "Asia/Riyadh", rtl: true, vatRate: 0.15, supportsCod: true, supportsKnet: false, supportsApplePay: true, supportsGooglePay: true, defaultLanguage: "ar", dialect: "gulf", localGreeting: "السلام عليكم" },
      AE: { code: "AE", nameAr: "الإمارات", nameEn: "UAE", currency: "AED", currencySymbol: "د.إ", timezone: "Asia/Dubai", rtl: true, vatRate: 0.05, supportsCod: true, supportsKnet: false, supportsApplePay: true, supportsGooglePay: true, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا بيك" },
      QA: { code: "QA", nameAr: "قطر", nameEn: "Qatar", currency: "QAR", currencySymbol: "ر.ق", timezone: "Asia/Qatar", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: false, supportsApplePay: true, supportsGooglePay: true, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا والله" },
      BH: { code: "BH", nameAr: "البحرين", nameEn: "Bahrain", currency: "BHD", currencySymbol: "د.ب", timezone: "Asia/Bahrain", rtl: true, vatRate: 0.1, supportsCod: true, supportsKnet: false, supportsApplePay: true, supportsGooglePay: true, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا بيك" },
      OM: { code: "OM", nameAr: "عمان", nameEn: "Oman", currency: "OMR", currencySymbol: "ر.ع", timezone: "Asia/Muscat", rtl: true, vatRate: 0.05, supportsCod: true, supportsKnet: false, supportsApplePay: true, supportsGooglePay: true, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا والله" },
      JO: { code: "JO", nameAr: "الأردن", nameEn: "Jordan", currency: "JOD", currencySymbol: "د.أ", timezone: "Asia/Amman", rtl: true, vatRate: 0.16, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "levantine", localGreeting: "مرحبا" },
      EG: { code: "EG", nameAr: "مصر", nameEn: "Egypt", currency: "EGP", currencySymbol: "ج.م", timezone: "Africa/Cairo", rtl: true, vatRate: 0.14, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "egyptian", localGreeting: "أهلاً" },
      IQ: { code: "IQ", nameAr: "العراق", nameEn: "Iraq", currency: "IQD", currencySymbol: "د.ع", timezone: "Asia/Baghdad", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا بالغالين" },
      LB: { code: "LB", nameAr: "لبنان", nameEn: "Lebanon", currency: "LBP", currencySymbol: "ل.ل", timezone: "Asia/Beirut", rtl: true, vatRate: 0.11, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "levantine", localGreeting: "مرحبا" },
      DZ: { code: "DZ", nameAr: "الجزائر", nameEn: "Algeria", currency: "DZD", currencySymbol: "د.ج", timezone: "Africa/Algiers", rtl: true, vatRate: 0.19, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "maghrebi", localGreeting: "السلام عليكم" },
      TN: { code: "TN", nameAr: "تونس", nameEn: "Tunisia", currency: "TND", currencySymbol: "د.ت", timezone: "Africa/Tunis", rtl: true, vatRate: 0.19, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "maghrebi", localGreeting: "أهلا وسهلا" },
      MA: { code: "MA", nameAr: "المغرب", nameEn: "Morocco", currency: "MAD", currencySymbol: "د.م", timezone: "Africa/Casablanca", rtl: true, vatRate: 0.2, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "maghrebi", localGreeting: "السلام عليكم" },
      LY: { code: "LY", nameAr: "ليبيا", nameEn: "Libya", currency: "LYD", currencySymbol: "د.ل", timezone: "Africa/Tripoli", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "maghrebi", localGreeting: "هلا والله" },
      SD: { code: "SD", nameAr: "السودان", nameEn: "Sudan", currency: "SDG", currencySymbol: "ج.س", timezone: "Africa/Khartoum", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "gulf", localGreeting: "السلام عليكم" },
      YE: { code: "YE", nameAr: "اليمن", nameEn: "Yemen", currency: "YER", currencySymbol: "ر.ي", timezone: "Asia/Aden", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "gulf", localGreeting: "هلا بيك" },
      PS: { code: "PS", nameAr: "فلسطين", nameEn: "Palestine", currency: "ILS", currencySymbol: "₪", timezone: "Asia/Gaza", rtl: true, vatRate: 0.17, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "levantine", localGreeting: "السلام عليكم" },
      SY: { code: "SY", nameAr: "سوريا", nameEn: "Syria", currency: "SYP", currencySymbol: "ل.س", timezone: "Asia/Damascus", rtl: true, vatRate: 0, supportsCod: true, supportsKnet: false, supportsApplePay: false, supportsGooglePay: false, defaultLanguage: "ar", dialect: "levantine", localGreeting: "أهلاً" },
    };

    return configs[code] || configs["KW"];
  }

  /**
   * Step 3: Decompose task into sub-tasks for agent assignment
   */
  private decomposeTask(
    intent: ParsedIntent,
    input: SwarmInput,
    _context: ConversationContext,
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
        intent,
        input: {
          message: input.message,
          userId: input.userId,
          marketCode: input.marketCode,
          ...intent.entities,
          ...input.context,
        },
        status: "pending",
        priority: this.calculatePriority(intent, i),
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

    // If no agents matched, add a fallback general chat task
    if (tasks.length === 0) {
      tasks.push({
        id: generateTaskId(),
        agentType: "intent_detector",
        intent,
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

  /**
   * Calculate task priority based on intent and position
   */
  private calculatePriority(intent: ParsedIntent, index: number): number {
    const basePriority: Record<IntentType, number> = {
      food_order: 8,
      product_search: 7,
      order_tracking: 9,
      payment: 10,
      checkout: 10,
      cart_add: 6,
      cart_remove: 6,
      cart_view: 5,
      job_seeker: 7,
      hire_worker: 7,
      create_store: 6,
      haggle: 7,
      return_item: 8,
      dna_crossbreed: 4,
      zakat_calculate: 7,
      islamic_check: 6,
      fleet_track: 8,
      biometric_auth: 10,
      vision_scan: 6,
      voice_query: 5,
      saas_deploy: 5,
      aggregator_browse: 6,
      widget_embed: 4,
      a2a_trade: 5,
      crossborder_order: 7,
      supplier_search: 6,
      analytics_view: 5,
      general_chat: 3,
      greeting: 3,
      help: 4,
      ambiguous: 2,
      error: 1,
    };

    const base = basePriority[intent.intent] || 5;
    // Reduce priority for secondary agents
    return Math.max(1, base - index);
  }

  /**
   * Separate tasks by dependencies for parallel vs sequential execution
   */
  private separateByDependencies(tasks: SwarmTask[]): {
    independent: SwarmTask[];
    dependent: SwarmTask[];
  } {
    const independent = tasks.filter((t) => t.dependencies.length === 0);
    const dependent = tasks.filter((t) => t.dependencies.length > 0);
    return { independent, dependent };
  }

  /**
   * Execute a single task with an agent
   */
  private async executeTask(task: SwarmTask): Promise<SwarmTask> {
    const registryEntry = AGENT_REGISTRY[task.agentType];

    // Check agent availability
    if (!this.isAgentAvailable(task.agentType)) {
      return this.handleFailure({
        ...task,
        status: "failed",
        error: `Agent ${task.agentType} is at capacity`,
      });
    }

    // Increment load
    this.agentLoad.set(task.agentType, (this.agentLoad.get(task.agentType) || 0) + 1);
    this.runningTasks.set(task.id, task);

    const startTime = Date.now();
    task.status = "running";
    task.startedAt = new Date();

    try {
      // Get the executor for this agent
      const executor = AGENT_EXECUTORS[task.agentType];

      if (!executor) {
        throw new SwarmError(
          `No executor registered for agent: ${task.agentType}`,
          "AGENT_ERROR",
          task.id,
          task.agentType,
        );
      }

      // Execute with timeout
      const timeoutMs = registryEntry?.timeoutMs || this.config.defaultTimeoutMs;
      const output = await this.executeWithTimeout(executor, task, timeoutMs);

      task.output = output;
      task.status = "completed";
      task.completedAt = new Date();
      task.metadata.executionTimeMs = Date.now() - startTime;

      // Decrement load
      this.agentLoad.set(task.agentType, Math.max(0, (this.agentLoad.get(task.agentType) || 1) - 1));
      this.runningTasks.delete(task.id);

      return task;
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = new Date();

      // Decrement load
      this.agentLoad.set(task.agentType, Math.max(0, (this.agentLoad.get(task.agentType) || 1) - 1));
      this.runningTasks.delete(task.id);

      return this.handleFailure(task);
    }
  }

  /**
   * Execute with timeout wrapper
   */
  private executeWithTimeout(
    executor: AgentExecutor,
    task: SwarmTask,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${task.agentType} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      executor(task)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Execute tasks in parallel (independent tasks only)
   */
  private async executeParallel(tasks: SwarmTask[]): Promise<SwarmTask[]> {
    if (tasks.length === 0) return [];

    // Limit concurrent execution
    const limit = Math.min(tasks.length, this.config.maxParallelTasks);
    const executing: Promise<SwarmTask>[] = [];
    const results: SwarmTask[] = [];

    // Start initial batch
    for (let i = 0; i < limit; i++) {
      executing.push(this.executeTask(tasks[i]));
    }

    // Process remaining as slots free up
    let nextIndex = limit;

    while (executing.length > 0) {
      const completed = await Promise.race(executing);
      results.push(completed);

      // Replace completed promise with next task
      const completedIndex = executing.findIndex(
        (p) => p === executing.find((ep) => ep === Promise.resolve(completed)),
      );

      if (nextIndex < tasks.length) {
        executing[completedIndex] = this.executeTask(tasks[nextIndex]);
        nextIndex++;
      } else {
        executing.splice(completedIndex, 1);
      }
    }

    return results;
  }

  /**
   * Execute tasks in sequence (for dependent tasks)
   */
  private async executeSequential(tasks: SwarmTask[]): Promise<SwarmTask[]> {
    const results: SwarmTask[] = [];

    for (const task of tasks) {
      // Check if dependencies are met
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

      // Stop on critical failure
      if (result.status === "failed" && result.priority >= 9) {
        break;
      }
    }

    return results;
  }

  /**
   * Aggregate results from multiple agents into unified SwarmResults
   */
  private aggregateResults(tasks: SwarmTask[]): SwarmResult[] {
    return tasks.map((task) => ({
      taskId: task.id,
      agentType: task.agentType,
      intent: task.intent.intent,
      success: task.status === "completed",
      data: task.output || {},
      error: task.error,
      confidence: task.intent.confidence,
      executionTimeMs: (task.metadata.executionTimeMs as number) || 0,
      tokensUsed: 0,
    }));
  }

  /**
   * Check if an agent is available (not at capacity)
   */
  private isAgentAvailable(agentType: AgentType): boolean {
    const registryEntry = AGENT_REGISTRY[agentType];
    if (!registryEntry || !registryEntry.isEnabled) return false;

    const currentLoad = this.agentLoad.get(agentType) || 0;
    return currentLoad < registryEntry.maxConcurrent;
  }

  /**
   * Handle agent failures with fallback strategy
   */
  private async handleFailure(task: SwarmTask): Promise<SwarmTask> {
    const registryEntry = AGENT_REGISTRY[task.agentType];

    // Retry if under max retries
    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = "retrying";

      // Exponential backoff
      const backoffMs = Math.pow(2, task.retryCount) * 1000;
      await new Promise((r) => setTimeout(r, backoffMs));

      return this.executeTask(task);
    }

    // Try fallback agent
    if (registryEntry?.fallbackAgent) {
      const fallbackEntry = AGENT_REGISTRY[registryEntry.fallbackAgent];
      if (fallbackEntry?.isEnabled) {
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

        return this.executeTask(fallbackTask);
      }
    }

    // All fallbacks exhausted
    task.status = "failed";
    return task;
  }

  /**
   * Log execution to agent_logs table
   */
  private async logExecution(
    input: SwarmInput,
    tasks: SwarmTask[],
    results: SwarmResult[],
  ): Promise<void> {
    if (!this.config.logAgentCalls) return;

    try {
      await db.insert(schema.agentLogs).values({
        agentName: "swarm_orchestrator",
        userId: input.userId,
        intent: tasks[0]?.intent.intent,
        input: input.message.substring(0, 1000),
        output: JSON.stringify(results.map((r) => ({
          agent: r.agentType,
          success: r.success,
          intent: r.intent,
        }))),
        tokensUsed: results.reduce((sum, r) => sum + r.tokensUsed, 0),
        cost: 0,
        duration: 0,
      });
    } catch {
      // Logging failure is non-critical
    }
  }

  /**
   * Handle execution errors gracefully
   */
  private handleExecutionError(
    error: unknown,
    input: SwarmInput,
    startTime: number,
  ): SwarmOutput {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return {
      response: {
        text: "عذراً ما فهمت طلبك — تقدر توضح أكثر؟",
        language: "ar",
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
      metadata: {
        intent: {
          intent: "error",
          confidence: 0,
          entities: {},
          secondaryIntents: [],
          sentiment: "negative",
          marketCode: input.marketCode,
        },
        agentsUsed: [],
        marketCode: input.marketCode,
        tokensUsed: 0,
      },
    };
  }
}
