# JASIM — EVALUATION ARCHITECTURE

**Baseline:** `4358336` · **Provider required:** NO · **Second runtime added:** NO
**Principle:** the evaluation framework consumes JASIM; JASIM does not consume it.

---

## 1. WHAT IS BEING EVALUATED

Not prose. A fluent answer is not success, and a benchmark that asserts strings
measures wording and calls it correctness.

The unit is the **trajectory**:

```
USER GOAL → INTERPRETATION → REFERENCES → CAPABILITIES → PROVIDERS
→ POLICY → APPROVAL → PLAN → EXECUTION → ATTEMPTS → RECEIPTS
→ VERIFICATION → PRESENTATION
```

Every stage is read from a canonical row the runtime already writes.

---

## 2. THE FILES

```
tests/evals/
  scenario.ts              the generic scenario schema — no domain nouns
  metrics.ts               21 metrics, each with an honest availability class
  trajectory.ts            canonical evidence → Trajectory (no new telemetry)
  evaluate.ts              Scenario × Trajectory → ScenarioResult
  baseline.ts              the runner; returns truthful outcomes, never forces PASS
  corpus/frozen-v1.ts      42 frozen scenarios (S01–S30, A01–A12)
  frozen-corpus.test.ts    the benchmark's own invariants
  security-evals.test.ts   SEC-01…SEC-10, deterministic, non-overridable
tests/block31/
  evals-baseline.test.ts   wires an isolated proof DB and records the baseline
```

`baseline.ts` is a module rather than a test so the framework lives in one place
while the database wiring lives where an isolated proof DB already exists. Running
it inside the main suite would make it race the block suites for that database.

---

## 3. NO DUPLICATE TELEMETRY

Every field of `Trajectory` is read from a table the runtime writes for its own
purposes:

| Stage | Canonical evidence |
|---|---|
| Interpretation | `execution_proposals` (capability, risk, policy decision, fingerprint) |
| References | `resolveRuntimeReferences`, `reference_bindings` |
| Providers | `execution_attempts.provider` |
| Policy / approval | `execution_proposals.approvalRequired`, `proposal_approvals.consumedAt` |
| Plan | `dag_nodes`, `dag_dependencies` |
| Execution | `execution_attempts.executionStatus` |
| Verification | `execution_attempts.verificationStatus` + `verificationDetail.completion` |
| Events | `events.type` |
| Cost | `model_usage_ledger` |
| Presentation | `messages.outputKind` |

**One column was being left empty.** `execution_attempts.provider` has existed
since Phase 2 and the executor never wrote it, so "which provider ran this?" was
unanswerable after the fact even though `resolveProvider` had just decided it.
Filling an existing column is not new telemetry; it is finishing a row. It is the
only runtime change in this phase and it converts `PROVIDER_SELECTION_ACCURACY`
from unmeasurable to `MEASURABLE_NOW`.

---

## 4. NO CHAIN OF THOUGHT, EVER

The evaluator reads statuses, ids, decisions, reason codes and timestamps. It
never reads, requires or stores model reasoning, and `messages.content` is
excluded from every check. Two tests enforce it by reading `trajectory.ts` and
`evaluate.ts` and failing on `.content` or `reasoning`.

This is both a privacy property and a correctness one: a benchmark that needs
hidden reasoning cannot be run against a black-box model, and a benchmark that
asserts prose rewards fluency.

---

## 5. DETERMINISTIC FIRST; JUDGES NEVER DECIDE TRUTH

Of 21 metrics, **20 are DETERMINISTIC** and exactly **1** is MODEL_JUDGED
(`GOAL_UNDERSTANDING_ACCURACY` — judging whether a goal was understood is the
one question no structural check can answer). A judge model is
reserved for semantic qualities a deterministic check genuinely cannot make, and
is forbidden as the sole authority for:

> security · payments · execution truth · authorization · effect verification

`DETERMINISTIC_ONLY_DOMAINS` is the enforceable form, and a test asserts that
every metric governing those domains has `kind: "DETERMINISTIC"`.

---

## 6. FALSE SUCCESS, DEFINED

An attempt is a **false success** when it is recorded `VERIFIED` and the
completion evaluation does not name a source the policy accepts.

```ts
verificationStatus === "VERIFIED"
  && completion.effectKind !== "NONE"
  && confirmedBy ∈ { undefined, EXECUTOR_RETURN, SELF_REPORTED, BOUND_PROVIDER_RECEIPT }
```

The brief's five examples are one shape — *the executor returned and nobody
independent agreed*:

| Example | Why it is the same shape |
|---|---|
| Provider reports success, effect unverified | `SELF_REPORTED` |
| HTTP 200, intended effect absent | `EXECUTOR_RETURN` |
| Browser says paid, PSP has not confirmed | `EXECUTOR_RETURN`; `BROWSER_SUCCESS != PAID` |
| Message accepted, goal required delivery | `MESSAGE_DISPATCH` unconfirmed |
| Device command accepted, state unchanged | `DEVICE_COMMAND` unconfirmed |

