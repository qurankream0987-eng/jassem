# JASIM — THE HOLDOUT: TEN IDEAS NOBODY BUILT ANYTHING FOR

## THE RESULT

> **Ten unseen ideas carried end to end. Production files changed: 0.**

Not one branch, one handler, one noun or one core line was needed. The only
file this phase added is the probe itself.

---

## THE TEN

None was used while building any primitive in this runtime.

| Idea | The measure that had to be reconciled |
|---|---|
| six hours on a **radio telescope** | dish ≥ 25 **m** vs offered 32000 **mm** |
| a twelfth-century **Syriac manuscript** | turnaround ≤ 30 **day** vs 3 **week** |
| moving forty **beehives** during bloom | capacity ≥ 40 **count** |
| custody of a **racing pigeon loft** | window ≤ 21 **day** vs 2 **week** |
| a licensed **blaster** for a rock outcrop | charge ≥ 120 **kg** vs 250000 **g** |
| testing sand for **silica** | sample ≥ 5 **kg** vs 12000 **g** |
| an eighty-tonne **mobile crane** | lift ≥ 80 **tonne** vs 120000 **kg** |
| casting a **bronze bell** | cast ≥ 300 **kg** vs 500 **kg** |
| a **dark-sky site** | brightness ≥ 21 |
| inspecting a **diving bell** | depth ≥ 300 **m** vs 45000 **cm** |

Eight of the ten state their requirement in a different scale from the one the
offering holds it in. A runtime comparing bare numbers would have matched almost
none of them — and would have matched some of the wrong ones.

---

## THE NINE STEPS, EACH AN ORDINARY SENTENCE

For every row, unchanged:

1. state something true of me → 2. confirm it (INFERRED → STATED)
3. state where I am → 4. confirm it
5. search with **two** bounds — the measure and a proximity
6. take the first → 7. request it
8. ask the other party the one thing only they can answer; read the answer
9. they accept inside bounds they set in advance; release the private fact they
   now need; confirm the release

And for every row the probe also asserts what must **not** happen:

- the same capability **too far away** is not found
- something **near enough but on the wrong side of the bound** is not found —
  whichever side that is
- the counterparty's answer is **evidence, never an attribute** of the thing
- the agreement says plainly that nothing is **paid** and nothing is **fulfilled**
- the release is **shown before it is performed**, goes to **one** person, and
  **publishes nothing**

---

## WHAT THE FIRST RUN CAUGHT — IN THE PROBE, NOT IN JASIM

Six of ten passed immediately. The four that did not were **my errors**, and in
every case JASIM had refused correctly:

- three rows asked for a *window* («no longer than 30 days») but the prover
  hard-coded `gte`. The direction of a requirement is part of the requirement,
  so it became a column. JASIM had correctly found nothing.
- one row asked to release a field the person had never stated. JASIM refused —
  `DISCLOSING_WHAT_IS_NOT_THERE = 0` — which is exactly right.
- one row's «able» offering was on the wrong side of its own bound.

A probe whose failures are all its own is the outcome this file exists to
produce.

---

## THE ASSERTION THE WHOLE CLAIM RESTS ON

> **DOMAIN_BRANCHES_IN_THE_PROVER = 0**

One prover, ten rows of data. A test reads the prover's own source and fails if
it ever asks *which* idea it is holding — no `switch`, no `semanticType ===`,
and none of the ten nouns anywhere in its body.

A second test reads the seven core runtime files and fails if any of them has
learned any of these words.

---

## WHAT THIS DELIBERATELY DOES NOT CLAIM

Every step is offline: no provider is connected and no model is called. This
proves that the **shape** of each request is expressible and that the chain
carries it — not that a telescope was actually booked. What a provider adds is
the observation at the end, never a branch in the middle.

`tests/block31/unseen-ideas-holdout.test.ts` — 13 tests.
