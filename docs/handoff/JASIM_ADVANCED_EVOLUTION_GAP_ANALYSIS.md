# JASIM — ADVANCED EVOLUTION GAP ANALYSIS

**Baseline:** `8bfaaeb` · **Date:** 2026-09-18 · **Code changed:** NONE
**Method:** every classification below is traced from *live, registered* code —
`api/router.ts` registers exactly `runtime`, `fabric`, `block2`, and nothing
outside that graph counts as present.

---

## PART 1 — CURRENT JASIM, RECONSTRUCTED FROM CODE

### The live path, traced

```
runtime.turnsCreate            api/routers/runtime.ts
  └─ routeRuntimeConversationTurn            jasim-runtime.ts:5702
      ├─ createRuntimeMessage (user)         ← committed BEFORE the model call
      ├─ orchestrateConversationCommerce     block31/conversation-orchestrator.ts:600
      │   └─ discover()                      block31/discovery.ts:307
      ├─ [history ‖ memories ‖ summary]      Promise.all
      ├─ resolveRuntimeReferences            → ReferenceBindings
      ├─ modelGateway.generate               → IntentEnvelope (allowlisted, .strict())
      ├─ createExecutionProposalsForIntent   :5185
      └─ createRuntimeRun (blocked / awaiting_*)

runtime.proposalsDecide → approval bound to executionFingerprint
runtime.runsExecute            api/routers/runtime.ts:899
  └─ executeApprovedRun        :7725
      └─ driveRunToCompletion  :7636
          └─ executeRuntimeDagNode :3721
              ├─ claim (fenced lease) → attempt row → capability execute
              ├─ gatherEffectAssertions       completion-policy.ts
              ├─ verifyExecutionAttempt       execution-verifier.ts
              └─ complete / fail / PENDING
buildRunReceipt → summarizeLatestVerification → isVerifiedReceipt
decidePresentation (pure) → PresentationRenderer → Web / Mobile
```

### Stage classification

| # | Stage | Status | Evidence |
|---|---|---|---|
| 1 | Conversation | **MATURE** | Owner-scoped rows, user message committed before the model call, failure integrity closed (`1af5352`) |
| 2 | Model Gateway | **MATURE** | Tiers T0–T3, semantic aliases, per-attempt ledger rows, normalized `finishReason`, fail-closed budget, context budgeting |
| 3 | Semantic interpretation | **WORKING_BUT_LIMITED** | One model call → one `IntentEnvelope`. Output is `requiredCapabilities: string[]` — **a flat list, not a structure** |
| 4 | References | **MATURE** | `resolveRuntimeReferences`, `referenceBindings` table, ambiguous/unresolved are first-class, ordinals never leak (`ref-1` lives in `data-reference`) |
| 5 | Capability resolution | **MATURE** | Registry with aliases, input contracts, semantic purposes, effect classes; `validateInputs` before assignment |
| 6 | Provider resolution | **MATURE** | Filter cascade: trust → freshness → health → privacy/jurisdiction → protocol → contract, then a **deterministic lexicographic tie-break** (health, trust rank, verified successes, cost, latency, observation freshness, id) |
| 7 | **Planning** | **PARTIAL — the weakest stage** | see §1.1 |
| 8 | Approval | **MATURE** | Proposal → approval bound to `executionFingerprint`, expiry, `consumedAt`, gate re-evaluated per node |
| 9 | Durable execution | **MATURE** | Fenced leases, `fenceVersion`, CAS job claim, `runtime_jobs`, crash-resume, `resumeScheduledRuntimeRun` |
| 10 | Attempts | **MATURE** | Immutable `execution_attempts`, idempotency `run:node:fenceVersion`, one row per attempt |
| 11 | Receipts | **MATURE** | `buildRunReceipt`, `isVerifiedReceipt`, truthful Arabic per state |
| 12 | Completion policy | **MATURE** (new) | 6 effect classes, 6 claim sources, downgrade-only, wired to all 3 verifier call sites |
| 13 | Observations | **WORKING_BUT_LIMITED** | Append-only `observations`, freshness TTL, privacy-gated projection. **Not connected to effect verification** — see §6 |
| 14 | Verification | **MATURE** | Output verifier + completion policy; `INCONCLUSIVE != FAILED` enforced as a retry policy |
| 15 | Reconciliation | **WORKING_BUT_LIMITED** | `reconcileUncertainAttempt` with an `INDEPENDENT_READBACK` lookup hook — **and no registered lookup implementations** |
| 16 | **Repair / compensation** | **MISSING** | see §1.2 |
| 17 | Canonical state | **MATURE** | One runtime, one DB, owner-scoped throughout |
| 18 | Presentation | **MATURE** | `decidePresentation` pure + deterministic, 40 primitives, 8 output kinds, 5 transitions |
| 19 | Web projection | **MATURE** | RTL, Arabic-first, design tokens, truthful states (UI-1/2/2.1) |
| 20 | Mobile projection | **WORKING_BUT_LIMITED** | Renders the same primitives; not visually accepted to the Web's standard |
| 21 | Proactive triggers | **WORKING_BUT_LIMITED** | Six trigger kinds incl. CONDITION and EVENT with CAS claiming — **no bridge to a user-facing turn** |
| 22 | Discovery | **PARTIAL** | see §1.3 |
| 23 | Memory | **PARTIAL** | One untyped key/value store + summaries; no types, no TTL, no salience retrieval |
| 24 | Evaluation | **MISSING** | No harness. 1285 unit tests are not agent evals |
| 25 | Observability export | **MISSING** | Rich internal events; no trace export, no `gen_ai.*` |
| 26 | Cost caching | **MISSING** | Budget and metering exist; no prompt/prefix cache |
| 27 | Computer use | **FUTURE** | `ProviderKind.COMPUTER_USE` declared only |
| 28 | Human providers | **FUTURE** | `ProviderKind.HUMAN` declared; no dispatch/acceptance/proof lifecycle |
| 29 | Multimodal | **FUTURE** | Image *generation* with durable lineage exists; no image/document/audio *input* |
| 30 | Voice | **FUTURE** | Nothing |
| 31 | Core Evolution Lab | **ISOLATED (by design)** | Not registered in `api/router.ts` — correct |

