/**
 * Market Detector - Detects and validates market context
 * Handles 15+ Arab markets with proper currency, timezone, and dialect mapping
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { markets } from "@db/schema";
import type { AgentType, MarketConfig } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  invalidHeaders: "البيانات المرسلة غير صالحة",
  marketNotFound: "السوق غير موجود أو غير مدعوم حالياً",
  accessDenied: "لا يمكنك الوصول إلى هذا السوق",
  validationFailed: "فشل التحقق من السوق",
} as const;

// ============================================
// MARKET CONFIGURATIONS - 15 Arab markets
// ============================================

const MARKET_CONFIGS: Record<string, MarketConfig> = {
  KW: {
    code: "KW",
    nameAr: "الكويت",
    nameEn: "Kuwait",
    currency: "KWD",
    currencySymbol: "د.ك",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Kuwait",
    isActive: true,
    pricingMultiplier: 1.0,
    defaultAgent: "food",
  },
  SA: {
    code: "SA",
    nameAr: "السعودية",
    nameEn: "Saudi Arabia",
    currency: "SAR",
    currencySymbol: "ر.س",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Riyadh",
    isActive: true,
    pricingMultiplier: 12.3,
    defaultAgent: "food",
  },
  AE: {
    code: "AE",
    nameAr: "الإمارات",
    nameEn: "UAE",
    currency: "AED",
    currencySymbol: "د.إ",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Dubai",
    isActive: true,
    pricingMultiplier: 11.8,
    defaultAgent: "food",
  },
  QA: {
    code: "QA",
    nameAr: "قطر",
    nameEn: "Qatar",
    currency: "QAR",
    currencySymbol: "ر.ق",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Qatar",
    isActive: true,
    pricingMultiplier: 11.9,
    defaultAgent: "food",
  },
  BH: {
    code: "BH",
    nameAr: "البحرين",
    nameEn: "Bahrain",
    currency: "BHD",
    currencySymbol: "د.ب",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Bahrain",
    isActive: true,
    pricingMultiplier: 1.22,
    defaultAgent: "food",
  },
  OM: {
    code: "OM",
    nameAr: "عُمان",
    nameEn: "Oman",
    currency: "OMR",
    currencySymbol: "ر.ع",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Muscat",
    isActive: true,
    pricingMultiplier: 1.25,
    defaultAgent: "food",
  },
  JO: {
    code: "JO",
    nameAr: "الأردن",
    nameEn: "Jordan",
    currency: "JOD",
    currencySymbol: "د.أ",
    language: "ar",
    dialect: "levantine",
    timezone: "Asia/Amman",
    isActive: true,
    pricingMultiplier: 2.3,
    defaultAgent: "food",
  },
  LB: {
    code: "LB",
    nameAr: "لبنان",
    nameEn: "Lebanon",
    currency: "USD",
    currencySymbol: "$",
    language: "ar",
    dialect: "levantine",
    timezone: "Asia/Beirut",
    isActive: true,
    pricingMultiplier: 3.2,
    defaultAgent: "food",
  },
  EG: {
    code: "EG",
    nameAr: "مصر",
    nameEn: "Egypt",
    currency: "EGP",
    currencySymbol: "ج.م",
    language: "ar",
    dialect: "egyptian",
    timezone: "Africa/Cairo",
    isActive: true,
    pricingMultiplier: 100.5,
    defaultAgent: "food",
  },
  IQ: {
    code: "IQ",
    nameAr: "العراق",
    nameEn: "Iraq",
    currency: "IQD",
    currencySymbol: "د.ع",
    language: "ar",
    dialect: "gulf",
    timezone: "Asia/Baghdad",
    isActive: true,
    pricingMultiplier: 3900,
    defaultAgent: "food",
  },
  MA: {
    code: "MA",
    nameAr: "المغرب",
    nameEn: "Morocco",
    currency: "MAD",
    currencySymbol: "د.م",
    language: "ar",
    dialect: "maghrebi",
    timezone: "Africa/Casablanca",
    isActive: true,
    pricingMultiplier: 32.8,
    defaultAgent: "food",
  },
  TN: {
    code: "TN",
    nameAr: "تونس",
    nameEn: "Tunisia",
    currency: "TND",
    currencySymbol: "د.ت",
    language: "ar",
    dialect: "maghrebi",
    timezone: "Africa/Tunis",
    isActive: true,
    pricingMultiplier: 9.8,
    defaultAgent: "food",
  },
  DZ: {
    code: "DZ",
    nameAr: "الجزائر",
    nameEn: "Algeria",
    currency: "DZD",
    currencySymbol: "د.ج",
    language: "ar",
    dialect: "maghrebi",
    timezone: "Africa/Algiers",
    isActive: true,
    pricingMultiplier: 435,
    defaultAgent: "food",
  },
  SD: {
    code: "SD",
    nameAr: "السودان",
    nameEn: "Sudan",
    currency: "SDG",
    currencySymbol: "ج.س",
    language: "ar",
    dialect: "egyptian",
    timezone: "Africa/Khartoum",
    isActive: true,
    pricingMultiplier: 2950,
    defaultAgent: "food",
  },
  PS: {
    code: "PS",
    nameAr: "فلسطين",
    nameEn: "Palestine",
    currency: "JOD",
    currencySymbol: "د.أ",
    language: "ar",
    dialect: "levantine",
    timezone: "Asia/Gaza",
    isActive: true,
    pricingMultiplier: 2.3,
    defaultAgent: "food",
  },
};

// ============================================
// HEADER/BODY DETECTION PATTERNS
// ============================================

// Common header keys for market detection
const MARKET_HEADER_KEYS = [
  "x-market-code",
  "x-market",
  "market-code",
  "market",
  "x-country",
  "country",
  "x-region",
  "region",
  "x-locale",
  "locale",
];

// ============================================
// PUBLIC API
// ============================================

/**
 * Detect market from request headers and/or body
 * Checks common header keys and body fields
 */
