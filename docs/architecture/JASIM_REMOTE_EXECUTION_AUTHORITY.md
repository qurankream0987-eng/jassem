# JASIM — A DISCOVERED SYSTEM IS NOT A CONNECTION

```
DISCOVERED_PROVIDER != AUTHORIZED_CONNECTION
DISCOVERED_ENDPOINT != AUTHORIZED_DESTINATION
SSRF_SAFE           != AUTHORIZED_DESTINATION
PROVIDER_CANDIDATE  != PROVIDER_BINDING
REMOTE_SELECTION    != CONNECTION_AUTHORITY
FOUND_PROVIDER      != MAY_EXECUTE_PROVIDER
PAST_SELECTION      != CURRENT_EXECUTION_AUTHORITY
TRUSTED_CREDENTIAL + UNTRUSTED_DESTINATION = INVALID CONNECTION
```

## What the trace found

Three network paths reach an MCP/A2A system, and all three took their
destination from discovery.

| path | authorized by | destination from | credential |
| --- | --- | --- | --- |
| initial invoke | `resolveProvider` (trust class, freshness, availability, protocol, contract) | `provider.endpoint ?? provider.provenance.reference` | none |
| poll | the owner check on the execution row | `capability_provider_catalog.ioMetadata.endpoint`, re-read at call time | none |
| cancel | the owner check plus the state check | the same, re-read at call time | none |

The only destination check anywhere was `assertTrustedRemoteEndpoint`, which
proves HTTPS and a public address. That is a statement about the network, not
about authority — nobody had said JASIM may speak to that system, on whose
behalf, or with what.

No path required a canonical binding, a VERIFIED lifecycle, a granted
capability, or opened a credential. `endpointOf` and `credentialFor` — which
exist and do exactly this — were not reached from any of them.

Two further facts followed from re-reading the catalog at call time: a discovery
row edited between the invocation and the poll **redirected the follow-up**, and
a cancellation — a mutating instruction to somebody else's system — went to
wherever the new value pointed.

Neither `pollRemoteExecution` nor `requestRemoteCancellation` is called from
anywhere in `api/` or from any test. They were exported, unwired and untested;
they are still production code and are now both covered.

## The identity defect this phase had to fix first

The receipt phase wrote:

```ts
accountBindingFor({ scopeId, definitionId: providerBinding.providerId })
```

`providerBinding.providerId` is a **discovery candidate id** — `mcp:<server>:<tool>`,
`a2a:<agent>:<skill>`, one per tool or skill, chosen by whatever the remote
system called itself. `scope_provider_bindings.definitionId` names a **trusted
provider definition** registered in server code. Two unrelated namespaces, and
passing one where the other was expected could only ever match by coincidence.

```
DISCOVERY_ID_IMPLICITLY_EQUALS_DEFINITION_ID = 0
```

The bridge is now explicit, stated once, and **discovery may not state it**:
`CapabilityProvider.definitionId` is trusted configuration, and
`CapabilityProviderRegistry.register` refuses that field on any candidate whose
provenance is `MCP_CATALOG` or `A2A_AGENT_CARD`. A normalized tool listing or
agent card can never nominate itself as an instance of a connected provider.

A remote execution now records both: `providerId` is the candidate that was
selected, `providerDefinitionId` is the definition it was authorized as.

## The one gate

`authorizedConnection` in the general provider-binding runtime — not a second
binding runtime, and not a protocol one:

```
authorizedConnection({ bindingId, onBehalfOfScopeId, definitionId, requires })

  bindingId is null                → NO_SUCH_BINDING       (never searched for)
  row missing / legacy / not yours → NO_SUCH_BINDING       (one refusal, no oracle)
  definition does not match        → PROVIDER_MISMATCH
  lifecycle is not VERIFIED        → BINDING_NOT_USABLE
  the exact verb is not granted     → CAPABILITY_NOT_GRANTED
  the manifest does not support it  → CAPABILITY_NOT_GRANTED
  the call names no operation       → CAPABILITY_NOT_GRANTED
  unregistered / no address / no credential → CONNECTION_INCOMPLETE

  otherwise → { endpoint, credential, definitionId, scopeId, authMethod }
```

