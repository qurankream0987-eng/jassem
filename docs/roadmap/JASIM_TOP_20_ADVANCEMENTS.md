# JASIM — TOP 20 ADVANCEMENTS

**Baseline:** `8bfaaeb` · **Ranked by** IMPACT × GENERALITY × FEASIBILITY ÷ RISK
**Nothing here is implemented.** This is a ranked backlog, not a plan of record.

Scoring is 1–5 per factor. `GEN` = generality (does it serve every domain, or
one?). A high-impact item that only serves one domain scores low on purpose —
that is the architecture's own test applied to its roadmap.

---

## THE RANKING

| # | Advancement | Impact | Gen | Feas | Risk | Score | Provider | Model | DB | Phase |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **CompensationPolicy** | 5 | 5 | 4 | 2 | **50.0** | no | no | yes | NOW |
| 2 | **Evaluation harness + frozen benchmark** | 5 | 5 | 4 | 1 | **100.0** | partial | partial | yes | NOW |
| 3 | **GoalSpec (typed constraints)** | 5 | 5 | 4 | 2 | **50.0** | no | yes | yes | AFTER_GEMINI |
| 4 | **PlanGraph + plan validation** | 5 | 5 | 3 | 3 | **25.0** | no | yes | yes | AFTER_GEMINI |
| 5 | **Observation → EffectAssertion bridge** | 4 | 5 | 5 | 1 | **100.0** | no | no | no | NOW |
| 6 | **Discovery bridge (web-research → discover)** | 5 | 4 | 4 | 2 | **40.0** | yes | no | no | AFTER_DISCOVERY |
| 7 | **Tool-description fencing (MCP/A2A)** | 4 | 5 | 5 | 1 | **100.0** | no | no | no | NOW |
| 8 | **Typed memory + TTL + salience retrieval** | 4 | 5 | 4 | 2 | **40.0** | no | partial | yes | NOW |
| 9 | **Presentation streaming (SSE transitions)** | 4 | 5 | 3 | 2 | **30.0** | no | no | no | NOW |
| 10 | **Structured "why" projection** | 4 | 5 | 5 | 1 | **100.0** | no | no | no | NOW |
| 11 | **Prefix caching + stable-prefix prompt order** | 3 | 5 | 5 | 1 | **75.0** | yes | yes | no | AFTER_GEMINI |
| 12 | **Proactive trigger → conversation bridge** | 4 | 5 | 4 | 3 | **26.7** | no | no | yes | NOW |
| 13 | **Budget dimensions beyond model calls** | 4 | 5 | 4 | 2 | **40.0** | no | no | yes | NOW |
| 14 | **Conflicting-evidence outcome** | 3 | 5 | 5 | 1 | **75.0** | no | no | no | NOW |
| 15 | **Circuit breakers + bulkheads** | 3 | 5 | 4 | 1 | **60.0** | no | no | yes | NOW |
| 16 | **Verified-outcome provider feedback loop** | 4 | 5 | 4 | 2 | **40.0** | no | no | yes | NOW |
| 17 | **Hybrid ranking (BM25 + vector + RRF)** | 3 | 4 | 3 | 2 | **18.0** | yes | yes | yes | AFTER_DISCOVERY |
| 18 | **Plan repair + replanning** | 5 | 5 | 2 | 4 | **12.5** | no | yes | yes | LATER |
| 19 | **Opportunity model (Level 7)** | 5 | 4 | 2 | 4 | **10.0** | yes | yes | yes | LATER |
| 20 | **Human provider lifecycle** | 4 | 4 | 3 | 3 | **16.0** | yes | no | yes | AFTER_REAL_PROVIDERS |

> **Read the scores carefully.** #2, #5, #7 and #10 score 100 because they are
> high-generality, highly feasible and near-zero risk — they are the ones to do
> first, and none of them is exciting. #18 and #19 have the highest raw impact
> and the lowest scores because they are difficult and risky. The ranking is
> doing its job when it disagrees with intuition.

---

