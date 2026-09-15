/**
 * Intent Parser - JASIM's NLP Brain
 * Understands Arabic user queries across 19 intent categories
 * Supports dialect detection, entity extraction, and bubble suggestions
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import type {
  IntentType,
  AgentType,
  ParsedIntent,
  BubbleType,
  BubbleTheme,
  ConversationContext,
} from "./types";
import { IntentTypeSchema, ParsedIntentSchema } from "./types";
import {
  analyzeLanguage,
  detectDialect,
  normalizeArabic,
  transliterate,
} from "./language-processor";

// ============================================
// ARABIC KEYWORD DICTIONARIES
// ============================================

interface KeywordEntry {
  keywords: string[];
  agent: AgentType;
  confidence: number;
}

const INTENT_KEYWORDS: Record<IntentType, KeywordEntry> = {
  food_order: {
    keywords: [
      "أطلب", "اطلب", "أبي آكل", "ابغى آكل", "جوعان", "جعان",
      "طلبية", "طلب", "أكل", "عشا", "غدا", "فطور",
      "مطعم", "برياني", "كبسة", "شاورما", "برجر", "بيتزا",
      "مندي", "حنذي", "جريش", "مرقوق", "مقالي", "سمك",
      "atlob", "akol", "joo3an", "ga3an", "mat3am",
      "order food", "hungry", "restaurant", "menu",
      "طلب أكل", "أبي أطلب", "ابغى أطلب", "بدي اطلب",
      "عايز اطلب", "بغيت نطلب", "واش ناكل",
      "delivery", "توصيل أكل", "توصيل طعام",
    ],
    agent: "food",
    confidence: 0.95,
  },
  product_search: {
    keywords: [
      "ابحث", "أبحث", "دور على", "وين القى", "وين ألقى",
      "منتج", "سلعة", "بضاعة", "شنو عندكم", "وش عندكم",
      "عندكم", "تبيعون", "للبيع", "متجر", "محل",
      "ab9ath", "door", "product", "search",
      "price", "سعر", "بكم", "بكام", "كم سعر",
      "find", "looking for", "where can i find",
      "أبي", "ابغى", "بدي", "عايز", "بغيت",
      "ابي منتج", "ابغى منتج", "ابي اشتري", "ابغى اشتري",
    ],
    agent: "fashion",
    confidence: 0.85,
  },
  order_tracking: {
    keywords: [
      "وين طلبي", "وين طلبية", "وين الاوردر", "تتبع",
      "order status", "tracking", "where is my order",
      "track", "shipment", "توصيل", "طلبيتي",
      "وين وصل", "وصل", "موصلش", "متى يوصل",
      "waen talabi", "tracking number", "رقم الطلب",
      "حالة الطلب", "اوردر", "وين وصل طلبي",
      "kied", "track order", "follow my order",
      "وين", "فين", "وينه", "وينها",
    ],
    agent: "delivery",
    confidence: 0.92,
  },
  payment: {
    keywords: [
      "دفع", "فلوس", "كاش", "كرت", "بطاقة", "فيزا",
      "payment", "pay", "visa", "card", "credit",
      "knet", "apple pay", "google pay", "مدى",
      "ادفع", "أبي ادفع", "ابغى ادفع", "كيف ادفع",
      "سداد", "فاتورة", "receipt", "invoice",
      "refund", "ارجاع فلوس", "استرجاع", "transakcja",
      "balance", "رصيد", "محفظة", "wallet",
      "ادفع", "أدفع", "ابغى ادفع", "ابي ادفع",
      " installments", "تقسيط", "أقساط",
    ],
    agent: "financial",
    confidence: 0.9,
  },
  b2b_inquiry: {
    keywords: [
      "مورد", "توريد", "بالجملة", "جملة", "كمية كبيرة",
      "b2b", "supplier", "wholesale", "bulk", "vendor",
      "تصدير", "استيراد", "تجارة", "اعمال", "شركة",
      "نحتاج كمية", "عقد توريد", "طلبية جملة",
      "مؤسسة", "تاجر", "موزع", "وكيل", "franchise",
      "شراكة", "تعاون", "عرض سعر", "quotation",
    ],
    agent: "b2b_supplier",
    confidence: 0.88,
  },
  haggle_request: {
    keywords: [
      "فاضي", "تنزل", "تخفيض", "خصم", "عرض", "سوم",
      "غالي", "فلوس كثير", "expensive", "discount",
      "haggle", "negotiate", "offer", " cheaper", "deal",
      "كم آخر", "أقل", "ارخص", "سعر أقل", "نقاش",
      "ممكن تنزل", "تقدر تنزل", "مجال", "في مجال",
      "price match", "best price", "lowest",
      "رخيص", "غالي", "سومة", "باكج",
      "فيه خصم", "فيه عرض", "وين العروض",
    ],
    agent: "haggle",
    confidence: 0.93,
  },
  delivery_tracking: {
    keywords: [
      "سائق", "مندوب", "توصيل", "وصل", "موصل",
      "driver", "delivery guy", "where is the driver",
      "مكان السائق", "وين المندوب", "وين السائق",
      "time", "متى", "كم بيوصل", "expected time",
      "地图", "location", "موقع", "نقطة",
      "map", "route", "طريق", "مسار",
      "ف ast", "بسرعة", "عاجل", "urgent",
    ],
    agent: "fleet",
    confidence: 0.9,
  },
  cv_generation: {
    keywords: [
      "cv", "resume", "سيرة ذاتية", "cv builder",
      "أبي سوي cv", "ابغى سيرة ذاتية", "سوي لي cv",
      "generate cv", "create resume", "build cv",
      "مؤهلاتي", "شهادات", "خبرات", "وظيفتي",
      "qualifications", "experience", "skills",
      "محتاج cv", "أحتاج سيرة", "سيرة",
      "my profile", "ملفي", "معلوماتي",
      "عندي خبرة", "شتغلت", "وظائف سابقة",
    ],
    agent: "recruitment",
    confidence: 0.92,
  },
  job_search: {
    keywords: [
      "وظيفة", "وظائف", "شغل", "دوام", "دوام كامل",
      "job", "jobs", "career", "employment", "hire",
      "abghى وظيفة", "ابي شغل", "ابغى دوام",
      "open position", "vacancy", "available jobs",
      "engineering", "marketing", "sales", "it",
      "هندسة", "محاسبة", "ادارة", "تسويق", "مبيعات",
      "remote", "about", "عن بعد", "ريموت",
      "تقديم", "apply", "وظائف شاغرة",
    ],
    agent: "recruitment",
    confidence: 0.9,
  },
  job_apply: {
    keywords: [
      "أقدم", "أبغى أقدم", "ابي اقدم", "تقديم",
      "apply", "application", "submit", "cover letter",
      "وظيفة معينة", "هالوظيفة", "هذي الوظيفة",
      "interested in", "مهتم في", "ابغى هذه",
      "this job", "this position", "المحل ده",
      "مرتب", "راتب", "salary", "compensation",
      "أرسل طلب", "سيرتي", "خبرتي", "مؤهلاتي",
    ],
    agent: "recruitment",
    confidence: 0.88,
  },
  connect_pos: {
    keywords: [
      "connect", "integration", "api", "pos", "system",
      "ربط", "توصيل", "نظام", "ربط المحل", "integration",
      "toast", "square", "clover", "shopify", "woocommerce",
      "erp", "accounting", "محاسبة", "برنامج المحل",
      "link", "sync", "synchronize", "مزامنة",
      "old system", "نظام قديم", "transfer data",
      "connect my store", "ربط متجري", "smart connect",
      "toast pos", "square pos", "clover pos",
      "shopify store", "woocommerce store", "magento",
    ],
    agent: "smart_connect",
    confidence: 0.85,
  },
  deploy_saas: {
    keywords: [
      "saas", "deploy", "app builder", "app maker",
      "ابغى سوي تطبيق", "ابي سوي متجر", "برنامج",
      "create app", "build app", "generate platform",
      "no code", "low code", "without coding", "بدون برمجة",
      "موقع", "website", "web app", "متجر الكتروني",
      "gen saas", "platform builder", "app generator",
      "template", "قالب", "نشر", "deploy",
      "تطبيقي", "متجري", "موقعي", "افتح لي متجر",
      "ابغى افتح متجر", "ابي افتح متجر", "سوي لي متجر",
    ],
    agent: "gen_saas",
    confidence: 0.87,
  },
  create_platform: {
    keywords: [
      "marketplace", "multi vendor", "aggregator", "platform",
      "متعدد البائعين", "بائعين", "منصة", "سوق",
      "uber model", "amazon model", "like talabat",
      "create platform", "build marketplace", "بناء منصة",
      "vendors", "sellers", "بائع", "تاجر", "تجار",
      "commission", "عمولة", "نسبة", "revenue share",
      "marché", "merchant platform", "vendor portal",
      "بنية تحتية", "infrastructure", "نظام بائعين",
      "ابغى سوي منصة", "ابي سوق", "افتح سوق",
      "مثل طلبات", "مثل أمازون", "مثل أوبر",
    ],
    agent: "gen_aggregator",
    confidence: 0.86,
  },
  embed_widget: {
    keywords: [
      "widget", "embed", "plugin", "chat widget",
      "تضمين", "إضافة", "ودجت", "شات", "محادثة",
      "my website", "موقعي", "الموقع", "مدونتي",
      "html", "javascript", "code snippet", "iframe",
      "wordpress", "wix", "shopify embed", "react",
      "book button", "زر الحجز", "chat bubble", "فقاعة",
      "booking widget", "product widget", "lead form",
      "احط ف موقعي", "اضيف لموقعي", "اركب على موقعي",
    ],
    agent: "widget",
    confidence: 0.88,
  },
  agent_trade: {
    keywords: [
      "a2a", "agent trade", "sell agent", "buy agent",
      "تداول وكلاء", "بيع وكيل", "شراء وكيل",
      "trade ai", "agent marketplace", "ai commerce",
      "الوكلاء", "وكلاء", "تجارة وكلاء", "تبادل",
      "digital agent", "ai agent", "trading",
      "swap", "exchange", "barter", "مقايضة",
      "agent listing", "train model", "custom ai",
      "nlp model", "fine tune", "fine-tune",
    ],
    agent: "a2a",
    confidence: 0.82,
  },
  zakat_calc: {
    keywords: [
      "zakat", "زكاة", "زكاة", "nisab", "نصاب",
      "calculate zakat", "حساب زكاة", "زكاة المال",
      "zakat mal", "zakat fitr", "زكاة الفطر",
      "gold", "silver", "ذهب", "فضة", "gram", "جرام",
      "islamic", "sharia", "شرعي", "حلال", "islamic finance",
      "charity", "sadaqa", "صدقة", "خير", "donation",
      "owed", "due", "مستحقة", "فرض", " obligation",
      "ابغى احسب زكاتي", "ابي احسب زكاة", "كم زكاتي",
      "zakat calculator", "zakat tool", "حاسبة زكاة",
    ],
    agent: "financial",
    confidence: 0.94,
  },
  general_chat: {
    keywords: [
      "مرحبا", "هلا", "شلونك", "كيفك", "عساك",
      "hello", "hi", "hey", "how are you",
      "شخبارك", "اخبارك", "كيف الحال", "كيف الأمور",
      "شنو تسوي", "وش تسوي", "وش عندك",
      "what's up", "how's it going", "كيف الأمور",
      "good morning", "good evening", "صباح", "مساء",
      "thanks", "thank you", "شكرا", "مشكور",
      "ok", "okay", "تمام", "ماشي", "طيب",
    ],
    agent: "mentor",
    confidence: 0.6,
  },
  greeting: {
    keywords: [
      "صباح الخير", "مساء الخير", "هلا والله",
      "good morning", "good evening", "good afternoon",
      "أهلاً", "أهلا", "مرحباً", "مرحبا", "سلام",
      "hi there", "greetings", "welcome",
      "تشرفنا", "يشرفني", "nice to meet",
      "back again", "رجعت", "زرتكم", "أول مرة",
      "first time", "new user", "مستخدم جديد",
    ],
    agent: "mentor",
    confidence: 0.75,
  },
  help: {
    keywords: [
      "مساعدة", "help", "support", "مساعدة",
      "كيف استخدم", "كيف يشتغل", "شرح", "explanation",
      "مش فاهم", "ما فهمت", "مو عارف", "معرفش",
      "don't understand", "confused", "lost", "تائه",
      "ابغى مساعدة", "ابي مساعدة", "ساعدني", "ساعدوني",
      "how to", "how do i", "كيف اقدر", "كيف أسوي",
      "tutorial", "demo", "show me", "اريني", "شوفني",
      "اتصل", "contact", "customer service", "خدمة عملاء",
      "report", "شكوى", "complaint", "مشكلة", "problem",
    ],
    agent: "mentor",
    confidence: 0.8,
  },
};

// ============================================
// ENTITY EXTRACTION PATTERNS
// ============================================

const ENTITY_PATTERNS = {
  price: {
    regex: /(\d+(?:\.\d{1,2})?)\s*(دينار|ريال|درهم|جنيه|ليرة|dinar|riyal|dirham|pound)\b/,
    extract: (match: RegExpMatchArray) => ({
      type: "price" as const,
      value: match[0],
      normalized: `${match[1]} ${match[2]}`,
    }),
  },
  quantity: {
    regex: /(\d+)\s*(كيلو|جرام|قطعة|صحن|طبق|كوب|لتر|piece|kg|g| serving)\b/,
    extract: (match: RegExpMatchArray) => ({
      type: "quantity" as const,
      value: match[0],
      normalized: `${match[1]} ${match[2]}`,
    }),
  },
  phone: {
    regex: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    extract: (match: RegExpMatchArray) => ({
      type: "phone" as const,
      value: match[0],
      normalized: match[0].replace(/\D/g, ""),
    }),
  },
  location: {
    regex: /(ال科威ت|السعودية|الإمارات|قطر|البحرين|عمان|الأردن|لبنان|مصر|المغرب|تونس|الجزائر|العراق|السودان|فلسطين|ال科威ت|الرياض|جدة|دبي|أبوظبي|الدوحة|المنامة|مسقط|عمان|القاهرة|الدار البيضاء|تونس|بيروت|عمان|بغداد|الخرطوم)/,
    extract: (match: RegExpMatchArray) => ({
      type: "location" as const,
      value: match[1],
      normalized: match[1],
    }),
  },
};

// ============================================
// BUBBLE GENERATORS
// ============================================

function generateBubblesForIntent(
  intent: IntentType,
  entities: Record<string, string>,
  dialect: string
): BubbleType[] {
  const bubbles: BubbleType[] = [];

  switch (intent) {
    case "food_order":
      bubbles.push(
        {
          type: "restaurant_search",
          theme: "food" as BubbleTheme,
          data: { cuisine: entities.cuisine || "all", dialect },
          priority: 90,
        },
        {
          type: "quick_actions",
          theme: "default" as BubbleTheme,
          data: { actions: ["popular", "nearby", "offers", "favorites"] },
          priority: 80,
        }
      );
      break;

    case "product_search":
      bubbles.push(
        {
          type: "product_grid",
          theme: "fashion" as BubbleTheme,
          data: { query: entities.product || "", category: entities.category || "all" },
          priority: 90,
        },
        {
          type: "filter_bar",
          theme: "default" as BubbleTheme,
          data: { filters: ["price", "rating", "newest", "popular"] },
          priority: 70,
        }
      );
      break;

    case "order_tracking":
      bubbles.push(
        {
          type: "order_map",
          theme: "map" as BubbleTheme,
          data: { orderId: entities.orderId || "", showRoute: true },
          priority: 95,
        },
        {
          type: "order_status",
          theme: "order" as BubbleTheme,
          data: { status: "in_transit", estimatedArrival: "30 min" },
          priority: 85,
        }
      );
      break;

    case "payment":
      bubbles.push(
        {
          type: "payment_methods",
          theme: "payment" as BubbleTheme,
          data: { methods: ["knet", "apple_pay", "google_pay", "cash"], amount: entities.amount || "0" },
          priority: 90,
        },
        {
          type: "secure_badge",
          theme: "success" as BubbleTheme,
          data: { encrypted: true, escrow: true },
          priority: 60,
        }
      );
      break;

    case "haggle_request":
      bubbles.push(
        {
          type: "haggle_interface",
          theme: "haggle" as BubbleTheme,
          data: { productId: entities.productId || "", currentPrice: entities.price || "0" },
          priority: 95,
        },
        {
          type: "price_history",
          theme: "chart" as BubbleTheme,
          data: { showTrend: true },
          priority: 70,
        }
      );
      break;

    case "cv_generation":
      bubbles.push(
        {
          type: "cv_builder",
          theme: "cv" as BubbleTheme,
          data: { step: "personal_info", template: "modern" },
          priority: 95,
        },
        {
          type: "cv_templates",
          theme: "default" as BubbleTheme,
          data: { templates: ["modern", "classic", "creative", "executive"] },
          priority: 75,
        }
      );
      break;

    case "job_search":
      bubbles.push(
        {
          type: "job_list",
          theme: "job" as BubbleTheme,
          data: { keyword: entities.skill || "", location: entities.location || "all" },
          priority: 90,
        },
        {
          type: "salary_insights",
          theme: "chart" as BubbleTheme,
          data: { role: entities.role || "software_engineer" },
          priority: 65,
        }
      );
      break;

    case "zakat_calc":
      bubbles.push(
        {
          type: "zakat_calculator",
          theme: "islamic" as BubbleTheme,
          data: { nisabType: "gold", currency: "KWD" },
          priority: 95,
        },
        {
          type: "asset_breakdown",
          theme: "chart" as BubbleTheme,
          data: { categories: ["cash", "gold", "silver", "investments", "receivables"] },
          priority: 80,
        }
      );
      break;

    case "greeting":
    case "general_chat":
      bubbles.push(
        {
          type: "quick_menu",
          theme: "default" as BubbleTheme,
          data: {
            options: [
              { label: "اطلب أكل", action: "food_order" },
              { label: "تسوق", action: "product_search" },
              { label: "تابع طلبك", action: "order_tracking" },
              { label: "ابحث عن وظيفة", action: "job_search" },
            ],
          },
          priority: 70,
        }
      );
      break;

    default:
      bubbles.push({
        type: "text_response",
        theme: "default" as BubbleTheme,
        data: { text: "تم فهم طلبك، جاري المعالجة..." },
        priority: 50,
      });
  }

  return bubbles;
}

// ============================================
// ENTITY EXTRACTION
// ============================================

function extractEntities(text: string): Record<string, string> {
  const entities: Record<string, string> = {};
  const normalized = text.toLowerCase();

  // Extract price
  const priceMatch = normalized.match(/(\d+(?:\.\d{1,2})?)\s*(دينار|ريال|درهم|جنيه|ليرة|dinar|riyal|dirham|pound|KWD|SAR|AED|QAR|BHD|OMR|JOD|EGP|MAD)/i);
  if (priceMatch) {
    entities.price = `${priceMatch[1]} ${priceMatch[2]}`;
    entities.amount = priceMatch[1];
  }

  // Extract quantity
  const qtyMatch = normalized.match(/(\d+)\s*(كيلو|جرام|قطعة|صحن|طبق|كوب|لتر|حبة|شخص|person|kg|g|piece| serving)/i);
  if (qtyMatch) {
    entities.quantity = `${qtyMatch[1]} ${qtyMatch[2]}`;
  }

  // Extract order ID / tracking number
  const orderMatch = normalized.match(/(?:order|طلب|رقم|#)\s*[:\s]*(\d{4,})/i);
  if (orderMatch) {
    entities.orderId = orderMatch[1];
  }

  // Extract phone
  const phoneMatch = normalized.match(/(\+?965|\+?966|\+?971|\+?974|\+?973|\+?968|\+?962|\+?20|\+?212)?\s*\d{8}/);
  if (phoneMatch) {
    entities.phone = phoneMatch[0].replace(/\s/g, "");
  }

  // Extract product references
  const productPatterns = [
    /(?:ابغى|ابي|بدي|عايز|بغيت|looking for|search for)\s+(.{2,30}?)(?:\s|$|في|من|مع)/,
    /(.{2,30}?)\s*(?:بكم|بكام|كم|price|سعر|how much)/,
  ];
  for (const pattern of productPatterns) {
    const match = normalized.match(pattern);
    if (match && match[1] && match[1].length > 1) {
      entities.product = match[1].trim();
      break;
    }
  }

  // Extract location
  const locations = [
    "الكويت", "السعودية", "الرياض", "جدة", "دبي", "أبوظبي",
    "قطر", "الدوحة", "البحرين", "المنامة", "عمان", "مسقط",
    "الأردن", "عمان", "لبنان", "بيروت", "مصر", "القاهرة",
    "المغرب", "الدار البيضاء", "تونس", "الجزائر", "العراق",
  ];
  for (const loc of locations) {
    if (normalized.includes(loc.toLowerCase())) {
      entities.location = loc;
      break;
    }
  }

  // Extract cuisine type
  const cuisines = ["برياني", "كبسة", "شاورما", "برجر", "بيتزا", "مندي", "فطور", "عشا", "غدا", "صيني", "هندي", "لبناني", "تركي", "إيطالي"];
  for (const cuisine of cuisines) {
    if (normalized.includes(cuisine)) {
      entities.cuisine = cuisine;
      break;
    }
  }

  return entities;
}

// ============================================
// MAIN INTENT PARSING
// ============================================

/**
 * Parse user text into structured intent
 * This is the main NLP entry point for JASIM's brain
 */
