# JASIM — EFFECT → OBSERVATION → VERIFICATION

```
INTENT
 → TRUSTED EXECUTION
 → ATTEMPT
 → EFFECT SIGNAL / RECEIPT
 → EFFECT ASSERTION
 → CANONICAL OBSERVATION
 → VERIFICATION
 → RECONCILIATION
 → CANONICAL STATE / EVENT
```

One mechanism, no domains. A valve, a calibration cycle, a generator, a message and a
person travel the same path and differ only in the strings that travel through it.

---

## 1. The gap, as it actually stood

Traced in the running runtime before anything was changed.

| what existed | where | what it could do |
|---|---|---|
| `submitEffectSignal`, `observationEffectResolver` | `api/runtime/effect-observation-bridge.ts` | record a canonical Observation from a trusted channel and read it back as an `EffectAssertion` |
| `COMPLETION_POLICIES`, `decideCompletion`, `gatherEffectAssertions` | `api/runtime/completion-policy.ts` | decide VERIFIED / PENDING / INCONCLUSIVE / FAILED from assertions |
| `verifyExecutionAttempt` | `api/runtime/execution-verifier.ts` | run the decision and produce a verdict per attempt |
| the live executor | `jasim-runtime.ts` → `executeRuntimeDagNode` (~4040) | gather assertions and persist the verdict on every attempt |
| reconciliation | `jasim-runtime.ts` → `reconcileUncertainAttempt` (~9076) | re-gather and re-decide later |

**And the gap:**

1. **Nothing in production called `submitEffectSignal`.** Its only callers were tests.
   No canonical Observation was ever created on a live path.
2. **No capability could consume one.** The single registered `resolveEffect` (`notify`)
   reads JASIM's own `notification_intents` ledger — an `INTERNAL_READBACK` of JASIM's own
   dispatch, which is not a reading of the world.
3. **Therefore:** `DEVICE_COMMAND`, `REMOTE_MUTATION` and `HUMAN_ACTION` accept only
   `INDEPENDENT_READBACK` or `OWNER_CONFIRMATION`, and neither was reachable. **No effect
   in those three classes could ever become VERIFIED on the running runtime.**

The bridge was a socket with nothing plugged into its ingress. Test 1 of
`tests/block31/effect-observation-verification.test.ts` pins that behaviour permanently.

## 2. What closed it

### An expectation, declared once

```ts
effectExpectation: {
  observationType: "state",
  subject:       (ctx) => ({ subjectKind, subjectId }) | undefined,
  occurredWhen:  (payload, ctx) => boolean,
  notOccurredWhen?: (payload, ctx) => boolean,
  maxAgeMs?: number,
}
```

A capability says **what would convince it**. It cannot say **what its evidence is
worth** — that is fixed by the channel a signal arrives on, in trusted server code. The
predicate receives the execution context, so a capability can say "the observed state
equals the state this attempt asked for" and thereby recognise no state, no noun and no
industry.

`capability-registry.effectContract()` composes the declaration into the same
`EffectResolver` the completion policy already took, so the policy cannot tell a
declaration from hand-written trusted code, and neither form can widen what verifies.

### Trust from the channel, never the payload

| channel | claim source |
|---|---|
| `PROVIDER_RESPONSE` | `SELF_REPORTED` |
| `HUMAN_PROVIDER_REPORT` | `SELF_REPORTED` |
| `AUTHENTICATED_TELEMETRY` | `INDEPENDENT_READBACK` |
| `RUNTIME_READBACK` | `INDEPENDENT_READBACK` |
| `INTERNAL_STATE_READBACK` | `INTERNAL_READBACK` |
| `OWNER_CONFIRMATION` | `OWNER_CONFIRMATION` |

No channel yields `BOUND_PROVIDER_RECEIPT`: a receipt is established by a signature check
in the executor, not by something arriving through an observation channel. And no
`sufficientSources` list contains it — `RECEIPT != VERIFICATION`, for every effect class.

### Freshness

`observationFreshness()` answers in the vocabulary the datasets already speak:

```
CURRENT   a declared validity horizon that has not passed
STALE     a declared horizon that has
UNKNOWN   no declared horizon — how long the reading stays true is not known
```

A reading one second old with no declared horizon is **UNKNOWN, not CURRENT**. Receiving
something recently is a fact about us, not about the world; a temperature and a door state
decay at completely different rates and the clock cannot tell which this is.

This does not replace `classifyObservationPresence`, which answers a different question
for the presentation layer.

### Replay

Ingestion is idempotent on `(ownerId, subject, observationType, attemptId, correlationId)`.
A retried callback returns the row already recorded — one observation, one event. Nothing
in ingestion executes anything, so a replay could never repeat a physical effect; what it
could do is let one delivery be counted twice, and that is what this closes.

### Durable, auditable history

`verificationDetail` on the attempt is **the current verdict**, and reconciliation
overwrites it. Two append-only events carry the history:

| event | when | carries |
|---|---|---|
| `OBSERVATION_RECORDED` | a signal became a canonical observation | observation id, subject, attempt, claim source, observed time |
| `VERIFICATION_CHANGED` | a verdict was reached or moved | from → to, decision, reason code, and the assertions it rested on |

Both are owner-scoped rows in `events` with a serial id — which is the cursor a realtime
subscriber resumes from. Neither carries a value a subscriber could mistake for a verdict.
A later observation is a new fact, never a correction of the old one.

## 3. What verifies what

| effect class | verified by |
|---|---|
| `NONE` | a valid output — there is nothing else to confirm |
| `INTERNAL_STATE` | JASIM's own readback, because JASIM owns the state |
| `MESSAGE_DISPATCH` | the message's own lifecycle reaching a terminal delivered state |
| `DEVICE_COMMAND` | the device's own state, read back |
| `REMOTE_MUTATION` | the owning system's own reading |
| `HUMAN_ACTION` | an independent reading, or the owner's confirmation |

For every class but `NONE`, the executor's return value verifies nothing.

## 4. Proven on the live runtime

`tests/block31/effect-observation-verification.test.ts` drives the real executor
(`executeRuntimeDagNode` → attempts → `gatherEffectAssertions` → `verifyExecutionAttempt`
→ persistence → `reconcileUncertainAttempt`) against the real proof database:

- **A · MESSAGE** dispatch is not delivery; an independent status verifies it.
- **B · DEVICE** command accepted ≠ command performed; telemetry verifies it.
- **C · HUMAN** the person's own report does not verify their own work; the owner's
  confirmation does.
- **D · RECEIPT** a provider's own response leaves the effect unconfirmed.
- **E · CONFLICT** two fresh authorities disagreeing is UNCERTAIN, and blind retry is
  forbidden.
- **Missing observation** → never VERIFIED.
- **Stale observation** → never VERIFIED.
- Five holdout domains — an industrial valve, a laboratory calibration, a temporary
  generator, a cold-storage chamber, a lent community item — verify through the same one
  capability and the same one declaration, and fail on the wrong reading.

## 5. One defect the proof found

`executeRuntimeDagNode` accepts an injected `capabilityRegistry` and threaded it into
claiming, validation and verification — but not into `completeRuntimeDagNode`. The
completion gate therefore re-resolved the capability in the default registry and refused
`UNKNOWN_CAPABILITY`, so an injected registry was honoured everywhere except at the last
step and a node it had just executed could never complete. One argument.

## 6. What is not proven

- **`LIVE_PROVIDER_PROOF = BLOCKED_BY_ENVIRONMENT.`** No real external provider is
  configured. The core semantics are proven with deterministic trusted test adapters; a
  live device, gateway or remote system is not.
- **No HTTP ingress.** Signals enter through trusted server code only. The frozen eval
  asserting the bridge is absent from `api/routers` and `src` still holds, deliberately:
  when a client-facing endpoint is added it must supply the channel server-side, and
  changing that line is how it becomes a visible decision.
- **No realtime delivery.** The events are durable and resumable; nothing subscribes yet.
- **No surface.** `STATUS`, `TRACKER` and `MAP` can project these observations; none is
  built. A MAP must never invent a location and a TRACKER must never invent progress.
