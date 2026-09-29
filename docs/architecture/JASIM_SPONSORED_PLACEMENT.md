# JASIM — المعلن يشتري أن يُرى، لا أن يُوصى به

```
SPONSORED != BEST
ADVERTISER_BUYS_JASIM_OPINION = 0
SPONSORED_RESULT_IS_UNLABELLED = 0
MONEY_BUYS_AN_EXEMPTION_FROM_A_BUYERS_REQUIREMENT = 0
MODEL_NOMINATES_A_SPONSORED_RESULT = 0
```

## What already existed, and what did not

The **money** side of advertising was built: `fee-rules` carries `promotion` and
`listing` kinds, versioned, owner-configured, never decided by a model. What did
not exist was any notion of a sponsored **placement** — and adding one naively is
how a marketplace stops being worth asking.

The ranking path was already built the right way round. `searchInternal` filters
the eligibility pool by the buyer's hard constraints **before** computing any
score, with its own comment:

> *«This makes it impossible for relevance to admit a hard failure.»*

Sponsorship must not be allowed to reach behind that. So it is a **label**, and
nothing else.

## Three things it cannot do

**It cannot change the order.** Merit is computed with no knowledge of who paid.
Sponsoring the candidate merit put last leaves it last; sponsoring every
candidate changes the order not at all. Both are proved.

**It cannot admit what the buyer excluded.** A sponsored offering that fails a
hard constraint does not appear — not first, not last, not labelled. **Absent.**
The promotion set is drawn from the pool that already passed, so it cannot reach
a candidate those constraints removed.

**It cannot hide.** A sponsored candidate is labelled *even when it earned its
place on merit*. Hiding the label on the ones that also rank well is the oldest
way of laundering an advertisement.

## What it legitimately buys

**Exposure.** An eligible candidate that merit alone would have left outside the
display limit may be shown, in its own place **after** the merit list, marked.

*Being seen is a real thing to sell. Being recommended is not.*

One consequence had to be followed through: the display cut belongs to `discover`,
not to the SQL query. The query used to truncate first, which made the candidate
just outside the cut — exactly the one a sponsor pays for — unreachable. The
wider fetch is asked for **only when somebody actually paid**, so an ordinary
search costs no more than it did.

## Who says who paid

`sponsoredRefs` is runtime-supplied: a settled commercial fact about who bought
placement, never a payload a caller sends and never a model's suggestion. It is
read *after* eligibility and never by the ordering — asserted in the proofs by
source, not by convention.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/sponsored-placement.test.ts` | paying does not change the order by a single position — proved without assuming which candidate merit prefers, by sponsoring whichever it put last and then sponsoring all of them; a sponsored candidate is labelled even when it earned its place, and with nobody paying nothing is labelled; a sponsored offering failing the buyer's requirement does not appear at all; an eligible candidate merit left out may be shown behind an untouched, unlabelled merit list; sponsoring something already in the list adds no second copy and sponsoring something ineligible adds nothing; positions stay dense and unique so «الثاني» never drifts; the ordering query never mentions sponsorship, eligibility is computed before it is read, and the module consults no model and names no domain |
