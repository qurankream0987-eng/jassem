# JASIM — PRODUCT ARCHITECTURE DECISIONS

**Status:** BINDING · **Source:** product owner, vision clarification round
**Vision:** `00D_JASIM_MASTER_PRODUCT_VISION.md` · **Code changed by this document:** NONE

> Six decisions. Each is recorded with **how it must be enforced structurally**
> — not by documentation — and **what the benchmark must assert**, because a
> constraint that only exists in prose is a constraint that will be lost.
>
> Nothing here is implemented. This is the contract future phases are measured
> against.

---

## D1 — BUSINESS SCOPE vs ANSWER INTEGRITY

### Decision

A business may define the **product scope** of its own JASIM OS surface. A
retailer may expose only its own catalog; a restaurant only its own menu. That
is legitimate.

```
BUSINESS_SCOPE != GLOBAL_NEUTRAL_DISCOVERY
```

JASIM OS must **never present a business-scoped answer as if it were an
independent market-wide answer.**

Three concepts stay separate:

| Concept | Who controls it | What it may do |
|---|---|---|
| **ELIGIBILITY / PRODUCT SCOPE** | the business | inventory, serviceability, business hours, policy, geography, permissions |
| **ORGANIC RANKING** | JASIM, neutrally | order by fit to the stated need |
| **SPONSORED RANKING** | paid, separate, labelled | placement only, never "best" |

A business **may not silently purchase or configure "best" status**.
`SPONSORED != BEST`. Any sponsored placement must be explicitly labelled.

**For JASIM App, external businesses must not be able to suppress competitors or
alter neutral organic ranking.**

### Enforcement — structural, not editorial

1. **Organic ranking code must not be able to read sponsorship or
   business-preference data.** Not "ignores it" — *cannot see it*. Enforced by
   module boundary: the organic ranking module imports no sponsorship type and
   no business-config type, asserted by a source-level test of the kind already
   used for `compensation-policy.ts` (which is asserted to import no financial
   schema).
2. **A scoped answer carries its scope in the response contract**, so the
   presentation layer cannot render it as neutral. Scope is data the renderer
   must handle, not a flag it may ignore.
3. **Eligibility filters apply BEFORE ranking**, reusing the existing
   `hardConstraints`-before-ranking order already established in
   `block31/discovery.ts`. Eligibility narrows the candidate set; it never
   reorders it.

### Benchmark must assert

- A JASIM-OS-scoped result set is labelled as scoped and is **not** presented as
  market-wide.
- A sponsored candidate is labelled, and **never** outranks a better organic one.
- A sponsored candidate is never `actionable` in an autonomous run without the
  owner seeing the label.
- **Adversarial:** a business configuration attempting to suppress a competitor
  in JASIM App is rejected.

### Current status
No advertising system, no business config, no sponsorship data. The
`actionable: []` rule for untrusted candidates is the mechanism that will carry
the fourth assertion. `SPONSORED != BEST` is currently a documented rule with no
code able to violate it — the work is to keep it that way once money exists.

---

## D2 — PROVIDER CONFIGURATION vs PROVIDER TRUST

### Decision

A JASIM OS business may bind and configure providers: payment, delivery, CRM,
ERP, catalog API, messaging, custom API.

```
BUSINESS_PROVIDER_CONFIGURATION != PROVIDER_TRUST_CONFIGURATION
```

The business must **never** set authoritative fields such as `trustClass`,
`verificationAuthority`, `independentEvidence`, `verified`, `effectConfirmed`,
or equivalents.

> **THE BUSINESS CHOOSES WHERE JASIM MAY CALL.**
> **THE TRUSTED JASIM POLICY DECIDES WHAT THAT CALL CAN PROVE.**

### Enforcement — the mechanism already exists three times over

This is the same shape as three boundaries already in the codebase, and it must
reuse them rather than invent a fourth:

| Existing boundary | What it refuses |
|---|---|
| `AUTHORITY_KEYS` (`model-output-trust.ts`) | a model asserting `ownerId`, `verified`, `approved`, `paid` |
| `EFFECT_AUTHORITY_KEYS` (`completion-policy.ts`) | a capability grading its own evidence |
| `SIGNAL_AUTHORITY_KEYS` (`effect-observation-bridge.ts`) | a signal naming its own trust class |

