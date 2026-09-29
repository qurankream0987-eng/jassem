# JASIM — A NEED CAN NAME A MEASURE

## THE GAP, TRACED BEFORE ANYTHING WAS WRITTEN

> «أحتاج مكاناً لتخزين **30 متراً مكعباً**» · «جهاز وزنه **7 أطنان**» ·
> «**5,000 قطعة** قبل الأربعاء» · «**45 يوماً** بدرجة حرارة محددة»

Every one of those is a quantity of something on a number line, and **none of
them could be written down as a need**.

| Side | What a requirement could be |
|---|---|
| **Offering** (`ConstraintExpression`) | any `field` + `operator` + `value` + `unit` — since the fabric was written |
| **Need** (`GOAL_DIMENSIONS`) | six abstract dimensions: COST, TIME, QUALITY, RISK, PRIVACY, LOCATION |

Two halves of one runtime disagreeing about what a requirement is. A measured
quantity is not a cost, not a risk, not a privacy level, and not an opinion
about quality.

> **A MEASURE IS NOT A QUALITY**

---

## AND THREE DEFECTS ON THE PATH A MEASURE WOULD HAVE TAKEN

**1. `UNIT_DROPPED_IN_TRANSLATION = 0`**
`translateConstraints` ended its non-COST branch by pushing
`{ field, operator, value }` and **dropping the unit**, under a comment saying
no conversion metadata existed. That metadata has existed since the units
phase — and dropping the unit was never the safe option it looked like: a bound
of «30 m³» became a bare `<= 30`, which a candidate holding **30000 litres**
satisfied. A silent **false match**, and the mirror of the false exclusion that
file exists to refuse. The unit now travels; a scale the fabric does not know is
**named** (`UNKNOWN_UNIT`), exactly as an unknown currency is.

**2. `TWO_CONSTRAINT_EVALUATORS = 0`**
`discovery.satisfiesHardConstraints` and `economic-fabric.evaluateConstraint`
both answered *"does this candidate satisfy this constraint"*, and had drifted:

| | discovery | fabric |
|---|---|---|
| units | none | normalized by dimension |
| provenance | none | INFERRED decides nothing |
| operators | `max`, `<=`, `gte`, `>=`, `eq`, `=` | `lte`, `gte`, `gt`, `lt`, `eq`, `neq` |

Discovery is the path everybody searches through, so the weaker answer was the
one that decided. It now delegates, keeping only what is genuinely its own:
money.

**3. `INFERRED_VALUE_EXCLUDES_A_CANDIDATE = 0` — on the discovery path**
A model's reading of a photo both **admitted** and **excluded** candidates in
search. The law was enforced on the matching side and nowhere here. An inferred
value is now UNKNOWN, and UNKNOWN is not a hard match — it is left for the
brokering path to ask the owner.

**4. `TWO_UNIT_TABLES = 0`**
`goal-spec` held a private `SECONDS_PER_UNIT` that only TIME consulted. Deleted;
weeks and days still compare, and now so do tonnes and kilograms, m³ and litres.

---

## ONE DIMENSION, NOT A CATALOGUE OF QUANTITIES

```ts
{ dimension: "MEASURE", field: "volume", operator: "AT_MOST",
  value: 30, unit: "m3", hardness: "HARD", source: "STATED" }
```

There is no `VOLUME`, no `MASS`, no `TEMPERATURE` and no `DURATION` dimension
beside it. **What** is measured is `field`; the **scale** is `unit`; both are
data. Enumerating physical quantities is enumerating the world.

> **DOMAIN_DIMENSIONS_ADDED = 0**

Two rules keep the vocabulary honest, at the schema:

- `A MEASURE OF NOTHING = 0` — MEASURE without a `field` does not parse.
- Only MEASURE names a field. A COST whose field is «volume» does not parse.

---

## WHAT COUNTS AS THE SAME NUMBER LINE

Contradictions group by **(dimension, field)**, not by dimension.

- «30 m³» beside «7 tonnes» → **two requirements**, no conflict.
  `INCOMPARABLE_ACROSS_FIELDS != CONTRADICTORY`
- «at most 2 tonnes» beside «at least 3000 kg» → `CONTRADICTORY_HARD_BOUNDS`,
  and the conflict **names the measure**, because one nobody can name is one
  nobody can fix.
- «at most 2 glorbs» beside «at least 3000 kg» → `INCOMPARABLE_HARD_BOUNDS`.
  Checking them would mean pretending one scale is the other.
- Two bounds in the **same** unrecognised scale still compare — they are on one
  number line whatever that unit means, and nothing is converted.

Money stays out of the unit table entirely. A currency is not a scale of some
other currency, and no rate exists anywhere on this path.

> **CURRENCY_IS_A_UNIT = 0 · FX_CONVERSION_ADDED = 0**

---

## GENERALITY

The same bound was run against storage capacity, machine time, professional
hours, a seabed survey line, artifact conservation and bandwidth allocation.
The filter cannot see what is being measured.

`tests/block31/measured-need.test.ts` — 18 tests.
