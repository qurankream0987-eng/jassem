# JASIM — يوصِل السؤال، ولا يجيب عن أحد

```
ANSWER_AUTHORITY_IS_THE_SUBJECT_OWNER
SELLER_ANSWER_IS_EVIDENCE_NOT_ATTRIBUTE
MODEL_ANSWERS_ON_BEHALF_OF_A_PARTY = 0
UNANSWERED != FALSE · DECLINED != UNAVAILABLE
QUESTION_LEAKS_ASKER_IDENTITY = 0
ENGAGEMENT_IS_THE_CONTACT_AUTHORITY
```

## What the trace found

A buyer asks about something an offering never declared — the mileage, the
delivery window, whether the size is really in stock. **There was nowhere for
that question to go.**

`economic-fabric` guards ownership strictly and correctly: a non-owner sees the
public projection and nothing else, and every cross-owner read is refused with
one sentence so that a refusal is never an existence oracle. That guard is right.
It just left a gap with only two ways to fill it, and both were wrong:

| the wrong ways | why |
| --- | --- |
| the model answers | invention — a number with no author |
| write it into the offering's `attributes` | a claim the seller never made, indistinguishable from what they declared at publication |

The third way is the one a human broker uses: **carry the question to the person
who knows, and bring their answer back with their name on it.**

## Why it needs an engagement

A question is contact, and contact needs consent.

The only authorized cross-owner relationship in this repository is the
**engagement**: match-backed, with participants DERIVED from the authorized match
rather than nominated by a caller. `createEngagement` already refuses to invent
one, saying an unmatched engagement *«would require an invitation/consent flow
that does not exist yet»*. That is still true, and this phase did not build one.

```
SECOND_CROSS_OWNER_CONSENT_PATH = 0
```

So `requireEngagementParticipant` — previously private — is exported and becomes
**the one gate** for «may these two parties be in contact at all». Anything else
built between two owners asks that question rather than growing its own answer.

This is a real constraint and it is stated rather than hidden: **a buyer must
reach an engagement before asking.** Browsing a public listing does not entitle
anyone to a seller's attention.

## What an answer is

`SELF_REPORTED` evidence — *«the acting party asserts it. Uncorroborated.»*

That is the honest classification, and it is also the **strongest evidence that
exists** for how many kilometres a car has driven: nobody issues a receipt for
that. It is still not a fact JASIM asserts. The distinction is not pedantry:

> **«the seller says 120,000 km»** ≠ **«the car has driven 120,000 km»**

Only one of those is true, and a marketplace that cannot tell them apart is one
where every listing eventually becomes a rumour with a price on it.

So an answer is **never** written into `economic_expressions.attributes`. The
offering's version does not change, its public projection does not change, and
nothing downstream can read the answer as something declared at publication.

```
BUYER_QUESTION_MUTATES_SELLER_OFFERING = 0
ANSWER_BECOMES_DECLARED_ATTRIBUTE = 0
```

## What travels, and what does not

| the answering party sees | the answering party does NOT see |
| --- | --- |
| their own expression | who asked |
| which property was asked about | what that party needs |
| which version it was asked about | what they were willing to pay |
| when it was asked | anything else at all |

The view is a fixed five-key shape, asserted key-by-key in the proofs. A question
that carried the asker's identity would let a seller price the answer to the
person, which is the same failure as a listing that changes price when it
recognises you.

## Three things that are not answers

- **Unanswered.** Nothing is known. Not zero, not unavailable, not «no». The
  answer field is absent rather than defaulted, so no caller can read a value
  out of silence.
- **Declined.** The owner chose not to say. That is a fact about the owner, not
  about the thing — `DECLINED != UNAVAILABLE`.
- **Empty.** An answer with no value is refused outright, so it cannot
  masquerade as a decline or as a value nobody typed.

## An answer describes a version

`subjectRevision` is pinned when the question is **asked**. If the owner revises
the expression afterwards, the answer stays attached to what it actually
described, and `currentAnswersFor` reports it `stale` beside the current
revision — the same shape `evidence-sufficiency` already calls
`SUBJECT_REVISED_SINCE`.

```
ANSWER_SURVIVES_SUBJECT_REVISION = 0
```

The same question may then be asked again about the new version, and it is a new
question. Within one version, asking twice returns the first question rather than
creating a second: a repeated question is not a way to press the other party.

```
REPEATED_QUESTION_CREATES_SECOND_OBLIGATION = 0
```

Enforced by a unique index on `(engagementId, subjectExpressionId, subjectRevision, property)`,
so four concurrent asks leave one row — the database decides, not a read.

## What was added

One table, one module, one export. No new consent path, no new vault, no model
call anywhere in the file, and no domain word: `cross-party-brokering.ts` does not
contain «car», «price», «seller» or «buyer», and the proofs assert that.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/cross-party-brokering.test.ts` | the whole journey — buyer asks, it reaches the seller carrying nothing about the buyer, the seller answers, the answer comes back as `SELF_REPORTED` evidence, and the offering's attributes, version and projection are unchanged; only the subject's owner may answer (asker and stranger both refused with one indistinguishable refusal); without an engagement there is no question and a stranger can neither ask through one nor create one; a party may not ask about its own thing nor a third party's; declining carries no value and says nothing about the thing; an empty answer is refused; an answered question is settled and leaves the inbox; repeating a question returns the first and four concurrent asks leave one row; an answer stays pinned to the version it described, reads `stale` after a revision, and the question may be asked afresh about the new one; each party reads only its own thread and only its own inbox; the module names no domain, consults no model, and invents no consent |
