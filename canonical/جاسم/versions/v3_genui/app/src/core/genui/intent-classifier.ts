// ============================================================================
// Intent Classifier v3.0 — يفهم ما يريده المستخدم ويصنفه
// ============================================================================

import { BubbleType } from './types';
import type { IntentResult } from './types';

/** أنماط التعرف على النية بالعربية والإنجليزية */
const INTENT_PATTERNS: Array<{ types: BubbleType[]; patterns: RegExp[]; weight: number }> = [
  // الطعام والمطاعم
  {
    types: [BubbleType.RESTAURANT, BubbleType.FOOD],
    patterns: [
      /مطعم/i, /طعام/i, /أكل/i, /وجبة/i, /برياني/i, /مجبوس/i, /مندي/i,
      /burger/i, /pizza/i, /food/i, /restaurant/i, /eat/i, /hungry/i,
      /افت[ح ا]/i, /اطلب/i, /توصيل/i,
    ],
    weight: 1.0,
  },
  // الصيدليات
  {
    types: [BubbleType.PHARMACY],
    patterns: [
      /صيدلية/i, /دواء/i, /علاج/i, /وصفة/i, /فيتامين/i, /صح[ة ت]/i,
      /pharmacy/i, /medicine/i, /drug/i, /pill/i, /vitamin/i,
    ],
    weight: 1.0,
  },
  // الموضة والأزياء
  {
    types: [BubbleType.FASHION],
    patterns: [
      /موضة/i, /أزياء/i, /ملابس/i, /فستان/i, /قميص/i, /حذاء/i,
      /fashion/i, /clothes/i, /dress/i, /shirt/i, /shoe/i, /outfit/i,
    ],
    weight: 1.0,
  },
  // البقالة
  {
    types: [BubbleType.GROCERY],
    patterns: [
      /بقالة/i, /سوبرماركت/i, /خضار/i, /فاكهة/i, /لحوم/i,
      /grocery/i, /supermarket/i, /vegetable/i, /fruit/i, /market/i,
    ],
    weight: 1.0,
  },
  // التوصيل
  {
    types: [BubbleType.DELIVERY],
    patterns: [
      /توصيل/i, /سائق/i, /طلبية/i, /شحنة/i, /وصل/i,
      /delivery/i, /driver/i, /shipping/i, /track/i, /logistics/i,
    ],
    weight: 1.0,
  },
  // الوظائف والتوظيف
  {
    types: [BubbleType.RECRUITMENT, BubbleType.JOB],
    patterns: [
      /وظيفة/i, /موظف/i, /مرشح/i, /تعيين/i, /راتب/i, /سيرة/i, /cv/i,
      /job/i, /hire/i, /apply/i, /candidate/i, /career/i, /position/i,
      /وظائف/i, /موارد بشرية/i,
    ],
    weight: 1.0,
  },
  // الدفع
  {
    types: [BubbleType.PAYMENT, BubbleType.WALLET],
    patterns: [
      /دفع/i, /فاتورة/i, /فيزا/i, /كي-نت/i, /تحويل/i, /رصيد/i, /محفظة/i,
      /pay/i, /payment/i, /invoice/i, /visa/i, /transfer/i, /wallet/i, /balance/i,
      /فلوس/i, /مصاري/i,
    ],
    weight: 1.0,
  },
  // الطوارئ
  {
    types: [BubbleType.EMERGENCY],
    patterns: [
      /طوارئ/i, /إسعاف/i, /نار/i, /سرقة/i, /حادث/i, /إسعاف/i, / police/i,
      /emergency/i, /ambulance/i, /fire/i, /police/i, /accident/i, /help/i, /911/i,
    ],
    weight: 1.2, // أولوية أعلى
  },
  // المنتجات والتسوق
  {
    types: [BubbleType.PRODUCT, BubbleType.AD],
    patterns: [
      /منتج/i, /شراء/i, /سلة/i, /طلب/i, /سعر/i, /خصم/i, /عرض/i,
      /product/i, /buy/i, /shop/i, /cart/i, /order/i, /price/i, /discount/i,
    ],
    weight: 1.0,
  },
  // المنصات والبناء
  {
    types: [BubbleType.PLATFORM],
    patterns: [
      /منصة/i, /سوق/i, /سااس/i, /متجر/i, /تطبيق/i, /موقع/i, /برنامج/i,
      /platform/i, /marketplace/i, /saas/i, /app/i, /website/i, /build/i, /create/i,
      /ابن[ي ين]/i, /صمم/i, /طوّر/i,
    ],
    weight: 1.0,
  },
  // التفاوض
  {
    types: [BubbleType.NEGOTIATION],
    patterns: [
      /تفاوض/i, /خصم/i, /سوم/i, /نقاش/i, /سعر/i, /رخيص/i, /فلوس/i,
      /haggle/i, /negotiate/i, /discount/i, /deal/i, /cheap/i, /bargain/i,
    ],
    weight: 1.0,
  },
  // الإعلانات
  {
    types: [BubbleType.ADS],
    patterns: [
      /إعلان/i, /حملة/i, /تسويق/i, /ترويج/i, /إعلانات/i, /مشاهدات/i,
      /ad/i, /ads/i, /campaign/i, /marketing/i, /promote/i, /advertise/i,
    ],
    weight: 1.0,
  },
  // التحليلات
  {
    types: [BubbleType.ANALYTICS],
    patterns: [
      /تحليل/i, /إحصائيات/i, /تقرير/i, /مبيعات/i, /زيارات/i, /أرقام/i,
      /analytics/i, /stats/i, /report/i, /dashboard/i, /metrics/i, /kpi/i,
    ],
    weight: 1.0,
  },
  // الاقتراحات
  {
    types: [BubbleType.SUGGESTIONS],
    patterns: [
      /اقتراح/i, /توصية/i, /نصيحة/i, /أفضل/i, /شنو أنصح/i,
      /suggest/i, /recommend/i, /advice/i, /best/i, /top/i,
    ],
    weight: 1.0,
  },
  // الإعدادات
  {
    types: [BubbleType.SETTINGS],
    patterns: [
      /إعداد/i, /ضبط/i, /لغة/i, /حساب/i, /ملف/i, /تفضيل/i, /إشعار/i,
      /setting/i, /config/i, /account/i, /profile/i, /language/i, /preference/i,
    ],
    weight: 1.0,
  },
  // الدردشة والمحادثة
  {
    types: [BubbleType.SUBCHAT, BubbleType.CHAT],
    patterns: [
      /دردشة/i, /محادثة/i, /رسالة/i, /شات/i, /كلام/i,
      /chat/i, /message/i, /talk/i, /conversation/i, /messaging/i,
    ],
    weight: 0.8,
  },
];

