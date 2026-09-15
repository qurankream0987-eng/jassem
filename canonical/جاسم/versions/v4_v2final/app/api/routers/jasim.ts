import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { db } from "@db/queries/connection";
import { chats, messages, memory, bubbles, agentLogs } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";
import { detectIntent, generateResponse } from "../lib/ai";

// ─── bubble generation per intent ──────────────────────────────────────
function generateBubblesForIntent(
  intent: string,
  message: string,
  marketCode: string = "KW",
): Array<{
  id: string;
  type: string;
  label: string;
  color: string;
  color2: string;
  items: Array<{ title: string; val: string; up: boolean }>;
}> {
  const currencySymbol = marketCode === "KW" ? "د.ك" : marketCode === "SA" ? "ر.س" : marketCode === "AE" ? "د.إ" : "د.ك";

  const bubbleMap: Record<string, Array<{ id: string; type: string; label: string; color: string; color2: string; items: Array<{ title: string; val: string; up: boolean }> }>> = {
    food_order: [{
      id: "food", type: "food", label: "طعام", color: "#FF6B00", color2: "#FFD700",
      items: [
        { title: "كبستنا", val: `5.5 ${currencySymbol}`, up: false },
        { title: "برجر كنج", val: `3.2 ${currencySymbol}`, up: false },
        { title: "برياني هندي", val: `4.0 ${currencySymbol}`, up: false },
        { title: "شاورما", val: `1.5 ${currencySymbol}`, up: false },
      ],
    }],
    product_search: [{
      id: "products", type: "products", label: "منتجات", color: "#00d4ff", color2: "#4a9eff",
      items: [
        { title: "خلاط سعة 2لتر", val: `12.5 ${currencySymbol}`, up: false },
        { title: "شاحن سريع 65W", val: `8.0 ${currencySymbol}`, up: false },
        { title: "سماعات بلوتوث", val: `15.0 ${currencySymbol}`, up: true },
      ],
    }],
    job_seeker: [{
      id: "cv", type: "cv", label: "السيرة الذاتية", color: "#00c896", color2: "#00d4ff",
      items: [
        { title: "الدور", val: message.replace(/أبي وظيفة|ابحث عن|وظيفة/g, "").trim() || "عام", up: true },
        { title: "نقاط القوة", val: "الذكاء والخبرة", up: true },
        { title: "التوصية", val: "95%", up: true },
      ],
    }],
    hire_worker: [{
      id: "jobs", type: "jobs", label: "الوظائف", color: "#a855f7", color2: "#ec4899",
      items: [
        { title: "منشور", val: "تم النشر", up: true },
        { title: "مرشحون", val: "3 متاحين", up: true },
        { title: "أفضل تطابق", val: "87%", up: true },
      ],
    }],
    create_store: [{
      id: "saas", type: "saas", label: "منصتي", color: "#ec4899", color2: "#a855f7",
      items: [
        { title: "النوع", val: "POS ذكي", up: true },
        { title: "الحالة", val: "جاهز في 3 دق", up: true },
        { title: "السعر", val: `39 ${currencySymbol}/شهر`, up: false },
      ],
    }],
    order_tracking: [{
      id: "tracking", type: "tracking", label: "التتبع", color: "#00d4ff", color2: "#00c896",
      items: [
        { title: "السائق", val: "سالم - كامري 2024", up: true },
        { title: "الوقت", val: "8 دقائق", up: true },
        { title: "الحالة", val: "في الطريق", up: true },
      ],
    }],
    payment: [{
      id: "payment", type: "payment", label: "الدفع", color: "#00c896", color2: "#FFD700",
      items: [
        { title: "المبلغ", val: `25.5 ${currencySymbol}`, up: false },
        { title: "KNET", val: "متاح", up: true },
        { title: "Apple Pay", val: "متاح", up: true },
      ],
    }],
    haggle: [{
      id: "haggle", type: "haggle", label: "المفاوضة", color: "#FF6B00", color2: "#ec4899",
      items: [
        { title: "العرض", val: "100 كرتون مياه", up: true },
        { title: "سعرك", val: `45 ${currencySymbol}`, up: false },
        { title: "توصية AI", val: `48 ${currencySymbol} + توصيل مجاني`, up: true },
      ],
    }],
    return_item: [{
      id: "return", type: "return", label: "الإرجاع", color: "#ff6b6b", color2: "#FF6B00",
      items: [
        { title: "المنتج", val: "خلاط كهربائي", up: false },
        { title: "الحالة", val: "تالف", up: false },
        { title: "الحل", val: "استبدال خلال 24س", up: true },
      ],
    }],
  };

  return bubbleMap[intent] || [];
}

