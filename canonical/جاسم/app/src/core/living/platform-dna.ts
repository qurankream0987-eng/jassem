// ============================================================================
// Platform DNA Engine — كل منصة لها DNA فريد لا يتكرر
// ============================================================================

import { PlatformCategory } from './types';
import type {
  PlatformDNA,
  PlatformCategory as PC,
  PlatformFeature,
  PlatformIntent,
} from './types';

// ======== DNA SEED POOLS — genetic material for each category ========

const COLOR_PALETTES: Record<PC, string[][]> = {
  [PlatformCategory.RESTAURANT]: [
    ['#FF6B00', '#FFB800', '#FF4500', '#FFD700', '#FF8C00'], // warm food
    ['#E63946', '#F4A261', '#E9C46A', '#F3722C', '#F8961E'], // appetizing
    ['#2A9D8F', '#E9C46A', '#F4A261', '#E76F51', '#264653'], // elegant
  ],
  [PlatformCategory.CAR_REPAIR]: [
    ['#4A5568', '#ED8936', '#2D3748', '#DD6B20', '#1A202C'], // garage
    ['#3182CE', '#63B3ED', '#2B6CB0', '#4299E1', '#1A365D'], // trust
    ['#38A169', '#68D391', '#2F855A', '#48BB78', '#1C4532'], // reliable
  ],
  [PlatformCategory.PHARMACY]: [
    ['#319795', '#4FD1C5', '#285E61', '#38B2AC', '#234E52'],
    ['#805AD5', '#B794F4', '#6B46C1', '#9F7AEA', '#44337A'],
  ],
  [PlatformCategory.FASHION]: [
    ['#D53F8C', '#F687B3', '#B83280', '#ED64A6', '#97266D'],
    ['#6B46C1', '#9F7AEA', '#553C9A', '#805AD5', '#44337A'],
  ],
  [PlatformCategory.GROCERY]: [
    ['#38A169', '#68D391', '#2F855A', '#48BB78', '#276749'],
    ['#D69E2E', '#ECC94B', '#B7791F', '#F6E05E', '#975A16'],
  ],
  [PlatformCategory.REAL_ESTATE]: [
    ['#2B6CB0', '#63B3ED', '#2C5282', '#4299E1', '#1A365D'],
    ['#744210', '#975A16', '#5D3A1A', '#B7791F', '#4A2C0A'],
  ],
  [PlatformCategory.SALON]: [
    ['#D53F8C', '#F687B3', '#B83280', '#ED64A6', '#97266D'],
    ['#805AD5', '#B794F4', '#6B46C1', '#9F7AEA', '#44337A'],
  ],
  [PlatformCategory.CLINIC]: [
    ['#319795', '#4FD1C5', '#285E61', '#38B2AC', '#234E52'],
    ['#E53E3E', '#FC8181', '#C53030', '#F56565', '#742A2A'],
  ],
  [PlatformCategory.MARKETPLACE]: [
    ['#DD6B20', '#F6AD55', '#C05621', '#ED8936', '#7B341E'],
    ['#805AD5', '#B794F4', '#6B46C1', '#9F7AEA', '#44337A'],
  ],
  [PlatformCategory.DELIVERY]: [
    ['#3182CE', '#63B3ED', '#2B6CB0', '#4299E1', '#1A365D'],
    ['#38A169', '#68D391', '#2F855A', '#48BB78', '#1C4532'],
  ],
  [PlatformCategory.EDUCATION]: [
    ['#2B6CB0', '#63B3ED', '#2C5282', '#4299E1', '#1A365D'],
    ['#D69E2E', '#ECC94B', '#B7791F', '#F6E05E', '#975A16'],
  ],
  [PlatformCategory.FITNESS]: [
    ['#38A169', '#68D391', '#2F855A', '#48BB78', '#1C4532'],
    ['#E53E3E', '#FC8181', '#C53030', '#F56565', '#742A2A'],
  ],
  [PlatformCategory.EVENT]: [
    ['#D69E2E', '#ECC94B', '#B7791F', '#F6E05E', '#975A16'],
    ['#805AD5', '#B794F4', '#6B46C1', '#9F7AEA', '#44337A'],
  ],
  [PlatformCategory.CUSTOM]: [
    ['#4A5568', '#A0AEC0', '#2D3748', '#718096', '#1A202C'],
    ['#DD6B20', '#F6AD55', '#C05621', '#ED8936', '#7B341E'],
  ],
};

