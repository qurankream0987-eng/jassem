# JASIM — WHICH SOURCE SHOULD ESTABLISH THIS FACT?

> `SOURCE_RESOLUTION != TRUTH` · `SOURCE_RESOLUTION != AUTHORITY`
> `PROVIDER_AVAILABLE != PROVIDER_SHOULD_BE_USED` · `HUMAN_AVAILABLE != HUMAN_SHOULD_BE_ASKED`
> `PROVIDER_ERROR != BUSINESS_FACT` · `NO_PROVIDER != NO_CAPABILITY`
> `NO_MACHINE_SOURCE != FAILURE` · `UNKNOWN != FALSE` · `UNKNOWN != TRUE`

Two merchants, one JASIM. One has no API and is asked when stronger evidence is
needed. One has a verified connected system and is not bothered at all. Same
Need runtime, same Offering, same Freshness runtime, same Human Verification
runtime, same Provider Binding runtime. Only the available source changed.

## What the trace found

Every source already existed. Nothing chose between them.

| needed | already there |
| --- | --- |
| "is what we know enough?" | `assessSufficiency` → verdict, reason, `requirementKey` |
| whose subject this is | `subjectAuthority(kind, id, property)` |
| verified bindings by capability | `usableBindingFor` — first row only |
| a provider reading as evidence | `recordProviderEvidence` + `bound_provider_receipt` |
| asking a person, deduplicated | `requireCounterpartyEvidence` + `pendingRequestFor` |
| scope-declared rules | `scope_policies` |
| revision / configuration matching | `coversRevision`, `coversConfiguration`, `coversQuantity` |

**Answers to the seven questions**

1. **General source resolver?** No. Each source was reachable only by a caller that had already decided.
2. **Can Freshness name the fact needing stronger evidence?** Yes — verdict, reason and a stable requirement key.
3. **Can verified bindings be enumerated by scope and capability?** Partially. `usableBindingFor` takes the first matching row, which is exactly the "first DB row wins" that §14 forbids. It answers *is there one*; it cannot choose.
4. **Can provider reads become observations?** Yes, but see below — two things were missing.
5. **Can human verification create and dedupe a request?** Yes, durably. Untouched.
6. **New table needed?** **No.**
7. **Runtime decision over canonical state?** **Yes.** Source selection has no durable business truth; the evidence, the request and the binding are the durable things and all already have homes.

## Two gaps that had to close first

Neither was visible until something tried to use the provider path to answer
somebody else's question.

**Provider evidence could not cover a question that named anything.**
`evidenceFor` reads `payload.configuration`, `payload.quantity` and
`provenance.subjectRevision`; `recordProviderEvidence` wrote none of them. The
freshness runtime sets evidence aside before judging it — a reading of another
revision is not weak evidence, it is not evidence — so a provider reading would
have been recorded and then immediately found inapplicable, forever.

**A buyer has no standing in a seller's scope.** `callProvider` authorizes by a
principal's `view` permission on the binding's scope, which is right for
somebody using their own connection and useless here: the system that knows
whether a seller's thing is available is the *seller's*. So
`readThroughBinding` has a different, narrower basis — no principal at all, and
a scope the caller must have established canonically, checked against the
binding rather than believed. It refuses a mutating capability structurally, so
no path through it can book, schedule, message, pay or refund.

## The order is not a priority list

Emphatically not "provider, then human, then local":

```
1  Is what we already know enough for THIS purpose?    → stop. Ask nobody.
2  Does this scope's policy reserve this for a person? → skip machines.
3  Who is canonically authoritative for this fact?     → their systems.
4  Does one of their verified bindings observe it?     → read, record, re-judge.
5  Otherwise, may an authorized person be asked?       → ask, once.
6  Otherwise say so. UNKNOWN is an answer.
```

Step 1 is what keeps JASIM quiet: `SUFFICIENT_EVIDENCE_PROVIDER_CALLS = 0` and
`SUFFICIENT_EVIDENCE_HUMAN_PINGS = 0`.

## Whose system — the decisive thing

