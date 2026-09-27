# JASIM — A REMOTE SYSTEM THAT CAN ACTUALLY BE CALLED

```
TRANSPORT != AUTHORITY
PROTOCOL  != DOMAIN
REMOTE DESCRIPTION != TRUSTED CONFIGURATION
DISCOVERED_TOOL    != AUTHORIZED_TOOL
REMOTE_TOOL_NAME   != PROVIDER_CAPABILITY
PROVIDER_UNAVAILABLE != BUSINESS_FACT
```

## What the trace found

Everything needed for a real remote call existed except two things.

**The protocol client was already complete.** `api/runtime/block2/mcp-client.ts`
implements `initialize`, `listTools`, `callTool`, `getTask` and `cancelTask` over
real HTTP, with DNS-pinned connections, a strict JSON-RPC envelope check,
`TIMEOUT` / `TRANSPORT` / `PROTOCOL` error codes, and the cross-origin redirect
refusal the previous phase added. Nothing about it needed changing.

**There was no A2A client.** A2A execution already used the same JSON-RPC client
via `callTool`; what is distinct about A2A in this repository is its *payload
projection* (`buildA2AProjection`) and its *delegation grant*, not its transport.

**What was missing** was a `ProviderAdapter` implementation and a way for a
production `ProviderDefinition` to exist at all. The production registry held
zero definitions, and the adapter contract had no implementation anywhere outside
test fixtures — so the whole authority chain built over the previous phases could
not be traversed by anything.

## The adapter, and what it is not

`api/runtime/providers/mcp-provider.ts` implements the existing contract and
decides nothing:

```
authenticate → initialize            a handshake; no tool is called
discover     → listTools             the configured verbs whose tool is really there
invoke       → callTool(tool, args)  one verb, one tool
```

By the time `invoke` runs, `authorizedConnection` has already proved the scope,
the definition, the VERIFIED lifecycle and the **exact** granted verb, and has
opened the credential for this one call. The adapter receives an already
authorized context.

```
NEW_AUTHORITY_RUNTIME_ADDED = NO
MCP_DOMAIN_RUNTIME = 0 · A2A_DOMAIN_RUNTIME = 0
```

### Where the tool name comes from

The one thing a protocol needs that the capability vocabulary does not carry is
*which remote tool performs a verb*. That is trusted configuration, and it is a
map **from capability to tool** — never the reverse:

```
tools: { SEARCH: "find_items", TRACK: "job_status", CANCEL: "stop_job" }
```

A tool called `transfer_funds` does not become `PAY` by being named that; `PAY`
becomes `transfer_funds` because a deployment said so. A verb with no configured
tool is **refused before any request is sent** — there is no fallback tool, no
first tool, and no name derived from anything.

```
TOOL_NAME_SELECTS_PROVIDER_CAPABILITY = 0
DESCRIPTION_SELECTS_PROVIDER_CAPABILITY = 0
EFFECT_KIND_SELECTS_PROVIDER_CAPABILITY = 0
MODEL_ARBITRARY_TOOL_SELECTION = 0 · MODEL_ARBITRARY_REMOTE_HTTP = 0
```

`mcpProviderDefinition` **derives** `supports` from the tool map's keys rather
than taking it beside them, so a definition cannot claim a verb it has no way to
perform, and a bound tool cannot be dead configuration.

### Discovery narrows, and cannot widen

`discover` returns the configured verbs whose tool the server actually exposes. A
tool the configuration never named contributes nothing; a verb the configuration
named contributes nothing unless its tool is really there. The result is always a
subset of the manifest — which `verifyBinding` then intersects with what was
requested, as it always did. A provider that will not answer reports **none**,
because unknown is not everything.

```
REMOTE_DISCOVERY_WIDENS_DEFINITION_SUPPORT = 0
```

### A failure is not a fact

```
unreachable, timed out, reset, undefined HTTP → UNAVAILABLE   (JASIM does not know)
answered, and the answer was an error or not the protocol → ERROR   (it declined)
```

Neither is ever a success and neither becomes an observation. `isError: true` from
the provider is a refusal, not a result.

