# JASIM — REALTIME PERMISSION REVOCATION · microclosure report

```
AUTHORIZED_AT_SUBSCRIBE != AUTHORIZED_FOREVER
```

One declared security PARTIAL, closed. Realtime was not redesigned, no living
object was built, and no second stream or scheduler exists.

---

## 1. §1 · The authority source, traced

`realtime.subscribe`, `runtime.realtimeCatchUp` and every scoped read already
authorize from the same two canonical places, and no third was invented:

| | |
|---|---|
| `resolveActingScope` | membership decides whether a principal may act as an organization |
| the scoped read itself | `readWorld`, `readMonitor`, `getRuntimeRun`, the conversation's own `userId` — a subscription can never see further than a query could |

What was missing was not a permission model. It was that the verdict was taken
**once, at subscribe**, and never asked again while the socket stayed open.

## 2. The mechanism

Two halves, because one would have been either wrong or expensive.

**An authority revision, per scope.** `authorityRevisionOf(scopeId)` is the
latest instant at which anything that could narrow a scope's authority changed:
`memberships.updatedAt` (whose `$onUpdate` moves on every grant, narrowing and
revocation, and whose `revokedAt` moves on revocation) and
`scopePolicies.createdAt` (a policy is versioned by appending, so a new row IS
the change). **One query per scope per sweep** — not per frame, not per socket.
A hundred tabs on one scope ask it once.

**A bounded maximum age.** `REAUTH_MAX_AGE_MS = 5_000` catches what a revision
cannot see: an entity that left the scope, a conversation that was deleted.
Entity membership has no revision column, and inventing one would have been the
second permission model the brief forbids.

Both are checked **only when there is something to deliver**, so an idle
connection costs nothing and nothing polls for permissions.

```
SECOND_EVENT_STREAMS_ADDED = 0 · SECOND_SCHEDULERS_ADDED = 0
DOMAIN_REVOCATION_TYPES_ADDED = 0 · NEW_DOMAIN_BRANCHES = 0
```

## 3. The decisions that carry it

**Re-authorization is the same function that authorized it.**
`stillAuthorized` calls `authorizeSubscription` — so live push and catch-up
cannot possibly disagree about what a principal may hear. Catch-up already
re-authorized on every call; now the socket does too, through the same door.

**The re-established authorization may be narrower, and is applied as such.**
Events that the original subscription selected are filtered again against what
the new one says. A subscription that was scope-wide and is now entity-limited
delivers less, rather than being either killed or trusted.

**Any refusal at all ends it.** There is no partial re-authorization: a lost
membership, a vanished entity and a policy that now denies all end the
subscription the same way.

**The race fails closed.** The check happens at DELIVERY time against CURRENT
authority, so an event written before a revocation is not delivered after it
merely because it is older than the revocation.

**The ending frame is a code.** `ACCESS_REVOKED`, and nothing else — not the
object that became forbidden, not whether it still exists, not which permission
was lost. The attachment is dropped **before** the frame is sent, so an
overlapping sweep has nothing left to deliver to.

**The client stops rather than arguing.** `revoked()` is terminal on both
surfaces: the socket is not reopened and the cursor is dropped. Reconnecting
would be a client re-asking a refused question with a position attached, and the
surface's own authorized reads are where that answer belongs.

## 4. Proof

| file | tests |
|---|---:|
| `tests/block31/realtime-runtime.test.ts` | 28 (+6) |
| `tests/unit/realtime-contract.test.ts` | 36 (+8) |

Real sockets, real HTTP servers, a real membership revoked while the connection
stays **verifiably OPEN**.

| §11 requirement | proof |
|---|---|
| authorized subscription receives | the member receives `before-revocation` |
| revoked while socket open → next event not delivered | `after-revocation` never arrives; `ACCESS_REVOKED` does; `readyState` was OPEN at the moment of revocation |
| catch-up after revocation → forbidden event not returned | `authorizeSubscription` refuses the same principal the socket refused |
| permission restored → current policy honoured | a **new** subscription receives again; the ended connection stays ended |
| second device does not retain stale authority | both the tab and the phone stop, and both are told |
| unrelated authorization change does not break an unrelated subscription | a policy on the actor's personal scope leaves the organization subscription receiving, and neither is revoked |
| race: event created, then revoked, then swept | nothing delivered, revocation frame sent |

Plus: the revision moves for a membership and for a policy, and a scope with
neither reads 0 rather than a wrong answer; the frame leaks no id, scope,
permission, cursor or payload; the check is asked once per bucket and only when
`wanted.length > 0`; and both client files stop the same way.

## 5. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2283 passed, 27 skipped · 97 files | 2275, 27 · 97 | +8 |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 598 · 36 files | 592 · 36 | +6 |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

**No inherited test was weakened.** One test written in the previous phase was
**replaced by stronger ones**: it asserted only that a revoked member's
re-authorization is refused — which was all that was true then. The six tests
above assert the thing it could not: that the live connection itself stops.

The catalog was not touched: no gate moved, no scenario moved, and this closed
a declared PARTIAL rather than a gap.

## 6. The final report

```
PHASE = REALTIME_PERMISSION_REVOCATION_MICROCLOSURE

PERMISSION_REVOCATION         = PASS
LIVE_PUSH_REAUTHORIZATION     = PASS
CATCHUP_REAUTHORIZATION       = PASS
MULTI_DEVICE_REVOCATION       = PASS
REVOCATION_RACE               = PASS
UNRELATED_SCOPE_ISOLATION     = PASS
FAIL_CLOSED                   = PASS

SECOND_EVENT_STREAMS_ADDED    = 0
SECOND_SCHEDULERS_ADDED       = 0
DOMAIN_REVOCATION_TYPES_ADDED = 0
NEW_DOMAIN_BRANCHES           = 0
FALSE_AUTHORIZED_DELIVERIES   = 0

MAIN              = 2283/27 · 97 files
BLOCK2            = 121 · 16 files
BLOCK3            = 133 · 17 files
BLOCK3_1          = 598 · 36 files
FROZEN_EVALUATION = 90 · 5 files

TYPECHECK        = PASS
WEB_BUILD        = PASS
MOBILE_TYPECHECK = PASS
EXPO_EXPORT      = PASS

READY_FOR_LIVING_OBJECT_RUNTIME = YES
```

### Untouched on purpose

`DATASET_REALTIME_READINESS` stays PARTIAL — invalidate-and-re-read is
acceptable and no delta was built. `MOBILE_DEVICE_PROOF` stays NOT_RUN — no
emulator ran. `QUERY_MONITORING` stays PARTIAL. `STANDING_ACTION_AUTHORITY`
stays a separate gap: realtime transports a trigger and grants no authority to
act on it.
