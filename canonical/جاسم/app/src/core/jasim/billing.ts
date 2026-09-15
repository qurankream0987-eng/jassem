import type { DagPlan, ExecutionContext } from './types';

export interface PricingConfig {
  baseRate: number;
  perCapabilityRate: number;
  perNodeRate: number;
  perTransactionRate: number;
  subscriptionDiscount: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  baseRate: 0.01,
  perCapabilityRate: 0.05,
  perNodeRate: 0.02,
  perTransactionRate: 0.01,
  subscriptionDiscount: 0.2,
} as const;

export function calculateEstimatedCost(plan: DagPlan, config: PricingConfig = DEFAULT_PRICING): number {
  const baseCost = config.baseRate;
  const nodeCost = plan.nodes.length * config.perNodeRate;
  const capabilityCost = plan.nodes.length * config.perCapabilityRate;
  return baseCost + nodeCost + capabilityCost;
}

export function calculateActualCost(context: ExecutionContext, config: PricingConfig = DEFAULT_PRICING): number {
  const baseCost = config.baseRate;
  const executedNodes = Object.keys(context.results).length;
  const nodeCost = executedNodes * config.perNodeRate;
  return baseCost + nodeCost;
}

export function getPricingConfig(): PricingConfig {
  return { ...DEFAULT_PRICING };
}

export function checkSubscriptionLimits(
  usage: number,
  limit: number,
  subscription: string
): { allowed: boolean; remaining: number; exceeded: boolean } {
  const discount = subscription === 'enterprise' ? 0.5 : subscription === 'pro' ? 0.2 : 0;
  const effectiveLimit = limit * (1 + discount);
  const remaining = effectiveLimit - usage;
  return {
    allowed: usage < effectiveLimit,
    remaining: Math.max(0, remaining),
    exceeded: usage >= effectiveLimit,
  };
}

export function applyDiscount(cost: number, discountPercent: number): number {
  return cost * (1 - discountPercent);
}

export function formatCost(cost: number, currency: string = 'KWD'): string {
  return `${cost.toFixed(3)} ${currency}`;
}
