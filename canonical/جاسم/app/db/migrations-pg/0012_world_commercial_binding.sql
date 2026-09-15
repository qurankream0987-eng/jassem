-- Generic generated-World ownership references for commercial configuration.
-- These are references rather than domain-specific foreign keys: generated
-- worlds are persisted by the World runtime, not by the economic fabric.
ALTER TABLE "fee_rules" ADD COLUMN "worldId" varchar(191);
ALTER TABLE "plans" ADD COLUMN "worldId" varchar(191);
CREATE INDEX "fee_rules_world_idx" ON "fee_rules" ("worldId", "status");
CREATE INDEX "plans_world_idx" ON "plans" ("worldId", "status");