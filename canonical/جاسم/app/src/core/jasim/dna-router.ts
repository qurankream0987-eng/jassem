import { DnaGene } from './types';
import type { DnaProfile, IntentResult, DnaGeneValue } from './types';

const INTENT_PATTERNS: Record<string, { en: RegExp[]; ar: RegExp[]; platform: string }> = {
  marketplace: {
    en: [/buy|sell|shop|product|store|cart|item|purchase|order|deal|price|discount/i],
    ar: [/شراء|بيع|متجر|منتج|تسوق|سلة|طلب|صفقة|سعر|خصم|عرض/i],
    platform: 'marketplace',
  },
  services: {
    en: [/service|repair|fix|maintain|install|clean|plumber|electrician|mechanic/i],
    ar: [/خدمة|إصلاح|صيانة|تركيب|تنظيف|سباك|كهربائي|ميكانيكي/i],
    platform: 'services',
  },
  jobs: {
    en: [/job|work|career|hire|employ|salary|cv|resume|interview|position|opening/i],
    ar: [/وظيفة|عمل|توظيف|راتب|سيرة|مقابلة|منصب|شاغر|وظائف/i],
    platform: 'job_board',
  },
  real_estate: {
    en: [/rent|apartment|house|property|villa|building|real estate|land|mortgage/i],
    ar: [/إيجار|شقة|منزل|عقار|فيلا|بناية|أرض|عقارات|رهن/i],
    platform: 'rental',
  },
  transport: {
    en: [/ride|taxi|cab|uber|delivery|car|vehicle|transport|driver|shipping/i],
    ar: [/مواصلات|تاكسي|توصيل|سيارة|مركبة|سائق|نقل|شحن/i],
    platform: 'transport',
  },
  freelance: {
    en: [/freelance|gig|project|developer|designer|contractor|consultant|expert/i],
    ar: [/مستقل|مشروع|مطور|مصمم|مقاول|استشاري|خبير/i],
    platform: 'freelance',
  },
  events: {
    en: [/event|concert|ticket|venue|party|wedding|conference|festival|exhibition/i],
    ar: [/فعالية|حفل|تذكرة|مكان|زفاف|مؤتمر|مهرجان|معرض/i],
    platform: 'event',
  },
  education: {
    en: [/course|learn|class|student|university|school|degree|certificate|training/i],
    ar: [/تعلم|دورة|طالب|جامعة|مدرسة|شهادة|تعليم|تدريب/i],
    platform: 'education',
  },
  healthcare: {
    en: [/doctor|hospital|clinic|medicine|health|appointment|dentist|pharmacy|treatment/i],
    ar: [/طبيب|مستشفى|عيادة|دواء|صحة|موعد|أسنان|صيدلية|علاج/i],
    platform: 'healthcare',
  },
  travel: {
    en: [/flight|hotel|trip|vacation|booking|travel|tour|visa|umrah|hajj|tourism/i],
    ar: [/سفر|فندق|رحلة|إجازة|حجز|سياحة|تأشيرة|عمرة|حج/i],
    platform: 'travel',
  },
  government: {
    en: [/government|official|document|license|permit|zakat|tax|bill|payment|fine/i],
    ar: [/حكومة|رسمي|وثيقة|ترخيص|تصريح|زكاة|ضريبة|فاتورة|دفع|مخالفة/i],
    platform: 'government',
  },
  bulk: {
    en: [/bulk|wholesale|container|b2b|supplier|manufacturer|export|import|trade/i],
    ar: [/جملة|بالجملة|حاوية|مورد|مصنع|تصدير|استيراد|تجارة/i],
    platform: 'marketplace',
  },
  furniture: {
    en: [/furniture|sofa|table|chair|bed|cabinet|decor|interior|design/i],
    ar: [/أثاث|كنبة|طاولة|كرسي|سرير|خزانة|ديكور|داخلي|تصميم/i],
    platform: 'marketplace',
  },
  food: {
    en: [/food|restaurant|meal|delivery|kitchen|chef|menu|catering|dining/i],
    ar: [/طعام|مطعم|وجبة|توصيل|مطبخ|طاهي|قائمة|ضيافة/i],
    platform: 'marketplace',
  },
  car_repair: {
    en: [/car repair|auto|mechanic|garage|service|tire|oil|maintenance|fix/i],
    ar: [/إصلاح سيارات|ميكانيكي|كراج|صيانة|إطار|زيت|تصليح/i],
    platform: 'services',
  },
};

export function classifyIntent(query: string): IntentResult {
  const language = detectLanguage(query);
  let bestMatch: IntentResult = {
    category: 'marketplace',
    confidence: 0.1,
    platform: 'marketplace',
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

    const confidence = Math.min(1, matches / regexes.length + keywords.length * 0.05);

    if (confidence > bestMatch.confidence) {
      bestMatch = {
        category,
        confidence,
        platform: patterns.platform,
        keywords: [...new Set(keywords)],
        language,
      };
    }
  }

  return bestMatch;
}

export function generateDnaProfile(intent: IntentResult): DnaProfile {
  const seed = intent.platform + intent.category;
  const genes = generateGenesFromSeed(seed);

  return {
    id: `dna-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    genes,
    platform: intent.platform,
    category: intent.category,
    confidence: intent.confidence,
    features: generateFeatures(genes),
    createdAt: new Date(),
  };
}

export function getGeneValue(profile: DnaProfile, gene: DnaGeneValue): number {
  return profile.genes[gene] ?? 0.5;
}

function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  const arabicRegex = /[\u0600-\u06FF]/;
  const englishRegex = /[a-zA-Z]/;
  const hasArabic = arabicRegex.test(text);
  const hasEnglish = englishRegex.test(text);

  if (hasArabic && hasEnglish) return 'mixed';
  if (hasArabic) return 'ar';
  return 'en';
}

function generateGenesFromSeed(seed: string): Record<DnaGeneValue, number> {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }

  const genes: Record<DnaGeneValue, number> = {
    [DnaGene.UI]: 0,
    [DnaGene.CAPABILITY]: 0,
    [DnaGene.TRUST]: 0,
    [DnaGene.MEMORY]: 0,
    [DnaGene.REASONING]: 0,
    [DnaGene.PLANNING]: 0,
    [DnaGene.COMMUNICATION]: 0,
    [DnaGene.SECURITY]: 0,
  };

  const geneKeys = Object.keys(DnaGene) as DnaGeneValue[];
  for (let i = 0; i < geneKeys.length; i++) {
    hash = ((hash * 16807) % 2147483647);
    genes[geneKeys[i]] = ((hash & 0x7fffffff) / 2147483647);
  }

  return genes;
}

function generateFeatures(genes: Record<DnaGeneValue, number>): string[] {
  const allFeatures = [
    'search', 'filter', 'sort', 'map', 'chat', 'reviews',
    'payments', 'escrow', 'notifications', 'analytics',
    'ai_recommendations', 'booking', 'messaging', 'video',
    'calendar', 'tracking', 'multi_language', 'rtl_support',
    'dark_mode', 'offline_mode', 'pwa', 'biometric',
  ];
  const count = Math.floor((genes[DnaGene.CAPABILITY] ?? 0.5) * 10) + 3;
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor((genes[DnaGene.UI] ?? 0.5) * i * 100) % allFeatures.length;
    const feature = allFeatures[idx];
    if (!selected.includes(feature)) selected.push(feature);
  }
  return selected;
}