A buyer asking whether a seller's thing is available is asking about the
*seller's* subject. Looking for a provider attached to whoever asked would read
the wrong company's inventory. The candidate scopes come from `subjectAuthority`
— the same canonical derivation the human path already uses to decide who may be
asked. One derivation, two kinds of source.

```
BUYER_PROVIDER_USED_FOR_SELLER_FACT = 0
MODEL_CAN_CHOOSE_SOURCE_SCOPE = NO
```

A test gives the buyer a perfectly good connected system and asserts it is never
read, and that the authority step named the seller.

## What may establish a fact

`READ` and `OBSERVE`, and nothing else. Both are existing vocabulary. The other
verbs mean other acts — `SEARCH` and `DISCOVER` find candidates rather than
report on one, `TRACK` follows something over time — so a binding granted only
`SEARCH` can look things up and still cannot say whether this one is available.

```
DOMAIN_SOURCE_CAPABILITIES_ADDED = 0
```

There is no `READ_INVENTORY`. *Which* facts a kind of system can establish is
adapter contract metadata — `ProviderDefinition.observes`, a list of property
names — exactly where the phase brief says fact semantics belong. Absent means
**none**: a definition that never says what it observes answers no questions.
That is what makes `PROVIDER_USED_FOR_UNSUPPORTED_FACT = 0` structural rather
than hopeful — a system that knows how many units are on a shelf does not
thereby know whether its owner would accept a lower price.

## A tie is reported, not broken

A scope with two verified systems that could both answer produces
`AMBIGUOUS_SOURCE`. Nothing is read, nothing is recorded, nobody is messaged on
a guess. Every tiebreak available here is arbitrary: the newest verification is
not the better system, the first row is a database ordering, alphabetical is
nothing at all. The scope settles it in its own policy, or it stays ambiguous.

```
MULTIPLE_PROVIDER_LATEST_WINS = 0
```

## Policy can only make JASIM ask a person

`source.resolution`, in the ordinary scope policy store, carries two fields:
`humanRequiredFor` (purposes a person must confirm, machine evidence
notwithstanding — "somebody looked at it" is sometimes the point) and
`preferredProviders`. Both narrow. No declaration here makes evidence
sufficient, widens a capability, or skips a person who is the only source.
Sufficiency stays the freshness runtime's, entirely.

## A provider failing says nothing about the world

`UNAVAILABLE`, `ERROR` and a thrown adapter all write **no observation** and
leave the question open for a person. A provider that successfully reads *no* is
a different thing entirely — a real negative reading, recorded and judged.

```
PROVIDER_FAILURE_CREATES_NEGATIVE_FACT = 0
NEGATIVE_FACT_DISTINCT_FROM_PROVIDER_FAILURE = PASS
```

And a provider that answers is not a provider that is believed: the reading
becomes an observation, and `assessSufficiency` runs again over it. A read that
is too stale or too weak for the purpose leaves the question open exactly as if
it had not happened.

## Not asking twice

Sequential callers never reach the provider at all — the first reading is fresh,
so step 1 answers them. For simultaneous callers there is an in-process collapse,
and it is labelled as exactly that: **not canonical coordination**. Two Node
processes asking at the same instant will both read, which is safe because a
read mutates nothing and the second writes an observation the first would have
written. A durable in-flight row would be a table, and a table for a harmless
duplicate read is not a trade worth making. The expensive path — asking a person
— was already deduplicated durably, and still is.

## What it does not do

It establishes no fact, decides no verdict, mutates no external system, owns no
state and writes no row of its own. Its entire output is a decision plus the
steps that produced it, which explain the choice out loud and carry ids, states
and reasons — no payload, no credential, no endpoint, and nothing persisted.

```
NEW_SOURCE_TABLE_ADDED = NO
PROVIDER_AVAILABILITY_CREATES_RESERVATION = 0
SOURCE_RESOLUTION_USED_FOR_NEGOTIATION = 0
PAYMENT_EXECUTION_ADDED = 0
```

"Would you accept 8500" is not a fact about a subject, and the kinds that carry
acceptance — agreement, proposal, commitment, living object — have no answering
authority at all, by design, from the subject authority phase. Asking through
this runtime finds no source, which is the correct refusal rather than a check
this module had to invent.
