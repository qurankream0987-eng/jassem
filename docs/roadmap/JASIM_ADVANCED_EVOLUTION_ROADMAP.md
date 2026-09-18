# JASIM — ADVANCED EVOLUTION ROADMAP

**From:** `8bfaaeb` (execution truth closed) **To:** V1 → Level 6 → Level 7 →
Continuous Evolution
**Structured by dependency, not by phase number.** A stage begins when its entry
conditions hold, not when the previous number finishes. Several stages run in
parallel, and that is stated where it is true.

---

## THE DEPENDENCY SPINE

```
                    ┌─ S1 Measurement ──────────────────────┐
                    │   (eval harness, why-projection)      │
                    │                                       ▼
  8bfaaeb ──────────┼─ S2 Truth Completion ──────────► S4 Real Model ──┐
                    │   (compensation, observation                     │
                    │    bridge, conflict, budgets)                    ▼
                    │                                            S5 Planning
                    └─ S3 Hardening ──────────────┐                    │
                        (tool fencing, breakers,  │                    ▼
                         typed memory, streaming) │              S6 Discovery
                                                  │                    │
                                                  └────────► S7 V1 ◄───┘
                                                              │
                                                              ▼
                                                          S8 Level 6
                                                              │
                                                              ▼
                                                          S9 Level 7
                                                              │
                                                              ▼
                                                    S10 Continuous Evolution
```

**S1, S2 and S3 need no provider and can run in parallel.** That is the whole
reason this waiting period is not idle time.

---

## S1 — MEASUREMENT

*The stage that makes every later stage verifiable. It is first because without
it, "improved" is an opinion.*

**ENTRY:** execution truth closed (`8bfaaeb`). Nothing else.

**WORK**
- Trajectory evaluation harness reading the existing attempt ledger, run events,
  proposals, approvals and verification details.
- Freeze the 30 behavioural examples as benchmark **v1**: GoalSpec, fixture
  world, expected *outcome class* — never an expected string.
- Metrics: goal success · HARD-constraint compliance · **false-success rate** ·
  INCONCLUSIVE rate · clarification rate · replan rate · cost/goal ·
  model-calls/goal · user-intervention rate.
- **Generality suite**: a goal from a domain the fixtures never mention. If it
  needs new core code, generality has failed.
- **Hazard suite**: injected *recoverable* provider failures; measure diagnosis
  and recovery, not happy-path completion.
- Structured **"why" projection** (provider / approval / stop / replan /
  inconclusive) — operational facts only, never model reasoning text.

**EXIT**
- Benchmark v1 frozen, versioned, runnable in CI without a provider.
- A baseline report exists for the current build.
- `false-success rate` is measured and published.

**EVIDENCE:** a committed baseline run; the generality suite passing on a domain
absent from every fixture; the "why" projection answering all five questions from
stored rows.

---

## S2 — TRUTH COMPLETION

*Finishing what the completion policy started: JASIM can prove an effect
occurred; it must be able to undo one, see one, doubt one, and stop.*

**ENTRY:** none beyond baseline. Runs in parallel with S1 and S3.

**WORK**
- **CompensationPolicy** — a declaration attached to a capability plus a reverse
  executor. Reuses the completion policy's effect classes and claim sources.
  A compensation is itself an effect and is verified by the same machinery.
- **Observation → EffectAssertion** — an `Observation` becomes an
  `INDEPENDENT_READBACK`, turning `reconcileUncertainAttempt`'s empty socket into
  a working mechanism.
- **Conflicting evidence** — disagreeing readbacks become their own INCONCLUSIVE
  reason rather than silently resolving to the first.
- **Budget dimensions** — time, money and attempts alongside `maxModelCalls`,
  fail-closed and ambient, following the existing budget-scope pattern.
- **Circuit breakers + bulkheads** on provider calls.
- **Verified-outcome feedback**: a verified receipt increments the provider
  counter the tie-break already reads.

**EXIT**
- A run that half-succeeds can be compensated, and the compensation is verified.
- No effectful capability can reach VERIFIED without a registered readback.
- A run can be stopped by a time or money ceiling, not only a model-call ceiling.

**EVIDENCE:** a fixture run where step 2 succeeds, step 3 fails, compensation
executes and is independently verified; a conflicting-evidence case producing
INCONCLUSIVE; a budget-exhausted run terminating truthfully.

---

## S3 — HARDENING & EXPERIENCE

*Provider-free work that removes the clearest external security finding and the
loudest product complaint.*

**ENTRY:** none. Parallel with S1 and S2.