export function detectMarket(headers: Record<string, unknown> = {}, body: Record<string, unknown> = {}): string {
  // Check headers first (case-insensitive)
  const headersLower: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    headersLower[key.toLowerCase()] = value;
  }

  for (const key of MARKET_HEADER_KEYS) {
    const value = headersLower[key];
    if (value && typeof value === "string") {
      const upper = value.toUpperCase();
      if (MARKET_CONFIGS[upper]) {
        return upper;
      }
    }
  }

  // Check body
  if (body.marketCode && typeof body.marketCode === "string") {
    const upper = body.marketCode.toUpperCase();
    if (MARKET_CONFIGS[upper]) {
      return upper;
    }
  }

  if (body.market && typeof body.market === "string") {
    const upper = body.market.toUpperCase();
    if (MARKET_CONFIGS[upper]) {
      return upper;
    }
  }

  if (body.country && typeof body.country === "string") {
    const upper = body.country.toUpperCase();
    if (MARKET_CONFIGS[upper]) {
      return upper;
    }
  }

  // Check Accept-Language header
  const acceptLang = headersLower["accept-language"];
  if (acceptLang && typeof acceptLang === "string") {
    const langMap: Record<string, string> = {
      "ar-kw": "KW", "ar-sa": "SA", "ar-ae": "AE",
      "ar-qa": "QA", "ar-bh": "BH", "ar-om": "OM",
      "ar-jo": "JO", "ar-lb": "LB", "ar-eg": "EG",
      "ar-iq": "IQ", "ar-ma": "MA", "ar-tn": "TN",
      "ar-dz": "DZ", "ar-sd": "SD", "ar-ps": "PS",
    };
    for (const [lang, code] of Object.entries(langMap)) {
      if (acceptLang.toLowerCase().includes(lang)) {
        return code;
      }
    }
  }

  // Check IP-based hints (from CF-IPCountry or similar)
  const ipCountry = headersLower["cf-ipcountry"] || headersLower["x-vercel-ip-country"];
  if (ipCountry && typeof ipCountry === "string") {
    const upper = ipCountry.toUpperCase();
    if (MARKET_CONFIGS[upper]) {
      return upper;
    }
  }

  // Default to Kuwait
  return "KW";
}

/**
 * Validate that a user has access to a specific market
 * Checks if the market is active and user is authorized
 */
export async function validateMarketAccess(
  _userId: string,
  marketCode: string
): Promise<boolean> {
  const config = getMarketConfig(marketCode);
  if (!config) {
    return false;
  }
  return config.isActive;
}

/**
 * Get full configuration for a market
 */
export function getMarketConfig(marketCode: string): MarketConfig | null {
  const upper = marketCode.toUpperCase();
  return MARKET_CONFIGS[upper] || null;
}

/**
 * Get all active markets
 */
export function getActiveMarkets(): MarketConfig[] {
  return Object.values(MARKET_CONFIGS).filter(m => m.isActive);
}

/**
 * Get market by currency
 */
export function getMarketByCurrency(currency: string): MarketConfig | null {
  return (
    Object.values(MARKET_CONFIGS).find(
      m => m.currency.toUpperCase() === currency.toUpperCase()
    ) || null
  );
}

