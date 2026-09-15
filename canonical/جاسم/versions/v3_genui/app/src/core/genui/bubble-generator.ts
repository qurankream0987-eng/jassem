// ============================================================================
// Bubble Generator v3.0 — يولد فقاعات حية من النية المصنفة
// ============================================================================


import { BubbleType, BubbleSize } from './types';
import type { BubbleExpression, BubbleContent, BubbleGene, IntentResult } from './types';
import { getDNA } from './dna-templates';
import { getBubbleIconSvg } from './intent-classifier';

let BUBBLE_ID_COUNTER = 0;

/** توليد ID فريد */
function genId(): string {
  return `bubble_${Date.now()}_${++BUBBLE_ID_COUNTER}`;
}

/** حساب موقع مناسب للفقاعة (غير متعارض) */
function computePosition(type: BubbleType, existingPositions: Array<{ x: number; y: number; r: number }>, screenW: number, screenH: number): { x: number; y: number } {
  // مناطق مفضلة حسب نوع الفقاعة (dispersed layout)
  const preferredZones: Record<string, Array<{ x: number; y: number }>> = {
    [BubbleType.ADS]: [{ x: 0.15, y: 0.25 }, { x: 0.1, y: 0.35 }],
    [BubbleType.SUGGESTIONS]: [{ x: 0.85, y: 0.2 }, { x: 0.9, y: 0.3 }],
    [BubbleType.ANALYTICS]: [{ x: 0.5, y: 0.12 }, { x: 0.4, y: 0.08 }],
    [BubbleType.WALLET]: [{ x: 0.88, y: 0.6 }, { x: 0.92, y: 0.5 }],
    [BubbleType.SUBCHAT]: [{ x: 0.12, y: 0.65 }, { x: 0.08, y: 0.55 }],
    [BubbleType.SETTINGS]: [{ x: 0.5, y: 0.88 }, { x: 0.6, y: 0.85 }],
    [BubbleType.FOOD]: [{ x: 0.2, y: 0.2 }, { x: 0.15, y: 0.15 }],
    [BubbleType.RESTAURANT]: [{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.15 }],
    [BubbleType.JOB]: [{ x: 0.8, y: 0.25 }, { x: 0.75, y: 0.2 }],
    [BubbleType.RECRUITMENT]: [{ x: 0.15, y: 0.7 }, { x: 0.2, y: 0.75 }],
    [BubbleType.PHARMACY]: [{ x: 0.85, y: 0.4 }, { x: 0.8, y: 0.35 }],
    [BubbleType.FASHION]: [{ x: 0.3, y: 0.8 }, { x: 0.35, y: 0.75 }],
    [BubbleType.GROCERY]: [{ x: 0.7, y: 0.75 }, { x: 0.65, y: 0.8 }],
    [BubbleType.DELIVERY]: [{ x: 0.8, y: 0.8 }, { x: 0.75, y: 0.75 }],
    [BubbleType.PAYMENT]: [{ x: 0.5, y: 0.5 }, { x: 0.45, y: 0.45 }],
    [BubbleType.PLATFORM]: [{ x: 0.5, y: 0.3 }, { x: 0.45, y: 0.25 }],
    [BubbleType.NEGOTIATION]: [{ x: 0.7, y: 0.3 }, { x: 0.65, y: 0.25 }],
    [BubbleType.EMERGENCY]: [{ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }],
    [BubbleType.PRODUCT]: [{ x: 0.3, y: 0.35 }, { x: 0.25, y: 0.3 }],
    [BubbleType.SERVICE]: [{ x: 0.7, y: 0.55 }, { x: 0.65, y: 0.5 }],
  };

  const zones = preferredZones[type] || [{ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }];

  // اختر أول منطقة غير متعارضة
  for (const zone of zones) {
    const px = zone.x * screenW;
    const py = zone.y * screenH;
    // تحقق من التعارض
    let conflict = false;
    for (const ex of existingPositions) {
      const dx = px - ex.x;
      const dy = py - ex.y;
      const minDist = 120; // minimum distance between bubbles
      if (Math.sqrt(dx * dx + dy * dy) < minDist) {
        conflict = true;
        break;
      }
    }
    if (!conflict) {
      // إضافة ضوضاء طفيفة للتنويع
      return {
        x: px + (Math.random() - 0.5) * 40,
        y: py + (Math.random() - 0.5) * 40,
      };
    }
  }

  // احتياطي: موقع عشوائي مع التحقق من التعارض
  for (let attempts = 0; attempts < 20; attempts++) {
    const px = 100 + Math.random() * (screenW - 200);
    const py = 80 + Math.random() * (screenH - 300);
    let conflict = false;
    for (const ex of existingPositions) {
      const dx = px - ex.x;
      const dy = py - ex.y;
      if (Math.sqrt(dx * dx + dy * dy) < 120) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return { x: px, y: py };
  }

  // último recurso
  return { x: screenW / 2 + (Math.random() - 0.5) * 200, y: screenH / 2 + (Math.random() - 0.5) * 200 };
}

/** توليد المحتوى الداخلي للفقاعة */
function generateContent(intent: IntentResult): BubbleContent {
  const arabicLabels: Record<string, string> = {
    [BubbleType.FOOD]: 'طعام',
    [BubbleType.RESTAURANT]: 'مطعم',
    [BubbleType.PHARMACY]: 'صيدلية',
    [BubbleType.FASHION]: 'موضة',
    [BubbleType.GROCERY]: 'بقالة',
    [BubbleType.DELIVERY]: 'توصيل',
    [BubbleType.JOB]: 'وظيفة',
    [BubbleType.RECRUITMENT]: 'توظيف',
    [BubbleType.PAYMENT]: 'دفع',
    [BubbleType.WALLET]: 'محفظة',
    [BubbleType.EMERGENCY]: 'طوارئ',
    [BubbleType.PLATFORM]: 'منصة',
    [BubbleType.NEGOTIATION]: 'تفاوض',
    [BubbleType.PRODUCT]: 'منتج',
    [BubbleType.AD]: 'إعلان',
    [BubbleType.ADS]: 'إعلانات',
    [BubbleType.ANALYTICS]: 'تحليلات',
    [BubbleType.SUGGESTIONS]: 'اقتراحات',
    [BubbleType.SETTINGS]: 'إعدادات',
    [BubbleType.SUBCHAT]: 'دردشة',
    [BubbleType.CHAT]: 'محادثة',
    [BubbleType.DASHBOARD]: 'لوحة',
    [BubbleType.SERVICE]: 'خدمة',
  };

  const typeLabel = arabicLabels[intent.type] || 'جاسم';

  // محتوى مخصص حسب النوع
  const contentMap: Partial<Record<BubbleType, Partial<BubbleContent>>> = {
    [BubbleType.FOOD]: {
      title: `ابحث عن ${typeLabel}`,
      subtitle: 'أقرب المطاعم إليك',
      body: 'جاسم يختار لك أفضل الخيارات بالسعر والجودة',
      actions: [{ label: 'ابحث', action: 'search_food', style: 'primary' }, { label: 'عروض', action: 'show_offers', style: 'secondary' }],
      iconType: 'chart-bar',
      accentColor: '#FFD740',
    },
    [BubbleType.RESTAURANT]: {
      title: 'مطاعم قريبة',
      subtitle: 'توصيل سريع',
      body: 'اكتشف مطاعم جديدة بأفضل العروض',
      actions: [{ label: 'استكشاف', action: 'explore_restaurants', style: 'primary' }],
      iconType: 'chart-bar',
      accentColor: '#FF9800',
    },
    [BubbleType.JOB]: {
      title: 'وظائف متاحة',
      subtitle: 'بناءً على مهاراتك',
      body: 'جاسم يبحث عن أفضل الفرص لك',
      actions: [{ label: 'تصفح', action: 'browse_jobs', style: 'primary' }, { label: 'سيرتي', action: 'upload_cv', style: 'secondary' }],
      iconType: 'person',
      accentColor: '#FF6E40',
    },
    [BubbleType.RECRUITMENT]: {
      title: 'التوظيف الذكي',
      subtitle: 'أفضل المرشحين',
      body: 'جاسم يقترح مرشحين بناءً على متطلباتك',
      actions: [{ label: 'نشر وظيفة', action: 'post_job', style: 'primary' }],
      iconType: 'person',
      accentColor: '#009688',
    },
    [BubbleType.PAYMENT]: {
      title: 'المدفوعات',
      subtitle: 'آمن وسريع',
      body: 'أدفع فواتيرك وحمّل رصيدك بكل سهولة',
      actions: [{ label: 'ادفع', action: 'pay_now', style: 'primary' }, { label: 'التحويلات', action: 'transfers', style: 'secondary' }],
      iconType: 'dollar',
      accentColor: '#00E676',
    },
    [BubbleType.WALLET]: {
      title: 'المحفظة',
      subtitle: 'رصيدك ومعاملاتك',
      body: 'تابع رصيدك ومعاملاتك المالية',
      actions: [{ label: 'عرض', action: 'view_wallet', style: 'primary' }],
      iconType: 'dollar',
      accentColor: '#00c896',
    },
    [BubbleType.EMERGENCY]: {
      title: 'طوارئ!',
      subtitle: 'جاسم يساعدك فوراً',
      body: 'اتصال مباشر بالطوارئ والإسعاف',
      actions: [{ label: 'اتصال', action: 'call_emergency', style: 'danger' }, { label: 'موقعي', action: 'share_location', style: 'primary' }],
      iconType: 'alert',
      accentColor: '#FF1744',
    },
    [BubbleType.PLATFORM]: {
      title: 'بناء منصة',
      subtitle: 'جاسم يبني لك',
      body: 'وصف منصتك وسنبنيها لك بالذكاء الاصطناعي',
      actions: [{ label: 'ابدأ', action: 'start_build', style: 'primary' }, { label: 'قوالب', action: 'show_templates', style: 'secondary' }],
      iconType: 'code',
      accentColor: '#64FFDA',
    },
    [BubbleType.NEGOTIATION]: {
      title: 'تفاوض ذكي',
      subtitle: 'جاسم يتفاوض لك',
      body: 'احصل على أفضل سعر بالتفاوض الآلي',
      actions: [{ label: 'تفاوض', action: 'start_haggle', style: 'primary' }],
      iconType: 'chat',
      accentColor: '#FFD740',
    },
    [BubbleType.PRODUCT]: {
      title: 'منتجات',
      subtitle: 'تسوق ذكي',
      body: 'اكتشف منتجات مخصصة لك',
      actions: [{ label: 'تصفح', action: 'browse_products', style: 'primary' }],
      iconType: 'box',
      accentColor: '#448AFF',
    },
    [BubbleType.ADS]: {
      title: 'إعلاناتي',
      subtitle: 'أداء حملاتك',
      body: 'تابع أداء إعلاناتك بالتفصيل',
      actions: [{ label: 'لوحة التحكم', action: 'ad_dashboard', style: 'primary' }],
      iconType: 'chart-bar',
      accentColor: '#FF6B00',
    },
    [BubbleType.ANALYTICS]: {
      title: 'التحليلات',
      subtitle: 'إحصائيات متقدمة',
      body: 'تحليلات عميقة لأداء نشاطك',
      actions: [{ label: 'عرض', action: 'view_analytics', style: 'primary' }],
      iconType: 'chart-line',
      accentColor: '#ec4899',
    },
    [BubbleType.SUGGESTIONS]: {
      title: 'اقتراحات',
      subtitle: 'توصيات ذكية',
      body: 'جاسم يقترح لك بناءً على تفضيلاتك',
      actions: [{ label: 'استكشاف', action: 'explore_suggestions', style: 'primary' }],
      iconType: 'star',
      accentColor: '#00d4ff',
    },
    [BubbleType.SETTINGS]: {
      title: 'الإعدادات',
      subtitle: 'إدارة حسابك',
      body: 'تخصيص تجربتك مع جاسم',
      actions: [{ label: 'تعديل', action: 'edit_settings', style: 'primary' }],
      iconType: 'gear',
      accentColor: '#94a3b8',
    },
    [BubbleType.SUBCHAT]: {
      title: 'دردشة فرعية',
      subtitle: 'محادثاتك النشطة',
      body: 'تواصل مع التجار والمستخدمين',
      actions: [{ label: 'فتح', action: 'open_chat', style: 'primary' }],
      iconType: 'chat-bubble',
      accentColor: '#a855f7',
    },
    [BubbleType.PHARMACY]: {
      title: 'صيدليات',
      subtitle: 'أقرب صيدلية',
      body: 'ابحث عن الأدوية والصيدليات القريبة',
      actions: [{ label: 'بحث', action: 'search_pharmacy', style: 'primary' }],
      iconType: 'cross',
      accentColor: '#00C853',
    },
    [BubbleType.FASHION]: {
      title: 'أزياء',
      subtitle: 'آخر الصيحات',
      body: 'اكتشف أحدث trends في الموضة',
      actions: [{ label: 'تصفح', action: 'browse_fashion', style: 'primary' }],
      iconType: 'heart',
      accentColor: '#F48FB1',
    },
    [BubbleType.GROCERY]: {
      title: 'بقالة',
      subtitle: 'تسوق يومي',
      body: 'اطلب خضار وفواكه ومواد غذائية',
      actions: [{ label: 'اطلب', action: 'order_grocery', style: 'primary' }],
      iconType: 'cart',
      accentColor: '#795548',
    },
    [BubbleType.DELIVERY]: {
      title: 'توصيل',
      subtitle: 'تتبع شحناتك',
      body: 'تابع طلباتك وشحناتك لحظياً',
      actions: [{ label: 'تتبع', action: 'track_delivery', style: 'primary' }],
      iconType: 'truck',
      accentColor: '#03A9F4',
    },
  };

  const specific = contentMap[intent.type] || {};

  return {
    title: specific.title || typeLabel,
    subtitle: specific.subtitle || 'جاسم يخدمك',
    body: specific.body || 'اطلب ما تريد وسنفعله لك',
    actions: specific.actions || [{ label: 'فتح', action: 'open', style: 'primary' }],
    metadata: { intent: intent.originalText, entities: intent.entities },
    iconType: specific.iconType || 'circle',
    accentColor: specific.accentColor || '#64FFDA',
  };
}

/** توليد فقاعة كاملة من النية */
export function generateBubble(
  intent: IntentResult,
  existingPositions: Array<{ x: number; y: number; r: number }>,
  screenW: number,
  screenH: number
): BubbleExpression {
  const dna = getDNA(intent.type);
  const content = generateContent(intent);
  const position = computePosition(intent.type, existingPositions, screenW, screenH);

  // حجم الفقاعة حسب الثقة والنوع
  let radius: number;
  if (intent.confidence > 0.8) radius = 75;
  else if (intent.confidence > 0.5) radius = 65;
  else radius = 55;

  // Emergency bubbles are bigger
  if (intent.type === BubbleType.EMERGENCY) radius = 85;

  const size = radius > 70 ? BubbleSize.STANDARD : radius > 60 ? BubbleSize.COMPACT : BubbleSize.MICRO;

  return {
    id: genId(),
    gene: dna,
    content,
    bubbleType: intent.type,
    size,
    position,
    radius,
    streamMode: true,
    expandable: true,
    createdAt: Date.now(),
  };
}

/** توليد فقاعات أولية عند فتح التطبيق (welcome bubbles) */
export function generateWelcomeBubbles(screenW: number, screenH: number): BubbleExpression[] {
  const welcomeIntents: IntentResult[] = [
    { type: BubbleType.ADS, confidence: 0.9, entities: [], originalText: 'إعلانات' },
    { type: BubbleType.SUGGESTIONS, confidence: 0.9, entities: [], originalText: 'اقتراحات' },
    { type: BubbleType.ANALYTICS, confidence: 0.9, entities: [], originalText: 'تحليلات' },
    { type: BubbleType.SUBCHAT, confidence: 0.9, entities: [], originalText: 'دردشة' },
    { type: BubbleType.WALLET, confidence: 0.9, entities: [], originalText: 'محفظة' },
    { type: BubbleType.SETTINGS, confidence: 0.9, entities: [], originalText: 'إعدادات' },
  ];

  const positions: Array<{ x: number; y: number; r: number }> = [];
  const bubbles: BubbleExpression[] = [];

  for (const intent of welcomeIntents) {
    const bubble = generateBubble(intent, positions, screenW, screenH);
    positions.push({ x: bubble.position.x, y: bubble.position.y, r: bubble.radius });
    bubbles.push(bubble);
  }

  return bubbles;
}

/** إعادة إحياء فقاعة منبثقة (respawn after 3 seconds) */
export function respawnBubble(
  original: BubbleExpression,
  existingPositions: Array<{ x: number; y: number; r: number }>,
  screenW: number,
  screenH: number
): BubbleExpression {
  const newPos = computePosition(original.bubbleType, existingPositions, screenW, screenH);
  return {
    ...original,
    id: genId(),
    position: newPos,
    createdAt: Date.now(),
  };
}

export { getBubbleIconSvg };
