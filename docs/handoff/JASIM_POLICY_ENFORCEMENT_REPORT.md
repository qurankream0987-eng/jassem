# JASIM — GENERAL POLICY ENFORCEMENT · micro-closure report

```
POLICY STORED != POLICY ENFORCED
```

**Rule held throughout:** `DOMAIN_POLICY_TYPES_ADDED = 0` ·
`DOMAIN_POLICY_EVALUATORS_ADDED = 0` · `NEW_DOMAIN_BRANCHES = 0` ·
`FALSE_SUCCESS = 0`. `GENERAL_TRANSACTION_FULFILLMENT` was not started.

---

## 1. §0 · What the trace actually found

| | where |
|---|---|
| `scopePolicies` | `db/schema-block2.ts` — id, scopeId, policyKey, **free-form `value`**, version, state, setByPrincipalId, createdAt |
| `setScopePolicy` / `getScopePolicy` / `scopePolicyHistory` | `api/runtime/actor-scope.ts` |
| `policy.set` act | `api/runtime/authority-acts.ts` |
| `authorizeScopeAction` | `api/runtime/actor-scope.ts` — **permission, not policy** |
| `evaluateExecutionPolicy` | `api/runtime/capability-registry.ts:659` — a static gate (sensitive-capability regex, binding present, plan approved). Reads no row. |
| `completion-policy.ts`, `compensation-policy.ts`, `model-policy.ts` | three other meanings of the word: effect verification, reversibility, model tier |
| capability execution | `executeRuntimeDagNode`, after `resolveRuntimeDagExecutionInputs` |
| commitment | `commitAgreement` in `agreement-runtime.ts` |
| a future transaction | nothing exists; `transactionIntents` and `external-action-session.ts` are the entry |

`getScopePolicy` had **no production caller**. And the finding that shaped the
phase: **`value` defined no semantics at all** — it was screened for authority
keys and otherwise accepted anything. "Start enforcing the existing rows" was
not available, because there was nothing in them to enforce.

No new framework was created and **no migration was needed**: the typed body
lives in `value`, and `version` / `state` / `createdAt` already carried the
versioning the brief lists.

## 2. §1–§3 · Three classes, and only one enforces

| body | class | consequence |
|---|---|---|
| no `policySchema` | `RECORDED_ONLY` | scope configuration; takes no part in any decision, and never claimed to |
| carries it and parses | `ENFORCED` | a rule |
| carries it and does **not** parse | `MALFORMED` | fails closed — nothing proceeds in that scope |

The third is the point. Prose cannot become a rule by sitting next to rules, and
a rule that cannot be read is never silently skipped.

`policy.set` renders its own classification as a line the person reads —
`enforcement = ENFORCED` or `RECORDED_ONLY` — with the effect and every
condition spelled out when it is a rule. Somebody who asked for a rule and is
getting a note sees that before approving.

No model is consulted at enforcement time, and it cannot be: the module imports
nothing that could reach one, and a test asserts the gateway is never called
while a decision is taken.

## 3. §4–§6 · One boundary, four effects

```ts
evaluatePolicies({ scopeId, action, parameters?, resourceRefs?, now? })
```

Called from exactly three places — the turn (early truth), the **executor
immediately before the effect** (the boundary that matters, with inputs finally
resolved), and `commitAgreement`. No capability reads a rule of its own, and
there is no hook to add one per domain.

Narrowest-first, and nothing can raise an outcome:

```
UNSUPPORTED_POLICY > DENIED > REQUIRES_APPROVAL > ALLOWED
```

`ALLOW` widens nothing. `CONSTRAIN` **refuses rather than rewrites**: clamping
parameters to make them legal is the runtime negotiating on someone's behalf
without being asked. A worker cannot ask anybody, so `REQUIRE_APPROVAL` reaching
the executor fails the node with `POLICY_REQUIRES_APPROVAL` — the plan approval
it already had was not the approval the rule asked for. Where an act exists, the
authority administration path is the answer and no second mechanism was built.

## 4. §5 · §11 · Four questions composing

| | |
|---|---|
| envelope | may negotiate up to **250** |
| rule | any commitment above **200** needs a person |
| **190** | the envelope agrees; the rule does not apply |
| **225** | the envelope is wide enough **and the rule still sends it to a person** |
| **260** | the authority itself is exceeded, whatever the rule says |

Proven end to end. Broader authority never erases a narrower rule, and a `DENY`
stops the owner too: `APPROVAL != POLICY OVERRIDE`.

## 5. §7 · §8 · §10 · The statement carries the decision

