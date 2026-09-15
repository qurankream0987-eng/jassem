-- JASIM Block 2 — operational fabric (generic, domain-free).
-- Ten new tables + two in-place extensions. Non-destructive; no existing
-- Block 0/1/1.1 state is dropped or altered in meaning.

CREATE TABLE "memberships" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"subjectId" varchar(100) NOT NULL,
	"subjectKind" varchar(24) DEFAULT 'user' NOT NULL,
	"resourceKind" varchar(64) NOT NULL,
	"resourceId" varchar(64) DEFAULT '*' NOT NULL,
	"role" varchar(64),
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"purpose" varchar(255),
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"expiresAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delegation_grants" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"principalOwnerId" varchar(100) NOT NULL,
	"delegateId" varchar(100) NOT NULL,
	"delegateKind" varchar(24) DEFAULT 'agent' NOT NULL,
	"purpose" varchar(255) NOT NULL,
	"allowedCapabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"deniedCapabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"resourceScope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"maxMonetary" numeric(24, 6),
	"currency" varchar(8),
	"validFrom" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone,
	"maxDepth" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"parentGrantId" varchar(64),
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"revokedAt" timestamp with time zone,
	"fingerprint" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporal_triggers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"runId" uuid,
	"nodeId" uuid,
	"kind" varchar(16) NOT NULL,
	"fireAt" timestamp with time zone,
	"timezone" varchar(64),
	"recurrence" jsonb,
	"condition" jsonb,
	"eventFilter" jsonb,
	"continuation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"lastFiredAt" timestamp with time zone,
	"fireCount" integer DEFAULT 0 NOT NULL,
	"maxFires" integer,
	"idempotencyKey" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_windows" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"resourceKind" varchar(64) NOT NULL,
	"resourceId" varchar(64) NOT NULL,
	"startsAt" timestamp with time zone NOT NULL,
	"endsAt" timestamp with time zone NOT NULL,
	"timezone" varchar(64),
	"unit" varchar(32) NOT NULL,
	"capacityTotal" numeric(24, 6) NOT NULL,
	"capacityHeld" numeric(24, 6) DEFAULT '0' NOT NULL,
	"state" varchar(16) DEFAULT 'open' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"resourceOwnerId" varchar(100) NOT NULL,
	"windowId" varchar(64),
	"resourceKind" varchar(64) NOT NULL,
	"resourceId" varchar(64) NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit" varchar(32) NOT NULL,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"status" varchar(16) DEFAULT 'HELD' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expiresAt" timestamp with time zone,
	"idempotencyKey" varchar(255) NOT NULL,
	"compositeGroupId" varchar(64),
	"matchId" varchar(64),
	"expressionId" varchar(64),
	"runId" uuid,
	"nodeId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"subjectKind" varchar(64) NOT NULL,
	"subjectId" varchar(64) NOT NULL,
	"observationType" varchar(64) NOT NULL,
	"observedAt" timestamp with time zone NOT NULL,
	"sourceKind" varchar(32) DEFAULT 'system' NOT NULL,
	"providerId" varchar(128),
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freshnessExpiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"subjectKind" varchar(64) NOT NULL,
	"subjectId" varchar(64) NOT NULL,
	"purpose" varchar(255) NOT NULL,
	"viewerScope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latestObservationId" varchar(64),
	"state" varchar(16) DEFAULT 'active' NOT NULL,
	"assignmentId" varchar(64),
	"runId" uuid,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endsAt" timestamp with time zone,
	"endedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"subjectKind" varchar(64) NOT NULL,
	"subjectId" varchar(64) NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(16) DEFAULT 'OFFERED' NOT NULL,
	"matchId" varchar(64),
	"runId" uuid,
	"nodeId" uuid,
	"offerExpiresAt" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remote_executions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"runId" uuid NOT NULL,
	"nodeId" uuid NOT NULL,
	"providerId" varchar(128) NOT NULL,
	"bindingId" varchar(128),
	"protocolKind" varchar(16) NOT NULL,
	"remoteReference" varchar(255),
	"state" varchar(24) DEFAULT 'INVOKED' NOT NULL,
	"requestDigest" varchar(64) NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"delegationGrantId" varchar(64),
	"lastObservedAt" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_intents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"recipientId" varchar(100) NOT NULL,
	"purpose" varchar(255) NOT NULL,
	"content" jsonb NOT NULL,
	"privacyClass" varchar(24) DEFAULT 'standard' NOT NULL,
	"urgency" varchar(16) DEFAULT 'normal' NOT NULL,
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"state" varchar(24) DEFAULT 'QUEUED' NOT NULL,
	"channelStates" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"runId" uuid,
	"nodeId" uuid,
	"entityRef" jsonb,
	"expiresAt" timestamp with time zone,
	"idempotencyKey" varchar(255) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_grant_idx" ON "memberships" USING btree ("ownerId","subjectId","resourceKind","resourceId");
