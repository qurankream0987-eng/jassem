# JASIM — GENERAL TRANSACTION + FULFILLMENT RUNTIME · phase report

```
COMMITMENT != TRANSACTION != PAYMENT != FULFILLMENT != VERIFICATION
PAID != DELIVERED
CLAIMED_COMPLETE != VERIFIED_COMPLETE
```

---

## 1. §0 · The trace

- **Only intent:** `transactionIntents` — accepting a proposal produced one and
  nothing consumed it.
- **Already a real commitment:** `commitments`, created from declared `owedBy`
  and permanently `open`, because nothing could close one.
- **Could execute:** payment, against a PSP that is not configured.
- **Could be fulfilled:** nothing. There was no fulfillment model at all.
- **Could be verified:** any capability *attempt*, through the bridge —
  obligations were attached to nothing.
- **`commercialOrders`** was the closest existing thing and is **not** the
  general transaction: `buyerRef`, `sellerRef` and a `FULFILLED` status a caller
  sets. It is Block 3's checkout binding and is untouched.

## 2. Reused rather than duplicated

**No `obligations` table was created, because one already existed under another
name.** A Commitment *is* an obligation, so it gained a beneficiary, the
evidence that would prove it, an observation subject, a settlement, a payment
link and a `verification` column beside its `state`. Two tables meaning the same
thing is how a system comes to have two answers.

Reused whole: Block 3's payment runtime (**one** nullable `transactionId`
column and nothing else), the observation bridge, `decideCompletion`, the
compensation policy, the policy boundary, the authority path.

Built: `transactions` — parties as a **list**, a terms snapshot and digest, the
origin, the authority basis, the policy decision, and a **derived** state.

## 3. The decisions that carry the phase

**Parties, not roles.** No `buyerRef`, no `sellerRef`. The live proof has two
obligations pointing opposite ways in one transaction, and a schema test greps
the table for both words.

**Evidence defaults to the strictest.** An undeclared `evidenceKind` is
`HUMAN_ACTION`, where a party's own word settles nothing. Forgetting to declare
can never make an obligation easier to settle.

**The state is derived, every time it is asked.** Nothing writes `SETTLED`, and
a test greps for it. A payment verified while a delivery is pending is an
`OPEN` transaction — proven as a function and on the live path.

**Materialization sits inside `commitAgreement` but outside its database
transaction.** A policy refusing to execute must not roll back an agreement two
people actually reached. `AGREEMENT != TRANSACTION`, including when only one is
possible.

**Idempotency is the unique index on `agreementId`.** Ten simultaneous
materializations produce one transaction and nine `created: false` — no lock
anybody had to remember to take.

## 4. Proof

| file | tests |
|---|---:|
| `tests/block31/transaction-fulfillment.test.ts` | 40 |
| `tests/unit/transaction-contract.test.ts` | 30 |

The live path: «اتفقنا — ثبّت الاتفاق» → an authority request whose statement
shows every term, its unit and who owes it → the person cites the digest →
agreement, commitments, transaction. Then the payment obligation verifies
through a real observation and the delivery does not, and the transaction stays
`OPEN` with `outstanding = 1`.

Seven unrelated exchanges settle through the same rows: goods, laboratory
instrument time, generator capacity, warehouse pallet-days, a human
translation, machine fabrication minutes and a falconry stand reservation.

## 5. Catalog effect

`GENERAL_TRANSACTION_FULFILLMENT` is **closed** — the fifth gap in five phases.

| gate | before | after |
|---|---:|---:|
| PLANNABLE | 133 | **138** |
| EXECUTABLE | 85 | **89** |
| OBSERVABLE | 78 | 76 |
| VERIFIABLE | 73 | 71 |
| blocked by a **provider** | 31 | **35** |
| waiting on a general capability | 49 | **40** |

**Nine scenarios moved, and two gates went DOWN.** That is the honest shape of
this phase:

| moved | to | why |
|---|---|---|
| `transaction.cancel` | `EXECUTABLE = PASS` | cancelling is canonical state JASIM owns; after a verified obligation it becomes COMPENSATING |
| `transaction.fulfillment` | `EXECUTABLE = PASS` | «هل وصل الطلب؟» is answered by the projection, and an unobserved delivery reads PENDING |
| `idea.elder_companionship_rota` · `idea.rare_seed_lending_ring` | `EXECUTABLE`/`OBSERVABLE`/`VERIFIABLE = PASS` | a turn slot and a seed return are obligations that close on the beneficiary's confirmation and nobody else's |
| `transaction.buy` · `sell` · `book` · `reserve` | `EXECUTABLE`/`OBSERVABLE`/`VERIFIABLE = BLOCKED_BY_PROVIDER` | the runtime exists; the counterparty is outside JASIM and nothing is connected |
| `monetization.commission` | `EXECUTABLE = BLOCKED_BY_PROVIDER` | a commission is one more obligation; taking it needs a PSP |

`OBSERVABLE` and `VERIFIABLE` fell by two because four scenarios moved from an
unearned `PASS` to `BLOCKED_BY_PROVIDER`: observing a real external purchase
needs the provider that made it, and the previous entry claimed otherwise.
Correcting a gate downward while closing the gap above it is the whole reason
the catalog exists.

```
GENERALITY FAILURE != PROVIDER NOT CONNECTED
```

**162 scenarios · 16 blind holdouts · 7 blind ideas · 10 general gaps.**

## 6. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2118 passed, 27 skipped · 92 files | 2086, 27 · 91 | +32, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 481 · 32 files | 440 · 31 | +41, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

Two inherited tests changed, neither weakened: the agreement suite's
"no subject column" check now excludes the generic observation-subject pair by
name **and gained a companion asserting no production line branches on it**; the
policy contract's caller list gained the transaction runtime.

## 7. The final report

```
PHASE = GENERAL_TRANSACTION_FULFILLMENT

CURRENT_GAP_PROVEN            = PASS
CANONICAL_TRANSACTION         = PASS
GENERIC_OBLIGATION_MODEL      = PASS
COMMITMENT_TO_TRANSACTION     = PASS
IDEMPOTENT_MATERIALIZATION    = PASS
POLICY_ENFORCEMENT            = PASS
AUTHORITY_INTEGRATION         = PASS
PAYMENT_RUNTIME_REUSED        = PASS
GENERIC_FULFILLMENT           = PASS
PARTIAL_FULFILLMENT           = PASS
OBSERVATION_INTEGRATION       = PASS
VERIFICATION_INTEGRATION      = PASS
COMPENSATION_INTEGRATION      = PASS
OPEN_MARKET_COMPATIBILITY     = PASS
BUSINESS_SCOPE_READY          = PASS
ACTIVE_CONVERSATION_PROOF     = PASS
HOLDOUT_GENERALITY            = PASS

DOMAIN_TRANSACTION_TYPES_ADDED    = 0
DOMAIN_FULFILLMENT_TYPES_ADDED    = 0
DOMAIN_TRANSACTION_HANDLERS_ADDED = 0
NEW_DOMAIN_BRANCHES               = 0

FALSE_TRANSACTION_SUCCESS  = 0
FALSE_PAYMENT_SUCCESS      = 0
FALSE_FULFILLMENT_SUCCESS  = 0
FALSE_VERIFICATION         = 0

CATALOG_SCENARIOS_MOVED = 9
  TRANSACTIONS  · transaction.cancel, transaction.fulfillment → PASS
  TRANSACTIONS  · transaction.buy/sell/book/reserve → BLOCKED_BY_PROVIDER
  MONETIZATION  · monetization.commission → BLOCKED_BY_PROVIDER
  IDEA_INTAKE   · idea.elder_companionship_rota, idea.rare_seed_lending_ring → PASS

MAIN              = 2118/27 · 92 files
BLOCK2            = 121 · 16 files
BLOCK3            = 133 · 17 files
BLOCK3_1          = 481 · 32 files
FROZEN_EVALUATION = 90 · 5 files

TYPECHECK        = PASS
WEB_BUILD        = PASS
MOBILE_TYPECHECK = PASS
EXPO_EXPORT      = PASS

NEXT_GENERIC_GAP = SECURE_PRODUCT_ACTION_RUNTIME
```

`BUSINESS_SCOPE_READY = PASS` rather than PARTIAL: `scopeId` is the acting
scope, parties are ids, and nothing in the transaction core knows what an
organization is — the business scope runtime already exists and resolves member
authority before this is reached.

Two gaps sit at nine. `SECURE_PRODUCT_ACTION_RUNTIME` is the one to take next:
it is the last route the semantic router names and honestly reports as
unimplemented, and unlike `PERSISTENT_WORLD_MATERIALIZATION` it needs no
presentation surface to be true.
