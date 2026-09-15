/**
 * JASIM Security Engine — Runtime Permission Enforcement + Risk Gates
 *
 * Core responsibilities:
 * 1. Check user capability permissions before execution
 * 2. Assess risk levels and enforce approval gates
 * 3. Verify approval status for sensitive operations
 * 4. Enforce policy rules dynamically
 * 5. Log all security events for audit
 *
 * CRITICAL RULES:
 * - NEVER allow execution without permission check
 * - NEVER allow high-risk operations without approval
 * - ALL side effects must be logged
 * - Security events must be persisted
 */

import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "../queries/connection";
import {
  securityEvents,
  approvals,
  capabilities,
  tools,
  policies,
  users,
  type NewSecurityEvent,
} from "@db/schema";
import {
  CAPABILITY_RISK_LEVELS,
  type CapabilityRiskLevel,
} from "@contracts/constants";
import {
  DEFAULT_POLICIES,
  evaluateCondition,
  extractSideEffects,
  hasRequiredRole,
  hasExplicitPermission,
  RISK_LEVEL_ORDER,
  type SecurityPolicy,
} from "./security-policies";
import {
  ApprovalError,
  ValidationError,
  ERROR_CODES,
} from "@contracts/errors";
import type { ExecutionContext } from "./tool-runtime";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type SecurityEventType =
  | "permission_denied"
  | "risk_gate_triggered"
  | "approval_required"
  | "approval_granted"
  | "approval_denied"
  | "policy_violation"
  | "side_effect_executed"
  | "authentication_failure"
  | "suspicious_activity";

export interface SecurityEvent {
  type: SecurityEventType;
  userId: string;
  capabilityId?: string;
  toolId?: string;
  action: string;
  result: "allowed" | "denied" | "pending_approval";
  reason?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredApprovals?: string[];
}

export interface RiskAssessmentResult {
  level: CapabilityRiskLevel;
  gates: string[];
  requiresApproval: boolean;
}

export interface ApprovalVerificationResult {
  approved: boolean;
  approvedBy?: string;
  expiresAt?: Date;
}

export interface PolicyEnforcementResult {
  allowed: boolean;
  violations: string[];
  requiredApprovals?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SecurityEngine
// ═══════════════════════════════════════════════════════════════════════════════

let engineInstance: SecurityEngine;

export class SecurityEngine {
  private loadedPolicies: SecurityPolicy[] = [...DEFAULT_POLICIES];
  private policyCacheMs = 60000; // Refresh policies every 60s
  private lastPolicyLoad = 0;

  constructor() {
    engineInstance = this;
  }

  // ── Permission Check ───────────────────────────────────────────────────────────

  /**
   * Check if a user is allowed to execute a capability or tool.
   * Validates user role, capability permissions, ownership, and active status.
   */
  async checkCapabilityPermission(
    userId: string,
    capabilityId: string,
    inputs: unknown,
    context: ExecutionContext
  ): Promise<PermissionCheckResult> {
    // 1. Validate user exists and is active
    const user = await this.getUser(userId);
    if (!user) {
      return { allowed: false, reason: "User not found" };
    }
    if (user.status !== "active") {
      return { allowed: false, reason: `User status is ${user.status}` };
    }

    // 2. Admin bypass — admins can execute anything
    const userRole = user.role ?? "user";
    if (userRole === "admin" || userRole === "system") {
      return { allowed: true };
    }

    // 3. Look up capability or tool
    const capability = await this.lookupCapabilityOrTool(capabilityId);
    if (!capability) {
      return { allowed: false, reason: `Capability or tool "${capabilityId}" not found` };
    }

    if (!capability.isActive) {
      return { allowed: false, reason: `Capability "${capabilityId}" is inactive` };
    }

    // 4. Check explicit permissions on the capability
    const capPerms = capability.permissions ?? [];
    const userPerms = (user.permissions as string[] | null) ?? [];

    if (capPerms.length > 0 && !hasExplicitPermission(userPerms, capPerms)) {
      return {
        allowed: false,
        reason: `User lacks required permissions: ${capPerms.join(", ")}`,
        requiredApprovals: ["admin_override"],
      };
    }

    // 5. Check ownership for user-scoped resources
    const resourceOwner = (inputs as Record<string, unknown> | undefined)?.ownerId;
    if (resourceOwner !== undefined && String(resourceOwner) !== String(userId)) {
      // Non-owner requires explicit grant or admin role
      if (userRole !== "admin") {
        return {
          allowed: false,
          reason: "User does not own the target resource",
        };
      }
    }

    // 6. Input sanitization — reject suspicious payloads
    if (this.isSuspiciousInput(inputs)) {
      await this.logSecurityEvent({
        type: "suspicious_activity",
        userId,
        capabilityId,
        action: "checkCapabilityPermission",
        result: "denied",
        reason: "Suspicious input detected",
        timestamp: new Date(),
        metadata: { inputs, context: context.metadata },
      });
      return { allowed: false, reason: "Suspicious input detected" };
    }

    return { allowed: true };
  }

