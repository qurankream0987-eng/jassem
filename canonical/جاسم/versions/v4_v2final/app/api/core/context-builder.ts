/**
 * Context Builder - Constructs conversation context for JASIM
 * Manages session state, message history, and user state transitions
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { chats, messages } from "@db/schema";
import type {
  ConversationContext,
  MessageEntry,
  UserState,
  AgentType,
  ParsedIntent,
} from "./types";
import { UserStateSchema } from "./types";
import { parseIntent } from "./intent-parser";
import { detectMarket } from "./market-detector";
import { analyzeLanguage } from "./language-processor";
import {
  getPreferences,
  getRecentInteractions,
  storeInteraction,
} from "./memory-engine";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  buildFailed: "فشل في بناء سياق المحادثة",
  updateFailed: "فشل في تحديث السياق",
  stateDetectionFailed: "فشل في تحديد حالة المستخدم",
  historyFetchFailed: "فشل في استرجاع تاريخ المحادثة",
  invalidContext: "سياق غير صالح",
  resolveMarketFailed: "فشل في تحديد السوق",
} as const;

// ============================================
// SESSION MANAGEMENT
// ============================================

// In-memory session cache (use Redis in production)
const sessionCache = new Map<string, ConversationContext>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ============================================
// ZOD SCHEMAS
// ============================================

const BuildContextInputSchema = z.object({
  userId: z.string(),
  marketCode: z.string().default("KW"),
  message: z.string(),
  sessionId: z.string().optional(),
});

const UpdateContextInputSchema = z.object({
  role: z.enum(["user", "assistant", "system", "agent"]),
  content: z.string(),
  agentName: z.string().optional(),
  bubbles: z.array(z.record(z.string(), z.unknown())).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
});

// ============================================
// PUBLIC API
// ============================================

/**
 * Build conversation context from user ID and message
 * Fetches history from DB, loads preferences, parses intent
 */
export async function buildContext(
  userId: string,
  marketCode: string,
  message: string
): Promise<ConversationContext> {
  try {
    // Validate inputs
    const validated = BuildContextInputSchema.parse({ userId, marketCode, message });

    // Generate session ID if not provided
    const sessionId = `session_${validated.userId}_${Date.now()}`;

    // Step 1: Parse the incoming message intent
    const parsedIntent = parseIntent(message, undefined);

    // Step 2: Detect market from text if different
    const detectedMarket = resolveMarket(message);
    const finalMarket = detectedMarket || validated.marketCode;

    // Step 3: Fetch recent conversation history from DB
    const history = await fetchConversationHistory(validated.userId, 20);

    // Step 4: Load user preferences
    const preferences = await getPreferences(validated.userId);

    // Step 5: Determine active agents from intent
    const activeAgents = determineActiveAgents(parsedIntent);

    // Step 6: Detect user state
    const userState = detectUserStateFromHistory(history, parsedIntent);

    // Step 7: Build context
    const context: ConversationContext = {
      sessionId,
      userId: validated.userId,
      marketCode: finalMarket,
      intent: parsedIntent,
      history,
      activeAgents,
      userState,
      preferences,
    };

    // Step 8: Cache the context
    sessionCache.set(sessionId, context);

    // Step 9: Store this interaction
    try {
      await storeInteraction(validated.userId, "last_message", {
        message,
        intent: parsedIntent.type,
        confidence: parsedIntent.confidence,
        market: finalMarket,
        timestamp: new Date().toISOString(),
      }, finalMarket);
    } catch {
      // Non-critical: continue even if storage fails
    }

    return context;
  } catch (error) {
    console.error("[ContextBuilder] buildContext error:", error);
    // Return minimal context on error
    return createMinimalContext(userId, marketCode, message);
  }
}

/**
 * Update context with a new message
 * Adds message to history and re-evaluates state
 */
export async function updateContext(
  context: ConversationContext,
  message: MessageEntry
): Promise<ConversationContext> {
  try {
    // Validate
    if (!context || !context.sessionId) {
      throw new Error(Errors.invalidContext);
    }

    // Add message to history
    const updatedHistory = [...context.history, message];

    // Trim history to last 50 messages
    if (updatedHistory.length > 50) {
      updatedHistory.splice(0, updatedHistory.length - 50);
    }

    // Re-parse intent if user message
    let updatedIntent = context.intent;
    if (message.role === "user") {
      updatedIntent = parseIntent(message.content, context);
    }

    // Re-detect user state
    const updatedState = detectUserStateFromHistory(updatedHistory, updatedIntent);

    // Update active agents
    const updatedAgents = determineActiveAgents(updatedIntent);

    // Build updated context
    const updatedContext: ConversationContext = {
      ...context,
      history: updatedHistory,
      intent: updatedIntent,
      userState: updatedState,
      activeAgents: updatedAgents,
    };

    // Update cache
    sessionCache.set(context.sessionId, updatedContext);

    // Persist to DB
    try {
      await persistMessage(context.userId, message);
    } catch {
      // Non-critical
    }

    return updatedContext;
  } catch (error) {
    console.error("[ContextBuilder] updateContext error:", error);
    return context; // Return original on error
  }
}