**The destination and the credential come from one read of one row**, and nothing
returns one without the other:

```
CREDENTIAL_BINDING_DIFFERS_FROM_ENDPOINT_BINDING = 0
```

### Which grant a remote call requires — the EXACT verb

The first version of this gate asked only which **side** of the vocabulary a
call was on, and treated any grant on that side as sufficient. That was too
weak, and it was the last thing standing between this door and the two older
ones beside it, which had always required the exact verb:

```
SAME_EFFECT_SIDE      != SAME_AUTHORITY
GRANTED_SOME_MUTATION != GRANTED_THIS_MUTATION
GRANTED_SOME_READ     != GRANTED_THIS_READ
```

A connection granted only `PAY` passed a `DELETE`; one granted only `OBSERVE`
passed a `SEARCH`. `capabilityMutates` keeps the job it always had — the
read/write partition — and is no longer authority for anything.

The gate now proves, for one named verb:

```
definition.supports  includes it      (a manifest that narrowed invalidates a stale grant)
binding.granted      includes it      (exact, never a sibling on the same side)
```

An operation nobody named is refused. There is no default and no "most likely"
verb: the five reading verbs are a **set**, not a ladder, so nothing could be
derived even if deriving were safe.

**Where the verb comes from.** Trusted configuration on the candidate bridge,
beside `definitionId`, and under the same trust law — `register` refuses it on a
discovered candidate:

```
operations: { invoke, readback?, cancel? }
DISCOVERY_CAN_SELF_DECLARE_EXECUTION_CAPABILITY = 0
MODEL_SELECTS_PROVIDER_CAPABILITY = 0
```

A tool named `transfer_funds` does not thereby authorize `PAY`. Never derived
from a capability id, a tool name, a remote description, or an effect class —
an effect class cannot tell `PAY` from `DELETE`, so authorizing by one would let
either stand for the other.

**Three operations, three verbs.** Invoking, reading a result back and
withdrawing the instruction are separate operations that a provider may permit
separately:

```
AUTHORITY_TO_EXECUTE != AUTHORITY_TO_READ_BACK
AUTHORITY_TO_CREATE  != AUTHORITY_TO_CANCEL
```

`readback` and `cancel` are optional, and absent means **there is none** — not
"anything on the same side". All three are pinned onto
`remote_executions.authorizedOperations` when the execution is created, so a
later follow-up reads the row instead of re-deriving a verb from discovery
metadata, a policy, or a manifest that has since moved.

```
MUTABLE_POLICY_CHANGES_REQUIRED_CAPABILITY = 0
```

### CANCEL, and why the vocabulary needed it

Nothing in the thirteen verbs meant *withdraw an instruction already given*.
`DELETE` destroys a record, `UPDATE` changes a value, `REFUND` undoes a payment
specifically. So `CANCEL` was added: generic, on the writing side, naming no
domain — the same verb withdraws a payment authorization, a reservation and a
long-running remote job. It flows through the existing path
(`supports` → `requestedCapabilities` → `grantedCapabilities` → the exact gate)
and brought no runtime of its own.

A provider whose own contract folds cancellation into the verb that started the
work says exactly that in configuration — `cancel: "BOOK"` — rather than the
runtime assuming it for everyone.

## Poll and cancel: what is remembered and what is re-asked

Two different facts, kept apart deliberately:

- **Which account ran the request** is settled history. It is read from
  `remote_executions.providerBindingRef`, pinned when the execution was created.
  Nothing is reselected — not the latest binding, not a preferred provider, not
  the current policy, not the first account that matches.
- **Whether that connection may still be called** is a question about now, and
  it is asked again every time. A connection that is no longer VERIFIED is
  refused for a readback and for a cancellation alike, which is the rule the
  general provider doors already applied; this phase did not soften it for reads.
  A cancellation additionally needs a mutating grant, because it is a new
  instruction and not a reading of what already happened.

