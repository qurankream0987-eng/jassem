/**
 * Response Generator - Generate natural Arabic responses using LLM
 * Creates dialect-aware, contextually relevant responses for JASIM
 * Falls back to templates when LLM is unavailable
 */

import { z } from "zod";
import type {
  ParsedIntent,
  IntentType,
  ConversationContext,
  BubbleType,
  ArabicDialect,
  AgentType,
} from "./types";
import { getLLMRouter } from "./llm-router";
import { getArabicNLP } from "./arabic-nlp";

// ============================================
// ZOD SCHEMAS
// ============================================

export const GeneratedResponseSchema = z.object({
  text: z.string(),
  suggestedActions: z.array(
    z.object({
      label: z.string(),
      action: z.string(),
      data: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  confidence: z.number().min(0).max(1),
  metadata: z
    .object({
      model: z.string(),
      tokensUsed: z.number(),
      cost: z.number(),
      latency: z.number(),
      usedTemplate: z.boolean(),
    })
    .optional(),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type GeneratedResponse = z.infer<typeof GeneratedResponseSchema>;

export interface SuggestedAction {
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

// ============================================
// DIALECT-SPECIFIC RESPONSE PATTERNS
// ============================================

const DIALECT_TEMPLATES: Record<
  ArabicDialect,
  Record<string, string[]>
> = {
  gulf: {
    greeting: [
      "هلا والله! شلونك اليوم؟",
      "أهلاً حبيبي! وش تبي تسوي؟",
      "هلا بيك! كيف الحال؟",
      "مرحبا! شخبارك؟",
    ],
    food_order: [
      "تمام، وش تبي تطلب؟ أنا جاهز أساعدك",
      "يبيّلنا ناكل شي زين! وش تحب؟",
      "قول وش تبي وأنا أدورلك أحسن مطاعم",
    ],
    product_search: [
      "دقائق بس، أدورلك على هالمنتج",
      "إن شاء الله نلقى لك اللي تبي",
      "وش بالضبط تدور؟ أنا حاضر أساعدك",
    ],
    order_tracking: [
      "دقيقة بس، أشيك على طلبيتك",
      "طلبيتك واصلة إن شاء الله! هذي التفاصيل:",
      "أشرفك، هذي وين وصلت طلبيتك:",
    ],
    payment: [
      "تمام، وش طريقة الدفع اللي تبيها؟",
      "عندك كنت، أبل باي، جوجل باي، أو كاش",
      "ما يصير إلا بالحلال! اختر طريقة الدفع:",
    ],
    haggle_request: [
      "هاها، تبي تفاصل؟ خلني أشوف وش أقدر أسوي",
      "شاطر! مجال التفاوض موجود",
      "قول سعرك وشوف وش أقدر أسوي",
    ],
    help: [
      "ولا يهمك! أنا حاضر أساعدك",
      "قول وش تحتاج وأنا أشرحلك",
      "إن شاء الله نحل مشكلتك",
    ],
    fallback: [
      "أفهم عليك، بس عطني شوي أوضح",
      "ما فهمت بالضبط، تقدر توضح أكثر؟",
      "إن شاء الله نفهم بعض! شنو تقصد بالضبط؟",
    ],
  },
  levantine: [
    // levantine uses same keys but different phrasing
  ] as unknown as Record<string, string[]>,
  egyptian: [
    // egyptian uses same keys but different phrasing
  ] as unknown as Record<string, string[]>,
  maghrebi: [
    // maghrebi uses same keys but different phrasing
  ] as unknown as Record<string, string[]>,
  msa: [
    // msa uses same keys but different phrasing
  ] as unknown as Record<string, string[]>,
  unknown: [
    // fallback
  ] as unknown as Record<string, string[]>,
};

// Fill in other dialects
DIALECT_TEMPLATES.levantine = {
  greeting: ["أهلاً! كيفك؟", "مرحبا! شو أخبارك؟", "هلا! كيف صحتك؟"],
  food_order: ["شو بدك تطلب؟", "بدك تأكل شي؟", "شو ناوي تاكل؟"],
  product_search: ["دقيقة بفتشلك", "شو بدك بالضبط؟", "إن شاء الله منلاقي"],
  order_tracking: ["رقم الطلبية؟", "دقيقة بشيك", "هيي طلبيتك"],
  payment: ["شو طريقة الدفع؟", "عندك كاش أو بطاقة", "تمام، نجهز الدفع"],
  haggle_request: ["بدك تفاصّل؟ أوكي", "شو سعرك؟", "في مجال"],
  help: ["ولا يهمك، شو بدك؟", "أنا حاضر أساعدك", "شرلي شو بدك"],
  fallback: ["ما فهمت كتير، توضح شوي؟", "عطيني تفاصيل أكتر", "شو تقصد؟"],
};

DIALECT_TEMPLATES.egyptian = {
  greeting: ["أهلاً! إزيك؟", "هلا! عامل إيه؟", "صباح الفل!"],
  food_order: ["عايز تأكل إيه؟", "إيه أكلتك المفضلة؟", "هنطلب مع بعض"],
  product_search: ["أنا أدورلك حالاً", "عايز إيه بالظبط؟", "دقيقة كده"],
  order_tracking: ["رقم الأوردر؟", "أشوف طلبك", "ده وصل فين دلوقتي"],
  payment: ["عايز تدفع إزاي؟", "فيزا ولا كاش؟", "تمام، نجهز"],
  haggle_request: ["عايز تفاصل؟", "قول سعرك", "في مجال إن شاء الله"],
  help: ["متقلقش! أنا معاك", "إيه المشكلة؟", "أنا حاضر أساعدك"],
  fallback: ["مش فاهم قوي، أوضح", "إيه تقصد بالظبط؟", "قول تاني كده"],
};

DIALECT_TEMPLATES.maghrebi = {
  greeting: ["مرحبا! كيفاش؟", "أهلاً! واش راك؟", "السلام عليكم!"],
  food_order: ["واش بغيتي تأكل؟", "شنو ناوي تأكل؟", "شحال عندك جوع؟"],
  product_search: ["نقصك شي؟", "واش تدور؟", "دابا نقلبلك"],
  order_tracking: ["وين وصل الطلبية؟", "رقم الطلبية؟", "هذا مكانها"],
  payment: ["كيفاش بغيتي تخلص؟", "كاش ولا بطاقة؟", "تمام"],
  haggle_request: ["بغيتي تفاوض؟", "شحال عطيت؟", "نقدر ننزل شوية"],
  help: ["ماشي مشكل!", "كيفاش نقدر نساعدك؟", "أنا حاضر"],
  fallback: ["مفهمتش مزيان، وضح شوية", "شنو تقصد؟", "عاود قول"],
};

DIALECT_TEMPLATES.msa = {
  greeting: ["مرحباً! كيف حالك؟", "أهلاً وسهلاً!", "السلام عليكم ورحمة الله"],
  food_order: ["ماذا تود أن تطلب؟", "ما نوع الطعام المفضل لديك؟", "يسعدنا خدمتك"],
  product_search: ["سنبحث لك عن المنتج", "ما المنتج الذي تبحث عنه؟", "لحظات وسنجد لك"],
  order_tracking: ["رقم الطلبية من فضلك", "دعني أتحقق من طلبك", "حالة طلبك:"],
  payment: ["ما هي طريقة الدفع المفضلة؟", "نوفر خيارات دفع آمنة", "تمام"],
  haggle_request: ["يمكننا مناقشة السعر", "ما هو السعر المناسب لك؟", "سنرى ما يمكن فعله"],
  help: ["يسعدنا مساعدتك", "كيف يمكنني مساعدتك؟", "نحن هنا لخدمتك"],
  fallback: ["لم أفهم تماماً، هل يمكن التوضيح؟", "عذراً، أعد السؤال بطريقة أخرى", "أنا هنا للمساعدة"],
};

DIALECT_TEMPLATES.unknown = { ...DIALECT_TEMPLATES.gulf };

// ============================================
// INTENT → SUGGESTED ACTIONS MAP
// ============================================

const INTENT_ACTIONS: Record<string, SuggestedAction[]> = {
  food_order: [
    { label: "المطاعم القريبة", action: "nearby_restaurants" },
    { label: "العروض", action: "food_offers" },
    { label: "اطلب مجدداً", action: "reorder" },
  ],
  product_search: [
    { label: "تصفح الفئات", action: "browse_categories" },
    { label: "الأكثر مبيعاً", action: "best_sellers" },
    { label: "عروض خاصة", action: "special_offers" },
  ],
  order_tracking: [
    { label: "تفاصيل الطلب", action: "order_details" },
    { label: "اتصل بالسائق", action: "contact_driver" },
    { label: "إلغاء الطلب", action: "cancel_order" },
  ],
  payment: [
    { label: "KNET", action: "pay_knet" },
    { label: "Apple Pay", action: "pay_apple" },
    { label: "كاش", action: "pay_cash" },
  ],
  haggle_request: [
    { label: "اقترح سعر", action: "make_offer" },
    { label: "شوف عروض", action: "view_offers" },
    { label: "سعر ثابت", action: "fixed_price" },
  ],
  greeting: [
    { label: "اطلب أكل", action: "food_order" },
    { label: "تسوق", action: "product_search" },
    { label: "تابع طلبك", action: "order_tracking" },
  ],
  help: [
    { label: "كيفية الطلب", action: "how_to_order" },
    { label: "طرق الدفع", action: "payment_methods" },
    { label: "الإرجاع", action: "return_policy" },
  ],
  zakat_calc: [
    { label: "حاسبة الذهب", action: "gold_calc" },
    { label: "حاسبة الفضة", action: "silver_calc" },
    { label: "النصاب", action: "nisab_info" },
  ],
  cv_generation: [
    { label: "ابدأ السيرة", action: "start_cv" },
    { label: "قوالب", action: "cv_templates" },
    { label: "نصائح", action: "cv_tips" },
  ],
  job_search: [
    { label: "وظائف حديثة", action: "latest_jobs" },
    { label: "حسب المهارة", action: "by_skill" },
    { label: "حسب الموقع", action: "by_location" },
  ],
  general_chat: [
    { label: "اطلب أكل", action: "food_order" },
    { label: "تسوق", action: "product_search" },
    { label: "مساعدة", action: "help" },
  ],
};

// ============================================
// RESPONSE GENERATOR CLASS
// ============================================

export class ResponseGenerator {
  private llmRouter = getLLMRouter();
  private arabicNLP = getArabicNLP();

  /**
   * Generate response for any intent with real AI
   */
  async generate(
    intent: ParsedIntent,
    context: ConversationContext,
    dbData: unknown,
    agentResults: unknown[] = []
  ): Promise<GeneratedResponse> {
    try {
      // Attempt LLM-based generation
      const prompt = this.buildResponsePrompt(intent, context, dbData, agentResults);
      const complexity = this.selectComplexity(intent.type);

      const llmResponse = await this.llmRouter.route({
        complexity,
        prompt,
        temperature: 0.7,
        maxTokens: 300, // Keep responses short for bubbles
        systemPrompt: this.buildSystemPrompt(context),
      });

      // If LLM failed or returned empty, use template
      if (llmResponse.error || !llmResponse.text.trim()) {
        return this.generateFromTemplate(intent.type, context);
      }

      return {
        text: llmResponse.text.trim(),
        suggestedActions: this.extractActions(intent.type, llmResponse.text),
        confidence: llmResponse.confidence,
        metadata: {
          model: llmResponse.model,
          tokensUsed: llmResponse.tokensUsed,
          cost: llmResponse.cost,
          latency: llmResponse.latency,
          usedTemplate: false,
        },
      };
    } catch {
      // LLM unavailable - fallback to template
      return this.generateFromTemplate(intent.type, context);
    }
  }

  /**
   * Fallback to templates when LLM unavailable
   */
  async generateFromTemplate(
    intentType: IntentType,
    context: ConversationContext
  ): Promise<GeneratedResponse> {
    const dialect = (context.preferences?.dialect as ArabicDialect) || "gulf";
    const templates = DIALECT_TEMPLATES[dialect] || DIALECT_TEMPLATES.gulf;

    // Get template for intent, fallback to generic
    const intentTemplates = templates[intentType] || templates.fallback || templates.greeting;

    // Pick a template (deterministic based on session)
    const index = context.sessionId
      ? context.sessionId.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % intentTemplates.length
      : 0;

    const text = intentTemplates[index] || intentTemplates[0] || "مرحباً! كيف يمكنني مساعدتك؟";

    return {
      text,
      suggestedActions: INTENT_ACTIONS[intentType] || INTENT_ACTIONS.general_chat,
      confidence: 0.6,
      metadata: {
        model: "template",
        tokensUsed: 0,
        cost: 0,
        latency: 0,
        usedTemplate: true,
      },
    };
  }

  /**
   * Generate a quick response without LLM (for latency-sensitive paths)
   */
  generateQuick(
    intentType: IntentType,
    dialect: ArabicDialect = "gulf"
  ): GeneratedResponse {
    const templates = DIALECT_TEMPLATES[dialect] || DIALECT_TEMPLATES.gulf;
    const intentTemplates = templates[intentType] || templates.fallback;
    const text = intentTemplates[0] || "مرحباً!";

    return {
      text,
      suggestedActions: INTENT_ACTIONS[intentType] || [],
      confidence: 0.5,
      metadata: {
        model: "quick-template",
        tokensUsed: 0,
        cost: 0,
        latency: 0,
        usedTemplate: true,
      },
    };
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Build context-aware prompt for LLM
   */
  private buildResponsePrompt(
    intent: ParsedIntent,
    context: ConversationContext,
    dbData: unknown,
    agentResults: unknown[]
  ): string {
    const dialectName = this.getDialectName(context.preferences?.dialect as ArabicDialect || "gulf");
    const marketName = this.getMarketName(context.marketCode);
    const lastMessage = context.history[context.history.length - 1]?.content || "...";

    return `أنت "جاسم" — وكيل ذكي توليدي لتجارة العرب.

=== التعليمات ===
- تتحدث باللهجة ${dialectName}
- السوق: ${marketName} (${context.marketCode})
- حالة المستخدم: ${context.userState}
- نوع النية: ${intent.type}
- درجة الثقة: ${intent.confidence}

=== كيانات مكتشفة ===
${JSON.stringify(intent.entities, null, 2)}

=== بيانات قاعدة البيانات ===
${JSON.stringify(dbData, null, 2)}

=== نتائج الوكلاء ===
${JSON.stringify(agentResults, null, 2)}

=== رسالة المستخدم ===
"${lastMessage}"

=== متطلبات الرد ===
- اكتب رداً طبيعياً وودوداً باللهجة ${dialectName}
- الرد يجب أن يكون ≤ 200 كلمة
- استخدم رموز تعبيرية مناسبة 😊
- اجعل الرد مفيداً وعملياً
- اقترح إجراءات واضحة للمستخدم
- تحدث باسم "جاسم"

اكتب الرد فقط بدون أي شرح إضافي:`;
  }

  /**
   * Build system prompt with personality
   */
  private buildSystemPrompt(context: ConversationContext): string {
    const dialect = (context.preferences?.dialect as ArabicDialect) || "gulf";
    const dialectTraits: Record<string, string> = {
      gulf: "تحدث باللهجة الخليجية. استخدم كلمات مثل: 'هلا'، 'أبغى'، 'وش'، 'تمام'، 'زين'، 'والله'",
      levantine: "تحدث باللهجة الشامية. استخدم كلمات مثل: 'شو'، 'بدي'، 'منيح'، 'كتير'، 'يلا'",
      egyptian: "تحدث باللهجة المصرية. استخدم كلمات مثل: 'عايز'، 'إزيك'، 'تمام جداً'، 'خلاص'، 'بص'",
      maghrebi: "تحدث باللهجة المغربية. استخدم كلمات مثل: 'واش'، 'بغيت'، 'بزاف'، 'واخا'، 'دابا'",
      msa: "تحدث بالفصحى المبسطة",
      unknown: "تحدث بلهجة خليجية واضحة",
    };

    return `أنت جاسم (JASIM)، مساعد ذكي عربي متخصص في التجارة الإلكترونية.
${dialectTraits[dialect] || dialectTraits.gulf}

الشخصية:
- ودود، محترف، سريع
- تستخدم رموز تعبيرية باعتدال
- تقدم حلولاً عملية
- تحترم المستخدم وثقافته
- تتحدث باختصار ووضوح

القواعد:
- لا تستخدم لغة خارجة أو غير مهذبة
- لا تعد بوعود لا يمكن الوفاء بها
- كن صادقاً بشأن قدراتك`;
  }

  /**
   * Select complexity based on intent
   */
  private selectComplexity(intentType: IntentType): "simple" | "normal" | "complex" {
    switch (intentType) {
      case "greeting":
      case "general_chat":
      case "help":
        return "simple";
      case "food_order":
      case "product_search":
      case "order_tracking":
      case "delivery_tracking":
      case "job_search":
      case "job_apply":
        return "normal";
      case "haggle_request":
      case "b2b_inquiry":
      case "zakat_calc":
      case "payment":
      case "cv_generation":
      case "connect_pos":
      case "deploy_saas":
      case "create_platform":
      case "embed_widget":
      case "agent_trade":
        return "complex";
      default:
        return "normal";
    }
  }

  /**
   * Extract suggested actions from LLM response text
   */
  private extractActions(intentType: IntentType, text: string): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    // Look for action markers in the text
    const actionPatterns = [
      /\[([\u0600-\u06FF\s]+)\]/g,         // [Action] in Arabic
      /\{([\u0600-\u06FF\s]+)\}/g,         // {Action} in Arabic
      /(\d+)\.\s+([\u0600-\u06FF\s]+)/g,  // 1. Action
    ];

    for (const pattern of actionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        actions.push({
          label: match[1] || match[2] || match[0],
          action: `extracted_${actions.length}`,
        });
      }
    }

    // If no actions found in text, use default actions for intent
    if (actions.length === 0) {
      return INTENT_ACTIONS[intentType] || INTENT_ACTIONS.general_chat;
    }

    return actions;
  }

  private getDialectName(dialect: ArabicDialect): string {
    const names: Record<string, string> = {
      gulf: "الخليجية 🇰🇼🇸🇦🇦🇪",
      levantine: "الشامية 🇯🇴🇱🇧🇸🇾",
      egyptian: "المصرية 🇪🇬",
      maghrebi: "المغربية 🇲🇦🇹🇳🇩🇿",
      msa: "الفصحى",
      unknown: "العربية",
    };
    return names[dialect] || names.unknown;
  }

  private getMarketName(code: string): string {
    const names: Record<string, string> = {
      KW: "الكويت 🇰🇼",
      SA: "السعودية 🇸🇦",
      AE: "الإمارات 🇦🇪",
      QA: "قطر 🇶🇦",
      BH: "البحرين 🇧🇭",
      OM: "عمان 🇴🇲",
      JO: "الأردن 🇯🇴",
      LB: "لبنان 🇱🇧",
      EG: "مصر 🇪🇬",
      IQ: "العراق 🇮🇶",
      MA: "المغرب 🇲🇦",
      TN: "تونس 🇹🇳",
      DZ: "الجزائر 🇩🇿",
      SD: "السودان 🇸🇩",
      PS: "فلسطين 🇵🇸",
    };
    return names[code] || code;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let generatorInstance: ResponseGenerator | null = null;

export function getResponseGenerator(): ResponseGenerator {
  if (!generatorInstance) {
    generatorInstance = new ResponseGenerator();
  }
  return generatorInstance;
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export async function generateResponse(
  intent: ParsedIntent,
  context: ConversationContext,
  dbData: unknown,
  agentResults?: unknown[]
): Promise<GeneratedResponse> {
  return getResponseGenerator().generate(intent, context, dbData, agentResults);
}

export async function generateTemplateResponse(
  intentType: IntentType,
  context: ConversationContext
): Promise<GeneratedResponse> {
  return getResponseGenerator().generateFromTemplate(intentType, context);
}

export function generateQuickResponse(
  intentType: IntentType,
  dialect?: ArabicDialect
): GeneratedResponse {
  return getResponseGenerator().generateQuick(intentType, dialect);
}

// ============================================
// AGENT-SPECIFIC RESPONSE BUILDERS
// ============================================

/**
 * Generate a response for a specific agent type
 */
export async function generateAgentResponse(
  agentType: AgentType,
  context: ConversationContext,
  data: unknown
): Promise<GeneratedResponse> {
  const prompt = `أنت وكيل متخصص: ${agentType} لمنصة جاسم.

المستخدم: ${context.history[context.history.length - 1]?.content || "..."}
البيانات: ${JSON.stringify(data)}

اكتب رداً مختصراً ومهنياً باللهجة الخليجية.`;

  try {
    const llmResponse = await getLLMRouter().route({
      complexity: "normal",
      prompt,
      temperature: 0.6,
      maxTokens: 200,
    });

    return {
      text: llmResponse.text.trim(),
      suggestedActions: INTENT_ACTIONS[context.intent?.type] || [],
      confidence: llmResponse.confidence,
      metadata: {
        model: llmResponse.model,
        tokensUsed: llmResponse.tokensUsed,
        cost: llmResponse.cost,
        latency: llmResponse.latency,
        usedTemplate: false,
      },
    };
  } catch {
    return generateQuickResponse(context.intent?.type || "general_chat");
  }
}
