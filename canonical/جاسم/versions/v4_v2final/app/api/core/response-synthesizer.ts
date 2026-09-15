/**
 * ============================================
 * RESPONSE SYNTHESIZER
 * Generates Final Arabic Responses for JASIM
 * ============================================
 * 
 * Takes results from multiple swarm agents and synthesizes a cohesive,
 * natural Arabic response. Handles all 18 Arab markets with dialect-aware
 * phrasing and domain-specific response patterns.
 */

import { generateResponse } from "../lib/ai";
import type {
  Action,
  ConversationContext,
  IntentType,
  MarketConfig,
  SwarmResult,
  SynthesizedResponse,
} from "./types";

// ============================================
// ARABIC RESPONSE TEMPLATES BY INTENT
// ============================================
interface ResponseTemplate {
  patterns: string[]; // {placeholder} syntax for dynamic values
  followUps: string[]; // Suggested follow-up messages
  actions: Array<{ label: string; type: Action["type"]; payload?: Record<string, unknown> }>;
  confidence: number;
}

const RESPONSE_TEMPLATES: Record<IntentType, ResponseTemplate> = {
  // ── FOOD ORDER ───────────────────────────────────────────
  food_order: {
    patterns: [
      "لقيتلك {product} من {merchant} حلو بال{market} — ب {price} ⭐{rating} — تبي تطلبها؟",
      "شفتلك {merchant} عندهم {product} ب {price} — توصيل {eta} دقايق ⭐{rating}",
      "أفضل خيار لك: {product} من {merchant} — السعر {price} والتوصيل سريع 🍽️",
      "وصلتني توصية من {merchant}: {product} ب {price} — يستاهل التجربة! ⭐{rating}",
    ],
    followUps: [
      "أبي أطلبها الحين",
      "شنو أكثر مطعم تقييم؟",
      "بغيت شي أرخص",
      "وين المطعم بالضبط؟",
    ],
    actions: [
      { label: "اطلب الحين", type: "order" },
      { label: "شوف القائمة", type: "view_product" },
      { label: "كلم المطعم", type: "call" },
    ],
    confidence: 0.92,
  },

  // ── PRODUCT SEARCH ───────────────────────────────────────
  product_search: {
    patterns: [
      "لقيتلك {product} — السعر {price} {currency} — متوفر ب{market} 📦",
      "شفت {product} ب {price} {currency} — جودة ممتازة وتوصيل سريع ✨",
      "أفضل خيار: {product} — ب {price} {currency} — {stock} قطع متوفرة",
    ],
    followUps: [
      "ضفه للسلة",
      "عندك أرخص؟",
      "شنو مواصفاته؟",
      "متوفر بلون ثاني؟",
    ],
    actions: [
      { label: "أضف للسلة", type: "add_to_cart" },
      { label: "تفاصيل أكثر", type: "view_product" },
      { label: "شارك", type: "share" },
    ],
    confidence: 0.88,
  },

  // ── ORDER TRACKING ───────────────────────────────────────
  order_tracking: {
    patterns: [
      "طلبك #{orderId} من {merchant} — السائق واصل عند {location} ⏱️ {eta} دقايق",
      "تحديث طلبك #{orderId}: {status} — السائق {driverName} ⭐{driverRating} — يوصل خلال {eta} دقايق 🚚",
      "طلبك #{orderId} بخير! الحالة: {status} — الموقع الحالي: {location}",
      "وصل طلبك #{orderId} لـ{location} — باقي {eta} دقايق ويوصل بإذن الله 📍",
    ],
    followUps: [
      "كلم السائق",
      "غير العنوان",
      "الغي الطلب",
      "اطلب نفس الشي ثاني",
    ],
    actions: [
      { label: "كلم السائق", type: "call" },
      { label: "تتبع بالخريطة", type: "navigate" },
      { label: "تفاصيل الطلب", type: "view_product" },
    ],
    confidence: 0.95,
  },

  // ── PAYMENT ──────────────────────────────────────────────
  payment: {
    patterns: [
      "المبلغ {amount} {currency} — تبي تدفع بـ{gateway}؟ 🔒 آمن و سريع",
      "فاتورتك: {amount} {currency} — اختر طريقة الدفع: {gateway} 💳",
      "بيانات الدفع محمية — المبلغ {amount} {currency} — {gateway} متاحة ✅",
    ],
    followUps: [
      "ادفع KNET",
      "ادفع Apple Pay",
      "ادفع كاش",
      "عندي مشكلة بالدفع",
    ],
    actions: [
      { label: "ادفع الآن", type: "pay" },
      { label: "تحقق بيومتري", type: "biometric_verify" },
      { label: "غير الطريقة", type: "clarify" },
    ],
    confidence: 0.93,
  },

  // ── CART ─────────────────────────────────────────────────
  cart_view: {
    patterns: [
      "سلتك فيها {itemCount} منتجات — المجموع {total} {currency} 🛒",
      "محتويات السلة: {itemCount} منتجات — الإجمالي {total} {currency}",
    ],
    followUps: [
      "أكمل الشراء",
      "فضّ السلة",
      "ضف منتج ثاني",
    ],
    actions: [
      { label: "إتمام الشراء", type: "checkout" },
      { label: "أضف منتج", type: "add_to_cart" },
      { label: "احفظ لبعدين", type: "save" },
    ],
    confidence: 0.9,
  },

  cart_add: {
    patterns: [
      "ضفت {product} للسلة ✅ — المجموع الحين: {total} {currency}",
      "تمت الإضافة: {product} — عندك {itemCount} منتجات بالسلة",
    ],
    followUps: [
      "أكمل الشراء",
      "كمل تسوق",
      "شوف السلة",
    ],
    actions: [
      { label: "إتمام الشراء", type: "checkout" },
      { label: "كمل تسوق", type: "add_to_cart" },
    ],
    confidence: 0.9,
  },

  cart_remove: {
    patterns: [
      "شلت {product} من السلة 🗑️ — المجموع الحين: {total} {currency}",
      "تم الحذف — باقي {itemCount} منتجات بالسلة",
    ],
    followUps: [
      "رجعه للسلة",
      "فضّ السلة كلها",
      "أكمل الشراء",
    ],
    actions: [
      { label: "تراجع", type: "add_to_cart" },
      { label: "إتمام الشراء", type: "checkout" },
    ],
    confidence: 0.9,
  },

  // ── CHECKOUT ─────────────────────────────────────────────
  checkout: {
    patterns: [
      "جاهزين للإتمام! المبلغ {total} {currency} — العنوان: {address} 📦",
      "الطلبية جاهزة — {total} {currency} — توصيل خلال {deliveryTime}",
    ],
    followUps: [
      "أكد الطلب",
      "غير العنوان",
      "ضف كوبون خصم",
    ],
    actions: [
      { label: "أكد الطلب", type: "order" },
      { label: "عدّل العنوان", type: "clarify" },
    ],
    confidence: 0.91,
  },

  // ── JOB SEEKER ───────────────────────────────────────────
  job_seeker: {
    patterns: [
      "لقيتلك {count} وظيفة مطابقة ب{market} — أفضلها: {jobTitle} براتب {salary} 💼",
      "وظائف متاحة: {jobTitle} في {location} — الراتب {salary} — المطلوب: {requirements}",
      "فرصة ممتازة: {jobTitle} — {salary} — {location} ⭐ توصية AI: 87% تطابق",
    ],
    followUps: [
      "قدّم الحين",
      "جهزلي سيرة ذاتية",
      "وظائف أخرى",
      "شنو المتطلبات؟",
    ],
    actions: [
      { label: "قدّم الآن", type: "apply_job" },
      { label: "جهز سيرتي", type: "navigate" },
      { label: "حفظ الوظيفة", type: "save" },
    ],
    confidence: 0.85,
  },

  // ── HIRE WORKER ──────────────────────────────────────────
  hire_worker: {
    patterns: [
      "نشرت وظيفتك: {jobTitle} ✅ — {candidateCount} مرشحين متاحين — أفضل تطابق: {matchScore}%",
      "تم النشر بنجاح! وظيفة {jobTitle} — {candidateCount} متقدمين — أفضلهم {candidateName}",
    ],
    followUps: [
      "شوف المرشحين",
      "عدّل الوظيفة",
      "وظيفة ثانية",
    ],
    actions: [
      { label: "شوف المرشحين", type: "view_product" },
      { label: "نشر وظيفة", type: "post_job" },
    ],
    confidence: 0.87,
  },

  // ── CREATE STORE / SAAS ─────────────────────────────────
  create_store: {
    patterns: [
      "نقدر نبنيلك متجر {storeType} جاهز بـ 3 دقايق 🚀 — السعر {price} {currency}/شهر — جرب مجاناً 14 يوم!",
      "منصتك جاهزة: {storeType} — {price} {currency}/شهر — يشمل: {features}",
    ],
    followUps: [
      "ابني المتجر الحين",
      "شنو يشمل الاشتراك؟",
      "عرض تجربة مجانية",
    ],
    actions: [
      { label: "ابدأ مجاناً", type: "deploy_saas" },
      { label: "شوف الخطط", type: "view_product" },
    ],
    confidence: 0.86,
  },

  // ── HAGGLE ───────────────────────────────────────────────
  haggle: {
    patterns: [
      "فاوضتلك: {product} — السعر الأصلي {originalPrice} {currency} — وصولنا لـ {negotiatedPrice} {currency} 💰",
      "المفاوضة جارية! {product} — عرضك: {buyerPrice} — رد التاجر: {sellerPrice} — توصيتي: {recommendedPrice}",
      "وصلنا لاتفاق ممتاز على {product} — السعر النهائي: {finalPrice} {currency} 🎯",
    ],
    followUps: [
      "اقبل العرض",
      "فاوض أكثر",
      "شوف منتج ثاني",
    ],
    actions: [
      { label: "اقبل الصفقة", type: "haggle" },
      { label: "فاوض أكثر", type: "haggle" },
      { label: "اطلبه بسعره", type: "order" },
    ],
    confidence: 0.82,
  },

  // ── RETURN ITEM ──────────────────────────────────────────
  return_item: {
    patterns: [
      "طلب الإرجاع #{returnId} قيد المراجعة — المنتج: {product} — الحل المتوقع: {resolution} ⏱️ {eta} ساعة",
      "شفت حالة الإرجاع: {product} — {resolution} — التحليل: {analysis}",
    ],
    followUps: [
      "تابع الإرجاع",
      "تواصل مع الدعم",
      "طلب استبدال",
    ],
    actions: [
      { label: "تواصل مع الدعم", type: "contact_support" },
      { label: "تفاصيل الإرجاع", type: "view_product" },
    ],
    confidence: 0.85,
  },

  // ── DNA CROSSBREED ───────────────────────────────────────
  dna_crossbreed: {
    patterns: [
      "تم دمج DNA بنجاح! 🧬 — النسل الجديد: {childName} — القدرات: {capabilities}",
      "الهجين جاهز — {childName} — يورث أفضل صفات الأبوين",
    ],
    followUps: [
      "شوف التفاصيل",
      "درب الوكيل",
      "ابتعه",
    ],
    actions: [
      { label: "شوف التفاصيل", type: "view_product" },
      { label: "تدريب", type: "navigate" },
    ],
    confidence: 0.78,
  },

  // ── ZAKAT CALCULATE ──────────────────────────────────────
  zakat_calculate: {
    patterns: [
      "زكاتك: {zakatAmount} {currency} — النصاب: {nisab} {currency} — صافي الثروة: {netWealth} 🌙",
      "حساب الزكاة: {zakatAmount} {currency} — على ثروة {netWealth} {currency} — النسبة: 2.5%",
    ],
    followUps: [
      "ادفع الزكاة",
      "عدّل الحساب",
      "أضف أصول",
    ],
    actions: [
      { label: "ادفع الزكاة", type: "pay" },
      { label: "تفاصيل الحساب", type: "view_product" },
    ],
    confidence: 0.9,
  },

  // ── ISLAMIC CHECK ────────────────────────────────────────
  islamic_check: {
    patterns: [
      "فحص {product}: {halalStatus} ✅ — الثقة: {confidence}% — العلامة: {certification}",
      "المنتج {product} — حالة الحلال: {halalStatus} — نسبة الامتثال: {complianceRate}%",
    ],
    followUps: [
      "شوف التقرير الكامل",
      "منتجات حلال أخرى",
      "بلّغ عن منتج",
    ],
    actions: [
      { label: "التقرير الكامل", type: "view_product" },
      { label: "منتجات حلال", type: "navigate" },
    ],
    confidence: 0.88,
  },

  // ── FLEET TRACK ──────────────────────────────────────────
  fleet_track: {
    patterns: [
      "سائقك {driverName} ({vehicle}) ⭐{rating} — الموقع: {location} — يوصل خلال {eta} دقايق 🚗",
      "تحديث الموقع: السائق واصل {location} — {eta} دقايق للتوصيل",
    ],
    followUps: [
      "كلم السائق",
      "غير السائق",
      "شوف المسار",
    ],
    actions: [
      { label: "كلم السائق", type: "call" },
      { label: "تتبع بالخريطة", type: "navigate" },
    ],
    confidence: 0.92,
  },

  // ── BIOMETRIC AUTH ───────────────────────────────────────
  biometric_auth: {
    patterns: [
      "التحقق البيومتري جاهز 🔐 — {biometricType} — آمن ومشفّر — اضغط للتحقق",
      "تم التحقق بنجاح ✅ — الهوية مؤكدة — يمكنك المتابعة بأمان",
    ],
    followUps: [
      "تحقق الحين",
      "غير طريقة التحقق",
      "مسح البيانات",
    ],
    actions: [
      { label: "تحقق", type: "biometric_verify" },
      { label: "تخطي", type: "clarify" },
    ],
    confidence: 0.93,
  },

  // ── VISION SCAN ──────────────────────────────────────────
  vision_scan: {
    patterns: [
      "تم المسح! 🔍 — النتيجة: {result} — الثقة: {confidence}%",
      "التعرف البصري: {result} — دقة: {confidence}% — تفاصيل: {details}",
    ],
    followUps: [
      "مسح ثاني",
      "شوف التفاصيل",
      "احفظ النتيجة",
    ],
    actions: [
      { label: "مسح جديد", type: "navigate" },
      { label: "حفظ", type: "save" },
    ],
    confidence: 0.85,
  },

  // ── VOICE QUERY ──────────────────────────────────────────
  voice_query: {
    patterns: [
      "فهمتك! 🎤 — اللهجة: {dialect} — الثقة: {confidence}%",
      "تمت المعالجة الصوتية — النص: {transcript} — اللهجة المكتشفة: {dialect}",
    ],
    followUps: [
      "كلم بالعربي",
      "غير اللهجة",
      "تحويل لنص",
    ],
    actions: [
      { label: "رد صوتي", type: "navigate" },
      { label: "تحويل لنص", type: "clarify" },
    ],
    confidence: 0.88,
  },

  // ── SAAS DEPLOY ──────────────────────────────────────────
  saas_deploy: {
    patterns: [
      "منصتك {platformName} جاهزة! 🚀 — الرابط: {url} — الحالة: نشطة ✅",
      "تم النشر بنجاح — {platformName} — شغّلها الحين وابدأ البيع 💼",
    ],
    followUps: [
      "ادخل المنصة",
      "عدّل الإعدادات",
      "أضف منتجات",
    ],
    actions: [
      { label: "ادخل المنصة", type: "navigate" },
      { label: "الإعدادات", type: "navigate" },
    ],
    confidence: 0.87,
  },

  // ── AGGREGATOR BROWSE ────────────────────────────────────
  aggregator_browse: {
    patterns: [
      "لقيتلك {count} متاجر بـ{platformName} 🛍️ — أفضلها: {topStore} ⭐{rating}",
      "منصة {platformName}: {vendorCount} تاجر — {productCount} منتج — تصفح واختار!",
    ],
    followUps: [
      "تصفح المتاجر",
      "بحث بمنتج",
      "افتح متجرك",
    ],
    actions: [
      { label: "تصفح", type: "navigate" },
      { label: "فتح متجر", type: "deploy_saas" },
    ],
    confidence: 0.84,
  },

  // ── WIDGET EMBED ─────────────────────────────────────────
  widget_embed: {
    patterns: [
      "الودجت جاهز! 🔧 — النوع: {widgetType} — الكود جاهز للنسخ — حطّه بموقعك خلال دقيقة",
      "تم إعداد {widgetType} — انسخ الكود والصقه بموقعك — يشتغل فوراً",
    ],
    followUps: [
      "انسخ الكود",
      "عدّل التصميم",
      "اختبار",
    ],
    actions: [
      { label: "نسخ الكود", type: "share" },
      { label: "تعديل", type: "navigate" },
    ],
    confidence: 0.83,
  },

  // ── A2A TRADE ────────────────────────────────────────────
  a2a_trade: {
    patterns: [
      "وكلاء متاحين للتبادل: {agentCount} — {agentName} بـ{price} {currency} — المهارات: {skills}",
      "سوق الوكلاء: {agentName} — سعر: {price} — سمعة: ⭐{reputation} — صفقات: {transactions}",
    ],
    followUps: [
      "اشتري وكيل",
      "فاوض السعر",
      "شوف وكلاء ثاني",
    ],
    actions: [
      { label: "شراء", type: "pay" },
      { label: "فاوض", type: "haggle" },
      { label: "تفاصيل", type: "view_product" },
    ],
    confidence: 0.8,
  },

  // ── CROSSBORDER ORDER ────────────────────────────────────
  crossborder_order: {
    patterns: [
      "طلبك التجاري من {origin} لـ{destination} — الحالة: {status} — التكلفة: {total} {currency} 📦🌍",
      "تحديث تجاري: البضاعة {status} — التكلفة الإجمالية: {total} {currency} — الرسوم الجمركية: {customs}",
    ],
    followUps: [
      "تفاصيل الشحن",
      "مستندات الجمارك",
      "تواصل مع المورد",
    ],
    actions: [
      { label: "تتبع الشحنة", type: "track" },
      { label: "المستندات", type: "view_product" },
      { label: "تواصل", type: "call" },
    ],
    confidence: 0.85,
  },

  // ── SUPPLIER SEARCH ──────────────────────────────────────
  supplier_search: {
    patterns: [
      "لقيتلك {count} موردين بـ{market} — {supplierName} — نوع: {businessType} ⭐{rating}",
      "موردين متاحين: {supplierName} ({businessType}) — تقييم: ⭐{rating} — طلبات: {totalOrders}",
    ],
    followUps: [
      "كلم المورد",
      "اطلب عرض سعر",
      "شوف منتجاته",
    ],
    actions: [
      { label: "تواصل", type: "call" },
      { label: "عرض سعر", type: "haggle" },
      { label: "تفاصيل", type: "view_product" },
    ],
    confidence: 0.84,
  },

  // ── ANALYTICS VIEW ───────────────────────────────────────
  analytics_view: {
    patterns: [
      "تحليلاتك: المبيعات {sales} {currency} 📈 — الطلبات: {orders} — الزبائن: {customers} — {trend}",
      "ملخص الأداء: {metric} = {value} — {period} — {trend} مقارنة بالفترة السابقة",
    ],
    followUps: [
      "تقرير مفصل",
      "صدر Excel",
      "مقارنة بالشهر الماضي",
    ],
    actions: [
      { label: "تقرير مفصل", type: "view_product" },
      { label: "تصدير", type: "share" },
    ],
    confidence: 0.88,
  },

  // ── GENERAL CHAT ─────────────────────────────────────────
  general_chat: {
    patterns: [
      "أنا جاسم، وكيلك الذكي 🤖 — أقدر أساعدك بطلب أكل، تسوق، توظيف، وبناء متجر — شنو تحتاج؟",
      "مرحباً! عندي 22+ وكيل متخصص — من طعام وتوصيل لتوظيف وتجارة إلكترونية — كيف أقدر أساعدك؟",
    ],
    followUps: [
      "أبي أطلب أكل",
      "أبي أشتري منتج",
      "أبي وظيفة",
      "ابنيلي متجر",
    ],
    actions: [
      { label: "اطلب أكل", type: "navigate" },
      { label: "تسوق", type: "navigate" },
      { label: "وظائف", type: "navigate" },
    ],
    confidence: 0.75,
  },

  // ── GREETING ─────────────────────────────────────────────
  greeting: {
    patterns: [
      "{greeting}! أنا جاسم 🤖 — وكيلك الذكي — شلون أقدر أساعدك اليوم؟",
      "{greeting}! هلا والله — جاهز أساعدك بأي شي تحتاجه ✨",
      "{greeting}! مرحباً بيك — شنو تبي تسوي اليوم؟",
    ],
    followUps: [
      "أبي أطلب أكل",
      "أبي أشتري",
      "أبي وظيفة",
      "عندي سؤال",
    ],
    actions: [
      { label: "طلب أكل", type: "navigate" },
      { label: "تسوق", type: "navigate" },
    ],
    confidence: 0.98,
  },

  // ── HELP ─────────────────────────────────────────────────
  help: {
    patterns: [
      "أقدر أساعدك بـ: 🍽️ طلب أكل — 🛒 تسوق — 💼 وظائف — 🏪 بناء متجر — 📦 تتبع طلبات — 💰 دفع — 📊 تحليلات",
      "خدماتي: طعام، منتجات، توصيل، توظيف، متاجر إلكترونية، زكاة، مفاوضة AI — شنو تحتاج بالتحديد؟",
    ],
    followUps: [
      "كيف أطلب أكل؟",
      "كيف أسوي متجر؟",
      "كيف أدفع؟",
      "كلم دعم",
    ],
    actions: [
      { label: "مركز المساعدة", type: "navigate" },
      { label: "تواصل معنا", type: "contact_support" },
    ],
    confidence: 0.95,
  },

  // ── AMBIGUOUS ────────────────────────────────────────────
  ambiguous: {
    patterns: [
      "تبي تطلب أكل ولا تدور منتجات ولا خدمة؟ 🤔",
      "ما فهمت بالضبط — تقدر توضح أكثر؟ 😊",
      "عندك خيارات كثيرة — أكل، تسوق، وظايف، متاجر — شنو اللي يهمك؟",
    ],
    followUps: [
      "أبي أكل",
      "أبي أشتري",
      "أبي وظيفة",
      "أبي متجر",
    ],
    actions: [
      { label: "طعام", type: "navigate" },
      { label: "منتجات", type: "navigate" },
      { label: "خدمات", type: "clarify" },
    ],
    confidence: 0.5,
  },

  // ── ERROR ────────────────────────────────────────────────
  error: {
    patterns: [
      "عذراً ما فهمت طلبك — تقدر توضح أكثر؟ 😔",
      "صار خطأ — جرب مرة ثانية أو تواصل مع الدعم 🛠️",
      "ما قدرت أفهم — تقدر تكتبلي بالعربي الفصحى أو باللهجة الخليجية؟",
    ],
    followUps: [
      "حاول مرة ثانية",
      "كلم الدعم",
      "ارجع للرئيسية",
    ],
    actions: [
      { label: "إعادة المحاولة", type: "clarify" },
      { label: "الدعم", type: "contact_support" },
    ],
    confidence: 0,
  },
};

