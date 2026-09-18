# JASIM — COMPENSATION POLICY

**Module:** `api/runtime/compensation-policy.ts` · **Executor:** `compensateFailedRun`
**New tables:** 0 · **New execution infrastructure:** 0 · **Domain components:** 0

---

## 1. THE QUESTION

> When a verified real-world effect already happened, and the larger goal later
> cannot complete, what is the truthful and authorized recovery behaviour?

Traced on the live path before anything was designed. A run with nodes
A → B → C, where A and B complete VERIFIED and C fails definitively:

```
run.status           = failed
receipt.status       = failed
A: COMPLETED / VERIFIED      ← effect stands
B: COMPLETED / VERIFIED      ← effect stands
C: FAILED    / FAILED
compensation events  = 0
```

Truthful about the **goal**. Silent about the **effects**. Two verified effects
still stood in the world; nothing recorded that, nothing asked whether they
should be undone, and nothing could say they could not be.

---

## 2. THE INVARIANTS

```
A failed goal does NOT imply the previous effects did not happen.

ROLLBACK                 != DATABASE TRANSACTION ROLLBACK
COMPENSATION             != DELETE HISTORY
COMPENSATION             != INVERSE OPERATION
COMPENSATION_REQUESTED   != COMPENSATION_EXECUTED != COMPENSATION_VERIFIED
ORIGINAL_EFFECT_VERIFIED  stays historically true, forever
```

A captured payment is a fact. A refund is a **second** fact. The runtime never
mutates the first into "never happened" — asserted by a test that reads the
executor and requires it to contain no `update` against the source run's
attempts or nodes.

---

## 3. COMPENSATION IS ITSELF AN EFFECT

The load-bearing decision, and the one that kept this small.

A compensation runs as an ordinary DAG node inside a **linked compensation
Run**. It therefore inherits, with nothing rebuilt:

| Inherited | From |
|---|---|
| Immutable attempt record | `execution_attempts` |
| Idempotency key | `run:node:fenceVersion` |
| Fenced lease + CAS claim | `claimRuntimeDagNode` |
| Effect verification | `CompletionPolicy` |
| Independent readback | the compensating capability's own resolver |
| Receipt | `buildRunReceipt` |

This also respects a constraint rather than fighting it: `createRuntimeDag`
refuses a second DAG on a Run ("A durable DAG is already attached"), so recovery
could not have been appended to the failed Run even had that seemed convenient.

Consequence, proven end to end: a compensating `notify` produces its own attempt
whose `verificationStatus` is **not** VERIFIED, because the completion policy
judges it exactly as it judges a forward effect. A provider's HTTP 200 to a
DELETE has not proven the resource is gone.

---

## 4. THE TAXONOMY — FOUR VALUES, FOUR DECISIONS

| Reversibility | Runtime decision |
|---|---|
| `NO_COMPENSATION_REQUIRED` | SKIP — no external effect occurred |
| `COMPENSATABLE` | COMPENSATE; recovery can complete |
| `PARTIALLY_COMPENSATABLE` | COMPENSATE; run stays `RECOVERY_INCOMPLETE` **even on success** |
| `IRREVERSIBLE` | never attempted; a person is told the truth |

### Why there is no `REVERSIBLE` member

The brief lists REVERSIBLE and COMPENSATABLE separately. In this runtime they
are not separate: **both produce a new effect that must be independently
verified**, so they would drive identical decisions, and a taxonomy member that
changes no behaviour is taxonomy for its own sake.

