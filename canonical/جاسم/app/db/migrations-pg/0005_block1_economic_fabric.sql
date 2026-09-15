CREATE TYPE "public"."economic_engagements_state" AS ENUM('open', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."economic_expressions_kind" AS ENUM('offering', 'need');--> statement-breakpoint
CREATE TYPE "public"."economic_expressions_status" AS ENUM('draft', 'active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."economic_expressions_visibility" AS ENUM('private', 'unlisted', 'shared', 'public');--> statement-breakpoint
CREATE TYPE "public"."economic_matches_status" AS ENUM('candidate', 'viable', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."economic_proposals_status" AS ENUM('draft', 'proposed', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "public"."external_action_sessions_status" AS ENUM('active', 'used', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."transaction_intents_status" AS ENUM('intent', 'cancelled', 'fulfilled_externally');--> statement-breakpoint
CREATE TABLE "economic_engagements" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"matchId" varchar(64),
	"initiatorOwnerId" varchar(100) NOT NULL,
	"participants" jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "economic_engagements_state" DEFAULT 'open' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_expressions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"kind" "economic_expressions_kind" NOT NULL,
	"subjectEntityId" varchar(64),
	"semanticType" varchar(160) NOT NULL,
	"schemaRef" jsonb,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hardConstraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"softPreferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" jsonb,
	"visibility" "economic_expressions_visibility" DEFAULT 'private' NOT NULL,
	"status" "economic_expressions_status" DEFAULT 'draft' NOT NULL,
	"publicProjection" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_matches" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"needId" varchar(64) NOT NULL,
	"offeringId" varchar(64),
	"compositeComponents" jsonb,
	"constraintResults" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "economic_matches_status" DEFAULT 'candidate' NOT NULL,
	"createdByOwnerId" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_proposals" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"engagementId" varchar(64) NOT NULL,
	"proposerOwnerId" varchar(100) NOT NULL,
	"terms" jsonb NOT NULL,
	"termsSchemaRef" jsonb,
	"version" integer NOT NULL,
	"status" "economic_proposals_status" DEFAULT 'proposed' NOT NULL,
	"supersedesId" varchar(64),
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_action_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ownerId" varchar(100) NOT NULL,
	"provider" varchar(160) NOT NULL,
	"purpose" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"origin" varchar(255) NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"state" varchar(64) NOT NULL,
	"runId" varchar(64),
	"transactionIntentId" varchar(64),
	"status" "external_action_sessions_status" DEFAULT 'active' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"usedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_intents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"proposalId" varchar(64) NOT NULL,
	"engagementId" varchar(64) NOT NULL,
	"participants" jsonb NOT NULL,
	"valueKind" varchar(32) NOT NULL,
	"terms" jsonb NOT NULL,
	"status" "transaction_intents_status" DEFAULT 'intent' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "economic_engagements_match_idx" ON "economic_engagements" USING btree ("matchId");--> statement-breakpoint
CREATE INDEX "economic_expressions_owner_idx" ON "economic_expressions" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "economic_expressions_discovery_idx" ON "economic_expressions" USING btree ("kind","visibility","status");--> statement-breakpoint
CREATE INDEX "economic_matches_need_idx" ON "economic_matches" USING btree ("needId");--> statement-breakpoint
CREATE INDEX "economic_matches_offering_idx" ON "economic_matches" USING btree ("offeringId");--> statement-breakpoint
CREATE INDEX "economic_proposals_engagement_idx" ON "economic_proposals" USING btree ("engagementId");--> statement-breakpoint
CREATE INDEX "external_action_sessions_owner_idx" ON "external_action_sessions" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "external_action_sessions_expiry_idx" ON "external_action_sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_intents_proposal_idx" ON "transaction_intents" USING btree ("proposalId");
