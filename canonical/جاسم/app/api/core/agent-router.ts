/**
 * ============================================================
 * AGENT ROUTER V2 — Supervisor-Worker Pattern (2026)
 * JASIM Advanced Agent Orchestration
 * ============================================================
 *
 * Implements:
 * - Supervisor agent that decomposes tasks
 * - Routes to specialized worker agents
 * - Synthesizes results from workers
 * - Timeout handling per subtask
 * - Zod schemas for all inputs/outputs
 */

import { z } from "zod";
import {
  JASIMError,
  retryWithBackoff,
  CircuitBreaker,
  getCircuitBreaker,
  executeWithDegradation,
} from "./error-handler";

// ============================================
// ZOD SCHEMAS — All inputs/outputs validated
// ============================================

export const AgentTypeSchema = z.enum([
  "food", "fashion", "grocery", "pharmacy", "delivery",
  "b2b_supplier", "cross_border", "haggle",
  "fleet", "recruitment", "vision", "voice",
  "smart_connect", "gen_saas", "gen_aggregator",
  "widget", "a2a", "analytics", "financial", "mentor",
  // Worker agent subtypes
  "worker_research", "worker_code", "worker_write",
  "worker_analyze", "worker_summarize",
  // Supervisor
  "supervisor",
]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

export const IntentTypeSchema = z.enum([
  "food_order", "product_search", "order_tracking", "payment",
  "b2b_inquiry", "haggle_request", "delivery_tracking",
  "cv_generation", "job_search", "job_apply",
  "connect_pos", "deploy_saas", "create_platform",
  "embed_widget", "agent_trade", "zakat_calc",
  "general_chat", "greeting", "help",
  // Complex multi-step intents
  "multi_step_research", "multi_step_compare",
  "multi_step_order", "multi_step_analyze",
]);

export type IntentType = z.infer<typeof IntentTypeSchema>;

export const AgentTierSchema = z.number().min(1).max(5) as z.ZodType<1 | 2 | 3 | 4 | 5>;

export const ParsedIntentSchema = z.object({
  type: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  entities: z.record(z.string(), z.string()),
  marketCode: z.string().length(2),
  dialect: z.string().default("gulf"),
  requiresAgent: AgentTypeSchema.default("mentor"),
  suggestedBubbles: z.array(z.record(z.string(), z.unknown())).default([]),
  complexity: z.enum(["simple", "normal", "complex", "multi_step"]).default("normal"),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

export const RoutingResultSchema = z.object({
  agent: z.lazy(() => AgentConfigSchema),
  confidence: z.number().min(0).max(1),
  isParallel: z.boolean(),
  fallbackAgent: z.lazy(() => AgentConfigSchema).optional(),
  estimatedLatency: z.number(),
  // V2 fields
  decomposition: z.array(z.lazy(() => SubtaskSchema)).optional(),
  supervisorAssigned: z.boolean().default(false),
  workerAssignments: z.array(z.lazy(() => WorkerAssignmentSchema)).optional(),
  executionStrategy: z.enum(["single", "parallel", "sequential", "supervisor_worker"]).default("single"),
});

export type RoutingResult = z.infer<typeof RoutingResultSchema>;

export const AgentConfigSchema = z.object({
  type: AgentTypeSchema,
  name: z.string(),
  nameAr: z.string(),
  description: z.string(),
  triggers: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  tier: z.number().min(1).max(5) as z.ZodType<1 | 2 | 3 | 4 | 5>,
  capabilities: z.array(z.string()),
  router: z.string(),
  timeoutMs: z.number().default(10000),
  maxWorkers: z.number().default(1),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const SubtaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  agentType: AgentTypeSchema,
  dependencies: z.array(z.string()).default([]),
  timeoutMs: z.number().default(15000),
  priority: z.number().min(1).max(10).default(5),
  input: z.record(z.string(), z.unknown()).default({}),
  maxRetries: z.number().default(2),
});

export type Subtask = z.infer<typeof SubtaskSchema>;

export const WorkerAssignmentSchema = z.object({
  subtaskId: z.string(),
  workerType: AgentTypeSchema,
  supervisorNotes: z.string().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().default(15000),
});

export type WorkerAssignment = z.infer<typeof WorkerAssignmentSchema>;

export const WorkerResultSchema = z.object({
  subtaskId: z.string(),
  workerType: AgentTypeSchema,
  status: z.enum(["pending", "running", "completed", "failed", "timeout"]),
  output: z.record(z.string(), z.unknown()).default({}),
  error: z.string().optional(),
  executionTimeMs: z.number().default(0),
  tokensUsed: z.number().default(0),
});

export type WorkerResult = z.infer<typeof WorkerResultSchema>;

export const SupervisorPlanSchema = z.object({
  taskId: z.string(),
  originalIntent: ParsedIntentSchema,
  subtasks: z.array(SubtaskSchema),
  executionOrder: z.enum(["parallel", "sequential", "mixed"]),
  estimatedTotalTimeMs: z.number(),
  fallbackStrategy: z.enum(["best_effort", "full_retry", "partial_result"]).default("best_effort"),
});

export type SupervisorPlan = z.infer<typeof SupervisorPlanSchema>;

export const SupervisorSynthesisSchema = z.object({
  taskId: z.string(),
  workerResults: z.array(WorkerResultSchema),
  synthesizedOutput: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1),
  synthesisTimeMs: z.number(),
});

export type SupervisorSynthesis = z.infer<typeof SupervisorSynthesisSchema>;

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================

const Errors = {
  agentNotFound: "الوكيل غير موجود",
  routingFailed: "فشل في توجيه الطلب",
  invalidIntent: "نوع الطلب غير صالح",
  invalidAgent: "نوع الوكيل غير صالح",
  supervisorFailed: "فشل المشرف في تفكيك المهمة",
  workerTimeout: "انتهى وقت الوكيل العامل",
  synthesisFailed: "فشل في تركيب النتائج",
} as const;

// ============================================
// AGENT REGISTRY — All agents with Zod validation
// ============================================

const AGENT_REGISTRY: Record<AgentType, AgentConfig> = {
  food: {
    type: "food", name: "Food Agent", nameAr: "وكيل الطعام",
    description: "Handles restaurant discovery, menu browsing, and food ordering",
    triggers: ["food", "restaurant", "menu", "order food", "hungry", "delivery",
      "مطعم", "أكل", "طعام", "اكل", "طلب", "برياني", "كبسة", "شاورما"],
    confidence: 0.95, tier: 1, capabilities: ["restaurant_search", "menu_browse", "food_order"],
    router: "api/routers/orders", timeoutMs: 8000, maxWorkers: 3,
  },
  fashion: {
    type: "fashion", name: "Fashion Agent", nameAr: "وكيل الأزياء",
    description: "Handles clothing, accessories, and fashion product discovery",
    triggers: ["fashion", "clothes", "clothing", "dress", "shirt", "shoes",
      "ملابس", "أزياء", "موضة", "فستان", "قميص", "حذاء"],
    confidence: 0.88, tier: 1, capabilities: ["product_search", "size_guide", "virtual_try_on"],
    router: "api/routers/products", timeoutMs: 8000, maxWorkers: 2,
  },
  grocery: {
    type: "grocery", name: "Grocery Agent", nameAr: "وكيل البقالة",
    description: "Handles grocery shopping, supermarkets, and daily essentials",
    triggers: ["grocery", "supermarket", "vegetables", "fruits",
      "بقالة", "سوبرماركت", "خضار", "فواكه", "لحم"],
    confidence: 0.9, tier: 1, capabilities: ["product_search", "category_browse", "recipe_ingredients"],
    router: "api/routers/products", timeoutMs: 6000, maxWorkers: 2,
  },
  pharmacy: {
    type: "pharmacy", name: "Pharmacy Agent", nameAr: "وكيل الصيدلية",
    description: "Handles medicine search, prescriptions, and pharmacy orders",
    triggers: ["pharmacy", "medicine", "drug", "prescription",
      "صيدلية", "دواء", "علاج", "دوا", "حبوب", "فيتامين"],
    confidence: 0.92, tier: 1, capabilities: ["medicine_search", "prescription_upload", "dosage_info"],
    router: "api/routers/orders", timeoutMs: 8000, maxWorkers: 2,
  },
  delivery: {
    type: "delivery", name: "Delivery Agent", nameAr: "وكيل التوصيل",
    description: "Handles delivery logistics, tracking, and route optimization",
    triggers: ["delivery", "shipping", "track", "order status",
      "توصيل", "طلبي", "وين", "شحن", "tracking"],
    confidence: 0.9, tier: 2, capabilities: ["order_tracking", "route_view", "eta_calculation"],
    router: "api/routers/orders", timeoutMs: 6000, maxWorkers: 2,
  },
  b2b_supplier: {
    type: "b2b_supplier", name: "B2B Supplier Agent", nameAr: "وكيل الموردين",
    description: "Handles wholesale, bulk orders, and supplier connections",
    triggers: ["b2b", "supplier", "wholesale", "bulk",
      "مورد", "جملة", "بالجملة", "توريد", "تاجر"],
    confidence: 0.85, tier: 2, capabilities: ["supplier_search", "quote_request", "contract_negotiation"],
    router: "api/routers/suppliers", timeoutMs: 12000, maxWorkers: 4,
  },
  cross_border: {
    type: "cross_border", name: "Cross Border Agent", nameAr: "وكيل التجارة العابرة",
    description: "Handles cross-border trade, customs, and international shipping",
    triggers: ["cross border", "international", "import", "export", "customs",
      "تجارة عابرة", "تصدير", "استيراد", "جمارك"],
    confidence: 0.87, tier: 2, capabilities: ["customs_calculation", "document_generation", "shipping_quote"],
    router: "api/routers/crossborder", timeoutMs: 15000, maxWorkers: 5,
  },
  haggle: {
    type: "haggle", name: "Haggle Agent", nameAr: "وكيل المساومة",
    description: "AI-powered price negotiation for products and services",
    triggers: ["haggle", "negotiate", "discount", "offer", "deal",
      "خصم", "تخفيض", "عرض", "فلوس", "غالي", "رخيص", "سوم"],
    confidence: 0.93, tier: 1, capabilities: ["price_negotiation", "discount_calculation", "counter_offer"],
    router: "api/routers/haggle", timeoutMs: 10000, maxWorkers: 1,
  },
  fleet: {
    type: "fleet", name: "Fleet Agent", nameAr: "وكيل الأسطول",
    description: "Manages delivery fleet, drivers, and logistics operations",
    triggers: ["fleet", "driver", "vehicle", "delivery guy", "sos",
      "سائق", "مندوب", "سيارة", "سطر", "أسطول"],
    confidence: 0.88, tier: 2, capabilities: ["driver_tracking", "route_optimization", "sos_alert"],
    router: "api/routers/fleet", timeoutMs: 6000, maxWorkers: 3,
  },
  recruitment: {
    type: "recruitment", name: "Recruitment Agent", nameAr: "وكيل التوظيف",
    description: "Handles job postings, CV generation, and candidate matching",
    triggers: ["job", "career", "cv", "resume", "hire",
      "وظيفة", "وظائف", "شغل", "سيرة ذاتية", "توظيف"],
    confidence: 0.9, tier: 2, capabilities: ["cv_generation", "job_search", "candidate_matching"],
    router: "api/routers/recruitment", timeoutMs: 10000, maxWorkers: 3,
  },
  vision: {
    type: "vision", name: "Vision Agent", nameAr: "وكيل الرؤية",
    description: "AI computer vision for product scanning, OCR, and image search",
    triggers: ["scan", "image", "photo", "picture", "ocr", "barcode",
      "مسح", "صورة", "كاميرا", "باركود"],
    confidence: 0.85, tier: 3, capabilities: ["product_scan", "barcode_scan", "ocr_receipt", "image_search"],
    router: "api/routers/vision", timeoutMs: 12000, maxWorkers: 1,
  },
  voice: {
    type: "voice", name: "Voice Agent", nameAr: "وكيل الصوت",
    description: "Handles voice interactions, speech-to-text, and text-to-speech",
    triggers: ["voice", "speak", "call", "audio", "listen",
      "صوت", "اتصل", "مكالمة", "سمع", "تحدث"],
    confidence: 0.82, tier: 3, capabilities: ["speech_to_text", "text_to_speech", "dialect_detection"],
    router: "api/routers/voice", timeoutMs: 10000, maxWorkers: 1,
  },
  smart_connect: {
    type: "smart_connect", name: "Smart Connect Agent", nameAr: "وكيل الربط الذكي",
    description: "Connects external POS and e-commerce systems",
    triggers: ["connect", "integration", "pos", "sync", "import",
      "ربط", "توصيل", "نظام", "erp", "toast", "square", "clover", "shopify"],
    confidence: 0.86, tier: 2, capabilities: ["pos_integration", "api_sync", "data_import"],
    router: "api/routers/smartconnect", timeoutMs: 15000, maxWorkers: 2,
  },
  gen_saas: {
    type: "gen_saas", name: "Gen-SaaS Agent", nameAr: "وكيل المنصات",
    description: "Generates and deploys SaaS applications without coding",
    triggers: ["saas", "app builder", "create app", "deploy", "website",
      "تطبيق", "موقع", "متجر", "no code", "منصة"],
    confidence: 0.84, tier: 3, capabilities: ["template_selection", "app_generation", "deployment"],
    router: "api/routers/gensaas", timeoutMs: 20000, maxWorkers: 5,
  },
  gen_aggregator: {
    type: "gen_aggregator", name: "Gen-Aggregator Agent", nameAr: "وكيل السوق المتعدد",
    description: "Creates multi-vendor marketplace platforms",
    triggers: ["marketplace", "multi vendor", "platform", "aggregator",
      "سوق", "بائعين", "منصة", "متعدد البائعين"],
    confidence: 0.85, tier: 3, capabilities: ["platform_creation", "vendor_management", "commission_setup"],
    router: "api/routers/genaggregator", timeoutMs: 15000, maxWorkers: 5,
  },
  widget: {
    type: "widget", name: "Widget Agent", nameAr: "وكيل الأدوات",
    description: "Creates embeddable widgets for external websites",
    triggers: ["widget", "embed", "plugin",
      "ودجت", "تضمين", "إضافة", "مدونة", "html"],
    confidence: 0.87, tier: 2, capabilities: ["widget_builder", "embed_code", "appearance_config"],
    router: "api/routers/widget", timeoutMs: 10000, maxWorkers: 1,
  },
  a2a: {
    type: "a2a", name: "A2A Agent", nameAr: "وكيل التداول",
    description: "Agent-to-agent trading marketplace",
    triggers: ["a2a", "agent trade", "sell agent", "buy agent",
      "تداول وكلاء", "وكيل", "تجارة", "swap"],
    confidence: 0.8, tier: 5, capabilities: ["agent_listing", "agent_purchase", "skill_transfer"],
    router: "api/routers/a2a", timeoutMs: 15000, maxWorkers: 1,
  },
  analytics: {
    type: "analytics", name: "Analytics Agent", nameAr: "وكيل التحليلات",
    description: "Business analytics, reports, and insights",
    triggers: ["analytics", "report", "dashboard", "statistics",
      "تحليلات", "تقرير", "إحصائيات", "أرقام"],
    confidence: 0.83, tier: 3, capabilities: ["sales_report", "revenue_analytics", "customer_insights"],
    router: "api/routers/orders", timeoutMs: 12000, maxWorkers: 3,
  },
  financial: {
    type: "financial", name: "Financial Agent", nameAr: "وكيل المالية",
    description: "Handles payments, zakat, and Islamic finance",
    triggers: ["payment", "zakat", "finance", "money", "nisab",
      "دفع", "زكاة", "مالية", "فلوس", "نصاب"],
    confidence: 0.91, tier: 2, capabilities: ["payment_processing", "zakat_calculation", "escrow_management"],
    router: "api/routers/payments", timeoutMs: 10000, maxWorkers: 2,
  },
  mentor: {
    type: "mentor", name: "Mentor Agent", nameAr: "وكيل المساعدة",
    description: "General help, onboarding, and guidance",
    triggers: ["help", "support", "how to", "what is", "guide",
      "مساعدة", "شرح", "كيف", "مش فاهم", "دليل",
      "hello", "hi", "مرحبا", "welcome"],
    confidence: 0.7, tier: 1, capabilities: ["onboarding", "faq", "feature_guide", "troubleshooting"],
    router: "api/routers/agents", timeoutMs: 5000, maxWorkers: 1,
  },
  // Worker agent types (used in Supervisor-Worker pattern)
  worker_research: {
    type: "worker_research", name: "Research Worker", nameAr: "عامل البحث",
    description: "Specialized in deep research tasks",
    triggers: [], confidence: 0.9, tier: 2,
    capabilities: ["deep_search", "data_gathering", "source_validation"],
    router: "api/routers/workers", timeoutMs: 20000, maxWorkers: 5,
  },
  worker_code: {
    type: "worker_code", name: "Code Worker", nameAr: "عامل البرمجة",
    description: "Specialized in code generation and review",
    triggers: [], confidence: 0.88, tier: 3,
    capabilities: ["code_generation", "code_review", "debugging"],
    router: "api/routers/workers", timeoutMs: 25000, maxWorkers: 3,
  },
  worker_write: {
    type: "worker_write", name: "Write Worker", nameAr: "عامل الكتابة",
    description: "Specialized in content creation",
    triggers: [], confidence: 0.87, tier: 2,
    capabilities: ["content_creation", "translation", "summarization"],
    router: "api/routers/workers", timeoutMs: 15000, maxWorkers: 4,
  },
  worker_analyze: {
    type: "worker_analyze", name: "Analyze Worker", nameAr: "عامل التحليل",
    description: "Specialized in data analysis",
    triggers: [], confidence: 0.9, tier: 2,
    capabilities: ["data_analysis", "pattern_detection", "trend_analysis"],
    router: "api/routers/workers", timeoutMs: 18000, maxWorkers: 4,
  },
  worker_summarize: {
    type: "worker_summarize", name: "Summarize Worker", nameAr: "عامل التلخيص",
    description: "Specialized in summarization",
    triggers: [], confidence: 0.92, tier: 1,
    capabilities: ["summarization", "extraction", "distillation"],
    router: "api/routers/workers", timeoutMs: 10000, maxWorkers: 5,
  },
  // Supervisor agent
  supervisor: {
    type: "supervisor", name: "Supervisor Agent", nameAr: "وكيل الإشراف",
    description: "Orchestrates multi-step tasks by delegating to worker agents",
    triggers: [], confidence: 0.95, tier: 2,
    capabilities: ["task_decomposition", "worker_coordination", "result_synthesis"],
    router: "api/routers/supervisor", timeoutMs: 30000, maxWorkers: 10,
  },
};

// ============================================
// INTENT TO AGENT MAPPING
// ============================================

const INTENT_AGENT_MAP: Record<IntentType, AgentType[]> = {
  food_order: ["food", "delivery"],
  product_search: ["fashion", "grocery", "pharmacy"],
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
  // Multi-step intents → always go through supervisor
  multi_step_research: ["supervisor"],
  multi_step_compare: ["supervisor"],
  multi_step_order: ["supervisor"],
  multi_step_analyze: ["supervisor"],
};

// ============================================
// PARALLEL COMPATIBILITY MATRIX
// ============================================

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
// SUPERVISOR AGENT CLASS
// ============================================

export class SupervisorAgent {
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = getCircuitBreaker("supervisor-agent", {
      failureThreshold: 3,
      recoveryTimeoutMs: 20000,
    });
  }

  /**
   * Decompose a complex task into subtasks for workers
   */
  async decomposeTask(intent: ParsedIntent, context?: Record<string, unknown>): Promise<SupervisorPlan> {
    return this.circuitBreaker.execute(async () => {
      const taskId = `supervisor_${Date.now()}`;

      // Analyze complexity and determine required workers
      const subtasks = this.analyzeTaskComplexity(intent, context);

      // Build execution plan
      const plan: SupervisorPlan = {
        taskId,
        originalIntent: intent,
        subtasks,
        executionOrder: this.determineExecutionOrder(subtasks),
        estimatedTotalTimeMs: subtasks.reduce((sum, s) => sum + s.timeoutMs, 0),
        fallbackStrategy: "best_effort",
      };

      return plan;
    });
  }

  /**
   * Execute worker subtasks according to plan
   */
  async executeWorkers(plan: SupervisorPlan): Promise<WorkerResult[]> {
    const results: WorkerResult[] = [];

    switch (plan.executionOrder) {
      case "parallel":
        return this.executeWorkersParallel(plan.subtasks);
      case "sequential":
        return this.executeWorkersSequential(plan.subtasks);
      case "mixed":
        return this.executeWorkersMixed(plan.subtasks);
      default:
        return this.executeWorkersSequential(plan.subtasks);
    }
  }

  /**
   * Synthesize results from all workers into unified output
   */
  async synthesizeResults(
    taskId: string,
    workerResults: WorkerResult[],
  ): Promise<SupervisorSynthesis> {
    const startTime = Date.now();

    // Count successes and failures
    const successes = workerResults.filter((r) => r.status === "completed");
    const failures = workerResults.filter((r) => r.status === "failed" || r.status === "timeout");

    // Build synthesized output
    const synthesizedOutput: Record<string, unknown> = {
      taskId,
      totalSubtasks: workerResults.length,
      completedSubtasks: successes.length,
      failedSubtasks: failures.length,
      workerOutputs: successes.map((s) => ({
        subtaskId: s.subtaskId,
        output: s.output,
      })),
      errors: failures.map((f) => ({
        subtaskId: f.subtaskId,
        error: f.error,
      })),
      summary: this.generateSummary(successes, failures),
    };

    // Calculate overall confidence
    const confidence = workerResults.length > 0
      ? successes.length / workerResults.length
      : 0;

    return {
      taskId,
      workerResults,
      synthesizedOutput,
      confidence,
      synthesisTimeMs: Date.now() - startTime,
    };
  }

  // ============================================
  // PRIVATE: Task analysis
  // ============================================

  private analyzeTaskComplexity(
    intent: ParsedIntent,
    context?: Record<string, unknown>,
  ): Subtask[] {
    const subtasks: Subtask[] = [];
    const baseTimeout = 15000;

    switch (intent.type) {
      case "multi_step_research": {
        // Decompose research into: research → analyze → summarize
        subtasks.push({
          id: `research_${Date.now()}_1`,
          description: "Deep research on the topic",
          agentType: "worker_research",
          dependencies: [],
          timeoutMs: baseTimeout * 2,
          priority: 10,
          input: { query: context?.query, entities: intent.entities },
        });
        subtasks.push({
          id: `research_${Date.now()}_2`,
          description: "Analyze findings",
          agentType: "worker_analyze",
          dependencies: [subtasks[0].id],
          timeoutMs: baseTimeout,
          priority: 8,
        });
        subtasks.push({
          id: `research_${Date.now()}_3`,
          description: "Summarize results",
          agentType: "worker_summarize",
          dependencies: [subtasks[1].id],
          timeoutMs: baseTimeout,
          priority: 6,
        });
        break;
      }

      case "multi_step_compare": {
        // Decompose comparison into: research (parallel for each item) → analyze → summarize
        const items = (context?.items as string[]) || ["item1", "item2"];
        items.forEach((item, i) => {
          subtasks.push({
            id: `compare_${Date.now()}_${i}`,
            description: `Research ${item}`,
            agentType: "worker_research",
            dependencies: [],
            timeoutMs: baseTimeout,
            priority: 10,
            input: { item, index: i },
          });
        });
        subtasks.push({
          id: `compare_${Date.now()}_analysis`,
          description: "Compare and analyze findings",
          agentType: "worker_analyze",
          dependencies: subtasks.map((s) => s.id),
          timeoutMs: baseTimeout,
          priority: 9,
        });
        break;
      }

      case "multi_step_order": {
        // Decompose ordering into: search → compare → payment
        subtasks.push({
          id: `order_${Date.now()}_search`,
          description: "Search for products",
          agentType: "worker_research",
          dependencies: [],
          timeoutMs: baseTimeout,
          priority: 10,
          input: { entities: intent.entities },
        });
        subtasks.push({
          id: `order_${Date.now()}_select`,
          description: "Select best options",
          agentType: "worker_analyze",
          dependencies: [subtasks[0].id],
          timeoutMs: baseTimeout,
          priority: 9,
        });
        subtasks.push({
          id: `order_${Date.now()}_payment`,
          description: "Process payment info",
          agentType: "worker_analyze",
          dependencies: [subtasks[1].id],
          timeoutMs: baseTimeout,
          priority: 8,
        });
        break;
      }

      case "multi_step_analyze": {
        subtasks.push({
          id: `analyze_${Date.now()}_1`,
          description: "Gather data",
          agentType: "worker_research",
          dependencies: [],
          timeoutMs: baseTimeout * 2,
          priority: 10,
        });
        subtasks.push({
          id: `analyze_${Date.now()}_2`,
          description: "Analyze patterns",
          agentType: "worker_analyze",
          dependencies: [subtasks[0].id],
          timeoutMs: baseTimeout,
          priority: 9,
        });
        subtasks.push({
          id: `analyze_${Date.now()}_3`,
          description: "Generate insights summary",
          agentType: "worker_summarize",
          dependencies: [subtasks[1].id],
          timeoutMs: baseTimeout,
          priority: 8,
        });
        break;
      }

      default: {
        // Simple fallback for any intent
        subtasks.push({
          id: `task_${Date.now()}`,
          description: `Handle ${intent.type}`,
          agentType: INTENT_AGENT_MAP[intent.type]?.[0] ?? "mentor",
          dependencies: [],
          timeoutMs: baseTimeout,
          priority: 5,
          input: context,
        });
      }
    }

    return subtasks;
  }

  private determineExecutionOrder(subtasks: Subtask[]): "parallel" | "sequential" | "mixed" {
    if (subtasks.length <= 1) return "sequential";

    const hasDependencies = subtasks.some((s) => s.dependencies.length > 0);
    const allIndependent = subtasks.every((s) => s.dependencies.length === 0);

    if (allIndependent) return "parallel";
    if (hasDependencies && subtasks.some((s) => s.dependencies.length === 0)) return "mixed";
    return "sequential";
  }

  // ============================================
  // PRIVATE: Worker execution strategies
  // ============================================

  private async executeWorkersParallel(subtasks: Subtask[]): Promise<WorkerResult[]> {
    const promises = subtasks.map((subtask) =>
      this.executeSingleWorker(subtask),
    );
    return Promise.all(promises);
  }

  private async executeWorkersSequential(subtasks: Subtask[]): Promise<WorkerResult[]> {
    const results: WorkerResult[] = [];

    for (const subtask of subtasks) {
      const result = await this.executeSingleWorker(subtask);
      results.push(result);

      // Stop on critical failure
      if (result.status === "failed" && result.subtaskId === subtasks[0]?.id) break;
    }

    return results;
  }

  private async executeWorkersMixed(subtasks: Subtask[]): Promise<WorkerResult[]> {
    // Execute independent tasks in parallel, then dependent sequentially
    const independent = subtasks.filter((s) => s.dependencies.length === 0);
    const dependent = subtasks.filter((s) => s.dependencies.length > 0);

    const independentResults = await this.executeWorkersParallel(independent);

    // Check if all independent tasks succeeded
    const allSucceeded = independentResults.every((r) => r.status === "completed");
    if (!allSucceeded && dependent.length > 0) {
      // Still try dependent with degraded inputs
    }

    const dependentResults = await this.executeWorkersSequential(dependent);

    return [...independentResults, ...dependentResults];
  }

  private async executeSingleWorker(subtask: Subtask): Promise<WorkerResult> {
    const startTime = Date.now();

    return retryWithBackoff(
      async () => {
        // Simulate worker execution (replace with actual worker call)
        const output = await this.callWorker(subtask);

        return {
          subtaskId: subtask.id,
          workerType: subtask.agentType,
          status: "completed",
          output,
          executionTimeMs: Date.now() - startTime,
          tokensUsed: 0,
        };
      },
      {
        maxRetries: subtask.maxRetries,
        onRetry: (attempt) => {
          console.warn(`[Supervisor] Retry ${attempt} for subtask ${subtask.id}`);
        },
      },
    ).catch((error) => ({
      subtaskId: subtask.id,
      workerType: subtask.agentType,
      status: "timeout" as const,
      output: {},
      error: error instanceof Error ? error.message : String(error),
      executionTimeMs: Date.now() - startTime,
      tokensUsed: 0,
    }));
  }

  private async callWorker(subtask: Subtask): Promise<Record<string, unknown>> {
    // Timeout wrapper for individual worker calls
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new JASIMError({
          code: "AGENT_TIMEOUT",
          message: `Worker ${subtask.agentType} timed out after ${subtask.timeoutMs}ms`,
          context: { subtaskId: subtask.id, timeoutMs: subtask.timeoutMs },
        }));
      }, subtask.timeoutMs);

      // Simulate worker processing (replace with actual implementation)
      this.simulateWorkerExecution(subtask)
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

  private async simulateWorkerExecution(subtask: Subtask): Promise<Record<string, unknown>> {
    // In production, this calls the actual worker agent
    await new Promise((r) => setTimeout(r, Math.min(100, subtask.timeoutMs)));
    return {
      subtaskId: subtask.id,
      agentType: subtask.agentType,
      processed: true,
      input: subtask.input,
    };
  }

  private generateSummary(
    successes: WorkerResult[],
    failures: WorkerResult[],
  ): string {
    if (failures.length === 0) {
      return `All ${successes.length} subtasks completed successfully.`;
    }
    if (successes.length === 0) {
      return `All ${failures.length} subtasks failed.`;
    }
    return `${successes.length} of ${successes.length + failures.length} subtasks completed. ${failures.length} failed: ${failures.map((f) => f.subtaskId).join(", ")}`;
  }
}

