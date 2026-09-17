# JASIM — ADVANCED VISION, BEHAVIOR AND EXAMPLES

**Status:** MANDATORY FIRST READ — read this before `01_JASIM_MASTER_PRODUCT_AND_ARCHITECTURE.md`
**Audience:** Claude Code / Claude Max / any senior engineer or agent inheriting JASIM
**Companion:** the 110-example library lives in `00B_JASIM_BEHAVIOR_EXAMPLE_LIBRARY.md`
**Scope of this document:** what JASIM *is*, how JASIM *thinks*, and what behavior counts as correct.
**What this document is not:** it is not the architecture reference, not the security constitution,
and not a feature backlog. Those are separate documents.

---

## 0. WHY THIS DOCUMENT EXISTS

The other JASIM documents tell you **how JASIM is built** and **what must never be broken**.
They are laws. Laws are necessary but they do not transmit intent.

This document exists because an engineer who has only read the laws can still build the wrong
product perfectly legally: a technically compliant runtime that nobody wants to talk to.

So this document answers three different questions:

1. What experience is JASIM trying to give a human being?
2. How should JASIM reason from a sentence to a real outcome in the world?
3. How do you recognize — in your own thinking, while you work — that you have started
   to misunderstand JASIM?

Read it once completely before writing code. Return to Chapter 10 whenever you are about to
add a file whose name contains a domain noun.

### 0.1 Ground truth used to write this document

Every primitive, table, state and file path named in this document was read from the repository,
not recalled from another project. The active implementation is:

```
canonical/جاسم/app/api/runtime/jasim-runtime.ts     the canonical runtime (~8,270 lines)
canonical/جاسم/app/api/router.ts                    registers ONLY: runtime, fabric, block2
```

`artifacts/api-server/src/lib/jasim-runtime.ts` is deliberately neutralized. Legacy routers
(`jasim`, `conversation`, `task`, `bubble`, `worlds`, …) still exist as files under
`api/routers/` but are **not registered and not compiled into the active server**. Never cite
them as evidence that a capability is live. Trace from `api/router.ts` or it does not exist.

### 0.2 Baseline verified at the time of writing

These were executed, not quoted:

| Check | Result |
|---|---|
| `tsc -b` full typecheck | PASS, zero errors |
| main vitest suite | 937 passed |
| Block 2 suite (`test:jasim-block-2`) | 101 / 101 |
| Block 3 suite (`test:jasim-block-3`) | 133 / 133 |
| Block 3.1 suite (`test:jasim-block-3-1`) | 65 / 65 |
| PostgreSQL schema push | PASS |

Two honest notes you inherit with the repository:

1. **Do not use `pnpm test` as a gate.** The default vitest config globs `tests/**`, which pulls
   the Block 2 / 3 / 3.1 suites into the same parallel run. Each of those suites `DROP`s and
   `CREATE`s its own shared proof database, so running them together produces ~35 failures that
   are pure test-database races, not product defects. Run each block suite under its own config,
   serially. Do not "fix" this by weakening an assertion.
2. **Some docs in this repository are stale.** `JASIM-WHATS-MISSING.md`, `docs/JASIM_FINAL_VISION_GAP_ANALYSIS.md`
   and several `.agents/memory/*.md` notes describe as MISSING or PARTIAL things that are now
   implemented (the Output Router, reference resolution, Smart Bubbles, the commerce↔conversation
   path, the `resumeNode` seam in `boot.ts`). When a document and the code disagree, the code is
   the evidence and the disagreement is a finding to report — never something to silently resolve.

---

## 1. WHAT JASIM IS

JASIM is a **universal generative agent runtime**. One conversation, one intelligence, one
canonical runtime, and a surface that forms itself around whatever the person actually wants
to happen.

The one-sentence version, and it is worth memorizing:

> The user says what they want to happen.
> JASIM decides what must be understood, what data is needed, which capabilities are required,
> which humans or systems must be involved, which interface is appropriate, and what needs
> approval — then executes, observes, verifies, and keeps going.

JASIM is simultaneously all of these, and none of them alone:

- **conversational** — the primary interface is a sentence, not a menu
- **generative** — the interface is composed per goal, not pre-built per domain
- **capability-based** — ability is described semantically and supplied by providers
- **execution-aware** — work is durable, resumable, and survives restarts
- **verification-aware** — nothing is "done" because something claimed it was done
- **economically aware** — offerings, needs, matches, money, and unit economics are first-class
- **persistent only where persistence is justified** — most requests must not create durable state
- **provider-neutral** — no vendor name belongs in semantic planning
- **domain-general** — a new domain must not require new core architecture

The long-term ambition is that JASIM can face a practical or economic problem it has never
seen, decompose it into generic primitives it already has, and either solve it or state
truthfully which generic capability or provider is missing.

### 1.1 The three sentences that separate JASIM from an assistant

An ordinary assistant answers. JASIM does three additional things:

1. **It decides how much machinery the request deserves.** "كم سعر الدولار اليوم؟" gets text.
   "أدر لي شركة الصيانة" gets a durable world. Choosing wrongly in either direction is a defect.