  // ── Risk Assessment ────────────────────────────────────────────────────────────

  /**
   * Assess the risk level of a capability or tool execution.
   * Returns the risk level, required gates, and whether approval is needed.
   */
  async assessRisk(
    capabilityId: string,
    inputs: unknown,
    context: ExecutionContext
  ): Promise<RiskAssessmentResult> {
    const capability = await this.lookupCapabilityOrTool(capabilityId);
    if (!capability) {
      return { level: CAPABILITY_RISK_LEVELS.CRITICAL, gates: ["unknown_capability"], requiresApproval: true };
    }

    const riskLevel = capability.riskLevel ?? CAPABILITY_RISK_LEVELS.LOW;
    const sideEffects = extractSideEffects(capability.sideEffects);
    const gates: string[] = [];
    let requiresApproval = false;

    // Evaluate all loaded policies against this execution context
    const policies = await this.getActivePolicies();
    const evalContext: Record<string, unknown> = {
      riskLevel,
      sideEffects,
      inputs,
      userId: context.userId,
      taskId: context.taskId,
      action: "execute",
      resource: capabilityId,
    };

    for (const policy of policies) {
      for (const rule of policy.rules) {
        try {
          const matched = evaluateCondition(rule.condition, evalContext);
          if (matched) {
            switch (rule.action) {
              case "require_approval":
                requiresApproval = true;
                gates.push(policy.id);
                break;
              case "deny":
                gates.push(`deny:${policy.id}`);
                requiresApproval = true;
                break;
              case "log_and_notify":
                gates.push(`log:${policy.id}`);
                break;
              case "verify_ownership":
                gates.push(`ownership:${policy.id}`);
                break;
              case "rate_limit":
                gates.push(`rate_limit:${policy.id}`);
                requiresApproval = true;
                break;
              case "escalate":
                gates.push(`escalate:${policy.id}`);
                requiresApproval = true;
                break;
              default:
                break;
            }
          }
        } catch {
          // Condition evaluation error: fail-closed
          gates.push(`error:${policy.id}`);
          requiresApproval = true;
        }
      }
    }

    // High and Critical risk always requires approval
    if (riskLevel === CAPABILITY_RISK_LEVELS.HIGH || riskLevel === CAPABILITY_RISK_LEVELS.CRITICAL) {
      requiresApproval = true;
      if (!gates.includes("policy-high-risk-approval")) {
        gates.push("policy-high-risk-approval");
      }
    }

    // Payment side effects always require approval
    if (sideEffects.includes("payment") || sideEffects.includes("PAYMENT")) {
      requiresApproval = true;
      if (!gates.includes("policy-payment-verification")) {
        gates.push("policy-payment-verification");
      }
    }

    // Destructive side effects always require approval
    if (sideEffects.includes("destructive") || sideEffects.includes("DESTRUCTIVE")) {
      requiresApproval = true;
      if (!gates.includes("policy-destructive-tool-block")) {
        gates.push("policy-destructive-tool-block");
      }
    }

    return { level: riskLevel, gates, requiresApproval };
  }

