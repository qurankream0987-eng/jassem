# JASIM — A STANDING CONDITION

```
CONVERSATION
  -> MONITORING INTENT
    -> STANDING CONDITION
      -> AUTHORIZED OBSERVATION SOURCE
        -> DURABLE EVALUATION
          -> STATE TRANSITION
            -> NOTIFICATION INTENT
              -> observation · verification · persistence
```

```
CONDITION_MATCHED != USER_NOTIFIED
LEVEL             != EDGE
UNKNOWN           != FALSE
UNKNOWN           != ABSENT
ROUTED            != EVALUATED
MONITORING AUTHORITY != EXECUTION AUTHORITY
```

---

## 1. What was actually there

Traced through `1f1cd58` before anything was written, because the brief's first
constraint was *do not create a second scheduler, observation system, event
ledger or notification truth*. None of the four had to be created.

| | where | what it already did |
|---|---|---|
| `runtime_jobs` · `DurableJobWorker` | `db/schema.ts`, `api/core/*` | a domain-neutral durable queue: leases, `availableAt`, idempotency keys, attempts, CAS recovery |
| `runBlock2Sweep` · `makeTemporalScanHandler` | `api/runtime/block2/jobs.ts` | ONE duty cycle, itself a durable job that re-enqueues its own next tick |
| `temporal_triggers` · `fireDueTemporalTriggers` | `schema-block2.ts`, `block2/temporal.ts` | AT · AFTER · DEADLINE · RECURRING · CONDITION · EVENT, claimed by CAS on `(state, fireCount)`, dispatched with a per-fire idempotency key |
| `observations` · `observationFreshness` | `schema-block2.ts`, `effect-observation-bridge.ts` | canonical readings with `subjectKind`/`subjectId`/`observationType`/`payload` and a freshness horizon → CURRENT · STALE · **UNKNOWN** |
| `events` (serial id) · `emitCanonicalEvent` | `db/schema.ts`, `block2/events.ts` | the ordered, resumable ledger, already waking EVENT triggers |
| `notification_intents` · `createNotificationIntent` · `deliverNotificationIntent` | `block2/notifications.ts` | notification as an effect, with per-channel **BLOCKED_BY_PROVIDER** and delivery gated on a Trusted Executor attempt context |
| `readCanonicalData` · `AuthorizedQuery` | `authorized-query.ts` | the authorized read with its own freshness |

**So the gap was never "there is no scheduler".** It was five precise things:

1. **`ConditionEvaluator` is an injected seam with no production
   implementation.** `api/boot.ts` builds the worker with `{ resumeNode }` and
   no evaluator, so `fireDueTemporalTriggers` reaches
   `evaluator ? … : undefined`, the verdict is never `true`, and a CONDITION
   trigger reschedules its poll **forever**. That single missing argument is
   where monitoring died.
2. **`temporal_triggers.condition` is untyped `jsonb`.** There was no condition
   language to evaluate even if something had been wired.
3. **A trigger is a DAG continuation** — `runId`, `nodeId`,
   `continuation.resumeNode`, `ownerId` and no `scopeId`. There was nowhere to
   keep what a PERSON is watching, and no lifecycle they drive.
4. **No previous-evaluation state**, so no way to tell «it is true» from «it
   just became true» — a repeating poll would notify every minute forever.
5. **The MONITORING route reported NOT_IMPLEMENTED**, so no conversation
   reached any of it.

## 2. What was built

| file | lines | what |
|---|---:|---|
| `api/runtime/monitoring-runtime.ts` | 1368 | the condition language, three-valued evaluation, edge/level, lifecycle, the two modes, the projection |
| `db/migrations-pg/0020_standing_monitors.sql` | 82 | `standing_monitors`, `monitor_evaluations` |

Extended rather than replaced: `block2/jobs.ts` (one step in the sweep that
already existed), `jasim-runtime.ts` (one envelope field and one branch),
`semantic-router.ts` (the route left `NOT_IMPLEMENTED`), `api/routers/runtime.ts`
(four procedures), `artifacts/jasim-mobile/lib/runtime-trpc.ts` (the same four,
by name), `model-output-trust.ts`, `db/schema-block2.ts`.

```
SECOND_SCHEDULERS_ADDED    = 0
SECOND_OBSERVATION_SYSTEMS = 0
SECOND_EVENT_LEDGERS       = 0
SECOND_NOTIFICATION_TRUTHS = 0
```

