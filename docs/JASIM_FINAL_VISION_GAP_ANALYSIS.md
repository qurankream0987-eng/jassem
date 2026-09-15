# JASIM Final Vision — Bubble-First Gap Analysis

**Status:** Vision Gate assessment only — no feature implementation in this step  
**Reference authority:** `attached_assets/Pasted--JASIM-FINAL-VISION-CORRECTION-BUBBLE-FIRST-ARCHITECTUR_1787187466100.txt`
**Prior authority:** `attached_assets/Pasted--JASIM-FINAL-VISION-LOCK-DO-NOT-IMPLEMENT-YET-FIRST-PRO_1787186983521.txt`
**Assessment basis:** current source tree, OpenAPI contract, database schema, existing runtime reports, runtime proof, and current Web/Mobile route structure.

## Executive conclusion

The project has a real, domain-neutral runtime core and a trustworthy execution boundary. It does **not** yet implement the complete product described by the Vision Lock.

The most important corrected architectural truth is:

```text
USER
  ↓
MAIN CONVERSATION
  ↓
SMART GENERATIVE BUBBLES
  ↓
OPTIONAL DURABLE WORLD RUNTIME
  ↓
TASKS / RUNS → CAPABILITIES → EVENTS / VERIFICATION
  ↓
THE SAME BUBBLE EVOLVES AND RE-RENDERS
```

The existing work is a valid foundation, not a failed direction. The separate World aggregate and version history remain useful as the durable backing model, but World is not the product center. The final vision gate remains **closed** until the Bubble-first contracts are frozen: Conversation, Output Router, Smart Bubble, Bubble↔World binding, reference resolution, mutation/evolution, renderer, multi-user access, long-running work, verification/recovery, provider-based transactions, cross-Bubble behavior, and Capability Lab boundaries.

## Status meanings

- **COMPLETE** — the behavior and contract are present and evidenced.
- **PARTIAL** — a real foundation exists, but the final vision contract is incomplete.
- **MISSING** — no implementation or reliable contract was found.
- **WRONG_DIRECTION** — current behavior actively contradicts the vision and should not be extended.

## Point-by-point comparison

### 1. Final identity — Universal Generative Runtime

- **CURRENT IMPLEMENTATION:** The API accepts a natural-language goal, uses a Model Gateway to create validated Task DNA/Plan/World data, and executes only through registered capabilities.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/api-server/src/lib/jasim-runtime.ts`, `artifacts/api-server/src/lib/model-gateway.ts`, `docs/JASIM_GENERAL_RUNTIME_REPORT.md`
- **GAP:** The current user-facing product is still primarily a Task runtime. It does not yet cover the complete Conversation → Bubbles → Worlds → long-running runtime model.
- **REQUIRED WORK:** Establish the output-kind router, persistent Conversation runtime, generative projection layer, and long-running execution model before calling the product complete.
- **DEPENDENCIES:** Conversation model, Runtime schema, capability catalog, UI projection contract.

### 2. One primary interface — Main JASIM Chat

- **CURRENT IMPLEMENTATION:** Web has a home screen with a new objective form and runtime telemetry; mobile has a main chat-like screen and task cards.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/jasim/src/App.tsx`, `artifacts/jasim-mobile/app/index.tsx`
- **GAP:** The primary web surface still reads like a task dashboard with metrics. History, Worlds, Account, Settings, and Notifications are not yet a coherent navigation layer around one persistent chat.
- **REQUIRED WORK:** Make Main Chat the canonical entry surface and keep dashboard views secondary. Do not remove useful telemetry; move it behind supporting navigation. Smart Bubbles are the primary generated surfaces.
- **DEPENDENCIES:** Persistent conversations, Bubble discovery/expansion, shared Web/Mobile information architecture.

### 3. Chat as the control center

