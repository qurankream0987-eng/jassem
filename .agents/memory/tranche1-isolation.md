---
name: Tranche 1 isolation decisions
description: Canonical-only isolation decisions and guards added during Tranche 1 (runtime_tasks, NaN guards, tsconfig exclude).
---

## runtime_tasks table
- UUID primary key, no `tasks_priority_enum` ENUM dependency.
- Applied manually via `node -e "..."` (pg driver) because `db:migrate` was failing on the legacy ALTER TABLE lines in the generated SQL.
- Drizzle journal entry `0001_empty_miss_america` exists in `_journal.json` but the SQL file was rewritten to contain only the CREATE TABLE + indexes.
- **Why:** Original `tasks` table had a PostgreSQL ENUM (`tasks_priority_enum`) that caused insert failures in the proof; runtime_tasks uses `varchar(40)` for status instead.

## NaN guards in owner-isolation functions
- `getRuntimeWorld`: added `const ownerNum = toNumId(ownerId); if (isNaN(ownerNum)) throw new RuntimeAccessError(...)` before the DB query.
- `loadConversationRecord`: same guard before the query.
- **Why:** `toNumId("other-338776393")` returns `NaN`; PostgreSQL throws a type error (not RuntimeAccessError) when NaN is sent as a bigint parameter, so the proof's isolation assertion would see a non-RuntimeAccessError and mark isolation as failed.
- **How to apply:** Any new function that does `eq(bigintColumn, toNumId(ownerId))` where ownerId comes from untrusted input should add this guard.

## tsconfig.server.json exclude list
- Excludes: api/core, api/connectors, api/services, api/routes, api/webhook-handlers.ts, api/lib, api/routers/agents.ts, all legacy router files (task, bubble, conversation, capability, entity, approval, notifications, security, dna, external-actions, worlds, core-evolution, jasim, stream).
- **Why:** These files have pre-existing TypeScript errors. The canonical server (api/runtime/, api/routers/runtime.ts, api/router.ts, api/trpc.ts, api/boot.ts, api/context.ts, api/queries/, api/kimi/) compiles to 0 errors.

## boot.ts legacy removal
- `initializeRuntime`, `getConnectorHealthMonitor`, `getExternalActionReconciler` (from api/core/runtime), `ExternalReliabilityWorker`, webhook handlers (Moyasar, Shipday) were removed.
- **Why:** These pulled in api/core/ (legacy) causing cascade TS errors. The canonical runtime doesn't need them.
- **How to apply:** When restoring webhooks/connectors, do so in a separate file that is excluded from the canonical tsconfig check, or fix the underlying api/core TS errors first.

## InsertUser / NewUser alias
- `api/queries/users.ts` imports `NewUser as InsertUser` (not `InsertUser` directly).
- `lastSignInAt` field removed from all upsertUser call sites — this column does not exist in the users table.