/**
 * Detect user state from conversation context
 * Uses state machine logic to determine if user is browsing, ordering, negotiating, or in support
 */
export function detectUserState(
  context: ConversationContext
): UserState {
  return detectUserStateFromHistory(context.history, context.intent);
}

/**
 * Get relevant history for current context
 * Filters history to messages relevant to current intent
 */
export function getRelevantHistory(
  context: ConversationContext,
  maxMessages: number = 10
): MessageEntry[] {
  const currentIntent = context.intent.type;

  // Get recent messages
  const recent = context.history.slice(-maxMessages * 2);

  // Score each message by relevance to current intent
  const scored = recent.map(msg => {
    let score = 0;

    // Recent messages get higher base score
    const index = recent.indexOf(msg);
    score += (recent.length - index) * 0.1;

    // Messages from same intent get bonus
    if (msg.bubbles && msg.bubbles.length > 0) {
      score += 0.3;
    }

    // User messages get slight priority
    if (msg.role === "user") {
      score += 0.1;
    }

    return { msg, score };
  });

  // Sort by score and take top N
  scored.sort((a, b) => b.score - a.score);
  const topScored = scored.slice(0, maxMessages);

  // Sort back chronologically
  topScored.sort((a, b) => a.msg.timestamp.getTime() - b.msg.timestamp.getTime());

  return topScored.map(s => s.msg);
}

/**
 * Resolve market from text input
 * Detects market mentions in user text
 */
