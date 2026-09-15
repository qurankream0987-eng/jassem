import type { IntentStructure } from "@contracts/dna";

/**
 * Language-level fallback for runtime composition.
 *
 * The lexicon extracts generic roles and operations. It never selects an app,
 * agent class, screen component or domain workflow.
 */
export function parseDeterministicIntent(goal: string): IntentStructure {
  const lower = goal.toLowerCase();
  const describesLending = /lend|borrow|rent|استعارة|أستعير|استعير|إعارة|اعارة|أعير|اعير|أداة|أدوات|جار|جيران/i.test(lower);
  const describesPersistentWorld = /(منصة|نظام|مساحة|بيئة|platform|system|workspace|environment)/i.test(lower);
  const describesExplicitPurchase = /buy|purchase|order|شراء|اشتر|أشتري|اشتري|اطلب|أطلب/i.test(lower);
  const actors: IntentStructure["actors"] = [];
  if (/(أبيع|ابيع|بيع|أعرض|اعرض|sell|offer|list)/i.test(lower)) {
    actors.push({ role: "initiator_of_exchange", description: "Initiates the requested exchange" });
    actors.push({ role: "interested_counterparty", description: "Any party whose intent matches the generated offer" });
  }
  if (/seller|vendor|owner/i.test(lower)) actors.push({ role: "provider_described_by_goal", description: "Provides the subject described by the goal" });
  if (/buyer|purchaser|customer/i.test(lower)) actors.push({ role: "buyer", description: "Seeks to acquire items" });
  if (/lender|owner|إعارة|اعارة|أعير|اعير/i.test(lower) || describesLending) actors.push({ role: "lender", description: "Provides subjects for temporary use" });
  if (/borrower|renter|استعارة|أستعير|استعير/i.test(lower) || describesLending) actors.push({ role: "borrower", description: "Requests temporary use of a subject" });
  if (/مطعم|متجر|محل|restaurant|store|shop/i.test(lower)) {
    actors.push({ role: "source_provider", description: "Provides the requested resource" });
  }
  if (/سائق|مندوب|driver|courier/i.test(lower)) {
    actors.push({ role: "fulfillment_provider", description: "Fulfils or transports the commitment" });
  }
  if (/(منصة|نظام|مساحة|بيئة|platform|system|workspace|environment)/i.test(lower)) {
    actors.push({ role: "world_initiator", description: "Defines and evolves a reusable world" });
  }
  if (actors.length === 0) actors.push({ role: "user", description: "Primary actor" });

  const objects: IntentStructure["objects"] = [];
  const offeredSubject = goal.match(/(?:أريد|اريد|أبي|ابي)?\s*(?:بيع|أبيع|ابيع|عرض|أعرض|اعرض)\s+(.+?)(?=\s+(?:بسعر|بمبلغ|مع|وأريد|واريد|وأبي|وابي)|$)/iu)
    ?? goal.match(/(?:sell|offer|list)\s+(?:my\s+)?(.+?)(?=\s+(?:for|with|and)|$)/i);
  const environmentSubject = goal.match(/(?:محل|متجر|مساحة|منصة)\s+(.+?)(?=\s+(?:أريد|اريد|أبي|ابي|يجمع|تجمع)|$)/iu);
  const offeredSubjectName = offeredSubject?.[1]?.trim();
  if (offeredSubjectName) {
    objects.push({
      name: offeredSubjectName,
      type: "subject",
      attributes: /(صورة|صور|مرفق|image|photo|picture|attachment)/i.test(lower)
        ? { visualEvidence: "user_supplied" }
        : {},
    });
  }
  const objectKeywords = [
    { pattern: /furniture|أثاث/, name: "Furniture", type: "product" },
    { pattern: /car|سيارة|vehicle/, name: "Vehicle", type: "product" },
    { pattern: /tool|أداة|أدوات|equipment/, name: "Tool", type: "product" },
    { pattern: /phone|هاتف|mobile/, name: "Phone", type: "product" },
    { pattern: /book|كتاب/, name: "Book", type: "product" },
    { pattern: /house|منزل|property|عقار/, name: "Property", type: "product" },
    { pattern: /service|خدمة/, name: "Service", type: "service" },
    { pattern: /طعام|وجبة|وجبات|أكل|اكل|food|meal/, name: "Requested Resource", type: "resource" },
  ];
  for (const item of objectKeywords) {
    if (objects.length > 0) break;
    if (!item.pattern.test(lower)) continue;
    objects.push({ name: item.name, type: item.type, attributes: { category: lower.match(item.pattern)?.[0] } });
    break;
  }
  const environmentSubjectName = environmentSubject?.[1]?.trim();
  if (objects.length === 0 && environmentSubjectName) {
    objects.push({
      name: environmentSubjectName,
      type: "subject",
      attributes: {},
    });
  }
  if (objects.length === 0) objects.push({ name: "Item", type: "product", attributes: {} });

  const domainHints: string[] = [];
  if (/marketplace|sell|buy|سوق|بيع|شراء/i.test(lower)) domainHints.push("exchange");
  if (/marketplace|سوق/i.test(lower)) domainHints.push("marketplace");
  if (describesLending) domainHints.push("lending");
  if (/service|خدمة/i.test(lower)) domainHints.push("services");
  if (describesExplicitPurchase || (
    /أريد|اريد|طلب|want/i.test(lower) && !describesLending && !describesPersistentWorld
  )) domainHints.push("acquisition");
  if (/سائق|مندوب|توصيل|يوصل|driver|courier|deliver/i.test(lower)) domainHints.push("fulfillment");
  if (describesPersistentWorld) domainHints.push("persistent-world");

  const actions: string[] = [];
  const actionKeywords: Record<string, string[]> = {
    create: ["create", "add", "new", "post", "إنشاء", "إضافة", "جديد"],
    search: ["search", "find", "browse", "discover", "بحث"],
    filter: ["filter", "narrow", "refine", "تصفية"],
    compare: ["compare", "contrast", "مقارنة"],
    negotiate: ["negotiate", "haggle", "offer", "bid", "تفاوض", "عرض"],
    confirm: ["confirm", "approve", "accept", "تأكيد"],
    contact: ["contact", "message", "chat", "تواصل", "رسالة"],
    track: ["track", "monitor", "follow", "تتبع"],
    verify: ["verify", "validate", "check", "التحقق"],
    buy: ["buy", "purchase", "order", "اطلب", "أطلب", "شراء", "اشتر", "أشتري", "اشتري"],
    borrow: ["borrow", "rent", "استعارة", "أستعير", "استعير"],
    lend: ["lend", "loan", "إعارة", "اعارة", "أعير", "اعير"],
    delegate: ["delegate", "assign", "deliver", "سائق", "مندوب", "توصيل", "يوصل"],
    sell: ["sell", "offer", "list", "publish", "بيع", "أبيع", "ابيع", "أعرض", "اعرض", "انشر"],
    build: ["build", "compose", "platform", "system", "workspace", "ابن", "ابني", "أنشئ", "انشئ", "منصة", "نظام", "مساحة"],
    vision: ["image", "photo", "picture", "attachment", "صورة", "صور", "مرفق"],
    analyze: ["analyze", "appraise", "value", "estimate", "حلل", "قيم", "تقييم", "السعر"],
  };
  for (const [action, keywords] of Object.entries(actionKeywords)) {
    if (keywords.some((keyword) => lower.includes(keyword))) actions.push(action);
  }
  if (domainHints.includes("acquisition") && !actions.includes("buy")) actions.push("buy");
  if (domainHints.includes("exchange") && !actions.includes("search")) actions.push("search", "filter");
  if (domainHints.includes("acquisition") && !actions.includes("search")) actions.push("search");
  if (domainHints.includes("lending") && !actions.includes("search")) actions.push("search");
  if (domainHints.includes("fulfillment") && !actions.includes("track")) actions.push("track");
  if (actions.includes("sell")) {
    const buyIndex = actions.indexOf("buy");
    if (buyIndex >= 0) actions.splice(buyIndex, 1);
    if (!actions.includes("analyze")) actions.push("analyze");
    if (!actions.includes("negotiate")) actions.push("negotiate");
  }
  if (domainHints.includes("persistent-world") && !actions.includes("build")) actions.push("build");
  if (actions.length === 0) actions.push("create", "search", "read");

  const constraints: IntentStructure["constraints"] = [];
  if (/near|local|location|قريب|الأقرب|اقرب/i.test(lower)) {
    constraints.push({ type: "location", field: "location", operator: "near", value: "user_location" });
  }
  if (/price|budget|سعر|ميزانية/i.test(lower)) {
    constraints.push({ type: "budget", field: "price", operator: "lte", value: "user_budget" });
  }

  return {
    goal,
    actors,
    objects,
    actions,
    constraints,
    desiredOutcomes: [goal],
    unknowns: [],
    domainHints,
    confidence: 0.6,
  };
}
