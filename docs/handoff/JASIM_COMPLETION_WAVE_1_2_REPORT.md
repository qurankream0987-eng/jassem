# JASIM — COMPLETION WAVE 1.2: REFERENCE DEFENSE-IN-DEPTH + GENERIC CLARIFICATION

**Branch:** `claude/runtime-experience-wave-1`
**Scope:** deliberately small — close the two findings Wave 1.1 recorded rather than fixed.
**Production touched:** NO · **Database schema changed:** NO · **Real model:** NO · **Real money:** NO

> A copy also exists at `.local/tasks/jasim-completion-wave-1-2-report.md`. `.local/` is
> gitignored, so this committed copy is the one that survives.

---

## 1. BASELINE VERIFIED BEFORE ANY CHANGE

Wave 1.1 was green, committed and pushed (`f0b2f68`) before this wave began:
main 811/811 · Block 2 101/101 · Block 3 133/133 · Block 3.1 65/65 · `tsc -b` PASS ·
web build PASS · mobile TypeScript 10 pre-existing.

---

## 2. PART 2–4 — OWNER SCOPE BY CONTRACT, NOT BY CALLER DISCIPLINE

### 2.1 What was wrong, stated proportionately

`resolveThis` and `resolveOrdinal` took a bare `conversationId`. Their safety therefore rested
entirely on every caller checking ownership first. Today's callers do check, so this was a
`DEFENSE_IN_DEPTH_GAP` and **not a proven cross-owner exploit**.

But "safe because everyone has been careful so far" is not an invariant, and the next caller
inherits no warning.

### 2.2 Caller impact analysis, done before the signatures moved

| Caller | Classification |
|---|---|
| `block31/conversation-orchestrator.ts:246` (`resolveOrdinal`) | **ACTIVE_PRODUCTION** — reachable via `orchestrateConversationCommerce` ← `jasim-runtime.ts` |
| `block31/conversation-orchestrator.ts:335` (`resolveOrdinal`) | **ACTIVE_PRODUCTION** |
| `tests/block31/discovery-core.test.ts` ×3 | TEST |
| `tests/block31/unseen-goals.test.ts` ×2 | TEST |
| `resolveThis` production callers | **none** |

Both production sites already held `input.ownerId`, so the change was mechanical there.

### 2.3 The fix

```ts
export type ReferenceScope = { ownerId: string; conversationId: string };

resolveThis(db, scope: ReferenceScope)
resolveOrdinal(db, scope: ReferenceScope, n: number)
```

Owner conditions were added inside both queries: directly on `reference_bindings`, and on
`discovery_result_sets` for the ordinal path — candidates are reached through their result
set, so scoping the set scopes the ordinal.

**The object is not cosmetic.** With two positional strings a caller could pass a bare
conversation id and widen the query silently. Omitting the owner is now a **type error**.

Five Block 3.1 call sites were updated to pass the owner. **No assertion was touched.**

### 2.4 Security tests

Six isolation tests give **two owners the same conversation id** on purpose, so isolation has
to come from the owner condition rather than from an unguessable identifier:

- owner A's own binding resolves
- owner B's binding in that same conversation id is invisible to A
- the same `referenceKey` held by two owners stays isolated
- the same ordinal under two owners stays isolated
- another owner's rows cannot manufacture an ambiguity for A
- a mismatched owner cannot resolve even with the exact conversation id

Plus: a superseded binding does not come back, and **"not yours" and "does not exist" are
byte-identical answers** — asserted with `expect(foreign).toEqual(empty)`, so the resolver
cannot be used as an oracle confirming what other owners hold.

```
RESOLVE_THIS_OWNER_SCOPED    = YES
RESOLVE_ORDINAL_OWNER_SCOPED = YES
CROSS_OWNER_REFERENCE_LEAKS  = 0
```

---

## 3. PART 6–9 — CHOICE, WITH NO NEW FIELD

### 3.1 The contract already distinguished the two cases

The question asked was whether the presentation contract could tell `DATA_ENTRY` from
`CLARIFICATION_SELECTION`. It could, and had been able to all along:

- `missingFields` — data the runtime **does not have**
- `candidates` — a bounded set of alternatives it **already holds and has authorized**

So the smallest deterministic branch uses what exists:

```
collect_input + candidates non-empty + no missingFields  →  CHOICE
otherwise                                                →  FORM
```

**Fields win when both are present**, because a choice cannot substitute for a value that
still has to be supplied. **Authority outranks both**: a consequential turn carrying
candidates is still `APPROVAL`, never `CHOICE`.

```
CHOICE_REACHABLE         = YES
CHOICE_GENERIC           = YES
FORM_SEMANTICS_PRESERVED = YES
```

Both are asserted, including the both-present case and the empty-candidate-list case, so
FORM cannot quietly disappear.

### 3.2 The decision layer stays authoritative

A caller naming a primitive in `data` is just data: a test passes
`data: { primitive: "CHOICE", candidates }` on an informational turn and gets
`SEARCH_RESULTS`. There is no input through which a client or a model selects a privileged
primitive.

### 3.3 CHOICE option payload

