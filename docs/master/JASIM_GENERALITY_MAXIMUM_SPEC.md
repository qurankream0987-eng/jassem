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

## 4.10 A SECURE PRODUCT ACTION

Some of what a person asks for is not a goal in the world. It is a change to
JASIM itself: sign me in, sign me out, change this setting, close my account.
These are the actions where a mistake costs an identity, so they have their own
law.

```
CONVERSATION INITIATES
  -> TRUSTED PRODUCT RUNTIME DEFINES
    -> TRUSTED SURFACE COLLECTS
      -> SERVER VALIDATES
        -> POLICY AUTHORIZES
          -> RUNTIME MUTATES
            -> AUDIT RECORDS
```

Seven steps, and the model appears at exactly one of them: the first. It
recognises what a person wants. It defines nothing and performs nothing.

```
AUTHENTICATE != DAG NODE
MODEL RECOGNISES != MODEL DEFINES
SURFACE COLLECTS != SURFACE DECIDES
CLIENT STATE CLEARED != SESSION REVOKED
ACCOUNT CLOSED   != ACCOUNT DELETED
```

### A secret is not context

```
PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL   !=   LLM CONTEXT
```

What a person types into a trusted surface is read once, by the one server
boundary that needs it, and is never written anywhere. It does not enter a
conversation message, an assistant reply, a Presentation IR payload kept for
replay, an event payload, an analytics record or a log line. This is not a
convention; it is a test that hunts a sentinel string through every table the
runtime writes and fails if it finds it anywhere.

```
SECRET_IN_MODEL_CONTEXT       = 0
SECRET_IN_CONVERSATION_STORAGE = 0
SECRET_IN_OBSERVABILITY       = 0
```

### The runtime defines the action, and there is one of it

The model may not define the input schema, which fields are sensitive, whether
confirmation is required, whether re-authentication is required, who is
authorized, or what the mutation does. A registry does, one entry per general
product verb, and one server boundary submits all of them.

No `users_v2`. No `sessions_v2`. No `auth_v2`. No second password system and no
second permission system: granting and revoking a person's authority stays an
**authority act** with a statement and a digest, because a second approval
mechanism beside it is how two answers to "may they?" come to exist.

```
DOMAIN_PRODUCT_ACTIONS_ADDED = 0
PARALLEL_AUTH_SYSTEMS_ADDED  = 0
```

`LoginAgent`, `SignupFlow`, `PasswordResetModule` and `AccountSettingsAgent`
are the names this section exists to prevent.

### Approval, and what it is worth

An irreversible action is confirmed by the person typing back the exact phrase
the runtime showed them. A yes/no on an irreversible act is a click, and

```
APPROVAL != CLICK
```

A caller may not assert that it re-authenticated, that a policy allowed it,
that a confirmation was satisfied, or who the actor is. Those are the runtime's
own words. A submitted field carrying one of them is refused, never ignored.

### Ending honestly

Signing out means the **server** stops accepting every token minted for that
identity before now. A client that erased its own storage has proven nothing.

Closing an account is real and deleting one is not, while no erasure policy
exists. The runtime suspends the account, revokes its sessions, and says in the
same breath that it deleted nothing — and the catalog records the deletion gate
as unmet rather than calling the closure a pass.

```
FALSE_SUCCESS = 0
```

## 4.11 A PERSISTENT WORLD

Some of what a person asks for does not end when the conversation does:
«أنشئ لي نظاماً دائماً لإدارة عمليات شركتي». A **World** is durable, versioned,
authorized operational state that outlives a conversation, a Run, a Task, a
Bubble and a device session.

It is not an agent, not an intelligence, not a domain application, not a
dashboard, not a replacement for the conversation, not a database a model
designed and not a generated front end.

```
CONVERSATION
  -> SEMANTIC ROUTER
    -> PERSISTENT_WORLD
      -> VALIDATED WorldDefinition
        -> SCOPE / AUTHORIZATION
          -> POLICY / APPROVAL
            -> ATOMIC MATERIALIZATION
              -> worldId · version 1 · durable event · canonical projection
```

```
ROUTED       != MATERIALIZED
MATERIALIZED != CONFIGURED
CONFIGURED   != EXTERNALLY_CONNECTED
IDEA != WORLD
GOAL != WORLD
UI != WORLD
UI != CANONICAL STATE
```

### A World is earned, never assumed

Run may exist without World. Task may exist without World. Dataset, Bubble and
Idea may too. «عندي فكرة» decomposes into primitives; only «حوّلها إلى نظام
دائم أدير منه الموارد والسياسات» asks for persistence, and a runtime that made
a world per turn would fill up with worlds nobody asked for.

### The definition is a proposal until the runtime accepts it

```
MODEL OUTPUT -> WorldDefinition proposal -> schema validation
  -> reference validation -> authorization -> policy -> approval -> materialization
```

Never `MODEL -> raw schema`, `MODEL -> SQL`, `MODEL -> eval`, `MODEL -> generated
server code`, `MODEL -> arbitrary React or HTML`. A definition describes
structure; anything executable inside one is refused, not sandboxed. A
definition may not bind its own capabilities either — a binding is the right to
ACT, and a world that could grant itself one would be an application with
authority.

