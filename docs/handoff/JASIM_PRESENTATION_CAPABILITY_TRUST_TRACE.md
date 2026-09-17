# JASIM — PRESENTATION / CAPABILITY / TRUSTED ACTION DEEP TRACE

**Type:** read-only architecture validation
**Method:** source tracing from the registered router outward. No documentation was
accepted as evidence; every claim below cites a file and, where it matters, a line.
**Product source changed:** NO · **Database changed:** NO · **Production touched:** NO

Files read completely: `api/runtime/presentation-fabric.ts` (1,006), `api/runtime/economic-fabric.ts`
(892), `api/runtime/capability-provider.ts` (807), `api/runtime/trusted-action-dispatcher.ts` (618).
Supporting traces: `api/runtime/jasim-runtime.ts`, `api/runtime/semantic-fabric.ts`,
`api/runtime/active-workspace-projection.ts`, `api/runtime/living-object-projection.ts`,
`api/routers/{runtime,fabric,block2}.ts`, `api/router.ts`, `api/boot.ts`,
`api/runtime/block2/worker.ts`, `lib/jasim-runtime-contract/src/index.ts`.

---

## 1. ACTUAL CALL GRAPH

This is the traced path, not the conceptual one. Where they differ, the difference is called out.

```
Web (src/) / Mobile (Expo)
        │  tRPC
        ▼
api/router.ts            ← registers EXACTLY three routers: runtime, fabric, block2
        │
        ├── runtime.*  (api/routers/runtime.ts, 942 lines)  ── the only consequential surface
        │       │
        │       ├── conversationTurn
        │       │      └── routeRuntimeConversationTurn()            jasim-runtime.ts:5496
        │       │            ├── modelGateway.generate()             model-gateway.ts
        │       │            ├── parseStrictOutputEnvelope()         strict Zod, 8 kinds
        │       │            ├── resolveRuntimeReferences()          jasim-runtime.ts:4359
        │       │            ├── presentationForConversationEnvelope jasim-runtime.ts:5184
        │       │            │     └── routePresentation()  ─────────┐
        │       │            ├── createExecutionProposal()           │
        │       │            └── persist message + optional bubble/run
        │       │                                                    │
        │       ├── dispatchAction                                   │
        │       │      └── dispatchCanonicalTrustedAction(ownerIdOf(ctx), input)
        │       │            └── dispatchTrustedAction()             trusted-action-dispatcher.ts:243
        │       │                  ├── envelope Zod parse            │
        │       │                  ├── forbidden-key scan (recursive)│
        │       │                  ├── per-type strict payload schema│
        │       │                  ├── local-vs-canonical split      │
        │       │                  ├── route registry lookup         │
        │       │                  ├── reference-kind allowlist      │
        │       │                  ├── resolveReference(ownerId, …)  ← owner scope
        │       │                  ├── presentation-version staleness│
        │       │                  └── route → canonical runtime fn  │
        │       │                        ├── actOnRuntimeTask        │
        │       │                        ├── decideExecutionProposalApproval
        │       │                        ├── executeApprovedRun      │
        │       │                        ├── resumeApprovedPlan      │
        │       │                        ├── reconcileRunToConversation
        │       │                        ├── updateRuntimeBubblePresentation
        │       │                        └── attachRuntimeArtifactToBubble
        │       │                                                    │
        │       ├── workspaceProjection ── getActiveWorkspaceProjection()  (read-only)
        │       └── activeLivingObjects ── getLivingObjectsProjection()    (read-only)
        │                                                            │
        ├── fabric.*   (api/routers/fabric.ts, 376 lines)            │
        │       ├── composeGoal   → composeRequirementGraph()   semantic-fabric.ts
        │       ├── present       → routePresentation() ────────────┤  PURE, no persistence
        │       ├── expression*/match*/engagement*/proposal*  → economic-fabric.ts
        │       └── externalActionSession*  → external-action-session.ts
        │                                                            │
        └── block2.*   (api/routers/block2.ts, 396 lines)            │
                └── coordination primitives (membership, temporal,   │
                    availability, reservation, observation, assignment,
                    remote execution, notification intent)           │
                                                                     ▼
                                                     presentation-fabric.ts
                                                       decidePresentation()  ← ONE selector
                                                              │
                                                     PresentationDefinition
                                                              │
                                    ┌─────────────────────────┴──────────────────────┐
                                    ▼                                                ▼
                        Web SchemaRenderer                             Mobile native renderer
                        (static allowlist)                             (static allowlist)
```

**Execution and durability, traced separately:**

```
executeApprovedRun / executeRuntimeDagNode      jasim-runtime.ts
        ├── capability registry gate            capability-registry.ts
        ├── provider resolution                 capability-provider.ts  resolveProvider()
        ├── execution_attempts (append-only)
        ├── action_receipts
        ├── execution-verifier.ts               independent verification
        └── reconcileUncertainAttempt()         never a blind retry

api/boot.ts  ── starts the Block 2 worker, injecting resumeNode:
        getBlock2Worker({ resumeNode: resumeScheduledRuntimeRun })
                └── api/runtime/block2/worker.ts
                        └── DurableJobWorker over the EXISTING runtimeJobs queue
                            (api/core/durable-job-*). "No new scheduler, no new runtime."
```

