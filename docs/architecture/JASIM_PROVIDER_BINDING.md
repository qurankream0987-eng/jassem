# JASIM — CONNECTED IS NOT VERIFIED

> `MODEL != SECRET STORE` · `MODEL != PROVIDER AUTHORITY` · `MODEL != CREDENTIAL TRANSPORT`
> `CONNECTED != VERIFIED` · `AUTHORIZED != AUTHENTICATED != VERIFIED` · `VERIFIED != FULL ACCESS`
> `READ != WRITE` · `PROVIDER_WRITE_PERMISSION != JASIM_ACTION_AUTHORITY`
> `PROVIDER_RESPONSE != CANONICAL_TRUTH` · `PROVIDER_UNAVAILABLE != BUSINESS_FACT`
> `SETUP_LINK_CREATED != CREDENTIAL_STORED != AUTHENTICATED != VERIFIED != CAPABILITY_AVAILABLE`

This is the layer through which JASIM may later connect to any external system.
It integrates none of them.

## What the trace found

More than expected. `scope_provider_bindings` already existed and already got
the hardest part right.

| needed | already there |
| --- | --- |
| a binding owned by a **scope** | `scope_provider_bindings.scopeId` |
| permission to connect one | `manage_providers`, via `authorizeScopeAction` |
| a credential **reference** | `credentialEnvName` — a NAME, value in the environment |
| a trusted surface for secrets | `product-actions.ts` + `product_action_sessions` |
| `SENSITIVE` fields a model cannot redefine | `FIELD_KINDS`, `sensitiveFieldsOf` |
| an envelope cipher | `AES-256-GCM` + AAD, in `generated-input-secret-vault.ts` |
| an SSRF boundary with DNS pinning | `assertResolvedPublicEndpoint` in `block2/mcp-client.ts` |
| a short-lived one-time external session | `external_action_sessions` |
| a test-only registry gate | `CapabilityRegistry`'s `allowTestOnly` |
| a claim source for a bound provider | `BOUND_PROVIDER_RECEIPT`, already consequential |
| a source failure that is not a fact | `SourceFailure.PROVIDER_UNAVAILABLE` |

**Answers to the eleven trace questions**

1. **Canonical provider abstraction?** Partial — a binding, with no definition, no capabilities and no lifecycle.
2. **Provider registry?** Two, neither this: `capability_provider_catalog` and `CapabilityProviderRegistry` describe capability *implementations*, not external business systems.
3. **Secret-reference abstraction?** Three: `credentialEnvName`, `payment_method_references.tokenRef`, and the AES-GCM input vault.
4. **Where are external credentials stored?** Environment variables, named by the binding. Nothing user-supplied was stored anywhere.
5. **Secure setup-session primitive?** Yes — the product-action runtime, reused here whole.
6. **OAuth?** Only for JASIM's own identity. No provider-side flow.
7. **API-key integrations?** Only as boot-time configuration.
8. **Capabilities modeled?** Yes, for JASIM's internal capability system. Nothing said what a *binding* may do.
9. **Verification separate from configuration?** **No.** `bindScopeProvider` inserted `state: "active"`. Creating the row was being connected.
10. **Can provider receipts become Observations?** On the **effect** axis yes, through a signed receipt in the executor. On the **evidence** axis no: `SOURCE_BY_PROOF_CLASS` mapped no proof class to `BOUND_PROVIDER_RECEIPT`, so the strongest machine source the freshness policy accepted was one nothing could produce.
11. **Smallest missing layer?** A definition, a capability grant, a lifecycle, a credential reference — and one mapping entry.

## The three things, kept apart

```
DEFINITION   what kind of external integration this is   trusted code
BINDING      this scope authorized this account of it    a canonical row
CAPABILITY   what that binding may actually do           granted, not supported
```

A definition may support eight verbs and a binding be granted one.
`PROVIDER_SUPPORTS_CAPABILITY != BINDING_GRANTED_CAPABILITY`, and the grant is
an **intersection** — of what was asked for, what the provider supports, and
what the account turned out to be able to do. A person asking for `UPDATE` from
a read-only account gets `READ`, and is told what was withheld.

## No provider is a branch

There is no `kind` column enumerating inventory, calendar or ERP, and no
`ShopifyBindingRuntime`. A named system is a definition plus an adapter plus a
capability manifest — data, registered in trusted server code.

