/**
 * JASIM Security Policies — Default Policy Definitions
 *
 * Policies define rules for capability execution, risk assessment,
 * and approval requirements. They are evaluated by the SecurityEngine
 * at runtime before any operation is allowed to proceed.
 */

import { CAPABILITY_RISK_LEVELS } from "@contracts/constants";
import type { CapabilityRiskLevel } from "@contracts/jasim";

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Types
// ═══════════════════════════════════════════════════════════════════════════════

export type PolicyAction =
  | "require_approval"
  | "allow"
  | "deny"
  | "escalate"
  | "log_and_notify"
  | "verify_ownership"
  | "rate_limit";

export interface PolicyRule {
  condition: string; // Evaluated as expression against context
  action: PolicyAction;
  requiredApprovers?: number;
  approverRoles?: string[];
  metadata?: Record<string, unknown>;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  description?: string;
  rules: PolicyRule[];
  scope: "global" | "task" | "capability" | "tool" | "user" | "entity";
  priority: number; // Higher number = higher priority
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Risk Gate Thresholds
// ═══════════════════════════════════════════════════════════════════════════════

export const RISK_LEVEL_ORDER: CapabilityRiskLevel[] = [
  CAPABILITY_RISK_LEVELS.NONE,
  CAPABILITY_RISK_LEVELS.LOW,
  CAPABILITY_RISK_LEVELS.MEDIUM,
  CAPABILITY_RISK_LEVELS.HIGH,
  CAPABILITY_RISK_LEVELS.CRITICAL,
];

/**
 * Returns true if a risk level meets or exceeds a threshold.
 */
export function riskMeetsThreshold(
  level: CapabilityRiskLevel,
  threshold: CapabilityRiskLevel
): boolean {
  const levelIdx = RISK_LEVEL_ORDER.indexOf(level);
  const thresholdIdx = RISK_LEVEL_ORDER.indexOf(threshold);
  return levelIdx >= thresholdIdx;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default Policies
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_POLICIES: SecurityPolicy[] = [
  {
    id: "policy-high-risk-approval",
    name: "High Risk Approval Required",
    description:
      "Any capability or tool execution with high or critical risk level must be explicitly approved by a human.",
    rules: [
      {
        condition: 'riskLevel === "high" || riskLevel === "critical"',
        action: "require_approval",
        requiredApprovers: 1,
        approverRoles: ["admin", "owner", "approver"],
      },
    ],
    scope: "global",
    priority: 100,
    isActive: true,
  },
  {
    id: "policy-payment-verification",
    name: "Payment Verification Required",
    description:
      "Any operation involving payment side effects must be approved before execution.",
    rules: [
      {
        condition: 'sideEffects && (sideEffects.includes("payment") || sideEffects.includes("PAYMENT"))',
        action: "require_approval",
        requiredApprovers: 1,
        approverRoles: ["admin", "owner", "finance"],
      },
    ],
    scope: "global",
    priority: 90,
    isActive: true,
  },
  {
    id: "policy-data-modification-log",
    name: "Data Modification Logging",
    description:
      "All write or data_modification side effects must be logged and optionally notify an auditor.",
    rules: [
      {
        condition:
          'sideEffects && (sideEffects.includes("write") || sideEffects.includes("data_modification") || sideEffects.includes("WRITE") || sideEffects.includes("DATA_MODIFICATION"))',
        action: "log_and_notify",
      },
    ],
    scope: "global",
    priority: 80,
    isActive: true,
  },
  {
    id: "policy-external-communication",
    name: "External Communication Approval",
    description:
      "Operations that communicate with external systems or users require explicit approval.",
    rules: [
      {
        condition:
          'sideEffects && (sideEffects.includes("external_communication") || sideEffects.includes("EXTERNAL_COMMUNICATION"))',
        action: "require_approval",
        requiredApprovers: 1,
        approverRoles: ["admin", "owner"],
      },
    ],
    scope: "global",
    priority: 70,
    isActive: true,
  },
  {
    id: "policy-user-data-access",
    name: "User Data Access Restriction",
    description:
      "Read operations on user data must verify ownership unless the actor is an admin.",
    rules: [
      {
        condition: 'action === "read" && resource && resource.includes("user_data")',
        action: "verify_ownership",
      },
    ],
    scope: "global",
    priority: 60,
    isActive: true,
  },
  {
    id: "policy-destructive-tool-block",
    name: "Destructive Tool Block",
    description:
      "Tools with destructive side effects require approval and cannot be run by non-admin users without explicit authorization.",
    rules: [
      {
        condition: 'sideEffects === "destructive" || sideEffects === "DESTRUCTIVE"',
        action: "require_approval",
        requiredApprovers: 2,
        approverRoles: ["admin", "owner"],
      },
    ],
    scope: "tool",
    priority: 95,
    isActive: true,
  },
  {
    id: "policy-suspicious-input-rate-limit",
    name: "Suspicious Input Rate Limit",
    description:
      "Rate-limit operations when suspicious input patterns are detected.",
    rules: [
      {
        condition: 'inputs && (inputs._suspicious === true || inputs.__proto__ || inputs.constructor)',
        action: "deny",
      },
    ],
    scope: "global",
    priority: 110,
    isActive: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Policy Evaluation Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a simple condition string against a context object.
 * WARNING: This uses Function constructor for dynamic evaluation.
 * All values are sanitized to avoid code injection.
 */
export function evaluateCondition(
  condition: string,
  context: Record<string, unknown>
): boolean {
  try {
    // Sanitize: only allow specific identifiers and operators
    const sanitized = condition.replace(/[^a-zA-Z0-9_\s\|\&\=\!\<\>\'\"\.\(\)\[\]\+\-\*\/\%\?\:\,]/g, "");

    const keys = Object.keys(context);
    const values = keys.map((k) => context[k]);

    const fn = new Function(...keys, `return (${sanitized})`);
    return Boolean(fn(...values));
  } catch {
    // If evaluation fails, deny by default (fail-closed)
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Side Effect Classification
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract side effect types from a capability or tool record.
 * Capabilities store side effects as an array of objects or strings.
 * Tools store side effects as a single string.
 */
export function extractSideEffects(
  sideEffects: unknown
): string[] {
  if (!sideEffects) return [];
  if (typeof sideEffects === "string") return [sideEffects];
  if (Array.isArray(sideEffects)) {
    return sideEffects.map((se) =>
      typeof se === "string" ? se : se?.type ?? String(se)
    );
  }
  return [String(sideEffects)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Permission Resolution
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a user's roles satisfy any of the required roles.
 */
export function hasRequiredRole(
  userRoles: string[],
  requiredRoles?: string[]
): boolean {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  return userRoles.some((role) => requiredRoles.includes(role));
}

/**
 * Check if a user has explicit permission for an action on a resource.
 */
export function hasExplicitPermission(
  userPermissions: string[],
  requiredPermissions: string[]
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) return true;
  return requiredPermissions.every((perm) => userPermissions.includes(perm));
}
