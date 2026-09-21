# JASIM — THE AUTHORITY ADMINISTRATION PATH · phase report

```
APPROVAL != CLICK
MODEL PROPOSES != RUNTIME PERFORMS
STATEMENT != SUMMARY
```

**Rule held throughout:** `DOMAIN_AUTHORITY_ACTS_ADDED = 0` ·
`NEW_DOMAIN_BRANCHES = 0` · `DOMAIN_ROLES_ADDED = 0` · `FALSE_SUCCESS = 0`.

---

## 1. Why this was the hardest gap in the list

Not because the mechanism is difficult. Because the obvious implementation is
worse than not building it.

A capability called `set-negotiation-envelope`, plus a run summary the person
clicks «موافق» on, would have closed twenty-two scenarios in an afternoon and
made every guarantee in this repository decorative. A plan could propose
`{ reserve: 9999 }`, the summary would say "delegate negotiating authority", and
the person would have approved a number they never saw.

The previous report said as much before the work started, and the phase was
built to that standard.

## 2. What was built

| | |
|---|---|
| `authority_requests` | a **statement** the runtime rendered, its **digest**, an expiry, and nothing else |
| an act **registry** | seven general verbs; a new act inherits the statement, digest, expiry and re-render |
| a **renderer** | driven by the act's declared parameter schema, flattening every scalar |
| an **expansion** contract | any act naming a row must say what the row says |
| a **readback** contract | required of every act, because `RECEIPT != VERIFICATION` |
| `runtime.authorityRequest*` | list, approve — citing the digest — and reject |

The four steps:

1. **A model requests.** A registered act type and typed parameters. It performs
   nothing, and an undeclared parameter is **refused, not dropped** — a
   parameter silently discarded is one the person was never shown and the
   runtime never used.
2. **The runtime writes the statement**, from the declared schema so an act
   cannot leave anything out, and from canonical state so a caller cannot rename
   a company for the length of one sentence.
3. **Every scalar appears on its own line.** `bounds.price.reserve = 250`, not
   «الحدود: {…}». A summary is where a number goes to hide.
4. **The person cites the digest.** Before performing, the runtime re-renders
   from current canonical state; if the statement would read differently now,
   the approval is `VOID`.

## 3. The two design decisions that carry the phase

**The renderer walks the value; it does not ask the act what to show.** That is
the whole anti-theatre guarantee, and it is structural rather than a
convention: an act cannot omit a number even by accident. A test walks the
parameters of several acts and asserts every leaf appears in the statement.

**An `Id` parameter must be expanded.** «وافق على العرض p_8f3a» is not something
anyone can consent to, so `agreement.commit` renders every term, its unit and
who owes it; `membership.grant` renders what that person already holds;
`provider.bind` renders what is already bound for that class. A ratchet holds
it: any act with an `Id`-suffixed parameter must declare an expansion, and a
second test checks the rule is not vacuous.

Because the expansion reads canonical state, it is also what makes the digest
catch a proposal whose terms changed while somebody was reading.

## 4. One defect the proof found

Envelopes were arriving `VOID` for having changed when nothing had. Parameters
are stored as `jsonb`, and **Postgres does not preserve an object's key order**,
so re-rendering produced the same lines in a different sequence and a different
digest. Nested keys are now sorted.

Worth naming what that bug was: the mechanism was refusing to act — the safe
direction — and would have been easy to "fix" by comparing something looser.
Comparing something looser is how a digest stops meaning anything.

## 5. Proof

| file | tests | what it holds |
|---|---:|---|
| `tests/block31/authority-administration.test.ts` | 31 | asking performs nothing; approving performs it once; the 250 on its own line; scope names from the database; ids expanded; a changed world voiding an approval; a revoked membership; expiry; permission checked at request **and** approval; undeclared and authority-claiming parameters refused; a role name refused after approval; the four-act business setup end to end by talking; a negotiation delegated, run and agreed; every act's readback against the real database |
| `tests/unit/authority-act-contract.test.ts` | 26 | acts are general verbs; every id is expanded; every act reads back and says what it cannot undo; the renderer is schema-driven and sorted; the digest is order-independent and change-sensitive; no blanket approval; no capability imports this module |

