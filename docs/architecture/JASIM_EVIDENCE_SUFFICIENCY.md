# JASIM — ENOUGH FOR THIS, NOT ENOUGH FOR THAT

> `FRESH_ENOUGH_FOR_DISCOVERY != FRESH_ENOUGH_FOR_TRANSACTION`
> `LISTED != CURRENTLY_AVAILABLE` · `DECLARED != VERIFIED`
> `CONFIRMED_ONCE != TRUE_FOREVER`
> `UNKNOWN != AVAILABLE` · `UNKNOWN != UNAVAILABLE`

## What the trace found

Almost everything. `NEW_FRESHNESS_TABLE_ADDED = NO`.

| needed | already there |
| --- | --- |
| freshness | `observations.observedAt` + `freshnessExpiresAt`; `Freshness = CURRENT\|STALE\|UNKNOWN` |
| provenance | `observations.sourceKind` / `providerId` / `provenance` |
| source strength | `EffectClaimSource` — `EXECUTOR_RETURN` · `SELF_REPORTED` · `BOUND_PROVIDER_RECEIPT` · `INTERNAL_READBACK` · `INDEPENDENT_READBACK` · `OWNER_CONFIRMATION` |
| channel → source | `effect-observation-bridge` `CHANNEL_SOURCE`, set by the trusted call site |
| policy storage | `scope_policies` — a generic key/value store |

**The missing boundary** was a decision: *given a fact, a purpose, the evidence
already stored, a policy and a clock — is this enough?* One module, three words,
no table.

## Purpose is the whole idea

```
DISCOVER · PRESENT · COMPARE · ANSWER_INFORMATION
PROPOSE · RESERVE · COMMIT · EXECUTE
```

Every entry names a **kind of act**, never a kind of thing, ordered by what it
costs to be wrong. A listing published four minutes ago is a perfectly good
reason to *show* it, and not a good reason to let somebody *bind themselves* to
it. The difference is the purpose.

```
VERIFY WHEN THE COST OF BEING WRONG BECOMES MATERIAL.
```

## The central judgement

`SELF_REPORTED` is accepted for DISCOVER, PRESENT, COMPARE, ANSWER_INFORMATION
and PROPOSE — and **excluded** from RESERVE, COMMIT and EXECUTE.

A listing is its owner saying something once. It is enough to search on, compare
on and answer with. It is not enough to bind anybody. `EXECUTOR_RETURN` is
excluded everywhere: code returning without throwing is evidence that code ran.

Defaults are keyed **by purpose and by nothing else** — there is no `CAR_TTL` and
no `SHIRT_TTL`, and a scope may replace any of it in the ordinary policy store.

```
DOMAIN_TTLS_ADDED = 0 · DOMAIN_FRESHNESS_TYPES_ADDED = 0
```

A declared policy is read **faithfully, not generously**: a scope that names only
sources which do not exist has accepted no source. Falling back to defaults
there would honour something they never said — and would be the *less* safe
reading.

## What evidence honestly covers

Evidence is set aside before it is ever judged old or weak:

- **configuration** — black/L says nothing about white/XL; Thursday says nothing about Friday
- **quantity** — one is not ten, and evidence carrying no quantity answers no question about quantity
- **revision** — evidence gathered about version 3 does not follow the subject into version 4

Each mismatch is reported by name, so "I don't know" is precise rather than
blank.

## What a verdict is not

The module **writes nothing, sends nobody anything, reserves nothing and
authorizes nothing** — asserted from its own source and proved live by counting
rows before and after.

```
FRESHNESS_EVALUATION_CREATES_FACT = 0
FRESHNESS_CREATES_RESERVATION = 0 · FRESHNESS_CREATES_ACCEPTANCE_AUTHORITY = 0
HUMAN_MESSAGES_SENT = 0 · NEW_PROVIDER_ADAPTERS = 0
```

Sufficiency is about the **evidence**, never about which way it points: strong
fresh evidence that something is *unavailable* is `SUFFICIENT`.

`STRONGER_EVIDENCE_REQUIRED` names a `requirementKey` — deterministic over
subject, property, configuration, quantity, revision and purpose, with keys
sorted — so identical questions name one requirement rather than many. A hundred
views produce none at all.

## Provenance survives into the wording

`attributionFor` returns `NONE` / `ATTRIBUTED` / `VERIFIED`. A declaration stays
attributed to whoever declared it: saying *"it is available"* about something
only its owner once claimed would be JASIM lending its own certainty to somebody
else's word. A payload claiming `verified: true` is just a payload — the source
comes from the row's own classification.

## Where the proof is

- `tests/unit/evidence-sufficiency.test.ts` — 17 tests, injected clock, exact
  boundary on both sides (at the limit is within it; one millisecond past is not).
- `tests/block31/evidence-sufficiency.test.ts` — 12 live tests against real
  stored observations: the journey without bothering anybody, scope isolation,
  a forged payload, a declared policy, seven unrelated subjects, and a
  before/after row count proving nothing was written.
