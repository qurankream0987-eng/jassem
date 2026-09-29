# JASIM — جدول واحد للكميات

```
TWO_TABLES_THAT_MUST_AGREE = 0
CURRENCY_IS_A_UNIT = 0
UNKNOWN_UNIT_IS_NOT_AN_ERROR
```

## A defect, not a wish

The previous phase recorded that the unit table covered mass, time and count
only. Tracing it for this phase found something worse first.

`block2/units.ts` kept its **own** hand-written map of which unit belongs to
which dimension — beside the table in `semantic-fabric` that the very same file
already imported from. Two tables that must agree and are maintained separately
do not stay in agreement, and these had already drifted:

```
canonicalQuantity(60, "seconds")  →  dimension "custom:seconds"
quantitySatisfies({1,"minute"}, {60,"seconds"})  →  undefined
```

**The declared base unit of time was not recognized as time**, and sixty seconds
did not satisfy a need for one minute. `BASE_UNIT.time` said `"seconds"` while
`DIMENSION_OF` had no entry for `second` or `seconds` at all — a table naming a
base unit it could not classify.

So the fix is not a row. The dimension map and the base units are now **asked of
the fabric**, and `block2/units.ts` holds nothing to drift with. Adding a unit is
one edit in one place.

## The two missing dimensions, and a third

`length`, `area` and `volume` join mass, time and count, with exact factors:

| dimension | base | spellings |
| --- | --- | --- |
| length | `m` | mm · cm · m · metre(s) · meter(s) · km · kilometre(s) · kilometer(s) |
| area | `m2` | m2 · m^2 · sqm · dunum · hectare(s) · ha · km2 · km^2 |
| volume | `m3` | ml · l · litre(s) · liter(s) · m3 · m^3 · cbm |

A buyer asking for 30 m³ and a seller offering 40,000 litres now meet. Before,
the two names could not be converted, the constraint answered `UNKNOWN`, and the
candidate was never viable — they passed each other in silence.

## What does not belong here

**Money.** A currency has no factor; it has a market. `block3/money` owns it with
its own scales and its refusal to add two currencies, and `JOD → KWD` returns
undefined here as it must.

**Anything anybody negotiates.** The table is physical dimensions with fixed,
exact conversions. Nothing whose rate changes.

## Unknown is still not an error

The list is not exhaustive and is not meant to be. An unknown unit keeps its own
name under its own dimension, so an exact same-unit comparison still works —
`صندوق` against `صندوق` compares correctly — and only **cross**-unit conversion
is refused. That behaviour is unchanged, and it is why nothing was broken before
this phase for owners who happened to use the same word on both sides.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/unit-dimensions.test.ts` | the base unit of time is time in both spellings and sixty seconds satisfy one minute while fifty-nine do not; there is no second table to drift from — the dimension map and base units are asked for rather than restated, and every unit the fabric knows is classified identically by the module that asks; volume, area and length convert exactly across eleven pairs; dimensions never cross (kg↔m, m3↔m2, hectare↔litre, km↔hour, count↔kg); a currency is not a unit and JOD→KWD is undefined; an unknown unit compares exactly with itself, refuses conversion across, and is never an error; spelling and spacing do not change a quantity; a need in m³ meets an offering in litres and still fails when the arithmetic says so; an area need meets an area offering across names; an unconvertible pair is `UNKNOWN`, never `FAIL`; the table names quantities and never things, and every declared dimension has a base unit that is itself a row |
