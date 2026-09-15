import type { TrustPolicy } from './types';

const TRUST_POLICIES: Map<string, TrustPolicy> = new Map();

export function createTrustPolicy(policy: TrustPolicy): void {
  TRUST_POLICIES.set(policy.id, policy);
}

export function validateAction(
  action: string,
  userKycLevel: string,
  transactionValue: number,
  policyId: string
): { allowed: boolean; reason: string; requirements: string[] } {
  const policy = TRUST_POLICIES.get(policyId);
  if (!policy) {
    return { allowed: true, reason: 'No policy found', requirements: [] };
  }

  const requirements: string[] = [];

  if (policy.kycRequired && !checkKycLevel(userKycLevel, policy.kycLevel)) {
    requirements.push(`KYC level ${policy.kycLevel} required`);
  }

  if (transactionValue > policy.maxTransactionValue) {
    requirements.push(`Transaction exceeds maximum ${policy.maxTransactionValue}`);
  }

  if (policy.escrowRequired) {
    requirements.push('Escrow required');
  }

  if (policy.insuranceRequired) {
    requirements.push('Insurance required');
  }

  const allowed = requirements.length === 0;

  return {
    allowed,
    reason: allowed ? 'Action permitted' : 'Requirements not met',
    requirements,
  };
}

export function checkKycLevel(userLevel: string, requiredLevel: string): boolean {
  const levels = ['bronze', 'silver', 'gold', 'diamond'];
  const userIndex = levels.indexOf(userLevel.toLowerCase());
  const requiredIndex = levels.indexOf(requiredLevel.toLowerCase());
  return userIndex >= requiredIndex;
}

export function checkIslamicCompliance(category: string): boolean {
  const nonCompliant = ['gambling', 'alcohol', 'tobacco', 'interest_based_loans'];
  return !nonCompliant.includes(category.toLowerCase());
}

export function calculateFraudRisk(
  userHistory: Record<string, unknown>,
  transaction: Record<string, unknown>
): number {
  let risk = 0;

  if (userHistory.verified === false) risk += 0.3;
  if (userHistory.previousFraud === true) risk += 0.5;
  if (transaction.amount && (transaction.amount as number) > 10000) risk += 0.2;
  if (transaction.urgent === true) risk += 0.1;
  if (transaction.newRecipient === true) risk += 0.15;

  return Math.min(1, risk);
}

export function getTrustPolicy(id: string): TrustPolicy | undefined {
  return TRUST_POLICIES.get(id);
}

export function initializeTrustPolicies(): void {
  const policies: TrustPolicy[] = [
    { id: 'default', name: 'Default', kycRequired: false, kycLevel: 'bronze', escrowRequired: false, insuranceRequired: false, islamicCompliant: true, maxTransactionValue: 1000, allowedCategories: [], blockedCategories: [] },
    { id: 'standard', name: 'Standard', kycRequired: true, kycLevel: 'silver', escrowRequired: true, insuranceRequired: false, islamicCompliant: true, maxTransactionValue: 10000, allowedCategories: [], blockedCategories: [] },
    { id: 'premium', name: 'Premium', kycRequired: true, kycLevel: 'gold', escrowRequired: true, insuranceRequired: true, islamicCompliant: true, maxTransactionValue: 100000, allowedCategories: [], blockedCategories: [] },
    { id: 'enterprise', name: 'Enterprise', kycRequired: true, kycLevel: 'diamond', escrowRequired: true, insuranceRequired: true, islamicCompliant: true, maxTransactionValue: 1000000, allowedCategories: [], blockedCategories: [] },
    { id: 'micro', name: 'Micro', kycRequired: false, kycLevel: 'bronze', escrowRequired: false, insuranceRequired: false, islamicCompliant: true, maxTransactionValue: 100, allowedCategories: [], blockedCategories: [] },
  ];

  for (const policy of policies) {
    createTrustPolicy(policy);
  }
}

initializeTrustPolicies();
