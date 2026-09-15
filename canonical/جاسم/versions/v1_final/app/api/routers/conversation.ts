import { router, authedQuery } from "../trpc";
import { z } from "zod";
import { db } from "@db/queries/connection";
import { chats, messages, memory, agentLogs } from "@db/schema";
import { eq, desc, and } from "drizzle-orm";
import { detectIntent, generateResponse } from "../lib/ai";

// ─── Types ─────────────────────────────────────────────────────────────
interface ConversationMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string;
  bubbleData?: Record<string, unknown>;
  createdAt: Date;
}

interface ConversationSummary {
  sessionId: string;
  title: string;
  lastMessage?: string;
  messageCount: number;
  intent?: string;
  updatedAt: Date;
}

// ─── Helper: build conversation context ────────────────────────────────
function buildContext(msgs: ConversationMessage[]): Record<string, unknown> {
  if (msgs.length === 0) return {};

  const userMessages = msgs.filter(m => m.role === "user");
  const intents = msgs.filter(m => m.intent).map(m => m.intent!);
  const topIntent = intents.length > 0
    ? intents.sort((a, b) =>
        intents.filter(i => i === a).length - intents.filter(i => i === b).length
      ).pop()
    : undefined;

  return {
    totalMessages: msgs.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: msgs.filter(m => m.role === "assistant").length,
    topIntent,
    lastTopic: userMessages[userMessages.length - 1]?.content.substring(0, 100),
    duration: msgs.length > 0
      ? Math.round((new Date(msgs[msgs.length - 1].createdAt).getTime()
          - new Date(msgs[0].createdAt).getTime()) / 60000)
      : 0,
  };
}

// ─── Helper: analyze sentiment ─────────────────────────────────────────
function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  const positive = ["شكرا", "ممتاز", "رائع", "حلو", "جميل", "أحب", "أفضل", "😊", "❤️", "👍"];
  const negative = ["سيء", "مشكلة", "غاضب", "محبط", "سيئ", " worst", "bad", "😡", "😠", "👎"];

  let score = 0;
  positive.forEach(w => { if (text.includes(w)) score += 1; });
  negative.forEach(w => { if (text.includes(w)) score -= 1; });

  if (score > 0) return "positive";
  if (score < 0) return "negative";
  return "neutral";
}