---

### §1.1 THE PLANNING FINDING — traced, not inferred

This is the most consequential discovery of this review.

**JASIM has no planner.** It has a capability-list-to-node mapper.

```ts
// createExecutionProposalsForIntent — jasim-runtime.ts:5194
const capabilities = [...new Set(input.intent.requiredCapabilities)];
return Promise.all(capabilities.map((capability) =>
  createExecutionProposal({ …, capability, inputs: input.intent.inputs, … })));
//                                     ↑ no dependencies argument → defaults to []

// materializeApprovedRunDag — jasim-runtime.ts:7646
const nodes = eligibleProposals.map((p, i) => ({
  nodeKey: `step-${i}`, capabilityId: p.capabilityId!, …
}));                                 // ↑ no `dependencies` field
```

So on the conversational path **every DAG is a dependency-free set of nodes**,
each receiving the same `intent.inputs`.

What makes this striking is everything sitting unused around it:

- `RuntimeDagNodeInput.dependencies?: string[]` exists.
- `createRuntimeDag` does topological ordering, **cycle detection**
  (`"DAG dependencies cannot contain a cycle"`), and cross-node validation.
- `RuntimeInputBinding` can bind one node's output path into another's input.
- `semantic-fabric.ts` contains `composeRequirementGraph` — a real composer over
  `CapabilityRequirement` with `dependsOn`, resource and provider requirements.
- It is exposed as `fabric.composeGoal` — **and `grep` proves nothing in
  `jasim-runtime.ts` ever calls it.** The only caller is the router, which takes
  the requirement graph *from the client*.

**The one exception**, and the proof the machinery works: 
`createResearchImageComposition` (`:3012`) builds a genuine three-node DAG —
`research → research-context → image` — with real `dependencies` and real
`RuntimeInputBinding`s. It is hardcoded, and it is reached only by
`isResearchImageCompositionIntent`, a hand-written intent matcher.

> **JASIM can execute a dependency graph beautifully and cannot produce one.**

This single gap explains most of what feels missing at Levels 6 and 7. Multi-step
goals, plan repair, replanning, cost-aware planning and alternative-plan
comparison are all downstream of *having a plan object at all*.

**`api/core/task-runtime.ts` contains a full replan/repair engine** (`replan`,
`repair.action === 'replan'`, recovery, step cancellation). It is in the
unreachable `api/core/` tree — the same tree as `llm-router.ts`, which a previous
wave proved dead by module-graph walk. `api/boot.ts` imports only
`core/runtime-readiness` and `core/websocket` from it. **JASIM has a replanning
engine it cannot reach**, and reviving it would be wrong: it predates the trust
chain and would make the LLM an execution authority. It is evidence that the
problem was once solved in the wrong architecture, not a shortcut.

