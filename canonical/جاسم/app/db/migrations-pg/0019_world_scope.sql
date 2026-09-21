-- JASIM — PERSISTENT WORLD MATERIALIZATION
--
--   ROUTED != MATERIALIZED
--   MATERIALIZED != CONFIGURED
--   CONFIGURED != EXTERNALLY_CONNECTED
--
-- No new World tables. `generated_systems` and `system_versions` already hold
-- a versioned, digest-addressed, request-keyed world and have since Block 2.
-- What they could not hold was WHOSE it is once a business became a scope, so
-- that is the only thing added here.

ALTER TABLE "generated_systems" ADD COLUMN IF NOT EXISTS "scopeId" varchar(64);

-- Every row written before scopes existed belongs to its owner's personal
-- scope, and a personal scope's id is the principal's own id. Backfilled
-- rather than left null, so a scoped read never has to mean two things.
UPDATE "generated_systems" SET "scopeId" = "ownerId"::text WHERE "scopeId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "generated_systems_scope_world_idx"
  ON "generated_systems" ("scopeId", "worldKey");

CREATE INDEX IF NOT EXISTS "generated_systems_scope_idx"
  ON "generated_systems" ("scopeId", "status");
