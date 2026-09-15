// ============================================================================
// Dynamic Agent Breeder — يولد وكلاء حيين من DNA المنصة
// ============================================================================

import { AgentRole, AgentStatus } from './types';
import type { LivingAgent, PlatformDNA, AgentRecipe, PlatformFeature } from './types';

/** Agent recipes per platform category — what agents to breed */
const RECIPE_LIBRARY: Record<string, AgentRecipe[]> = {
  restaurant: [
    { role: AgentRole.MENU_CURATOR, count: 1, priority: 100, requiredFeatures: ['feat_restaurant_0', 'feat_restaurant_1'] },
    { role: AgentRole.ORDER_HANDLER, count: 2, priority: 95, requiredFeatures: ['feat_restaurant_2'] },
    { role: AgentRole.KITCHEN_COORDINATOR, count: 1, priority: 90, requiredFeatures: ['feat_restaurant_3'] },
    { role: AgentRole.DELIVERY_DISPATCHER, count: 1, priority: 85, requiredFeatures: ['feat_restaurant_4'] },
    { role: AgentRole.PAYMENT_PROCESSOR, count: 1, priority: 80, requiredFeatures: ['feat_restaurant_5'] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 70, requiredFeatures: [] },
    { role: AgentRole.ANALYTICS_EXPERT, count: 1, priority: 60, requiredFeatures: ['feat_restaurant_8'] },
  ],
  car_repair: [
    { role: AgentRole.GARAGE_FINDER, count: 1, priority: 100, requiredFeatures: ['feat_car_repair_0'] },
    { role: AgentRole.BOOKING_SCHEDULER, count: 2, priority: 95, requiredFeatures: ['feat_car_repair_1'] },
    { role: AgentRole.QUOTE_NEGOTIATOR, count: 2, priority: 90, requiredFeatures: ['feat_car_repair_2'] },
    { role: AgentRole.PROGRESS_TRACKER, count: 1, priority: 85, requiredFeatures: ['feat_car_repair_4'] },
    { role: AgentRole.QUALITY_INSPECTOR, count: 1, priority: 80, requiredFeatures: ['feat_car_repair_5'] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 75, requiredFeatures: [] },
    { role: AgentRole.REVIEW_COLLECTOR, count: 1, priority: 65, requiredFeatures: ['feat_car_repair_5'] },
  ],
  pharmacy: [
    { role: AgentRole.INVENTORY_MANAGER, count: 1, priority: 100, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 90, requiredFeatures: [] },
    { role: AgentRole.ORDER_HANDLER, count: 1, priority: 85, requiredFeatures: [] },
  ],
  fashion: [
    { role: AgentRole.SALES_ASSISTANT, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.MARKETING_AGENT, count: 1, priority: 85, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 75, requiredFeatures: [] },
  ],
  grocery: [
    { role: AgentRole.INVENTORY_MANAGER, count: 1, priority: 100, requiredFeatures: [] },
    { role: AgentRole.ORDER_HANDLER, count: 2, priority: 95, requiredFeatures: [] },
    { role: AgentRole.DELIVERY_DISPATCHER, count: 1, priority: 85, requiredFeatures: [] },
  ],
  real_estate: [
    { role: AgentRole.SALES_ASSISTANT, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 85, requiredFeatures: [] },
    { role: AgentRole.ANALYTICS_EXPERT, count: 1, priority: 70, requiredFeatures: [] },
  ],
  salon: [
    { role: AgentRole.BOOKING_SCHEDULER, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 80, requiredFeatures: [] },
  ],
  clinic: [
    { role: AgentRole.BOOKING_SCHEDULER, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 85, requiredFeatures: [] },
    { role: AgentRole.COMPLIANCE_GUARD, count: 1, priority: 90, requiredFeatures: [] },
  ],
  marketplace: [
    { role: AgentRole.SALES_ASSISTANT, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.ORDER_HANDLER, count: 2, priority: 95, requiredFeatures: [] },
    { role: AgentRole.PAYMENT_PROCESSOR, count: 1, priority: 90, requiredFeatures: [] },
    { role: AgentRole.ANALYTICS_EXPERT, count: 1, priority: 75, requiredFeatures: [] },
  ],
  delivery: [
    { role: AgentRole.DELIVERY_DISPATCHER, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.ORDER_HANDLER, count: 1, priority: 90, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 80, requiredFeatures: [] },
  ],
  education: [
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 90, requiredFeatures: [] },
    { role: AgentRole.ANALYTICS_EXPERT, count: 1, priority: 80, requiredFeatures: [] },
  ],
  fitness: [
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 90, requiredFeatures: [] },
    { role: AgentRole.MARKETING_AGENT, count: 1, priority: 80, requiredFeatures: [] },
  ],
  event: [
    { role: AgentRole.BOOKING_SCHEDULER, count: 2, priority: 100, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 85, requiredFeatures: [] },
    { role: AgentRole.MARKETING_AGENT, count: 1, priority: 80, requiredFeatures: [] },
  ],
  custom: [
    { role: AgentRole.CUSTOM_AGENT, count: 3, priority: 100, requiredFeatures: [] },
    { role: AgentRole.CUSTOMER_SUPPORT, count: 1, priority: 80, requiredFeatures: [] },
  ],
};