  // ── Approval Verification ────────────────────────────────────────────────────

  /**
   * Verify that an approval exists and is valid (approved and not expired).
   */
  async verifyApproval(
    approvalId: string,
    userId: string
  ): Promise<ApprovalVerificationResult> {
    const id = Number(approvalId);
    if (isNaN(id)) {
      return { approved: false };
    }

    const approval = await db.query.approvals.findFirst({
      where: eq(approvals.id, id),
    });

    if (!approval) {
      return { approved: false };
    }

    // Must be explicitly approved
    if (approval.approved !== true) {
      return { approved: false };
    }

    // Check expiration
    if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
      return { approved: false };
    }

    // Check user ownership or admin
    const user = await this.getUser(userId);
    const isAdmin = user?.role === "admin" || user?.role === "system";
    if (approval.approvedBy && !isAdmin) {
      const approverId = Number(approval.approvedBy);
      if (!isNaN(approverId) && approverId !== Number(userId)) {
        // Allow if the approval was granted for this user's task
        const taskId = approval.taskId;
        if (taskId) {
          const { tasks } = await import("@db/schema");
          const task = await db.query.tasks.findFirst({
            where: eq(tasks.id, taskId),
          });
          if (!task || task.userId !== Number(userId)) {
            return { approved: false };
          }
        }
      }
    }

    return {
      approved: true,
      approvedBy: approval.approvedBy ? String(approval.approvedBy) : undefined,
      expiresAt: approval.expiresAt ? new Date(approval.expiresAt) : undefined,
    };
  }

  /**
   * Check whether a capability/tool already has a valid approval for the current user/task.
   */
  async hasValidApproval(
    capabilityId: string,
    context: ExecutionContext
  ): Promise<boolean> {
    if (!context.userId) return false;

    // Look for recent unexpired approvals for this user/task/capability combination
    const userId = Number(context.userId);
    const taskId = context.taskId ? Number(context.taskId) : undefined;

    const recentApprovals = await db.query.approvals.findMany({
      where: and(
        eq(approvals.approved, true),
        gte(approvals.expiresAt, new Date()),
        ...(taskId !== undefined ? [eq(approvals.taskId, taskId)] : [])
      ),
      orderBy: [desc(approvals.createdAt)],
      limit: 20,
    });

    // Check if any approval matches the capability/action
    for (const approval of recentApprovals) {
      const meta = approval.metadata as Record<string, unknown> | null;
      const approvedCapability = meta?.capabilityId ?? meta?.action;
      if (approvedCapability === capabilityId) {
        return true;
      }
      const authorizedCapabilities = Array.isArray(meta?.authorizedCapabilityIds)
        ? meta.authorizedCapabilityIds
        : [];
      if (authorizedCapabilities.some((item) => String(item) === capabilityId)) {
        return true;
      }
      // Generic approval for the user's current task
      if (!approvedCapability && approval.actor === String(userId)) {
        return true;
      }
    }

    return false;
  }

  // ── Policy Enforcement ───────────────────────────────────────────────────────

