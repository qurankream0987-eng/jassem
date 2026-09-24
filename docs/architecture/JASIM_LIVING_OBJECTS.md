# JASIM — LIVING OBJECTS

> A durable, authorized **handle** on something that keeps going.
>
> `LIVING_OBJECT != CANONICAL_SUBJECT`
> `LIVING_OBJECT != WORLD · != RUN · != MONITOR_EXECUTION`
> `DUPLICATE_OPERATIONAL_TRUTH = 0`
> `SURFACE_EXIT != LIVING_OBJECT_DELETE`
> `HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED`
> `EVERY_TURN_BECOMES_LIVING_OBJECT = NO`

## What was already there

JASIM had a living-objects **rail**: `api/runtime/living-object-projection.ts`,
a read-only derivation recomputed on every query over four of JASIM's own
execution artifacts — `runtime_task`, `runtime_run`, `generated_system`,
`smart_bubble`. It grouped them, ranked them by attention and handed a surface
something to draw.

That rail is preserved exactly as it was, including its `activeLivingObjects`
procedure. It answers a different question, and it still answers it.

## What was missing, precisely

The one name `LIVING_OBJECT_RUNTIME` was covering **four** things:

1. **Subject breadth.** `LivingObjectReference.kind` was closed over execution
   artifacts. An agreement, a commitment, a transaction, a held reservation, an
   engagement, a negotiation and a standing monitor — the things people
   actually follow — could not be one. «أين وصل طلبي؟» is a question about an
   obligation, and the rail could only point at a run.
2. **A durable handle.** Nothing recorded *that* a scope follows a subject, so
   hiding, resolving and releasing had nowhere to live, and
   `SURFACE_EXIT != LIVING_OBJECT_DELETE` was not expressible.
3. **Acting scope.** The rail was `ownerId`-scoped while world, monitoring and
   realtime all resolve an acting scope. An organization's tracked things were
   not separable from a person's.
4. **Reconciliation.** A follower had no cursor, so nothing could say what had
   changed since they last looked.

## The shape

`api/runtime/living-object-runtime.ts` and one table, `living_objects`.

```
living_objects
  scopeId · subjectKind · subjectId       -- WHO follows WHAT (unique together)
  followState   FOLLOWING|RESOLVED|RELEASED
  surfaceState  VISIBLE|HIDDEN
  reason        why it exists, closed vocabulary
  originConversationId · materializedBy
  lastSeenRevision · lastSeenAt           -- the FOLLOWER's cursor
```

There is **no status, title, progress or payload column**, and there must never
be one. Everything a follower is shown is read from the canonical row at
projection time, so a handle can never drift from, contradict or outlive the
truth of the thing it points at. The migration is asserted against this in
`tests/unit/living-object-contract.test.ts`.

### Eleven subject kinds, zero domain types

```
run · task · world · bubble · agreement · commitment
transaction · reservation · engagement · negotiation · monitor
```

Every one is a JASIM primitive. There is no `order`, no `delivery`, no
`booking`, no `application`, no `driver` and no `price watch`, because those are
not kinds of thing — they are terms inside an obligation, a held claim or a
standing condition.

```
DOMAIN_LIVING_OBJECT_TYPES_ADDED = 0
```

Each kind has exactly one **reader** that reads its own canonical table and
nothing else. The readers are the only door to subject truth in the module, and
there is no cache, mirror or copy behind them — which is what makes
`DUPLICATE_OPERATIONAL_TRUTH = 0` true rather than merely intended.

### The materialization policy is structural

```ts
materializationDecision({ subjectKind, subjectId, sideEffect, durability }, snapshot)
```

Both deciding inputs are **shapes**, not topics. Nothing in the policy can be
read as «this was about food» or «this was about a car», because nothing in it
carries a noun.

| what the turn left behind | outcome |
| --- | --- |
| nothing changed, nothing outlives the turn | `READ_ONLY_TURN` |
| something changed, nothing outlives the turn | `EPHEMERAL_RESULT` |
| the subject is not there, or not visible to this scope | `NO_DURABLE_SUBJECT` |
| the subject already finished | `SUBJECT_ALREADY_TERMINAL` |
| something keeps running, owing, watching or existing | a handle |

