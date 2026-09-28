-- JASIM — A REVOKED CONNECTION IS HISTORY, NOT A SLOT TO REUSE
--
--   REVOKED_BINDING_IDENTITY_IS_TERMINAL
--   RECONNECT != UNREVOKE · RECONNECT != ROTATION
--   PINNED_BINDING_IDENTITY != CURRENT_CONNECTION_FOR_PROVIDER
--
-- `scope_provider_bindings` was unique on (scopeId, providerClass, providerId)
-- unconditionally, which asserted that a scope may only ever have had ONE
-- connection to a provider — past tense included. Reconnecting after a
-- revocation therefore had nowhere to put the new connection, and
-- `beginProviderSetup` reused the revoked row: same id, lifecycle reset to
-- SETUP_PENDING, endpointUrl cleared, credentialVersion back to 0.
--
-- That was wrong in two directions at once.
--
-- It did not work. `provider_credentials` is unique on (bindingId, kind,
-- version) and a retired envelope is kept for audit, so the reconnect's
-- PROVIDER_AUTH v1 collided with the revoked connection's retired v1 and the
-- setup failed with a raw database unique violation. Legitimate reconnect was
-- impossible.
--
-- And had it worked, it would have been worse. Canonical records pin binding
-- identity — `remote_executions.providerBindingRef`,
-- `payment_intents.providerBindingRef`, every sealed credential envelope, the
-- webhook and receipt verification material, the audit trail. An execution that
-- ran at bind_A's account and address would have found bind_A pointing at a
-- different account and a different address, silently, because the owner
-- reconnected. A follow-up about an existing effect must reach the system that
-- created it.
--
-- So the constraint is narrowed to what anybody actually meant by it: a scope
-- has at most ONE LIVE connection per provider. History is unlimited and
-- immutable, and a reconnect is a NEW binding identity beside it.
--
-- `IS DISTINCT FROM` rather than `<>`: a legacy environment-named row carries
-- NULL lifecycle, and `NULL <> 'REVOKED'` is NULL, which would drop those rows
-- out of the index and allow a second live row beside one. NULL is not revoked,
-- so NULL counts as live.
--
--   LEGACY_NULL_LIFECYCLE_ROW_ESCAPES_LIVE_UNIQUENESS = 0
--
-- Forward-only. No row is deleted, no binding id is rewritten, no credential
-- envelope is touched. The index is rebuilt under the same name so nothing that
-- names it has to change, and the new predicate is strictly weaker — every set
-- of rows that satisfied the old index satisfies this one, so an existing
-- database migrates without conflict whatever it holds: one VERIFIED row, one
-- REVOKED row, or a legacy NULL-lifecycle row.

DROP INDEX IF EXISTS "scope_provider_bindings_unique_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "scope_provider_bindings_unique_idx"
  ON "scope_provider_bindings" ("scopeId", "providerClass", "providerId")
  WHERE "lifecycle" IS DISTINCT FROM 'REVOKED';
