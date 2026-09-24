# JASIM — GENERAL REALTIME RUNTIME · phase report

```
REALTIME TRANSPORT  != TRUTH
TRANSPORT_CONNECTED != DATA_CURRENT
```

---

## 1. §1 · The trace, and the five things that were missing

A WebSocket server already existed at `486e2ad`, authenticated at the upgrade,
with a connection map and a ping/pong. The canonical `events` ledger already
existed, serial-ordered and scope-tagged, and every runtime already appended to
it. Neither was rebuilt.

The gap was five precise things:

1. **The socket authorized a subscription and threw it away.**
   `handleSubscription` checked a bubble or a run, replied «subscribed», and
   nothing ever routed an event by it.
2. **No cursor**, so a disconnect lost everything between.
3. **Nothing connected the ledger to the socket** — `emitToUser` served one
   notification adapter and nothing else.
4. **One socket per user**: `clients.set(userId, ws)` overwrote, so a second
   tab silently killed the first.
5. **No client at all** — nothing in the web app or the mobile app opened one.

```
SECOND_SOCKET_SERVERS_ADDED = 0 · SECOND_EVENT_LEDGERS_ADDED = 0
SECOND_SCHEDULERS_ADDED     = 0 · DOMAIN_REALTIME_CHANNELS_ADDED = 0
```

## 2. What was built

| file | lines | what |
|---|---:|---|
| `api/runtime/realtime-runtime.ts` | 727 | subscription contract, authorization, envelope, cursor, resync, backpressure, tailer, metrics |
| `src/lib/realtime-client.ts` | 226 | state machine, ordering, dedupe, backoff — shared verbatim with mobile |
| `src/hooks/use-realtime.ts` | 160 | the web socket lifecycle |
| `artifacts/jasim-mobile/lib/realtime.ts` | 187 | the same semantics, the OS lifecycle that differs |

Extended: `api/core/websocket.ts`, `block2/jobs.ts`, `monitoring-runtime.ts`,
`api/routers/runtime.ts`, `src/hooks/useJasimChat.ts`, `model-output-trust.ts`,
`artifacts/jasim-mobile/lib/runtime-trpc.ts`.

## 3. The decisions that carry the phase

**One stream, one cursor.** Monitors and observations now append a canonical
signal to the `events` ledger every other runtime already writes to, so a
subscriber has one cursor rather than one per subsystem. `monitor_evaluations`
stays what it was: that monitor's own audit ledger.

**One reader.** `tailRealtime` is the only place events leave the ledger, and
both the live push and the reconnect resume go through it — which makes
ordering, deduplication and the stability lag one behaviour instead of three
that drift. Sinks are grouped **by scope**, so a hundred tabs is one query.

**The stability lag is named, not hidden.** A serial id is assigned before
commit, so a cursor may not advance past an event younger than 250 ms. Every
canonical event is appended as its own statement after its state change
committed, which is what makes that bound meaningful rather than hopeful.

**The envelope is an allowlist.** Position, identity, type, instant, scope, a
subject reference, a revision, and closed-vocabulary signals. A new event type
carrying a private field leaks nothing, because nothing it did not declare is
copied. `freshness` travels with the event precisely so a surface can be
connected and still say the reading is stale.

**The client re-reads and never reconstructs.** An event says WHICH canonical
object changed; `useJasimChat` invalidates the query that drew it.

**A second tab no longer kills the first.** The registry is a `Set` per user.

## 4. Proof

| file | tests |
|---|---:|
| `tests/block31/realtime-runtime.test.ts` | 22 |
| `tests/unit/realtime-contract.test.ts` | 28 |
| `tests/unit/generality-catalog.test.ts` (new assertions) | 5 |

Every live test opens **real WebSockets over a real HTTP server** against the
real PostgreSQL ledger. "Delivered" always means a frame a client received on a
wire; "recovered" always means read back after the socket that would have
carried it was destroyed.