### §1.2 THE COMPENSATION FINDING

After the completion-policy work JASIM can say, with evidence, **"this effect
occurred"**. It has no way to say **"undo it"**.

There is no compensating action, no reverse capability, no saga coordinator. A
run whose step 2 succeeds against an external system and whose step 3 fails
leaves a real-world effect with no path back. Block 2's composite reservations
are the single counter-example, and they compensate *within one SQL transaction*,
which does not generalize across providers.

This is the natural sibling of `CompletionPolicy` and is ranked #1 in the top-20.

### §1.3 THE DISCOVERY FINDING — more built than assumed, and unconnected

The brief says "web-research returns real sources, but not normalized offerings."
That is true of the *capability*, and it understates what exists.

Block 3.1 already has the normalization pipeline:
`planSources` → `HardConstraint` + `satisfiesHardConstraints` (**applied before
ranking**, which is the correct order and rarer than it should be) →
`normalizeCandidate` → versioned immutable `discovery_result_sets`
("new search = new row, never silent reorder") → `discovery_candidates` with
`trust`, `provenance`, `externalContent: "untrusted_evidence_only"`, and
`actionable: []` for anything external.

The gap is a **missing wire**, precisely locatable:

```ts
// conversation-orchestrator.ts:176
webResults: Array.isArray(values.webResults) ? values.webResults : [],
//          ↑ values = envelope.intent.inputs — i.e. THE MODEL'S OWN OUTPUT
```

`discover()` never fetches. It accepts `webResults` as a parameter, and the only
thing that ever supplies them is the model. Meanwhile the `web-research`
capability *does* fetch real sources with provenance — into a DAG node output
that **never flows into `discover()`**.

So Real Discovery is not a pipeline to build. It is a **bridge to build between
two halves that both already exist**, plus ranking.

> **⚠ FINDING — MEDIUM, reported not fixed (per Part 33).**
> Because `webResults` is model-supplied, a model could emit fabricated URLs,
> prices and `retrievedAt` timestamps which would be persisted as
> `WEB_OBSERVATION` candidates with a provenance block.
> **Mitigating facts, verified in code:** they are stamped
> `trust: "untrusted_external_evidence"`, `canonicalRef: null`, `actionable: []`,
> `externalContent: "untrusted_evidence_only"`; the URL must match `^https?://`
> and money must be exact integer minor units with a matching currency. So the
> system does not claim they are true and does not let a run act on them.
> **The residual issue is honesty of provenance**: a `provenance.retrievedAt`
> that no retrieval produced. The clean fix is to require that a
> `WEB_OBSERVATION` carry a canonical `attemptId` from a real `web-research`
> node — which is also exactly what the discovery bridge would introduce.
> This is not a critical security bug and has not been changed.

---

## PART 3 — JASIM AGAINST THE FRONTIER