export function parseIntent(
  text: string,
  context?: ConversationContext
): ParsedIntent {
  if (!text || text.trim().length === 0) {
    return createFallbackIntent("general_chat", "KW", "gulf");
  }

  const trimmed = text.trim();

  // Step 1: Language analysis
  const langAnalysis = analyzeLanguage(trimmed);
  const dialect = langAnalysis.detectedDialect;
  const normalizedText = langAnalysis.normalized || trimmed;

  // Step 2: Detect market from context or text
  const marketCode = context?.marketCode || detectMarketFromText(trimmed) || "KW";

  // Step 3: Score each intent
  const scores: Array<{ intent: IntentType; score: number; agent: AgentType; conf: number }> = [];

  for (const [intentKey, entry] of Object.entries(INTENT_KEYWORDS)) {
    const intent = intentKey as IntentType;
    let score = 0;

    // Check keyword matches
    const textToCheck = langAnalysis.isArabic ? normalizedText : trimmed.toLowerCase();
    for (const keyword of entry.keywords) {
      const kw = keyword.toLowerCase();
      if (textToCheck.includes(kw)) {
        // Full word match gets higher score
        const wordBoundary = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (wordBoundary.test(textToCheck)) {
          score += 2;
        } else {
          score += 1;
        }
      }
      // Also check transliterated match
      if (langAnalysis.isTransliterated) {
        const translitKw = transliterate(kw);
        if (translitKw && textToCheck.includes(translitKw.toLowerCase())) {
          score += 1.5;
        }
      }
    }

    if (score > 0) {
      scores.push({
        intent,
        score,
        agent: entry.agent,
        conf: entry.confidence,
      });
    }
  }

  // Step 4: Sort by score and pick best
  scores.sort((a, b) => b.score - a.score);

  let detectedIntent: IntentType;
  let agent: AgentType;
  let confidence: number;

  if (scores.length > 0 && scores[0].score >= 1) {
    detectedIntent = scores[0].intent;
    agent = scores[0].agent;
    // Confidence based on score differential
    const scoreDiff = scores.length > 1
      ? scores[0].score - scores[1].score
      : scores[0].score;
    confidence = Math.min(0.5 + (scoreDiff / (scores[0].score + 2)) * 0.45, 0.98);
  } else {
    // No clear match - use context or fallback
    if (context?.intent?.type) {
      detectedIntent = context.intent.type;
      agent = context.intent.requiresAgent;
      confidence = 0.4;
    } else {
      detectedIntent = detectFromPatterns(trimmed) || "general_chat";
      agent = INTENT_KEYWORDS[detectedIntent]?.agent || "mentor";
      confidence = 0.35;
    }
  }

  // Step 5: Extract entities
  const entities = extractEntities(trimmed);

  // Step 6: Generate bubbles
  const suggestedBubbles = generateBubblesForIntent(detectedIntent, entities, dialect);

  // Step 7: Validate with Zod
  const result = ParsedIntentSchema.parse({
    type: detectedIntent,
    confidence,
    entities,
    marketCode,
    dialect,
    requiresAgent: agent,
    suggestedBubbles,
  });

  return result;
}

