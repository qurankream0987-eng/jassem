# JASIM — EXECUTION TRUTH CLOSURE
## Completion Policy + Effect Verification

**Baseline:** `1af5352`, `516a489` · **Branch:** `claude/runtime-experience-wave-1`
**Model provider connected:** NO · **Real Discovery:** NO · **Core Evolution:** NO · **Real payments:** NO
**Domain-specific verifiers added:** 0 · **DB migrations:** 0 · **New verification statuses:** 0

---

## 1. THE TRACE, BEFORE ANY CODE CHANGED

The brief required proving exactly where `VERIFIED` could be reached. Three
places, all reachable, all traced from a registered router.

### The active path

```
runtime.runsExecute                      api/routers/runtime.ts:899
  └─ executeApprovedRun                  api/runtime/jasim-runtime.ts:7725
      └─ driveRunToCompletion            :7636
          └─ executeRuntimeDagNode       :3721
              └─ verifyExecutionAttempt  :4025   ← site 1
```

`trusted-action-dispatcher.ts:583` enters the same `executeApprovedRun`, so the
approval path lands on site 1 too.

```
block2/remote-polling.ts:162
  └─ completeRemoteRuntimeDagNode        :4195
      └─ verifyExecutionAttempt          :4290   ← site 2

reconcileUncertainAttempt                :8133
  └─ verifyExecutionAttempt              :8242   ← site 3
```

### What each site established

The composite verifier runs three strategies and reduces them. For a capability
outside the three hardcoded ids (`openai-chat`, `web-research`,
`image-generation`), all three said VERIFIED on this basis:

| Strategy | What it actually checked |
|---|---|
| `RECEIPT_VALIDATION` | five identifier fields are non-empty |
| `INTERNAL_STATE_ASSERTION` | `executionStatus === 'COMPLETED'` and the result is a non-null object |
| `DATABASE_READBACK` (generic branch) | `Object.keys(result).length > 0` |

And at site 1, `executionStatus: 'COMPLETED'` is a **literal** — it means
`execute()` returned without throwing. So the whole basis for VERIFIED was:
*the code ran, and it returned an object with at least one key.*

### Measured, not reasoned

I ran the real verifier against the real shapes. Every row came back
**VERIFIED**:

```
VERIFIED | notify: notification merely QUEUED
VERIFIED | notify: provider only ACCEPTED it
VERIFIED | notify: delivery FAILED
VERIFIED | notify: BLOCKED_BY_PROVIDER
VERIFIED | notify: channel itself INCONCLUSIVE
VERIFIED | unknown capability, one junk key           { anything: "at all" }
VERIFIED | unknown capability, explicit failure       { ok: false, error: "device offline" }
VERIFIED | unknown capability, human claim            { claimedByProvider: true, evidence: "none" }
```

**This is worse than the 30-example audit predicted.** The audit said effect
verification was missing. It is also the case that a notification whose own
durable state said `FAILED` or `BLOCKED_BY_PROVIDER` was reported as VERIFIED —
not merely unverified, but *affirmatively verified while its own ledger said it
had not been delivered.* `notify` is the only registered capability with
`sideEffects: "external"`, so this was the live behaviour of the only real
effect the runtime has.

Those eight rows are now a permanent regression test, kept in both directions:
without an effect contract the output verifier still says VERIFIED (correctly —
the shape is valid), and with one it does not.

### Where the truth already existed

The codebase already contained the right model, in one place: `block3/payout.ts`.

```
REQUESTED → EXECUTED (a receipt binds to the request) → VERIFIED (independent readback agrees)
```

A receipt moves a payout to `EXECUTED` and never to `VERIFIED`; only
`reconcilePayout`, after `payoutReadback` binds on id, destination, amount and
currency, writes `VERIFIED`; and an `INCONCLUSIVE` payout throws rather than
being dispatched again. The gap was not that JASIM lacked a truth model. It was
that the truth model existed **only for money**.

---

## 2. WHAT WAS BUILT

`api/runtime/completion-policy.ts` — 594 lines, pure, no I/O, no DB, no domain.

### The two axes that were missing

Everything the runtime had was one claim source treated as proof. The module
adds the axis:

