/**
 * ============================================
 * BUBBLE GENERATOR
 * GenUI Bubble Generator for JASIM
 * ============================================
 * 
 * Generates interactive GenUI bubbles based on intent and agent results.
 * Each bubble is a self-contained JSON object (150-300 tokens max) with
 * type, theme, data payload, and priority for the frontend renderer.
 * 
 * Bubble JSON format: { type, theme, data, priority }
 */

import type {
  Bubble,
  BubbleTheme,
  BubbleType,
  ConversationContext,
  IntentType,
  SwarmResult,
} from "./types";

// ============================================
// THEME CONFIGURATION
// ============================================
interface ThemeConfig {
  colors: { primary: string; secondary: string; accent: string };
  icon: string;
  rtl: boolean;
}

const THEME_CONFIGS: Record<BubbleTheme, ThemeConfig> = {
  // ── FOOD ─────────────────────────────────
  spicy_food_night: {
    colors: { primary: "#FF6B35", secondary: "#1A1A2E", accent: "#FFD93D" },
    icon: "🌶️",
    rtl: true,
  },
  traditional_kabsa: {
    colors: { primary: "#D4A373", secondary: "#5C4033", accent: "#FAEDCD" },
    icon: "🍛",
    rtl: true,
  },
  family_feast: {
    colors: { primary: "#E63946", secondary: "#F1FAEE", accent: "#457B9D" },
    icon: "👨‍👩‍👧‍👦",
    rtl: true,
  },

  // ── FASHION ──────────────────────────────
  elegant_style: {
    colors: { primary: "#2B2D42", secondary: "#8D99AE", accent: "#D4AF37" },
    icon: "👗",
    rtl: true,
  },
  trendy_look: {
    colors: { primary: "#FF006E", secondary: "#FB5607", accent: "#FFBE0B" },
    icon: "👠",
    rtl: true,
  },
  modest_fashion: {
    colors: { primary: "#6A4C93", secondary: "#F8EDEB", accent: "#CB997E" },
    icon: "🧕",
    rtl: true,
  },

  // ── DELIVERY ─────────────────────────────
  fast_track: {
    colors: { primary: "#00F5D4", secondary: "#00BBF9", accent: "#FEE440" },
    icon: "⚡",
    rtl: true,
  },
  green_delivery: {
    colors: { primary: "#2D6A4F", secondary: "#52B788", accent: "#D8F3DC" },
    icon: "🌿",
    rtl: true,
  },
  night_rider: {
    colors: { primary: "#7B2CBF", secondary: "#10002B", accent: "#E0AAFF" },
    icon: "🌙",
    rtl: true,
  },

  // ── PAYMENT ──────────────────────────────
  secure_checkout: {
    colors: { primary: "#4361EE", secondary: "#3F37C9", accent: "#4CC9F0" },
    icon: "🔒",
    rtl: true,
  },
  biometric_verify: {
    colors: { primary: "#0096C7", secondary: "#023E8A", accent: "#48CAE4" },
    icon: "👆",
    rtl: true,
  },
  instant_pay: {
    colors: { primary: "#06D6A0", secondary: "#118AB2", accent: "#FFD166" },
    icon: "⚡",
    rtl: true,
  },

  // ── B2B ──────────────────────────────────
  wholesale_deal: {
    colors: { primary: "#FF7F51", secondary: "#705D56", accent: "#F6BD60" },
    icon: "📦",
    rtl: true,
  },
  bulk_order: {
    colors: { primary: "#264653", secondary: "#2A9D8F", accent: "#E9C46A" },
    icon: "🏭",
    rtl: true,
  },
  gold_partner: {
    colors: { primary: "#B8860B", secondary: "#8B6914", accent: "#FFD700" },
    icon: "🏆",
    rtl: true,
  },

  // ── HAGGLE ───────────────────────────────
  bazaar_deal: {
    colors: { primary: "#E36414", secondary: "#5F0F40", accent: "#FB8B24" },
    icon: "🤝",
    rtl: true,
  },
  smart_negotiate: {
    colors: { primary: "#3D405B", secondary: "#81B29A", accent: "#F2CC8F" },
    icon: "🧠",
    rtl: true,
  },
  win_win: {
    colors: { primary: "#2A9D8F", secondary: "#264653", accent: "#E9C46A" },
    icon: "✌️",
    rtl: true,
  },

  // ── FLEET ────────────────────────────────
  route_optimizer: {
    colors: { primary: "#457B9D", secondary: "#1D3557", accent: "#A8DADC" },
    icon: "🗺️",
    rtl: true,
  },
  driver_profile: {
    colors: { primary: "#6A994E", secondary: "#386641", accent: "#BC4749" },
    icon: "👤",
    rtl: true,
  },
  delivery_map: {
    colors: { primary: "#219EBC", secondary: "#023047", accent: "#FFB703" },
    icon: "📍",
    rtl: true,
  },

  // ── RECRUITMENT ──────────────────────────
  professional_cv: {
    colors: { primary: "#3C6E47", secondary: "#2D4A33", accent: "#A7C957" },
    icon: "📄",
    rtl: true,
  },
  job_match: {
    colors: { primary: "#7B2D8E", secondary: "#461E52", accent: "#DD99BB" },
    icon: "💼",
    rtl: true,
  },
  career_path: {
    colors: { primary: "#4361EE", secondary: "#3A0CA3", accent: "#F72585" },
    icon: "🚀",
    rtl: true,
  },

  // ── SAAS ─────────────────────────────────
  modern_dashboard: {
    colors: { primary: "#6366F1", secondary: "#1E1B4B", accent: "#22D3EE" },
    icon: "📊",
    rtl: true,
  },
  clean_form: {
    colors: { primary: "#10B981", secondary: "#064E3B", accent: "#6EE7B7" },
    icon: "📝",
    rtl: true,
  },
  data_visualization: {
    colors: { primary: "#8B5CF6", secondary: "#4C1D95", accent: "#C4B5FD" },
    icon: "📈",
    rtl: true,
  },

  // ── ISLAMIC ──────────────────────────────
  islamic_gold: {
    colors: { primary: "#C9A227", secondary: "#1B1B1B", accent: "#F5E6A3" },
    icon: "🌙",
    rtl: true,
  },
  halal_shield: {
    colors: { primary: "#059669", secondary: "#064E3B", accent: "#6EE7B7" },
    icon: "☪️",
    rtl: true,
  },
  zakat_pure: {
    colors: { primary: "#D4AF37", secondary: "#2C1810", accent: "#F5E6CC" },
    icon: "💛",
    rtl: true,
  },

  // ── GENERAL ──────────────────────────────
  default: {
    colors: { primary: "#6366F1", secondary: "#1E293B", accent: "#38BDF8" },
    icon: "✨",
    rtl: true,
  },
  error: {
    colors: { primary: "#EF4444", secondary: "#7F1D1D", accent: "#FCA5A5" },
    icon: "⚠️",
    rtl: true,
  },
  loading: {
    colors: { primary: "#3B82F6", secondary: "#1E3A5F", accent: "#93C5FD" },
    icon: "⏳",
    rtl: true,
  },
};

