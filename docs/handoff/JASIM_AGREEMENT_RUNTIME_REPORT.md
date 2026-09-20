# JASIM — THE GENERAL AGREEMENT RUNTIME · phase report

```
Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
TARGET != AUTHORITY
EXECUTION != APPROVAL
```

**Rule held throughout:** `DOMAIN_NEGOTIATION_TYPES_ADDED = 0` ·
`DOMAIN_TERM_TYPES_ADDED = 0` · `NEW_DOMAIN_BRANCHES = 0` ·
`DOMAIN_AGENTS_ADDED = 0` · `FALSE_SUCCESS = 0` · `FALSE_PURE_READ = 0`.

---

## 1. The gap, traced before it was filled

A great deal already existed: match-backed engagements whose participants are
derived rather than named, versioned proposals with a CAS and database-time
expiry, and acceptance into a `TransactionIntent` that is explicitly not a
payment. All of it reachable over tRPC.

What was missing was four things, and they were one thing:

1. **Terms were opaque.** `Record<string, unknown>`. Nothing knew which fields
   were negotiable or which way was better — so nothing could compare a counter,
   and nothing could be bounded.
2. **There was no authority envelope.** «لا تتجاوز 250 دينارًا ولا تخبره بذلك»
   had nowhere to go.
3. **There was no Agreement.** Acceptance went straight to a transaction intent,
   which collapses `AGREEMENT != TRANSACTION`.
4. **No capability named any of it**, so nothing a person said could reach it.

## 2. What was built

| | |
|---|---|
| a **term sheet** | `{ key, kind: NUMBER \| CHOICE, value, unit?, owedBy?, dueAt? }` — everything validated is structural, and the key is opaque |
| a **negotiation envelope** | per term: direction, target, **reserve**, concession step; plus `mayConcede` and `mayAcceptWithinReserve`, both defaulting to **false** |
| an **evaluator** | pure; `WITHIN_RESERVE` / `COUNTERABLE` / `OUT_OF_AUTHORITY`, and a counter clamped at the reserve |
| an **Agreement** and **Commitments** | the exact version, a terms snapshot, and whose authority — with commitments only where the sheet declared `owedBy` |
| four **capabilities** | `agreement-open`, `-propose`, `-respond`, `-commit`, each INTERNAL_STATE with its own readback |

Three modelling decisions that were the whole design:

**No `CURRENCY` kind and no `DATE` kind.** Both would be the module learning a
subject. A unit is carried and never converted: converting would be deciding an
exchange rate nobody supplied.

**`owedBy` is declared, never inferred.** `price` does not mean the buyer pays.
Guessing that from a field name is how a general runtime acquires a domain at
the worst possible point, so a term sheet with no declared obligation produces
**zero** commitments, and a test asserts exactly that.

**The concession is deterministic.** One declared step from this party's own last
position, clamped at the reserve. No heuristic, no model, no "split the
difference" — a concession nobody can explain is a concession nobody authorized.

## 3. Where a reserve may go

Nowhere.

```
RESERVE != LLM CONTEXT
```

Treated as a credential. The counterparty view is built from five named fields,
so a bound cannot reach it by being added to the row later. An `OUT_OF_AUTHORITY`
answer names term states and never the numbers behind them. The envelope row
never leaves the API — the mutation returns the bounded term *names*, not the
bounds.

```
NOT_DISCLOSED != NOT_INFERABLE
```

And the runtime claims no more than that. The tests prove a reserve is never
**stated**. They deliberately do not claim it cannot be **inferred** from a
sequence of counters, because it can, and asserting otherwise would be the false
guarantee.

## 4. Why a capability may never approve

```
EXECUTION != APPROVAL
```

A capability receives a scope id. It does not receive the person and cannot tell
an approved run from an unapproved one. So `agreement-commit` acts only on an
envelope the owner signed in advance, and `ownerDirect` is a **reserved input
key** — a caller naming it is refused rather than obeyed, which a live test
proves by watching the attempt fail and the agreements table stay empty.

The same reasoning is why setting an envelope is **not** a capability: a plan
proposing `{ reserve: 9999 }` and a person clicking approve on a run summary
would be an approval they never read.

## 5. Proof

| file | tests | what it holds |
|---|---:|---|
| `tests/block31/agreement-runtime.test.ts` | 50 | term sheets, the envelope, three verdicts, the clamp over ten rounds, the private bound, the agreement's authority basis, `AGREEMENT != TRANSACTION`, declared-not-inferred commitments, the full four-capability path on the real executor, and **fourteen subjects** through one evaluator |
| `tests/unit/agreement-contract.test.ts` | 30 | authority refusal mirrored in model output, the clamp in both directions, the projection built from named fields, and that the modules name no subject anywhere |