```
DOMAIN_PROVIDER_BINDING_TYPES    = 0
DOMAIN_PROVIDER_BINDING_HANDLERS = 0
NEW_PROVIDER != NEW_CORE
```

A payment gateway is a provider whose manifest contains `PAY` and `REFUND`.
`PAY` appears exactly twice in the runtime — once in the vocabulary, once in the
set of verbs that mutate — and a contract test holds it there.

```
PAYMENT_PROVIDER_SPECIAL_BINDING_RUNTIME = 0
```

## Read and write are different sets

Not two levels of one permission:

```
reads   READ SEARCH DISCOVER OBSERVE TRACK
writes  CREATE UPDATE DELETE BOOK SCHEDULE MESSAGE PAY REFUND
```

Partitioned — nothing is both, nothing is neither, and an unknown verb is not
quietly a read. `READ_GRANT_IMPLIES_WRITE = 0` is arithmetic.

## Four gates, and the fourth is the one that is easy to lose

```
1  the binding is this scope's                  NO_SUCH_BINDING
2  the binding is VERIFIED                      BINDING_NOT_USABLE
3  the capability was GRANTED to this binding   CAPABILITY_NOT_GRANTED
4  a mutating call needs JASIM's own authority  NOT_AUTHORIZED_TO_ACT
```

A calendar provider supports `SCHEDULE`; the binding was granted `SCHEDULE`; a
member who may *view* but not *mutate* still cannot schedule anything. The
policy, approval and execution runtimes remain in front of that, untouched.

```
PROVIDER_WRITE_PERMISSION != JASIM_ACTION_AUTHORITY
```

All four run before the adapter is reached, so a refusal never becomes a call.

## The secret never enters the conversation

Credential collection is the existing trusted product action surface, reused —
not a second trusted-product framework. One registered action, `provider.connect`,
whose sensitive fields are the superset and whose *required* fields are read from
the provider definition's authentication method. Auth method is configuration;
there is no runtime per method.

The binding row holds a **reference**. Material is sealed with the repository's
own AES-256-GCM construction, additionally authenticated over the scope, the
binding and the credential version — so a sealed value cannot be replayed into
another binding or an older rotation. A test moves one and it fails to open.

**What this backend honestly is:** application-level envelope encryption with a
key derived from the process secret. It is what this repository has. It is *not*
a KMS or an HSM — an attacker holding both the database and the process secret
holds the credentials. The `ProviderCredentialVault` interface exists so a
deployment can substitute a real key-management backend with no caller changing.
**That substitution is the open item of this phase.**

## Who chooses where a credential is sent

A review of the first cut found one narrow authority leak, and it is worth
recording rather than quietly fixing.

The model-visible request schema carried `endpointUrl`, and the conversation
boundary passed it into `beginProviderSetup`, which network-checked it and
persisted it as the address the credential would later be used against. The
network check was correct. It was answering a different question.

```
SSRF_SAFE                != AUTHORIZED_DESTINATION
MODEL_SUGGESTED_ENDPOINT != TRUSTED_ENDPOINT
CONVERSATION_URL         != CREDENTIAL_TARGET
```

A perfectly valid public HTTPS address can still be the wrong address, and
nothing about appearing in a conversation makes it the right one. So the field
is gone from the schema entirely, and `beginProviderSetup` has no parameter for
an address at all: for a provider whose endpoint is declared at setup, it leaves
the address empty and reports that the trusted surface must collect it.

**There is no "suggestion" path, and the reason is structural.** The trusted
presentation contract carries no value, ever — not a default, not a previous
entry, not a hint. A model-suggested prefill would have had nowhere to go, so
removal was the only honest option rather than one of two.

The address is now collected by `provider.connect`, beside the credential it
targets, in one submission against one binding under one re-read of standing:

```
TRUSTED_CREDENTIAL + UNTRUSTED_DESTINATION = INVALID CONNECTION
```

That co-location is what makes `CROSS_BINDING_ENDPOINT_SWAP = 0` structural
rather than checked — there is no pair of halves to mismatch. A connection whose
address is missing seals no credential; an address supplied for a `FIXED`
provider is **refused rather than ignored**, because silently dropping it would
leave whoever sent it believing it took effect.

Two smaller things closed at the same source: a provider base endpoint carrying
a query string, a fragment, or an authority credential is refused — that being
exactly where a secret would sit if one ever reached a URL, it is better refused
than scrubbed out of the audit afterwards. The audit records the host and
nothing else.

