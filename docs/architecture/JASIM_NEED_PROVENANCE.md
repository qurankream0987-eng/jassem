# JASIM — WHAT CAME OF WHAT YOU WANTED?

> `PROVENANCE != AUTHORITY` · `!= VERIFICATION` · `!= COMPLETION`
> `TRANSACTION_CREATED != NEED_SATISFIED`
> `PAYMENT_VERIFIED != NEED_SATISFIED`
> `FULFILLMENT_CLAIMED != NEED_SATISFIED`
> `NO_PROVENANCE → NO_AUTOMATIC_NEED_RESOLUTION`

## What the trace found

Most of the chain was already deterministic and immutable:

```
transactions.agreementId  → agreements.proposalId (unique index)
agreements.proposalId     → economic_proposals.engagementId
reference_bindings.resultSetId · discovery_candidates.resultSetId
commercial_orders.proposalId
```

Three edges were missing — the **head** of the chain, and the **carrier** into
it. No new table was needed.

## The three edges

| edge | where | why |
| --- | --- | --- |
| `discovery_result_sets.needId` + `needRevision` | why a search happened | a search is evidence *for a particular wording* |
| `commercial_orders.resultSetId` + `candidateId` | what was picked, out of what | a selection must not lose why the candidate was on screen |
| `economic_engagements.needId` + `needRevision` | **the canonical carrier** | born the moment a selection becomes a proposal, never changes |

The full chain is walked, never guessed:

```
transaction.agreementId → agreement.proposalId → proposal.engagementId
  → engagement.needId @ engagement.needRevision
```

Nothing reads a transcript, a semantic type, an amount, a timestamp, or "the
most recent need". A transaction created outside a conversation traces to
**null**, and saying so is the point.

### Why the engagement, not the draft

The commercial order is a selection snapshot and authoritative for nothing
(previous phase). Routing lineage through it would re-promote it. The
engagement is canonical, immutable, and born at exactly the right moment.

### Why the revision matters

A need goes on being refined after a search ran. An edge carrying only the
need's id would let a corrected need silently inherit evidence gathered for
what it used to say.

```
STALE_RESULTSET_REINTERPRETED_AS_NEW_NEED = 0
HISTORICAL_PROVENANCE_MUTATION = 0
```

## The resolution gate

Both halves must hold, and neither substitutes for the other:

**A.** deterministic provenance to a transaction **at the revision the need has now**, and
**B.** every obligation in it `VERIFIED` — not claimed, not paid.

| verdict | when |
| --- | --- |
| `SATISFIED` | exactly one traced transaction at the current revision, everything verified |
| `NO_TRANSACTION` | nothing ever came of it |
| `FULFILLMENT_INCOMPLETE` | something came of it and is not finished |
| `SUPERSEDED_BY_REVISION` | the attempts belong to an older wording |
| `INCONCLUSIVE` | more than one traced transaction |

**Conservative by construction.** Nothing in a need says how many things it
takes to satisfy it. «جهز لي فعالية» may need a hall, an interpreter and
transport, and one finished transaction is not the outcome — so more than one
traced transaction is `INCONCLUSIVE`. Inventing partial-completion semantics to
make that case green would be inventing the answer.

```
ONE_TRANSACTION_ALWAYS_RESOLVES_NEED = NO
INCONCLUSIVE_NEED_SATISFACTION != RESOLVED
```

`resolveNeedIfSatisfied` writes `RESOLVED` **only** on `SATISFIED`, and only
while the need is still at the revision the verdict was reached on. There is no
argument by which a caller can force it and no path from a model patch reaches
it.

## A bug this phase's tests caught

The previous phase wired the canonical need into discovery. A `GoalConstraint`
(`COST · AT_MOST · 3 · KWD`) is **not** a discovery `HardConstraint`
(`field: price · maxMinor`), and passing one untranslated made **every
candidate fail to match**. Fixed with an explicit translator.

**Only faithful translations are applied.** A bound stated in major units
cannot become minor units without a currency's exponent, and guessing one would
quietly exclude things the person never excluded — so such a bound is not
applied as a hard filter. Discovery stores the constraints it did apply, so
what was applied stays visible. **Bounds stated in units the fabric does not
store are a remaining narrow gap**, reported rather than papered over.

## Where the proof is

`tests/block31/need-provenance.test.ts` — 18 live tests, real PostgreSQL, the
conversational path through `routeRuntimeConversationTurn`, a second real
principal as counterparty, and fulfillment verified through the **real evidence
path** (effect signals scoped to the transaction's own scope; a party's own
report still does not verify their own work).

Seven structurally unrelated exchanges take the identical chain, one of them a
semantic type that appears nowhere else in the repository.
