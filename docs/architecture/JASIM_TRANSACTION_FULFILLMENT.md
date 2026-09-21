# JASIM — THE GENERAL TRANSACTION AND FULFILLMENT RUNTIME

```
OPPORTUNITY != PROPOSAL != AGREEMENT != COMMITMENT != TRANSACTION
TRANSACTION != PAYMENT  != FULFILLMENT != VERIFICATION

ACCEPTED OFFER   != EXECUTED TRANSACTION
PAID             != DELIVERED
PROVIDER RECEIPT != VERIFIED FULFILLMENT
CLAIMED_COMPLETE != VERIFIED_COMPLETE
```

---

## 1. What the trace found

| | where | what it was |
|---|---|---|
| `transactionIntents` | `db/schema.ts` | an accepted proposal's structured intent. Unique per proposal. **Intent, not execution.** |
| `economicEngagements` · `economicProposals` | `db/schema.ts` | match-backed engagement, versioned proposals with CAS and database-time expiry |
| `agreements` · `commitments` | `db/schema-block2.ts` | the exact version, a terms snapshot, whose authority — and a commitment per term that declared `owedBy`, stuck at `open` |
| `commitAgreement` | `agreement-runtime.ts` | the one place a commitment is born |
| `commercialOrders` | `db/schema-block3.ts` | an order with **`buyerRef` and `sellerRef`**, fingerprinted terms, and a `FULFILLED` status somebody asserts |
| `paymentIntents` + `payment-execution.ts` | Block 3 | a real payment runtime: exact minor units, mandatory currency, owner+idempotency unique index, PSP client, refund as a **new** effect, reconciliation, `verifyPaymentClaim` |
| `external-action-session.ts` | | server-created, owner- and purpose-bound provider transitions |
| the bridge | `effect-observation-bridge.ts` + `completion-policy.ts` | observations with a claim source fixed by the channel; `decideCompletion` per effect kind |
| `policy-enforcement.ts` | | one boundary, `action` + parameters → decision |
| `authority-acts.ts` | | statement, digest, re-render |
| `compensation-policy.ts` | | reversibility per effect kind |

Answering the brief's questions concretely:

- **Only intent:** `transactionIntents`. Accepting a proposal produced one and
  nothing consumed it.
- **Already a real commitment:** `commitments` — created from declared `owedBy`,
  and permanently `open` because nothing could close one.
- **Could actually execute:** payment, against a PSP that is not configured.
- **Could be fulfilled:** nothing. There was no fulfillment model.
- **Could be verified:** any *capability attempt*, through the bridge. No
  obligation, because obligations were not attached to anything.
- **Where a transaction naturally lives:** between `commitAgreement` and the
  payment runtime, owning obligations and owning none of the effects.

`commercialOrders` was the closest existing thing and is **not** the general
transaction: two permanent roles, and a `FULFILLED` status a caller sets. It is
Block 3's checkout binding and is left exactly as it was.

## 2. What was built, and what was reused

**Built:** `transactions` — parties as a list, a terms snapshot and digest, the
origin, the authority basis, the policy decision, and a state that is
**derived**.

**Reused rather than duplicated:** no `obligations` table was created, because
one already existed under another name. A Commitment *is* an obligation, so it
gained a beneficiary, the evidence that would prove it, an observation subject,
a settlement, a payment link, and a `verification` column beside its `state`.
Two tables meaning the same thing is how a system comes to have two answers.

**Reused whole:** Block 3's payment runtime (one new nullable `transactionId`
column and nothing else), the observation bridge, `decideCompletion`, the
compensation policy, the policy boundary, the authority path.

## 3. The obligation

```
responsibleActor · beneficiaryActor · subject · terms
due · state · verification · evidenceKind
```

`owedBy` is declared by the term. `owedTo` is declared, or — with exactly two
parties — the other one, which is determinate rather than a guess. Nothing says
"seller ships, buyer pays": the live proof has the two obligations pointing
opposite ways in one transaction.

