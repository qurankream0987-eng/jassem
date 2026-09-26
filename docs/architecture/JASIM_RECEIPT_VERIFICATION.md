# JASIM — WHOSE RECEIPT IS THIS

```
RECEIPT != VERIFICATION
VALID_RECEIPT_SIGNATURE != BUSINESS_TRUTH
PROVIDER_RECEIPT_SECRET != PUBLIC DISCOVERY METADATA
PROVIDER_CANDIDATE != PROVIDER_ACCOUNT · SAME_PROVIDER != SAME_ACCOUNT
REMOTE_EXECUTION != LATEST_BINDING · UNKNOWN_BINDING != ANY_BINDING
RECEIPT_SECRET != WEBHOOK_SECRET
MODEL != SECRET PROVISIONING AUTHORITY
```

## What the trace found

Remote receipt verification took its material from two places, both wrong:

1. **The polling path** read `capability_provider_catalog.ioMetadata.receiptSecret`
   — plaintext `jsonb`, on the discovery table, at trust class
   `UNTRUSTED_CANDIDATE`, with no production writer. Exactly the defect the
   webhook phase closed, in the same column family.
2. **The in-line path** read `provider.receiptSecret` off an in-memory
   `CapabilityProvider`. **Nothing anywhere ever assigned that field.** Every
   normalizer that builds a remote candidate — `normalizeMcpToolMetadata`,
   `normalizeAgentCardMetadata` — leaves it unset by construction, because a
   candidate normalized from a tool listing or an agent card is untrusted by
   definition.

So receipt verification could not succeed in production at all, and the
`providerReceiptSecret` parameter on `completeRemoteRuntimeDagNode` meant the
material a receipt was weighed against was whatever its **caller** handed in.

`remote_executions.bindingId` did not help. `resolveProvider` mints
`id: randomUUID()` for every resolution it makes, so that column records *which
decision* chose a provider for a node. It references no durable row, identifies
no account, and nothing reads it.

## Why this is not the webhook answer reused

The webhook phase proved that callback material belongs to the binding whose
`accountRef` the provider reported. That argument does not transfer, and was not
transferred. The receipt case stands on its own evidence:

- A receipt secret is shared between JASIM and **one remote endpoint identity**.
- The canonical row that owns a trusted remote endpoint is the scope's provider
  binding: `endpointUrl` lives on the binding for a provider whose address is
  declared at setup. Two scopes running their own remote systems therefore have
  different endpoints and different receipt secrets.
- A definition-scoped secret cannot express that; a catalog-scoped one expresses
  nothing at all, because a discovered candidate has no owner.

```
RECEIPT_SECRET_TRUE_SCOPE = BINDING
```

One scope holds at most one binding per provider — `scope_provider_bindings` is
unique on `(scope, class, provider)` — so the account is **exact rather than
chosen**. There is no "latest", "first" or "any" to fall back to, and the code
has no ordering clause to do it with.

### And why it is a third kind, not the second one reused

`RECEIPT_VERIFICATION` is its own credential kind because nothing in this
repository states that a provider issues one value for both purposes, and the
two authenticate different things:

| kind | what it proves |
| --- | --- |
| `PROVIDER_AUTH` | who JASIM is when it **calls** the provider |
| `WEBHOOK_VERIFICATION` | that an inbound **callback's raw bytes** came from the provider |
| `RECEIPT_VERIFICATION` | that a **digest of a completed result** JASIM already holds came from the provider |

Merging them because all three are bytes called "secret" would mean a rotation
of one silently retires another. A provider definition declares each purpose
separately (`webhook`, `receipt`), absent meaning `NONE`, and material offered
for a purpose a provider never declared is **refused** rather than stored.

```
OUTBOUND_ROTATION_RETIRES_RECEIPT_SECRET = 0
WEBHOOK_ROTATION_RETIRES_RECEIPT_SECRET  = 0
RECEIPT_ROTATION_RETIRES_PROVIDER_AUTH   = 0
RECEIPT_ROTATION_RETIRES_WEBHOOK_SECRET  = 0
```

## Where it lives

The same store, with no table change: `provider_credentials` already counts the
kind in its unique index `(bindingId, kind, version)` and in its AAD, so the
third kind needed nothing new.

```
SECOND_SECRET_STORE_ADDED = 0 · NEW_SECRET_TABLE_ADDED = NO
```

The binding points at it as it points at the other two:
`receiptCredentialRef` + `receiptCredentialVersion`.

The ceremony that seals any of it is now written **once**
(`configureVerificationMaterial`) with the purposes as data. Two copies of a
standing check are two places for one to rot.

## How it is provisioned

```
Provider Definition  (declares receipt: NONE | SIGNED_HMAC)
  → beginProviderSetup … verifyBinding
  → configureReceiptVerification   ← the material that checks receipts
```

Through `provider.receipt.configure`: a `SENSITIVE` field, `EXPLICIT`
confirmation, re-authentication, single use, and the actor's `manage_providers`
standing over that binding re-read at submission rather than remembered.