## Where a definition comes from in production

`api/runtime/providers/configured-providers.ts`, from `JASIM_REMOTE_PROVIDERS` —
trusted deployment configuration, validated once at boot, the same trust class as
the process secret:

```json
[{ "id": "…", "displayName": "…", "authMethod": "API_KEY",
   "endpoint": "https://…" | "DECLARED_AT_SETUP",
   "tools": { "SEARCH": "find_items" },
   "webhook": "SIGNED_HMAC", "receipt": "SIGNED_HMAC" }]
```

A malformed entry is a **startup failure**, which is the cheapest place for a
mistake about an address or a verb to be found. The registry then applies the
checks it always did: the address is public HTTPS and not local, every verb is in
the vocabulary, and a test-only entry cannot enter a production registry.

```
DISCOVERY_CREATES_PROVIDER_DEFINITION = 0
MODEL_CREATES_PROVIDER_DEFINITION = 0
REMOTE_METADATA_CREATES_PROVIDER_DEFINITION = 0
```

**This ships no provider.** An installation that configures none has an empty
registry and can make no remote call, exactly as before. The difference is that a
deployment can now say otherwise without a code change, and nothing fake was
added to pretend it already had.

```
PRODUCTION_FAKE_PROVIDER = 0
```

## Why the proofs split in two

A provider definition's address must be public HTTPS and must not be local — a
rule `TRUSTED_PROVIDER_ENDPOINT_AUTHORITY` established and this phase does not
weaken. A loopback test server therefore **cannot** be a definition's address. So
each half is proved where it is true:

- **The authority chain**, through the real gate against a real definition at a
  public address, with an adapter that records the context it was handed. That is
  how *"the credential reaches only the bound endpoint"* becomes an assertion
  rather than a hope, and how *"an ungranted verb never reaches the adapter"*
  becomes a count of zero.
- **The transport**, by calling the real adapter against real loopback HTTP
  servers: a genuine round trip, a genuine redirect, a genuine timeout, a genuine
  malformed answer.

## The candidate bridge — what makes a definition selectable

```
PROVIDER_DEFINITION != CAPABILITY_PROVIDER
CONFIGURED_CANDIDATE != GRANTED_CONNECTION
SELECTED_PROVIDER    != AUTHORIZED_CONNECTION · FOUND != MAY_EXECUTE
CONFIGURED != REACHABLE
```

A definition says a kind of system exists and how a connection is made. The
DAG asks a different question — *which implementation of this **semantic**
capability should this node use?* — and answers it from the
`CapabilityProviderRegistry`, which knew nothing about configured definitions.
So a configured definition was callable through `invokeThroughBinding` and
invisible to `executeRuntimeDagNode`.

### Three namespaces, two explicit statements

```
a semantic capability   what JASIM promises             inventory.search
a provider verb         what a connection was granted   SEARCH
a remote tool name      what the system calls it        search_inventory
```

Neither relationship is inferred. `tools` states verb → tool; `candidates`
states semantic capability → verb:

```json
"tools": { "SEARCH": "search_inventory" },
"freshnessSeconds": 900,
"candidates": { "inventory.search": { "invoke": "SEARCH", "readback": "TRACK" } }
```

```
REMOTE_TOOL_NAME_SELECTS_PROVIDER_VERB = 0
PROVIDER_VERB_SELECTS_SEMANTIC_CAPABILITY = 0
DESCRIPTION_SELECTS_SEMANTIC_CAPABILITY = 0
```

`semanticMapCandidate` is **not** called: it exists to refuse automatic remote
mapping, and an explicit deployment statement is a different thing from an
inference. A test-only or unknown semantic capability is refused at boot.

A candidate's `implementationId` is **derived** from `tools[invoke]`, read
through the same parser the definition's manifest is derived from — so the tool
the DAG names and the tool the adapter calls for one operation are the same
string by construction.

```
DAG_TOOL_DIFFERS_FROM_ADAPTER_TOOL_FOR_SAME_OPERATION = 0
```

### Registered is not selectable