// ============================================
// INTENT → BUBBLE TYPE + THEME MAPPING
// ============================================
const INTENT_BUBBLE_MAP: Record<IntentType, Array<{ type: BubbleType; theme: BubbleTheme }>> = {
  food_order: [
    { type: "food", theme: "traditional_kabsa" },
    { type: "product", theme: "spicy_food_night" },
  ],
  product_search: [
    { type: "product", theme: "elegant_style" },
    { type: "bundle", theme: "trendy_look" },
  ],
  order_tracking: [
    { type: "tracking", theme: "delivery_map" },
    { type: "fleet", theme: "fast_track" },
  ],
  payment: [
    { type: "payment", theme: "secure_checkout" },
    { type: "payment", theme: "instant_pay" },
  ],
  cart_view: [
    { type: "product", theme: "default" },
  ],
  cart_add: [
    { type: "product", theme: "default" },
  ],
  cart_remove: [
    { type: "generic", theme: "default" },
  ],
  checkout: [
    { type: "payment", theme: "secure_checkout" },
  ],
  job_seeker: [
    { type: "cv", theme: "professional_cv" },
    { type: "job", theme: "job_match" },
  ],
  hire_worker: [
    { type: "job", theme: "career_path" },
    { type: "analytics", theme: "modern_dashboard" },
  ],
  create_store: [
    { type: "saas", theme: "modern_dashboard" },
    { type: "analytics", theme: "data_visualization" },
  ],
  haggle: [
    { type: "haggle", theme: "bazaar_deal" },
    { type: "haggle", theme: "smart_negotiate" },
  ],
  return_item: [
    { type: "generic", theme: "default" },
  ],
  dna_crossbreed: [
    { type: "a2a", theme: "modern_dashboard" },
  ],
  zakat_calculate: [
    { type: "zakat", theme: "islamic_gold" },
    { type: "zakat", theme: "zakat_pure" },
  ],
  islamic_check: [
    { type: "escrow", theme: "halal_shield" },
    { type: "zakat", theme: "islamic_gold" },
  ],
  fleet_track: [
    { type: "fleet", theme: "delivery_map" },
    { type: "fleet", theme: "route_optimizer" },
  ],
  biometric_auth: [
    { type: "payment", theme: "biometric_verify" },
  ],
  vision_scan: [
    { type: "generic", theme: "modern_dashboard" },
  ],
  voice_query: [
    { type: "generic", theme: "default" },
  ],
  saas_deploy: [
    { type: "saas", theme: "modern_dashboard" },
    { type: "saas", theme: "clean_form" },
  ],
  aggregator_browse: [
    { type: "aggregator", theme: "wholesale_deal" },
    { type: "product", theme: "elegant_style" },
  ],
  widget_embed: [
    { type: "widget", theme: "clean_form" },
  ],
  a2a_trade: [
    { type: "a2a", theme: "win_win" },
    { type: "haggle", theme: "smart_negotiate" },
  ],
  crossborder_order: [
    { type: "crossborder", theme: "gold_partner" },
    { type: "tracking", theme: "route_optimizer" },
  ],
  supplier_search: [
    { type: "merchant", theme: "wholesale_deal" },
    { type: "analytics", theme: "gold_partner" },
  ],
  analytics_view: [
    { type: "analytics", theme: "modern_dashboard" },
    { type: "analytics", theme: "data_visualization" },
  ],
  general_chat: [
    { type: "generic", theme: "default" },
  ],
  greeting: [
    { type: "generic", theme: "default" },
  ],
  help: [
    { type: "generic", theme: "default" },
  ],
  ambiguous: [
    { type: "generic", theme: "default" },
  ],
  error: [
    { type: "generic", theme: "error" },
  ],
};

