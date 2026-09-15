# JASIM Architecture Truth

**Assessment date:** 2026-08-20
**Assessment method:** source inspection, generated-contract inspection, development database schema push, runtime proof, smoke test, and workflow restart.

## Executive truth

JASIM is a **general conversational runtime with independently persisted Conversation,
Smart Bubble, Run, Task, and World aggregates**. It accepts a natural-language goal,
validates a model-proposed semantic output, and only allows execution through assigned
trusted capabilities. Current Action, Workflow, and Durable Run outputs are intent-only:
they are blocked or awaiting input and carry no external effects.

It is **not yet a complete universal commercial runtime**. The execution graph is
sequential in practice, there is no independent post-execution verifier or generalized
repair loop, and external-effect providers are deliberately disabled.

## Runtime call graph

```text
Web / Mobile client
  -> /api/runtime/session
     -> resolveRuntimeActor -> signed cookie or seven-day signed bearer token

  -> POST /api/runtime/tasks
     -> createRuntimeTask
        -> ModelGateway.generate
        -> validateGeneratedTaskArtifact
        -> assignPlanCapabilities
        -> insert World (version 1)
        -> insert WorldVersion (world_created)
        -> insert Task + task events

  -> POST /api/runtime/tasks/{taskId}/actions
     -> actOnRuntimeTask (transaction + task row lock)
        -> provide-context | approve-plan | executeApprovedPlan
        -> policy evaluation + capability registry for execution
        -> task event and idempotency receipt persistence
        -> synchronized WorldVersion when the task world advances

   -> POST /api/runtime/conversations/{conversationId}/turns
      -> persist user Message
      -> ModelGateway.generate
      -> strict semantic Output Router
      -> persist assistant Message, optional Smart Bubble, or blocked Run intent

  -> GET /api/runtime/worlds/{worldId}
     -> owner-scoped World + immutable version history

  -> POST /api/runtime/worlds/{worldId}/changes
     -> optimistic baseVersion check
     -> domain-neutral entity/policy/state/view change set
     -> World update + immutable WorldVersion
```

## Durable state

| Aggregate | Durable store | Truth |
| --- | --- | --- |
| Task | `jasim_runtime_tasks` | Stores goal, status, task-local snapshot, actions, optional `conversationId`, and `worldId`. |
| World | `jasim_runtime_worlds` | Independent owner-scoped aggregate with schema version, lifecycle status, definition, and current version. |
| World history | `jasim_runtime_world_versions` | Append-only snapshot per `(worldId, version)` for creation, task synchronization, and explicit evolution. |
| Task events | `jasim_runtime_events` | Append-only events for the task lifecycle. |
| Idempotency | `jasim_runtime_action_receipts` | Stores the durable response bound to a task action and key. |
| Conversation | `jasim_runtime_conversations` | Owner-scoped durable chat surface. |
| Message | `jasim_runtime_messages` | Ordered user/assistant/system/tool timeline. |
| Smart Bubble | `jasim_runtime_bubbles` | Optional durable presentation surface, optionally linked to a World. |
| Run | `jasim_runtime_runs` | Independent execution instance with optional Conversation/Bubble/Task links. |
| Run events | `jasim_runtime_run_events` | Append-only lifecycle events; creation is recorded with `effects: none`. |

The World definition is intentionally domain-neutral. It carries actors, entities, relationships, collections, capabilities, policies, permissions, workflows, actions, views, state, transactions, memory, and metadata. The current composition path initially fills the fields it can derive safely; empty collections are explicit rather than inferred.

## Trust boundaries and invariants

1. A model can propose Task DNA, a World, semantic outputs, and a plan, but cannot invoke tools directly.
2. Proposed artifacts are schema-validated; malformed output prevents task persistence.
3. Sensitive or external steps require a recorded approval before execution.
4. Only server-assigned capability bindings with a server signature may run.
5. The current real capabilities are side-effect-free local analysis/calculation; a missing trusted binding is reported as `blocked`, not success.
6. Task actions use a database transaction, a row lock, and an idempotency receipt.
7. Cookie actors and native bearer actors are signed; bearer tokens expire after seven days.
8. Task and World reads are owner-scoped. A missing or foreign resource is intentionally indistinguishable as `404`.
9. World evolution uses `baseVersion`; stale updates are rejected rather than overwriting the newer state.
10. Run creation is owner-scoped, idempotent on `(ownerId, idempotencyKey)`, and transactionally persists its initial event.
11. Run creation accepts only safe initial states; external or terminal claims cannot be selected by a client.
12. Semantic execution intents are checked against the trusted capability registry and are never reported as completed external work.

## Evidence collected

| Check | Result |
| --- | --- |
| OpenAPI code generation and library typecheck | Passed |
| Development database schema push | Passed |
| Full workspace typecheck | Passed |
| Independent World runtime proof | Passed |
| API workflow restart/build/listen | Passed |
| `/api/healthz` via proxy | Returned `{"status":"ok"}` |
| Model-unavailable smoke behavior | Passed; task creation returned the documented explicit unavailable behavior rather than a fabricated task |
| Signed session issue and foreign/unknown World response | Passed; response was `404` without leaking state |
| Run idempotency, foreign-owner isolation, restart readback, and parallel create | Passed |
| Semantic Durable Run proof with no Bubble/World and `effects: none` | Passed |
| Web/mobile workflow restart and visual preview | Passed |

## Known gaps, classified honestly

| Area | Current state | Required next capability |
| --- | --- | --- |
| Conversations | Durable owner-scoped Conversation/Message aggregate exists; richer reference resolution is pending. | Server-owned references, pagination, and conversation-level evolution flows. |
| World editing from chat | API supports versioned generic change sets; chat does not yet compose them from natural language. | Planner-to-change-set flow with validation, preview, and approval as needed. |
| Task/World relationship | New tasks persist a separate World; legacy tasks can still have no `worldId`. | Backfill/migration and a single World-first route in clients. |
| Execution graph | Step dependencies are validated, but execution is effectively sequential. | DAG scheduler, branch state, parallel-safe joins, and replan edges. |
| Verification and recovery | Checkpoints and blocked/failed states exist. | Independent verifier, retry policy, repair/replan, and resume acceptance tests. |
| UI rendering | Main Chat renders Conversation messages, Smart Bubble labels, and blocked/awaiting-input intent notices. | Schema-driven World renderer and `/world/:worldId` client route. |
| External effects | Deliberately absent. | Connector-specific reconciliation and durable receipt verification before enabling effects. |

## Bottom line

The independent World persistence and versioning introduced here are a real architectural step, not a UI-only concept. The project is safe to continue as a constrained general runtime. It should not yet be described as having full conversational continuity, fully generative UI, verified external execution, or proven broad generalization.