`resolveProvider` requires a non-native provider to be observed `AVAILABLE` and
to hold an **unexpired freshness lease**. A configuration file is not evidence
that a system answers, so a bridged candidate is registered `UNKNOWN` with no
lease — unselectable — and nothing in this code writes `AVAILABLE`.

```
CONFIG_FILE_EQUALS_LIVE_AVAILABILITY = NO
FAKE_AVAILABLE_TO_PASS_RESOLUTION = 0 · MISSING_FRESHNESS_LEASE_EXECUTES = 0
```

It becomes selectable when a **real handshake** reaches the real endpoint with
the real credential — the round trip `authenticateBinding` and `verifyBinding`
already perform. That runtime reports what it saw through a one-way observer
seam; the bridge turns a reachable observation into `AVAILABLE` plus a lease of
the deployment's own stated length, and an unreachable one into `UNAVAILABLE`
with the lease **cleared**, so a system that stopped answering stops being
selected rather than coasting on an old success. The registry's only mutation is
that observation: it cannot change a capability, a definition, an operation, a
trust class or an address.

### Whose handshake was it

An observation may only speak for its own subject, and the first version of this
observer forgot that: it read `definitionId` and `reachable` and updated every
candidate under the definition. Two facts were collapsed into one boolean, and a
per-account event was promoted to a shared one.

```
PROVIDER_DEFINITION != PROVIDER_ACCOUNT
BAD_CREDENTIAL      != PROVIDER_GLOBALLY_DOWN
ONE_BINDING_FAILURE != ALL_BINDINGS_UNAVAILABLE
OBSERVATION_AUTHORITY_MUST_MATCH_OBSERVATION_SUBJECT
```

A handshake produces **three separate facts**, and they belong to different
subjects:

| fact | subject |
| --- | --- |
| something answered at the address | the SERVICE — shared only when the address is |
| the credential was accepted | ONE ACCOUNT |
| which capabilities the account has | ONE ACCOUNT, most specifically of all |

So the observation now carries `bindingId`, `endpointMode`, `service` and
`account`, and the shared candidate is touched in exactly one case:

```
FIXED address + something ANSWERED → AVAILABLE + lease   (every binding dials that same place)
FIXED address + SILENCE            → UNAVAILABLE, lease cleared
anything else                      → nothing is written
```

An `account: "REFUSED"` never touches it — otherwise any one tenant's bad key
would take the provider away from every other tenant. A `DECLARED_AT_SETUP`
definition is never promoted at all, because each connection dials its own
address. And an adapter that cannot tell a refusal from silence reports
`service: "UNKNOWN"` and **nothing is written**, rather than guessing.

Telling the two apart needed one small transport change: a non-2xx response now
raises `HTTP_STATUS` rather than `TRANSPORT`, because *something answered* — a
401 is a healthy service refusing one credential. What a failed call MEANS is
unchanged (`UNAVAILABLE`); the new code exists only to judge whether a service
answered.

**Discovery reports nothing at all now.** It observes which capabilities *this
account* has, which cannot stand for anything shared — and it used to refresh the
shared lease, so one account's discovery failure erased an observation whose
subject was another account.

None of this is authority: availability decides whether a node may *consider* a
candidate, and execution still needs the acting scope's own VERIFIED binding.
A restart empties the observations, so nothing is selectable until a handshake
happens again — forgetting is conservative, and authority lives in the database.

```
BINDING_A_SUCCESS_MARKS_BINDING_B_AUTHENTICATED = 0
BINDING_B_AUTH_FAILURE_POISONS_BINDING_A = 0
BINDING_B_DISCOVERY_FAILURE_POISONS_BINDING_A = 0
CANDIDATE_AVAILABILITY_BYPASSES_BINDING_GATE = 0
RESTART_WIDENS_AUTHORITY = 0 · FAKE_GLOBAL_HEALTH_CHECK_ADDED = 0
```

### What a candidate still is not

It connects no account, grants no verb, carries no address and holds no
credential. Execution still needs the acting scope's own VERIFIED binding with
the exact verb granted, and still takes its endpoint and credential from that
binding.

