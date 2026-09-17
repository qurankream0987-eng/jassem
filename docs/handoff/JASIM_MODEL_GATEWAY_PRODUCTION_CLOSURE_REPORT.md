# JASIM — WAVE 2.1: MODEL GATEWAY PRODUCTION HARDENING

**Branch:** `claude/runtime-experience-wave-1` · **Wave 2 baseline:** `a8ef5e2`
**Production touched:** NO · **Schema changed:** NO · **Real model:** NO · **Real money:** NO · **Deployed:** NO

---

## 0. THE HEADLINE, BEFORE THE DETAIL

Wave 2.1 had two halves. **The hardening half is done.** The
**real-provider half could not be started**, because no provider credential
exists in this environment — Part 6 asks for one "supplied through environment
secrets" and none was. Parts 6 through 10 are therefore
`BLOCKED_BY_ENVIRONMENT`, and nothing was substituted for them.

The session does carry `ANTHROPIC_BASE_URL`, pointing at the Claude Code agent
proxy. That is this coding session's own credential path, not one supplied for
JASIM to use, and routing JASIM's production traffic through it would have
produced a "real provider acceptance" line backed by a credential the project
does not own. It was not used.

What that means for the gate: **everything that can be proven without spending
money is proven; nothing about a real provider is claimed.** The work is
arranged so that supplying one credential and running one command completes the
remaining parts — see §10.

---

## 1. PART 1 — BUDGET ENFORCEMENT NOW FAILS CLOSED

### 1.1 The finding this closes

Wave 2's own report named it as the first thing a reviewer should doubt:

> If any path ever hops contexts … the scope is lost and, under the default
> `SCOPED` mode, the call proceeds **unbounded**.

The default has been inverted, and the inversion goes further than flipping a
value.

```ts
export function configuredEnforcement(): ModelCallBudgetEnforcement {
  if (isProductionRuntime()) return "STRICT";
  return process.env.JASIM_MODEL_BUDGET_ENFORCEMENT?.trim().toUpperCase() === "SCOPED"
    ? "SCOPED"
    : "STRICT";
}
```

Three properties, each tested:

1. **Unset is strict.** Fail-closed is what you get by doing nothing.
2. **A typo is strict.** `"scoped_"`, `"SCOPE"`, `"false"`, `""` — all strict.
   Only the exact string relaxes it.
3. **Production does not read the variable at all.** There is no value anyone
   can set, by accident or on purpose, that makes a production deployment call a
   model outside a budget context.

Point 3 is the one that answers the brief's actual requirement — *do not depend
solely on an environment variable being manually configured correctly*. An
unset variable, a container that drops its environment, a new deploy target
nobody remembered: each of those previously selected the unsafe mode silently,
and the symptom was a bill.

The failure is `MODEL_BUDGET_CONTEXT_MISSING`, raised **before** the provider is
contacted. Proven: a gateway call with no context makes zero `fetch` calls.

### 1.2 What it cost

Nothing. Flipping the default broke **three tests, all of them mine from Wave
2**, and no inherited test at all. Fail-closed turned out to be free, which is
worth recording because "we can't, it would break too much" is the usual reason
this kind of default never gets fixed.

```
MODEL_BUDGET_FAIL_CLOSED = PASS
```

---

## 2. PART 2 — ASYNC BOUNDARIES, MEASURED RATHER THAN ASSUMED

Wave 2 asserted that `AsyncLocalStorage` carries the context. Asserting is not
proving, and the patterns genuinely differ.

| Boundary | Classification | Evidence |
|---|---|---|
| Promise chains | `CONTEXT_PRESERVED` | test |
| `setTimeout` / `setImmediate` / nested timers | `CONTEXT_PRESERVED` | test |
| `queueMicrotask` | `CONTEXT_PRESERVED` | test |
| `Promise.all` fan-out | `CONTEXT_PRESERVED` | test — **one shared counter, not N clones** |
| Database awaits | `CONTEXT_PRESERVED` | ordinary promise await |
| Provider retry / tier escalation | `CONTEXT_PRESERVED` | same call frame; tests in Part 12 |
| Error and retry paths, spend inside `catch` | `CONTEXT_PRESERVED` | test |
| Async generators / `for await` | `CONTEXT_PRESERVED` | test |
| Fire-and-forget outliving its request | `CONTEXT_PRESERVED` | test |
| tRPC procedure | `EXPLICIT_SCOPE_REESTABLISHED` | created there (`api/trpc.ts`) |
| Durable job handler | `EXPLICIT_SCOPE_REESTABLISHED` | created there |
| **Plain `EventEmitter` listener** | **`UNSAFE`** | **test — see below** |
| `worker_threads` | `NOT_APPLICABLE` | none in the tree |
| `child_process` | `NOT_APPLICABLE` | no model work is spawned |
| WebSocket handlers (`api/core/websocket.ts`) | `NOT_APPLICABLE` | reaches only read-only DB reads |
| `external-reliability-worker` timers | `NOT_APPLICABLE` | not wired in `boot.ts`; no model path |
| `api/routers/stream.ts` emitters | `NOT_APPLICABLE` | router not registered |

