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

## The payer's instrument, and the provider asking for more

A review of the first cut named a gap. **Tracing it found my own report was
wrong on two counts**, and the correction matters more than the gap did.

`payment_method_references` exists, and so does a producer:
`createPaymentMethodReference`, which refuses card-shaped data and anything
Luhn-valid before it will store a token. So does a consumer —
`resolvePaymentMethodReference`, plus the delegation mandate, which already
filters an execution by which instrument it names. `paymentMethodRef` *does*
reach execution.

Two things were genuinely absent:

- the reference never reached the **provider** — `PspClient.authorize` had no
  parameter for one, so an instrument could be chosen and then ignored;
- nothing could express `REQUIRES_ACTION` — zero occurrences in the runtime, so
  a provider needing the payer to approve something had no way to say so.

### Not every provider wants a card

```
PAY_PROVIDER != ALWAYS_REQUIRES_CARD
```

A pre-funded balance, an organization settlement account, an invoice rail and a
provider-held mandate all pay without anybody producing an instrument. So the
requirement is adapter contract metadata — `ProviderDefinition.paymentMethod` —
beside `observes`, and **absent means NONE**. A model saying "this needs a card"
establishes nothing.

### The one distinction this rests on

```
PROVIDER_BINDING_CREDENTIAL != CUSTOMER_PAYMENT_METHOD
```

The binding's credential authenticates JASIM to the provider; the payer's method
names the instrument the money comes from. The payment phase before this one
only ever needed the first, because its fixture provider funded itself — a fact
about that fixture, and never a payment method.

### Four filters on an instrument

Owned by the payer, issued by **this** provider, still ACTIVE, not expired.
A token minted by one provider is meaningless to another and dangerous to
forward, so provider identity is matched exactly. Naming an instrument the payer
does not hold gives the same answer as holding none.

```
CROSS_SCOPE_PAYMENT_METHOD_USE = 0 · CROSS_PROVIDER_PAYMENT_METHOD_USE = 0
MODEL_CAN_INJECT_PAYMENT_METHOD_REF = NO
```

Keeping an instrument is a separate answer from paying with it once, and the
default is not to keep it:

```
ONE_TIME_METHOD != REUSABLE_METHOD
PAYMENT_AUTHORIZATION != FUTURE_CHARGE_AUTHORIZATION
```

### A challenge is an external action session

3-D Secure, a bank approval, a wallet confirmation, a device prompt and a
redirect authorization are all one thing, and none of them is a runtime. An
adapter normalises whatever its provider calls it into `REQUIRES_ACTION`, and
the challenge is an `external_action_session` — which already carried a payment
intent id, a single-use state, a validated origin and an expiry.

```
NEW_PARALLEL_TRUSTED_SURFACE_RUNTIME = 0
No ThreeDSRuntime. No WalletChallengeRuntime.
```

Coming back proves only that somebody came back. The return moves no payment
state, reads no query parameter as a verdict, and believes nothing a client body
says; it consumes the session and hands the payment to the readback the payment
runtime already trusts.

```
RETURN_URL_PAYMENT_SUCCESS_AUTHORITY = 0
CLIENT_CHALLENGE_SUCCESS_SETTLES = 0
SURFACE_CLOSED != PAYMENT_CANCELLED
```

An expired challenge authorises nothing **and fails nothing** — only the
provider says a payment failed.

### One more shared boundary

A challenge URL is a place a *person* is sent, so sending them somewhere local
is worse than sending them nowhere. The host rule that guards a provider
endpoint is now shared rather than duplicated — deliberately the host rule only,
since a provider's challenge page legitimately carries a session in its query
where a base endpoint never does.

### Coming back only causes a look

The last link. `completePaymentChallenge` returned a payment intent id and
stopped; `reconcilePaymentEffect` had no production caller at all. The
continuation joins them and adds nothing else.

**What it cannot be told is the guarantee.** Its whole input is a challenge id,
that challenge's single-use state, and who is returning. There is no parameter
for a status, an amount, a currency, a payee, a provider or a payment id — so a
return carrying `success=true` or `amount=1` has nowhere to put any of it. That
is not a check; it is an absence, which is the only kind a browser cannot argue
with. A test passes all of them anyway and the provider's `FAILED` still wins.