- **CURRENT IMPLEMENTATION:** Chat/goal entry can create a Task; Task detail can provide context, approve, and execute.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/jasim-mobile/app/index.tsx`, `artifacts/jasim-mobile/app/task/[id].tsx`, `artifacts/api-server/src/routes/runtime.ts`
- **GAP:** Search, compare, modify, monitor, schedule, buy, sell, hire, publish, and manage are not unified conversational operations. There is no server-owned message timeline.
- **REQUIRED WORK:** Add Conversation and Message aggregates and route each message through the Runtime’s intent/output decision without turning examples into domain handlers.
- **DEPENDENCIES:** Conversation state, output-kind router, capability/policy registry.

### 4. Not every request becomes a World

- **CURRENT IMPLEMENTATION:** `createRuntimeTask` always asks for and persists a Task DNA, Plan, and World artifact.
- **STATUS:** `MISSING`
- **EVIDENCE:** `composeTaskWorld` and `modelPrompt` in `artifacts/api-server/src/lib/jasim-runtime.ts`
- **GAP:** There is no dynamic decision among text response, structured answer, Bubble, action, workflow, Task, or persistent World.
- **REQUIRED WORK:** Define and validate a Runtime Output Envelope with explicit output kinds, lifecycle rules, and projection metadata. A simple question must not create a persistent World.
- **DEPENDENCIES:** Conversation runtime, Bubble schema, authorization/risk policy, client rendering contract.

### 5. Smart Generative Bubbles

- **CURRENT IMPLEMENTATION:** Mobile renders chat messages and Task cards; Task detail renders fixed sections and raw World JSON.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/jasim-mobile/app/index.tsx`, `artifacts/jasim-mobile/app/task/[id].tsx`
- **GAP:** A Bubble is not yet a first-class aggregate and generic Runtime surface whose identity, mode, state, view, role, permissions, and context drive its projection. The current UI is still a Task card/detail projection.
- **REQUIRED WORK:** Define the SmartBubble contract, safe Bubble Renderer, Bubble-scoped Runtime Context, lifecycle, and action boundary. Bubble actions must call Runtime capabilities, not contain hidden domain logic.
- **DEPENDENCIES:** Output Router, Bubble Schema, Bubble↔World binding, permissions, Web/Mobile shared projection components.

### 6. World Runtime as Bubble Backing Life

- **CURRENT IMPLEMENTATION:** New Tasks create independent records in `jasim_runtime_worlds` and immutable records in `jasim_runtime_world_versions`. Definitions include generic fields for actors, entities, relationships, workflows, actions, views, state, transactions, and memory.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `lib/db/src/schema/jasim-worlds.ts`, `artifacts/api-server/src/lib/jasim-runtime.ts`
- **GAP:** The current World aggregate is not yet bound to a Smart Bubble as its durable internal life. A Bubble cannot yet own multiple Tasks through a first-class relation, and several fields are placeholders/empty projections. Legacy Tasks may have no `worldId`.
- **REQUIRED WORK:** Keep World independent from Task, add Bubble↔World binding and Bubble↔Task lifecycle, backfill legacy records, and persist World events/permissions/automations as first-class runtime data. Do not make `/world/:worldId` the primary product surface.
- **DEPENDENCIES:** Conversation model, Bubble aggregate, migration policy, event model, multi-user roles.

### 7. Bubble Intelligence through the same Runtime

- **CURRENT IMPLEMENTATION:** Main Chat creates Tasks; World read/evolution endpoints exist independently; no Smart Bubble context is assembled for Jasim Intelligence.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `GET /api/runtime/worlds/:worldId`, `POST /api/runtime/worlds/:worldId/changes` in `artifacts/api-server/src/routes/runtime.ts`
- **GAP:** The user cannot naturally speak to an existing Bubble from Main Chat or an expanded Bubble surface and have the message resolve Bubble identity, target, role, permissions, version, and task context.
- **REQUIRED WORK:** Assemble a bounded Bubble Runtime Context containing identity, purpose, state, relevant entities, workflows, policies, actions, history summary, permissions, and version. Route all entry points through the same Jasim Intelligence and Runtime.
- **DEPENDENCIES:** Durable messages, Bubble Reference Resolution, Smart Bubble Renderer, Output Router.

### 8. Smart Bubble Evolution

- **CURRENT IMPLEMENTATION:** A version-checked generic ChangeSet can upsert/remove entities, policies, and views or set state. Stale base versions are rejected.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `evolveRuntimeWorld` in `artifacts/api-server/src/lib/jasim-runtime.ts`; OpenAPI `RuntimeWorldChangeSet`
- **GAP:** There is no conversational Bubble mutation pipeline, natural-language ChangeSet generation, migration validation, human-readable preview, approval policy, verification, or rollback operation.
- **REQUIRED WORK:** Implement `resolve Bubble → resolve target → classify mutation → plan → permission/policy → approval → capability execution → verify → version/state update → Bubble re-render`, while retaining `WorldChangeSet`, `WorldVersion`, and migration internally.
- **DEPENDENCIES:** Conversation, Bubble Reference Resolution, schema validator, policy/risk engine, verifier, checkpoint model.

### 9. Generality across domains