// ============================================
// RESPONSE SYNTHESIZER CLASS
// ============================================
export class ResponseSynthesizer {
  /**
   * Synthesize final response from agent results
   */
  async synthesize(
    results: SwarmResult[],
    context: ConversationContext,
  ): Promise<SynthesizedResponse> {
    if (results.length === 0) {
      return this.createFallbackResponse(context);
    }

    // Determine primary intent from results
    const primaryResult = results.reduce((best, r) =>
      r.confidence > best.confidence ? r : best,
    );

    const intent = primaryResult.intent;
    const template = RESPONSE_TEMPLATES[intent] || RESPONSE_TEMPLATES.general_chat;

    // Generate Arabic text from template + data
    const text = this.generateText(results, context, template);

    // Generate suggested actions
    const actions = this.generateActions(results, template);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(results);

    // Get suggestions from template
    const suggestions = template.followUps;

    return {
      text,
      language: context.userPreferences.language,
      confidence,
      actions,
      suggestions,
      sentiment: this.determineSentiment(results, context),
    };
  }

  /**
   * Generate Arabic text response by filling template with agent data
   */
  private generateText(
    results: SwarmResult[],
    context: ConversationContext,
    template: ResponseTemplate,
  ): string {
    // Pick a random pattern for variety
    const pattern = template.patterns[Math.floor(Math.random() * template.patterns.length)];

    // Build data map from all results
    const dataMap = this.buildDataMap(results, context);

    // Fill in the template
    let text = pattern;
    for (const [key, value] of Object.entries(dataMap)) {
      text = text.replace(new RegExp(`{${key}}`, "g"), String(value ?? ""));
    }

    // Clean up any unfilled placeholders
    text = text.replace(/\{[^}]+\}/g, "");

