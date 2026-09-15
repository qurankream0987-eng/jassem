/**
 * Agent Router - Routes requests to appropriate AI agents
 * Manages 20 agent configurations with triggers, capabilities, and routing logic
 */

import { z } from "zod";
import type {
  AgentType,
  IntentType,
  AgentConfig,
  AgentTier,
  RoutingResult,
  ParsedIntent,
} from "./types";
import { AgentTypeSchema, IntentTypeSchema, ParsedIntentSchema } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  agentNotFound: "الوكيل غير موجود",
  routingFailed: "فشل في توجيه الطلب",
  invalidIntent: "نوع الطلب غير صالح",
  invalidAgent: "نوع الوكيل غير صالح",
} as const;

// ============================================
// AGENT CONFIGURATIONS - All 20 agents
// ============================================

const AGENT_REGISTRY: Record<AgentType, AgentConfig> = {
  food: {
    type: "food",
    name: "Food Agent",
    nameAr: "وكيل الطعام",
    description: "Handles restaurant discovery, menu browsing, and food ordering",
    triggers: [
      "food", "restaurant", "menu", "order food", "hungry", "delivery",
      "مطعم", "أكل", "طعام", "اكل", "طلب", "برياني", "كبسة", "شاورما",
      "مندي", "فطور", "غدا", "عشا", "توصيل أكل",
    ],
    confidence: 0.95,
    tier: 1,
    capabilities: [
      "restaurant_search", "menu_browse", "food_order", "delivery_tracking",
      "cuisine_filter", "rating_view", "recommendations", "group_order",
    ],
    router: "api/routers/orders",
  },
  fashion: {
    type: "fashion",
    name: "Fashion Agent",
    nameAr: "وكيل الأزياء",
    description: "Handles clothing, accessories, and fashion product discovery",
    triggers: [
      "fashion", "clothes", "clothing", "dress", "shirt", "shoes", "accessories",
      "ملابس", "أزياء", "موضة", "فستان", "قميص", "حذاء", "إكسسوارات",
      "عباية", "شيلة", "ثوب", "جلباب",
    ],
    confidence: 0.88,
    tier: 1,
    capabilities: [
      "product_search", "size_guide", "color_filter", "brand_browse",
      "virtual_try_on", "wishlist", "style_recommendations",
    ],
    router: "api/routers/products",
  },
  grocery: {
    type: "grocery",
    name: "Grocery Agent",
    nameAr: "وكيل البقالة",
    description: "Handles grocery shopping, supermarkets, and daily essentials",
    triggers: [
      "grocery", "supermarket", "vegetables", "fruits", "meat", "dairy",
      "بقالة", "سوبرماركت", "خضار", "فواكه", "لحم", "حليب", "خبز",
      "سبرماركت", "بقال", "مواد غذائية", "تموينات",
    ],
    confidence: 0.9,
    tier: 1,
    capabilities: [
      "product_search", "category_browse", "recipe_ingredients",
      "subscription_box", "schedule_delivery", "inventory_check",
    ],
    router: "api/routers/products",
  },
  pharmacy: {
    type: "pharmacy",
    name: "Pharmacy Agent",
    nameAr: "وكيل الصيدلية",
    description: "Handles medicine search, prescriptions, and pharmacy orders",
    triggers: [
      "pharmacy", "medicine", "drug", "prescription", "pill", "vitamin",
      "صيدلية", "دواء", "علاج", "دوا", "حبوب", "فيتامين", "وصفة طبية",
      "صيدلي", "مضاد حيوي", "مسكن", "مرهم", "شراب",
    ],
    confidence: 0.92,
    tier: 1,
    capabilities: [
      "medicine_search", "prescription_upload", "dosage_info",
      "drug_interaction", "pharmacy_locator", "refill_reminder",
      "generic_alternatives",
    ],
    router: "api/routers/orders",
  },
  delivery: {
    type: "delivery",
    name: "Delivery Agent",
    nameAr: "وكيل التوصيل",
    description: "Handles delivery logistics, tracking, and route optimization",
    triggers: [
      "delivery", "shipping", "track", "order status", "where is my order",
      "توصيل", "طلبي", "وين", "شحن", "tracking", "طلبية", "اوردر",
    ],
    confidence: 0.9,
    tier: 2,
    capabilities: [
      "order_tracking", "route_view", "eta_calculation",
      "delivery_schedule", "address_management", "delivery_preferences",
    ],
    router: "api/routers/orders",
  },
  b2b_supplier: {
    type: "b2b_supplier",
    name: "B2B Supplier Agent",
    nameAr: "وكيل الموردين",
    description: "Handles wholesale, bulk orders, and supplier connections",
    triggers: [
      "b2b", "supplier", "wholesale", "bulk", "vendor", "trade",
      "مورد", "جملة", "بالجملة", "توريد", "تاجر", "بائع", "شركة",
      "تصدير", "استيراد", "تجارة", "فرنشايز", "وكيل",
    ],
    confidence: 0.85,
    tier: 2,
    capabilities: [
      "supplier_search", "quote_request", "contract_negotiation",
      "bulk_order", "inventory_sync", "supplier_rating",
    ],
    router: "api/routers/suppliers",
  },
  cross_border: {
    type: "cross_border",
    name: "Cross Border Agent",
    nameAr: "وكيل التجارة العابرة",
    description: "Handles cross-border trade, customs, and international shipping",
    triggers: [
      "cross border", "international", "import", "export", "customs",
      "تجارة عابرة", "تصدير", "استيراد", "جمارك", "دولي", "خارجي",
      "transit", "border", "trade zone",
    ],
    confidence: 0.87,
    tier: 2,
    capabilities: [
      "customs_calculation", "document_generation", "shipping_quote",
      "compliance_check", "tracking_international", "duty_calculator",
    ],
    router: "api/routers/crossborder",
  },
  haggle: {
    type: "haggle",
    name: "Haggle Agent",
    nameAr: "وكيل المساومة",
    description: "AI-powered price negotiation for products and services",
    triggers: [
      "haggle", "negotiate", "discount", "offer", "deal", " cheaper",
      "خصم", "تخفيض", "عرض", "فلوس", "غالي", "رخيص", "سوم", "فاضي",
      "تنزل", "مجال", "كم آخر", "أقل سعر", "best price",
    ],
    confidence: 0.93,
    tier: 1,
    capabilities: [
      "price_negotiation", "discount_calculation", "counter_offer",
      "price_history", "market_comparison", "bundle_deals",
    ],
    router: "api/routers/haggle",
  },
  fleet: {
    type: "fleet",
    name: "Fleet Agent",
    nameAr: "وكيل الأسطول",
    description: "Manages delivery fleet, drivers, and logistics operations",
    triggers: [
      "fleet", "driver", "vehicle", "delivery guy", "sos",
      "سائق", "مندوب", "سيارة", "دراجة", "fleet manager",
      "موظف توصيل", "كابتن", "سطر", "أسطول",
    ],
    confidence: 0.88,
    tier: 2,
    capabilities: [
      "driver_tracking", "route_optimization", "fleet_dashboard",
      "sos_alert", "driver_rating", "assignment_management",
    ],
    router: "api/routers/fleet",
  },
  recruitment: {
    type: "recruitment",
    name: "Recruitment Agent",
    nameAr: "وكيل التوظيف",
    description: "Handles job postings, CV generation, and candidate matching",
    triggers: [
      "job", "career", "cv", "resume", "hire", "employment",
      "وظيفة", "وظائف", "شغل", "سيرة ذاتية", "توظيف", "دوام",
      "cv builder", "job search", "apply", "مرتب", "راتب",
    ],
    confidence: 0.9,
    tier: 2,
    capabilities: [
      "cv_generation", "job_search", "candidate_matching",
      "interview_scheduler", "skill_assessment", "salary_insights",
    ],
    router: "api/routers/recruitment",
  },
  vision: {
    type: "vision",
    name: "Vision Agent",
    nameAr: "وكيل الرؤية",
    description: "AI computer vision for product scanning, OCR, and image search",
    triggers: [
      "scan", "image", "photo", "picture", "ocr", "barcode",
      "مسح", "صورة", "كاميرا", "باركود", "قراءة صورة", "بحث بالصورة",
      "camera", "lens", "visual search",
    ],
    confidence: 0.85,
    tier: 3,
    capabilities: [
      "product_scan", "barcode_scan", "ocr_receipt", "image_search",
      "document_verification", "object_detection", "face_recognition",
    ],
    router: "api/routers/vision",
  },
  voice: {
    type: "voice",
    name: "Voice Agent",
    nameAr: "وكيل الصوت",
    description: "Handles voice interactions, speech-to-text, and text-to-speech",
    triggers: [
      "voice", "speak", "call", "audio", "listen",
      "صوت", "اتصل", "مكالمة", "سمع", "تحدث", " dictated",
      "voice search", "voice order", "hands free",
    ],
    confidence: 0.82,
    tier: 3,
    capabilities: [
      "speech_to_text", "text_to_speech", "dialect_detection",
      "voice_order", "voice_search", "audio_playback",
    ],
    router: "api/routers/voice",
  },
  smart_connect: {
    type: "smart_connect",
    name: "Smart Connect Agent",
    nameAr: "وكيل الربط الذكي",
    description: "Connects external POS and e-commerce systems",
    triggers: [
      "connect", "integration", "pos", "sync", "import",
      "ربط", "توصيل", "نظام", "erp", "accounting", "مزامنة",
      "toast", "square", "clover", "shopify", "woocommerce", "api",
    ],
    confidence: 0.86,
    tier: 2,
    capabilities: [
      "pos_integration", "api_sync", "data_import",
      "webhook_management", "field_mapping", "system_health",
    ],
    router: "api/routers/smartconnect",
  },
  gen_saas: {
    type: "gen_saas",
    name: "Gen-SaaS Agent",
    nameAr: "وكيل المنصات",
    description: "Generates and deploys SaaS applications without coding",
    triggers: [
      "saas", "app builder", "create app", "deploy", "website",
      "تطبيق", "موقع", "متجر", "برنامج", "no code", "without coding",
      "منصة", "موقع إلكتروني", "تطبيقي", "متجري", "افتح متجر",
    ],
    confidence: 0.84,
    tier: 3,
    capabilities: [
      "template_selection", "app_generation", "deployment",
      "customization", "workflow_builder", "analytics_setup",
    ],
    router: "api/routers/gensaas",
  },
  gen_aggregator: {
    type: "gen_aggregator",
    name: "Gen-Aggregator Agent",
    nameAr: "وكيل السوق المتعدد",
    description: "Creates multi-vendor marketplace platforms",
    triggers: [
      "marketplace", "multi vendor", "platform", "aggregator",
      "سوق", "بائعين", "منصة", "متعدد البائعين", "marché",
      "uber model", "amazon model", "like talabat", "create platform",
    ],
    confidence: 0.85,
    tier: 3,
    capabilities: [
      "platform_creation", "vendor_management", "commission_setup",
      "theme_customization", "payment_split", "analytics_dashboard",
    ],
    router: "api/routers/genaggregator",
  },
  widget: {
    type: "widget",
    name: "Widget Agent",
    nameAr: "وكيل الأدوات",
    description: "Creates embeddable widgets for external websites",
    triggers: [
      "widget", "embed", "plugin", "website", "integration",
      "ودجت", "تضمين", "إضافة", "موقع", "مدونة", "html",
      "chat widget", "booking button", "product carousel", "iframe",
    ],
    confidence: 0.87,
    tier: 2,
    capabilities: [
      "widget_builder", "embed_code", "appearance_config",
      "domain_whitelist", "event_tracking", "template_gallery",
    ],
    router: "api/routers/widget",
  },
  a2a: {
    type: "a2a",
    name: "A2A Agent",
    nameAr: "وكيل التداول",
    description: "Agent-to-agent trading marketplace",
    triggers: [
      "a2a", "agent trade", "sell agent", "buy agent", "ai agent",
      "تداول وكلاء", "وكيل", "تجارة", "swap", "exchange agent",
      "trade ai", "custom model", "fine tune", "ai model",
    ],
    confidence: 0.8,
    tier: 4,
    capabilities: [
      "agent_listing", "agent_purchase", "agent_trade",
      "skill_transfer", "model_training", "agent_analytics",
    ],
    router: "api/routers/a2a",
  },
  analytics: {
    type: "analytics",
    name: "Analytics Agent",
    nameAr: "وكيل التحليلات",
    description: "Business analytics, reports, and insights",
    triggers: [
      "analytics", "report", "dashboard", "statistics", "metrics",
      "تحليلات", "تقرير", "إحصائيات", "أرقام", "performance",
      "sales report", "revenue", "growth", "insights",
    ],
    confidence: 0.83,
    tier: 3,
    capabilities: [
      "sales_report", "revenue_analytics", "customer_insights",
      "trend_analysis", "forecasting", "export_report",
    ],
    router: "api/routers/orders",
  },
  financial: {
    type: "financial",
    name: "Financial Agent",
    nameAr: "وكيل المالية",
    description: "Handles payments, zakat, and Islamic finance",
    triggers: [
      "payment", "zakat", "finance", "money", "nisab",
      "دفع", "زكاة", "مالية", "فلوس", "نصاب", "gold price",
      "knet", "apple pay", "google pay", "installments", "تقسيط",
    ],
    confidence: 0.91,
    tier: 2,
    capabilities: [
      "payment_processing", "zakat_calculation", "nisab_lookup",
      "escrow_management", "refund_processing", "installment_plan",
    ],
    router: "api/routers/payments",
  },
  mentor: {
    type: "mentor",
    name: "Mentor Agent",
    nameAr: "وكيل المساعدة",
    description: "General help, onboarding, and guidance",
    triggers: [
      "help", "support", "how to", "what is", "guide",
      "مساعدة", "شرح", "كيف", "مش فاهم", "دليل", "مساعده",
      "hello", "hi", "مرحبا", "greeting", "welcome", "شنو",
    ],
    confidence: 0.7,
    tier: 1,
    capabilities: [
      "onboarding", "faq", "feature_guide", "troubleshooting",
      "feedback_collection", "escalation", "general_chat",
    ],
    router: "api/routers/agents",
  },
};