---

## 2. PART A — PRESENTATION DECISION LAYER

### 2.1 What reaches the layer

One validated struct: `SemanticPresentationInput` (`presentation-fabric.ts:188-249`, Zod at :342).
It is **domain-free by construction** — there is no field anywhere in it that names a domain.
Its fields are:

| Group | Fields |
|---|---|
| Need | `interactionNeed` — one of 12: `inform`, `collect_input`, `compare`, `show_state`, `show_history`, `track`, `authorize`, `external_transition`, `operate_persistent`, `preview_artifact`, `show_schedule`, `show_result` |
| Payload | `data`, `missingFields`, `candidates`, `events` |
| Reality | `observation { status, locationDescription, coordinates{lat,lng}, observedAt, source }` |
| Authority | `approvalSummary`, `actionRisk`, `actionability` |
| Semantics | `semanticOutput` (11 values), `resultCount`, `resultSetPresent`, `referencedEntityCount`, `selectedEntityCount`, `requiresStructuredInput` |
| Lifecycle | `ongoing`, `transactionState`, `hasFinancialEffect`, `persistent`, `documentSummary`, `worldReference` |
| External | `externalAction { provider, purpose, sessionId }` |

### 2.2 Which fields actually decide the primitive

`decidePresentation()` (`presentation-fabric.ts:757`) is a single ordered cascade. The
**precedence is the design**: safety and authority outrank richness, so a prettier surface can
never hide a blocker or an approval.

```
 1. semanticOutput === "error" || transactionState === "failed"      → ERROR_STATE
 2. approvalRequired                                                 → CHECKOUT (financial) | APPROVAL
      approvalRequired = interactionNeed==="authorize"
                       || transactionState==="awaiting_approval"
                       || actionability==="consequential"
                       || actionRisk high|critical
                       || approvalSummary present
 3. inputRequired                                                    → FORM
 4. ongoing:
        interactionNeed==="show_history"                             → TIMELINE
        interactionNeed==="track"                                    → TRACKER
                                                 + child MAP  ⟵ ONLY IF hasLocation
        otherwise                                                    → STATUS
 5. compare | semanticOutput==="comparison"                          → COMPARISON
 6. hasResultSet | semanticOutput==="candidates"                     → resultCount>=6 ? ENTITY_GRID : SEARCH_RESULTS
 7. document                                                         → DOCUMENT
 8. world                                                            → WORLD_SUMMARY
 9. external_transition                                              → EXTERNAL_ACTION
10. preview_artifact                                                 → ARTIFACT_PREVIEW
11. operate_persistent                                               → SMART_BUBBLE
12. show_schedule                                                    → CALENDAR
13. empty                                                            → EMPTY_STATE
14. structured                                                       → DETAIL
15. fallback                                                         → TEXT
```

`hasLocation` is the single gate on MAP (`presentation-fabric.ts:768-770`):

```ts
const hasLocation =
  parsedInput.observation?.coordinates !== undefined &&
  Number.isFinite(parsedInput.observation.coordinates.lat) &&
  Number.isFinite(parsedInput.observation.coordinates.lng);
```

**A map is impossible without finite coordinates in a trusted observation.** The truthfulness rule
is not a convention here; it is a branch condition.

### 2.3 Who calls `presentationForConversationEnvelope`

Exactly one caller: `routeRuntimeConversationTurn()` in `jasim-runtime.ts`. It maps the eight
Output Router kinds onto **four** interaction needs (`jasim-runtime.ts:5184-5232`):

| Envelope kind | interactionNeed passed | Observation passed |
|---|---|---|
| `text` | `inform` | no |
| `structured_result` | `inform` / `show_result` / `compare` (via `projectStructuredResult`) | no |
| `ephemeral_bubble` | `show_result` | no |
| `interactive_bubble`, `persistent_smart_bubble` | `operate_persistent` | no |
| `direct_action`, `workflow`, `durable_run` | `authorize` | no |

The other callers of the layer are `projectStructuredResult` (same file) and `fabric.present`.

### 2.4 Deterministic, model-generated, hybrid or rule-driven?

**Rule-driven and fully deterministic.** `decidePresentation` is a pure function of its input: no
IO, no randomness, no model call, no persistence. The model's only influence is indirect — it
proposes an Output Envelope *kind*, and the runtime maps that kind to an interaction need. The
model never names a primitive, and a model that tried to would be discarded, because
`ConversationOutputEnvelopeSchema` has no field for one.

### 2.5 Validation, and where invalid presentations are rejected

Every return path in `decidePresentation` is wrapped in `validatePresentationDefinition()`
(`:712`), which is `PresentationDefinitionSchema.parse(...)`. The schema is recursive
(`z.lazy`, `:428`) and closed:

- `primitive` ∈ 40-value enum — an unknown primitive throws.
- `version` is `z.literal(1)`.
- `actions[].intent` ∈ 13-value enum, `.strict()` — an unknown intent throws.
- `fields[]` `.strict()` — unknown keys throw.

