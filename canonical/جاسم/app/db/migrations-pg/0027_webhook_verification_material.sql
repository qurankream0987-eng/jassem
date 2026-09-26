-- JASIM — WHERE A WEBHOOK VERIFICATION SECRET LIVES
--
--   WEBHOOK_SECRET != PUBLIC PROVIDER METADATA
--   PROVIDER_DEFINITION != PROVIDER_BINDING
--   PROVIDER_TYPE != PROVIDER_ACCOUNT
--   SECOND_SECRET_STORE = FORBIDDEN
--
-- Webhook authentication used to read a PLAINTEXT string out of
-- `capability_provider_catalog.ioMetadata`, a table whose own header says it
-- persists "normalized external candidates (MCP/A2A/…)" at trust class
-- UNTRUSTED_CANDIDATE. Nothing in production ever wrote it, so the mounted
-- webhook route could not authenticate anything at all; and had anything
-- written it, one string would have authenticated callbacks naming EVERY
-- scope's payments, because a discovery row has no account.
--
-- Nothing here adds a store. `provider_credentials` already seals provider
-- material with AES-256-GCM bound to (scope, binding, version). What it could
-- not say is that one binding holds more than one KIND of material — an
-- outbound credential that proves who JASIM is, and inbound verification
-- material that proves a callback came from the provider. They are issued at
-- different provider surfaces and rotate on different days, so they are two
-- envelopes in one store rather than one envelope with two meanings.

ALTER TABLE "provider_credentials"
  -- PROVIDER_AUTH · WEBHOOK_VERIFICATION. Defaulted so every existing envelope
  -- keeps exactly the meaning it was sealed with.
  ADD COLUMN IF NOT EXISTS "kind" varchar(32) NOT NULL DEFAULT 'PROVIDER_AUTH';
--> statement-breakpoint

-- One current version PER KIND, so a rotation of one is never ambiguous
-- authority for the other.
DROP INDEX IF EXISTS "provider_credentials_binding_version_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credentials_binding_kind_version_idx"
  ON "provider_credentials" ("bindingId", "kind", "version");
--> statement-breakpoint

ALTER TABLE "scope_provider_bindings"
  -- A REFERENCE into the same vault. Never material, exactly like credentialRef.
  ADD COLUMN IF NOT EXISTS "webhookCredentialRef" varchar(64),
  ADD COLUMN IF NOT EXISTS "webhookCredentialVersion" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- WHICH ACCOUNT executed this payment, beside WHICH KIND of system did.
--
-- `providerRef` is a provider DEFINITION, and two scopes may legitimately hold
-- their own accounts at the same one. Without this column the only way back to
-- the executing account is to re-resolve the payment route, which runs through
-- mutable scope policy — so a policy edit would silently stop authenticating a
-- provider's callbacks. Bound once, by the same execution ceremony that binds
-- `providerRef`, and never rewritten.
ALTER TABLE "payment_intents"
  ADD COLUMN IF NOT EXISTS "providerBindingRef" varchar(64);
