# JASIM — REMAINING UNDERSTANDING CLOSURE

**Type:** read-only validation — Mobile, Authentication, Core Evolution Lab, active source map
**Method:** source tracing plus a **live local run** of the application. The 401 classification and
the truthful-failure behaviour below are runtime evidence, not inference.
**Product source changed:** NO · **Database schema changed:** NO · **Production touched:** NO

---

## 1. MOBILE ARCHITECTURE

### 1.1 Which mobile app is active

There are **two** mobile codebases in the repository. Only one is live.

| Path | Files | Verdict |
|---|---|---|
| `artifacts/jasim-mobile` | 33 | **ACTIVE.** pnpm workspace package `@workspace/jasim-mobile`; depends on `@workspace/jasim-runtime-contract` and `@workspace/jasim-bubble-contract`; contains the Smart UI renderer, morphing and living-object modules. |
| `canonical/جاسم/app/mobile` | 18 | **ARCHIVED.** Zero references from any config, script or source outside itself. Contains `MerchantScreen.tsx`, `useChat.ts` — the pre-generalization domain era. |

Anyone reading `canonical/جاسم/app/mobile` and concluding "JASIM mobile has merchant screens" would
be reading a fossil.

### 1.2 Structure (active app)

```
app/_layout.tsx            Expo Router root; SessionProvider wraps the tree
app/index.tsx              the conversation screen — 1,663 lines, the whole surface
app/task/[id].tsx          task detail route
app/+not-found.tsx

components/MobilePresentationRenderer.tsx   909 lines — the native renderer
components/MobileWorkspaceSurface.tsx       workspace projection surface
components/MobileLivingObjectsSurface.tsx   living objects surface
components/{SoapBubble,GlassWindow,BubbleField}.tsx   visual language

lib/runtime-trpc.ts        199 lines — the ONLY server transport
lib/session.tsx            197 lines — bearer session lifecycle
lib/mobile-presentation.ts  81 lines — the static renderer registry
lib/mobile-morphing.ts      56 lines — transition policy
lib/mobile-living-objects.ts
```

### 1.3 How Mobile retrieves state, and how a PresentationDefinition reaches it

One transport, one shape:

```
lib/runtime-trpc.ts
  endpoint(procedure) = https://${EXPO_PUBLIC_DOMAIN}/api/trpc/${procedure}
       │
       ├── runtime.workspaceProjection   → ActiveWorkspaceProjectionSchema.parse()
       ├── runtime.activeLivingObjects   → LivingObjectsProjectionSchema.parse()
       ├── runtime.turnsCreate / conversations*
       └── runtime.dispatchAction        → TrustedActionEnvelopeSchema.parse()
                                           → TrustedDispatchResultSchema.parse()
```

Every schema named there is imported from `@workspace/jasim-runtime-contract` — **the same module
the server imports**. The `PresentationDefinition` reaches Mobile inside
`ActiveWorkspaceProjection.currentPresentation`, already decided and already validated server-side,
and Mobile re-parses it against the shared schema before rendering. Mobile never builds a
presentation and never asks for one to be built.

### 1.4 Which primitives Mobile can actually render — proven, not inferred

`MOBILE_PRESENTATION_REGISTRY` (`lib/mobile-presentation.ts:30-61`) is a static
`Partial<Record<PresentationPrimitive, MobilePresentationRendererKind>>`. Eleven semantic renderer
kinds. **A primitive absent from this map cannot render**, and the renderer fails closed:

```tsx
const kind = MOBILE_PRESENTATION_REGISTRY[definition.primitive];
if (!kind) {
  return (<View testID="mobile-presentation-unsupported">
    <Text>هذا النوع غير مدعوم على الهاتف</Text>
    <Text>يمكن متابعة المحادثة دون تنفيذ إجراء غير معروف.</Text>
  </View>);
}
```

Note what the fallback does **not** do: it executes no action and offers none.

Against the fourteen primitives asked about:

| Primitive | Mobile | Renderer kind |
|---|---|---|
| TEXT | ✅ | `text` |
| SEARCH_RESULTS | ✅ | `collection` |
| COMPARISON | ✅ | `comparison` |
| FORM | ✅ | `form` |
| CHOICE | ✅ | `choice` |
| APPROVAL | ✅ | `approval` |
| STATUS | ✅ | `status` |
| TIMELINE | ✅ | `timeline` |
| TRACKER | ✅ | `timeline` |
| **MAP** | ❌ | **absent from the registry** |
| DOCUMENT | ✅ | `document` |
| WARNING | ✅ | `state` |
| ERROR_STATE | ✅ | `state` |
| EMPTY_STATE | ✅ | `state` |