// ============================================
// BUBBLE GENERATOR CLASS
// ============================================
export class BubbleGenerator {
  private bubbleIdCounter = 0;

  /**
   * Generate bubbles based on intent and agent results
   */
  async generate(
    context: ConversationContext,
    results: SwarmResult[],
  ): Promise<Bubble[]> {
    const bubbles: Bubble[] = [];

    if (results.length === 0) {
      return [this.createGenericBubble(context)];
    }

    // Group results by intent
    const resultsByIntent = this.groupByIntent(results);

    for (const [intent, intentResults] of resultsByIntent) {
      const bubbleDefs = INTENT_BUBBLE_MAP[intent] || [{ type: "generic" as BubbleType, theme: "default" as BubbleTheme }];

      for (const bubbleDef of bubbleDefs) {
        // Merge data from all results for this intent
        const mergedData = this.mergeResultData(intentResults);

        const bubble = await this.createBubble(
          bubbleDef.type,
          bubbleDef.theme,
          mergedData,
          context,
        );

        if (bubble) {
          bubbles.push(bubble);
        }
      }
    }

    // Sort by priority (highest first)
    bubbles.sort((a, b) => b.priority - a.priority);

    // Limit to 3 bubbles max to stay within token budget
    return bubbles.slice(0, 3);
  }

  /**
   * Group results by their intent type
   */
  private groupByIntent(results: SwarmResult[]): Map<IntentType, SwarmResult[]> {
    const map = new Map<IntentType, SwarmResult[]>();
    for (const result of results) {
      const existing = map.get(result.intent) || [];
      existing.push(result);
      map.set(result.intent, existing);
    }
    return map;
  }

  /**
   * Merge data from multiple results into a single data object
   */
  private mergeResultData(results: SwarmResult[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const result of results) {
      Object.assign(merged, result.data);
    }
    return merged;
  }

