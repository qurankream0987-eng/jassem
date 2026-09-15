import { describe, expect, it } from "vitest";
import {
  assessRuntimeSchema,
  buildLifecycleReadiness,
  type RuntimeLifecycleReadiness,
} from "../../api/core/runtime-readiness";

// ── Canonical full-schema fixture ───────────────────────────────────────────

const tables = [
  "users", "conversations", "messages", "bubbles", "runs", "dag_nodes",
  "dag_dependencies", "execution_proposals", "proposal_approvals",
  "execution_attempts", "runtime_tasks", "jasim_model_usage_ledger",
];

const columns = [
  ["users", ["id", "unionId", "status"]],
  ["conversations", ["id", "userId"]],
  ["messages", ["id", "conversationId", "ownerId"]],
  ["bubbles", ["id", "userId"]],
  ["runs", ["id", "ownerId", "status", "currentState"]],
  ["dag_nodes", ["id", "runId", "ownerId", "status", "attemptCount", "maxAttempts", "claimedBy", "leaseToken", "leaseExpiresAt", "fenceVersion", "version"]],
  ["dag_dependencies", ["id", "runId", "ownerId", "upstreamNodeId", "downstreamNodeId"]],
  ["execution_proposals", ["id", "ownerId", "runId", "fingerprint", "status", "capabilityId"]],
  ["proposal_approvals", ["id", "proposalId", "ownerId", "executionFingerprint", "status"]],
  ["execution_attempts", ["id", "ownerId", "runId", "nodeId", "fingerprint", "idempotencyKey", "attemptNumber", "leaseToken", "fenceVersion", "executionStatus", "verificationStatus"]],
  ["runtime_tasks", ["id", "userId", "status"]],
  ["jasim_model_usage_ledger", ["id", "ownerId", "purpose", "success"]],
] as const;

function allColumns() {
  return columns.flatMap(([table, names]) => names.map((column) => ({ table, column })));
}

// ── assessRuntimeSchema unit tests ───────────────────────────────────────────

describe("runtime readiness schema contract", () => {
  it("accepts the complete canonical runtime contract", () => {
    expect(assessRuntimeSchema({
      tables,
      columns: allColumns(),
      constraints: ["execution_attempts_idempotencyKey_unique"],
    })).toEqual([]);
  });

  it("rejects a partially migrated lease/fence schema", () => {
    expect(assessRuntimeSchema({
      tables,
      columns: allColumns().filter((item) => item.column !== "fenceVersion"),
      constraints: [],
    })).toEqual(expect.arrayContaining([
      "column:dag_nodes.fenceVersion",
      "column:execution_attempts.fenceVersion",
      "constraint:execution_attempts_idempotencyKey_unique",
    ]));
  });

  it("rejects when a whole required table is missing", () => {
    const missing = assessRuntimeSchema({
      tables: tables.filter((t) => t !== "jasim_model_usage_ledger"),
      columns: allColumns(),
      constraints: ["execution_attempts_idempotencyKey_unique"],
    });
    expect(missing).toContain("table:jasim_model_usage_ledger");
    // columns of the missing table should also be reported
    expect(missing).toContain("column:jasim_model_usage_ledger.id");
  });

  it("rejects when idempotency constraint is absent", () => {
    const missing = assessRuntimeSchema({
      tables,
      columns: allColumns(),
      constraints: [],
    });
    expect(missing).toContain("constraint:execution_attempts_idempotencyKey_unique");
  });

  it("returns no duplicates for a complete schema", () => {
    const result = assessRuntimeSchema({
      tables,
      columns: allColumns(),
      constraints: ["execution_attempts_idempotencyKey_unique"],
    });
    expect(new Set(result).size).toBe(result.length);
  });
});

// ── buildLifecycleReadiness unit tests ───────────────────────────────────────
// These use the pure builder (no DB) to cover all lifecycle signal combinations.

describe("runtime lifecycle readiness – normal", () => {
  it("all signals are up when db is reachable and schema is complete", () => {
    const r = buildLifecycleReadiness({ dbReachable: true });
    expect(r.ready).toBe(true);
    expect(r.db).toBe("up");
    expect(r.schema).toBe("up");
    expect(r.executor).toBe("up");
    expect(r.recovery).toBe("up");
    expect(r.missing).toBeUndefined();
    expect(typeof r.checkedAt).toBe("string");
    expect(() => new Date(r.checkedAt)).not.toThrow();
  });
});

