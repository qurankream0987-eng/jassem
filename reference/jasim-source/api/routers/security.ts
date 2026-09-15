/**
 * JASIM — Security Router
 *
 * Exposes security operations via tRPC:
 *   - Check permission for a capability
 *   - Request approval for high-risk operations
 *   - Query security audit logs
 *   - Verify approval status
 */

import { router, publicQuery, authedQuery } from "../trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getSecurityEngine } from "../core/security-engine";
import { db } from "@db/queries/connection";
import { approvals } from "@db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { JasimError, NotFoundError, ValidationError, ERROR_CODES } from "@contracts/errors";
import { CapabilityError } from "@contracts/errors";

function handleJasimError(err: unknown): never {
  if (err instanceof JasimError) {
    throw new TRPCError({
      code: err.statusCode === 404
        ? "NOT_FOUND"
        : err.statusCode === 400
        ? "BAD_REQUEST"
        : err.statusCode === 403
        ? "FORBIDDEN"
        : "INTERNAL_SERVER_ERROR",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof Error) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unknown error" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Security Router
// ═══════════════════════════════════════════════════════════════════════════════

export const securityRouter = router({

  // ═══════════════════════════════════════════════════════════════════════════
  // checkPermission — Check if current user can execute a capability
  // ═══════════════════════════════════════════════════════════════════════════
  checkPermission: authedQuery
    .input(z.object({
      capabilityId: z.string(),
      inputs: z.record(z.unknown()).optional().default({}),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const engine = getSecurityEngine();
        const userId = String(ctx.user!.id);

        const result = await engine.checkCapabilityPermission(
          userId,
          input.capabilityId,
          input.inputs,
          { userId, metadata: { source: "security_router" } },
        );

        return result;
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // assessRisk — Assess risk level for a capability without executing
  // ═══════════════════════════════════════════════════════════════════════════
  assessRisk: authedQuery
    .input(z.object({
      capabilityId: z.string(),
      inputs: z.record(z.unknown()).optional().default({}),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const engine = getSecurityEngine();
        const userId = String(ctx.user!.id);

        const result = await engine.assessRisk(
          input.capabilityId,
          input.inputs,
          { userId, metadata: { source: "security_router" } },
        );

        return result;
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // requestApproval — Create a new approval request for a high-risk action
  // ═══════════════════════════════════════════════════════════════════════════
  requestApproval: authedQuery
    .input(z.object({
      action: z.string(),
      reason: z.string(),
      riskLevel: z.enum(["none", "low", "medium", "high", "critical"]),
      taskId: z.number().optional(),
      stepId: z.number().optional(),
      expiresAt: z.string().datetime().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const engine = getSecurityEngine();
        const userId = String(ctx.user!.id);

        const approval = await engine.createApproval({
          taskId: input.taskId,
          stepId: input.stepId,
          action: input.action,
          actor: userId,
          riskLevel: input.riskLevel,
          reason: input.reason,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          metadata: {
            ...input.metadata,
            requestedBy: userId,
            requestedAt: new Date().toISOString(),
          },
        });

        // Log the approval request
        await engine.logSecurityEvent({
          type: "approval_required",
          userId,
          action: input.action,
          result: "pending_approval",
          reason: input.reason,
          timestamp: new Date(),
          metadata: { approvalId: approval.approvalId, riskLevel: input.riskLevel },
        });

        return approval;
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // verifyApproval — Check if an approval is valid
  // ═══════════════════════════════════════════════════════════════════════════
  verifyApproval: authedQuery
    .input(z.object({
      approvalId: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const engine = getSecurityEngine();
        const userId = String(ctx.user!.id);

        const result = await engine.verifyApproval(input.approvalId, userId);
        return result;
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // getSecurityLog — Query security events (admins see all, users see own)
  // ═══════════════════════════════════════════════════════════════════════════
  getSecurityLog: authedQuery
    .input(z.object({
      limit: z.number().min(1).max(500).default(50),
      offset: z.number().min(0).default(0),
      type: z.enum([
        "permission_denied",
        "risk_gate_triggered",
        "approval_required",
        "approval_granted",
        "approval_denied",
        "policy_violation",
        "side_effect_executed",
        "authentication_failure",
        "suspicious_activity",
      ]).optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const engine = getSecurityEngine();
        const userId = String(ctx.user!.id);
        const isAdmin = ctx.user!.role === "admin" || ctx.user!.role === "system";

        // Admins can query all events; regular users only their own
        const events = await engine.querySecurityEvents({
          userId: isAdmin ? undefined : userId,
          type: input?.type,
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
        });

        return { events, total: events.length };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // getApprovals — List approvals with optional filtering
  // ═══════════════════════════════════════════════════════════════════════════
  getApprovals: authedQuery
    .input(z.object({
      status: z.enum(["pending", "approved", "rejected"]).optional(),
      taskId: z.number().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input, ctx }) => {
      try {
        const userId = Number(ctx.user!.id);
        const isAdmin = ctx.user!.role === "admin" || ctx.user!.role === "system";

        const conditions = [];
        if (!isAdmin) {
          conditions.push(eq(approvals.actor, String(userId)));
        }
        if (input?.status) {
          if (input.status === "pending") {
            conditions.push(eq(approvals.approved, false));
          } else if (input.status === "approved") {
            conditions.push(eq(approvals.approved, true));
          }
          // "rejected" is handled by approved = false + metadata.rejected = true
        }
        if (input?.taskId) {
          conditions.push(eq(approvals.taskId, input.taskId));
        }
        // Only non-expired
        conditions.push(gte(approvals.expiresAt, new Date()));

        const results = await db.query.approvals.findMany({
          where: conditions.length > 0 ? and(...conditions) : undefined,
          orderBy: [desc(approvals.createdAt)],
          limit: input?.limit ?? 20,
          offset: input?.offset ?? 0,
        });

        return { approvals: results, total: results.length };
      } catch (err) {
        handleJasimError(err);
      }
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // grantApproval — Approve a pending approval request (admin or owner)
  // ═══════════════════════════════════════════════════════════════════════════
  grantApproval: authedQuery
    .input(z.object({
      approvalId: z.number(),
      decision: z.enum(["approve", "reject"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const engine = getSecurityEngine();
        const userId = Number(ctx.user!.id);
        const isAdmin = ctx.user!.role === "admin" || ctx.user!.role === "system";

        const approval = await db.query.approvals.findFirst({
          where: eq(approvals.id, input.approvalId),
        });

        if (!approval) {
          throw new NotFoundError("Approval", String(input.approvalId));
        }

        // Only the assigned approver or an admin can grant
        const canGrant = isAdmin || approval.approvedBy === String(userId) || !approval.approvedBy;
        if (!canGrant) {
          throw new CapabilityError(
            ERROR_CODES.CAPABILITY_UNAUTHORIZED,
            "You are not authorized to grant this approval",
            String(input.approvalId),
          );
        }

        const updateData = {
          approved: input.decision === "approve",
          approvedBy: String(userId),
          updatedAt: new Date(),
          metadata: {
            ...(approval.metadata as Record<string, unknown>),
            decisionReason: input.reason,
            decidedAt: new Date().toISOString(),
            rejected: input.decision === "reject",
          },
        };

        await db.update(approvals)
          .set(updateData)
          .where(eq(approvals.id, input.approvalId));

        // Log the decision
        await engine.logSecurityEvent({
          type: input.decision === "approve" ? "approval_granted" : "approval_denied",
          userId: String(userId),
          action: "grantApproval",
          result: input.decision === "approve" ? "allowed" : "denied",
          reason: input.reason,
          timestamp: new Date(),
          metadata: {
            approvalId: input.approvalId,
            targetActor: approval.actor,
            riskLevel: approval.riskLevel,
          },
        });

        return {
          approvalId: input.approvalId,
          status: input.decision === "approve" ? "approved" : "rejected",
          approvedBy: String(userId),
        };
      } catch (err) {
        handleJasimError(err);
      }
    }),
});
