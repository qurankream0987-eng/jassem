# JASIM — PERSISTENT WORLD MATERIALIZATION · phase report

```
ROUTED != MATERIALIZED != CONFIGURED != EXTERNALLY_CONNECTED
IDEA != WORLD · GOAL != WORLD · UI != WORLD
```

---

## 1. §1 · The trace, and what the gap actually was

A World already existed at `9d5ac61`: `generated_systems` and `system_versions`,
`WorldDNASchema`, `GeneratedWorldService` with a structural diff, a semver bump
derived from it, a semantic digest, request-key reconciliation and a rollback
that creates a new version rather than erasing one. `worldsRouter` served it.
`WORLD_SUMMARY` was already a presentation primitive both apps mapped.

So `PERSISTENT_WORLD_MATERIALIZATION` was never "there is no world". It was four
things at once, and separating them is most of this phase:

1. **A conversation could not reach any of it.** The turn returned
   `MECHANISM_NOT_IMPLEMENTED`; the machinery was reachable only from the legacy
   router and the Block 3 commerce orchestrator.
2. **No precondition.** `persistApproved` never compared against a version the
   caller had read, so a stale writer won by arriving second.
3. **No atomicity.** `createVersion` → `activateVersion` → `updateSystem` were
   three statements, and between them a world had a version nothing pointed at.
4. **No scope.** `ownerId` is a `bigint`; an organization could not own a world.

Nothing was duplicated. One column was added and no table.

```
PARALLEL_WORLD_SYSTEMS_ADDED = 0
```

## 2. What was built

| file | lines | what |
|---|---:|---|
| `api/runtime/world-runtime.ts` | 1257 | the conversational boundary: vocabulary, validation, change sets, scope, policy, authority, events, projection |
| `db/migrations-pg/0019_world_scope.sql` | 23 | `generated_systems.scopeId`, backfilled, unique on (`scopeId`,`worldKey`) |

Extended rather than replaced: `contracts/generated-world.ts` (`scopeId`,
`expectedVersion`, `WorldVersionConflictError`), `generated-world-repository.ts`
(scoped reads and a transactional `commitVersion` with a compare-and-set),
`generated-world-service.ts` (threads both through; exposes its diff),
`authority-acts.ts` (`world.evolve`), `jasim-runtime.ts` (one envelope field and
one branch), `semantic-router.ts` (the route left `NOT_IMPLEMENTED`),
`api/routers/runtime.ts` (four read procedures),
`artifacts/jasim-mobile/lib/runtime-trpc.ts` (the same four, by name),
`model-output-trust.ts` (the world authority keys), `db/schema.ts`.

## 3. The decisions that carry the phase

**The commit became one transaction and one compare-and-set.**

```sql
UPDATE generated_systems SET version = $new, schema = $world, status = 'active'
 WHERE id = $id AND version = $expectedVersion     -- 0 rows ⇒ CONFLICT
```

Postgres decides the race. `expectedVersion` is optional, so every inherited
caller behaves as it did — and is now atomic as well.

**Atomicity is structural rather than defended.** A change set is applied to a
COPY; if #4 of 5 is invalid it throws and the first three exist only in a value
about to be garbage. There is no partially written world because there was never
a partial write.

**The runtime decides what a change IS.** Seven general classes, derived from
the target. A change that calls itself DATA while touching a policy is refused —
otherwise it would take a DATA change's permission.

**Each class maps onto a permission that already existed.** `mutate`,
`manage_policies`, `manage_members`, `act_financially`. POLICY, PERMISSION and
COMMERCIAL additionally need `world.evolve`, an authority act read and cited.

```
SECOND_PERMISSION_SYSTEMS_ADDED = 0
```

**A definition may not bind its own capabilities.** `capabilities` is always
`[]`. A binding is the right to act.

**The precondition is the runtime's.** The turn reads the current version and
passes that; a model naming a version would be naming the precondition it has
to satisfy.

**Nothing is reported until it is read back** from the database, after the
commit, at the version just written.

## 4. Proof

| file | tests |
|---|---:|
| `tests/block31/persistent-world.test.ts` | 26 |
| `tests/unit/world-contract.test.ts` | 35 |
| `tests/unit/generality-catalog.test.ts` (new assertions) | 6 |

Everything in the live file runs against real PostgreSQL with the real
migrations, and "persisted" always means read back through a fresh query after
the turn that wrote it returned.

