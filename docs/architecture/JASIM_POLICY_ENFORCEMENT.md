# JASIM — A STORED POLICY IS NOT AN ENFORCED POLICY

```
POLICY STORED != POLICY ENFORCED
POLICY TEXT   != EXECUTABLE POLICY
MODEL INTERPRETATION != AUTHORITY
UNKNOWN POLICY SEMANTICS != ALLOW
POLICY ABSENCE          != POLICY DENIAL
```

---

## 1. What was actually there

Traced before anything was changed.

| | where | what it did |
|---|---|---|
| `scopePolicies` | `db/schema-block2.ts` | id, scopeId, policyKey, **free-form `value`**, version, state, setByPrincipalId |
| `setScopePolicy` | `api/runtime/actor-scope.ts` | requires `manage_policies`, appends a new version |
| `getScopePolicy` | `api/runtime/actor-scope.ts` | requires `view`, returns the newest active row — **called by nothing in production** |
| `scopePolicyHistory` | `api/runtime/actor-scope.ts` | the versions, for audit |
| `policy.set` | `api/runtime/authority-acts.ts` | the conversational path, added last phase |
| `authorizeScopeAction` | `api/runtime/actor-scope.ts` | membership permission — **PERMISSION, not policy** |
| `evaluateExecutionPolicy` | `api/runtime/capability-registry.ts:659` | a *static* gate: sensitive-capability regex, binding present, plan approved. Reads no row. |
| `completion-policy.ts` · `compensation-policy.ts` · `model-policy.ts` | | three other meanings of the word "policy": effect verification, reversibility, model tier. None is a scope rule. |

And the finding that shaped everything else: **`value` defined no semantics at
all.** It was screened for authority keys and otherwise accepted anything. So
"start enforcing the existing rows" was not available — there was nothing in
them to enforce.

Where enforcement had to reach:

| | |
|---|---|
| capability execution | `executeRuntimeDagNode` → after `resolveRuntimeDagExecutionInputs`, before the provider call |
| agreement commitment | `commitAgreement` in `agreement-runtime.ts` |
| authority acts | `requestAuthorityAct` / `approveAuthorityRequest` |
| a future transaction | nothing exists; `transactionIntents` and `external-action-session.ts` are where it will enter |

## 2. What a policy row is now

Nothing was added to the schema. `value` carries a typed body, and `version`,
`state` and `createdAt` already carried the versioning:

```jsonc
{
  "policySchema": "jasim.policy/1",
  "actions": ["agreement.commit"],          // or ["*"]
  "conditions": [{ "field": "terms.price", "operator": "gt", "value": 200 }],
  "effect": "REQUIRE_APPROVAL",             // ALLOW · DENY · REQUIRE_APPROVAL · CONSTRAIN
  "requires": [],                            // for CONSTRAIN
  "effectiveFrom": "…", "effectiveUntil": "…"
}
```

Three classes, and only one enforces:

| body | class | consequence |
|---|---|---|
| carries no `policySchema` | `RECORDED_ONLY` | scope configuration. Takes no part in any decision, and never claimed to. |
| carries it and parses | `ENFORCED` | a rule |
| **carries it and does not parse** | `MALFORMED` | fails closed: nothing proceeds in that scope |

The third row is the one that matters. Prose cannot become a rule by sitting
next to rules, and a rule that cannot be read is never silently skipped.

Operators are the fabric's own closed set — `eq, neq, gte, lte, gt, lt,
contains`. `within_time` and `compatible` are deliberately absent: both need
context to evaluate, and a comparison that needs context can be wrong in two
places.

## 3. One boundary

```ts
evaluatePolicies({ scopeId, action, parameters?, resourceRefs?, now? })
  → { outcome, reasons, consulted }
