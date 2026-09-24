# JASIM — WHAT SOMEBODY SAID, IN THE TERMS THE SEARCH SPEAKS

> `UNDERSTOOD != TRANSLATABLE` · `TRANSLATABLE != CONVERTIBLE_BY_GUESSING`
> `UNIT_CONVERSION != FX_CONVERSION` · `DISPLAY_VALUE != CANONICAL_VALUE`
> `FLOAT != MONEY`

## The bug, proven at the base

```
translateForDiscovery([COST AT_MOST 3 KWD])  →  []
2500 minor KWD passes · 3500 minor KWD passes
```

«أقل من 3 دنانير» was understood by the need runtime and **silently dropped**
by discovery. A `GoalConstraint` (`COST · AT_MOST · 3 · KWD`) is not a discovery
`HardConstraint` (`field: price · maxMinor`), and the previous phase correctly
refused to guess the conversion rather than inventing one.

## What already existed

`api/runtime/block3/money.ts` — the canonical money module the payment path
uses:

- **currency scales** — KWD/BHD/OMR/JOD 3, JPY/KRW 0, default 2
- `parseMoney` — exact decimal string → minor units, **bigint only**
- refuses precision the currency does not have rather than rounding it
- `Number()` / `parseFloat` are forbidden on this path by design

Nothing new was written for money. One thing was added: a registered set of
currency codes, because a unit string alone cannot tell `KWD` from `DAY` — both
are three uppercase letters. **An unregistered code is not money**, which fails
safe: an unrecognized bound goes unapplied rather than being applied at the
wrong scale.

## The translation is a projection, never a rewrite

| | says |
| --- | --- |
| the need | `COST AT_MOST 3 KWD` — in the words the person used |
| the derived filter | `{ field: price, maxMinor: "3000", currency: "KWD" }` |

The need is untouched. The filter is derived for **one search** and stored on
that result set, beside the need id and revision the provenance phase added — so
history can say *N1@rev3 wanted ≤ 3 KWD, and R1 filtered on ≤ 3000 minor KWD*.

## What is not applied is returned, not swallowed

```
DIRECTION_NOT_A_BOUND      — «الأرخص» ranks; it does not exclude
NO_UNIT                    — three of what?
UNKNOWN_UNIT               — no metadata for this code
PRECISION_UNREPRESENTABLE  — more decimals than the currency has
DIMENSION_NOT_STORED       — nothing comparable is stored
```

Every one is carried into the answer, and the person is told in the sentence
they read. **`SILENT_GUESSED_FILTER = 0`.**

### Currency is carried into the comparison

A KWD bound neither admits nor excludes a USD price. 2000 USD minor is a
smaller integer than 3000 — and without a rate that means nothing, so the
runtime declines rather than deciding. **No exchange rate exists anywhere on
this path.**

## A bug this phase found in the previous one

The need patch schema was a weaker copy of the canonical goal schema, so a
constraint the canonical schema refuses — a bare number with no unit — could be
**stored and then be unreadable on the next turn**. Merges now go through
`GoalSpecSchema` itself, so such a constraint is refused where it is proposed.

That makes the no-currency case *stronger* than declining to translate it: it
never enters the need at all.

## Other dimensions

**Supported:** `COST` in any registered currency, `COST` in exact minor units,
and any dimension the fabric already stores as a plain numeric attribute in the
same unit.

**Deferred:** cross-unit conversion for time, distance, weight and capacity —
hours to days, kilometres to metres. That needs conversion metadata this
runtime does not have, and inventing it would exclude things nobody excluded.
Such bounds are named as unapplied, never guessed.

## Where the proof is

- `tests/unit/constraint-unit-translation.test.ts` — 16 tests, including the
  binary-float traps (`10.99 × 100 = 1098.9999999999998`) that exact decimal
  parsing has no opinion about.
- `tests/block31/constraint-unit-translation.test.ts` — 7 live tests through the
  real conversation boundary: the primary journey with a USD decoy, correction
  to a new bound, and the older result set keeping the bound it actually used.