// ============================================
// PUBLIC API FUNCTIONS
// ============================================

/**
 * Route an intent to the appropriate agent
 * Returns the best matching agent configuration
 */
export function routeToAgent(intent: ParsedIntent): RoutingResult {
  try {
    const validated = ParsedIntentSchema.parse(intent);
    const agentTypes = INTENT_AGENT_MAP[validated.type];

    // Multi-step intents → supervisor-worker pattern
    if (validated.complexity === "multi_step" || validated.type.startsWith("multi_step")) {
      return routeToSupervisor(validated, agentTypes);
    }

    if (!agentTypes || agentTypes.length === 0) {
      const fallback = AGENT_REGISTRY.mentor;
      return {
        agent: fallback,
        confidence: 0.5,
        isParallel: false,
        fallbackAgent: fallback,
        estimatedLatency: 200,
        executionStrategy: "single",
      };
    }

    const primaryType = agentTypes[0];
    const agent = AGENT_REGISTRY[primaryType];
    const isParallel = canHandleParallel(agentTypes);
    const fallback = agentTypes.length > 1
      ? AGENT_REGISTRY[agentTypes[1]]
      : AGENT_REGISTRY.mentor;

    return {
      agent,
      confidence: validated.confidence,
      isParallel,
      fallbackAgent: fallback,
      estimatedLatency: estimateLatency(agent.tier),
      executionStrategy: isParallel ? "parallel" : "single",
    };
  } catch (error) {
    console.error("[AgentRouter] routeToAgent error:", error);
    return {
      agent: AGENT_REGISTRY.mentor,
      confidence: 0.3,
      isParallel: false,
      estimatedLatency: 100,
      executionStrategy: "single",
    };
  }
}

