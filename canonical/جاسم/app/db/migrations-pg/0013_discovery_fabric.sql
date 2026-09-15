-- Block 3.1 — chat-native universal discovery fabric (generic, domain-free).
-- Forward-only; no change to any previously shipped migration.
CREATE TABLE "discovery_result_sets" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "ownerId" varchar(100) NOT NULL,
  "conversationId" varchar(64) NOT NULL,
  "runId" varchar(64),
  "queryText" text NOT NULL,
  "sources" jsonb NOT NULL,
  "hardConstraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "discovery_candidates" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "resultSetId" varchar(64) NOT NULL,
  "position" integer NOT NULL,
  "source" varchar(32) NOT NULL,
  "canonicalRef" varchar(64),
  "externalRef" text,
  "providerId" varchar(160),
  "title" text NOT NULL,
  "summary" text,
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observedPriceMinor" numeric(38,0),
  "observedCurrency" varchar(8),
  "availability" varchar(24),
  "trust" varchar(40) NOT NULL,
  "capabilityRef" varchar(191),
  "actionable" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "reference_bindings" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "ownerId" varchar(100) NOT NULL,
  "conversationId" varchar(64) NOT NULL,
  "referenceKey" varchar(128) NOT NULL,
  "targetKind" varchar(48) NOT NULL,
  "targetId" varchar(191) NOT NULL,
  "resultSetId" varchar(64),
  "position" integer,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "supersededAt" timestamp with time zone
);
CREATE TABLE "fulfillment_observations" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "ownerId" varchar(100) NOT NULL,
  "subjectKind" varchar(48) NOT NULL,
  "subjectId" varchar(64) NOT NULL,
  "observerOwnerId" varchar(100) NOT NULL,
  "observationKind" varchar(48) NOT NULL,
  "proofClass" varchar(40) NOT NULL,
  "location" jsonb,
  "note" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "discovery_candidates_set_position_idx" ON "discovery_candidates" ("resultSetId", "position");
CREATE INDEX "discovery_candidates_canonical_idx" ON "discovery_candidates" ("canonicalRef");
CREATE INDEX "discovery_result_sets_owner_idx" ON "discovery_result_sets" ("ownerId", "createdAt");
CREATE INDEX "discovery_result_sets_conversation_idx" ON "discovery_result_sets" ("conversationId", "createdAt");
CREATE INDEX "reference_bindings_conversation_idx" ON "reference_bindings" ("conversationId", "referenceKey");
CREATE INDEX "reference_bindings_target_idx" ON "reference_bindings" ("targetKind", "targetId");
CREATE INDEX "fulfillment_observations_subject_idx" ON "fulfillment_observations" ("subjectKind", "subjectId", "createdAt");
-- Lexical search support for internal discovery (structured filters + FTS + trigram).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "economic_expressions_trgm_idx" ON "economic_expressions" USING gin (("semanticType" || ' ' || COALESCE("publicProjection"::text, '')) gin_trgm_ops);
