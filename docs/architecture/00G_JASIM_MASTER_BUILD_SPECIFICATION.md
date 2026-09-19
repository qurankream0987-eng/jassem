# 00G — JASIM MASTER BUILD SPECIFICATION

**Status:** BINDING · GOVERNING DOCUMENT · **Recorded:** 2026-09-19
**Source:** product owner, 93 sections, supplied verbatim
**Instruction accompanying it:** «ادرس فقط» — **study only. Not executed.**

This supersedes nothing and governs everything: where an earlier document
disagrees with this one, this one wins. It is recorded here so the next phase
has a single reference, and so the owner-facing boundary (§78–§82) is not
rediscovered each time.

---

## 1. What this document is for

> إكمال جاسم كمنتج عام Generative Universal Runtime إلى أقصى درجة ممكنة من داخل
> الكود، بحيث يتبقى على المالك أساسًا: إنشاء/امتلاك الحسابات الخارجية، وضع
> المفاتيح والأسرار، إتمام العقود التجارية، اعتماد القرارات النهائية، ثم النشر.

The operative rule, and the one that changes day-to-day behaviour most:

```
A missing provider does NOT stop the product build.

Build: contract · adapter boundary · validation · UI states ·
       provider registry · tests · failure semantics

Then return truthfully:  BLOCKED_BY_PROVIDER  /  BLOCKED_BY_CONFIGURATION

Never: fake success.
```

## 2. The law (§2)

```
ONE JASIM · ONE CENTRAL INTELLIGENCE · ONE CONVERSATION CONTROL PLANE
ONE GENERAL SEMANTIC RUNTIME · ONE TRUSTED EXECUTION RUNTIME
ONE CANONICAL STATE · ONE GENERAL CAPABILITY SYSTEM
ONE GENERAL PROVIDER SYSTEM · ONE GENERAL EVENT/POLICY/SECURITY TRUTH
ONE GENERATIVE PRESENTATION SYSTEM
```

```
NEW EXAMPLE   != NEW AGENT
NEW DOMAIN    != NEW CORE
NEW BUSINESS  != NEW RUNTIME
NEW PROVIDER          may be needed
NEW GENERIC CAPABILITY may be needed
```

Forbidden by name: `RestaurantAgent`, `JobsAgent`, `DriverAgent`, `TravelAgent`,
`CarAgent`, `SalesAgent`, `InventoryAgent`, `HiringAgent`, `RecruitmentAgent`,
`ShoppingAgent`.

On finding a gap, the question is **"is this a GENERIC gap?"** If yes, solve it
generally. If no, it does not enter core.

## 3. Trust laws (§6, §7) — unchanged from what is already built

```
AUTHORIZED != EXECUTED            EXECUTED != VERIFIED
RECEIPT != VERIFICATION           PROVIDER CLAIM != CANONICAL OBSERVATION
INCONCLUSIVE != SUCCESS           PAYMENT AUTHORIZED != SETTLED
TRANSACTION != FULFILLMENT

LLM = UNTRUSTED PLANNER / CLASSIFIER / GENERATOR
RUNTIME = AUTHORITY
```

The model may never decide: `ownerId`, `authorized`, `approved`, `verified`,
`paid`, `providerTrust`, `executionStatus`, `effectTruth`, `completionTruth`,
`securityRole`.

## 4. The canonical flow (§8)

```
USER → MAIN CONVERSATION → CONVERSATION INTELLIGENCE → REFERENCE RESOLUTION
→ GOALSPEC → SEMANTIC ROUTER → one of {TEXT, DIRECT_READ,
  GENERATED_PRESENTATION, TRUSTED_PRODUCT_ACTION, PLANGRAPH/DURABLE_RUN,
  MONITORING, PERSISTENT_LIVING_OBJECT, PERSISTENT_WORLD}
→ CAPABILITY RESOLUTION → PROVIDER RESOLUTION → POLICY → APPROVAL
→ DURABLE EXECUTION → ATTEMPT → RECEIPT → OBSERVATION → VERIFICATION
→ REPAIR/COMPENSATION → CANONICAL STATE → EVENT → REALTIME
→ PRESENTATION IR → WEB / IOS / ANDROID
```

## 5. Owner boundary (§78–§82, §92)

Claude completes everything buildable **before** asking. The owner keeps:
account ownership, secrets placement, commercial terms, legal approval, final
release authority. Secrets are **named**, never pasted into chat or code.

The required handoff shape (§80) is reproduced verbatim in
`docs/handoff/JASIM_OWNER_ACTION_FORMAT.md` when the first one is needed.

**§81 is load-bearing:** a missing MapsProvider blocks map execution only. It
does not block datasets, auth, transactions, search, realtime, UI or worlds.

## 6. Pricing is policy, not code (§72–§77)

```
PRICE != CODE CONSTANT
PRICE  = VERSIONED COMMERCIAL POLICY
```

