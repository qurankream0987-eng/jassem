# JASIM — OBSERVATION / EFFECT EVALS

**Behavioural:** `tests/block31/observation-bridge.test.ts` — 18 assertions
**Presentation:** `tests/block31/observation-bridge-presentation.test.ts` — 3
**Structural:** `tests/evals/observation-bridge-evals.test.ts` — 13
**Frozen corpus:** unchanged. Digest `949718cafbeff242` still pins.

> Existing benchmark definitions were **not** altered. These are a new suite.

---

## THE TWELVE CASES

| # | Case | Result | Established |
|---|---|---|---|
| B-01 | Provider claim only | PASS | becomes an Observation; verifies nothing (PENDING) |
| B-02 | Independent readback | PASS | VERIFIED |
| B-03 | Stale readback | PASS | UNCERTAIN → INCONCLUSIVE, with the reason |
| B-04 | Cross-owner assertion | PASS | rejected; **zero rows written** |
| B-05 | Replay across attempts | PASS | invisible to the other attempt; original still resolves |
| B-06 | Conflicting observations | PASS | UNCERTAIN; both readings preserved |
| B-07 | Device telemetry | PASS | command receipt ≠ state observation |
| B-08 | Messaging delivery | PASS | DELIVERED never inferred from SENT |
| B-09 | Remote mutation readback | PASS | POST 200 → PENDING; separate GET → VERIFIED |
| B-10 | Human provider claim | PASS | SELF_REPORTED → PENDING; owner confirmation → VERIFIED |
| B-11 | Compensation readback | PASS | same bridge, absence as the effect |
| B-12 | Duplicate callback | PASS | both rows kept; verdict unchanged |

```
FALSE_SUCCESS        = 0
SECURITY_FAILURES    = 0
DOMAIN_SPECIFIC_CORE = 0
```

---

## THE FIVE WORTH READING THE CODE FOR

### B-04 — a raw attempt id is not authority

```ts
const { attemptId } = await attemptFor(OTHER, "b04");   // a REAL id…
await expect(submitEffectSignal(db, { ownerId: OWNER, attemptId, … }))
  .rejects.toThrow(EffectSignalError);
expect(await db.select().from(observations)).toHaveLength(0);
```

The attempt genuinely exists. The lookup is owner-scoped, so it is *not found*
rather than found-and-refused — and nothing is written, so a rejected injection
leaves no trace to be read back later.

### B-05 — replay, closed by binding rather than by a nonce

Same owner, same subject, same observation type, same value, different attempt:

```ts
expect(replayed).toBeUndefined();     // not evidence here
expect(original.assertion.state).toBe("OCCURRED");   // still evidence there
```

The second assertion matters as much as the first: it proves the row was not
merely invisible to everything.

### B-03b — two freshness ceilings, one mechanism

A row fresh by its own one-hour TTL but five minutes old:

```ts
lenient.assertion.state === "OCCURRED"          // by the row's horizon
strict === undefined                            // maxAgeMs: 30_000
```

A policy may demand more currency than the signal claimed for itself. Both use
`observedAt` and the existing `freshnessExpiresAt`; **no second freshness
mechanism was added.**

### B-06 — conflict is not a tie-break

Provider says PRESENT, authenticated telemetry says ABSENT. The bridge does not
prefer the stronger source:

```ts
expect(evidence.assertion.state).toBe("UNCERTAIN");
expect(evidence.considered).toHaveLength(2);       // both preserved
```

Two authorities disagreeing is a stronger signal than one being unsure. Silently
choosing the convenient reading is how a false success is manufactured.

### B-07 — a receipt is not a state

```ts
observationType: "command_receipt"   → a state query finds NOTHING
observationType: "state"             → INDEPENDENT_READBACK → VERIFIED
```

No `Door`-specific anything. The distinction is carried by the generic
`observationType` field, which is why a door, a valve and a feature flag are the
same code.

---

## PRESENTATION COMPATIBILITY

Three assertions push a bridged row through the **untouched** pipeline:

1. A fresh bridged observation projects `visible: true`, `freshness: FRESH`.
2. A stale one keeps stale semantics — the UI is never told it is current.
3. The provenance this phase added (`attemptId`, `runId`, `nodeId`, plus any
   provider note) **does not reach the viewer**. Asserted explicitly, because
   the bridge put new fields into a structure a viewer-facing projection reads.

---

## HONEST CLASSIFICATION

```
PROVEN_AT_RUNTIME_CONTRACT_LEVEL  ✔
PROVEN_IN_REAL_WORLD              ✘
```

Every signal in these tests comes from a deterministic fixture. There is no real
device provider, no real human provider and no real messaging provider, and none
is claimed. What is proven is that **when** such a signal arrives, the runtime
classifies, binds, ages and adjudicates it correctly.

---

## WHAT IS NOT COVERED

- **No client submission endpoint exists**, so there is no test of an
  authenticated owner confirmation arriving over HTTP. The structural test
  asserts the absence deliberately, so adding one is a visible change.
- **No registered capability uses `observationEffectResolver` yet.** The
  resolver is proven; wiring it to a capability requires a capability whose
  effect an external source can observe, and none exists.
- **No signature verification** on `AUTHENTICATED_TELEMETRY` — the channel
  assumes the *call site* already authenticated the sender. That assumption is
  documented rather than enforced here, because enforcement belongs at the
  endpoint that does not yet exist.

END.