/**
 * Detect intent from common phrase patterns
 * Handles multi-word expressions
 */
function detectFromPatterns(text: string): IntentType | null {
  const normalized = text.toLowerCase().trim();

  // Food patterns
  const foodPatterns = [
    /(?:ابغى|ابي|بدي|عايز|بغيت|ابغا|atlob|hab)\s+(?:اكل|آكل|طعام|أطلب|order|food)/i,
    /(?:جوعان|جعان|جوعانة|hungry|starving)/i,
    /(?:مطعم|مطاعم|restaurant|cafe)/i,
  ];
  if (foodPatterns.some(p => p.test(normalized))) return "food_order";

  // Order tracking patterns
  const trackPatterns = [
    /(?:وين|فين|where|وينه|وصل)\s+(?:طلبي|طلبية|اوردر|order|shipment)/i,
    /(?:track|tracking|follow|تتبع|متابعة)\s+(?:طلب|order|shipment)/i,
    /(?:رقم|number)\s+(?:طلب|order|tracking)/i,
  ];
  if (trackPatterns.some(p => p.test(normalized))) return "order_tracking";

  // Payment patterns
  const paymentPatterns = [
    /(?:ادفع|أدفع|pay|payment|دفع|سداد|فلوس)/i,
    /(?:knet|فيزا|visa|card|credit card|ماستر)/i,
  ];
  if (paymentPatterns.some(p => p.test(normalized))) return "payment";

  // Job patterns
  const jobPatterns = [
    /(?:وظيفة|وظائف|شغل|job|jobs|career|employment)/i,
    /(?:cv|resume|سيرة ذاتية|cv builder)/i,
  ];
  if (jobPatterns.some(p => p.test(normalized))) return "job_search";

  // Zakat patterns
  const zakatPatterns = [
    /(?:زكاة|زكاة|zakat|nisab|نصاب|حساب زكاة)/i,
  ];
  if (zakatPatterns.some(p => p.test(normalized))) return "zakat_calc";

  // Help patterns
  const helpPatterns = [
    /(?:مساعدة|help|support|sos|مساعده|ساعدني)/i,
  ];
  if (helpPatterns.some(p => p.test(normalized))) return "help";

  // Greeting patterns
  const greetingPatterns = [
    /^(?:مرحبا|هلا|أهلا|أهلاً|salam|hello|hi|hey)\b/i,
    /^(?:صباح|مساء|good morning|good evening)\b/i,
  ];
  if (greetingPatterns.some(p => p.test(normalized))) return "greeting";

  return null;
}

