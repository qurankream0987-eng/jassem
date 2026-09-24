# JASIM — REALTIME TRANSPORT

```
REALTIME TRANSPORT  != TRUTH
TRANSPORT_CONNECTED != DATA_CURRENT

CANONICAL STATE CHANGE
  -> DURABLE EVENT
    -> AUTHORIZED SUBSCRIPTION
      -> TRANSPORT
        -> CLIENT CURSOR
          -> RECONCILIATION
            -> CANONICAL PROJECTION UPDATE
```

---

## 1. What was actually there

Traced through `486e2ad` before anything was written, because the brief's first
constraint was *do not create a second system if usable infrastructure already
exists*. A great deal existed.

| | where | what it did |
|---|---|---|
| `JasimWebSocketServer` | `api/core/websocket.ts` | an **authenticated upgrade** (`verifyClient` → `authenticateRequest`), a per-user connection map, a client-initiated `ping`/`pong`, and a `subscribe` action for bubbles and runs |
| `events` | `db/schema.ts` | a **serial-id ledger** with `ownerId` and `correlationId` that every runtime already appends to |
| `monitor_evaluations` | `schema-block2.ts` | a per-monitor cursor, from the previous phase |
| world events | `world-runtime.ts` | `WORLD_MATERIALIZED` / `WORLD_VERSION_CREATED`, already appended to `events` |
| `emitToUser` | `api/core/websocket.ts` | fan-out to one user id, used only by the in-app notification adapter |
| `httpSubscriptionLink` | `src/providers/trpc.tsx` | an SSE link already configured on the **client**, with no server counterpart |

**So the gap was never "there is no socket".** It was five precise things:

1. **The socket authorized a subscription and then discarded it.**
   `handleSubscription` checked a bubble or run, replied `subscribed`, and
   nothing ever routed an event by it. There was no subscription registry.
2. **No cursor.** A disconnect lost everything between; the socket was the only
   path, so nothing could be caught up.
3. **Nothing connected the ledger to the socket.** `emitToUser` was called by
   one notification adapter and by nothing else.
4. **One socket per user.** `clients.set(userId, ws)` overwrote, so a second tab
   silently killed the first.
5. **No client.** Nothing in `canonical/جاسم/app/src`, `artifacts/jasim` or
   `artifacts/jasim-mobile` opened a socket at all.

## 2. What was built

| file | lines | what |
|---|---:|---|
| `api/runtime/realtime-runtime.ts` | 727 | the subscription contract, authorization, the envelope, the cursor, resync, backpressure, the tailer, metrics |
| `src/lib/realtime-client.ts` | 226 | the client state machine, ordering, dedupe, backoff — **shared verbatim with mobile** |
| `src/hooks/use-realtime.ts` | 160 | the web socket lifecycle |
| `artifacts/jasim-mobile/lib/realtime.ts` | 187 | the same semantics, with the OS lifecycle that differs |

Extended rather than replaced: `api/core/websocket.ts` (a subscription
registry, a `Set` per user, a server heartbeat, an authorized delivery path),
`block2/jobs.ts` (delivery and heartbeat as steps in the existing sweep),
`monitoring-runtime.ts` (canonical signals for evaluations and observations),
`api/routers/runtime.ts` (the catch-up read), `useJasimChat.ts` (the real
product), `model-output-trust.ts`.

```
SECOND_SOCKET_SERVERS_ADDED = 0 · SECOND_EVENT_LEDGERS_ADDED = 0
DOMAIN_REALTIME_CHANNELS_ADDED = 0
```

### One stream, one cursor

Monitor evaluations kept their own audit ledger; what the transport reads is
the **canonical `events` ledger**, ordered by its serial position. So monitors
and observations now append a canonical signal there too, and a subscriber has
ONE cursor rather than one per subsystem.

### One reader

There is exactly one place events leave the ledger — `tailRealtime` — and both
the live push and the reconnect resume go through it. That is what makes
ordering, deduplication and the stability lag one behaviour rather than three
that drift. It runs as a step in the Block 2 sweep, which is itself a durable
job re-enqueueing its next tick.

```
SECOND_SCHEDULERS_ADDED = 0
```

Sinks are grouped **by scope** before reading: a hundred tabs on one scope is
one query, not a hundred. That is the N+1 this design was most likely to grow.

### The stability lag

A serial id is assigned before COMMIT, so an event inserted first can become
visible second, and a cursor that advanced the instant it saw the higher id
would skip the lower one forever. Every canonical event is appended as its own
statement **after** its state change has committed, so a 250 ms lag before a
cursor may advance past an event bounds the hazard rather than hiding it. It is
a named constant, not a magic number, and the tests move the clock rather than
sleeping through it.

### The envelope carries a signal, never a state

Position, identity, type, instant, scope, a subject reference, a revision when
there is one, and closed-vocabulary signals — a verdict, a transition, a
freshness. Built from an **allowlist**, so a new event type that happens to
carry a private field leaks nothing: an observation payload, a negotiation
reserve, a policy body and a credential all leave the same way, by never being
named.

`freshness` is in the envelope precisely so a surface can be CONNECTED and
still say the reading is STALE.

### Authorization happens once, before the subscription exists

The request says what to hear about. It may not name a scope, a permission, a
membership or a trust. Each named entity is looked up through the **same scoped
read** the rest of the runtime uses, so a subscription can never see further
than a query could, and a guessed id is refused rather than reported as
missing.

### The client re-reads, and never reconstructs

```
EVENT -> IDENTIFY CHANGED OBJECT -> FETCH AUTHORIZED PROJECTION
```

`useJasimChat` subscribes to the acting scope and, on a change, invalidates the
tRPC query that drew the object — `worldRead`, `monitorRead`,
`conversationsGet`. It builds no runtime state out of an event body, which is
the rule that keeps a future negotiation or transaction surface honest.

### What a person is told

One sentence, and only when something is wrong: *«جارٍ إعادة الاتصال — قد
تتأخر المعلومات قليلاً»*. No cursor, no stream id, no event type, and no
permanent CONNECTED badge — being connected is the ordinary case and needs no
announcement.

## 3. What is still not true

| | |
|---|---|
| a living object | every catalogued scenario that named `REALTIME_RUNTIME` also needs a durable tracked thing «أين وصل طلبي؟» can be about. Closing this gap greened **none** of them |
| ~~per-event re-authorization~~ | **closed.** A subscription is re-established against current authority before any event reaches it — see `JASIM_REALTIME_REVOCATION_REPORT.md` |
| a device proof | the mobile client compiles, exports and calls the same procedures. No emulator ran |
| dataset deltas | an event invalidates a dataset; it never mutates rows from a client frame. Incremental deltas are a later phase, and correctness came first |

```
FALSE_LIVE_CLAIMS = 0 · FALSE_SUCCESS = 0
```