And because a destination somebody chose does not authorize every destination
*it* can point at, `assertWithinEndpoint` is the contract an adapter calls
before following a redirect. No transport exists yet, so it is a contract — but
one with a function behind it and a test on it, not a paragraph.

```
MODEL_CAN_SET_PROVIDER_ENDPOINT = NO
MODEL_OUTPUT_TO_BINDING_ENDPOINT_DIRECT_PATH = 0
MODEL_CHOSEN_PUBLIC_ENDPOINT_ACCEPTED = 0
CHAT_URL_AUTOMATICALLY_BECOMES_CREDENTIAL_DESTINATION = 0
MODEL_OVERRIDES_FIXED_PROVIDER_ENDPOINT = 0
CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
```

The model may still understand «اربطك بموقعي», and a person may still write
their address in the conversation. Understanding is not deciding.

## Where this is stricter than what it reuses

The shared network boundary permits a loopback host by name, and for its own
caller that is correct — a runtime legitimately talks to an MCP server on the
same machine, named in trusted configuration. A provider endpoint is a different
trust class: it is typed in by a business at a setup surface. So the loopback
forms that guard lets through are refused here before resolution; everything
else — private ranges, link-local, cloud metadata, carrier-grade NAT, and any
*name* that resolves into one, with the resolution pinned against rebinding — is
the shared guard's, verified by test against it rather than reimplemented.

Both halves are required, and they answer different questions. The network
boundary answers *is this address safe to contact*. The trusted surface answers
*did the authorized person actually choose it*. Neither substitutes for the other.

## A provider's answer is evidence, and evidence is not a verdict

The binding runtime writes an observation and stops. It never reaches for the
runtime that decides whether evidence is good enough.

```
sourceKind "bound_provider_receipt"  →  BOUND_PROVIDER_RECEIPT
```

That one mapping is the whole connection, and it is set by the trusted call site
from the CHANNEL, never lifted from a payload. The freshness runtime then judges
it exactly as it judges a human answer: a test records one reading and shows the
*same* reading sufficient to commit on at five minutes and insufficient at sixty.
Age decided that. The provider had no vote.

```
PROVIDER_BINDING_DECLARES_BUSINESS_TRUTH = 0
PROVIDER_RESPONSE_BYPASSES_FRESHNESS = 0
```

And a provider that cannot be reached says nothing about the world.
`PROVIDER_UNAVAILABLE` and `PROVIDER_ERROR` stay two different states, and
neither is ever `false`, `unavailable` or `out of stock`. Neither writes an
observation at all.

## The human source is not displaced

The phase before this one still works. Where no binding exists, where a binding
lacks the capability, and where a provider call fails, asking the person who
knows remains a legitimate source — asserted directly: with no provider evidence
the verdict is `UNKNOWN`, and a counterparty confirmation makes it `SUFFICIENT`.

**Source priority is deliberately not built here.** Choosing between local,
provider and human evidence is the next phase. This one only makes a verified
binding a legitimate candidate.

## No fixture is a provider

`PRODUCTION_FAKE_PROVIDER = 0` is arithmetic rather than a promise: the
production registry is **empty**, because this is the binding layer and no real
adapter has been written yet. It refuses any definition marked `testOnly`, and a
test asserts both facts. The seven holdouts live in a registry built to hold
fixtures, which is test code.

## Seven holdouts, one runtime

| holdout | authentication | manifest | endpoint |
| --- | --- | --- | --- |
| stock system | API key | READ SEARCH UPDATE | fixed |
| calendar | OAuth code | READ CREATE SCHEDULE | fixed |
| resource system | basic credential | READ UPDATE CREATE | fixed |
| document store | signed token | READ SEARCH | fixed |
| telemetry | certificate | OBSERVE TRACK | fixed |
| custom API | API key | READ CREATE | declared at setup |
| payment gateway | API key | READ PAY REFUND | fixed |

They differ on the three axes a real provider actually differs on. They pass
through one lifecycle, one gate and one vault, and no branch anywhere reads
which is which.

## What was added, and what was not

One migration. Thirteen columns on a table that already existed, and one new
table for sealed material. No table was dropped or renamed, and a row with a
`NULL` lifecycle is a legacy environment binding exactly as before — the
connector runtime refuses to use one, so nothing became usable by being migrated.
