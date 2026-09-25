# JASIM — A PAYMENT PROVIDER IS A PROVIDER

> `NO_CANONICAL_SETTLEMENT_OBLIGATION → NO_EXECUTABLE_PAYMENT_PATH`
> `MODEL != PAYMENT AUTHORITY` · `MODEL != PAYMENT ROUTE AUTHORITY` · `MODEL != PAYEE AUTHORITY`
> `PROVIDER_PAY_CAPABILITY != AUTHORITY_TO_PAY` · `PAYMENT_INTENT != PAYMENT_EXECUTION`
> `CHECKOUT_CREATED != PAYMENT_AUTHORIZED != CAPTURED != SETTLED`
> `PROVIDER_SUCCESS != VERIFIED_PAYMENT` · `PROVIDER_RECEIPT != VERIFICATION`
> `PAYMENT != FULFILLMENT` · `PAYMENT_VERIFIED != TRANSACTION_FULFILLED`

Both halves already existed. Neither could reach the other.

## What the trace found

The payment runtime is mature and almost none of it needed changing.

| already there | where |
| --- | --- |
| canonical payable gate | `block31/canonical-payable.ts` — `resolvePayable` |
| PaymentIntent, ten states | `block3/payment-intents.ts` |
| durable atomic claim | `transitionPaymentIntent` — optimistic lock on `version` |
| provider identity pinned on first execution | `providerBindingViolation(..., {allowBind:true})` |
| INCONCLUSIVE on lost transport | `payment-execution.ts` |
| readback over callback | `viewBindsToIntent` + `moneyMatches` |
| refunds as new effects | `refundPaymentEffect` |
| tokenised method references | `payment_method_references.tokenRef` |
| browser return never moves truth | `handleCheckoutReturn` → `paymentTruth: "UNCHANGED"` |

**Answers to the twelve questions**

1. **What creates a PaymentIntent?** `payTurn` → `createPaymentIntent`, after `resolvePayable`.
2. **What authorises its amount/currency/payee?** The accepted settlement commitment, via `PayableObligation`. Unchanged.
3. **What creates checkout?** `createFinancialCheckout`, from `payTurn`.
4. **Did checkout call an old payment-specific provider abstraction?** It validated a URL against a boot-time origin registry. It executed nothing.
5. **Where did `provider` and `adapterEndpoint` come from?** **The model's envelope** — `string(values, "provider")`, `string(values, "adapterEndpoint")`.
6. **Could those bypass the binding runtime?** Yes, completely. They were the only production payment route, and the general binding runtime had no part in them.
7. **PaymentIntent states?** CREATED · REQUIRES_APPROVAL · EXECUTING · PROVIDER_AUTHORIZED · CAPTURED · SETTLED · FAILED · CANCELLED · EXPIRED · INCONCLUSIVE.
8. **Is AUTHORIZED distinct from SETTLED?** Yes, and CAPTURED is distinct from both.
9. **Webhook/receipt mechanism?** `webhook-auth.ts`, `external_webhook_events` with a unique `(provider, eventKey)` index, and `provider-output-boundary.ts`.
10. **Replay prevention?** That unique index, durably.
11. **Payment material tokenised?** Yes — `tokenRef`, raw PAN/CVV forbidden by construction.
12. **Smallest missing bridge?** How a `PspClient` is *obtained*. Everything else was already right.

## The bypass, and it was model-supplied

```ts
const provider = string(values, "provider");
const adapterEndpoint = string(values, "adapterEndpoint");
```

`values` is `envelope.intent.inputs` — the model's. The URL built from it was
origin-checked against a server-owned registry, so it could not point anywhere.
It was still **the model choosing which payment provider carried somebody's
money**, with no verified binding, no PAY grant, no canonical scope and no
credential vault.

Both reads are gone. The orchestrator no longer imports the checkout module at
all, so there is no second executable path left to drift.

```
PAYMENT_EXECUTION_BYPASSES_GENERAL_PROVIDER_BINDING = 0
PARALLEL_EXECUTABLE_PAYMENT_PATHS = 0
```

## Whose rail

Not "always the payer" and not "always the payee". A card payment runs on the
merchant's acquiring side; a bank transfer runs on the payer's. Both sides of
the canonical settlement are eligible, and both come from the payable
obligation — who owes, and who is owed. A scope with no stake in the settlement
is never considered however many PAY bindings it holds.

Ranking follows the law the source-policy phase settled: **within** a scope, by
that scope's own policy; **across** the two sides, by the payer's declared
`side` — it is their money moving, and it changes no payee, no amount and no
currency. Absent that declaration, `AMBIGUOUS_ROUTE`. Never a guess.

## The bridge is a `PspClient`

The execution runtime keeps every rule it had and simply stops being handed a
client by its caller. Four operations run through the general binding:

```
AUTHORIZE · CAPTURE · READBACK   →  PAY      (reading back a payment you made
REFUND                           →  REFUND    is part of having made it)
```

How a failure is classified is the part that matters most:

```
provider ERROR       → REJECTED    it definitively said no
provider UNAVAILABLE → UNCERTAIN   it may have landed
adapter threw        → UNCERTAIN   same, and the door reports it that way
```

Collapsing the second into the first is how a system double-charges: a request
that may have succeeded, recorded as failed, invites a retry. A lost response
sends the intent to INCONCLUSIVE, and asking again reconciles rather than
re-authorising — asserted directly.

## Two doors, and neither can do the other's job

`readThroughBinding` derives its own authority, because a fact has a canonical
owner and the subject says who it is. An **act** does not work that way: what
authorises paying is a canonical settlement obligation, which is the payment
runtime's knowledge. A general binding runtime that read payment tables would
be exactly the payment-shaped hole this design exists to avoid.

So `invokeThroughBinding` checks everything structural — VERIFIED only, granted
only, the named scope's own, **mutating capability only** — and says plainly
what it cannot check. A contract test asserts the payment runtime is its only
caller, so the claim stays true as the repository grows.

```
PAYMENT_SPECIAL_BINDING_RUNTIME = 0
PAYMENT_SPECIAL_SECRET_STORE = 0
PAY_IN_SOURCE_RESOLUTION = 0
```

## One gap found on the way

A payment provider's whole manifest may be `PAY` and `REFUND`. The binding
runtime's connection test looked for a non-mutating capability to label the
handshake context with, and **threw when a definition had none** — so a
payment-only provider could never be verified, and therefore could never become
a route. The phase would have been impossible rather than merely awkward.

`authenticate` and `discover` are handshakes, not invocations, so the label now
falls back to `READ` when a definition supports nothing non-mutating. Nothing
about the label grants anything: `invoke` is never reached from a handshake,
and every gate reads the *grant*. The law it protects —
`CONNECTION_TEST_CAUSES_BUSINESS_MUTATION = 0` — still holds, because a
handshake still calls no capability at all.

## What a payment still is not

A settled payment fulfils no transaction and resolves no need — asserted by
counting: zero fulfilment observations, zero needs touched.

```
PAYMENT_SETTLEMENT_AUTO_FULFILLS_TRANSACTION = 0
PAYMENT_SETTLEMENT_AUTO_RESOLVES_NEED = 0
```

And the production provider registry is still empty. No real payment integration
exists in this repository; every provider here is a fixture in a registry built
to hold fixtures, and no test moves money.

```
PRODUCTION_FAKE_PAYMENT_PROVIDER = 0 · REAL_MONEY_TEST_CHARGE = 0
```