/**
 * Detect market code from text
 */
function detectMarketFromText(text: string): string | null {
  const normalized = text.toLowerCase();

  const marketMap: Record<string, string[]> = {
    KW: ["الكويت", "كويت", "kuwait"],
    SA: ["السعودية", "سعودي", "saudi", "الرياض", "جدة", "mekkah", "الدمام"],
    AE: ["الإمارات", "امارات", "uae", "dubai", "دبي", "أبوظبي"],
    QA: ["قطر", "qatar", "الدوحة"],
    BH: ["البحرين", "bahrain", "المنامة"],
    OM: ["عمان", "oman", "مسقط"],
    JO: ["الأردن", "jordan", "عمان"],
    LB: ["لبنان", "lebanon", "بيروت"],
    EG: ["مصر", "egypt", "القاهرة"],
    IQ: ["العراق", "iraq", "بغداد"],
    MA: ["المغرب", "morocco", "الدار البيضاء"],
    TN: ["تونس", "tunisia"],
    DZ: ["الجزائر", "algeria"],
    SD: ["السودان", "sudan"],
    PS: ["فلسطين", "palestine"],
  };

  for (const [code, names] of Object.entries(marketMap)) {
    if (names.some(n => normalized.includes(n.toLowerCase()))) {
      return code;
    }
  }

  return null;
}