A business configuration is the **fourth submitter** of untrusted input, and it
gets the same treatment: **rejected, not stripped and used.**

Beyond key rejection, two structural requirements:

1. **Trust class is derived, never supplied.** The bridge already establishes the
   pattern: `CHANNEL_SOURCE` maps *how a signal arrived* to what it is worth, in
   a frozen table, and no caller can name the result. Provider trust must be
   derived the same way — from what the runtime knows about the binding, not
   from what the business says about it.
2. **Verification code must not import business configuration.** A source-level
   test, so that a future refactor cannot quietly give the verifier a business
   config to read.

### Benchmark must assert

- **Adversarial:** a business config containing `trustClass` is rejected outright.
- A business-bound provider's self-report is `SELF_REPORTED` — which no effectful
  policy accepts — regardless of how the business configured it.
- A business cannot raise a provider to `TRUSTED` by configuration.

### Current status
`normalizeMcpToolMetadata` already stamps `UNTRUSTED_CANDIDATE` and
`resolveProvider` already filters those out absent an explicit approval. There
is no business config yet, so the boundary cannot currently be crossed —
SEC-08's reachability evidence pins that.

---

## D3 — CURRENT COMMERCE BRANCH — TRANSITIONAL

### Decision

The hard-coded commerce conversation branches are **accepted as TRANSITIONAL
ARCHITECTURE**.

- **Do NOT delete them now.** They are what makes discovery and commerce work.
- **Do NOT expand the same pattern** into Jobs, Cars, Travel, Restaurants,
  Health, or any other domain.

Long-term direction: `GoalSpec → generic semantic intents → PlanGraph →
capabilities → providers`. The mini-planner should eventually be **absorbed**
by that path.

### What exists today, precisely

`api/runtime/jasim-runtime.ts` hardcodes six capability labels into the core
turn prompt — `discovery-search, commerce-publish, commerce-select,
commerce-approve, commerce-pay, world-commerce` — **none of which is a
registered `TrustedCapability`**. They are matched by seven string tests in
`orchestrateConversationCommerce` (`isPay`, `isApprove`, `isCompare`,
`isSelect`, `isPublish`, `isWorldCommerce`, `isDiscovery`) which run **before**
the main turn path.

### Enforcement — a ratchet

"Do not expand" is only meaningful if expansion is detectable. The mechanism:

> **Pin the branch count at its current value (7) and the label list at its
> current six.** A test asserts both. The numbers may go **down** — that is
> absorption — and an attempt to raise either fails the build.

This is the same technique already used for the frozen corpus digest and for the
`verifyExecutionAttempt` call-site count: a number that can only shrink is a
constraint a future phase cannot quietly widen.

The ratchet also makes the absorption **visible**: when GoalSpec and PlanGraph
land, the count drops, and the drop is the evidence that the generic path took
over rather than sitting alongside.

### Benchmark must assert

- Branch count ≤ 7 and label count ≤ 6.
- **No new domain family appears in the core prompt.**
- Once GoalSpec exists: a commerce intent routed through the generic path
  produces the same outcome as the hardcoded branch — which is the test that
  permits deletion.

---

## D4 — JASIM OS BUSINESS DIMENSION

### Decision

The absence of a first-class **Business** dimension is accepted as a genuine
future JASIM OS foundation gap. **Do NOT implement it now.**

A future `Business` will likely own:

> brand · business users · catalog/data scope · business policies ·
> offerings/pricing · provider bindings · permissions · workflows ·
> world associations

It must **NOT** own:

> core authority rules · verification truth · execution truth ·
> security boundaries · model authority · provider trust classification

### Enforcement — when it is built

1. **Business is a scoping axis, not a fork.** It sits alongside `ownerId` as a
   query predicate — the same shape that already makes cross-owner access
   impossible rather than merely refused. **Not** a separate runtime, schema or
   code path.
2. **Cross-business isolation is proven exactly as cross-owner isolation is.**
   The adversarial corpus already has the template: a raw id from another owner
   is *not found*. A raw id from another business must behave identically.
3. **The forbidden list is a type-level impossibility, not a review item.** A
   `BusinessConfig` type that has no field for verification or authority cannot
   set one; combined with D2's key rejection for anything arriving as data.

