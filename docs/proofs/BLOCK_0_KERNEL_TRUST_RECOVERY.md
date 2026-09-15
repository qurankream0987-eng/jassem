# JASIM Block 0 — Kernel Trust + Recovery Closure

**Scope:** Identity and owner isolation, the active trusted executor boundary, and durable Run recovery.  
**Out of scope:** Scheduler work, cross-user discovery, maps, payments, commercial/economic runtime, model calibration, and domain-specific additions.

## Result

**PASS for the active canonical runtime.**

The checks below exercised PostgreSQL-backed canonical paths. This report does not
claim that inactive legacy/reference modules are production paths.

## Identity and Isolation

| Gate | Evidence | Result |
|---|---|---|
| Missing session cannot access private API | `test:jasim-block0-phase-a` | PASS |
| Invalid and expired signed sessions stay anonymous | `test:jasim-block0-phase-a` | PASS |
| Forged client owner input cannot write as another user | `test:jasim-block0-phase-a` | PASS |
| Cross-owner conversation, Bubble, Run reads are blocked | `test:jasim-block0-phase-a` | PASS |
| Cross-owner Run execution is blocked | `test:jasim-block0-phase-a` | PASS |
| WebSocket principal is authenticated at handshake and cannot be swapped by a message | `block0-auth-boundaries.test.ts` | PASS |

Phase A terminal counters:

```text
PRIVATE_ANONYMOUS_ACCESS=0
FORGED_OWNER_SUCCESS=0
CROSS_OWNER_PRIVATE_READS=0
CROSS_OWNER_PRIVATE_WRITES=0
CROSS_OWNER_PRIVATE_EXECUTIONS=0
IDOR_PRIVATE_ACCESS=0
```

## Trusted Execution Boundary

- The active router uses the canonical runtime and derives owner identity from the
  authenticated server context.
- Generated plans select registered capabilities; they cannot provide executable
  code or connector requests.
- The active capability registry currently declares `sideEffects: "none"`.
- Proposal fingerprint and approval checks are re-evaluated before final node
  completion.
- Attempt records, verifier output, and reconciliation remain canonical and
  regressions pass.

Evidence:

```text
test:jasim-trusted-executor      PASS
test:phase2-attempt-ledger       PASS (no blocked Run was misreported as executed)
test:phase3-verifier             PASS (INCONCLUSIVE is never success)
test:phase4-reconciliation       PASS (no blind retry)
```

## Restart, Leases, and Fencing

A two-process durable proof ran against PostgreSQL:

1. Process A completed nodes A and B in a four-node dependency chain.
2. It claimed and started node C, persisted the lease, then terminated with
   `SIGKILL` without graceful completion.
3. Process B waited for the durable lease to expire, recovered the node, advanced
   its fence version, and rejected Process A's stale completion token.
4. Process B completed C and D. Nodes A and B remained single-attempt.

```text
PASS MULTI_NODE_DAG
PASS LEASE_RECOVERY
STALE_WORKER_COMMIT=0
COMPLETED_NODE_REEXECUTION=0
DOUBLE_VALID_WORKER_CLAIM=0
BLIND_EFFECT_RETRY_AFTER_RESTART=0
FALSE_RUN_SUCCESS=0
PASS STARTUP_RECOVERY
PASS RUN_RESTART
```

The active canonical executor is request-driven and does not instantiate the
legacy `DurableJobWorker`; its safety comes from durable node leases, database
time fencing on terminal writes, and recovery on the next executor invocation.
No scheduler or second worker path was introduced.

## Migration and Readiness Safety

- A temporary fresh PostgreSQL database accepted the baseline and all four
  canonical migrations.
- The proof recorded five migration ledger entries and verified nine required
  runtime tables.
- Deliberately invalid migration SQL failed under `ON_ERROR_STOP`.
- The temporary database was removed after the proof.
- Application readiness now validates the canonical table, lease/fence, owner,
  proposal, attempt-ledger, and idempotency-constraint contract read-only. It
  returns `503` with `schema_incompatible` or `db_unreachable`; it does not run
  migrations or mutate production schema during startup/health checks.

```text
PASS FRESH_MIGRATION tables=9 ledger=5 failure_detection=PASS
```

## Regression Evidence

```text
check:generative-runtime          PASS
block0-auth-boundaries.test.ts    PASS (2 tests)
test:phase7-generalization        PASS
test:jasim-artifact-bubble        PASS
test:jasim-research-to-image      PASS
test:jasim-block0-restart         PASS
web build                          PASS
mobile typecheck                   PASS
```

The web build issued its existing chunk-size warning only; it was not a failure.

## Hard-Gate Summary

```text
DOMAIN_SPECIFIC_CORE_ADDITIONS=0
DOMAIN_SPECIFIC_HANDLER_REQUIRED=0
FAKE_SUCCESS=0
```

No Block 1 work was started by this closure.