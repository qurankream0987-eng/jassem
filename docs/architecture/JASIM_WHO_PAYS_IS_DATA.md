# JASIM — WHO ASKED IS NOT WHO PAYS

> «عندي ١٨٠ لتر زيت مستعمل، أريد من يجمعه»
> — and the collector may **pay you**.

## THE GAP, IN ONE LINE

`termSheetFor` built the settlement term as:

```ts
owedBy: input.proposer,
owedTo: input.counterparty,
```

**unconditionally.** The money always flowed from whoever asked.

So a scenario where the provider pays the requester could not be expressed at
all: **asking made you the payer**. The same is true of anybody buying something
back, refunding a deposit, recovering salvage, or taking waste away for money.

> **WHO_ASKED != WHO_PAYS · ECONOMICS_IS_DATA**

This came out of holdout scenario 06, and it is the law the scenario itself
states: *"Do not assume seller → buyer based on who initiated the request."*

---

## WHOSE DATA IT IS

> **THE OFFERING DECLARES THE DIRECTION. THE REQUEST NEVER DOES.**

```
publicTerms.money = {
  amountMinor: "5000",
  currency: "SAR",
  owedBy: "REQUESTER" | "PROVIDER"   ← absent means REQUESTER
}
```

| Value | Meaning |
|---|---|
| `REQUESTER` (or absent) | whoever asks pays the offering's owner — selling |
| `PROVIDER` | the offering's owner pays whoever asks — collecting, buying back, refunding |

Read from the offering's **own published terms**, never from the merged record a
requester contributed configuration to. Otherwise the person asking could flip
who pays whom by stating a value — proven: a requester configuring
`money.owedBy = PROVIDER` changes nothing.

An unreadable direction falls back to **REQUESTER**: the status quo, and the one
direction that cannot hand somebody money they were never promised.

---

## WHAT DID NOT MOVE

The **provision** direction is untouched. Whoever published the offering still
does the thing, whichever way the money runs — asserted in both directions.

Absent `owedBy` behaves exactly as before, so every offering written before this
existed keeps meaning what it meant.

---

## IT REACHES CANONICAL OBLIGATIONS

The commitment that materializes is **owed by the owner**, with the asker as
beneficiary — because `commitments.ownerId` is *"declared by the term, never
inferred from a field name"*, and the term now says so.

And the payoff, asserted directly: after such an agreement, «ادفع» from the
person who asked resolves to **`NONE`** — they owe nothing. The payment path
needed no change at all; it was already reading canonical state rather than
assuming a direction.

---

## GENERALITY

The same declaration works for residue collection, scrap buyback, deposit
refund, salvage recovery and surplus uplift — and the function that reads it
names no noun, no verb and no trade.

`tests/block31/who-pays-is-data.test.ts` — 9 tests.