export function resolveMarket(text: string): string | null {
  if (!text) return null;

  const normalized = text.toLowerCase();

  // Market name mappings
  const marketMap: Record<string, string[]> = {
    KW: ["الكويت", "كويت", "kuwait", "كويتي"],
    SA: ["السعودية", "سعودية", "سعودي", "saudi", "الرياض", "جدة", "الدمام", "مكة"],
    AE: ["الإمارات", "امارات", "emirates", "uae", "dubai", "دبي", "أبوظبي", "abu dhabi"],
    QA: ["قطر", "qatari", "qatar", "الدوحة", "doha"],
    BH: ["البحرين", "bahrain", "المنامة", "manama"],
    OM: ["عمان", "oman", "مسقط", "muscat"],
    JO: ["الأردن", "jordan", "عمان", "amman"],
    LB: ["لبنان", "lebanon", "lebanese", "بيروت", "beirut"],
    EG: ["مصر", "egypt", "egyptian", "القاهرة", "cairo"],
    IQ: ["العراق", "iraq", "iraqi", "بغداد", "baghdad"],
    MA: ["المغرب", "morocco", "moroccan", "الدار البيضاء", "casablanca"],
    TN: ["تونس", "tunisia", "tunisian", "tunis"],
    DZ: ["الجزائر", "algeria", "algerian", "algiers"],
    SD: ["السودان", "sudan", "sudanese", "khartoom"],
    PS: ["فلسطين", "palestine", "palestinian"],
  };

  for (const [code, names] of Object.entries(marketMap)) {
    for (const name of names) {
      if (normalized.includes(name.toLowerCase())) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Get cached context by session ID
 */
export function getCachedContext(sessionId: string): ConversationContext | null {
  return sessionCache.get(sessionId) || null;
}

/**
 * Invalidate cached context
 */
export function invalidateContext(sessionId: string): void {
  sessionCache.delete(sessionId);
}

/**
 * Get session statistics
 */
export function getSessionStats(): {
  activeSessions: number;
  oldestSession: number;
} {
  const now = Date.now();
  let oldest = now;

  for (const [, ctx] of sessionCache) {
    const age = now - ctx.history[ctx.history.length - 1]?.timestamp.getTime() || now;
    if (age < oldest) oldest = age;
  }

  return {
    activeSessions: sessionCache.size,
    oldestSession: oldest,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Fetch conversation history from database
 */
async function fetchConversationHistory(
  userId: string,
  limit: number = 20
): Promise<MessageEntry[]> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;

    // Get recent chat sessions for this user
    const recentChats = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, userIdNum))
      .orderBy(desc(chats.updatedAt))
      .limit(1);

    if (recentChats.length === 0) {
      return [];
    }

    const chatId = Number(recentChats[0].id);

    // Get messages from the most recent chat
    const chatMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    // Convert to MessageEntry format (reverse to chronological order)
    return chatMessages.reverse().map(msg => ({
      role: msg.role as "user" | "assistant" | "system" | "agent",
      content: msg.content,
      bubbles: msg.bubbleData ? [msg.bubbleData as unknown as { type: string; theme: string; data: Record<string, unknown>; priority: number }] : undefined,
      timestamp: msg.createdAt,
    })) as MessageEntry[];
  } catch (error) {
    console.error("[ContextBuilder] fetchConversationHistory error:", error);
    return [];
  }
}

/**
 * Persist a message to the database
 */
async function persistMessage(
  userId: string,
  message: MessageEntry
): Promise<void> {
  try {
    const userIdNum = Number.parseInt(userId) || 0;

    // Get or create active chat
    const existingChats = await db
      .select()
      .from(chats)
      .where(
        and(
          eq(chats.userId, userIdNum),
          eq(chats.isActive, true)
        )
      )
      .orderBy(desc(chats.createdAt))
      .limit(1);

    let chatId: number;

    if (existingChats.length === 0) {
      // Create new chat
      const [result] = await db.insert(chats).values({
        userId: userIdNum,
        title: `Chat ${new Date().toISOString()}`,
        intent: undefined,
        context: {},
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      chatId = Number(result.insertId);
    } else {
      chatId = Number(existingChats[0].id);

      // Update chat timestamp
      await db
        .update(chats)
        .set({ updatedAt: new Date() })
        .where(eq(chats.id, chatId));
    }

    // Insert message
    await db.insert(messages).values({
      chatId,
      role: message.role as "user" | "assistant" | "system",
      content: message.content,
      intent: undefined,
      bubbleData: message.bubbles ? (message.bubbles[0] as unknown as Record<string, unknown>) : undefined,
      createdAt: message.timestamp,
    });
  } catch (error) {
    console.error("[ContextBuilder] persistMessage error:", error);
  }
}

/**
 * Detect user state from conversation history
 * State machine: browsing -> ordering -> negotiating -> support
 */
function detectUserStateFromHistory(
  history: MessageEntry[],
  currentIntent: ParsedIntent
): UserState {
  // Check current intent for strong state indicators
  const intentStateMap: Record<string, UserState> = {
    food_order: "ordering",
    payment: "ordering",
    order_tracking: "ordering",
    haggle_request: "negotiating",
    b2b_inquiry: "negotiating",
    help: "support",
    cv_generation: "browsing",
    job_search: "browsing",
    product_search: "browsing",
    general_chat: "browsing",
    greeting: "browsing",
  };

  const intentBased = intentStateMap[currentIntent.type];
  if (intentBased) {
    return intentBased;
  }

  // Analyze recent history
  if (history.length < 2) {
    return "browsing";
  }

  const recent = history.slice(-5);

  // Count ordering signals
  let orderingSignals = 0;
  let negotiatingSignals = 0;
  let supportSignals = 0;

  for (const msg of recent) {
    const lower = msg.content.toLowerCase();

    // Ordering signals
    if (/\b(اطلب|order|طلبية|payment|pay|فلوس|ادفع|checkout|سلة|cart)\b/i.test(lower)) {
      orderingSignals++;
    }

    // Negotiating signals
    if (/\b(خصم|discount|فلوس كثير|غالي|expensive| cheaper|negotiat|فاضي|offer|عرض)\b/i.test(lower)) {
      negotiatingSignals++;
    }

    // Support signals
    if (/\b(مساعدة|help|support|مشكلة|problem|issue|شكوى|complaint|error|خطأ)\b/i.test(lower)) {
      supportSignals++;
    }
  }

  // Determine state based on signal counts
  if (supportSignals >= 2) return "support";
  if (negotiatingSignals >= 2) return "negotiating";
  if (orderingSignals >= 2) return "ordering";

  return "browsing";
}

/**
 * Determine which agents should be active for this intent
 */
function determineActiveAgents(intent: ParsedIntent): AgentType[] {
  const agents: AgentType[] = [intent.requiresAgent];

  // Add complementary agents
  switch (intent.type) {
    case "food_order":
      agents.push("delivery", "financial");
      break;
    case "product_search":
      agents.push("analytics");
      break;
    case "order_tracking":
      agents.push("fleet", "delivery");
      break;
    case "payment":
      agents.push("financial");
      break;
    case "haggle_request":
      agents.push("financial");
      break;
    case "cv_generation":
    case "job_search":
    case "job_apply":
      // Recruitment only
      break;
    case "b2b_inquiry":
      agents.push("cross_border", "financial");
      break;
    case "zakat_calc":
      agents.push("financial");
      break;
    default:
      // Mentor handles most
      break;
  }

  // Deduplicate
  return [...new Set(agents)];
}

/**
 * Create minimal context when full build fails
 */
function createMinimalContext(
  userId: string,
  marketCode: string,
  message: string
): ConversationContext {
  const intent = parseIntent(message);

  return {
    sessionId: `fallback_${userId}_${Date.now()}`,
    userId,
    marketCode: marketCode || "KW",
    intent,
    history: [],
    activeAgents: [intent.requiresAgent],
    userState: "browsing",
    preferences: {},
  };
}

// ============================================
// PERIODIC CLEANUP
// ============================================

// Clean expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, ctx] of sessionCache) {
    const lastMessage = ctx.history[ctx.history.length - 1];
    if (lastMessage) {
      const age = now - lastMessage.timestamp.getTime();
      if (age > SESSION_TTL_MS) {
        sessionCache.delete(sessionId);
      }
    }
  }
}, 5 * 60 * 1000);
