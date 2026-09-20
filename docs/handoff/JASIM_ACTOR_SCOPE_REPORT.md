# JASIM — BUSINESS / ORGANIZATION ACTOR SCOPE · phase report

```
AUTHENTICATED PRINCIPAL  !=  ACTING SCOPE
```

**Rule held throughout:** `DOMAIN_BUSINESS_TYPES_ADDED = 0` · `DOMAIN_ROLES_ADDED = 0` ·
`NEW_DOMAIN_BRANCHES = 0` · `DOMAIN_AGENTS_ADDED = 0` · `DOMAIN_MARKETPLACES_ADDED = 0` ·
`IDEA_DOMAIN_BRANCHES = 0` · `IDEA_AGENTS_ADDED = 0` · `FALSE_PURE_READ = 0` ·
`FALSE_SUCCESS = 0`.

---

## 1. What a business turned out to be

A value the `ownerId` column can hold. Not a second runtime, not a second
intelligence, and not a migration: `ownerId` was already opaque everywhere that
mattered, so almost nothing was renamed.

`memberships` already provided a durable, revocable, audited person↔organization
grant. **No new grant table was added** — two answers to "may they" is worse than
one awkward one.

What was genuinely new: `organizations`, `scope_policies`,
`scope_provider_bindings` (migration `0014_actor_scope.sql`) and
`api/runtime/actor-scope.ts`.

A business's *kind* — restaurant, factory, school — lives in `attributes`. Eleven
organization kinds, five familiar and six nobody designed for, run through the
same code and no production line reads that field.

## 2. Three defects the work found

**A pure read that wrote.** `opportunity-discover` both listed and matched, and
matching inserts non-idempotent `economic_matches` rows. One registration made a
write look like a read. Matching is now `opportunity-match`, classified
`INTERNAL_STATE`, and discovery refuses a `needId` rather than quietly doing
something else. `FALSE_PURE_READ = 0` is a ratchet, not an aspiration.

**Membership was being read as permission.** The turn resolved the scope and
then acted, so a member granted only `view` could publish in the company's name.
Capabilities now declare the verb they need **at registration** — for the same
reason they cannot declare what their own evidence is worth — and the check runs
at the turn boundary, the one place where both the principal and the scope are
known. Omitting the declaration is safe and never permissive: the fallback comes
from the effect kind, and an unidentifiable capability is charged `mutate`.

**A read answered as the wrong owner.** `DIRECT_READ` passed the principal, so
«أرني عملياتي» said while acting for a company returned the person's rows. It now
reads the acting scope. That exposed a second thing worth naming: a resource
whose owner column is numeric is keyed to a *person*, so an organization scope
would have matched nothing and been shown an empty table. **That is a false
empty** — it says the company has none when the truth is that a company cannot
hold one at all — and it now answers `UNAVAILABLE`.

## 3. Continuity, and what it may not carry

```
ESTABLISHED SCOPE != STANDING AUTHORITY
```

A conversation remembers which scope it is being conducted for. It never
remembers that the person may act there: what is carried forward is an ordinary
`ActingScopeRequest` — the kind of thing a model is allowed to produce — and it
is re-resolved on every turn.

- a membership revoked between two turns is denied on the second one
- «شخصياً» ends the organization scope rather than excusing one turn
- only an exact id is carried, never a hint — re-matching stale words against a
  changed membership list is how a conversation silently changes company
- a scope that stops resolving is **forgotten**, not retried: a memory that could
  only ever be denied would lock a person out of their own work

## 4. The Idea Intake Law

```
UNKNOWN IDEA != UNSUPPORTED DOMAIN
```

Recorded as §4.4 of the governing law and measured by a second blind family of
**seven** ideas — things that match no industry, no marketplace, no application,
no business category and no workflow. All seven enter, decompose into primitives
that already existed and come back with an answer. Three kinds of answer occur,
and all three are correct:

| | |
|---|---|
| runs today | a time bank, a rainwater surplus ring |
| needs a capability that does not exist | an elder companionship rota, a rare-seed lending ring, a dark-sky map, a flood-channel watch |
| needs a provider nobody connected | a vanishing-dialect archive |

`IdeaAgent`, `IdeaMarketplace`, an idea registry and an idea category enum are
forbidden by name and asserted absent from the runtime. The ideas are
deliberately **not** forced down one route: answering every idea the same way
would be a domain branch wearing the costume of generality.

Neither blind family may be the first user of a primitive, a capability or a
route — a blind case that licensed itself, or licensed another, would measure
nothing. That test found a real inconsistency: `realtime.delivery_tracker` is the
one scenario blocked on `LOCATION_OBSERVATION` and was not declaring `Location`.