```

`action` is a registered act id, a capability id, or anything a future runtime
invents. The function knows nothing about what an action *is*, has no branch per
capability and no hook per domain.

It is called from exactly three places:

1. **The turn** — so a person is told now rather than after a run was opened
   that was never going to be allowed to finish.
2. **The executor**, immediately before the effect, with the inputs finally
   resolved — so a node whose parameter was bound from an upstream result is
   checked against the values that will actually execute. This is the boundary
   that matters.
3. **`commitAgreement`**, where an agreement becomes a fact.

Resolution is narrowest-first and nothing can raise an outcome:

```
UNSUPPORTED_POLICY  >  DENIED  >  REQUIRES_APPROVAL  >  ALLOWED
```

`ALLOW` records an intention and widens nothing — an explicit permission cannot
erase a denial in the same scope. `CONSTRAIN` **refuses rather than rewrites**:
clamping somebody's parameters to make them legal is the runtime negotiating on
their behalf without being asked.

A worker cannot ask anybody, so a `REQUIRE_APPROVAL` reaching the executor fails
the node with `POLICY_REQUIRES_APPROVAL` rather than proceeding. The plan
approval it already had was not the approval the rule asked for.

## 4. Four questions that compose

```
PERMISSION != POLICY != AUTHORITY ENVELOPE != APPROVAL
APPROVAL   != POLICY OVERRIDE
```

The generic case, proven end to end:

| | |
|---|---|
| authority envelope | may negotiate up to **250** |
| business rule | any commitment above **200** needs a person |
| at **190** | the envelope agrees; the rule does not apply |
| at **225** | the envelope is wide enough **and the rule still sends it to a person** |
| at **260** | the authority itself is exceeded, whatever the rule says |

Broader authority never erases a narrower rule, and a `DENY` stops the owner
too: approving what a rule denies does not make it permitted.

## 5. The statement carries the decision

The authority statement renders the policy decision — outcome, policy ids,
versions, effects, reason codes — **inside** itself. Three things fall out with
no new machinery:

- **§7** the person sees the rule's verdict beside the parameters that will
  execute;
- **§8** a rule written while they were reading moves the digest, so the old
  approval is `VOID` with `STATEMENT_CHANGED`;
- **§10** the decision is attributable to the version that produced it, and the
  superseded version is still on the record.

And `policy.set` renders its own classification on a line: `enforcement =
ENFORCED` or `RECORDED_ONLY`, with the effect and every condition spelled out
when it is a rule. A person who asked for a rule and is getting a note can see
that before they approve it.

## 6. One path convention

A rule names its fields by dotted path — `terms.price`, `bounds.price.reserve`,
`attributes.quantity` — and those are **the same paths the authority statement
renders as lines**. The walk lives in `policy-enforcement.ts` and the statement
renderer uses it, deliberately: two conventions would be two meanings of one
sentence.

That also produced the phase's one real finding. See §8.

## 7. What is never disclosed

A decision carries `policyId`, `policyKey`, `version`, `effect`, a reason code
and — for an unsatisfied constraint — the **field** it named, so a caller can
propose something legal. It never carries the body. A seller's floor, a buyer's
ceiling and an internal threshold all steer outcomes without being disclosed,
and a "reason" that quoted the rule would disclose every one of them.

`disclosableDecision()` is what may reach a statement, an event or a log, and
its shape is fixed at two keys.

## 8. One defect the proof found

An `agreement.commit` statement rendered its terms as `"225 JOD"` — value and
unit formatted together, which reads well. The policy `terms.price gt 200` then
compared a **string** to a number, did not hold, and the rule silently did not
apply.

The rule was doing exactly what it was told. The bug was that the fact a person
*reads* had stopped being the fact a rule *compares*:

```
A FACT THAT IS DISPLAYED MUST BE THE FACT THAT IS COMPARED.
```

Terms now render `terms.price = 225` and `units.price = "JOD"` as two lines. A
silently non-matching rule is worse than one that errors, because nothing
anywhere says it did not fire.

## 9. What is not built

- **No closing of the executor's approval loop.** A `REQUIRE_APPROVAL` rule that
  bites at the executor fails the node truthfully; turning that into an
  authority request automatically is not built. Where an act exists — all seven,
  including `agreement.commit` — the authority path is already the answer.
- **No transaction runtime.** `GENERAL_TRANSACTION_FULFILLMENT` is untouched.
  The boundary takes an unregistered action id and returns a deterministic
  decision today, which is proven, and that is all this phase claims.
- **No second policy schema.** The identifier carries a version so one can
  exist; nothing needed it yet.
- **No policy over who may read.** These rules govern acts, not visibility.
  Visibility is permissions and projections, and it already works.