// ======== FEATURE LIBRARY — all possible features per category ========

const FEATURE_LIBRARY: Record<PC, Array<{ name: string; nameAr: string; iconSvg: string; requiresAgents: number }>> = {
  [PlatformCategory.RESTAURANT]: [
    { name: 'QR Ordering', nameAr: 'الطلب بالـ QR', iconSvg: 'qr', requiresAgents: 1 },
    { name: 'Menu Builder', nameAr: 'منشئ القائمة', iconSvg: 'menu', requiresAgents: 1 },
    { name: 'Order Management', nameAr: 'إدارة الطلبات', iconSvg: 'orders', requiresAgents: 2 },
    { name: 'Kitchen Display', nameAr: 'شاشة المطبخ', iconSvg: 'kitchen', requiresAgents: 1 },
    { name: 'Delivery Dispatch', nameAr: 'إرسال الطلبات', iconSvg: 'delivery', requiresAgents: 2 },
    { name: 'Payment Bridge', nameAr: 'بوابة الدفع', iconSvg: 'payment', requiresAgents: 1 },
    { name: 'Table Management', nameAr: 'إدارة الطاولات', iconSvg: 'table', requiresAgents: 1 },
    { name: 'Loyalty Program', nameAr: 'برنامج الولاء', iconSvg: 'loyalty', requiresAgents: 1 },
    { name: 'Analytics Dashboard', nameAr: 'لوحة التحليلات', iconSvg: 'analytics', requiresAgents: 1 },
    { name: 'Customer Reviews', nameAr: 'تقييمات العملاء', iconSvg: 'reviews', requiresAgents: 1 },
  ],
  [PlatformCategory.CAR_REPAIR]: [
    { name: 'Garage Profiles', nameAr: 'ملفات الورش', iconSvg: 'garage', requiresAgents: 1 },
    { name: 'Booking System', nameAr: 'نظام الحجز', iconSvg: 'calendar', requiresAgents: 2 },
    { name: 'Quote Comparison', nameAr: 'مقارنة العروض', iconSvg: 'compare', requiresAgents: 2 },
    { name: 'GPS Tracking', nameAr: 'تتبع GPS', iconSvg: 'gps', requiresAgents: 1 },
    { name: 'Progress Tracking', nameAr: 'تتبع التقدم', iconSvg: 'progress', requiresAgents: 1 },
    { name: 'Review System', nameAr: 'نظام التقييم', iconSvg: 'reviews', requiresAgents: 1 },
    { name: 'Pickup Service', nameAr: 'خدمة الاستلام', iconSvg: 'pickup', requiresAgents: 1 },
    { name: 'Parts Inventory', nameAr: 'مخزون القطع', iconSvg: 'inventory', requiresAgents: 1 },
    { name: 'Warranty Manager', nameAr: 'إدارة الضمان', iconSvg: 'warranty', requiresAgents: 1 },
    { name: 'Insurance Link', nameAr: 'ربط التأمين', iconSvg: 'insurance', requiresAgents: 1 },
  ],
  [PlatformCategory.PHARMACY]: [
    { name: 'Drug Catalog', nameAr: 'كتالوج الأدوية', iconSvg: 'drug', requiresAgents: 1 },
    { name: 'Prescription Upload', nameAr: 'رفع الوصفات', iconSvg: 'prescription', requiresAgents: 1 },
    { name: 'Insurance Claims', nameAr: 'مطالبات التأمين', iconSvg: 'insurance', requiresAgents: 1 },
    { name: 'Delivery', nameAr: 'التوصيل', iconSvg: 'delivery', requiresAgents: 1 },
    { name: 'Drug Interactions', nameAr: 'تفاعلات الأدوية', iconSvg: 'interactions', requiresAgents: 1 },
  ],
  [PlatformCategory.FASHION]: [
    { name: 'Lookbook', nameAr: 'لوك بوك', iconSvg: 'lookbook', requiresAgents: 1 },
    { name: 'Size Guide', nameAr: 'دليل المقاسات', iconSvg: 'size', requiresAgents: 1 },
    { name: 'Virtual Try-On', nameAr: 'تجربة افتراضية', iconSvg: 'tryon', requiresAgents: 1 },
    { name: 'Wishlist', nameAr: 'المفضلة', iconSvg: 'wishlist', requiresAgents: 1 },
    { name: 'Style Advisor', nameAr: 'مستشار الأناقة', iconSvg: 'advisor', requiresAgents: 1 },
  ],
  [PlatformCategory.GROCERY]: [
    { name: 'Product Catalog', nameAr: 'كتالوج المنتجات', iconSvg: 'products', requiresAgents: 1 },
    { name: 'Smart Lists', nameAr: 'قوائم ذكية', iconSvg: 'lists', requiresAgents: 1 },
    { name: 'Subscription Box', nameAr: 'صندوق اشتراك', iconSvg: 'subscription', requiresAgents: 1 },
    { name: 'Delivery Slots', nameAr: 'مواعيد التوصيل', iconSvg: 'slots', requiresAgents: 1 },
    { name: 'Freshness Tracker', nameAr: 'تتبع الطزاجة', iconSvg: 'fresh', requiresAgents: 1 },
  ],
  [PlatformCategory.REAL_ESTATE]: [
    { name: 'Property Listings', nameAr: 'قوائم العقارات', iconSvg: 'property', requiresAgents: 1 },
    { name: 'Virtual Tours', nameAr: 'جولات افتراضية', iconSvg: 'tours', requiresAgents: 1 },
    { name: 'Mortgage Calculator', nameAr: 'حاسبة الرهن', iconSvg: 'mortgage', requiresAgents: 1 },
    { name: 'Document Vault', nameAr: 'خزنة المستندات', iconSvg: 'documents', requiresAgents: 1 },
    { name: 'Agent Connect', nameAr: 'تواصل مع الوكيل', iconSvg: 'agent', requiresAgents: 1 },
  ],
  [PlatformCategory.SALON]: [
    { name: 'Service Menu', nameAr: 'قائمة الخدمات', iconSvg: 'menu', requiresAgents: 1 },
    { name: 'Booking', nameAr: 'الحجز', iconSvg: 'calendar', requiresAgents: 1 },
    { name: 'Stylist Profiles', nameAr: 'ملفات المصممين', iconSvg: 'stylist', requiresAgents: 1 },
    { name: 'Before/After Gallery', nameAr: 'معرض قبل/بعد', iconSvg: 'gallery', requiresAgents: 1 },
  ],
  [PlatformCategory.CLINIC]: [
    { name: 'Appointments', nameAr: 'المواعيد', iconSvg: 'calendar', requiresAgents: 1 },
    { name: 'Patient Records', nameAr: 'سجلات المرضى', iconSvg: 'records', requiresAgents: 1 },
    { name: 'Telemedicine', nameAr: 'الطب عن بعد', iconSvg: 'telemedicine', requiresAgents: 1 },
    { name: 'Lab Results', nameAr: 'نتائج المختبر', iconSvg: 'lab', requiresAgents: 1 },
    { name: 'Prescriptions', nameAr: 'الوصفات الطبية', iconSvg: 'prescription', requiresAgents: 1 },
  ],
  [PlatformCategory.MARKETPLACE]: [
    { name: 'Vendor Onboarding', nameAr: 'تسجيل البائعين', iconSvg: 'vendor', requiresAgents: 1 },
    { name: 'Product Catalog', nameAr: 'كتالوج المنتجات', iconSvg: 'products', requiresAgents: 1 },
    { name: 'Cart & Checkout', nameAr: 'السلة والدفع', iconSvg: 'cart', requiresAgents: 1 },
    { name: 'Dispute Resolution', nameAr: 'حل النزاعات', iconSvg: 'dispute', requiresAgents: 1 },
    { name: 'Commission Engine', nameAr: 'محرك العمولات', iconSvg: 'commission', requiresAgents: 1 },
  ],
  [PlatformCategory.DELIVERY]: [
    { name: 'Route Optimization', nameAr: 'تحسين المسارات', iconSvg: 'route', requiresAgents: 1 },
    { name: 'Real-time Tracking', nameAr: 'التتبع اللحظي', iconSvg: 'tracking', requiresAgents: 1 },
    { name: 'Driver App', nameAr: 'تطبيق السائق', iconSvg: 'driver', requiresAgents: 2 },
    { name: 'Proof of Delivery', nameAr: 'إثبات التوصيل', iconSvg: 'pod', requiresAgents: 1 },
  ],
  [PlatformCategory.EDUCATION]: [
    { name: 'Course Builder', nameAr: 'منشئ الدورات', iconSvg: 'course', requiresAgents: 1 },
    { name: 'Student Portal', nameAr: 'بوابة الطلاب', iconSvg: 'student', requiresAgents: 1 },
    { name: 'Assessment Engine', nameAr: 'محرك التقييم', iconSvg: 'assessment', requiresAgents: 1 },
    { name: 'Live Classes', nameAr: 'حصص مباشرة', iconSvg: 'live', requiresAgents: 1 },
  ],
  [PlatformCategory.FITNESS]: [
    { name: 'Workout Plans', nameAr: 'خطط التمرين', iconSvg: 'workout', requiresAgents: 1 },
    { name: 'Nutrition Tracker', nameAr: 'تتبع التغذية', iconSvg: 'nutrition', requiresAgents: 1 },
    { name: 'Progress Photos', nameAr: 'صور التقدم', iconSvg: 'photos', requiresAgents: 1 },
    { name: 'Trainer Connect', nameAr: 'تواصل مع المدرب', iconSvg: 'trainer', requiresAgents: 1 },
  ],
  [PlatformCategory.EVENT]: [
    { name: 'Event Builder', nameAr: 'منشئ الفعاليات', iconSvg: 'event', requiresAgents: 1 },
    { name: 'Ticketing', nameAr: 'التذاكر', iconSvg: 'tickets', requiresAgents: 1 },
    { name: 'Guest Management', nameAr: 'إدارة الضيوف', iconSvg: 'guests', requiresAgents: 1 },
    { name: 'Vendor Coordination', nameAr: 'تنسيق الموردين', iconSvg: 'vendors', requiresAgents: 1 },
  ],
  [PlatformCategory.CUSTOM]: [
    { name: 'Custom Feature 1', nameAr: 'ميزة مخصصة ١', iconSvg: 'custom', requiresAgents: 1 },
    { name: 'Custom Feature 2', nameAr: 'ميزة مخصصة ٢', iconSvg: 'custom', requiresAgents: 1 },
    { name: 'Custom Feature 3', nameAr: 'ميزة مخصصة ٣', iconSvg: 'custom', requiresAgents: 1 },
  ],
};