- **CURRENT IMPLEMENTATION:** No automotive, restaurant, hiring, or other domain-specific branches were found. The prompt and capability names are generic.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `modelPrompt` in `artifacts/api-server/src/lib/jasim-runtime.ts`; `artifacts/api-server/src/lib/capability-registry.ts`; `docs/JASIM_GENERALIZATION_TEST_REPORT.md`
- **GAP:** Only a deterministic runtime fixture has been proven. There is no 30-scenario model-backed generalization corpus or measured success rate.
- **REQUIRED WORK:** Build a versioned, Arabic/English, 30+ unknown-intent acceptance corpus and calculate GSR only from recorded outcomes.
- **DEPENDENCIES:** Configured Model Provider, sanitized artifact/receipt capture, verifier and test harness.

### 10. JASIM Intelligence

- **CURRENT IMPLEMENTATION:** Model Gateway supports provider selection; the planner handles interpretation, decomposition, capability requests, and World/Plan generation.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/api-server/src/lib/model-gateway.ts`, `artifacts/api-server/src/lib/jasim-runtime.ts`
- **GAP:** Replanning, Bubble reference resolution, and generative presentation decisions are absent. The model output shape is fixed to Task DNA/Plan/World.
- **REQUIRED WORK:** Separate semantic reasoning stages from Runtime decisions and add structured outputs for clarification, Bubble target, output kind, replan proposals, mutation class, and projection intent.
- **DEPENDENCIES:** Output Envelope, Bubble Context, Planner contract, Runtime validator, verifier.

### 11. Runtime as source of truth

- **CURRENT IMPLEMENTATION:** Tasks, Worlds, World versions, task events, and idempotency receipts are stored in PostgreSQL. Model output is validated before persistence.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `lib/db/src/schema/jasim-runtime.ts`, `lib/db/src/schema/jasim-worlds.ts`, `artifacts/api-server/src/lib/jasim-runtime.ts`
- **GAP:** Verification results, role permissions, policy decisions, and provider receipts are not complete first-class sources of truth. The current World definition contains fields for some of them but not their full lifecycle.
- **REQUIRED WORK:** Add durable verification results, policy decisions, provider receipts, and World-level event history with explicit provenance.
- **DEPENDENCIES:** External provider contract, verifier, policy engine, event schema.

### 12. Trusted Execution

- **CURRENT IMPLEMENTATION:** Plan → assigned capability → policy → approval → signed binding → execution checkpoint/receipt is substantially present.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `assignPlanCapabilities`, `evaluateExecutionPolicy`, `executeAssignedCapability` in `artifacts/api-server/src/lib/capability-registry.ts`; execution path in `jasim-runtime.ts`
- **GAP:** The final `Verifier` stage is missing. External provider reconciliation is also missing, so success cannot yet be independently verified.
- **REQUIRED WORK:** Add provider contracts, durable receipts, independent verification, and recovery semantics before enabling external effects.
- **DEPENDENCIES:** Provider/Connector abstraction, verifier, event and receipt schema.

### 13. General capability philosophy

- **CURRENT IMPLEMENTATION:** Current real capabilities are generic, side-effect-free local analysis/calculation capabilities. No named domain capability branches were found.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/api-server/src/lib/capability-registry.ts`
- **GAP:** The general catalog is small; search, extract, compare, rank, match, schedule, notify, publish, monitor, and transact are not implemented as reusable capability contracts.
- **REQUIRED WORK:** Define capability interfaces by primitive behavior, input/output schemas, risk, provider, idempotency, and verification—not by business domain.
- **DEPENDENCIES:** Connector/provider layer, policy/risk engine, capability registration lifecycle.

### 14. Commercial Runtime

- **CURRENT IMPLEMENTATION:** World schema contains a `transactions` collection, but no provider-based transaction or monetization runtime was found.
- **STATUS:** `MISSING`
- **EVIDENCE:** `RuntimeWorldDefinition` in `lib/db/src/schema/jasim-worlds.ts` is structural only; no transaction capability/provider path exists.
- **GAP:** Commission, subscription, success fee, transaction fee, CPC, CPA, featured placement, service fee, and hybrid pricing are not modeled or executed.
- **REQUIRED WORK:** Define a generic commercial contract and provider-based transaction boundary. Do not embed one payment vendor or one domain’s pricing logic in the Kernel.
- **DEPENDENCIES:** Security review, payment/commerce integration, idempotency, reconciliation, verification, legal/compliance decisions.

