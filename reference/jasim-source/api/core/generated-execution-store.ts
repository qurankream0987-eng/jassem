import { and, eq, isNull } from "drizzle-orm";
import { db } from "../queries/connection";
import { approvals, tasks } from "@db/schema";
import {
  GeneratedApprovalTicketSchema,
  GeneratedExecutionCheckpointSchema,
  type GeneratedApprovalTicket,
  type GeneratedExecutionCheckpoint,
} from "@contracts/generated-execution";

export interface ApprovalRequest {
  taskId: number;
  userId: number;
  planId: string;
  worldId?: string;
  stepId: string;
  capabilityId: string;
  capabilityRegistryId?: string;
  title: string;
  risk: "none" | "low" | "medium" | "high" | "critical";
  authorizedStepIds: string[];
  authorizedCapabilityIds: string[];
  expiresAt: string;
}

export interface ApprovalDecisionInput {
  approvalId: string;
  taskId: number;
  userId: number;
  approved: boolean;
  reason?: string;
}

export interface GeneratedExecutionStore {
  load(taskId: number, planId: string): Promise<GeneratedExecutionCheckpoint | undefined>;
  save(checkpoint: GeneratedExecutionCheckpoint): Promise<void>;
  requestApproval(request: ApprovalRequest): Promise<GeneratedApprovalTicket>;
  getApproval(approvalId: string): Promise<GeneratedApprovalTicket | undefined>;
  decideApproval(input: ApprovalDecisionInput): Promise<GeneratedApprovalTicket>;
}

export class MemoryGeneratedExecutionStore implements GeneratedExecutionStore {
  private readonly checkpoints = new Map<string, GeneratedExecutionCheckpoint>();
  private readonly tickets = new Map<string, GeneratedApprovalTicket>();
  private sequence = 0;

  async load(taskId: number, planId: string): Promise<GeneratedExecutionCheckpoint | undefined> {
    const checkpoint = this.checkpoints.get(`${taskId}:${planId}`);
    return checkpoint ? structuredClone(checkpoint) : undefined;
  }

  async save(checkpoint: GeneratedExecutionCheckpoint): Promise<void> {
    const parsed = GeneratedExecutionCheckpointSchema.parse(checkpoint);
    this.checkpoints.set(`${parsed.taskId}:${parsed.planId}`, structuredClone(parsed));
  }

  async requestApproval(request: ApprovalRequest): Promise<GeneratedApprovalTicket> {
    const existing = [...this.tickets.values()].find((ticket) =>
      ticket.taskId === request.taskId && ticket.planId === request.planId &&
      ticket.stepId === request.stepId && ticket.status === "pending",
    );
    if (existing) return structuredClone(existing);

    const ticket = GeneratedApprovalTicketSchema.parse({
      id: String(++this.sequence),
      taskId: request.taskId,
      planId: request.planId,
      stepId: request.stepId,
      capabilityId: request.capabilityId,
      title: request.title,
      risk: request.risk,
      status: "pending",
      authorizedStepIds: request.authorizedStepIds,
      requestedBy: request.userId,
      createdAt: new Date().toISOString(),
      expiresAt: request.expiresAt,
    });
    this.tickets.set(ticket.id, ticket);
    return structuredClone(ticket);
  }

  async getApproval(approvalId: string): Promise<GeneratedApprovalTicket | undefined> {
    const ticket = this.tickets.get(approvalId);
    if (!ticket) return undefined;
    if (ticket.status === "pending" && ticket.expiresAt && new Date(ticket.expiresAt) <= new Date()) {
      ticket.status = "expired";
    }
    return structuredClone(ticket);
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<GeneratedApprovalTicket> {
    const ticket = this.tickets.get(input.approvalId);
    if (!ticket || ticket.taskId !== input.taskId) throw new Error("Approval not found");
    if (ticket.requestedBy !== input.userId) throw new Error("Approval does not belong to this user");
    if (ticket.status !== "pending") throw new Error("Approval is no longer pending");
    if (ticket.expiresAt && new Date(ticket.expiresAt) <= new Date()) {
      ticket.status = "expired";
      throw new Error("Approval has expired");
    }
    ticket.status = input.approved ? "approved" : "rejected";
    ticket.decidedBy = input.userId;
    ticket.reason = input.reason;
    ticket.decidedAt = new Date().toISOString();
    return structuredClone(ticket);
  }
}

export class DrizzleGeneratedExecutionStore implements GeneratedExecutionStore {
  async load(taskId: number, planId: string): Promise<GeneratedExecutionCheckpoint | undefined> {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    const context = task?.context as Record<string, unknown> | null;
    const executions = context?.generatedExecutions as Record<string, unknown> | undefined;
    const stored = executions?.[planId];
    if (!stored) return undefined;
    const parsed = GeneratedExecutionCheckpointSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  }