// ─── suggested actions per intent ──────────────────────────────────────
function getSuggestedActions(intent: string, marketCode: string = "KW"): Array<{
  label: string;
  intent: string;
  icon: string;
}> {
  const commonActions: Record<string, Array<{ label: string; intent: string; icon: string }>> = {
    food_order: [
      { label: "اطلب كبسة", intent: "food_order_kabsa", icon: "🍗" },
      { label: "مطاعم قريبة", intent: "nearby_restaurants", icon: "📍" },
      { label: "عروض اليوم", intent: "daily_deals", icon: "🔥" },
    ],
    product_search: [
      { label: "ابحث منتج", intent: "product_search", icon: "🔍" },
      { label: "قارن أسعار", intent: "price_compare", icon: "📊" },
      { label: "أفضل مبيعات", intent: "best_sellers", icon: "🏆" },
    ],
    job_seeker: [
      { label: "ابحث وظيفة", intent: "job_search", icon: "🔎" },
      { label: "سوي CV", intent: "generate_cv", icon: "📄" },
      { label: "وظائف حكومية", intent: "gov_jobs", icon: "🏛" },
    ],
    hire_worker: [
      { label: "نشر وظيفة", intent: "post_job", icon: "📢" },
      { label: "المرشحين", intent: "browse_candidates", icon: "👥" },
      { label: "مقابلات", intent: "schedule_interview", icon: "📅" },
    ],
    create_store: [
      { label: "افتح متجر", intent: "deploy_saas", icon: "🏪" },
      { label: "POS ذكي", intent: "setup_pos", icon: "💻" },
      { label: "ربط أنظمة", intent: "smart_connect", icon: "🔗" },
    ],
    order_tracking: [
      { label: "وين طلبي", intent: "order_tracking", icon: "📦" },
      { label: "اتصل بالسائق", intent: "call_driver", icon: "📞" },
      { label: "السجل", intent: "order_history", icon: "📋" },
    ],
    payment: [
      { label: "ادفع الآن", intent: "pay_now", icon: "💳" },
      { label: "KNET", intent: "knet_payment", icon: "🏦" },
      { label: "Apple Pay", intent: "apple_pay", icon: "🍎" },
    ],
    haggle: [
      { label: "فاوض السعر", intent: "start_haggle", icon: "💬" },
      { label: "اشتري فوري", intent: "buy_now", icon: "⚡" },
      { label: "عرض جملة", intent: "bulk_offer", icon: "📦" },
    ],
    return_item: [
      { label: "إرجاع منتج", intent: "return_item", icon: "↩️" },
      { label: "استبدال", intent: "exchange", icon: "🔄" },
      { label: "الدعم", intent: "customer_support", icon: "🎧" },
    ],
    general_chat: [
      { label: "اطلب كبسة", intent: "food_order", icon: "🍗" },
      { label: "وين طلبي", intent: "order_tracking", icon: "📦" },
      { label: "افتح متجر", intent: "deploy_saas", icon: "🏪" },
      { label: "دلني طريق", intent: "navigation", icon: "🗺" },
    ],
  };

  return commonActions[intent] || commonActions.general_chat;
}

// ─── determine which agent handles an intent ──────────────────────────
function resolveAgent(intent: string): string {
  const agentMap: Record<string, string> = {
    food_order: "food",
    product_search: "fashion",
    grocery_order: "grocery",
    pharmacy_order: "pharmacy",
    order_tracking: "fleet",
    job_seeker: "recruitment",
    hire_worker: "recruitment",
    create_store: "gen_saas",
    payment: "fashion",
    haggle: "haggle",
    return_item: "fashion",
    smart_connect: "smart_connect",
    analytics: "analytics",
  };
  return agentMap[intent] || "analytics";
}

// ─── generate personalized home bubbles ────────────────────────────────
function generateHomeBubbles(marketCode: string = "KW"): Array<{
  type: string;
  theme: string;
  priority: number;
  label: string;
  icon: string;
}> {
  return [
    { type: "food_order", theme: "spicy_food_night", priority: 1, label: "عشاء توابل", icon: "🍗" },
    { type: "product_search", theme: "trendy_look", priority: 2, label: "أناقة اليوم", icon: "👗" },
    { type: "delivery_tracking", theme: "fast_track", priority: 3, label: "وين طلبي", icon: "📦" },
    { type: "job_seeker", theme: "career_boost", priority: 4, label: "وظيفة أحلامك", icon: "💼" },
    { type: "create_store", theme: "launch_ready", priority: 5, label: "افتح متجر", icon: "🏪" },
    { type: "haggle", theme: "smart_deal", priority: 6, label: "صفقة ذكية", icon: "💬" },
    { type: "payment", theme: "easy_pay", priority: 7, label: "ادفع بسهولة", icon: "💳" },
  ];
}