## THE TOP TEN, IN FULL

### 1 — CompensationPolicy
**What:** A generic declaration, attached to a capability, of how to *semantically
undo* an effect that occurred, plus an executor state machine that runs
compensations in reverse order when a later step fails.
**Why:** After `CompletionPolicy`, JASIM can prove an effect occurred and has no
way to reverse it. A run whose step 2 books and step 3 fails leaves a real-world
effect with no path back. The saga literature is explicit: *compensating
transactions are not rollbacks — they are real business operations that can
themselves fail and must be retried.*
**Current state:** MISSING. Block 2 composite reservations compensate within one
SQL transaction only; that does not generalize across providers.
**Deps:** none. It is the exact sibling of `CompletionPolicy` and reuses its
effect classes, its claim sources and its INCONCLUSIVE rule.
**Provider:** no · **Model:** no · **DB:** a `compensations` ledger
**Security risk:** MEDIUM — a compensation is itself an effect and must go
through the same verification, or JASIM gains an unverified write path.
**Economic value:** HIGH — it is the precondition for any multi-step run that
touches money or bookings.
**Difficulty:** MEDIUM · **Impact:** a failed run stops being a mess.

### 2 — Evaluation harness + frozen benchmark
**What:** Trajectory-level evaluation over the existing attempt ledger; the 30
behavioural examples as a frozen v1 corpus; a generality suite and a hazard suite.
**Why:** Nothing else on this list can be *known* to have helped. It is also the
hard prerequisite for Core Evolution — "regression suite" is currently a sentence,
not a gate.
**Current state:** MISSING. But the trajectory record already exists, which is the
part most teams have to build first.
**Deps:** none · **Provider:** partial (fixtures for most, a model for end-to-end)
**Headline metric:** **false-success rate**, newly measurable because PENDING now
exists.
**Risk:** LOW — it only reads. **Difficulty:** MEDIUM.

### 3 — GoalSpec
**What:** A typed, allowlisted model output carrying outcome, constraints
(dimension / operator / value / unit / **hardness**), a preference ordering,
explicit assumptions and unknowns.
**Why:** «بأرخص طريقة لكن لا تتأخر أكثر من يومين» currently has nowhere typed to
live. `hardness` is the load-bearing field: HARD filters before ranking, SOFT
ranks. `assumptions` is what lets JASIM be honest about what it inferred.
**Current state:** `IntentEnvelope` carries a flat `requiredCapabilities: string[]`
and free-form `inputs`.
**Deps:** none technically; needs a model to produce and validate.
**Risk:** MEDIUM — a model authoring constraints must never author *authority*;
the existing `ModelProposal<T>` brand is the mechanism.

### 4 — PlanGraph + plan validation
**What:** Turn the goal into requirement nodes with `dependsOn`, then **validate
in pure code** that every HARD constraint has a step that can satisfy it and every
input is bound or asked for.
**Why:** §1.1 of the gap analysis: JASIM executes dependency graphs beautifully
and cannot produce one. Every conversational DAG today is a dependency-free set.
**Current state:** `composeRequirementGraph` exists in `semantic-fabric.ts`, is
exposed as `fabric.composeGoal`, and **is never called from the turn path**. The
only real multi-node composition is one hardcoded function.
**The validation half needs no model at all** — and it is the half that matters:
a plan that structurally cannot meet a stated hard constraint should never reach
approval.
**Risk:** MEDIUM-HIGH — planning is where an LLM most wants to become an
authority. Mitigation: the model proposes a graph; the runtime validates, binds
and decides.

### 5 — Observation → EffectAssertion bridge
**What:** Let a recorded `Observation` (append-only, provenance, freshness TTL)
serve as an `INDEPENDENT_READBACK` in the completion policy.
**Why:** The completion policy's only path to VERIFIED for an effectful capability
is a readback, and **nothing currently registers one**. Meanwhile JASIM has an
entire observation subsystem the verifier cannot see. This is a socket and a plug
that were built separately.
**Difficulty:** LOW. **Risk:** LOW — freshness and trust rules already exist.
**Impact:** it is what makes tracked physical effects verifiable, and it converts
`reconcileUncertainAttempt` from a hook into a working mechanism.