/**
 * Route complex tasks through supervisor-worker pattern
 */
function routeToSupervisor(
  intent: ParsedIntent,
  _agentTypes: AgentType[],
): RoutingResult {
  const supervisor = AGENT_REGISTRY.supervisor;

  // Create worker assignments for the supervisor
  const workerAssignments: WorkerAssignment[] = [];

  // Map intent type to worker types
  const workerTypeMap: Record<string, AgentType[]> = {
    multi_step_research: ["worker_research", "worker_analyze", "worker_summarize"],
    multi_step_compare: ["worker_research", "worker_analyze", "worker_summarize"],
    multi_step_order: ["worker_research", "worker_analyze", "worker_analyze"],
    multi_step_analyze: ["worker_research", "worker_analyze", "worker_summarize"],
  };

  const workers = workerTypeMap[intent.type] || ["worker_analyze"];

  workers.forEach((workerType, i) => {
    workerAssignments.push({
      subtaskId: `${intent.type}_${Date.now()}_${i}`,
      workerType,
      supervisorNotes: `Step ${i + 1} of ${intent.type}`,
      input: { entities: intent.entities, step: i },
      timeoutMs: AGENT_REGISTRY[workerType]?.timeoutMs || 15000,
    });
  });

  return {
    agent: supervisor,
    confidence: 0.9,
    isParallel: false,
    fallbackAgent: AGENT_REGISTRY.mentor,
    estimatedLatency: estimateLatency(supervisor.tier) * workers.length,
    supervisorAssigned: true,
    workerAssignments,
    executionStrategy: "supervisor_worker",
  };
}

