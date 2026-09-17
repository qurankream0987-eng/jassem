# JASIM UI evidence — `before`

Server-rendered component output for each canonical semantic scenario.
Structure, text and semantics only — not a visual capture. See the UI-1 report.

## A-plain-conversation — محادثة نصية عادية

**Primitive:** `TEXT`

**Expectation:** Plain text. No card, no chrome — a sentence should look like a sentence.

- Web: [`A-plain-conversation.web.html`](./A-plain-conversation.web.html) — 781 chars
- Mobile: [`A-plain-conversation.mobile.json`](./A-plain-conversation.mobile.json)

## B-search-results — نتائج بحث

**Primitive:** `SEARCH_RESULTS`

**Expectation:** A result set. Ordinals must be visible so 'الثاني' can refer to something.

- Web: [`B-search-results.web.html`](./B-search-results.web.html) — 2438 chars
- Mobile: [`B-search-results.mobile.json`](./B-search-results.mobile.json)

## C-comparison — قارن الثاني والرابع

**Primitive:** `COMPARISON`

**Expectation:** A comparison surface over an EXISTING result set — no fresh search.

- Web: [`C-comparison.web.html`](./C-comparison.web.html) — 1309 chars
- Mobile: [`C-comparison.mobile.json`](./C-comparison.mobile.json)

## D-ambiguous-choice — مرجع غامض → CHOICE

**Primitive:** `CHOICE`

**Expectation:** CHOICE, with a select action. Options carry reference keys only — never coordinates.

- Web: [`D-ambiguous-choice.web.html`](./D-ambiguous-choice.web.html) — 854 chars
- Mobile: [`D-ambiguous-choice.mobile.json`](./D-ambiguous-choice.mobile.json)

## E-map-fresh — خريطة بمشاهدة حديثة

**Primitive:** `TRACKER`

**Expectation:** MAP with a position. Freshness must be stated, not implied.

- Web: [`E-map-fresh.web.html`](./E-map-fresh.web.html) — 2673 chars
- Mobile: [`E-map-fresh.mobile.json`](./E-map-fresh.mobile.json)

## F-map-stale — خريطة بدون مشاهدة حديثة

**Primitive:** `TRACKER`

**Expectation:** NO position may be drawn. A stale observation must read as stale, never as a location.

- Web: [`F-map-stale.web.html`](./F-map-stale.web.html) — 1836 chars
- Mobile: [`F-map-stale.mobile.json`](./F-map-stale.mobile.json)

## G-approval-required — إجراء يحتاج موافقة

**Primitive:** `APPROVAL`

**Expectation:** APPROVAL. Consequences listed before the button, not after.

- Web: [`G-approval-required.web.html`](./G-approval-required.web.html) — 1310 chars
- Mobile: [`G-approval-required.mobile.json`](./G-approval-required.mobile.json)

## H-living-object — كائن حي / مراقبة مستمرة

**Primitive:** `SMART_BUBBLE`

**Expectation:** A persistent object. Secondary to the conversation, never a second dashboard.

- Web: [`H-living-object.web.html`](./H-living-object.web.html) — 777 chars
- Mobile: [`H-living-object.mobile.json`](./H-living-object.mobile.json)

## I-operation-running — عملية قيد التنفيذ

**Primitive:** `STATUS`

**Expectation:** Indeterminate. No percentage may appear unless the runtime reports real progress.

- Web: [`I-operation-running.web.html`](./I-operation-running.web.html) — 824 chars
- Mobile: [`I-operation-running.mobile.json`](./I-operation-running.mobile.json)

## J-operation-completed — عملية مكتملة

**Primitive:** `DETAIL`

**Expectation:** A settled result. Completion is a canonical fact, not an animation.

- Web: [`J-operation-completed.web.html`](./J-operation-completed.web.html) — 1131 chars
- Mobile: [`J-operation-completed.mobile.json`](./J-operation-completed.mobile.json)

## K-provider-unavailable — المزود غير متاح

**Primitive:** `ERROR_STATE`

**Expectation:** A blocked state, visibly NOT a success. Must not be rendered in a success colour.

- Web: [`K-provider-unavailable.web.html`](./K-provider-unavailable.web.html) — 772 chars
- Mobile: [`K-provider-unavailable.mobile.json`](./K-provider-unavailable.mobile.json)

## L-model-unavailable — نموذج الذكاء غير متاح

**Primitive:** `ERROR_STATE`

**Expectation:** Same: blocked, honest, and distinguishable from an empty result.

- Web: [`L-model-unavailable.web.html`](./L-model-unavailable.web.html) — 773 chars
- Mobile: [`L-model-unavailable.mobile.json`](./L-model-unavailable.mobile.json)

## M-empty-state — لا توجد نتائج

**Primitive:** `EMPTY_STATE`

**Expectation:** An empty result is not an error and must not be dressed as one.

- Web: [`M-empty-state.web.html`](./M-empty-state.web.html) — 761 chars
- Mobile: [`M-empty-state.mobile.json`](./M-empty-state.mobile.json)

