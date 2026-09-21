# JASIM — A PERSISTENT WORLD

```
CONVERSATION
  -> SEMANTIC ROUTER
    -> PERSISTENT_WORLD
      -> VALIDATED WorldDefinition
        -> SCOPE / AUTHORIZATION
          -> POLICY / APPROVAL
            -> ATOMIC MATERIALIZATION
              -> worldId · version 1 · durable event · canonical projection
```

```
ROUTED       != MATERIALIZED
MATERIALIZED != CONFIGURED
CONFIGURED   != EXTERNALLY_CONNECTED
IDEA != WORLD · GOAL != WORLD
UI != WORLD · UI != CANONICAL STATE
```

---

## 1. What was actually there

Traced through `9d5ac61` before anything was written, because the brief's first
constraint was *do not introduce a parallel World system if one already
exists*. One did.

| | where | what it did |
|---|---|---|
| `generated_systems` | `db/schema.ts` | `worldKey`, `ownerId`, `version`, `continuity`, `visibility`, `schema` (the DNA), `status`, unique on (`ownerId`, `worldKey`) |
| `system_versions` | `db/schema.ts` | `version`, `status`, `parentVersion`, `contentDigest`, `requestKey`, `migration.changes`; unique on (`systemId`,`version`) and (`systemId`,`requestKey`) |
| `WorldDNASchema` | `contracts/dna.ts` | entities, relations, capabilities, workflows, policies, participants, ui, theme, lineage |
| `GeneratedWorldService` | `api/core/generated-world-service.ts` | `persistApproved`, a structural `diff`, a semver bump derived from that diff, a semantic digest, request-key reconciliation, and a **rollback that creates a new version** |
| `DrizzleGeneratedWorldRepository` | `api/core/generated-world-repository.ts` | the rows, plus the conversation attachment in `conversations.context.activeWorldId` |
| `worldsRouter` | `api/routers/worlds.ts` | list · get · history · attach · detach · requestRollback |
| `PERSISTENT_WORLD` | `api/runtime/semantic-router.ts` | a route the router named and honestly reported as unimplemented |
| `WORLD_SUMMARY` | `presentation-fabric.ts`, both apps | a presentation primitive both surfaces already mapped |

So the gap was never "there is no world". It was that **a conversation could
not reach any of it**, and that four things the brief requires were missing
from what could:

1. **No path from a turn.** `routeRuntimeConversationTurn` returned
   `MECHANISM_NOT_IMPLEMENTED`. The world machinery was reachable only from the
   legacy router and the Block 3 commerce orchestrator.
2. **No precondition.** `persistApproved` never compared against a version the
   caller had read. A stale writer won by arriving second.
3. **No atomicity.** `createVersion` → `activateVersion` → `updateSystem` were
   three statements; between them a world had a version nothing pointed at.
4. **No scope.** `ownerId` is a `bigint`. An organization could not own a world
   at all.

## 2. What was built

### One column, and no new table

`0019_world_scope.sql` adds `generated_systems.scopeId`, backfills it to
`ownerId::text` (a personal scope's id *is* the principal's id), and adds a
unique index on (`scopeId`, `worldKey`). `ownerId` keeps meaning **who made
it**; `scopeId` means **whose it is** — two questions that stopped being the
same one when a business became a scope.

```
PARALLEL_WORLD_SYSTEMS_ADDED = 0
```

### The commit became one transaction and one compare-and-set

`GeneratedWorldRepository.commitVersion` replaces the three-statement commit.
Inside one `db.transaction`:

```sql
UPDATE generated_systems SET version = $new, schema = $world, status = 'active'
 WHERE id = $id AND version = $expectedVersion     -- 0 rows ⇒ CONFLICT
```

then the old active version is retired and the new one inserted. Postgres
decides the race, not a read-then-write two requests can interleave inside.
`expectedVersion` is optional, so every existing caller behaves exactly as it
did — and is now atomic as well.

### `api/runtime/world-runtime.ts` — the conversational boundary

The module the phase is about. It owns validation, scope, policy, authority,
events and the projection, and commits through the service that already
existed.

**Seven mutation classes, and the runtime decides which one a change is:**

```
DATA · STRUCTURAL · POLICY · WORKFLOW · VIEW · PERMISSION · COMMERCIAL
```