// ============================================
// INTENT TO AGENT MAPPING
// ============================================

const INTENT_AGENT_MAP: Record<IntentType, AgentType[]> = {
  food_order: ["food", "delivery"],
  product_search: ["fashion", "grocery", "pharmacy", "analytics"],
  order_tracking: ["delivery", "fleet"],
  payment: ["financial"],
  b2b_inquiry: ["b2b_supplier", "cross_border"],
  haggle_request: ["haggle", "financial"],
  delivery_tracking: ["fleet", "delivery"],
  cv_generation: ["recruitment"],
  job_search: ["recruitment"],
  job_apply: ["recruitment"],
  connect_pos: ["smart_connect"],
  deploy_saas: ["gen_saas"],
  create_platform: ["gen_aggregator"],
  embed_widget: ["widget"],
  agent_trade: ["a2a"],
  zakat_calc: ["financial"],
  general_chat: ["mentor"],
  greeting: ["mentor"],
  help: ["mentor"],
};

// ============================================
// PARALLEL EXECUTION GROUPS
// ============================================

// Agents that can work in parallel without conflicts
const PARALLEL_COMPATIBLE: Record<string, string[]> = {
  food: ["delivery", "payment", "analytics"],
  fashion: ["analytics", "haggle"],
  grocery: ["delivery", "payment"],
  pharmacy: ["delivery", "payment"],
  delivery: ["fleet", "analytics"],
  haggle: ["financial", "analytics"],
  recruitment: ["analytics"],
  financial: ["analytics", "delivery"],
  mentor: ["food", "fashion", "grocery", "pharmacy"],
};