So the layer cannot emit an invalid definition even if its own inputs are odd: it validates its own
output before returning it. Rejection happens **server-side, before the wire**.

### 2.6 Does the LLM directly choose privileged UI?

**No**, on three independent grounds:

1. The envelope schema has no presentation field, so the model has nothing to say about it.
2. The mapping from kind → interaction need is a `switch` in server code.
3. The precedence cascade means the safety branches (ERROR_STATE, APPROVAL/CHECKOUT) are
   evaluated *before* any richer primitive, and are driven by runtime-computed risk and
   transaction state, not by model text.

**One nuance worth recording, not a defect:** `fabric.present` (`api/routers/fabric.ts:118-126`)
accepts `z.record(z.string(), z.unknown())` from an authenticated client and runs it through
`routePresentation`. A client can therefore obtain a `MAP` definition built from coordinates it
made up. It gains nothing by doing so: the call performs **no database write** (verified — zero
`db.insert/update/delete` in `presentation-fabric.ts`), the result is never attached to a
conversation, never enters `ActiveWorkspaceProjection`, and its actions are inert intent
identifiers that still have to survive the trusted dispatcher. It is a pure calculator the client
drives with its own data — equivalent to the client drawing its own map locally. It is declared
`.mutation()` despite writing nothing.

### 2.7 Stale presentation protection

Two independent mechanisms, at different layers:

1. **Write side (authoritative).** `trusted-action-dispatcher.ts:302-328`. Eleven action types are
   listed in `requiredPresentationVersion`; for those, a missing `expectedPresentationVersion` is
   `INVALID_ACTION`, and a mismatch against `target.currentPresentationVersion` is `STALE` with
   "Refresh first." For all other types, a version is optional but still compared when supplied.
   **A stale action cannot mutate canonical state.**
2. **Read side (cosmetic).** `src/components/jasim-core/useWorkspacePresentationTransition.ts`
   classifies transitions from `PresentationIdentity`; a superseded projection is not rendered.
   This controls appearance only.

### 2.8 Where ENTER / UPDATE / MORPH / EXIT / NO_CHANGE are computed

In the **shared contract**, `lib/jasim-runtime-contract/src/index.ts`, as a pure function over
`PresentationIdentity { key, primitive }` plus a stable serialization of the data. It is invoked
**client-side** by `classifyWorkspacePresentationTransition` /
`useWorkspacePresentationTransition`.

This is correct and not a violation: a transition is a statement about *how the surface should
animate between two server-provided projections*, never about lifecycle truth. Both platforms
import the same function, which is what keeps Web and Mobile semantically identical. Client state
controls presentation only; it can never author a status, an attention or an action outcome.

### 2.9 What makes an active surface disappear

Canonical state changes, the next projection no longer carries that presentation identity, and the
shared classifier returns `EXIT`. There is no client-side "dismiss" that removes operational truth,
and no server call named "hide". Disappearing is a *consequence* of state, never a command.

### 2.10 Workspace and Presentation: canonical or projection?

**Both are projections.** Verified by absence: `active-workspace-projection.ts`,
`living-object-projection.ts` and `presentation-fabric.ts` contain **zero** `db.insert`,
`db.update` or `db.delete`. `ActiveWorkspaceProjection` is assembled per request from
conversation, task/run, result set, reference bindings, proposal and world rows. There is no
workspace table and no presentation table. `presentationVersion` is *derived* (e.g.
`living:${activeRun.updatedAt.toISOString()}`, `:357`), not stored.

### 2.11 How ResultSet references survive a presentation change

They do not live in the presentation at all — which is exactly why they survive. Identity is held
in `discovery_result_sets`, `discovery_candidates` (durable ordered position) and
`reference_bindings`. `ActiveWorkspaceProjection.resultSet` and `.selectedEntityReferences` are
re-read from those tables on every projection. A presentation may morph from `SEARCH_RESULTS` to
`COMPARISON` to `APPROVAL` and "الثاني" still resolves, because the ordinal was never a property of
the rendered list.

---

## 3. PART B — DRIVER MAP THOUGHT EXPERIMENT (no implementation)

### 3.1 The path each layer would take

```
"جاسم اعرض لي خريطة السائق."
   │
   ├─ runtime.conversationTurn                              EXISTS
   ├─ routeRuntimeConversationTurn → model → Output Envelope EXISTS
   ├─ resolveRuntimeReferences → the active delivery/driver  EXISTS (owner-scoped)
   ├─ trusted observation of the driver                      EXISTS as data:
   │     block2 `observations`, `track_sessions`;
   │     block31 `fulfillment_observations` ("no fake GPS" is in the schema comment)
   ├─ Presentation Decision with interactionNeed="track"
   │     + observation.coordinates                           LAYER EXISTS, PATH DOES NOT
   ├─ TRACKER + child MAP                                    EXISTS in decidePresentation
   ├─ ActiveWorkspaceProjection.currentPresentation          EXISTS
   └─ Web/Mobile renderer over the same definition           EXISTS (MAP/MARKER/ROUTE primitives)
```

