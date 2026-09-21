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

## 4.4 THE IDEA INTAKE LAW

Any lawful open-ended idea may enter JASIM **without** matching a known industry,
marketplace, application, business category or workflow.

```
UNKNOWN IDEA != UNSUPPORTED DOMAIN
```

JASIM's response to an unfamiliar idea is to decompose it into the primitives it
already has:

```
Goal · Actor · Need · Offering · Resource · Capacity
Constraint · Preference · Economics · Policy · Opportunity
Capabilities · Providers
```

What comes back may be "this needs a capability that does not exist yet" or "this
needs a provider nobody has connected". Both are answers. "JASIM does not support
that kind of thing" is not, because there are no kinds of thing.

Forbidden: `IdeaAgent`, `IdeaMarketplace`, an idea registry, an idea category
enum, and `Idea` as a permanent canonical primitive — unless persistence or
versioning of ideas independently requires one, which is a separate decision with
its own evidence.

```
IDEA_DOMAIN_BRANCHES = 0
IDEA_AGENTS_ADDED    = 0
```

## 4.5 ACTOR SCOPE

```
AUTHENTICATED PRINCIPAL  !=  ACTING SCOPE
```

Authentication answers *who is using JASIM*. Acting scope answers *on whose
authority*. One person is one principal and may act as several scopes — their own,
and each organization they belong to.

An organization is a general **Actor scope**: a value the `ownerId` column can
hold, not a second runtime and not a second intelligence. It owns Needs,
Offerings, Resources, Capacity, data, policies, provider bindings and world
associations, through exactly the same mechanisms a person does.

Natural language may **request** a scope and may never **grant** one:

```
names an organization they do not belong to   → DENIED
«باسم شركتي» with two plausible organizations → NEEDS_INPUT
```

Never a silent choice. Membership is durable, revocable and audited; revoking it
removes future authority and rewrites no history.

Permissions are verbs — `view`, `publish`, `mutate`, `approve`, `manage_members`,
`manage_policies`, `manage_providers`, `act_financially`. Roles may bundle them;
the permissions are the authority. There is no `FactoryManager` and no
`RestaurantOwner`.

```
DOMAIN_BUSINESS_TYPES_ADDED = 0
DOMAIN_ROLES_ADDED          = 0
```

A business's *kind* — restaurant, factory, school — is an **attribute** of the
organization. It is data the owner supplies, and no production code branches on it.

## 4.6 NEGOTIATION AND AGREEMENT

One negotiation mechanism, for every subject there is. A salary, a rent, a
shipping fee, a service scope and six hours of laboratory time are the same
evaluator and the same four capabilities, differing only in a term key that
nothing in the runtime reads.

```
Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
```

Reaching an Agreement moves no money, books nothing and tells nobody. It records
that two parties agreed to an exact proposal **version** and under whose
authority. A Commitment exists only where the term sheet **declared** who owes
what: a runtime that inferred the payer from a field called `price` would have
acquired a domain at the worst possible point.

### Bounded authority

```
TARGET != AUTHORITY
```

The target is what someone would like. The reserve is what they may go to.
«لا تتجاوز 250 دينارًا ولا تخبره بذلك» is two different facts — a limit and a
secret — and the envelope holds both. A counter is clamped at the reserve over
any number of rounds, and an envelope may never agree past its own limit. The
owner themselves may agree to anything they like: the reserve bounds what JASIM
may do **on their behalf**, never what they may decide.

Undeclared authority is **no** authority: `mayConcede` and `mayAcceptWithinReserve`
both default to false.

```
RESERVE != LLM CONTEXT
```

A reserve is treated as a credential. It never enters a model context, never
appears in a counterparty projection and never explains a refusal.

```
NOT_DISCLOSED != NOT_INFERABLE
```

And the runtime does not claim more than that. A reserve is never **stated**; it
may still be **inferred** from a sequence of counters, and asserting otherwise
would be the false guarantee.

### A capability may not approve

```
EXECUTION != APPROVAL
```

A capability sees a scope id, not a person, and cannot tell an approved run from
an unapproved one. So it may act only within a limit the owner delegated in
advance, where the person read the number. Accepting on the owner's own
authority happens where the person is present.

```
DOMAIN_NEGOTIATION_TYPES_ADDED = 0
DOMAIN_TERM_TYPES_ADDED        = 0
```

There is no `SalaryNegotiation`, no `RentNegotiation`, no currency type and no
date type. What is being negotiated lives in a term key, which is data.

## 4.7 AN AUTHORITY ACT

```
APPROVAL != CLICK
MODEL PROPOSES != RUNTIME PERFORMS
STATEMENT != SUMMARY
```

Creating an organization, granting a verb, setting a policy, binding a
provider, delegating a negotiating limit and agreeing are one shape: an
**authority act**. A person must be able to do each by speaking, and a plan may
never do any of them on their behalf.

The difficulty is that the obvious implementation is worse than not building it.
A capability that sets a limit, plus a run summary somebody clicks «موافق» on,
is an authority they never read.

So:

1. A model may **request** an act — a registered act type and typed
   parameters — and it performs nothing.
2. The **runtime** writes the statement, from the act's declared parameter
   schema so an act cannot choose what to leave out, and from canonical state so
   a scope's name is what the database says. No sentence a model produced
   enters it.
3. **Every scalar in the parameters appears in that statement.** A reserve
   buried three levels inside an object is rendered as its own line, because a
   summary is where a number goes to hide. An act that names a row must also say
   what that row says: «وافق على العرض p_8f3a» is not something anyone can
   consent to.