--> statement-breakpoint
CREATE INDEX "memberships_subject_idx" ON "memberships" USING btree ("subjectId","state");
--> statement-breakpoint
CREATE INDEX "delegation_grants_principal_idx" ON "delegation_grants" USING btree ("principalOwnerId","state");
--> statement-breakpoint
CREATE INDEX "delegation_grants_delegate_idx" ON "delegation_grants" USING btree ("delegateId","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "temporal_triggers_owner_idem_idx" ON "temporal_triggers" USING btree ("ownerId","idempotencyKey");
--> statement-breakpoint
CREATE INDEX "temporal_triggers_due_idx" ON "temporal_triggers" USING btree ("state","fireAt");
--> statement-breakpoint
CREATE INDEX "temporal_triggers_run_idx" ON "temporal_triggers" USING btree ("runId");
--> statement-breakpoint
CREATE INDEX "availability_windows_resource_idx" ON "availability_windows" USING btree ("resourceKind","resourceId","state","startsAt");
--> statement-breakpoint
CREATE INDEX "availability_windows_owner_idx" ON "availability_windows" USING btree ("ownerId");
--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_owner_idem_idx" ON "reservations" USING btree ("ownerId","idempotencyKey");
--> statement-breakpoint
CREATE INDEX "reservations_resource_idx" ON "reservations" USING btree ("resourceKind","resourceId","status");
--> statement-breakpoint
CREATE INDEX "reservations_expiry_idx" ON "reservations" USING btree ("status","expiresAt");
--> statement-breakpoint
CREATE INDEX "reservations_composite_idx" ON "reservations" USING btree ("compositeGroupId");
--> statement-breakpoint
CREATE INDEX "observations_subject_idx" ON "observations" USING btree ("subjectKind","subjectId","observationType","observedAt");
--> statement-breakpoint
CREATE INDEX "observations_owner_idx" ON "observations" USING btree ("ownerId");
--> statement-breakpoint
CREATE INDEX "track_sessions_subject_idx" ON "track_sessions" USING btree ("subjectKind","subjectId","state");
--> statement-breakpoint
CREATE INDEX "track_sessions_owner_idx" ON "track_sessions" USING btree ("ownerId","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_owner_idem_idx" ON "assignments" USING btree ("ownerId","idempotencyKey");
--> statement-breakpoint
CREATE INDEX "assignments_subject_idx" ON "assignments" USING btree ("subjectKind","subjectId","state");
--> statement-breakpoint
CREATE INDEX "assignments_run_idx" ON "assignments" USING btree ("runId");
--> statement-breakpoint
CREATE UNIQUE INDEX "remote_executions_owner_idem_idx" ON "remote_executions" USING btree ("ownerId","idempotencyKey");
--> statement-breakpoint
CREATE INDEX "remote_executions_run_idx" ON "remote_executions" USING btree ("runId","nodeId");
--> statement-breakpoint
CREATE INDEX "remote_executions_remote_ref_idx" ON "remote_executions" USING btree ("providerId","remoteReference");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intents_owner_idem_idx" ON "notification_intents" USING btree ("ownerId","idempotencyKey");
--> statement-breakpoint
CREATE INDEX "notification_intents_recipient_idx" ON "notification_intents" USING btree ("recipientId","state");
--> statement-breakpoint
-- §21: extend canonical event subscriptions (run continuation, external
-- source binding, expiry, state) — no new event bus.
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "ownerId" varchar(100);
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "runId" uuid;
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "nodeId" uuid;
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'internal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "state" varchar(16) DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD COLUMN IF NOT EXISTS "lastTriggeredAt" timestamp with time zone;
--> statement-breakpoint
-- §46–47: provider operational metadata (privacy/jurisdiction classes) —
-- availabilityState varchar already admits DEGRADED without schema change.
ALTER TABLE "capability_provider_catalog" ADD COLUMN IF NOT EXISTS "privacyClass" varchar(24);
--> statement-breakpoint
ALTER TABLE "capability_provider_catalog" ADD COLUMN IF NOT EXISTS "jurisdiction" varchar(64);