// ─── MAIN JASIM ROUTER ─────────────────────────────────────────────────
export const jasimRouter = router({

  // ═══════════════════════════════════════════════
  // THE main entry point — send a message to JASIM
  // ═══════════════════════════════════════════════
  chat: authedQuery
    .input(z.object({
      message: z.string().min(1, "الرسالة لا يمكن أن تكون فارغة"),
      sessionId: z.string().optional(),
      marketCode: z.string().length(2).default("KW"),
      attachments: z.array(z.object({
        type: z.enum(["image", "voice", "location"]),
        url: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const startTime = Date.now();

      // 1. Parse intent from message
      const intentResult = detectIntent(input.message);

      // 2. Get or create session
      let sessionId = input.sessionId;
      if (!sessionId) {
        const [chat] = await db.insert(chats).values({
          userId,
          title: input.message.substring(0, 50),
          intent: intentResult.intent,
          context: { marketCode: input.marketCode },
          isActive: true,
        }).$returningId();
        sessionId = String(chat.id);
      }

      // 3. Store user message
      await db.insert(messages).values({
        chatId: Number(sessionId),
        role: "user",
        content: input.message,
        intent: intentResult.intent,
      });

      // 4. Recall relevant memories
      const userMemories = await db.select().from(memory)
        .where(eq(memory.userId, userId))
        .limit(10);

      const memoryContext = userMemories.length > 0
        ? `المستخدم يفضل: ${userMemories.map(m => m.value).join("، ")}`
        : "";

      // 5. Route to appropriate agent
      const agentUsed = resolveAgent(intentResult.intent);

      // 6. Generate AI response
      const systemPrompt = `أنت جاسم (JASIM)، وكيل ذكاء اصطناعي تنفيذي عربي متخصص في التجارة والأعمال.
        - تحدث بالعربية الفصحى أو العامة الخليجية
        - السوق: ${input.marketCode}
        - النية المكتشفة: ${intentResult.intent}
        - ثقة النية: ${intentResult.confidence}
        ${memoryContext}`;

      const aiResponse = await generateResponse(input.message, systemPrompt);

      // 7. Generate bubbles
      const bubbles = generateBubblesForIntent(intentResult.intent, input.message, input.marketCode);

      // 8. Suggested actions
      const actions = getSuggestedActions(intentResult.intent, input.marketCode);

      // 9. Store assistant response
      await db.insert(messages).values({
        chatId: Number(sessionId),
        role: "assistant",
        content: aiResponse.text,
        intent: intentResult.intent,
        bubbleData: { bubbles, actions, agentUsed },
      });

      // 10. Log agent execution
      await db.insert(agentLogs).values({
        agentName: agentUsed,
        userId,
        intent: intentResult.intent,
        input: input.message,
        output: aiResponse.text,
        tokensUsed: aiResponse.tokens,
        duration: Date.now() - startTime,
      });

      return {
        response: aiResponse.text,
        bubbles,
        actions,
        agentUsed,
        confidence: intentResult.confidence,
        sessionId,
      };
    }),

  // ═══════════════════════════════════════════════
  // Quick actions — context-aware suggestions
  // ═══════════════════════════════════════════════
  quickActions: authedQuery
    .input(z.object({
      sessionId: z.string(),
      marketCode: z.string().default("KW"),
    }))
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);

      // Get last intent from conversation
      const recentMessages = await db.select().from(messages)
        .where(eq(messages.chatId, Number(input.sessionId)))
        .orderBy(desc(messages.createdAt))
        .limit(5);

      const lastIntent = recentMessages.find(m => m.intent)?.intent || "general_chat";
      const actions = getSuggestedActions(lastIntent, input.marketCode);

      return { actions };
    }),

  // ═══════════════════════════════════════════════
  // Get suggested bubbles for home screen
  // ═══════════════════════════════════════════════
  homeBubbles: authedQuery
    .input(z.object({
      marketCode: z.string().default("KW"),
    }))
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);

      // Recall user preferences from memory
      const userMemories = await db.select().from(memory)
        .where(eq(memory.userId, userId))
        .limit(10);

      // Get recent bubble usage
      const userBubbles = await db.select().from(bubbles)
        .where(eq(bubbles.userId, userId))
        .orderBy(desc(bubbles.createdAt))
        .limit(5);

      const baseBubbles = generateHomeBubbles(input.marketCode);

      // Personalize based on history
      const personalized = baseBubbles.map(b => {
        const history = userBubbles.find(ub => ub.type === b.type);
        return {
          ...b,
          priority: history ? history.isPinned ? b.priority - 2 : b.priority : b.priority,
        };
      }).sort((a, b) => a.priority - b.priority);

      return { bubbles: personalized };
    }),

  // ═══════════════════════════════════════════════
  // Process voice message
  // ═══════════════════════════════════════════════
  voiceChat: authedQuery
    .input(z.object({
      audioUrl: z.string(),
      marketCode: z.string(),
      sessionId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Mock voice transcription (delegates to voice.transcribe in production)
      const mockTexts = [
        "أهلاً، أبي أطلب كبسة بالدجاج وعصير ليمون",
        "شلونكم شباب؟ وين ألقى محل إلكترونيكس قريب؟",
        "أبي أسوي متجر إلكتروني حق منتجاتي",
        "أبي وظيفة مطور برامج في الكويت",
      ];
      const text = mockTexts[Math.floor(Math.random() * mockTexts.length)];

      // 2. Pass transcribed text through chat handler
      const intentResult = detectIntent(text);
      const aiResponse = await generateResponse(
        text,
        `أنت جاسم. المستخدم أرسل رسالة صوتية. نية مكتشفة: ${intentResult.intent}. رد بالعربية.`,
      );

      const bubbles = generateBubblesForIntent(intentResult.intent, text, input.marketCode);

      return {
        text,
        response: aiResponse.text,
        bubbles,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
      };
    }),

  // ═══════════════════════════════════════════════
  // Process image (AI Vision)
  // ═══════════════════════════════════════════════
  visionChat: authedQuery
    .input(z.object({
      imageUrl: z.string(),
      marketCode: z.string(),
      sessionId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Analyze image (delegates to vision router in production)
      const detectedObjects = [
        "منتج غذائي", "منتج إلكتروني", "وثيقة رسمية",
        "ملابس", "أثاث", "سيارة", "دواء",
      ];
      const detected = detectedObjects[Math.floor(Math.random() * detectedObjects.length)];

      const aiResponse = await generateResponse(
        `المستخدم أرسل صورة تحتوي على: ${detected}`,
        "أنت جاسم. المستخدم أرسل صورة. حلل الصورة وقدم رداً مفيداً بالعربية.",
      );

      const bubbles: Array<{
        id: string;
        type: string;
        label: string;
        color: string;
        color2: string;
        items: Array<{ title: string; val: string; up: boolean }>;
      }> = [{
        id: "vision", type: "vision", label: "تحليل الصورة",
        color: "#6366f1", color2: "#a855f7",
        items: [
          { title: "المكتشف", val: detected, up: true },
          { title: "الثقة", val: "92%", up: true },
          { title: "الإجراء", val: "بحث متاح", up: true },
        ],
      }];

      return {
        detected,
        response: aiResponse.text,
        bubbles,
      };
    }),

  // ═══════════════════════════════════════════════
  // Get conversation history
  // ═══════════════════════════════════════════════
  history: authedQuery
    .input(z.object({
      sessionId: z.string(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const messagesList = await db.select().from(messages)
        .where(eq(messages.chatId, Number(input.sessionId)))
        .orderBy(desc(messages.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return {
        messages: messagesList.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          intent: m.intent,
          bubbleData: m.bubbleData,
          createdAt: m.createdAt,
        })),
      };
    }),

  // ═══════════════════════════════════════════════
  // Create new conversation session
  // ═══════════════════════════════════════════════
  newSession: authedQuery
    .mutation(async ({ ctx }) => {
      const userId = Number(ctx.user!.id);

      const [chat] = await db.insert(chats).values({
        userId,
        title: "محادثة جديدة",
        isActive: true,
      }).$returningId();

      return { sessionId: String(chat.id) };
    }),

  // ═══════════════════════════════════════════════
  // Health check (public)
  // ═══════════════════════════════════════════════
  health: publicQuery
    .query(() => {
      return {
        status: "ok",
        agent: "jasim",
        version: "1.0.0",
        message: "جاسم جاهز! 🚀",
      };
    }),
});
