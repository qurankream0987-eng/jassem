/**
 * Database Tool Adapter — Safe Parameterized Query Execution
 *
 * Executes safe, read-only or limited-write queries against the JASIM database
 * using Drizzle ORM. Validates table names and operation types against an allowlist.
 */

import { eq, like, and, or, desc, asc, sql, count, type SQL } from "drizzle-orm";
import { db } from "@db/queries/connection";
import * as schema from "@db/schema";
import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface DatabaseInputs {
  operation: "select" | "insert" | "update" | "delete" | "count";
  table: string;
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
  orderBy?: { column: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

// Allowlist of tables the tool can access
const ALLOWED_TABLES = [
  "users",
  "conversations",
  "messages",
  "tasks",
  "task_steps",
  "capabilities",
  "tools",
  "entities",
  "memory_entries",
  "events",
  "approvals",
  "policies",
  "agent_logs",
  "execution_traces",
  "bubbles",
  "tool_invocations",
];

// Tables that permit write operations
const WRITABLE_TABLES = [
  "memory_entries",
  "events",
  "entities",
  "bubbles",
  "tool_invocations",
];

// Tables that permit delete operations
const DELETABLE_TABLES = ["memory_entries", "events", "bubbles"];

const MAX_LIMIT = 1000;

/**
 * Execute a safe database query via Drizzle ORM.
 */
export async function executeDatabaseQuery(
  inputs: DatabaseInputs,
  ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();
  const sideEffects: string[] = [];

  try {
    validateInputs(inputs);

    const tableName = inputs.table.toLowerCase();
    const tableSchema = getTableSchema(tableName);

    switch (inputs.operation) {
      case "select":
        return await executeSelect(tableSchema, inputs, start);
      case "count":
        return await executeCount(tableSchema, inputs, start);
      case "insert": {
        if (!WRITABLE_TABLES.includes(tableName)) {
          throw new ToolError(
            ERROR_CODES.TOOL_UNAUTHORIZED,
            `Table '${tableName}' does not permit insert operations`,
            "database_query"
          );
        }
        sideEffects.push("data_modification");
        return await executeInsert(tableSchema, inputs, start, ctx);
      }
      case "update": {
        if (!WRITABLE_TABLES.includes(tableName)) {
          throw new ToolError(
            ERROR_CODES.TOOL_UNAUTHORIZED,
            `Table '${tableName}' does not permit update operations`,
            "database_query"
          );
        }
        sideEffects.push("data_modification");
        return await executeUpdate(tableSchema, inputs, start);
      }
      case "delete": {
        if (!DELETABLE_TABLES.includes(tableName)) {
          throw new ToolError(
            ERROR_CODES.TOOL_UNAUTHORIZED,
            `Table '${tableName}' does not permit delete operations`,
            "database_query"
          );
        }
        sideEffects.push("data_modification");
        return await executeDelete(tableSchema, inputs, start);
      }
      default:
        throw new ToolError(
          ERROR_CODES.VALIDATION_FAILED,
          `Unknown operation: ${inputs.operation}`,
          "database_query"
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateInputs(inputs: DatabaseInputs): void {
  if (!inputs.operation) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Database query requires an 'operation' field",
      "database_query"
    );
  }

  if (!inputs.table) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Database query requires a 'table' field",
      "database_query"
    );
  }

  const tableName = inputs.table.toLowerCase();
  if (!ALLOWED_TABLES.includes(tableName)) {
    throw new ToolError(
      ERROR_CODES.TOOL_UNAUTHORIZED,
      `Table '${inputs.table}' is not in the allowlist`,
      "database_query"
    );
  }

  if (inputs.limit && (inputs.limit < 1 || inputs.limit > MAX_LIMIT)) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      `Limit must be between 1 and ${MAX_LIMIT}`,
      "database_query"
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Resolution
// ─────────────────────────────────────────────────────────────────────────────

function getTableSchema(tableName: string) {
  const schemaMap: Record<string, unknown> = {
    users: schema.users,
    conversations: schema.conversations,
    messages: schema.messages,
    tasks: schema.tasks,
    task_steps: schema.taskSteps,
    capabilities: schema.capabilities,
    tools: schema.tools,
    entities: schema.entities,
    memory_entries: schema.memoryEntries,
    events: schema.events,
    approvals: schema.approvals,
    policies: schema.policies,
    agent_logs: schema.agentLogs,
    execution_traces: schema.executionTraces,
    bubbles: schema.bubbles,
    tool_invocations: schema.toolInvocations,
  };
  return schemaMap[tableName];
}

// ─────────────────────────────────────────────────────────────────────────────
// Query Builders
// ─────────────────────────────────────────────────────────────────────────────

async function executeSelect(
  tableSchema: unknown,
  inputs: DatabaseInputs,
  start: number
): Promise<ToolResult> {
  const table = tableSchema as Record<string, unknown>;
  const limit = Math.min(inputs.limit ?? 100, MAX_LIMIT);
  const offset = inputs.offset ?? 0;

  const conditions = buildWhereConditions(table, inputs.where);

  const query = db
    .select()
    .from(table as never)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(limit)
    .offset(offset);

  if (inputs.orderBy) {
    const col = table[inputs.orderBy.column];
    if (col) {
      query.orderBy(
        inputs.orderBy.direction === "desc" ? desc(col as never) : asc(col as never)
      );
    }
  }

  const results = await query;

  return {
    success: true,
    output: {
      rows: results,
      count: results.length,
      limit,
      offset,
    },
    duration: Date.now() - start,
    sideEffects: [],
  };
}

async function executeCount(
  tableSchema: unknown,
  inputs: DatabaseInputs,
  start: number
): Promise<ToolResult> {
  const table = tableSchema as Record<string, unknown>;
  const conditions = buildWhereConditions(table, inputs.where);

  const result = await db
    .select({ total: count() })
    .from(table as never)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return {
    success: true,
    output: { total: result[0]?.total ?? 0 },
    duration: Date.now() - start,
    sideEffects: [],
  };
}

async function executeInsert(
  tableSchema: unknown,
  inputs: DatabaseInputs,
  start: number,
  ctx: ExecutionContext
): Promise<ToolResult> {
  if (!inputs.data || Object.keys(inputs.data).length === 0) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Insert operation requires 'data' field",
      "database_query"
    );
  }

  const table = tableSchema as Record<string, unknown>;

  // Auto-populate context fields if applicable
  const enrichedData = { ...inputs.data };
  if (ctx.userId && !enrichedData.userId) {
    enrichedData.userId = Number(ctx.userId);
  }
  if (ctx.taskId && !enrichedData.taskId) {
    enrichedData.taskId = Number(ctx.taskId);
  }

  const result = await db.insert(table as never).values(enrichedData as never);

  return {
    success: true,
    output: {
      insertedId: Number((result as { insertId: string | number }).insertId),
      affectedRows: Number((result as { affectedRows: string | number }).affectedRows ?? 1),
    },
    duration: Date.now() - start,
    sideEffects: ["data_modification"],
  };
}

async function executeUpdate(
  tableSchema: unknown,
  inputs: DatabaseInputs,
  start: number
): Promise<ToolResult> {
  if (!inputs.data || Object.keys(inputs.data).length === 0) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Update operation requires 'data' field",
      "database_query"
    );
  }

  const table = tableSchema as Record<string, unknown>;
  const conditions = buildWhereConditions(table, inputs.where);

  if (conditions.length === 0) {
    throw new ToolError(
      ERROR_CODES.TOOL_UNAUTHORIZED,
      "Update requires a WHERE clause for safety",
      "database_query"
    );
  }

  const result = await db
    .update(table as never)
    .set(inputs.data as never)
    .where(and(...conditions));

  return {
    success: true,
    output: {
      affectedRows: Number((result as { affectedRows: string | number }).affectedRows ?? 0),
    },
    duration: Date.now() - start,
    sideEffects: ["data_modification"],
  };
}

