CREATE TABLE "jasim_runtime_bubble_versions" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"bubbleId" bigint NOT NULL,
"ownerId" bigint NOT NULL,
"schemaVersion" varchar(40) NOT NULL,
"fromVersion" varchar(40),
"mutationType" varchar(40) NOT NULL,
"nlInstruction" text,
"changeSet" jsonb NOT NULL,
"schemaBefore" jsonb,
"schemaAfter" jsonb NOT NULL,
"appliedBy" bigint NOT NULL,
"appliedAt" timestamp with time zone DEFAULT now() NOT NULL,
"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bubble_versions_bubble_idx" ON "jasim_runtime_bubble_versions" USING btree ("bubbleId");
--> statement-breakpoint
CREATE INDEX "bubble_versions_owner_idx" ON "jasim_runtime_bubble_versions" USING btree ("ownerId");
--> statement-breakpoint
CREATE INDEX "bubble_versions_type_idx" ON "jasim_runtime_bubble_versions" USING btree ("mutationType");