### Versions, and history that is not erased

```
World v1 -> ChangeSet -> World v2 -> ChangeSet -> World v3
```

The current version is explicit, every superseded version stays readable, and
restoring an earlier shape creates a NEW version rather than erasing one.

```
NO LAST-WRITE-WINS FOR AUTHORITY-BEARING STRUCTURAL STATE
```

A change set carries the version it was built on. A caller working from a stale
read is told what to rebase onto; it does not win by arriving second.

### All of it, or none of it

A ChangeSet of five changes whose fourth is invalid writes none of the five.
There is no partially materialized world, because every change lands on a copy
before anything reaches the database, and the commit is one transaction.

Replaying is not a second decision: the request key catches a retry and the
semantic digest catches the same change arriving by another road.

### Seven classes, and not one of them is an industry

```
DATA · STRUCTURAL · POLICY · WORKFLOW · VIEW · PERMISSION · COMMERCIAL
```

«أضف عضواً» is a PERMISSION change whether the world organizes a school or a
foundry. «أضف مورداً» is DATA whether the resource is a lathe or a beehive. The
runtime decides which class a change IS from what it touches, so a POLICY
change labelled DATA cannot take a DATA change's permission.

```
DOMAIN_WORLD_TYPES_ADDED      = 0
DOMAIN_WORLD_RENDERERS_ADDED  = 0
WORLD_MARKETPLACE_CORES_ADDED = 0
```

`FactoryWorld`, `RestaurantWorld`, `SchoolWorld`, `WarehouseWorld` and
`PropertyWorld` are the names this section exists to prevent.

### Whose world it is

Ownership comes from the acting scope and from nothing a caller said. A
proposal may not name an owner, a scope, a membership, a permission, a version,
a policy decision or an approval. A person and an organization own a world
through the same `scopeId` every other scoped read and write uses — there is no
second permission system here, and a change that decides what everyone else may
do is an **authority act**, read and cited, not a sentence in a conversation.

### The market stays one market

An Offering does not need a World. A Need does not need a World. A World may
ORGANIZE references to them, and the internal opportunity exchange stays the
one domain-neutral exchange.

### What a surface may show

A materialized world projects to counts and names read from stored state. A
world that mentions a provider has connected nothing, and its projection says
so. Both applications render it through a primitive they already had; neither
has a world runtime of its own.

```
FALSE_WORLD_SUCCESS = 0
FALSE_PERSISTENCE   = 0
```

## 4.12 A STANDING CONDITION

Some of what a person asks for is not a question but a **watch**: «راقب السعر
وأخبرني إذا نزل», «إذا وصلت الحرارة إلى ٥ أخبرني», «نبّهني إذا تأخر». A
standing condition outlives the turn that created it and is evaluated durably,
whether or not anybody is looking.

```
CONVERSATION
  -> MONITORING INTENT
    -> STANDING CONDITION
      -> AUTHORIZED OBSERVATION SOURCE
        -> DURABLE EVALUATION
          -> STATE TRANSITION
            -> NOTIFICATION INTENT
              -> observation · verification · persistence
```

```
CONDITION_MATCHED != USER_NOTIFIED
LEVEL             != EDGE
UNKNOWN           != FALSE
UNKNOWN           != ABSENT
ROUTED            != EVALUATED
MONITORING AUTHORITY != EXECUTION AUTHORITY
```

### One engine, and the subject is data

«راقب السعر», «راقب الحرارة» and «راقب حالة الطلب» are one mechanism over three
payloads. What is being measured belongs to the observation, never to the
monitor's type.

```
DOMAIN_MONITOR_TYPES_ADDED = 0
DOMAIN_WATCHERS_ADDED      = 0
DOMAIN_SCHEDULE_TYPES_ADDED = 0
DOMAIN_NOTIFICATION_TYPES_ADDED = 0
```

`PriceMonitor`, `DeliveryMonitor`, `FlightMonitor`, `DeviceMonitor` and
`StockMonitor` are the names this section exists to prevent.

### A condition is typed, and never a program

A model may PROPOSE a condition; the runtime owns it. Every leaf is an operator
from a closed set — equals, greater_than, contains, exists, changed,
entered_state, left_state, within_range — over a dotted field path and a
scalar, composed with all, any and not. There is no raw JavaScript, no `eval`,
no SQL and no expression string, because a condition that could compute could
also act.

### A verdict has three values

```
TRUE · FALSE · UNKNOWN
```

A missing fact is UNKNOWN, not false. A comparison against the wrong kind of
value is UNKNOWN. An unknown leaf survives `all` and `any` rather than
collapsing, and negating unknown is unknown. A monitor whose verdict is unknown
has NOT decided that the world is fine.

### Freshness decides who may decide

A reading with no declared horizon is UNKNOWN, never CURRENT. A monitor asking
about the state NOW may not be decided by yesterday's temperature — unless it
explicitly permits history, which is a different monitor and says so.

### Level is not edge