Every primitive on that path exists. **One link is missing**, and it is a wiring gap, not a
modelling gap.

### 3.2 The precise gap

`presentationForConversationEnvelope` produces only four of the twelve interaction needs —
`inform`, `show_result`, `operate_persistent`, `authorize` — and **never passes an `observation`**.
A repository-wide search confirms no production caller emits `interactionNeed: "track"`: the only
`"track"` occurrences outside the decision layer are in `api/core/*` modules
(`intent-parser.ts`, `agent-router.ts`, `deterministic-intent.ts`, `response-synthesizer.ts`,
`operational-memory.ts`), and every one of those files has **zero live references** from the
registered routers.

Consequence, stated plainly: **`TRACKER` and `MAP` are unreachable in production today.** Not
forbidden, not absent — unreachable. Branch coverage of `decidePresentation` from real callers is
roughly 6 of 15 branches.

### 3.3 Driver claims delivery

The semantic distinction the question asks about is already enforced by the runtime, and is not a
presentation concern at all:

```
driver reports delivered
   → an observation / a receipt                  action_receipts, execution_attempts
   → NOT a completion
   → execution-verifier.ts decides independently
   → policy decides what proof is sufficient (customer confirmation, artifact, trusted event)
   → only then canonical state becomes completed
```

`DRIVER_CLAIMS_DELIVERED ≠ VERIFIED_COMPLETED` is structural here: a claim lands in the receipt
table, and completion is written by the verifier path. Nothing lets a claim write completion
directly. Note the existing `GapKind` already contains `REQUIRES_HUMAN` and
`INSUFFICIENT_INFORMATION`, which is the generic vocabulary for "a human still has to confirm".

### 3.4 MAP exit after verified completion

Once canonical state is completed, `ongoing` is false, `interactionNeed` is no longer `track`, the
next projection carries a different presentation identity, and the shared classifier returns
`EXIT`. Operational history is untouched — the delivery, its observations, its attempts and its
receipt all remain rows. **What ended is a projection, not a fact.** No delete is involved and none
is needed.

### 3.5 Verdict

```
CAN_CURRENT_ARCHITECTURE_EXPRESS_THIS = PARTIAL
```

- The **representation** is complete: observations, track sessions, tracker/map/marker/route
  primitives, the coordinate gate, the verifier boundary, the transition classifier.
- The **path** is incomplete: nothing converts a trusted observation into a `track` interaction
  need on the conversation path.

**Missing generic primitive — one, and it is generic:**

> **An observation-aware presentation input builder.** Something that, for the active goal, asks
> "does canonical state currently carry a trusted, fresh observation about the subject of this
> goal?" and, when it does, supplies `interactionNeed: "track"` plus `observation` to the existing
> decision layer.

It is domain-free by construction: it speaks only of a subject reference, an observation, and
freshness. The Block 2 observation model is already `(subjectKind, subjectId)` — it never mentions
deliveries. Nothing about this needs a `DriverMapPage`, a `DeliveryMapAgent`, or any domain type,
and none is proposed here.

A second, smaller gap: `SemanticPresentationInput.observation` has no freshness policy. A
three-hour-old coordinate and a three-second-old one produce the identical MAP. `observedAt` is
carried into the TRACKER child but nothing decides when a stale position should stop being shown
as a position. That is a generic truthfulness gap, not a domain one.

---

## 4. PART C — CAPABILITY / PROVIDER

### 4.1 Definitions as implemented

| Concept | Where | What it is |
|---|---|---|
| **Capability** | `capability-registry.ts` | A semantic ability with `id`, `version`, `risk`, `inputContract`, `sideEffects: "none" \| "local_test" \| "external"`, `testOnly`. Registered today: `local-analysis`, `local-calculation`, `notify`, `openai-chat`, `web-research`, `image-generation`, `research-context`. |
| **Provider** | `capability-provider.ts:70` | A trusted implementation that supplies a capability, carrying kind, trust class, availability, cost/latency class, privacy class, jurisdiction, freshness, I/O specs, provenance, optional endpoint, optional receipt secret, optional native handler. |
| **ProviderBinding** | `capability-provider.ts:115` | The *proof of a validated pairing*: `{capabilityId, providerId, implementationId, kind, validatedAt, validated:{semantic,inputContract,outputContract,trust,availability,protocol}}` — all six literal `true`. A binding cannot exist without all six checks having passed. |

**`ProviderKind` includes `HUMAN` and `COMPUTER_USE`** alongside `NATIVE`, `MCP`, `A2A`,
`AGENT_HARNESS`. The architecture's claim that a provider need not be software is implemented in
the type system, not merely asserted in documentation.

### 4.2 Registration

- **Native** providers are registered in code (`registerNativeProvider`, `:209`) into an in-memory
  `CapabilityProviderRegistry` (`:170`), which rejects duplicate ids.
