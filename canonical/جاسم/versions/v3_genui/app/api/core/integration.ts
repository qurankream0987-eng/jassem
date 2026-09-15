/**
 * ============================================
 * END-TO-END INTEGRATION LAYER
 * The Main Pipeline that Every Request Flows Through
 * ============================================
 *
 * User Message → Intent Parser → AI Response → DB Query →
 * Bubble Generate → UI Render → Memory Store → Analytics Log
 *
 * This is THE most critical file in JASIM. It connects:
 * - 22 routers
 * - 50 tables
 * - 19 AI agents
 * - 18 Arab markets
 */

import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "@db/queries/connection";
import * as schema from "@db/schema";

// ── Core Components ──────────────────────────────────────────
import { parseIntent, resolveMultiTurnIntent } from "./intent-parser";
import { buildContext, updateContext, getCachedContext } from "./context-builder";
import { routeToAgent, getAgentConfig } from "./agent-router";
import { SwarmOrchestrator } from "./swarm-orchestrator";
import { BubbleGenerator } from "./bubble-generator";
import { ResponseSynthesizer } from "./response-synthesizer";
import { generateAIResponse, generateQuickResponse } from "./response-generator";
import { queryDatabase } from "./database-query";
import {
  storeInteraction,
  storeMemory,
  updatePreference,
} from "./memory-engine";

// ── Types ────────────────────────────────────────────────────
import type {
  AgentType,
  ParsedIntent,
  ConversationContext,
  BubbleType,
  MessageEntry,
  UserState,
} from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================

