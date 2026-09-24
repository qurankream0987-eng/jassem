# JASIM — SELECTION → CANONICAL PROPOSAL

> `SELECTION != PROPOSAL` · `PROPOSAL != AGREEMENT`
> `AGREEMENT != COMMITMENT` · `COMMITMENT != TRANSACTION`
> `PAYMENT_INTENT != PAYMENT` · `PAYMENT != FULFILLMENT`
> `OFFERING_PUBLIC_TERMS != PARTY_STATED_CONFIGURATION`
> `PARTY_CONFIGURATION != COUNTERPARTY_CHANGED_TERMS`

## What was disconnected

Two chains existed. The conversational one ended at a draft and a pinned
payment intent; the canonical one carried everything the runtime verifies,
observes and follows. A person talking to JASIM fell off the first one.

```
A  expression → commercialOrder → paymentIntent            (fell off here)
B  expression → match → engagement → proposal → agreement
     → commitment → transaction → fulfillment → verification → living object
```

## What was built

**Nothing that could be called a runtime.** The bridge is composition of
primitives that already existed: `matchNeedToOffering`, `createEngagement`,
`participantsForMatch`, `proposeTermSheet`. The proposal that comes out is the
same `economic_proposals` row the agreement runtime has always read.

```
NEW_PROPOSAL_RUNTIME_ADDED = 0
```

Two generic verbs joined the conversational dispatch:

| verb | what it is | what it is not |
| --- | --- | --- |
| `commerce:configure` | a party states values for terms the offering left open | negotiating, or touching the offering |
| `commerce:propose` | a party authorizes sending **their own** proposal | the other party accepting |

## Party configuration

`api/runtime/block31/party-configuration.ts` — a key, a kind and a bound. That
is the whole vocabulary, and it is the same whether what is configured is a
preparation, an hour of somebody's time, a machine tolerance or a room.

```
DOMAIN_CONFIGURATION_TYPES_ADDED = 0
```

An offering **publishes** `configurableTerms` (a new key in the existing public
projection allowlist — no schema). A party may state values for exactly those
keys, within exactly those bounds. An **undeclared key is closed**: a party
cannot widen an offering by naming a term it never opened. The published
offering row is read and never written.

## Three fingerprints, because three different things can move

| fingerprint | moves when |
| --- | --- |
| `offeringFingerprint` | the counterparty changes their published offer |
| `configurationFingerprint` | this party restates what they want |
| proposal `version` | a new canonical proposal is made |

```
SAME_OFFERING + NEW_CONFIGURATION      → new configuration, NOT «seller changed»
CHANGED_OFFERING                       → the draft is stale, re-selection required
UNCHANGED + UNCHANGED                  → idempotent
```

All three are hashes over canonical state. None is a display string.

## The role of `commercial_orders` — precisely

It is a **selection snapshot and a pre-canonical draft**. It is kept, and it is
authoritative for nothing.

```
COMMERCIAL_ORDER != AGREEMENT
COMMERCIAL_ORDER != COMMITMENT
COMMERCIAL_ORDER != CANONICAL_TRANSACTION
```

It holds what was selected, what this party configured, the two fingerprints
that make movement classifiable, and — once sent — a `proposalId`. **The draft
points at the canonical truth; the truth never points back at the draft.** No
agreement, commitment, transaction or fulfillment reads it.

## The payment intent, corrected

`commerce:approve` still pins an approved fingerprint into a payment intent,
and that intent is still never executed. What changed is that it no longer
reads as ordering: the sentence a person sees now says, in the same breath,
that no payment happened, that the other party has not agreed, and that no
agreement, commitment or transaction exists.

```
PRE_AGREEMENT_PAYMENT_EXECUTION = 0
PAYMENT_INTENT_AS_ORDER_SUCCESS = 0
FAKE_PAYMENT = 0
```

## Only the counterparty can accept

The canonical runtime already refused self-acceptance
(`respondToProposal`: *"Proposer cannot accept their own proposal"*), and
engagement participants are **derived from the authorized match** rather than
nominated by the caller. The bridge reuses both. A buyer saying «البائع وافق»
moves nothing, and a model cannot carry an `accepted` key — the envelope schema
is strict and has no such field.

```
FAKE_COUNTERPARTY_ACCEPTANCE = 0
```

## Where the proof is

`tests/block31/selection-to-proposal-bridge.test.ts` — 17 live tests, real
PostgreSQL, every conversational turn through `routeRuntimeConversationTurn`,
with a second real principal acting as the counterparty. Six structurally
unrelated exchanges take the identical bridge, one of them a semantic type that
appears nowhere else in the repository.
