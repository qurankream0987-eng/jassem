# JASIM — THE GENERAL AGREEMENT RUNTIME

```
Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
```

One negotiation mechanism. A salary, a rent, a shipping fee, a service scope and
six hours of laboratory time go through the same evaluator and the same four
capabilities, differing only in a term key that nothing in the runtime reads.

---

## 1. What already existed, and what did not

Traced before anything was written.

| existed | where |
|---|---|
| match-backed engagements, participants derived from the match | `economic-fabric.ts` |
| versioned proposals, CAS-guarded, with expiry evaluated in database time | `economic_proposals` |
| acceptance into a `TransactionIntent` that is explicitly not a payment | `respondToProposal` |
| a tRPC surface for all three | `api/routers/fabric.ts` |

And the gap, in four parts:

1. **Terms were opaque.** `terms` was a `Record<string, unknown>`. Nothing knew
   which fields were negotiable or which way was better, so nothing could
   compare a counter, and nothing could be bounded.
2. **There was no authority envelope.** «لا تتجاوز 250 دينارًا ولا تخبره بذلك»
   had nowhere to go.
3. **There was no Agreement.** Acceptance went straight to a transaction intent,
   which collapses `AGREEMENT != TRANSACTION`.
4. **No capability named any of it**, so nothing a person said could reach it —
   the same shape of gap the opportunity exchange had.

## 2. A term sheet

```ts
{ key, kind: "NUMBER" | "CHOICE", value, unit?, owedBy?, dueAt? }
```

`key` is opaque. Everything validated is structural: the kind is in the closed
set, a NUMBER is finite, a key appears once. There is deliberately **no**
`CURRENCY` kind and no `DATE` kind — both would be the module learning a
subject.

A unit is carried and never converted. A runtime that turned dinars into dollars
would be deciding an exchange rate nobody gave it.

`owedBy` is how a Commitment comes to exist. It is **declared**, never inferred:
`price` does not mean the buyer pays, and guessing that from a field name is how
a general runtime acquires a domain at the worst possible point.

## 3. The envelope — bounded authority

```
TARGET != AUTHORITY
```

Per term: a direction, a target, a **reserve**, and optionally a concession step.

| | |
|---|---|
| target | the opening position. Binds nothing. |
| reserve | the line. A counter is clamped here, over any number of rounds. |
| concessionStep | how far one move goes. Absent means straight to the reserve — a decision the owner made by not declaring a step, not a default the runtime chose. |
| `mayConcede` | whether JASIM may counter at all. **Defaults to false.** |
| `mayAcceptWithinReserve` | whether JASIM may agree. **Defaults to false.** |

Undeclared authority is no authority. A target lying beyond its own reserve is
refused as a contradiction: it would open at a position the owner has already
said they cannot hold.

Envelopes are versioned and append-only, like a policy. Authority that could be
edited in place would let an agreement be re-explained after it was reached.

## 4. Evaluation

Pure. It reads no database, writes nothing and decides nothing about acceptance.

| verdict | meaning |
|---|---|
| `WITHIN_RESERVE` | every bounded term is at or inside the reserve. **This is not acceptance.** |
| `COUNTERABLE` | something is outside, and a counter inside the declared authority exists |
| `OUT_OF_AUTHORITY` | something is outside and JASIM may not move. The owner decides. |

A term nobody bounded is `UNBOUNDED` — an unanswered question, neither a
violation nor an agreed point. A counter carries the already-settled terms
forward verbatim: reopening one to win another is a negotiating tactic nobody
authorized.

The concession is deterministic and explainable — one declared step from this
party's own last position, clamped at the reserve. There is no heuristic, no
model and no "split the difference", because a concession nobody can explain is
a concession nobody authorized.

## 5. Where the reserve may go

Nowhere.

```
RESERVE != LLM CONTEXT
```

It is treated exactly like a credential. The counterparty's view of a proposal
is built from five named fields, so a bound cannot reach it by being added to
the row later — the same construction the public expression projection uses, and
for the same reason: a projection assembled by omission leaks the first field
somebody forgets. An `OUT_OF_AUTHORITY` answer names term states and never the
numbers behind them, and the envelope row itself never leaves the API.

```
NOT_DISCLOSED != NOT_INFERABLE
```

And that is the whole claim. A reserve is never **stated**. It may still be
**inferred** from a sequence of counters — moving in declared steps is a
concession policy the owner sets, not a promise the runtime makes — and a test
asserting otherwise would be the false guarantee this project exists to refuse.

## 6. Agreement

An `Agreement` records the exact proposal **version**, its terms as a
**snapshot** (a later edit must not change what was agreed), the parties, and
the authority the acceptance rested on:

```
OWNER_DIRECT  the person, present, deciding
ENVELOPE      the envelope id, its version, and who delegated it
```

An agreement that could not say whose authority it rested on would make the
envelope decorative.

`AGREEMENT != TRANSACTION`: nothing here moves money, books anything or tells
anyone. Commitments are created only for terms that declared `owedBy`, and they
stay `open` until something **observes** otherwise — never advanced by the party
who owes them.

One proposal version yields at most one agreement: a CAS on the proposal status
and a unique index on `proposalId`, which are two locks for the same race.

## 7. Why a capability may never approve

```
EXECUTION != APPROVAL
```

A capability receives a scope id. It does not receive the person, and it cannot
tell an approved run from an unapproved one — the run it executes inside was
approved by something it has no handle on. So `agreement-commit` acts only on an
**envelope** the owner signed in advance, and `ownerDirect` is a reserved input
key: a caller naming it is refused rather than obeyed.

Accepting on the owner's own authority happens on the trusted path, where the
person is actually present. That is also why setting an envelope is not a
capability: a plan proposing `{ reserve: 9999 }` and a person clicking approve on
a run summary would be an approval they never read.

A capability that could say "the owner approved this" would make every approval
gate in the runtime decorative.

## 8. The four capabilities

| | effect | verb | verified by |
|---|---|---|---|
| `agreement-open` | INTERNAL_STATE | `mutate` | the engagement lists this owner |
| `agreement-propose` | INTERNAL_STATE | `publish` | the proposal stands as this owner's |
| `agreement-respond` | INTERNAL_STATE | `publish` | whichever branch it reported |
| `agreement-commit` | INTERNAL_STATE | `approve` | the agreement lists this owner |

Responding may write a counter and may write nothing, and **both are claims**.
It is declared INTERNAL_STATE for both branches rather than switching: a
capability whose effect class depended on its own outcome could report the
cheaper one. Reporting "I did not counter" is read back too — a run that quietly
created a version while saying it had not is exactly the false success the
completion policy exists to catch.

Every one is verified by JASIM's own readback, never by what the executor
returned.

## 9. What is not built

- **No way to delegate a limit by talking.** `AUTHORITY_ADMINISTRATION_PATH` —
  the same gap the business scope left behind, which is what makes it general.
- **No transaction, payment or fulfillment.** The chain ends at Agreement.
- **No fulfillment observation.** A Commitment stays `open`; nothing yet watches
  the world to close one, and nothing may close one on the word of the party who
  owes it.
- **No negotiation with anyone outside JASIM.** That is messaging and discovery,
  and both are provider gaps.