  /**
   * Enforce policies against a concrete action/actor/resource triple.
   * Used by task-runtime and tool-runtime before execution.
   */
  async enforcePolicy(
    action: string,
    actor: string,
    resource: string,
    context: Record<string, unknown>
  ): Promise<PolicyEnforcementResult> {
    const violations: string[] = [];
    const requiredApprovals: string[] = [];

    const policies = await this.getActivePolicies();
    const evalContext = {
      action,
      actor,
      resource,
      ...context,
    };

    for (const policy of policies) {
      for (const rule of policy.rules) {
        try {
          const matched = evaluateCondition(rule.condition, evalContext);
          if (matched) {
            switch (rule.action) {
              case "deny":
                violations.push(`Policy "${policy.name}" denied this action`);
                break;
              case "require_approval":
                requiredApprovals.push(policy.id);
                break;
              case "escalate":
                violations.push(`Policy "${policy.name}" requires escalation`);
                requiredApprovals.push(policy.id);
                break;
              case "rate_limit":
                // Rate limiting checked separately
                requiredApprovals.push(policy.id);
                break;
              case "verify_ownership": {
                const owner = context.ownerId as string | undefined;
                if (owner && String(owner) !== String(actor)) {
                  violations.push(`Policy "${policy.name}" ownership check failed`);
                }
                break;
              }
              case "log_and_notify":
                // Log but don't block
                await this.logSecurityEvent({
                  type: "policy_violation",
                  userId: actor,
                  action,
                  result: "allowed",
                  reason: `Policy "${policy.name}" triggered log_and_notify`,
                  timestamp: new Date(),
                  metadata: { resource, policyId: policy.id },
                });
                break;
              default:
                break;
            }
          }
        } catch {
          violations.push(`Policy "${policy.name}" evaluation error`);
        }
      }
    }

    // Require approval if any policy demands it and actor is not admin
    const user = await this.getUser(actor);
    const isAdmin = user?.role === "admin" || user?.role === "system";

    let allowed = violations.length === 0;
    if (requiredApprovals.length > 0 && !isAdmin) {
      // Check if there is a valid approval
      const hasApproval = await this.hasValidApproval(resource, {
        userId: actor,
        taskId: context.taskId as string | undefined,
      });
      if (!hasApproval) {
        allowed = false;
        violations.push(`Approval required: ${requiredApprovals.join(", ")}`);
      }
    }

    return { allowed, violations, requiredApprovals };
  }

  // ── Security Event Logging ───────────────────────────────────────────────────

  /**
   * Persist a security event to the database for audit purposes.
   */
  async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      const record: NewSecurityEvent = {
        type: event.type,
        userId: event.userId,
        capabilityId: event.capabilityId ?? null,
        toolId: event.toolId ?? null,
        action: event.action,
        result: event.result,
        reason: event.reason ?? null,
        metadata: event.metadata ?? {},
        timestamp: event.timestamp,
      };