### The unsafe one, and why it is not a hole today

`EventEmitter.emit()` is **synchronous**: listeners run in the *emitter's*
context, not the one they were registered in. A listener registered inside a
budget scope and fired from outside it sees no context at all. That is measured,
not recalled:

```
it("UNSAFE: a plain EventEmitter listener runs in the EMITTER's context")
  → currentModelCallBudget() is undefined
```

No active JASIM model path goes through an emitter, so nothing is broken today.
The reason it is not a *latent* hole is Part 1: a listener that reached the
gateway would now be **refused**, not served unbounded. That is the entire value
of fail-closed, and the test states it exactly that way — the transport can
fail, and the invariant still holds.

Two repairs are provided for when one is needed: `AsyncResource.bind()` (tested)
and `runWithReestablishedModelBudget(snapshot)`, which rebuilds a context from a
snapshot's **remaining** allowance. It deliberately does not share the live
object: two isolates cannot share one counter, and a counter that is not shared
is not a ceiling.

```
ALS_ACTIVE_BOUNDARIES_SAFE = PASS
```

---

## 3. PART 3 — THE BUDGET IS AN EXPLICIT TYPE, NOT AN AMBIENT HABIT

`ModelExecutionContext` names what ALS transports, and
`requireModelExecutionContext(purpose)` is the accessor for code that genuinely
needs one — because reading `currentModelCallBudget()` and branching on
`undefined` is precisely how "no context" quietly becomes "no limit".

ALS remains the transport. It is no longer the place the rule lives.

| Question | Answer |
|---|---|
| **Who creates it** | Only a trusted server boundary: the tRPC base procedure and the durable job worker. Trusted because no client input reaches their arguments. |
| **Who may narrow** | Anyone, by nesting. A nested context is clamped to the parent's **remaining** slots, so narrowing is real and never a reset. |
| **Who may widen** | Nobody. No API raises a ceiling; the constructor clamps against the deployment maximum. |
| **Who consumes** | Only `ModelGateway.generate()`, via `reserveModelCall()`, once per provider attempt, always before the network call. |
| **Who may release** | Nobody. There is no `release()`. The money is spent whether or not the response was useful. |
| **Nesting** | `min(requested, parent.remaining)`. Spending in a child never refunds the parent. |

---

## 4. PART 4 — ALLOWLISTED CONTRACTS REPLACE THE BLOCKLIST

Wave 2 shipped a blocklist and said in its own report that a blocklist is
incomplete by construction. It is. `settlementConfirmed`, `isCleared`,
`overrideReason` — none were on it, and a longer list is a losing race against a
system that can name a field anything.

`api/runtime/model-proposal.ts` defines six semantic contracts, each `.strict()`
at every level:

| Family | Answers |
|---|---|
| `intent_classification` | which intent — a label, nothing else |
| `reference_proposal` | which of the things I showed you |
| `planning_proposal` | what steps, as advisory metadata |
| `comparison_request` | compare these two |
| `monitoring_proposal` | watch this attribute |
| `presentation_intent` | what **shape** of information — never a primitive |

**An allowlist is complete by construction in the way a blocklist can never
be**: the set of things a model may say is finite and written down, so a field
nobody has imagined yet is refused for the same reason as one that has.

Proven across **181 assertions**: every one of 20 forbidden fields — including
`ownerId`, `userId`, `accountId`, `paid`, `verified`, `settled`, `approved`,
`policyOverride`, `providerUrl`, `handler`, `executionStatus`, `paymentStatus`,
`credentials`, `mandate`, `authorizationScope` — is refused at the **root** of
every family, **inside nested objects**, and **inside arrays**.

Three details that carry weight:

- **Approval is monotonic.** `proposesApproval` is typed `z.literal(true)`, not a
  boolean. A model can ask for more scrutiny; there is no value it can send that
  asks for less.
