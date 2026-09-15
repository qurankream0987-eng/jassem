import type { Merchant, Product, Order } from "@/types/commerce";

// ─── 15 Merchants across different Arab markets ───
export const mockMerchants: Merchant[] = [
  {
    id: 1, userId: 101, businessName: "مطعم الرومانسية", businessType: "restaurant",
    crNumber: "CR-10001", marketCode: "KW", subscriptionTier: "pro",
    commissionRate: 0.025, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-01-15"), updatedAt: new Date("2024-01-15"), isHalal: true,
  },
  {
    id: 2, userId: 102, businessName: "صيدلية الدواء", businessType: "pharmacy",
    crNumber: "CR-10002", marketCode: "KW", subscriptionTier: "enterprise",
    commissionRate: 0.02, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-02-01"), updatedAt: new Date("2024-02-01"), isHalal: true,
  },
  {
    id: 3, userId: 103, businessName: "أزياء النور", businessType: "clothing",
    crNumber: "CR-10003", marketCode: "SA", subscriptionTier: "starter",
    commissionRate: 0.03, isVerified: false, isActive: true, kycStatus: "pending",
    createdAt: new Date("2024-02-10"), updatedAt: new Date("2024-02-10"), isHalal: true,
  },
  {
    id: 4, userId: 104, businessName: "سوبرماركت السلام", businessType: "grocery",
    crNumber: "CR-10004", marketCode: "KW", subscriptionTier: "pro",
    commissionRate: 0.022, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-02-15"), updatedAt: new Date("2024-02-15"), isHalal: true,
  },
  {
    id: 5, userId: 105, businessName: "إلكترونيات المستقبل", businessType: "electronics",
    crNumber: "CR-10005", marketCode: "AE", subscriptionTier: "enterprise",
    commissionRate: 0.018, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-03-01"), updatedAt: new Date("2024-03-01"), isHalal: true,
  },
  {
    id: 6, userId: 106, businessName: "صالون لمسة جمال", businessType: "salon",
    crNumber: "CR-10006", marketCode: "KW", subscriptionTier: "starter",
    commissionRate: 0.035, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-03-05"), updatedAt: new Date("2024-03-05"), isHalal: true,
  },
  {
    id: 7, userId: 107, businessName: "عقارات الكويت", businessType: "real_estate",
    crNumber: "CR-10007", marketCode: "KW", subscriptionTier: "ultimate",
    commissionRate: 0.015, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-03-10"), updatedAt: new Date("2024-03-10"), isHalal: true,
  },
  {
    id: 8, userId: 108, businessName: "ورشة الصقر للسيارات", businessType: "workshop",
    crNumber: "CR-10008", marketCode: "QA", subscriptionTier: "pro",
    commissionRate: 0.025, isVerified: false, isActive: true, kycStatus: "pending",
    createdAt: new Date("2024-03-15"), updatedAt: new Date("2024-03-15"), isHalal: true,
  },
  {
    id: 9, userId: 109, businessName: "مكتبة العبيكان", businessType: "bookstore",
    crNumber: "CR-10009", marketCode: "SA", subscriptionTier: "pro",
    commissionRate: 0.028, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-03-20"), updatedAt: new Date("2024-03-20"), isHalal: true,
  },
  {
    id: 10, userId: 110, businessName: "تاجر الجملة", businessType: "wholesale",
    crNumber: "CR-10010", marketCode: "KW", subscriptionTier: "ultimate",
    commissionRate: 0.012, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-04-01"), updatedAt: new Date("2024-04-01"), isHalal: true,
  },
  {
    id: 11, userId: 111, businessName: "عيادة الريان", businessType: "clinic",
    crNumber: "CR-10011", marketCode: "KW", subscriptionTier: "enterprise",
    commissionRate: 0.02, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-04-05"), updatedAt: new Date("2024-04-05"), isHalal: true,
  },
  {
    id: 12, userId: 112, businessName: "مطعم بحر الخليج", businessType: "restaurant",
    crNumber: "CR-10012", marketCode: "BH", subscriptionTier: "starter",
    commissionRate: 0.032, isVerified: false, isActive: true, kycStatus: "rejected",
    createdAt: new Date("2024-04-10"), updatedAt: new Date("2024-04-10"), isHalal: false,
  },
  {
    id: 13, userId: 113, businessName: "أزياء الجنوب", businessType: "clothing",
    crNumber: "CR-10013", marketCode: "OM", subscriptionTier: "starter",
    commissionRate: 0.03, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-04-12"), updatedAt: new Date("2024-04-12"), isHalal: true,
  },
  {
    id: 14, userId: 114, businessName: "صيدلية الرازي", businessType: "pharmacy",
    crNumber: "CR-10014", marketCode: "KW", subscriptionTier: "pro",
    commissionRate: 0.022, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-04-15"), updatedAt: new Date("2024-04-15"), isHalal: true,
  },
  {
    id: 15, userId: 115, businessName: "إلكترونيات برج العرب", businessType: "electronics",
    crNumber: "CR-10015", marketCode: "EG", subscriptionTier: "starter",
    commissionRate: 0.028, isVerified: true, isActive: true, kycStatus: "approved",
    createdAt: new Date("2024-04-20"), updatedAt: new Date("2024-04-20"), isHalal: true,
  },
];

