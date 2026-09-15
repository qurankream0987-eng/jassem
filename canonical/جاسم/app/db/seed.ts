import { db } from "./queries/connection";
import { markets } from "./schema";

async function seed() {
  console.log("Seeding markets...");
  
  const marketData = [
    { code: "KW", nameAr: "الكويت", nameEn: "Kuwait", currency: "KWD", currencySymbol: "د.ك", pricingMultiplier: 1.0 },
    { code: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", currency: "SAR", currencySymbol: "ر.س", pricingMultiplier: 12.3 },
    { code: "AE", nameAr: "الإمارات", nameEn: "UAE", currency: "AED", currencySymbol: "د.إ", pricingMultiplier: 11.8 },
    { code: "QA", nameAr: "قطر", nameEn: "Qatar", currency: "QAR", currencySymbol: "ر.ق", pricingMultiplier: 11.7 },
    { code: "BH", nameAr: "البحرين", nameEn: "Bahrain", currency: "BHD", currencySymbol: "د.ب", pricingMultiplier: 1.23 },
    { code: "OM", nameAr: "عمان", nameEn: "Oman", currency: "OMR", currencySymbol: "ر.ع", pricingMultiplier: 1.25 },
    { code: "IQ", nameAr: "العراق", nameEn: "Iraq", currency: "IQD", currencySymbol: "د.ع", pricingMultiplier: 1.0 },
    { code: "JO", nameAr: "الأردن", nameEn: "Jordan", currency: "JOD", currencySymbol: "د.أ", pricingMultiplier: 0.5 },
    { code: "EG", nameAr: "مصر", nameEn: "Egypt", currency: "EGP", currencySymbol: "ج.م", pricingMultiplier: 0.5 },
    { code: "SY", nameAr: "سوريا", nameEn: "Syria", currency: "SYP", currencySymbol: "ل.س", pricingMultiplier: 0.5 },
    { code: "LB", nameAr: "لبنان", nameEn: "Lebanon", currency: "LBP", currencySymbol: "ل.ل", pricingMultiplier: 1.0 },
    { code: "MA", nameAr: "المغرب", nameEn: "Morocco", currency: "MAD", currencySymbol: "د.م", pricingMultiplier: 1.0 },
    { code: "TN", nameAr: "تونس", nameEn: "Tunisia", currency: "TND", currencySymbol: "د.ت", pricingMultiplier: 1.0 },
    { code: "DZ", nameAr: "الجزائر", nameEn: "Algeria", currency: "DZD", currencySymbol: "د.ج", pricingMultiplier: 1.0 },
    { code: "YE", nameAr: "اليمن", nameEn: "Yemen", currency: "YER", currencySymbol: "ر.ي", pricingMultiplier: 1.0 },
  ];

  for (const m of marketData) {
    await db.insert(markets).values(m).onConflictDoUpdate({ target: markets.code, set: m });
  }

  console.log("Markets seeded!");
}

seed().catch(console.error);