| | |
|---|---|
| authorization | a guessed `worldId`/`monitorId` is refused and the refusal does not echo the id; an org outsider is refused and the member is not; a request naming `scopeId`/`ownerId`/`authorized` is refused; malformed and oversized subscriptions are refused, not truncated |
| cross-owner | one owner's events never reach another owner's socket |
| monitor realtime | an evaluation reaches a connected client with no refresh, carrying `result` and `transition` — and never the reading |
| missed catch-up | the socket is **terminated**, two evaluations happen, a new connection resumes from the cursor and gets both, strictly increasing and without repeats |
| world realtime | a mutation advances the subscriber to the correct version, and the client re-reads the projection to confirm it |
| CAS | a stale writer is still refused after watching a change land — **a socket is not a lock** |
| observation realtime | `OBSERVATION_RECORDED` carries `freshness` and no reading |
| cursor | invalid, fractional, NaN, ahead-of-ledger and behind-retention each return a typed `RESYNC_REQUIRED`; a new subscriber starts at the head |
| ordering & dedupe | two overlapping delivery passes produce strictly increasing cursors and unique event ids |
| server restart | the transport is destroyed, the world moves with nothing listening, a new server resumes correctly from the cursor |
| multi-device | two connections for one person both receive, with independent cursors, and neither closes the other |
| backpressure | a full queue returns `RESYNC_REQUIRED` with the cursor, never an arbitrary subset |
| revocation | a revoked member's re-authorization is refused |
| leak | a sentinel in an observation payload and in a world title appears **nowhere** in any frame — asserted as an absence, never printed |
| heartbeat | a live peer survives repeated sweeps; a peer whose TCP stream is paused — open, but silent — is terminated rather than held CONNECTED forever |
| holdouts | a world, a monitor, a device-shaped reading, a calibration and a shared resource all ride one subscription and one ordered cursor |
| metrics | counters and one latency, and the scope id appears in none of it |

## 5. Catalog effect

`REALTIME_RUNTIME` is **closed** — the ninth gap in nine phases.

**And it greened nothing.** Not one gate moved:

| | before | after |
|---|---:|---:|
| every gate's PASS count | unchanged | unchanged |
| distinct general gaps | 12 | **11** |

All five scenarios that named `REALTIME_RUNTIME` — `realtime.order_status`,
`negotiation_session`, `application`, `booking`, `price_monitor` — route to
`PERSISTENT_LIVING_OBJECT`, and every one of them needs a durable tracked
object that «أين وصل طلبي؟» can be **about**. The transport was never what they
were missing. They now blame `LIVING_OBJECT_RUNTIME`, which is the thing that
actually blocks them, and their truthful state says a client subscribes today
and still never claims «مباشر».

A gap closing without a number moving is the honest shape of this phase, and
the catalog asserts it rather than merely recording it.

## 6. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2275 passed, 27 skipped · 97 files | 2242, 27 · 96 | +33, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 592 · 36 files | 570 · 35 | +22, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

**No inherited test was removed, weakened or changed.** The approved socket
test in `block0-auth-boundaries.test.ts` still passes untouched: the legacy
`subscribe` action for bubbles and runs was left exactly as it was, and the
canonical contract arrived beside it as `realtime.subscribe`.

One inherited behaviour was **narrowed, not widened**: `broadcast()` sent a
frame to every connected socket with no authorization check. It now does
nothing, for the same reason `broadcastToMarket` already did nothing — a frame
that reaches everybody has been authorized for nobody. Nothing called it.

## 7. The final report

