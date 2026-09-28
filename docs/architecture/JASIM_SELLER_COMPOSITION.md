# JASIM — ما قاله البائع، لا ما فهمه النموذج

```
MODEL_EXTRACTION != SELLER_DECLARATION
IMAGE_INTERPRETATION != SELLER_DECLARATION
DRAFT != PUBLISHED
PUBLISH_CONFIRMS_EXACT_CONTENT
STALE_CONFIRMATION_PUBLISHES = 0
MISSING_DETAIL_INVENTED_FROM_A_DOMAIN_TEMPLATE = 0
```

## What the trace found

`publishTurn` took `envelope.intent.inputs` — **a model's reading of a
sentence** — and wrote it straight into a PUBLIC offering attributed to the
seller, in one step. It refused only when a subject or a price was missing.

So a seller who said *«انشر عرضي»* published whatever the model decided the
offering says. Every other place in this repository already refuses that shape:

```
LLM != Authority
```

and this is where it costs most, because **a public listing binds its owner**. A
colour the model inferred from a photo, a year it read out of a filename, a
condition it summarised generously — the seller answers for all of it, to a
buyer, and later to whoever adjudicates the sale.

Note what was *not* wrong: `publishTurn` already required an explicit publish
request, and already refused with `missingInputs` rather than inventing a price.
The gap is narrower and sharper:

> **Confirming «publish» is not confirming WHAT.**

## A draft is a thing, and confirming is an act

A seller composes across as many turns as they like. Nothing is public. What
comes back is the exact text that would be published and a **fingerprint** of the
whole statement — kind, stated values, attachments, public words, version.

Publishing quotes that fingerprint back. If anything moved between seeing and
confirming — one more sentence, one amended value — the fingerprint moved and the
confirmation is refused, rather than applied to words nobody read.

Every amendment bumps the version, and the version is inside the fingerprint, so
a stale confirmation is void **by construction** rather than by comparison.

## Photos are not statements

Attachments are carried as **references** and never interpreted. This module calls
no model, and the proofs assert it: no `ModelGateway`, no `generate`, no `infer`.

> A picture of a white car is evidence that there is a picture.
> The **seller** is the one who says the car is white.

## What this deliberately does not decide

**What a kind of thing ought to state.** There is no schema registry here and none
was invented — `schemaRef` exists on the row and is still unread. Building one
would mean a template per domain, which is the failure this whole system exists
to avoid.

A missing detail surfaces the honest way instead: **a buyer asks**, through the
brokering the previous phase closed, and the seller answers in their own words as
`SELF_REPORTED` evidence. The two phases fit together exactly:

```
البائع يقول ما يقوله   →   منشور يلزمه هو
الزبون يسأل عمّا نقص   →   جواب البائع، باسمه، كبيّنة
لا شيء بينهما يُختلَق
```

## One road to public

`publishComposedOffering` calls the existing owner-gated `publishExpression` with
its authorized-keys check. No second path to public was added, and the proofs
assert the module never writes `visibility: "public"` itself.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/seller-composition.test.ts` | composing across turns stays private and publishing quotes exactly what was read; a confirmation of what it used to say publishes nothing, and reading again then confirming works; a fingerprint from another draft, an invented one and an empty one all publish nothing; a published offering cannot be quietly amended nor published twice and is byte-identical after both attempts; an empty statement and an offering with no kind are refused; nobody reads, amends or publishes somebody else's draft (one indistinguishable refusal); photos are carried, are not among the stated values, and no colour nobody stated appears; what the seller did not state stays unstated — no mileage is invented because cars usually have one — until a buyer asks through an engagement and the seller answers as `SELF_REPORTED`, which still does not become what the listing declares; the module consults no model and names no domain |