```
MODEL_CAN_PROVISION_RECEIPT_SECRET = NO
MODEL_CAN_SEE_RECEIPT_SECRET       = NO
CHAT_CAN_TRANSPORT_RECEIPT_SECRET  = NO
```

A model may say a connection still owes this step, because
`receiptVerification: "REQUIRED_NOT_CONFIGURED"` is a **status** on the binding
projection. The completion says `{ configured: true, version }` and never the
value, a prefix or a fingerprint.

## How the account is pinned

```
remote execution created
  → accountBindingFor({ scopeId: ownerId, definitionId: providerId })
  → remote_executions.providerBindingRef        ← pinned here, once
        …
receipt arrives (inline or polled)
  → receiptSecretFor({ providerId, bindingId: execution.providerBindingRef })
  → vault opens that binding's RECEIPT_VERIFICATION envelope
```

The account is read **once**, before the effect exists, and recorded. Everything
afterwards reads the record. A provider preference, a policy edit, another
account at the same provider, or a rotation elsewhere therefore cannot redirect
a past receipt to different material.

```
MUTABLE_POLICY_CHANGES_RECEIPT_SECRET_SOURCE = 0
```

`providerBindingRef` is NULL when nothing was pinned — a remote execution
created before this column existed, or one by an owner who holds no binding at
that provider. NULL means **unknown**, and unknown is never "any":

```
NULL_BINDING_REMOTE_RECEIPT_VERIFIED = 0
```

Such a receipt cannot be independently verified, which the existing verifier
already reports as `INCONCLUSIVE`. The alternative — finding a plausible secret
by scope, provider, recency or endpoint — would be choosing what a past effect's
evidence is checked against, which is the whole thing this phase removes.

The legacy `remote_executions.bindingId` column is left alone and its meaning is
now stated in the schema: it is the **selection record**, not the account.

## What a receipt still does not prove

Nothing about this phase touches the separation the verifier already had:

```
result → canonicalResultDigest → provider receipt signature → verdict
```

The signature is checked against a digest JASIM computed itself, and the
completion path re-computes that digest from the output it holds before calling
the receipt valid. A receipt that is genuine for a result that has since changed
does not verify, and a valid signature is one input to a verdict rather than the
verdict.

```
WRONG_DIGEST_VERIFIES = 0 · SIGNED_RECEIPT_AUTO_PROVES_BUSINESS_EFFECT = 0
```

## Revocation

`revokeBinding` retires every kind and clears all three references. Nothing new
authenticates afterwards, and nothing already recorded is touched — the
execution row, the canonical events and any verdict already reached all stand.

```
REVOKED_BINDING_AUTHENTICATES_NEW_RECEIPT      = 0
REVOCATION_ERASES_HISTORICAL_VERIFIED_EVIDENCE = 0
```

## Rotation

```
ROTATION_SEMANTICS = RETIRE_THEN_REPLACE_PER_KIND_NO_OVERLAP_WINDOW
```

`configureReceiptVerification` retires every earlier `RECEIPT_VERIFICATION`
envelope for the binding and seals version + 1. The vault refuses a retired
envelope, so old material stops verifying immediately. No overlap window exists
and none was invented.

## What this phase deliberately did not do

**The endpoint.** `remote-polling.ts` still reads the remote system's address
from `capability_provider_catalog.ioMetadata.endpoint`, falling back to
`provenance.reference`. That is a *discovered candidate* deciding where JASIM
speaks — the same shape of defect as the secret, one layer over, and
`TRUSTED_PROVIDER_ENDPOINT_AUTHORITY` already established for provider bindings
that an address is collected on a trusted surface beside the credential it
targets. Correcting the secret did not require correcting the address, so the
address was not touched. It is the next gap, named rather than widened into.

**The remote execution path itself.** Remote MCP/A2A providers are still
selected from `CapabilityProviderRegistry`, not authorized through
`scope_provider_bindings`. This phase gives the execution an account to record
and verifies receipts against it; it does not make the binding runtime the
authority for remote invocation. Until a deployment binds a remote provider
under the same id its definition carries, `providerBindingRef` is NULL and
receipts are `INCONCLUSIVE` — which is what production already was, said out
loud.

**KMS/HSM.** `KMS_HSM_HARDENING = DEFERRED_TO_PRODUCTION_HARDENING`. The backend
is the application-level AES-256-GCM the repository already has;
`setReceiptVerificationResolver` is the seam a deployment substitutes.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/provider-receipt-secret.test.ts` | provisioning and sealing, the leak scan, a genuine receipt passing the existing verifier, wrong and missing material, cross-binding and cross-scope and cross-provider, a callback secret refused as a receipt secret, wrong digest and tampered result, a null account with no fallback, policy changed after execution, per-purpose rotation, revocation, and a provider that never signs receipts |
| `tests/unit/receipt-verification-contract.test.ts` | the plaintext field is gone from the candidate and from discovery metadata, one store and no cipher of its own, the account is pinned and never re-derived, nothing a caller supplies can name the material, every refusal is the same refusal, a receipt is weighed rather than believed, no protocol or domain branches |
| `tests/block2/mcp-transport.test.ts` | the receipt layer's own laws, unchanged |