// ======== NAME GENERATOR ========

const NAME_PREFIXES: Record<PC, { ar: string[]; en: string[] }> = {
  [PlatformCategory.RESTAURANT]: {
    ar: ['مائدة', 'سفرة', 'نكهة', 'طبق', 'شهية', 'وليمة', 'بيت'],
    en: ['Table', 'Flavor', 'Dish', 'Feast', 'Taste', 'Plate', 'Kitchen'],
  },
  [PlatformCategory.CAR_REPAIR]: {
    ar: ['ورشة', 'سيارة', 'محرك', 'درب', 'سرعة', 'حماية'],
    en: ['Garage', 'Auto', 'Motor', 'Drive', 'Speed', 'Fix'],
  },
  [PlatformCategory.PHARMACY]: {
    ar: ['صيدلية', 'صحة', 'علاج', 'رعاية'],
    en: ['Pharma', 'Health', 'Care', 'Cure', 'Med'],
  },
  [PlatformCategory.FASHION]: {
    ar: ['أناقة', 'موضة', 'زي', 'جمال'],
    en: ['Style', 'Vogue', 'Chic', 'Trend', 'Mode'],
  },
  [PlatformCategory.GROCERY]: {
    ar: ['بقالة', 'طازج', 'سوق', 'خيرات'],
    en: ['Fresh', 'Market', 'Grocery', 'Harvest'],
  },
  [PlatformCategory.REAL_ESTATE]: {
    ar: ['عقار', 'مسكن', 'بيت', 'دار'],
    en: ['Home', 'Estate', 'Property', 'Nest'],
  },
  [PlatformCategory.SALON]: {
    ar: ['صالون', 'جمال', 'أناقة', 'لمسة'],
    en: ['Salon', 'Glow', 'Beauty', 'Touch'],
  },
  [PlatformCategory.CLINIC]: {
    ar: ['عيادة', 'صحة', 'رعاية', 'طبيب'],
    en: ['Clinic', 'Health', 'Care', 'Med'],
  },
  [PlatformCategory.MARKETPLACE]: {
    ar: ['سوق', 'تاجر', 'بازار', 'منتجات'],
    en: ['Market', 'Hub', 'Bazaar', 'Trade'],
  },
  [PlatformCategory.DELIVERY]: {
    ar: ['توصيل', 'سرعة', 'وصل', 'مندوب'],
    en: ['Deliver', 'Swift', 'Rush', 'Go'],
  },
  [PlatformCategory.EDUCATION]: {
    ar: ['تعليم', 'معرفة', 'درس', 'أكاديمية'],
    en: ['Edu', 'Learn', 'Academy', 'Mind'],
  },
  [PlatformCategory.FITNESS]: {
    ar: ['لياقة', 'قوة', 'تمرين', 'صحة'],
    en: ['Fit', 'Strong', 'Gym', 'Active'],
  },
  [PlatformCategory.EVENT]: {
    ar: ['فعالية', 'حدث', 'احتفال', 'لقاء'],
    en: ['Event', 'Fest', 'Gather', 'Meet'],
  },
  [PlatformCategory.CUSTOM]: {
    ar: ['مشروع', 'منصة', 'حل', 'نظام'],
    en: ['Project', 'Platform', 'Solution', 'Hub'],
  },
};

