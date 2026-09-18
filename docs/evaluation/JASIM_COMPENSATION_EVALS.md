# JASIM — COMPENSATION EVALS

**Policy evals:** `tests/evals/compensation-evals.test.ts` — 23 assertions
**End-to-end:** `tests/block31/compensation-recovery.test.ts` — 7 assertions
**Capacity:** `tests/block2/compensation-capacity.test.ts` — 6 assertions
**Frozen corpus:** unchanged. Digest `949718cafbeff242` still pins.

> The existing benchmark's meanings were **not** altered. Compensation evals are
> a new, separate suite. Changing what S01–S30 mean in order to accommodate new
> work is exactly the drift the frozen digest exists to prevent.

---

## THE TWELVE CASES

| # | Case | Result | What it establishes |
|---|---|---|---|
| C-01 | Fully reversible two-step workflow | PASS | both verified effects planned, in safe order |
| C-02 | First effect verified, second fails | PASS | the verified one is compensated; the failed one is skipped, not "undone" |
| C-03 | Compensation verified successfully | PASS | `RECOVERY_COMPLETE` only when every compensation VERIFIED |
| C-04 | Provider reports success, effect unverified | PASS | `RECOVERY_INCOMPLETE`; the completion policy judges compensation identically |
| C-05 | Compensation timeout → INCONCLUSIVE | PASS | unresolved is named; and an uncertain **original** is never compensated |
| C-06 | Irreversible effect | PASS | never attempted, never reported recovered |
| C-07 | Compensation requires approval | PASS | excluded from `executable` until approved |
| C-08 | Duplicate compensation attempt | PASS | one compensation run, one attempt |
| C-09 | Process restart during recovery | PASS | identity is derived (`compensation:${runId}`), not generated |
| C-10 | Cross-owner compensation injection | PASS | owner-scoped reads; authority keys rejected |
| C-11 | Payment / refund compatibility | PASS | financial path untouched; no schema import |
| C-12 | Capacity reservation release | PASS | four properties, from existing atomic guarantees |

```
FALSE_SUCCESS                  = 0
BLIND_RETRY                    = 0
DOMAIN_SPECIFIC_CORE_ADDITIONS = 0
SECURITY_FAILURES              = 0
```

---

## THE THREE THAT ARE WORTH READING THE CODE FOR

### C-05 — uncertainty forbids compensation, not just retry

```ts
for (const uncertain of ["INCONCLUSIVE", "PENDING"]) {
  expect(plan.executable).toHaveLength(0);
  expect(plan.requirements[0].reasonCode).toBe("EFFECT_UNCERTAIN_COMPENSATION_UNSAFE");
}
```

Compensating an effect that may not have occurred causes a **second, opposite
error**. This is the blind-retry rule seen from the other side, and it is the
case a naive implementation gets backwards — it looks like the safe thing to do.

### C-01 — order comes from the graph, not from a reversed list

A diamond: `D ← {B, C} ← A`. Reverse execution order and reverse topological
order differ here, and the test asserts the stronger property directly:

```ts
for (const entry of steps)
  for (const upstream of entry.dependsOn)
    expect(position.get(entry.nodeKey)).toBeLessThan(position.get(upstream));
```

Every node is compensated before its own upstreams. On a linear chain this is
indistinguishable from "reverse the list", which is why the diamond is in the
suite.

### C-04 — a compensation is not trusted more than a forward effect

Proven end-to-end against a real database: a compensating `notify` produces its
own attempt whose `verificationDetail.completion.effectKind` is
`MESSAGE_DISPATCH` and whose `verificationStatus` is **not** VERIFIED. The same
policy, the same refusal.

---

## WHAT THE END-TO-END SUITE ADDS

Seven assertions that only a database can make:

1. A real partially-failed run plans recovery for the effect that happened and
   skips the one that did not.
2. Planning is **pure** — no new attempt row, no new effect, and a
   `COMPENSATION_PLANNED` event.
3. Recovery executes as a real linked Run with a real attempt, and a **real
   correction notification is sent** (`purpose = "correction"` appears in
   `notification_intents`).
4. A partially compensatable effect never reports `RECOVERY_COMPLETE`.
5. Calling twice yields **one** compensation run and **one** attempt.
6. The forward history is byte-identical afterwards — same verification status,
   same execution status, same `finishedAt`.
7. Another owner's run cannot be compensated.

---

## A VACUOUS TEST I WROTE AND THEN CAUGHT

The first draft of the capacity suite asserted:

```ts
expect(after[0].remaining).toBe(before[0].remaining);   // ← both undefined
```

`getAvailability` projects `available`, not `remaining`, so both sides were
`undefined` and "no leaked capacity" passed **vacuously**. A neighbouring test
that happened to compare a number failed and exposed it.

It is fixed, and the assertion now checks `typeof … === "number"` first —
because a test that cannot fail is worse than no test, and this suite's whole
purpose is to catch exactly that class of comfortable illusion.

---

## WHAT IS NOT COVERED

- **No real remote mutation.** C-04's "provider reports success" is proven
  through the completion policy and the messaging capability. A real DELETE
  returning 200 needs a real provider.
- **No approval round-trip.** C-07 proves the compensation is excluded from
  `executable`; it does not drive a proposal → approval → execution cycle,
  because building the compensation-approval proposal path was beyond this
  phase's minimum.
- **No irreversible capability is registered**, so C-06 is proven through the
  policy and the fail-closed default rather than against a real effect.

END.