```
EXECUTOR_RETURN  →  SELF_REPORTED  →  BOUND_PROVIDER_RECEIPT
                 →  INTERNAL_READBACK  →  INDEPENDENT_READBACK  →  OWNER_CONFIRMATION
```

and the axis of effect class — describing JASIM's **relationship** to an effect,
never its subject matter:

`NONE` · `INTERNAL_STATE` · `MESSAGE_DISPATCH` · `DEVICE_COMMAND` ·
`REMOTE_MUTATION` · `HUMAN_ACTION`

Those six cover the brief's five cases: a human provider claim is `HUMAN_ACTION`
+ `SELF_REPORTED`; a device command is `DEVICE_COMMAND`; a messaging effect is
`MESSAGE_DISPATCH`; a remote API mutation is `REMOTE_MUTATION`; and
reconciliation after uncertain execution is `INDEPENDENT_READBACK` arriving late.

### The four distinctions, as enforced properties

| Distinction | How it is enforced | Asserted by |
|---|---|---|
| `PROVIDER_RESPONSE != EFFECT_OCCURRED` | `EXECUTOR_RETURN` is in `sufficientSources` for exactly one effect class — `NONE`, the one with no effect | a test that computes that set and asserts it equals `["NONE"]` |
| `RECEIPT != VERIFICATION` | `BOUND_PROVIDER_RECEIPT` is in **no** class's `sufficientSources` | a test that computes the accepting set and asserts it is empty |
| `EXECUTED != VERIFIED` | `executionStatus = COMPLETED` with `verificationStatus = PENDING` | measured on the live path (§4) |
| `VALID_OUTPUT_SHAPE != REAL_WORLD_COMPLETION` | the output verifier and the completion policy are separate halves of the composite, and the second can only lower the first | `applyCompletionDecision` + test |

### No new status, and why that is the right answer

"Executed but not yet verified" already had a name: `executionStatus = COMPLETED`
with `verificationStatus = PENDING`. Both values predate this work. And the rest
of the runtime was **already built to respect it**:

- `summarizeLatestVerification` lets a single `PENDING` attempt hold an entire
  run back from `VERIFIED`.
- `isVerifiedReceipt` refuses anything that is not `VERIFIED`.
- the conversation already had truthful Arabic for it:
  «⏳ اكتملت خطوات المعالجة، لكن التحقق ما زال معلّقًا».

So there is **no migration, no new enum member, and no new vocabulary**. The
concept was already expressible; nothing was writing it.

### The trust split, which is the whole design

A capability's output may say **what happened** (`effect.state` — a factual
lifecycle value). It may never say **how much its word is worth**.

The weight of a capability's own report is fixed at **registration**, in code, by
a human. A payload that reaches for `source`, `claimSource`, `verified`,
`verificationStatus` or `sufficientSources` is not silently stripped — it is
rejected, converted to an `UNCERTAIN` assertion, and written to the run event
log as `EFFECT_DECLARATION_REJECTED`. Something that tries to certify itself is a
security event, not a formatting quirk.

Without this the layer would be theatre: any provider could return
`{ effect: { state: "OCCURRED", source: "INDEPENDENT_READBACK" } }` and grade
its own homework.

### How VERIFIED stays reachable

A layer that only ever withholds is not a verifier. Two mechanisms grant it:

1. **`resolveEffect`** — trusted server code, registered beside a capability,
   that reads the effect back from the authority that owns it. Being code, it
   states its own claim source honestly. A resolver that throws becomes
   `UNCERTAIN`, never optimistic: a verifier that cannot reach its authority has
   learnt that it does not know.
2. **`reconcileUncertainAttempt`'s `lookup`** — the pre-existing hook that asks
   the owning system what became of an uncertain attempt. It now enters as
   `INDEPENDENT_READBACK`, which every effectful class accepts. This upgrades
   reconciliation from a shape re-check into real effect verification, and is
   case 5 of the brief.

---

## 3. THE ONE REAL EFFECT, WIRED HONESTLY

`notify` is declared `MESSAGE_DISPATCH`, and its resolver re-reads the durable
`notification_intents` row — owner-scoped, by id — rather than trusting the
snapshot the capability returned before any redelivery job ran.

The state mapping rests on a fact about the code, not an assumption:

> **Only `inAppAdapter` can ever return `DELIVERED`**, and only when
> `isOnline(recipientId)` was true — JASIM's own socket, JASIM's own
> observation. Every external adapter (push, sms, email, webhook) tops out at
> `PROVIDER_ACCEPTED`, because none of them knows whether delivery happened.

So `DELIVERED`/`READ` is genuinely an `INTERNAL_READBACK`, while
`PROVIDER_ACCEPTED`/`SENT` is `SELF_REPORTED`. That claim is **pinned by a test**
that reads the adapter source between `pushAdapter` and `inAppAdapter` and
asserts none of them returns `DELIVERED` — so if an adapter ever starts claiming
delivery, the mapping fails loudly instead of quietly inheriting an authority it
no longer has.

| Ledger state | Effect | Source | Decision |
|---|---|---|---|
| `DELIVERED`, `READ` | OCCURRED | `INTERNAL_READBACK` | **VERIFIED** |
| `FAILED`, `BLOCKED_BY_PROVIDER` | NOT_OCCURRED | `INTERNAL_READBACK` | **FAILED** |
| `QUEUED` | PENDING | `INTERNAL_READBACK` | **PENDING** |
| `PROVIDER_ACCEPTED`, `SENT` | PENDING | `SELF_REPORTED` | **PENDING** |
| anything else | UNCERTAIN | `INTERNAL_READBACK` | **INCONCLUSIVE** |
| row not readable by this owner | UNCERTAIN | — | **INCONCLUSIVE** |

---

## 4. EVIDENCE ON THE LIVE PATH

Not a fixture. A run created with `createRuntimeRun`, a DAG built with
`createRuntimeDag`, and driven by the shipped `driveRunToCompletion` →
`executeRuntimeDagNode`, against an isolated proof database that the runtime's
own connection is repointed at. The ledger rows below are verbatim.

### A pure capability — unchanged, which matters as much

```
### local-calculation
executionStatus    = COMPLETED
verificationStatus = VERIFIED
completion = { "effectKind": "NONE", "decision": "VERIFIED",
               "reasonCode": "NO_EFFECT_TO_VERIFY",
               "confirmedBy": "EXECUTOR_RETURN", "retryPermitted": true }
receipt.status     = verified / VERIFIED
```

Nearly every registered capability is read-only. None of them became harder to
complete because effectful ones did.

### The messaging effect — the case this phase exists for

```
### notify
executionStatus    = COMPLETED          ← the step really did execute
verificationStatus = PENDING            ← was VERIFIED before this work
completion = {
  "effectKind": "MESSAGE_DISPATCH",
  "decision": "PENDING",
  "reasonCode": "EFFECT_STILL_IN_FLIGHT",
  "retryPermitted": false,
  "assertions": [ { "state": "PENDING", "source": "SELF_REPORTED",
                    "authority": "notification-ledger",
                    "reference": "nti_68cbcea5-…" } ],
  "missingEvidence": [ "INTERNAL_READBACK", "INDEPENDENT_READBACK", "OWNER_CONFIRMATION" ]
}
receipt.status     = partial / PENDING  ← was verified / VERIFIED
```

Read the two rows together: the step executed and the effect is unconfirmed, and
both are now sayable at once. The ledger also records **what would have been
accepted**, so the row is an audit record rather than a verdict without a
reason.

### The node is not failed, and that is deliberate

A `PENDING` attempt lets its node **complete** and emits
`EFFECT_AWAITING_CONFIRMATION`. Failing the node would be the opposite error —
asserting that nothing happened when something may well have. The withholding
happens where it belongs: in the attempt ledger, which is what decides the
receipt and therefore what the user is told.

A structural test pins that `PENDING` is not routed into the `INCONCLUSIVE`
node-failure branch.

### Ten properties, each asserted

| # | Property | Where |
|---|---|---|
| 1 | The eight rows that used to be VERIFIED are no longer | `tests/unit/completion-policy.test.ts` |
| 2 | `EXECUTOR_RETURN` verifies exactly one class, and it has no effect | same |
| 3 | No class accepts a bound receipt — the payment rule, generalized | same |
| 4 | An independent readback does verify, so VERIFIED stays reachable | same |
| 5 | A self-certifying payload becomes UNCERTAIN and is logged | same |
| 6 | The layer can only lower a verdict, never raise one | same |
| 7 | A real delivered notification verifies; four other states do not | `tests/block2/effect-verification.test.ts` |
| 8 | A live run records the effect verdict and withholds the receipt | `tests/block31/execution-truth.test.ts` |
| 9 | All three verifier call sites supply a contract, and there is no fourth | `tests/unit/completion-policy.test.ts` |
| 10 | A refused effect fails its node instead of completing it (§6b) | same |

