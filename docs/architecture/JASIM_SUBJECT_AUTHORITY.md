# JASIM — WHO MAY SPEAK FOR THIS THING

> `LIVING_OBJECT != SUBJECT_AUTHORITY` · `NEW SUBJECT KIND != NEW DOMAIN`
> `ARBITRARY SUBJECT ID != AUTHORITY` · `MODEL-NAMED ACTOR != AUTHORITY`
> `LATEST PARTICIPANT != AUTHORITY`
> `AUTHORITY_TO_ANSWER != AUTHORITY_TO_MUTATE`
> `AUTHORITY_TO_CONFIRM != AUTHORITY_TO_ACCEPT`

The previous phase built the channel: when the evidence is not strong enough and
no machine can do better, ask the person who knows — once, about one exact
thing. That phase resolved *who* through a single map:

```ts
const SUBJECT_AUTHORITY = { offering: /* owner of the offering */ };
```

Its holdout tests varied the semantic type freely — and passed. But every
subject in all of them was still created through `offering(...)`.

```
DOMAIN_GENERALITY                 = PASS   (previous phase, still true)
CANONICAL_SUBJECT_KIND_GENERALITY = NOT YET PROVEN
```

That is the gap this phase closes, and it is not the gap it first looks like.

## What the trace found

| needed | already there |
| --- | --- |
| the question channel | `counterparty-verification.ts` — request, answer, expiry, dedup |
| evidence classification | `observations` + `sourceKind` |
| acting scope | `resolveActingScope` / `memberships` |
| ownership of an offering | `economicExpressions.ownerId` |
| ownership of capacity | `availabilityWindows.ownerId` |
| **two-sided** standing | `reservations.ownerId` **and** `.resourceOwnerId` |
| **many-party** standing | `transactions.scopeId` + `transactions.parties` |

Everything needed was already in the rows. Nothing needed a table, a migration
or a column. `SUBJECT_MIGRATIONS_ADDED = 0`.

## Why a registry and not a switch

The honest finding of the trace is that **JASIM's canonical subjects do not
share one ownership shape**, and a single `ownerId` lookup is not a general
version of anything — it is the offering's shape, promoted by accident.

Four genuinely different shapes exist:

| shape | subject | who stands in it |
| --- | --- | --- |
| ONE OWNER | `offering` | somebody published it |
| CAPACITY OWNER | `availability_window` | it is offered **by** somebody |
| TWO SIDES | `reservation` | a requester **and** a capacity owner |
| MANY PARTIES | `transaction` | parties, **none of them privileged** |

So `subject-authority.ts` is a registry keyed by **canonical subject kind** —
a structural fact — with one adapter per kind. It is keyed by no business noun.
There is no `car`, no `garment`, no `venue`, and adding one would not extend
this design but abandon it.

```
DOMAIN_SUBJECT_AUTHORITY_HANDLERS_ADDED = 0
```

## Authority depends on the fact, not only on the thing

A two-sided subject is the reason a role is not enough. For a reservation:

```
property "availability" → CAPACITY_OWNER   the side supplying it knows if it stands
property "attendance"   → SUBJECT_OWNER    the side that asked knows their own intent
```

Neither side can answer for the other, and neither is "the owner". So an adapter
carries `propertyAuthority` where the shape requires it, and `defaultRoles`
otherwise:

```ts
subjectAuthority({ subjectKind, subjectId, property? })
  → { scopeIds, roles, revision } | null
```

`null` is a real answer. An unknown kind, a closed row, or a row whose entitled
roles are empty produces **no source** — never a guess at the requester, the
latest participant, or whoever the model had in mind.

```
UNKNOWN_SUBJECT_KIND_GUESSES_AUTHORITY = 0
MODEL_CAN_CHOOSE_SUBJECT_AUTHORITY     = NO
```

## What is deliberately absent

The registry is **not** exhaustive over the canonical tables, and the omissions
are a statement rather than a gap. `NOT_VERIFIABLE_BY_DESIGN` names each one and
why asking a person there would be a backdoor around a runtime that already owns
the decision:

| kind | why not |
| --- | --- |
| `agreement` | acceptance is the agreement runtime's, not a question's |
| `proposal` | accepting or countering belongs to the agreement runtime |
| `commitment` | whether an obligation was discharged is verification's |
| `living_object` | a handle points at a subject; resolve it and ask about that |

«Do you accept?» arriving as a *question* would be negotiation smuggled through
the verification channel — with no envelope, no authority basis and no record.

```
VERIFICATION_AUTHORITY_BYPASSES_AGREEMENT_RUNTIME = 0
```

`living_object` is the sharpest of the four. A living object is a durable,
authorized **handle**. Being able to hold one confers nothing about the thing it
points at, and treating the handle's scope as the subject's authority would let
anyone with a handle answer for somebody else's row.

## An inherited expectation was changed

`tests/block31/counterparty-verification.test.ts` asserted that an answer is
authorized by comparing the answering scope against `respondingScopeId` — the
scope stored on the request when it was **created**.

| | |
| --- | --- |
| OLD_EXPECTATION | the request's stored `respondingScopeId` authorizes the answer |
| WHY_IT_IS_WRONG | it is a snapshot. Ownership can change between asking and answering, and the snapshot would let a **former** owner still speak for the row |
| NEW_EXPECTATION | entitlement is re-read from the subject at answer time |
| WHY_THE_NEW_EXPECTATION_IS_STRICTER | it closes a window the old one left open, and is asserted in both directions: the former owner can no longer answer, and the current owner can |

`CONFIRMED_ONCE != TRUE_FOREVER` already governed the *answer*. This makes it
govern the *entitlement to answer* too.

## What this does not decide

Whether the answer is **true**. That stays with the observation and verification
runtimes, unchanged. This module says only who may be asked.