The live path runs open → propose(300) → respond → counter(225) → propose(245) →
commit, on the real executor, and every attempt reaches `VERIFIED` by JASIM's own
readback rather than by what the capability returned.

Fourteen subjects — the catalog's eight plus six nobody designed for, including
instrument hours, hives provided and pallet-days — negotiate through the **same**
evaluator with the same two directions, each with a counter-case that must
*not* counter, so a holdout cannot pass by always countering.

## 6. Two defects avoided by declaring honestly

**A capability whose effect class depended on its outcome.** `agreement-respond`
sometimes writes a counter and sometimes writes nothing. Declaring the effect
per-branch would have let it report the cheaper one, so it is INTERNAL_STATE for
both and the readback checks whichever branch was reported — including "I did not
counter", which is read back by looking for a version it might have created.

**An agreement that could not say whose authority it rested on.** Storing the
envelope id *and its version* is what keeps the envelope from being decorative:
version 1 still says what it said, so an agreement reached under it can still be
explained after version 2 narrowed the reserve.

## 7. Catalog effect

`GENERAL_AGREEMENT_RUNTIME` is **closed** and removed from the vocabulary of
blames — the second gap to close in two phases.

What both phases left behind is the **same** gap, which is what makes it general
rather than two missing features. Creating an organization, granting a verb,
setting a policy, binding a provider and delegating a negotiating limit are one
shape: an **authority act**, which no plan may perform on the person's behalf.
`SCOPE_ADMINISTRATION_PATH` is therefore renamed `AUTHORITY_ADMINISTRATION_PATH`
and now carries 22 scenarios.

| gate | before | after |
|---|---:|---:|
| PLANNABLE | 122 | **133** |
| OBSERVABLE | 67 | **69** |
| VERIFIABLE | 62 | **64** |
| EXECUTABLE | 65 | 65 |

Note what did **not** move. `PLANNABLE` moved for all eleven agreement scenarios
at once — what a general mechanism looks like when it lands. `EXECUTABLE` moved
for none of them, because the door is a different thing and promoting both would
have been reporting effort rather than the repository.

Two of the previous phase's blind ideas — the elder companionship rota and the
rare-seed lending ring — were waiting on this runtime and now wait on the door
instead. Their term with a holder and a deadline is a Commitment today.

**162 scenarios · 16 blind holdouts · 7 blind ideas · 12 general gaps.**

## 8. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2031 passed, 27 skipped · 89 files | 1999, 27 · 88 | +32, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 361 · 29 files | 311 · 28 | +50, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

No inherited test was weakened and none was removed. Block 2, Block 3 and
Block 3.1 still need `--no-file-parallelism`.

## 9. What this phase did **not** do

- **No transaction, payment or fulfillment.** The chain ends at Agreement.
  `GENERAL_TRANSACTION_FULFILLMENT` is untouched.
- **No fulfillment observation.** A Commitment stays `open`, and nothing may
  close one on the word of the party who owes it.
- **No negotiation with anyone outside JASIM.** That is messaging and external
  discovery, and both are provider gaps.
- **No conversational authority delegation.** Deliberately — it is the gap, and
  building it carelessly is how approval becomes theatre.
- **No model was involved.** `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`.

## 10. Next general gap

```
AUTHORITY_ADMINISTRATION_PATH     22
SECURE_PRODUCT_ACTION_RUNTIME      9
PERSISTENT_WORLD_MATERIALIZATION   9
MONITORING_ENGINE                  7
GENERAL_TRANSACTION_FULFILLMENT    7
REALTIME_RUNTIME                   5
BUSINESS_DATA_SOURCE_ADAPTER       3
EXTERNAL_DISCOVERY_PROVIDER        3
LOCATION_OBSERVATION               2
SUBSCRIPTION_RUNTIME               2
SPONSORED_DISCOVERY_RUNTIME        2
LIVING_OBJECT_RUNTIME              1
```

`AUTHORITY_ADMINISTRATION_PATH` is now larger than the next three combined, and
it is the hardest one in the list — not because the mechanism is difficult, but
because the whole point is that a person must actually read what they are
authorizing. It needs a presentation surface that shows the exact numbers and an
approval that is a decision rather than a click, and getting that wrong turns
every guarantee in this document into theatre.