- **Presentation intent has no field a primitive fits in.** Wave 1.2 established
  that `decidePresentation` alone chooses primitives. The contract makes that
  structural rather than conventional.
- **A plan-local id may not have the shape of a canonical one.** My first version
  of this claimed it in a comment and did not do it — `[A-Za-z0-9_-]` admits a
  UUID happily. The test caught my own false comment; I fixed the code to match
  the claim rather than softening the claim.

The blocklist stays as defence in depth over the *declared* fields, in case a
contract is ever written too permissively. Two controls that fail differently
are worth more than either alone.

**Honest scope limit.** The contracts and the brand are built and exhaustively
tested; only one of them is wired into a live path (`composeTaskWorld`, from
Wave 2). Wiring the remaining five means rewriting the conversational prompts to
request these exact shapes and verifying a real model complies — which needs a
provider. Hence `PARTIAL`, not `PASS`. Claiming otherwise would be exactly the
fake-success this wave is meant to prevent.

---

## 5. PART 5 — FOUR ADAPTERS, CONTRACT-TESTED

**This is not real-provider acceptance and no line of it may be cited as such.**
It proves JASIM builds the request it thinks it builds and reads the response it
thinks it reads — which is where the cheap mistakes live.

| Adapter | URL | Auth | Divergences verified | Classification |
|---|---|---|---|---|
| `openai` | `/chat/completions` | `Authorization: Bearer` | `max_tokens`, `temperature`, `response_format` | **CONTRACT_TESTED** |
| `openai-compatible` | `/chat/completions` | `Authorization: Bearer` | `max_completion_tokens`, **no** `temperature`, base-URL slash stripping | **CONTRACT_TESTED** |
| `anthropic` | `/messages` | `x-api-key` + `anthropic-version` | system prompt hoisted out of `messages`, `CLAUDE_API_KEY` alias, no `total_tokens` | **CONTRACT_TESTED** |
| `gemini` | `:generateContent?key=` | query string | `systemInstruction`, `generationConfig`, model-name URL encoding | **CONTRACT_TESTED** |

Also covered for all four: timeout signal present, HTTP 401/403/404/429/500/503/504
mapping, `Retry-After` parsing, error-body truncation, token-usage parsing,
empty-completion rejection, and absent usage yielding `undefined` rather than 0.

### A truthfulness gap closed along the way

The gateway parsed no finish reason. `finishReasonFromProvider` now normalizes
three vocabularies — `end_turn`/`STOP`/`stop`, `max_tokens`/`MAX_TOKENS`/`length`
— onto one, and an unrecognized value maps to `"unknown"`, **never** to
`"stop"`. Defaulting to `"stop"` would assert normal completion on no evidence.

This matters most for truncation: a JSON response cut off at the token ceiling
now fails as `MODEL_GATEWAY_INVALID_OUTPUT` with a message saying so, instead of
surfacing downstream as a baffling "unexpected end of input". Truncated **prose**
is kept, because half an answer is still an answer — and `finishReason` says it
was truncated.

```
REAL_PROVIDER_ADAPTERS   = 4
ADAPTERS_CONTRACT_TESTED = 4
```

---

## 6. PART 14 — UNGOVERNED PATHS: 0, PROVEN BY REACHABILITY

Wave 2 answered this with a grep. A grep proves what a file contains, not what
the server can reach — and "it is dead code" stops being true the first time
someone adds an import.

A test now walks the **real module graph** from the only two entry points that
exist, `api/boot.ts` and `api/router.ts`:

```
MODULES_REACHABLE = 92
REACHABLE FILES THAT CALL A MODEL PROVIDER = ['api/runtime/model-gateway.ts']
```

### The thing the re-audit found

**`api/core/llm-router.ts` — 1385 lines, six direct provider `fetch` calls.** A
complete second model router that Wave 2's audit missed entirely. It is imported
by twelve modules: `api/routers/jasim.ts` (not registered in `api/router.ts`)
and eleven `api/core` engines that have no live references.

It is **unreachable** from both entry points, so it is not an ungoverned path
today. Dead is fine. Dead and unwatched is how it comes back, so a test now
asserts both that it exists and that it stays unreachable.