      await db.insert(securityEvents).values(record);
    } catch (err) {
      // Never throw from logging — security events failing should not crash execution
      console.error("[SecurityEngine] Failed to log security event:", err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Query security events for a user (with optional filters).
   */
  async querySecurityEvents(opts: {
    userId?: string;
    type?: SecurityEventType;
    limit?: number;
    offset?: number;
  }): Promise<SecurityEvent[]> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const results = await db.query.securityEvents.findMany({
      where: opts.userId
        ? eq(securityEvents.userId, opts.userId)
        : undefined,
      orderBy: [desc(securityEvents.timestamp)],
      limit,
      offset,
    });

    return results.map((r) => ({
      type: r.type as SecurityEventType,
      userId: r.userId ?? "unknown",
      capabilityId: r.capabilityId ?? undefined,
      toolId: r.toolId ?? undefined,
      action: r.action,
      result: r.result as "allowed" | "denied" | "pending_approval",
      reason: r.reason ?? undefined,
      timestamp: r.timestamp,
      metadata: r.metadata as Record<string, unknown> | undefined,
    }));
  }

  // ── Approval Creation ────────────────────────────────────────────────────────

  /**
   * Create a new approval request in the database.
   */
  async createApproval(opts: {
    taskId?: number;
    stepId?: number;
    action: string;
    actor?: string;
    riskLevel: string;
    reason?: string;
    expiresAt?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{ approvalId: number; status: string }> {
    const [result] = await db.insert(approvals).values({
      taskId: opts.taskId ?? 0,
      stepId: opts.stepId,
      action: opts.action,
      actor: opts.actor,
      riskLevel: opts.riskLevel as "none" | "low" | "medium" | "high" | "critical",
      required: true,
      approved: null,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000), // Default 24h
      metadata: {
        ...(opts.metadata ?? {}),
        reason: opts.reason,
      },
    });

    return { approvalId: Number(result.insertId), status: "pending" };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private async getUser(userId: string) {
    try {
      const id = Number(userId);
      if (isNaN(id)) return null;
      return await db.query.users.findFirst({
        where: eq(users.id, id),
      });
    } catch {
      return null;
    }
  }

  private async getActivePolicies(): Promise<SecurityPolicy[]> {
    const now = Date.now();
    if (now - this.lastPolicyLoad < this.policyCacheMs) {
      return this.loadedPolicies.filter((p) => p.isActive);
    }

    try {
      const dbPolicies = await db.query.policies.findMany({
        where: eq(policies.isActive, true),
      });

      // Merge DB policies with defaults (DB overrides defaults by ID)
      const merged = new Map<string, SecurityPolicy>();
      for (const p of DEFAULT_POLICIES) merged.set(p.id, p);
      for (const p of dbPolicies) {
        merged.set(String(p.id), {
          id: String(p.id),
          name: p.name,
          description: p.description ?? undefined,
          rules: (p.rules as SecurityPolicy["rules"]) ?? [],
          scope: (p.scope as SecurityPolicy["scope"]) ?? "global",
          priority: p.priority ?? 0,
          isActive: p.isActive,
          metadata: (p.metadata as Record<string, unknown>) ?? undefined,
        });
      }

      this.loadedPolicies = Array.from(merged.values());
      this.lastPolicyLoad = now;
    } catch {
      // On error, fall back to defaults
      this.loadedPolicies = [...DEFAULT_POLICIES];
    }

    return this.loadedPolicies.filter((p) => p.isActive);
  }

  private async lookupCapabilityOrTool(idOrName: string) {
    // Try numeric ID first (capability)
    const numId = Number(idOrName);
    if (!isNaN(numId)) {
      try {
        const cap = await db.query.capabilities.findFirst({
          where: eq(capabilities.id, numId),
        });
        if (cap) return { ...cap, kind: "capability" as const };
      } catch { /* ignore */ }

      try {
        const tool = await db.query.tools.findFirst({
          where: eq(tools.id, numId),
        });
        if (tool) return { ...tool, kind: "tool" as const };
      } catch { /* ignore */ }
    }

    // Try by name
    try {
      const cap = await db.query.capabilities.findFirst({
        where: eq(capabilities.name, idOrName),
      });
      if (cap) return { ...cap, kind: "capability" as const };
    } catch { /* ignore */ }

    try {
      const tool = await db.query.tools.findFirst({
        where: eq(tools.name, idOrName),
      });
      if (tool) return { ...tool, kind: "tool" as const };
    } catch { /* ignore */ }

    return null;
  }

  private isSuspiciousInput(inputs: unknown): boolean {
    if (!inputs || typeof inputs !== "object") return false;

    const obj = inputs as Record<string, unknown>;
    const json = JSON.stringify(inputs);

    // Prototype pollution patterns
    if (json.includes("__proto__") || json.includes("constructor")) {
      return true;
    }

    // SQL injection patterns in string values
    const suspiciousSql = /(\b(union|select|insert|update|delete|drop|alter|create|exec|execute)\b)/i;
    for (const val of Object.values(obj)) {
      if (typeof val === "string" && suspiciousSql.test(val)) {
        return true;
      }
    }

    // Command injection patterns
    const suspiciousCmd = /[;|&$`\n]/;
    for (const val of Object.values(obj)) {
      if (typeof val === "string" && suspiciousCmd.test(val) && val.length > 10) {
        return true;
      }
    }

    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Export
// ═══════════════════════════════════════════════════════════════════════════════

export function getSecurityEngine(): SecurityEngine {
  if (!engineInstance) {
    engineInstance = new SecurityEngine();
  }
  return engineInstance;
}

export { engineInstance as securityEngine };
