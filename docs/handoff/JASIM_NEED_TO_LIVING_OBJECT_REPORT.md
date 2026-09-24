# JASIM — NEED → LIVING OBJECT · MICROCLOSURE REPORT

Base: `1e9d2e875aaa3f64cda7c4e1a39c59db628c880f`
Branch: `claude/runtime-experience-wave-1`

---

## 1 · WHAT THIS PHASE WAS

A **proof** phase. The question was not "what is missing" but "does the general
runtime already compose", and the method was to drive the whole path through the
REAL conversation boundary — `routeRuntimeConversationTurn` — and let it fail
where it actually fails.

It did compose, almost entirely. One seam was closed. Three findings are named
rather than papered over.

```
DOMAIN_NOUN_BRANCHES = 0 · SHAWARMA_BRANCH = 0
BROASTED_BRANCH = 0 · TRANSLATOR_BRANCH = 0
FOOD_DISCOVERY_RUNTIME_ADDED = 0 · DOMAIN_TRANSACTION_TYPES_ADDED = 0
DOMAIN_CONFIGURATION_TYPES_ADDED = 0
```

No food code was written. Every holdout reduces to Need · Discovery ·
Selection · Obligation.

---

## 2 · WHAT THE LIVE TRACE FOUND

Driving the path turn by turn through the real boundary:

| step | result |
| --- | --- |
| a stated need | goal recorded, readiness `NEEDS_INPUT`, **no handle** |
| an underspecified need | same — an open question, not `UNSUPPORTED_DOMAIN` |
| a refinement with constraints | `ACTIONABLE`; stated HARD kept, inferred HARD downgraded and the downgrade recorded |
| discovery | 3 canonical candidates, 3 ordinal bindings, **no handle** |
| comparison | no new result set, no new ordinals, **no handle** |
| ordinal selection | DRAFT order at the offering's read-back terms, **no handle** |
| approval | payment INTENT only, «لم يحدث دفع», **no handle** |
| **committed agreement** | agreement + commitments + transaction, **handle for every party** |

The materialization boundary the brief asked for is exactly where it should be:

```
DISCOVERY_CREATED_LIVING_OBJECT   = 0
COMPARISON_CREATED_LIVING_OBJECT  = 0
SELECTION_CREATED_LIVING_OBJECT   = 0
ONGOING_FULFILLMENT_LIVING_OBJECT = PASS
```

---

## 3 · THE ONE SEAM CLOSED

**An open transaction was nobody's to follow.** The living object runtime's
materialization hooks were wired for worlds and monitors; the moment a
transaction is *born* — `commitAgreement`, after `materializeTransaction` — had
none. So «أين طلبي؟» had nothing to resolve.

Closed with one hook at the one place such a transaction exists, and one new
entry point:

- `materializeLivingObjectForScope` — for the runtime's own call sites, where an
  operation is already authorized and re-resolving an acting scope would ask a
  question already answered. It is not a bypass: the subject is still asked
  whether the scope may see it, the same structural policy still decides, and
  the same unique index still makes it idempotent. Only scope *resolution* is
  skipped.
- In `commitAgreement`: **every party** to the new transaction gets a handle.
  Not because it is an order, a booking or a job — because it is an OPEN
  OBLIGATION, which is the only fact the living object runtime is shown. Failure
  to make a handle never fails the commitment.

The handle carries no status of its own, so it cannot later claim the
transaction finished; it reads that from the transaction on every projection.

```
PAYMENT != FULFILLMENT · PAID != DELIVERED
```

---

## 4 · THREE FINDINGS NAMED, NOT CLOSED

These are real, they are generic, and each is larger than a microclosure. They
are reported rather than half-built.

### (a) `SELECTION_TO_COMMITMENT_BRIDGE` — the largest

**There are two parallel commerce chains, and only one reaches fulfillment.**

```
A  economicExpressions → commercialOrders → paymentIntents          (conversational)
B  expression → match → engagement → proposal → agreement
     → commitments → transaction → fulfillment → verification       (canonical)
```

Chain A is what an ordinal selection and an approval in conversation actually
produce. Chain B is what the runtime verifies, observes, reconciles and now
follows. **Nothing turns an approved chain-A selection into a chain-B
proposal**, so a conversational selection is a dead end with respect to
commitments, transactions, fulfillment, verification and living objects.

This phase's proof therefore reaches a committed transaction through chain B —
a legitimate internal path, reached the way the runtime reaches it — and the
bridge is named rather than improvised. Building it means a selection creating
an engagement and a proposal between the two parties, which is a phase, not a
seam.

### (b) `PARTY_STATED_TERMS` — configuration has nowhere to live

An order's terms are the offering's public terms and nothing else, and
`approveOrder` recomputes them from the offering alone to detect change. So a
party cannot state configuration *within what an offering permits*, and if they
could, the re-approval check would read their configuration as the
counterparty's change and discard it.

The generic gap is `OFFERING_TERMS != ORDER_TERMS`, and with it
`PARTY_CONFIGURATION != COUNTERPARTY_CHANGE`. Closing it means an offering
declaring which terms are configurable and a fingerprint that distinguishes the
two kinds of movement. No food-modifier type was added, and none should be.

### (c) `NEED_CONTINUITY` — a need does not survive its turn

A `goalSpec` is stated per turn, evaluated per turn, and recorded in that turn's
canonical message metadata. Nothing accumulates it across turns.

This is reported as a finding rather than a defect, because it is a genuine
trade: continuity cannot become contamination — proven, a meal's budget does not
follow a request about a car — and the price is that refinement must be
re-stated rather than assumed. Whether JASIM should carry a conversation-scoped
Need is a design decision, not a bug, and it is the user's to make.

---

## 5 · PROOF

`tests/block31/need-to-living-object.test.ts` — **16 live tests**, real
PostgreSQL, real migrations, every turn through the real conversation boundary,
with the model saying only what a model may say (`effects` is a literal the
schema pins, so a model cannot declare an effect at all).

Including:
- the materialization boundary, all four negatives and the positive;
- both parties following one transaction, and committing twice following one thing;
- «أين طلبي؟» answering from the transaction and never reading as finished;
- hide preserving the handle AND leaving the transaction `OPEN`;
- reopen resolving the same handle;
- **six structurally unrelated holdouts** taking the identical path, with a
  companion proving they are also refused identically when nothing was
  committed;
- topic change not carrying constraints, and a stale ordinal not resolving into
  a new conversation.

---

## 6 · REGRESSION

```
MAIN                  2307 passed ·  27 skipped ·  95 files
BLOCK 2                121 passed              ·  16 files
BLOCK 3 + BLOCK 3.1    782 passed              ·  55 files   (+16 new)
FROZEN_EVALUATION       90 passed              ·   5 files

tsc -b                 clean
web build              clean
mobile tsc --noEmit    clean
expo export            clean
```

No inherited test was weakened, and none needed to change.

---

## 7 · NOT DONE

The brief arrived with two earlier briefs addressed to a different agent —
`GENERAL_PROVIDER_CONNECTOR_BINDING_RUNTIME` and
`GENERAL_PAYMENT_PROVIDER_RUNTIME`. Neither was started: this brief explicitly
scoped the turn to the microclosure and forbade new provider, payment,
transaction and agreement runtimes.

The brief's text was **truncated mid-sentence in §5**, so anything specified in
§6 onward was not seen and not done.