const NAME_SUFFIXES: Record<PC, { ar: string[]; en: string[] }> = {
  [PlatformCategory.RESTAURANT]: { ar: ['الذكية', 'المميزة', 'الحية', 'السريعة'], en: ['Smart', 'Pro', 'Live', 'Express'] },
  [PlatformCategory.CAR_REPAIR]: { ar: ['الذكية', 'المتنقلة', 'السريعة', 'الموثوقة'], en: ['Smart', 'Mobile', 'Fast', 'Trust'] },
  [PlatformCategory.PHARMACY]: { ar: ['الذكية', 'الرقمية', 'السريعة'], en: ['Smart', 'Digital', 'Quick'] },
  [PlatformCategory.FASHION]: { ar: ['الذكية', 'المميزة', 'العصرية'], en: ['Smart', 'Premium', 'Trendy'] },
  [PlatformCategory.GROCERY]: { ar: ['الذكية', 'الطازجة', 'السريعة'], en: ['Smart', 'Fresh', 'Quick'] },
  [PlatformCategory.REAL_ESTATE]: { ar: ['الذكية', 'الرقمية', 'المتطورة'], en: ['Smart', 'Digital', 'Prime'] },
  [PlatformCategory.SALON]: { ar: ['الذكية', 'المميزة', 'الفاخرة'], en: ['Smart', 'Premium', 'Lux'] },
  [PlatformCategory.CLINIC]: { ar: ['الذكية', 'الرقمية', 'المتطورة'], en: ['Smart', 'Digital', 'Care'] },
  [PlatformCategory.MARKETPLACE]: { ar: ['الذكي', 'الرقمي', 'المتطور'], en: ['Smart', 'Hub', 'Prime'] },
  [PlatformCategory.DELIVERY]: { ar: ['الذكي', 'السريع', 'المتطور'], en: ['Smart', 'Fast', 'Pro'] },
  [PlatformCategory.EDUCATION]: { ar: ['الذكية', 'الرقمية', 'المتطورة'], en: ['Smart', 'Digital', 'Plus'] },
  [PlatformCategory.FITNESS]: { ar: ['الذكية', 'المتطورة', 'الحية'], en: ['Smart', 'Pro', 'Active'] },
  [PlatformCategory.EVENT]: { ar: ['الذكية', 'الحية', 'المتطورة'], en: ['Smart', 'Live', 'Pro'] },
  [PlatformCategory.CUSTOM]: { ar: ['الذكي', 'المخصص', 'المتطور'], en: ['Smart', 'Custom', 'Pro'] },
};