The detector had its own false positive worth recording: matching `/messages`
flagged `block2/notifications.ts`, which posts to FCM
(`/v1/projects/{id}/messages:send`) and the WhatsApp Graph API
(`/v19.0/{id}/messages`). Those are delivery endpoints, not models. The detector
is shape-based, not a vendor list, and it is a heuristic — the reachability walk
is what makes it useful, because it only has to be right about 92 modules.

```
UNGOVERNED_ACTIVE_MODEL_CALL_PATHS = 0
```

---

## 7. PARTS 11 & 12 — FAILURE TRUTH AND COST TRUTH

### Part 11: no failure returns a successful-looking response

| Condition | Category | Provider contacted? |
|---|---|---|
| Invalid credential | `PROVIDER_AUTH_FAILED` | yes (401) |
| No credential configured | `PROVIDER_AUTH_FAILED` | **no** |
| Timeout (504) | `PROVIDER_TIMEOUT` | yes |
| Aborted transport | `PROVIDER_UNAVAILABLE` | attempted |
| Rate limit (429) | `PROVIDER_RATE_LIMITED` | yes |
| Empty output | `MODEL_GATEWAY_INVALID_OUTPUT` | yes |
| Truncated JSON | `MODEL_GATEWAY_INVALID_OUTPUT` | yes |
| Context too large | `MODEL_CONTEXT_TOO_LARGE` | **no** |
| Budget exhausted | `MODEL_BUDGET_EXCEEDED` | **no** |
| No budget context | `MODEL_BUDGET_CONTEXT_MISSING` | **no** |

Asserted as one check across every mode, not merely implied by ten separate
ones. A gateway that degrades into a cheerful "Sorry, I couldn't reach the
model!" is worse than one that throws: the caller stores it, renders it, and
counts it as an answer.

### Part 12: the ledger records attempts, not requests

**A real cost-truth hole was found and fixed.** Wave 2 wrote one aggregate row
per request. A failover from A to B recorded only B's success — while A may well
have generated tokens before failing and billed for them. The ledger now writes
**one row per provider attempt**:

```
primary 500 → fallback 200   ⇒  2 rows: openai/primary FAILED, anthropic/fallback SUCCESS
primary 503 ×2, fallback 503 ×2 (retries on)  ⇒  4 rows, every one individually visible
```

Proven alongside: a retry spends a budget slot and appears as its own row; tier
escalation is recorded under the tier that actually ran; a refusal *before* the
network records `provider = "unavailable"`, `modelId = "unavailable"` and no
token counts, so it can never be mistaken for billed usage by any aggregation.

A context refusal was invisible in the ledger — it threw before any row was
written. It is now recorded too: the one symptom of a prompt quietly growing
past its budget was its own absence.

Two latencies are recorded, both true and now distinguished: the ledger row
measures **that attempt** (what a provider-performance question needs), while the
response carries total elapsed time including retries and backoff (what the
caller actually waited).

---

## 8. PART 13 — WORLD GENERATION ROUTING: REVIEWED, KEPT, DOCUMENTED

Wave 2 found that `purpose: "WORLD_GENERATION"` alone routes FAST_CHEAP and
flagged it as surprising. The review conclusion is that **the behaviour is
correct and the documentation was missing.**

- `purpose` answers *which kind of work* — it selects the prompt family, the
  output ceiling, the ledger label. It is a **category**.
- `worldGeneration`, `structuralMutation`, `complexity`, `novelty`,
  `qualityRequirement` answer *how hard this particular request is*. They are
  **properties of the instance**.

Routing on the category would mean "a world is expensive". Generating a world for
*"track my driver"* is not the same problem as generating one for a multi-party
logistics network, and charging STRONG_REASONING prices for the first because of
a label breaks cheapest-sufficient on the most frequent path. **No model was made
more expensive.**

What was genuinely wrong was that the distinction was undocumented, which made
the redundancy look like a bug and invited someone to "fix" it by escalating on
the purpose. It is now documented at the decision site, `tierFromPurpose()` is
named as the supported constructor, and a test reads the **actual call sites** to
assert that every production profile naming `WORLD_GENERATION` also sets the flag
— with a companion test proving the check is not vacuous.

---

## 9. PART 17 — INDEPENDENT REVIEW: FINDINGS FIXED IN THIS WAVE

Reviewing the diff adversarially against the named risks produced three fixes
beyond the brief:

**1. A ledger outage could discard a paid-for answer, or mask a provider error.**
`recordModelUsage` was awaited unguarded. On the success path a database hiccup
would have thrown away a response the provider had already billed for — losing
both the money and the answer. Worse, the failure-path write sits inside a
`catch`, so a throw there would have replaced the provider's error with a
database error and **aborted failover before the next candidate was tried**.