// ─── 50+ Products with Arabic names ───
export const mockProducts: Product[] = [
  // Restaurant products
  { id: 1, merchantId: 1, name: "كباب مشوي", description: "كباب مشوي على الفحم مع أرز", price: 3.5, currency: "KWD", category: "Food", imageUrl: null, stock: 25, isHalal: true, barcode: "P-001", tags: ["مشويات", "غداء"], createdAt: new Date("2024-05-01"), updatedAt: new Date("2024-05-01"), merchantName: "مطعم الرومانسية" },
  { id: 2, merchantId: 1, name: "برياني دجاج", description: "برياني دجاج هندي أصيل", price: 2.8, currency: "KWD", category: "Food", imageUrl: null, stock: 15, isHalal: true, barcode: "P-002", tags: ["برياني", "عشاء"], createdAt: new Date("2024-05-02"), updatedAt: new Date("2024-05-02"), merchantName: "مطعم الرومانسية" },
  { id: 3, merchantId: 1, name: "مشكل مقبلات", description: "حمص، متبل، بابا غنوج", price: 1.5, currency: "KWD", category: "Food", imageUrl: null, stock: 30, isHalal: true, barcode: "P-003", tags: ["مقبلات"], createdAt: new Date("2024-05-03"), updatedAt: new Date("2024-05-03"), merchantName: "مطعم الرومانسية" },
  { id: 4, merchantId: 12, name: "سمك مشوي", description: "سمك هامور مشوي على الفحم", price: 5, currency: "BHD", category: "Food", imageUrl: null, stock: 8, isHalal: false, barcode: "P-004", tags: ["بحري", "عشاء"], createdAt: new Date("2024-05-04"), updatedAt: new Date("2024-05-04"), merchantName: "مطعم بحر الخليج" },
  { id: 5, merchantId: 12, name: "جمبري مقلي", description: "جمبري مقلي مقرمش", price: 4, currency: "BHD", category: "Food", imageUrl: null, stock: 12, isHalal: false, barcode: "P-005", tags: ["بحري"], createdAt: new Date("2024-05-05"), updatedAt: new Date("2024-05-05"), merchantName: "مطعم بحر الخليج" },

  // Pharmacy products
  { id: 6, merchantId: 2, name: "فيتامين سي 1000مجم", description: "فيتامين سي فوار", price: 3.2, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 50, isHalal: true, barcode: "P-006", tags: ["فيتامينات"], createdAt: new Date("2024-05-06"), updatedAt: new Date("2024-05-06"), merchantName: "صيدلية الدواء" },
  { id: 7, merchantId: 2, name: "معجون أسنان طبي", description: "معجون أسنان للحماية من التسوس", price: 1.2, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 40, isHalal: true, barcode: "P-007", tags: ["عناية شخصية"], createdAt: new Date("2024-05-07"), updatedAt: new Date("2024-05-07"), merchantName: "صيدلية الدواء" },
  { id: 8, merchantId: 2, name: "شامبو طبي مضاد للقشرة", description: "شامبو طبي مضاد للقشرة", price: 2.5, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 0, isHalal: true, barcode: "P-008", tags: ["شعر", "عناية شخصية"], createdAt: new Date("2024-05-08"), updatedAt: new Date("2024-05-08"), merchantName: "صيدلية الدواء" },
  { id: 9, merchantId: 14, name: "مسكن ألم 500مجم", description: "أقراص مسكنة للآلام الخفيفة", price: 1.8, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 60, isHalal: true, barcode: "P-009", tags: ["مسكنات"], createdAt: new Date("2024-05-09"), updatedAt: new Date("2024-05-09"), merchantName: "صيدلية الرازي" },
  { id: 10, merchantId: 14, name: "كريم مرطب للبشرة", description: "كريم مرطب للبشرة الجافة", price: 4.5, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 22, isHalal: true, barcode: "P-010", tags: ["بشرة", "عناية"], createdAt: new Date("2024-05-10"), updatedAt: new Date("2024-05-10"), merchantName: "صيدلية الرازي" },

  // Clothing products
  { id: 11, merchantId: 3, name: "ثوب أبيض كلاسيك", description: "ثوب أبيض قطني فاخر", price: 12, currency: "SAR", category: "Clothing", imageUrl: null, stock: 35, isHalal: true, barcode: "P-011", tags: ["ثياب", "رجالي"], createdAt: new Date("2024-05-11"), updatedAt: new Date("2024-05-11"), merchantName: "أزياء النور" },
  { id: 12, merchantId: 3, name: "شماغ أحمر", description: "شماغ فاخر يدوي النسيج", price: 45, currency: "SAR", category: "Clothing", imageUrl: null, stock: 18, isHalal: true, barcode: "P-012", tags: ["إكسسوارات", "رجالي"], createdAt: new Date("2024-05-12"), updatedAt: new Date("2024-05-12"), merchantName: "أزياء النور" },
  { id: 13, merchantId: 3, name: "عباية سوداء فاخرة", description: "عباية سوداء مطرزة باليد", price: 150, currency: "SAR", category: "Clothing", imageUrl: null, stock: 10, isHalal: true, barcode: "P-013", tags: ["عبايات", "نسائي"], createdAt: new Date("2024-05-13"), updatedAt: new Date("2024-05-13"), merchantName: "أزياء النور" },
  { id: 14, merchantId: 13, name: "تيشيرت بولو", description: "تيشيرت بولو قطني 100%", price: 8, currency: "OMR", category: "Clothing", imageUrl: null, stock: 42, isHalal: true, barcode: "P-014", tags: ["رياضي", "رجالي"], createdAt: new Date("2024-05-14"), updatedAt: new Date("2024-05-14"), merchantName: "أزياء الجنوب" },
  { id: 15, merchantId: 13, name: "بنطلون جينز", description: "بنطلون جينز أزرق كلاسيكي", price: 15, currency: "OMR", category: "Clothing", imageUrl: null, stock: 28, isHalal: true, barcode: "P-015", tags: ["جينز", "رجالي"], createdAt: new Date("2024-05-15"), updatedAt: new Date("2024-05-15"), merchantName: "أزياء الجنوب" },

  // Grocery products
  { id: 16, merchantId: 4, name: "أرز بسمتي هندي", description: "أرز بسمتي هندي فاخر 5 كيلو", price: 3.5, currency: "KWD", category: "Grocery", imageUrl: null, stock: 45, isHalal: true, barcode: "P-016", tags: ["أرز"], createdAt: new Date("2024-05-16"), updatedAt: new Date("2024-05-16"), merchantName: "سوبرماركت السلام" },
  { id: 17, merchantId: 4, name: "زيت زيتون بكر", description: "زيت زيتون بكر ممتاز 1 لتر", price: 4.2, currency: "KWD", category: "Grocery", imageUrl: null, stock: 30, isHalal: true, barcode: "P-017", tags: ["زيوت"], createdAt: new Date("2024-05-17"), updatedAt: new Date("2024-05-17"), merchantName: "سوبرماركت السلام" },
  { id: 18, merchantId: 4, name: "تمر سكري مجهول", description: "تمر سكري فاخر 1 كيلو", price: 2.5, currency: "KWD", category: "Grocery", imageUrl: null, stock: 55, isHalal: true, barcode: "P-018", tags: ["تمور"], createdAt: new Date("2024-05-18"), updatedAt: new Date("2024-05-18"), merchantName: "سوبرماركت السلام" },
  { id: 19, merchantId: 4, name: "قهوة عربية", description: "قهوة عربية خليجية 500جرام", price: 6, currency: "KWD", category: "Grocery", imageUrl: null, stock: 20, isHalal: true, barcode: "P-019", tags: ["قهوة"], createdAt: new Date("2024-05-19"), updatedAt: new Date("2024-05-19"), merchantName: "سوبرماركت السلام" },
  { id: 20, merchantId: 4, name: "عسل سدر طبيعي", description: "عسل سدر طبيعي 100% 500جرام", price: 12, currency: "KWD", category: "Grocery", imageUrl: null, stock: 8, isHalal: true, barcode: "P-020", tags: ["عسل"], createdAt: new Date("2024-05-20"), updatedAt: new Date("2024-05-20"), merchantName: "سوبرماركت السلام" },

  // Electronics products
  { id: 21, merchantId: 5, name: "سماعات بلوتوث لاسلكية", description: "سماعات بلوتوث مع إلغاء الضوضاء", price: 35, currency: "AED", category: "Electronics", imageUrl: null, stock: 18, isHalal: true, barcode: "P-021", tags: ["سماعات"], createdAt: new Date("2024-05-21"), updatedAt: new Date("2024-05-21"), merchantName: "إلكترونيات المستقبل" },
  { id: 22, merchantId: 5, name: "شاحن سريع 65 واط", description: "شاحن جداري سريع مع منافذ USB-C", price: 45, currency: "AED", category: "Electronics", imageUrl: null, stock: 30, isHalal: true, barcode: "P-022", tags: ["شواحن"], createdAt: new Date("2024-05-22"), updatedAt: new Date("2024-05-22"), merchantName: "إلكترونيات المستقبل" },
  { id: 23, merchantId: 5, name: "كيبل USB-C 2متر", description: "كيبل USB-C للشحن السريع والنقل", price: 20, currency: "AED", category: "Electronics", imageUrl: null, stock: 5, isHalal: true, barcode: "P-023", tags: ["كوابل"], createdAt: new Date("2024-05-23"), updatedAt: new Date("2024-05-23"), merchantName: "إلكترونيات المستقبل" },
  { id: 24, merchantId: 15, name: "ماوس لاسلكي", description: "ماوس لاسلكي مريح للألعاب", price: 180, currency: "EGP", category: "Electronics", imageUrl: null, stock: 14, isHalal: true, barcode: "P-024", tags: ["كمبيوتر"], createdAt: new Date("2024-05-24"), updatedAt: new Date("2024-05-24"), merchantName: "إلكترونيات برج العرب" },
  { id: 25, merchantId: 15, name: "لوحة مفاتيح ميكانيكية", description: "لوحة مفاتيح ميكانيكية للألعاب", price: 450, currency: "EGP", category: "Electronics", imageUrl: null, stock: 0, isHalal: true, barcode: "P-025", tags: ["كمبيوتر", "ألعاب"], createdAt: new Date("2024-05-25"), updatedAt: new Date("2024-05-25"), merchantName: "إلكترونيات برج العرب" },

  // Salon/Beauty products
  { id: 26, merchantId: 6, name: "جلسة عناية بالبشرة", description: "جلسة كاملة لتنظيف وترطيب البشرة", price: 15, currency: "KWD", category: "Beauty", imageUrl: null, stock: 8, isHalal: true, barcode: "P-026", tags: ["عناية بالبشرة"], createdAt: new Date("2024-05-26"), updatedAt: new Date("2024-05-26"), merchantName: "صالون لمسة جمال" },
  { id: 27, merchantId: 6, name: "قص وتسريحة شعر", description: "قص وتسريحة شعر احترافية", price: 8, currency: "KWD", category: "Beauty", imageUrl: null, stock: 12, isHalal: true, barcode: "P-027", tags: ["شعر"], createdAt: new Date("2024-05-27"), updatedAt: new Date("2024-05-27"), merchantName: "صالون لمسة جمال" },
  { id: 28, merchantId: 6, name: "مناكير وباديكير", description: "جلسة مناكير وباديكير كاملة", price: 10, currency: "KWD", category: "Beauty", imageUrl: null, stock: 6, isHalal: true, barcode: "P-028", tags: ["أظافر"], createdAt: new Date("2024-05-28"), updatedAt: new Date("2024-05-28"), merchantName: "صالون لمسة جمال" },

  // Clinic products
  { id: 29, merchantId: 11, name: "كشف طبي عام", description: "كشف طبي شامل مع فحوصات", price: 10, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 20, isHalal: true, barcode: "P-029", tags: ["صحة"], createdAt: new Date("2024-05-29"), updatedAt: new Date("2024-05-29"), merchantName: "عيادة الريان" },
  { id: 30, merchantId: 11, name: "تحليل دم شامل", description: "تحليل دم شامل يشمل جميع المعايير", price: 18, currency: "KWD", category: "Pharmacy", imageUrl: null, stock: 15, isHalal: true, barcode: "P-030", tags: ["مختبر"], createdAt: new Date("2024-05-30"), updatedAt: new Date("2024-05-30"), merchantName: "عيادة الريان" },

  // Bookstore products
  { id: 31, merchantId: 9, name: "كتاب السيرة النبوية", description: "السيرة النبوية لابن هشام", price: 25, currency: "SAR", category: "Home", imageUrl: null, stock: 12, isHalal: true, barcode: "P-031", tags: ["كتب دينية"], createdAt: new Date("2024-06-01"), updatedAt: new Date("2024-06-01"), merchantName: "مكتبة العبيكان" },
  { id: 32, merchantId: 9, name: "كتاب تفسير القرآن", description: "تفسير ابن كثير 4 أجزاء", price: 80, currency: "SAR", category: "Home", imageUrl: null, stock: 7, isHalal: true, barcode: "P-032", tags: ["كتب دينية"], createdAt: new Date("2024-06-02"), updatedAt: new Date("2024-06-02"), merchantName: "مكتبة العبيكان" },
  { id: 33, merchantId: 9, name: "دفتر ملاحظات جلدي", description: "دفتر ملاحظات فاخر بغلاف جلدي", price: 18, currency: "SAR", category: "Home", imageUrl: null, stock: 25, isHalal: true, barcode: "P-033", tags: ["قرطاسية"], createdAt: new Date("2024-06-03"), updatedAt: new Date("2024-06-03"), merchantName: "مكتبة العبيكان" },
  { id: 34, merchantId: 9, name: "قلم حبر فاخر", description: "قلم حبر فاخر من ماركة عالمية", price: 45, currency: "SAR", category: "Home", imageUrl: null, stock: 16, isHalal: true, barcode: "P-034", tags: ["قرطاسية"], createdAt: new Date("2024-06-04"), updatedAt: new Date("2024-06-04"), merchantName: "مكتبة العبيكان" },

  // Wholesale products
  { id: 35, merchantId: 10, name: "زيت نباتي 18 لتر", description: "زيت نباتي للطبخ بالجملة 18 لتر", price: 22, currency: "KWD", category: "Grocery", imageUrl: null, stock: 100, isHalal: true, barcode: "P-035", tags: ["جملة", "زيوت"], createdAt: new Date("2024-06-05"), updatedAt: new Date("2024-06-05"), merchantName: "تاجر الجملة" },
  { id: 36, merchantId: 10, name: "سكر أبيض 50 كيلو", description: "سكر أبيض للجملة 50 كيلوجرام", price: 18, currency: "KWD", category: "Grocery", imageUrl: null, stock: 80, isHalal: true, barcode: "P-036", tags: ["جملة", "سكر"], createdAt: new Date("2024-06-06"), updatedAt: new Date("2024-06-06"), merchantName: "تاجر الجملة" },
  { id: 37, merchantId: 10, name: "منظفات متنوعة", description: "كرتون منظفات متنوعة 24 قطعة", price: 35, currency: "KWD", category: "Grocery", imageUrl: null, stock: 60, isHalal: true, barcode: "P-037", tags: ["جملة", "منظفات"], createdAt: new Date("2024-06-07"), updatedAt: new Date("2024-06-07"), merchantName: "تاجر الجملة" },
  { id: 38, merchantId: 10, name: "مناديل ورقية 48 رول", description: "كرتون مناديل ورقية 48 رول", price: 12, currency: "KWD", category: "Grocery", imageUrl: null, stock: 120, isHalal: true, barcode: "P-038", tags: ["جملة", "ورقيات"], createdAt: new Date("2024-06-08"), updatedAt: new Date("2024-06-08"), merchantName: "تاجر الجملة" },

  // Workshop products
  { id: 39, merchantId: 8, name: "تغيير زيت المحرك", description: "تغيير زيت محرك + فلتر", price: 25, currency: "QAR", category: "Electronics", imageUrl: null, stock: 15, isHalal: true, barcode: "P-039", tags: ["صيانة"], createdAt: new Date("2024-06-09"), updatedAt: new Date("2024-06-09"), merchantName: "ورشة الصقر للسيارات" },
  { id: 40, merchantId: 8, name: "كشف كمبيوتر شامل", description: "فحص كمبيوتر شامل للسيارة", price: 15, currency: "QAR", category: "Electronics", imageUrl: null, stock: 20, isHalal: true, barcode: "P-040", tags: ["فحص"], createdAt: new Date("2024-06-10"), updatedAt: new Date("2024-06-10"), merchantName: "ورشة الصقر للسيارات" },

  // Real estate services
  { id: 41, merchantId: 7, name: "استشارة عقارية", description: "استشارة عقارية شاملة", price: 50, currency: "KWD", category: "Home", imageUrl: null, stock: 10, isHalal: true, barcode: "P-041", tags: ["استشارة"], createdAt: new Date("2024-06-11"), updatedAt: new Date("2024-06-11"), merchantName: "عقارات الكويت" },
  { id: 42, merchantId: 7, name: "إدارة أملاك", description: "خدمة إدارة الأملاك الشهرية", price: 100, currency: "KWD", category: "Home", imageUrl: null, stock: 5, isHalal: true, barcode: "P-042", tags: ["إدارة"], createdAt: new Date("2024-06-12"), updatedAt: new Date("2024-06-12"), merchantName: "عقارات الكويت" },

  // More restaurant items
  { id: 43, merchantId: 1, name: "مندي لحم", description: "مندي لحم تقليدي مع صلصة الطماطم", price: 4, currency: "KWD", category: "Food", imageUrl: null, stock: 20, isHalal: true, barcode: "P-043", tags: ["مندي", "غداء"], createdAt: new Date("2024-06-13"), updatedAt: new Date("2024-06-13"), merchantName: "مطعم الرومانسية" },
  { id: 44, merchantId: 1, name: "مقلوبة دجاج", description: "مقلوبة دجاج مع خضار مشكلة", price: 3, currency: "KWD", category: "Food", imageUrl: null, stock: 18, isHalal: true, barcode: "P-044", tags: ["مقلوبة", "عشاء"], createdAt: new Date("2024-06-14"), updatedAt: new Date("2024-06-14"), merchantName: "مطعم الرومانسية" },
  { id: 45, merchantId: 1, name: "فتة مصرية", description: "فتة مصرية بالخل والثوم", price: 2.2, currency: "KWD", category: "Food", imageUrl: null, stock: 22, isHalal: true, barcode: "P-045", tags: ["فتة"], createdAt: new Date("2024-06-15"), updatedAt: new Date("2024-06-15"), merchantName: "مطعم الرومانسية" },
  { id: 46, merchantId: 1, name: "كبدة مشوية", description: "كبدة مشوية على الطريقة المصرية", price: 3.8, currency: "KWD", category: "Food", imageUrl: null, stock: 14, isHalal: true, barcode: "P-046", tags: ["مشويات"], createdAt: new Date("2024-06-16"), updatedAt: new Date("2024-06-16"), merchantName: "مطعم الرومانسية" },

  // More grocery items
  { id: 47, merchantId: 4, name: "حليب طازج 1 لتر", description: "حليب طازج كامل الدسم 1 لتر", price: 0.8, currency: "KWD", category: "Grocery", imageUrl: null, stock: 40, isHalal: true, barcode: "P-047", tags: ["ألبان"], createdAt: new Date("2024-06-17"), updatedAt: new Date("2024-06-17"), merchantName: "سوبرماركت السلام" },
  { id: 48, merchantId: 4, name: "بيض طازج 30 حبة", description: "بيض طازج أبيض 30 حبة", price: 1.5, currency: "KWD", category: "Grocery", imageUrl: null, stock: 35, isHalal: true, barcode: "P-048", tags: ["بيض"], createdAt: new Date("2024-06-18"), updatedAt: new Date("2024-06-18"), merchantName: "سوبرماركت السلام" },
  { id: 49, merchantId: 4, name: "خبز عربي طازج", description: "خبز عربي طازج 5 أرغفة", price: 0.5, currency: "KWD", category: "Grocery", imageUrl: null, stock: 60, isHalal: true, barcode: "P-049", tags: ["مخبوزات"], createdAt: new Date("2024-06-19"), updatedAt: new Date("2024-06-19"), merchantName: "سوبرماركت السلام" },
  { id: 50, merchantId: 4, name: "جبنة كريمي", description: "جبنة كريمي علبة 500جرام", price: 2, currency: "KWD", category: "Grocery", imageUrl: null, stock: 25, isHalal: true, barcode: "P-050", tags: ["أجبان"], createdAt: new Date("2024-06-20"), updatedAt: new Date("2024-06-20"), merchantName: "سوبرماركت السلام" },
  { id: 51, merchantId: 4, name: "سميد ناعم 2 كيلو", description: "سميد ناعم للكبة والحلويات 2 كيلو", price: 1.8, currency: "KWD", category: "Grocery", imageUrl: null, stock: 0, isHalal: true, barcode: "P-051", tags: ["حبوب"], createdAt: new Date("2024-06-21"), updatedAt: new Date("2024-06-21"), merchantName: "سوبرماركت السلام" },
  { id: 52, merchantId: 4, name: "مكسرات مشكلة 1 كيلو", description: "مكسرات مشكلة فاخرة 1 كيلو", price: 8.5, currency: "KWD", category: "Grocery", imageUrl: null, stock: 4, isHalal: true, barcode: "P-052", tags: ["مكسرات"], createdAt: new Date("2024-06-22"), updatedAt: new Date("2024-06-22"), merchantName: "سوبرماركت السلام" },
];