/** Agent name generator */
const AGENT_NAMES: Record<AgentRole, { ar: string[]; en: string[] }> = {
  [AgentRole.MENU_CURATOR]: { ar: ['منسق القائمة', 'خبير الطعام'], en: ['Menu Curator', 'Food Expert'] },
  [AgentRole.ORDER_HANDLER]: { ar: ['منسق الطلبات', 'مدير الطلبات'], en: ['Order Handler', 'Order Manager'] },
  [AgentRole.KITCHEN_COORDINATOR]: { ar: ['منسق المطبخ', 'مدير الطهي'], en: ['Kitchen Coordinator', 'Chef Manager'] },
  [AgentRole.DELIVERY_DISPATCHER]: { ar: ['مرسل الطلبات', 'منسق التوصيل'], en: ['Dispatch Agent', 'Delivery Coordinator'] },
  [AgentRole.CUSTOMER_SUPPORT]: { ar: ['الدعم الفني', 'مساعد العملاء'], en: ['Support Agent', 'Customer Assistant'] },
  [AgentRole.PAYMENT_PROCESSOR]: { ar: ['معالج المدفوعات', 'خبير الدفع'], en: ['Payment Agent', 'Billing Expert'] },
  [AgentRole.ANALYTICS_EXPERT]: { ar: ['محلل البيانات', 'خبير التحليلات'], en: ['Analytics Agent', 'Data Expert'] },
  [AgentRole.GARAGE_FINDER]: { ar: ['الباحث عن ورش', 'مستكشف الورش'], en: ['Garage Finder', 'Shop Scout'] },
  [AgentRole.QUOTE_NEGOTIATOR]: { ar: ['المفاوض', 'محلل الأسعار'], en: ['Price Negotiator', 'Quote Analyst'] },
  [AgentRole.BOOKING_SCHEDULER]: { ar: ['منسق المواعيد', 'مدير الجدولة'], en: ['Booking Agent', 'Schedule Manager'] },
  [AgentRole.PROGRESS_TRACKER]: { ar: ['متتبع التقدم', 'مراقب الإصلاح'], en: ['Progress Tracker', 'Repair Monitor'] },
  [AgentRole.REVIEW_COLLECTOR]: { ar: ['جامع التقييمات', 'محلل الرأي'], en: ['Review Collector', 'Feedback Analyst'] },
  [AgentRole.QUALITY_INSPECTOR]: { ar: ['مفتش الجودة', 'مراقب الجودة'], en: ['Quality Inspector', 'QC Agent'] },
  [AgentRole.INVENTORY_MANAGER]: { ar: ['مدير المخزون', 'منسق المخزن'], en: ['Inventory Agent', 'Stock Manager'] },
  [AgentRole.MARKETING_AGENT]: { ar: ['مسوق ذكي', 'خبير التسويق'], en: ['Marketing Agent', 'Growth Expert'] },
  [AgentRole.SALES_ASSISTANT]: { ar: ['مساعد المبيعات', 'مستشار الشراء'], en: ['Sales Agent', 'Buying Advisor'] },
  [AgentRole.HR_RECRUITER]: { ar: ['مسؤول التوظيف', 'مستشار الموارد'], en: ['HR Agent', 'Talent Scout'] },
  [AgentRole.FINANCE_ADVISOR]: { ar: ['مستشار مالي', 'محلل مالي'], en: ['Finance Agent', 'Money Advisor'] },
  [AgentRole.COMPLIANCE_GUARD]: { ar: ['حارس الامتثال', 'مراقب القوانين'], en: ['Compliance Agent', 'Rule Guard'] },
  [AgentRole.CUSTOM_AGENT]: { ar: ['وكيل مخصص', 'مساعد ذكي'], en: ['Custom Agent', 'Smart Assistant'] },
};