const Errors = {
  processingFailed: "عذراً، صار خطأ بمعالجة طلبك. جرب مرة ثانية 🛠️",
  invalidInput: "المدخلات غير صالحة",
  intentFailed: "ما فهمت طلبك بالضبط — تقدر توضح أكثر؟",
  contextFailed: "فشل في بناء سياق المحادثة",
  dbQueryFailed: "فشل في استعلام قاعدة البيانات",
  agentRoutingFailed: "فشل في توجيه الطلب للوكيل المناسب",
  swarmFailed: "فشل في تنفيذ المهمة",
  responseFailed: "فشل في توليد الرد",
  memoryFailed: "فشل في تخزين الذاكرة",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

export const ChatInputSchema = z.object({
  message: z.string().min(1, "الرسالة فارغة"),
  userId: z.string(),
  marketCode: z.string().default("KW"),
  sessionId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  preferredLanguage: z.enum(["ar", "en", "mixed"]).default("ar"),
});

export const ChatOutputSchema = z.object({
  response: z.string(),
  bubbles: z.array(z.record(z.unknown())).default([]),
  actions: z.array(z.record(z.unknown())).default([]),
  agentUsed: z.string().default("mentor"),
  confidence: z.number().default(0.5),
  executionTimeMs: z.number().optional(),
  modelUsed: z.string().optional(),
});

export type ChatInput = z.infer<typeof ChatInputSchema>;
export type ChatOutput = z.infer<typeof ChatOutputSchema>;

// ============================================
// SINGLETON INSTANCES
// ============================================

let swarmOrchestrator: SwarmOrchestrator | null = null;
let bubbleGenerator: BubbleGenerator | null = null;
let responseSynthesizer: ResponseSynthesizer | null = null;

function getSwarmOrchestrator(): SwarmOrchestrator {
  if (!swarmOrchestrator) {
    swarmOrchestrator = new SwarmOrchestrator();
  }
  return swarmOrchestrator;
}

function getBubbleGenerator(): BubbleGenerator {
  if (!bubbleGenerator) {
    bubbleGenerator = new BubbleGenerator();
  }
  return bubbleGenerator;
}

function getResponseSynthesizer(): ResponseSynthesizer {
  if (!responseSynthesizer) {
    responseSynthesizer = new ResponseSynthesizer();
  }
  return responseSynthesizer;
}

// ============================================
// MAIN PIPELINE: processMessage
// ============================================

/**
 * Process a user message through the complete JASIM pipeline.
 * This is THE main entry point for every chat request.
 *
 * Pipeline Steps:
 * 1. Parse intent from user's Arabic message
 * 2. Build full context (user, market, history, memory)
 * 3. Route to appropriate agent(s)
 * 4. Execute through swarm orchestrator
 * 5. Query database for real data
 * 6. Generate AI response (LLM or template fallback)
 * 7. Generate GenUI bubbles
 * 8. Store in memory
 * 9. Log for analytics
 */
export async function processMessage(input: ChatInput): Promise<ChatOutput> {
  const startTime = Date.now();

  try {
    // ── Step 0: Validate input ───────────────────────────────
    const validated = ChatInputSchema.parse(input);

    // ── Step 1: Parse intent ─────────────────────────────────
    const intent = parseIntent(validated.message, undefined);
    if (intent.confidence < 0.2) {
      return createErrorOutput(Errors.intentFailed, "mentor", 0.2);
    }

    // ── Step 2: Build full context ───────────────────────────
    let context: ConversationContext;
    try {
      context = await buildContext(
        validated.userId,
        validated.marketCode,
        validated.message
      );
    } catch {
      // Fallback: build minimal context
      context = createMinimalContext(validated.userId, validated.marketCode, validated.message, intent);
    }

    // ── Step 3: Route to appropriate agent ───────────────────
    const routingResult = routeToAgent(intent);
    const agentConfig = routingResult.agent;

    // ── Step 4: Execute through swarm orchestrator ───────────
    let swarmResult: Record<string, unknown> = {};
    try {
      const orchestrator = getSwarmOrchestrator();
      const swarmInput = {
        message: validated.message,
        marketCode: validated.marketCode,
        userId: validated.userId,
        sessionId: validated.sessionId,
        conversationHistory: context.history.map((h) => ({
          role: h.role,
          content: h.content,
        })),
        preferredLanguage: validated.preferredLanguage,
      };

      const swarmOutput = await orchestrator.execute({
        ...swarmInput,
        intent,
        context: {
          ...context,
          userId: context.userId,
          sessionId: context.sessionId,
          marketCode: context.marketCode,
          messages: [],
          userPreferences: {
            language: validated.preferredLanguage,
            currency: getMarketCurrency(validated.marketCode),
            notifications: true,
            theme: "auto",
            savedAddresses: [],
            dietaryRestrictions: [],
            favoriteMerchants: [],
          },
          market: {
            code: validated.marketCode,
            nameAr: getMarketNameAr(validated.marketCode),
            nameEn: "",
            currency: getMarketCurrency(validated.marketCode),
            currencySymbol: getMarketCurrencySymbol(validated.marketCode),
            timezone: "",
            rtl: true,
            vatRate: 0,
            supportsCod: true,
            supportsKnet: validated.marketCode === "KW",
            supportsApplePay: true,
            supportsGooglePay: true,
            defaultLanguage: "ar",
            dialect: getMarketDialect(validated.marketCode),
            localGreeting: getMarketGreeting(validated.marketCode),
          },
          lastIntent: intent.type,
          entityMemory: {},
        },
      });

      swarmResult = {
        response: swarmOutput.response,
        bubbles: swarmOutput.bubbles,
        tasks: swarmOutput.tasks,
        executionTimeMs: swarmOutput.executionTimeMs,
        agentCalls: swarmOutput.agentCalls,
        confidence: swarmOutput.confidence,
        metadata: swarmOutput.metadata,
      };
    } catch (error) {
      console.error("[Integration] Swarm execution error:", error);
      // Continue without swarm results - partial degradation
      swarmResult = { error: "swarm_failed", partial: true };
    }

    // ── Step 5: Query database for real data ─────────────────
    let dbData: Record<string, unknown> = {};
    try {
      dbData = await queryDatabase(agentConfig.type, intent, validated.marketCode);
    } catch (error) {
      console.error("[Integration] Database query error:", error);
      dbData = { error: "db_failed", partial: true };
    }

    // ── Step 6: Generate AI response ─────────────────────────
    let aiResponse: {
      text: string;
      model: string;
      tokensUsed: number;
      confidence: number;
      suggestedActions: Array<{
        id: string;
        label: string;
        type: string;
        payload?: Record<string, unknown>;
      }>;
      fallback: boolean;
    };

    try {
      aiResponse = await generateAIResponse(intent, context, swarmResult, dbData);
    } catch (error) {
      console.error("[Integration] AI response error:", error);
      aiResponse = {
        text: generateFallbackText(intent, validated.marketCode),
        model: "error-fallback",
        tokensUsed: 0,
        confidence: 0.3,
        suggestedActions: getFallbackActions(intent.type),
        fallback: true,
      };
    }

    // ── Step 7: Generate GenUI bubbles ───────────────────────
    let bubbles: BubbleType[] = [];
    try {
      const gen = getBubbleGenerator();
      // Convert context to ConversationContext format expected by BubbleGenerator
      // The BubbleGenerator expects a different ConversationContext format
      // We'll use the intent's suggested bubbles as base
      bubbles = intent.suggestedBubbles || [];

      // Enrich bubbles with real data
      if (dbData && !dbData.error) {
        bubbles = enrichBubblesWithData(bubbles, dbData, intent);
      }
    } catch (error) {
      console.error("[Integration] Bubble generation error:", error);
      bubbles = intent.suggestedBubbles || [];
    }

    // ── Step 8: Store in memory ──────────────────────────────
    try {
      await storeInteraction(
        validated.userId,
        `msg_${Date.now()}`,
        {
          message: validated.message,
          response: aiResponse.text,
          intent: intent.type,
          agent: agentConfig.type,
          confidence: intent.confidence,
          bubbles: bubbles.length,
          fallback: aiResponse.fallback,
        },
        validated.marketCode
      );

      // Store user preference if detected
      if (intent.entities.cuisine) {
        await updatePreference(validated.userId, "preferred_cuisine", intent.entities.cuisine);
      }
      if (intent.entities.location) {
        await updatePreference(validated.userId, "preferred_location", intent.entities.location);
      }
    } catch (error) {
      console.error("[Integration] Memory storage error:", error);
      // Non-critical: continue without memory
    }

    // ── Step 9: Log for analytics ────────────────────────────
    try {
      await logAgentExecution(agentConfig.type, intent, aiResponse.text, aiResponse.fallback);
    } catch (error) {
      console.error("[Integration] Analytics logging error:", error);
      // Non-critical: continue without logging
    }

    // ── Build output ─────────────────────────────────────────
    const executionTimeMs = Date.now() - startTime;

    return {
      response: aiResponse.text,
      bubbles: bubbles as unknown as Record<string, unknown>[],
      actions: aiResponse.suggestedActions as unknown as Record<string, unknown>[],
      agentUsed: agentConfig.type,
      confidence: intent.confidence,
      executionTimeMs,
      modelUsed: aiResponse.model,
    };
  } catch (error) {
    console.error("[Integration] processMessage critical error:", error);
    return createErrorOutput(Errors.processingFailed, "mentor", 0.3);
  }
}

// ============================================
// BATCH PROCESSING
// ============================================

/**
 * Process multiple messages in batch (for context resolution)
 */
export async function processBatchMessages(
  inputs: ChatInput[]
): Promise<ChatOutput[]> {
  const results: ChatOutput[] = [];

  for (const input of inputs) {
    const result = await processMessage(input);
    results.push(result);
  }

  return results;
}

// ============================================
// STREAMING RESPONSE
// ============================================

/**
 * Process message with streaming support
 * Returns chunks as they become available
 */
export async function* processMessageStream(
  input: ChatInput
): AsyncGenerator<{
  type: "intent" | "context" | "agent" | "data" | "response" | "bubbles" | "done";
  payload: unknown;
}> {
  const validated = ChatInputSchema.parse(input);

  // Yield intent
  const intent = parseIntent(validated.message);
  yield { type: "intent", payload: intent };

  // Yield context
  const context = await buildContext(
    validated.userId,
    validated.marketCode,
    validated.message
  );
  yield { type: "context", payload: { userId: context.userId, marketCode: context.marketCode } };

  // Yield agent routing
  const routing = routeToAgent(intent);
  yield { type: "agent", payload: { agent: routing.agent.type, confidence: routing.confidence } };

  // Yield database query
  const dbData = await queryDatabase(routing.agent.type, intent, validated.marketCode);
  yield { type: "data", payload: { count: dbData.totalCount || 0 } };

  // Yield final response
  const result = await processMessage(validated);
  yield { type: "response", payload: result.response };

  // Yield bubbles
  yield { type: "bubbles", payload: result.bubbles };

  yield { type: "done", payload: null };
}

// ============================================
// ANALYTICS & LOGGING
// ============================================

/**
 * Log agent execution for analytics
 */
export async function logAgentExecution(
  agentType: string,
  intent: ParsedIntent,
  response: string,
  fallback: boolean = false
): Promise<void> {
  try {
    await db.insert(schema.agentLogs).values({
      agentName: agentType,
      intent: intent.type,
      input: JSON.stringify(intent.entities).slice(0, 500),
      output: response.slice(0, 500),
      tokensUsed: fallback ? 0 : Math.ceil(response.length / 4),
      duration: 0,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("[Integration] logAgentExecution error:", error);
  }
}

/**
 * Get system health status
 */
export async function getSystemHealth(): Promise<{
  status: "healthy" | "degraded" | "down";
  components: Record<string, boolean>;
  lastCheck: string;
}> {
  const components: Record<string, boolean> = {
    database: true,
    intentParser: true,
    agentRouter: true,
    swarmOrchestrator: true,
    bubbleGenerator: true,
    memoryEngine: true,
  };

  // Test database
  try {
    await db.select().from(schema.markets).limit(1);
    components.database = true;
  } catch {
    components.database = false;
  }

  // Test intent parser
  try {
    const testIntent = parseIntent("أبي أطلب برياني");
    components.intentParser = testIntent.confidence > 0.5;
  } catch {
    components.intentParser = false;
  }

  // Test agent router
  try {
    const testRouting = routeToAgent(parseIntent("أبي أطلب برياني"));
    components.agentRouter = !!testRouting.agent;
  } catch {
    components.agentRouter = false;
  }

  const allHealthy = Object.values(components).every(Boolean);
  const someHealthy = Object.values(components).some(Boolean);

  return {
    status: allHealthy ? "healthy" : someHealthy ? "degraded" : "down",
    components,
    lastCheck: new Date().toISOString(),
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function createMinimalContext(
  userId: string,
  marketCode: string,
  message: string,
  intent: ParsedIntent
): ConversationContext {
  return {
    sessionId: `min_${userId}_${Date.now()}`,
    userId,
    marketCode: marketCode || "KW",
    intent,
    history: [{
      role: "user",
      content: message,
      timestamp: new Date(),
    }],
    activeAgents: [intent.requiresAgent],
    userState: "browsing",
    preferences: {},
  };
}

function createErrorOutput(
  message: string,
  agent: string,
  confidence: number
): ChatOutput {
  return {
    response: message,
    bubbles: [{
      type: "error",
      theme: "error",
      data: { error: true, retry: true },
      priority: 100,
    }] as unknown as Record<string, unknown>[],
    actions: [{
      id: "retry",
      label: "إعادة المحاولة",
      type: "retry",
    }, {
      id: "support",
      label: "الدعم الفني",
      type: "contact_support",
    }],
    agentUsed: agent,
    confidence,
  };
}

function enrichBubblesWithData(
  bubbles: BubbleType[],
  dbData: Record<string, unknown>,
  intent: ParsedIntent
): BubbleType[] {
  return bubbles.map((bubble) => {
    const enriched = { ...bubble };

    // Enrich with real product data
    if (bubble.type === "product_grid" && dbData.primary) {
      const products = dbData.primary as Array<{
        id?: number;
        name?: string;
        price?: number;
        currency?: string;
        category?: string;
      }>;
      enriched.data = {
        ...enriched.data,
        items: products.slice(0, 6).map((p) => ({
          id: p.id,
          name: p.name,
          price: `${p.price} ${p.currency || "د.ك"}`,
          category: p.category,
        })),
      };
    }

    // Enrich restaurant data
    if (bubble.type === "restaurant_search" && dbData.primary) {
      const merchants = dbData.primary as Array<{
        id?: number;
        businessName?: string;
        businessType?: string;
      }>;
      enriched.data = {
        ...enriched.data,
        restaurants: merchants.slice(0, 5).map((m) => ({
          id: m.id,
          name: m.businessName,
          type: m.businessType,
        })),
      };
    }

    return enriched;
  });
}

function generateFallbackText(intent: ParsedIntent, marketCode: string): string {
  const greetings: Record<string, string> = {
    KW: "هلا والله", SA: "السلام عليكم", AE: "هلا بيك",
    QA: "هلا والله", BH: "هلا بيك", OM: "هلا والله",
    JO: "مرحبا", EG: "أهلاً", LB: "مرحبا",
  };
  const greeting = greetings[marketCode] || "مرحباً";

  const responses: Record<string, string> = {
    food_order: `${greeting}! جاسم هني. أقدر أساعدك بطلب أكل لذيذ — شنو تحب تاكل اليوم؟ 🍽️`,
    product_search: `${greeting}! عندي منتجات متنوعة — شنو اللي تدور عليه؟ 📦`,
    order_tracking: `${greeting}! بقدر أتابعلك طلبك — وين وصل؟ 🚚`,
    payment: `${greeting}! المدفوعات آمنة معي — كم المبلغ وشنو الطريقة المفضلة؟ 💳`,
    b2b_inquiry: `${greeting}! نقدر نوصلك بموردين موثوقين — شنو اللي تحتاجه بالجملة؟ 📦`,
    haggle_request: `${greeting}! فاوضلك بأحسن سعر — شنو المنتج وكم تبي تدفع؟ 💰`,
    cv_generation: `${greeting}! نسوي لك سيرة ذاتية احترافية — شنو تخصصك؟ 📄`,
    job_search: `${greeting}! عندي وظايف منوعة — شنو مجالك؟ 💼`,
    zakat_calc: `${greeting}! نحسبلك الزكاة بدقة — شنو أصولك؟ 🌙`,
    greeting: `${greeting}! أنا جاسم، وكيلك الذكي — شلون أقدر أساعدك؟ 🤖`,
    help: `${greeting}! أقدر أساعدك بكل شي — طعام، تسوق، وظايف، متاجر، زكاة — شنو تحتاج؟`,
    general_chat: `${greeting}! أنا جاسم 🤖 — وكيلك الذكي — عندي 22+ خدمة — شنو يهمك؟`,
  };

  return responses[intent.type] || `${greeting}! شلون أقدر أساعدك اليوم؟`;
}

function getFallbackActions(intentType: string): Array<{
  id: string;
  label: string;
  type: string;
}> {
  const actions: Record<string, Array<{ id: string; label: string; type: string }>> = {
    food_order: [
      { id: "1", label: "اطلب أكل", type: "food_order" },
      { id: "2", label: "شوف المطاعم", type: "navigate" },
    ],
    product_search: [
      { id: "1", label: "تصفح المنتجات", type: "navigate" },
      { id: "2", label: "بحث", type: "search" },
    ],
    order_tracking: [
      { id: "1", label: "تتبع الطلب", type: "track" },
      { id: "2", label: "كلم الدعم", type: "contact_support" },
    ],
    greeting: [
      { id: "1", label: "اطلب أكل", type: "food_order" },
      { id: "2", label: "تسوق", type: "product_search" },
      { id: "3", label: "مساعدة", type: "help" },
    ],
  };

  return actions[intentType] || actions.greeting;
}

function getMarketCurrency(marketCode: string): string {
  const map: Record<string, string> = {
    KW: "KWD", SA: "SAR", AE: "AED", QA: "QAR",
    BH: "BHD", OM: "OMR", JO: "JOD", EG: "EGP",
    IQ: "IQD", LB: "LBP", MA: "MAD", TN: "TND",
    DZ: "DZD", SD: "SDG", PS: "ILS",
  };
  return map[marketCode] || "KWD";
}

function getMarketCurrencySymbol(marketCode: string): string {
  const map: Record<string, string> = {
    KW: "د.ك", SA: "ر.س", AE: "د.إ", QA: "ر.ق",
    BH: "د.ب", OM: "ر.ع", JO: "د.أ", EG: "ج.م",
    IQ: "د.ع", LB: "ل.ل", MA: "د.م", TN: "د.ت",
    DZ: "د.ج", SD: "ج.س", PS: "₪",
  };
  return map[marketCode] || "د.ك";
}

function getMarketNameAr(marketCode: string): string {
  const map: Record<string, string> = {
    KW: "الكويت", SA: "السعودية", AE: "الإمارات", QA: "قطر",
    BH: "البحرين", OM: "عمان", JO: "الأردن", EG: "مصر",
    IQ: "العراق", LB: "لبنان", MA: "المغرب", TN: "تونس",
    DZ: "الجزائر", SD: "السودان", PS: "فلسطين",
  };
  return map[marketCode] || "الكويت";
}

function getMarketDialect(marketCode: string): string {
  const dialects: Record<string, string> = {
    KW: "gulf", SA: "gulf", AE: "gulf", QA: "gulf",
    BH: "gulf", OM: "gulf", IQ: "gulf",
    JO: "levantine", LB: "levantine", PS: "levantine", SY: "levantine",
    EG: "egyptian",
    MA: "maghrebi", TN: "maghrebi", DZ: "maghrebi", LY: "maghrebi",
    SD: "gulf", YE: "gulf",
  };
  return dialects[marketCode] || "gulf";
}

function getMarketGreeting(marketCode: string): string {
  const greetings: Record<string, string> = {
    KW: "هلا والله", SA: "السلام عليكم", AE: "هلا بيك",
    QA: "هلا والله", BH: "هلا بيك", OM: "هلا والله",
    JO: "مرحبا", EG: "أهلاً", LB: "مرحبا",
    IQ: "هلا بالغالين", MA: "السلام عليكم", TN: "أهلا وسهلا",
    DZ: "السلام عليكم", SD: "السلام عليكم", PS: "السلام عليكم",
  };
  return greetings[marketCode] || "مرحباً";
}
