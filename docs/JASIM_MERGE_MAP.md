# JASIM Canonical Merge — Subsystem Classification Map

Law: `KEEP → CONNECT → GENERALIZE → REPLACE ONLY WHEN NECESSARY`.
Canonical source: `canonical/جاسم/app` (verified byte-identical re-import of the
original upload; git commit `fca1965`). Proven runtime: `artifacts/api-server` +
`lib/db` + `scripts/src/jasim-world-runtime-proof.ts`.

## Platform adaptations (forced by environment, not redesign)

| Decision | Reason |
|---|---|
| DB dialect MySQL → PostgreSQL (drizzle pg-core) | Original schema never ran here (no MySQL on Replit); zero MySQL data exists, nothing destroyed. All 34 tables/columns/enums verified identical after conversion; `markets` table added (seed.ts referenced it — pre-existing defect). |
| zod pinned 4.3.5 (original lockfile); 88 single-arg `z.record()` calls fixed to two-arg form | Mechanical zod-4 compatibility; original never passed `tsc -b` (baseline: 1440 pre-existing type errors; 460/460 vitest green). |
| Runtime transport = tRPC (canonical style), not Express/OpenAPI | Spec: canonical API hosts runtime routes using original routing style; no parallel API. |
| vite dev port from `PORT` env | Replit preview assigns ports; hardcoded 3000 breaks preview. |

## Identity & DB truth

- ONE user identity: canonical `users` (unionId). Runtime `ownerId` = `String(users.id)`.
- ONE DB: canonical `db/schema.ts` + `db/schema-runtime.ts` on Replit Postgres.
- `lib/db` jasim_* tables: retained in DB (non-destructive), code paths retired after switch. Conversations/messages backfilled with id-mapping.

## Subsystem classification

| Subsystem | Canonical (original) | Proven runtime | Classification | Action |
|---|---|---|---|---|
| Conversations | `conversations` table + router | runtime conversations | KEEP_ORIGINAL + EXTEND | runtime logic ported onto canonical table |
| Messages | `messages` | runtime messages (+outputKind) | KEEP_ORIGINAL + EXTEND | added `outputKind`, `ownerId` columns |
| Tasks | `tasks` (planned work) | runtime task interpretation/actions | KEEP_ORIGINAL + EXTEND | added task-state/action support; Task does not create a durable World by default |
| Task steps | `taskSteps` | DAG nodes (execution-level) | BOTH_KEPT_DISTINCT_CONCEPT | taskSteps = plan steps (original); dag_nodes = durable execution (new table) |
| Runs | — (runtimeJobs is a generic job queue, different concept) | runs | NEW canonical concept | new `runs` table |
| DAG execution | task-runtime.ts (in-memory DAG) | durable DAG w/ leases/fencing | MERGE (proven DAG is authoritative) | new `dag_nodes`/`dag_dependencies`; invariants preserved, DB-time lease authority |
| Execution proposals | — | proposals + fingerprint approvals | NEW canonical concept | new `execution_proposals`/`proposal_approvals` |
| Approvals | `approvals` (task-step HITL, boolean) | proposal approvals (fingerprint-bound) | BOTH_KEPT_DISTINCT_SCOPE | approvals = task-step authority (original); proposal_approvals = execution authority. NOT merged — different layers |
| Bubbles | `bubbles` | runtime bubbles (mode/semantic/world) | KEEP_ORIGINAL + EXTEND | added `mode`, `semanticDescription`, `activeView`, `presentationState`, `permissions`, `references`, `worldId`; status enum += `archived` |
| Worlds | `generatedSystems`+`systemVersions` (+service/repository) | runtime worlds (definition+versions+optimistic concurrency) | KEEP_ORIGINAL + ADAPT | optional durable state created behind a persistent Smart Bubble only; not a standalone product surface |
| Events | `events`/`eventSubscriptions` | task/run/proposal event logs | KEEP_ORIGINAL + EXTEND | fold runtime events into `events` (+`ownerId`,`runId`,`proposalId`,`taskRef`,`message`) |
| Capabilities | `capabilities` table + CapabilityRegistry + signed binder + execution port | local safe capabilities + policy evaluation | KEEP_ORIGINAL + MERGE | proven local capabilities registered into canonical registry; proven policy evaluation wired as registry gate |
| Connectors | 8 connectors + credential provider + health monitor | (none — external effects forbidden) | PRESERVED_DORMANT | kept; external providers remain disabled (no Receipt+Verifier yet) |
| Auth | Kimi OAuth → `jasim_session` JWT cookie | dev-owner header | KEEP_ORIGINAL + ADAPT | runtime procedures use canonical ctx.user; dev-login added (development only, issues canonical session) |
| Web Main Chat | Home/chat local state | proven Main Chat (working) | MERGED_AND_ACTIVE | canonical chat hook uses runtime tRPC for conversations, turns, bubbles, and archived history; the active web and API artifacts now run the canonical source and browser regression passed |
| Mobile Main Chat | Expo app, useChat simulated | MERGED_AND_ACTIVE | Expo now calls canonical runtime tRPC directly for conversation list/get/create/archive and turns; Expo Web CORS is development-only, and message persistence was verified in the running preview |
| Old artifacts runtime | — | artifacts/api-server + artifacts/jasim + lib/api-* | SAFE_TO_REMOVE after switch | workflows repointed to canonical; old code removed post-regression |

## Invariants that must survive the merge (regression gate)

1. All DAG invariants: readiness from deps, atomic claims, lease expiry validated with DB time, stale-worker fencing, retry/permanent failure, cancellation preserves completed nodes.
2. Proposal lifecycle: fingerprint binding, approval invalidation on input change, replay protection, owner isolation.
3. Output router: model untrusted (propose-only), deterministic fallback, explicit failure when unconfigured.
4. Reference resolution: ambiguity surfaced, unresolved never fabricated, owner isolation.
5. World evolution: optimistic concurrency (stale baseVersion rejected), version history preserved.
6. Original suite stays green (460 tests) and no silent behavior change in original engines.
7. Bubble-first boundary: only a persistent Smart Bubble creates or exposes its
   optional durable World Runtime; a general Run must work without any Bubble.
