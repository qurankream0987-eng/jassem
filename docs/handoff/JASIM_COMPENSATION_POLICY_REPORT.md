# JASIM — COMPENSATION POLICY REPORT

**Baseline:** `752d738` · **Provider:** none · **New tables:** 0 · **New runtime infra:** 0

---

## 0. SECURITY PRECHECK — SEC-08

**Verdict: `UNREACHABLE_FUTURE_GAP`.** Compensation work proceeded, as the brief
directs for that classification.

Established on five pieces of evidence, each now pinned by a test so that if any
one changes the gap becomes live and the build says so:

1. **`normalizeMcpToolMetadata` and `normalizeAgentCardMetadata` have no callers**
   outside their own module. No external tool metadata is ever ingested.
2. **The provider selection registry is fed only by code**
   (`registerNativeProvider(this.providerRegistry, capability)`), and
   `capability-registry.ts` contains no reference to the catalog table.
3. **Nothing in production writes `capability_provider_catalog`** — two modules
   read it (`remote-polling`, `webhook-auth`); only tests insert.
4. **The conversation prompt's capability labels are hardcoded literals.** No
   provider description or schema reaches a model.
5. Even if ingested, metadata arrives `trustClass: "UNTRUSTED_CANDIDATE"`, which
   `resolveProvider` filters out absent an explicit approval.

The gap is real for the future. No active entry path reaches it today.

---

## 1. THE TRACE — DONE FIRST, NOT ASSUMED

A run A → B → C where A and B complete VERIFIED and C fails definitively:

```
run.status          = failed
receipt             = failed
A: COMPLETED / VERIFIED    ← effect stands, no recovery representation
B: COMPLETED / VERIFIED    ← effect stands, no recovery representation
C: FAILED    / FAILED
compensation events = 0
```

Truthful about the goal, silent about the effects. Confirmed empirically, and
the first attempt at this trace was itself instructive: a node with a missing
required input goes to `WAITING / AWAITING_INPUT`, not FAILED — so the trace had
to be rebuilt with a capability that passes its input contract and then throws.

**A second observation worth recording:** in the partial case the run reported
`receipt.verificationStatus = VERIFIED` with `completed = 2/3`. That is
defensible — every attempt that ran did verify — and `receipt.status` was
correctly `partial`. It is noted rather than changed, because the run-level
status was already truthful.

---

## 2. WHAT WAS BUILT

`api/runtime/compensation-policy.ts` — pure, no I/O, no schema import, no domain.

- **4 reversibility classes**, each producing a distinct runtime decision.
- **`planCompensation`** — safe order from the DAG, per-effect decisions.
- **`recoveryOutcome`** — five truthful outcomes, `unresolved` named per effect.
- **`compensateFailedRun`** in `jasim-runtime.ts` — executes recovery as a
  **linked compensation Run**.

### The one decision that kept this small

A compensation is an **ordinary DAG node in an ordinary Run**. It therefore
inherits the attempt ledger, idempotency, fenced leases, the completion policy,
independent verification and receipts — none rebuilt. It also respects
`createRuntimeDag`'s refusal of a second DAG on a Run rather than working around
it.

---

## 3. THE FIVE RULES THAT MATTER

1. **Compensation is itself an effect.** A compensating `notify` produces its own
   attempt, judged by the same completion policy, and comes back *not* VERIFIED.
   A provider's 200 to a DELETE proves nothing a 200 to a POST would not.
2. **Uncertainty forbids compensation.** An `INCONCLUSIVE` or `PENDING` original
   is never compensated — that would cause a second, opposite error. Same rule as
   blind retry, from the other side.
3. **Order comes from the graph.** Reverse *topological* order, proven on a
   diamond where reverse-execution-order would differ.
4. **Authority does not carry over.** An action costing 5 may carry a penalty of
   200; `requiresApproval` excludes a compensation from `executable`.
5. **History is never rewritten.** `ORIGINAL_EFFECT_VERIFIED` stays true. Proven
   byte-for-byte: same verification status, execution status and `finishedAt`
   after recovery ran.

### And one the brief asked for that I declined to build

The brief lists `REVERSIBLE` and `COMPENSATABLE` as separate classes. They are
not separate here: **both produce a new effect requiring independent
verification**, so they would drive identical decisions, and Part 4 says to use
only distinctions that produce real runtime decisions. What actually differs is
captured by `requiresApproval` and by the compensating capability's own effect
contract. Stated rather than silently dropped.

---

## 4. EVIDENCE

36 new assertions: 23 policy, 7 end-to-end against a real database, 6 capacity.

End-to-end highlights: a real correction notification is **sent**
(`purpose = "correction"` in `notification_intents`); calling twice yields one
run and one attempt; planning is pure (no attempt row appears); another owner's
run cannot be compensated.

Capacity: four properties — no double release, no leaked capacity, no
resurrection, no overbooking — all from the **existing** `SELECT … FOR UPDATE`
state guard. Nothing new was built to obtain them.

### A vacuous test I wrote and caught

The first capacity draft compared `after[0].remaining` to `before[0].remaining`.
The projection returns `available`; both sides were `undefined`, and "no leaked
capacity" passed for no reason at all. A neighbouring assertion that happened to
compare a number failed and exposed it. Fixed, and the assertion now checks the
type first. Disclosed because a test that cannot fail is worse than no test.

---

## 5. REGRESSION

| Suite | Result | Δ |
|---|---|---|
| Main | **1346 / 1346** (+8 skipped) | +24 |
| Block 2 | **121 / 121** | +6 |
| Block 3 | **213 / 213** | +7, and no file under `tests/block3` was touched |
| Block 3.1 | **80 / 80** | +7 |
| `tsc -b` | **PASS** | |
| Web build | **PASS** (5.71s) | |
| Frozen corpus | **unchanged**, digest still pins | |

**No inherited test was modified or weakened.**

On block 3: the count has now read 198, 203, 206 and 213 across four phases in
which nothing under `tests/block3` changed — `git status` confirms it again here.
The suites drop and recreate a shared proof database, so collection depends on
its settled state. This count is not a reliable regression signal until those
suites stop sharing a database, and saying so each time is more honest than
quoting a number that looks stable.

---

## 6. WHAT WAS NOT BUILT

No GoalSpec. No PlanGraph. No replanning. No Real Discovery. No
`EffectAssertion → Observation` bridge. No provider connected. No new run-status
enum member. No compensation-approval proposal round-trip (C-07 proves exclusion
from `executable`, not the full approval cycle). No irreversible capability is
registered, so that class is proven through policy and the fail-closed default.

END.
