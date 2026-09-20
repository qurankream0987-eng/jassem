# JASIM — CANONICAL DATA

**Status:** IMPLEMENTED · **Phase:** Canonical Data + AuthorizedQuery + CanonicalDataset + first generative data surfaces

```
Conversation → GoalSpec → Semantic Router → DIRECT_READ → DataNeed
→ AuthorizedQuery → Canonical Resource Resolution → AUTHORIZATION
→ DataSource → CanonicalDataset → Presentation IR → TABLE / CHART
```

| Module | Owns |
|---|---|
| `api/runtime/data-need.ts` | what a person wants to see, semantically |
| `api/runtime/canonical-resource.ts` | what is readable, and by whom |
| `api/runtime/data-source.ts` | where rows come from |
| `api/runtime/authorized-query.ts` | resolve → **authorize** → bound → execute |
| `api/runtime/canonical-dataset.ts` | data that survives its presentation |
| `api/runtime/dataset-presentation.ts` | TABLE and CHART over a dataset |
| `src/components/jasim-core/DatasetSurface.tsx` | the web surface |
| `artifacts/jasim-mobile/components/DatasetSurface.tsx` | the same dataset on a phone |

Tests: `tests/unit/canonical-data.test.ts` (67) · `tests/block31/canonical-data-turn-path.test.ts` (18)

---

## 1. One general system

There is no `SalesQuery`, `InventoryDashboard` or `BookingsDataset`, and nowhere
to put one. **Adding a resource is adding a row to a list.** Nothing in the data
modules knows what any resource MEANS — asserted by scanning all five for
*sales, inventory, employee, booking, restaurant, invoice*.

### Only JASIM's own data is registered

`runs`, `tasks`, `conversations`. Real, owner-scoped rows the runtime already
writes.

**Business data belongs to a business** and arrives through an adapter its owner
connects. So «أرني مبيعاتي» resolves to no resource and answers `UNAVAILABLE`
truthfully, while «أرني عملياتي» returns real rows — through the identical code
path. Registering a `sales` resource backed by invented rows would make every
proof above it worthless.

---

## 2. What a model may say

```ts
DataNeed {
  resource, fields, filters, sort, groupBy, aggregate,
  timeRange, window, presentationIntent, subject
}
```

`.strict()`, and there is **no field** for `ownerId`, `role`, `permission`,
`scope`, `sql`, `rawSql` or `table`. Ten authority keys are rejected outright and
mirrored into the shared `AUTHORITY_KEYS`.

A proposal carrying one is **rejected, not trimmed**: a trimmed injection looks
like a normal request, and the one that mattered would be the one nobody saw.

Filter values are **scalars only** — an object or array is the shape an injection
takes when a driver is asked to interpret it.

---

## 3. Authorization happens before a query exists

```
DataNeed → resource resolution → AUTHORIZATION → AuthorizedQuery → source
```

There is no moment at which an unauthorized read is in flight. `ownerScope` is a
separate argument the caller supplies from the session, so **forgetting it is a
type error**, and it travels on the query rather than as a source-call argument,
so there is no path that executes one without it.

| Case | Answer |
|---|---|
| resource not registered | `UNAVAILABLE`, naming what does exist |
| sensitive field requested | `DENIED` — **never silently dropped** |
| unknown field | `NEEDS_INPUT`, listing the real ones |
| field not filterable/sortable | `NEEDS_INPUT` |
| no owner scope | `DENIED` |
| source not registered | `BLOCKED_BY_CONFIGURATION` |
| source unavailable | `BLOCKED_BY_PROVIDER` |

**A restriction is never silently removed.** Quietly returning the other columns
teaches a person the field does not exist, which is a different fact and a false
one.

Cross-owner isolation is proven on the live path: owner A reads 1 row while
owner B's 2 rows exist, and neither appears anywhere in the response.

---

## 4. DataSource

Internal PostgreSQL is **one** source. The contract takes an already-authorized
query and returns plain rows — no session, no credentials, no way to ask who is
calling. That is what makes an external adapter safe to add: **the worst a badly
written one can do is fail, not leak.**

Every value is bound through Drizzle's expression builders; no string is
concatenated into SQL anywhere. Proven: a filter value of
`'; DROP TABLE runs; --` matches nothing and the table survives.

`registerDataSource` refuses to replace an existing id — silently swapping where
data comes from is exactly the change nobody would notice.
`EXTERNAL_SOURCE_ENV_CONTRACT` lists Railway variable **names only**; no value is
read, logged or printed.

---

## 5. CanonicalDataset

```
Dataset != UI.        Dataset != a SQL result.
```

«أرني مبيعاتي» → «رتبها من الأعلى» → «حولها إلى رسم» is **ONE dataset seen three
ways**. If rows lived in the table component, the sort would re-ask the source
and the chart would re-ask again — three answers to one question, each able to
differ from the last.

Proven on the live path: after a read, **every row is deleted from the database**
and the re-sort still returns all of them. No second read happened.

### Stable references

Each row carries a runtime-assigned `ref` and a `position` that is its place in
the **presented** order. «اعرض الثاني» means the second row on screen — not the
second the database returned. A re-sort renumbers positions and bumps
`revision`, keeping `datasetId`: same data, seen differently.