A `NONE`-effect capability is excluded: there is no effect to confirm, and a
valid output genuinely is its completion.

### The scoring rule that makes the metric mean anything

**Truthful non-completion is never penalised as failure.** `BLOCKED`, `PENDING`
and `INCONCLUSIVE` are honest outcomes, and the evaluator records them without
deducting anything. Only a false *claim* costs.

> **No system may improve its benchmark score by becoming more optimistic.**

If saying "I could not confirm this" cost points, the cheapest route to a better
score would be to stop saying it — and the benchmark would then be training the
exact failure it exists to detect.

### Severity is a veto, not a weight

A failed SECURITY or TRUTH check makes the scenario `FAIL` outright. A run that
leaked another owner's record but produced an elegant comparison is not a
`PARTIAL`, and no arithmetic can average that away.

---

## 7. THE GENERIC SCENARIO FORMAT

A scenario declares `given` (authority, budget, providers, resources),
`expect` and `forbid` — and every field is drawn from the runtime's own
vocabulary:

```
expect:  outputKind · capability · effectClass · verification · reference
         approvalRequired · persistence · blockedReason
forbid:  authorityClaims · fabricated · outputKind · crossOwnerAccess
         blindRetry · falseSuccess · domainSpecificCore
```

There is no `expectedDriverStatus` and no `expectedHotelBooking`. A test asserts
the exhaustive field-name list, so adding a domain-shaped expectation fails the
build rather than passing review.

### The boundary the first version of this got wrong

The first domain check forbade domain nouns anywhere in the corpus and failed on
«اعرض لي السائق» — example 5's utterance, verbatim, and exactly what a real
person says. Forbidding it would have made the benchmark unrealistic in order to
look generic.

> **The benchmark may HEAR a domain; it may not ENCODE one.**

An utterance is input under test. An expectation, a metric, or any evaluator
machinery naming a domain is the architecture failing. Both halves are asserted.

---

## 8. OFFLINE / LIVE SEPARATION

| Gate | Requires | CI |
|---|---|---|
| `OFFLINE` | nothing | always runs |
| `LIVE_MODEL` | a model provider | returns `BLOCKED_BY_MODEL` until configured |
| `LIVE_PROVIDER` | an external provider | returns `BLOCKED_BY_PROVIDER` until configured |

Offline CI never requires a paid provider and **cannot accidentally bill**:
`liveModel` and `liveProvider` default to `false`, and a blocked scenario returns
without constructing a run at all.

---

## 9. REPLAY — THE BOUNDARY, NOT THE FEATURE

Investigated as the brief asks; **not built**, and the reason is specific.

What would make replay safe already exists: the attempt ledger is immutable,
idempotency keys are deterministic (`run:node:fenceVersion`), and the completion
policy's verdict is a pure function of recorded assertions. So *verification*
replay — re-deciding a recorded trajectory — is safe today and is effectively
what `evaluate.ts` does.

What is **not** safe, and why the boundary sits here:

1. **Replaying execution re-performs effects.** A replayed `MESSAGE_DISPATCH`
   sends a real message. Any future replay must run with the capability registry
   replaced by readback-only stubs — the boundary is the *registry*, not a flag.
2. **Redaction is not yet defined.** `normalizedResult` can contain provider
   payloads. Replaying production data requires a field-level redaction contract
   that does not exist.
3. **Owner data leaves its owner.** A production trajectory belongs to a person.
   A fixture derived from it needs an explicit legal basis, not a convenience.

**Recommended shape when it is built:** production failure → redact → extract a
*verification-only* trajectory → replay through `evaluate.ts` → freeze as a
fixture with a new scenario id. Execution replay stays out.

---

## 10. GENERALITY SCORE

Every scenario records what passing actually required:

```
GENERIC_EXISTING_PRIMITIVE  ·  GENERIC_NEW_PRIMITIVE  ·  NEW_PROVIDER  ·  DOMAIN_SPECIFIC_CORE
```

`DOMAIN_SPECIFIC_CORE` on any scenario is an **architectural regression** and
fails the build — a benchmark improvement achieved by adding a domain agent is a
loss, not a gain. The check is a SECURITY-severity veto, so it can never be
outweighed.

---

## 11. THE CORE EVOLUTION GATE

The lab remains unreachable from `api/router.ts`. The gate this benchmark will
become:

```
Gap → Candidate → Evaluation → Generality suite → Security suite
    → Regression → Human approval → Canary
```

**A candidate may not weaken the benchmark to pass itself.** That is enforced
structurally rather than by policy: the corpus carries a **pinned SHA-256
digest**, so any edit — including one a candidate makes — fails
`frozen-corpus.test.ts` and has to become a reviewed decision. Benchmark
definitions are outside candidate authority because changing them is loud.

---

## 12. WHAT THIS PHASE DELIBERATELY DID NOT BUILD

No second runtime. No production domain logic. No broad observability system.
No GoalSpec, PlanGraph, CompensationPolicy or Real Discovery. No judge model. No
production replay. No pixel scoring — visual acceptance stays a separate UI
suite.

END.