Property 9 is the one that keeps this closed. The count of
`verifyExecutionAttempt` call sites is pinned at three, each is asserted to pass
`completion`, and each is asserted to take its `effectKind` **from the registry**
rather than a literal — because a hardcoded `effectKind: "NONE"` at a call site
would be a permanent exemption for everything flowing through it.

### Compatibility with the payment model, asserted rather than claimed

Two tests read `block3/payout.ts` and assert that a payout still reaches
`VERIFIED` only inside `reconcilePayout`, still refuses a blind retry, and that
no generic policy accepts `BOUND_PROVIDER_RECEIPT` or `SELF_REPORTED` — so the
generic path can never become a way around the stricter money path. Money keeps
its own route; it is now the *example* rather than the exception.

---

## 5. FAIL-CLOSED CHOICES, STATED PLAINLY

1. **An undeclared external capability resolves to `REMOTE_MUTATION`** — the
   strictest class. A capability that acquires a real effect and forgets to say
   so becomes *harder* to verify, not easier. Forgetting must never be the
   permissive path.
2. **An unknown capability id resolves to `REMOTE_MUTATION` with no resolver.**
   The runtime cannot verify the effect of something it cannot identify, so it
   must not claim to.
3. **A thrown resolver is `UNCERTAIN`.** Not "assume fine".
4. **A readback that cannot see the row is `UNCERTAIN`, never `NOT_OCCURRED`.**
   Owner isolation must not be readable as evidence about the effect.
5. **Every effectful class is `RECONCILE_ONLY`.** `payout.ts`'s "blind retry
   forbidden", said once for everything instead of once for money.
6. **A party is always believed when it says its own effect failed**, from any
   source. Trust is asymmetric on purpose: claiming failure costs the claimant,
   claiming success profits them.

---

## 6. ONE HOLE I OPENED AND CLOSED

While wiring reconciliation I added an `INTERNAL_READBACK` assertion whenever the
DAG node was `COMPLETED` — reasoning that JASIM owns its own DAG.

That was wrong, and it would have re-opened the exact gap this phase closes. A
`COMPLETED` DAG node records that the **step** finished. For an `INTERNAL_STATE`
effect that is the effect itself; for a message, a device or a remote mutation it
is only JASIM's note of what the executor claimed — and reading our own note of
somebody else's word is not independent evidence.

It now resolves to `INTERNAL_READBACK` only for `INTERNAL_STATE`, and to
`EXECUTOR_RETURN` otherwise. A test pins the conditional.

---

## 6b. A BEHAVIOUR CHANGE THIS FORCED, AND IT IS THE RIGHT ONE

Adversarially re-reading my own diff turned up a second problem — this one
pre-existing, and made sharp by the new layer.

`executeRuntimeDagNode` handled `INCONCLUSIVE` and nothing else. A
`verificationStatus` of `FAILED` **fell through to `completeRuntimeDagNode`**, so
the node completed and dependent nodes were free to build on it. That branch used
to be nearly unreachable — only a malformed attempt record or a wrong output
`kind` produced `FAILED` — so the fall-through was latent.

The completion policy makes it reachable on purpose: a notification whose ledger
says `BLOCKED_BY_PROVIDER` now decides `FAILED`. Left alone, the outcome would
have been the sharpest possible version of the bug this phase exists to close —
**the attempt ledger recording that the effect did not happen while the DAG
records that the step did.**

So `FAILED` now fails the node, with a deliberate difference in error code:

| Verdict | Node | Code | Why |
|---|---|---|---|
| `FAILED` | fails | `RETRYABLE` | nothing happened, so acting again is safe; `maxAttempts` still bounds it |
| `INCONCLUSIVE` | fails | `PERMANENT` | something **may** have happened; repeating it is the one thing that must not be automatic |
| `PENDING` | completes | — | the step ran; the effect is unconfirmed and the receipt withholds |

