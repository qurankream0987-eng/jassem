# JASIM — COMPLETION WAVE 2: PRODUCTION MODEL GATEWAY + AI COST CONTROL

**Branch:** `claude/runtime-experience-wave-1`
**Production touched:** NO · **Database schema changed:** NO · **Real model:** NO · **Real money:** NO

> A copy also exists at `.local/tasks/jasim-production-model-gateway-report.md`.
> `.local/` is gitignored, so this committed copy is the one that survives.

---

## 1. PART 1 — AUDIT FIRST. NO SECOND GATEWAY WAS BUILT.

The instruction was explicit: *do not create a second gateway if a usable generic
foundation already exists*. One does. Every line below is an addition to it or a
correction of it.

| Item | Lines | Classification | Note |
|---|---|---|---|
| `api/runtime/model-gateway.ts` | 567 → 638 | **ACTIVE_PRODUCTION_READY** | 4 providers, tier selection, per-tier fallbacks, usage recording |
| `api/runtime/model-policy.ts` | 198 → 265 | **ACTIVE_PRODUCTION_READY** | T0–T3, 11 purposes, `ModelTaskProfile`, `ModelBudget` |
| `api/runtime/model-usage-ledger.ts` | 146 → 224 | **ACTIVE_PRODUCTION_READY** | append-only, no prompt text, no PII |
| `api/runtime/model-cost.ts` | 270 | **ACTIVE_PRODUCTION_READY** | added in the previous wave; prices from config, never hardcoded |
| `db/schema-runtime.ts` → `jasim_model_usage_ledger` | — | **ACTIVE_PRODUCTION_READY** | already carries `estimatedCost`, `actualProviderCost` |
| `ModelBudget.maxModelCalls` | — | **REAL_UNCONNECTED → now ACTIVE** | declared since Phase 12, **never enforced**. This wave enforces it. |
| `capability-registry.ts` → `callOpenAiChat` | 58 | **ACTIVE_PARTIAL / BYPASSED THE GATEWAY** | called `fetch` directly. See §3. |
| 5 `modelGateway.generate(...)` sites in `jasim-runtime.ts` | — | **ACTIVE_PRODUCTION_READY** | world generation, output routing, bubble mutation, memory extraction, conversation summary |
| `ModelSelectionDecision.cachePolicy` | — | **STUB** | always `"UNSUPPORTED"`; nothing reads it. Left as-is and disclosed. |

`FOUNDATION_REUSED = YES` · `SECOND_GATEWAY_CREATED = NO`

---

## 2. PART 6 — `maxModelCalls` IS NOW ENFORCED (G5 CLOSED)

### 2.1 Why the obvious fix would have been worse than nothing

The natural reading is "check `budget.maxModelCalls` inside `generate()`". Three
reasons that is wrong, and they are the reason this took a new module:

1. **The budget came from the caller of `generate()`.** A limit the limited code
   supplies is not a limit.
2. **It defaults to 1.** Enforced per request it would cap every request at one
   provider attempt — silently disabling tier fallback. A ceiling that breaks
   failover is a regression wearing a safety label.
3. **One `generate()` call is the wrong unit.** The runaway case is a planner
   loop issuing fifty calls, each individually within its own budget.

### 2.2 What was built

`api/runtime/model-call-budget.ts` — an ambient scope carried by
`AsyncLocalStorage`:

- opened at boundaries the client never reaches;
- **no `release()`** — a spent attempt stays spent;
- a nested scope can only narrow (`Math.min` against the parent's *remaining*);
- a request above the deployment ceiling is clamped, not honoured.

### 2.3 The enforcement point, and why it sits where it does

```ts
try { reserveModelCall(reason); }
catch (error) { lastError = error; candidateExhaustedBudget = true; break; }
attemptsMade += 1;
// ... only now is the provider contacted
```

Every provider attempt — primary, fallback **and** retry — commits a slot
*before* any network call. Because the refusal happens before the request rather
than after it, the `break` leaves the candidate loop as well, which is what makes
the third requirement true: a refused call cannot be re-attempted through another
provider.

### 2.4 Concurrency

`reserve()` is synchronous, with no `await` between reading `reserved` and
incrementing it. On Node's single-threaded loop that read-modify-write is atomic.
A version that awaited anything first would let every racer see the same free
slot.

Proven, not asserted: 12 concurrent `generate()` calls in a 3-call scope produce
**exactly 3 fulfilled, 9 rejected, and 3 `fetch` calls**.

### 2.5 The two trusted boundaries

| Boundary | File | Covers |
|---|---|---|
| tRPC | `api/trpc.ts` | every procedure, public and authed, **without opting in** |
| Durable jobs | `api/core/durable-job-worker.ts` | background work, which has no request around it |

The tRPC middleware is applied to the base procedure that both `publicQuery` and
`authedQuery` derive from, and it runs *before* `requireAuth`, so an
unauthenticated request that somehow reached a model is bounded too. A test
passes `{ maxModelCalls: 9999 }` as procedure input and observes the configured
ceiling of 2 — the request cannot reach the limit.

```
MAX_MODEL_CALLS_ENFORCED        = YES
ENFORCEMENT_AT_TRUSTED_BOUNDARY = YES
CONCURRENCY_BYPASS              = 0
REJECTED_CALL_CONTINUES         = NO
```

### 2.6 What is deliberately *not* fail-closed

`JASIM_MODEL_BUDGET_ENFORCEMENT` defaults to `SCOPED`: the ceiling binds wherever
a scope is open, and unscoped code (tests, migrations, one-off scripts) still
runs. `STRICT` refuses to invoke a model outside a scope at all, so a deployment
that wants to *prove* no path escapes can set it. Making `STRICT` the default
would have broken every script in the repo on the day it shipped; it is offered
rather than imposed, and this sentence is here so the choice is visible.

---

## 3. THE HOLE THE AUDIT FOUND: A SECOND, UNGOVERNED MODEL PATH

`callOpenAiChat` in `capability-registry.ts` called the provider with a bare
`fetch`. No tier policy, no usage ledger, no cost estimate — and, the moment the
call budget existed, **no ceiling**. A plan step could have spent without limit
while every runtime path was bounded. A budget one code path can walk around is
not a budget.

It now goes through `modelGateway`. Two things had to change to make that honest
rather than merely tidy:

- **`responseFormat: "json" | "text"`** was added to the gateway request
  (default `"json"`, preserving every existing caller). The gateway hardcoded
  `response_format: { type: "json_object" }`; routing a prose chat capability
  through it unchanged would have started returning JSON to users.
- **`inputs.model` is no longer honoured by default.** A plan step's inputs are
  model-authored, so letting them name a model let an untrusted proposal pick the
  most expensive one available. A requested model is used only if it appears in
  `JASIM_CAPABILITY_MODEL_ALLOWLIST`; otherwise tier policy chooses.

The returned shape is unchanged, because `execution-verifier.ts` verifies it.
`finishReason` is now `"unreported"` — the gateway normalizes four provider
shapes and does not surface a vendor stop reason. Saying so is accurate;
inventing `"stop"` would be a claim nobody made.

```
UNGOVERNED_MODEL_PATHS_BEFORE = 1
UNGOVERNED_MODEL_PATHS_AFTER  = 0
```

---

## 4. PART 7 — CONTEXT BUDGETING

`api/runtime/model-context-budget.ts`.

An oversized request fails two ways. The provider rejects it — one wasted round
trip — or it **silently truncates**, answers confidently from half the context,
and nothing downstream can tell. The second is the dangerous one because it is
indistinguishable from success, so the check happens before dispatch:

```
MODEL_CONTEXT_TOO_LARGE: OUTPUT_ROUTING (T1) is an estimated 25008 input tokens,
above the 500-token limit (DECLARED_BUDGET). The request was not sent, so
nothing was truncated silently.
```

It runs **once, before the candidate loop** — an oversized prompt is oversized
for every model, so paying four fallbacks to learn that would be spend with no
possible outcome. It also runs before the first reservation: refusing to send
costs nothing and should not consume an allowance.

**Token counts are estimates and are named as such.** JASIM does not ship four
vendor tokenizers whose vocabularies change without notice. The heuristic splits
ASCII (÷4) from everything else (÷2), because JASIM is Arabic-first and counting
Arabic at the Latin rate under-counts by a factor of two or more on exactly the
prompts that matter most. It errs high on purpose: under-estimating would let an
oversized prompt through, which is the failure the module exists to prevent.

`JASIM_MODEL_MAX_INPUT_TOKENS` is an absolute ceiling a caller **cannot widen** —
a declared budget narrows it, never the reverse. That is the runaway guard for a
planner that concatenates its own growing history into a prompt.

### Stable reference preservation

`selectWithinTokenBudget` keeps pinned segments, fills the rest newest-first, and
**preserves original order** — a conversation reordered by size is a different
conversation. It returns `droppedIds` and `reduced` rather than hiding the
reduction, and if the pinned segments alone exceed the budget it **throws instead
of dropping one**: a summary that drops the reference keys a later turn will be
asked to resolve has not compressed the conversation, it has corrupted it.

```
CONTEXT_BUDGET_ENFORCED       = YES
MODEL_CONTEXT_TOO_LARGE_ERROR = YES
STABLE_REFERENCES_PRESERVED   = YES
```

---

## 5. PART 8 + PART 20 — MODEL OUTPUT IS DATA, NEVER AUTHORITY

`api/runtime/model-output-trust.ts`. Two classes, two different answers:

- **AUTHORITY keys are rejected.** `paid`, `settled`, `verified`, `ownerId`,
  `policyOverride`, `serverSignature`, … There is no benign reason for a model to
  emit one; it is either an injection landing or a prompt bug, and both deserve
  to be loud. Silently stripping would hide an attack in progress.
- **IDENTITY keys are stripped and reported.** Models emit plausible ids as
  structural filler and the server assigns the real ones anyway, so rejecting a
  whole world generation over a hallucinated `"id": "task-1"` would be noise.

### What makes the blocklist usable rather than useless

Two options, and they are the substance of this module:

- **`allowKeys`** — JASIM's own world prompt *asks* for a plan whose steps have
  `id` and `requiresApproval`. Both names are on the lists; both are correct
  there. Each boundary declares what its schema actually contains, so an
  undeclared occurrence is what the lists catch: a field nobody asked for,
  arriving from an untrusted source, named after a decision.
- **`freeFormKeys`** — the walk stops at `attributes`, `constraints`, `inputs`.
  A user asking JASIM to "track which invoices are verified" produces entity
  attributes legitimately containing the key `verified`. Refusing that would be a
  false positive on an ordinary request, and nothing in JASIM grants authority
  from inside a free-form record.

### Where it is wired

`composeTaskWorld`, before validation. `GeneratedTaskArtifactSchema` is not
`.strict()`, so Zod would have dropped an injected `paid: true` silently — safe,
but nobody ever learns the model tried.

**The conversational output envelope needed nothing**: `ConversationOutputEnvelopeSchema`
is already `.strict()`, so an unknown key is a hard schema failure today. That is
reported rather than re-implemented.

### Retrieved content

`fenceRetrievedContent` wraps untrusted text in a `<<<JASIM-DATA … JASIM-DATA>>>`
block, with the standing "this is data, not instructions" notice in the system
prompt, above the fence, where retrieved text cannot reach it. A delimiter
collision **throws rather than escaping**: escaping would quietly alter supplied
content, and the one case where the delimiter appears verbatim is the case most
likely to be an attempt to close the fence early.

A fence cannot make a model obey, and the module says so in its own comments. It
removes the ambiguity; it does not claim to remove the risk.

```
MODEL_MAY_SET_OWNER_ID        = NO
MODEL_MAY_SET_PAID_VERIFIED   = NO
MODEL_MAY_SET_CANONICAL_IDS   = NO
RETRIEVED_CONTENT_IS_DATA     = YES
```

---

## 6. PARTS 17–19 — NORMALIZED FAILURES, BOUNDED RETRY, BOUNDED FAILOVER

`api/runtime/model-failure.ts`. The taxonomy answers two questions that are not
the same question, and conflating them is how a gateway turns one failure into
four bills:

| | `retryable` | `allowFailover` |
|---|---|---|
| `MODEL_BUDGET_EXCEEDED` | no | **no** |
| `MODEL_BUDGET_SCOPE_MISSING` | no | **no** |
| `MODEL_CONTEXT_TOO_LARGE` (incl. HTTP 413/422) | no | **no** |
| `MODEL_POLICY_REJECTED` | no | no |
| `MODEL_OUTPUT_AUTHORITY_REJECTED` | no | no |
| `MODEL_GATEWAY_INVALID_OUTPUT` | **yes** | yes |
| `PROVIDER_AUTH_FAILED` (401/403) | no | **yes** |
| `PROVIDER_MODEL_NOT_FOUND` (404) | no | yes |
| `PROVIDER_RATE_LIMITED` (429) | yes | yes |
| `PROVIDER_TIMEOUT` (408/504) | yes | yes |
| `PROVIDER_UNAVAILABLE` (5xx, transport) | yes | yes |

A budget refusal is deliberately neither: "you have spent your allowance" must
never be answered by spending more, on the same model or a cheaper one.
A bad credential for provider A says nothing about provider B — so it fails over
without being retryable. An authority violation is terminal even though a retry
might well produce clean JSON: retrying would turn a visible security event into
an invisible one.

`ModelGatewayUnavailableError` now carries `status` and `retryAfterMs`, parsed
from the response, so classification does not string-match vendor prose that a
provider may rewrite tomorrow.

**Retries are one by default, clamped to three**, and every retry spends a real
budget slot. A provider that failed twice is telling JASIM something a third
attempt will not change. `Retry-After` is honoured over the built-in backoff.

```
FAILURES_NORMALIZED    = YES
RETRIES_BOUNDED        = YES (default 1, ceiling 3, each metered)
FAILOVER_BOUNDED       = YES (candidate list only, budget-gated per attempt)
```

---

## 7. PARTS 2–5 — PROVIDER-NEUTRAL SEMANTIC TIERS

`T1/T2/T3` say where a model sits in a ladder; they do not say what the ladder is
*for*. `semanticTier`/`tierFromSemantic` add `DETERMINISTIC / FAST_CHEAP /
BALANCED / STRONG_REASONING` as an **alias, not a second scale** — a second scale
would eventually disagree with the first. The round trip is tested in both
directions, and the names are asserted to contain no vendor string.

`cheapestSufficientTier` states in one place what `selectModelPolicy` already
does across a dozen conditions (every rule moves *up* from a purpose default,
none moves down) and returns the reasons alongside the tier, so a routing
decision is never a number without a justification.

**A finding worth reading twice, now pinned by a test:** `purpose:
"WORLD_GENERATION"` on a hand-written profile routes **FAST_CHEAP**, not
STRONG_REASONING. It is the separate `worldGeneration` *flag* that escalates, and
`tierFromPurpose()` is what sets both together. A caller who writes a profile by
hand and names only the purpose silently gets a cheaper model than the name
implies. Nothing in production does this — all five call sites set the flags —
but the trap is real and is now documented by an assertion rather than by this
paragraph alone.

---

## 8. PARTS 13–16 — METERING, AGGREGATION, RUNAWAY LIMITS

`breakdownModelCost({ ownerId, dimension })` groups owner-scoped usage by
`provider`, `modelId`, `tier` or `purpose`, alongside the existing
`summarizeModelCost`.

Grouping is done in application code, **not in SQL**, on purpose: `complete` is
not a sum, it is a claim that nothing in the bucket was unpriced, and
`SUM(estimatedCost)` would treat a NULL as absent and report a confident total
over partial data. A total of $0.12 across 40 calls means something very
different when 38 were unpriced.

Failed calls are counted, never silently excluded: a failover storm that burned
forty attempts and returned nothing still cost money.

Runaway limits now in force, all three server-side:

| Guard | Mechanism | Config |
|---|---|---|
| Calls per unit of work | ambient scope, reserve-before-spend | `JASIM_MODEL_MAX_CALLS_PER_SCOPE` (8) |
| Input size | pre-dispatch estimate, caller cannot widen | `JASIM_MODEL_MAX_INPUT_TOKENS` (200 000) |
| Cost per candidate | pre-flight worst-case, per candidate | `budget.maxEstimatedCost` + `JASIM_MODEL_PRICES` |
| Retries | clamped, each metered | `JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE` (1, ≤3) |

---

## 9. SECRETS

No credential is committed, logged, or reachable from web, mobile, presentation
or model prompts. **Names only**, as required:

`JASIM_MODEL_PROVIDER`, `JASIM_MODEL`, `JASIM_MODEL_{T1,T2,T3}`,
`JASIM_MODEL_{T1,T2,T3}_PROVIDER`, `JASIM_MODEL_{T1,T2,T3}_FALLBACKS`,
`JASIM_MODEL_PRICES`, `JASIM_MODEL_MAX_CALLS_PER_SCOPE`,
`JASIM_MODEL_MAX_INPUT_TOKENS`, `JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE`,
`JASIM_MODEL_BUDGET_ENFORCEMENT`, `JASIM_CAPABILITY_MODEL_ALLOWLIST`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_API_KEY`, `GEMINI_API_KEY`,
`MODEL_GATEWAY_API_KEY`, `MODEL_GATEWAY_BASE_URL`,
`AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`.

The usage ledger stores operational metadata only — never prompt text, model
output, credentials, or PII beyond canonical owner identifiers. Model cost is
telemetry and never reaches `economic_ledger_entries`.

---

## 10. PARTS 22–24 — WHAT COULD NOT BE PROVEN, STATED PLAINLY

No provider credential exists in this environment. The gateway was run for real
against that fact:

```
CREDENTIAL_VARS_PRESENT = (none)
REAL_PROVIDER_ACCEPTANCE = BLOCKED_BY_ENVIRONMENT
  category  = PROVIDER_AUTH_FAILED
  retryable = false
  failover  = true
  message   = No model service is configured. Configure JASIM_MODEL_PROVIDER
              with its provider API key before creating a task.
```

It refused, truthfully, with the right category. **No PASS was fabricated.**

What this blocks, and nothing else was substituted for it:

- **Parts 9–10**, real natural-language intent over the generic pipeline, and
  the four Arabic unseen-generality prompts of Part 24. Ambiguity → CHOICE is
  already live and proven from Wave 1.2, but it is **structural** (two candidates
  exist) rather than **semantic** (a sentence was understood). That gap is
  unchanged by this wave.
- **Parts 11–12**, real provider adapters end to end. Four adapters exist and are
  exercised against stubbed transport only. `MULTI_PROVIDER_FAILOVER = NOT_CONFIGURED`.
- **Part 23** scenarios A–G in their live form.

Everything the gateway does *before* the provider responds — routing, budgeting,
context refusal, failover ordering, ledger writes, failure classification — is
proven against a stubbed transport, which is a real proof of those paths and not
a proof of the provider ones.

---

## 11. TESTS

| Suite | Result |
|---|---|
| New: `tests/unit/model-call-budget.test.ts` | **20 / 20** |
| New: `tests/unit/model-context-and-trust.test.ts` | **42 / 42** |
| Main suite (58 files) | **889 / 889** (830 + 59) |
| Block 2 | **101 / 101** |
| Block 3 | **133 / 133** |
| Block 3.1 | **65 / 65** |
| `tsc -b` | **PASS** (exit 0) |
| Web build | **PASS** (8.34s) |

**No inherited test was modified in this wave. No assertion was weakened.**

One test I wrote failed first, and the failure was mine: I asserted
`purpose: "WORLD_GENERATION"` routes STRONG_REASONING and it routes FAST_CHEAP.
I corrected the expectation, not the behaviour, and kept the finding as its own
test (§7).

---

## 12. COUNTERS

```
WAVE_2                            = PASS (with the environment blocks in §10)

FOUNDATION_REUSED                 = YES
SECOND_GATEWAY_CREATED            = NO

MAX_MODEL_CALLS_ENFORCED          = YES
ENFORCEMENT_AT_TRUSTED_BOUNDARY   = YES
CONCURRENCY_BYPASS                = 0
REJECTED_CALL_CONTINUES           = NO
UNGOVERNED_MODEL_PATHS            = 0

CONTEXT_BUDGET_ENFORCED           = YES
MODEL_CONTEXT_TOO_LARGE_ERROR     = YES
STABLE_REFERENCES_PRESERVED       = YES

MODEL_MAY_SET_OWNER_ID            = NO
MODEL_MAY_SET_PAID_VERIFIED       = NO
MODEL_MAY_SET_CANONICAL_IDS       = NO
RETRIEVED_CONTENT_IS_DATA         = YES

FAILURES_NORMALIZED               = YES
RETRIES_BOUNDED                   = YES
FAILOVER_BOUNDED                  = YES
SEMANTIC_TIERS_PROVIDER_NEUTRAL   = YES
COST_AGGREGATION_DIMENSIONS       = 4 (provider, model, tier, purpose)

REAL_PROVIDER_ACCEPTANCE          = BLOCKED_BY_ENVIRONMENT
MULTI_PROVIDER_FAILOVER           = NOT_CONFIGURED
REAL_NL_INTENT_SCENARIOS          = BLOCKED_BY_ENVIRONMENT
UNSEEN_GENERALITY_MINI_GATE       = BLOCKED_BY_ENVIRONMENT
DOMAIN_CODE_PATCHED_FOR_A_PROMPT  = 0

MAIN_SUITE                        = 889 / 889
BLOCK_2                           = 101 / 101
BLOCK_3                           = 133 / 133
BLOCK_3_1                         = 65 / 65
TYPECHECK                         = PASS
WEB_BUILD                         = PASS
INHERITED_TESTS_MODIFIED          = 0

REAL_MODEL_USED                   = NO
REAL_MONEY_USED                   = NO
PRODUCTION_DATABASE_TOUCHED       = NO
SECRETS_COMMITTED                 = 0
AUTHENTICATION_WEAKENED           = NO
ARCHITECTURE_FREEZE_VIOLATIONS    = 0
```

---

## 13. WHAT A REVIEWER SHOULD DOUBT FIRST

1. **`AsyncLocalStorage` is load-bearing.** If any path ever hops contexts — a
   raw `setTimeout` chain that outlives the request, a worker thread, a queue
   that resumes a continuation elsewhere — the scope is lost and, under the
   default `SCOPED` mode, the call proceeds **unbounded**. `STRICT` converts that
   silent hole into a loud failure, and a deployment that cares should run it.
   This is the single most important line in the report.
2. **Four provider adapters, zero real calls.** Every provider path is proven
   against a stubbed `fetch`. The routing, the budgeting and the classification
   are real; the wire format for anthropic, gemini and openai-compatible is as
   trustworthy today as it was before this wave, which is to say untested.
3. **The token estimator is a heuristic.** ÷4 ASCII, ÷2 otherwise. It is honest
   about being an estimate and it errs high, but a deployment whose real
   tokenizer is worse than 2 chars/token on some script would still be
   under-counting. The absolute ceiling is the backstop, not the estimator.
4. **The authority key list is a blocklist.** Blocklists are incomplete by
   construction. `allowKeys` and `freeFormKeys` make it usable, but a privileged
   field named something not on the list passes. It raises the cost of an
   injection; it does not close the class.
5. **`callOpenAiChat` behaviour changed.** `finishReason` is now `"unreported"`
   and `inputs.model` is ignored unless allow-listed. `execution-verifier.ts`
   does not read `finishReason`, and Block 3.1 stays 65/65 — but this is a
   behaviour change to a registered capability and should be read as one.
6. **The default ceiling of 8 is a judgement, not a measurement.** It is
   comfortably above the longest current path (one routing call plus fallbacks)
   and far below a runaway loop. No production trace was available to calibrate
   it against.

END OF WAVE 2 REPORT.
