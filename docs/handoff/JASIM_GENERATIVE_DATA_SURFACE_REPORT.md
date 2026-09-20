# JASIM — GENERATIVE DATA SURFACE CLOSURE + ACTIVE CHAT RENDERING

**Phase:** close CHART_SURFACE / WEB_INTEGRATION / MOBILE_INTEGRATION, and make data
visibly work inside the ACTIVE conversation.

**Rule held throughout:** `DOMAIN_SURFACES_ADDED = 0` · `FALSE_AGGREGATE = 0` ·
`DOMAIN_SPECIFIC_CORE_ADDED = 0` · `FALSE_SUCCESS = 0`.

---

## 1. What was PARTIAL, and what closed it

| | before | after |
|---|---|---|
| **CHART_SURFACE** | a chart could be produced, and said nothing about what it was computed over | every chart carries `scope` + `coverage`; a partial window says so in words, on both platforms |
| **WEB_INTEGRATION** | the surface existed; nothing mounted it on a message | `TurnSurface` mounts it on the assistant's own turn in `ChatMessage`, with the lifecycle in the DOM |
| **MOBILE_INTEGRATION** | same | `MobileTurnSurface` in `MessageRow`, same closed registry, same contract |
| **CHART → TABLE** | one-way door: a chart could not become a table again | `datasetOp: { op: "TABLE" }` — same dataset, same rows, same sort, no re-query |
| **presented-order references** | an ordinal could not mean a row of the table on screen | dataset rows are enumerated by PRESENTED position; «الصف الثاني» follows the sort |

## 2. The surface lifecycle

`classifyLifecycle` is semantic state, not animation, and it is in the DOM whether or not
anything moves:

```
ENTER      first surface, or a different datasetId
UPDATE     same dataset, new revision          (a re-sort)
MORPH      same dataset, different primitive   (TABLE ⇄ CHART, both directions)
EXIT       the surface went away
NO_CHANGE  nothing changed — not a redraw
```

`prefers-reduced-motion` removes the transition. It does not remove the state.

## 3. What an aggregate is allowed to claim

```
SOURCE           the source ran the GROUP BY over everything it holds
COMPLETE_WINDOW  the window saw every row there is
PARTIAL_WINDOW   it did not — and the surface must say so
```

A bar chart of 50 rows out of 4000 looks exactly like a bar chart of 4000. The only thing
between the reader and a wrong conclusion is the sentence
«محسوب على 50 من 4000 صفاً المعروضة، وليس على كامل البيانات.» — rendered as text, on web
and on mobile, never as a tooltip nobody opens.

An aggregate the data cannot support is refused, not coerced: `AVG` over a text column
returns `NOT_MEASURABLE` rather than a picture of `NaN` presented as a finding.

## 4. The client may not choose a primitive

`TRUSTED_SURFACE_PRIMITIVES` is a closed map — `["TABLE", "CHART"]` on both platforms,
asserted equal by test. An unknown `primitive`, or a payload whose shape does not match
what it claims to be, renders a named notice and never the raw payload. STATUS, CHOICE,
MAP, TRACKER and the rest become more keys in the same registry; none of them is a
rewrite, and none of them is a domain component.

## 5. Three defects the visual proof found

Component-isolation screenshots would have passed all three.

1. **A read asked to be approved.** The Presentation IR was derived from the envelope's
   KIND, and `direct_action` maps to «موافقة مطلوبة». A table therefore arrived with an
   approval card under it, asking a person to authorize a read that had already happened
   and had no effect to approve. This is the same defect the semantic router fixed one
   level up: the kind is the model's guess at a shape, the ROUTE is the fact. The two
   branches that execute nothing — `respondDataset` and `respondRouted` — now carry an
   informational presentation.

2. **A column nobody asked for pushed out one they did.** The identity field travels with
   every read. It was also rendered, so «أرني الهدف والحالة» produced a wall of UUIDs with
   «الحالة» clipped off the table's edge. It still travels and is still read; it is no
   longer a column when it was not asked for. Asking for everything still shows it.