That asymmetry is the whole `INCONCLUSIVE != FAILED` rule, expressed as a retry
policy instead of a comment. Three tests pin the ordering, the codes, and that
`FAILED` returns before the completion call.

**This is a change in runtime behaviour beyond adding a verification layer, and
it is disclosed rather than folded into "no regressions".** It is also why the
main suite grew by three more tests after I had already declared it green once.

---

## 7. ONE TRUTHFULNESS FIX IN PASSING

`appendDagNodeEvent` built its payload as
`{ nodeId, ...data, effects: "none" }` — with the literal **after** the spread,
so every runtime node event asserted that the step had no effects, and no caller
could say otherwise. It is now before the spread, and the new
`EFFECT_AWAITING_CONFIRMATION` event declares `effects: "external"`. Asserted.

---

## 8. WHAT A REVIEWER SHOULD DOUBT

1. **`MESSAGE_DISPATCH` is the only effect class with a live wiring.**
   `DEVICE_COMMAND`, `REMOTE_MUTATION` and `HUMAN_ACTION` have policies, tests
   and fail-closed defaults, but no registered capability of those kinds exists
   yet, because the runtime has no device, no remote mutation and no human
   provider. Their *decision logic* is proven; their *integration* is proven
   only for the shapes the runtime can currently produce.
2. **Remote MCP/A2A completions now land on `PENDING`.** A remote provider's
   task completion resolves to `REMOTE_MUTATION` by the fail-closed default, so a
   bound receipt yields `PENDING`. This is correct by the payment rule, and it is
   also **conservative for remote reads**: a remote tool that only reads has no
   effect to verify but cannot say so, because nothing declares a remote
   capability's effect class. Closing that needs the MCP/A2A catalog to carry an
   effect declaration — a real follow-up, and deliberately not smuggled into
   this phase.
3. **`block3` grew from 133 to 198 collected tests.** Nothing was added there.
   The earlier figure was measured with file parallelism on, under which the
   block suites race on their shared proof database and some files fail to
   collect. Run with `--no-file-parallelism` they are all green. **The 133 in
   earlier reports understated the suite**, and my own earlier counters were
   measured the same way.
4. **`notify`'s verdict in this environment is `PENDING`, not `VERIFIED`.** No
   notification channel is configured here, so the in-app adapter returns `SENT`
   rather than `DELIVERED`. A delivered notification verifying is proven against
   a real ledger in `tests/block2/effect-verification.test.ts`, not on the live
   run — that needs an online recipient socket.
5. **No model provider was connected**, so no capability whose effect is a model
   call was exercised end-to-end. Those are all `NONE`-effect and unchanged.

---

## 9. WHAT WAS NOT TOUCHED

No UI file. No model gateway policy, tier table, budget or ledger. No payment,
payout, PSP or economic code. No Real Discovery. No Core Evolution. No auth, no
middleware, no session. No DB migration. No test weakened, skipped or deleted.

```
DOMAIN_SPECIFIC_VERIFIERS_ADDED     = 0
ARCHITECTURE_FREEZE_VIOLATIONS      = 0
DB_MIGRATIONS                       = 0
NEW_VERIFICATION_STATUSES           = 0
INHERITED_TESTS_MODIFIED            = 0
RUNTIME_BEHAVIOUR_CHANGES           = 1    (§6b, plus the event-payload fix in §7)
```

---

## 10. COUNTERS