`price < 50` is a LEVEL question. *Crossed from ≥ 50 to < 50* is an EDGE one.
A repeating poll over an unchanged fact must notify once, not every minute, so
the previous verdict is persisted and a REPEAT is told apart from a RISE. A
LEVEL condition that repeats AND notifies is refused, and the refusal names
EDGE.

### Absence is claimed, never inferred

```
UNKNOWN != ABSENT
```

«إذا لم يصل الرد خلال يوم» needs an expected observation, the window it had to
arrive in, and a clock. Nothing having been seen is not the same as nothing
having happened, and a monitor never turns silence into a fact without the
window that makes it one.

### A match is not a notification

```
CONDITION_MATCHED -> NOTIFICATION_INTENT -> trusted delivery -> receipt
```

A monitor transitions and creates an INTENT. It delivers nothing and speaks for
no delivery. When the channels a person asked for have no provider, the trigger
still stands and the projection says which channels are unconfigured — the
trigger is never lost to make the delivery look clean.

### Detecting is not authority to act

«إذا نزل السعر تحت ٩٥ اشترِ» contains two authorities. A standing monitor may
hold the first and never the second: its only actions are NOTIFY and NONE, and
anything further must satisfy its own envelope at the moment it happens. A
monitor creates no authority.

### No fake live

A monitor polls, on the durable duty cycle that already existed. Its evaluation
ledger is ordered and resumable from a cursor — which a later transport will
subscribe from — and until then nothing claims «مباشر».

```
FALSE_TRIGGERS      = 0
FALSE_NOTIFICATIONS = 0
```

## 4.13 REALTIME TRANSPORT

```
REALTIME TRANSPORT  != TRUTH
TRANSPORT_CONNECTED != DATA_CURRENT
```

Canonical state is truth. A durable event says truth CHANGED. Realtime carries
an authorized notification of that change and creates nothing.

```
CANONICAL STATE CHANGE
  -> DURABLE EVENT
    -> AUTHORIZED SUBSCRIPTION
      -> TRANSPORT
        -> CLIENT CURSOR
          -> RECONCILIATION
            -> CANONICAL PROJECTION UPDATE
```

A socket that dies erases nothing. A server that restarts costs a reconnect. A
client that was asleep catches up. None of those is a loss of state, because
none of them was holding any.

### Connected is not current

A connection open right now says nothing about whether a reading is fresh.
Four things stay separate and are never collapsed:

```
transport status · event recency · observation freshness · verification state
```

A socket may be CONNECTED while the temperature it is showing is STALE. The
truthful surface says connected transport, stale observation. It never says
«مباشر» because a socket is open.

### One subscription contract

A subscriber says WHAT it wants to hear about — a scope, a canonical entity, a
conversation. It may not say whose events those are, what permission it holds,
what membership it has, or that it is authorized. The server derives all of it
from the authenticated actor, and a guessed id is refused rather than reported
as missing.

```
DOMAIN_REALTIME_CHANNELS_ADDED = 0
SECOND_SOCKET_SERVERS_ADDED    = 0
SECOND_EVENT_LEDGERS_ADDED     = 0
```

`WorldRealtime`, `MonitorRealtime`, `OrderRealtime`, `NegotiationRealtime`,
`MapRealtime` and `MobileRealtime` are the names this section exists to
prevent.

### An event is a signal, not a state

The envelope carries a position, an identity, a type, an instant, a reference
and — where they exist — a revision and closed-vocabulary signals such as a
verdict or a freshness. It carries no observation payload, no negotiation
reserve, no policy body, no credential and no row. Everything not explicitly
allowed is dropped, so a new event type leaks nothing it never declared.

### The client re-reads; it does not reconstruct

```
EVENT -> IDENTIFY CHANGED OBJECT -> FETCH AUTHORIZED PROJECTION
```

A frontend that rebuilt business truth out of a frame would be trusting the
transport with the one job the transport does not have. This matters most for
what comes later: negotiation, transactions, location and private business
policy must never be assembled from a notification.

### A cursor, and what to do when it cannot be honoured

A subscriber resumes from a cursor, and nothing is lost merely because
transport disconnected. When a cursor cannot be honoured — invalid, ahead of
the ledger, behind what is retained, or a subscriber too far behind to be fed
event by event — the answer is typed:

```
RESYNC_REQUIRED
```

The client re-reads the canonical projection and resumes from a cursor that
means something. Silently skipping the missing range is the one failure a
cursor exists to prevent, and a final canonical projection is worth more than
the pretence that every missed event was applied.

### Ordering is per ledger, and said exactly

Ordering is total within the canonical event ledger, by its position. Nothing
claims ordering across unrelated ledgers, because none exists. A serial
position is assigned before commit, so a cursor never advances past an event
young enough that an older sibling might still be committing.

### Background is not a lie

A suspended app's socket dies with it. The runtime does not pretend otherwise:
on resume it reconnects and catches up from its cursor, and a cold reopen
re-reads the canonical projection. A correct app that was asleep beats a
connected app that was lying.

```
FALSE_LIVE_CLAIMS = 0
```

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