```
CONFIGURED_CANDIDATE_AUTO_CREATES_BINDING = 0
CONFIGURED_CANDIDATE_AUTO_GRANTS_CAPABILITY = 0
CONFIGURED_CANDIDATE_ENDPOINT_BYPASSES_BINDING = 0
```

### What this bridge does not establish

Two filters it deliberately does not satisfy, because nothing trustworthy exists
to satisfy them with:

- **The protocol version** (below). The **I/O contract** was the other, and is now
  addressed — see *A contract is authority only when its evidence is*.
- **The protocol version.** A bridged candidate declares no protocol, so it is
  not filtered on one — which is `resolveProvider`'s own rule for a candidate
  that makes no protocol claim. The only honest source of a version is the remote
  system's `initialize` response, which registration has not read.

```
REQUIRED_SPEC_COPIED_AS_OFFERED_PROOF = 0
MODEL_GENERATES_PROVIDER_IO_CONTRACT = 0
```

### A contract is authority only when its evidence is

```
OBSERVED_SCHEMA_AUTHORITY MUST_MATCH OBSERVATION_SUBJECT
REQUIREMENT_SPEC_COPIED_INTO_OFFERED_SPEC = 0
REMOTE_TOOL_DESCRIPTION_IS_AUTHORITY = 0
FAIL_CLOSED > FALSE_COMPATIBILITY
```

`resolveProvider` filters external candidates on `inputSpec` / `outputSpec`, and a
bridged candidate declared neither — so any requirement that actually asked for a
field failed closed. The obvious source of a contract is the remote's own
`listTools()` schema, and **it cannot be used for a shared candidate**:

A `listTools()` result is obtained through **one binding, one credential, one
endpoint**. Nothing in the MCP protocol or in this repository says a server shows
every credential the same tool surface — servers commonly gate tools per token —
so account A seeing `search(query)` while account B sees
`search(query, tenantId required)` is ordinary. Promoting A's schema onto the
shared candidate would make it *compatible* for a requirement B could never
satisfy. `FIXED` means every binding dials the same address; it does **not** mean
every credential sees the same surface. The previous phase proved *service
answered* and *account accepted* are different facts; a tool surface is a third.

So the contract comes from the same authority that named the definition, the
tool and the verb — **trusted deployment configuration**, per route:

```json
"candidates": {
  "customers.search": {
    "invoke": "SEARCH",
    "inputSpec": [{ "name": "query", "type": "string", "required": true }]
  }
}
```

It is trusted because it belongs to the configuration authority, not because a
remote account claimed it. Absent means **there is no verified contract**, and a
requirement asking for fields stays `INCOMPATIBLE`. Input and output are
independent: a deployment that knows what a tool accepts but not what it returns
declares the first, and an output requirement still fails.

**Nothing observed is promoted.** No handshake writes a contract — a refused
credential, a silent address and a differing tool surface all leave every
declared contract exactly as it was. The one registry mutation remains the health
observation, which cannot carry a spec.

**Unrepresentable is not permissive.** `TypedFieldSpec` is a flat list of named
scalars: no element type, no interior, no enum, no union. Configuration that
implies nesting — `properties`, `items`, `enum`, `oneOf`, `$ref` — is refused at
boot rather than flattened into a claim that cannot be checked. And
`jsonSchemaToSpec`, which translates a *discovered* candidate's schema, used to
default an unknown or absent property type to `"string"`; it now yields no spec at
all, because a missing word must not become a matching type.

One inherited semantic is recorded rather than changed: `specCompatible` weighs
only the requirement's **required** fields and does not consult the offered
field's own `required` flag. An optional requirement therefore imposes nothing.
That is the existing rule for every capability in the system and not this phase's
to alter.

### And why the DAG round trip is not proved with a socket

A definition's address must be public HTTPS and must not be local, and
`assertResolvedPublicEndpoint` rejects a public *name* that resolves to a private
address. So no loopback server can ever be a definition's address, and a real
socket driven from the DAG is impossible without weakening endpoint authority —
which this phase does not do. The transport's real-socket behaviour is proved
directly against the adapter; the selection and authority path is proved through
the real registry, the real `resolveProvider` and the real gate.