    // Add market-specific greeting for new sessions
    if (context.messages.length === 0 && template.confidence > 0.9) {
      const greeting = context.market.localGreeting;
      if (!text.includes(greeting)) {
        text = `${greeting}! ${text}`;
      }
    }

    return text.trim();
  }

  /**
   * Build a flat data map from all agent results for template filling
   */
  private buildDataMap(
    results: SwarmResult[],
    context: ConversationContext,
  ): Record<string, string> {
    const map: Record<string, string> = {};

    // Add market info
    map.market = context.market.nameAr;
    map.currency = context.market.currencySymbol;
    map.greeting = context.market.localGreeting;

    // Merge data from all results
    for (const result of results) {
      const d = result.data;

      // Food/Restaurant
      if (d.merchants && Array.isArray(d.merchants) && d.merchants.length > 0) {
        map.merchant = String((d.merchants as Array<{ name?: string }>)[0]?.name ?? "مطعم الرقي");
      }
      if (d.products && Array.isArray(d.products) && d.products.length > 0) {
        const first = (d.products as Array<{ name?: string; price?: number; currency?: string }>)[0];
        map.product = first?.name ?? "كبسة";
        map.price = String(first?.price ?? "3.5");
        map.currency = first?.currency ?? map.currency;
      }

      // Recommendation
      if (d.recommendation && typeof d.recommendation === "object") {
        const rec = d.recommendation as { name?: string; price?: number };
        map.product = rec.name ?? map.product;
        map.price = String(rec.price ?? map.price);
      }

      // Order tracking
      if (d.orders && Array.isArray(d.orders) && d.orders.length > 0) {
        const order = (d.orders as Array<{ id?: number; status?: string; total?: number; trackingNumber?: string; eta?: unknown }>)[0];
        map.orderId = String(order?.trackingNumber ?? `JAS-${order?.id ?? "1234"}`);
        map.status = this.translateOrderStatus(order?.status ?? "shipped");
        map.total = String(order?.total ?? "25.5");
      }

      // Driver/Fleet
      if (d.drivers && Array.isArray(d.drivers) && d.drivers.length > 0) {
        const driver = (d.drivers as Array<{ name?: string; vehicle?: string; rating?: number }>)[0];
        map.driverName = driver?.name ?? "سالم";
        map.vehicle = driver?.vehicle ?? "كامري 2024";
        map.driverRating = String(driver?.rating ?? 4.8);
      }
      if (d.avgDeliveryTime !== undefined) {
        map.eta = String(d.avgDeliveryTime);
      }
      if (d.availableDrivers !== undefined) {
        map.availableDrivers = String(d.availableDrivers);
      }

      // Payment
      if (d.availableGateways && Array.isArray(d.availableGateways)) {
        map.gateway = (d.availableGateways as string[]).join(" أو ");
      }
      if (d.amount !== undefined) {
        map.amount = String(d.amount);
      }

      // Haggle
      if (d.originalPrice !== undefined) {
        map.originalPrice = String(d.originalPrice);
      }
      if (d.suggestedPrice !== undefined) {
        map.negotiatedPrice = String(d.suggestedPrice);
        map.recommendedPrice = String(d.suggestedPrice);
      }
      if (d.finalPrice !== undefined) {
        map.finalPrice = String(d.finalPrice);
      }

      // Zakat
      if (d.zakatPayable !== undefined) {
        map.zakatAmount = String(d.zakatPayable);
      }
      if (d.nisabThreshold !== undefined) {
        map.nisab = String(d.nisabThreshold);
      }
      if (d.netWealth !== undefined) {
        map.netWealth = String(d.netWealth);
      }

      // Jobs
      if (d.jobs && Array.isArray(d.jobs) && d.jobs.length > 0) {
        const job = (d.jobs as Array<{ title?: string; salary?: string; location?: string }>)[0];
        map.jobTitle = job?.title ?? "مطور برمجيات";
        map.salary = job?.salary ?? "500-800 د.ك";
        map.location = job?.location ?? context.market.nameAr;
        map.count = String(d.jobs.length);
      }
      if (d.candidates && Array.isArray(d.candidates)) {
        map.candidateCount = String(d.candidates.length);
        const cand = (d.candidates as Array<{ name?: string; score?: number }>)[0];
        map.candidateName = cand?.name ?? "مرشح متميز";
        map.matchScore = String(cand?.score ?? 87);
      }

      // Store/SaaS
      if (d.templates && Array.isArray(d.templates) && d.templates.length > 0) {
        const tmpl = (d.templates as Array<{ name?: string; price?: number }>)[0];
        map.storeType = tmpl?.name ?? "متجر إلكتروني";
        map.platformName = tmpl?.name ?? "متجري";
        map.price = String(tmpl?.price ?? 39);
      }

      // Analytics
      if (d.metrics && Array.isArray(d.metrics) && d.metrics.length > 0) {
        const m = d.metrics as Array<{ metric?: string; value?: number }>;
        map.sales = String(m.find((x) => x.metric === "sales")?.value ?? "1,250");
        map.orders = String(m.find((x) => x.metric === "orders")?.value ?? 45);
        map.customers = String(m.find((x) => x.metric === "customers")?.value ?? 120);
        map.trend = "⬆️ نمو 12%";
      }

      // Biometric
      if (d.supported && Array.isArray(d.supported)) {
        map.biometricType = (d.supported as string[]).join(" و ");
      }

      // Voice
      if (d.detectedDialect) {
        map.dialect = String(d.detectedDialect);
      }
      if (d.inputText) {
        map.transcript = String(d.inputText);
      }
      if (d.confidence !== undefined) {
        map.confidence = String(Math.round((d.confidence as number) * 100));
      }

      // Vision
      if (d.result && typeof d.result === "string") {
        map.result = d.result;
      }

      // Rating fallback
      map.rating = map.rating ?? "4.8";
      map.location = map.location ?? "برج التجارية";
      map.eta = map.eta ?? "5";

      // Supplier
      if (d.suppliers && Array.isArray(d.suppliers) && d.suppliers.length > 0) {
        const sup = (d.suppliers as Array<{ name?: string; type?: string; rating?: number; totalOrders?: number }>)[0];
        map.supplierName = sup?.name ?? "مورد الرقي";
        map.businessType = sup?.type ?? "جملة";
        map.rating = String(sup?.rating ?? 4.5);
        map.totalOrders = String(sup?.totalOrders ?? 150);
        map.count = String(d.suppliers.length);
      }

      // Crossborder
      if (d.orders && Array.isArray(d.orders) && d.orders.length > 0) {
        const cb = d.orders as Array<{ origin?: string; destination?: string; status?: string; total?: number }>;
        map.origin = cb[0]?.origin ?? "الصين";
        map.destination = cb[0]?.destination ?? context.market.code;
        map.total = String(cb[0]?.total ?? 5000);
        map.customs = String(d.customsFees ?? 250);
      }

      // Aggregator
      if (d.platforms && Array.isArray(d.platforms) && d.platforms.length > 0) {
        const plat = d.platforms as Array<{ name?: string }>;
        map.platformName = plat[0]?.name ?? "سوقي";
        map.vendorCount = String(plat.length);
      }

      // A2A
      if (d.availableAgents && Array.isArray(d.availableAgents) && d.availableAgents.length > 0) {
        const ag = d.availableAgents as Array<{ name?: string; price?: number; reputation?: number; type?: string }>;
        map.agentName = ag[0]?.name ?? "وكيل ذكي";
        map.price = String(ag[0]?.price ?? 100);
        map.reputation = String(ag[0]?.reputation ?? 95);
        map.agentCount = String(ag.length);
        map.skills = ag[0]?.type ?? "ذكاء اصطناعي";
        map.transactions = String(50);
      }

      // Widget
      if (d.widgetTypes && Array.isArray(d.widgetTypes)) {
        map.widgetType = (d.widgetTypes as string[])[0] ?? "chat";
      }

      // Return item
      if (d.resolution) {
        map.resolution = String(d.resolution);
      }
      if (d.analysis) {
        map.analysis = String(d.analysis);
      }

      // DNA
      if (d.childName) {
        map.childName = String(d.childName);
      }
      if (d.capabilities) {
        map.capabilities = String(d.capabilities);
      }

      // Islamic
      if (d.halalRate !== undefined) {
        map.halalStatus = (d.halalRate as number) > 0.9 ? "حلال ✅" : "يحتاج مراجعة ⚠️";
        map.complianceRate = String(Math.round((d.halalRate as number) * 100));
      }
      if (d.checks && Array.isArray(d.checks) && d.checks.length > 0) {
        const check = (d.checks as Array<{ productName?: string; isHalal?: boolean; confidence?: number }>)[0];
        map.product = check?.productName ?? map.product;
        map.halalStatus = check?.isHalal ? "حلال ✅" : "غير حلال ❌";
        map.confidence = String(Math.round((check?.confidence ?? 1) * 100));
        map.certification = "OIC";
      }
    }

    return map;
  }

  /**
   * Translate order status to Arabic
   */
  private translateOrderStatus(status: string): string {
    const map: Record<string, string> = {
      pending: "قيد الانتظار",
      confirmed: "تم التأكيد",
      processing: "قيد التجهيز",
      shipped: "في الطريق",
      delivered: "تم التوصيل",
      cancelled: "ملغي",
      returned: "مُرجع",
    };
    return map[status] || status;
  }

  /**
   * Generate suggested actions from agent results
   */
  private generateActions(
    results: SwarmResult[],
    template: ResponseTemplate,
  ): Action[] {
    const actions: Action[] = [];
    let idCounter = 0;

    for (const tmplAction of template.actions) {
      const action: Action = {
        id: `action_${++idCounter}`,
        label: tmplAction.label,
        type: tmplAction.type,
        payload: tmplAction.payload || {},
        priority: actions.length < 2 ? 10 : 5,
      };

      // Enrich payload with result data
      for (const result of results) {
        if (result.data.productId) {
          action.payload.productId = result.data.productId;
        }
        if (result.data.orderId) {
          action.payload.orderId = result.data.orderId;
        }
        if (result.data.merchantId) {
          action.payload.merchantId = result.data.merchantId;
        }
      }

      actions.push(action);
    }

    return actions;
  }

  /**
   * Calculate overall confidence from all agent results
   */
  private calculateConfidence(results: SwarmResult[]): number {
    if (results.length === 0) return 0;

    const weightedSum = results.reduce((sum, r) => {
      // Weight by success and individual confidence
      const successWeight = r.success ? 1 : 0.3;
      return sum + r.confidence * successWeight;
    }, 0);

    return Math.min(1, weightedSum / results.length);
  }

  /**
   * Determine overall sentiment from results and context
   */
  private determineSentiment(
    results: SwarmResult[],
    context: ConversationContext,
  ): "positive" | "neutral" | "negative" | "urgent" {
    // Check for any failures
    const hasFailures = results.some((r) => !r.success);
    const hasUrgent = results.some((r) =>
      r.intent === "payment" || r.intent === "biometric_auth" || r.intent === "order_tracking",
    );

    if (hasUrgent && hasFailures) return "urgent";
    if (hasFailures) return "negative";

    // Check user sentiment in recent messages
    const recentMessages = context.messages.slice(-3);
    for (const msg of recentMessages) {
      if (msg.role === "user") {
        const text = msg.content.toLowerCase();
        if (/عاجل|ضروري|بسرعة/.test(text)) return "urgent";
        if (/سيئ|رديء|غاضب/.test(text)) return "negative";
        if (/شكرا|ممتاز|حلو/.test(text)) return "positive";
      }
    }

    return "neutral";
  }

  /**
   * Create a fallback response when no results are available
   */
  private createFallbackResponse(context: ConversationContext): SynthesizedResponse {
    return {
      text: `${context.market.localGreeting}! عذراً ما فهمت طلبك — تقدر توضح أكثر؟ 😊`,
      language: context.userPreferences.language,
      confidence: 0,
      actions: [
        {
          id: "retry",
          label: "إعادة المحاولة",
          type: "clarify",
          payload: {},
          priority: 1,
        },
      ],
      suggestions: ["اطلب أكل", "تسوق منتجات", "تابع طلبك"],
      sentiment: "neutral",
    };
  }
}
