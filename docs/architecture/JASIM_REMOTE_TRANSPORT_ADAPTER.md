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

- **The I/O contract.** A bridged candidate declares no `inputSpec`/`outputSpec`.
  Copying the requirement across as the offer would be proving nothing, and the
  remote's own schema has not been read at registration time. The consequence is
  honest and visible: any caller that *does* pass a requirement spec gets
  `INCOMPATIBLE`. The DAG's own `resolveProvider` call passes none, so that filter
  is vacuous on that path — a fact worth naming rather than hiding.
- **The protocol version.** A bridged candidate declares no protocol, so it is
  not filtered on one — which is `resolveProvider`'s own rule for a candidate
  that makes no protocol claim. The only honest source of a version is the remote
  system's `initialize` response, which registration has not read.

```
REQUIRED_SPEC_COPIED_AS_OFFERED_PROOF = 0
MODEL_GENERATES_PROVIDER_IO_CONTRACT = 0
```

### And why the DAG round trip is not proved with a socket

A definition's address must be public HTTPS and must not be local, and
`assertResolvedPublicEndpoint` rejects a public *name* that resolves to a private
address. So no loopback server can ever be a definition's address, and a real
socket driven from the DAG is impossible without weakening endpoint authority —
which this phase does not do. The transport's real-socket behaviour is proved
directly against the adapter; the selection and authority path is proved through
the real registry, the real `resolveProvider` and the real gate.

## A2A is deferred, deliberately

One complete protocol integration beats two simulations. A2A needs its bounded
projection and its delegation grant threaded into the adapter path — a real piece
of work, and not one to half-do beside this. Its transport is the same client, so
nothing here has to change for it.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/remote-transport-adapter.test.ts` | a definition supports exactly the verbs it has a tool for; only trusted configuration registers one, and every malformed form fails; a discovered candidate still cannot name a definition or an operation; the adapter receives the bound endpoint and sealed credential and nothing else; an ungranted verb and a revoked connection never reach it; the raw credential is in no row, event or projection after a real call; authenticate is a handshake that calls no tool; discover narrows and does not widen (a `charge_card` tool becomes nothing); a real invoke calls exactly the configured tool once; a verb with no tool is refused before any request; malformed, declining and silent providers all produce non-OK; the credential does not follow a cross-origin redirect; no protocol or domain name appears where a verb becomes a call |
| `tests/block31/remote-candidate-bridge.test.ts` | no configuration means no candidate and a definition alone is not a provider; a bridged candidate is unselectable until a real handshake, and its lease expires; a failed handshake clears the lease; the DAG's tool equals the adapter's tool; a renamed remote tool changes no verb and no capability; a discovered candidate with identical strings cannot become the bridge; every malformed trusted mapping is a boot failure including a duplicate identity; being selected authorizes nothing (no binding, unverified, wrong scope, ungranted verb, revoked); a candidate carries no address and no credential; the I/O and protocol filters still refuse what they always refused |
| `tests/block31/remote-capability-grant.test.ts` | the exact-verb gate in front of all of it, unchanged |
| `tests/block31/remote-execution-authority.test.ts` | the endpoint, credential and pinned-account laws, unchanged |