### 15. Memory separation

- **CURRENT IMPLEMENTATION:** World has `memory` and metadata fields; Task has a snapshot and events. Conversation memory and user memory have no independent durable model.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `lib/db/src/schema/jasim-worlds.ts`, `lib/db/src/schema/jasim-runtime.ts`, `artifacts/jasim-mobile/app/index.tsx`
- **GAP:** Mobile conversation history is local; Conversation memory, User memory, World memory, Task state, Runtime state, and Event history are not distinct persisted boundaries.
- **REQUIRED WORK:** Create separate stores and retrieval policies with scoped context assembly. Never use one unbounded prompt as the memory model.
- **DEPENDENCIES:** Conversation aggregate, user identity model, privacy/retention rules, context budget policy.

### 16. Proactive and long-running work

- **CURRENT IMPLEMENTATION:** Runtime actions are synchronous HTTP requests with task checkpoints. No scheduler, watcher, notification, wait-for-event, or durable worker lifecycle was found.
- **STATUS:** `MISSING`
- **EVIDENCE:** `artifacts/api-server/src/routes/runtime.ts`; runtime status/action implementation in `jasim-runtime.ts`
- **GAP:** A long-running task cannot safely continue independently of a request or resume from a durable trigger.
- **REQUIRED WORK:** Add durable Workflow/Run/Schedule/Trigger primitives and a worker lifecycle with lease, checkpoint, resume, cancellation, and notification receipts.
- **DEPENDENCIES:** Event model, scheduler/worker infrastructure, capability idempotency, mobile notification policy.

### 17. Multi-user Smart Bubbles

- **CURRENT IMPLEMENTATION:** World definitions can contain actors and participants; API access is owner-scoped. No Smart Bubble visibility or membership lifecycle is enforced.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `RuntimeWorldDefinition.actors`, `resolveRuntimeActor`, and owner filters in `jasim-runtime.ts`
- **GAP:** Owner is the only enforced actor boundary. Private, shared, invite-only, public, and commercial Bubble visibility plus member, customer, provider, moderator, admin, and custom roles are not persisted or evaluated.
- **REQUIRED WORK:** Add Bubble memberships and role bindings, visibility/invitation lifecycle rules, actor identity mapping, controlled sharing, and server-side role evaluation over the optional World Runtime.
- **DEPENDENCIES:** Permissions/policy engine, identity model, audit events, privacy rules.

### 18. Permissions and Policies

- **CURRENT IMPLEMENTATION:** Owner checks, capability policy evaluation, approval, and model-proposed policy strings exist. `permissions` is structurally present but not a complete enforced model.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `evaluateExecutionPolicy` in `capability-registry.ts`; `policies`/`permissions` in `jasim-worlds.ts`
- **GAP:** Actions do not consistently pass the full identity → ownership → role → permission → policy → risk → approval pipeline for World-defined roles.
- **REQUIRED WORK:** Define a server-side authorization decision object and require it for every World action, mutation, transaction, and projection.
- **DEPENDENCIES:** Multi-user membership, role schema, risk classification, audit/event model.

### 19. Transactions

- **CURRENT IMPLEMENTATION:** A generic `transactions` array exists in the World definition, but it is not a transactional provider abstraction.
- **STATUS:** `MISSING`
- **EVIDENCE:** `lib/db/src/schema/jasim-worlds.ts`; no transaction route/provider in `artifacts/api-server/src`
- **GAP:** There is no provider-based prepare/authorize/commit/receipt/verify/reconcile path.
- **REQUIRED WORK:** Add a generic transaction lifecycle independent of a single payment gateway and require explicit policy/approval/verification.
- **DEPENDENCIES:** Commercial model, connector/provider layer, security and compliance review.

### 20. Smart Bubble Renderer

- **CURRENT IMPLEMENTATION:** OpenAPI exposes a generic World definition and generated client hooks. Web/Mobile Task screens render known fields and mobile can show raw World JSON.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `lib/api-spec/openapi.yaml`; `artifacts/jasim/src/App.tsx`; `artifacts/jasim-mobile/app/task/[id].tsx`
- **GAP:** UI is not `projection(bubble identity, world schema if present, runtime state, active view, role, permissions, capabilities, workflows, context)`. There is no shared Web/Mobile Bubble projection engine.
- **REQUIRED WORK:** Define a safe Smart Bubble Renderer for compact, expanded, full-screen, public-facing, owner-facing, and member-facing surfaces, with action capability checks, loading/error/empty states, and version-conflict handling.
- **DEPENDENCIES:** Bubble Schema, optional World Schema, permissions, shared client package, visual design system.

