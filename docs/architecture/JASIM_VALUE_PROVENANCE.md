# JASIM — تخمين عن شيء يملكه غيرك لا يحسم بيعاً

```
INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0
INFERRED_VALUE_ADMITS_A_CANDIDATE = 0
INFERRED_VALUE_CONTRIBUTES_TO_A_CAPACITY_PROMISE = 0
MODEL_GUESS != OWNER_CLAIM · OWNER_CLAIM != VERIFIED_FACT
UNRECOGNIZED_PROVENANCE_READ_AS_STATED = 0
```

## What the trace found — an asymmetry running the wrong way

The **need** side has had this law for a long time and enforces it. `goal-spec`
records `STATED | INFERRED` per constraint, and an INFERRED constraint is
downgraded from `HARD` to `SOFT`, recorded and shown:

> *«an inference may guide, it may not exclude»*

The **offer** side had none of it. `economic_expressions.attributes` is a flat
bag of values with no source, and matching reads it as fact:

```ts
evaluateConstraint(constraint, offering.attributes)
```

So:

| side | an inference could… |
| --- | --- |
| buyer's constraint | …not exclude anything. Downgraded. |
| **seller's value** | **…decide a match outright.** |

Concretely: JASIM reads six photos and infers a colour. A buyer states *«لا أريد
الأبيض»* as a wall. The match is then decided — included **or** excluded — by a
model's guess about somebody else's car, invisibly, and both directions cost
somebody real money.

And it gets worse with every intake channel, which is the whole point. An offer
may arrive as text, voice, images, video, a spreadsheet, a catalogue, or through
an inventory binding. An ERP reading is **OBSERVED** and strong. A photo guess is
**INFERRED** and weak. The owner typing it is **STATED**. All three landed in the
same untyped bag and were read with equal confidence.

## Three sources, and why not four

```
STATED    — the owner said it
INFERRED  — something derived it: a model reading a photo, a video, a sentence
OBSERVED  — a connected system reported it
```

**VERIFIED is deliberately absent, and this is a correction worth stating.** It is
a *verdict* `evidence-sufficiency` reaches about evidence — never a label a
writer gives itself. A self-assignable «verified» would be exactly the
vulnerability this system exists to prevent, and adding it as a fourth source
would have created one.

**A field with no entry is NOT inferred.** Every existing writer is the owner's
own composition or trusted configuration, and this does not retroactively weaken
them. What is new is that a channel which *knows* a value was inferred can say
so — and saying so has consequences.

## What an inferred value does instead

`UNKNOWN` — which already exists in `ConstraintState` and already means exactly
this: *nothing is known*, never `FAIL`. The reason travels with it, so a person
can be told why.

A buyer who cares then **asks**, and the brokering path carries the question to
the owner, whose answer is theirs and carries their name. The two phases fit:

```
صورة  →  تخمين  →  لا يحسم شيئاً
سؤال  →  جواب المالك  →  بيّنة باسمه
```

The same law is applied twice, because there are two places a value decides:
`evaluateConstraint`, and the composite-capacity path that sums offerings into a
promise somebody will be held to. A guessed capacity has no business in that sum.

## The owner sees what was guessed, before confirming

Provenance is inside the draft's **fingerprint**. Changing only a value's source
— «this came from your photo» → «I am stating it» — moves the fingerprint and
voids an earlier confirmation. Which values were guessed is part of the
statement, not a footnote discovered afterwards.

An entry for a field nobody stated, or an unrecognized word, is dropped rather
than read charitably: a typo may not become a stronger or weaker claim than the
caller meant.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/offer-value-provenance.test.ts` | a stated value decides in both directions and an observed one decides too; a value with no recorded source keeps deciding as it always did; an inferred value neither excludes nor admits — `UNKNOWN`, not viable, never `FAIL`, with the reason attached — proved in **both** directions, including the half that costs the seller; only the inferred field is silenced while stated fields still exclude, so a guess is not a shield; two stated halves compose into a capacity promise and a guessed half composes into nothing; the need side downgrades an inferred wall to a preference while the offer side refuses to let an inferred value answer one, in the same test; the owner sees which values were guessed, a provenance-only change voids an earlier confirmation, and after correcting it to stated the value decides; an entry for an unstated field and an invented word are both dropped, and `VERIFIED` is not among the sources; the law names no domain |