The launch numbers in §72 are **proposals**, explicitly `CONFIGURABLE ·
VERSIONED · CHANGEABLE · NOT HARDCODED`, and are to be set after economic
telemetry (§73). **No price from §72 has been written into the codebase**, and
none should be until a `PricingCatalog` with `PlanVersion` / `EffectiveDate` /
`Currency` / `Region` / `Tax` / `Grandfathering` exists to hold it.

## 7. Ads law (§70)

```
SPONSORED != BEST
ADVERTISER MONEY != ANSWER AUTHORITY
BUSINESS SUBSCRIPTION != ORGANIC RANK
```

Hard constraints are applied **before** ad eligibility. And §68: do not build
ads on top of fabricated discovery.

## 8. Reporting contract (§91)

Every phase report from now on returns exactly:

```
PHASE · WHAT_CHANGED · REAL_PATH_PROOF · VISUAL_PROOF · GENERALITY · SECURITY
FALSE_SUCCESS · DOMAIN_SPECIFIC_CORE_ADDED · NEW_DOMAIN_BRANCHES · TESTS
TYPECHECK · WEB_BUILD · MOBILE_BUILD · STAGING · OWNER_ACTION_REQUIRED
NEXT_PHASE_READY  → then STOP
```

§87 requires suite totals to carry **file counts**, which
`JASIM_TEST_SUITE_CONTINUITY.md` already established.

---

## 9. Study notes — where this meets the code today

Read against the repository, not the docs. These are the points a future phase
should not have to rediscover.

### 9.1 Where §10's stated gap now stands

§10 says: *"PlanGraph exists but does not yet drive the real conversation path."*
**As of this commit it does.** `routeRuntimeConversationTurn` evaluates a
model-proposed `planGraph`, validates it against the GoalSpec, and materialises
an executable DAG plan into real `dag_nodes` / `dag_dependencies` rows. Proven in
`tests/block31/plan-graph-turn-path.test.ts` (10 tests) on the shipped path with
only the provider call stubbed.

The legacy flat path remains as §11 permits — **measurable, not hidden**: a turn
with no plan takes it and is byte-for-byte unchanged, and `modelMetadata.plan` is
absent, which is how the two are told apart in any recording.

### 9.2 Four items in §5/§13/§14 that do not exist yet

| Named in the spec | Reality |
|---|---|
| `CHART` surface (§5, §13, §14) | **Not a primitive.** 34 primitives exist; `CHART` is not among them. |
| `TRANSACTION_SUMMARY` / `TransactionSurface` (§5, §14) | Not a primitive. |
| `SPONSORED_SURFACE` / `SponsoredSurface` (§5, §14, §69) | Not a primitive. |
| `WORLD` / `WorldSurface` (§5, §14) | Not a primitive. |

Adding them is cheap; adding them **before the data layer exists** would produce
surfaces with nothing true to render, which §0 forbids.

### 9.3 The dependency the spec's own ordering implies

§12's data layer is the precondition for §13 and for the §11 example
«أرني جدول مبيعاتي». Today `api/queries/` contains `connection.ts` and
`users.ts`; no trusted capability reads owner business data; there is no
`CanonicalDataset`. Full evidence in
`docs/roadmap/JASIM_GENERATIVE_PRODUCT_RUNTIME_ASSESSMENT.md`.

§19's realtime has its **server half only**: `JasimWebSocketServer` exists and is
wired in `boot.ts`; no web client subscribes, and the product polls.

### 9.4 One conflict to resolve before §11 is called complete

§11 requires `"سجلني خروج" → TRUSTED_PRODUCT_ACTION` and
`"أرني جدول مبيعاتي" → DIRECT_READ`. PlanGraph can **classify** both
(`IDENTITY_CHANGE`, `DIRECT_READ`) and correctly refuses to make either a DAG.
But the **semantic router that acts on that classification does not exist**: a
`DIRECT_READ` plan on a `direct_action` envelope still creates a blocked run and
flat proposals, because the envelope kind decided that before the plan was read.

Classification without routing is half the mechanism. Closing it means letting
the plan's `kind` override the envelope's `kind` — which is a real behaviour
change on every turn and belongs in its own phase with its own proof.

### 9.5 Commerce ratchet

Unchanged at **7 branches / 6 labels**, now pinned by a test. §19 of the PlanGraph
brief and §2 here agree: it may shrink, never grow, and nothing is deleted before
equivalent generic behaviour is proven. That proof needs a live model, which this
environment does not have.

### 9.6 Nothing in §50–§67 has been started

No Railway configuration, no staging/production separation, no runbooks, no
observability stack, no store readiness. `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`
still holds: **no model provider is configured here**, so every "model proposes X"
path in this document is proven by contract and by hand-written proposals, never
by a live model.

---

## 10. What this document does not authorise

It is recorded under «ادرس فقط». It does not by itself start the program in §90,
does not authorise touching production, and does not authorise writing any §72
price into code.
