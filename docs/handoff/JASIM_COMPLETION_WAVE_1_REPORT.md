# JASIM — COMPLETION WAVE 1: RUNTIME EXPERIENCE FOUNDATION

**Branch:** `claude/runtime-experience-wave-1` (descends from the accepted `3f3f4d1`)
**Mode:** implementation within the wave's explicit scope. Architecture freeze respected.
**Production source changed:** yes, within scope · **Database schema changed:** NO ·
**Migrations added:** NO · **Production touched:** NO · **Real model used:** NO · **Real money:** NO

> A copy of this report also exists at `.local/tasks/jasim-completion-wave-1-report.md` as
> instructed. `.local/` is gitignored, so this committed copy is the one that survives.

---

## 1. WHAT THIS WAVE ACTUALLY CHANGED

JASIM could model a live tracking surface it could never show. Every part existed and none
of them were joined:

- Block 2 has persisted observations against an opaque `(subjectKind, subjectId)` pair since
  it was built, and the `observations` table already carried `freshnessExpiresAt`.
- `decidePresentation` has always emitted `TRACKER`, with a child `MAP`, when handed
  `interactionNeed: "track"` and finite coordinates.
- Web's renderer has always had `MAP`, `MARKER` and `ROUTE`.

What was missing was the thing in between, and one renderer entry on Mobile. This wave built
the bridge, added the renderer, and fixed two defects that made local testing lie.

### 1.1 The generic bridge — `api/runtime/observation-presentation.ts` (new)

It reads a trusted owner-scoped observation, decides how much of it may honestly be
presented, and returns a `SemanticPresentationInput`. It renders nothing and selects no
primitive: `decidePresentation` remains the single selector.

**Domain neutrality is structural.** The subject is `{ kind, id }` and the kind is never
inspected — there is no branch anywhere in the module that could tell a driver from a kiln.
A test asserts identical behaviour across `driver`, `technician`, `vehicle`, `shipment`,
`robot` and `unknown_future`.

**The freshness rule is what makes it honest.** Block 2's own `freshnessOf` answers
FRESH/STALE from `freshnessExpiresAt`, which is correct for evidence — but a null horizon
there means *the provider never committed to one*, not that the reading is eternal. That is
how a three-hour-old position could have rendered as live. Presentation therefore applies a
stricter policy on top:

| Case | Presence | Coordinates emitted? |
|---|---|---|
| No observation | `UNAVAILABLE` | no |
| Declared horizon still open | `FRESH` | yes |
| Declared horizon passed | `STALE` | **no** |
| No horizon, within default max age (120s) | `FRESH` | yes |
| No horizon, beyond default max age | `STALE` | **no** |
| Timestamped in the future | `STALE` | **no** |

`UNAVAILABLE` is deliberately distinct from `STALE`: "never observed" and "observed a while
ago" are different truths, and collapsing them would hide which one a person is looking at.
A future timestamp is treated as stale because a clock that disagrees with ours is not
evidence of currency — trusting it would let a wrong or hostile source pin a subject as
permanently live.

**Coordinates are withheld, not flagged.** A stale observation still produces a truthful
tracking surface carrying its status, timestamp and source — it simply loses its
coordinates, so `decidePresentation` *cannot* build a `MAP` from it. The guarantee is
enforced by removing the data rather than by trusting a renderer to behave.

Coordinate extraction refuses to coerce: a string `"29.3"`, a null, a NaN, an Infinity, a
missing key or an out-of-range value all yield "no coordinates" rather than a fabricated
point.

### 1.2 Reachability — `runtime.subjectObservationPresentation`

Owner-scoped, and the scope is part of the SQL rather than a check afterwards. A caller can
ask *about* a subject but can never supply where it is: there is no parameter through which
a position could arrive, so a client-declared location is not an observation.

### 1.3 Mobile native map

`MAP`, `MARKER` and `ROUTE` now resolve to one semantic renderer, so the definition the
server decides renders on both platforms. Nothing interpolates a position, smooths between
points, guesses a route or computes an ETA. With no valid marker the surface says so in
words. Unsupported primitives still fail closed.

### 1.4 D1 — the session contract

Root-caused rather than patched. It is **not** JASIM code and **not** a Node version issue:

```
hono bodyLimit:  if body present AND no content-length
                 -> buffer it, then `new Request(c.req.raw, init)`
dev server:      @hono/vite-dev-server replaces the global fetch objects
                 -> that rebuild throws "Cannot read properties of undefined (reading 'window')"
```

Verified against a production-mode run **before** fixing: a bodyless POST returns **401 in
production** and returned **500 in development**. The route reads no body at all, so it is
exempted from the global limiter — which removes the divergence without raising the cap for
any route that accepts input.

The contract is now explicit rather than merely tolerant. An absent body and `{}` are the
same request; a body carrying fields is **rejected with 400**, because a client sending
fields here has misunderstood the contract and answering 200 would hide that until it
mattered. The active mobile client now sends `{}`.

### 1.5 D2 — truthful health

`/health` fell through to the SPA in development and answered `200` with HTML: a readiness
probe that could never report "not ready". The dev server's exclude pattern now routes it to
the same handler production uses.

