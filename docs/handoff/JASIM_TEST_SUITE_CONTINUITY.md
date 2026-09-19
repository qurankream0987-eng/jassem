# JASIM — TEST SUITE CONTINUITY

**Audited:** 2026-09-19 · **Question:** why have the reported test counts moved?
**Answer:** every movement is new tests, plus one wrong number in one of my own reports.

**No test file has ever been deleted.** `git log --diff-filter=D --name-only --all`
over `canonical/جاسم/app/tests/` returns nothing for the entire repository history.

---

## The table

| Suite | Current command | Discovered now | Previously reported | Difference | Classification |
|---|---|---|---|---|---|
| **Main** | `npx vitest run --exclude 'tests/block2/**' --exclude 'tests/block3/**' --exclude 'tests/block31/**'` | **1526** passed, 26 skipped (75 files) | 1285 (+8 skipped) | **+241**, +18 skipped | **new tests** |
| **Block 2** | `npx vitest run --config vitest.block2.config.ts` | **121** (16 files) | 115 | **+6** | **new tests** |
| **Block 3** | `npx vitest run --config vitest.block3.config.ts` | **133** (17 of 17 files) | "203" | **0** | **misreported figure — corrected** |
| **Block 3.1** | `npx vitest run --config vitest.block31.config.ts` | **115** (20 files) | 70 | **+45** | **new tests** |
| **Frozen evaluation** | `npx vitest run tests/evals/` | **74** (4 files) | 74 | 0 | **subset of Main** — not additive |

Not a single entry is *missing regression coverage*.

---

## Every delta, reconciled to the file

### Main: 1285 → 1526 (+241)

| File | Tests |
|---|---|
| `tests/evals/frozen-corpus.test.ts` | 19 |
| `tests/evals/security-evals.test.ts` | 19 |
| `tests/evals/compensation-evals.test.ts` | 23 |
| `tests/evals/observation-bridge-evals.test.ts` | 13 |
| `tests/unit/mobile-runtime-endpoint.test.ts` | 29 |
| `tests/unit/ordinal-reference.test.ts` | 75 |
| `tests/unit/credential-shapes.test.ts` | 63 |
| | **241** |

`1285 + 241 = 1526.` Exact.

The +18 skipped is `tests/integration/model-provider-live.test.ts`, the only *modified*
(not added) test file: the live-provider sections are gated on a real credential and
skip closed when none is readable. Skipped, not removed — and they must stay skipped
here, because `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`.

### Block 2: 115 → 121 (+6)

`tests/block2/compensation-capacity.test.ts` — 6. Exact.

### Block 3.1: 70 → 115 (+45)

| File | Tests |
|---|---|
| `tests/block31/compensation-recovery.test.ts` | 7 |
| `tests/block31/evals-baseline.test.ts` | 3 |
| `tests/block31/observation-bridge.test.ts` | 18 |
| `tests/block31/observation-bridge-presentation.test.ts` | 3 |
| `tests/block31/ordinal-reference-resolution.test.ts` | 14 |
| | **45** |

`70 + 45 = 115.` Exact.

### Block 3: 133 → 133 (0), and the "203"

This is the one that needed explaining rather than adding up, so it gets the detail.

`JASIM_COMPLETION_POLICY_AND_EFFECT_VERIFICATION_REPORT.md` §10a claimed `BLOCK_3 = 203`
and "corrected" an earlier `133` as "a partial collection reported as a whole one".

**That correction was wrong, and it was mine.** Evidence:

1. `git diff --stat 8bfaaeb HEAD -- canonical/جاسم/app/tests/block3/` — **empty**. The
   directory is byte-identical between the commit that reported 203 and HEAD.
2. `git diff --stat 8bfaaeb HEAD -- canonical/جاسم/app/vitest.block3.config.ts` —
   **empty**. Same selector, same `fileParallelism: false`.
3. `git log --oneline -- tests/block3/` — one commit, the initial import. Nothing has
   ever been changed or removed there.
4. Re-run today: **`Test Files 17 passed (17)` · `Tests 133 passed (133)`**. All
   seventeen files collected. A partial collection reports fewer *files*; this reports
   all of them.
5. `133 + 70 = 203`, and `70` is exactly what the same report recorded for Block 3.1
   at that moment.

So `203` was two consecutive suite totals read as one number, and the "correction"
replaced a correct figure with that sum. Both the summary line and §10a of that report
now carry a retraction pointing here. **Nothing was restored, because nothing was lost.**

---

## What was checked for, and not found

| Failure mode the audit looked for | Found? |
|---|---|
| A previously active inherited regression suite no longer running | **No** — all four selectors run, and `tests/block3` (the inherited economic suite) collects 17/17 |
| Deleted test files | **No** — zero deletions in the whole history |
| Tests moved to a directory the selector excludes | **No** — the three exclusions are the three block suites, each of which has its own command in the table above |
| `describe.skip` / `it.skip` / `.only` added to dodge a failure | **No** — the only skips are the environment-gated live-provider sections |
| Expected behaviour changed to align a count | **No** — no test assertion was modified in this audit; the only edit was to a prose report |

---

## Standing rule for future reports

Each suite is counted by **its own command**, and the file count is quoted next to the
test count. A total without a file count cannot be distinguished from a partial
collection, which is the mistake that produced the 203 in the first place.

The frozen evaluation is a **subset of Main**, not a fifth suite — adding it to a
grand total double-counts 74 tests.
