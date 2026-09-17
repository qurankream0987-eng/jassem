# JASIM — Model Gateway environment contract (Railway Staging)

**Names only. No value in this file is a real credential, and none ever should be.**
Set every value in Railway's own secret store. Nothing here is committed, echoed
in logs, returned by an API, or placed in a model prompt.

Status: **prepared, not deployed.** No deployment was performed in Wave 2.1.

---

## 1. Required

| Variable | What it is | Notes |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Staging database only. Never the production one. |
| `SESSION_SECRET` | Signing secret for runtime ownership | Generate per environment. Rotating it invalidates existing sessions. |

The process refuses to start without both. That is deliberate: a runtime that
boots with no session secret would be one that cannot tell whose data it is
holding.

---

## 2. Provider selection — pick exactly one to start

One working provider is the whole gate. Others stay `NOT_CONFIGURED` and JASIM
reports them that way rather than pretending.

| Variable | What it is |
|---|---|
| `JASIM_MODEL_PROVIDER` | `openai` \| `anthropic` \| `gemini` \| `openai-compatible` |
| `JASIM_MODEL` | Default model identifier when no tier-specific one is set |

Then the credential for whichever provider was named:

| Provider | Credential | Optional base URL |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| `anthropic` | `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) | `ANTHROPIC_BASE_URL` |
| `gemini` | `GEMINI_API_KEY` | `GEMINI_BASE_URL` |
| `openai-compatible` | `MODEL_GATEWAY_API_KEY` | `MODEL_GATEWAY_BASE_URL` (**required**) |

`JASIM_MODEL_PROVIDER` may be omitted, in which case the provider is inferred
from whichever credential is present. Prefer setting it explicitly: inference is
a convenience for a laptop, and on a shared environment it makes "which model
answered" depend on which secret someone added last.

---

## 3. Tier mapping

JASIM routes to a *semantic* tier and a deployment decides which model provides
it. Nothing in the runtime names a vendor.

| Semantic tier | Internal code | Model variable | Provider override | Fallback list |
|---|---|---|---|---|
| `FAST_CHEAP` | `T1` | `JASIM_MODEL_T1` | `JASIM_MODEL_T1_PROVIDER` | `JASIM_MODEL_T1_FALLBACKS` |
| `BALANCED` | `T2` | `JASIM_MODEL_T2` | `JASIM_MODEL_T2_PROVIDER` | `JASIM_MODEL_T2_FALLBACKS` |
| `STRONG_REASONING` | `T3` | `JASIM_MODEL_T3` | `JASIM_MODEL_T3_PROVIDER` | `JASIM_MODEL_T3_FALLBACKS` |

Fallback lists are comma-separated `provider:model` pairs, tried in order:

```
JASIM_MODEL_T1_FALLBACKS = <provider>:<model>,<provider>:<model>
```

An unset tier variable is not an error. The tier falls back to `JASIM_MODEL`,
and a tier with no model configured reports `NOT_CONFIGURED`.

A fallback needs its own provider's credential to be present too. A fallback
naming a provider with no key is skipped — truthfully, as
`PROVIDER_AUTH_FAILED` — rather than failing the request outright.

---

## 4. Budget and safety

| Variable | Default | What happens if unset |
|---|---|---|
| `JASIM_MODEL_BUDGET_ENFORCEMENT` | `STRICT` | **Stays strict.** See below. |
| `JASIM_MODEL_MAX_CALLS_PER_SCOPE` | `8` | 8 provider attempts per request or job |
| `JASIM_MODEL_MAX_INPUT_TOKENS` | `200000` | Absolute input ceiling, which no caller can widen |
| `JASIM_MODEL_MAX_RETRIES_PER_CANDIDATE` | `1` | One retry per candidate, clamped to 3 |
| `JASIM_CAPABILITY_MODEL_ALLOWLIST` | *(empty)* | Plan-step inputs may not name a model at all |

### The one that matters

**`JASIM_MODEL_BUDGET_ENFORCEMENT` fails closed, and production ignores it.**

Unset means `STRICT`. A typo means `STRICT`. Only the exact string `SCOPED`, in
a non-production environment, relaxes it — and when `NODE_ENV=production` the
variable is not read at all, so no value anyone can set makes a production
deployment call a model outside a budget context.

This is deliberate. The budget travels through `AsyncLocalStorage`, and the one
way it fails is by being absent — which at a call site is indistinguishable from
being generous. "Remember to set the variable" is not a safety property; the
safe state has to be the one you get by doing nothing.

Set `NODE_ENV=production` on Staging if you want Staging to behave exactly as
Production will. Leave it unset to keep the escape hatch available for
debugging.

---

## 5. Pricing

| Variable | What it is |
|---|---|
| `JASIM_MODEL_PRICES` | JSON object keyed by `provider/model`, with an optional `provider/*` fallback |

```
JASIM_MODEL_PRICES = {"<provider>/<model>":{"inputPerMillion":0,"outputPerMillion":0,"currency":"USD"}}
```

Per entry: `inputPerMillion`, `outputPerMillion`, optional
`cachedInputPerMillion` and `reasoningPerMillion`, optional `currency`
(ISO-4217, default `USD`).

No vendor price is compiled into JASIM. A hardcoded table goes stale and becomes
a confident lie; an unconfigured price yields `undefined` and the ledger records
the call as **unpriced**, never as free. Leaving this unset is a supported state
— every cost report then says its coverage is incomplete instead of reporting a
misleadingly small total.

`ESTIMATED_MODEL_COST` is JASIM's own arithmetic. `PROVIDER_BILLED_COST` is what
the provider actually charges, which no provider returns per call, so it stays
`UNAVAILABLE`. The two are never equated.

---

## 6. Live model tests

| Variable | Purpose |
|---|---|
| `JASIM_LIVE_MODEL_TESTS` | `1` enables `tests/integration/model-provider-live.test.ts` |

Double-gated: it needs both this flag and a credential. **Do not set it in CI.**
A suite that bills on every push is a suite people stop running.

---

## 7. Not in scope for this environment

Deliberately absent, and their absence is a control rather than an oversight —
Real Discovery has not started:

- Search, Maps, delivery and PSP credentials
- Production database credentials
- Anything under `JASIM_MOYASAR_*`, `JASIM_SHIPDAY_*`, `JASIM_PARTNER_PAYMENT_*`

---

## 8. Minimum viable Staging

The shortest list that boots and serves real model traffic:

```
DATABASE_URL
SESSION_SECRET
JASIM_MODEL_PROVIDER
JASIM_MODEL
<PROVIDER>_API_KEY
```

Everything else has a safe default. Add `JASIM_MODEL_PRICES` when cost reporting
needs to be complete rather than merely honest about being incomplete.

---

## 9. Verifying a deployment without spending much

1. `GET /health` — confirms boot, which proves `DATABASE_URL` and
   `SESSION_SECRET` are present.
2. One authenticated conversation turn — proves the credential, the tier
   mapping, and that a ledger row is written.
3. Read `jasim_model_usage_ledger` for that turn: `provider`, `modelId`, `tier`,
   token counts, `latencyMs`, `estimatedCost`. A row whose provider is
   `unavailable` means JASIM declined to call a model and the `errorCategory`
   column says why.

One turn is enough. If the ledger row is right, the contract is right.
