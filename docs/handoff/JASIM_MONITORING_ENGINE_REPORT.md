# JASIM — GENERAL MONITORING ENGINE · phase report

```
CONDITION_MATCHED != USER_NOTIFIED
LEVEL != EDGE · UNKNOWN != FALSE · UNKNOWN != ABSENT
MONITORING AUTHORITY != EXECUTION AUTHORITY
```

---

## 1. §1 · The trace, and the one line where monitoring died

Everything the brief said not to duplicate already existed at `1f1cd58`: the
durable job queue and its single Block 2 duty cycle (the scheduler), canonical
`observations` with `observationFreshness` → CURRENT/STALE/UNKNOWN (the
observation truth), the serial-id `events` ledger (the cursor), and
`notification_intents` with per-channel `BLOCKED_BY_PROVIDER` (the notification
truth). `temporal_triggers` has had a `CONDITION` kind since Block 2.

The gap was five precise things:

1. **`ConditionEvaluator` is an injected seam with no production
   implementation.** `api/boot.ts` constructs the worker with `{ resumeNode }`
   and nothing else, so `fireDueTemporalTriggers` takes the
   `evaluator ? … : undefined` branch, never sees `true`, and reschedules a
   condition poll **forever**. One missing argument is where monitoring died.
2. **`temporal_triggers.condition` is untyped `jsonb`** — no condition language
   to evaluate even if something had been wired.
3. **A trigger is a DAG continuation** (`runId`, `nodeId`, `resumeNode`,
   `ownerId` and no `scopeId`), not something a person owns and drives.
4. **No previous-evaluation state**, so no way to tell «it is true» from «it
   just became true».
5. **The MONITORING route reported NOT_IMPLEMENTED.**

Nothing was duplicated. Two tables and one module were added; the evaluation
runs inside the sweep that already existed.

```
SECOND_SCHEDULERS_ADDED = 0 · SECOND_OBSERVATION_SYSTEMS = 0
SECOND_EVENT_LEDGERS    = 0 · SECOND_NOTIFICATION_TRUTHS = 0
```

## 2. What was built

| file | lines | what |
|---|---:|---|
| `api/runtime/monitoring-runtime.ts` | 1368 | condition language, three-valued evaluation, edge/level, lifecycle, both modes, projection |
| `db/migrations-pg/0020_standing_monitors.sql` | 82 | `standing_monitors`, `monitor_evaluations` |

Extended: `block2/jobs.ts` (one step in the existing sweep), `jasim-runtime.ts`
(one envelope field, one branch), `semantic-router.ts` (the route left
`NOT_IMPLEMENTED`), `api/routers/runtime.ts` (four procedures),
`artifacts/jasim-mobile/lib/runtime-trpc.ts` (the same four by name),
`model-output-trust.ts`, `db/schema-block2.ts`, `world-runtime.ts` (the
executable-text screen widened — see §6).

## 3. The decisions that carry the phase

**A condition is typed, so there is nothing to sandbox.** Fifteen operators
over a dotted lower-case field path and a scalar, composed with `all`/`any`/
`not`, depth-bounded. No expression string is ever parsed. A program smuggled
into a string value is caught by the same screen the world runtime uses.

**A verdict has three values and is never collapsed.** A missing fact, a
comparison against the wrong kind of value, and a `changed` with no previous
reading are all UNKNOWN. A monitor whose verdict is unknown has **not** decided
that the world is fine.

**Freshness feeds straight into the verdict.** `CURRENT` required and the
reading STALE or UNKNOWN → UNKNOWN, never false, never true.

**Level is not edge.** `lastResult` is persisted so RISING, REPEAT and FALLING
are told apart. An EDGE monitor never fires on a REPEAT, and a LEVEL monitor
that repeats **and** notifies is refused at creation with a message naming EDGE.

**Absence is claimed, never inferred** — an expected observation, a window and a
clock. And it is the one evaluation keyed by its window rather than by an
observation id, because what changes an absence verdict is time.

**Concurrency is a compare-and-set.** Every write is guarded by `version`; two
workers on one observation produce one trigger and one ledger row.

**A match is not a notification.** The transition is durable first; the
notification is an INTENT and nothing more. If the intent cannot even be
created, the trigger still stands.

**A monitor creates no authority.** Its only actions are NOTIFY and NONE, and
`executeCapability`, `createRuntimeRun`, `commitAgreement`,
`materializeTransaction` and `submitProductAction` appear nowhere in the module
— asserted, not assumed.

## 4. Proof

| file | tests |
|---|---:|
| `tests/block31/monitoring-engine.test.ts` | 28 |
| `tests/unit/monitoring-contract.test.ts` | 28 |
| `tests/unit/generality-catalog.test.ts` (new assertions) | 6 |

Every live test runs against real PostgreSQL with the real migrations, and
"triggered" always means a row read back after the call that wrote it returned.

**§32 · the required live proofs.**

