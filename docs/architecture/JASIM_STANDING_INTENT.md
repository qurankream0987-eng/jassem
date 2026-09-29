# JASIM — PARKING AN ACT BEHIND A CONDITION

> «إذا نزل المنتج تحت ٥٠، جهّز لي طلباً — ولا تنفّذ بدون موافقتي»

## THE DOOR, AND WHY IT CAME LAST

Three phases built the chain this opens onto, in this order and deliberately:

1. **a condition can become true** — the evaluator was never wired, so every
   condition trigger rescheduled forever
2. **a fired trigger can wake what it names** — the wake knew only clocks
3. **an act nobody is watching asks first** — approval was risk alone

**The rule came before the door on purpose.** Opening this first would have made
a low-risk standing act execute unattended the moment anybody used it.

---

## WHAT A STANDING INTENT IS

A **run that carries an act and has not started**, plus a **condition trigger
that names that run**. Nothing else — no new table, no new job kind, no second
proposal system.

> **A RUN A TRIGGER NAMES IS A STANDING RUN**

That one naming serves both readers: the **wake** uses it to know which run a
trigger may resume, and the **approval gate** uses it to know the act is
unwatched. A standing run cannot be one thing to one and something else to the
other.

---

## WHAT FIRING DOES, AND DOES NOT

> **PREPARING IS NOT DOING**

When the condition holds, the act is **prepared**: an ordinary execution
proposal is created, it lands at `awaiting_approval` *because the run is
standing*, and the person decides. Nothing runs. «جهّز» is the whole of what was
promised and the whole of what happens.

> **PREPARED_ONCE**

A condition that holds on three consecutive sweeps has not asked for three
purchases. The check is the proposal ledger itself, not a flag.

> **PREPARING IS NOT RESUMING**

Two different things park behind a condition — a run that *started and paused*,
and a run that never started and *carries an act*. `wakeRunFromTrigger` tells
them apart from canonical state, and refuses to prepare anything that is not a
standing intent.

---

## WHAT THE ENVELOPE MAY SAY

The model may say **what** to prepare and **when**. It may not say that the
person agreed, and it cannot reach execution from here at all. The schema is
`.strict()` and carries no approval, no decision, no authorization —
asserted by a test.

`when` is a **monitor condition**, validated by the same `validateCondition`,
and refused **at the door** while somebody is present to be told. A condition
refused late would become a standing intent that quietly answers *unknown*
forever.

> **TWO_CONDITION_LANGUAGES = 0**

The branch is checked **before** monitoring, because «راقب هذا وأخبرني» asks to
be *told* while «إذا نزل تحت خمسين جهّز لي طلباً» asks for something to be
*ready* — and a monitor's only actions are NOTIFY and NONE, so routing the
second to it would silently deliver half of what was asked.

> **BEING TOLD != HAVING IT READY**

The answer says plainly what will happen: `willPrepareOnly`,
`requiresApprovalWhenPrepared`, `effects: "none"`.

---

## GENERALITY

A condition, a capability and its inputs. What the act buys, books, sends or
cancels is the act's business — the module names no stock, price, purchase,
reorder, inventory or threshold.

> **DOMAIN_STANDING_INTENTS_ADDED = 0**

`tests/block31/standing-intent-door.test.ts` — 13 tests.
