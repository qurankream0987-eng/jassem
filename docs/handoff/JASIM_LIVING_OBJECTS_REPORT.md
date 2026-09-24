# JASIM — LIVING OBJECT RUNTIME · HANDOFF REPORT

Base: `0f6e59f6f865e92b16a86d3b19eb5a304a1e45ed`
Branch: `claude/runtime-experience-wave-1`

---

## 1 · WHAT THE TRACE FOUND, BEFORE ANY SCHEMA

The repository already contained a living-objects concept, and it was not a
stub. `api/runtime/living-object-projection.ts` (489 lines) derives a rail on
every query from four execution artifacts — `runtime_task`, `runtime_run`,
`generated_system`, `smart_bubble` — groups them, ranks them by attention and
serves `runtime.activeLivingObjects`. `PERSISTENT_LIVING_OBJECT` was already a
routable destination and was NOT in the router's `NOT_IMPLEMENTED` set.

So the phase did not begin by building a missing thing. It began by finding out
what the one name `LIVING_OBJECT_RUNTIME` was actually covering. It was **four**
things:

1. **Subject breadth.** `LivingObjectReference.kind` was closed over JASIM's own
   execution artifacts. An agreement, a commitment, a transaction, a held
   reservation, an engagement, a negotiation and a standing monitor could not be
   followed. «أين وصل طلبي؟» is a question about an obligation; the rail could
   only point at a run.
2. **A durable handle.** Nothing recorded *that* a scope follows a subject.
   Hiding, resolving and releasing had nowhere to live, and
   `SURFACE_EXIT != LIVING_OBJECT_DELETE` was not expressible.
3. **Acting scope.** The rail was `ownerId`-scoped while world, monitoring and
   realtime all resolve an acting scope.
4. **Reconciliation.** A follower had no cursor.

`trackSessions` was inspected and deliberately left alone: it is a
location-observation session with viewer precision, not a general follow handle.
It is untouched by this phase.

**PRESERVE → CONNECT → EXTEND** was applied. The rail is preserved unchanged,
including its procedure. Nothing was duplicated.

---

## 2 · WHAT WAS BUILT

| file | lines | what |
| --- | --- | --- |
| `api/runtime/living-object-runtime.ts` | ~820 | the runtime |
| `db/migrations-pg/0021_living_objects.sql` | 60 | one table |
| `db/schema-block2.ts` | +75 | `livingObjects` |
| `tests/block31/living-object-runtime.test.ts` | 35 tests | live proof |
| `tests/unit/living-object-contract.test.ts` | 24 tests | contract proof |
| `docs/architecture/JASIM_LIVING_OBJECTS.md` | — | the shape |

Wired into: `realtime-runtime.ts` (entity kind `living_object`),
`block2/jobs.ts` (reconciliation inside the existing sweep),
`routers/runtime.ts` (five procedures), `jasim-runtime.ts` (the conversation
branch and one generic materialization hook).

**Eleven subject kinds, zero domain types:**
`run · task · world · bubble · agreement · commitment · transaction ·
reservation · engagement · negotiation · monitor`

Each has one reader that reads its own canonical table. The readers are the only
door to subject truth in the module.

---

## 3 · THE COUNTERS

```
DOMAIN_LIVING_OBJECT_TYPES_ADDED   = 0
DOMAIN_NOUN_BRANCHES               = 0
TEST_ID_BRANCHES                   = 0
SCENARIO_NAME_BRANCHES             = 0
EXAMPLE_PHRASE_BRANCHES            = 0
SHAWARMA_BRANCH                    = 0
BROASTED_BRANCH                    = 0
TRANSLATOR_BRANCH                  = 0
DUPLICATE_OPERATIONAL_TRUTH        = 0
SECOND_SCHEDULERS_ADDED            = 0
SECOND_EVENT_LEDGERS_ADDED         = 0
SECOND_CURSOR_MODELS_ADDED         = 0
DOMAIN_REALTIME_CHANNELS_ADDED     = 0
PRODUCTION_FAKE_MARKET_DATA_ADDED  = 0
FAKE_PROVIDER_ADDED                = 0
CONVERSATION_HISTORY_AS_OPERATIONAL_TRUTH = 0
MODEL_INVENTED_SUBJECTS            = 0
EVERY_TURN_BECOMES_LIVING_OBJECT   = NO
```