What genuinely differs is captured by fields that had to exist anyway — whether
recovery needs its own authority (`requiresApproval`), how the compensating
effect is confirmed (its own capability's effect contract), and whether full
recovery is achievable, which is the one real axis and is exactly the four
values above.

---

## 5. UNCERTAINTY FORBIDS COMPENSATION

The sharpest rule, and the one a naive implementation gets backwards.

An `INCONCLUSIVE` or `PENDING` original effect is **never compensated**. It
resolves to `MANUAL_INTERVENTION_REQUIRED` with reason
`EFFECT_UNCERTAIN_COMPENSATION_UNSAFE`.

Compensating something that may not have happened causes a **second, opposite
error**: refunding a payment that never captured, cancelling a booking that was
never made, sending a correction for a message nobody received. This is the same
rule that forbids blind retry, seen from the other side — and it is why
reconciliation must resolve uncertainty before recovery can even be planned.

---

## 6. SAFE ORDER, DERIVED FROM THE DAG

Compensation order is **reverse topological order** of the original graph, not
reverse execution order.

If B consumed A's output, B's effect must be offset before A's — otherwise the
world briefly holds a B that depends on a withdrawn A. On a linear chain the two
orders agree; on a diamond (D ← B,C ← A) they do not, and only the topological
one is safe. A test builds that diamond and asserts every node precedes its own
upstreams.

---

## 7. AUTHORITY DOES NOT CARRY OVER

Having been authorized to perform an action is **not** consent to its recovery.

> An action costing 5 may carry a cancellation penalty of 200.

`requiresApproval` on a policy yields the decision `APPROVAL_REQUIRED`, and such
a requirement is **excluded from `plan.executable`** — it does not run until the
existing proposal/approval chain produces an approval of its own.

---

## 8. TRUTHFUL OUTCOMES

| Outcome | Meaning |
|---|---|
| `RECOVERY_NOT_REQUIRED` | no verified effect needed offsetting |
| `RECOVERY_COMPLETE` | every required compensation VERIFIED, no residue |
| `RECOVERY_INCOMPLETE` | a compensation is unconfirmed, or a residue remains |
| `RECOVERY_FAILED` | a compensation definitively failed; the original still stands |
| `MANUAL_INTERVENTION_REQUIRED` | an effect occurred the runtime cannot offset |

These live in the compensation Run's state and in run events. **No new run-status
enum member was added** — the failed run keeps `status = failed`, which is
truthful about the goal, and recovery is a separate question with a separate
answer.

`recoveryOutcome` never collapses history into a generic FAILED: `unresolved`
names each effect and what became of its recovery.

---

## 9. COMPENSATION IS NOT AN INVERSE — THE REGISTERED EXAMPLE

`notify` declares:

```ts
compensation: {
  reversibility: "PARTIALLY_COMPENSATABLE",
  compensationCapabilityId: "notify",        // ← itself, not "notify-undo"
  residualNote: "The original message was already delivered; a correction cannot unsee it.",
  deriveInputs: (context) => ({ recipientId, purpose: "correction", … }),
}
```

You cannot unsend a message by changing a row. Recovery is a **second message**
telling the recipient to disregard the first — a new effect with its own delivery
truth. And it is `PARTIALLY_COMPENSATABLE` rather than `COMPENSATABLE` because
the recipient still read the original; claiming full recovery would be the small
lie this module exists to prevent.

---

## 10. FINANCIAL TRUTH WINS

The generic module **defers to** `block3` rather than replacing it. A refund is
already a new immutable financial effect with its own stricter path — a payout
reaches VERIFIED only inside `reconcilePayout`, only when an authoritative
readback binds on id, destination, amount and currency, and never from a receipt.

Asserted: `compensation-policy.ts` imports no financial table and contains no
`@db/schema` reference at all. Where a generic rule and a financial rule
conflict, the financial rule wins.

---

## 11. CAPACITY — REUSED, NOT REBUILT

Releasing a reservation as a compensation calls the existing
`releaseReservation`, which runs `SELECT … FOR UPDATE` inside a transaction with
a `from`-state guard. Four properties follow from that guard rather than from
new code, and each is proven:

| Property | Why it holds |
|---|---|
| No double release | a second release finds no row in a releasable state |
| No leaked capacity | `capacityHeld` returns to exactly 0 |
| No capacity resurrection | availability never exceeds `capacityTotal` |
| No overbooking | released capacity is re-reservable exactly once |

A compensating action that invented its own release path would be exactly the
parallel execution infrastructure this design avoids.

---

## 12. THE AUTHORITY BOUNDARY

Eight keys were added to the runtime's existing `AUTHORITY_KEYS` rejection set:

```
compensationComplete · refundComplete · effectReversed · ignorePreviousEffect
skipCompensation · compensated · reversed · rolledBack
```

(`policyOverride` was already there.) Each is an attempt to **end the recovery
conversation by declaring it over**, which is precisely what a model, client or
provider may not do. A payload containing one is rejected, not stripped and used.

---

## 13. WHAT THIS DOES NOT DO

No planner, no GoalSpec, no PlanGraph, no automatic replanning, no Real
Discovery. Compensation works from the DAG evidence that already exists. It is
also not automatic: `compensateFailedRun` is called explicitly, and `execute`
defaults to false so that **planning is always pure** — a plan can be computed
and read without any effect occurring.

END.