Each option carries **only** its stable `referenceKey` and its opaque `entityRef`
(`kind:id`). Enough to pick, never enough to read a position — a test asserts the serialized
clarification contains no `lat`, `lng`, `coordinates`, `ownerId` or `observedAt`.

---

## 4. REAL LOCAL ACCEPTANCE — 5 CASES OVER HTTP

Isolated local database, real server, canonical rows only.

| # | Case | Result |
|---|---|---|
| A | One observable subject | `RESOLVED` → TRACKER + **MAP** @ 29.3, 47.9 |
| B | Two authorized observable subjects | **`AMBIGUOUS` → CHOICE**, two options, `actions: [select]`, **coordinate leak: false** |
| C | Selecting one authorized option | `RESOLVED` → **MAP** @ 29.4, 47.99 |
| D | Another owner's binding **in the same conversation** | only the owner's own two options appear — the foreign option is absent, **0 disclosure** |
| E | Superseded option re-selected | `NOT_FOUND` → STATUS, **no resurrection** |

Case D is the one worth reading twice: the foreign binding sat in the *same conversation id*
and still disclosed nothing.

```
AMBIGUOUS_REFERENCE_TO_CHOICE = PASS
CHOICE_TO_TRUSTED_RESOLUTION  = PASS
```

Selection does not bypass validation: choosing an option re-enters the same owner-scoped
resolver with an explicit `referenceKey`. There is no hidden auto-execution, and the
architecture's existing turn boundary is preserved.

---

## 5. WEB / MOBILE PARITY

`CHOICE` maps to `choice` in **both** registries — `TRUSTED_PRESENTATION_REGISTRY.CHOICE` and
`MOBILE_PRESENTATION_REGISTRY.CHOICE` — so one semantic definition renders on both, with
device-specific presentation only. No mobile reference semantics were added and no domain
screen exists.

```
WEB_MOBILE_CHOICE_PARITY = PASS
```

---

## 6. TESTS

| Suite | Result |
|---|---|
| New: `reference-scope-and-choice.test.ts` | **19 / 19** |
| Main suite | **830 / 830** (811 + 19), 56 files |
| Block 2 | **101 / 101** |
| Block 3 | **133 / 133** |
| Block 3.1 | **65 / 65** — unchanged after five call-site migrations |
| `tsc -b` | **PASS** (exit 0) |
| Web build | **PASS** (8.64s) |
| Mobile TypeScript | **10** — unchanged, all pre-existing |
| Metro iOS/Android | `BLOCKED_BY_ENVIRONMENT` |

**No assertion was weakened.** One test I wrote failed first because *my expectation* was
wrong — `candidates` in `data` reaches the result-set branch before `structured` — so I
corrected the expectation, not the behaviour. The point it was making held either way: the
caller did not get `CHOICE`.

---

## 7. COUNTERS

```
WAVE_1_2                          = PASS

RESOLVE_THIS_OWNER_SCOPED         = YES
RESOLVE_ORDINAL_OWNER_SCOPED      = YES
CROSS_OWNER_REFERENCE_LEAKS       = 0

CHOICE_REACHABLE                  = YES
CHOICE_GENERIC                    = YES
FORM_SEMANTICS_PRESERVED          = YES
AMBIGUOUS_REFERENCE_TO_CHOICE     = PASS
CHOICE_TO_TRUSTED_RESOLUTION      = PASS
WEB_MOBILE_CHOICE_PARITY          = PASS

DOMAIN_SPECIFIC_CORE_FILES_ADDED  = 0

BLOCK_2                           = 101 / 101
BLOCK_3                           = 133 / 133
BLOCK_3_1                         = 65 / 65
MAIN_SUITE                        = 830 / 830
TYPECHECK                         = PASS
WEB_BUILD                         = PASS
MOBILE_BUILD_OR_METRO             = BLOCKED_BY_ENVIRONMENT

REAL_MODEL_USED                   = NO
REAL_MONEY_USED                   = NO
PRODUCTION_DATABASE_TOUCHED       = NO
ARCHITECTURE_FREEZE_VIOLATIONS    = 0
READY_FOR_PRODUCTION_MODEL_GATEWAY= YES
```

---

## 8. WHAT A REVIEWER SHOULD DOUBT FIRST

1. **`decidePresentation` was modified.** It is the frozen decision layer, and this wave added
   a branch to it. The branch is deterministic, uses only existing contract fields, is placed
   *inside* the existing `inputRequired` gate so no other path changed, and is covered by
   both-present and empty-list tests. But it is a change to a frozen component and should be
   read as one.
2. **`resolveThis` has no production caller**, so its owner scoping is currently proven only
   by tests. That is the right direction — the primitive is safe before someone reaches for
   it — but it is not exercised by live traffic.
3. **Ambiguity is still structural, not semantic.** Two observable subjects produce a CHOICE
   because there are two, not because JASIM understood a sentence naming one. Free-text
   disambiguation remains `BLOCKED_BY_MODEL_GATEWAY`.
4. **Block 3.1 tests were edited.** Only call sites, and the suite still reports 65/65 — but
   any edit to an inherited suite deserves a look at the diff rather than trust in this line.

END OF WAVE 1.2 REPORT.