- **External** candidates persist in the single `capability_provider_catalog` table and arrive
  through `registerCatalogSource` / `searchExternalCatalogs`, or through
  `normalizeMcpToolMetadata` / `normalizeAgentCardMetadata` which convert MCP tool metadata and
  A2A agent cards into the same `CapabilityProvider` shape.

### 4.3 Selection dimensions — implemented, in this order

`resolveProvider()` (`:385`) is a deterministic filter chain. Every filter that empties the set
returns a distinct, truthful status:

| # | Dimension | Fails to |
|---|---|---|
| 0 | capability has candidates at all | `NO_PROVIDER` |
| 1 | **trust** — `UNTRUSTED_CANDIDATE` requires explicit approval | `UNTRUSTED` |
| 2 | **freshness** — `isProviderStale` vs `freshness.expiresAt` | `STALE` |
| 3 | **availability** — only `AVAILABLE`/`DEGRADED` proceed | `BLOCKED` |
| 4 | **policy** — required privacy class, jurisdiction allowlist | `BLOCKED` |
| 5 | **protocol** — declared protocol must be in `supportedProtocols` **with a matching version** | `INCOMPATIBLE` |
| 6 | **contract** — `specCompatible` on declared I/O (`NATIVE` exempt, already bound by the composer) | `INCOMPATIBLE` |
| 7 | **cost / latency / health / verified successes / kind preference / id** | deterministic ordering |

All seven dimensions the question asked about are real. Two notes on strictness: a provider that
declares a protocol but whose version is absent from the supported list is rejected rather than
tried (`protocolVersion !== undefined && versions.includes(...)`), and stale metadata never
silently authorizes execution.

### 4.4 Cardinality

- **One capability, many providers:** yes — `registry.forCapability(capabilityId)` returns an array
  and the chain ranks it.
- **One provider, many capabilities:** **no, not in one record.** `CapabilityProvider.capabilityId`
  is a single optional field, so a provider offering three capabilities is three registry entries
  sharing an `implementationId`. Functionally sufficient; structurally it means "provider identity"
  and "capability binding" are fused in one row.

### 4.5 The two failure states, and why they are different

```
Capability exists, no provider           → resolveProvider → NO_PROVIDER
                                           surfaced as GapKind "BLOCKED_BY_PROVIDER"

The semantic capability itself is absent → semantic-fabric.ts:292
                                           GapKind "MISSING_GENERIC_CAPABILITY"
```

`GapKind` (`semantic-fabric.ts:85-94`) has nine values and is richer than the architecture
documents describe:

```
MISSING_GENERIC_CAPABILITY   BLOCKED_BY_PROVIDER      BLOCKED_BY_RESOURCE
REQUIRES_HUMAN               REQUIRES_OWNER_DECISION  REQUIRES_REGULATORY_REVIEW
INSUFFICIENT_INFORMATION     INSUFFICIENT_TRUST       BINDING_VALIDATION_FAILED
```

The distinction matters operationally: `BLOCKED_BY_PROVIDER` is fixed by configuration or by an
adapter at the integration edge; `MISSING_GENERIC_CAPABILITY` is the only one that legitimately
calls for new core work, and it is the honest output of a generality test.

### 4.6 MCP / A2A / remote as trusted authority?

**No.** Four defences, all in code:

1. They enter as `UNTRUSTED_CANDIDATE` and filter #1 removes them without an explicit approval.
2. `description` is annotated as data that is "never rendered into system instructions and never
   influences trust, selection, or policy".
3. `semanticKeys` must come from structured metadata or JASIM-side configuration, "NEVER parsed out
   of free-text descriptions or remote tool names".
4. `receiptSecret` is "provisioned only by trusted boot-time catalog binding" — discovery metadata
   cannot supply or replace it, so a remote cannot mint its own authenticated receipts.

Correspondingly, `DiscoverySourceKind` marks `MCP_PROVIDER` / `A2A_PROVIDER` results as
`untrusted_external_evidence`, never `canonical_internal`.

---

## 5. PART D — ECONOMIC FABRIC

`economic-fabric.ts` header states the model, and the code matches it: "Offering and Need share one
typed generic core (EconomicExpression) … acceptance creates a TransactionIntent — never a payment."

### 5.1 Representation status, honestly graded

| Concept | Status | Evidence |
|---|---|---|
| **Entity / Actor** | **Indirect** | `entities` table exists; the fabric references it only as `subjectEntityId` on an expression. There is no actor model inside this file. |
| **Resource** | **Architectural** | No `resources` table. A resource is an `entity` plus attributes; "resource" appears as `resourceRequirement` in the semantic fabric and as `BLOCKED_BY_RESOURCE` in `GapKind`. |
| **Offering / Need** | **Direct** | `economic_expressions.kind ∈ {offering, need}`, one typed core, with `visibility ∈ {private, unlisted, shared, public}` and `status ∈ {draft, active, paused, closed}`. |
| **Capacity** | **Direct, but elsewhere** | Block 2: `availability_windows`, `reservations`, `api/runtime/block2/capacity.ts`, `units.ts`. Not in the economic fabric. |
| **Constraint** | **Direct** | `hardConstraints` / `softPreferences` with operators `eq,neq,gte,lte,gt,lt,contains,within_time,compatible`, unit-normalized via `semantic-fabric.normalizeUnit`. |
| **Match** | **Direct** | `economic_matches`; `evaluateMatch` yields per-constraint `PASS / SOFT_MATCH / UNKNOWN / FAIL` — no opaque score. Composite matches supported when a Need permits splitting. |
| **Opportunity** | **Architectural** | No table and no type. It is a reading of a match, not a persisted thing. This is the weakest link for Level 7. |
| **Engagement** | **Direct** | `economic_engagements`. |
| **Proposal** | **Direct** | `economic_proposals`, versioned terms. |
| **TransactionIntent** | **Direct** | `transaction_intents`, written by `respondToProposal` on acceptance (`:856`). |
| **Economics / money** | **Direct, separate** | Block 3: `commercial_orders`, `payment_intents`, `economic_ledger_entries`, `fee_rules`, `payouts`, `mandate_budgets`. |