| Area | JASIM today | Frontier pattern | Gap | Importance | Difficulty | Provider? | Recommendation |
|---|---|---|---|---|---|---|---|
| Durable execution | Fenced leases + attempt ledger | Temporal/Restate journaling | **none** | — | — | no | Keep. Reject external engine |
| Execution truth | CompletionPolicy | (no vendor equivalent) | **JASIM ahead** | — | — | no | Keep |
| Compensation | none | Saga / SagaLLM | **large** | critical | med | no | **Build** |
| Planning | flat capability list | HTN / DAG / partial-order | **large** | critical | med-high | model | **Build** |
| Replanning | none (dead code in `api/core`) | plan repair, receding horizon | **large** | high | high | model | After planning |
| Model routing | a-priori tier selection | cascade + calibrated escalation | medium | med | med | **yes** | Adapt, schema-signal only |
| Prompt caching | none | prefix cache, 50–90% saving | medium | high | **low** | yes | **Adopt** |
| Semantic cache | none | similarity-served answers | — | low | med | yes | **Reject** |
| Memory | one k/v table | typed 5-way taxonomy | medium | high | low-med | no | **Build (typed, TTL, salience)** |
| Context compression | summary only | trajectory-validated compaction | medium | high | med | partial | Adapt |
| Discovery fetch→normalize | **wire missing** | multi-source + RRF | **large** | critical | med | **yes** | **Build the bridge** |
| Ranking | position order | BM25+vector+RRF | medium | med | med | yes | Adapt after bridge |
| Prompt injection | fencing + allowlisted contracts + non-LLM privileged side | dual-LLM | **JASIM ahead** | — | — | no | Keep |
| MCP tool descriptions | consumed as metadata | treat as supply chain | **real gap** | high | low | no | **Adopt** |
| Observability export | rich internal events | OTel `gen_ai.*` | medium | med | low | no | Adapt vocabulary |
| Evaluation | none | trajectory evals | **large** | critical | med | partial | **Build** |
| Generative UI | deterministic IR, 40 primitives | AG-UI static tier | **JASIM ahead** | — | — | no | Keep |
| UI streaming | one presentation per turn | SSE transitions | medium | high | med | no | **Build** |
| Proactive | 6 trigger kinds, no bridge | ambient agents | small-med | high | **low** | no | **Build the bridge** |
| HITL | fingerprint-bound approvals | interrupt + checkpoint | **JASIM ahead** | — | — | no | Extend inputs |
| A2A interop | ProviderKind + metadata | 8-state task lifecycle | small | low | low | no | Align states |
| Agent payments | internal mandate | AP2 signed mandates | small | low now | med | payments | Defer |
| Level 7 opportunity | capacity+reservation only | perishable-utility matching | **large** | high | high | yes | Design now, build later |
| Advertising | none | bid × quality, separated | n/a | — | — | — | Design only |

**Deliberately NOT counted as gaps** (fashionable, and wrong for JASIM):
multi-agent debate, reflection loops (arXiv 2606.05976 shows they degrade
accuracy), semantic answer caching, a vector store for canonical entities, an LLM
plan-critic with authority, autonomous tool creation, blended sponsored/organic
ranking.

---

## PARTS 4–5 — INTELLIGENCE AND PLANNING

The brief's own example is the right test:

> «رتب لي الموضوع بأرخص طريقة لكن لا تتأخر أكثر من يومين»

Today this produces one `IntentEnvelope` with a flat `requiredCapabilities` list
and free-form `inputs`. **"أرخص" and "يومين" have nowhere typed to live.** The
model may put them in `inputs`, where nothing enforces them: no capability
contract mentions cost, no provider filter reads a deadline, no plan is scored
against either.

The generic mechanism JASIM needs is **not** a better prompt. It is a typed
**GoalSpec** — domain-neutral, allowlisted like every other model output:

```
GoalSpec {
  outcome:      what must become true
  constraints:  [ { dimension: COST|TIME|QUALITY|RISK|PRIVACY|LOCATION,
                    operator, value, unit, hardness: HARD|SOFT } ]
  preferences:  ordered dimensions (the hierarchy, not a score)
  assumptions:  what the model inferred and the user did not say
  unknowns:     what must be asked before acting
}
```

`hardness` is the load-bearing field: a HARD constraint is a **filter** applied
before ranking (Block 3.1 already does this for discovery, so the pattern is
established); a SOFT constraint is a **ranking dimension**. `assumptions` is what
makes JASIM honest — "I assumed cheapest means lowest total cost including
delivery" is checkable, and today it is invisible.

Nothing here is domain-specific. "أرخص" is `COST ≤ min, SOFT-preferred-first`;
"لا تتأخر أكثر من يومين" is `TIME ≤ 48h, HARD`. A car, a scaffold and a
translator all reduce to the same five fields.

**Planning then becomes possible**, in this dependency order:
1. **GoalSpec** (typed constraints) — needs a model, cheap to define.
2. **PlanGraph**: requirement nodes with `dependsOn` — `composeRequirementGraph`
   already produces this shape; it needs to be called from the turn.
3. **Plan validation**: every HARD constraint has a step that can satisfy it;
   every input is bound or asked for. Pure code, no model.
4. **Plan scoring**: expected cost / time / risk from provider metadata that
   already exists (`costClass`, `latencyClass`, `verifiedSuccessCount`).
5. **Plan repair**: re-bind or re-select a provider for one failed node.
6. **Replanning**: only after 1–5, and **the LLM proposes, the runtime decides** —
   the existing `ModelProposal<T>` brand is the mechanism.

Step 3 is the one that matters most and needs no model at all. A plan that
structurally cannot satisfy a stated hard constraint should never reach approval.

---

## PART 6 — OBSERVE / VERIFY / REPAIR

