# JASIM — A CONDITION THAT CAN ACTUALLY COME TRUE

> «إذا نزل المنتج تحت ٥٠، جهّز لي طلباً — ولا تنفّذ بدون موافقتي»

## THE GAP, TRACED EXACTLY

`fireDueTemporalTriggers` handles a CONDITION trigger like this:

```ts
const verdict = evaluator
  ? await evaluator.evaluate(trigger.condition ?? {}, { ownerId })
  : undefined;
if (verdict !== true) { reschedule; continue; }
```

`ConditionEvaluator` is an **injected seam, optional at every layer that passes
it on**:

| Layer | Signature |
|---|---|
| `runBlock2Sweep` | `evaluator?: ConditionEvaluator` |
| `makeTemporalScanHandler` | `evaluator?: ConditionEvaluator` |
| `createBlock2Worker` | `evaluator?: ConditionEvaluator` |
| **`boot.ts`** | `getBlock2Worker({ resumeNode })` — **and nothing else** |

So in production the verdict was permanently `undefined`, and **every condition
trigger rescheduled forever without ever firing**. A condition could be written
down, stored and polled — and could never come true.

The mechanism is careful, fail-closed and correct. It was **one wire short of
being able to happen at all**. The first test in the proving suite reproduces
that state exactly; every test after it is the same sweep with the wire in
place.

---

## ONE CONDITION LANGUAGE

> **TWO_CONDITION_LANGUAGES = 0**

The monitoring runtime already owns a condition vocabulary: a closed operator
set, dotted field paths, scalar leaves, three-valued results, a depth bound, and
a screen that refuses executable text smuggled into a string. A second grammar
here would mean two things called *condition* that drift — and the drift would
resolve in favour of whichever one said TRUE.

A trigger's condition **is** a monitor condition, validated by the same
`validateCondition` and evaluated by the same `evaluateCondition`. A test asserts
the evaluator contains no expression parser, no `eval`, and no SQL.

---

## WHAT IT REFUSES TO CONFUSE

| Law | Behaviour |
|---|---|
| `UNREADABLE_CONDITION != FALSE_CONDITION` | no subject, an unknown operator, or an expression string → **unknown**, rescheduled, never "it failed" |
| `NO_READING != FALSE` | nothing observed is not «the level is fine» — the subject may never have been reported on |
| `CONDITION_READS_ONLY_THE_OWNERS_OWN` | somebody else's reading never answers your condition; same scoped query monitoring uses |
| `A_CONDITION_IS_NOT_AN_AUTHORITY` | a true condition dispatches **one continuation**; whatever it resumes faces its own approval gate |

`true` is returned **only** when the condition was read against a real reading
and found to hold. Everything else returns `undefined` — the seam's own word for
*truthfully unknown, poll again*. `false` is reserved for a condition that was
actually read and did not hold.

A malformed trigger returns unknown rather than throwing: one bad condition must
not stop every other one in the sweep from being evaluated.

---

## TRANSITIONS

`changed`, `entered_state` and `left_state` are about a **transition**, and a
transition needs the reading before this one. The evaluator reads the two newest
observations and passes the older as `previous`. With a single reading those
operators answer UNKNOWN by themselves — proven both ways in the suite.

---

## WHAT THIS COMPLETES, AND WHAT IT DOES NOT

The vision's §19 shape — *condition → trigger → proposal → approval →
execution* — now has its first half working end to end: the condition can be
stated, stored, polled, and can **become true**, dispatching a continuation.

What it deliberately does **not** do is act. Firing resumes whatever was waiting;
that resumed work still meets its own approval gate, its own policy and its own
effect contract. Nothing in this file authorizes anything.

> **TARGET / CONDITION != EXECUTION AUTHORITY**

---

## GENERALITY

A subject, an observation type and a condition — all three are data. The
evaluator's body names no stock, no price, no threshold, no level and no
temperature.

> **DOMAIN_CONDITIONS_ADDED = 0**

`tests/block31/condition-can-come-true.test.ts` — 12 tests.

---

## AND THE WAKE IT REACHES

Once the condition can become true, the continuation reaches
`resumeScheduledRuntimeRun` — whose eligibility was `resumeAt <= now`, **a
clock**. A run parked on a *condition* rather than a time has no `resumeAt`, so
the wake arrived and there was no rule under which it could resume anything.

> **A CONDITION THAT CAME TRUE COULD WAKE NOTHING**

A fired trigger is now its own evidence, and it is **stricter than the clock
ever was** — because the authority is read back from canonical state rather than
taken from the job that arrived:

> **A_RUN_IS_WOKEN_BY_A_TRIGGER_THAT_NAMES_IT**

The trigger must carry this run **on its own row**, owned by the same scope, and
must actually have fired. A run named only inside a continuation payload wakes
nothing — which is the function's standing rule ("does not infer authority from
a worker payload") kept exactly.

> **WAKING_IS_NOT_APPROVING**

The `status = "waiting"` filter is untouched, so a run parked on a **person** —
`awaiting_input`, `awaiting_approval` — is as unreachable from here as it ever
was. This is «لا تنفّذ بدون موافقتي» holding structurally: a condition may say
the world changed; it may never say a person agreed. Terminal runs are not
restarted by a late wake either.

**A defect found while proving it:** the function returned `Boolean(cleared)` —
success meant *consuming the clock*. On the scheduled path that compare-and-clear
is the double-resume guard and is left exactly as it was; on the trigger path
there is no clock, so it reported a successful resume as a failure. The trigger
path's guard is the sweep's own fire claim (`fireCount` under a CAS: one firing,
one continuation).

`tests/block31/condition-wakes-a-run.test.ts` — 11 tests.