// ============================================
// PUBLIC API
// ============================================

/**
 * Route an intent to the appropriate agent
 * Returns the best matching agent configuration
 */
export function routeToAgent(intent: ParsedIntent): RoutingResult {
  try {
    const agentTypes = INTENT_AGENT_MAP[intent.type];

    if (!agentTypes || agentTypes.length === 0) {
      // Fallback to mentor
      const fallback = AGENT_REGISTRY.mentor;
      return {
        agent: fallback,
        confidence: 0.5,
        isParallel: false,
        fallbackAgent: fallback,
        estimatedLatency: 200,
      };
    }

    // Get primary agent
    const primaryType = agentTypes[0];
    const agent = AGENT_REGISTRY[primaryType];

    // Check if parallel execution is possible
    const isParallel = canHandleParallel(agentTypes);

    // Get fallback agent
    const fallback = agentTypes.length > 1
      ? AGENT_REGISTRY[agentTypes[1]]
      : AGENT_REGISTRY.mentor;

    // Estimate latency based on agent tier
    const estimatedLatency = estimateLatency(agent.tier);

    return {
      agent,
      confidence: intent.confidence,
      isParallel,
      fallbackAgent: fallback,
      estimatedLatency,
    };
  } catch (error) {
    console.error("[AgentRouter] routeToAgent error:", error);
    return {
      agent: AGENT_REGISTRY.mentor,
      confidence: 0.3,
      isParallel: false,
      estimatedLatency: 100,
    };
  }
}