// ─── 10 Orders in various statuses ───
export const mockOrders: Order[] = [
  {
    id: 1001, userId: 1, merchantId: 1, productIds: [1, 2, 3],
    totalAmount: 7.8, commission: 0.195, status: "delivered",
    paymentMethod: "كي-نت", paymentStatus: "paid",
    trackingNumber: "TRK-KW-001", deliveryEta: new Date("2024-06-20"),
    createdAt: new Date("2024-06-18"), updatedAt: new Date("2024-06-20"),
  },
  {
    id: 1002, userId: 1, merchantId: 2, productIds: [6, 7],
    totalAmount: 4.4, commission: 0.11, status: "shipped",
    paymentMethod: "بطاقة فيزا", paymentStatus: "paid",
    trackingNumber: "TRK-KW-002", deliveryEta: new Date("2024-06-28"),
    createdAt: new Date("2024-06-25"), updatedAt: new Date("2024-06-26"),
  },
  {
    id: 1003, userId: 1, merchantId: 4, productIds: [16, 17, 18],
    totalAmount: 10.2, commission: 0.255, status: "processing",
    paymentMethod: "كي-نت", paymentStatus: "paid",
    trackingNumber: null, deliveryEta: new Date("2024-06-30"),
    createdAt: new Date("2024-06-27"), updatedAt: new Date("2024-06-27"),
  },
  {
    id: 1004, userId: 1, merchantId: 5, productIds: [21],
    totalAmount: 35, commission: 0.875, status: "confirmed",
    paymentMethod: "بطاقة ماستركارد", paymentStatus: "paid",
    trackingNumber: null, deliveryEta: new Date("2024-07-02"),
    createdAt: new Date("2024-06-28"), updatedAt: new Date("2024-06-28"),
  },
  {
    id: 1005, userId: 1, merchantId: 6, productIds: [26],
    totalAmount: 15, commission: 0.375, status: "pending",
    paymentMethod: "نقد عند الاستلام", paymentStatus: "pending",
    trackingNumber: null, deliveryEta: new Date("2024-07-03"),
    createdAt: new Date("2024-06-29"), updatedAt: new Date("2024-06-29"),
  },
  {
    id: 1006, userId: 1, merchantId: 9, productIds: [31, 32],
    totalAmount: 105, commission: 2.625, status: "delivered",
    paymentMethod: "بطاقة فيزا", paymentStatus: "paid",
    trackingNumber: "TRK-SA-001", deliveryEta: new Date("2024-06-22"),
    createdAt: new Date("2024-06-15"), updatedAt: new Date("2024-06-22"),
  },
  {
    id: 1007, userId: 1, merchantId: 3, productIds: [11, 12],
    totalAmount: 57, commission: 1.425, status: "cancelled",
    paymentMethod: "كي-نت", paymentStatus: "refunded",
    trackingNumber: null, deliveryEta: null,
    createdAt: new Date("2024-06-20"), updatedAt: new Date("2024-06-21"),
  },
  {
    id: 1008, userId: 1, merchantId: 11, productIds: [29, 30],
    totalAmount: 28, commission: 0.7, status: "shipped",
    paymentMethod: "بطاقة فيزا", paymentStatus: "paid",
    trackingNumber: "TRK-KW-003", deliveryEta: new Date("2024-07-01"),
    createdAt: new Date("2024-06-26"), updatedAt: new Date("2024-06-27"),
  },
  {
    id: 1009, userId: 1, merchantId: 14, productIds: [9, 10],
    totalAmount: 6.3, commission: 0.1575, status: "processing",
    paymentMethod: "كي-نت", paymentStatus: "paid",
    trackingNumber: null, deliveryEta: new Date("2024-07-04"),
    createdAt: new Date("2024-06-28"), updatedAt: new Date("2024-06-28"),
  },
  {
    id: 1010, userId: 1, merchantId: 7, productIds: [41],
    totalAmount: 50, commission: 1.25, status: "pending",
    paymentMethod: "تحويل بنكي", paymentStatus: "pending",
    trackingNumber: null, deliveryEta: new Date("2024-07-05"),
    createdAt: new Date("2024-06-29"), updatedAt: new Date("2024-06-29"),
  },
];