2. **It keeps canonical truth on the server.** What you see is a projection of state, never the
   state itself. The UI cannot make something true.
3. **It refuses to lie when reality is unavailable.** No fake map, no fake ETA, no fake progress
   percentage, no fake provider result, no fake payment success. An honest `BLOCKED_BY_PROVIDER`
   is a correct answer and a passing test.

---

## 2. WHAT JASIM IS NOT

### 2.1 It is not a zoo of mini-applications

This is the single most important prohibition in the project, so it is stated bluntly.

Forbidden as core architecture:

```
CarAgent            JobAgent            RestaurantAgent     TravelAgent
HotelAgent          HealthAgent         WarehouseAgent      DriverAgent
ScaffoldingAgent    BoatAgent           LabAgent            BakeryAgent
CarRuntime          JobRuntime          RestaurantWorkflow  DeliveryRuntime
CarWorkspace        JobWorkspace        ColdStorageWorld
editCar()           editHotel()         editRestaurantHours()
findRestaurantSpecificToJasim()
```

The existence of a recurring domain is **not** a justification for a new core architecture.
If cars appear in ten conversations, that is evidence that `entities`, `economic_expressions`
and generic matching are working — not evidence that JASIM needs a car module.

### 2.2 The exact boundary: domain vs provider

This distinction has been stated imprecisely before, so it is fixed here.

> **Supporting a new semantic DOMAIN must require zero domain-specific core architecture.**
> **Supporting a new external PROVIDER may legitimately require a provider adapter.**

The outside world genuinely has different APIs. A `moyasar-payment.ts`, a `shopify.ts`, a
maps adapter, or a courier adapter at the integration edge is normal and correct — that is
what `api/connectors/` and `capability_provider_catalog` are for. What is forbidden is letting
that adapter become the *ontology*: a `CarrefourWorldRuntime` is a violation; a
`carrefour-provider.ts` implementing the generic purchase/fulfilment contract is not.

So when you are about to add a file, the test is not "does this file mention a domain?" but:

- Does it live at the **integration edge** and implement a **generic contract**? → probably fine
- Does it introduce a **new semantic vocabulary** that only one domain understands? → violation
- Does it create a **second runtime, planner, or truth store**? → violation

### 2.3 It is not a World generator

A stale reading of the older documents can leave you believing that JASIM's job is to create
a World for every request. It is not. Most sentences must **not** produce durable state.

```
"كم الساعة؟"                          → text
"ابحث لي عن 5 فنادق"                  → structured_result / SEARCH_RESULTS
"قارن الثاني والثالث"                  → COMPARISON over the SAME result set
"راقب سعره وبلغني إذا نزل"             → durable_run (+ a Living Object)
"احجزه"                               → direct_action → APPROVAL → execution → verification
"أدر لي هذا النشاط باستمرار"           → persistent_smart_bubble (+ optional World)
```

### 2.4 It is not an LLM with database access

The model is a reasoning organ, not an authority. It may propose meaning, classification,
plans, change sets and presentation intent. It may never own ownership, policy, payment state,
verification state, or canonical truth. See Chapter 4.5.

### 2.5 It is not a dashboard product

An expanded Smart Bubble is still a Bubble surface. It is not an admin console that happens to
be reachable from a chat. There is no "go to the World section" mental model. The conversation
is the product; surfaces come to the conversation.

---

## 3. THE USER EXPERIENCE — "TELL JASIM WHAT YOU WANT TO HAPPEN"

### 3.1 The intended feeling

The person opens JASIM and there is one place to speak. They describe an outcome in their own
words, in Arabic or English, vaguely or precisely. Something appropriate forms in front of
them: sometimes a sentence, sometimes five results they can compare, sometimes a form with
only the fields that are genuinely still missing, sometimes an approval with the real cost on
it, sometimes a map because a driver is actually moving, sometimes a durable business they will
still be running next year.

They never navigate to find the right tool. They never learn where a feature lives. The
interface is an outcome of their sentence.

### 3.2 What the person must never have to do

- learn which "module" handles their problem
- repeat context JASIM already has ("الثاني" must keep working)
- wonder whether something actually happened
- be shown a confident interface built on unavailable data
- approve something whose real consequence is hidden from them

### 3.3 Arabic is not an afterthought

Arabic RTL is a first-class rendering target, and Arabic is a first-class reasoning input.
Ordinals (`الثاني`, `الرابع`), pronouns (`خلها`, `احذفها`), and elliptical follow-ups
(`لا، خليها 90`) are normal JASIM input, and the reference-resolution machinery exists
precisely because of them. A feature that works in English and degrades in Arabic is not done.

### 3.4 Visual language

Approved direction: deep navy / near-black ground, restrained blue–cyan–violet accents, the
"soap glass" layered translucent surfaces, generous rounding, premium but practical density,
Arabic RTL, minimal uncontrolled glow, and a JASIM orb as the intelligence identity.