// ─── CONVERSATION ROUTER ───────────────────────────────────────────────
export const conversationRouter = router({

  // ═══════════════════════════════════════════════
  // List user's conversations
  // ═══════════════════════════════════════════════
  list: authedQuery
    .input(z.object({
      marketCode: z.string().optional(),
      limit: z.number().default(20),
      offset: z.number().default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);

      // Get all chat sessions for user
      const userChats = await db.select().from(chats)
        .where(eq(chats.userId, userId))
        .orderBy(desc(chats.updatedAt))
        .limit(input?.limit || 20)
        .offset(input?.offset || 0);

      // Get last message for each chat
      const conversations: ConversationSummary[] = [];
      for (const chat of userChats) {
        const [lastMsg] = await db.select().from(messages)
          .where(eq(messages.chatId, chat.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        const msgCount = await db.select().from(messages)
          .where(eq(messages.chatId, chat.id));

        conversations.push({
          sessionId: String(chat.id),
          title: chat.title || "محادثة",
          lastMessage: lastMsg?.content.substring(0, 100),
          messageCount: msgCount.length,
          intent: chat.intent || undefined,
          updatedAt: chat.updatedAt,
        });
      }

      return { conversations, total: conversations.length };
    }),

  // ═══════════════════════════════════════════════
  // Get a conversation with messages
  // ═══════════════════════════════════════════════
  get: authedQuery
    .input(z.object({
      sessionId: z.string(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const chatId = Number(input.sessionId);

      // Verify ownership
      const [chat] = await db.select().from(chats)
        .where(eq(chats.id, chatId))
        .limit(1);

      if (!chat || chat.userId !== userId) {
        return { messages: [], context: {}, error: "الدردشة غير موجودة" };
      }

      // Get messages
      const msgs = await db.select().from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(desc(messages.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const typedMessages: ConversationMessage[] = msgs.map(m => ({
        id: m.id,
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        intent: m.intent || undefined,
        bubbleData: m.bubbleData || undefined,
        createdAt: m.createdAt,
      }));

      const context = buildContext(typedMessages);

      return {
        messages: typedMessages,
        context: {
          ...context,
          sessionId: input.sessionId,
          chatTitle: chat.title,
          isActive: chat.isActive,
          intent: chat.intent,
        },
      };
    }),

  // ═══════════════════════════════════════════════
  // Send message (delegates to jasim.chat internally)
  // ═══════════════════════════════════════════════
  sendMessage: authedQuery
    .input(z.object({
      sessionId: z.string(),
      content: z.string().min(1, "لا يمكن إرسال رسالة فارغة"),
      attachments: z.array(z.object({
        type: z.enum(["image", "voice", "location"]),
        url: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const chatId = Number(input.sessionId);
      const startTime = Date.now();

      // 1. Verify chat ownership
      const [chat] = await db.select().from(chats)
        .where(eq(chats.id, chatId))
        .limit(1);

      if (!chat || chat.userId !== userId) {
        return { error: "الدردشة غير موجودة", message: null, response: null };
      }

      // 2. Detect intent
      const intentResult = detectIntent(input.content);

      // 3. Store user message
      const [userMsg] = await db.insert(messages).values({
        chatId,
        role: "user",
        content: input.content,
        intent: intentResult.intent,
      }).$returningId();

      // 4. Get conversation memory
      const userMemories = await db.select().from(memory)
        .where(eq(memory.userId, userId))
        .limit(5);

      // 5. Generate AI response
      const systemPrompt = `أنت جاسم، وكيل ذكي عربي. السياق: محادثة مستمرة في موضوع ${chat.intent || "عام"}.
        ${userMemories.length > 0 ? `تذكر أن المستخدم: ${userMemories.map(m => m.value).join("، ")}` : ""}`;

      const aiResponse = await generateResponse(input.content, systemPrompt);

      // 6. Store assistant response
      const [assistantMsg] = await db.insert(messages).values({
        chatId,
        role: "assistant",
        content: aiResponse.text,
        intent: intentResult.intent,
        bubbleData: { confidence: intentResult.confidence },
      }).$returningId();

      // 7. Update chat intent if not set
      if (!chat.intent) {
        await db.update(chats)
          .set({ intent: intentResult.intent })
          .where(eq(chats.id, chatId));
      }

      // 8. Log agent execution
      await db.insert(agentLogs).values({
        agentName: "conversation",
        userId,
        intent: intentResult.intent,
        input: input.content,
        output: aiResponse.text,
        tokensUsed: aiResponse.tokens,
        duration: Date.now() - startTime,
      });

      return {
        message: {
          id: userMsg.id,
          role: "user",
          content: input.content,
          intent: intentResult.intent,
          createdAt: new Date(),
        },
        response: {
          id: assistantMsg.id,
          role: "assistant",
          content: aiResponse.text,
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          model: aiResponse.model,
          duration: Date.now() - startTime,
        },
      };
    }),

  // ═══════════════════════════════════════════════
  // Delete conversation
  // ═══════════════════════════════════════════════
  delete: authedQuery
    .input(z.object({
      sessionId: z.string(),
      permanent: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const chatId = Number(input.sessionId);

      // Verify ownership
      const [chat] = await db.select().from(chats)
        .where(eq(chats.id, chatId))
        .limit(1);

      if (!chat || chat.userId !== userId) {
        return { success: false, error: "الدردشة غير موجودة" };
      }

      if (input.permanent) {
        // Hard delete: remove messages then chat
        const allMessages = await db.select().from(messages)
          .where(eq(messages.chatId, chatId));

        for (const msg of allMessages) {
          await db.delete(messages).where(eq(messages.id, msg.id));
        }

        await db.delete(chats).where(eq(chats.id, chatId));
      } else {
        // Soft delete: mark as inactive
        await db.update(chats)
          .set({ isActive: false })
          .where(eq(chats.id, chatId));
      }

      return { success: true };
    }),

  // ═══════════════════════════════════════════════
  // Get conversation insights
  // ═══════════════════════════════════════════════
  insights: authedQuery
    .input(z.object({
      sessionId: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const chatId = Number(input.sessionId);

      // Verify ownership
      const [chat] = await db.select().from(chats)
        .where(eq(chats.id, chatId))
        .limit(1);

      if (!chat || chat.userId !== userId) {
        return { topics: [], sentiment: "neutral" as const, agentUsed: "", messageCount: 0 };
      }

      // Get all messages
      const msgs = await db.select().from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(desc(messages.createdAt));

      // Extract topics (intents)
      const intentCounts: Record<string, number> = {};
      msgs.forEach(m => {
        if (m.intent) {
          intentCounts[m.intent] = (intentCounts[m.intent] || 0) + 1;
        }
      });

      const topics = Object.entries(intentCounts)
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count);

      // Analyze overall sentiment
      const allText = msgs.filter(m => m.role === "user").map(m => m.content).join(" ");
      const sentiment = analyzeSentiment(allText);

      // Get agent used (from bubbleData or intent)
      const lastAssistantMsg = msgs.find(m => m.role === "assistant");
      const agentUsed = (lastAssistantMsg?.bubbleData as Record<string, unknown>)?.agentUsed as string
        || chat.intent
        || "general";

      return {
        topics: topics.map(t => t.topic),
        topicBreakdown: topics,
        sentiment,
        agentUsed,
        messageCount: msgs.length,
        userMessageCount: msgs.filter(m => m.role === "user").length,
        assistantMessageCount: msgs.filter(m => m.role === "assistant").length,
        duration: msgs.length > 0
          ? Math.round((new Date(msgs[msgs.length - 1].createdAt).getTime()
              - new Date(msgs[0].createdAt).getTime()) / 60000)
          : 0,
      };
    }),

  // ═══════════════════════════════════════════════
  // Update conversation title
  // ═══════════════════════════════════════════════
  updateTitle: authedQuery
    .input(z.object({
      sessionId: z.string(),
      title: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);
      const chatId = Number(input.sessionId);

      const [chat] = await db.select().from(chats)
        .where(eq(chats.id, chatId))
        .limit(1);

      if (!chat || chat.userId !== userId) {
        return { success: false, error: "الدردشة غير موجودة" };
      }

      await db.update(chats)
        .set({ title: input.title })
        .where(eq(chats.id, chatId));

      return { success: true };
    }),

  // ═══════════════════════════════════════════════
  // Get recent conversations (shortcut for home screen)
  // ═══════════════════════════════════════════════
  recent: authedQuery
    .input(z.object({
      limit: z.number().default(5),
    }).optional())
    .query(async ({ ctx, input }) => {
      const userId = Number(ctx.user!.id);

      const userChats = await db.select().from(chats)
        .where(and(
          eq(chats.userId, userId),
          eq(chats.isActive, true),
        ))
        .orderBy(desc(chats.updatedAt))
        .limit(input?.limit || 5);

      return {
        conversations: userChats.map(c => ({
          sessionId: String(c.id),
          title: c.title || "محادثة",
          intent: c.intent,
          updatedAt: c.updatedAt,
        })),
      };
    }),
});