### 21. Design — Soap Glass / Generative Bubbles / Single Chat

- **CURRENT IMPLEMENTATION:** Existing Web/Mobile work follows the approved Soap Glass direction, and the presentation layer is separate from the server Runtime state.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/jasim/src`, `artifacts/jasim-mobile/app`, `docs/JASIM_ARCHITECTURE_TRUTH.md`
- **GAP:** The visual language exists, but Smart Generative Bubbles are not yet generic Runtime projections and the web home still emphasizes dashboard telemetry.
- **REQUIRED WORK:** Preserve Soap Glass and Generative Pop Bubbles while replacing fixed Task projections with schema-driven Bubble surfaces. An expanded/full-screen Bubble is still part of the Jasim experience, not a separate World application.
- **DEPENDENCIES:** Generative UI contract; no visual redesign from scratch is required.

### 22. Web and Mobile as clients of one Runtime

- **CURRENT IMPLEMENTATION:** Both clients use the same API Server and generated OpenAPI client patterns; mobile uses signed bearer sessions and web uses cookies.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `artifacts/jasim`, `artifacts/jasim-mobile`, `lib/api-client-react`, `artifacts/api-server/src/lib/jasim-runtime.ts`
- **GAP:** They do not yet share a Smart Bubble Renderer or a complete Conversation model. Current screens are Task-specific and may evolve separately.
- **REQUIRED WORK:** Share Runtime schemas, Bubble projection contracts/components, action handling semantics, and error/state behavior across clients.
- **DEPENDENCIES:** Persistent Conversation, Bubble Renderer, generated contract, client shared primitives.

### 23. Model Providers and Gateway

- **CURRENT IMPLEMENTATION:** Model Gateway supports OpenAI, Anthropic, Gemini, and OpenAI-compatible provider selection without exposing provider credentials to the model artifact.
- **STATUS:** `COMPLETE`
- **EVIDENCE:** `artifacts/api-server/src/lib/model-gateway.ts`; `docs/JASIM_GENERAL_RUNTIME_REPORT.md`
- **GAP:** Product readiness still depends on configuring a real provider and proving fallback/timeout/cost behavior. The architecture itself is aligned.
- **REQUIRED WORK:** Add operational provider configuration, observability, quotas, and model-backed acceptance tests; do not couple Core to a provider.
- **DEPENDENCIES:** Deployment configuration, integrations/secrets, test corpus.

### 24. Connectors and Providers

- **CURRENT IMPLEMENTATION:** Capability registry is present, but current real capabilities are local analysis/calculation. No generalized Connector/Provider lifecycle was found.
- **STATUS:** `MISSING`
- **EVIDENCE:** `artifacts/api-server/src/lib/capability-registry.ts`; absence of connector/provider modules under `artifacts/api-server/src`
- **GAP:** Adding external services would currently require more than registering a provider contract, especially for receipts, reconciliation, scopes, and verification.
- **REQUIRED WORK:** Define Connector Provider interfaces, capability discovery/registration, scoped credentials, health, idempotency, receipts, verification, and disconnect behavior.
- **DEPENDENCIES:** Integrations policy, security model, transaction model, verifier.

### 25. Unsupported actions must be BLOCKED

- **CURRENT IMPLEMENTATION:** Missing trusted capability bindings are denied and returned as `blocked`; the runtime smoke test asserts no false completion.
- **STATUS:** `COMPLETE`
- **EVIDENCE:** `executeApprovedPlan` and `execution_blocked` in `jasim-runtime.ts`; `scripts/src/jasim-runtime-smoke.ts`
- **GAP:** The behavior is proven for the current safe capability set, not yet across external providers or every future action class.
- **REQUIRED WORK:** Preserve this invariant in all new capabilities and add it to connector/provider contract tests.
- **DEPENDENCIES:** Future capability registration and verifier tests.

### 26. Future Capability Lab / self-extension

- **CURRENT IMPLEMENTATION:** No Capability Lab, sandbox proposal flow, canary, or signed production registration lifecycle was found.
- **STATUS:** `MISSING`
- **EVIDENCE:** No Capability Lab route, schema, or lifecycle under `artifacts/api-server/src`; current registry is static code/config.
- **GAP:** The model cannot safely propose, test, security-review, generalize, approve, and canary a new capability.
- **REQUIRED WORK:** Define Capability Proposal → Sandbox → Tests → Security → Generalization → Approval → Canary → Signed Registration.
- **DEPENDENCIES:** Capability manifest, sandbox isolation, security scanning, verifier, governance/approval model.

### 27. Measure success by unknown-goal handling

- **CURRENT IMPLEMENTATION:** Existing proof avoids domain handlers and validates one unfamiliar deterministic fixture. Generalization Success Rate is explicitly not measured.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `scripts/src/jasim-world-runtime-proof.ts`, `docs/JASIM_GENERALIZATION_TEST_REPORT.md`
- **GAP:** One fixture is Runtime proof, not broad model generalization.
- **REQUIRED WORK:** Execute and retain evidence for 30+ unknown Arabic/English scenarios with no domain-specific branching and calculate GSR.
- **DEPENDENCIES:** Real Model Provider, corpus governance, verifier, artifact/receipt retention.

### 28. Required Vision Gap Analysis

- **CURRENT IMPLEMENTATION:** This document provides the requested `VISION ITEM / CURRENT IMPLEMENTATION / STATUS / EVIDENCE / GAP / REQUIRED WORK / DEPENDENCIES` comparison.
- **STATUS:** `COMPLETE`
- **EVIDENCE:** `docs/JASIM_FINAL_VISION_GAP_ANALYSIS.md`
- **GAP:** The report itself must be kept current when the architecture changes.
- **REQUIRED WORK:** Treat this report as a gate artifact, not as proof that the gaps are already closed.
- **DEPENDENCIES:** Future architecture decisions and acceptance evidence.

### 29. Reconcile all prior JASIM documentation

- **CURRENT IMPLEMENTATION:** Current Architecture Truth, General Runtime, and Generalization reports agree that the runtime is partial and not yet a complete universal commercial runtime.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `docs/JASIM_ARCHITECTURE_TRUTH.md`, `docs/JASIM_GENERAL_RUNTIME_REPORT.md`, `docs/JASIM_GENERALIZATION_TEST_REPORT.md`
- **GAP:** There is no formal documentation index with conflict-resolution ownership across every historical reference document.
- **REQUIRED WORK:** Create a short documentation index and mark the Vision Lock as the highest-level product/architecture authority. Retire contradictory claims rather than silently carrying them forward.
- **DEPENDENCIES:** Product owner approval of the final terminology and scope.

### 30. No feature implementation during the Vision Gate

- **CURRENT IMPLEMENTATION:** This step is inspection, tracing, comparison, and documentation only. No Runtime/Web/Mobile feature was added for the Vision Lock.
- **STATUS:** `COMPLETE`
- **EVIDENCE:** This document and the existing source inspection; no feature patch is part of this Vision Gate step.
- **GAP:** The project still contains earlier implementation work, so future agents must not interpret this report as permission to begin “Finish JASIM.”
- **REQUIRED WORK:** Keep implementation work behind the gate and require an approved ordered roadmap.
- **DEPENDENCIES:** Product owner approval after reviewing this report.

### 31. Clarity for a new team

- **CURRENT IMPLEMENTATION:** Existing reports explain the current Task/World runtime and its limitations. This report adds the final product-level comparison.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** This document plus the three existing JASIM reports.
- **GAP:** A new team still needs explicit contracts for output kinds, Conversation/Message, Bubble, World membership, capability/provider, verifier, and long-running runs. Without them, engineers may incorrectly expand Task screens or add domain handlers.
- **REQUIRED WORK:** Freeze those contracts in a concise Runtime Product Contract before feature implementation.
- **DEPENDENCIES:** Decisions in the Final Vision Gate section below.

### 32. Bubble-first Final Vision Gate

- **CURRENT IMPLEMENTATION:** The project has a Task/World foundation, but the Bubble-first relationship among Conversation, Smart Bubble, optional World Runtime, Tasks/Runs, and the shared renderer has not been represented by a frozen Runtime contract.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** This corrected gap analysis; `docs/JASIM_SMART_BUBBLE_ARCHITECTURE.md`; the existing Task/World runtime reports.
- **GAP:** The original report incorrectly elevated World to a product-first surface. The correction resolves that conceptual error, but the contract is not yet precise enough for implementation.
- **REQUIRED WORK:** Treat `docs/JASIM_SMART_BUBBLE_ARCHITECTURE.md` as the mandatory architecture reference, then freeze its explicit unresolved contracts before creating Runtime or UI features.
- **DEPENDENCIES:** Product-owner approval of the remaining contract decisions only; feature completeness is not a condition of this Vision Gate.

### 33. Output Router

- **CURRENT IMPLEMENTATION:** Every model-composed goal is persisted as Task DNA, Plan, and World data.
- **STATUS:** `WRONG_DIRECTION`
- **EVIDENCE:** `composeTaskWorld` and `createRuntimeTask` in `artifacts/api-server/src/lib/jasim-runtime.ts`
- **GAP:** The Runtime has no validated decision between `TEXT`, `STRUCTURED_RESPONSE`, `EPHEMERAL_BUBBLE`, `INTERACTIVE_BUBBLE`, `ACTION`, `WORKFLOW`, `TASK`, and `PERSISTENT_SMART_BUBBLE`.
- **REQUIRED WORK:** Freeze an Output Envelope with output kind, confidence/clarification behavior, ownership, presentation intent, risk class, references, and durable attachment rules. A World is created only when a persistent Smart Bubble requires durable life.
- **DEPENDENCIES:** Conversation/Message contract, SmartBubble contract, policy/risk taxonomy.

### 34. Smart Bubble Aggregate and Bubble↔World Binding

- **CURRENT IMPLEMENTATION:** Task cards and standalone World records exist; there is no Bubble identifier or binding.
- **STATUS:** `MISSING`
- **EVIDENCE:** `lib/db/src/schema/jasim-runtime.ts`, `lib/db/src/schema/jasim-worlds.ts`
- **GAP:** There is no first-class durable user-facing embodiment for an interactive or persistent runtime.
- **REQUIRED WORK:** Define a SmartBubble aggregate with identity, owner, conversation, mode, lifecycle, title, semantic description, active view, presentation state, permissions, references, and optional `runtimeWorldId`. Initially one Bubble may bind to zero or one primary World Runtime, without blocking future composition.
- **DEPENDENCIES:** Conversation ownership, visibility/role model, migration strategy for existing Task/World records.

### 35. Bubble Reference Resolution

- **CURRENT IMPLEMENTATION:** There is no server-owned conversation history or Bubble identity to resolve.
- **STATUS:** `MISSING`
- **EVIDENCE:** Current API exposes Task and World IDs only; mobile history is local.
- **GAP:** Jasim cannot safely resolve expressions such as “my store,” “the platform we built,” or “the Bubble with the iPhone” to a Bubble and then to an entity, workflow, policy, or view.
- **REQUIRED WORK:** Define candidate retrieval from conversation history, explicit references, recent activity, semantic descriptions, entity mentions, ownership, recent mutations, and temporal context. Resolve automatically only when unambiguous; otherwise ask a natural-language clarification.
- **DEPENDENCIES:** Conversation memory, Bubble metadata/indexing, ownership and permission checks.

### 36. Conversational Bubble Control and Mutation

- **CURRENT IMPLEMENTATION:** Direct World ChangeSets can mutate limited structural data by ID and base version.
- **STATUS:** `PARTIAL`
- **EVIDENCE:** `evolveRuntimeWorld` and `RuntimeWorldChangeSet`
- **GAP:** There is no natural-language path that targets a Bubble, resolves an internal target, classifies the intended mutation, and applies it safely.
- **REQUIRED WORK:** Freeze the mutation pipeline and neutral classes: `DATA_MUTATION`, `STRUCTURAL_MUTATION`, `POLICY_MUTATION`, `WORKFLOW_MUTATION`, `VIEW_MUTATION`, `PERMISSION_MUTATION`, and `COMMERCIAL_MUTATION`. A failed or blocked capability must not corrupt the Bubble or World state.
- **DEPENDENCIES:** Reference Resolution, policy/approval, capabilities, verifier, version/event model.

### 37. Bubble-first Renderer and Evolution

- **CURRENT IMPLEMENTATION:** Web/Mobile render fixed Task projections; World detail is raw or task-oriented.
- **STATUS:** `MISSING`
- **EVIDENCE:** `artifacts/jasim/src/App.tsx`, `artifacts/jasim-mobile/app/task/[id].tsx`
- **GAP:** The system has neither a generic Bubble projection nor an explicit distinction between product-facing Bubble Evolution and internal World migration/versioning.
- **REQUIRED WORK:** Render compact, expanded, full-screen, public-facing, owner-facing, and member-facing Bubble projections from identity, optional World schema, Runtime state, active view, role, permissions, capabilities, workflows, and context. Present understandable change previews; keep database migrations internal.
- **DEPENDENCIES:** SmartBubble contract, projection schema, authorization decision, version/conflict contract.

### 38. Cross-Bubble Architecture

- **CURRENT IMPLEMENTATION:** No Bubble references, subscriptions, controlled sharing, or composition primitives exist.
- **STATUS:** `MISSING`
- **EVIDENCE:** No Bubble aggregate or cross-aggregate workflow contract exists.
- **GAP:** The architecture does not yet reserve a safe place for future requests that read, link, compose, or coordinate multiple Bubbles.
- **REQUIRED WORK:** Define Bubble references, controlled data-sharing grants, event subscriptions, cross-Bubble workflow boundaries, and composition projections. Every cross-Bubble interaction must be authorized, auditable, and constrained by policy.
- **DEPENDENCIES:** Bubble identity, memberships/permissions, event model, workflow/run contract.

## Remaining architecture ambiguities before implementation

This is deliberately an ambiguity list, not a list of unimplemented features.

| Contract boundary | Decision still required |
| --- | --- |
| Conversation ↔ Message ↔ Bubble | Exact ownership, retention, ordering, and event semantics for messages that create, mutate, or merely reference a Bubble. |
| Output Envelope | Exact versioned schema, confidence threshold, clarification state, and which Runtime rule—not the model—authorizes durable creation. |
| SmartBubble lifecycle | Enumerated modes/statuses, archival/deletion semantics, public identity, and compatibility path for existing Tasks and Worlds. |
| Bubble ↔ World binding | Exact initial cardinality, detach/archive behavior, and how future composed Bubbles reference multiple Worlds without changing the single-Bubble primary experience. |
| Reference Resolution | Candidate scoring boundaries, permission filtering order, and the deterministic threshold for asking a clarifying question. |
| Authorization | One enforceable decision object covering Bubble visibility, membership, World access, target entity access, capabilities, risk, approval, and projection. |
| Execution truth | Verifier evidence, provider receipt, retry/recovery, and state-transition rules for external effects and long-running Runs. |
| Cross-Bubble consistency | Grant model, event delivery semantics, failure isolation, and transaction/compensation boundaries. |
| Commercial and extension boundaries | Provider-neutral transaction reconciliation, legal/compliance policy points, and Capability Lab governance/signing. |

## Recommended implementation order after architecture approval

This is an ordering recommendation, not authorization to implement now.

1. **Freeze Bubble-first contracts:** Conversation/Message, Output Envelope, SmartBubble, Bubble↔World, Reference Resolution, authorization, Run/Schedule, Capability, Receipt/Verifier, and cross-Bubble grants.
2. **Build the durable conversation and Bubble foundation:** messages, scoped memory, Output Router, Bubble Manager, and Bubble/World/Task relations.
3. **Build the client projection contract:** Main Chat, Smart Bubble Renderer, expanded Bubble surfaces, and shared Web/Mobile semantics.
4. **Build safe execution:** DAG scheduling, provider boundary, receipts, independent verification, recovery, and resume.
5. **Add multi-user and long-running work:** visibility/memberships, notifications, schedules, monitors, and event triggers.
6. **Add commercial primitives and cross-Bubble composition:** only after authorization, provider reconciliation, and verifier proof.
7. **Add Capability Lab:** sandboxed proposal/testing/security/generalization/canary/registration lifecycle outside the live Bubble Runtime.
8. **Run the Bubble-first 30+ scenario gate:** verify output choice, unnecessary-World avoidance, reference resolution, conversational mutation, persistence, renderer generality, blocked actions, and recovery.

## Final answer to the corrected Vision Lock question

> If a new team receives only this project and the Bubble-first architecture documents, will it know precisely what JASIM is and what it must not become?

**Answer today: Almost, but not yet precisely enough to implement safely.**

The correction resolves the previous product-level contradiction: a World Runtime is durable internal life; a Smart Bubble is its user-facing embodiment; Tasks are temporary work; Conversation is where the user speaks with Jasim. The remaining issue is no longer a feature checklist. It is the set of concrete contract choices listed above, especially exact aggregate lifecycle, Output Envelope authority, authorization, reference-resolution ambiguity handling, verifier evidence, and cross-Bubble consistency.

## Gate decision

```text
FINAL VISION GATE: NOT PASSED
IMPLEMENTATION AUTHORIZATION: NOT GRANTED
REASON: Bubble-first semantics are corrected, but the remaining architecture contracts are not yet frozen.
NEXT VALID ACTION: approve the explicit contract decisions in the ambiguity table; do not start features yet.
```