**No second health system was created.** The existing `RuntimeReadiness` contract
(`ready: true | { ready: false, reason: "db_unreachable" | "schema_incompatible", missing[] }`)
is reused unchanged.

---

## 2. REAL LOCAL BEHAVIORAL ACCEPTANCE

The application was run locally against an isolated PostgreSQL. Observations were inserted
as canonical rows — the trusted path — never injected through a client.

| # | Check | Result |
|---|---|---|
| 1 | `/health` in **development** | `{"status":"ok",...}`, `content-type: application/json`, 200 |
| 2 | Bodyless `POST /api/runtime/session` (the old mobile shape) | **200** + token (was 500) |
| 3 | `{}` body (the new mobile contract) | **200** + token |
| 4 | Body with fields `{"ownerId":"99"}` | **400** with an explicit message |
| 5 | No observation | `UNAVAILABLE` -> `TRACKER`, **no MAP** |
| 6 | Fresh observation | `FRESH` -> `TRACKER` + **`MAP`**, marker `{lat:29.3759, lng:47.9774}`, `entityRef: generic_subject:probe-1` |
| 7 | Newer fresh observation | MAP **updates** to `{lat:29.4, lng:47.99}` |
| 8 | Declared horizon passed | `STALE` / `DECLARED_HORIZON_PASSED` -> **MAP gone** |
| 9 | 3 hours old, no horizon (the G3 hole) | `STALE` / `EXCEEDS_DEFAULT_MAX_AGE` -> **MAP gone** |
| 10 | Same subject, observation owned by another owner | `UNAVAILABLE` — **owner isolation holds** |
| 11 | Unauthenticated request | **401** |
| 12 | Conversation turn, no model provider | **412** `PRECONDITION_FAILED`, explicit message, no fabricated answer |
| 13 | `fabric.present` | still a pure function, no persistence |

Evidence level: `LOCAL_RUNTIME_EXECUTED`. Not `REAL_PROVIDER_EXECUTED` — no model, discovery,
PSP or notification provider is configured, and nothing was faked to pretend otherwise.

---

## 3. TESTS

| Suite | Result |
|---|---|
| `tsc -b` (full workspace) | **PASS**, 0 errors |
| Main suite | **789 / 789** (735 inherited + 54 new), 54 files |
| Block 2 | **101 / 101** |
| Block 3 | **133 / 133** |
| Block 3.1 | **65 / 65** |
| Web production build | **PASS** (9.26s) |
| Mobile TypeScript | 10 errors **before and after** — identical, all pre-existing (`TS6305` on an unbuilt `lib/api-client-react/dist`, plus implicit-any in `app/task/[id].tsx`). My files add zero. |
| Metro iOS / Android | `BLOCKED_BY_ENVIRONMENT` — no simulator or device here |

**61 new tests**: `observation-presentation.test.ts` (29), `mobile-map-parity.test.ts` (19),
`boot-contracts.test.ts` (13).

### 3.1 One inherited test was changed — disclosed, not buried

`smart-ui-task-8b1-mobile-renderer.test.ts` asserted `MOBILE_PRESENTATION_REGISTRY.MAP` is
`undefined`, under the heading *"fails closed for primitives without a native renderer"*.

That assertion encoded a fact that this wave changed. It was **corrected, not weakened**: MAP
moved into the supported list, and the fail-closed rule is still asserted — against
`WORKSPACE`, `EXTERNAL_ACTION` and `CHAT`, which genuinely have no renderer. The test's
intent survives intact; only its example changed. A further test asserts the unsupported set
is still non-empty, so the remaining gap cannot be quietly closed by a catch-all.

---

## 4. G2 — INTERACTION NEED REACHABILITY

`presentationForConversationEnvelope` produces 5 of the 12 modelled needs. The rest were
audited; only `track` was connected, and only through a dedicated owner-scoped procedure.

| Interaction need | Primitive | Classification | Why |
|---|---|---|---|
| `track` | TRACKER / MAP | **SAFE_TO_CONNECT_NOW** -> **done** | canonical observations exist and are owner-scoped |
| `collect_input` | FORM | `REQUIRES_RUNTIME_STATE` | needs a task's missing-field set; the envelope carries none |
| `show_state` | STATUS | `REQUIRES_RUNTIME_STATE` | needs a run reference in the envelope |
| `show_history` | TIMELINE | `REQUIRES_RUNTIME_STATE` | events exist; no reference reaches the envelope |
| `show_schedule` | CALENDAR | `REQUIRES_RUNTIME_STATE` | availability windows exist in Block 2, unreferenced from chat |
| `external_transition` | EXTERNAL_ACTION | `REQUIRES_PROVIDER` | no external provider configured; Mobile has no renderer either |
| `preview_artifact` | ARTIFACT_PREVIEW | `DEFER` | artifacts exist; Mobile cannot render it, so connecting it would create a parity gap |

**Privileged UI reachability was not increased because an enum value exists.** The remaining
seven stay unreachable, deliberately.