/**
 * Get configuration for a specific agent type
 */
export function getAgentConfig(agentType: AgentType): AgentConfig {
  const config = AGENT_REGISTRY[agentType];
  if (!config) {
    throw new Error(`${Errors.agentNotFound}: ${agentType}`);
  }
  return config;
}

/**
 * Check if a group of agents can handle requests in parallel
 */
export function canHandleParallel(agentTypes: AgentType[]): boolean {
  if (agentTypes.length <= 1) return false;

  const primary = agentTypes[0];
  const compatible = PARALLEL_COMPATIBLE[primary];

  if (!compatible) return false;

  // Check if all other agents are compatible with primary
  for (let i = 1; i < agentTypes.length; i++) {
    if (!compatible.includes(agentTypes[i])) {
      return false;
    }
  }

  return true;
}

/**
 * Get fallback agent for an intent type
 */
export function getFallbackAgent(intentType: IntentType): AgentConfig {
  const agentTypes = INTENT_AGENT_MAP[intentType];

  if (agentTypes && agentTypes.length > 1) {
    return AGENT_REGISTRY[agentTypes[1]];
  }

  return AGENT_REGISTRY.mentor;
}

/**
 * Get all registered agent configurations
 */
export function getAllAgents(): AgentConfig[] {
  return Object.values(AGENT_REGISTRY);
}