### Freshness is a claim, so it is typed

`CURRENT | STALE | UNKNOWN`, defaulting to `UNKNOWN`. **Nothing may render
«مباشر»** and no field can express it. The internal source reports `UNKNOWN`
because rows were true when read and nothing pushes a change yet. `datasetId` +
`revision` is the hook realtime will attach to.

---

## 6. TABLE and CHART

A chart is described by naming a category column, a measure column and one of
three forms (`BAR`, `LINE`, `METRIC`). **No generated code, no SVG from a model,
nothing to evaluate.** A chart naming a column the dataset lacks is refused; one
measuring a text column is `NOT_MEASURABLE`, refused rather than coerced — a
chart built from a silent `Number("قيد التنفيذ")` would be a picture of `NaN`
presented as a finding.

### One colour, on purpose

A chart here is **one measure across categories — a single series**. Giving each
bar its own hue would be colouring by RANK, which repaints when data reorders
and encodes nothing. One hue, direct labels, no legend.

`#2196c9` is JASIM's accent re-stepped into the dark-mode lightness band
(OKLCH L 0.48–0.67) and **validated, not eyeballed** — the product's own
`--jasim-accent` sits at L 0.80, outside the band. Status colours
(success/warning/danger) are deliberately unused: a green bar would read as good
news.

### Web and mobile are one architecture

Same dataset, same columns, same freshness label. The phone scrolls a wide table
horizontally rather than dropping columns, because hiding columns shows less than
was asked for without saying so. `LINE` draws as bars on a phone — the same
numbers in the form that fits.

---

## 7. Bounded by construction

`MAX_WINDOW` 200, default 50, `MAX_FILTERS` 10, `MAX_SORT` 3, `MAX_FIELDS` 30. An
unbounded read cannot be *asked for* — the schema rejects it. A windowed view
says so: «50 من 4000», because showing 50 of 4000 silently is a quiet lie about
how much there is.

---

## 8. Observability

Recorded: resource, source kind, operation counts, status, row count, freshness,
latency. **Never** row payloads, **never** filter values (a filter value is user
data — «status = مرفوض» says something about them), never the owner id, never
credentials. Proven by a test that seeds a row containing «سرّي جداً» and asserts
it appears in no observation field.

---

## 9. Provider-ready

| | |
|---|---|
| CONTRACT | PASS — `DataSource` takes an authorized query, returns rows |
| CONFIG | PASS — `EXTERNAL_SOURCE_ENV_CONTRACT`, names only |
| AUTHORIZATION | PASS — happens before any source is consulted |
| NORMALIZATION | PASS — positions, refs, typed columns, provenance added by the runtime, not the adapter |
| ERROR_STATE | PASS — `NOT_CONFIGURED` / `PROVIDER_UNAVAILABLE` / `READ_FAILED` map to distinct truthful states |
| OBSERVABILITY | PASS — §8 |
| TEST_HARNESS | PASS — `registerDataSource` + the contract are exercised by the registry tests |

---

## 10. Two bugs the tests caught

**Substring resolution matched an unrelated subject.** «ساعات تشغيل المخرطة» — a
lathe's operating hours — resolved to the `runs` resource because «تشغيل» was an
alias appearing inside it. Resolving an unrelated subject to a real resource is
**worse than resolving nothing**, because it answers confidently with somebody
else's question. Fixed to whole-word matching with the definite article
normalised, and «تشغيل» removed as too generic to identify anything.

**An observation lost its shape.** `readObservation` reported `resource: null`
when the caller had not kept the query. A dataset describes itself — provenance
and view — so the observation now reads from there and is complete for every
caller that only wanted rows.

---

## 11. What the surface phase added

**A third dataset operation: `{ op: "TABLE" }`.** `SORT` and `CHART` made a table
into other things; nothing brought it back. A chart that cannot become a table
again is a one-way door — the rows are still there, and a person who wants to
read the numbers rather than look at them should not have to ask for the data a
second time. It carries no arguments, because the table of a dataset **is** the
dataset: same id, same revision, same rows, same sort, no re-query.

**Aggregation scope.** `SOURCE` · `COMPLETE_WINDOW` · `PARTIAL_WINDOW`. An
aggregate is the one presentation that can be false while every number in it is
true, so a chart now carries where its numbers came from and the surface says so
when the window was partial. `groupBy` + `aggregate` are executed by the source
as a real `GROUP BY`, which is what earns `SOURCE`.

**The identity field stopped being a column it was never asked to be.** It still
travels with every read — a row nobody can point at later is a row an ordinal
cannot resolve to — but when the request named its own fields, the identity is
read without being rendered. Asking for everything still shows it.

**Rows are enumerated by PRESENTED position.** The newest dataset in a
conversation contributes its rows to reference resolution under
`dataset:<id>:<revision>`, so «الصف الثاني» means the second row on screen —
which is a different row once «رتبها من الأعلى» has run.

---

## 12. What is not yet true

- **No external data source exists.** One adapter, reading JASIM's own rows.
- **No realtime.** `datasetId` + `revision` + `freshness` exist so it can attach;
  nothing pushes yet, and nothing claims to.
- **Enum values render as the source stores them.** Columns are labelled; values
  are not.
- **No model has produced a DataNeed here.** `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`.
