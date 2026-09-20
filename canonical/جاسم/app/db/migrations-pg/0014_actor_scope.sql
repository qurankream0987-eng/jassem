-- JASIM — ORGANIZATION AS A GENERAL ACTOR SCOPE.
--
-- An organization is a SCOPE that owns things, not a second kind of system.
-- Every table that already keys on "ownerId" keys on a scope id, so nothing is
-- renamed and nothing is migrated: an organization simply becomes another
-- value that column can hold.
--
-- There is no business TYPE column. A factory, a school and a clinic differ in
-- their attributes and their registrations, never in their architecture.
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "displayName" varchar(200) NOT NULL,
  -- The person who created it. Authority still comes from membership, so this
  -- is lineage rather than a permanent owner.
  "createdByPrincipalId" varchar(100) NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  -- Free-form, owner-supplied description of what this organization is. A
  -- "restaurant" lives HERE, as data, and never as a type in the core.
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "organizations_principal_idx"
  ON "organizations" ("createdByPrincipalId");

-- Private, versioned, scope-owned policy.
--
-- Append-only: a new version is a new row, so "what was the rule when this
-- decision was made" stays answerable. Nothing here is commerce-specific; a
-- minimum price and a maximum response time are the same two columns.
CREATE TABLE IF NOT EXISTS "scope_policies" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "scopeId" varchar(100) NOT NULL,
  "policyKey" varchar(120) NOT NULL,
  "value" jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "state" varchar(16) DEFAULT 'active' NOT NULL,
  "setByPrincipalId" varchar(100) NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "scope_policies_scope_idx"
  ON "scope_policies" ("scopeId", "policyKey", "version");

-- Provider bindings, owned by the scope that configured them.
--
-- Business A's connection is not Business B's, and a person's is not their
-- employer's. Secrets never live here: this records THAT a binding exists and
-- which environment name holds its credential.
CREATE TABLE IF NOT EXISTS "scope_provider_bindings" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "scopeId" varchar(100) NOT NULL,
  "providerClass" varchar(64) NOT NULL,
  "providerId" varchar(120) NOT NULL,
  "credentialEnvName" varchar(160),
  "state" varchar(16) DEFAULT 'active' NOT NULL,
  "boundByPrincipalId" varchar(100) NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "revokedAt" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "scope_provider_bindings_unique_idx"
  ON "scope_provider_bindings" ("scopeId", "providerClass", "providerId");