**WORK**
- **Tool-description fencing** for MCP/A2A metadata, plus a provider-catalog
  change gate. (NSA / Microsoft / OWASP, 2026.)
- **Egress allowlist** for provider HTTP (SSRF).
- **Typed memory**: five types, TTL, correction path, salience retrieval —
  with Constraint memories exempt from salience by design.
- **Presentation streaming** over SSE using the existing transition vocabulary.
- **Proactive bridge**: fired trigger → proactive turn, behind a notification
  policy (frequency, quiet hours, per-owner caps, authority, budget, privacy).
- **Stable-prefix prompt ordering** — free now, enables caching later.
- **Plan *validation*** (not generation): given a plan object, prove in pure code
  that every HARD constraint has a step and every input is bound or asked for.

**EXIT**
- No untrusted provider metadata reaches a prompt unfenced.
- A long run is visibly progressing rather than silent.
- A proactive notification cannot exceed its owner's policy.

**EVIDENCE:** an injection attempt via a tool description that is fenced and
logged; a streamed run captured in a real browser; a notification-policy test
that refuses to over-notify.

---

## S4 — FIRST REAL MODEL PROVIDER

*The gate that has been waiting since Wave 2.1.*

**ENTRY:** a development credential exists. S1 is complete enough to measure the
before/after.

**WORK**
- `REAL_PROVIDER_ACCEPTANCE` against the real gateway: cost validation, real
  Arabic conversation acceptance, real generality mini-gate, real failure modes.
- **Prefix caching** enabled and measured against the ledger.
- Close the last UI-2.1 evidence gaps (scenarios C–F, I–L inside the assembled
  shell) which require a conversation that produced a real surface.
- Escalation routing — **on schema-validation failure and unclean finish reasons
  only, never on a judge model's opinion.**

**EXIT**
- `REAL_PROVIDER_ACCEPTANCE = PASS` with real cost figures from the ledger.
- Benchmark v1 has a with-model baseline beside its fixture baseline.

**EVIDENCE:** ledger rows with real spend; before/after benchmark reports;
the remaining shell captures.

---

## S5 — PLANNING

*The largest single capability gap in JASIM, and the one everything at Level 6
depends on.*

**ENTRY:** S4 (needs a model) and S1 (needs measurement to prove it helped).
S3's plan-validation work is already done and is reused here.

**WORK**
- **GoalSpec** — typed, allowlisted, `.strict()`: outcome, constraints with
  `hardness`, preference ordering, assumptions, unknowns.
- **PlanGraph** — call `composeRequirementGraph` from the turn path instead of
  mapping `requiredCapabilities` to flat nodes. The DAG engine already supports
  dependencies, bindings and cycle detection; the planner simply stops refusing
  to use them.
- Retire `isResearchImageCompositionIntent` — the hardcoded composition becomes
  one output of the general planner, which is the test that the planner is real.
- **Plan scoring** from provider metadata that already exists (`costClass`,
  `latencyClass`, `verifiedSuccessCount`).
- **Alternative-plan comparison** surfaced as a CHOICE, which the presentation
  layer already renders.

**EXIT**
- A multi-step goal produces a dependency graph with bindings, from the
  conversation, with no hardcoded intent matcher.
- A plan that cannot satisfy a stated HARD constraint is refused **before**
  approval, with a truthful explanation.
- The research→image composition is produced by the planner, not by a special case.

**EVIDENCE:** «رتب لي الموضوع بأرخص طريقة لكن لا تتأخر أكثر من يومين» yields a
GoalSpec with `COST` and `TIME(HARD, 48h)`, a validated PlanGraph, and a refusal
when no plan can meet the deadline. Benchmark v1 improves on constraint
compliance without regressing false-success rate.

---

## S6 — REAL DISCOVERY

**ENTRY:** a search provider is available; S5 (a GoalSpec supplies the hard
constraints discovery filters on).

**WORK**
- **The bridge**: real `web-research` output → `discover()` as `WEB_OBSERVATION`s
  carrying the originating `attemptId`, closing the medium-severity provenance
  finding at the same time.
- Require a canonical `attemptId` on every `WEB_OBSERVATION` — a retrieval that
  did not happen cannot claim a `retrievedAt`.
- Entity resolution and deduplication across sources.
- **Hybrid ranking** — BM25 + vector + RRF, fused on rank so heterogeneous
  sources need no score calibration.
- Diversity, freshness and provenance in the ResultSet; stable references out.

**EXIT**
- A real query returns normalized, deduplicated, constraint-filtered candidates
  with true provenance and stable references.
- No candidate reaches `actionable` without a canonical binding.