// ======== SEEDED RANDOM ========

function seededRandom(seed: string): () => number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
  }
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

// ======== GENERATE UNIQUE DNA ========

export function generatePlatformDNA(intent: PlatformIntent): PlatformDNA {
  const cat = intent.category;
  const seed = intent.originalText + Date.now();
  const rng = seededRandom(seed);

  // Select color palette (deterministic from seed)
  const palettes = COLOR_PALETTES[cat] || COLOR_PALETTES[PlatformCategory.CUSTOM];
  const palette = palettes[Math.floor(rng() * palettes.length)];

  // Generate 32-float gene sequence
  const geneSequence = Array.from({ length: 32 }, () => rng());

  // Generate name
  const prefixPool = NAME_PREFIXES[cat] || NAME_PREFIXES[PlatformCategory.CUSTOM];
  const suffixPool = NAME_SUFFIXES[cat] || NAME_SUFFIXES[PlatformCategory.CUSTOM];
  const prefixAr = prefixPool.ar[Math.floor(rng() * prefixPool.ar.length)];
  const suffixAr = suffixPool.ar[Math.floor(rng() * suffixPool.ar.length)];
  const prefixEn = prefixPool.en[Math.floor(rng() * prefixPool.en.length)];
  const suffixEn = suffixPool.en[Math.floor(rng() * suffixPool.en.length)];
  const nameAr = `${prefixAr} ${suffixAr}`;
  const nameEn = `${prefixEn}${suffixEn}`;

  // Generate features (subset based on complexity)
  const allFeatures = FEATURE_LIBRARY[cat] || FEATURE_LIBRARY[PlatformCategory.CUSTOM];
  const featureCount = Math.max(3, Math.floor(intent.complexity * allFeatures.length));
  const shuffled = [...allFeatures].sort(() => rng() - 0.5);
  const selectedFeatures = shuffled.slice(0, featureCount);

  const features: PlatformFeature[] = selectedFeatures.map((f, i) => ({
    id: `feat_${cat}_${i}`,
    name: f.name,
    nameAr: f.nameAr,
    isCore: i < 3, // first 3 are core
    isEnabled: true,
    priority: Math.floor(rng() * 100),
    iconSvg: f.iconSvg,
    requiresAgents: f.requiresAgents,
  }));

  // Calculate agent count from features
  const agentCount = features.reduce((sum, f) => sum + f.requiresAgents, 0);

  // Personality from gene sequence
  const personality = {
    friendliness: 0.5 + geneSequence[0] * 0.5,
    professionalism: 0.5 + geneSequence[1] * 0.5,
    speed: 0.5 + geneSequence[2] * 0.5,
    thoroughness: 0.5 + geneSequence[3] * 0.5,
    creativity: 0.5 + geneSequence[4] * 0.5,
  };

  return {
    id: `dna_${Date.now()}_${Math.floor(rng() * 10000)}`,
    name: nameEn,
    nameAr: nameAr,
    slug: `${cat}_${Math.floor(rng() * 9999)}`,
    description: `AI-powered ${cat} platform generated by JASIM`,
    descriptionAr: `منصة ${nameAr} مدعومة بالذكاء الاصطناعي من جاسم`,
    category: cat,
    geneSequence,
    colors: {
      primary: palette[0],
      secondary: palette[1],
      accent: palette[2],
      glow: palette[3],
      warm: palette[4],
      cool: palette[1],
    },
    personality,
    features,
    agentCount,
    complexity: intent.complexity,
    createdAt: Date.now(),
    generation: 1,
  };
}