  /**
   * Create a single bubble with given type, theme, and data
   */
  private async createBubble(
    type: BubbleType,
    theme: BubbleTheme,
    data: Record<string, unknown>,
    context: ConversationContext,
  ): Promise<Bubble | null> {
    const config = THEME_CONFIGS[theme];

    switch (type) {
      case "product":
        return this.generateProductBubble(data, context, theme, config);
      case "tracking":
        return this.generateTrackingBubble(data, context, theme, config);
      case "payment":
        return this.generatePaymentBubble(data, context, theme, config);
      case "haggle":
        return this.generateHaggleBubble(data, context, theme, config);
      case "analytics":
        return this.generateAnalyticsBubble(data, context, theme, config);
      case "escrow":
        return this.generateEscrowBubble(data, context, theme, config);
      case "zakat":
        return this.generateZakatBubble(data, context, theme, config);
      case "bundle":
        return this.generateBundleBubble(data, context, theme, config);
      case "food":
        return this.generateFoodBubble(data, context, theme, config);
      case "cv":
        return this.generateCVBubble(data, context, theme, config);
      case "job":
        return this.generateJobBubble(data, context, theme, config);
      case "saas":
        return this.generateSaasBubble(data, context, theme, config);
      case "fleet":
        return this.generateFleetBubble(data, context, theme, config);
      case "crossborder":
        return this.generateCrossborderBubble(data, context, theme, config);
      case "a2a":
        return this.generateA2ABubble(data, context, theme, config);
      case "merchant":
        return this.generateMerchantBubble(data, context, theme, config);
      case "aggregator":
        return this.generateAggregatorBubble(data, context, theme, config);
      default:
        return this.generateGenericBubble(data, context, theme, config);
    }
  }

  // ============================================
  // PRODUCT BUBBLE
  // ============================================
  private generateProductBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const products = this.extractProducts(data);
    const currency = context.market.currencySymbol;

