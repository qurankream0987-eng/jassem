import { BubbleType } from './types';
import type { BubbleTypeValue } from './types';

export interface IntentResult {
  category: string;
  confidence: number;
  platform: string;
  bubbleType: BubbleTypeValue;
  keywords: string[];
  language: 'ar' | 'en' | 'mixed';
}

const INTENT_PATTERNS: Record<string, { en: RegExp[]; ar: RegExp[]; platform: string; bubbleType: BubbleTypeValue }> = {
  marketplace: {
    en: [/buy|sell|shop|product|store|cart|item|purchase|order|deal/i],
    ar: [/شراء|بيع|متجر|منتج|تسوق|سلة|طلب|صفقة|سعر/i],
    platform: 'marketplace',
    bubbleType: BubbleType.PRODUCT,
  },
  services: {
    en: [/service|repair|fix|maintain|install|clean|plumber|electrician/i],
    ar: [/خدمة|إصلاح|صيانة|تركيب|تنظيف|سباك|كهربائي/i],
    platform: 'services',
    bubbleType: BubbleType.SERVICE,
  },
  jobs: {
    en: [/job|work|career|hire|employ|salary|cv|resume|interview/i],
    ar: [/وظيفة|عمل|توظيف|راتب|سيرة|مقابلة|وظائف/i],
    platform: 'job_board',
    bubbleType: BubbleType.JOB,
  },
  real_estate: {
    en: [/rent|apartment|house|property|villa|building|real estate|land/i],
    ar: [/إيجار|شقة|منزل|عقار|فيلا|بناية|أرض|عقارات/i],
    platform: 'rental',
    bubbleType: BubbleType.PROPERTY,
  },
  transport: {
    en: [/ride|taxi|cab|uber|delivery|car|vehicle|transport|driver/i],
    ar: [/مواصلات|تاكسي|توصيل|سيارة|مركبة|سائق|نقل/i],
    platform: 'transport',
    bubbleType: BubbleType.VEHICLE,
  },
  freelance: {
    en: [/freelance|gig|project|developer|designer|contractor|consultant/i],
    ar: [/مستقل|مشروع|مطور|مصمم|مقاول|استشاري|عقد/i],
    platform: 'freelance',
    bubbleType: BubbleType.FREELANCE,
  },
  events: {
    en: [/event|concert|ticket|venue|party|wedding|conference|festival/i],
    ar: [/فعالية|حفل|تذكرة|مكان|زفاف|مؤتمر|مهرجان/i],
    platform: 'event',
    bubbleType: BubbleType.EVENT,
  },
  education: {
    en: [/course|learn|class|student|university|school|degree|certificate/i],
    ar: [/تعلم|دورة|طالب|جامعة|مدرسة|شهادة|تعليم/i],
    platform: 'education',
    bubbleType: BubbleType.EDUCATION,
  },
  healthcare: {
    en: [/doctor|hospital|clinic|medicine|health|appointment|dentist|pharmacy/i],
    ar: [/طبيب|مستشفى|عيادة|دواء|صحة|موعد|أسنان|صيدلية/i],
    platform: 'healthcare',
    bubbleType: BubbleType.HEALTHCARE,
  },
  travel: {
    en: [/flight|hotel|trip|vacation|booking|travel|tour|visa|umrah|hajj/i],
    ar: [/سفر|فندق|رحلة|إجازة|حجز|سياحة|تأشيرة|عمرة|حج/i],
    platform: 'travel',
    bubbleType: BubbleType.TRAVEL,
  },
  government: {
    en: [/government|official|document|license|permit|zakat|tax|bill/i],
    ar: [/حكومة|رسمي|وثيقة|ترخيص|تصريح|زكاة|ضريبة|فاتورة/i],
    platform: 'government',
    bubbleType: BubbleType.GOVERNMENT,
  },
  bulk: {
    en: [/bulk|wholesale|container|b2b|supplier|manufacturer|export|import/i],
    ar: [/جملة|بالجملة|حاوية|مورد|مصنع|تصدير|استيراد/i],
    platform: 'marketplace',
    bubbleType: BubbleType.BULK,
  },
  furniture: {
    en: [/furniture|sofa|table|chair|bed|cabinet|decor|interior/i],
    ar: [/أثاث|كنبة|طاولة|كرسي|سرير|خزانة|ديكور|داخلي/i],
    platform: 'marketplace',
    bubbleType: BubbleType.FURNITURE,
  },
};

export function classifyIntent(query: string): IntentResult {
  const language = detectLanguage(query);
  let bestMatch: IntentResult = {
    category: 'marketplace',
    confidence: 0.1,
    platform: 'marketplace',
    bubbleType: BubbleType.PRODUCT,
    keywords: [],
    language,
  };

  for (const [category, patterns] of Object.entries(INTENT_PATTERNS)) {
    const regexes = language === 'ar' ? patterns.ar : patterns.en;
    let matches = 0;
    const keywords: string[] = [];

    for (const regex of regexes) {
      const match = query.match(regex);
      if (match) {
        matches++;
        keywords.push(...match);
      }
    }

    const confidence = Math.min(1, matches / regexes.length + keywords.length * 0.1);

    if (confidence > bestMatch.confidence) {
      bestMatch = {
        category,
        confidence,
        platform: patterns.platform,
        bubbleType: patterns.bubbleType,
        keywords: [...new Set(keywords)],
        language,
      };
    }
  }

  return bestMatch;
}

export function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  const arabicRegex = /[\u0600-\u06FF]/;
  const englishRegex = /[a-zA-Z]/;
  const hasArabic = arabicRegex.test(text);
  const hasEnglish = englishRegex.test(text);

  if (hasArabic && hasEnglish) return 'mixed';
  if (hasArabic) return 'ar';
  return 'en';
}

export function getBubbleIconSvg(type: BubbleTypeValue): string {
  const icons: Record<BubbleTypeValue, string> = {
    [BubbleType.PRODUCT]: 'Package',
    [BubbleType.SERVICE]: 'Wrench',
    [BubbleType.JOB]: 'Briefcase',
    [BubbleType.PROPERTY]: 'Home',
    [BubbleType.VEHICLE]: 'Car',
    [BubbleType.FREELANCE]: 'User',
    [BubbleType.EVENT]: 'Calendar',
    [BubbleType.EDUCATION]: 'GraduationCap',
    [BubbleType.HEALTHCARE]: 'Heart',
    [BubbleType.TRAVEL]: 'Plane',
    [BubbleType.GOVERNMENT]: 'Building',
    [BubbleType.BULK]: 'Boxes',
    [BubbleType.FURNITURE]: 'Sofa',
    [BubbleType.OTHER]: 'Circle',
  };
  return icons[type] ?? 'Circle';
}