The class comes from the TARGET (`entity` → STRUCTURAL, `policy` → POLICY,
`participant` → PERMISSION …). A caller may state what it believes it is doing;
if the statement disagrees with what the change touches, the change is refused.
A POLICY change labelled DATA would otherwise take a DATA change's permission.

**Each class maps onto a permission that already existed** — `mutate`,
`manage_policies`, `manage_members`, `act_financially` — so there is no second
permission system. POLICY, PERMISSION and COMMERCIAL additionally require the
`world.evolve` **authority act**: a statement the runtime renders, read and
cited by its digest.

**A definition is untrusted until validated.** `assertNoWorldAuthorityClaim`
refuses a proposal that names an owner, a scope, a membership, a permission, an
approval or a version. `assertNoExecutableCode` refuses `<script>`,
`javascript:`, `eval(`, `new Function(`, an arrow body, `require(`, `import(`,
`process.env`, a SQL statement or a template substitution — anywhere in the
proposal. Then reference validation: a relation must relate declared entities, a
policy must guard a declared target, and no key may appear twice.

**A definition may not bind its own capabilities.** `capabilities` is always
`[]`. A binding is the right to ACT, and a world that could grant itself one
would be a generated application with authority.

### Atomicity is structural, not defended

`applyChangeSet` walks the whole set onto a **copy**. If change #4 of 5 is
invalid it throws, and the first three exist only in a value about to be
garbage. There is no partially written world to clean up because there was
never a partial write. The commit that follows is one transaction.

### Replay is answered by identity, then by digest

The stable request key is checked before anything is recomputed — re-applying a
landed change set would fail with *«adds x, which is already there»*, and that
is the wrong answer to "did this already happen". The semantic digest then
catches the same decision arriving under a different key.

### The ledger, and none of the transport

`WORLD_MATERIALIZED` and `WORLD_VERSION_CREATED` go into the `events` table
that already exists, scoped by `ownerId = scopeId`, correlated by `worldId`,
ordered by the serial id and resumable from it. `worldEventsSince({ after })` is
the cursor a subscriber will use. Nothing subscribes, nothing says «مباشر», and
no socket was opened.

### The surface

`projectWorld` returns counts and names read from stored state, plus
`externallyConnected: false` and `providerBindings: 0` — said out loud, because
a world naming a provider is the case most likely to be read the other way.
The turn renders it as `WORLD_SUMMARY`, which both apps already mapped
(`detail` on web, `entity` on mobile). `runtime.worldRead` / `worldList` /
`worldHistory` / `worldEvents` serve both, and mobile calls the same procedure
names. There is no `WebWorldRuntime` and no `MobileWorldRuntime`.

## 3. The decisions that carry the phase

**A world is earned.** The branch is entered by the route or by an explicit
world request. An ordinary turn — «عندي فكرة أن الناس يؤجرون ساعات معداتهم» —
creates nothing, and a test asserts the table is empty afterwards.

**The precondition is the runtime's, not the model's.** The turn reads the
current version and passes THAT as `expectedVersion`. A model naming a version
would be naming the precondition it has to satisfy.

**Not found and not permitted are the same answer.** A cross-scope read returns
`undefined`; a cross-scope mutation says *no such world in this scope*. Telling
a stranger that a world exists is already telling them something.

**Nothing is reported until it is read back.** `materializeWorld` re-reads the
row after the commit and refuses to report success unless it comes back at the
version just written.

**`world.evolve` is one more registration, not one more mechanism.** The
inherited "seven acts" test became "every act", asserting the invariants for
each entry rather than the seven names — the list grows when a new kind of
decision needs a person; the number of mechanisms does not.

## 4. What is still not true

| | |
|---|---|
| a grant on ONE world | `membership.grant` is scope-wide. The membership row already carries `resourceKind`/`resourceId` and nothing writes anything but `organization`/`*` — `RESOURCE_SCOPED_PERMISSION_GRANT` |
| a scope's name, logo and palette | a world carries a theme and a scope has a display name; no surface reads either — `SCOPE_BRANDING_SURFACE` |
| live updates | the ledger is resumable and nothing subscribes. Transport is the next capability, and this phase built none of it |
| entity ROWS inside a world | a world declares structure. Records under that structure are a separate decision with its own evidence |
| a world's own UI | `VIEW` is a recognised class and carries no canonical state. `UI != WORLD` |

```
GENERALITY FAILURE != PROVIDER NOT CONNECTED
FALSE_WORLD_SUCCESS = 0 · FALSE_PERSISTENCE = 0
```
