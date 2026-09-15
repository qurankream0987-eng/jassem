# JASIM Smart Bubble Architecture

**Status:** Mandatory architecture reference — implementation is not authorized by this document alone.  
**Authority:** This document applies the Bubble-first correction and supersedes any product framing that treats World as an independent primary application surface.

## The canonical rule

> The conversation is where the user speaks with Jasim.
>
> Smart Generative Bubbles are the living things Jasim creates and operates with the user.
>
> The World Runtime is the durable internal life of a persistent Bubble.
>
> Tasks are temporary units of work performed on behalf of the user or a Bubble.
>
> Jasim Intelligence understands natural language, resolves the correct Bubble and target, plans changes, and operates them only through trusted Runtime capabilities.
>
> A Bubble can grow from a simple generated surface into a persistent commercial world without becoming a hard-coded domain application.

## Product semantics

JASIM has one primary interaction model: a user speaks in the Main Conversation. Jasim may reply directly, place one or more Bubbles into the conversation, execute an allowed action, begin a workflow, or create a persistent Smart Bubble when the request requires durable state and life.

A Smart Bubble is not a preview card or a link to a separate product. It is the intelligent surface that Jasim and the user can inspect, mutate, expand, share, operate, and evolve. An expanded or full-screen Bubble remains an expanded Bubble surface, not a World-first administration application.

The Runtime remains domain-neutral. A “store,” “portfolio,” “rental space,” “service marketplace,” or “inventory” is an emergent Bubble projection backed by schemas and capabilities, not a built-in domain handler or fixed application template.

For any supplied visual HTML reference, apply the mandatory
[HTML Reference Boundary](JASIM_HTML_REFERENCE_BOUNDARY.md): match the visual
and interaction language, but keep all intelligence, state, permissions,
execution, and outcomes in the JASIM Runtime.

## Canonical flow

```text
User
  ↓
JASIM Main Conversation
  ↓
Conversation Runtime
  ↓
Context + Memory + Bubble Reference Resolution
  ↓
Jasim Intelligence / Model Gateway
  ↓
Intent and Understanding
  ↓
Output Router
  ↓
Text | structured response | ephemeral Bubble | interactive Bubble
Action | workflow | Task | persistent Smart Bubble
  ↓
Smart Bubble Manager
  ↓
Optional durable World Runtime
  ↓
Execution DAG → Capability Registry / Resolver → Policy / Approval
  ↓
Execution → Verifier → Events and durable state
  ↓
Smart Bubble Projection
  ↓
Web and Mobile
```

The model may propose meaning, classification, plans, and projection intent. It never directly creates durable state, invokes capabilities, grants access, or declares an external action successful. The Runtime validates and records all of those outcomes.

## Primary aggregates and relationships

```text
Conversation
├── Message[]
├── SmartBubble[]
├── Task[]
└── Run[]

SmartBubble
├── Task[]                       temporary work performed on/for the Bubble
├── optional primary WorldRuntime
└── Projection[]                 compact, expanded, full-screen, public, role-aware

WorldRuntime
├── entities / relationships / workflows / policies / views
├── versions / events / state
└── durable life backing one SmartBubble initially
```

### Conversation

Conversation is the durable place where the user speaks to Jasim. It owns ordered Messages and references Bubbles, Tasks, and Runs created or discussed in that context. Conversation is not modeled primarily as a collection of Worlds.

### SmartBubble

SmartBubble is the first-class user-facing aggregate. Its conceptual contract includes:

```text
bubbleId
ownerId
conversationId

mode
status

title
semanticDescription

runtimeWorldId?                 optional durable backing life

activeView
presentationState

permissions
references

createdAt
updatedAt
```

The final API/database fields, lifecycle states, and schema versions must be frozen before implementation. The initial binding is `SmartBubble 1 → 0..1 primary WorldRuntime`; future composition must remain possible without turning the product into a collection of separate applications.

### World Runtime

World Runtime is independent of a Task because a Task can finish while durable state continues. It is not independent of the user experience: when a World exists for a Bubble, it is the Bubble’s durable internal life. World versions, ChangeSets, migrations, and rollbacks remain internal implementation concepts; users receive understandable Bubble/Jasim change previews.

### Task and Run

Task is a temporary unit of work. A task can create a Bubble, mutate a Bubble, act on behalf of a Bubble, or be conversational-only. Run is the durable execution instance for work that may wait, schedule, monitor, retry, resume, or react to an event.

## Output Router

No rule may assume `every goal → Task + World`. After understanding the request, Jasim proposes an output intent; the Runtime validates it through a versioned Output Envelope.

Permitted conceptual outcomes are:

```text
TEXT
STRUCTURED_RESPONSE
EPHEMERAL_BUBBLE
INTERACTIVE_BUBBLE
ACTION
WORKFLOW
TASK
PERSISTENT_SMART_BUBBLE
```

An ephemeral or interactive Bubble may have no World Runtime. A persistent Smart Bubble binds a World only when it needs durable entities, workflows, state, permissions, events, long-running behavior, or commercial life.

The Output Envelope must later define its exact schema, confidence/clarification state, references, risk class, presentation intent, and durable-creation authorization. The model can recommend an output; Runtime rules make the final durable decision.

## Bubble Runtime Context and reference resolution