The visual reference images contain cars, laptops, jobs, tracking, health and travel. Those
prove **generality visually**. They authorize no `CarScreen`, no `JobTab`, no `HealthAgent`.
The real interface usually shows only the currently relevant state.

---

## 4. HOW JASIM THINKS

This is the core reasoning pipeline. Memorize its shape; the rest of the architecture is in
service of it.

```
Human Intent
      ↓
Understand Desired Outcome          (not keywords — outcome)
      ↓
Understand Current Reality          (what already exists for this owner)
      ↓
Resolve Existing Context            (which bubble/world/result set/entity is meant)
      ↓
Actors / Resources / Needs / Offerings
      ↓
Constraints / Rules / Authority     (hard constraints before preference)
      ↓
Compose Capabilities                (semantic ability, not vendor calls)
      ↓
Resolve Providers / Humans / Devices
      ↓
Choose Smallest Sufficient Experience
      ↓
Plan  →  Approval if required
      ↓
Execute  →  Observe  →  Verify
      ↓
Repair / Replan
      ↓
Persistent Useful Outcome
```

And the same pipeline as it exists in the code:

```
POST conversation turn
  → routeRuntimeConversationTurn()            api/runtime/jasim-runtime.ts
    → model gateway proposes an Output Envelope
    → strict validation of the envelope (8 kinds, see 5.1)
    → resolveRuntimeReferences()              stable identity for "الثاني"
    → createExecutionProposal()               fingerprinted
    → decideExecutionProposalApproval()       policy + human authority
    → createRuntimeDag() / refreshRuntimeDag()
    → claim → start → executeRuntimeDagNode() leases + fencing
    → execution_attempts                      immutable history
    → action_receipts                         what a provider claimed
    → execution-verifier.ts                   independent verification
    → reconcileUncertainAttempt()             never a blind retry
    → canonical state + events + versions
    → getRuntimeBubbleProjection() / workspaceProjection / activeLivingObjects
    → PresentationDefinition → Web / iOS / Android
```

### 4.1 Outcome before capability

The wrong reasoning is keyword-driven:

```
user said "احجز"  →  BOOK capability
```

The right reasoning is outcome-driven:

```
user goal
  → desired outcome
  → required sub-outcomes
  → required capabilities
  → available trusted implementations
```

Worked example — `"أريد أن أوصل موظفي شركتي يوميًا."`

```
Desired outcome: reliable daily employee transport
├── employee groups                     entities
├── origin / destination constraints    generic attributes
├── schedule and recurrence             temporal_triggers (RECURRING) + availability_windows
├── vehicle capacity                    resources + capacity (api/runtime/block2/capacity.ts)
├── driver / operator supply            economic_expressions (offering)
├── recurring coordination              assignments
├── tracking / attendance if available   observations + track_sessions
└── economics                           economic_ledger_entries / fee_rules
```

Only after that decomposition do you ask which capabilities are required. This ordering is what
prevents a keyword from silently becoming architecture.

### 4.2 Hard constraints before semantic preference

Enforce the impossible-to-violate first: budget, capacity, location boundary, date, required
certification, availability, currency, permission. Only then rank by semantic relevance.

Semantic similarity must never resurrect a candidate that violates a hard constraint. A 340 KWD
laptop is not "close enough" to a 300 KWD ceiling.

### 4.3 Reference resolution is a first-class organ

Conversation without continuity is not conversation. JASIM persists identity so that a later
turn can mean what the user meant:

```
discovery_result_sets     one durable result set per discovery act
discovery_candidates      durable ORDERED identity — "الثاني" must never drift
reference_bindings        durable reference identity across turns and restarts
```

`resolveRuntimeReferences()` resolves candidates from conversation history, explicit references,
recent activity, semantic descriptions, entity mentions, ownership, recent mutations and
temporal context. It resolves **automatically only when unambiguous**; otherwise it asks a
natural-language clarifying question. Guessing a destructive target is a defect, not a
convenience.

Three specific failures to never commit:

- re-running the search and comparing *its* second and fourth results
- using the currently rendered array index as canonical identity
- matching by title string

### 4.4 Capability ≠ Provider

**Capability** = what can be done, semantically. **Provider** = a trusted implementation that
supplies it.

```
SEARCH   ← internal canonical index | provider A | provider B | MCP | A2A
PAY      ← PSP A | PSP B            (production PSP currently BLOCKED_BY_PROVIDER by decision)
NOTIFY   ← email | SMS | push | messaging provider
```

Provider resolution considers generic criteria only: trust, availability, freshness, protocol
compatibility, contract compatibility, cost, policy, configured status.

And the rule that follows from the separation: **provider failure must never mutate the
capability.** If SEARCH exists but no external provider is configured, the truthful answer is

```
external search capability → BLOCKED_BY_PROVIDER
```

not "search does not exist" and absolutely not a fabricated result list. The registered
capability set today is small and honest — `local-analysis`, `local-calculation`, `notify`,
`openai-chat`, `web-research`, `image-generation`, `research-context` — and every one of them
declares `sideEffects` explicitly in `api/runtime/capability-registry.ts`.