### 6 — Discovery bridge
**What:** Route real `web-research` output into `discover()` as
`WEB_OBSERVATION`s carrying the originating `attemptId`.
**Why:** Both halves exist. `web-research` fetches real, provenance-tagged
sources into a DAG node output; `discover()` normalizes, applies hard constraints
before ranking, and persists a versioned ResultSet with stable references. The
only thing that currently supplies `webResults` is **the model's own output** —
which is also the medium-severity finding in the gap analysis. The bridge closes
both at once.
**Provider:** yes. **Risk:** MEDIUM — external content entering the candidate
path; the existing `untrusted_external_evidence` / `actionable: []` rules are the
mitigation and must not be relaxed.

### 7 — Tool-description fencing
**What:** Treat MCP/A2A tool names, descriptions and schemas as untrusted input —
fenced like retrieved content, with a provider-catalog change gate.
**Why:** The clearest *external* security finding of 2026: NSA guidance, Microsoft
classifying tool descriptions as supply-chain assets, OWASP MCP Top 10 #3. JASIM
fences retrieved *content* and treats tool *metadata* as configuration.
**Difficulty:** LOW — `fenceRetrievedContent` already exists.
**Risk:** LOW. **This is the highest-value security work available.**

### 8 — Typed memory
**What:** Five memory types (preference / constraint / entity / procedural /
episodic), each with owner, TTL, correction path and retrieval rule; salience-based
retrieval instead of bulk loading.
**The asymmetry is the design:** a *Constraint* memory ("never SMS me") must
**never** be subject to salience — a policy that fails to retrieve is worse than
no memory. Everything else is ranked by recency × importance × relevance.
**Why:** JASIM already gets the hard part right — memory is advisory, canonical
state is authoritative, different tables. What is missing is typing, expiry and
selection. **Forgetting is a privacy obligation, not an optimization.**

### 9 — Presentation streaming
**What:** Stream presentation transitions over SSE during a run.
**Why:** JASIM computes one presentation per turn, so a long run is silent. It
already has the typed vocabulary for incremental updates
(ENTER/UPDATE/MORPH/EXIT/NO_CHANGE) — this is a transport, not a new model.
**Do not adopt AG-UI's authority model** (agent picks the component);
`decidePresentation` stays the decider.

### 10 — Structured "why" projection
**What:** A read-only projection answering: why this provider, why approval was
required, why the run stopped, why it replanned, why verification was inconclusive.
**Why:** Every answer is already in the database and none is exposed.
`resolveProvider` computes a `reason` that is not persisted per binding; the
completion policy's `reasonCode` and `missingEvidence` now are.
**Must expose operational facts only — never model reasoning text.**
**Difficulty:** LOW. **Impact:** this is what makes JASIM *auditable* to a user
rather than merely correct.

---

## 11–20, IN BRIEF

**11 — Prefix caching.** 50–90% input-cost reduction; break-even at 2 hits. The
free prerequisite — ordering prompts stable-prefix-first — can be done *now*,
before any provider exists.

**12 — Proactive bridge.** Six trigger kinds (AT/AFTER/DEADLINE/RECURRING/
CONDITION/EVENT) with CAS claiming already exist. Missing: a fired trigger → a
proactive turn, plus a **notification policy** (frequency, quiet hours, per-owner
caps). Risk is annoyance, and it is real.

**13 — Budget dimensions.** `maxModelCalls` is the *only* enforced ceiling. Time,
money and attempt budgets do not exist, and Level 6 cannot be bounded without them.

**14 — Conflicting evidence.** Two independent readbacks that disagree currently
resolve silently to whichever is found first. Two authorities disagreeing is a
*stronger* signal than one being unsure and deserves its own INCONCLUSIVE reason.