Jasim uses central intelligence; Bubbles do not receive isolated autonomous brains. Every Bubble-targeted request is interpreted with:

```text
Central Jasim Intelligence
+ Conversation context
+ Bubble-scoped Runtime Context
```

Bubble Runtime Context is bounded and relevant. It can include Bubble identity and purpose, current state, schemas, relevant entities, workflows, policies, available actions, summarized history, permissions, and current version. It must not dump the entire database into the model context.

Reference Resolution lets Jasim understand phrases such as “my store,” “the platform we built,” “the Bubble with the iPhone,” or “my design service.” Candidate retrieval uses conversation history, explicit references, recent active Bubbles, semantic descriptions, entity mentions, ownership, recent mutations, and temporal references. Permission filtering occurs before a candidate can be presented or used.

If the reference is unambiguous, the Runtime resolves it without exposing an ID. If two or more permitted candidates remain materially plausible, Jasim asks a natural-language clarification rather than guessing.

## Conversational Bubble control and evolution

Requests from Main Conversation, an expanded Bubble, or future Bubble-native input all pass through the same intelligence, Runtime, policy, capability, and verifier boundaries.

```text
Natural-language request
  ↓
Resolve Bubble
  ↓
Resolve target inside Bubble
  ↓
Classify mutation
  ↓
Plan
  ↓
Permission / Policy
  ↓
Approval when required
  ↓
Capability execution
  ↓
Verification
  ↓
Version and state update
  ↓
Bubble re-render
```

The neutral mutation taxonomy is:

```text
DATA_MUTATION
STRUCTURAL_MUTATION
POLICY_MUTATION
WORKFLOW_MUTATION
VIEW_MUTATION
PERMISSION_MUTATION
COMMERCIAL_MUTATION
```

Bubble Evolution is the user-facing concept. Internally, a structural change may use WorldChangeSet, WorldVersion, validation, migration, checkpoint, verification, recovery, and rollback. The user sees the intended result in plain language, for example: “I will add a 1–5 rating, an optional comment, and a follow-up review request after service completion.”

## Smart Bubble Renderer

The renderer is schema-driven and domain-agnostic:

```text
Bubble UI = projection(
  bubble identity,
  world schema if present,
  runtime state,
  active view,
  role,
  permissions,
  available capabilities,
  workflows,
  context
)
```

It must support compact, expanded, full-screen, public-facing, owner-facing, and member-facing views from the same Runtime contract. A renderer never chooses capabilities or enforces security client-side; it only projects server-authorized actions and sends commands back through Runtime endpoints.

Soap Glass and Generative Pop Bubbles remain the visual language, but visual style is not a source of Runtime truth.

## Access, visibility, and cross-Bubble behavior

Smart Bubbles can later be private, shared, invite-only, public, or commercial. Roles can include owner, member, customer, provider, moderator, and custom roles. Every read, projection, mutation, capability invocation, transaction, and data-sharing operation requires a server authorization decision over identity, visibility, membership, role, permission, policy, risk, and approval.

The architecture must support future Bubble references, controlled data-sharing grants, event subscriptions, cross-Bubble workflows, and composed projections. It must not permit silent or implicit sharing. A failed, blocked, or unauthorized action affects only its own explicitly defined state and must not corrupt either Bubble.

## Long-running work, transactions, and extension

A persistent Bubble may stay alive while it has schedules, monitors, pending approvals, external events, automations, or long-running Runs. That life must not depend on a user keeping an app or Bubble open.

Transactions and monetization occur inside or across Bubbles through provider-neutral capabilities. Commission, subscription, success fee, transaction fee, CPC, CPA, listing fee, featured placement, and hybrid policies are generic commercial policies—not domain features. They require receipts, reconciliation, verification, authorization, idempotency, and compliance decisions.

Capability Lab is separate from the live Bubble Runtime. New capability proposals must move through sandboxing, tests, security review, generalization review, approval, canary, and signed registration before production use.

## Acceptance behavior

The architecture is accepted only when later implementation can demonstrate that Jasim:

1. Selects the correct output shape instead of creating a World for every request.
2. Creates a persistent Smart Bubble and World Runtime only when durable life is required.
3. Resolves Bubble references conversationally and asks when genuine ambiguity remains.
4. Mutates the same Bubble repeatedly through Main Conversation without hard-coded domain flows.
5. Keeps rendering domain-agnostic across Web and Mobile.
6. Preserves the blocked invariant when a needed capability is unavailable.
7. Handles persistence, versioning, authorization, verification, recovery, and long-running work without false success.

## Architecture decisions still to freeze

This document locks the semantic model. The following implementation-grade contracts remain open and keep the Vision Gate closed:

1. Versioned schemas and lifecycle state machines for Conversation, Message, SmartBubble, Output Envelope, Task, Run, and Bubble↔World binding.
2. Deterministic rules for durable creation, reference-resolution scoring, clarification, visibility, and lifecycle migration.
3. A single authorization decision contract across Bubble, World, target entity, capability, policy, risk, approval, and projection.
4. Provider receipt, verifier evidence, recovery, retry, compensation, and external-effect reconciliation rules.
5. Cross-Bubble grant, subscription, consistency, failure-isolation, and composition contracts.
6. Provider-neutral transaction/commercial contracts and Capability Lab governance.

Until these are frozen and approved, no broad implementation program is authorized.