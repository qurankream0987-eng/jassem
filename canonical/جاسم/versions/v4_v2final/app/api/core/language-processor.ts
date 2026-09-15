/**
 * Language Processor - Arabic NLP utilities
 * Handles dialect detection, normalization, transliteration
 * Supports Gulf, Levantine, Egyptian, and Maghrebi dialects
 */

import { z } from "zod";
import type {
  ArabicDialect,
  LanguageAnalysis,
} from "./types";
import {
  ArabicDialectSchema,
  LanguageAnalysisSchema,
} from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  emptyInput: "النص فارغ - يرجى إدخال نص للتحليل",
  invalidLanguage: "لم يتم التعرف على لغة النص",
  normalizationFailed: "فشل في تطبيع النص",
} as const;

// ============================================
// DIALECT MARKERS - Keyword dictionaries
// ============================================
const DIALECT_MARKERS: Record<ArabicDialect, string[]> = {
  gulf: [
    // Pronouns & particles
    "يش", "يلا", "هذا", "هذي", "هذاك", "ذاك", "ذچ", "ذاكا",
    "وش", "وشو", "وشنو", "وش فيه", "وش فيها",
    // Verbs
    "يبي", "ابغى", "ابي", "ابغا", "ابغي", "تبي", "تبين",
    "أبغى", "أبي", "أبغي", "أبغا",
    "دش", "ادش", "تدش", "يدش",
    // Common words
    "ديرة", "بلد", "حبي", "حبيبي", "يمّه", "أبوي", "أمي",
    "زين", "حلو", "فلوس", "دراهم", "ريال",
    "شلونك", "شلونچ", "شخبارك", "عساك",
    "بسرعة", "دقايقة", "دقايق",
    "والله", "واللهي", "وبالله", "تو",
    "صج", "صدج", "صح", "يالله", "يلا",
    "هني", "هناك", "داخل", "بره", "برا",
    "كلش", "واجد", "هوige", "هيج", "هايچ",
    "كاش", "شبكة", "ماكو", "موجود", "مو",
    "الحين", "حاليا", "بعد", "قبل", "دحين",
    "يستاهل", "يعطيك", "الله يعطيك", "مافي", "مافيه",
  ],
  levantine: [
    "شو", "شو بدك", "شو بدچ", "شو بدك تعمل", "شو عم تعمل",
    "بدي", "بدك", "بدها", "بدنا", "بدكم", "بدهم",
    "كتير", "كتير منيح", "منيح", "تكرم", "تكرم عينك",
    "شباب", "بنات", "يسلمو", "يسلم", "تسلم",
    "هيدا", "هيي", "هودي", "هول",
    "كيفك", "كيفيك", "اخبارك", "شو اخبارك",
    "شو في", "شو فيه", "شو القصة", "شو القصه",
    "يلا", "تعال", "تعي", "روح", "روحي",
    "عنجد", "بجد", "صراحة", "wallah",
    "مصاري", "ليرة", "شيكل", "دينار",
    "حبيبي", "حبيبتي", "عيوني", "قلبي",
    "شو بدك تطلب", "بدي اطلب", "بدي آكل", "جوعان",
    "مرتب", "منيح", "ظريف", "حلو",
  ],
  egyptian: [
    "ايه", "ايوه", "اه", "لأ", "مش", "مش عارف",
    "عايز", "عايزة", "عايزين", "عوز", "نفسي",
    "ازيك", "ازيكم", "اخبارك ايه", "عمل ايه",
    "ياض", "ياواد", "ياست", "يا باشا", "يا باشمهندس",
    "كدة", "كده", "كدا", "خلاص", "تمام", "تمام جدا",
    "جامد", "جامدة", "تحفة", "عسل", "حلو اوي",
    "فلوس", "جنيه", "مليم", "مصاري",
    "بكام", "بكم ده", "اد ايه", "قد ايه",
    "يلا بينا", "تعالى", "تعالي", "روح", "روحي",
    "بص", "بصي", "شوف", "شوفي", "اتفرج",
    "دلوقتي", "دلوقت", "وقتي", "الوقت",
    "تاكسي", "مواصلات", "مترو", "اوتوبيس",
    "طلب", "اطلب", "بطلب", "هطلب", "عايز اطلب",
    "اكل", "عايز آكل", "جعان", "جعانة", "تعبان",
    "شاطر", "دمك تقيل", "كفاية", "بقا", "بقي",
  ],
  maghrebi: [
    "واش", "واش كاين", "واش راك", "واش راكي", "واخا",
    "بغيت", "بغيتي", "بغينا", "بغاو", "نبغي", "تبغي",
    "شحال", "بشحال", "شحال هادي", "منين", "فين",
    "ماشي", "ماشي مشكل", "مكاين", "مكاينش",
    "خويا", "ختي", "عزيزي", "حبيبي",
    "بزاف", "بزاف منيح", "واعر", "واعرة",
    "درهم", "ريال", "سنتيم", "فلوس",
    "شنو", "شكون", "كيفاش", "علاش", "فاش",
    "يلا", "سير", "سيري", "اجي", "اجيي",
    "دابا", "دابة", "هلا", "توا", " taw",
    "راك", "راكي", "وانت", "وانتي", "هوما",
    "صباح", "مساء", "ليلة", "نهار",
    "طاب", "ماشي", "لاباس", "الحمد",
  ],
  msa: [
    "هل", "ما", "لماذا", "كيف", "متى", "أين", "من",
    "أريد", "أحب", "أود", "أحب أن", "أريد أن",
    "هذا", "هذه", "هؤلاء", "ذلك", "تلك",
    "من فضلك", "لو سمحت", "هل يمكن", "هل يمكنني",
    "شكرا", "أشكرك", "جزيل", "الشكر",
    "أين يمكن", "أين أجد", "كم السعر", "ما السعر",
    "أود الطلب", "أريد شراء", "أحجز", "أريد حجز",
    "عفوا", "معذرة", "آسف", " disculpe",
  ],
  unknown: [],
};