```
PHASE = REALTIME_RUNTIME

CURRENT_REALTIME_GAP            = PASS
EXISTING_TRANSPORT_REUSED       = YES
SECOND_SOCKET_SERVERS_ADDED     = 0
SECOND_EVENT_LEDGERS_ADDED      = 0
CANONICAL_SUBSCRIPTION_CONTRACT = PASS
AUTHORIZATION                   = PASS
CROSS_OWNER_ISOLATION           = PASS
CROSS_ORG_ISOLATION             = PASS
CURSOR_RESUME                   = PASS
MISSED_EVENT_CATCHUP            = PASS
ORDERING                        = PASS
DEDUPLICATION                   = PASS
RESYNC_REQUIRED                 = PASS
RECONNECT_STATE_MACHINE         = PASS
HEARTBEAT                       = PASS
BACKPRESSURE                    = PASS
SERVER_RESTART_RECOVERY         = PASS
PERMISSION_REVOCATION           = PARTIAL   (closed in the microclosure below)
MONITOR_REALTIME                = PASS
WORLD_REALTIME                  = PASS
OBSERVATION_REALTIME            = PASS
DATASET_REALTIME_READINESS      = PARTIAL
WEB_ACTIVE_PRODUCT              = PASS
MOBILE_CLIENT                   = PARTIAL
MOBILE_DEVICE_PROOF             = NOT_RUN
TRANSPORT_CONNECTED_NOT_EQUAL_FRESH = PASS
QUERY_MONITORING                = PARTIAL
STANDING_ACTION_AUTHORITY       = NOT_IMPLEMENTED

DOMAIN_REALTIME_CHANNELS_ADDED  = 0
DOMAIN_SOCKET_SERVERS_ADDED     = 0
DOMAIN_EVENT_LEDGERS_ADDED      = 0
NEW_DOMAIN_BRANCHES             = 0
FALSE_LIVE_CLAIMS               = 0
FALSE_SUCCESS                   = 0
GENERIC_HOLDOUTS                = PASS

CATALOG_SCENARIOS_MOVED = 5  (all to LIVING_OBJECT_RUNTIME; none to PASS)
GATES_MOVED             = 0
GAPS_CLOSED             = REALTIME_RUNTIME
DISTINCT_GENERAL_GAPS   = 12 -> 11

MAIN              = 2275/27 · 97 files
BLOCK2            = 121 · 16 files
BLOCK3            = 133 · 17 files
BLOCK3_1          = 592 · 36 files
FROZEN_EVALUATION = 90 · 5 files
GENERALITY_CATALOG = PASS

TYPECHECK        = PASS
WEB_BUILD        = PASS
MOBILE_TYPECHECK = PASS
EXPO_EXPORT      = PASS
RAILWAY_RUNBOOK  = PASS

NEXT_GENERIC_GAP = LIVING_OBJECT_RUNTIME
```

### Why four of those are not PASS

**`PERMISSION_REVOCATION = PARTIAL`** — **closed.** It was the one declared
security PARTIAL and it did not survive the phase: see
`JASIM_REALTIME_REVOCATION_REPORT.md`. A subscription is now re-established
against current authority before any event is delivered to it, so a membership
revoked while a socket stays open ends that subscription rather than outliving
it.

**`DATASET_REALTIME_READINESS = PARTIAL`.** An event invalidates and a client
re-queries through the authorized path; nothing mutates a row from a client
frame and nothing calls a dataset CURRENT because an event arrived. Incremental
deltas and derived revisions are not built, and correctness came first.

**`MOBILE_CLIENT = PARTIAL` · `MOBILE_DEVICE_PROOF = NOT_RUN`.** The mobile
client shares the state machine, the cursor rule and the dedupe rule verbatim
with the web — a test holds both files to that — and calls the same catch-up
procedure. The typecheck and Expo export are clean. **No emulator ran, and no
socket was opened from a device.** The claim stops at the contract.

**`QUERY_MONITORING = PARTIAL`** is unchanged from the previous phase, on
purpose. Realtime does not close it, and nothing here pretended it did.

### Where the weight sits now

`LIVING_OBJECT_RUNTIME` now holds **6** scenarios and is the largest remaining
gap — «أين وصل طلبي؟» needs a durable tracked object, and it now has a
transport waiting for it, a monitor engine to observe it and a world runtime to
hold it. `REALTIME_RUNTIME` closing without moving a single gate is what made
that visible.

Six gaps carry one scenario each. None may be folded into a closed name.