### 5.2 The four distinctions, verified

- **Entity ≠ Offering** — ✅ separate tables; an expression *points at* an entity via
  `subjectEntityId` and may omit it entirely.
- **Need ≠ Query** — ✅ a need is a durable typed row with constraints, availability and
  visibility. Query text lives on `discovery_result_sets`, a different table with a different
  lifetime. They are never the same object.
- **Proposal accepted ≠ Transaction executed** — ✅ `respondToProposal` inserts a
  `transaction_intents` row. It performs no payment call, touches no ledger, and has no path to
  either.
- **TransactionIntent ≠ PaymentIntent** — ✅ distinct tables with distinct lifecycles. The link is
  by reference only: `commercial_orders.transactionIntentId` and
  `payment_intents.transactionIntentId` are nullable foreign references. An intent can exist
  forever with no payment, which is the correct shape.

**Not inflated:** matching is deterministic structured filtering with explicit `UNKNOWN`
propagation — it is not semantic/embedding matching, and nothing here does "AI matching". No
opportunity discovery loop exists. No demand-side provider is configured.

---

## 6. PART E — TRUSTED ACTION DISPATCHER

### 6.1 One consequential action, end to end

```
Web/Mobile builds a TrustedActionEnvelope
   { actionId, actionType, targetReference{kind,id}, expectedPresentationVersion?, payload }
        ↓  tRPC runtime.dispatchAction  (authedQuery)
   dispatchCanonicalTrustedAction(ownerIdOf(ctx), input)      ← ownerId from SERVER CONTEXT
        ↓
   dispatchTrustedAction()
     1. TrustedActionEnvelopeSchema.safeParse            → INVALID_ACTION
     2. hasForbiddenPayloadKey (RECURSIVE)               → INVALID_ACTION
     3. per-type strict payload schema                   → INVALID_ACTION
     4. local action?                                    → LOCAL_ONLY, never dispatched
     5. not a canonical action?                          → INVALID_ACTION
     6. routeRegistry lookup                             → BLOCKED if null
     7. targetReference present + kind in allowlist      → INVALID_ACTION
     8. resolveReference(ownerId, reference)             → UNAUTHORIZED if null
     9. presentation-version check                       → STALE
    10. route → canonical runtime function
        ↓
   outcome ∈ OPENED | PROJECTION_REFRESH_REQUIRED | DISPATCH_ACCEPTED
             | APPROVAL_REQUIRED | INCONCLUSIVE | BLOCKED
```

Note the outcome vocabulary: **`DISPATCH_ACCEPTED` is not `SUCCESS`**, and `INCONCLUSIVE` is a
first-class result of a *dispatch*, not only of an external effect.

### 6.2 Static allowlists — three, not one

1. **Action types** — `routeRegistry` covers all 18 `TrustedActionType` values; five are `null`
   (pure local presentation: workspace/rail collapse-expand, local tab change) and are answered
   `LOCAL_ONLY` without ever reaching a route.
2. **Reference kinds per action** — `expectedReferenceKinds` binds each action to the kinds it may
   target. `SUBMIT_INPUT` may only target `runtime_task`; `APPROVE_PROPOSAL` only
   `execution_proposal`.
3. **Payload shape per action** — `actionPayloadSchemas`, every one `.strict()`. Most are
   `z.object({}).strict()` — an empty object, so *any* extra key is rejected.

### 6.3 The forbidden-key scan

`forbiddenPayloadKeys` (`:133-151`) is exactly the attack list, and `hasForbiddenPayloadKey`
recurses through nested objects **and arrays**, so burying a key three levels down does not help:

```
ownerId  userId  providerSecret  handler  handlerPath  serverHandler  sql
providerUrl  url  policyOverride  verification  verified  trustedReceiptStatus
providerReceiptTrusted  paymentStatus  paid  isPaid
```

### 6.4 Answers to the ten questions

