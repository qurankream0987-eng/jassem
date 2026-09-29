# JASIM — «قريب» كمية، لا نوع جديد من القيود

```
PROXIMITY_IS_A_NEW_CONSTRAINT_KIND = 0
FABRICATED_POINT = 0
MISSING_POINT_IS_UNKNOWN_NOT_FAR
INFERRED_LOCATION_DECIDES_PROXIMITY = 0
DERIVED_VALUE_OVERWRITES_A_STATED_ONE = 0
GREAT_CIRCLE != TRAVEL_DISTANCE · NEAR != AVAILABLE
EXACT_COORDINATES_IN_A_PUBLIC_PROJECTION = 0
```

## The whole design, in one sentence

**A distance is a length**, and the previous phase made length a dimension the
unit table declares. So «within 25 km» is an ordinary bound over an ordinary
quantity, normalized by the same machinery as «at least 7 tonnes». Nothing new
was invented to hold it: the need bounds a field named `distance`, and the
matcher derives that field in metres when — and only when — both sides said where
they are.

No proximity runtime, no geo service, no new table, no migration.

## What geometry is not allowed to claim

Great-circle distance is the length of a straight line across a sphere. It is
**not** a travel distance and **not** a travel time. No road is consulted, no
traffic, no ferry, no closed bridge. Two points 25 km apart may be an hour apart
by road or unreachable entirely.

So what this answers is *«is it plausibly nearby»* — a **filter**. It is not a
promise that anybody can get there, and nothing downstream may read it as one. A
real travel distance is a provider's answer, not geometry's.

## Four ways it refuses to decide

**A fabricated point.** Points are read through the same strict reader
observations use — two finite numbers in range. A string `"31.95"`, a `NaN`, a
missing key, a latitude of 991: all yield no point, because a coerced point is a
fabricated location.

**A missing point.** One side without a usable point yields **nothing** — not a
large distance. *«Not known to be near» is not «far»*, and returning a number
there would turn a silence into an exclusion. The constraint answers `UNKNOWN`.

**A guessed point.** A location a model read off a photo decides no proximity,
and this falls out of the provenance phase rather than being re-implemented: the
derived distance inherits `INFERRED` from **either** side. Both directions are
proved — the guess that would have included a candidate and the guess that would
have excluded one.

**Someone else's word over the owner's.** If the owner stated a field by that
name themselves, theirs stands and nothing is derived over it.

## Near is not available

Proximity filters; it authorizes nothing. A candidate 20 km away with too little
capacity still fails on capacity, and the match is not viable. Being near excuses
nothing — the same way being selected is not being authorized.

## A point is private; a summary is public

Matching reads the point **server-side, from private attributes**. The public
projection carries `locationSummary` — a summary, never coordinates — and
`publishExpression` refuses a raw point as a public key outright, because
`PUBLIC_PROJECTION_KEYS` never admitted one.

So a buyer learns *«this is within 25 km»*, which is a yes or a no. They do not
learn where somebody lives.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/proximity-matching.test.ts` | the geometry is correct, symmetric, zero against itself, and returns a real number at antipodal points rather than NaN; a radius decides like any other bound and in km or metres alike through the one unit table; near is a filter — a close candidate with too little capacity still fails and is not viable; seven kinds of missing or unusable point all answer `UNKNOWN` and never far, including a buyer who did not say where they are; a guessed location decides no proximity from either side, in both the including and the excluding direction; an owner's own stated distance is never overwritten by a derivation; matching reads a private point while a non-owner sees only the summary, and publishing a raw point as a public key is refused; the geometry names no road, route, traffic or travel and writes its own limitation down; proximity names no domain, and one strict point reader is shared rather than copied |