Web's `TRUSTED_PRESENTATION_REGISTRY` covers all 40 primitives (only `WORKSPACE` maps to `null`).
Mobile covers 29. **Missing on Mobile:** `MAP`, `MARKER`, `ROUTE`, `TABLE`, `EXTERNAL_ACTION`,
`CHAT`, `METRIC`, `ARTIFACT_PREVIEW`, `MEDIA`, `SMART_BUBBLE`.

A small internal inconsistency worth recording: `resolveMobilePresentationPolicy` has explicit cases
for `MEDIA` and `ARTIFACT_PREVIEW` (returning `FULL_SCREEN_TEMPORARY`), but neither is in the
registry — so the registry lookup fails first and the policy branch is dead.

### 1.5 Consequential actions

```
Mobile UI (app/index.tsx)
   → builds a TrustedActionEnvelope
   → TrustedActionEnvelopeSchema.parse(input)         client-side pre-validation
   → POST /api/trpc/runtime.dispatchAction
   → server: dispatchCanonicalTrustedAction(ownerIdOf(ctx), input)
   → TrustedDispatchResultSchema.parse(result)        client-side result validation
```

Identical to Web. There is no mobile-only trusted path and no second endpoint.

### 1.6 Can Mobile inject privileged fields?

**No.** Not by client politeness but by server rejection: the six fields
(`ownerId`, `handler`, `providerUrl`, `paid`, `verified`, `policyOverride`) are in
`forbiddenPayloadKeys` and scanned **recursively** through nested objects and arrays before any
route runs. Mobile's `ownerId` is never transmitted at all — the server derives it from
`ownerIdOf(ctx)`.

### 1.7 Is Mobile ever a canonical state owner?

**NO.** Three independent proofs:

1. `lib/runtime-trpc.ts` performs no persistence of its own: it fetches, parses against shared
   schemas, and returns. There is no local database, no write-behind cache, no queue.
2. Every status, attention level, completion and approval state Mobile displays comes from a
   projection it re-parses.
3. The only local storage is the **session credential** — `SecureStore` on native, `AsyncStorage`
   on Expo Web — which is a credential, not business state.

### 1.8 Web/Mobile duplication audit

| Candidate | Classification |
|---|---|
| `lib/mobile-presentation.ts` registry vs Web `TRUSTED_PRESENTATION_REGISTRY` | `PRESENTATION_ONLY` — different renderer targets for the same primitives |
| `lib/mobile-morphing.ts` vs Web `useWorkspacePresentationTransition.ts` | `PRESENTATION_ONLY` — both delegate to the shared `classifyPresentationTransition` |
| `lib/mobile-living-objects.ts` vs Web `ActiveObjectsRail` | `VALID_PROJECTION_LOGIC` — display ordering/grouping over a server projection |
| `lib/session.tsx` (SecureStore/AsyncStorage) | `DEVICE_SPECIFIC` — no Web equivalent needed; Web uses a cookie |
| Bottom-sheet vs inline policy | `DEVICE_SPECIFIC` |
| Any pricing, status, completion or approval computation | **none found** |

```
DUPLICATE_BUSINESS_LOGIC   = 0
ACTIVE_AUTHORITY_CONFLICT  = 0
```

### 1.9 WebView Smart UI

**None.** No `react-native-webview` dependency, no `WebView` import anywhere in the active app. All
Smart UI is native.

### 1.10 Stable references and staleness on Mobile

References survive because Mobile never owns them: `ActiveWorkspaceProjection.resultSet.candidates`
carries `position`, and `.selectedEntityReferences` carries `referenceKey`/`targetKind`/`targetId`,
both re-read from `discovery_candidates` and `reference_bindings` on every projection.

Staleness is enforced on the **server**: Mobile sends `expectedPresentationVersion` in the envelope,
and the dispatcher answers `STALE` on mismatch for the eleven action types that require it. Mobile
cannot talk its way past a stale version because the decision is not taken on the device.

### 1.11 Could a generic MAP render natively without a delivery-specific screen?

Architecturally yes — the path is already generic: the server decides `MAP`, ships it inside the
projection, and the device resolves it through a static registry. Making it render is a **registry
entry plus one semantic renderer kind** (e.g. `MAP/MARKER/ROUTE → 'map'`), exactly as Web already
does. Nothing about it requires knowing that the subject is a driver.

But today the entry does not exist, so:

```
MOBILE_SEMANTIC_PARITY    = PARTIAL
MOBILE_CAN_RENDER_GENERIC_MAP = NO
```

