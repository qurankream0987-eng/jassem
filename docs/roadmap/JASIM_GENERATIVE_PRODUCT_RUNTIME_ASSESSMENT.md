# JASIM — GENERATIVE PRODUCT RUNTIME

**Assessed:** 2026-09-19 · **Against:** the ten workstreams in the owner's brief
**Method:** read the code, not the documentation. Every claim below cites a file.

The purpose of this document is to stop us building a second copy of something
that already exists — the standing rule — and to name the one absence that makes
the headline example impossible today.

---

## 0. The headline example, traced against reality

```
«جاسم أرني جدول مبيعاتي»
  → يفهم أن المطلوب عرض بيانات      ← exists (output router → presentation fabric)
  → يحدد مصدر بيانات المبيعات       ← DOES NOT EXIST
  → يجلب الحقيقة من Backend          ← DOES NOT EXIST
  → ينشئ TABLE Surface               ← exists (TABLE is primitive #12 of 34)
  → يعرض الجدول                      ← exists (web + mobile renderers)
  → تصل مبيعات جديدة                 ← no source to arrive from
  → الجدول يتحدث لحظيًا               ← server can push; the web client does not listen
  → «رتبها من الأعلى» → UPDATE       ← transition vocabulary exists; no dataset to sort
```

**Two of the eight steps are missing, and they are adjacent.** Everything before
and after them is built. This is the most useful fact in the assessment: the
product is not ten workstreams away from that sentence working — it is one layer
away, plus a socket.

---

## 1. What already exists (do not rebuild)

| Brief item | State | Evidence |
|---|---|---|
| **#1 Frontend generative renderer** | **EXISTS** | `src/components/jasim-core/PresentationRenderer.tsx` — a trusted registry of **34 primitives** including TEXT, TABLE, CHOICE, COMPARISON, MAP, TRACKER, FORM, APPROVAL, STATUS, TIMELINE. The model requests meaning; the registry draws it. The client cannot select a privileged primitive. |
| **ENTER → UPDATE → MORPH → EXIT** | **EXISTS** | `PresentationTransition` in `lib/jasim-runtime-contract`; `classifyWorkspacePresentationTransition` computes it — same primitive ⇒ `UPDATE`, different primitive ⇒ `MORPH`. Your `TABLE → MORPH → CHART` is already the intended mechanism. |
| **#8 Web + mobile parity** | **EXISTS (partial)** | `artifacts/jasim-mobile/lib/mobile-presentation.ts` mirrors the registry; `tests/unit/mobile-map-parity.test.ts` fails the build if the server can decide a primitive mobile cannot draw. |
| **#6 Living objects** | **EXISTS (projection only)** | `api/runtime/living-object-projection.ts`, `ActiveObjectsRail`. They render; they do not yet *change without a message*. |
| **Realtime transport (server half)** | **EXISTS** | `api/core/websocket.ts` — `JasimWebSocketServer`, `emitToUser`, private subscription targets. Wired in `api/boot.ts`. Used today by `block2/notifications.ts`. |
| **#3 Pipeline (both ends)** | **EXISTS** | Intent → references → capability → provider → policy → execution → observation → verification → canonical state → presentation all exist and are tested. |

## 2. What is genuinely missing

### 2.1 The data layer — **the blocking gap** (#4, #7)

There is **no generic owner-scoped dataset**. Concretely:

- `api/queries/` contains exactly two files: `connection.ts` and `users.ts`.
- No capability in the trusted registry reads owner business data. The seven are
  `local-analysis`, `local-calculation`, `notify`, `openai-chat`, `web-research`,
  `image-generation`, `research-context`.
- `TABLE` exists as a **presentation** primitive with nowhere to get rows.
- There is no `CHART` primitive at all (`grep -c CHART presentation-fabric.ts` → 0),
  so `TABLE → MORPH → CHART` cannot currently morph into anything.

This is why «أرني مبيعاتي» cannot be built today without fabricating rows — which
`NO MOCK SUCCESS` forbids. **No amount of frontend work fixes it**, because the
frontend would have nothing true to render.

The required shape is generic, and it is the same one for مبيعات / بضاعة /
موظفين / حجوزات:

```
Intent → DataNeed → AuthorizedQuery → CanonicalDataset → Presentation
```

with the LLM never holding a database connection and the surface never inventing
rows. One `Dataset` contract; four questions answered by it, not four dashboards.

### 2.2 Realtime — the client half (#2)

The server can push. **The web client never listens.** `grep` for `WebSocket` /
`EventSource` across `src/` finds only a dead adapter stub in
`src/core/jasim/cytoplasm.ts`. What the product actually does today is poll:
`useLiving.ts` uses `setInterval`, `useRunLifecycle.ts` uses `refetchInterval`.

So `RUNNING → PENDING → VERIFIED` reaches the screen on a timer, not on the
truth changing. Missing on top of the transport: reconnect, resume-from-cursor,
deduplication, and event ordering.

### 2.3 The new middle is not wired (#3)

`GoalSpec` and `PlanGraph` are built, validated and tested — and neither is
called from `createRuntimeConversationTurn`. The turn still uses the flat
proposal materialization. The pipeline is ~70% real with a hole where the
planning now lives.

### 2.4 Honest status vocabulary (#10)

Partial. The truthful terminal states exist in the runtime
(`BLOCKED_BY_PROVIDER`, `PENDING`, `INCONCLUSIVE`, `VERIFIED`). The *in-flight*
vocabulary the brief asks for — جاري الفهم / جاري البحث / بانتظار الموافقة /
ننتظر تأكيد المزود — is not modelled as states the surface reads. Today a long
turn shows «جاري معالجة البيانات...».

### 2.5 Mobile realtime behaviour (#9)

Not started. No resume-after-background, no push registration, no deep link to a
Living Object or Run.

---

## 3. Dependency order

These are not ten parallel tracks. Three of them gate the rest:

```
  Dataset / AuthorizedQuery  ──┐
        (2.1)                  │
                               ├──→  «أرني مبيعاتي» works truthfully
  Realtime client (2.2)  ──────┘         and updates by itself
        │
        └──→ Living objects that change without a message (#6)
        └──→ Honest in-flight status on screen (#10)
        └──→ Mobile resume / push (#9)

  Turn wiring (2.3) ───────────→ GoalSpec + PlanGraph become visible at all
```

`CHART` is a small addition **after** `Dataset` exists, not before — a chart with
no dataset is a picture.

---

## 4. What must not happen

- No `SalesDashboard`, `InventoryDashboard`, `JobsDashboard`. One `Dataset`
  contract, one `TABLE`, one `CHART`.
- No second renderer. The 34-primitive registry is the renderer.
- No second realtime transport. `JasimWebSocketServer` exists; the client
  connects to *it*.
- No SQL reaching the model, and no rows invented by a surface.
- No permanent tab per data kind.
- `DOMAIN_SPECIFIC_CORE_ADDED = 0` · `DOMAIN_AGENTS_ADDED = 0` ·
  `NEW_DOMAIN_BRANCHES = 0` · `PERMANENT_DOMAIN_TABS = 0`.

---

## 5. Recommendation

Start with **2.1, the Dataset / AuthorizedQuery layer**, because it is the only
item on the list that nothing else can proceed without and the only one whose
absence forces a lie. Then **2.2, the realtime client**, which turns every
existing projection live at once. Then **2.3**, the turn wiring, which is also
where the commerce-branch equivalence proof belongs.

Sequencing is the owner's call; this document records the evidence it should be
made on.