```
POLL_RESELECTS_PROVIDER_BINDING = 0 · CANCEL_RESELECTS_PROVIDER_BINDING = 0
NULL_PROVIDER_BINDING_POLL_ALLOWED = 0 · DISCOVERY_MUTATION_REDIRECTS_RUNNING_EXECUTION = 0
```

A refused cancellation is now checked **before** the state moves, so a refusal
leaves canonical state as it was instead of parking the execution at
`CANCEL_REQUESTED` with nothing having been sent.

## The credential on the wire

`httpAuthorizationFor` turns the binding's material into exactly one header —
`Authorization: Bearer …` for a key, a token or an access token, `Basic …` for a
username and password, nothing at all for `TRUSTED_INTERNAL`. A `CERTIFICATE`
connection is **refused**: a client certificate is a transport handshake this
transport does not perform, and sending it as text would be sending a private
key to an application server.

No URL is built there, so there is no query string for material to arrive in,
and the execution row records identities only.

### And a redirect does not carry it

`McpClient` follows redirects, re-sending its headers. A binding to
`https://provider.example` does not authorize handing its credential to
`https://evil.example`, and a *public* address is not an *authorized* one — so a
request that carries an `Authorization` header now **refuses** a cross-origin
redirect rather than following it. Same-origin redirects still follow, and a
request carrying no credential is unchanged.

```
CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
```

This was latent before this phase — the transport carried no credential to lose
— and became real the moment one was attached.

## What discovery is still for

Unchanged: JASIM discovers MCP tools, A2A agents and external capabilities, and
`resolveProvider` still chooses between candidates deterministically. What a
candidate no longer decides is where JASIM speaks, as whom, or with what.

```
DISCOVERY FINDS · BINDING AUTHORIZES · RUNTIME EXECUTES · VERIFIER JUDGES
```

A candidate with no `definitionId` may be discovered, described and selected,
and will refuse to execute. In production nothing registers a remote candidate
at all, so the remote path is inert either way — the difference is that it is now
inert **because it fails closed** rather than because a field nobody wrote
happened to be empty.

## What this phase deliberately did not do

- **It did not make the binding runtime the selector.** `resolveProvider` still
  picks which candidate fits a capability; the binding decides whether that
  candidate may be called. Those are different questions and stayed separate.
- **It did not turn MCP/A2A into provider adapters.** The protocol client is
  still a protocol client. It now receives an authorized endpoint and an
  authorized credential instead of choosing its own.
- **It added no protocol or domain authority runtime.**
  `PROTOCOL_AUTHORITY_RUNTIMES_ADDED = 0`.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/remote-execution-authority.test.ts` | an unbound candidate cannot execute; discovery cannot nominate itself; only VERIFIED with the right side of the grant may be called (setup-pending, authorized, suspended and revoked each refused); the canonical endpoint is used and a mutated discovery row is never dialled, for poll and for cancel; another scope's account and another provider's account refused; the credential and address come from one account; the credential is nowhere in canonical state; a credential does not follow a cross-origin redirect (real MCP client, real sockets); the pinned account survives a policy change and a new account elsewhere; revocation stops new reads and cancellations and leaves state untouched; the three credential kinds still coexist |
| `tests/unit/remote-execution-authority-contract.test.ts` | no remote path can reach a discovered endpoint; the namespaces are bridged by trusted configuration only; destination and credential leave by the same door; the pinned account is read and never reselected; a credential never reaches a URL, a row or another origin; authority stays in the general runtime |
| `tests/block31/remote-capability-grant.test.ts` | a mutating grant authorizes its own verb and no other (PAY↛DELETE, DELETE↛PAY); a reading grant likewise (OBSERVE↛SEARCH, SEARCH↛OBSERVE, READ↛TRACK); supported is not granted, and a grant cannot exceed or be requested beyond the manifest; discovery cannot declare the verb it would be authorized as, for MCP and for A2A; a call naming no operation is refused rather than defaulted; a readback needs the verb pinned for it; a cancellation needs its own, and the verb that started the work is not it; an execution that pinned none has no authorized follow-up; nothing that changes afterwards changes which verb was required; the lifecycle and one-account rules unchanged |
| `tests/block2/mcp-transport.test.ts` | the protocol transport's own laws, unchanged |