**EVIDENCE:** a real search producing a versioned ResultSet; a fabricated
`webResults` payload rejected for want of an `attemptId`.

---

## S7 — JASIM V1 PRODUCTION

**ENTRY:** S1–S6 complete.

**WORK:** secret storage; staging deployment; production runbooks; load and
latency baselines; disaster recovery rehearsal; the four security items from the
gap analysis closed and re-verified; mobile visual acceptance to the web's
standard; privacy and data-retention policy implemented (memory TTLs are part of
this, not an optimization).

**EXIT**
- `false-success rate` measured in staging and inside its stated bound.
- Every security gap ranked HIGH or MEDIUM closed or explicitly accepted, in
  writing, by the owner.
- A rehearsed rollback.

**EVIDENCE:** a staging run of benchmark v1; a recovery rehearsal report; a
signed-off security register.

---

## S8 — LEVEL 6: BOUNDED AUTONOMY

`Goal → Plan → Act → Observe → Verify → Repair → Replan` under Authority, Policy,
Budget, Time, Risk, Termination.

**ENTRY:** S7. Specifically: planning (S5), compensation (S2), budget dimensions
(S2), observation-as-evidence (S2), measurement (S1). **Level 6 is not a feature;
it is what those five make possible.**

**WORK**
- **Plan repair** — re-bind or re-select a provider for one failed node without
  rebuilding the plan.
- **Replanning** — the model proposes, the runtime validates and decides. Never
  revive `api/core/task-runtime.ts`.
- **Semantic termination** — stop when the goal is met, when the budget is spent,
  when no plan can satisfy the hard constraints, or when the owner's authority
  window closes. `MAX_ITERATIONS = 50` is a loop guard, not a termination
  condition.
- **Autonomy tiers** — oversight from confidence, risk and *cumulative budget
  spent*, not capability risk alone.

**EXIT**
- An autonomous run recovers from a provider failure without a human, and stops
  truthfully when it cannot.
- Every autonomous run terminates for a *stated* reason.
- Replan rate and intervention rate are measured and bounded.

**EVIDENCE:** hazard-suite runs where the agent diagnoses an unreliable provider,
repairs, and completes — and a matched set where it correctly gives up and says
why.

---

## S9 — LEVEL 7: ECONOMIC INTELLIGENCE

**ENTRY:** S8, plus real demand discovery (S6) and a payments decision.

**WORK**
- **Opportunity** as a generic type:
  `UnusedCapacity × MatchedNeed × ConstraintCompatibility ×
   PositiveExpectedEconomics × Authority`, modelled on perishable utility —
  capacity whose value decays to zero at an expiry.
- Need discovery (the demand side of S6).
- Expected economics: expected value − expected cost − risk.
- **Stable matching, not auctions** — lower latency, no small-participant
  exclusion, and it avoids money entering the ranking authority.
- An Opportunity is a **proposal**. It reuses the existing proposal/approval
  chain and therefore needs no new trust machinery.
- Sponsored Discovery *design* only: `OrganicRanking` computed by code that
  **cannot see** sponsorship data; `SponsoredRanking` behind a relevance floor;
  `FinalPresentation` interleaving with mandatory labelling; a sponsored
  candidate is never `actionable` in an autonomous run.

**EXIT**
- JASIM proposes a matched opportunity with stated expected economics, and never
  executes one without authority.
- `SPONSORED != BEST` is enforced by module boundaries, not by documentation.

---

## S10 — CONTINUOUS EVOLUTION

**ENTRY:** S1 complete and trusted. **This is the hard gate** — without the
evaluation harness, "regression suite" is a sentence rather than a check.

**WORK:** observed failure → generic gap → candidate improvement → isolated lab →
regression + security + **generality** suites → human approval → canary → release.

**EXIT / permanent invariants**
- No live self-modification.
- No self-authorized release.
- Core Evolution remains unregistered in `api/router.ts` until a human registers
  a released artifact.
- A candidate that requires a domain-specific core is **rejected by the generality
  suite**, automatically.

---

## WHAT THIS ROADMAP DELIBERATELY DOES NOT CONTAIN

No domain agents. No second runtime. No external workflow engine. No reflection
loops. No judge model with authority. No semantic answer caching. No
model-generated UI code. No blended sponsored ranking. No vector store for
canonical identity. The reasoning for each is in §31 of the gap analysis.

---

## THE ONE-LINE VERSION

**S1–S3 need nothing and can start today. S4 needs one credential. S5 is the
largest real gap. Everything at Level 6 and 7 is downstream of S5 and S2.**

END OF ROADMAP.
