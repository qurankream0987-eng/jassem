# JASIM — ألف صف يُقترَح، ولا واحد يَصير حقيقة وحده

```
BULK_ROW_PUBLISHES_ITSELF = 0
SPREADSHEET_ROW != TRUSTED_LIVE_STOCK
BATCH_CONFIRMATION_COVERS_EXACT_ROWS · ONE_CHANGED_ROW_VOIDS_THE_BATCH
GAP_DETECTION_USES_A_DOMAIN_TEMPLATE = 0
FORMAT_BRANCHES = 0 · DOMAIN_BRANCHES = 0
```

An owner with a thousand things should not have to say them a thousand times.
But a thousand rows arriving at once must not become a thousand public promises
either, and the previous phase's law does not bend for volume:

```
PUBLISH_CONFIRMS_EXACT_CONTENT
```

So this is **intake, not import**. Every row becomes a draft through the one
composition path that already exists, nothing reaches the public, and what the
owner confirms is a **batch fingerprint** over each draft's own fingerprint.
Change one row and the batch confirmation is void — for the same reason changing
one value voids a single one. All of it, or none: never five out of six.

## It knows nothing about what the rows mean

There is no file format here, no spreadsheet, no catalogue and no API. Those are
**edges**: something out there turns bytes into rows. This takes rows already
read, and cannot tell whether they are cars, meals, machine hours or lake
surveys. The proofs assert the module contains none of those words — and check
whole words only, because «pos» lives inside `composeOffering` and «erp» inside
`fingerprint`.

## How a gap is found without a template

The previous phase refused to build a registry of what a KIND of thing ought to
state, because that is a template per domain. **That refusal stands.** What is
reported here comes only from primitives this repository already has, or from the
row contradicting itself:

| gap | why it is structural |
| --- | --- |
| `NO_KIND` | `composeOffering` already refuses it |
| `MONEY_WITHOUT_CURRENCY` | `assertCurrency` refuses money with no currency; an amount alone is not an amount |
| `QUANTITY_UNIT_DECLARED_BUT_EMPTY` | the row said a quantity has a unit and supplied none |
| `NOTHING_TO_PUBLISH` | `publishComposedOffering` already refuses it |

Not one says *«a car needs a mileage»*.

### A rule that was tried and withdrawn

The first version reported a gap when `normalizeUnit` could not place a unit —
`m3`, `hectare` — reasoning that an unplaceable unit makes the number unusable.

Tracing `evaluateConstraint` showed that is **false**. Normalization is reached
only when the two unit strings *differ*, so a need in `m3` against an offering in
`m3` compares its numbers directly and works perfectly. The rule would have
flagged rows that function and sent owners to fix nothing.

```
A GAP NOBODY HAS IS A GAP NOBODY SHOULD BE ASKED TO FILL.
```

It was withdrawn, and the reason is recorded in the module so it is not
reintroduced.

## A separate gap this uncovered, recorded not patched

`UNIT_TABLE` in `semantic-fabric` covers **mass, time and count only** — no
volume and no area. So *cross-unit* conversion in those dimensions genuinely
cannot happen: `m3` against `litre`, or `hectare` against `m2`, yields `UNKNOWN`.
Identical unit strings still compare correctly, which is why nothing is broken
today, but a buyer and a seller who name the same quantity differently will not
meet. That belongs to `semantic-fabric` and is not patched from an intake module.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/bulk-offer-intake.test.ts` | six rows from six unrelated worlds all become private drafts and nothing becomes public, with references echoed back so a row is addressable; what is structurally unusable is reported per row and never filled in — money with no currency, an invalid currency, a declared-but-empty unit, nothing to publish, no kind — and the row with no kind produces no expression at all; a unit the table cannot place is **not** a gap, because it still works; confirming the batch publishes exactly what was read; one amended row voids the whole batch and publishes nothing, not five out of six; a batch naming a different set than was read, or a shorter one, or an empty one, publishes nothing; an invented or borrowed batch fingerprint publishes nothing; nobody publishes somebody else's batch; two rows with one reference, or a blank reference, are refused before anything is drafted; a row may say a value was inferred and that value then decides nothing, with attachments carried; intake names no file format and no domain, consults no model, reaches public only through the one door, and nothing consults a table of what a kind needs |