/**
 * Create a fallback intent when parsing fails
 */
function createFallbackIntent(
  type: IntentType,
  marketCode: string,
  dialect: string
): ParsedIntent {
  return {
    type,
    confidence: 0.3,
    entities: {},
    marketCode,
    dialect,
    requiresAgent: INTENT_KEYWORDS[type]?.agent || "mentor",
    suggestedBubbles: generateBubblesForIntent(type, {}, dialect),
  };
}

/**
 * Get all supported intents with metadata
 */
export function getSupportedIntents(): Array<{
  intent: IntentType;
  agent: AgentType;
  sampleQueries: string[];
}> {
  return [
    { intent: "food_order", agent: "food", sampleQueries: ["أبي أطلب برياني", "ابغى كبسة", "جوعان"] },
    { intent: "product_search", agent: "fashion", sampleQueries: ["ابغى ملابس", "دور على منتج", "كم سعر"] },
    { intent: "order_tracking", agent: "delivery", sampleQueries: ["وين طلبي", "وين الاوردر", "track order"] },
    { intent: "payment", agent: "financial", sampleQueries: ["ابغى ادفع", "كيف ادفع", "payment method"] },
    { intent: "haggle_request", agent: "haggle", sampleQueries: ["غالي", "فيه خصم", "تنزل السعر"] },
    { intent: "cv_generation", agent: "recruitment", sampleQueries: ["سوي لي cv", "سيرة ذاتية", "build resume"] },
    { intent: "job_search", agent: "recruitment", sampleQueries: ["ابغى وظيفة", "وظائف", "find job"] },
    { intent: "zakat_calc", agent: "financial", sampleQueries: ["احسب زكاتي", "زكاة", "zakat calculator"] },
    { intent: "help", agent: "mentor", sampleQueries: ["مساعدة", "help", "كيف استخدم"] },
    { intent: "greeting", agent: "mentor", sampleQueries: ["مرحبا", "هلا", "hello"] },
  ];
}