Each of the first eight is asserted from the module's own source, with string
literals searched separately from identifiers so that a word *discussed in a
comment* is never confused with a word *branched on*.

`DUPLICATE_OPERATIONAL_TRUTH = 0` is asserted three ways: the migration declares
no `status`/`title`/`progress`/`payload` column; `information_schema` is queried
live and checked; and the only table the module ever `.update(`s is
`living_objects`.

---

## 4 · THE SEPARATIONS, AND WHERE EACH IS PROVEN

| law | proof |
| --- | --- |
| `LIVING_OBJECT != CANONICAL_SUBJECT` | the subject moves; the projection follows with no write to the handle |
| `DUPLICATE_OPERATIONAL_TRUTH = 0` | live `information_schema` check; no operational column exists |
| `HIDE != CANCEL` | after hiding, the commitment still reads `active` |
| `CANCEL != DELETE` | the module never calls `.delete(` on anything |
| `RESOLVED != ERASED` | resolving leaves the handle and the subject both intact |
| `SURFACE_EXIT != LIVING_OBJECT_DELETE` | a hidden handle is still returned by `includeHidden` |
| `UNKNOWN != FALSE · UNKNOWN != ABSENT` | an unreadable subject gives `UNKNOWN` and an empty title, never a guess |
| `CLAIMED_COMPLETE != VERIFIED_COMPLETE` | a commitment claiming `completed` with `verification = PENDING` projects as `VERIFYING` |
| `LLM != AUTHORITY` | the envelope has no `subjectKind`, `subjectId`, `scopeId` or `status`, and is `.strict()` |
| `EVERY_TURN_BECOMES_LIVING_OBJECT = NO` | three real discovery turns through the boundary leave zero handles |

---

## 5 · SECURITY NEGATIVES, ALL PROVEN LIVE

- A **guessed id** and a **forbidden id** produce the identical refusal — a
  refusal that distinguished them would make guessing an existence oracle.
- A handle in **another scope** is `NOT_FOUND`, never `FORBIDDEN`.
- **Cross-owner**: a stranger to an obligation cannot follow it; a party can.
- **Revoked standing**: authorization is re-asked on every read, so removing a
  beneficiary closes the projection immediately, with the handle left in place
  saying it cannot be read.
- **Deleted subject**: the handle survives and reports `unreadable`.
- A handle the **model named** but the acting scope does not hold is refused at
  the conversation boundary.
- Events carry exactly four keys — `livingObjectId · subjectKind · followState ·
  surfaceState` — and a commitment whose `termKey` was a secret string proves
  the secret never reaches the ledger.

---

## 6 · WHAT MOVED IN THE CATALOG, AND WHAT DID NOT

```
                      before   after
EXECUTABLE              103     110    (+7)
OBSERVABLE               87      88    (+1)
PLANNABLE               161     162    (+1)
VERIFIABLE               86      87    (+1)
generalGaps              11      10    (−1)
notYetImplemented        20      13    (−7)

total 162 · holdouts 16 · ideas 7
REPRESENTABLE 162 · ROUTABLE 162 · PRESENTABLE 162 · PERSISTENT 145
blockedByProvider 41 · blockedByEnvironment 2
```

Six scenarios blamed `LIVING_OBJECT_RUNTIME`. **Five are now unblocked**
(`route.living_object`, `realtime.order_status`, `realtime.negotiation_session`,
`realtime.application`, `realtime.booking`, `realtime.price_monitor` — five
realtime plus the routing one).

**One did not move and must not.** `realtime.delivery_tracker` — «أرني السائق
على الخريطة» — is still held by `LOCATION_OBSERVATION`. The delivery is
followable like anything else; where the driver *is* is not observable, and a
map must never invent one. Its `OBSERVABLE` and `VERIFIABLE` gates remain
`BLOCKED_BY_PROVIDER`.

`LOCATION_OBSERVATION` was **not** implemented as a fake to green the example.

### Gap ranking after this phase

