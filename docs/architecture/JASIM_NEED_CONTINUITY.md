# JASIM — THE RUNTIME REMEMBERS WHAT YOU WANT

> `NEED_CONTINUITY != CHAT_HISTORY_AS_TRUTH` · `!= MODEL_MEMORY`
> `NEED_CONTINUITY != LIVING_OBJECT` · `!= TRANSACTION` · `!= USER_PROFILE_MEMORY`
> `MODEL != NEED_AUTHORITY` · `TOPIC_SWITCH != NEED_RESOLVED`

## What the trace found

No conversation-level goal existed. `message.metadata.goal` was **write-only
evidence** — recorded on every turn and read back by nothing. A `GoalSpec` was
validated inside one turn and then discarded, so the only thing carrying
continuity was the model restating everything it could remember.

`economicExpressions(kind = "need")` was rejected as the home for this: it is a
**market** primitive, and «أنا جائع» must not put anybody on a marketplace.

## The smallest new abstraction

One table, `conversation_needs`. Its columns **are the GoalSpec's fields**,
because a conversational need is a goal that outlived its turn — not a second
vocabulary for the same thing. Every merge is re-validated by the existing
`evaluateGoalSpec`, so the honesty rules that governed a goal inside one turn
keep governing it across many.

No column names a kind of thing.

```
DOMAIN_NEED_TYPES_ADDED = 0 · DOMAIN_NEED_HANDLERS_ADDED = 0
```

## The central law: the model sends a delta

`NeedPatchSchema` has **no field that can restate the prior goal**. There is no
`constraints` list that replaces wholesale, and `outcome` is read only when
creating a new need. A patch that could restate everything would be a patch
that could silently erase everything.

```
MODEL_MUST_RESTATE_FULL_PRIOR_GOAL = NO
RUNTIME_OWNS_NEED_MERGE = PASS
```

The acceptance test's decisive property: after turn 1, **not one model stub
mentions the outcome or any earlier constraint**. The journey still works.

## The merge rules

**One constraint per dimension.** A new bound *replaces* the old one, which is
what makes «أقل من ٥» followed by «لا، خلها ٧» a correction rather than a
contradiction nobody can satisfy.

**A stated bound always beats an inferred one.** The reverse is refused
outright: an inference may not overwrite something somebody actually said. And
`evaluateGoalSpec` still downgrades an inferred HARD bound to SOFT on every
revision, so provenance survives every refinement.

```
PROVENANCE_SURVIVES_REFINEMENT = PASS · INFERRED_AS_USER_STATED = 0
```

## Lifecycle — four words, no workflow

`ACTIVE` · `BACKGROUND` · `RESOLVED` · `ABANDONED`.

Turning to something else makes the previous need **BACKGROUND** — still live,
still resumable. Only an outcome actually reached is RESOLVED, and **nothing
sets that automatically**: no path exists from a model patch to RESOLVED, and
nothing in this repository yet carries provenance from a need to the exchange
that came out of it. Resolving one from a completed transaction would be a
guess about which need a payment satisfied.

```
FALSE_NEED_SATISFACTION = 0
```

## Ambiguity is asked, never guessed

Coming back with more than one thing set aside asks which. Refining with more
than one live need and no current one asks which.

```
AMBIGUOUS_NEED_GUESS = 0 · LATEST_NEED_ALWAYS_WINS = NO · FIRST_NEED_ALWAYS_WINS = NO
```

## Concurrency: rebase, not last-write-wins

Every write is a compare-and-set on `revision`. A contended write **re-applies
its delta** to whatever the other writer left behind. That is a genuine safe
merge precisely because a patch is a delta — re-applying loses nothing, which a
last write of a whole reconstructed goal could never claim. Proven: two
simultaneous refinements both survive.

```
LOST_NEED_UPDATE = 0 · STALE_NEED_WRITE_SILENTLY_ACCEPTED = 0
```

## Discovery consumes it

A search turn that carries no constraints uses what JASIM already holds.
Silence now means "use canonical state", not "there are no constraints". What
the model does supply on the turn still wins.

The reference system is untouched and still answers a different question:

| primitive | answers |
| --- | --- |
| Need | **why** are we searching |
| ResultSet | **what** was presented |
| Reference binding | **which** presented item is «الثانية» |

## What a need is not

Wanting something creates **no living object**, publishes **nothing** to the
market, and writes **nothing** to the user's profile. All three are asserted.

```
NEED_CREATED_LIVING_OBJECT = 0 · CONVERSATIONAL_NEED_AUTO_PUBLISHED = 0
TEMPORARY_CONSTRAINT_AUTO_SAVED_TO_PROFILE = 0
```

## Where the proof is

`tests/block31/need-continuity.test.ts` — 18 live tests, real PostgreSQL, every
turn through `routeRuntimeConversationTurn`, with delta-only model stubs. Six
unrelated wants take the identical path, one of them a kind that appears
nowhere else in the repository.