/**
 * Get configuration for a specific agent type
 */
export function getAgentConfig(agentType: AgentType): AgentConfig {
  const config = AGENT_REGISTRY[agentType];
  if (!config) {
    throw new JASIMError({
      code: "AGENT_NOT_FOUND",
      message: `${Errors.agentNotFound}: ${agentType}`,
      statusCode: 404,
      context: { agentType },
    });
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

  for (let i = 1; i < agentTypes.length; i++) {
    if (!compatible.includes(agentTypes[i])) return false;
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
export function getAgentsByTier(tier: 1 | 2 | 3 | 4 | 5): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter((a) => a.tier === tier);
}

/**
 * Find agents by capability
 */
export function findAgentsByCapability(capability: string): AgentConfig[] {
  return Object.values(AGENT_REGISTRY).filter((a) =>
    a.capabilities.includes(capability),
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
  intentType: IntentType,
): boolean {
  const agentTypes = INTENT_AGENT_MAP[intentType];
  if (!agentTypes) return false;
  return agentTypes.includes(agentType);
}

/**
 * Get suggested agents for a conversation
 */
export function getSuggestedAgents(
  recentIntents: IntentType[],
): AgentConfig[] {
  const agentCounts: Record<string, number> = {};

  for (const intent of recentIntents) {
    const types = INTENT_AGENT_MAP[intent];
    if (types) {
      for (const t of types) {
        agentCounts[t] = (agentCounts[t] || 0) + 1;
      }
    }
  }

  const sorted = Object.entries(agentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return sorted.map(([type]) => AGENT_REGISTRY[type as AgentType]);
}

/**
 * Execute with supervisor-worker pattern for complex tasks
 */
export async function executeWithSupervisor(
  intent: ParsedIntent,
  context?: Record<string, unknown>,
): Promise<{
  synthesis: SupervisorSynthesis;
  plan: SupervisorPlan;
}> {
  const supervisor = new SupervisorAgent();

  // Step 1: Decompose
  const plan = await supervisor.decomposeTask(intent, context);

  // Step 2: Execute workers
  const workerResults = await supervisor.executeWorkers(plan);

  // Step 3: Synthesize
  const synthesis = await supervisor.synthesizeResults(plan.taskId, workerResults);

  return { synthesis, plan };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function estimateLatency(tier: 1 | 2 | 3 | 4 | 5): number {
  const latencyMap: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 150, 2: 350, 3: 700, 4: 1200, 5: 2000,
  };
  return latencyMap[tier] || 300;
}