/**
 * Batch parse multiple messages (for context resolution)
 */
export function batchParseIntents(
  messages: string[],
  context?: ConversationContext
): ParsedIntent[] {
  return messages.map(msg => parseIntent(msg, context));
}

/**
 * Re-evaluate intent with multi-turn context
 * Resolves ambiguous intents using conversation history
 */
export function resolveMultiTurnIntent(
  currentText: string,
  previousIntents: ParsedIntent[],
  marketCode: string = "KW"
): ParsedIntent {
  const current = parseIntent(currentText);

  // If current intent is weak, boost based on history
  if (current.confidence < 0.5 && previousIntents.length > 0) {
    // Get most frequent recent intent
    const recentIntents = previousIntents.slice(-3);
    const intentCounts: Record<string, number> = {};
    for (const pi of recentIntents) {
      intentCounts[pi.type] = (intentCounts[pi.type] || 0) + 1;
    }

    const topIntent = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])[0];

    if (topIntent && topIntent[1] >= 2) {
      // Boost confidence based on conversation continuity
      return {
        ...current,
        type: topIntent[0] as IntentType,
        confidence: Math.min(current.confidence + 0.3, 0.85),
        requiresAgent: INTENT_KEYWORDS[topIntent[0] as IntentType]?.agent || current.requiresAgent,
        marketCode,
      };
    }
  }

  return { ...current, marketCode };
}
