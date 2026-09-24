# JASIM — ASK THE PERSON WHO KNOWS, ONCE

> `NO API != NO CAPABILITY` · `HUMAN RESPONSE != MAGIC TRUTH`
> `COUNTERPARTY_ASSERTION != SYSTEM_OBSERVATION` · `!= VERIFIED_FACT`
> `QUESTION != PROPOSAL` · `AVAILABILITY_CONFIRMATION != RESERVATION`
> `AVAILABILITY != AUTHORITY` · `NO_RESPONSE != YES` · `NO_RESPONSE != NO`

JASIM does not stop being useful because a shop has no API. When the freshness
runtime says the evidence is not strong enough and no machine can supply a
better answer, the person who owns the fact may be asked — once, about one
exact thing.

## What the trace found

| needed | already there |
| --- | --- |
| delivery | `notification_intents` — recipient, purpose, content, **privacyClass**, idempotency |
| evidence store | `observations` + `recordObservation` |
| source classification | `sourceKind`, set by the channel a trusted call site names |
| authority | `resolveActingScope` / `memberships` |
| re-evaluation | `assessSufficiency` (previous phase) |
| deduplication key | `requirementKeyFor` (previous phase) |

**One table was needed.** Nothing existing binds a question to *this subject, at
this revision, this property, this configuration, this quantity, for this
purpose* and to the scope entitled to answer. `authority_requests` is shaped for
authorizing an **act**, and forcing a question through it would be exactly the
`QUESTION != PROPOSAL` conflation the trust chain forbids.

## The order is the whole point

```
1. Is it already known well enough?   → nobody is asked
2. Who canonically speaks for it?     → derived from the subject, never named
3. Is that question already open?     → reuse it
4. Otherwise ask, once.
```

A hundred views open nothing. A confirmation given moments ago is reused. Five
people wanting one answer is **one question** — enforced by a partial unique
index on the requirement key `WHERE state = 'PENDING'`, so it holds under
concurrency rather than by hoping.

## Who may answer is a property of the subject

One resolver per canonical subject kind, reading the subject's own row. An
organization's offering resolves to the **organization's scope** — never to
whichever member is nearby — and who may then answer is decided by that scope's
own membership, like every other scoped act.

```
MODEL_CAN_CHOOSE_AUTHORITATIVE_COUNTERPARTY = NO
```

**Authority is re-checked when they answer**, not trusted from when the question
was sent. A member who left the organization in between is refused, and a
stranger gets the same refusal — so neither learns anything from being told no.

## What the answer becomes

Four words the runtime owns: `AFFIRMED` · `DENIED` · `CHANGED` · `UNKNOWN`.

Only the first two say anything about the fact **as asked**, and only they write
an observation:

- **`CHANGED`** is not an answer to the question that was put — it is news that
  the question no longer fits. Letting it stand as confirmation of the old
  configuration would be the silent mutation that must not happen.
- **`UNKNOWN`** is a reply worth recording and evidence of nothing.

A **no is good evidence**. Sufficiency is about evidence quality, never about
whether the answer is convenient.

Nothing is marked verified: a person clicking *yes* is a person saying yes. The
source is `counterparty_confirm`, chosen by the trusted handler from the fact
that an authorized counterparty answered a trusted question — never by anything
the payload said about itself.

## An answer is not permission

After recording, the **freshness runtime is asked again**. Only its verdict
decides whether the caller may continue.

```
COUNTERPARTY_RESPONSE_BYPASSES_SUFFICIENCY = 0
```

And a confirmation creates nothing else — no reservation, no agreement, no
transaction, no standing authority. Asserted by counting rows.

## What the person asked is told

The subject, the property, the configuration, the quantity. **Nothing about who
is asking** — which matters twice over, because one question may stand for
several people, and none of them learns the others exist.

## It is not a negotiation channel

The table has no column for a price, an amount, terms, an offer or a proposal
id, and the module never reaches `proposeTermSheet` or `commitAgreement` —
both asserted. *"Ask him whether he accepts an inspection"* is a question.
*"Tell him I offer 8500"* is a proposal, and proposals go through the agreement
runtime like every other proposal.

## Silence

Stays `PENDING`, then becomes `EXPIRED`. Never a yes, never a no, never a
refusal. The fact remains simply unknown.

## Where the proof is

`tests/block31/counterparty-verification.test.ts` — 23 live tests, real
PostgreSQL, real acting scopes, injected time: the journey without bothering
anybody, five concurrent askers producing one question, organization membership
revoked between question and answer, answers that cover only the exact
configuration / quantity / revision asked about, and seven structurally
unrelated subjects — one of which appears nowhere else in the repository.