| | |
|---|---|
| materialization | «أنشئ نظاماً دائماً» → one world, version 1.0.0, one `WORLD_MATERIALIZED` event, and rows verified by direct SQL |
| persistence | re-read with nothing shared with the turn — no response metadata, no run, no component state |
| versioning | a change set makes 1.1.0; the superseded version is still readable and says what it said |
| history | restoring an earlier shape creates a THIRD version; nothing is erased |
| atomicity | 5 changes, #4 invalid → the version is unchanged and `system_versions` still has one row |
| concurrency | two writers on v1: the second gets `CONFLICT` naming what to rebase onto, and the winner's entity survives while the loser's never appears |
| replay | the same request key → `unchanged`; the same decision under a different key → caught by the digest; both leave two versions |
| scope | another owner reads `undefined` and mutating says *no such world in this scope*; an organization owns one through `scopeId` and the person's own scope cannot see it; an outsider with no membership is refused |
| policy | a scope rule denying `world.structural` stops the change, and the version does not move |
| authority | a POLICY change is `NEEDS_AUTHORITY` in a conversation; through `requestAuthorityAct` the statement says POLICY whatever the change called itself, asking performs nothing, and citing the digest applies it |
| false success | routed with no definition → `NEEDS_INPUT` and zero rows; a dangling relation → `DENIED` and zero rows; `<script>` in a definition → `DENIED` and zero rows; a world naming providers binds none |
| reference | «أضف له» finds the world this conversation made, through the canonical attachment and not an ordinal |
| ledger | ordered, scoped, resumable from a cursor, and carrying no definition body |
| holdouts | six unrelated operational contexts materialize AND mutate through one runtime |
| not the default | «عندي فكرة أن الناس يؤجرون ساعات معداتهم الفارغة» creates nothing |

**The six holdouts:** a laboratory instrument pool, a community lending
cooperative, a temporary event operation, shared agricultural capacity,
industrial maintenance coordination, and a falconry stand rota that is not a
business at all and appears nowhere in the implementation.

```
WORLD_HOLDOUT_REQUIRING_DOMAIN_BRANCH = 0
```

## 5. Catalog effect

`PERSISTENT_WORLD_MATERIALIZATION` is **closed** — the seventh gap in seven
phases. It was one name covering three different missing things, and the other
two are now named rather than absorbed.

| gate | before | after |
|---|---:|---:|
| PLANNABLE | 147 | **154** |
| EXECUTABLE | 92 | **99** |
| OBSERVABLE | 80 | **87** |
| VERIFIABLE | 74 | **81** |
| PRESENTABLE | 160 | **161** |
| PERSISTENT | 137 | **144** |
| waiting on a general capability | 33 | **26** |
| distinct general gaps | 11 | **12** |

**Nine scenarios moved; seven of them to a full PASS.**

| scenario | after | why |
|---|---|---|
| `route.persistent_world` | **PASS** | the turn materializes, and still creates no run and no DAG |
| `world.business_world` · `warehouse_world` · `operational_world` | **PASS** | one runtime, one registry, one commit; six unfamiliar contexts prove it |
| `world.data_mutation` | **PASS** | all-or-nothing change sets with a version precondition |
| `world.policy_mutation` | **PASS** | runs as an authority act, read and cited — not as a sentence |
| `business.world_association` | **PASS** | an organization owns a durable system through the same `scopeId` everything else uses |
| `world.permission_mutation` | **NOT_YET_IMPLEMENTED** | scope-wide read-only runs today as `membership.grant`; a grant on ONE world has no mechanism — `RESOURCE_SCOPED_PERMISSION_GRANT` |
| `jasimos.branding` | **NOT_YET_IMPLEMENTED** | a world carries a theme and a scope has a name; no surface reads either — `SCOPE_BRANDING_SURFACE` |

**162 scenarios · 16 blind holdouts · 7 blind ideas · 12 general gaps.**

## 6. Regression

| suite | result | before | Δ |
|---|---|---|---|
| **Main** | 2208 passed, 27 skipped · 95 files | 2167, 27 · 94 | +41, +1 file |
| **Block 2** | 121 · 16 files | 121 · 16 | 0 |
| **Block 3** | 133 · 17 files | 133 · 17 | 0 |
| **Block 3.1** | 542 · 34 files | 516 · 33 | +26, +1 file |
| **Frozen evaluation** | 90 · 5 files | 90 · 5 | 0 — untouched |
| TypeScript (`tsc -b`) · Web build · Mobile typecheck · Expo export | all clean | | |

**No inherited test was removed or weakened.** Three changed, each a
refinement with a companion assertion, and each recorded here:

- `semantic-router.test.ts` — `PERSISTENT_WORLD` moved out of the
  NOT_IMPLEMENTED list into its own AVAILABLE case, exactly as `DIRECT_READ`
  did when the data layer landed, **and** gained an assertion that it still
  routes away from execution.
- `policy-contract.test.ts` — the enforcement-boundary caller list gained the
  world runtime, **and** gained an assertion that it calls `evaluatePolicies`
  exactly once, with no branch per class.