    return {
      id: this.nextId(),
      type: "product",
      theme,
      data: {
        title: "منتجات مقترحة",
        subtitle: `أفضل الخيارات ب${context.market.nameAr}`,
        items: products.slice(0, 3).map((p) => ({
          id: p.id,
          name: p.name,
          price: `${p.price} ${currency}`,
          image: p.imageUrl || null,
          rating: p.rating || 4.5,
          inStock: (p.stock ?? 0) > 0,
          badge: p.isHalal ? "حلال ✅" : null,
        })),
        currency,
        cta: {
          label: "شوف الكل",
          action: "view_all_products",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 9,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // TRACKING BUBBLE
  // ============================================
  private generateTrackingBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const order = this.extractOrder(data);
    const currency = context.market.currencySymbol;

    return {
      id: this.nextId(),
      type: "tracking",
      theme,
      data: {
        title: "تتبع طلبك",
        orderId: order.orderId,
        status: order.status,
        statusAr: this.translateStatus(order.status),
        merchant: order.merchant || "مطعم الرقي",
        total: `${order.total} ${currency}`,
        driver: {
          name: order.driverName || "سالم",
          vehicle: order.vehicle || "كامري 2024",
          rating: order.driverRating || 4.8,
          phone: order.driverPhone || "",
        },
        eta: {
          minutes: order.etaMinutes || 8,
          text: `${order.etaMinutes || 8} دقايق`,
        },
        location: order.location || "برج التجارية",
        steps: [
          { label: "تم الطلب", done: true },
          { label: "قيد التجهيز", done: true },
          { label: "في الطريق", done: order.status === "shipped" || order.status === "delivered" },
          { label: "تم التوصيل", done: order.status === "delivered" },
        ],
        mapSnapshot: {
          lat: order.lat || 29.3759,
          lng: order.lng || 47.9774,
          zoom: 14,
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 10,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // PAYMENT BUBBLE
  // ============================================
  private generatePaymentBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const gateways = (data.availableGateways as string[]) || ["knet", "apple_pay"];
    const amount = this.extractAmount(data);

    return {
      id: this.nextId(),
      type: "payment",
      theme,
      data: {
        title: "الدفع الآمن",
        amount: `${amount} ${context.market.currencySymbol}`,
        escrowEnabled: data.escrowEnabled ?? true,
        biometricEnabled: data.biometricEnabled ?? true,
        methods: gateways.map((g) => ({
          id: g,
          name: this.translateGateway(g),
          icon: this.gatewayIcon(g),
          enabled: true,
        })),
        securityNote: "🔒 بياناتك مشفرة ومحمية",
        styles: config.colors,
        icon: config.icon,
      },
      priority: 10,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // HAGGLE BUBBLE
  // ============================================
  private generateHaggleBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const originalPrice = (data.originalPrice as number) || 100;
    const suggestedPrice = (data.suggestedPrice as number) || originalPrice * 0.85;
    const concessionRange = (data.concessionRange as { min?: number; max?: number }) || { min: originalPrice * 0.7, max: originalPrice * 0.95 };

    return {
      id: this.nextId(),
      type: "haggle",
      theme,
      data: {
        title: "المفاوضة الذكية",
        product: data.productName || data.product || "المنتج",
        priceTimeline: [
          { label: "السعر الأصلي", value: `${originalPrice} ${context.market.currencySymbol}`, party: "merchant" },
          { label: "عرض AI", value: `${Math.round(suggestedPrice * 100) / 100} ${context.market.currencySymbol}`, party: "ai" },
          { label: "الحد الأدنى", value: `${Math.round((concessionRange.min || suggestedPrice) * 100) / 100} ${context.market.currencySymbol}`, party: "floor" },
        ],
        discount: `${Math.round((1 - suggestedPrice / originalPrice) * 100)}%`,
        strategy: data.strategy || "gradual",
        expiresIn: "10 دقايق",
        styles: config.colors,
        icon: config.icon,
      },
      priority: 8,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // ANALYTICS BUBBLE
  // ============================================
  private generateAnalyticsBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const metrics = (data.metrics as Array<{ metric?: string; value?: number; category?: string }>) || [];

    return {
      id: this.nextId(),
      type: "analytics",
      theme,
      data: {
        title: "تحليلات الأداء",
        period: "آخر 30 يوم",
        kpis: metrics.slice(0, 4).map((m) => ({
          label: m.metric || "مقياس",
          value: m.value ?? 0,
          change: `${(Math.random() * 20 - 5).toFixed(1)}%`,
          up: Math.random() > 0.3,
        })),
        chart: {
          type: "line",
          labels: ["أسبوع 1", "أسبوع 2", "أسبوع 3", "أسبوع 4"],
          values: metrics.slice(0, 4).map((m) => m.value ?? Math.floor(Math.random() * 1000)),
        },
        summary: `أداء جيد بشكل عام — نمو ملحوظ ب${context.market.nameAr}`,
        styles: config.colors,
        icon: config.icon,
      },
      priority: 6,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // ESCROW BUBBLE
  // ============================================
  private generateEscrowBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    return {
      id: this.nextId(),
      type: "escrow",
      theme,
      data: {
        title: "حماية الشراء",
        status: "holding",
        statusAr: "قيد الاحتجاز",
        amount: `${this.extractAmount(data)} ${context.market.currencySymbol}`,
        merchant: data.merchantName || "التاجر",
        releaseConditions: [
          "استلام المنتج",
          "الموافقة على الجودة",
          "فترة الفحص 24 ساعة",
        ],
        disputeWindow: "7 أيام",
        styles: config.colors,
        icon: config.icon,
      },
      priority: 9,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // ZAKAT BUBBLE
  // ============================================
  private generateZakatBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const zakatAmount = (data.zakatPayable as number) || 0;
    const nisab = (data.nisabThreshold as number) || 5000;
    const netWealth = (data.netWealth as number) || 0;

    return {
      id: this.nextId(),
      type: "zakat",
      theme,
      data: {
        title: "حاسبة الزكاة",
        yearHijri: data.yearHijri || 1446,
        nisab: `${nisab} ${context.market.currencySymbol}`,
        netWealth: `${netWealth} ${context.market.currencySymbol}`,
        zakatDue: `${zakatAmount} ${context.market.currencySymbol}`,
        zakatRate: "2.5%",
        assets: [
          { type: "نقد", amount: netWealth * 0.4 },
          { type: "ذهب", amount: netWealth * 0.3 },
          { type: "استثمارات", amount: netWealth * 0.2 },
          { type: "أخرى", amount: netWealth * 0.1 },
        ],
        isNisabMet: netWealth >= nisab,
        payable: netWealth >= nisab,
        goldPrice: data.goldPrice || 25,
        silverPrice: data.silverPrice || 0.5,
        styles: config.colors,
        icon: config.icon,
      },
      priority: 9,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // BUNDLE BUBBLE
  // ============================================
  private generateBundleBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const products = this.extractProducts(data);
    const total = products.reduce((sum, p) => sum + (p.price || 0), 0);
    const bundlePrice = total * 0.85; // 15% bundle discount

    return {
      id: this.nextId(),
      type: "bundle",
      theme,
      data: {
        title: "باقة توفير",
        subtitle: "وفّر 15% مع الباقة",
        products: products.slice(0, 3).map((p) => ({
          id: p.id,
          name: p.name,
          originalPrice: `${p.price} ${context.market.currencySymbol}`,
        })),
        originalTotal: `${Math.round(total * 100) / 100} ${context.market.currencySymbol}`,
        bundlePrice: `${Math.round(bundlePrice * 100) / 100} ${context.market.currencySymbol}`,
        savings: `${Math.round((total - bundlePrice) * 100) / 100} ${context.market.currencySymbol}`,
        cta: {
          label: "اشتري الباقة",
          action: "buy_bundle",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 7,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // FOOD BUBBLE
  // ============================================
  private generateFoodBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const products = this.extractProducts(data);
    const merchants = (data.merchants as Array<{ id?: number; name?: string; type?: string; rating?: number }>) || [];

    return {
      id: this.nextId(),
      type: "food",
      theme,
      data: {
        title: "اكتشف الطعام",
        subtitle: `أفضل المطاعم ب${context.market.nameAr}`,
        restaurants: merchants.slice(0, 3).map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          rating: m.rating || 4.5,
          deliveryTime: `${Math.floor(Math.random() * 20) + 10} دقيقة`,
          deliveryFee: `${(Math.random() * 1 + 0.5).toFixed(1)} ${context.market.currencySymbol}`,
        })),
        topDishes: products.slice(0, 3).map((p) => ({
          id: p.id,
          name: p.name,
          price: `${p.price} ${context.market.currencySymbol}`,
          image: p.imageUrl || null,
        })),
        styles: config.colors,
        icon: config.icon,
      },
      priority: 9,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // CV BUBBLE
  // ============================================
  private generateCVBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const candidates = (data.candidates as Array<{ id?: number; name?: string; title?: string; score?: number }>) || [];
    const candidate = candidates[0] || { name: "مرشح", title: "مطور", score: 87 };

    return {
      id: this.nextId(),
      type: "cv",
      theme,
      data: {
        title: "السيرة الذاتية",
        candidate: {
          name: candidate.name || "مرشح متميز",
          title: candidate.title || "مطور برمجيات",
          matchScore: candidate.score || 87,
          skills: ["JavaScript", "React", "Node.js", "SQL", "Git"],
          experience: "3-5 سنوات",
          education: "بكالوريوس علوم حاسوب",
        },
        recommendations: [
          "مطابق عالي للوظيفة",
          "خبرة قوية بالتقنيات المطلوبة",
        ],
        cta: {
          label: "قدّم الآن",
          action: "apply_job",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 7,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // JOB BUBBLE
  // ============================================
  private generateJobBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const jobs = (data.jobs as Array<{ id?: number; title?: string; salary?: string; location?: string }>) || [];

    return {
      id: this.nextId(),
      type: "job",
      theme,
      data: {
        title: "فرص العمل",
        subtitle: `وظائف متاحة ب${context.market.nameAr}`,
        listings: jobs.slice(0, 3).map((j) => ({
          id: j.id,
          title: j.title,
          salary: j.salary,
          location: j.location || context.market.nameAr,
          type: "دوام كامل",
          postedAgo: "منذ يومين",
        })),
        totalCount: jobs.length,
        cta: {
          label: "شوف الكل",
          action: "view_all_jobs",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 7,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // SAAS BUBBLE
  // ============================================
  private generateSaasBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const templates = (data.templates as Array<{ id?: number; name?: string; category?: string; price?: number }>) || [];

    return {
      id: this.nextId(),
      type: "saas",
      theme,
      data: {
        title: "منصتك الإلكترونية",
        subtitle: "ابنِ متجرك في 3 دقائق",
        templates: templates.slice(0, 3).map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          price: `${t.price} ${context.market.currencySymbol}/شهر`,
          features: ["POS", "تحليلات", "دفع إلكتروني"],
        })),
        freeTrial: "14 يوم مجاناً",
        deployTime: data.deployTime || "3 دقائق",
        cta: {
          label: "ابدأ مجاناً",
          action: "deploy_saas",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 6,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // FLEET BUBBLE
  // ============================================
  private generateFleetBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const drivers = (data.drivers as Array<{ id?: number; name?: string; vehicle?: string; rating?: number; status?: string }>) || [];

    return {
      id: this.nextId(),
      type: "fleet",
      theme,
      data: {
        title: "أسطول التوصيل",
        drivers: drivers.slice(0, 3).map((d) => ({
          id: d.id,
          name: d.name,
          vehicle: d.vehicle,
          rating: d.rating || 5.0,
          status: d.status || "متاح",
        })),
        stats: {
          available: data.availableDrivers || 0,
          busy: Math.floor((data.availableDrivers as number || 0) * 0.6),
          avgRating: 4.7,
        },
        mapSnapshot: {
          lat: 29.3759,
          lng: 47.9774,
          zoom: 12,
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 7,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // CROSSBORDER BUBBLE
  // ============================================
  private generateCrossborderBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    return {
      id: this.nextId(),
      type: "crossborder",
      theme,
      data: {
        title: "التجارة الدولية",
        route: {
          origin: data.origin || "الصين",
          destination: data.destination || context.market.nameAr,
        },
        status: data.status || "order_placed",
        costs: {
          products: `${this.extractAmount(data) * 0.8} ${context.market.currencySymbol}`,
          shipping: `${this.extractAmount(data) * 0.1} ${context.market.currencySymbol}`,
          customs: `${this.extractAmount(data) * 0.1} ${context.market.currencySymbol}`,
          total: `${this.extractAmount(data)} ${context.market.currencySymbol}`,
        },
        murabaha: data.murabahaEnabled ? {
          rate: "5%",
          amount: `${this.extractAmount(data) * 0.05} ${context.market.currencySymbol}`,
        } : null,
        trackingStages: [
          { label: "تم الطلب", done: true },
          { label: "استلام الدفعة", done: true },
          { label: "تخليص جمركي", done: false },
          { label: "الشحن", done: false },
          { label: "الوصول", done: false },
        ],
        styles: config.colors,
        icon: config.icon,
      },
      priority: 7,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // A2A BUBBLE
  // ============================================
  private generateA2ABubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const agents = (data.availableAgents as Array<{ id?: number; name?: string; price?: number; reputation?: number; type?: string }>) || [];

    return {
      id: this.nextId(),
      type: "a2a",
      theme,
      data: {
        title: "سوق الوكلاء",
        subtitle: `وكلاء ذكاء اصطناعي متاحين ب${context.market.nameAr}`,
        agents: agents.slice(0, 3).map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          price: `${a.price} ${context.market.currencySymbol}`,
          reputation: a.reputation || 95,
          skills: ["تحليل", "مبيعات", "خدمة عملاء"],
        })),
        cta: {
          label: "تصفح الكل",
          action: "browse_agents",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 5,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // MERCHANT BUBBLE
  // ============================================
  private generateMerchantBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const suppliers = (data.suppliers as Array<{ id?: number; name?: string; type?: string; rating?: number }>) || [];

    return {
      id: this.nextId(),
      type: "merchant",
      theme,
      data: {
        title: "الموردين والتجار",
        subtitle: `شركاء موثوقين ب${context.market.nameAr}`,
        merchants: suppliers.slice(0, 3).map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          rating: s.rating || 4.5,
          verified: true,
        })),
        cta: {
          label: "تواصل",
          action: "contact_merchant",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 6,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // AGGREGATOR BUBBLE
  // ============================================
  private generateAggregatorBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    const platforms = (data.platforms as Array<{ id?: number; name?: string; vendorCount?: number; productCount?: number }>) || [];

    return {
      id: this.nextId(),
      type: "aggregator",
      theme,
      data: {
        title: "المتاجر المتعددة",
        subtitle: "تسوق من عدة تجار بمكان واحد",
        platforms: platforms.slice(0, 3).map((p) => ({
          id: p.id,
          name: p.name,
          vendors: p.vendorCount || 0,
          products: p.productCount || 0,
        })),
        cta: {
          label: "تصفح المنصات",
          action: "browse_platforms",
        },
        styles: config.colors,
        icon: config.icon,
      },
      priority: 6,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // GENERIC BUBBLE (fallback)
  // ============================================
  private generateGenericBubble(
    data: Record<string, unknown>,
    context: ConversationContext,
    theme: BubbleTheme,
    config: ThemeConfig,
  ): Bubble {
    return {
      id: this.nextId(),
      type: "generic",
      theme,
      data: {
        title: data.title || "جاسم",
        subtitle: data.subtitle || `وكيلك الذكي ب${context.market.nameAr}`,
        message: data.message || "كيف أقدر أساعدك اليوم؟",
        quickActions: [
          { label: "طلب أكل", action: "food_order" },
          { label: "تسوق", action: "product_search" },
          { label: "وظائف", action: "job_seeker" },
          { label: "متجري", action: "create_store" },
        ],
        styles: config.colors,
        icon: config.icon,
      },
      priority: 3,
      marketCode: context.marketCode,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private createGenericBubble(context: ConversationContext): Bubble {
    return {
      id: this.nextId(),
      type: "generic",
      theme: "default",
      data: {
        title: "جاسم 🤖",
        subtitle: `وكيلك الذكي — ${context.market.nameAr}`,
        message: "مرحباً! أقدر أساعدك بطلب أكل، تسوق، توظيف، وبناء متجر إلكتروني.",
        quickActions: [
          { label: "🍽️ طعام", action: "food_order" },
          { label: "🛍️ منتجات", action: "product_search" },
          { label: "💼 وظائف", action: "job_seeker" },
          { label: "🏪 متجري", action: "create_store" },
        ],
        styles: THEME_CONFIGS.default.colors,
        icon: "✨",
      },
      priority: 1,
      marketCode: context.marketCode,
    };
  }

  private extractProducts(data: Record<string, unknown>): Array<{
    id: number; name: string; price: number; currency: string;
    stock: number; category: string; isHalal: boolean;
    imageUrl: string | null; rating: number;
  }> {
    if (data.products && Array.isArray(data.products)) {
      return (data.products as Array<{
        id?: number; name?: string; price?: number; currency?: string;
        stock?: number; category?: string; isHalal?: boolean;
        imageUrl?: string; rating?: number;
      }>).map((p) => ({
        id: p.id || 0,
        name: p.name || "منتج",
        price: p.price || 0,
        currency: p.currency || "KWD",
        stock: p.stock || 0,
        category: p.category || "عام",
        isHalal: p.isHalal ?? true,
        imageUrl: p.imageUrl || null,
        rating: p.rating || 4.5,
      }));
    }
    return [];
  }

  private extractOrder(data: Record<string, unknown>): {
    orderId: string; status: string; merchant: string; total: number;
    driverName: string; vehicle: string; driverRating: number;
    driverPhone: string; etaMinutes: number; location: string;
    lat: number; lng: number;
  } {
    const orders = data.orders as Array<{
      id?: number; status?: string; total?: number;
      trackingNumber?: string; merchantName?: string;
    }> | undefined;
    const firstOrder = orders?.[0];

    return {
      orderId: firstOrder?.trackingNumber || `JAS-${firstOrder?.id || "1234"}`,
      status: firstOrder?.status || "shipped",
      merchant: data.merchantName as string || "مطعم الرقي",
      total: firstOrder?.total || 25.5,
      driverName: data.driverName as string || "سالم",
      vehicle: data.vehicle as string || "كامري 2024",
      driverRating: (data.driverRating as number) || 4.8,
      driverPhone: data.driverPhone as string || "",
      etaMinutes: (data.eta as number) || (data.avgDeliveryTime as number) || 8,
      location: data.location as string || "برج التجارية",
      lat: (data.lat as number) || 29.3759,
      lng: (data.lng as number) || 47.9774,
    };
  }

  private extractAmount(data: Record<string, unknown>): number {
    return (data.amount as number)
      || (data.total as number)
      || (data.totalAmount as number)
      || (data.zakatPayable as number)
      || 25.5;
  }

  private translateGateway(gateway: string): string {
    const map: Record<string, string> = {
      knet: "KNET",
      apple_pay: "Apple Pay",
      google_pay: "Google Pay",
      cash: "كاش",
      card: "بطاقة",
      stc_pay: "STC Pay",
      pay_by_card: "بطاقة دفع",
      vodafone_cash: "Vodafone Cash",
    };
    return map[gateway] || gateway;
  }

  private gatewayIcon(gateway: string): string {
    const map: Record<string, string> = {
      knet: "💳",
      apple_pay: "🍎",
      google_pay: "🤖",
      cash: "💵",
      card: "💳",
      stc_pay: "📱",
    };
    return map[gateway] || "💳";
  }

  private translateStatus(status: string): string {
    const map: Record<string, string> = {
      pending: "قيد الانتظار",
      confirmed: "تم التأكيد",
      processing: "قيد التجهيز",
      shipped: "في الطريق",
      delivered: "تم التوصيل",
      cancelled: "ملغي",
      returned: "مُرجع",
      assigned: "تم التعيين",
      accepted: "مقبول",
      picked_up: "تم الاستلام",
      in_transit: "بالطريق",
      active: "نشط",
      available: "متاح",
    };
    return map[status] || status;
  }

  private nextId(): string {
    return `bubble_${Date.now()}_${++this.bubbleIdCounter}`;
  }
}