```
EXECUTION_TRUTH_CLOSURE             = PASS

PROVIDER_RESPONSE_EQUALS_EFFECT     = NO   (EXECUTOR_RETURN verifies only the effectless class)
RECEIPT_EQUALS_VERIFICATION         = NO   (no class accepts BOUND_PROVIDER_RECEIPT)
EXECUTED_EQUALS_VERIFIED            = NO   (COMPLETED + PENDING, measured live)
VALID_SHAPE_EQUALS_COMPLETION       = NO   (separate halves; downgrade-only)

VERIFIED_REACHABLE_FROM_EXECUTOR_RETURN_ALONE = NO  (for every effectful class)
VERIFIED_STILL_REACHABLE            = YES  (independent readback / owner confirmation)
INCONCLUSIVE_BECOMES_SUCCESS        = NO
PENDING_BECOMES_SUCCESS             = NO
BLIND_RETRY_AFTER_UNCERTAINTY       = FORBIDDEN (every effectful class)
SELF_CERTIFYING_PAYLOAD_ACCEPTED    = NO   (rejected + logged)
REFUSED_EFFECT_COMPLETES_ITS_NODE   = NO   (§6b — changed behaviour, disclosed)
PAYMENT_TRUTH_MODEL_WEAKENED        = NO   (asserted against payout.ts)

GENERIC_EFFECT_CLASSES              = 6
CLAIM_SOURCES                       = 6
VERIFIER_CALL_SITES_WIRED           = 3 / 3   (count pinned)
CAPABILITIES_WITH_A_LIVE_EFFECT     = 1 / 1   (notify)

MAIN_SUITE                          = 1285 / 1285 (+8 skipped: gated live-model, visual, shell)
BLOCK_2                             = 115 / 115
BLOCK_3                             = 133 / 133   (see §10a — `203` retracted)
BLOCK_3_1                           = 70 / 70
TYPECHECK (tsc -b)                  = PASS
WEB_BUILD                           = PASS (6.21s)
```

### 10a. How the suite numbers were measured, and why they moved

The block suites drop and recreate a shared proof database, so with file
parallelism on they race: files fail to collect, and the run reports both
failures and a smaller total. Every figure above was taken with
`--no-file-parallelism`, and `block3` was measured **twice consecutively** at
`203 / 203` to be sure the count was settled rather than a partial collection.

Two corrections to earlier reports follow from that, and they are mine:

- ~~Earlier reports said `BLOCK_3 = 133 / 133`. The suite has 203 tests. The 133
  was a partial collection reported as a whole one.~~
  **THIS CORRECTION WAS ITSELF WRONG — retracted 2026-09-19.** `BLOCK_3` is
  **133**, and always was. Re-measured at the Wave 1 continuity audit:
  `tests/block3/` and `vitest.block3.config.ts` are byte-identical between this
  commit and HEAD (`git diff --stat 8bfaaeb HEAD` over both paths is empty), and
  the suite collects **17 of 17 files** for 133 tests — not a partial
  collection. `203` is `133` (Block 3) **plus** `70` (Block 3.1 at that time):
  two consecutive suite totals read as one. The original `133` was correct and
  this paragraph replaced it with a wrong number.
- ~~My first measurement in this phase said `198`…~~ Also retracted: `198` was a
  genuinely partial collection, but the figure it was being corrected toward
  was the summed one. No `tests/block3` file has ever been deleted —
  `git log --diff-filter=D` over `tests/` for the whole repository history
  returns nothing.

Nothing in `tests/block3` was changed by this phase — `git diff --stat` against
that directory is empty. The growth in the other suites is entirely the new
files: `block2` 101 → 115 (+14), `block31` 65 → 70 (+5), main 1219 → 1285 (+66).

---

## 11. WHAT THIS UNBLOCKS, AND WHAT IT DOES NOT

The 30-example audit's sharpest finding was that `CompletionPolicy` did not
exist — that `execution-verifier.ts` checked a capability's output **shape**, not
its **effect**. That concept now exists, is generic, is enforced at every path
that can reach `VERIFIED`, and is measured on the live one.

What it does **not** do is give JASIM more effects to verify. There is still
exactly one capability with a real effect. The layer is deliberately built so
that the next one — a device, a booking, a human provider — needs a *declaration
and a resolver*, not a verifier:

1. declare `effectKind` on the capability (or leave it, and inherit the
   strictest class), and
2. write a `resolveEffect` that reads the authority that owns the effect.

If a future capability ever needs a bespoke verifier inside JASIM's core, that is
the signal the 30-example document names: generality has failed. The test that
reads this module's own code and asserts it names no domain is there to make that
failure visible rather than gradual.

**Recommended next, and still the user's call:** this closes the gap the audit
identified before roadmap Stage 3. The outstanding decision is unchanged — a
development model credential would unblock Stage 1 and the last of the UI-2.1
evidence together. This phase needed no credential, which is why it was the right
thing to do while waiting.

END OF REPORT.

