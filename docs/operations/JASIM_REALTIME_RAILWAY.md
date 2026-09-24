# JASIM — realtime transport on Railway

**Names only. No value in this file is a credential, and none ever should be.**

Status: **documented, not deployed.** No deployment was performed in this phase.

```
REALTIME TRANSPORT  != TRUTH
TRANSPORT_CONNECTED != DATA_CURRENT
```

The whole reason this runbook is short: **a dropped connection costs nothing.**
Canonical state is in PostgreSQL, change notifications are in the canonical
event ledger, and every client resumes from a cursor. Draining, restarting,
scaling and redeploying all cost one reconnect each and lose nothing.

---

## 1. Service topology

One service. The WebSocket upgrade is served by the **same** Node HTTP server
that serves the API, on the same port, at the same origin:

```
api/boot.ts → serve({ fetch: app.fetch, port: PORT })
            → initWebSocket(server)      // upgrade handler on the same server
```

There is no separate realtime service, no separate port and no sticky-session
requirement. A client may reconnect to **any** instance: the subscription is
re-authorized from the ledger and the cursor on each connect, and the
connection registry is per-process transport state that is authoritative for
nothing.

**Required env vars: none new.** `PORT`, `DATABASE_URL` and `SESSION_SECRET`
already exist and are all realtime needs.

## 2. Proxy and timeouts

Railway's edge proxy terminates TLS and forwards the `Upgrade` header, so
`wss://` reaches the service as a normal upgrade. Two things to know:

| | |
|---|---|
| **Idle timeout** | An idle connection may be closed by the edge. The server pings every duty-cycle sweep (~1s) and terminates a peer that stops answering, so an idle socket is never idle for long and a silently dead one is not held forever. |
| **Origin** | The client builds `wss://` from `window.location.host` on web, and from the one place the runtime's address is decided on mobile. Neither has a realtime URL of its own to get wrong. |

## 3. Health checks

The existing HTTP health route is sufficient. **Do not health-check the
WebSocket endpoint**: a failed upgrade probe would report a service unhealthy
for a transport whose absence degrades nothing — clients fall back to the
`runtime.realtimeCatchUp` read and stay correct, only later.

## 4. Graceful shutdown and connection draining

The existing `gracefulShutdown` in `api/boot.ts` stops the Block 2 worker,
releases leases and closes the pool. Realtime needs nothing added to it:

1. The process stops accepting connections.
2. Open sockets close; every client's state machine moves to `RECONNECTING`
   and backs off with jitter, so a fleet that dropped together does not return
   together.
3. Each client reconnects **with its cursor** and receives exactly what it
   missed during the gap.

Nothing is flushed, drained or handed over, because nothing was held.

## 5. Restart behaviour

```
client cursor = N
server restarts
canonical events N+1..N+K are written by whatever wrote them
client reconnects with N
server delivers N+1..N+K, in order, once each
```

Proven in `tests/block31/realtime-runtime.test.ts` — the server is destroyed,
the world keeps moving with nothing listening, and a new connection resumes
correctly.

## 6. Scaling

| concern | today |
|---|---|
| **connection memory** | one entry in a `Set` per socket plus one small attachment record; no event copy is retained |
| **event lookup** | one indexed read per **scope** per sweep, not per connection: a hundred tabs on one scope is one query |
| **resume bounds** | every read is `LIMIT ≤ 200`; a subscriber further behind than its queue allows is told to resync rather than fed unboundedly |
| **fan-out** | in-process, from one ledger read; multi-instance works because each instance reads the same ledger for its own connections |
| **N+1 authorization** | authorization happens **once, at subscribe**, not per event. A membership revoked mid-connection is caught on the next subscribe or re-authorization — see the security note below |

## 7. Multi-instance

Each instance tails the ledger for the connections it holds. No cross-instance
bus is needed and none should be added: the ledger IS the bus, and a second one
would be a second truth.

## 8. Security note for operators

A long-lived connection is authorized at subscribe time. If a membership or
permission is revoked while a connection is open, that connection must not keep
its authority indefinitely — today it is re-authorized on every reconnect, and
a reconnect is forced by any deploy, restart or heartbeat failure. **A
deliberate revocation should be followed by terminating that principal's open
connections**, which is a one-line operator action and not a substitute for the
design change that would re-authorize per event class.

```
No secret, no message body, no observation payload and no identity is logged.
Realtime metrics are counters and one latency.
```