```
RETURN_QUERY_PAYMENT_STATUS_USED = 0 · RETURN_QUERY_AMOUNT_USED = 0
CLIENT_SUCCESS_RETURN_SETTLES = 0 · CLIENT_FAILURE_RETURN_FORCES_FAILURE = 0
CLIENT_CAN_SWAP_PAYMENT_INTENT_AFTER_CHALLENGE = 0
CLIENT_CAN_SWAP_PROVIDER_REFERENCE_AFTER_CHALLENGE = 0
```

Everything else comes from canonical state: the consumed challenge names its
payment, and the payment names its payer, its payee and — pinned on first
execution — its provider and provider reference. No `providerReference` is
passed to reconciliation, because the durable one is the only one it will read.

**A rail that moved is a refusal to look, not a verdict.** If the route now
resolves to a different provider than the payment was executed on — a binding
revoked, a preference changed — the continuation stops. Reading one provider's
state to settle a payment made at another is how a settlement gets attributed to
the wrong rail.

**A return may read. It may never pay again.** Only `reconcilePaymentEffect` is
reachable from here; `executePaymentEffect`, `authorize` and `capture` are not.

```
CHALLENGE_RETURN_SECOND_PAY_CALL = 0
CHALLENGE_RETURN_CREATES_NEW_PAYMENT_INTENT = 0
RECONCILIATION_RETRY != PAYMENT_RETRY
```

**And the return is a convenience, not a requirement.** A payer who completes
the provider's page and closes the browser has still paid; the server reconciles
through the same door with nobody returning anywhere. Where a provider event won
first, a later return finds nothing to reconcile: no downgrade, no second
financial effect, no stale overwrite.

```
BROWSER_RETURN_REQUIRED_FOR_PAYMENT_TRUTH = NO
RETURN_AFTER_WEBHOOK_DUPLICATES_EFFECT = 0
```

### A signature authenticates who spoke, never what they said

The other half of the asynchronous case: a payer who closes the browser, a bank
transfer that lands an hour later, a delayed capture. The return path needs
somebody to return. This one does not.

Every part existed; none were joined. `ingestAuthenticatedExternalEvent`
authenticates an HMAC over the exact raw bytes against a catalog-bound secret,
refuses a stale timestamp, refuses a financial callback whose *signed body* does
not itself carry its event type, reference, amount and currency, refuses one
whose money disagrees with the mandate, refuses one correlating to no known
payment, derives ownership from the intent rather than the caller, and derives
the replay key from the signed body so a caller cannot mint a fresh one for the
same bytes. `external_webhook_events` deduplicates on a unique index, durable
across processes. `verifyPaymentClaim` weighs a claim against the authoritative
readback.

And nothing in production called the last one, or moved a payment because an
event arrived.

**The bridge adds the join and nothing else.** No table — the ledger that
deduplicates was already the right ledger. No verifier — the one that weighs a
claim against a readback was already the right verifier. No state machine — the
transitions that apply truth were already the right transitions.

The order is the guarantee: authenticate, deduplicate and correlate *before* the
payment is loaded; verify *before* anything is applied. A contract test asserts
those indices rather than trusting the reading.

```
UNAUTHENTICATED_EVENT_CAN_CHANGE_PAYMENT = 0
EVENT_SUCCESS_BYPASSES_VERIFICATION = 0
DUPLICATE_EVENT_CAN_DUPLICATE_EFFECT = 0 · CROSS_PROCESS_EVENT_REPLAY = 0
ASYNC_PAYMENT_CAN_SETTLE_WITHOUT_BROWSER_RETURN = PASS
```

**An event may read a provider and may never spend at one.** Neither
`executePaymentEffect`, nor `refundPaymentEffect`, nor `authorize`, `capture` or
`refund` is imported into the event path at all. The only provider call it can
cause is a readback.

```
EVENT_PATH_PAY_CALLS = 0 · CAPTURE = 0 · REFUND = 0
REVOKED_BINDING_NEW_MUTATION_FROM_EVENT = 0
```

**A later event describing an older moment is a fact about the past**, and the
past does not overwrite a settlement that already happened. A webhook and a
browser return reach the same end, once, in either order.

```
OUT_OF_ORDER_EVENT_DOWNGRADES_TERMINAL_STATE = 0
WEBHOOK_AND_RETURN_DUPLICATE_EFFECT = 0
```

