# JASIM — SEMANTIC ROUTER

**Status:** IMPLEMENTED · **Module:** `api/runtime/semantic-router.ts`
**Tests:** `tests/unit/semantic-router.test.ts` (61) · `tests/block31/semantic-router-turn-path.test.ts` (13)

---

## 1. The gap this closed

PlanGraph could already **classify** a goal that is not a DAG. The active turn
could not **act** on that classification, because `envelope.kind` had already
decided. So «أرني جدول مبيعاتي» and «سجلني خروج» both produced a blocked
execution run — an artefact of arriving as `direct_action`, not an answer to
what was asked.

Classification without routing is half a mechanism.

## 2. The vocabulary

Nine mechanisms. Every domain in the world uses the same nine.

| Route | Means |
|---|---|
| `TEXT` | an answer in words |
| `DIRECT_READ` | authorized canonical data, no side effect |
| `GENERATED_PRESENTATION` | a surface over state that already exists |
| `TRUSTED_PRODUCT_ACTION` | identity or account mutation, via a trusted surface |
| `GENERAL_PLANGRAPH` | real dependency-aware work |
| `MONITORING` | a standing condition that acts only if it becomes true |
| `PERSISTENT_LIVING_OBJECT` | something that continues because it needs following |
| `PERSISTENT_WORLD` | a durable system |
| `LEGACY_FLAT` | the pre-PlanGraph path, kept **visible** |

`DOMAIN_ROUTES_ADDED = 0`, enforced: the module's code (comments and string
literals stripped) contains no *sales, inventory, jobs, restaurant, driver,
travel, hotel, shopping, recruitment, hiring, car, flight, delivery*.

## 3. Precedence — one ordered table, read top to bottom

`ROUTING_RULES` is a **value**, not a chain of `if`s, so precedence is something
a test can read and "why did this go there" is answered by one rule code.

```
1  PLAN_IDENTITY_CHANGE        → TRUSTED_PRODUCT_ACTION
2  PLAN_SETTING_MUTATION       → TRUSTED_PRODUCT_ACTION
3  PLAN_MONITORING             → MONITORING
4  PLAN_PERSISTENT_WORLD       → PERSISTENT_WORLD
5  PLAN_DIRECT_READ            → DIRECT_READ
6  PLAN_DAG_EXECUTABLE         → GENERAL_PLANGRAPH
7  PLAN_NOT_ROUTABLE           → LEGACY_FLAT
8  ENVELOPE_TEXT               → TEXT
9  ENVELOPE_PRESENTATION       → GENERATED_PRESENTATION
10 ENVELOPE_PERSISTENT_BUBBLE  → PERSISTENT_LIVING_OBJECT
11 ENVELOPE_EXECUTION_NO_PLAN  → LEGACY_FLAT
```

Three orderings carry weight, and each is pinned by a test:

- **Every plan rule precedes every envelope rule.** This ordering *is* the fix.
  If it inverts, the envelope decides mechanism again.
- **Identity is rule 1, before any validity check.** A plan that says it changes
  who the runtime operates as must never become a DAG — and that has to hold
  when the plan is *malformed*, which is the case where routing it as ordinary
  execution would do the most harm, not the least.
- **`PLAN_DIRECT_READ` precedes `PLAN_DAG_EXECUTABLE`.** A request that merely
  mentions something a capability could do is still a read.

## 4. What routing actually changes

| Route | Live behaviour |
|---|---|
| `DIRECT_READ` · `TRUSTED_PRODUCT_ACTION` · `MONITORING` · `PERSISTENT_WORLD` | **No run. No proposal. No DAG.** A `kind: "routed"` output with `state: UNAVAILABLE`. |
| `GENERAL_PLANGRAPH` | materialises a real DAG (previous phase) |
| `TEXT` · `GENERATED_PRESENTATION` · `PERSISTENT_LIVING_OBJECT` | unchanged envelope handling |
| `LEGACY_FLAT` | unchanged flat proposals |

The four route-away kinds are placed **after** the transitional commerce branch,
so that path behaves exactly as it did. The ratchet says it may shrink, and
shrinking it is a separate, proven step rather than a side effect of this one.

## 5. Truthful unavailability

```ts
{ state: "UNAVAILABLE", cause: "MECHANISM_NOT_IMPLEMENTED", route, message }
```

`UNAVAILABLE` and **not** `FAILED`: nothing was attempted, so nothing failed.
And **not** `BLOCKED_BY_PROVIDER`: no provider is missing here — the part JASIM
itself has not built is missing, which is a different fact and deserves a
different word.

Each message says what was understood and what is missing, e.g.
«فهمت أنك تطلب عرض بيانات. طبقة قراءة البيانات المصرّح بها غير مبنية بعد، ولن
أعرض أرقاماً غير حقيقية.»

`kind: "routed"` is its own output variant rather than a `text` reply carrying
an apology, because a caller must be able to tell *"JASIM answered"* from
*"JASIM understood and has nothing built to answer with"*. Collapsing those is
how an unbuilt feature starts looking like a working one.

## 6. The DataNeed boundary

`DIRECT_READ` carries:

```ts
{ kind: "AUTHORIZED_READ", subject: <the goal's own outcome text> }
```

Deliberately thin. It names no table, holds no SQL, and is not a query — it
exists so the read has somewhere real to point when the data layer is built. The
model never gets a database connection, and a boundary that carried one would
defeat the layer it is meant to make safe. Asserted: the decision contains no
`select`/`from`/`where`/`table`.

## 7. Observability

`modelMetadata` records `semanticRoute`, `semanticRouteReason` and
`semanticRouteDownstream` — the route and the rule that chose it, **never the
message that produced them**. Pinned by a test that routes an utterance
containing «السرية جدا» and asserts it appears in none of the three fields.

`LEGACY_FLAT` is recorded like any other route, so the fallback is measurable
rather than hidden, and its share is something that can be watched shrinking.

## 8. What is not yet true

- Four of the nine routes reach mechanisms that do not exist: the data layer,
  secure product surfaces, standing conditions, and world materialisation from a
  plan. They route correctly and say so. **That is the honest state, not a
  partial implementation** — none of them falls back to a DAG.
- `PERSISTENT_LIVING_OBJECT` is reachable only from a `persistent_smart_bubble`
  envelope today. A plan kind for it does not exist, because nothing downstream
  would distinguish it from `MONITORING` yet.
- No model has produced a route here. Every plan in every test is hand-written
  the way a model would propose one — `REAL_PROVIDER = BLOCKED_BY_ENVIRONMENT`.
