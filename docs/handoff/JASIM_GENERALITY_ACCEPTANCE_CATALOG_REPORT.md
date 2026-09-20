# JASIM — GENERALITY ACCEPTANCE CATALOG & RATCHET · phase report

This phase built **acceptance infrastructure**. It implemented no subsystem, connected
no provider and made no scenario greener than the repository actually is.

---

## 1. What was built

| | |
|---|---|
| `tests/generality/catalog.ts` | 155 scenarios across 17 families, each with 8 independent gate statuses, its general primitives, capabilities, provider classes, effect class, the one general gap blocking it, and what the runtime honestly does today |
| `tests/generality/render.ts` | renders the scoreboard and scenario tables into the document's generated region |
| `tests/unit/generality-catalog.test.ts` | 36 CI tests: well-formedness, no-false-pass invariants, ratchets, holdouts, open-market and negotiation genericity, a pinned scoreboard, and document/law synchronisation |
| `docs/master/JASIM_GENERALITY_ACCEPTANCE_CATALOG.md` | the catalog, with its generated region verified against the data |
| `docs/master/JASIM_GENERALITY_MAXIMUM_SPEC.md` | the governing generality law, including the **JASIM OPEN MARKET LAW** |

Gate defaults in the data are **pessimistic**: a gate nobody thought about reads
`NOT_YET_IMPLEMENTED`, never `PASS`. Forgetting cannot be the permissive path.

## 2. The scoreboard

**155 scenarios · 16 blind holdouts.** No single percentage is published; eight gates
answer eight questions.

| gate | PASS | NOT_YET_IMPLEMENTED | BLOCKED_BY_PROVIDER | BLOCKED_BY_ENVIRONMENT | NOT_APPLICABLE |
|---|---:|---:|---:|---:|---:|
| REPRESENTABLE | 155 | 0 | 0 | 0 | 0 |
| ROUTABLE | 155 | 0 | 0 | 0 | 0 |
| PLANNABLE | 116 | 39 | 0 | 0 | 0 |
| EXECUTABLE | 24 | 104 | 25 | 2 | 0 |
| OBSERVABLE | 54 | 18 | 18 | 0 | 65 |
| VERIFIABLE | 49 | 23 | 18 | 0 | 65 |
| PRESENTABLE | 153 | 2 | 0 | 0 | 0 |
| PERSISTENT | 121 | 17 | 0 | 0 | 17 |

Read honestly: **everything JASIM has been asked to do is representable and routable
with no domain branch, and 24 of 155 can actually be carried out today.** That gap is
the truth this phase exists to state.

29 scenarios wait on an absent provider; 2 on this environment; 104 on a general
capability.

## 3. The fourteen general gaps

Each closes many scenarios at once — which is what makes it general rather than a
feature.

```
OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH   GENERAL_AGREEMENT_RUNTIME
GENERAL_TRANSACTION_FULFILLMENT            REALTIME_RUNTIME
MONITORING_ENGINE                          LIVING_OBJECT_RUNTIME
PERSISTENT_WORLD_MATERIALIZATION           SECURE_PRODUCT_ACTION_RUNTIME
BUSINESS_SCOPE_RUNTIME                     BUSINESS_DATA_SOURCE_ADAPTER
EXTERNAL_DISCOVERY_PROVIDER                LOCATION_OBSERVATION
SPONSORED_DISCOVERY_RUNTIME                SUBSCRIPTION_RUNTIME
```

## 4. What tracing the repository actually found

Two assumptions were wrong, and the catalog records what is really there:

- **The Internal Opportunity Exchange largely exists.** `economic-fabric.ts` carries
  Need and Offering in one generic `EconomicExpression` with private constraints, a
  public projection, access grants, deterministic matching including composite
  matches, versioned proposal terms, and acceptance into a `TransactionIntent` that is
  explicitly not a payment. What is missing is a **conversational path into it** —
  one gap, not one per market category.
- **Internal/external discovery scope already exists.** `planSources` honours
  «فقط داخل جاسم» and «فقط في الإنترنت» and otherwise plans both. The missing piece is
  a live external provider, not the semantics.

## 5. Two inconsistencies the catalog's own invariants caught

The no-false-pass tests failed on their first run — against the catalog itself:

1. `data.missing_resource` named a blocker while every gate passed. Answering
   «لا يوجد مصدر بيانات» to a resource that does not exist **is** the complete correct
   behaviour; the gap belongs to `data.business_source`, which is about having the data.
2. `realtime.delivery_tracker` claimed `VERIFIABLE = PASS` while its observation was
   `BLOCKED_BY_PROVIDER`. A location that cannot be observed cannot be verified, and a
   MAP must never invent one.

## 6. What the ratchets prove — and do not

| ratchet | proves | does not prove |
|---|---|---|
| `DOMAIN_BRANCHES_REQUIRED = 0` | every scenario is declared to need no domain branch | that the declaration is honest |
| `BLIND_HOLDOUT_REQUIRING_DOMAIN_BRANCH = 0` | 16 unfamiliar domains represent and route on existing primitives | that they can be executed — most cannot, and say so |
| no domain identifier exported by the runtime | no exported runtime name is an industry noun | that the logic inside is domain-free |
| holdouts import no production module | the holdout suite cannot have shaped production code | that no future code will be written for them |

The behavioural counterpart is `tests/block31/effect-observation-verification.test.ts`,
which runs five unfamiliar domains through one capability and one declaration. Neither
kind of check is sufficient alone, and the document says so.

## 7. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 1923 passed, 27 skipped · 86 files | 1887, 27 · 85 | +36, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 210 · 26 files | 210 · 26 | 0 |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

No inherited test was weakened, and no runtime file was changed by this phase.

## 8. The next general gap

`OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH` — **35 scenarios**, more than twice the next
gap, and the one that turns an existing generic exchange into something a person can
actually reach by speaking. Every open-market pair, all 16 holdouts and
`market.claim_is_not_availability` are waiting on it.

The gaps ranked by how many scenarios each would close:

```
OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH  35
BUSINESS_SCOPE_RUNTIME                    17
GENERAL_AGREEMENT_RUNTIME                 11
SECURE_PRODUCT_ACTION_RUNTIME              9
PERSISTENT_WORLD_MATERIALIZATION           7
GENERAL_TRANSACTION_FULFILLMENT            7
MONITORING_ENGINE                          6
REALTIME_RUNTIME                           5
EXTERNAL_DISCOVERY_PROVIDER                3
SUBSCRIPTION_RUNTIME                       2
SPONSORED_DISCOVERY_RUNTIME                2
LIVING_OBJECT_RUNTIME                      1
BUSINESS_DATA_SOURCE_ADAPTER               1
LOCATION_OBSERVATION                       1
```
