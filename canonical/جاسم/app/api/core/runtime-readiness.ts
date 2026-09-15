import { sql } from "drizzle-orm";
import { db } from "../queries/connection";

const requiredRuntimeTables = [
  "users",
  "conversations",
  "messages",
  "bubbles",
  "runs",
  "dag_nodes",
  "dag_dependencies",
  "execution_proposals",
  "proposal_approvals",
  "execution_attempts",
  "runtime_tasks",
  "jasim_model_usage_ledger",
] as const;

const requiredColumns = {
  users: ["id", "unionId", "status"],
  conversations: ["id", "userId"],
  messages: ["id", "conversationId", "ownerId"],
  bubbles: ["id", "userId"],
  runs: ["id", "ownerId", "status", "currentState"],
  dag_nodes: [
    "id", "runId", "ownerId", "status", "attemptCount", "maxAttempts",
    "claimedBy", "leaseToken", "leaseExpiresAt", "fenceVersion", "version",
  ],
  dag_dependencies: ["id", "runId", "ownerId", "upstreamNodeId", "downstreamNodeId"],
  execution_proposals: ["id", "ownerId", "runId", "fingerprint", "status", "capabilityId"],
  proposal_approvals: ["id", "proposalId", "ownerId", "executionFingerprint", "status"],
  execution_attempts: [
    "id", "ownerId", "runId", "nodeId", "fingerprint", "idempotencyKey",
    "attemptNumber", "leaseToken", "fenceVersion", "executionStatus", "verificationStatus",
  ],
  runtime_tasks: ["id", "userId", "status"],
  jasim_model_usage_ledger: ["id", "ownerId", "purpose", "success"],
} as const;

const requiredConstraints = [
  "execution_attempts_idempotencyKey_unique",
] as const;

export type RuntimeReadiness =
  | { ready: true }
  | { ready: false; reason: "db_unreachable" | "schema_incompatible"; missing?: string[] };

export function assessRuntimeSchema(input: {
  tables: Iterable<string>;
  columns: Iterable<{ table: string; column: string }>;
  constraints: Iterable<string>;
}): string[] {
  const tables = new Set(input.tables);
  const columns = new Map<string, Set<string>>();
  for (const item of input.columns) {
    // information_schema rows must be interpreted relationally: a column
    // reported for a table that is not present in the table set cannot satisfy
    // the runtime contract for that table.
    if (!tables.has(item.table)) continue;
    const tableColumns = columns.get(item.table) ?? new Set<string>();
    tableColumns.add(item.column);
    columns.set(item.table, tableColumns);
  }
  const constraints = new Set(input.constraints);
  const missing = requiredRuntimeTables.filter((table) => !tables.has(table)).map((table) => `table:${table}`);
  for (const [table, expected] of Object.entries(requiredColumns)) {
    const actual = columns.get(table) ?? new Set<string>();
    for (const column of expected) {
      if (!actual.has(column)) missing.push(`column:${table}.${column}`);
    }
  }
  for (const constraint of requiredConstraints) {
    if (!constraints.has(constraint)) missing.push(`constraint:${constraint}`);
  }
  return missing;
}

/**
 * Read-only schema compatibility gate. Migrations remain an explicit deployment
 * operation: serving traffic must never mutate production schema implicitly.
 */
export async function checkRuntimeReadiness(): Promise<RuntimeReadiness> {
  try {
    const [tableResult, columnResult, constraintResult] = await Promise.all([
      db.execute(sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'users', 'conversations', 'messages', 'bubbles', 'runs', 'dag_nodes',
            'dag_dependencies', 'execution_proposals', 'proposal_approvals',
            'execution_attempts', 'runtime_tasks', 'jasim_model_usage_ledger'
          )
      `),
      db.execute(sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'users', 'conversations', 'messages', 'bubbles', 'runs', 'dag_nodes',
            'dag_dependencies', 'execution_proposals', 'proposal_approvals',
            'execution_attempts', 'runtime_tasks', 'jasim_model_usage_ledger'
          )
      `),
      db.execute(sql`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND constraint_name IN ('execution_attempts_idempotencyKey_unique')
      `),
    ]);
    const tableRows = (tableResult as unknown as { rows?: Array<{ table_name?: string }> }).rows ?? [];
    const columnRows = (columnResult as unknown as {
      rows?: Array<{ table_name?: string; column_name?: string }>;
    }).rows ?? [];
    const constraintRows = (constraintResult as unknown as {
      rows?: Array<{ constraint_name?: string }>;
    }).rows ?? [];
    const missing = assessRuntimeSchema({
      tables: tableRows.flatMap((row) => (typeof row.table_name === "string" ? [row.table_name] : [])),
      columns: columnRows.flatMap((row) =>
        typeof row.table_name === "string" && typeof row.column_name === "string"
          ? [{ table: row.table_name, column: row.column_name }]
          : [],
      ),
      constraints: constraintRows.flatMap((row) =>
        typeof row.constraint_name === "string" ? [row.constraint_name] : [],
      ),
    });
    return missing.length === 0 ? { ready: true } : { ready: false, reason: "schema_incompatible", missing };
  } catch {
    return { ready: false, reason: "db_unreachable" };
  }
}