describe("runtime lifecycle readiness – DB unavailable", () => {
  let r: RuntimeLifecycleReadiness;
  it("marks db as db_unreachable", () => {
    r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.db).toBe("db_unreachable");
  });
  it("marks overall ready as false", () => {
    r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.ready).toBe(false);
  });
  it("marks schema as unavailable (cannot probe without DB)", () => {
    r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.schema).toBe("unavailable");
  });
  it("marks executor as unavailable", () => {
    r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.executor).toBe("unavailable");
  });
  it("marks recovery as unavailable (no DB = no lease sweep)", () => {
    r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.recovery).toBe("unavailable");
  });
});

describe("runtime lifecycle readiness – schema incompatible", () => {
  const incompatibleMissing = [
    "table:jasim_model_usage_ledger",
    "column:execution_attempts.fenceVersion",
    "constraint:execution_attempts_idempotencyKey_unique",
  ];

  it("marks overall ready as false", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: incompatibleMissing });
    expect(r.ready).toBe(false);
  });
  it("marks db as up (DB is reachable)", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: incompatibleMissing });
    expect(r.db).toBe("up");
  });
  it("marks schema as schema_incompatible", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: incompatibleMissing });
    expect(r.schema).toBe("schema_incompatible");
  });
  it("exposes the missing items list", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: incompatibleMissing });
    expect(r.missing).toEqual(incompatibleMissing);
  });
  it("marks executor as unavailable (schema gate blocks execution)", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: incompatibleMissing });
    expect(r.executor).toBe("unavailable");
  });
  it("marks recovery as up (lease sweep only needs DB)", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: incompatibleMissing });
    expect(r.recovery).toBe("up");
  });
});

describe("runtime lifecycle readiness – executor unavailable (request-driven model)", () => {
  // The executor is request-driven: it is 'unavailable' whenever the schema
  // gate would prevent safe execution.  There is no separate worker process to
  // start/stop; the executor is a function of db+schema state.
  it("executor is up when db+schema are both up", () => {
    const r = buildLifecycleReadiness({ dbReachable: true });
    expect(r.executor).toBe("up");
  });
  it("executor is unavailable when db is down", () => {
    const r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.executor).toBe("unavailable");
  });
  it("executor is unavailable when schema is incompatible", () => {
    const r = buildLifecycleReadiness({ dbReachable: true, missing: ["table:runs"] });
    expect(r.executor).toBe("unavailable");
  });
});

describe("runtime lifecycle readiness – recovery unavailable", () => {
  it("recovery is unavailable when db is down", () => {
    const r = buildLifecycleReadiness({ dbReachable: false });
    expect(r.recovery).toBe("unavailable");
  });
  it("recovery is up even when schema is incompatible (DB is reachable)", () => {
    // Lease recovery is a simple UPDATE on dag_nodes rows. It does not require
    // the full schema contract; it only needs the DB to be reachable.
    const r = buildLifecycleReadiness({ dbReachable: true, missing: ["table:jasim_model_usage_ledger"] });
    expect(r.recovery).toBe("up");
  });
});

describe("runtime lifecycle readiness – restore normal after degraded", () => {
  it("all signals flip back to up when db is restored and schema is complete", () => {
    // Simulate degraded state first
    const degraded = buildLifecycleReadiness({ dbReachable: false });
    expect(degraded.ready).toBe(false);

    // Simulate restored state
    const restored = buildLifecycleReadiness({ dbReachable: true });
    expect(restored.ready).toBe(true);
    expect(restored.db).toBe("up");
    expect(restored.schema).toBe("up");
    expect(restored.executor).toBe("up");
    expect(restored.recovery).toBe("up");
    expect(restored.missing).toBeUndefined();
  });

  it("partial restore: db back but schema still missing transitions executor to unavailable", () => {
    const partial = buildLifecycleReadiness({
      dbReachable: true,
      missing: ["column:execution_attempts.fenceVersion"],
    });
    expect(partial.db).toBe("up");
    expect(partial.schema).toBe("schema_incompatible");
    expect(partial.executor).toBe("unavailable");
    expect(partial.recovery).toBe("up");
    expect(partial.ready).toBe(false);
  });
});