### A protocol claim needs an authority

```
PROVIDER_IS_NOT_ITS_OWN_PROTOCOL_AUTHORITY
REMOTE_DECLARED_VERSION_SATISFIES_ITSELF = 0
SERVER_INFO_VERSION_IS_PROTOCOL_VERSION = 0
REQUESTED_VERSION_IS_PROVIDER_EVIDENCE = 0
NEGOTIATED_VERSION_BECOMES_SHARED_CANDIDATE_CONFIGURATION = 0
FAIL_CLOSED > FALSE_COMPATIBILITY
```

`resolveProvider` has always had a protocol filter, and its comment always said
what it was for: *unsupported/ambiguous versions fail safe*. It reads a policy
field, `supportedProtocols`, which is a statement about **what this process can
speak** — and `executeRuntimeDagNode` built that statement **by reducing over the
candidates**:

```ts
const supportedProtocols = providers.list().reduce((all, provider) => {
  if (provider.protocol && provider.protocolVersion) {
    all[provider.protocol] = [...new Set([...(all[provider.protocol] ?? []), provider.protocolVersion])];
  }
  return all;
}, {});
```

A candidate declaring `protocol: "mcp", protocolVersion: "1999-01-01"` put
`1999-01-01` into the list of supported versions and was then checked against it.
Every candidate proved its own compatibility. The filter was not weak; it was
being handed the answer by the thing it was interrogating.

The fix is to ask the only honest authority. *Which versions can be spoken here?*
is a fact about this process's transport, so the transport says so:
`MCP_PROTOCOL_VERSIONS`, exported (frozen) from `block2/mcp-client.ts`, is the
same single constant `initialize` sends and the same one it refuses any deviation
from. A connection that exists at all negotiated that and nothing else.

**Nothing was added to configuration.** A deployment-declared version could only
restate the constant the client already enforces, or contradict it and produce a
candidate this process cannot call; and a `protocol` declared without a version
is *excluded*, so an optional field would be a way to make a working candidate
disappear. So a bridged candidate declares **neither field**, and the filter
passes it for the honest reason: no claim was made. This is DESIGN 5 — *no shared
protocol/version claim* — plus closing the self-satisfying filter.

#### What a handshake may say about a version, which is nothing

A handshake is one binding, one credential, one address — the same subject
problem as availability and as a tool surface, and the narrowest provable subject
of an observed version is **the connection**. It is also information-free here:
only one version can ever succeed, so a successful `initialize` tells JASIM what
it already knew.

This is structural rather than a convention an adapter is trusted to keep.
`AuthenticationOutcome` carries an account reference and a display label and has
no version channel; `CapabilityProviderRegistry.observe` takes a health state, a
time and a lease and cannot change a protocol, a capability, a definition or an
address. So there is nowhere for a negotiated version to be written, and a
restart therefore widens nothing.

#### Three versions that are not each other

| field | what it is | what it may never become |
| --- | --- | --- |
| `protocolVersion` sent in `initialize` | what JASIM asks for | evidence of what the server speaks |
| `protocolVersion` in the result | what the server *selected* | anything, unless it equals the one constant — otherwise `PROTOCOL` |
| `serverInfo.version` (e.g. `9.4.2`) | the product's software version | a protocol version; it is read as a display label and nothing else |

A server that answers a *different* version than the one it was offered fails the
handshake, and so does one that omits the field: silence is not agreement. And
because the filter now asks the process, `9.4.2` in a `protocolVersion` field is
`INCOMPATIBLE` rather than self-satisfying.

Discovery keeps recording what it was told — `normalizeMcpToolMetadata` copies a
catalogue's declared `protocolVersion` onto the candidate, which is the honest
thing to do with a self-description. Two gates hold it: the candidate is
`UNTRUSTED_CANDIDATE`, and the version it declared is not one this process
speaks. Trust it by hand and it is still `INCOMPATIBLE`.