/** Evolve existing DNA to next generation */
export function evolveDNA(dna: PlatformDNA): PlatformDNA {
  const rng = seededRandom(dna.id + Date.now());
  const mutations = dna.geneSequence.map((g) => {
    const mutate = rng() < 0.1; // 10% mutation rate
    return mutate ? Math.max(0, Math.min(1, g + (rng() - 0.5) * 0.3)) : g;
  });

  // Potentially enable a new feature
  const newFeatures = dna.features.map((f) => ({
    ...f,
    priority: Math.min(100, f.priority + Math.floor(rng() * 10)),
  }));

  return {
    ...dna,
    geneSequence: mutations,
    generation: dna.generation + 1,
    features: newFeatures,
    personality: {
      friendliness: Math.min(1, dna.personality.friendliness + (rng() - 0.5) * 0.05),
      professionalism: Math.min(1, dna.personality.professionalism + (rng() - 0.5) * 0.05),
      speed: Math.min(1, dna.personality.speed + (rng() - 0.5) * 0.05),
      thoroughness: Math.min(1, dna.personality.thoroughness + (rng() - 0.5) * 0.05),
      creativity: Math.min(1, dna.personality.creativity + (rng() - 0.5) * 0.05),
    },
  };
}

/** Get DNA color gradient for visual display */
export function getDNAColorGradient(dna: PlatformDNA): string {
  return `linear-gradient(135deg, ${dna.colors.primary}, ${dna.colors.secondary}, ${dna.colors.accent})`;
}

/** Serialize DNA to a compact string (for storage/sharing) */
export function serializeDNA(dna: PlatformDNA): string {
  return btoa(JSON.stringify(dna));
}

/** Deserialize DNA from string */
export function deserializeDNA(serialized: string): PlatformDNA {
  return JSON.parse(atob(serialized));
}