/** Skills per role */
const AGENT_SKILLS: Record<AgentRole, string[]> = {
  [AgentRole.MENU_CURATOR]: ['menu_analysis', 'dietary_recommendations', 'trending_dishes', 'seasonal_suggestions'],
  [AgentRole.ORDER_HANDLER]: ['order_processing', 'status_tracking', 'cancellation_handling', 'modification_requests'],
  [AgentRole.KITCHEN_COORDINATOR]: ['kitchen_queue', 'prep_time_calc', 'ingredient_availability', 'rush_management'],
  [AgentRole.DELIVERY_DISPATCHER]: ['route_optimization', 'driver_assignment', 'eta_calculation', 'delivery_tracking'],
  [AgentRole.CUSTOMER_SUPPORT]: ['inquiry_handling', 'complaint_resolution', 'multilingual_chat', 'escalation'],
  [AgentRole.PAYMENT_PROCESSOR]: ['knet_integration', 'apple_pay', 'refund_processing', 'invoice_generation'],
  [AgentRole.ANALYTICS_EXPERT]: ['sales_analysis', 'churn_prediction', 'demographic_insights', 'forecasting'],
  [AgentRole.GARAGE_FINDER]: ['location_search', 'specialty_matching', 'availability_check', 'price_comparison'],
  [AgentRole.QUOTE_NEGOTIATOR]: ['price_analysis', 'discount_engine', 'warranty_comparison', 'labor_estimation'],
  [AgentRole.BOOKING_SCHEDULER]: ['slot_management', 'reminder_system', 'rescheduling', 'calendar_sync'],
  [AgentRole.PROGRESS_TRACKER]: ['milestone_tracking', 'photo_collection', 'update_messaging', 'delay_alerts'],
  [AgentRole.REVIEW_COLLECTOR]: ['review_prompts', 'sentiment_analysis', 'response_generation', 'reputation_score'],
  [AgentRole.QUALITY_INSPECTOR]: ['checklist_generation', 'defect_detection', 'warranty_validation', 'reporting'],
  [AgentRole.INVENTORY_MANAGER]: ['stock_monitoring', 'reorder_alerts', 'expiry_tracking', 'supplier_sync'],
  [AgentRole.MARKETING_AGENT]: ['campaign_builder', 'audience_targeting', 'ab_testing', 'roi_tracking'],
  [AgentRole.SALES_ASSISTANT]: ['product_recommendations', 'upselling', 'cross_selling', 'checkout_optimization'],
  [AgentRole.HR_RECRUITER]: ['cv_parsing', 'skill_matching', 'interview_scheduling', 'offer_management'],
  [AgentRole.FINANCE_ADVISOR]: ['budget_planning', 'expense_tracking', 'tax_calculation', 'investment_advice'],
  [AgentRole.COMPLIANCE_GUARD]: ['kyc_verification', 'fraud_detection', 'audit_trail', 'regulatory_reporting'],
  [AgentRole.CUSTOM_AGENT]: ['task_automation', 'data_processing', 'integration_building', 'workflow_design'],
};

/** SVG icons per role */
const AGENT_ICONS: Record<AgentRole, string> = {
  [AgentRole.MENU_CURATOR]: 'book-open',
  [AgentRole.ORDER_HANDLER]: 'clipboard-list',
  [AgentRole.KITCHEN_COORDINATOR]: 'chef-hat',
  [AgentRole.DELIVERY_DISPATCHER]: 'truck',
  [AgentRole.CUSTOMER_SUPPORT]: 'headphones',
  [AgentRole.PAYMENT_PROCESSOR]: 'credit-card',
  [AgentRole.ANALYTICS_EXPERT]: 'bar-chart-3',
  [AgentRole.GARAGE_FINDER]: 'search',
  [AgentRole.QUOTE_NEGOTIATOR]: 'scale',
  [AgentRole.BOOKING_SCHEDULER]: 'calendar-clock',
  [AgentRole.PROGRESS_TRACKER]: 'activity',
  [AgentRole.REVIEW_COLLECTOR]: 'message-square-quote',
  [AgentRole.QUALITY_INSPECTOR]: 'shield-check',
  [AgentRole.INVENTORY_MANAGER]: 'package',
  [AgentRole.MARKETING_AGENT]: 'megaphone',
  [AgentRole.SALES_ASSISTANT]: 'shopping-bag',
  [AgentRole.HR_RECRUITER]: 'users',
  [AgentRole.FINANCE_ADVISOR]: 'trending-up',
  [AgentRole.COMPLIANCE_GUARD]: 'lock',
  [AgentRole.CUSTOM_AGENT]: 'sparkles',
};

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