3. **The bar chart had no bars at 390px.** Fixed label and value widths left the track
   zero width, so a phone drew a list of category names. The capture now measures the
   track rather than trusting the picture.

A fourth, found the same way: a routed non-answer (UNAVAILABLE / DENIED / NEEDS_INPUT)
was drawn as an ordinary reply on both platforms — the `RoutedNotice` existed and nothing
reached it. «لا يوجد مصدر بيانات» in a normal bubble reads as a finding. Both platforms
now draw it as a notice carrying its state.

## 6. Tests

| file | tests | what it holds |
|---|---:|---|
| `tests/unit/generative-data-surface.test.tsx` | 41 | closed registry, unknown/malformed surface rejection, lifecycle in both directions, table and chart rendering contract, no undeclared column, window truth, RTL, scope note, routed states, and the surface mounted on a real `ChatMessage` |
| `tests/unit/data-surface-truth.test.ts` | 13 | aggregation scope, the scope sentence, refusal of unsupported aggregates, CHART → TABLE identity |
| `tests/unit/mobile-data-surface-parity.test.ts` | 11 | the two platforms know the same primitives and the same fields; the phone scrolls rather than dropping columns; neither claims live data |
| `tests/block31/data-surface-turn-path.test.ts` | 17 | the whole thing through the live turn against the real database |
| `tests/ui/capture-data-surface.test.ts` | gated | the visual proof, with measurements |

## 7. Regression

| suite | command | result | before | Δ |
|---|---|---|---|---|
| **Main** | `npx vitest run --exclude 'tests/block2/**' --exclude 'tests/block3/**' --exclude 'tests/block31/**'` | **1867** passed, 27 skipped · **84 files** (81 passed + 3 skipped) | 1802 passed, 26 skipped · 80 files | **+65**, +4 files |
| **Block 2** | `npx vitest run --config vitest.block2.config.ts` | **121** · 16 files | 121 · 16 | 0 |
| **Block 3** | `npx vitest run --config vitest.block3.config.ts` | **133** · 17 files | 133 · 17 | 0 |
| **Block 3.1** | `npx vitest run --config vitest.block31.config.ts` | **182** · 25 files | 165 · 24 | **+17**, +1 file |
| **Frozen evaluation** | `npx vitest run tests/evals/` | **90** · 5 files | 90 · 5 | 0 — subset of Main, not additive |
| **TypeScript** | `npx tsc -b` | 0 errors | | |
| **Web build** | `npx vite build` | built | | |
| **Mobile typecheck** | `npx tsc --noEmit -p tsconfig.json` | 0 errors | | |
| **Mobile build** | `npx expo export --platform web` | exported | | |

The Main "before" figure was measured by running the same command with this phase's four
new files excluded: 1802 → 1867 is exactly the 65 tests added, and 80 → 84 files is
exactly the four added. Nothing inherited disappeared, and no test was weakened to obtain
a pass.

The three skipped Main files are the gated UI capture suites — `capture-shell`,
`capture-data-surface` (both need a running dev server and a browser) — and one
pre-existing gated file. `capture-data-surface` is the one this phase added, which is why
the skipped count moved from 26 to 27.

## 8. Visual proof

`docs/ui/data-surface/` — web A–G plus a 390px capture, and the two native captures, all
from the running product with real rows. Its README names what is real and what is not.

## 9. What is still open

- **Freshness is `UNKNOWN`.** No realtime maintains a `CURRENT` claim, so the surface says
  «حسب آخر قراءة» and never «مباشر». The WebSocket server exists and no web client
  subscribes; that is a realtime phase, not this one.
- **Enum values render raw.** `blocked` / `awaiting_input` reach the screen as the source
  stores them. Labelling values (as opposed to columns) belongs to the resource registry
  and would be a data-layer change, not a rendering one.
- **Only TABLE and CHART exist.** By design for this phase. The registry is the extension
  point.
