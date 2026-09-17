# JASIM — COMPLETION WAVE 1.1: CONVERSATIONAL SUBJECT RESOLUTION

**Branch:** `claude/runtime-experience-wave-1`
**Scope:** close the one generic gap left by Wave 1 — a conversation could not reach the
observation path because nothing resolved "which subject is this conversation about?".

> A copy also exists at `.local/tasks/jasim-completion-wave-1-1-report.md`. `.local/` is
> gitignored, so this committed copy is the one that survives.

---

## 1. NO NEW REFERENCE CONTRACT — AND NONE WAS NEEDED

`reference_bindings` already stores everything a presentation subject requires:

```
ownerId · conversationId · referenceKey ("ordinal:2", "deictic:this", "named:…")
targetKind · targetId · supersededAt
```

That `(targetKind, targetId)` pair has **the same shape** as
`observations.(subjectKind, subjectId)`. A binding already *is* a subject reference. Adding a
`subjectRef` field would have created a second reference system to keep in step with the
first — the exact failure this wave was asked to avoid.

```
EXISTING_REFERENCE_MODEL_REUSED      = YES
NEW_GENERIC_REFERENCE_CONTRACT_ADDED = NO
```

## 2. THE ONE QUESTION THAT WAS ADDED

`api/runtime/subject-resolution.ts` answers something the existing machinery could not:
**of the things this conversation currently refers to, which can actually be observed?**

That question is what makes ambiguity tractable without guessing:

- A conversation holding a moving subject **and** a laptop from a result set has two live
  references, but only one has evidence — so there is nothing to choose between.
- A conversation holding two observed subjects has a genuine ambiguity, and the honest answer
  is a question. The thing that would otherwise be guessed at is a person's location.

The restriction is domain-neutral by construction: it asks whether **evidence exists**, never
what the subject **is**. Observation type is part of the question, so a status reference is
not a location reference.

## 3. AUTHORITY

Owner and conversation scope are conditions in the SQL of every query, not checks afterwards.
There is **no parameter anywhere in the module** through which a caller or a model can supply
a `(kind, id)` pair and have it treated as resolved. A model will be able to *propose* a
referent; it can never *be* one.

Another owner's binding returns `NOT_FOUND`, indistinguishable from an empty conversation, so
the resolver cannot be used to confirm what exists.

## 4. REAL LOCAL ACCEPTANCE — 9 CASES OVER HTTP

| # | Case | Result |
|---|---|---|
| 1 | Nothing bound | `NOT_FOUND` / `NO_BINDING` → STATUS, no map |
| 2 | Bound but never observed | `NOT_FOUND` / `NO_OBSERVABLE_BINDING` |
| 3 | **The target path** | `RESOLVED` / `FRESH` → TRACKER + **MAP** @ 29.3759, 47.9774, subject `generic_subject:subj-A` via `deictic:this` |
| 4 | Two observable subjects | **`AMBIGUOUS`** → clarification, no coordinates, no silent pick |
| 5 | Explicit reference key | `RESOLVED` → MAP @ 29.1, 47.1 |
| 6 | That subject's reading goes stale | `STALE` → **map gone** |
| 7 | Second binding superseded | unambiguous again → **map returns** |
| 8 | Foreign conversation id | `NOT_FOUND` — existence not confirmed |
| 9 | Unauthenticated | **401** |

## 5. TESTS

22 new tests against a real database: resolution, cross-turn continuity, unobserved
references, observation-type scoping, ambiguity and its explicit-key resolution, superseded
bindings, and five privacy cases — including a shared subject id whose evidence belongs to
someone else.

| Suite | Result |
|---|---|
| Main suite | **811 / 811** (789 + 22) |
| Block 2 | **101 / 101** |
| Block 3 | **133 / 133** |
| Block 3.1 | **65 / 65** |
| `tsc -b` | **PASS** |
| Web build | **PASS** (8.49s) |
| Mobile TypeScript | 10 — unchanged, all pre-existing |
| Metro iOS/Android | `BLOCKED_BY_ENVIRONMENT` |

## 6. FINDINGS RECORDED, NOT CHANGED

1. **`resolveThis` / `resolveOrdinal` query by conversation alone**, with no owner condition.
   The live path is safe because callers pass an already-owner-scoped conversation, so this is
   a `DEFENSE_IN_DEPTH_GAP`, not a proven exploit. Changing their signatures touches Block 3.1
   and was outside this wave.
2. **`decidePresentation` emits no `CHOICE`**, although the primitive exists and both
   renderers support it. Clarification therefore arrives as a `FORM`.

Both are addressed in Wave 1.2.

## 7. COUNTERS

```
WAVE_1_1                              = PASS
EXISTING_REFERENCE_MODEL_REUSED       = YES
NEW_GENERIC_REFERENCE_CONTRACT_ADDED  = NO
CONVERSATION_TO_CANONICAL_SUBJECT     = PASS
SUBJECT_TO_OBSERVATION                = PASS
OBSERVATION_TO_PRESENTATION           = PASS
AMBIGUOUS_REFERENCE_HANDLING          = PASS
CROSS_OWNER_SUBJECT_ACCESS            = 0
ARBITRARY_CLIENT_SUBJECT_AUTHORITY    = 0
WEB_MOBILE_SEMANTIC_REFERENCE_PARITY  = PASS
GENERIC_MAP_RUNTIME_PATH              = PASS
FREE_TEXT_MAP_INTENT_WITHOUT_MODEL    = BLOCKED_BY_MODEL_GATEWAY
G2_REMAINING_UNREACHABLE_NEEDS        = 6
DOMAIN_SPECIFIC_CORE_FILES_ADDED      = 0
BLOCK_2 = 101/101 · BLOCK_3 = 133/133 · BLOCK_3_1 = 65/65 · MAIN = 811/811
TYPECHECK = PASS · WEB_BUILD = PASS · MOBILE = BLOCKED_BY_ENVIRONMENT
REAL_MODEL_USED = NO · REAL_MONEY_USED = NO
PRODUCTION_DATABASE_TOUCHED = NO · PRODUCTION_DEPLOYMENT = NO
ARCHITECTURE_FREEZE_VIOLATIONS = 0
READY_FOR_PRODUCTION_MODEL_GATEWAY = YES
```

**The honest limit:** free-text intent ("جاسم اعرض لي السائق") still requires a model to
classify. The runtime contract is now ready and reachable; interpreting an unseen sentence is
`BLOCKED_BY_MODEL_GATEWAY` and was not faked.

END.
