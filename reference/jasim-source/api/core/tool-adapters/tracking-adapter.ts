/**
 * Tracking Tool Adapter — Query Execution Status & Progress
 *
 * Queries JASIM runtime data to provide tracking information for:
 * - Task execution status
 * - Step-by-step progress
 * - Tool invocation history
 * - Agent activity logs
 * - Event stream
 */

import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "@db/queries/connection";
import {
  tasks,
  taskSteps,
  toolInvocations,
  agentLogs,
  events,
  executionTraces,
} from "@db/schema";
import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface TrackingInputs {
  type: "task" | "agent" | "tool" | "event" | "system" | "trace";
  id?: string;           // Specific task/agent/tool ID
  status?: string;       // Filter by status
  since?: string;        // ISO date string
  limit?: number;
}

export interface TrackingOutput {
  type: string;
  items: unknown[];
  count: number;
  summary?: {
    totalTasks?: number;
    completedTasks?: number;
    failedTasks?: number;
    runningTasks?: number;
    totalSteps?: number;
    averageDuration?: number;
  };
}

/**
 * Execute a tracking query against JASIM runtime data.
 */
export async function executeTracking(
  inputs: TrackingInputs,
  ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();

  try {
    if (!inputs.type) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "Tracking tool requires a 'type' field (task|agent|tool|event|system|trace)",
        "track_query"
      );
    }

    const limit = Math.min(inputs.limit ?? 50, 500);
    const since = inputs.since ? new Date(inputs.since) : undefined;

    let output: TrackingOutput;

    switch (inputs.type) {
      case "task":
        output = await queryTasks(inputs, since, limit);
        break;
      case "agent":
        output = await queryAgentLogs(inputs, since, limit);
        break;
      case "tool":
        output = await queryToolInvocations(inputs, since, limit);
        break;
      case "event":
        output = await queryEvents(inputs, since, limit);
        break;
      case "trace":
        output = await queryTraces(inputs, since, limit);
        break;
      case "system":
        output = await querySystemOverview(ctx, limit);
        break;
      default:
        throw new ToolError(
          ERROR_CODES.VALIDATION_FAILED,
          `Unknown tracking type: ${inputs.type}`,
          "track_query"
        );
    }

    return {
      success: true,
      output,
      duration: Date.now() - start,
      sideEffects: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Tracking
// ─────────────────────────────────────────────────────────────────────────────

async function queryTasks(
  inputs: TrackingInputs,
  since: Date | undefined,
  limit: number
): Promise<TrackingOutput> {
  const conditions = [];
  if (inputs.id) {
    conditions.push(eq(tasks.id, Number(inputs.id)) as never);
  }
  if (inputs.status) {
    conditions.push(eq(tasks.status, inputs.status as never) as never);
  }
  if (since) {
    conditions.push(gte(tasks.createdAt, since) as never);
  }

  const items = await db.query.tasks.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(tasks.createdAt)],
    limit,
  });

  // Get step counts per task
  const taskIds = items.map((t) => t.id);
  const steps = taskIds.length > 0
    ? await db.query.taskSteps.findMany({
        where: and(...taskIds.map((id) => eq(taskSteps.taskId, id))),
      })
    : [];

  const stepsByTask = new Map<number, typeof steps>();
  for (const step of steps) {
    const arr = stepsByTask.get(step.taskId) || [];
    arr.push(step);
    stepsByTask.set(step.taskId, arr);
  }

  const enriched = items.map((task) => ({
    ...task,
    stepCount: stepsByTask.get(task.id)?.length ?? 0,
    completedSteps: stepsByTask.get(task.id)?.filter((s) => s.status === "completed").length ?? 0,
  }));

  const summary = {
    totalTasks: enriched.length,
    completedTasks: enriched.filter((t) => t.status === "completed").length,
    failedTasks: enriched.filter((t) => t.status === "failed").length,
    runningTasks: enriched.filter((t) => t.status === "running").length,
    totalSteps: steps.length,
  };

  return { type: "task", items: enriched, count: enriched.length, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Log Tracking
// ─────────────────────────────────────────────────────────────────────────────

async function queryAgentLogs(
  inputs: TrackingInputs,
  since: Date | undefined,
  limit: number
): Promise<TrackingOutput> {
  const conditions = [];
  if (inputs.id) {
    conditions.push(eq(agentLogs.agentId, inputs.id) as never);
  }
  if (inputs.status) {
    conditions.push(eq(agentLogs.status, inputs.status as never) as never);
  }
  if (since) {
    conditions.push(gte(agentLogs.createdAt, since) as never);
  }

  const items = await db.query.agentLogs.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(agentLogs.createdAt)],
    limit,
  });

  const avgDuration =
    items.length > 0
      ? items.reduce((sum, log) => sum + (log.duration || 0), 0) / items.length
      : 0;

  return {
    type: "agent",
    items,
    count: items.length,
    summary: { totalTasks: items.length, averageDuration: Math.round(avgDuration) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Invocation Tracking
// ─────────────────────────────────────────────────────────────────────────────

async function queryToolInvocations(
  inputs: TrackingInputs,
  since: Date | undefined,
  limit: number
): Promise<TrackingOutput> {
  const conditions = [];
  if (inputs.id) {
    conditions.push(eq(toolInvocations.toolId, Number(inputs.id)) as never);
  }
  if (inputs.status) {
    conditions.push(eq(toolInvocations.status, inputs.status as never) as never);
  }
  if (since) {
    conditions.push(gte(toolInvocations.createdAt, since) as never);
  }

  const items = await db.query.toolInvocations.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(toolInvocations.createdAt)],
    limit,
  });

  const avgDuration =
    items.length > 0
      ? items.reduce((sum, inv) => sum + (inv.duration || 0), 0) / items.length
      : 0;

  return {
    type: "tool",
    items,
    count: items.length,
    summary: { totalTasks: items.length, averageDuration: Math.round(avgDuration) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Tracking
// ─────────────────────────────────────────────────────────────────────────────

async function queryEvents(
  inputs: TrackingInputs,
  since: Date | undefined,
  limit: number
): Promise<TrackingOutput> {
  const conditions = [];
  if (inputs.id) {
    conditions.push(eq(events.correlationId, inputs.id) as never);
  }
  if (inputs.status) {
    conditions.push(eq(events.type, inputs.status) as never);
  }
  if (since) {
    conditions.push(gte(events.createdAt, since) as never);
  }

  const items = await db.query.events.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(events.createdAt)],
    limit,
  });

  return { type: "event", items, count: items.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution Trace Tracking
// ─────────────────────────────────────────────────────────────────────────────

async function queryTraces(
  inputs: TrackingInputs,
  since: Date | undefined,
  limit: number
): Promise<TrackingOutput> {
  const conditions = [];
  if (inputs.id) {
    conditions.push(eq(executionTraces.taskId, Number(inputs.id)) as never);
  }
  if (inputs.status) {
    conditions.push(eq(executionTraces.status, inputs.status as never) as never);
  }
  if (since) {
    conditions.push(gte(executionTraces.timestamp, since) as never);
  }

  const items = await db.query.executionTraces.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(executionTraces.timestamp)],
    limit,
  });

  const avgDuration =
    items.length > 0
      ? items.reduce((sum, t) => sum + (t.duration || 0), 0) / items.length
      : 0;

  return {
    type: "trace",
    items,
    count: items.length,
    summary: { totalTasks: items.length, averageDuration: Math.round(avgDuration) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// System Overview
// ─────────────────────────────────────────────────────────────────────────────

async function querySystemOverview(
  _ctx: ExecutionContext,
  limit: number
): Promise<TrackingOutput> {
  const [recentTasks, recentEvents, recentTraces, recentInvocations] = await Promise.all([
    db.query.tasks.findMany({ orderBy: [desc(tasks.createdAt)], limit: 10 }),
    db.query.events.findMany({ orderBy: [desc(events.createdAt)], limit: 10 }),
    db.query.executionTraces.findMany({ orderBy: [desc(executionTraces.timestamp)], limit: 10 }),
    db.query.toolInvocations.findMany({ orderBy: [desc(toolInvocations.createdAt)], limit: 10 }),
  ]);

  const totalTasks = await db.select({ count: tasks.id }).from(tasks);
  const totalCompleted = await db
    .select({ count: tasks.id })
    .from(tasks)
    .where(eq(tasks.status, "completed"));
  const totalFailed = await db
    .select({ count: tasks.id })
    .from(tasks)
    .where(eq(tasks.status, "failed"));

  return {
    type: "system",
    items: [
      { metric: "recent_tasks", data: recentTasks },
      { metric: "recent_events", data: recentEvents },
      { metric: "recent_traces", data: recentTraces },
      { metric: "recent_invocations", data: recentInvocations },
    ],
    count: 4,
    summary: {
      totalTasks: totalTasks[0]?.count ?? 0,
      completedTasks: totalCompleted[0]?.count ?? 0,
      failedTasks: totalFailed[0]?.count ?? 0,
    },
  };
}