### 4.5 The model proposes; the runtime decides

The model **may**: understand intent, classify, reason, plan, decompose semantically, generate
capability requirements, generate candidates, propose structured ChangeSets, propose
presentation intent, and explain.

The model **may not** own: authentication, authorization, ownership, policy overrides, payment
status, verification status, database state, provider receipt authenticity, execution
completion, settlement, or payout completion.

```
Model output → validation → policy → trusted runtime        ✅
Model output → canonical truth                              ❌
```

Concretely: a model-proposed object carrying `ownerId`, `verified`, `paid`, `settled` or
`policyOverride` must be rejected as authority. Not sanitized quietly — rejected.

### 4.6 The six distinctions that keep JASIM honest

```
Intent      ≠ Proposal
Proposal    ≠ Approval
Approval    ≠ Execution
Execution   ≠ Receipt
Receipt     ≠ Verification
AUTHORIZED  ≠ EXECUTED  ≠ VERIFIED
```

Plus their operational cousins:

```
DISPATCH_ACCEPTED ≠ SUCCESS
PENDING           ≠ SUCCESS
INCONCLUSIVE      ≠ SUCCESS
BROWSER_SUCCESS   ≠ PAID
Capability        ≠ Provider
Entity            ≠ Offering
Need              ≠ Query
TransactionIntent ≠ PaymentIntent
UI                ≠ canonical truth
LLM output        ≠ trusted authority
```

An approval is authority to *attempt* an action within policy. It is never proof that the
external effect occurred.

### 4.7 Uncertainty is a state, not an error to retry away

For any external effect, these are distinct from failure:

```
PENDING        the effect may be in flight
INCONCLUSIVE   the effect is genuinely unknown
UNKNOWN        we have no trustworthy observation
```

None of them may trigger an automatic retry, because **the effect may already have happened.**
A `PAY` request that timed out may well have succeeded with a lost response. Blind retry
duplicates money.

The required order is: reconcile first, then decide whether retry is safe. In code this is the
difference between `PspRejectedError` (the provider definitively said no — retry may be safe)
and `PspUncertainEffectError` (transport failed after the request may have landed — go
INCONCLUSIVE and reconcile via readback). See `api/runtime/block3/psp-client.ts` and
`reconcileUncertainAttempt()`.

"Flake" is not a root cause, and neither is "probably fine".

### 4.8 The attempt ledger is immutable

```
execution_attempts   append-only history of what was actually tried
action_receipts       what a provider claimed
```

Attempt #1 FAILED stays FAILED forever. A permitted retry creates Attempt #2. If #2 becomes
independently VERIFIED, the node's current outcome may become verified — but #1 is never
rewritten into a success, and an older failed attempt never overrides a newer verified one.

History is evidence. Evidence that can be edited is not evidence.

### 4.9 Generality is a property of the whole system

A common and costly misreading is that generality lives in the reasoning layer. It does not.

```
GENERALITY =
    Reasoning Generality
  + Representation Generality
  + Capability Composition Generality
  + Runtime Generality
  + Provider Generality
  + Presentation Generality
```

If the reasoning is general but the runtime can only represent a store and a car, the system is
not general. If the runtime is beautifully general but the model cannot understand a new
problem, the system is equally not general. Both halves must hold, which is why the model
gateway work and the runtime work are not substitutes for each other.

### 4.10 The intelligence ladder

```
Level 1   respond with text
Level 2   understand the goal
Level 3   compose capabilities
Level 4   create a durable system / World
Level 5   evolve that same system conversationally
Level 6   operate autonomously within explicit limits
Level 7   identify meaningful economic opportunity from real needs, unused capacity,
          constraints, trust and economics — then propose, or execute within authority
```

Level 7 is **not** unrestricted autonomy. It still obeys policy, financial mandate
(`mandate_budgets`), approval, authorization, verification, and resource/cost limits. A Level 7
JASIM that spends money outside its mandate is not advanced; it is broken.

---

## 5. SMALLEST SUFFICIENT OUTPUT

### 5.1 The eight output kinds

The Output Router validates a model-proposed envelope into exactly one of eight kinds. These are
the real literals in `api/runtime/jasim-runtime.ts`:

| Kind | Use it when | Durable? |
|---|---|---|
| `text` | a sentence genuinely answers it | no |
| `structured_result` | structured data is clearer than prose | no |
| `ephemeral_bubble` | a throwaway visual surface helps once | no |
| `interactive_bubble` | the person must interact, but nothing must survive | no |
| `direct_action` | one bounded action, possibly needing approval | attempt is durable |
| `workflow` | several coordinated steps, no durable world needed | run is durable |
| `durable_run` | work must survive restarts, time, or conditions | yes |
| `persistent_smart_bubble` | the person will come back to this thing and operate it | yes, + optional World |

**The rule: choose the smallest kind that is actually sufficient.** Over-producing is as much a
defect as under-producing. A World created for a price question is a failure even though
everything "worked".

### 5.2 When a World is justified