Not implemented here, by instruction.

---

## 2. WEB / MOBILE SEMANTIC PARITY

Semantic concepts, not pixels:

| Semantic concept | Web | Mobile | Shared source | Parity |
|---|---|---|---|---|
| Goal / active goal | ✅ | ✅ | `ActiveWorkspaceProjection.activeGoal` | **FULL** |
| ResultSet (+ ordered candidates) | ✅ | ✅ | `.resultSet` ← `discovery_*` | **FULL** |
| ReferenceBindings | ✅ | ✅ | `.selectedEntityReferences` ← `reference_bindings` | **FULL** |
| Selected entities | ✅ | ✅ | same | **FULL** |
| PresentationDefinition | 40/40 | 29/40 | `PresentationDefinitionSchema` | **PARTIAL** |
| presentationVersion | ✅ | ✅ | `.presentationVersion` | **FULL** |
| Presentation transition | ✅ | ✅ | `classifyPresentationTransition` (shared) | **FULL** |
| Task | ✅ | ✅ | `runtime.tasks*` | **FULL** |
| Run | ✅ | ✅ | `.activeRun`, `runtime.runs*` | **FULL** |
| Living Object reference | ✅ | ✅ | `LivingObjectsProjectionSchema` | **FULL** |
| Approval state | ✅ | ✅ | `.approval` | **FULL** |
| Action intent | ✅ | ✅ | `TrustedActionEnvelopeSchema` | **FULL** |
| Completion status | ✅ | ✅ | `LivingObjectProjection.completion` | **FULL** |
| Attention | ✅ | ✅ | `.attention` | **FULL** |
| World reference | ✅ | ✅ | `.worldReference` | **FULL** |
| Layout / sheets / animation | — | — | — | **DEVICE_SPECIFIC** |

**One PARTIAL, and it is a renderer coverage gap, not a semantic divergence.** Mobile receives the
same `MAP` definition Web receives; it declines to render it and says so. Both platforms agree on
what is true; they disagree on what they can draw.

```
IS_WEB_A_CANONICAL_STATE_OWNER    = NO
IS_MOBILE_A_CANONICAL_STATE_OWNER = NO
```

---

## 3. AUTHENTICATION — AND THE "401 WALL", SETTLED BY RUNTIME

### 3.1 The system

```
Request headers
   → api/context.ts :: createContext()
        → api/kimi/auth.ts :: authenticateRequest(headers)
             1. Authorization: Bearer <jwt>   → verifySessionToken → findUserByUnionId → user
             2. else session cookie            → verifySessionToken → findUserByUnionId → user
             3. else throw
        → failure is CAUGHT and leaves ctx.user undefined
          ("development never gets an implicit principal")
   → api/trpc.ts :: requireAuth middleware
        if (!ctx.user) throw TRPCError UNAUTHORIZED
   → authedQuery = t.procedure.use(requireAuth)
   → ownerIdOf(ctx) = String(ctx.user!.id)
```

Every consequential procedure is `authedQuery`. Entry points: Kimi OAuth callback
(`Paths.oauthCallback`), `POST /api/runtime/session` (bearer, for Expo), and a
**development-only** `GET /api/auth/dev-login` that exists in `api/boot.ts` and is guarded by
`if (!env.isProduction)`.

Web uses the signed cookie; Mobile uses a bearer token stored in SecureStore (native) or
AsyncStorage (Expo Web), refreshed on 401 through `setRuntimeUnauthorizedHandler`.

Environment variable **names** only: `DATABASE_URL`, `SESSION_SECRET`, `APP_ID`, `APP_SECRET`,
`KIMI_AUTH_URL`, `KIMI_OPEN_URL`, optional `OWNER_UNION_ID`, and for Expo `EXPO_PUBLIC_DOMAIN`.

### 3.2 Live evidence

The application was started locally (`pnpm run dev`, port 5599, isolated local PostgreSQL) and
probed. Nothing was modified, no middleware weakened, no backdoor added — the dev-login route used
below is existing product behaviour, not something introduced for the test.

| # | Request | Result |
|---|---|---|
| A | `GET runtime.activeLivingObjects`, **no credential** | `401` · `code: -32001` · `"Authentication required"` · `UNAUTHORIZED` |
| B | same, **with the dev session cookie** | passes auth — fails later at `400 BAD_REQUEST` on my deliberately malformed input |
| C | `GET runtime.conversationsList`, cookie + valid input | **`200`** · `{"conversations":[]}` |
| D | `POST /api/runtime/session` then `GET runtime.conversationsList` with `Authorization: Bearer …` | **`200`** · `{"conversations":[]}` |