| # | Question | Answer from code |
|---|---|---|
| 1 | Accepted input contract | `TrustedActionEnvelopeSchema` + per-type strict payload schema |
| 2 | Static allowlist behavior | three allowlists (type, reference kind, payload shape); unknown fails closed |
| 3 | Owner identity | `ownerIdOf(ctx)` — server session only; never read from payload |
| 4 | Reference validation | kind allowlist, then `resolveReference(ownerId, …)`; foreign target → `UNAUTHORIZED` |
| 5 | Version / stale checks | 11 types require `expectedPresentationVersion`; mismatch → `STALE` |
| 6 | Idempotency | **not at this layer.** `actionId` is an identifier, not an idempotency key. Idempotency exists downstream: task action receipts, run creation on `(ownerId, idempotencyKey)`, `payment_intents` replay. |
| 7 | Policy / approval | not decided here; the route delegates to `decideExecutionProposalApproval` / `executeApprovedRun`, and the dispatcher can return `APPROVAL_REQUIRED` |
| 8 | Route/handler injection | impossible: `routeRegistry` is a closed literal map; `handler`, `handlerPath`, `serverHandler`, `providerUrl`, `url` are forbidden keys; strict schemas reject unknown fields |
| 9 | Can the client set ownerId/providerUrl/handler/paid/verified/policyOverride? | **No** — every one of those six is in `forbiddenPayloadKeys`, checked recursively, before anything else runs |
| 10 | Web/Mobile parity | both build the same envelope through the shared contract (`lib/jasim-runtime-contract`) and hit the same single endpoint; no platform-specific trusted path exists |

```
CAN_CLIENT_BECOME_CANONICAL_AUTHORITY = NO
```

Proven by: `ownerIdOf(ctx)` at the router; the recursive forbidden-key scan; closed route registry;
strict per-type payloads; owner-scoped reference resolution; and presentation-version staleness.

**One honest caveat:** the dispatcher is a *gate*, not the authority itself. It returns
`DISPATCH_ACCEPTED`; the runtime, verifier and ledger decide what actually became true. That
separation is the point, not a weakness.

---

## 7. PART F — FABRIC / BLOCK 2 / RUNTIME RELATIONSHIP

**"Fabric" does not mean runtime.** Traced, the three fabrics are three different kinds of thing:

| Layer | Nature | Owns state? | Owns execution? | External effects? |
|---|---|---|---|---|
| **Semantic fabric** | pure functions (composition, unit normalization, gap classification) | no | no | no |
| **Presentation fabric** | pure functions + Zod schemas | no | no | no |
| **Economic fabric** | **stateful** — reads/writes expressions, matches, engagements, proposals, transaction intents | **yes** | no | no |
| **Capability/provider fabric** | registry + deterministic resolution; holds native handlers | in-memory registry + catalog table | **produces bindings**, does not execute | no |
| **Block 2** | coordination primitives + durable worker | **yes** (membership, temporal, availability, reservation, observation, assignment, remote execution, notification) | **drives** durable continuation via `resumeNode` | notification delivery only, and it is `BLOCKED_BY_PROVIDER` today |
| **Trusted action dispatcher** | pure gate | no | no | no |
| **Canonical runtime** (`jasim-runtime.ts`) | **the authority** | **yes** | **yes** | via capability registry only |
| **Block 3** | economic/payment truth | **yes** | payment execution | PSP, currently `BLOCKED_BY_PROVIDER` |

### 7.1 Authority ownership table

| Authority | Owner | Not owned by |
|---|---|---|
| Owner identity | `api/context.ts` session → `ownerIdOf(ctx)` | client, model, payload |
| Output kind | Output Router in `jasim-runtime.ts` (schema-validated) | model (proposes only) |
| Presentation primitive | `decidePresentation()` | model, client |
| Reference identity | `discovery_*`, `reference_bindings` | rendered list order |
| Capability existence | `capability-registry.ts` | provider catalog |
| Provider selection | `resolveProvider()` | provider self-description |
| Policy / approval | `execution_proposals` + `proposal_approvals` | dispatcher, UI |
| Execution | DAG in `jasim-runtime.ts` + Block 2 continuation | fabrics |
| Verification | `execution-verifier.ts` | provider receipt |
| Money | Block 3, append-only ledger | economic fabric, model ledger |
| Model cost | `model_usage_ledger` | Block 3 ledger |
| Coordination state | Block 2 tables | runtime duplicates |
| Projections | derived per request | any table |

### 7.2 Correction to an inherited note

`.agents/memory/block31-mapping-status.md` says `api/core` is "LEGACY/DEAD". **That is true of the
competing engines and false of the infrastructure.** Traced live imports from the registered path:

```
api/runtime/block2/worker.ts  → core/durable-job-queue, core/drizzle-durable-job-repository,
                                 core/durable-job-worker, core/immutable-artifact-store
api/runtime/block2/notifications.ts → core/websocket
api/runtime/jasim-runtime.ts  → core/generated-world-service, core/generated-world-repository
api/runtime/block31/conversation-orchestrator.ts → core/generated-world-service (type)
api/runtime/block3/generated-business-economics.ts → core/generated-world-service (type)
api/runtime/phase11-providers.ts → core/tool-adapters/search-adapter
```

So `api/core` is **mixed**: live infrastructure plus dead engines. Treating the whole directory as
dead risks deleting the durable job queue that Block 2 runs on.