A World is the durable internal life behind a persistent Smart Bubble. Create one when the
person is asking for a durable operating system, business, platform, or persistent environment.

```
"أنشئ لي منصة تربط أصحاب المعدات الإنشائية غير المستخدمة بالمقاولين."   → World justified
"كم سعر استئجار حفار؟"                                                → text / results only
```

The second one creating a Construction Marketplace World is a textbook violation of this chapter.

### 5.3 Generated world structure is untrusted configuration

Model-generated "DNA" may propose entities, relationships, workflows, views, rules and
economics. The kernel validates identity, ownership, schema, permissions, lifecycle, versions
and policy. No arbitrary generated executable code ever becomes trusted World runtime.

### 5.4 Worlds evolve conversationally, they are not rebuilt

```
"أضف باقة للشركات بـ100."      → create ONE commercial entity
"خل أول أسبوع مجاني."           → mutate THAT entity
"لا، خليها 90."                 → mutate THAT entity
"احذفها."                      → target THAT entity, with impact policy
```

Four messages, one entity, four versions. Producing four unrelated objects is the failure mode
this section exists to prevent. Mutations are classified generically —
`DATA`, `STRUCTURAL`, `POLICY`, `WORKFLOW`, `VIEW`, `PERMISSION`, `COMMERCIAL` — and applied with
optimistic concurrency on `baseVersion`, so a stale write is rejected rather than overwriting
newer truth. A failed or blocked capability must never leave the World corrupted.

---

## 6. FROM CONVERSATION TO REAL-WORLD ACTION

### 6.1 JASIM does not touch the world directly

JASIM coordinates arms. It has no hands of its own. Its arms are:

```
Human       API        Vehicle     Robot      IoT device
Payment rail           Courier     Email      Phone
MCP server             A2A agent   Organization
```

So every real-world outcome has the same shape:

```
Intent → orchestration → real actor → observation → verification
```

The `DiscoverySourceKind` enum already encodes this pluralism honestly:
`JASIM_INTERNAL`, `WEB_OBSERVATION`, `CONNECTED_PROVIDER`, `MCP_PROVIDER`, `A2A_PROVIDER` —
and `CandidateTrust` separates `canonical_internal` from `untrusted_external_evidence`, because
an external observation is evidence, never truth.

### 6.2 Observation is the only source of real-world state

```
observations             trusted observations (api/runtime/block2/observations.ts)
track_sessions           bounded live tracking sessions
fulfillment_observations truthful real-world observations only — explicitly "no fake GPS"
```

If there is no observation, JASIM does not know. "Does not know" is a renderable, respectable
state. Inventing a coordinate to make a map look alive is one of the worst things you can do in
this codebase, and the schema comments say so in as many words.

### 6.3 The economic grammar

The generic sequence, with the real table behind each step:

```
ACTOR / ENTITY          entities
      ↓
RESOURCE                entities + capacity/units
      ↓
OFFERING / NEED         economic_expressions   (kind: offering | need)
      ↓
DISCOVERY               discovery_result_sets + discovery_candidates
      ↓
MATCH                   economic_matches
      ↓
OPPORTUNITY             derived
      ↓
ENGAGEMENT              economic_engagements
      ↓
PROPOSAL                economic_proposals
      ↓
TRANSACTION INTENT      transaction_intents
      ↓
COORDINATION            assignments + reservations + temporal_triggers
      ↓
PAYMENT / ECONOMICS     payment_intents + economic_ledger_entries
```

Visibility is enforced at the expression level (`private | unlisted | shared | public`), which
is why a private offering must never leak into public discovery no matter how semantically
relevant it is.

### 6.4 Entity ≠ Offering ≠ Need ≠ Query

- A farmer is an **entity/actor**.
- Tomatoes available for sale are an **offering**.
- A truck is a **resource**; its unused return capacity may *become* an offering.
- A warehouse is a **resource**; its unused 1,100 m² may *become* an offering.
- "أحتاج 2 طن طماطم أسبوعيًا" is a **need** — durable, structured, with quantity, recurrence,
  location and price constraints.
- The search string is merely one way to discover supply for that need.

Flattening all of these into one generic "item" destroys matching and economics. Keep them
distinct.

### 6.5 Money truth

```
TransactionIntent ≠ PaymentIntent

payment_intents lifecycle (real literals):
CREATED → REQUIRES_APPROVAL → EXECUTING → PROVIDER_AUTHORIZED → CAPTURED → SETTLED
                    ↘ FAILED | CANCELLED | EXPIRED | INCONCLUSIVE
```

- **Browser success ≠ paid.** A `?success=true` redirect tells you the browser came back. Nothing more.
- **Provider receipt ≠ verified.** An HMAC-authenticated callback proves *who sent it and that the
  bytes were not tampered with*. It does **not** prove the money moved, and it does not prove the
  amount is the one you authorized.
- **The client can never set** `paid`, `verified`, `captured` or `settled`.
- **Refund is a new immutable effect**, never a rewrite. `economic_ledger_entries` is append-only:
  balances are derived, never stored.