Probe B is the decisive one: the identical request that returned 401 returned a *different* error
once a credential was present. The middleware was never the obstacle — the absence of a session was.

### 3.3 Classification

```
AUTH_401_CLASSIFICATION = EXPECTED_SECURITY_BEHAVIOR
```

Both auth paths — cookie and bearer — were exercised end to end and both returned `200`. The
earlier Scope report's "401 wall … nothing downstream is testable until it is configured" describes
an unauthenticated probe, not a defect. There is no `SOURCE_GAP`. Had the report's framing been
accepted, an engineer could have "fixed" a working authentication system.

### 3.4 Two real defects found while probing (neither is the 401)

**D1 — `POST /api/runtime/session` with no request body returns `500`.**

```
TypeError: Cannot read properties of undefined (reading 'window')
  at new Request (node:internal/deps/undici/undici)
  at bodyLimit2 (hono/middleware/body-limit)
```

With `-d '{}'` the same endpoint returns `200` and a valid token. This matters because
`lib/session.tsx` sends **no body**:

```ts
await fetch(`https://${domain}/api/runtime/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
});   // ← no body
```

So the mobile session bootstrap hits the failing shape. **Honest caveat:** reproduced on
**Node 22.22.2**, while `.replit` pins **nodejs-24**. It may not reproduce on Node 24, and I did not
have Node 24 available to check. Classify as *reproduced locally, version-sensitivity unverified* —
not as a confirmed production defect.

**D2 — `/health` does not exist in dev.** `vite.config.ts` mounts the Hono app with
`exclude: [/^\/(?!api\/).*$/]`, so only `/api/*` reaches the server. `GET /health` returns the SPA
HTML with `200`. The readiness endpoint is production-only. A local smoke test that checks `/health`
would report a false green.

---

## 4. CORE EVOLUTION LAB

### 4.1 Status

```
CORE_EVOLUTION_LAB_STATUS = ISOLATED
```

It is a **separate process with its own boot** (`services/core-evolution-lab/boot.ts`, started by
`pnpm start:core-lab`), not mounted into the canonical server. Zero references from
`api/router.ts`, the registered routers, or `api/runtime/*`. The `api/routers/core-evolution.ts`
router exists but is **not registered** and is excluded in `tsconfig.server.json`.

It is not experimental scaffolding either: it has a real Docker runner, a durable job service over
the same queue Block 2 uses, an artifact resolver, an S3/filesystem artifact store, and a baked
evaluator image.

### 4.2 Purpose

Evaluate a proposed change to JASIM's own kernel **outside the running kernel**: take a candidate
source blob and an immutable baseline, run fixed gates inside a locked-down container, and produce
signed evidence. It is a laboratory, not a deployer.

### 4.3 Sandbox posture (`docker-runner.ts`)

```
--network none          --ipc none            --read-only
--cap-drop ALL          --security-opt no-new-privileges:true
--pids-limit N          --memory / --memory-swap (equal, so no swap)
--cpus N                --user <non-root>     --ulimit nproc
mounts: source.blob, baseline.json, request.json  → ALL readonly
```

Candidate code runs with **no network at all**. It cannot reach the database, a provider, or the
internet.

### 4.4 Gate integrity

The gate definition is **baked into the image** at `/opt/core-lab/policy.json` with `chmod 0444`,
and read from that path by `runner.mjs`. The candidate is mounted readonly elsewhere. A candidate
therefore **cannot** supply, replace or weaken its own gates. The gates are the repository's own
commands: `tsc -p tsconfig.generative-runtime.json`, `vitest run … tests/unit`,
`vitest run … tests/integration`.

### 4.5 Lifecycle — and where a human sits

```
submitted → evaluating → approved_for_build → built → signed → shadow → canary → active
       ↘ rejected / quarantined available from nearly every state; rolled_back from shadow/canary/active
```

`approveForBuild(candidateId, actor)` takes an **actor**. Promotion is a state transition over
database rows performed by an authenticated caller; nothing in the Lab promotes itself. A core patch
source must additionally be an **approved** `core_patch` DNA candidate whose **digest matches**, or
the transition throws `SOURCE_INVALID`.

### 4.6 The six capability questions

| | Capability | Answer | Evidence |
|---|---|---|---|
| A | Detect a generic capability gap | **YES** | `GapKind.MISSING_GENERIC_CAPABILITY` in `semantic-fabric.ts` |
| B | Propose a candidate improvement | **YES (structurally)** | DNA candidate + `corePatchCandidates` records exist |
| C | Write candidate code | **NOT AUTONOMOUSLY** | no generation path from a gap to a patch; candidates are submitted from outside |
| D | Execute candidate tests | **YES** | Docker runner + baked gate policy + evidence artifacts |
| E | **Modify the live Kernel automatically** | **NO** | no `writeFile` into live source, no `eval`, no dynamic `require`/`import` of candidate code in the live process; writes go only to the sandbox work dir |
| F | **Authorize its own production release** | **NO** | transitions require an `actor`; the Lab is not mounted in the serving process; `active` is a row state, not a deployment action |

```
LIVE_KERNEL_SELF_MODIFICATION        = NO
SELF_AUTHORIZED_PRODUCTION_RELEASE   = NO
```

**No critical architecture issue found. The required safety principles hold.**

Can the Lab weaken security gates, financial authority, verification semantics or frozen tests
without external authorization? **No** — gates are image-baked and read-only, the Lab process has no
access to Block 3 or the verifier, and candidate execution has no network.

**One honest observation, not a violation:** the full chain "production observation → evolution
candidate → isolated test → regression → security gate → canary → release" exists as *machinery and
recorded state*, but the **first link is manual**. Nothing converts a live `MISSING_GENERIC_CAPABILITY`
into a candidate. So the pipeline is real from "candidate submitted" onward, and conceptual before it.

---

## 5. ACTIVE SOURCE OWNERSHIP MAP

Import and runtime evidence only. **Memory notes and documentation carry no authority here.**

| Path | Classification | Evidence |
|---|---|---|
| `api/router.ts` | **ACTIVE_CANONICAL** | registers exactly `runtime`, `fabric`, `block2` |
| `api/routers/runtime.ts` | **ACTIVE_CANONICAL** | 38 procedures; the only consequential surface |
| `api/routers/fabric.ts` | **ACTIVE_CANONICAL** | registered |
| `api/routers/block2.ts` | **ACTIVE_CANONICAL** | registered |
| `api/runtime/jasim-runtime.ts` | **ACTIVE_CANONICAL** | the authority; 8,273 lines |
| `api/runtime/semantic-fabric.ts` | **ACTIVE_CANONICAL** (pure) | `composeRequirementGraph`, `GapKind` |
| `api/runtime/economic-fabric.ts` | **ACTIVE_CANONICAL** (stateful) | writes expressions → transaction intents |
| `api/runtime/presentation-fabric.ts` | **ACTIVE_PROJECTION** (pure) | zero DB writes |
| `api/runtime/capability-provider.ts` | **ACTIVE_CANONICAL** | `resolveProvider` binding authority |
| `api/runtime/trusted-action-dispatcher.ts` | **ACTIVE_CANONICAL** (gate) | `runtime.dispatchAction` |
| `api/runtime/block2/**` | **ACTIVE_CANONICAL** | worker started in `boot.ts` |
| `api/runtime/block3/**` | **ACTIVE_CANONICAL** | money truth; PSP blocked by decision |
| `api/runtime/block31/**` | **ACTIVE_CANONICAL** | discovery, reference bindings, observations |
| `api/runtime/active-workspace-projection.ts` | **ACTIVE_PROJECTION** | zero writes |
| `api/runtime/living-object-projection.ts` | **ACTIVE_PROJECTION** | zero writes |
| `api/core/durable-job-queue.ts` | **ACTIVE_INFRASTRUCTURE** | imported by `block2/worker.ts` |
| `api/core/durable-job-worker.ts` | **ACTIVE_INFRASTRUCTURE** | imported by `block2/worker.ts` |
| `api/core/drizzle-durable-job-repository.ts` | **ACTIVE_INFRASTRUCTURE** | imported by `block2/worker.ts` |
| `api/core/immutable-artifact-store.ts` | **ACTIVE_INFRASTRUCTURE** | `block2/worker.ts`, lab boot |
| `api/core/websocket.ts` | **ACTIVE_INFRASTRUCTURE** | `block2/notifications.ts`, `boot.ts` |
| `api/core/generated-world-service.ts` + `-repository.ts` | **ACTIVE_ADAPTER** | imported by `jasim-runtime.ts` |
| `api/core/tool-adapters/search-adapter.ts` | **ACTIVE_ADAPTER** | `phase11-providers.ts` |
| `api/core/task-runtime.ts` | **DEAD** | 0 live refs — a complete second DAG + agent loop |
| `api/core/planner.ts`, `agent-runtime`, `agent-router`, `intent-parser`, `intent-engine`, `swarm-orchestrator`, `lam-orchestrator`, `commerce-runtime` | **DEAD** | 0 live refs each |
| `api/core/*` (remainder) | **UNKNOWN** | not individually traced; classify before touching |
| `api/routers/{jasim,conversation,task,bubble,worlds,…}` | **LEGACY_BUT_REFERENCED** | files exist, excluded in `tsconfig.server.json`, unregistered |
| `api/connectors/**` | **REFERENCE_ONLY** | preserved dormant; excluded from the server build |
| `services/core-evolution-lab/**` | **ISOLATED** (separate process) | own boot; not mounted |
| `canonical/جاسم/app/src/**` (Web) | **ACTIVE_PROJECTION** | consumes projections; no business writes |
| `artifacts/jasim-mobile/**` | **ACTIVE_PROJECTION** | the live mobile app |
| `canonical/جاسم/app/mobile/**` | **ARCHIVED** | 0 external refs; domain-era screens |
| `artifacts/jasim` (76 files) | **ARCHIVED** | superseded web artifact; workspace member only |
| `artifacts/api-server` | **DEAD** (deliberately) | runtime file neutralized to `export {}` |
| `artifacts/mockup-sandbox` (69) | **REFERENCE_ONLY** | |
| `lib/jasim-runtime-contract`, `lib/jasim-bubble-contract` | **ACTIVE_CANONICAL** (shared contract) | imported by server, Web and Mobile |
| `lib/{api-spec,api-zod,api-client-react,db}` | **PARTIAL** | `api-client-react` used by Mobile; the OpenAPI/Zod chain served the retired Express runtime |
| `canonical/جاسم/versions/**` (1,527) | **ARCHIVED** | five pre-runtime snapshots; 41 domain files deliberately removed since |
| `reference/jasim-source/**` (224) | **REFERENCE_ONLY** | preserved original import |
| `.agents/memory/**` (41) | **REFERENCE_ONLY** | **several entries are stale — see §7** |

**The correction that matters most:** `api/core` is **mixed**, not dead. Six modules in it are live
infrastructure for the registered path. Acting on the inherited "api/core is LEGACY/DEAD" note would
delete the durable job queue Block 2 runs on.

---

## 6. G1–G5 DEPENDENCY MATRIX

| Gap | Severity | Blocks local runtime? | Blocks Model Gateway? | Blocks real Discovery? | Blocks driver/MAP? | Blocks production? | Suggested phase |
|---|---|---|---|---|---|---|---|
| **G1** MAP wiring (observation → `track`) | **HIGH** for the operational vision | NO | NO | NO | **YES** | NO | After the model gateway is live; pairs with G3 |
| **G2** unreachable interaction needs | MEDIUM | NO | NO | NO | YES (same root) | NO | Same phase as G1 — one envelope-mapping change covers both |
| **G3** observation freshness policy | MEDIUM (truthfulness) | NO | NO | NO | **YES, jointly** — a map without it can show a stale point as live | NO | Must ship **with** G1, never after |
| **G4** four blocked Trusted Actions | LOW–MEDIUM (honesty) | NO | NO | NO | NO | NO | Either implement the routes or stop advertising the action types |
| **G5** `maxModelCalls` unenforced | MEDIUM (cost safety) | NO | **NO** (gateway works) but blocks *bounded* autonomy | NO | NO | **YES for Level 6/7** | With the planner escalation loop, which does not exist yet |

Candidate additions from this pass (recorded, not fixed):

| | Gap | Severity |
|---|---|---|
| **G6** Mobile renderer lacks `MAP`/`MARKER`/`ROUTE` (+ 7 other primitives) | MEDIUM — Web/Mobile parity |
| **G7** `POST /api/runtime/session` 500s on a bodyless POST, which is exactly what Mobile sends | HIGH **if** it reproduces on Node 24 — unverified |
| **G8** `/health` unreachable in dev; readiness is production-only | LOW — but it makes local smoke tests lie |
| **G9** No path from a detected `MISSING_GENERIC_CAPABILITY` to an evolution candidate | LOW — the Lab's first link is manual |

```
KNOWN_GENERIC_GAPS = 5 confirmed (G1–G5) + 4 newly recorded (G6–G9) = 9
```

---

## 7. 00A — IMPLEMENTATION vs VISION

**Conflicts** (document asserts something the code contradicts):

| # | Document statement | Actual code | Severity | Correction |
|---|---|---|---|---|
| 1 | §6 lists nine output types ending in `PERSISTENT_WORLD` | Eight literals: `text`, `structured_result`, `ephemeral_bubble`, `interactive_bubble`, `direct_action`, `workflow`, `durable_run`, `persistent_smart_bubble`. A World is optional durable backing, not an output kind | **SEMANTIC** | Write `PERSISTENT_SMART_BUBBLE (+ optional durable World)` |
| 2 | §10 implies one action-intent vocabulary | `presentation-fabric.ts:64` types `intent: string`; the shared contract and both Zod schemas enforce the 13-value enum. Runtime is safe; the TS type is looser than the contract | **WORDING** | Note the enum is the contract; align the server type |
| 3 | §10 presentation list | Correct but partial — 40 primitives exist | **WORDING** | Say "including" |
| 4 | §2/§23 "do not become `DeliveryAgent`" etc. | Agreed and verified — but the doc does not say `MAP` is currently unreachable | **SEMANTIC** | Add a status line: modelled, not wired |
| 5 | §12 Living Object examples | Matches `semanticType: process \| world \| bubble` | — | none |
| 6 | §25 "Mobile file count is not the KPI" | Correct, and now proven: Mobile is a projection regardless of size | — | none |
| 7 | §26 truthful failure states | **Under-states the code.** `GapKind` has nine values including `REQUIRES_HUMAN`, `REQUIRES_OWNER_DECISION`, `REQUIRES_REGULATORY_REVIEW`, `BLOCKED_BY_RESOURCE`, `INSUFFICIENT_TRUST`, `BINDING_VALIDATION_FAILED` | **WORDING** | List all nine — §16/§17 scenarios depend on them |
| 8 | §9 humans as providers | **Implemented**: `ProviderKind` includes `HUMAN` and `COMPUTER_USE` | — | promote from aspiration to fact |

```
00A_CONFLICTS_FOUND = 8   (1 semantic on output kinds, 1 semantic on MAP status, 6 wording)
```

**Vision-only — intentionally ahead of the code, and must stay marked as such:**

| # | Vision item | Reality |
|---|---|---|
| 1 | §14 Level 7 economic opportunity | **No `opportunity` table or type.** An opportunity is a reading of an `economic_match`, never persisted. The weakest link for Level 7 |
| 2 | §13 Level 6 bounded autonomy | Mandates and policy exist; the goal→plan→act→observe→verify→repair loop has no autonomous driver |
| 3 | §15 "from intent to reality" | Blocked at the last mile: no model provider, no external discovery provider, no PSP, no notification channel |
| 4 | §18 the driver/map lifecycle | Expressible in representation, unreachable in wiring (G1) |
| 5 | §19 Carrefour + driver | The human-provider primitive exists; no route composes an errand onto an existing assignment |
| 6 | §22 Level 7 truck/shipment matching | `matchNeedToOffering` is real; opportunity surfacing and proposal generation are not |

```
VISION_ONLY_ITEMS_FOUND = 6
```

Nothing above changes the vision to match the code. The two columns stay separate on purpose.

---

## 8. SAFE LOCAL RUNTIME PREREQUISITES

Verified by actually doing it in this session.

**Services:** PostgreSQL 16 (isolated/local — never production). Docker only if the Core Evolution
Lab is exercised.

**Database:** `pnpm run db:push` applies the schema. Block suites create and drop their **own**
databases (`jasim_block2_test`, `jasim_block3_test`, `jasim_block31_test`) from
`db/migrations-pg`.

**Environment variable names only:** `DATABASE_URL`, `SESSION_SECRET`, `APP_ID`, `APP_SECRET`,
`KIMI_AUTH_URL`, `KIMI_OPEN_URL`; optional `OWNER_UNION_ID`, `PORT`, `JASIM_BLOCK2_WORKER`,
`JASIM_EXTERNAL_PROVIDERS`. For a model provider: `JASIM_MODEL_PROVIDER` plus that provider's key
variable, optional `JASIM_MODEL_T1/T2/T3`, `JASIM_MODEL_{tier}_FALLBACKS`, and `JASIM_MODEL_PRICES`
for cost metering. Mobile: `EXPO_PUBLIC_DOMAIN`.

**Commands (from `package.json`, not invented):**

```
pnpm install --frozen-lockfile
pnpm run db:push
pnpm run dev            # vite + Hono via @hono/vite-dev-server, honours PORT
pnpm run check          # tsc -b
pnpm run test           # ⚠ races the block suites — see below
pnpm run test:jasim-block-2 / -3 / -3-1   # run these SERIALLY
pnpm run start          # NODE_ENV=production tsx api/boot.ts
```

**Ports/URLs:** one port serves both (`PORT`, default 3000; 5599 used here). Web `http://localhost:$PORT/`,
API `http://localhost:$PORT/api/trpc/<procedure>`. **`/health` exists only in production mode** (D2).

**Authentication for local testing:** `GET /api/auth/dev-login` issues a cookie session for
`dev:local` (development only, existing product code). `POST /api/runtime/session` issues a bearer
token — **send `{}` as the body** (D1).

**Is a model provider required to open the application?** **No.** The Web app loads, conversations
list, workspace and living-object projections, and every trusted action against existing state all
work without one.

| Works without a model | Requires a model — truthfully refused today |
|---|---|
| Web/Mobile boot, auth (both paths) | `runtime.turnsCreate` — conversation turns |
| `conversationsList/Create/Get/Archive` | Output routing and envelope validation |
| `workspaceProjection`, `activeLivingObjects` | Bubble mutation generate/preview |
| `dispatchAction` over existing state | World/DNA generation |
| Runs, proposals, approvals, receipts, reconciliation | Conversation summaries |
| Block 2 coordination; Block 3 economics (PSP blocked) | |

**Proven live:** a conversation turn with no provider configured returns
`412 PRECONDITION_FAILED` — *"No model service is configured. Configure JASIM_MODEL_PROVIDER with
its provider API key before creating a task."* No fabricated answer. The truthfulness invariant
holds at runtime, not only in tests.

**Known trap:** `pnpm test` globs `tests/**`, pulling the block suites into one parallel run where
each drops and recreates a shared proof database. This produced ~35 false failures earlier in this
session; run serially under the dedicated configs instead. Separately, PostgreSQL died mid-run once
(`Removed stale pid file`) and produced 241 false failures that all cleared on restart — treat an
abrupt mass failure as an environment check before a code check.

```
READY_FOR_REAL_LOCAL_BEHAVIORAL_BASELINE = YES
```

---

## 9. REMAINING UNKNOWNS

Stated so nobody mistakes silence for coverage:

1. **Node 24 behaviour.** Everything here ran on Node 22.22.2; `.replit` pins nodejs-24. D1 in
   particular may be version-specific.
2. **`app/index.tsx` (1,663 lines)** was read for transport, registry and dispatch, not line by line.
3. **`api/core` remainder** — six modules proven live, nine proven dead, the rest untraced.
4. **Expo build/device** — no Metro build, no simulator, no device run. `METRO_IOS`/`METRO_ANDROID`
   remain unverified here.
5. **Real model, provider, PSP or notification behaviour** — unobservable without credentials.
6. **Multi-user behaviour** — memberships and delegation grants were read, never exercised with two
   real principals.
7. **Web renderer depth** — the registry was verified; the 40 individual components were not.
8. **Core Evolution Lab end to end** — Docker was not run; the posture is read from flags.

---

## 10. FINAL COUNTERS

```
MOBILE_READ_COMPLETE                      = YES
MOBILE_SEMANTIC_PARITY_UNDERSTOOD         = YES
MOBILE_CANONICAL_AUTHORITY                = NO
MOBILE_SEMANTIC_PARITY                    = PARTIAL
MOBILE_CAN_RENDER_GENERIC_MAP             = NO

AUTH_SYSTEM_UNDERSTOOD                    = YES
AUTH_401_CLASSIFICATION                   = EXPECTED_SECURITY_BEHAVIOR

CORE_EVOLUTION_LAB_READ_COMPLETE          = YES
CORE_EVOLUTION_LAB_STATUS                 = ISOLATED
LIVE_KERNEL_SELF_MODIFICATION             = NO
SELF_AUTHORIZED_PRODUCTION_RELEASE        = NO

ACTIVE_SOURCE_MAP_COMPLETE                = YES
00A_CONFLICTS_FOUND                       = 8
VISION_ONLY_ITEMS_FOUND                   = 6
KNOWN_GENERIC_GAPS                        = 9   (G1–G5 confirmed, G6–G9 newly recorded)

IS_WEB_A_CANONICAL_STATE_OWNER            = NO
IS_MOBILE_A_CANONICAL_STATE_OWNER         = NO

PRODUCT_SOURCE_CHANGED                    = NO
DATABASE_SCHEMA_CHANGED                   = NO
PRODUCTION_TOUCHED                        = NO

READY_FOR_REAL_LOCAL_BEHAVIORAL_BASELINE  = YES
UNDERSTANDING_CLOSURE                     = PASS
```

END OF CLOSURE REPORT.