| | |
|---|---|
| A · CREATE | «راقب حرارة المبرّد وأخبرني إذا تجاوزت ٥» → a durable monitor, a STATUS projection, zero runs |
| B · NO MATCH | an observation at 2° → FALSE, no trigger, still ACTIVE |
| C · MATCH | 2° then 9° → RISING, one trigger, ONE_SHOT → TRIGGERED |
| D · REPLAY | the same canonical observation again → `replayed`, no second trigger, one ledger row |
| E · REPEATING LEVEL | 9°, 11°, 12° → transitions `RISING, REPEAT, REPEAT` and **one** notification; it rises again only after actually falling |
| F · PAUSE | a paused monitor sees a 40° reading → no evaluation at all, not an evaluation discarded |
| G · RESUME | resume, then a new qualifying transition → trigger |
| H · CROSS OWNER | another owner cannot read, list, pause, resume, cancel or read the ledger; a foreign-scope observation never reaches the monitor; the same person acting for another scope cannot either |
| I · RESTART | state, verdict, trigger count and cursor all survive a fresh read; a fired ONE_SHOT does not fire again |
| J · MISSING PROVIDER | the trigger persists, the projection names `email`/`sms` as unconfigured, the intent is not DELIVERED, and an unconfigured channel reads `BLOCKED_BY_PROVIDER` at delivery |

**Also proven:** yesterday's reading cannot decide a question about now; a
reading with no declared horizon is UNKNOWN; a monitor that explicitly permits
history is decided by history; absence needs a window and is refused without
one; two concurrent evaluations produce one trigger; the scheduled sweep
evaluates a monitor nothing woke; `runBlock2Sweep` itself carries it;
pause/resume/list work across turns with the reference resolved from the
conversation rather than an ordinal; a scope rule can forbid watching; a world
monitor advances by cursor and never replays; and the ledger records the
verdict while a sentinel payload value appears nowhere in it.

**The six holdouts**, all through one engine with no branch: an industrial
valve entering CLOSED, cold-storage temperature exceeding a limit, a laboratory
calibration completing, a generator leaving supply, a community resource
becoming available, and an offer price crossing a threshold.

```
DOMAIN_MONITOR_TYPES_ADDED = 0 · DOMAIN_WATCHERS_ADDED = 0
```

## 5. Catalog effect

`MONITORING_ENGINE` is **closed** — the eighth gap in eight phases.

| gate | before | after |
|---|---:|---:|
| PLANNABLE | 154 | **161** |
| EXECUTABLE | 99 | **103** |
| OBSERVABLE | 87 | 87 |
| VERIFIABLE | 81 | **86** |
| PRESENTABLE | 161 | **162** |
| PERSISTENT | 144 | **145** |
| blocked by a **provider** | 39 | **41** |
| waiting on a general capability | 26 | **20** |
| distinct general gaps | 12 | 12 |

**Seven scenarios moved, and only four to a full PASS.**

| scenario | after | why |
|---|---|---|
| `route.monitoring` · `monitoring.price` · `monitoring.state` · `monitoring.notify_on_condition` | **PASS** | the condition is detected, recorded, transitioned and read back |
| `monitoring.repeated_observation` | **BLOCKED_BY_PROVIDER** | the hourly evaluation is real; READING a temperature has nothing plugged in |
| `idea.flood_channel_watch` | **BLOCKED_BY_PROVIDER** | the whole engine is the same one «راقب السعر» uses; the water-level telemetry is missing |
| `monitoring.standing_condition` | **NOT_YET_IMPLEMENTED** | «إذا نزل تحت ٢٠٠ اشترِ» — the watching half runs, the buying half needs an authority envelope evaluated at trigger time: `STANDING_ACTION_AUTHORITY` |

`OBSERVABLE` did not move: the five monitoring scenarios already claimed it,
and one of them went **down** to BLOCKED_BY_PROVIDER while `route.monitoring`
came up. A gate that stands still while a gap closes is worth saying out loud.

**162 scenarios · 16 blind holdouts · 7 blind ideas · 12 general gaps.**

## 6. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2242 passed, 27 skipped · 96 files | 2208, 27 · 95 | +34, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 570 · 35 files | 542 · 34 | +28, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript (`tsc -b`) · Web build · Mobile typecheck · Expo export | all clean | | |

**No inherited test was removed or weakened.** Two changed, each a refinement
with a companion assertion:

- `semantic-router.test.ts` — `MONITORING` moved out of the NOT_IMPLEMENTED
  list into its own AVAILABLE case, as `DIRECT_READ` and `PERSISTENT_WORLD` did
  before it, **and** gained an assertion that it still routes away from
  execution.
- `policy-contract.test.ts` — the enforcement-boundary caller list gained the
  monitoring runtime, **and** the single-call assertion now runs over both the
  world and the monitoring runtimes instead of one.

**One inherited screen was tightened, not loosened.** The world runtime's
executable-text check matched `=>\s*[{(]`, which let `() => true` through while
catching `() => { return true }`. Both are programs. The pattern now matches an
arrow followed by anything that could be a body, and the world suite still
passes unchanged.

