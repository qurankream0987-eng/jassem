# JASIM Generalization Test Report

**Assessment date:** 2026-08-19  
**Status:** partial proof; no broad-success-rate claim.

## Executed tests

| Test | Evidence | Result |
| --- | --- | --- |
| Generic model-unavailable handling | `pnpm --filter @workspace/scripts run test:jasim-runtime` | Passed. No task was silently fabricated when a model service was not configured. |
| Independent World creation | `pnpm --filter @workspace/scripts run test:jasim-world-runtime` | Passed. A non-product-specific neighborhood repair exchange goal produced a task with a separate `worldId`. |
| Task-to-World lifecycle synchronization | Same runtime proof | Passed. Supplying execution context advanced task status and persisted World version 2 with `awaiting_approval` state. |
| Versioned World evolution | Same runtime proof | Passed. Entity, state, and view changes produced World version 3 and an append-only history. |
| Stale-update protection | Same runtime proof | Passed. A `baseVersion: 2` edit was rejected after version 3 existed. |
| Owner isolation | Same runtime proof | Passed. A second owner could not read the first owner’s World. |
| API availability after restart | API workflow restart plus `/api/healthz` through proxy | Passed. Server rebuilt and returned health status. |
| Full workspace static verification | `pnpm run typecheck` | Passed. |

## Explicit non-results

The following tests have **not** been run and must not be inferred from the passing proof:

1. 30 independently authored unknown-intent prompts through a real configured model provider.
2. A measured Generalization Success Rate.
3. Natural-language editing of an existing World through a persisted conversation.
4. Browser/mobile schema-driven World rendering.
5. Restart during an executing multi-step plan followed by automatic resume.
6. Failed capability retry, repair, replan, and independent verification.
7. External-effect idempotency/reconciliation, because no external-effect capability is enabled.

Consequently:

```text
Generalization Success Rate = not measured (N/A)
```

It would be misleading to turn the single deterministic runtime fixture into a 30-scenario score. The fixture proves runtime invariants, not model quality across domains.

## Recommended acceptance suite before claiming broad generalization

Create a controlled, versioned corpus with at least 30 goals that covers:

- information organization, planning, and analysis;
- multi-actor coordination;
- reusable evolving systems;
- ambiguous goals and missing constraints;
- multilingual Arabic/English requests;
- a goal with no assigned capability;
- a rejected approval;
- a failing safe capability;
- an existing World change with a conflicting version;
- restart and resume while a plan is incomplete.

For each case, record: artifact validity, domain-specific branching count (expected zero), required context quality, approval correctness, capability truthfulness, resulting World version, isolation behavior, and verifier result. Only then calculate:

```text
GSR = successful scenarios / attempted scenarios
```

The test harness must use a real configured model provider and retain sanitized artifacts and receipts as evidence.