Ledger writes are now non-fatal but **loud**: the lost row is logged with its
identity (`UNCOUNTED`, provider, model, tier), so under-counted spend shows up in
the logs rather than only in the invoice. Both cases are tested.

**2. A credential could escape through an error message.** Gemini authenticates
by query string, and providers echo the offending key back in 401 bodies. Both
paths feed into error messages, which feed into logs. `redactCredentials` now
strips `key=`/`api_key=`/`access_token=` query values and any configured key
value at the point a provider error becomes a JASIM error. Tested both ways.

**3. My own false comment.** The plan-local id pattern was documented as
excluding canonical identifiers and did not. The test caught it; the code was
fixed to match the claim.

Other review dimensions, checked and clean: no mock or stub fallback exists
anywhere in the gateway path; no credential is interpolated outside header and
URL construction; no secret appears in any committed document; `estimatedCost`
remains telemetry and never reaches `economic_ledger_entries`; retrieved content
is still fenced as data.

---

## 10. PARTS 6–10 — WHAT IS BLOCKED, AND EXACTLY HOW TO UNBLOCK IT

No provider credential exists here, so none of the following was attempted, and
no substitute was counted in their place:

- **Part 6–7** — first real provider, real smoke per tier.
- **Part 8** — real cost validation against real token counts.
- **Part 9** — the seven Arabic conversation cases (A–G). Cases A–E were proven
  end-to-end in Wave 1.2 over HTTP with a real database, but **structurally**:
  ambiguity produced CHOICE because there were two candidates, not because a
  sentence was understood. Part 9 asks for the semantic version, and that needs a
  model.
- **Part 10** — the six unseen Arabic generality examples. Running them against a
  stub would produce a stub's answer and tell us nothing about generality.

The gate is built and waiting. `tests/integration/model-provider-live.test.ts`
is **double-gated** — it needs `JASIM_LIVE_MODEL_TESTS=1` *and* a credential, so
CI can never bill by accident — and it always prints its own state
(`SKIPPED_NOT_OPTED_IN` / `SKIPPED_NO_CREDENTIAL` / `LIVE`), so a green suite can
never be mistaken for real acceptance.

To complete Parts 6–8:

```
JASIM_LIVE_MODEL_TESTS=1 JASIM_MODEL_PROVIDER=<provider> <PROVIDER>_API_KEY=… \
  npx vitest run tests/integration/model-provider-live.test.ts
```

Every request in it is tiny: a few tokens in, 16 out, one call per configured
tier. Parts 9 and 10 then follow against the live conversational pipeline.

`docs/operations/JASIM_MODEL_GATEWAY_STAGING_ENV.md` (Part 15) is the
names-only environment contract for Railway Staging: required variables, tier
mapping, budget defaults, pricing, and the safe defaults — with
`JASIM_MODEL_BUDGET_ENFORCEMENT` documented as fail-closed and ignored in
production.

---

## 11. REGRESSION

| Suite | Wave 2 | Wave 2.1 |
|---|---|---|
| Main suite | 889 / 889 (58 files) | **1153 / 1153 + 5 skipped (63 files)** |
| Block 2 | 101 / 101 | **101 / 101** |
| Block 3 | 133 / 133 | **133 / 133** |
| Block 3.1 | 65 / 65 | **65 / 65** |
| `tsc -b` | PASS | **PASS** |
| Web build | PASS | **PASS** (8.14s) |
| Mobile TypeScript | 10 pre-existing | **10 pre-existing, unchanged** |

264 new tests. The 5 skipped are the live-provider gate, skipping by design.

**No inherited test was modified. No assertion was weakened.** The three Wave 2
tests that changed were mine, and they changed because the contract they
described got stricter.

---

## 12. COUNTERS