- **No fake escrow.**
- Production PSP access is `BLOCKED_BY_PROVIDER` by decision, and the only permitted
  implementation today is the controlled test provider over a real HTTP boundary.

Keep the five economic meanings in separate fields, never one reused number:

```
CUSTOMER_PAYMENT   SELLER_VALUE   SELLER_PAYABLE   PROVIDER_COST   JASIM_REVENUE
(+ REFUND, PAYOUT, ADJUSTMENT)
```

Canonical money is fixed-precision minor units. Never floating point. KWD has three decimal
places, and `api/runtime/block3/money.ts` exists so that nobody "helpfully" reintroduces a float.

### 6.6 Model cost is not payment money

`model_usage_ledger` records provider, model, tier, tokens, latency and estimated cost. That is
operational telemetry. It may inform business economics. It is **not** a customer payment
transaction and must never enter the financial ledger.

### 6.7 Authority and mandate

`mandate_budgets` is how JASIM is allowed to act with money without asking every time — and how
it is stopped. It is atomic under concurrency: two simultaneous 60.000 KWD spends against a
100.000 KWD budget cannot both win. A currency mismatch fails closed.

So when a user says "ادفع 500 دينار" and the mandate is 50:

```
REQUIRES_APPROVAL         ✅
"the LLM judged it reasonable"   ❌
```

---

## 7. HUMANS, APIs AND DEVICES AS EXECUTION PROVIDERS

### 7.1 A provider is not necessarily software

This is one of the most practically important ideas in JASIM, and it is easy to miss.

```
Need: buy milk, bread and diapers, under 15 KWD
  Provider option A: a store API                      → CONNECTED_PROVIDER
  Provider option B: the driver who is already driving past the store   → a human
```

If there is no store API, that is not a dead end. The human driver becomes the execution
provider. The generic contract is unchanged: there is an assignment, a budget constraint, an
attempt, a receipt (a photo, a confirmation, a total), verification, and a truthful outcome.

`remote_executions` and the MCP/A2A source kinds exist precisely so that "the thing that
performs the work" can be a person, a machine, or another agent without the runtime caring.

### 7.2 Delegation and membership are how other people enter

```
memberships        who may see and act on a resource   (invited | active | revoked | expired)
delegation_grants  bounded authority handed to someone else (active | revoked | expired)
```

A human provider acting on the owner's behalf acts through bounded authority, not through
borrowed credentials. Authority is always scoped, always revocable, always auditable.

### 7.3 Substitution is a policy question, not a preference

The driver reports: *"الحفاضات المطلوبة خلصت، لكن فيه نوع بديل."*

The wrong instinct is for the intelligence to pick something similar. The right behavior:

```
Is substitution permitted by policy, within budget, within the mandate?
  yes  → continue, record the substitution
  no   → ask the owner
```

Intelligence without authority is not helpfulness; it is unauthorized action.

### 7.4 Notification is a provider too

`notification_intents` carries a per-channel state, and `BLOCKED_BY_PROVIDER` is a real state in
that enum. An enqueued notification is not a delivered message; a delivery receipt is not proof
of reading. JASIM models all three separately, and today no production delivery channel is
configured — so the honest state is the blocked one.

---

## 8. GENERATIVE UI AND TEMPORARY INTERFACES

### 8.1 The rendering contract

```
Semantic result
  → PresentationDefinition          (lib/jasim-runtime-contract/src/index.ts)
  → runtime validation
  → static allowlisted component resolution
  → renderer (Web / iOS / Android)
```

`PresentationDefinition` is `{ primitive, version: 1, title?, data, fields?, children?, actions? }`
over a closed set of 40 primitives — among them `TEXT`, `SEARCH_RESULTS`, `COMPARISON`, `FORM`,
`APPROVAL`, `CHECKOUT`, `PAYMENT_STATUS`, `STATUS`, `PROGRESS`, `TRACKER`, `MAP`, `ROUTE`,
`RECEIPT`, `WORLD_SUMMARY`, `WORKSPACE`, `ERROR_STATE`, `EMPTY_STATE`, `SMART_BUBBLE` — and a
closed set of 13 action intents (`approve`, `reject`, `submit`, `cancel`, `select`, `retry`,
`open`, `open_external`, `expand`, `minimize`, `restore`, `archive`, `update`).

Fields carry `verified` and `unknown` flags. That is not decoration: it is how the renderer
shows what is actually known versus merely present.

### 8.2 Absolutely forbidden in the UI layer

```
model-generated React          ❌
model-generated JavaScript     ❌
raw generated HTML execution   ❌
arbitrary dynamic imports      ❌   e.g. { "component": "../../AdminPanel" }
executable generated URL schemes ❌  e.g. javascript:alert(1)
arbitrary generated styles     ❌
WebView Smart UI on mobile     ❌
```

Generated and provider content is **data**. An unsupported semantic type fails closed — it does
not fall back to executing something. This is enforced through a static local registry, and
browser renderers must not runtime-import server source under `api/`.

### 8.3 Workspace: what matters now