// ============================================
// TRANSLITERATION MAP - Latin Arabic to Arabic
// ============================================
const TRANSLITERATION_MAP: Record<string, string> = {
  // Common transliteration patterns
  "a": "ا", "b": "ب", "t": "ت", "th": "ث",
  "j": "ج", "7": "ح", "kh": "خ", "d": "د",
  "dh": "ذ", "r": "ر", "z": "ز", "s": "س",
  "sh": "ش", "9": "ص", "9'": "ض", "6": "ط",
  "6'": "ظ", "3": "ع", "3'": "غ", "f": "ف",
  "q": "ق", "k": "ك", "l": "ل", "m": "م",
  "n": "ن", "h": "ه", "w": "و", "y": "ي",
  "ee": "ي", "oo": "و", "aa": "ا", "ah": "ة",
  // Egyptian specific
  "2": "ء", "2a": "أ", "2e": "إ", "2o": "أو",
  // Gulf specific
  "ch": "چ", "g": "ق", "v": "ف",
};

// Transliteration patterns (multi-character, longest first)
const TRANSLITERATION_PATTERNS = [
  // Multi-char patterns first (longest match)
  { pattern: /sh/g, ar: "ش" },
  { pattern: /kh/g, ar: "خ" },
  { pattern: /th/g, ar: "ث" },
  { pattern: /dh/g, ar: "ذ" },
  { pattern: /gh/g, ar: "غ" },
  { pattern: /ee/g, ar: "ي" },
  { pattern: /oo/g, ar: "و" },
  { pattern: /aa/g, ar: "ا" },
  { pattern: /ah/g, ar: "ة" },
  { pattern: /ch/g, ar: "چ" },
  { pattern: /9'/g, ar: "ض" },
  { pattern: /6'/g, ar: "ظ" },
  { pattern: /3'/g, ar: "غ" },
  // Numbers
  { pattern: /7/g, ar: "ح" },
  { pattern: /9/g, ar: "ص" },
  { pattern: /6/g, ar: "ط" },
  { pattern: /3/g, ar: "ع" },
  { pattern: /2/g, ar: "ء" },
  // Single char
  { pattern: /a/g, ar: "ا" },
  { pattern: /b/g, ar: "ب" },
  { pattern: /t/g, ar: "ت" },
  { pattern: /j/g, ar: "ج" },
  { pattern: /d/g, ar: "د" },
  { pattern: /r/g, ar: "ر" },
  { pattern: /z/g, ar: "ز" },
  { pattern: /s/g, ar: "س" },
  { pattern: /f/g, ar: "ف" },
  { pattern: /q/g, ar: "ق" },
  { pattern: /k/g, ar: "ك" },
  { pattern: /l/g, ar: "ل" },
  { pattern: /m/g, ar: "م" },
  { pattern: /n/g, ar: "ن" },
  { pattern: /h/g, ar: "ه" },
  { pattern: /w/g, ar: "و" },
  { pattern: /y/g, ar: "ي" },
  { pattern: /g/g, ar: "ق" },
  { pattern: /v/g, ar: "ف" },
];

// ============================================
// ARABIC NORMALIZATION RULES
// ============================================
const NORMALIZATION_RULES = [
  // Remove tashkeel/diacritics
  { pattern: /[\u064B-\u065F\u0670\u0640]/g, replacement: "" },
  // Normalize alef variants
  { pattern: /[\u0622\u0623\u0625]/g, replacement: "\u0627" }, // Madda, Hamza-above, Hamza-below -> Alef
  // Normalize teh marbuta
  { pattern: /\u0629/g, replacement: "\u0647" }, // Teh marbuta -> Heh
  // Normalize alef maksura
  { pattern: /\u0649/g, replacement: "\u064A" }, // Alef maksura -> Yeh
  // Normalize kashida/tatweel
  { pattern: /\u0640/g, replacement: "" },
  // Normalize Eastern Arabic numerals
  { pattern: /[\u0660-\u0669]/g, replacement: (m: string) => String.fromCharCode(m.charCodeAt(0) - 0x0660 + 0x0030) },
  // Remove extra whitespace
  { pattern: /\s+/g, replacement: " " },
];

// ============================================
// KEY TERM TRANSLATION MAP (Ar <-> En)
// ============================================
const KEY_TERMS: Record<string, Record<string, string>> = {
  food: {
    en: "food, meal, cuisine, dish",
    ar: "أكل, طعام, وجبة, أكلة, أطباق",
  },
  order: {
    en: "order, request, booking",
    ar: "طلب, أطلب, اطلب, حجز, أحجز",
  },
  restaurant: {
    en: "restaurant, cafe, eatery",
    ar: "مطعم, كافيه, مطاعم, مطعمي",
  },
  delivery: {
    en: "delivery, shipping, sending",
    ar: "توصيل, delivers, توصيلة, ينجلي",
  },
  payment: {
    en: "payment, pay, money, cash",
    ar: "دفع, فلوس, كاش, payment, يسدد",
  },
  track: {
    en: "track, follow, where",
    ar: "تتبع, وين, فين, أين, وينه, مكان",
  },
  product: {
    en: "product, item, goods",
    ar: "منتج, سلعة, بضاعة, صنف, منتجات",
  },
  price: {
    en: "price, cost, how much",
    ar: "سعر, كم, بكم, بكام, تكلفة, ثمن",
  },
  help: {
    en: "help, support, assistance",
    ar: "مساعدة, help, دعم, ساعدني, يساعد",
  },
  job: {
    en: "job, work, employment, career",
    ar: "وظيفة, شغل, عمل, دوام, مهنة, وظائف",
  },
  store: {
    en: "store, shop, market, boutique",
    ar: "متجر, محل, سوق, دكان, بقالة",
  },
  zakat: {
    en: "zakat, charity, islamic",
    ar: "زكاة, زكاة, إسلام, charity, نصاب",
  },
  pharmacy: {
    en: "pharmacy, medicine, drug",
    ar: "صيدلية, دواء, علاج, دوا, أدوية, صيدلي",
  },
  fashion: {
    en: "fashion, clothing, dress, wear",
    ar: "موضة, ملابس, لبس, فساتين, أزياء",
  },
  grocery: {
    en: "grocery, supermarket, vegetables",
    ar: "بقالة, خضار, سوبرماركت, سبرماركت",
  },
  cv: {
    en: "cv, resume, curriculum, profile",
    ar: "سيرة, cv, سيرة ذاتية, ملف, ريزومي",
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if text contains Arabic script
 */
function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Check if text appears to be transliterated Arabic
 */
function isTransliterated(text: string): boolean {
  // Lowercase and remove punctuation
  const clean = text.toLowerCase().replace(/[^a-z0-9\s']/g, "");
  if (clean.length < 2) return false;

  // Check for common transliteration patterns
  const translitPatterns = [
    /\b(abgai|abgi|abga|abg)\b/,      // Gulf "I want"
    /\b(shlon|shlom|shlok|shlonk|shloun)\b/,  // "how are you"
    /\b(wain|wayn|wen|fin|fain)\b/,    // "where"
    /\b(shno|shinu|shino|shno|wesh)\b/, // "what"
    /\b(zain|zen|7ilu|7elo)\b/,        // "good/beautiful"
    /\b(falos|feloos|floos|darahim)\b/, // "money"
    /\b(ya3ni|y3ni|yaani)\b/,          // "meaning/you know"
    /\b(inshallah|inshala|nshallah)\b/, // "God willing"
    /\b(kteer|ktir|wajed|wayed)\b/,    // "a lot"
    /\b(3adi|3ady|adi|m3adi)\b/,       // "normal/it's ok"
    /\b(7ag|7aga|7aji|7ajat)\b/,       // "thing"
    /\b(dyara|diyra|deera)\b/,         // "home/country"
    /\b(wallah|walahi|wala)\b/,        // "I swear"
    /\b(kam|bikam|bkam|bish7al)\b/,    // "how much"
    /\b(maku|mako|mafi|mafih)\b/,      // "there isn't"
    /\b(al7een|7ena|al7in|d7een)\b/,   // "now"
    /\b(shta2na|sh9al|sh9lak)\b/,      // Gulf variants
    /\b(b3d|ba3ad|gabil|gbl)\b/,       // "before/after"
    /\b(shta|shlon|shlonek)\b/,        // "how"
  ];

  return translitPatterns.some(p => p.test(clean));
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Detect Arabic dialect from text
 * Returns dialect type with confidence score
 */
export function detectDialect(text: string): {
  dialect: ArabicDialect;
  confidence: number;
} {
  if (!text || text.trim().length === 0) {
    return { dialect: "unknown", confidence: 0 };
  }

  const normalized = text.toLowerCase().trim();

  // Check if text is not Arabic at all
  if (!containsArabic(normalized) && !isTransliterated(normalized)) {
    return { dialect: "unknown", confidence: 0 };
  }

  // Score each dialect
  const scores: Record<ArabicDialect, number> = {
    gulf: 0,
    levantine: 0,
    egyptian: 0,
    maghrebi: 0,
    msa: 0,
    unknown: 0,
  };

  // Count matches for each dialect
  for (const [dialect, markers] of Object.entries(DIALECT_MARKERS) as [ArabicDialect, string[]][]) {
    if (dialect === "unknown") continue;
    for (const marker of markers) {
      const markerLower = marker.toLowerCase();
      // Exact word match or substring match
      const regex = new RegExp(
        markerLower
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\*/g, ".*"),
        "g"
      );
      const matches = (normalized.match(regex) || []).length;
      scores[dialect] += matches;
    }
  }

  // Find highest scoring dialect
  const entries = Object.entries(scores).filter(([d]) => d !== "unknown") as [
    ArabicDialect,
    number,
  ][];
  entries.sort((a, b) => b[1] - a[1]);

  const [topDialect, topScore] = entries[0];

  // If no clear matches, check for MSA patterns
  if (topScore === 0) {
    // If text has Arabic script but no dialect markers, might be MSA
    if (containsArabic(normalized)) {
      return { dialect: "msa", confidence: 0.4 };
    }
    return { dialect: "unknown", confidence: 0 };
  }

  // Calculate confidence
  const totalScore = entries.reduce((sum, [, s]) => sum + s, 0);
  const confidence = totalScore > 0
    ? Math.min(0.3 + (topScore / totalScore) * 0.7, 0.95)
    : 0;

  return { dialect: topDialect, confidence };
}

/**
 * Normalize Arabic text - remove diacritics, unify alef variants, etc.
 */
export function normalizeArabic(text: string): string {
  if (!text || text.trim().length === 0) {
    throw new Error(Errors.emptyInput);
  }

  let normalized = text.trim();

  // Apply normalization rules
  for (const rule of NORMALIZATION_RULES) {
    normalized = normalized.replace(rule.pattern, rule.replacement as string);
  }

  return normalized.trim().toLowerCase();
}

/**
 * Convert transliterated Arabic (Latin script) to Arabic script
 * e.g., "abgai kabseh" -> "ابغى كبسة"
 */
export function transliterate(text: string): string {
  if (!text || text.trim().length === 0) return "";

  // If already Arabic, return normalized
  if (containsArabic(text)) {
    return normalizeArabic(text);
  }

  let result = text.toLowerCase().trim();

  // Apply transliteration patterns (longest match first)
  const patterns = [
    // 3-letter patterns
    { pattern: /sh/g, ar: "ش" },
    { pattern: /kh/g, ar: "خ" },
    { pattern: /th/g, ar: "ث" },
    { pattern: /dh/g, ar: "ذ" },
    { pattern: /gh/g, ar: "غ" },
    { pattern: /ee/g, ar: "ي" },
    { pattern: /oo/g, ar: "و" },
    { pattern: /aa/g, ar: "ا" },
    { pattern: /ah/g, ar: "ة" },
    { pattern: /ch/g, ar: "چ" },
    { pattern: /9'/g, ar: "ض" },
    { pattern: /6'/g, ar: "ظ" },
    { pattern: /3'/g, ar: "غ" },
    // 2-letter with numbers
    { pattern: /2a/g, ar: "أ" },
    { pattern: /2e/g, ar: "إ" },
    { pattern: /2o/g, ar: "أو" },
    // Numbers
    { pattern: /7/g, ar: "ح" },
    { pattern: /9/g, ar: "ص" },
    { pattern: /6/g, ar: "ط" },
    { pattern: /3/g, ar: "ع" },
    { pattern: /2/g, ar: "ء" },
    // Single char (apply last to avoid conflicts)
    { pattern: /b/g, ar: "ب" },
    { pattern: /t/g, ar: "ت" },
    { pattern: /j/g, ar: "ج" },
    { pattern: /d/g, ar: "د" },
    { pattern: /r/g, ar: "ر" },
    { pattern: /z/g, ar: "ز" },
    { pattern: /s/g, ar: "س" },
    { pattern: /f/g, ar: "ف" },
    { pattern: /q/g, ar: "ق" },
    { pattern: /k/g, ar: "ك" },
    { pattern: /l/g, ar: "ل" },
    { pattern: /m/g, ar: "م" },
    { pattern: /n/g, ar: "ن" },
    { pattern: /h/g, ar: "ه" },
    { pattern: /w/g, ar: "و" },
    { pattern: /y/g, ar: "ي" },
    { pattern: /g/g, ar: "ق" },
    { pattern: /v/g, ar: "ف" },
    { pattern: /a/g, ar: "ا" },
  ];

  // We need to use a different approach - build character by character
  // to avoid cascading replacements
  let arabic = "";
  let i = 0;
  while (i < result.length) {
    let matched = false;

    // Try multi-char patterns first
    for (const p of patterns) {
      const patternStr = p.pattern.source;
      const slice = result.slice(i, i + patternStr.length);
      if (p.pattern.test(slice)) {
        arabic += p.ar;
        i += patternStr.length;
        matched = true;
        break;
      }
      // Reset regex lastIndex
      p.pattern.lastIndex = 0;
    }

    // Try checking with a fresh approach for multi-char
    if (!matched) {
      for (const p of patterns) {
        const patternSource = p.pattern.source.replace(/\\/g, "");
        if (result.substring(i, i + patternSource.length) === patternSource) {
          arabic += p.ar;
          i += patternSource.length;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Keep original character if no match
      arabic += result[i];
      i++;
    }
  }

  // Post-process: clean up spacing and normalize
  arabic = arabic
    .replace(/\s+/g, " ")
    .replace(/([\u0600-\u06FF])[\s]*([\u0600-\u06FF])/g, "$1$2")
    .trim();

  return arabic;
}

/**
 * Perform full language analysis on input text
 */
export function analyzeLanguage(text: string): LanguageAnalysis {
  const trimmed = text?.trim() || "";

  if (!trimmed) {
    throw new Error(Errors.emptyInput);
  }

  const hasArabic = containsArabic(trimmed);
  const isTranslit = isTransliterated(trimmed);
  const hasEnglish = /[a-zA-Z]/.test(trimmed);

  // Determine language
  let language: "ar" | "en" | "mixed" = "ar";
  if (hasArabic && hasEnglish) language = "mixed";
  else if (!hasArabic && hasEnglish) language = "en";
  else if (hasArabic || isTranslit) language = "ar";

  // Detect dialect
  const { dialect, confidence } = detectDialect(trimmed);

  // Normalize Arabic text
  let normalized = trimmed;
  try {
    if (hasArabic) {
      normalized = normalizeArabic(trimmed);
    }
  } catch {
    normalized = trimmed;
  }

  // Transliterate if needed
  let transliterated = trimmed;
  try {
    if (isTranslit && !hasArabic) {
      transliterated = transliterate(trimmed);
    }
  } catch {
    transliterated = trimmed;
  }

  const result: LanguageAnalysis = {
    original: trimmed,
    normalized,
    transliterated,
    detectedDialect: dialect,
    dialectConfidence: confidence,
    isArabic: hasArabic || isTranslit,
    isTransliterated: isTranslit,
    language,
  };

  // Validate with Zod
  return LanguageAnalysisSchema.parse(result);
}

/**
 * Translate key commerce terms between Arabic and English
 */
export function translateKeyTerms(
  text: string,
  to: "ar" | "en"
): string {
  if (!text) return "";

  const normalized = text.toLowerCase().trim();
  const results: string[] = [];

  for (const [category, terms] of Object.entries(KEY_TERMS)) {
    const targetTerms = terms[to];
    const sourceTerms = to === "ar" ? terms.en : terms.ar;

    // Check if any source term matches
    const sourceArray = sourceTerms.split(", ").map(t => t.toLowerCase().trim());
    const targetArray = targetTerms.split(", ").map(t => t.trim());

    if (sourceArray.some(st => normalized.includes(st))) {
      results.push(...targetArray);
    }
  }

  return results.length > 0
    ? [...new Set(results)].join(", ")
    : to === "ar"
      ? text
      : "ترجمة غير متوفرة";
}

/**
 * Get all supported dialects info
 */
export function getSupportedDialects(): Array<{
  code: ArabicDialect;
  nameAr: string;
  nameEn: string;
  regions: string[];
}> {
  return [
    { code: "gulf", nameAr: "خليجي", nameEn: "Gulf Arabic", regions: ["الكويت", "السعودية", "الإمارات", "قطر", "البحرين", "عُمان"] },
    { code: "levantine", nameAr: "شامي", nameEn: "Levantine Arabic", regions: ["الأردن", "سوريا", "لبنان", "فلسطين"] },
    { code: "egyptian", nameAr: "مصري", nameEn: "Egyptian Arabic", regions: ["مصر", "السودان"] },
    { code: "maghrebi", nameAr: "مغاربي", nameEn: "Maghrebi Arabic", regions: ["المغرب", "تونس", "الجزائر", "ليبيا", "موريتانيا"] },
    { code: "msa", nameAr: "فصحى", nameEn: "Modern Standard Arabic", regions: ["العالم العربي"] },
    { code: "unknown", nameAr: "غير معروف", nameEn: "Unknown", regions: [] },
  ];
}

/**
 * Get dialect-specific greetings
 */
export function getDialectGreeting(dialect: ArabicDialect): string {
  const greetings: Record<ArabicDialect, string> = {
    gulf: "هلا والله! كيف حالك؟",
    levantine: "أهلاً! كيفك؟",
    egyptian: "أهلاً! إزيك؟",
    maghrebi: "مرحبا! كيفاش؟",
    msa: "مرحباً! كيف حالك؟",
    unknown: "مرحباً! كيف يمكنني مساعدتك؟",
  };
  return greetings[dialect] || greetings.unknown;
}