**Should JASIM add a `VerificationGraph`?** Per the brief's instruction not to
invent it unless justified: **NO — not as a new structure.** The attempt ledger
plus `EffectAssertion[]` already forms the graph's content, and a second
structure over the same facts would be the kind of duplication this architecture
exists to avoid.

What is genuinely missing is smaller and more valuable:

1. **Conflicting evidence.** `decideCompletion` today takes the first
   NOT_OCCURRED, then any UNCERTAIN, then a sufficient OCCURRED. If two
   independent readbacks disagree, one silently wins. That should be its own
   outcome — `EFFECT_EVIDENCE_CONFLICT` → INCONCLUSIVE — because two authorities
   disagreeing is a *stronger* signal than one being unsure.
2. **Observations are not evidence.** `block2/observations.ts` records
   append-only evidence with freshness TTLs, and the completion policy cannot see
   it. An observation is exactly an `INDEPENDENT_READBACK` in the policy's terms.
   **Wiring `Observation` → `EffectAssertion` is a small change with large reach**,
   and it is what makes tracked physical effects verifiable.
3. **No registered reconciliation lookups.** The `UncertainAttemptLookup` hook is
   the only path to VERIFIED for an effectful capability, and nothing implements
   one. It is a socket with nothing plugged in.
4. **Compensation** — §1.2, ranked #1.

---

## PART 7 — MEMORY

JASIM's one structural advantage here is already right: **memory is advisory and
canonical state is authoritative**, and they are different tables. Most surveyed
systems conflate them, which is why a remembered fact can contradict a live
record. Do not give that up.

What to add, typed and TTL'd:

| Type | Example | Owner | TTL | Retrieval | Correction |
|---|---|---|---|---|---|
| Preference | "prefers evening appointments" | user | long, refreshed on use | salience vs GoalSpec | user states otherwise |
| Constraint | "never SMS me" | user | until revoked | **always loaded** — a policy, not a hint | explicit only |
| Entity | "my car = reference X" | user | until the entity dies | reference resolution | canonical row wins |
| Procedural | "this goal shape needs these 3 steps" | system | versioned | plan composition | eval regression |
| Episodic | conversation summary | conversation | conversation lifetime | recency + relevance | recompaction |

**Retrieval must be selective.** Today memories are *loaded*; they should be
*selected* by relevance to the current GoalSpec — recency × importance ×
relevance, per the Generative Agents pattern. And a **Constraint memory must
never be subject to salience**: "never SMS me" that fails to retrieve is worse
than no memory at all. That asymmetry is the design.

**Forgetting** is absent entirely and is a privacy obligation, not an
optimization.

---

## PART 8 — CONTEXT ENGINEERING

The smallest sufficient context, in priority order, is *already enumerable* from
JASIM's own types: GoalSpec → HARD constraints → resolved references → current
Run state → authority/approval state → budget remaining → salient memories →
compacted history.

One JASIM-specific rule the general literature does not state, and the
Slipstream paper's trajectory-validation finding implies:

> **A compaction that drops a stable reference is a correctness bug, not a
> quality loss.** `ReferenceBindings` means `ref-3` must still resolve after
> compaction. Summaries must be *reference-preserving* by construction —
> references carried as structured data alongside the prose, never inside it.

And prompt caching (§11 of the research) has a structural prerequisite JASIM
should adopt regardless of provider: **order the prompt stable-prefix-first** —
system, policy, capability catalog, then per-turn content. That costs nothing
now and makes prefix caching a configuration change later.

---

## PART 9–10 — MODEL AND PROVIDER INTELLIGENCE

**Model routing.** JASIM should *not* adopt a judge model. The safe escalation
signal is one JASIM can compute without a second opinion: structured-output
schema validation failure, a `finishReason` that is not a clean stop, or a
refusal/abstention. Escalate on **evidence of failure**, never on a model's
opinion of quality. This keeps the cascade's cost benefit without letting a model
grade a model.

**Provider selection.** The current lexicographic cascade is better than it looks
and should not be replaced by a weighted score. Weights are unexplainable and
tunable in the wrong direction; a lexicographic order is auditable — *"why this
provider?"* has a one-line answer today. What is missing is not a `ProviderScore`
but **per-request ordering**: a GoalSpec preferring COST should reorder cost
above latency, not change the mechanism. That is a small, principled change and
it keeps `why` answerable.