/** استخراج الكيانات من النص */
function extractEntities(text: string): string[] {
  const entities: string[] = [];

  // أماكن
  const locationMatch = text.match(/في\s+(\S+)/);
  if (locationMatch) entities.push(`location:${locationMatch[1]}`);

  // أسعار
  const priceMatch = text.match(/(\d+)\s*(د\.ك|دينار|KD|USD|\$)/);
  if (priceMatch) entities.push(`price:${priceMatch[1]}`);

  // أرقام
  const numMatch = text.match(/(\d+)/g);
  if (numMatch) numMatch.forEach(n => entities.push(`number:${n}`));

  return entities;
}

/** تصنيف النية الرئيسي */
export function classifyIntent(text: string): IntentResult {
  if (!text || text.trim().length === 0) {
    return { type: BubbleType.CHAT, confidence: 0, entities: [], originalText: text };
  }

  const normalized = text.toLowerCase().trim();
  const scores = new Map<BubbleType, number>();

  // تقييم كل نمط
  for (const { types, patterns, weight } of INTENT_PATTERNS) {
    let matched = false;
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        matched = true;
        break;
      }
    }
    if (matched) {
      for (const type of types) {
        scores.set(type, (scores.get(type) || 0) + weight);
      }
    }
  }

  // اختيار الأعلى
  let bestType = BubbleType.CHAT;
  let bestScore = 0;

  for (const [type, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // حساب الثقة
  const confidence = Math.min(bestScore * 0.4, 1.0);
  const entities = extractEntities(text);

  return { type: bestType, confidence, entities, originalText: text };
}

/** هل النية واضحة بما يكفي لتوليد فقاعة؟ */
export function isIntentClear(result: IntentResult): boolean {
  return result.confidence >= 0.3;
}

/** الحصول على أيقونة SVG للنوع */
export function getBubbleIconSvg(type: BubbleType): string {
  const icons: Record<string, string> = {
    [BubbleType.FOOD]: '<path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5S13.4 11.5 12 11.5z"/>',
    [BubbleType.RESTAURANT]: '<path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>',
    [BubbleType.PHARMACY]: '<path d="M6 3h12v2H6V3zm0 4h12v2H6V7zm0 4h4v2H6v-2zm6 0h6v2h-6v-2zm-6 4h4v2H6v-2zm6 0h6v2h-6v-2zM6 19h12v2H6v-2z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    [BubbleType.JOB]: '<path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z"/>',
    [BubbleType.PAYMENT]: '<path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>',
    [BubbleType.EMERGENCY]: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
    [BubbleType.PLATFORM]: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
    [BubbleType.NEGOTIATION]: '<path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/>',
    [BubbleType.PRODUCT]: '<path d="M12 2l-5.5 9h11z"/><circle cx="17.5" cy="17.5" r="4.5"/><path d="M3 13.5h8v8H3z"/>',
    [BubbleType.ADS]: '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
    [BubbleType.ANALYTICS]: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    [BubbleType.WALLET]: '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M20 12v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/><path d="M18 12h2"/>',
    [BubbleType.SUBCHAT]: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    [BubbleType.SUGGESTIONS]: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    [BubbleType.SETTINGS]: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    [BubbleType.FASHION]: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
    [BubbleType.GROCERY]: '<path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>',
    [BubbleType.DELIVERY]: '<path d="M18 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/><path d="M4 13h10.5v-2H4v2zm0-4h6V7H4v2zm13-2.5V11h2.5l-2.5-2.5z"/>',
    [BubbleType.CHAT]: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    [BubbleType.SERVICE]: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
    [BubbleType.DASHBOARD]: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
    [BubbleType.AD]: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
  };

  return icons[type] || icons[BubbleType.SERVICE] || '<circle cx="12" cy="12" r="10"/>';
}