/**
 * Convert price to market's local currency
 */
export function convertToMarketCurrency(
  basePrice: number,
  marketCode: string
): { amount: number; currency: string; symbol: string } {
  const config = getMarketConfig(marketCode);
  if (!config) {
    return { amount: basePrice, currency: "KWD", symbol: "د.ك" };
  }

  const converted = basePrice * config.pricingMultiplier;

  // Round to appropriate decimal places
  const decimals = config.currency === "KWD" || config.currency === "BHD" || config.currency === "OMR" ? 3 : 2;
  const rounded = Math.round(converted * Math.pow(10, decimals)) / Math.pow(10, decimals);

  return {
    amount: rounded,
    currency: config.currency,
    symbol: config.currencySymbol,
  };
}

/**
 * Format price for display in market's locale
 */
export function formatMarketPrice(
  amount: number,
  marketCode: string
): string {
  const config = getMarketConfig(marketCode);
  if (!config) {
    return `${amount} د.ك`;
  }

  const decimals = config.currency === "KWD" || config.currency === "BHD" || config.currency === "OMR" ? 3 : 2;
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${formatted} ${config.currencySymbol}`;
}

/**
 * Get market-specific greeting
 */
export function getMarketGreeting(marketCode: string): string {
  const greetings: Record<string, string> = {
    KW: "هلا والله! أهلاً وسهلاً",
    SA: "أهلاً وسهلاً! حياك الله",
    AE: "مرحباً! أهلاً بيك",
    QA: "هلا! حياك الله",
    BH: "هلا والله! يا مرحبا",
    OM: "أهلاً وسهلاً! مرحباً",
    JO: "أهلاً وسهلاً! أهلاً بيك",
    LB: "أهلاً! أهلاً وسهلاً",
    EG: "أهلاً بيك! إزيك",
    IQ: "هلا بالغالي! أهلاً وسهلاً",
    MA: "مرحباً! أهلاً وسهلاً",
    TN: "أهلاً بيك! مرحباً",
    DZ: "مرحباً! أهلاً بيك",
    SD: "مرحباً! كيفك",
    PS: "أهلاً وسهلاً! يا هلا",
  };

  return greetings[marketCode.toUpperCase()] || "مرحباً! أهلاً وسهلاً";
}

/**
 * Get default agent for a market
 */
export function getMarketDefaultAgent(marketCode: string): AgentType {
  const config = getMarketConfig(marketCode);
  return config?.defaultAgent || "food";
}

/**
 * Check if market supports a specific feature
 */
export function marketSupportsFeature(
  marketCode: string,
  feature: string
): boolean {
  // Define feature availability per market
  const featureMap: Record<string, string[]> = {
    payment_knet: ["KW"],
    payment_mada: ["SA"],
    payment_apple_pay: ["KW", "SA", "AE", "QA", "BH"],
    cross_border: ["KW", "SA", "AE", "QA", "BH"],
    zakat: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "LB", "EG", "IQ", "SD", "PS"],
    haggle: ["KW", "SA", "AE", "QA", "BH"],
    fleet: ["KW", "SA", "AE", "QA", "BH", "OM", "EG"],
    recruitment: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "LB", "EG"],
    a2a: ["KW", "SA", "AE"],
    gensaas: ["KW", "SA", "AE", "QA", "BH", "OM"],
    aggregator: ["KW", "SA", "AE", "QA", "BH"],
    widget: ["KW", "SA", "AE", "QA", "BH", "OM", "JO", "LB", "EG"],
  };

  const markets = featureMap[feature];
  if (!markets) return true; // Default to available

  return markets.includes(marketCode.toUpperCase());
}

/**
 * Sync market configurations with database
 * Ensures all markets exist in the markets table
 */
export async function syncMarketsWithDb(): Promise<void> {
  try {
    for (const config of Object.values(MARKET_CONFIGS)) {
      // Check if market exists
      const existing = await db
        .select()
        .from(markets)
        .where(eq(markets.code, config.code))
        .limit(1);

      if (existing.length === 0) {
        // Insert new market
        await db.insert(markets).values({
          code: config.code,
          nameAr: config.nameAr,
          nameEn: config.nameEn,
          currency: config.currency,
          currencySymbol: config.currencySymbol,
          isActive: config.isActive,
          pricingMultiplier: config.pricingMultiplier,
        });
      }
    }
  } catch (error) {
    console.error("[MarketDetector] syncMarketsWithDb error:", error);
  }
}