The one genuinely missing dimension is **outcome feedback**:
`verifiedSuccessCount` exists in the tie-break but nothing appears to increment
it from verified receipts. Closing that loop makes provider choice learn from
verification — which is exactly the right learning signal, because it learns from
*effects*, not from model opinions.

---

## PARTS 12–14 — PROACTIVE, LEVEL 6, LEVEL 7

**Proactive (Part 12).** Much closer than the roadmap assumes. Six trigger kinds
with CAS claiming and an event bus already exist. Missing: a bridge from a fired
trigger to a proactive conversation turn, and a **notification policy** governing
frequency, quiet hours and per-owner caps. The research's design principle —
lightweight always-on temporal model, LLM only for what survives the trigger — is
what the existing CONDITION trigger already implements.

**Level 6 (Part 13).** `Goal → Plan → Act → Observe → Verify → Repair → Replan`
under Authority, Policy, Budget, Time, Risk, Termination.

Present: Act (mature), Verify (mature), Authority (mature), Policy (mature),
Budget (mature, model-calls only), Observe (exists, unwired).

Missing, in strict dependency order:
1. **Plan** (§1.1) — nothing downstream is meaningful without it.
2. **Repair / compensation** (§1.2).
3. **Replan** — requires 1 and 2.
4. **Termination conditions** — there is a `MAX_ITERATIONS = 50` loop guard and
   no *semantic* termination: no "stop when the goal is met", no "stop when the
   budget is spent", no "stop when no plan can satisfy the hard constraints".
5. **Budget beyond model calls** — time, money and attempt budgets do not exist.
   `maxModelCalls` is the only enforced ceiling.

**`LEVEL_6_FOUNDATION = PARTIAL`** — the hard half (trust, durability,
verification) is done; the planning half is not started.

**Level 7 (Part 14).** Supply is real: `AvailabilityWindow` + `Reservation` with
`DOUBLE_BOOKING = 0`, composite multi-leg reservations with per-leg policy.

The generic `Opportunity` concept, modelled on perishable utility:

```
OpportunityCandidate =
    UnusedCapacity        (an AvailabilityWindow with an expiry — exists)
  × MatchedNeed           (a Need expression satisfying the capacity's constraints)
  × ConstraintCompatibility (both sides' HARD constraints hold — GoalSpec)
  × PositiveExpectedEconomics (expected value − expected cost − risk > 0)
  × Authority             (the owner has pre-authorized this class of match)
```

Three of the five are missing: Need discovery, expected economics, and the
authority class for autonomous matching. And an `Opportunity` must be a
**proposal**, never an execution — the existing proposal/approval chain is
exactly the right home, which means Level 7 needs no new trust machinery.

**`LEVEL_7_FOUNDATION = PARTIAL`**, and it is blocked behind Level 6's planner
and Real Discovery's demand side, not behind market mathematics.

---

## PARTS 15–20 — ADS, UI, MULTIMODAL, VOICE, COMPUTER USE, HUMANS

**Advertising (15).** Design only. The invariant that must be structural, not
documentary: `OrganicRanking` is computed by code that **has no access to
sponsorship data at all** — not "ignores it", *cannot see it*. `SponsoredRanking`
runs separately behind a relevance floor. `FinalPresentation` interleaves with
mandatory labelling. And a sponsored candidate must never be `actionable` in an
autonomous run. Block 3.1's `actionable: []` for untrusted candidates is already
the right mechanism.

**Generative UI (16).** JASIM is ahead on authority and behind on transport. The
one real gap is **streaming**: a long run is silent. JASIM already has the typed
vocabulary for incremental updates (ENTER/UPDATE/MORPH/EXIT/NO_CHANGE) — it needs
an SSE channel, not a new model. Adaptive density and progressive disclosure are
genuine but secondary; cross-device continuity is mostly already true because
both clients project the same runtime.

**Multimodal (17).** The right shape follows JASIM's existing grammar: an input
image or document becomes a **Resource with durable lineage** (the
`image-generation` capability already stores `artifactId`, `objectPath`,
`sha256`, `byteLength` — the pattern exists) and then an **Observation** with
provenance and freshness. Never raw bytes into a prompt. Nothing to build now.

**Voice (18).** One rule matters: voice is a **transport**, not a runtime. Same
conversation rows, same envelope, same proposals, same approvals. The single
hard requirement is that **an irreversible action must never be confirmable by
voice alone without an explicit, replayable confirmation artifact** — a spoken
"yes" is not an approval record bound to an execution fingerprint.