// ─── Market codes mapping ───
export const marketNames: Record<string, string> = {
  KW: "الكويت",
  SA: "السعودية",
  AE: "الإمارات",
  QA: "قطر",
  BH: "البحرين",
  OM: "عمان",
  EG: "مصر",
  JO: "الأردن",
  LB: "لبنان",
  IQ: "العراق",
  YE: "اليمن",
  SD: "السودان",
  MA: "المغرب",
  DZ: "الجزائر",
  TN: "تونس",
};

// ─── Business type labels in Arabic ───
export const businessTypeLabels: Record<string, string> = {
  restaurant: "مطاعم",
  pharmacy: "صيدليات",
  clothing: "موضة",
  grocery: "بقالة",
  electronics: "إلكترونيات",
  salon: "صالونات",
  real_estate: "عقارات",
  workshop: "ورش",
  wholesale: "جملة",
  clinic: "عيادات",
  bookstore: "كتب",
  other: "أخرى",
};

// ─── Subscription tier colors ───
export const tierColors: Record<string, { bg: string; text: string; border: string }> = {
  starter: { bg: "bg-gray-500/20", text: "text-gray-300", border: "border-gray-500/30" },
  pro: { bg: "bg-blue-500/20", text: "text-blue-300", border: "border-blue-500/30" },
  enterprise: { bg: "bg-purple-500/20", text: "text-purple-300", border: "border-purple-500/30" },
  ultimate: { bg: "bg-amber-500/20", text: "text-amber-300", border: "border-amber-500/30" },
};

