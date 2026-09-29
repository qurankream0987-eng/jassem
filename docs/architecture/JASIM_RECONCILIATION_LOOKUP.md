# JASIM — AN UNCERTAIN EFFECT MUST BE ABLE TO BECOME CERTAIN

## THE GAP, TRACED BEFORE ANYTHING WAS WRITTEN

JASIM's refusal to retry an effect it is unsure about is real, and it is
proven: `BLIND_RETRY = 0` holds across the corpus. What was missing is the
other half of that sentence.

| Traced on the live path | Callers |
|---|---|
| `findUncertainExecutionAttempts` | **0** — not the runtime, not a router, not a job, not even a test |
| `reconcileUncertainAttempt` | **0 production** callers |
| a capability declaring how it can be asked | **impossible** — `lookup` was a parameter, so only a test could supply one |

So a process that died mid-execution left its effect uncertain **forever**, and
the one evidence source that can carry an effect to VERIFIED —
`INDEPENDENT_READBACK` — was unreachable from anything JASIM does on its own.

> **UNCERTAIN_FOREVER = 0**
>
> Not knowing is honest. Having no way to find out is not.

---

## THE LAWS

| Law | What it forbids |
|---|---|
| `UNCERTAIN_FOREVER = 0` | an uncertain effect with no path to resolution |
| `LOOKUP_AUTHORITY_IS_THE_EFFECT_OWNING_SYSTEM` | asking anyone but the system the effect happened in |
| `EXECUTOR_RETURN != INDEPENDENT_READBACK` | the claim under examination naming its own confirmer |
| `NO_ANSWER != NOT_OCCURRED` | converting a silence into a failure |
| `OCCURRED_WITHOUT_A_REFERENCE = 0` | confirming without naming what was confirmed |
| `CONFIRMED_WITHOUT_A_RECORD = 0` | confirming while holding nothing about it |
| `LOOKUP != RETRY` | asking what happened causing it to happen |
| `MODEL_SUPPLIES_A_LOOKUP = 0` | anything on a request path choosing its own confirmer |
| `DOMAIN_RECONCILERS_ADDED = 0` | a ShippingReconciler, a PaymentReconciler, a WarehouseReconciler |

---

## THREE DEFECTS INSIDE THE MECHANISM, FOUND WHILE PROVING IT

**1. A silence was being written as a failure.** The answer shape was
`occurred | not_occurred`. An authority that could not tell had no way to say
so: it had to claim `not_occurred`, and the runtime then wrote `FAILED` **and
failed the DAG node**. `UNKNOWN` is now a first-class answer, it leaves the
attempt `INCONCLUSIVE`, and it moves the node not at all.

**2. "Independent" was independent of nothing.** The assertion took its
authority from `attempt.providerReference` — the executor's own returned
reference — falling back to `attempt.capabilityId`, which *is* the executor.
The authority is now the one the **answer** names, and it is checked against
both. An answer that fails the check is not discarded: it enters as
`SELF_REPORTED`, which no effectful completion policy accepts, so the effect
stays unverified and the ledger records why.

**3. A confirmed effect was capped by an envelope it could never have.** The
verifier's output half reads `normalizedResult` as a canonical
`{ result, metadata }` envelope. A crashed attempt has none — that is what a
crash *is* — and the composite verdict is downgrade-only, so an effect the
owning system had just confirmed independently was still capped at
`INCONCLUSIVE`, permanently, by the absence of a wrapper the authority was
never going to speak. Reconciliation now shapes the authority's answer into
that envelope and marks it `reconciled`. The completion policy is untouched:
VERIFIED still requires `INDEPENDENT_READBACK`.

---

## THE SHAPE

```ts
type ReconciliationAnswer =
  | { outcome: "OCCURRED";     authority: string; reference: string;
      result: Record<string, unknown>; notes?: readonly string[] }
  | { outcome: "NOT_OCCURRED"; authority: string; notes?: readonly string[] }
  | { outcome: "UNKNOWN";      notes?: readonly string[] };
```

`authority` names **the system** — «the inventory system», «the hospital
scheduler» — never the row. `reference` names the row inside it. Both are
required on `OCCURRED` at the type level, so the two ways of confirming
nothing do not compile.

A lookup is declared in the same trusted registration that already declares
`effectKind`, `effectEvidenceSource` and `compensation`:

```ts
registry.register({
  id: "...",
  effectKind: "REMOTE_MUTATION",
  reconciliationLookup: async (subject) => { /* READS. Never acts. */ },
  execute,
});
```

`register` refuses a capability whose lookup **is** its executor.

---

## WHERE IT RUNS

`runBlock2Sweep` — the duty cycle that already fires temporal triggers,
evaluates standing monitors, reconciles living objects and delivers realtime.
Reconciliation gets no timer, no worker and no restart story of its own.

> **SECOND_SCHEDULERS_ADDED = 0**

The sweep reports `unanswerable` beside `unresolved` on purpose: an attempt
whose capability declares no lookup was not *failed* to resolve, it had **nobody
to ask**. Collapsing the two would let "nothing could be resolved" read as
"nothing needed resolving".

---

## GENERALITY

One signature, three effect classes, no domain code. A stock movement, a
machine command and a person's action differ only in the strings travelling
through it. The proving suite runs all three through the same four lines.

`tests/block31/reconciliation-lookup.test.ts` — 15 tests.