/**
 * Get agents by tier
 */
export function getAgentsByTier(tier: AgentTier): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter(a => a.tier === tier);
}

/**
 * Find agents by capability
 */
export function findAgentsByCapability(capability: string): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter(a =>
    a.capabilities.includes(capability)
  );
}

/**
 * Get agent router path for a given agent type
 */
export function getAgentRouter(agentType: AgentType): string {
  return AGENT_REGISTRY[agentType]?.router || "api/routers/agents";
}

/**
 * Check if an agent can handle a specific intent
 */
export function canAgentHandleIntent(
  agentType: AgentType,
  intentType: IntentType
): boolean {
  const agentTypes = INTENT_AGENT_MAP[intentType];
  if (!agentTypes) return false;
  return agentTypes.includes(agentType);
}

/**
 * Get suggested agents for a conversation
 * Based on user state and recent intents
 */
export function getSuggestedAgents(
  recentIntents: IntentType[]
): AgentConfig[] {
  const agentCounts: Record<string, number> = {};

  // Count agent occurrences
  for (const intent of recentIntents) {
    const types = INTENT_AGENT_MAP[intent];
    if (types) {
      for (const t of types) {
        agentCounts[t] = (agentCounts[t] || 0) + 1;
      }
    }
  }

  // Sort by frequency
  const sorted = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return sorted.map(([type]) => AGENT_REGISTRY[type as AgentType]);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Estimate latency based on agent tier
 */
function estimateLatency(tier: AgentTier): number {
  // Tier 1: Fast (< 200ms)
  // Tier 2: Normal (200-500ms)
  // Tier 3: Slow (500-1000ms)
  // Tier 4: Very slow (1000ms+)
  const latencyMap: Record<AgentTier, number> = {
    1: 150,
    2: 350,
    3: 700,
    4: 1200,
  };
  return latencyMap[tier] || 300;
}