// ─── Business type badge colors ───
export const typeColors: Record<string, string> = {
  restaurant: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  pharmacy: "bg-green-500/20 text-green-300 border-green-500/30",
  clothing: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  grocery: "bg-teal-500/20 text-teal-300 border-teal-500/30",
  electronics: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  salon: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  real_estate: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  workshop: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  wholesale: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  clinic: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  bookstore: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  other: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

// ─── Order status config ───
export const orderStatusConfig: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  pending:    { label: "قيد الانتظار", color: "text-yellow-400", bg: "bg-yellow-500/15 border-yellow-500/30", dot: "bg-yellow-400" },
  confirmed:  { label: "مؤكد",         color: "text-blue-400",   bg: "bg-blue-500/15 border-blue-500/30",   dot: "bg-blue-400" },
  processing: { label: "قيد التجهيز",  color: "text-purple-400", bg: "bg-purple-500/15 border-purple-500/30", dot: "bg-purple-400" },
  shipped:    { label: "تم الشحن",     color: "text-cyan-400",   bg: "bg-cyan-500/15 border-cyan-500/30",   dot: "bg-cyan-400" },
  delivered:  { label: "تم التوصيل",   color: "text-green-400",  bg: "bg-green-500/15 border-green-500/30",  dot: "bg-green-400" },
  cancelled:  { label: "ملغي",         color: "text-red-400",    bg: "bg-red-500/15 border-red-500/30",     dot: "bg-red-400" },
  returned:   { label: "مسترجع",       color: "text-orange-400", bg: "bg-orange-500/15 border-orange-500/30", dot: "bg-orange-400" },
};

// ─── Payment status config ───
export const paymentStatusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "قيد الانتظار", color: "text-yellow-400" },
  paid: { label: "تم الدفع", color: "text-green-400" },
  failed: { label: "فشل الدفع", color: "text-red-400" },
  refunded: { label: "تم الاسترجاع", color: "text-gray-400" },
};

// ─── Product category colors ───
export const categoryColors: Record<string, string> = {
  Food: "bg-orange-500/15 text-orange-300",
  Clothing: "bg-pink-500/15 text-pink-300",
  Electronics: "bg-cyan-500/15 text-cyan-300",
  Pharmacy: "bg-emerald-500/15 text-emerald-300",
  Grocery: "bg-teal-500/15 text-teal-300",
  Beauty: "bg-rose-500/15 text-rose-300",
  Home: "bg-indigo-500/15 text-indigo-300",
};