**Computer use (19).** Provider, never authority — already the stated position.
The research adds one concrete mapping: **TOCTOU** (the page changes between
reading and acting) is not a new problem for JASIM; it is `INCONCLUSIVE`, and
blind retry is already forbidden there.

**Human providers (20).** `ProviderKind.HUMAN` exists and the completion policy
already has `HUMAN_ACTION` with the correct rule — a person's claim is
`SELF_REPORTED` and never sufficient. Missing is the lifecycle: dispatch,
acceptance, availability (which `AvailabilityWindow` already models), proof, and
rating. Note the ranking dimension should be **verified completion rate**, not
stars — JASIM can measure what actually happened, which is a real differentiator
over review-based marketplaces.

---

## PART 21 — SECURITY GAPS, RANKED

| # | Gap | Severity | Present mitigation |
|---|---|---|---|
| 1 | **MCP/A2A tool descriptions not fenced as untrusted** | **HIGH** | None. 2026 guidance (NSA, Microsoft, OWASP #3) classifies these as supply-chain assets. JASIM fences *retrieved content* but treats *tool metadata* as configuration |
| 2 | **Model-supplied `webResults` become provenanced observations** | MEDIUM | Labelled untrusted, non-actionable, URL/money validated (§1.3) |
| 3 | **No provider-catalog change review** | MEDIUM | Trust classes and staleness exist; a catalog *edit* has no approval gate |
| 4 | **No egress allowlist for provider calls (SSRF)** | MEDIUM | `provider-http.ts` bounds size and timeout; origin validation exists for external *action sessions* but not for general provider fetches |
| 5 | Cross-owner isolation | **LOW — strong** | Every query owner-scoped; verified again in this review |
| 6 | Approval spoofing / replay | **LOW — strong** | Fingerprint-bound, expiring, single-consumption approvals |
| 7 | Model-generated authorization claims | **LOW — strong** | `AUTHORITY_KEYS` rejection, allowlisted contracts, `planLocalId` refuses UUIDs, `EFFECT_AUTHORITY_KEYS` rejection |
| 8 | Credential leakage | **LOW — strong** | `redactCredentials`, server-only secrets, `RAW_OPERATOR_ERRORS_EXPOSED = 0` |
| 9 | Confused deputy | **LOW** | Capability≠Provider plus per-purpose origin binding |

Items 5–9 are strong *because* of work already done. Items 1–4 are the real list.

---

## PART 22 — EVALUATION FRAMEWORK

JASIM has the rarest prerequisite and none of the harness. The attempt ledger,
run events, proposals, approvals and verification details **are a trajectory
record by construction** — most teams must build that first.

Frozen benchmark design:

- **Corpus:** the 30 behavioural examples as v1, frozen and versioned; each with a
  GoalSpec, a fixture world, and an expected *outcome class* — never an expected
  string.
- **Trajectory assertions:** which capabilities ran, which providers were chosen
  and **why**, how many model calls, which approvals were requested.
- **Metrics:** goal success · HARD-constraint compliance · **false-success rate**
  (a run reported VERIFIED whose effect did not occur — directly measurable now
  that PENDING exists) · INCONCLUSIVE rate · clarification rate · replan rate ·
  cost per goal · model calls per goal · user-intervention rate.
- **Generality suite:** the decisive one. Run a goal from a domain the fixtures
  never mention. If it needs new core code, generality has failed — the same test
  `completion-policy.test.ts` already applies to itself.
- **Hazard suite:** per ToolBench-X, inject *recoverable* provider failures and
  measure diagnosis and recovery, not happy-path completion.

**`false-success rate` should be the headline metric.** It is the number that
distinguishes JASIM from an assistant that says it did something.

---

## PARTS 23–27 — SELF-IMPROVEMENT, OBSERVABILITY, COST, PERFORMANCE, RELIABILITY

**Self-improvement (23).** Core Evolution Lab stays unregistered. The loop —
observed failure → generic gap → candidate → isolated lab → regression +
security + generality suites → **human approval** → canary → release — has a hard
prerequisite that does not exist yet: **the evaluation harness**. Without it
"regression suite" is a sentence, not a gate. Self-improvement is therefore
strictly downstream of Part 22, which is a useful ordering discovery.

**Observability (24).** The questions the brief lists — *why this provider? why
approval? why stop? why replan? why inconclusive?* — are each already answerable
from stored data, and none is *exposed*. `resolveProvider` returns a `reason`
string that is not persisted per binding; the completion policy's `reasonCode`
and `missingEvidence` now are. A structured **"why" projection** over existing
rows is low-difficulty, high-value, needs no provider, and must never expose
model reasoning text — operational facts only.

**Cost (25).** A Cost Governor is justified, in this order: (1) prefix caching —
free, large; (2) stable-prefix prompt ordering — free, enables (1); (3) budget
dimensions beyond model calls (time, money, attempts); (4) escalation routing.
**Semantic caching is rejected** — serving a similar question's answer is a
truthfulness risk, and it must never cross owners or survive a canonical state
change.

**Performance (26).** Only evidence-backed items: the turn does `Promise.all`
over history/memories/summary (good); `buildRunReceipt` hydrates images per node
(N+1 shaped); long conversations load full history before compaction applies;
the web bundle is ~870 kB JS in one chunk. Nothing here is urgent and nothing
should be optimized before the eval harness can measure it.

**Reliability (27).** Present: idempotency, fenced leases, bounded retry with
backoff, provider health and staleness, failover, reconciliation, CAS job claim,
dead-letter-shaped job states. **Missing: circuit breakers and bulkheads** — a
failing provider is retried per-request rather than tripped out globally, which
under load turns one sick provider into system-wide latency. That is the one real
reliability gap, and it is small.

---

## PART 28 — PRODUCT INTELLIGENCE: WHAT MAKES JASIM QUALITATIVELY DIFFERENT

Not more models, prompts or agents. The defensible differences, ranked by how
hard they are for an assistant-shaped competitor to copy:

1. **Verified execution truth.** JASIM can distinguish *"I did it"* from *"it
   happened"* and prove which. An assistant architecture cannot retrofit this —
   it requires an attempt ledger, effect classes and independent readback from
   the foundation. Confirmed by 2026 research as the hardest unsolved problem
   (the verification bottleneck). **This is the moat.**
2. **Persistent operational state with stable references.** «ذاك السائق» still
   resolves next week. Assistants restart from text every session.
3. **Living Objects + deterministic generative UI.** State that continues to
   exist and update between turns, rendered by a pure function the model cannot
   reach. Competitors let models emit UI; that is faster to build and impossible
   to trust.
4. **Policy-aware bounded autonomy.** Fingerprint-bound, expiring,
   single-consumption approvals. Stronger than checkpoint-resume HITL, and it is
   what makes real-money actions defensible.
5. **Human providers as a first-class execution arm** — and rankable by
   *verified* completion rate rather than reviews.

Ranked by *current* readiness the order is 1, 2, 3, 4, 5. Ranked by *marketing
legibility* it is almost exactly reversed, which is worth knowing: the strongest
thing about JASIM is the hardest to demo.

---

## PART 31 — WHAT SHOULD NOT BE BUILT

| Rejected | Why |
|---|---|
| Domain agents (CarAgent, TravelAgent, …) | Every one is an admission that the generic mechanism failed. The 30-example document already names this test |
| A second runtime (incl. for voice) | Voice is a transport. Two runtimes means two truths |
| Adopting Temporal/Restate | Rewrite that buys replay JASIM has and loses the completion policy |
| Reviving `api/core/task-runtime.ts` | Predates the trust chain; makes the LLM an execution authority |
| Reflection / self-critique loops | arXiv 2606.05976 + TACL: degrades accuracy without an external signal. JASIM's external grader is the right answer |
| A judge model that can promote a result | LLM acquiring authority through a side door |
| Semantic answer caching | Serves a different question's answer on a similarity score, in a system whose claim is truthfulness |
| Client-owned operational truth | Closed once already in the failure-integrity hotfix; must stay closed |
| Model-generated React/HTML/JS | The deterministic presentation layer is the differentiator, not a limitation |
| Blended sponsored/organic ranking | `SPONSORED != BEST` must be structural — organic ranking must not be able to *see* money |
| Unbounded autonomy | Every autonomous act needs authority, budget, termination |
| Live self-modification / self-authorized release | Core Evolution stays unregistered until the eval harness exists |
| Vector store for canonical entities | Canonical truth is relational and exact. Embeddings belong in *discovery*, never in identity |
| Fake providers / fake discovery / stub results | Already rejected repeatedly; `BLOCKED_BY_ENVIRONMENT` is the honest answer |

END OF GAP ANALYSIS.
