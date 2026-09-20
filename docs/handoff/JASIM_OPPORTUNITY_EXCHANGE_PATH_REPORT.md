# JASIM — OPPORTUNITY EXCHANGE · the conversational path · phase report

**Gap closed:** `OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH` — the largest in the
acceptance catalog at 35 scenarios.

**Rule held throughout:** `DOMAIN_MARKETPLACES_ADDED = 0` · `NEW_DOMAIN_BRANCHES = 0` ·
`DOMAIN_AGENTS_ADDED = 0` · `FALSE_SUCCESS = 0`.

---

## 1. What was actually missing

The exchange in `economic-fabric.ts` was already complete and domain-free before this
phase: Need and Offering share one `EconomicExpression`, constraints are typed,
matching is deterministic with unit normalisation, composite matches exist, private
attributes never cross an owner boundary, and nothing in it names an industry.

What was missing was **a door**. Nothing a person said could reach it.

Not a marketplace. Not a primitive. A door.

## 2. What was built

Two entries in the capability registry — `opportunity-publish` and
`opportunity-discover` — so the **existing** GoalSpec → PlanGraph → DAG path reaches the
exchange the way it reaches anything else.

**No new semantic route.** A route would have made the market a destination the runtime
navigates to; a capability makes it a mechanism a plan can name. That is also what makes
it compose: «اعرض شاحنتي الفارغة ثم ابحث عن شحنة» is two nodes with a dependency, not a
mode the runtime switches into. `NEW MARKET CATEGORY != NEW MARKETPLACE`, enforced by a
test that the route list gained nothing.

| decision | why |
|---|---|
| owner from the execution context, never inputs | identity comes from the session |
| public projection built by the runtime | a caller that chose what becomes public could publish a private bound by naming it |
| visibility is `PRIVATE` or `PUBLIC` only | sharing with a named party is a per-party grant, which is a separate authority act |
| `INTERNAL_STATE` + a readback resolver | JASIM owns this record, so JASIM's own readback verifies it — and its own return value does not |
| withdrawal is `PARTIALLY_COMPENSATABLE` | a published Offering cannot be unseen |

## 3. Two defects found by doing the work

**A top-level `ownerId` was silently ignored.** The reserved-key screen ran on
`attributes` but not on the inputs themselves. The owner was never wrong — it comes from
the session — but silently ignoring an identity claim is how a caller comes to believe it
worked. It is now refused and says so. The fix needed two key sets, not one: `visibility`
is a legitimate *input* and an illegitimate *attribute*, and screening it in both places
refused the ordinary case.

**A keyword outranked a plan.** The legacy commerce orchestrator decides by regex over
the raw text: anything containing «ابحث», `search`, `find` or `match` was answered by its
discovery branch *before* the router's plan was consulted. Harmless while nothing else
could answer those turns; not harmless once a plan could name a capability that does the
job properly. A validated plan now outranks the keyword — the semantic router's own rule
applied one layer up. A turn carrying no plan behaves exactly as before, which is why
every inherited commerce path is untouched (Block 3.1: 210 → 256, all passing).

## 4. Proof

`tests/block31/opportunity-exchange-turn-path.test.ts` — 46 tests on the real executor:

- publishing an Offering and a Need, each VERIFIED by internal readback
- a Need matching a published Offering **from another owner**
- a Need that cannot be met finding nothing rather than something close
- discovery listing public offerings and nobody's private ones
- identity, state transitions, `SHARED` visibility and unknown operators all refused
- the private bound structurally absent from the public projection
- one owner holding a Need and an Offering at once
- **all sixteen catalog holdouts** published and matched — each with a bound that must
  hold and a counter-case that must not match
- **a conversational turn planning two exchange nodes with a real dependency**

`tests/unit/opportunity-exchange-contract.test.ts` — 29 tests: identity and authority
refusal, projection safety, the closed operator vocabulary, bounds, and that the module
interprets no field name (`quantity`, `kilowatts` and `degreesCelsius` are four identical
fields to it).

## 5. Catalog effect

| gate | before | after |
|---|---:|---:|
| EXECUTABLE | 24 | **59** |
| OBSERVABLE | 54 | 61 |
| VERIFIABLE | 49 | 56 |

`OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH` is removed from the vocabulary of blames.
Scenarios waiting on a general capability: 104 → **69**.

One status was **downgraded** by doing the work: `market.claim_is_not_availability` had
`OBSERVABLE`/`VERIFIABLE` at PASS. The claim can now be published and is stored as a
claim — but nothing observes a seller's stock, so both are now `BLOCKED_BY_PROVIDER`.
`OPEN_MARKET != UNVERIFIED_MARKET` is a law, not an achievement.

## 6. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 1952 passed, 27 skipped · 87 files | 1923, 27 · 86 | +29, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 256 · 27 files | 210 · 26 | +46, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

No inherited test was weakened.

## 7. What this phase did **not** do

- **No negotiation.** `GENERAL_AGREEMENT_RUNTIME` is untouched — proposals, counter-
  proposals, bounded authority and agreement remain a separate gap, still 11 scenarios.
- **No transactions or fulfillment.**
- **No external discovery.** `EXTERNAL_DISCOVERY_PROVIDER` is the one remaining blocker
  in the open-market family, and it is a provider gap.
- **No surface.** Discovery returns structured results; projecting them as a dataset a
  person can sort, chart and point at by ordinal is a presentation phase.
- **No model was involved.** `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`; the envelope is
  stubbed exactly as in every previous phase.

## 8. Next general gap

`BUSINESS_SCOPE_RUNTIME` — 17 scenarios. A Business that owns data, Needs, Offerings,
Resources, Capacity, policies, provider bindings, a team and permissions. It is the scope
the exchange's expressions want to hang from, and it is what JASIM OS is made of.