// ── Runtime lifecycle dependency state ────────────────────────────────────────
//
// The canonical executor is request-driven (not a daemon worker): each tRPC
// call resolves a DAG node inline.  There is no persistent background process
// to poll.  The lifecycle signals below therefore represent:
//
//   • db          – whether the database pool can be reached (live probe)
//   • schema      – whether the current public schema satisfies the runtime
//                   contract (derived from checkRuntimeReadiness)
//   • executor    – whether the request-driven execution path is available;
//                   this is true whenever db+schema are both satisfied, because
//                   execution is inline with requests rather than a separate
//                   daemon.  It is false when the schema contract is violated or
//                   the DB is unreachable, because those two dependencies are
//                   the only hard blockers for synchronous execution.
//   • recovery    – whether expired-lease recovery can run; depends only on the
//                   db connection (recovery is a DB-level operation on dag_nodes
//                   that runs at the start of each executeRuntimeDagNode call).
//
// A future persistent worker (DurableJobWorker) would add its own boolean here;
// the type union is kept open-ended to support that.

export type RuntimeDependencyState =
  | "up"
  | "db_unreachable"
  | "schema_incompatible"
  | "unavailable";

export interface RuntimeLifecycleReadiness {
  /** Overall liveness: true only when all required dependencies are up. */
  ready: boolean;
  db: RuntimeDependencyState;
  schema: RuntimeDependencyState;
  /**
   * Request-driven executor availability.  The canonical jasim-runtime executor
   * runs inline with each tRPC request; it is available whenever db+schema are
   * satisfied.  Represented as a concrete lifecycle signal rather than a
   * hard-coded boolean so that future daemon workers can plug in here.
   */
  executor: RuntimeDependencyState;
  /**
   * Lease recovery availability.  Expired-lease sweep runs at the start of each
   * executeRuntimeDagNode call and only requires the DB to be reachable.
   */
  recovery: RuntimeDependencyState;
  missing?: string[];
  checkedAt: string;
}

/**
 * Full runtime lifecycle readiness: probes the DB, evaluates the schema
 * contract, and derives executor + recovery availability from those signals.
 *
 * This function is the authoritative source of truth for the /health endpoint
 * and for the migration/readiness proof scripts.
 */
export async function checkRuntimeLifecycleReadiness(): Promise<RuntimeLifecycleReadiness> {
  const checkedAt = new Date().toISOString();

  // ── DB reachability ──────────────────────────────────────────────────────
  let dbState: RuntimeDependencyState = "up";
  let schemaState: RuntimeDependencyState = "up";
  let missing: string[] | undefined;

  const schemaReadiness = await checkRuntimeReadiness();

  if (!schemaReadiness.ready) {
    if (schemaReadiness.reason === "db_unreachable") {
      dbState = "db_unreachable";
      schemaState = "unavailable"; // cannot evaluate schema without DB
    } else {
      // DB is reachable but schema is wrong
      dbState = "up";
      schemaState = "schema_incompatible";
      missing = schemaReadiness.missing;
    }
  }

  // ── Derive dependent states ──────────────────────────────────────────────
  // Request-driven executor: needs both db and schema
  const executorState: RuntimeDependencyState =
    dbState === "up" && schemaState === "up" ? "up" : "unavailable";

  // Recovery: only needs db (it works on dag_nodes rows, no schema-level gate)
  const recoveryState: RuntimeDependencyState =
    dbState === "up" ? "up" : "unavailable";

  const ready = dbState === "up" && schemaState === "up";

  return {
    ready,
    db: dbState,
    schema: schemaState,
    executor: executorState,
    recovery: recoveryState,
    ...(missing !== undefined ? { missing } : {}),
    checkedAt,
  };
}

/**
 * Inject an externally-constructed lifecycle readiness snapshot.
 * Used in tests to simulate DB-unavailable / schema-incompatible / worker-down
 * scenarios without touching a real database.
 */
export function buildLifecycleReadiness(input: {
  dbReachable: boolean;
  missing?: string[];
}): RuntimeLifecycleReadiness {
  const checkedAt = new Date().toISOString();
  const dbState: RuntimeDependencyState = input.dbReachable ? "up" : "db_unreachable";
  const schemaState: RuntimeDependencyState = !input.dbReachable
    ? "unavailable"
    : input.missing && input.missing.length > 0
      ? "schema_incompatible"
      : "up";
  const executorState: RuntimeDependencyState =
    dbState === "up" && schemaState === "up" ? "up" : "unavailable";
  const recoveryState: RuntimeDependencyState = dbState === "up" ? "up" : "unavailable";
  const ready = dbState === "up" && schemaState === "up";
  return {
    ready,
    db: dbState,
    schema: schemaState,
    executor: executorState,
    recovery: recoveryState,
    ...(input.missing && input.missing.length > 0 ? { missing: input.missing } : {}),
    checkedAt,
  };
}
