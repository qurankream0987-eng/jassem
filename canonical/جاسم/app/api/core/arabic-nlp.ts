/**
 * Arabic NLP Pipeline - Advanced Arabic language understanding for JASIM
 * Features: LLM-assisted intent parsing, entity extraction, dialect detection,
 * transliteration handling, dialect-aware response generation
 */

import { z } from "zod";
import type {
  ParsedIntent,
  IntentType,
  AgentType,
  ExtractedEntity,
  ConversationContext,
  ArabicDialect,
} from "./types";
import { ParsedIntentSchema } from "./types";
import { getLLMRouter } from "./llm-router";
import {
  analyzeLanguage,
  detectDialect,
  normalizeArabic,
} from "./language-processor";

// ============================================
// ZOD SCHEMAS
// ============================================

export const EntitySchema = z.object({
  type: z.enum([
    "product", "location", "quantity", "price", "time",
    "person", "phone", "category", "brand", "intent_modifier",
  ]),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  position: z.tuple([z.number(), z.number()]),
  normalized: z.string().optional(),
});

export const IntentAnalysisResultSchema = z.object({
  intent: z.string(),
  confidence: z.number().min(0).max(1),
  entities: z.array(
    z.object({
      type: z.string(),
      value: z.string(),
      confidence: z.number(),
    })
  ),
  dialect: z.string(),
  language: z.enum(["ar", "en", "mixed"]),
  isTransliterated: z.boolean(),
  suggestedResponses: z.array(z.string()),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type Entity = z.infer<typeof EntitySchema>;
export type IntentAnalysisResult = z.infer<typeof IntentAnalysisResultSchema>;

// ============================================
// INTENT → AGENT MAPPING
// ============================================

const INTENT_AGENT_MAP: Record<string, AgentType> = {
  food_order: "food",
  product_search: "fashion",
  order_tracking: "delivery",
  payment: "financial",
  b2b_inquiry: "b2b_supplier",
  haggle_request: "haggle",
  delivery_tracking: "fleet",
  cv_generation: "recruitment",
  job_search: "recruitment",
  job_apply: "recruitment",
  connect_pos: "smart_connect",
  deploy_saas: "gen_saas",
  create_platform: "gen_aggregator",
  embed_widget: "widget",
  agent_trade: "a2a",
  zakat_calc: "financial",
  general_chat: "mentor",
  greeting: "mentor",
  help: "mentor",
};

// ============================================
// TRANSLITERATION MAP (Romanized Arabic → Arabic)
// ============================================

const TRANSLITERATION_MAP: Record<string, string> = {
  // Common Gulf/Levantine transliterations
  abgai: "أبغى",
  abgi: "أبغي",
  abi: "أبي",
  abee: "أبي",
  abgha: "أبغى",
  akol: "آكل",
  akl: "أكل",
  akel: "أكل",
  joo3an: "جوعان",
  jooaan: "جوعان",
  jo3an: "جوعان",
  ga3an: "جعان",
  ga3aan: "جعان",
  mat3am: "مطعم",
  matjam: "مطعم",
  resturant: "مطعم",
  kabseh: "كبسة",
  kabsa: "كبسة",
  baryani: "برياني",
  briyani: "برياني",
  shawarma: "شاورما",
  shawrma: "شاورما",
  burger: "برجر",
  berger: "برجر",
  pizza: "بيتزا",
  mandi: "مندي",
  mendi: "مندي",
  salam: "سلام",
  halla: "هلا",
  hala: "هلا",
  ahlan: "أهلاً",
  marhaba: "مرحبا",
  shlonak: "شلونك",
  shlonik: "شلونك",
  shlonk: "شلونك",
  shakhbarak: "شخبارك",
  shakhbarek: "شخبارك",
  esh: "ايش",
  wsh: "وش",
  wash: "وش",
  shino: "شنو",
  shinno: "شنو",
  kam: "كم",
  bkam: "بكم",
  bkame: "بكام",
  wagid: "واجد",
  wayed: "وايد",
  katheer: "كثير",
  zain: "زين",
  zein: "زين",
  helu: "حلو",
  hilu: "حلو",
  tamam: "تمام",
  mashi: "ماشي",
  mashi7al: "ماشي الحال",
  ma3lish: "معليش",
  maaleesh: "معليش",
  yalla: "يلا",
  yallah: "يالله",
  inshallah: "إن شاء الله",
  mashallah: "ما شاء الله",
  alhamdulillah: "الحمد لله",
  wallah: "والله",
  wallahi: "واللهي",
  habibi: "حبيبي",
  habibti: "حبيبتي",
  shukran: "شكراً",
  mashkoor: "مشكور",
  afwan: "عفواً",
  minfudlik: "من فضلك",
  lawsamahht: "لو سمحت",
  bas: "بس",
  khalas: "خلاص",
  khalass: "خلاص",
  maafi: "مافي",
  maaku: "ماكو",
  mafi: "مافي",
  fee: "في",
  wain: "وين",
  wen: "وين",
  wayn: "وين",
  hatha: "هذا",
  hathe: "هذي",
  thak: "ذاك",
  // Egyptian
  aywa: "أيوه",
  aywa2: "ايوه",
  msh: "مش",
  mesh: "مش",
  "3ayez": "عايز",
  "3ayz": "عايز",
  "3aiz": "عايز",
  ayez: "عايز",
  biddi: "بدي",
  bidi: "بدي",
  kteeer: "كتير",
  gamd: "جامد",
  tamamgd: "تمام جداً",
  salamo3likom: "السلام عليكم",
  salamualikum: "السلام عليكم",
};

// ============================================
// ARABIC NLP CLASS
// ============================================

export class ArabicNLP {
  private llmRouter = getLLMRouter();
  private transliterationCache = new Map<string, string>();

  /**
   * Parse user message with LLM assistance
   * Uses Gemini Flash (Tier 2) for fast Arabic understanding
   */
  async parseWithLLM(
    message: string,
    context: ConversationContext
  ): Promise<ParsedIntent> {
    try {
      // Step 1: Language analysis (local, fast)
      const langAnalysis = analyzeLanguage(message);

      // Step 2: Handle transliteration if needed
      let processedMessage = message;
      let isTransliterated = langAnalysis.isTransliterated;

      if (isTransliterated) {
        processedMessage = await this.detransliterate(message);
        isTransliterated = false; // Now it's proper Arabic
      }

      // Step 3: Detect dialect (local)
      const dialectResult = detectDialect(processedMessage);
      const dialect = dialectResult.dialect;

      // Step 4: Build and send LLM intent prompt
      const prompt = this.buildIntentPrompt(processedMessage, context, dialect);

      const llmResponse = await this.llmRouter.route({
        complexity: "normal",
        prompt,
        temperature: 0.3,
        maxTokens: 800,
        responseFormat: "json",
      });

      // Step 5: Parse LLM response
      const parsed = this.parseLLMResponse(llmResponse.text, context);

      // Step 6: Extract entities (combine LLM + regex)
      const entities = await this.extractEntities(processedMessage);
      const entityRecord = this.entitiesToRecord(entities);

      // Merge LLM entities with regex entities
      for (const e of parsed.entities) {
        if (!entityRecord[e.type]) {
          entityRecord[e.type] = e.value;
        }
      }

      // Step 7: Build final ParsedIntent
      const intentType = this.validateIntent(parsed.intent);
      const agent: AgentType = INTENT_AGENT_MAP[parsed.intent] || "mentor";

      const result = ParsedIntentSchema.safeParse({
        type: intentType,
        confidence: parsed.confidence,
        entities: entityRecord,
        marketCode: context.marketCode || "KW",
        dialect,
        requiresAgent: agent,
        suggestedBubbles: [], // Populated by bubble generator
      });

      if (!result.success) {
        // Fallback to keyword-based parsing
        return this.fallbackParse(processedMessage, context, dialect);
      }

      return result.data;
    } catch (err) {
      // LLM failed - fallback to local keyword parsing
      const dialectResult = detectDialect(message);
      return this.fallbackParse(message, context, dialectResult.dialect);
    }
  }

  /**
   * Extract entities from message: products, locations, quantities, prices
   */
  async extractEntities(message: string): Promise<ExtractedEntity[]> {
    const entities: ExtractedEntity[] = [];
    const normalized = message.toLowerCase();

    // Price extraction: "5 دنانير", "10 ريال", "2.5 KWD"
    const priceRegex =
      /(\d+(?:\.\d{1,2})?)\s*(دينار|ريال|درهم|جنيه|ليرة|دنانير|KWD|SAR|AED|QAR|BHD|OMR|JOD|EGP|MAD)/gi;
    let match: RegExpExecArray | null;
    while ((match = priceRegex.exec(normalized)) !== null) {
      entities.push({
        type: "price",
        value: match[0],
        confidence: 0.95,
        position: [match.index, match.index + match[0].length],
        normalized: `${match[1]} ${match[2]}`,
      });
    }

    // Quantity extraction: "2 كيلو", "5 قطع", "1 لتر"
    const qtyRegex =
      /(\d+(?:\.\d{1,2})?)\s*(كيلو|جرام|قطعة|قطع|صحن|طبق|كوب|لتر|حبة|شخص|شخاص|كيلوغرام|g\b|kg\b)/gi;
    while ((match = qtyRegex.exec(normalized)) !== null) {
      entities.push({
        type: "quantity",
        value: match[0],
        confidence: 0.92,
        position: [match.index, match.index + match[0].length],
        normalized: `${match[1]} ${match[2]}`,
      });
    }

    // Phone extraction
    const phoneRegex =
      /(\+?965|\+?966|\+?971|\+?974|\+?973|\+?968|\+?962|\+?20|\+?212)?[\s\-]?\d{8,10}/g;
    while ((match = phoneRegex.exec(normalized)) !== null) {
      entities.push({
        type: "phone",
        value: match[0],
        confidence: 0.9,
        position: [match.index, match.index + match[0].length],
        normalized: match[0].replace(/\D/g, ""),
      });
    }

    // Location extraction - Gulf cities
    const locationMap: Record<string, string> = {
      الكويت: "KW", الرياض: "SA", جدة: "SA", الدمام: "SA",
      دبي: "AE", أبوظبي: "AE", الشارقة: "AE",
      الدوحة: "QA", "المنامة": "BH", مسقط: "OM",
      عمان: "JO", بيروت: "LB", القاهرة: "EG",
      "الدار البيضاء": "MA", تونس: "TN", "الجزائر": "DZ",
    };

    for (const [city, code] of Object.entries(locationMap)) {
      const idx = normalized.indexOf(city);
      if (idx !== -1) {
        entities.push({
          type: "location",
          value: city,
          confidence: 0.95,
          position: [idx, idx + city.length],
          normalized: code,
        });
      }
    }

    // Product category extraction
    const categoryKeywords: Record<string, string> = {
      برياني: "food", كبسة: "food", شاورما: "food", مندي: "food",
      برجر: "food", بيتزا: "food", فطور: "food", عشا: "food", غدا: "food",
      ملابس: "fashion", قميص: "fashion", بنطلون: "fashion", فستان: "fashion",
      هاتف: "electronics", موبايل: "electronics", لابتوب: "electronics",
      دواء: "pharmacy", علاج: "pharmacy",
    };

    for (const [keyword, category] of Object.entries(categoryKeywords)) {
      const idx = normalized.indexOf(keyword);
      if (idx !== -1) {
        entities.push({
          type: "category",
          value: keyword,
          confidence: 0.88,
          position: [idx, idx + keyword.length],
          normalized: category,
        });
      }
    }

    // Time extraction: "الساعة 5", "بكرة", "اليوم", "بعد ساعة"
    const timeKeywords = [
      { pattern: /\d{1,2}:\d{2}/g, type: "time" as const },
      { pattern: /الساعة\s+\d{1,2}/g, type: "time" as const },
    ];
    for (const { pattern, type } of timeKeywords) {
      while ((match = pattern.exec(normalized)) !== null) {
        entities.push({
          type,
          value: match[0],
          confidence: 0.9,
          position: [match.index, match.index + match[0].length],
        });
      }
    }

    // Person name detection (simple heuristic: after "أنا" or "اسمي")
    const nameRegex = /(?:أنا|اسمي|المستخدم)\s+([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?)/;
    const nameMatch = normalized.match(nameRegex);
    if (nameMatch) {
      entities.push({
        type: "person",
        value: nameMatch[1],
        confidence: 0.75,
        position: [nameMatch.index!, nameMatch.index! + nameMatch[0].length],
        normalized: nameMatch[1],
      });
    }

    return entities.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Detect Arabic dialect: Gulf, Levantine, Egyptian, Maghrebi, or MSA
   */
  async detectDialect(message: string): Promise<ArabicDialect> {
    // Use the local dialect detector first (fast, free)
    const localResult = detectDialect(message);
    if (localResult.dialect !== "unknown") {
      return localResult.dialect;
    }

    // If local detection is uncertain, use LLM
    try {
      const prompt = `
حدد اللهجة العربية في النص التالي. اختر واحدة فقط: [gulf, levantine, egyptian, maghrebi, msa]

النص: "${message}"

أعد الإجابة ككلمة واحدة فقط بدون أي شرح.`;

      const response = await this.llmRouter.route({
        complexity: "simple",
        prompt,
        temperature: 0.1,
        maxTokens: 20,
      });

      const detected = response.text.trim().toLowerCase();
      if (["gulf", "levantine", "egyptian", "maghrebi", "msa"].includes(detected)) {
        return detected as ArabicDialect;
      }
    } catch {
      // LLM failed, return unknown
    }

    return "unknown";
  }

  /**
   * Handle transliterated Arabic ("abgai kabseh" → "أبغى كبسة")
   */
  async detransliterate(text: string): Promise<string> {
    // Check cache first
    const cached = this.transliterationCache.get(text);
    if (cached) return cached;

    const words = text.toLowerCase().split(/\s+/);
    const result: string[] = [];

    for (const word of words) {
      // Check direct mapping
      let arabic = TRANSLITERATION_MAP[word];

      // If no direct mapping, try number-based replacements (Arabizi)
      if (!arabic) {
        arabic = this.arabiziToArabic(word);
      }

      // If still not found, keep original word
      result.push(arabic || word);
    }

    const detransliterated = result.join(" ");
    this.transliterationCache.set(text, detransliterated);
    return detransliterated;
  }

  /**
   * Generate Arabic response in user's dialect using LLM
   */
  async generateResponse(
    intent: IntentType,
    context: ConversationContext,
    data: unknown
  ): Promise<string> {
    const prompt = this.buildResponsePrompt(intent, context, data);

    const complexity = this.selectResponseComplexity(intent);
    const response = await this.llmRouter.route({
      complexity,
      prompt,
      temperature: 0.7,
      maxTokens: 300, // Keep responses short for chat bubbles
    });

    return response.text;
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Build the intent detection prompt for the LLM
   */
  private buildIntentPrompt(
    message: string,
    context: ConversationContext,
    dialect: string
  ): string {
    return `أنت محلل نوايا ذكي لمنصة تجارة عربية اسمها "جاسم".
حلل الرسالة التالية وحدد:
1. نوع النية (food_order, product_search, order_tracking, payment, b2b_inquiry, haggle_request, delivery_tracking, cv_generation, job_search, job_apply, connect_pos, deploy_saas, create_platform, embed_widget, agent_trade, zakat_calc, general_chat, greeting, help)
2. الكيانات (منتجات، أماكن، أسعار، كميات)
3. اللهجة العربية
4. درجة الثقة

أعد النتيجة كـ JSON فقط بدون أي شرح إضافي:
{
  "intent": "...",
  "confidence": 0.0-1.0,
  "entities": [{"type": "...", "value": "...", "confidence": 0.0-1.0}],
  "dialect": "...",
  "language": "ar|en|mixed",
  "isTransliterated": true|false,
  "suggestedResponses": ["..."]
}

الرسالة: "${message}"
اللهجة المكتشفة: ${dialect}
السياق: ${JSON.stringify({
      marketCode: context.marketCode,
      lastIntent: context.intent?.type,
      userState: context.userState,
    })}`;
  }

  /**
   * Parse LLM JSON response into structured result
   */
  private parseLLMResponse(text: string, _context: ConversationContext): IntentAnalysisResult {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = text.trim();
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.replace(/```json\n?/, "").replace(/```\s*$/, "");
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```\n?/, "").replace(/```\s*$/, "");
      }

      const parsed = JSON.parse(jsonStr);

      return IntentAnalysisResultSchema.parse({
        intent: parsed.intent || "general_chat",
        confidence: parsed.confidence || 0.5,
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        dialect: parsed.dialect || "gulf",
        language: parsed.language || "ar",
        isTransliterated: parsed.isTransliterated || false,
        suggestedResponses: Array.isArray(parsed.suggestedResponses)
          ? parsed.suggestedResponses
          : [],
      });
    } catch {
      // JSON parsing failed - return generic result
      return {
        intent: "general_chat",
        confidence: 0.3,
        entities: [],
        dialect: "gulf",
        language: "ar",
        isTransliterated: false,
        suggestedResponses: ["مرحباً! كيف يمكنني مساعدتك اليوم؟"],
      };
    }
  }

  /**
   * Build context-aware response prompt
   */
  private buildResponsePrompt(
    intent: IntentType,
    context: ConversationContext,
    data: unknown
  ): string {
    const dialectName = this.getDialectDisplayName(context.preferences?.dialect as string || "gulf");
    const marketName = this.getMarketDisplayName(context.marketCode);

    return `أنت "جاسم" — وكيل ذكي توليدي لتجارة العرب.

التعليمات:
- تتحدث باللهجة ${dialectName}
- السوق: ${marketName} (${context.marketCode})
- الحالة: ${context.userState}
- نية المستخدم: ${intent}

البيانات المتوفرة:
${JSON.stringify(data, null, 2)}

المستخدم قال: "${context.history[context.history.length - 1]?.content || "..."}"

اكتب رداً طبيعياً وودوداً بالعربية. اقترح إجراءات واضحة.
- الرد يجب أن يكون ≤ 200 كلمة
- استخدم الرموز التعبيرية المناسبة
- اجعل الرد مفيداً وعملياً
- تحدث باللهجة المناسبة للمستخدم`;
  }

  /**
   * Fallback parsing when LLM is unavailable
   */
  private fallbackParse(
    message: string,
    context: ConversationContext,
    dialect: string
  ): ParsedIntent {
    // Use keyword-based intent detection from intent-parser
    const { parseIntent } = require("./intent-parser");
    return parseIntent(message, context);
  }

  /**
   * Convert entities array to record format
   */
  private entitiesToRecord(entities: ExtractedEntity[]): Record<string, string> {
    const record: Record<string, string> = {};
    for (const e of entities) {
      record[e.type] = e.value;
    }
    return record;
  }

  /**
   * Validate intent string against known intents
   */
  private validateIntent(intent: string): IntentType {
    const validIntents: IntentType[] = [
      "food_order", "product_search", "order_tracking", "payment",
      "b2b_inquiry", "haggle_request", "delivery_tracking",
      "cv_generation", "job_search", "job_apply",
      "connect_pos", "deploy_saas", "create_platform",
      "embed_widget", "agent_trade", "zakat_calc",
      "general_chat", "greeting", "help",
    ];
    return validIntents.includes(intent as IntentType)
      ? (intent as IntentType)
      : "general_chat";
  }

  /**
   * Select response complexity based on intent
   */
  private selectResponseComplexity(intent: IntentType): "simple" | "normal" | "complex" | "premium" {
    switch (intent) {
      case "greeting":
      case "general_chat":
      case "help":
        return "simple";
      case "food_order":
      case "product_search":
      case "order_tracking":
        return "normal";
      case "haggle_request":
      case "b2b_inquiry":
      case "zakat_calc":
      case "payment":
        return "complex";
      default:
        return "normal";
    }
  }

  /**
   * Convert Arabizi numbers to Arabic letters
   * e.g., "3ayez" → "عايز", "a7la" → "أحلى"
   */
  private arabiziToArabic(word: string): string {
    const numberMap: Record<string, string> = {
      "3": "ع",
      "5": "خ",
      "6": "ط",
      "7": "ح",
      "8": "ق",
      "9": "ص",
      "2": "ء",
      "4": "ذ",
    };

    let result = "";
    for (const char of word) {
      result += numberMap[char] || char;
    }
    // Try to look up the transformed word
    return TRANSLITERATION_MAP[result] || "";
  }

  private getDialectDisplayName(dialect: string): string {
    const names: Record<string, string> = {
      gulf: "الخليجية",
      levantine: "الشامية",
      egyptian: "المصرية",
      maghrebi: "المغربية",
      msa: "الفصحى",
      unknown: "العربية",
    };
    return names[dialect] || names.unknown;
  }

  private getMarketDisplayName(code: string): string {
    const names: Record<string, string> = {
      KW: "الكويت",
      SA: "السعودية",
      AE: "الإمارات",
      QA: "قطر",
      BH: "البحرين",
      OM: "عمان",
      JO: "الأردن",
      LB: "لبنان",
      EG: "مصر",
      IQ: "العراق",
      MA: "المغرب",
      TN: "تونس",
      DZ: "الجزائر",
      SD: "السودان",
      PS: "فلسطين",
    };
    return names[code] || code;
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let nlpInstance: ArabicNLP | null = null;

export function getArabicNLP(): ArabicNLP {
  if (!nlpInstance) {
    nlpInstance = new ArabicNLP();
  }
  return nlpInstance;
}

// ============================================
// CONVENIENCE EXPORTS
// ============================================

export async function parseIntentWithLLM(
  message: string,
  context: ConversationContext
): Promise<ParsedIntent> {
  return getArabicNLP().parseWithLLM(message, context);
}

export async function extractEntities(message: string): Promise<ExtractedEntity[]> {
  return getArabicNLP().extractEntities(message);
}

export async function detectArabicDialect(message: string): Promise<ArabicDialect> {
  return getArabicNLP().detectDialect(message);
}

export async function detransliterateArabic(text: string): Promise<string> {
  return getArabicNLP().detransliterate(text);
}

export async function generateArabicResponse(
  intent: IntentType,
  context: ConversationContext,
  data: unknown
): Promise<string> {
  return getArabicNLP().generateResponse(intent, context, data);
}