A discovery turn — search, comparison, selection — reaches this with
`sideEffect: NONE, durability: EPHEMERAL` and gets nothing. That is the whole of
why `EVERY_TURN_BECOMES_LIVING_OBJECT = NO`, and it needs no list of verbs.

### Authorization is re-asked, never remembered

The **subject** answers who may see it, not the handle. A handle grants no
visibility; it only records that somebody already allowed to look is following.
Because `subjectVisibleTo` is re-evaluated on every read, a membership revoked a
second ago closes the projection now.

A guessed id and a forbidden one produce the **same refusal**, and a handle in
another scope is `NOT_FOUND` rather than `FORBIDDEN` — a refusal that
distinguished them would turn guessing into an existence oracle.

When a subject can no longer be read — deleted, or the standing that made it
visible revoked — the handle **stays** and says `unreadable`, with status
`UNKNOWN` and an empty title.

```
UNKNOWN != FALSE · UNKNOWN != ABSENT
```

### Nothing here can act on a subject

The module never calls `.delete(` on anything, its own rows included, and the
only table it ever `.update(`s is `living_objects`. Both are asserted from the
source. There is no `cancel` on the tRPC surface, and that is not an omission:
cancelling a subject belongs to the subject's own runtime, and no surface
gesture may reach it through this door.

## What it reuses, and what it adds

| concern | what it uses |
| --- | --- |
| scheduling | the existing Block 2 sweep (`runBlock2Sweep`) |
| event ledger | the canonical `events` table |
| transport | the existing realtime runtime, as entity kind `living_object` |
| cursor | realtime's existing ledger cursor |
| acting scope | `resolveActingScope` |

```
SECOND_SCHEDULERS_ADDED = 0
SECOND_EVENT_LEDGERS_ADDED = 0
SECOND_CURSOR_MODELS_ADDED = 0
DOMAIN_REALTIME_CHANNELS_ADDED = 0
```

Reconciliation runs **before** realtime delivery inside the same duty cycle, so
a handle whose subject moved reaches its follower in that cycle rather than the
next one. Nothing is pushed into a handle: each one asks its subject.

An event carries **ids and a closed vocabulary only** —
`livingObjectId · subjectKind · followState · surfaceState`. No title, no
status text, no terms, no payload passthrough. An event says that something
changed and never what it now says.

## The conversation boundary

`PERSISTENT_LIVING_OBJECT` was already a routable destination with nothing
behind it. It now reaches the runtime, with four intents: `LIST`, `READ`,
`HIDE`, `RESOLVE`.

The model may say the person is asking about what they follow, and may name a
handle the conversation already carries. It may **not** say that something
exists, whose it is, or what state it is in — the envelope schema has no
`subjectKind`, no `subjectId`, no `scopeId` and no `status`, and is `.strict()`.

```
LLM != AUTHORITY · MODEL_INVENTED_SUBJECTS = 0
```

With nothing followed, the answer is that nothing is followed, and it says what
would make a handle exist. No order is conjured to fill the silence.

Hiding says plainly, in the sentence the person reads, that nothing was
cancelled and nothing was deleted.

## What this did not close

`realtime.delivery_tracker` — «أرني السائق على الخريطة» — is still held by
`LOCATION_OBSERVATION`. The delivery is followable like anything else; where the
driver *is* is not, and a map must never invent one. Its `OBSERVABLE` and
`VERIFIABLE` gates remain `BLOCKED_BY_PROVIDER`.

## Where the proof is

- `tests/block31/living-object-runtime.test.ts` — 35 live tests against real
  PostgreSQL with the real migrations, including the real conversation
  boundary, seven subject kinds read from their own canonical tables, the
  authorization negatives and the sweep.
- `tests/unit/living-object-contract.test.ts` — 24 contract tests: the closed
  vocabularies, the structural policy, and the source-level guarantees.