**15 — Circuit breakers + bulkheads.** The one real reliability gap: a failing
provider is retried per-request rather than tripped out, so one sick provider
becomes system-wide latency under load.

**16 — Verified-outcome provider feedback.** `verifiedSuccessCount` is already in
the provider tie-break and nothing appears to increment it from verified receipts.
Closing that loop makes provider selection learn **from effects** — the only
learning signal in this architecture that is not a model's opinion.

**17 — Hybrid ranking.** BM25 + vector + RRF reaches 91% recall@10 vs 78%
vector-only. RRF is normalization-free, which is exactly right for fusing
heterogeneous sources. **Ranking is not the discovery gap** — #6 is — so this
comes after.

**18 — Plan repair + replanning.** Highest impact, lowest score: it needs #3 and
#4 first, and it is where an LLM most wants to seize authority. An unreachable
implementation already exists in `api/core/task-runtime.ts` and **must not be
revived** — it predates the trust chain.

**19 — Opportunity model.** `UnusedCapacity × MatchedNeed × ConstraintCompatibility
× PositiveExpectedEconomics × Authority`. Supply exists (`AvailabilityWindow` +
`Reservation`, `DOUBLE_BOOKING = 0`). Three of five are missing. An Opportunity
must be a **proposal**, never an execution — so it needs no new trust machinery.
Prefer stable matching over auctions (latency, small-participant exclusion, and it
avoids the advertising-authority problem).

**20 — Human provider lifecycle.** Dispatch → acceptance → availability → proof →
rating → payment. `HUMAN_ACTION` already has the right rule (a person's claim is
`SELF_REPORTED`, never sufficient). Rank by **verified completion rate**, not
stars — measurable truth is the differentiator over review-based marketplaces.

---

## PART 30 — WHAT CAN BE DONE NOW WITHOUT A MODEL PROVIDER

### NOW — no provider, no model, no external dependency

| Item | Difficulty | Why it is safe to start |
|---|---|---|
| #7 Tool-description fencing | LOW | Reuses `fenceRetrievedContent` |
| #10 Structured "why" projection | LOW | Read-only over existing rows |
| #5 Observation → EffectAssertion | LOW | Both sides exist |
| #14 Conflicting-evidence outcome | LOW | ~30 lines in `decideCompletion` |
| #15 Circuit breakers / bulkheads | LOW-MED | Provider health already modelled |
| #16 Verified-outcome feedback | MED | Receipt → provider counter |
| #13 Budget dimensions | MED | Generalize the existing budget scope |
| #2 Evaluation harness | MED | Fixture-driven; real-model cases gated |
| #1 CompensationPolicy | MED | Design + executor; fixtures prove it |
| #8 Typed memory | MED | Schema + retrieval; no model to type them |
| #9 Presentation streaming | MED | Transport only |
| #12 Proactive bridge | MED | Triggers exist; policy is new |
| #11a Stable-prefix prompt ordering | LOW | Free; enables caching later |
| #4a **Plan validation** (not generation) | MED | Pure code over a plan object |

**Count: 14 of the top 20 can begin with no provider at all.** That is the most
practically useful finding in this review.

### AFTER_GEMINI — needs a model to produce or validate
#3 GoalSpec · #4b plan *generation* · #11b prefix caching validation ·
escalation routing · end-to-end eval cases

### AFTER_DISCOVERY — needs a search provider
#6 Discovery bridge · #17 hybrid ranking

### AFTER_REAL_PROVIDERS
#20 human provider lifecycle · computer use · A2A federation

### LATER / POST-LAUNCH
#18 replanning · #19 Opportunity · advertising · voice · multimodal input ·
AP2 alignment · Core Evolution activation (gated on #2)

---

## THE HONEST SUMMARY

The three things that most limit JASIM today are **planning** (#3, #4),
**compensation** (#1) and **measurement** (#2). One needs a model, two do not.

The thing that most limits *confidence* in JASIM is that nothing measures it —
which is why #2 outranks everything with higher raw impact.

END.