/** Breed agents from Platform DNA */
export function breedAgents(dna: PlatformDNA): LivingAgent[] {
  const rng = seededRandom(dna.id + '_agents');
  const recipes = RECIPE_LIBRARY[dna.category] || RECIPE_LIBRARY['custom'];
  const agents: LivingAgent[] = [];

  // Determine which features are enabled
  const enabledFeatureIds = new Set(dna.features.filter(f => f.isEnabled).map(f => f.id));

  for (const recipe of recipes) {
    // Check if required features are enabled
    const hasRequiredFeatures = recipe.requiredFeatures.length === 0 ||
      recipe.requiredFeatures.some(fid => enabledFeatureIds.has(fid));

    if (!hasRequiredFeatures) continue;

    // Scale agent count by complexity
    const scaledCount = Math.max(1, Math.round(recipe.count * (0.5 + dna.complexity * 0.5)));

    for (let i = 0; i < scaledCount; i++) {
      const namePool = AGENT_NAMES[recipe.role];
      const nameAr = namePool.ar[i % namePool.ar.length];
      const nameEn = namePool.en[i % namePool.en.length];
      const uniqueName = scaledCount > 1 ? `${nameEn} ${i + 1}` : nameEn;
      const uniqueNameAr = scaledCount > 1 ? `${nameAr} ${i + 1}` : nameAr;

      // Generate unique gene marker from platform DNA + role + index
      const geneMarker = dna.geneSequence.slice(0, 8).map((g, gi) => {
        const mutation = Math.sin(recipe.priority * 0.1 + gi * 0.5 + i) * 0.2;
        return Math.max(0, Math.min(1, g + mutation));
      });

      // Color derived from platform colors + role offset
      const hueOffset = (Object.keys(AgentRole).indexOf(recipe.role) * 30) % 360;
      const color = shiftHue(dna.colors.primary, hueOffset);
      const glowColor = shiftHue(dna.colors.glow, hueOffset * 0.5);

      const agent: LivingAgent = {
        id: `agent_${dna.id}_${recipe.role}_${i}`,
        platformId: dna.id,
        name: uniqueName,
        nameAr: uniqueNameAr,
        role: recipe.role,
        description: `${uniqueName} — ${dna.name} platform agent`,
        descriptionAr: `${uniqueNameAr} — وكيل منصة ${dna.nameAr}`,
        skills: AGENT_SKILLS[recipe.role],
        geneMarker,
        color,
        glowColor,
        iconSvg: AGENT_ICONS[recipe.role],
        status: AgentStatus.SPAWNING,
        energy: 50 + Math.floor(rng() * 50),
        experience: 0,
        tasksCompleted: 0,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      };

      agents.push(agent);
    }
  }

  return agents;
}

/** Evolve a single agent — gains experience, may upgrade status */
export function evolveAgent(agent: LivingAgent): LivingAgent {
  const energyRegen = 2;
  const expGain = agent.status === AgentStatus.WORKING ? 5 : 1;

  let newStatus = agent.status;
  if (agent.status === AgentStatus.SPAWNING && agent.energy > 60) newStatus = AgentStatus.LEARNING;
  if (agent.status === AgentStatus.LEARNING && agent.experience > 20) newStatus = AgentStatus.READY;
  if (agent.status === AgentStatus.RESTING && agent.energy > 70) newStatus = AgentStatus.READY;
  if (agent.status === AgentStatus.READY && agent.experience > 50) newStatus = AgentStatus.EVOLVING;
  if (agent.status === AgentStatus.EVOLVING && agent.experience > 60) newStatus = AgentStatus.READY;

  return {
    ...agent,
    energy: Math.min(100, agent.energy + energyRegen),
    experience: Math.min(100, agent.experience + expGain),
    status: newStatus,
    lastActiveAt: Date.now(),
  };
}

/** Activate agent for work (consumes energy) */
export function activateAgent(agent: LivingAgent): LivingAgent {
  if (agent.energy < 10) {
    return { ...agent, status: AgentStatus.RESTING };
  }
  return {
    ...agent,
    status: AgentStatus.WORKING,
    energy: Math.max(0, agent.energy - 10),
    tasksCompleted: agent.tasksCompleted + 1,
    lastActiveAt: Date.now(),
  };
}

/** Shift hue of a hex color by degrees */
function shiftHue(hex: string, deg: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  h = (h * 360 + deg) % 360;
  if (h < 0) h += 360;

  // Simple HSL to RGB conversion with full saturation
  const c = 1;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = 0;

  let [rr, gg, bb] = [0, 0, 0];
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
}