4. The person approves by citing the **digest** of what they read. Before
   performing, the runtime re-renders from current canonical state: if the
   statement would read differently now, the approval is **void**.

There is no blanket approval — no "approve all pending", no "always approve this
act type". Each of those is an approval of something nobody read.

What was done is then **read back**, because `RECEIPT != VERIFICATION` applies to
an act's own word about itself exactly as it applies to a provider's.

```
DOMAIN_AUTHORITY_ACTS_ADDED = 0
```

There is no `RestaurantOnboarding` act. Every act is a general verb over a
general primitive, and a new one is a row in one registry that inherits the
statement, the digest, the expiry and the re-render.

## 4.8 A STORED POLICY IS NOT AN ENFORCED POLICY

```
POLICY STORED != POLICY ENFORCED
POLICY TEXT   != EXECUTABLE POLICY
```

A scope may write rules for itself, and a rule is authoritative only when it
belongs to that scope, its schema is recognized, it is active for the current
version and time, its conditions evaluate deterministically, and the action
being asked about is one it governs.

A body that carries no recognized schema is **scope configuration**: it enforces
nothing and never claimed to. A body that *claims* the schema and cannot be
read is **malformed**, and nothing proceeds under it. Prose cannot become a rule
by being stored next to rules, and the statement a person approves says which of
the two they are getting.

```
MODEL INTERPRETATION != AUTHORITY
```

A conversational layer may **propose** a typed rule. Nothing asks a model at
enforcement time what a stored sentence meant — a rule that means whatever it
said today is not a rule.

```
UNKNOWN POLICY SEMANTICS != ALLOW
POLICY ABSENCE          != POLICY DENIAL
```

Two different defaults, both deliberate. A scope with no rules permits what its
permissions permit. A scope with a rule nobody can read permits nothing, because
the alternative is proceeding past a rule.

### Four questions, composing

```
PERMISSION != POLICY
POLICY     != AUTHORITY ENVELOPE
ENVELOPE   != APPROVAL
APPROVAL   != POLICY OVERRIDE
```

May this person act here; what has this scope forbidden itself; how far may
JASIM go on someone's behalf; and did a person decide. They compose, and **the
narrowest wins**. A permission to transact does not answer a rule that caps the
amount. An envelope reaching 250 does not answer a rule that says a person
decides above 200. And approving what a rule denies does not make it permitted.

The effects are `ALLOW`, `DENY`, `REQUIRE_APPROVAL` and `CONSTRAIN`. `ALLOW`
records an intention and widens nothing. `CONSTRAIN` refuses rather than
rewrites: clamping somebody's parameters to make them legal is the runtime
negotiating on their behalf without being asked.

A decision carries the policy's id, version, effect and a reason code — never
its body. A seller's floor, a buyer's ceiling and an internal threshold steer
outcomes without being disclosed, and a decision is attributable to the version
that produced it.

```
DOMAIN_POLICY_TYPES_ADDED      = 0
DOMAIN_POLICY_EVALUATORS_ADDED = 0
```

There is no `FactoryPolicy`, no `NegotiationPolicyEvaluator` and no
`ShippingPolicyEvaluator`. One boundary is consulted before anything
irreversible, and no capability reads a rule of its own.

## 4.9 TRANSACTION AND FULFILLMENT

```
OPPORTUNITY != PROPOSAL
PROPOSAL    != AGREEMENT
AGREEMENT   != COMMITMENT
COMMITMENT != TRANSACTION
TRANSACTION != PAYMENT
PAYMENT     != FULFILLMENT
FULFILLMENT != VERIFICATION
```

```
ACCEPTED OFFER   != EXECUTED TRANSACTION
PAID             != DELIVERED
PROVIDER RECEIPT != VERIFIED FULFILLMENT
CLAIMED_COMPLETE != VERIFIED_COMPLETE
```

Eight facts, and a runtime that collapses any adjacent pair can tell somebody
their goods arrived because a card cleared.

### One transaction, no roles

A Transaction has **parties**, not a buyer and a seller. The same Actor is a
buyer in one and a provider in the next, and encoding either as a column would
end the open market. It snapshots the committed terms: a later edit to an
offering, a price, a policy or a catalogue changes nothing about what was
agreed.

```
DOMAIN_TRANSACTION_TYPES_ADDED    = 0
DOMAIN_FULFILLMENT_TYPES_ADDED    = 0
DOMAIN_TRANSACTION_HANDLERS_ADDED = 0
```

There is no `PurchaseTransaction` and no `RentalTransaction`. Goods, laboratory
hours, generator capacity, warehouse pallets, a translation and a fabrication
job are the same rows differing in a term key nothing reads.

### The obligation is the unit

What each party owes is an **obligation**, declared by the term that named who
owes what — never inferred from a field called `price`. An obligation carries
who owes it, who it is owed to, what would prove it, and two separate states:
what the world is **said** to have done, and what JASIM can **prove**.

Evidence is an effect kind from the completion policy's own closed set, so an
obligation is judged by the rules every capability's effect already obeys.

```
DOMAIN_FULFILLMENT_VERIFIERS = 0
```

Undeclared evidence means `HUMAN_ACTION`, the strictest — somebody's own word
about their own work settles nothing.

### The state is derived

A transaction's state comes from its obligations, every time it is asked, and
nothing writes `SETTLED`. **A payment verified while a delivery is pending is an
OPEN transaction**, and making that impossible to misread is the point.

### Ending honestly

Cancelling is for before anything irreversible. After an obligation is
verified, there is **compensation** — a new effect, a refund, a released
reservation — and nothing pretends the original vanished or deletes a row to
make it so.

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