---

## 8. PART G — DUPLICATE AUTHORITY

Each candidate was checked by asking "does the registered router path reach it?"

| Candidate | Finding | Class |
|---|---|---|
| `api/core/task-runtime.ts` — full in-memory DAG, agent loop, its own `SUCCESS/PARTIAL_SUCCESS/BLOCKED/REQUIRES_HUMAN` state machine | **0 live references** | `LEGACY_ONLY` |
| `api/core/planner.ts`, `agent-runtime.ts`, `agent-router.ts`, `intent-parser.ts`, `intent-engine.ts`, `swarm-orchestrator.ts`, `lam-orchestrator.ts`, `commerce-runtime.ts` | **0 live references each** | `LEGACY_ONLY` |
| Legacy routers (`jasim`, `conversation`, `task`, `bubble`, `worlds`, …) | not registered in `api/router.ts`; excluded in `tsconfig.server.json` | `LEGACY_ONLY` |
| `artifacts/api-server` | deliberately neutralized to `export {}` | `LEGACY_ONLY` |
| Block 2 worker | explicitly reuses the existing `runtimeJobs` queue — "no new scheduler, no new runtime" | `NONE` |
| Payment truth | only Block 3 writes `payment_intents` / `economic_ledger_entries`; the economic fabric stops at `transaction_intents` | `NONE` |
| Policy authority | only `execution_proposals` + `proposal_approvals`; the dispatcher returns `APPROVAL_REQUIRED`, it does not decide | `NONE` |
| Presentation | one selector (`decidePresentation`); `routePresentation` is a documented alias, not a second router | `NONE` |
| Web / Mobile | both consume projections and the shared contract; zero business writes | `NONE` |

```
ACTIVE_DUPLICATE_AUTHORITY = 0
```

The legacy engines are a **maintenance and comprehension hazard**, not a correctness hazard: they
compile in some configurations and will mislead a reader into thinking JASIM has two planners. They
are quarantined by non-registration, not by deletion. Recommended eventually, not now, and not as
part of this trace.

---

## 9. GENERIC GAPS DISCOVERED

All five are generic. **Zero domain-specific fixes are proposed.**

| # | Gap | Where | Consequence |
|---|---|---|---|
| **G1** | No caller converts a trusted observation into `interactionNeed: "track"` | between Block 2 observations and `presentationForConversationEnvelope` | `TRACKER` and `MAP` are unreachable in production; the entire map lifecycle is inexpressible end-to-end |
| **G2** | `presentationForConversationEnvelope` emits only 4 of 12 interaction needs | `jasim-runtime.ts:5184` | `show_history`/`TIMELINE`, `show_schedule`/`CALENDAR`, `preview_artifact`, `collect_input`/`FORM`, `external_transition` are not reachable from a conversation turn |
| **G3** | `observation` has no freshness policy | `presentation-fabric.ts:206` | a stale coordinate renders identically to a live one; `observedAt` is displayed but never gates the MAP |
| **G4** | Four trusted actions are declared but routed to `unavailableRoute` | `trusted-action-dispatcher.ts:600-603` | `SELECT_ENTITY`, `REQUEST_CHANGE`, `CREATE_PROPOSAL`, `CANCEL_OPERATION` are advertised to clients and always answer `BLOCKED` |
| **G5** | `ModelBudget.maxModelCalls` declared, never enforced | `model-policy.ts:64` | no ceiling on calls per request; its default of 1 means naive enforcement would disable provider fallback, so the enforcement point belongs to a planner loop that does not exist |

Ranked by what they cost: **G1 is the one that matters**, because it is the difference between "the
architecture can express a live operational surface" and "it cannot". G4 is a truthfulness issue in
miniature — an advertised action that always fails is a promise the runtime does not keep.

---

## 10. FINAL COUNTERS

```
PRESENTATION_FABRIC_READ_COMPLETE                 = YES
ECONOMIC_FABRIC_READ_COMPLETE                     = YES
CAPABILITY_PROVIDER_READ_COMPLETE                 = YES
TRUSTED_ACTION_DISPATCHER_READ_COMPLETE           = YES

PRESENTATION_DECISION_UNDERSTOOD                  = YES
MAP_LIFECYCLE_EXPRESSIBLE                         = PARTIAL
CAPABILITY_PROVIDER_SEPARATION_CONFIRMED          = YES
ECONOMIC_MODEL_UNDERSTOOD                         = YES
TRUSTED_ACTION_BOUNDARY_CONFIRMED                 = YES
FABRIC_BLOCK2_RUNTIME_RELATIONSHIP_UNDERSTOOD     = YES

ACTIVE_DUPLICATE_AUTHORITY                        = 0
GENERIC_GAPS_DISCOVERED                           = 5
DOMAIN_SPECIFIC_FIXES_PROPOSED                    = 0

PRODUCT_SOURCE_CHANGED                            = NO
DATABASE_CHANGED                                  = NO
PRODUCTION_TOUCHED                                = NO

UNDERSTANDING_GATE                                = PASS
```

END OF TRACE.