- `authority-administration.test.ts` — "all seven acts" became "every act": the
  list gained `world.evolve`, and the test now asserts the headline, readback
  and reversibility invariants **for every entry** rather than for seven names.

No flaky test appeared. Each suite was run alone, per the standing rule in
`JASIM_TEST_SUITE_CONTINUITY.md`.

## 7. The final report

```
PHASE = PERSISTENT_WORLD_MATERIALIZATION

CURRENT_WORLD_GAP_PROVEN      = PASS
WORLD_CANONICAL_MODEL         = PASS
WORLD_DEFINITION_VALIDATION   = PASS
WORLD_MATERIALIZATION         = PASS
WORLD_PERSISTENCE             = PASS
WORLD_VERSIONING              = PASS
WORLD_CHANGESET               = PASS
WORLD_MUTATION_ATOMICITY      = PASS
WORLD_CONCURRENCY             = PASS
WORLD_REPLAY_SAFETY           = PASS
WORLD_REFERENCE_RESOLUTION    = PASS
WORLD_POLICY_AUTHORITY        = PASS
WORLD_OWNER_SCOPE             = PASS
WORLD_BUSINESS_SCOPE          = PASS
WORLD_EVENT_LEDGER            = PASS
WORLD_PRESENTATION            = PARTIAL
WEB_ACTIVE_CONVERSATION       = PASS
MOBILE_ACTIVE_CONVERSATION    = PARTIAL
WORLD_PROVIDER_TRUTH          = PASS
OPEN_MARKET_COMPATIBILITY     = PASS
IDEA_INTAKE_COMPATIBILITY     = PASS
HOLDOUT_GENERALITY            = PASS

DOMAIN_WORLD_TYPES_ADDED              = 0
DOMAIN_WORLD_RENDERERS_ADDED          = 0
WORLD_MARKETPLACE_CORES_ADDED         = 0
WORLD_HOLDOUT_REQUIRING_DOMAIN_BRANCH = 0
NEW_DOMAIN_BRANCHES                   = 0
PARALLEL_WORLD_SYSTEMS_ADDED          = 0
SECOND_PERMISSION_SYSTEMS_ADDED       = 0
NEW_WORLD_TABLES_ADDED                = 0
REALTIME_TRANSPORT_BUILT              = NO

FALSE_WORLD_SUCCESS = 0
FALSE_PERSISTENCE   = 0

WORLD_SCENARIOS_UNLOCKED  = 7
WORLD_SCENARIOS_REMAINING = 2  (RESOURCE_SCOPED_PERMISSION_GRANT,
                                SCOPE_BRANDING_SURFACE)

TOTAL_GENERALITY_SCENARIOS = 162
EXECUTABLE_PASS_AFTER      = 99
PERSISTENT_PASS_AFTER      = 144

MAIN              = 2208/27 · 95 files
BLOCK2            = 121 · 16 files
BLOCK3            = 133 · 17 files
BLOCK3_1          = 542 · 34 files
FROZEN_EVALUATION = 90 · 5 files

TYPECHECK        = PASS
WEB_BUILD        = PASS
MOBILE_TYPECHECK = PASS
EXPO_EXPORT      = PASS

INHERITED_TESTS_WEAKENED = 0
INHERITED_TESTS_REFINED  = 3

NEXT_GENERIC_GAP = MONITORING_ENGINE

OWNER_ACTION_REQUIRED = NONE
```

### Why two of those read PARTIAL

**`WORLD_PRESENTATION = PARTIAL`.** A materialized world projects to counts,
names and an explicit "nothing is connected", rendered through the
`WORLD_SUMMARY` primitive both apps already had. That is the minimum §20 asks
for and all canonical truth supports today — there are no entity ROWS inside a
world yet, so there is nothing richer to show without inventing it.

**`MOBILE_ACTIVE_CONVERSATION = PARTIAL`.** Mobile calls the same four
`runtime.world*` procedures by name and maps `WORLD_SUMMARY` through its own
generic renderer, and a unit test holds both surfaces to the same procedure
names with no world runtime on either side. What is NOT proven here is a
device-level round trip — no emulator ran in this phase — so the claim stops at
the wire rather than at the screen.

### Where the weight sits now

`MONITORING_ENGINE` holds 7 scenarios and `REALTIME_RUNTIME` 5; they are the
two largest remaining, and they are related — a standing condition that acts
when it becomes true is what a subscriber would deliver. The world ledger built
here is deliberately the cursor that capability will resume from, and
deliberately none of its transport.

The two gaps this phase NAMED carry one scenario each. They are small, they are
real, and neither may be folded back into a closed name to make a number move.