The honest limit: **a user still cannot reach a map by asking for one in conversation.** The
Output Envelope carries no subject reference, and adding one is a contract change larger than
this wave's scope.

---

## 5. G4 — STILL BLOCKED, WITH A CLASSIFICATION

**Zero enabled.** Classified from source:

| Action | Classification | Evidence |
|---|---|---|
| `CANCEL_OPERATION` | `MISSING_GENERIC_HANDLER` | `cancelRuntimeDagRun` **exists** in the runtime; no router procedure exposes it |
| `REQUEST_CHANGE` | `SAFE_FUTURE_IMPLEMENTATION` | both `applyBubbleMutation` **and** the `bubblesMutateApply` procedure exist; only the trusted route is unwired |
| `CREATE_PROPOSAL` | `MISSING_AUTHORITY_MODEL` | `createExecutionProposal` is internal; creating one from a UI action needs goal and authority semantics that do not exist |
| `SELECT_ENTITY` | `MISSING_GENERIC_HANDLER` | reference bindings exist; no canonical route records a selection |

---

## 6. G5 — DEFERRED

No model-call accounting subsystem was built. `ModelBudget.maxModelCalls` remains declared
and unenforced; its default of `1` means naive enforcement inside `generate()` would disable
provider fallback entirely. **Its enforcement point is a planner-side escalation loop that
does not yet exist**, and it belongs to the Production Model Gateway phase.

---

## 7. ARCHITECTURE FREEZE

`ARCHITECTURE_FREEZE_VIOLATIONS = 0`.

- No kernel, planner or workflow engine change.
- No second runtime, scheduler, health system or state machine.
- No schema change and no migration — `freshnessExpiresAt` already existed.
- `decidePresentation` untouched; the bridge feeds it, it decides.
- No domain agent, no `DriverMapPage`, no delivery-specific anything.
- Client authority unchanged: owner from the session, forbidden payload keys still scanned
  recursively, no client path to a canonical observation.

`DOMAIN_SPECIFIC_FILES_ADDED = 0`.

---

## 8. FINAL COUNTERS

```
WAVE_1                               = PASS

D1_SESSION_CONTRACT                  = PASS
D2_HEALTH_TRUTHFULNESS               = PASS
G1_OBSERVATION_PRESENTATION_WIRING   = PASS
G2_INTERACTION_REACHABILITY          = PARTIAL   (track connected; 7 classified and deferred)
G3_OBSERVATION_FRESHNESS             = PASS

MOBILE_GENERIC_MAP                   = PASS
MOBILE_TRACKER                       = PASS
WEB_MOBILE_MAP_SEMANTIC_PARITY       = PASS
MAP_ENTER_UPDATE_EXIT                = PASS

STALE_LOCATION_PRESENTED_AS_LIVE     = 0
CLIENT_CANONICAL_OBSERVATION_BYPASSES= 0
DOMAIN_SPECIFIC_FILES_ADDED          = 0
G4_ACTIONS_ENABLED                   = 0
G5_DEFERRED_TO_MODEL_GATEWAY         = YES

BLOCK_2                              = 101 / 101
BLOCK_3                              = 133 / 133
BLOCK_3_1                            = 65 / 65
MAIN_SUITE                           = 789 / 789
TYPESCRIPT                           = PASS
WEB_BUILD                            = PASS
MOBILE_BUILD_OR_METRO                = BLOCKED_BY_ENVIRONMENT

REAL_LOCAL_RUNTIME                   = PASS
REAL_MODEL_USED                      = NO
REAL_MONEY_USED                      = NO
PRODUCTION_DATABASE_TOUCHED          = NO
PRODUCTION_DEPLOYMENT                = NO

ARCHITECTURE_FREEZE_VIOLATIONS       = 0
BLOCKERS_REMAINING                   = 0
READY_FOR_PRODUCTION_MODEL_GATEWAY   = YES
```

---

## 9. WHAT A REVIEWER SHOULD LOOK AT HARDEST

Stated plainly, because a report that only lists successes is not a report:

1. **The 120-second default max age is a judgement, not a measurement.** It is right for a
   moving subject and possibly wrong for a slow one. It is a single named constant and is
   overridable per call, but nobody has tuned it against real data.
2. **The conversation still cannot reach a map.** G1 is wired and reachable, but through a
   dedicated procedure rather than from a sentence. Anyone reading "MAP works now" should
   read it as "the surface exists and is reachable", not "ask JASIM and you get a map".
3. **`MOBILE_TRACKER = PASS` is narrower than it looks.** `TRACKER` maps to the `timeline`
   renderer on Mobile, which is a legitimate device-specific choice, not a purpose-built
   tracker component.
4. **The environment is unstable.** PostgreSQL was killed twice mid-session, once producing
   241 false failures that all cleared on restart. Treat an abrupt mass failure as an
   environment check before a code check.
5. **Mobile has 10 pre-existing TypeScript errors** from an unbuilt `lib/api-client-react`
   workspace artifact. Unrelated to this wave, but it means `MOBILE_TYPESCRIPT` is not a
   clean gate today.

END OF WAVE 1 REPORT.
