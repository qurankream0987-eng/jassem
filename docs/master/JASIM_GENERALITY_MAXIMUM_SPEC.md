# JASIM — THE GENERALITY LAW

The governing law of the project. Everything in `docs/architecture/` explains
*how* a mechanism works; this states what may never stop being true of any of
them.

```
JASIM
=
General Intelligence
+
Open Opportunity Network
+
Execution Runtime
```

---

## 1. One JASIM

There is one runtime, one canonical state, one event truth and one verification
truth. A domain is not a reason to add a second of any of them.

```
NEW DOMAIN          != NEW AGENT
NEW EXAMPLE         != NEW BRANCH
NEW BUSINESS        != NEW RUNTIME
NEW MARKET CATEGORY != NEW MARKETPLACE
```

Forbidden, permanently: `RestaurantAgent`, `JobsAgent`, `FactoryAgent`,
`DriverAgent`, `WholesaleAgent`, `MapAgent`, `SalesAgent`, `InventoryAgent`, and
every future member of that family — including a `LaboratoryMarketplace` or a
`GeneratorRentalAgent` invented to satisfy a holdout test.

## 2. Examples are tests, not architecture

A scenario in the acceptance catalog is a measurement. It is never a
specification for code. When a scenario fails, the thing that gets built is the
**general** capability it revealed — and that capability closes every other
scenario that needed it at the same time.

Writing code for a scenario is how a general system becomes a pile of verticals.

## 3. The trust chain

```
Intent != Proposal != Approval != Execution != Receipt != Verification
```

```
LLM        != Authority
CAPABILITY != PROVIDER
RECEIPT    != VERIFICATION
INCONCLUSIVE != FAILED
INCONCLUSIVE != SUCCESS
```

A model may state what should happen. It may never state that something has
been authorized, approved, executed, delivered, paid or verified. A provider may
report on itself; its own word is never independent evidence about itself.

Credentials — passwords, tokens, biometric secrets, payment credentials — never
enter the model context and are never persisted as conversation messages.

```
PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
AUTHENTICATE != DAG NODE
```

## 4. THE JASIM OPEN MARKET LAW

**JASIM is not a closed vertical marketplace.** It contains an open, general
market inside the same one JASIM.

Any authorized Actor may participate through generic economic primitives:

```
Need · Offering · Resource · Capacity · Availability · Economics
Constraint · Opportunity · Proposal · Agreement · Transaction · Fulfillment
```

A participant may simultaneously be:

```
buyer · seller · provider · requester · resource owner · capacity owner
```

These are **contextual roles**, not separate accounts and not separate
intelligence systems. A factory buying raw materials while selling products and
renting out spare capacity is one Actor holding Needs, Offerings and Capacity —
not three systems and not a "buyer account" beside a "seller account".

The Internal Opportunity Exchange must remain **domain-neutral**. Factories,
restaurants, shops, workers, drivers, warehouses, machines, service providers
and participants nobody has thought of yet use the **same** market runtime.

```
NEW MARKET CATEGORY != NEW MARKETPLACE
```

If adding a new economic domain requires a new marketplace core:

```
GENERALITY = FAIL
```

### 4.1 Open market ≠ closed discovery

Internal JASIM opportunities coexist with external discovery. The person's own
restriction decides the scope:

```
«ابحث داخل جاسم»     → INTERNAL_ONLY
«ابحث في الإنترنت»    → EXTERNAL_ONLY
«ابحث لي عن الأفضل»  → INTERNAL + EXTERNAL, according to context
```

JASIM optimizes for the person's real constraints and interests, never for
keeping the transaction inside JASIM. Hiding a better external option to steer
someone towards an internal one is forbidden.

```
SPONSORED             != BEST
PLATFORM_REVENUE      != ANSWER_AUTHORITY
BUSINESS_SUBSCRIPTION != ORGANIC_RANK
PLATFORM_INTEREST     != USER_ANSWER_AUTHORITY
```

### 4.2 Open market ≠ unverified market

Participation is open. Truth is not.

```
SELLER CLAIM  !=  PROVIDER CLAIM  !=  CANONICAL OBSERVATION  !=  VERIFIED FACT
```

An Offering may claim availability; that does not make availability verified. A
delivery may claim completion; that does not make fulfillment verified. Claims,
availability, identity, fulfillment and outcomes all keep their provenance,
trust class and verification semantics — through the same Effect → Observation →
Verification runtime everything else uses.

### 4.3 A person never has to know they entered a market

There is no "choose your marketplace" screen. Someone says

> «أحتاج مورد يوفر لي 300 حبة بأقل من 250 دينار»

and that becomes a `Need` with a quantity constraint and a budget constraint.
Someone says

> «عندي شاحنتان فارغتان اليوم من عمان إلى العقبة»

and that becomes a `Resource` with `Capacity`, `Availability` and `Location`,
offered into the same exchange. The market is a mechanism, not a destination.

## 5. Business is a scope, not an app

A Business may own data, Needs, Offerings, Resources, Capacity, Policies,
provider bindings, a team, permissions, worlds and campaigns. The same
representation must serve a factory, a restaurant, a shop, a hotel, a logistics
company, a consultancy, a school and a business nobody has described yet.

JASIM OS for a business is the **same core** with that scope, its data, its
policies and its branding. There is no second intelligence.

## 6. Provider gap ≠ generality failure

```
GENERALITY FAILURE   !=   PROVIDER NOT CONNECTED
```

If a scenario is generically representable and has a correct provider-ready
capability contract, but nothing is plugged in:

```
PROVIDER_READY = PASS
LIVE_EXECUTION = BLOCKED_BY_PROVIDER
```

Never a fake pass. Never an architectural failure either.

## 7. Truth in reporting

No single percentage. Eight independent gates — REPRESENTABLE, ROUTABLE,
PLANNABLE, EXECUTABLE, OBSERVABLE, VERIFIABLE, PRESENTABLE, PERSISTENT — are
eight separate facts, and collapsing them is how a system comes to believe it
can do things it has never done.

```
TRANSACTION = CREATED   does not mean   FULFILLMENT = VERIFIED
REPRESENTABLE = PASS    does not mean   JASIM CAN DO IT TODAY
```

## 8. The permanent ratchets

```
NEW_DOMAIN_BRANCHES             = 0
DOMAIN_AGENTS_ADDED             = 0
DOMAIN_PLAN_NODE_TYPES_ADDED    = 0
DOMAIN_QUERY_TYPES_ADDED        = 0
DOMAIN_DATASET_TYPES_ADDED      = 0
DOMAIN_RENDERERS_ADDED          = 0
DOMAIN_OBSERVATION_TYPES_ADDED  = 0
DOMAIN_VERIFIERS_ADDED          = 0
DOMAIN_MARKETPLACES_ADDED       = 0
FALSE_SUCCESS                   = 0
```

A domain-specific *registration* or *data schema* is allowed only when it moves
no intelligence and no authority into that domain.

## 9. The blind test

The real measure of generality is not the examples used during construction. It
is a goal from a world the builder never considered:

> «لدي جهاز مختبر متاح 6 ساعات، والجامعة تريد 10 ساعات. فاوض على تقسيم الوقت والسعر.»

If that needs `LaboratoryNegotiation`, generality has failed. If it runs as

```
Resource · Capacity · Availability · Offering · Need
· Opportunity · Proposal · Term · Authority · Agreement
```

then the question stops being *"does JASIM support this domain?"* and becomes
only *"do the data, capabilities and providers needed to achieve this goal
exist in the real world?"*

That is the level this project is aiming at.