### The condition language

A closed, typed tree. Every leaf is an operator from a fixed set over a
**dotted lower-case field path** and a scalar:

```
equals · not_equals · greater_than · greater_or_equal · less_than
less_or_equal · contains · exists · changed · entered_state · left_state
within_range · all · any · not
```

There is no expression string to parse, so there is nothing to sandbox. A
program smuggled into a string value is caught by the same executable-text
screen the world runtime uses — one of it, borrowed rather than written twice —
and re-thrown in this module's vocabulary.

### Three-valued, and never collapsed

```
TRUE · FALSE · UNKNOWN
```

A missing fact is UNKNOWN. A numeric comparison against a string is UNKNOWN.
`changed`, `entered_state` and `left_state` are UNKNOWN until there is a
previous reading to compare against. UNKNOWN survives `all` and `any`
correctly, and negating it stays UNKNOWN.

**Freshness feeds straight into this.** A monitor whose `freshnessRequirement`
is `CURRENT` and whose reading is STALE or UNKNOWN returns UNKNOWN — not false,
because *"I cannot see"* is not *"everything is fine"*.

### Level is not edge

`lastResult` is persisted, so `transitionOf(previous, current)` distinguishes:

| | |
|---|---|
| **RISING** | it was not true and now is — what EDGE fires on, including the first reading ever |
| **REPEAT** | it was already true and still is — the storm §10 warns about |
| **FALLING** | it stopped being true |

An EDGE monitor never fires on a REPEAT. A LEVEL monitor that also REPEATS and
also NOTIFIES is **refused at creation**, and the refusal names EDGE.

### Two modes, both on machinery that already existed

**SCHEDULED** — `sweepDueMonitors()` is one more step in `runBlock2Sweep`, the
duty cycle that is itself a durable job re-enqueueing its next tick. No timer,
no `setInterval`, no worker of its own; restart recovery is inherited rather
than written again.

**EVENT-DRIVEN** — `recordObservationAndEvaluate()` records a canonical
observation and evaluates every ACTIVE monitor on that subject. It is a
separate function rather than a hook inside `recordObservation` on purpose:
that primitive is called with a transaction handle by callers who know nothing
about monitoring, and evaluating inside somebody else's transaction is how a
monitor fires for a write that later rolled back. An observation recorded
through the raw primitive is not lost — the sweep reaches it within the
monitor's own poll interval.

**WORLD_EVENT** — `advanceWorldMonitors()` consumes the ledger the world phase
built, by cursor, so a restart resumes exactly where it stopped.

### Replay, and the one exception

An evaluation is keyed by the observation's id, and the unique index on
`(monitorId, evaluationKey)` makes a redelivery one judgement under a race.

**ABSENCE is keyed by its window instead**, and has to be: what changes an
absence verdict is TIME, not a new reading, so keying it by the last
observation's id would freeze it at *"something arrived recently"* forever.

### Concurrency

Every write is `WHERE id = ? AND version = ?`. Two workers on the same monitor:
the second finds the version moved and records no second trigger. Proven with
two concurrent evaluations of one observation — one trigger, one ledger row.

### A match is not a notification

On a firing transition the monitor transitions and `createNotificationIntent`
makes a row. **It delivers nothing.** Delivery belongs to the Trusted Executor,
which requires an attempt context a monitor does not have. If the intent cannot
even be created, the trigger still stands — the evaluation row already says it
matched. The projection names the requested channels that have **no configured
provider**, and the turn's own sentence says so out loud.

## 3. What is still not true

| | |
|---|---|
| acting on a trigger | «إذا نزل تحت ٢٠٠ اشترِ» — a monitor's only actions are NOTIFY and NONE. Acting needs an authority envelope evaluated at trigger time that nothing issues: `STANDING_ACTION_AUTHORITY` |
| reading a value on a schedule | «اقرأ الحرارة كل ساعة» — the hourly evaluation is real; the reading needs a device provider |
| live updates | the ledger is ordered and resumable and nothing subscribes. Transport is the next capability |
| query monitors | the subject vocabulary has `AUTHORIZED_QUERY`, and this phase proved OBSERVATION, WORLD_EVENT and ABSENCE against a live database. A standing query over the opportunity exchange is reachable from the same row and is not claimed until it is proven |

```
GENERALITY FAILURE != PROVIDER NOT CONNECTED
FALSE_TRIGGERS = 0 · FALSE_NOTIFICATIONS = 0
```