`evidenceKind` is an effect kind from the completion policy's own closed set,
and **undeclared means `HUMAN_ACTION`** — the strictest, where somebody's own
word about their own work settles nothing. Forgetting to declare evidence can
never make an obligation easier to settle.

## 4. Claimed is not verified

Two columns, because they are two facts.

`claimObligation` moves `state` to `CLAIMED` and touches `verification` never.
Only the party who owes it may claim it.

`settleObligation` reads Observations for the obligation's subject through the
bridge and runs the **same** `decideCompletion` every capability's effect runs
through. There is no fulfillment verifier:

```
DOMAIN_FULFILLMENT_VERIFIERS = 0
```

So a `HUMAN_ACTION` obligation is not settled by the provider's own response
(`SELF_REPORTED`) and is settled by the owner's confirmation — which is the
completion policy's rule, applied to a delivery instead of a device.

## 5. The state is derived

```ts
deriveTransactionState(obligations) // every time it is asked
```

Nothing writes `SETTLED`; a test greps for it. **A payment verified while a
delivery is pending is an `OPEN` transaction**, proven both as a function and on
the live path.

## 6. Money

Block 3 owns it. An obligation declares a `settlement` — exact integer minor
units and a currency — or it has no money at all. A term whose *unit* says
`KWD` is not a payable amount: inferring one from a display unit is how a
runtime acquires a currency, and `95.5` is refused at the term.

Binding creates a `PaymentIntent` keyed `obligation:<id>`, so a retry returns
the original rather than a second payable. Creating a payable is not paying: no
PSP is configured, and the transaction does not move.

No conversion, anywhere. There is no rate to invent.

## 7. Ending honestly

Cancelling is for before anything irreversible. Once an obligation is
`VERIFIED`, cancellation becomes `COMPENSATING` and returns what compensating
would mean per obligation, read from the compensation policy the runtime
already had. A compensation is a **new** effect; nothing deletes a row to make
an effect go away, and a test asserts the module contains no delete.

## 8. Policy and authority

`materializeTransaction` asks the existing boundary
`evaluatePolicies({ action: "transaction.execute", … })` with the transaction's
scalar facts — `terms.*`, `units.*`, `settlements.*`, `currencies.*` — by the
same dotted-path convention the authority statement renders. No
`TransactionPolicy` exists.

Materialization happens **inside** `commitAgreement`, outside its database
transaction: a policy refusing to execute must not roll back an agreement two
people actually reached. `AGREEMENT != TRANSACTION`, including when only one of
them is possible.

The approval is the one that already exists. The live path is
«اتفقنا — ثبّت الاتفاق» → an authority request whose statement shows every term,
its unit and who owes it → the person cites the digest → agreement, commitments
and transaction, in that order.

## 9. Idempotency

The unique index on `agreementId`. Ten simultaneous materializations of one
agreement produce one transaction and nine `created: false`, proven. No lock
anybody had to remember to take.

## 10. Scope-ready, not scope-bound

`scopeId` is the acting scope and has always meant the owner of the row, never
a person. Parties are ids. Nothing in the transaction core knows what an
organization is, and member authority is resolved before it is reached.

## 11. What is not built

- **No external effect.** Buying, booking and reserving reach a counterparty
  outside JASIM and nothing is connected. That is a provider gap and the
  catalog says so rather than blaming the runtime.
- **No realtime.** The events are durable, owner-scoped and ordered by the
  table's serial id, and `transactionTimeline` resumes from a cursor. Nothing
  subscribes.
- **No orders dashboard.** `projectTransaction` is the generic projection —
  what was agreed, what is committed, what is paid, what is verified, what
  remains — built from named fields, and no renderer was written.
- **No amendment subsystem.** Committed terms are a snapshot and the digest
  moves if anything moves. A new agreement is a new transaction.
- **No conversational way to confirm an obligation.** Signals enter through
  trusted server code, exactly as the observation phase left them.