  async save(checkpoint: GeneratedExecutionCheckpoint): Promise<void> {
    const parsed = GeneratedExecutionCheckpointSchema.parse(checkpoint);
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, parsed.taskId) });
    if (!task) throw new Error(`Task ${parsed.taskId} not found`);
    const context = task.context as Record<string, unknown> | null;
    const executions = context?.generatedExecutions as Record<string, unknown> | undefined;
    await db.update(tasks).set({
      context: {
        ...(context ?? {}),
        generatedExecutions: { ...(executions ?? {}), [parsed.planId]: parsed },
      },
      status: parsed.status === "waiting_approval" || parsed.status === "waiting_input"
        ? parsed.status
        : parsed.status === "completed"
          ? "completed"
          : parsed.status === "failed" || parsed.status === "rejected"
            ? "failed"
            : "running",
      outputs: parsed.results,
    }).where(eq(tasks.id, parsed.taskId));
  }

  async requestApproval(request: ApprovalRequest): Promise<GeneratedApprovalTicket> {
    const rows = await db.query.approvals.findMany({
      where: and(eq(approvals.taskId, request.taskId), isNull(approvals.approved)),
    });
    const existing = rows.find((row) => {
      const metadata = row.metadata as Record<string, unknown> | null;
      return metadata?.planId === request.planId && metadata?.stepId === request.stepId;
    });
    if (existing) return this.toTicket(existing);

    const [inserted] = await db.insert(approvals).values({
      taskId: request.taskId,
      action: request.title,
      actor: String(request.userId),
      permission: request.capabilityId,
      policy: { type: "generated_runtime_boundary", planId: request.planId },
      riskLevel: request.risk,
      required: true,
      expiresAt: new Date(request.expiresAt),
      metadata: {
        planId: request.planId,
        worldId: request.worldId,
        stepId: request.stepId,
        capabilityId: request.capabilityRegistryId,
        capabilityName: request.capabilityId,
        authorizedStepIds: request.authorizedStepIds,
        authorizedCapabilityIds: request.authorizedCapabilityIds,
      },
    }).$returningId();
    const row = await db.query.approvals.findFirst({ where: eq(approvals.id, Number(inserted.id)) });
    if (!row) throw new Error("Failed to create approval");
    return this.toTicket(row);
  }

  async getApproval(approvalId: string): Promise<GeneratedApprovalTicket | undefined> {
    const id = Number(approvalId);
    if (!Number.isInteger(id)) return undefined;
    const row = await db.query.approvals.findFirst({ where: eq(approvals.id, id) });
    return row ? this.toTicket(row) : undefined;
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<GeneratedApprovalTicket> {
    const id = Number(input.approvalId);
    const row = await db.query.approvals.findFirst({ where: eq(approvals.id, id) });
    if (!row || row.taskId !== input.taskId) throw new Error("Approval not found");
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) });
    if (!task || task.userId !== input.userId) throw new Error("Approval does not belong to this user");
    if (row.approved !== null) throw new Error("Approval is no longer pending");
    if (row.expiresAt && row.expiresAt <= new Date()) throw new Error("Approval has expired");

    const updateResult = await db.update(approvals).set({
      approved: input.approved,
      approvedBy: input.userId,
      approvedAt: new Date(),
      metadata: {
        ...(row.metadata as Record<string, unknown> ?? {}),
        decisionReason: input.reason,
      },
    }).where(and(eq(approvals.id, id), isNull(approvals.approved)));
    const header = Array.isArray(updateResult) ? updateResult[0] : updateResult;
    const affectedRows = (header as { affectedRows?: number } | undefined)?.affectedRows;
    if (affectedRows !== undefined && affectedRows !== 1) {
      throw new Error("Approval was already decided by another request");
    }
    const updated = await db.query.approvals.findFirst({ where: eq(approvals.id, id) });
    if (!updated) throw new Error("Approval disappeared after update");
    return this.toTicket(updated);
  }

  private toTicket(row: typeof approvals.$inferSelect): GeneratedApprovalTicket {
    const metadata = row.metadata as Record<string, unknown> | null;
    const expired = row.expiresAt ? row.expiresAt <= new Date() : false;
    return GeneratedApprovalTicketSchema.parse({
      id: String(row.id),
      taskId: row.taskId,
      planId: String(metadata?.planId ?? "unknown"),
      stepId: String(metadata?.stepId ?? row.stepId ?? "unknown"),
      capabilityId: String(metadata?.capabilityName ?? row.permission ?? "unknown"),
      title: row.action,
      risk: row.riskLevel,
      status: row.approved === true ? "approved" : row.approved === false ? "rejected" : expired ? "expired" : "pending",
      authorizedStepIds: Array.isArray(metadata?.authorizedStepIds) ? metadata.authorizedStepIds : [],
      requestedBy: Number(row.actor),
      decidedBy: row.approvedBy ?? undefined,
      reason: typeof metadata?.decisionReason === "string" ? metadata.decisionReason : undefined,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.approvedAt?.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
    });
  }
}
