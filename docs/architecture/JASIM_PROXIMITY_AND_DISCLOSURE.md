# JASIM — FIND WHO IS NEAR, WITHOUT SAYING WHERE YOU ARE

> «سيارتي تعطلت. ابحث عن مكانيكي، أخبره بمشكلتي، وأخبرني بالاتفاق وكم يحتاج من
> الوقت — وإن وافقتُ أرسل له موقعي.»

The chain ran to its end and stopped twice. Both stops were general, and
neither needed a provider to expose.

---

## GAP 1 — «قريب» NEVER REACHED THE SEARCH

Proximity lived on the **matching** side alone. `withDerivedDistance` computed a
great-circle distance between a need and an offering; `discover` had no idea
where anybody was. Discovery is where the candidate list comes from, so the
filter that mattered was the one that did not exist.

**What changed**

- `withDistanceFrom({ origin, attributes, provenance })` — one derivation, now
  with two callers: matching passes two expressions, discovery passes a point.
- `discover({ …, origin })` — the searcher's own point, carried for one query,
  written nowhere.
- A `LOCATION` bound stated in a **length** translates to the derived
  `distance` field, not to `location`. Naming the field `location` would have
  compared `25` against a `{lat,lng}`, which is not a comparison.

> **PROXIMITY_IS_A_NEW_CONSTRAINT_KIND = 0** — «within 25 km» is a bound on a
> quantity, judged by the same evaluator, through the same unit table.

**What it refuses**

| Law | Behaviour |
|---|---|
| `MISSING_POINT_IS_UNKNOWN_NOT_FAR` | a workshop that never said where it is yields **no** distance, never a large one. Remove the bound and it is an ordinary candidate again. |
| `INFERRED_LOCATION_DECIDES_PROXIMITY = 0` | a point a model read off a photo makes the distance INFERRED, and an inferred value decides nothing — **including when it would have passed**. |
| `SEARCHING_NEAR_SOMEBODY_DISCLOSES_NOTHING = 0` | neither side's coordinates appear anywhere in the result. |

---

## GAP 2 — NOTHING COULD TELL THE MECHANIC WHERE TO COME

A precise point never enters a public projection, and that is correct:

> **EXACT_COORDINATES_IN_A_PUBLIC_PROJECTION = 0**

But traced before this phase, **no module in the runtime released a private
field to a counterparty, under any authority, ever**. Found, asked, proposed,
agreed — and then nothing.

### What authorizes a release

> **AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY**

Not an engagement. An engagement is a **channel** — two parties able to speak —
and being able to speak to somebody has never been permission to learn where
they are. An accepted agreement is what makes a release proportionate: somebody
agreed to come, so they may be told where to.

| Law | What it forbids |
|---|---|
| `MODEL_DISCLOSES = 0` | anyone but the owner releasing it — the counterparty included |
| `DISCLOSED != PUBLISHED` | one named recipient; the public projection is untouched |
| `DISCLOSING_WHAT_IS_NOT_THERE = 0` | a row recording a fact that never existed |
| `DISCLOSURE_IS_PERMISSION_TO_LOOK, NOT A COPY` | a stale snapshot that outlives a withdrawal |
| `AGREEMENT_ENDS != DISCLOSURE_UNHAPPENS` | pretending a recipient forgot |

The value is read from the subject **at read time**. A car that has been towed
reports where it is now — and a withdrawal really stops the reading, instead of
leaving a copy behind.

Withdrawal sets `withdrawnAt`. The row stays and keeps saying they were told; a
recipient cannot erase the record that they learned something. «من يعرف أين
أنا؟» is answerable, and only to the person asking about themselves — a ledger
anybody could read would be a second disclosure.

---

## WHAT THIS IS NOT

There is no `MechanicAgent`, no `RoadsideRuntime`, no `LocationSharing` and no
`DriverDispatch`. The field released is a **string**; the subject is any
subject. The proving suite runs the identical chain — found because near, told
because agreed — for a seabed survey line, artifact conservation, on-site
interpreting, machine hire and wedding coverage, releasing a site access note,
a humidity window, a meeting point, a yard code and a venue contact.

> **NEW EXAMPLE != NEW FEATURE FAMILY · DOMAIN_DISCLOSURE_TYPES_ADDED = 0**

`tests/block31/stranded-driver.test.ts` — 15 tests.