Two end-to-end paths run on the live turn:

```
أنشئ شركتي → أضف ليلى بصلاحية النشر → ضع سياسة → اربط نظام المخزون
فوّضني للتفاوض حتى 250 → (JASIM negotiates inside it) → اتفقنا، ثبّت الاتفاق
```

Every step is a statement the person read and a digest they cited. No plan
approved anything.

## 6. Catalog effect

`AUTHORITY_ADMINISTRATION_PATH` is **closed** — the third gap to close in three
phases, and the one both previous phases left behind.

| gate | before | after |
|---|---:|---:|
| EXECUTABLE | 65 | **84** |
| OBSERVABLE | 69 | **77** |
| VERIFIABLE | 64 | **72** |
| waiting on a general capability | 69 | **50** |

Nineteen scenarios moved at once, having moved for none in the previous phase.
That is what a general mechanism looks like when it lands, and it is why the
previous phase refused to promote them early.

What is left behind is smaller and more specific: a policy can now be **set** by
talking, and nothing in the runtime **reads** one. Stored, versioned and private
is not enforced, and `POLICY_ENFORCEMENT` is what that is called — one scenario,
named honestly rather than folded into a family that now passes.

Two blind ideas moved too. The elder companionship rota and the rare-seed
lending ring are agreed by a person reading them; what they wait on now is the
other end — a Commitment stays `open` because nothing observes whether anybody
came, and nobody's own word may close it.

**162 scenarios · 16 blind holdouts · 7 blind ideas · 12 general gaps.**

## 7. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2059 passed, 27 skipped · 90 files | 2031, 27 · 89 | +28, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 392 · 30 files | 361 · 29 | +31, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript · Web build · Mobile typecheck · Expo export | all clean | | |

One inherited test changed: `agreement-contract` pinned that exactly one file
sets `ownerDirect: true`. It now pins two — the router and the authority act —
and both are places where a person is actually present. A third entry is still a
diff that has to be argued for.

## 8. What this phase did **not** do

- **No surface.** The statement travels structured through the turn's output and
  `runtime.authorityRequestsList`, ready to render. Nothing renders it, and a
  client that decided anything about it would be the UI becoming authority.
- **No policy enforcement.** Setting is not applying.
- **No delegation of delegation.** There is no act that lets someone approve on
  your behalf, and adding one needs its own evidence.
- **No re-approval flow.** A `VOID` request is not revived; the person asks
  again and reads the current version. Reviving one would be reviving words.
- **No model was involved.** `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`.

## 9. Next general gap

```
SECURE_PRODUCT_ACTION_RUNTIME      9
PERSISTENT_WORLD_MATERIALIZATION   9
GENERAL_TRANSACTION_FULFILLMENT    9
MONITORING_ENGINE                  7
REALTIME_RUNTIME                   5
BUSINESS_DATA_SOURCE_ADAPTER       3
EXTERNAL_DISCOVERY_PROVIDER        3
LOCATION_OBSERVATION               2
SUBSCRIPTION_RUNTIME               2
SPONSORED_DISCOVERY_RUNTIME        2
LIVING_OBJECT_RUNTIME              1
POLICY_ENFORCEMENT                 1
```

Three sit at nine, and they are genuinely different kinds of work.
`GENERAL_TRANSACTION_FULFILLMENT` is the one this phase leaned on hardest: the
chain now runs Intent → Proposal → Approval → Agreement and stops, with every
Commitment `open` and nothing in the world able to close one. It is also the
gap where the temptation to fake a pass is strongest, because closing a
commitment on the word of the party who owes it would make nine scenarios green
and mean nothing at all.