```
WAVE_2_1                           = PARTIAL

MODEL_GATEWAY_FOUNDATION_REUSED    = YES
SECOND_GATEWAY_CREATED             = NO

MODEL_BUDGET_FAIL_CLOSED           = PASS
ALS_ACTIVE_BOUNDARIES_SAFE         = PASS
MAX_MODEL_CALLS                    = PASS
UNGOVERNED_ACTIVE_MODEL_CALL_PATHS = 0

TASK_SPECIFIC_MODEL_OUTPUT_ALLOWLISTS = PARTIAL

REAL_PROVIDER_ADAPTERS             = 4
ADAPTERS_CONTRACT_TESTED           = 4

REAL_PROVIDER_ACCEPTANCE           = BLOCKED_BY_ENVIRONMENT
REAL_FAST_CHEAP                    = NOT_CONFIGURED
REAL_BALANCED                      = NOT_CONFIGURED
REAL_STRONG_REASONING              = NOT_CONFIGURED
REAL_MODEL_USAGE_CAPTURED          = NO
REAL_COST_ESTIMATE_CAPTURED        = NO

REAL_ARABIC_MAP_INTENT             = BLOCKED_BY_PROVIDER
REAL_AMBIGUITY_TO_CHOICE           = BLOCKED_BY_ENVIRONMENT
REAL_REFERENCE_CONTINUITY          = BLOCKED_BY_ENVIRONMENT
REAL_RESULTSET_CONTINUITY          = BLOCKED_BY_ENVIRONMENT
REAL_GENERALITY_MINI_GATE          = BLOCKED_BY_ENVIRONMENT

DOMAIN_SPECIFIC_CORE_FILES_ADDED   = 0
PRODUCTION_MODEL_MOCK_FALLBACKS    = 0
MODEL_AUTHORITY_BYPASSES           = 0
MODEL_PROVIDER_SECRET_LEAKS        = 0

BLOCK_2                            = 101 / 101
BLOCK_3                            = 133 / 133
BLOCK_3_1                          = 65 / 65
MAIN_SUITE                         = 1153 / 1153 (+5 skipped, live gate)
TYPECHECK                          = PASS
WEB_BUILD                          = PASS
MOBILE_BUILD_OR_METRO              = 10 PRE-EXISTING TS ERRORS (unchanged); Metro BLOCKED_BY_ENVIRONMENT

REAL_MONEY_USED                    = NO
REAL_DISCOVERY_STARTED             = NO
PRODUCTION_DATABASE_TOUCHED        = NO
PRODUCTION_DEPLOYMENT              = NO

READY_FOR_RAILWAY_STAGING          = YES
READY_FOR_REAL_DISCOVERY_PROVIDERS = NO
```

**`READY_FOR_REAL_DISCOVERY_PROVIDERS = NO`**, and that is the correct answer
rather than a cautious one. Real Discovery means JASIM acting on the world
through providers it does not control. Doing that on a gateway whose real
behaviour against a real model has never been observed would stack an unproven
layer on an unproven layer. One real credential and the live gate in §10 turn
this to `YES`; nothing else is outstanding.

`READY_FOR_RAILWAY_STAGING = YES` because Staging is precisely where that first
real call should happen.

---

## 13. WHAT A REVIEWER SHOULD DOUBT FIRST

1. **Zero real provider calls, still.** Four adapters, contract-tested against a
   stubbed transport. Everything up to the wire is proven; the wire itself is
   exactly as unproven as it was before this wave. Nothing in §5 is acceptance.
2. **`PARTIAL` on the allowlists is load-bearing.** Six contracts exist and are
   exhaustively tested; one live path uses the older sanitizer. The conversational
   prompts still have to be rewritten to request these shapes, and a real model
   has to be observed complying.
3. **The token estimator is still a heuristic.** ÷4 ASCII, ÷2 otherwise,
   unchanged from Wave 2. The absolute ceiling is the backstop, not the estimator.
4. **`NODE_ENV` is now a safety input.** Production strictness keys off it. A
   deployment that forgets to set `NODE_ENV=production` gets the non-production
   branch — which still defaults to strict, so the failure mode is "as safe as
   before" rather than "unsafe", but the sharpest guarantee does depend on that
   one variable being right.
5. **The provider detector is shape-based.** It would miss a provider using a
   completely novel endpoint shape and no recognizable header. The reachability
   walk keeps the surface to 92 modules, which is what makes a heuristic
   acceptable here.
6. **`llm-router.ts` is still in the tree.** 1385 lines and six provider calls,
   unreachable and now tested to stay that way. Deleting it was out of scope
   under the architecture freeze; a future wave should either remove it or
   neutralize it the way `artifacts/api-server` was.
7. **Ledger writes are now non-fatal.** That is the right trade — an already-billed
   answer should not be thrown away over a database hiccup — but it does mean a
   sustained database outage produces under-counted spend. It is logged as
   `UNCOUNTED` rather than silent, and that log is the only thing standing between
   an outage and a wrong cost report.

END OF WAVE 2.1 REPORT.