```
BUSINESS_DATA_SOURCE_ADAPTER       3
EXTERNAL_DISCOVERY_PROVIDER        3
LOCATION_OBSERVATION               2
SUBSCRIPTION_RUNTIME               2
SPONSORED_DISCOVERY_RUNTIME        2
DATA_ERASURE_POLICY                1
DELEGATED_ACCESS_RUNTIME           1
STANDING_ACTION_AUTHORITY          1
RESOURCE_SCOPED_PERMISSION_GRANT   1
SCOPE_BRANDING_SURFACE             1
```

---

## 7 · INHERITED EXPECTATIONS THAT CHANGED

Three, each disclosed in full at the test itself.

**(a) `tests/unit/realtime-contract.test.ts` — "names no database table in the
subscription vocabulary".**
*Asserted:* no entity kind contained any of four hand-listed table names, or the
character `_`.
*Why it must change:* `_` was a **proxy** for "looks like a table name". The new
entity kind `living_object` is a semantic name for a canonical subject; the
table is `living_objects`. The proxy fired on a correct name.
*Now asserts:* no entity kind matches **any** table the schema actually
declares, read from the schema files.
*Why not weaker:* the old list named four tables and would have missed `runs`,
`bubbles`, `commitments`, `transactions` and every table added after it was
written. The new one cannot miss any, and keeps catching new ones for free.

**(b) `tests/unit/generality-catalog.test.ts` — "blames no realtime runtime of
its own".**
*Asserted:* every realtime scenario named some gap, and that gap was in
`GENERAL_GAPS`.
*Why it must change:* five named `LIVING_OBJECT_RUNTIME`, now closed and no
longer a member.
*Now asserts:* no realtime scenario blames any transport name at all, and one
that still names a blocker names a real one.
*Why not weaker:* the original point — realtime never invents a gap of its own —
is asserted unchanged and now also positively, which the old version never did.

**(c) `tests/unit/generality-catalog.test.ts` — "closing it greened nothing".**
*Asserted:* `EXECUTABLE` was not `PASS` for any realtime scenario.
*Why it must change:* that was true **of the realtime phase** and said so — what
those scenarios needed was the living object, not the socket. The living object
now exists, so the gate it was holding is the gate that moves.
*Now asserts:* `EXECUTABLE` passes for all six, exactly five are unblocked, and
the sixth is held by the gap it was always held by.
*Why not weaker:* the old test forbade one gate from passing. The new one pins
which gates pass and which do not, for every scenario, and keeps the refusal
that mattered.

No inherited test was deleted or loosened.

---

## 8 · ONE CORRECTION MADE DURING THE PHASE

A contract assertion of my own searched the whole module source for domain nouns
and fired on `orderBy` — a drizzle method, not a branch. It was replaced by one
that searches **string literals**, which is where a noun comparison must live,
plus two companions: no `process.env` or test flag is read, and the module
contains exactly one `switch` (the status normalization), so there is nowhere a
per-kind branch could hide. That is stricter, not looser: the old form proved
nothing about branching while flagging a correct identifier.

---

## 9 · REGRESSION

```
MAIN                  2307 passed ·  27 skipped ·  95 files
BLOCK 2                121 passed              ·  16 files
BLOCK 3 + BLOCK 3.1    766 passed              ·  54 files
  (of which the new living object suite: 35 passed)
FROZEN_EVALUATION       90 passed              ·   5 files

tsc -b                 clean
web build              clean  (vite, 10.98s)
mobile tsc --noEmit    clean
expo export --platform web   clean
```

Block 2, Block 3, Block 3.1 and the frozen evaluation each run **alone** with
`--no-file-parallelism`, per the standing rule in
`docs/handoff/JASIM_TEST_SUITE_CONTINUITY.md`.

---

## 10 · WHAT WAS NOT DONE, DELIBERATELY

Per the brief's explicit list, none of these were implemented:
Restaurant Provider · fake restaurant API · food database · Location provider ·
Maps provider · Sponsored Discovery · Subscription Runtime · Business Dashboard ·
ERP adapter · any new Agreement, Transaction, Realtime or permission runtime.

No production seed data, no fake external provider rows, no domain dispatch
metadata, no production deploy.

`MOBILE_DEVICE_PROOF = NOT_RUN` — no device or emulator proof was performed.