The authority statement renders the decision — outcome, ids, versions, effects,
reason codes — **inside** itself. Three requirements fall out with no new
machinery and no weakening of the digest:

- the person sees the verdict beside the parameters that will execute;
- a rule written while they were reading moves the digest → `VOID` /
  `STATEMENT_CHANGED`, proven;
- the decision is attributable to the version that produced it, and the
  superseded version is still on the record.

## 6. One defect the proof found

An `agreement.commit` statement rendered its terms as `"225 JOD"` — value and
unit formatted together, which reads well. The rule `terms.price gt 200` then
compared a **string** to a number, did not hold, and silently did not apply.

The rule was doing exactly what it was told. The bug was that the fact a person
*reads* had stopped being the fact a rule *compares*:

```
A FACT THAT IS DISPLAYED MUST BE THE FACT THAT IS COMPARED.
```

Terms now render `terms.price = 225` and `units.price = "JOD"` as two lines, and
one dotted-path walk — shared between the statement renderer and the policy
evaluator — is what keeps the two from drifting again. A silently non-matching
rule is worse than one that errors, because nothing anywhere says it did not
fire.

## 7. §13 · Holdouts

Six unrelated worlds through the same evaluator, each with a compliant case and
a violating one: laboratory instrument hours, temporary generator kilowatts,
warehouse pallets moved, human-service spending, machine run-minutes, apiary
hives lent. No evaluator, no type, no branch.

## 8. §14 · Security

Proven: cross-scope rules decide nothing outside their scope; one person cannot
write a rule into another's scope; `policyDecision`, `policyVersion`,
`policyOverride`, `policyId`, `bypass`, `trusted`, `exempt` and `enforced` are
refused in a body, in a condition, and in model output; an unknown operator is
refused rather than approximated; a missing or incomparable fact does not
satisfy a requirement; a stale version cannot authorize; a malformed rule fails
closed; and a decision discloses ids, versions and codes while the bound itself
never appears — not in the reason, not in the turn output, not in a log.

## 9. §12 · Prepared, not built

A future transaction runtime submits `{ scopeId, action: "transaction.execute",
parameters, resourceRefs }` and gets a deterministic decision today — the same
question twice is the same answer twice, and a rule may name a resource
reference as readily as a parameter. `GENERAL_TRANSACTION_FULFILLMENT` was not
started and nothing transaction-specific exists.

## 10. Proof

| file | tests |
|---|---:|
| `tests/block31/policy-enforcement.test.ts` | 48 |
| `tests/unit/policy-contract.test.ts` | 26 |

The live path: «ضع سياسة: أي التزام يتجاوز 200 يحتاج موافقتي» → read (the 200 on
its own line, `enforcement = ENFORCED`) → approved → 190 agrees under the
envelope → 225 refuses the envelope and requires the person → the person's
statement shows `terms.price = 225` → a wrong digest performs nothing → a rule
written after a statement was read voids the approval.

## 11. Catalog effect

`POLICY_ENFORCEMENT` is **closed** — the fourth gap in four phases.

| gate | before | after |
|---|---:|---:|
| EXECUTABLE | 84 | **85** |
| OBSERVABLE | 77 | **78** |
| VERIFIABLE | 72 | **73** |
| waiting on a general capability | 50 | **49** |

One scenario, which is what a micro-closure looks like when it is reported
honestly. `jasimos.policies` — «طبّق سياسات مطعمي» — is the only one that was
waiting on it.

**162 scenarios · 16 blind holdouts · 7 blind ideas · 11 general gaps.**

A dead branch in the catalog still naming the closed `AUTHORITY_ADMINISTRATION_PATH`
was removed. It typechecked only because the branch was unreachable, which is
exactly how a closed gap comes back.

## 12. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2086 passed, 27 skipped · 91 files | 2059, 27 · 90 | +27, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 440 · 31 files | 392 · 30 | +48, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

Two inherited tests changed, both because a path convention was unified rather
than loosened: `authority-act-contract` now checks the sort in the shared walk,
and `authority-administration` reads `terms.price = 240` plus `units.price` where
it read `"240 JOD"`. No assertion was weakened and none was removed.

## 13. Next

`SECURE_PRODUCT_ACTION_RUNTIME`, `PERSISTENT_WORLD_MATERIALIZATION` and
`GENERAL_TRANSACTION_FULFILLMENT` all sit at 9.

The transaction runtime now has a policy boundary waiting for it, which was the
point of preparing it here. It remains the gap where faking a pass is easiest:
closing a commitment on the word of the party who owes it would make nine
scenarios green and mean nothing.
