# JASIM — WHERE A WEBHOOK VERIFICATION SECRET LIVES

```
WEBHOOK_SECRET != PUBLIC PROVIDER METADATA
WEBHOOK_SECRET != MODEL CONTEXT · != CHAT · != CLIENT STATE
WEBHOOK_SECRET != EVENT PAYLOAD · != OBSERVATION · != LOG · != AUDIT PAYLOAD
PROVIDER_DEFINITION != PROVIDER_BINDING
PROVIDER_TYPE      != PROVIDER_ACCOUNT
ROUTE_PROVIDER_NAME != SECRET AUTHORITY
SECRET_PROVISIONED != PROVIDER_VERIFIED != PAYMENT_SUCCESS
MODEL != SECRET PROVISIONING AUTHORITY
VALID_SIGNATURE != VERIFIED
```

## What the trace found

The authenticated webhook boundary read its secret from
`capability_provider_catalog.ioMetadata.webhookSecret`. Four facts about that,
all from the repository rather than from judgement:

1. **That table is discovery output.** Its own header says it persists
   "normalized external candidates (MCP/A2A/…) with trust classification,
   freshness, and provenance", and `trustClass` defaults to
   `UNTRUSTED_CANDIDATE`.
2. **`ioMetadata` is ordinary `jsonb`.** Nothing in its read or write path
   encrypts anything. The secret was plaintext.
3. **Nothing in production ever wrote it.** Every writer was a test fixture, so
   the HTTP webhook ingress mounted one phase earlier could not authenticate a
   single callback in production.
4. **A catalog row has no account.** Had anything written it, ONE string would
   have authenticated callbacks naming EVERY scope's payments.

Meanwhile `provider_credentials` + `ProviderCredentialVault` already sealed
provider material with AES-256-GCM, bound by AAD to `(scope, binding, version)`.
Everything needed existed except the joining of the two, and the row that says
which account a callback is about.

## Who owns it

`WEBHOOK_SECRET_SCOPE = BINDING`

A provider **definition** is a kind of system. A **binding** is one scope's
account at one such system, and it is where `accountRef` — the identity the
provider itself reported — lives. Company A and company B may each hold their
own account at the same provider, and each account's endpoint registration
issues its own signing secret. So the material belongs to the binding, which is
also the narrowest canonical row that already existed.

Binding scope and account scope coincide here because the account reference is a
column on the binding. If a provider ever issues one secret per *endpoint* across
many accounts, that is a definition-level fact and would need its own modelling;
nothing in this repository asserts it, so it was not built.

## Where it lives

One store, two kinds:

```
provider_credentials(bindingId, kind, version)   UNIQUE
  kind = PROVIDER_AUTH          — what JASIM spends to CALL the provider
  kind = WEBHOOK_VERIFICATION   — what JASIM checks a CALLBACK's signature with
```

`SECOND_SECRET_STORE_ADDED = 0`. No new table, no new cipher, no second vault
class. What the existing store could not express was that one binding holds more
than one kind of material — its unique index was `(bindingId, version)` and
`retire(bindingId)` retired everything, so rotating an API key would silently
have destroyed callback verification and failed every callback closed. The kind
is **authenticated** by the envelope's AAD, not merely stored beside it, so a
credential reference moved between columns cannot be opened as the wrong kind.

The binding points at it exactly as it points at the outbound credential:
`webhookCredentialRef` + `webhookCredentialVersion`, references and never
material.

## How it is provisioned

```
Provider Definition  (declares webhook: NONE | SIGNED_HMAC)
  → beginProviderSetup        — says whether verification material will be owed
  → completeProviderSetup     — the OUTBOUND credential
  → authenticateBinding
  → verifyBinding
  → configureWebhookVerification   ← the material that checks callbacks
```

The last step is a trusted **continuation of the same binding**, not a second
lifecycle: same row, same scope, the same `manage_providers` standing re-read at
submission time. It is separate because a provider issues a webhook signing
secret when an endpoint is registered *at the provider* — normally after the
connection already exists, often on another day and by another person. Collecting
it inside `completeProviderSetup` would have forced every connection to wait for
a secret that does not exist yet, and a connection that cannot be made is not a
safer connection.

The only way in is the product action `provider.webhook.configure`, whose secret
field is `SENSITIVE`:

```
MODEL_CAN_PROVISION_WEBHOOK_SECRET = NO
MODEL_CAN_SEE_WEBHOOK_SECRET       = NO
CHAT_CAN_TRANSPORT_WEBHOOK_SECRET  = NO
```

A model may say that a provider still owes this step, because
`webhookVerification: "REQUIRED_NOT_CONFIGURED"` is a **status** on the binding
projection. It cannot carry the value: the presentation contract a surface
renders carries no value at all, so there is nowhere to put a suggestion for
somebody to accept without reading.

The completion says `{ configured: true, version }`. Not the secret, not its
reference, not a prefix and not a fingerprint — a fingerprint is a guessing
oracle.

## How it is resolved

```
POST /api/webhooks/payment/:provider
  → :provider names a DEFINITION (a selector, never a claim)
  → the unsigned reference correlates to a PaymentIntent
  → the intent names the ACCOUNT it was executed at (providerBindingRef)
  → the vault opens that binding's WEBHOOK_VERIFICATION envelope
  → HMAC-SHA256 over the exact raw bytes
```

