# JASIM General Runtime Report

**Assessment date:** 2026-08-20

## What is generalized today

The runtime has no first-class branches for automotive sales, restaurants, hiring, or another named business domain. Its generic input/output contract is:

```text
Natural-language goal
  -> Task DNA
  -> World definition
  -> plan steps and requested capabilities
  -> approval-gated, trusted capability execution
  -> durable task events, receipts, and World versions
```

The model prompt constrains the model to a generic artifact and rejects credentials, executable code, tool calls, and invented completion claims. The runtime validates plan dependency order and duplicate IDs before writing state.

The conversational entry point now uses a durable owner-scoped Conversation and Message
aggregate. Its semantic Output Router supports text, structured results, ephemeral and
interactive Bubbles, persistent Smart Bubbles, and execution intents. Action, Workflow, and
Durable Run intents are persisted only as blocked or awaiting-input records with
`effects: none`; they do not execute providers or claim external success.

## General World contract

A persisted World contains:

- identity, schema version, lifecycle status, and continuity mode;
- actors, entities, relationships, and collections;
- capabilities, policies, and permissions;
- workflows and executable action projection;
- renderable views and generic state;
- transactions, memory, and metadata.

The public World change endpoint is deliberately generic. It supports an optimistic, version-checked change set for:

- upserting/removing an entity;
- upserting/removing a policy;
- setting a state key;
- upserting/removing a view.

This is enough to prove that a World can evolve independently without an `if intent == domain` handler. It is not yet a full natural-language World migration engine.

## Runtime safety status

| Mechanism | Status |
| --- | --- |
| Model output schema validation | Implemented |
| Unknown/forward dependency rejection | Implemented |
| Explicit task context and approval | Implemented |
| Capability allow-list and signed binding | Implemented |
| Idempotent action receipt | Implemented |
| Task ownership and signed sessions | Implemented |
| World ownership and optimistic versioning | Implemented |
| Conversation and Message ownership | Implemented |
| Independent durable Run with idempotency and events | Implemented |
| Semantic output feasibility gate | Implemented for trusted capability presence and safe blocked states |
| Side-effect reconciliation | Not implemented by design |
| Independent output verifier | Not implemented |
| Retry/repair/replan orchestration | Not implemented |

## Current capability truth

The capability registry currently has real, side-effect-free local capabilities. It does not perform financial, communication, persistent external, or destructive operations. Therefore:

- a plan needing an unassigned capability becomes `blocked`;
- a plan cannot obtain an external effect merely because a model described one;
- the current system is appropriate for safe planning and constrained local computation;
- enabling external execution needs connector-specific idempotency, reconciliation, and a verifier before it is called production-ready.

## Client and projection status

OpenAPI generates typed client hooks for Conversations, Messages, Smart Bubbles, Runs, and
Worlds. Web and mobile Main Chat now use the Conversation Turn route and show persisted
execution-intent status without presenting it as completed work. The Soap Glass visual layer
remains presentation-only and is not used as the source of runtime state.

## Maturity statement

**General semantic planning:** implemented, dependent on a configured model service.  
**Independent World aggregate:** implemented for newly created tasks.  
**Generic versioned World mutation API:** implemented.  
**General execution/runtime proof:** partial; proven for owner-scoped, idempotent, restart-durable, blocked execution intents and safe local capabilities.
**General generative product UI:** incomplete.  
**Production external-effect runtime:** intentionally not enabled.

## TRUSTED EXECUTION PREPARATION

| Capability | Status |
| --- | --- |
| Execution Proposal | REAL — owner-scoped records persist canonical capability identity, normalized inputs, resolved targets, policy context, fingerprint, events, and `effects: none`. |
| Canonical fingerprint | PASS — SHA-256 canonical serialization keeps JSON key order stable and changes when capability inputs, resolved targets, owner/scope, or policy context changes. |
| Policy evaluation | REAL — the server decides allow, deny, require-input, or require-approval before approval. |
| Approval binding | PASS — approvals bind one proposal to its exact execution fingerprint; clients cannot supply owner identity or a trusted fingerprint. |
| Approval invalidation | PASS — changed proposal configuration supersedes the old proposal and invalidates its approval. |
| Approval replay protection | PASS — a pending approval accepts one decision only. |
| Unknown capability blocking | PASS — unknown capabilities are durably `blocked` as `UNKNOWN_CAPABILITY`. |
| Provider execution | NOT ENABLED |
| Execution receipts | NOT ENABLED |
| External effects | ZERO |

`authorized` means only that the exact proposal passed current policy and approval checks. It
does **not** mean execution, completion, receipt creation, or external verification. A future
executor must revalidate the fingerprint before producing a receipt, and an independent verifier
must confirm any observed effect.

## DURABLE DAG CORE

| Capability | Status |
| --- | --- |
| Durable DAG | REAL — Run-owned nodes and `SUCCESS_REQUIRED` dependencies persist in the development database. |
| Dependency scheduling | PASS — readiness is computed server-side only after every required upstream node is `COMPLETED`. |
| Atomic claim | PASS — a ready node is claimed transactionally by one worker only. |
| Lease | PASS — each claim receives a bounded expiry, worker identity, opaque lease token, and monotonic fence version; sensitive writes check PostgreSQL's authoritative clock at commit time. |
| Heartbeat | PASS — only the current lease holder can extend a nonterminal lease. |
| Fencing | PASS — an expired/reclaimed node rejects completion from the prior worker credentials. |
| Parallel claim safety | PASS — concurrent claims for one ready node yield exactly one winner. |
| Local trusted worker | REAL — only registered side-effect-free local capabilities can run; the worker revalidates capability, inputs, proposal status, approval fingerprint, and policy-derived gate before start and completion. |
| Retry | PASS — only explicitly retryable failures schedule a bounded later attempt; permanent failures terminate. |
| Restart recovery | PASS — durable ready/retry state and expired-lease recovery are database-derived, not process-memory state. |
| Cancellation | PASS — cancelling a Run cancels every nonterminal node and prevents future claims. |
| User status projection | REAL — Web and Mobile show node status without worker, lease, or fencing secrets. |
| External providers | NOT ENABLED |
| Execution receipts | NOT ENABLED IN THIS TRANCHE |
| Independent verifier | NOT ENABLED IN THIS TRANCHE |
| External side effects | ZERO |

This is a durable DAG core, not a distributed workflow platform. It uses the current database
and Run event stream, with no Kafka, Redis, queue service, or external provider. Node completion
means only a trusted local capability finished; it is never labelled verified.