### Benchmark must assert

- Cross-business injection is refused, with **zero rows written** — the same
  standard B-04 holds the observation bridge to.
- Two businesses on one runtime cannot read each other's catalog, policies or
  runs.
- A business config cannot alter a verification outcome.

### Current status
`ownerId` is the only scoping axis in the schema. Confirmed by search: no
`tenantId`, `businessId` or `organizationId` exists anywhere.

---

## D5 — GENERATED WORLD MUTATION

### Decision

The absence of `Conversation → ChangeSet → persistent World mutation` is
accepted as a real future capability gap. **Do not implement it now.**

### Current status — already measured

This is not a newly discovered gap; the frozen benchmark already reports it.
**S15** («أي طلب فوق 500 لازم أوافق عليه» — policy change) and **S16**
(«محمد يشوف الطلبات لا الأرباح» — permission change) both return **`FUTURE`** in
the current baseline, with the recorded reason *"world mutation not reachable
from the turn path"*.

So the acceptance test for this decision already exists and already fails
honestly. **When S15 and S16 stop returning `FUTURE`, the gap is closed** — and
the benchmark, not a report, is what says so.

### Enforcement when built
The mutation path must go through the existing trust chain — ChangeSet →
impact → policy → approval → atomic mutation → version — and not become a
second write path that bypasses proposals and approvals.

---

## D6 — GENERALITY

### Decision

```
NEW DOMAIN != NEW CORE ARCHITECTURE
```

Examples remain acceptance tests. No domain agents. No domain runtimes. No
domain planners.

### Enforcement — already live

This is the one decision that is **already enforced in code**, and it should be
read as the model for the other five:

| Mechanism | Where |
|---|---|
| `DOMAIN_SPECIFIC_PATCH_COUNT` metric, must be zero | `tests/evals/metrics.ts` |
| Every scenario records what passing *actually required*; `DOMAIN_SPECIFIC_CORE` is a SECURITY-severity veto | `tests/evals/evaluate.ts` |
| The benchmark machinery is asserted to name no domain | `frozen-corpus.test.ts` |
| `completion-policy.ts`, `compensation-policy.ts`, `effect-observation-bridge.ts` are each asserted to declare no domain-named identifier | their eval suites |

**The boundary, established and worth restating:** the benchmark **may hear** a
domain — utterances are real user speech — and **may not encode** one. An
expectation, metric or piece of machinery naming a domain is the architecture
failing.

---

## THE CLOSING REQUIREMENT

> **«أهم شيء أن نبني جاسم مثل ما نريد، وهذه الاختبارات يجب أن نضمن أن تتحقق
> كاملة.»**

Taken literally, and answerable, because the 30 examples are already a frozen,
measured corpus. Current baseline: **13 PASS · 6 PARTIAL · 18 blocked on absent
configuration · 5 FUTURE · 0 FAIL.**

What each remaining group needs — no guesswork, these are the recorded reasons:

| Group | Count | Unblocked by |
|---|---|---|
| `BLOCKED_BY_MODEL` | 6 | a model provider |
| `BLOCKED_BY_PROVIDER` | 12 | discovery / device / payment providers |
| `FUTURE` (S08, S16, S23, S24, S25) | 5 | world mutation (D5), payment path, reconciliation lookups |
| `PARTIAL` (S03, S05, S07, S26, S27, S29) | 6 | seeded fixtures; capabilities for `HUMAN_ACTION` / `REMOTE_MUTATION` |

**"Fully achieved" means every one of the 42 reaches PASS with
`FALSE_SUCCESS = 0` held throughout.** That is a measurable finish line, and the
four gates already hold at every score:

```
FALSE_SUCCESSES = 0 · BLIND_RETRIES = 0
DOMAIN_SPECIFIC_CORE = 0 · SECURITY_FAILURES = 0
```

**The order that gets there is not a matter of preference.** Six scenarios need a
model; twelve need providers; the `FUTURE` five need capabilities that do not
exist. Nothing reorders that. The one thing that must never happen is a scenario
moving to PASS because the benchmark was softened — which is why the corpus
carries a pinned digest and why these six decisions are recorded with
enforcement mechanisms rather than intentions.

END OF DECISIONS.
