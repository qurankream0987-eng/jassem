# JASIM — EFFECT → OBSERVATION → VERIFICATION · phase report

**Rule held throughout:** `DOMAIN_OBSERVATION_TYPES_ADDED = 0` ·
`DOMAIN_VERIFIERS_ADDED = 0` · `NEW_DOMAIN_BRANCHES = 0` · `FALSE_SUCCESS = 0`.

---

## 1. The gap, proven before it was filled

Everything from `EffectAssertion` to `decideCompletion` to `verifyExecutionAttempt` already
existed and was already wired into the live executor. What did not exist was a way for the
world to say anything.

- `submitEffectSignal` / `observationEffectResolver` — **called by nothing in production**,
  only by tests.
- The one registered `resolveEffect` (`notify`) reads JASIM's own `notification_intents`
  ledger: an `INTERNAL_READBACK` of JASIM's own dispatch, not a reading of the world.
- `DEVICE_COMMAND`, `REMOTE_MUTATION` and `HUMAN_ACTION` accept only
  `INDEPENDENT_READBACK` or `OWNER_CONFIRMATION`.

⇒ **No effect in those three classes could ever reach VERIFIED on the running runtime.**
Test 1 of the live suite pins that fact permanently.

Concrete active files: `api/runtime/effect-observation-bridge.ts`,
`api/runtime/completion-policy.ts`, `api/runtime/execution-verifier.ts`,
`api/runtime/capability-registry.ts` (`effectContract`),
`api/runtime/jasim-runtime.ts` (`executeRuntimeDagNode` ≈ 4040,
`reconcileUncertainAttempt` ≈ 9076).

## 2. What was added

| | |
|---|---|
| `EffectExpectation` | a capability declares **what would convince it** — subject, property, two predicates. It cannot declare what its evidence is worth. |
| `expectationEffectResolver` | composes that declaration into the `EffectResolver` the policy already took, so the policy cannot tell a declaration from hand-written code. |
| `correlationId` + dedupe | ingestion is idempotent; a retried callback returns the row already recorded. |
| `observationFreshness` | `CURRENT` / `STALE` / `UNKNOWN`, in the dataset vocabulary. No horizon ⇒ `UNKNOWN`, never `CURRENT`. |
| `OBSERVATION_RECORDED` / `VERIFICATION_CHANGED` | append-only, owner-scoped, serial-id cursored. The audit trail, and the realtime feed when one is built. |

Hardening, additive: the self-grading vocabulary refused at the observation boundary is now
also refused in a capability's own `effect` block (`EFFECT_AUTHORITY_KEYS`) and in model
output (`AUTHORITY_KEYS` gained `effectverified`, `observationverified`, `claimsource`,
`proofclass`, `trustscore`, `providertrust`). One door closed and the other open is one
open door.

## 3. A defect the proof found

`executeRuntimeDagNode` threaded an injected `capabilityRegistry` into claiming, validation
and verification — but not into `completeRuntimeDagNode`. The completion gate re-resolved
the capability in the default registry and refused `UNKNOWN_CAPABILITY`, so a node the
injected registry had just executed could never complete. One argument.

## 4. Tests

| file | tests | what it holds |
|---|---:|---|
| `tests/block31/effect-observation-verification.test.ts` | 28 | the gap, the five acceptance classes, missing/stale/conflicting observation, replay, cross-owner and cross-attempt security, self-verification impossibility, appended history, and ten holdout assertions across five unfamiliar domains |
| `tests/unit/effect-verification-runtime.test.ts` | 20 | the contract itself: a claim is not a verdict, trust comes from the channel, freshness is established not assumed, and nothing in the mechanism knows what it is observing |

Every scenario — message, device, human, remote, and all five holdouts — runs through
**one** test capability with **one** declaration. A holdout needing its own capability,
observation type or verifier would have been the generality failure.

## 5. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 1887 passed, 27 skipped · 85 files | 1867, 27 · 84 | +20, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 210 · 26 files | 182 · 25 | +28, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

The frozen eval asserting the bridge is absent from `api/routers` and `src` **still
passes**: no HTTP ingress was added. Signals enter through trusted server code only.

## 6. What is not proven

- `LIVE_PROVIDER_PROOF = BLOCKED_BY_ENVIRONMENT` — no real external provider is configured.
  Core semantics are proven with deterministic trusted test adapters.
- The **proposal → approval** segment of the chain is proven by the inherited
  `execution-truth` suite against the production registry; this phase's live proof starts
  at the attempt, because `executeApprovedRun` takes no injectable registry.
- **No realtime delivery.** The events are durable and resumable; nothing subscribes yet.
- **No surface.** `STATUS` / `TRACKER` / `MAP` can project these observations; none is
  built, and none may invent a location or a progress value.
