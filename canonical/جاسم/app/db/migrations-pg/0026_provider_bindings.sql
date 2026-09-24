-- JASIM — THE GENERAL PROVIDER / CONNECTOR BINDING RUNTIME
--
--   CONNECTED != VERIFIED · AUTHORIZED != AUTHENTICATED != VERIFIED
--   READ != WRITE · PROVIDER_CAPABILITY != EXECUTION AUTHORITY
--   SETUP_LINK_CREATED != CREDENTIAL_STORED != AUTHENTICATED != VERIFIED
--
-- `scope_provider_bindings` already existed and already got the hardest part
-- right: a binding belongs to a SCOPE, and the credential column holds a NAME
-- rather than a secret. What it had no way to say is what kind of system is on
-- the other end, what this particular connection may DO, and whether anyone
-- ever checked that it works. Creating the row WAS being connected.
--
-- Nothing here is dropped or renamed. The legacy columns keep their meaning,
-- and a row with a NULL `lifecycle` is a boot-time environment binding exactly
-- as before.

ALTER TABLE "scope_provider_bindings"
  -- Which registered PROVIDER DEFINITION this binding is an instance of.
  -- Definition and binding are different things and stay different things.
  ADD COLUMN IF NOT EXISTS "definitionId" varchar(120),
  -- SETUP_PENDING · AUTHORIZED · AUTHENTICATED · VERIFIED · SUSPENDED · REVOKED
  -- NULL means a legacy environment-named binding, which this runtime will not
  -- use. A row is never usable merely because it exists.
  ADD COLUMN IF NOT EXISTS "lifecycle" varchar(16),
  -- What was ASKED for. A request, never a grant.
  ADD COLUMN IF NOT EXISTS "requestedCapabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the provider itself says this connection can do.
  ADD COLUMN IF NOT EXISTS "discoveredCapabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What this binding may actually do. Written only by verification, only as
  -- the intersection of requested, supported and discovered.
  ADD COLUMN IF NOT EXISTS "grantedCapabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- A REFERENCE into the credential vault. Never credential material.
  ADD COLUMN IF NOT EXISTS "credentialRef" varchar(64),
  -- Rotation: exactly one version is current, so two credentials can never be
  -- ambiguous authority for one binding.
  ADD COLUMN IF NOT EXISTS "credentialVersion" integer NOT NULL DEFAULT 0,
  -- Non-sensitive identity of the far side, as the provider reported it.
  ADD COLUMN IF NOT EXISTS "accountRef" varchar(191),
  ADD COLUMN IF NOT EXISTS "accountLabel" varchar(191),
  -- For providers whose endpoint is declared at setup rather than fixed in
  -- trusted code. Validated against the network boundary before it is stored.
  ADD COLUMN IF NOT EXISTS "endpointUrl" varchar(512),
  -- The trusted setup surface this binding is waiting on. One-time by
  -- construction: a consumed setup cannot be consumed again.
  ADD COLUMN IF NOT EXISTS "setupSessionId" varchar(64),
  ADD COLUMN IF NOT EXISTS "setupExpiresAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "setupConsumedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "authenticatedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "verifiedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "suspendedReason" varchar(191);

CREATE INDEX IF NOT EXISTS "scope_provider_bindings_lifecycle_idx"
  ON "scope_provider_bindings" ("scopeId", "lifecycle");

-- ---------------------------------------------------------------------------
-- THE CREDENTIAL BOUNDARY
--
--   RAW_PROVIDER_SECRET_IN_CANONICAL_BINDING = 0
--
-- Credential material never reaches the binding row, an event, a notification
-- or a model prompt. It lands here, sealed, and the binding holds a reference.
-- The envelope is the repository's own AES-256-GCM construction, additionally
-- authenticated over the scope, the binding and the credential version, so a
-- sealed value cannot be replayed into a different binding or an older
-- rotation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "provider_credentials" (
  "id" varchar(64) PRIMARY KEY,
  "scopeId" varchar(100) NOT NULL,
  "bindingId" varchar(64) NOT NULL,
  "version" integer NOT NULL,
  "ciphertext" text NOT NULL,
  "iv" varchar(64) NOT NULL,
  "authTag" varchar(64) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "retiredAt" timestamptz
);

-- One current credential per binding version, so a rotation replaces rather
-- than accumulates.
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_binding_version_idx"
  ON "provider_credentials" ("bindingId", "version");