## A2A is deferred, deliberately

One complete protocol integration beats two simulations. A2A needs its bounded
projection and its delegation grant threaded into the adapter path — a real piece
of work, and not one to half-do beside this. Its transport is the same client, so
nothing here has to change for it.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/remote-transport-adapter.test.ts` | a definition supports exactly the verbs it has a tool for; only trusted configuration registers one, and every malformed form fails; a discovered candidate still cannot name a definition or an operation; the adapter receives the bound endpoint and sealed credential and nothing else; an ungranted verb and a revoked connection never reach it; the raw credential is in no row, event or projection after a real call; authenticate is a handshake that calls no tool; discover narrows and does not widen (a `charge_card` tool becomes nothing); a real invoke calls exactly the configured tool once; a verb with no tool is refused before any request; malformed, declining and silent providers all produce non-OK; the credential does not follow a cross-origin redirect; no protocol or domain name appears where a verb becomes a call |
| `tests/block31/remote-io-contract-authority.test.ts` | a route with no declared contract resolves bare and refuses any requirement; a declared contract satisfies exactly what it declares (type mismatch and missing required field both refused); a declared input proves nothing about output; resolving with a requirement never writes it onto the candidate; prose and extra remote tools create nothing; a contract never crosses to another tool or another definition; no handshake of any account ever changes a declared contract; a per-connection address publishes none; unrepresentable configuration is refused at boot and an unrepresentable remote schema yields none; a restart keeps the declared contract and loses the selectability; a compatible candidate still executes nothing by itself; no provider and no domain decides a contract |
| `tests/block31/remote-observation-authority.test.ts` | a refused credential at a shared address is nobody else's outage; A's success authenticates and grants B nothing; a handshake at a per-connection address speaks for no shared candidate; silence at the shared address is the one thing that unselects it; an adapter that cannot tell a refusal from silence writes nothing; discovery reports nothing in either direction; availability changes nothing about who may execute; a restart loses selectability and no authority; the two facts are separated at the transport over real HTTP (a 401 is reached, a dead port is not) |
| `tests/block31/remote-candidate-bridge.test.ts` | no configuration means no candidate and a definition alone is not a provider; a bridged candidate is unselectable until a real handshake, and its lease expires; a failed handshake clears the lease; the DAG's tool equals the adapter's tool; a renamed remote tool changes no verb and no capability; a discovered candidate with identical strings cannot become the bridge; every malformed trusted mapping is a boot failure including a duplicate identity; being selected authorizes nothing (no binding, unverified, wrong scope, ungranted verb, revoked); a candidate carries no address and no credential; the I/O and protocol filters still refuse what they always refused |
| `tests/block31/remote-capability-grant.test.ts` | the exact-verb gate in front of all of it, unchanged |
| `tests/block31/remote-execution-authority.test.ts` | the endpoint, credential and pinned-account laws, unchanged |
| `tests/block31/remote-protocol-version-authority.test.ts` | the exported version list is exactly what `initialize` sends and accepts, and is frozen; the version JASIM sends is not evidence (a differing or absent selection is `PROTOCOL`, over a real socket); `serverInfo.version` is a label and `9.4.2` is never a protocol version; a handshake has no channel to report one (`AuthenticationOutcome` and `observe` both checked structurally); the ten-case truth table (no claim, version without protocol, the spoken version, no version, older, future, empty, product version, an unspoken protocol, a case mismatch); no supported-protocol statement refuses every claim and passes only the one that made none; a candidate's own declaration no longer satisfies the filter that checks it, and the old candidate-derived list is shown selecting it; the DAG builds the list from the transport with no reduce, no candidate field and no environment key; configured candidates declare neither field and a real handshake changes neither; no configuration key can declare one; a discovered declaration stays untrusted and unsupported; A's handshake at a shared address makes B compatible with nothing and a per-binding address promotes nothing; no requirement-side protocol exists and resolving writes nothing; compatibility still needs the scope's own binding and the exact verb; a rebuild restores no negotiated version; the authority names no domain and no provider |