Correlating on an unsigned reference is **selection, not belief**: picking the
wrong account produces material the signature does not check out against, and
every field read for routing is independently re-checked against the signed body
afterwards. Nothing has been trusted by the time the HMAC is verified.

The caller supplies none of it:

```
CLIENT_CAN_OVERRIDE_WEBHOOK_SECRET = 0
BODY_SECRET_USED = 0 · QUERY_SECRET_USED = 0
CALLER_CHOOSES_SECRET_SOURCE = 0
```

The boundary's input type has no field for a secret, a credential reference, a
binding or a database, so there is nothing for a body, a query string or a header
to arrive through. The resolver takes no database either: pointing the secret
boundary at a caller-chosen connection would make the source of truth selectable.

### Why the payment records its account

`payment_intents.providerBindingRef` was added because `providerRef` records the
provider **kind** and two scopes may each hold their own account at it. Without
it the only route back to the executing account is to re-resolve the payment
route — which runs through mutable scope policy, so a policy edit would silently
stop authenticating a provider's callbacks. It is bound by the same execution
ceremony that binds `providerRef`, in the same statement, so the pair can never
disagree. NULL means UNKNOWN, and unknown is not "any": a financial callback
about a payment with no recorded account is refused.

## Rotation

```
ROTATION_SEMANTICS = RETIRE_THEN_REPLACE_PER_KIND_NO_OVERLAP_WINDOW
```

`configureWebhookVerification` retires every earlier `WEBHOOK_VERIFICATION`
envelope for the binding and seals version + 1. The retired secret stops
authenticating immediately; the vault refuses a retired envelope, so an old
rotation cannot arrive at a verification at all. **There is no overlap window and
none was invented** — a deployment that needs one (a provider that keeps both
secrets live during a cutover) must model it explicitly.

Rotation is per kind. Re-attaching an outbound credential retires only
`PROVIDER_AUTH`; rotating verification material retires only
`WEBHOOK_VERIFICATION`.

One honest pre-existing limit, unchanged by this phase: a **live** binding cannot
re-open its setup (`beginProviderSetup` refuses a connection that already
exists), so rotating the OUTBOUND credential means disconnecting and
reconnecting. Verification material has no such limit, because it is configured
after the connection rather than as part of opening one.

## Revocation

```
REVOCATION_SEMANTICS = RETIRES_ALL_KINDS_AND_CLEARS_BOTH_REFERENCES;
                       HISTORICAL_EVIDENCE_PRESERVED
```

`revokeBinding` retires every envelope for the binding and clears both
`credentialRef` and `webhookCredentialRef`. Nothing new authenticates afterwards:

```
REVOKED_BINDING_AUTHENTICATES_NEW_CALLBACK = 0
REVOKED_BINDING_NEW_MUTATION_FROM_EVENT    = 0
```

This is a change in *where* a revoked account's callback is refused. Before this
phase such a callback authenticated against a catalog secret revocation never
touched, was written to the replay ledger, and only then found no usable route.
Now it is refused before the ledger, before the route and before any reading of
the payment. What revocation still does not do is erase facts: evidence already
ingested stands exactly as it was.

## A provider that never calls back

`PROVIDER_WITHOUT_WEBHOOK_REQUIREMENT_REGRESSION = 0`

`webhook` is optional definition metadata and absent means `NONE`. Such a
provider is never asked for material, its setup opening collects none, its
projection reports `NOT_REQUIRED`, and offering material for it is **refused**
rather than stored somewhere nothing will ever read it.

## What this is not

`KMS_HSM_HARDENING = DEFERRED_TO_PRODUCTION_HARDENING`

The backend is the one the repository already has: application-level AES-256-GCM
with a key derived from the process secret. An attacker holding both the database
and the process secret holds the material. `setWebhookVerificationResolver` and
`setProviderCredentialVault` are the seams a deployment substitutes to put either
kind of material behind a real key-management service; both are trusted server
code only, and no request path installs either.

One plaintext secret in catalog metadata survives this phase and is recorded
rather than quietly left: `ioMetadata.receiptSecret`, read by
`api/runtime/block2/remote-polling.ts` and `api/runtime/execution-verifier.ts`. It
is a different mechanism with its own readers and its own phase. `webhookSecret`
is gone from that type entirely, so writing one would not typecheck.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/provider-webhook-secret.test.ts` | the whole matrix: nothing provisioned, where it ended up, the mounted route end to end, the wrong secret, the model, body/query/header override, cross-binding and cross-scope, rotation and revocation, a provider that never calls back, raw-body and signed-timestamp laws, both kinds side by side |
| `tests/unit/webhook-verification-contract.test.ts` | the plaintext field is gone from runtime and schema, one store and no new cipher, the kind is authenticated, nothing a caller sends can name the material, every refusal is the same refusal, no provider names, the payment records its account |
| `tests/block31/payment-webhook-http.test.ts` | the HTTP ingress, now provisioning through the real path |
| `tests/block31/payment-event-ingestion.test.ts` | the event path, now provisioning through the real path |
| `tests/block3/webhook-auth.test.ts` and siblings | the boundary's own laws, stating material through the trusted resolver seam rather than plaintext jsonb |