One finding on the way: `verifyPaymentClaim` weighs *status and money*, while
`applyProviderCapture` additionally weighs *identity* — whether the readback is
bound to this payment — and refuses by throwing. Correct, and a webhook route
that threw would return 500 to a provider who did nothing wrong. The bridge
catches it and reports the same fact the throw carried; nothing is written
before the refusal, so the payment is untouched either way.

### An address a provider can post to

`ingestPaymentEvent` was a function nothing called from the outside. This is
transport, and only transport: the authenticated boundary, the replay ledger,
the correlation, the readback and the verifier are all reached through it
unchanged. What this adds is a door and a decision about which HTTP number to
answer with.

**Mounted before the catch-all.** `app.all("/api/*")` returns 404, so a route
added after it is a route a provider never reaches. A test reads `boot.ts` and
compares the two positions rather than trusting the reading.

**The raw bytes are the load-bearing part.** `c.req.text()` returns the body
unchanged; nothing parses and re-serialises before verification, and nothing
normalises whitespace, key order, number formatting or escaping. A body that is
semantically identical but byte-different is a different body — asserted with
both a whitespace variant and a key-order variant, each carrying the original's
signature, each refused.

A parse *does* happen, to read routing fields out of bytes the boundary then
independently re-checks against the signature and the mandate. Parsing to route
is not parsing to verify.

**The provider in the path is a selector, not a claim.** A caller correctly
signing for one provider's secret and posting to another's route is refused.

```
ROUTE_PROVIDER_NAME != AUTHORITY
```

**Nothing unsigned contributes anything.** The owner is never sent — the
boundary derives it from the correlated payment. The connector is derived from
the route. The event type, reference, money and timestamp come from the *signed*
body. A test posts a query string full of `ownerId`, `connectorId`, `provider`,
`reference`, `amountMinor` and `webhookSecret`, plus matching headers, and every
one of them is ignored: the ledger row carries the route-derived connector and
the canonical event carries the payment's owner.

**Its own size cap.** 64 KB, route-scoped. The signed schema is a handful of
short strings; the application's general 50 MB exists for prompts and uploads
and has no business being a webhook's budget. The global limit is untouched.

**A refusal about evidence is not a server error.** A provider whose authentic
event did not prove settlement has done nothing wrong, and a 500 would tell it
to retry forever. So `UNVERIFIED` answers 202 — accepted as received,
deliberately neither 200 nor 500 — while `DUPLICATE`, `STALE` and `NO_EFFECT`
answer 200 so the provider stops resending, and only genuine internal failure
would be a 5xx.

```
EXPECTED_REFUSAL_RETURNS_500 = 0 · HTTP_2XX != PAYMENT_SETTLED
```

The response carries the outcome name and no payment status: a caller who can
sign already knows what they sent, and telling them what JASIM now believes
would make the response a state oracle for whoever holds the secret.

**Two boundary corrections came out of the trace**, both small and both generic.

The authenticated boundary required `ownerId` from its caller. It checked it
against the intent, so it was never authority — but a public ingress has no
legitimate way to know whose payment an event concerns, and a parameter that
must be supplied and can only be wrong is a parameter that should not exist.
It is now optional: supplied → checked, absent → derived from the correlated
payment. A non-financial event still needs one, having no payment to derive from.

And the freshness window was checked against a timestamp that was **not signed**.
An old validly-signed body handed a fresh unsigned timestamp passed a check it
never earned — defence-in-depth only, since the durable ledger is what actually
stops a repeat of those bytes, but weaker than the code claimed. The signed body
is now authoritative wherever it carries a timestamp, a caller-supplied one may
not contradict it, and the HTTP route reads *only* the signed one, so at the door
there is no unsigned timestamp to swap.

```
FRESH_TIMESTAMP != AUTHENTICATED_TIMESTAMP
UNSIGNED_TIMESTAMP_CAN_REFRESH_OLD_SIGNED_BODY = 0
HTTP_CALLER_CAN_CHOOSE_OWNER = 0
```

### The handshake label grants nothing

The payment phase let a PAY-only provider authenticate by labelling its
handshake context `READ`. A regression now proves the label is a label: such a
binding is granted `PAY` and nothing else, its read list is empty, and the read
door refuses it.

```
HANDSHAKE_LABEL_GRANTS_READ = 0
```

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