## 5. Proof

| file | tests | what it holds |
|---|---:|---|
| `tests/block31/actor-scope-runtime.test.ts` | 53 | organizations, membership, verbs, DENIED and NEEDS_INPUT, revocation, B2B/P2B/B2P through one exchange, cross-scope isolation, private versioned policies, provider-binding isolation, five live turns, continuity, the scoped data path, eleven holdout organization kinds |
| `tests/unit/actor-scope-contract.test.ts` | 34 | authority refusal, verbs are not roles, continuity carries a request, the UI decides nothing |
| `tests/block31/opportunity-exchange-turn-path.test.ts` | 48 | the split between discovery and matching |

The five live turns are the ones the brief asked for:

```
A  «باسم شركتي انشر…»     → the run opens under the organization
B  «ابحث باسم شركتي…»     → discovery runs as the company; nothing of the
                             person's own private rows is visible to it
C  «شخصياً»                → the same person, their own scope
D  an organization they do not belong to  → DENIED, nothing written
E  «باسم شركتي» × two      → NEEDS_INPUT, both named
```

## 6. Catalog effect

`BUSINESS_SCOPE_RUNTIME` is **closed** and removed from the vocabulary of blames.
It is replaced by the narrower and more honest `SCOPE_ADMINISTRATION_PATH`:
creating an organization, adding a member, granting a verb, setting a policy and
binding a provider all exist as mechanisms and none is reachable by speaking.

The `BUSINESS` family was **not** bulk-promoted. It is split:

| | |
|---|---|
| **acting** in a scope — publish a Need, an Offering, a Resource, Capacity | `EXECUTABLE = PASS` |
| **administering** one | `SCOPE_ADMINISTRATION_PATH` |
| «أرني أداء المبيعات» | `BUSINESS_DATA_SOURCE_ADAPTER` |
| «اربط نظام شركتي» | `PERSISTENT_WORLD_MATERIALIZATION` |

`JASIM_OS` gained nothing. The core already runs under a business scope; its
branding, its own data and a durable system carrying them do not exist, and none
of them is a second intelligence.

| gate | before | after |
|---|---:|---:|
| EXECUTABLE | 59 | **65** |
| OBSERVABLE | 61 | **67** |
| VERIFIABLE | 56 | **62** |

**162 scenarios · 16 blind holdouts · 7 blind ideas.** Scenarios waiting on a
general capability: 69 — unchanged, because four business scenarios left that
column and four new ideas entered it.

## 7. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 1999 passed, 27 skipped · 88 files | 1952, 27 · 87 | +47, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 311 · 28 files | 256 · 27 | +55, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

Block 2, Block 3 and Block 3.1 need `--no-file-parallelism`; in parallel their
files race to create the same proof database. That is the harness, not the code.

One inherited test changed: `opportunity-exchange-contract` pinned "exactly two
capabilities". It now pins three, because matching was separated from discovery.
The intent — *not one per market* — is unchanged and a fourth would still be a
visible diff. No test was weakened and none was removed.

## 8. What this phase did **not** do

- **No conversational administration.** One gap, deliberately, rather than a
  capability per administrative verb.
- **No business data source.** The seam is ready and **no business row was
  fabricated** to show it.
- **No negotiation, transaction, fulfillment, subscription, sponsored discovery,
  realtime, ERP adapter, payment or business dashboard.** Untouched, by
  instruction.
- **No model was involved.** `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`; the
  envelope is stubbed exactly as in every previous phase.

## 9. Next general gap

The gaps ranked by how many scenarios each would close:

```
GENERAL_AGREEMENT_RUNTIME         13
SECURE_PRODUCT_ACTION_RUNTIME      9
PERSISTENT_WORLD_MATERIALIZATION   9
SCOPE_ADMINISTRATION_PATH          9
MONITORING_ENGINE                  7
GENERAL_TRANSACTION_FULFILLMENT    7
REALTIME_RUNTIME                   5
BUSINESS_DATA_SOURCE_ADAPTER       3
EXTERNAL_DISCOVERY_PROVIDER        3
LOCATION_OBSERVATION               2
SUBSCRIPTION_RUNTIME               2
SPONSORED_DISCOVERY_RUNTIME        2
LIVING_OBJECT_RUNTIME              1
```

`GENERAL_AGREEMENT_RUNTIME` is the largest at 13, and it is what two of this
phase's own ideas are waiting on — proposals, counter-proposals, bounded
authority and Terms that survive into an Agreement. `SCOPE_ADMINISTRATION_PATH`
is the narrower one this phase created and is the reason the rest of `JASIM_OS`
cannot be reached by talking.
