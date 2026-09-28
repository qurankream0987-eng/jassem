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

## الإخفاء لا يُخفي ما ينتظرك أنت

```
HIDE != CANCEL · SURFACE_EXIT != SUBJECT_DELETE     (مُغلق سابقاً)
HIDING_WHAT_WAITS_ON_YOU = 0
RELEASE_ABANDONS_AN_OBLIGATION = 0
SURFACE_STATE_SUPPRESSES_A_NEW_DEMAND_ON_YOU = 0
```

`setLivingObjectState` already carried the first law correctly: it writes two
columns, touches no subject, and has no `cancel` in it on purpose. Hiding a
delivery does not stop it. That stays exactly as it was.

The gap was next to it. `projectLivingObjects` filters out `HIDDEN` and
non-`FOLLOWING` handles by default, so hiding one **removes it from the surface**
— and a follower could hide a subject that had *stopped and was waiting for
them*. A payment awaiting their approval would vanish from the only place saying
the system is stuck on them. Releasing one was worse: reconciliation walks only
`FOLLOWING` handles, so it could never come back.

Meanwhile `decidePresentation` already refuses to let a richer surface hide a
blocker or an approval requirement. The principle was held in one place and
contradicted in another.

### What counts as waiting on you

A closed, structural set — not «important» and not «recent», which are
judgements:

| status | meaning |
| --- | --- |
| `WAITING_APPROVAL` | an approval nobody else can give |
| `WAITING_USER` | an input only they hold |
| `BLOCKED` | a blocker only they can clear |

**Everything else may be hidden freely, and that is the point.** A `RUNNING`
delivery is exactly what *«شيل الخريطة»* is about, and it goes on running unseen.
`MONITORING`, `ACTIVE`, `VERIFYING` and every terminal state hide without
argument.

It is not a trap either: acting on the subject moves it out of those statuses,
and hiding then works. **Deal with it, or leave it visible.** And `RESOLVED` —
«I have dealt with this» — is never refused, nor is bringing something back.

### Timing is not a way around it

Refusing to hide what waits on you would be trivially defeated by hiding it a
moment *before* it starts waiting. So reconciliation returns a hidden handle to
the surface when its subject has since stopped and turned to this person.

Narrowly: only for handles still being **followed**, and only for a demand —
a subject that merely moves from `RUNNING` to `VERIFYING` stays hidden, because
otherwise hiding would mean nothing. A `RELEASED` handle is a deliberate *«I am
not following this»* and is not resurrected; the subject's own runtime still
asks for what it needs through its own door.

One residual case is recorded rather than papered over: a handle released while
`RUNNING` whose subject *later* comes to need the person is not re-surfaced
through this rail. Widening the sweep to released handles would overrule what
releasing means, and the demand still reaches the person through the subject's
own runtime.

### And an unreadable subject proves nothing

`UNKNOWN != WAITING`. A subject that cannot be read is not evidence that
something waits on anybody, so hiding is allowed — a refusal built on nothing
would be a lock with no key.

| `tests/block31/surface-dismissal-authority.test.ts` | anything that carries on unseen (`RUNNING`, `ACTIVE`, `MONITORING`, `VERIFYING`) may be hidden, stays followed, leaves the subject untouched and is still there when asked for; what has stopped and waits on the follower (`WAITING_APPROVAL`, `WAITING_USER`, `BLOCKED`) can be neither hidden nor released, and stays visible and following after each attempt; it is not a trap — dealing with the subject makes hiding work; resolving and re-showing are never refused; hiding it first does not spare you, because a new demand returns to the surface on reconciliation without the subject being touched; a subject that merely moves on stays hidden; a finished and verified subject resolves and does not come back; the surface still has no way to cancel or delete a subject and the «waiting on you» vocabulary names no domain; an unreadable subject is not evidence that anything waits on anybody |