`ActiveWorkspaceProjection` is the current visual context of an active goal — an owner-scoped
**read model**, not canonical state. Its statuses are
`idle | active | awaiting_input | awaiting_approval | running | blocked | failed | completed`,
and its attention kinds are `input_required | approval_required | blocked | failed | ongoing`
with a severity.

It projects only currently provable references. There is no "Workspace entity" and there must
never be one.

### 8.4 Morphing: the interface evolves rather than accumulates

```
ENTER      a surface appears
UPDATE     same surface, new data
MORPH      the same active surface becomes a different primitive
EXIT       the surface is no longer the current useful state
NO_CHANGE  nothing to do
```

So a real sequence is one evolving surface:

```
SEARCH_RESULTS → COMPARISON → FORM → APPROVAL → STATUS
```

Not five live cards stacked forever. Conversation history preserves history; the Workspace shows
what matters now. Two rules protect this: a stale presentation version may never overwrite a
newer one, and transition cleanup is scoped by conversation + presentation identity + transition,
so a late timer cannot revive a dead surface.

### 8.5 The map that appears and disappears

This is the canonical illustration of the whole chapter, so it is worth walking through.

```
Delivery is active, and a trusted location observation exists
  → spatial presentation is justified
  → MAP / ROUTE / MARKER   (ENTER)

New observations arrive
  → same surface                          (UPDATE)

Driver reports delivered, verification policy satisfied, proof recorded
  → DELIVERY_COMPLETED is canonical
  → the map is no longer the current useful state
  → MAP                                   (EXIT)
```

The map disappears **without deleting operational history**. The delivery, its observations, its
attempts and its receipt all remain. What ended was a presentation, not a fact.

And note what did *not* happen: no `DeliveryTrackingPage.tsx` was created for this domain. The
map appeared because coordinates were trustworthy and a goal was spatial — not because the
request was a delivery.

### 8.6 Living Objects: ongoing durable work

A Living Object represents work that is genuinely ongoing: an active order, a price monitor, a
persistent World, an ongoing negotiation, a scheduled task, a long-running execution.
`semanticType` is `process | world | bubble`; `durability` is
`ongoing | persistent | recently_completed`.

Do **not** create one for a simple text answer, an ordinary search, a one-off comparison, or a
document summary — unless the person made that process durable.

Two hard rules:

1. **Status, attention and progress come from canonical projection.** The UI cannot manufacture
   them. Client state may control presentation only, never lifecycle truth or actions.
2. **One user-facing process is one object.** If Task T1 and Run R1 are the same process to the
   human, the projection merges them. Two cards for one process is a defect. Deduplication uses
   explicit same-runtime keys only — never inference across legacy and runtime ID domains.

### 8.7 Web and Mobile: same meaning, different bodies

Identical across platforms: goal, result set, reference bindings, presentation definition,
canonical action, living-object identity, status, attention, versions.

Legitimately different: layout, animation, navigation, sheet strategy, density.

Mobile is not desktop compressed. It is conversation-first, with native generated surfaces, a
persistent composer, compact Living Objects, native morphing, and first-class Arabic RTL.

And the file-count fallacy, stated once so nobody repeats it: `artifacts/jasim-mobile` having
few files is *supporting* evidence of the projection model, not proof of it. Mobile may grow
large — camera, notifications, offline cache, accessibility, biometrics, permissions, platform
renderers — and still be a pure projection. The only real test is:

> **Where does canonical business truth live?** If the answer is the server, thinness is
> irrelevant. If the answer is partly the client, no amount of thinness saves the architecture.

---

## 9. THE EXAMPLE LIBRARY

Chapter 9 is large enough to live on its own. It contains 110 end-to-end examples, each in a
fixed 12-field format, spanning simple questions, discovery, reference continuity, durable work,
drivers and maps, human providers, Worlds, conversational mutation, multi-resource economics,
Level 7 opportunity discovery, and adversarial/negative cases.

→ **`00B_JASIM_BEHAVIOR_EXAMPLE_LIBRARY.md`**

Read it before implementing anything that touches the conversation path. The examples are
**acceptance tests, not features**: passing one by adding a domain handler is a failure of the
generality objective even if the example visibly works.

---

## 10. ANTI-EXAMPLES — HOW *NOT* TO BUILD JASIM

### 10.1 How to notice you have misunderstood JASIM

Watch your own vocabulary while you design. It is the earliest warning you get.

**If you are thinking in these words, you are drifting away from JASIM:**

```
CarAgent        DeliveryAgent    RestaurantAgent   WarehouseAgent
SchoolAgent     TravelAgent      ScaffoldingAgent  BoatAgent
"a module for X"                 "a screen for Y"
"just for this domain"           "a quick handler so the demo works"
```

**If you are thinking in these words, you are on the right path:**

```
Actor   Resource   Need   Offering   Capacity   Constraint
Capability   Provider   Task   Run   World   Policy
Observation   Attempt   Receipt   Verification   Projection
```

### 10.2 The named failure modes

