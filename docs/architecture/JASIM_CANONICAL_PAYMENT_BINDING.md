# JASIM — WHAT EXACT OBLIGATION IS THIS PAYMENT SATISFYING?

> `NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH`
>
> `COMMERCIAL_ORDER != PAYABLE_OBLIGATION`
> `PAYMENT_INTENT != PAYMENT` · `PAYMENT_AUTHORIZATION != SETTLEMENT`

## The bypass, proven before it was fixed

Through the real conversation boundary: select → «أوافق» → «ادفع». The path ran
all the way into `createFinancialCheckout` while

```
agreements = 0 · commitments = 0 · transactions = 0
```

Nothing along it asked whether an obligation existed. The only thing that
stopped the session was the unrelated provider-trust gate — a check about
*where* the surface points, not about *what* is being paid.

**CURRENT_PRE_AGREEMENT_CHECKOUT_BYPASS = PROVEN.**

### Root cause

`payTurn` resolved its basis from `current:payment` → a payment intent →
`orderId` → the **draft commercial order**, and validated it by comparing
fingerprints against the offering. Every one of those is a pre-canonical
artifact. The canonical chain was never consulted, and `paymentIntents` already
had a `transactionId` column that nothing on this path ever set.

## The fix

`api/runtime/block31/canonical-payable.ts` — one question, asked first.

A **payable obligation** is a commitment that

- this **acting scope owes** (`ownerId`),
- is `PENDING` (still owed, and nobody has claimed to have discharged it),
- carries exact money (`settlement`: integer minor units + currency),
- names who is owed (`beneficiaryActorId`),
- sits on a transaction whose state is `OPEN`.

Anything else is simply absent rather than refused later. `payTurn` now
resolves that first and refuses with `NO_PAYABLE_OBLIGATION` before any surface
can open.

```
PAYMENT_AMOUNT_SOURCE    = CANONICAL_ACCEPTED_SETTLEMENT
PAYMENT_CURRENCY_SOURCE  = CANONICAL_ACCEPTED_SETTLEMENT
PAYMENT_RECIPIENT_SOURCE = CANONICAL_ACCEPTED_OBLIGATION
```

The client may name **which** obligation (`transactionRef`). It names none of
the three fields above, and a named obligation is still re-checked against what
this scope actually owes — a handle points at something, it never grants the
right to pay it.

```
LIVING_OBJECT != PAYMENT_AUTHORITY · LIVING_OBJECT != SETTLEMENT_TRUTH
MODEL_AS_PAYMENT_AUTHORITY = NO · COMMERCIAL_ORDER_AS_PAYMENT_AUTHORITY = NO
```

### Why `PENDING` only

`CLAIMED` means somebody said the obligation was discharged and verification
has not confirmed it. That is a reason to **verify**, never a reason to pay
twice.

### Ambiguity is not resolved by guessing

Two live obligations and no reference → the answer is that there are two.
Never the first row, the newest row, or the one a draft happens to mention.

```
AMBIGUOUS_PAYMENT_TARGET_GUESS = 0
```

## The pre-agreement payment intent — Option B, for a structural reason

`commerce:approve` still records an approved fingerprint as a payment intent.
That object was **not** deleted, because it genuinely represents something
real: a person approved their own draft's terms. What changed is that it is now
structurally non-executable — it carries **no `transactionId`**, and the payment
path does not consult it at all. The executable intent is prepared by `payTurn`
from the canonical obligation, and its binding to the transaction is what makes
it executable.

Option A was rejected on evidence: the canonical chain produces settlement
commitments only *after* acceptance, so deferring intent creation entirely would
have deleted a record of an approval that did happen.

## Two inherited expectations changed

Both are disclosed in full at the tests themselves
(`tests/block31/conversation-commerce.test.ts`). In summary: one asserted that a
**mutated draft** is what stops a payment — which implies an unmutated draft
would let one through; the other located the refusal in **missing conversation
context** — which implies more context would satisfy it. Both passed for the
wrong reason and would have hidden this bypass. Both now refuse on canonical
grounds, which no amount of context or fingerprint-matching can satisfy.

## Where the proof is

`tests/block31/canonical-payment-binding.test.ts` — 11 live tests, real
PostgreSQL, every conversational turn through `routeRuntimeConversationTurn`,
a second real principal as counterparty, and a genuinely trusted adapter so
that a refusal is always for a canonical reason. Six structurally unrelated
exchanges cross the identical boundary, one of them a semantic type that
appears nowhere else in the repository.

No PSP was connected and no money moved.
