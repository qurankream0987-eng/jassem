# JASIM — AN ACT NOBODY IS WATCHING ASKS FIRST

> «إذا نزل المنتج تحت ٥٠، جهّز لي طلباً — **ولا تنفّذ بدون موافقتي**»

## THE GAP

Approval was decided by **risk alone**:

```ts
input.risk === "high" || input.risk === "critical"
  ? "require_approval"
  : "allow";
```

That is right for an act a person authored a moment ago and is watching happen.
It is not right for one that fires at three in the morning because a number
moved. **The same "low risk" does not mean the same thing when nobody is
there.**

> **A STANDING ACT IS NOT A WATCHED ACT**

And the chain that makes such an act possible was completed in the two phases
before this one: a condition can become true, and a fired trigger can wake the
run it names. So the moment a standing act existed, a low-risk one would have
executed unattended.

**The rule is fixed before the door that needs it opens.** That is «لا تنفّذ
بدون موافقتي» holding by construction rather than by the person remembering to
say it.

---

## HOW "STANDING" IS KNOWN

> **A RUN A TRIGGER NAMES IS A STANDING RUN**

Read from canonical state, not from a flag — and it is the **same evidence**
that decides whether a fired trigger may wake the run
(`A_RUN_IS_WOKEN_BY_A_TRIGGER_THAT_NAMES_IT`). One fact, one place, nothing to
forget to set. A standing run cannot be one thing to the waker and another to
the approval gate.

Scoped to the owner, like the wake. Somebody else's trigger row is not evidence
about your run — and if it were, its only effect would be to ask **more** often.

---

## IT NEVER LOOSENS

| Case | Before | After |
|---|---|---|
| low risk, watched | allow | **allow** (unchanged) |
| low risk, standing | allow | **require_approval** |
| no risk at all, standing | allow | **require_approval** |
| high risk, either | require_approval | **require_approval** |
| nothing to run | deny | **deny** |
| missing inputs | require_input | **require_input** |

The rule can only turn *allow* into *require_approval*. A refusal never becomes
a request, and a gap in the inputs still asks for the inputs rather than for
approval of a gap.

---

## GENERALITY

The gate does not know what kind of act it is holding. The helper's body names
no payment, no purchase, no stock, no price — it asks one question about
canonical state and answers yes or no.

`tests/block31/standing-act-asks-first.test.ts` — 10 tests.