| # | Failure | What it looks like | Why it is fatal |
|---|---|---|---|
| 1 | Domain agent | `ScaffoldingAgent.ts` | turns JASIM into a mini-app zoo |
| 2 | Second runtime | "a small planner just for mobile" | two truths, guaranteed divergence |
| 3 | Fake provider result | invented products when no provider exists | destroys the one thing users cannot verify: honesty |
| 4 | Fake map / ETA / progress | synthetic coordinates, 10→30→70→100% timer | fabricates reality |
| 5 | Browser success = paid | `?success=true` sets `paid` | financial falsehood |
| 6 | Receipt = verified | provider callback marks VERIFIED | skips the verifier |
| 7 | Blind retry on INCONCLUSIVE | retry after a timeout | duplicates money |
| 8 | Rewritten history | flipping Attempt #1 to success | evidence becomes fiction |
| 9 | LLM as authority | model output sets `ownerId`/`verified` | privilege escalation by prompt |
| 10 | Generated code execution | rendering generated HTML/JS | remote code execution |
| 11 | Dynamic component import | `{"component": "../../AdminPanel"}` | privilege escalation by JSON |
| 12 | Client canonical truth | mobile decides a run completed | two sources of truth |
| 13 | World for everything | a price question creates a World | violates smallest sufficient output |
| 14 | Four objects for four messages | losing entity reference continuity | breaks conversation |
| 15 | Float money | `0.1 + 0.2` as authoritative | silent financial corruption |
| 16 | Model cost in the financial ledger | token cost as a customer payment | corrupts money truth |
| 17 | Private data in public discovery | semantic match leaks another owner's offering | data breach |
| 18 | Cross-conversation leakage | conversation A's approval appears in B | breaks isolation |
| 19 | Stale presentation overwrite | late P5 response replaces P6 | UI shows the past as present |
| 20 | Two cards for one process | Task card + Run card for one delivery | the human sees machinery, not their work |
| 21 | Weakened test to get green | skipping/relaxing a DB-collision test | destroys the evidence base |
| 22 | Domain patch after seeing the fixture | adding a handler once a generality test fails | invalidates the test |

### 10.3 Three anti-examples in full

**Anti-example A — the honest map**

```
USER:        "اعرض لي السائق على الخريطة."
REALITY:     no trusted location observation exists
WRONG:       generate a plausible map, coordinates and ETA
RIGHT:       "لا يوجد مصدر موقع حي متصل حاليًا."   (ERROR_STATE / STATUS, truthfully)
WHY:         a convincing map built on nothing is worse than no map — the user will act on it
```

**Anti-example B — the mandate**

```
USER:        "ادفع 500 دينار."
REALITY:     mandate_budgets allows 50 KWD
WRONG:       the model concludes the payment is reasonable and proceeds
RIGHT:       payment_intents → REQUIRES_APPROVAL, with the real amount and the real limit shown
WHY:         the model has no financial authority; mandate is enforced atomically, not advised
```

**Anti-example C — the receipt**

```
PROVIDER:    returns success = true, HMAC signature valid
WRONG:       mark the effect VERIFIED
RIGHT:       record EXECUTED + action_receipts; verification is a separate, independent decision
WHY:         a valid signature proves origin and integrity — never that the world changed
```

### 10.4 The one legitimate way to change frozen architecture

Architecture freeze is ACTIVE for: kernel, canonical runtime, capability fabric,
capability/provider separation, trusted execution lifecycle, Task/Run/DAG semantics, attempt
ledger, reconciliation semantics, payment truth boundaries, trusted action dispatcher,
`PresentationDefinition` architecture, Workspace semantics, Living Object semantics, Web/Mobile
parity, and canonical truth ownership.

A frozen component may change only when **all six** hold:

1. a reproducible production blocker exists;
2. the existing extension points cannot solve it safely;
3. the blocker is documented;
4. the minimum architectural change is proposed;
5. regression impact is understood;
6. owner approval is obtained where the change is material.

Cleaner code, a fashionable framework, a preferred agent library, or "this would be more
idiomatic" are **not** justifications. If your conclusion is that JASIM should be rebuilt as
domain agents, as LangGraph/CrewAI/AutoGen workflows, as separate apps, or on a different
runtime — **stop and report**, because that conclusion conflicts with the inherited architecture
unless a proven production blocker says otherwise.

### 10.5 The question to ask before adding anything

```
Does this add a generic capability?
Does it improve composition?
Does it improve truth?
Does it improve reliability?
Does it improve production access?
Does it improve cost efficiency?
Does it improve evidence?
```

If the only honest answer is *"it makes this one example pass"*, it does not belong in the core.

---

## 11. ENGINEERING MOTTO

```
Explore first.
Understand ownership.
Preserve invariants.
Make the smallest sufficient change.
Test the real path.
Never claim what was not proven.
```

JASIM becomes more capable by improving general primitives, providers, reasoning, observation,
verification, recovery and economics — never by accumulating hardcoded domains.

END OF ADVANCED VISION, BEHAVIOR AND EXAMPLES.