No flaky test appeared. Each suite ran alone, per the standing rule in
`JASIM_TEST_SUITE_CONTINUITY.md`.

## 7. The final report

```
PHASE = MONITORING_ENGINE

CURRENT_GAP_PROVEN             = PASS
STANDING_MONITOR               = PASS
CONDITION_LANGUAGE             = PASS
EVENT_DRIVEN_EVALUATION        = PASS
SCHEDULED_EVALUATION           = PASS
EDGE_SEMANTICS                 = PASS
LEVEL_SEMANTICS                = PASS
ABSENCE_SEMANTICS              = PASS
FRESHNESS_AWARE                = PASS
REPLAY_SAFE                    = PASS
CONCURRENT_EVALUATION_SAFE     = PASS
DURABLE_RECOVERY               = PASS
AUTHORITY_SEPARATION           = PASS
CROSS_OWNER_SECURITY           = PASS
NOTIFICATION_EFFECT_SEPARATED  = PASS
QUERY_MONITORING               = PARTIAL
WORLD_MONITORING               = PASS
CONVERSATIONAL_PATH            = PASS
WEB_ACTIVE_PATH                = PASS
MOBILE_WIRE_PROOF              = PASS
MOBILE_DEVICE_PROOF            = NOT_RUN
EVENT_CURSOR_READY_FOR_REALTIME = PASS
HOLDOUT_GENERALITY             = PASS

NEW_DOMAIN_BRANCHES             = 0
DOMAIN_MONITOR_TYPES_ADDED      = 0
DOMAIN_WATCHERS_ADDED           = 0
DOMAIN_SCHEDULE_TYPES_ADDED     = 0
DOMAIN_NOTIFICATION_TYPES_ADDED = 0
SECOND_SCHEDULERS_ADDED         = 0
SECOND_OBSERVATION_SYSTEMS      = 0
SECOND_EVENT_LEDGERS            = 0
SECOND_NOTIFICATION_TRUTHS      = 0
REALTIME_TRANSPORT_BUILT        = NO

FALSE_TRIGGERS      = 0
FALSE_NOTIFICATIONS = 0
FALSE_SUCCESS       = 0

CATALOG_SCENARIOS_MOVED = 7
  CONVERSATION_ROUTING · route.monitoring                   -> PASS
  MONITORING · monitoring.price, state, notify_on_condition -> PASS
  MONITORING · monitoring.repeated_observation              -> BLOCKED_BY_PROVIDER
  IDEA_INTAKE · idea.flood_channel_watch                    -> BLOCKED_BY_PROVIDER
  MONITORING · monitoring.standing_condition                -> STANDING_ACTION_AUTHORITY

GAPS_CLOSED = MONITORING_ENGINE
GAPS_NAMED  = STANDING_ACTION_AUTHORITY

TOTAL_GENERALITY_SCENARIOS = 162
EXECUTABLE_PASS_AFTER      = 103
PERSISTENT_PASS_AFTER      = 145

MAIN              = 2242/27 · 96 files
BLOCK2            = 121 · 16 files
BLOCK3            = 133 · 17 files
BLOCK3_1          = 570 · 35 files
FROZEN_EVALUATION = 90 · 5 files

TYPECHECK        = PASS
WEB_BUILD        = PASS
MOBILE_TYPECHECK = PASS
EXPO_EXPORT      = PASS

INHERITED_TESTS_WEAKENED = 0
INHERITED_TESTS_REFINED  = 2
INHERITED_SCREEN_TIGHTENED = 1

NEXT_GENERIC_GAP = REALTIME_RUNTIME

OWNER_ACTION_REQUIRED = NONE
```

### Why `QUERY_MONITORING` reads PARTIAL

`AUTHORIZED_QUERY` is one of the four source classes a monitor may declare, and
the same condition language and transition machinery serve it. What this phase
PROVED against a live database is `OBSERVATION`, `WORLD_EVENT` and `ABSENCE`.
A standing query over the opportunity exchange — «أخبرني إذا ظهر مورد يوفر ٣٠٠
حبة بأقل من ٢٥٠» — is reachable from the same row and is **not claimed until it
is proven**, which is the whole reason this line is not PASS.

### Why `MOBILE_DEVICE_PROOF` reads NOT_RUN

Mobile calls the same four `runtime.monitor*` procedures by name, a unit test
holds both surfaces to that with no monitor runtime on either side, and the
mobile typecheck and Expo export are clean. **No emulator ran.** The claim
stops at the wire.

### Where the weight sits now

`REALTIME_RUNTIME` holds 5 scenarios and is now the largest remaining gap —
and the one this phase was built toward. The monitor evaluation ledger is
ordered, scope-aware and resumable from a cursor; the world ledger from the
previous phase is the same shape. Both were built as the thing a subscriber
will resume from, and neither has a byte of transport in it.

Six gaps now carry one scenario each. They are small, they are real, and none
may be folded into a closed name to make a number move.