async function executeDelete(
  tableSchema: unknown,
  inputs: DatabaseInputs,
  start: number
): Promise<ToolResult> {
  const table = tableSchema as Record<string, unknown>;
  const conditions = buildWhereConditions(table, inputs.where);

  if (conditions.length === 0) {
    throw new ToolError(
      ERROR_CODES.TOOL_UNAUTHORIZED,
      "Delete requires a WHERE clause for safety",
      "database_query"
    );
  }

  const result = await db
    .delete(table as never)
    .where(and(...conditions));

  return {
    success: true,
    output: {
      affectedRows: Number((result as { affectedRows: string | number }).affectedRows ?? 0),
    },
    duration: Date.now() - start,
    sideEffects: ["data_modification"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHERE Condition Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildWhereConditions(
  table: Record<string, unknown>,
  where?: Record<string, unknown>
): SQL<unknown>[] {
  if (!where) return [];
  const conditions: SQL<unknown>[] = [];

  for (const [key, value] of Object.entries(where)) {
    const column = table[key];
    if (!column) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        `Column '${key}' does not exist on table`,
        "database_query"
      );
    }

    if (typeof value === "string" && value.includes("%")) {
      // LIKE pattern
      conditions.push(like(column as never, value) as SQL<unknown>);
    } else {
      conditions.push(eq(column as never, value) as SQL<unknown>);
    }
  }

  return conditions;
}
