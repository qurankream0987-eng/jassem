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

## A2A is deferred, deliberately

One complete protocol integration beats two simulations. A2A needs its bounded
projection and its delegation grant threaded into the adapter path — a real piece
of work, and not one to half-do beside this. Its transport is the same client, so
nothing here has to change for it.

## Proofs

| where | what |
| --- | --- |
| `tests/block31/remote-transport-adapter.test.ts` | a definition supports exactly the verbs it has a tool for; only trusted configuration registers one, and every malformed form fails; a discovered candidate still cannot name a definition or an operation; the adapter receives the bound endpoint and sealed credential and nothing else; an ungranted verb and a revoked connection never reach it; the raw credential is in no row, event or projection after a real call; authenticate is a handshake that calls no tool; discover narrows and does not widen (a `charge_card` tool becomes nothing); a real invoke calls exactly the configured tool once; a verb with no tool is refused before any request; malformed, declining and silent providers all produce non-OK; the credential does not follow a cross-origin redirect; no protocol or domain name appears where a verb becomes a call |
| `tests/block31/remote-capability-grant.test.ts` | the exact-verb gate in front of all of it, unchanged |
| `tests/block31/remote-execution-authority.test.ts` | the endpoint, credential and pinned-account laws, unchanged |
