-- JASIM — WHERE A REMOTE RECEIPT VERIFICATION SECRET LIVES
--
--   RECEIPT != VERIFICATION · VALID_RECEIPT_SIGNATURE != BUSINESS_TRUTH
--   PROVIDER_CANDIDATE != PROVIDER_ACCOUNT
--   RECEIPT_SECRET != WEBHOOK_SECRET
--   SECOND_SECRET_STORE = FORBIDDEN
--
-- The remote execution path verified provider receipts with a PLAINTEXT string
-- read from `capability_provider_catalog.ioMetadata.receiptSecret` — the same
-- discovery table, at the same UNTRUSTED_CANDIDATE trust class, that held the
-- webhook secret one phase ago. Nothing in production ever wrote it, and
-- nothing ever set the matching field on an in-memory provider either, so
-- receipt verification could not succeed in production at all.
--
-- It is NOT the webhook secret. A webhook secret authenticates an inbound
-- callback's raw body; a receipt secret authenticates a digest of a COMPLETED
-- remote result. They are presented at different provider surfaces and nothing
-- in this repository says a provider issues one value for both. So this is a
-- third KIND in the one existing store — `provider_credentials` already counts
-- the kind in its unique index and its AAD, so no table changes here.
--
-- What did not exist is a way to say WHICH ACCOUNT a remote execution ran
-- through. `remote_executions.bindingId` holds a per-resolution selection id
-- minted by `resolveProvider` — it identifies the DECISION, not the account,
-- and nothing reads it. So the account is recorded under the same name the
-- payment runtime uses for the same fact.

ALTER TABLE "scope_provider_bindings"
  -- A REFERENCE into the same vault, beside credentialRef and
  -- webhookCredentialRef. Three purposes, three references, one store.
  ADD COLUMN IF NOT EXISTS "receiptCredentialRef" varchar(64),
  ADD COLUMN IF NOT EXISTS "receiptCredentialVersion" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- WHICH ACCOUNT executed this remote call.
--
-- Pinned when the execution is created, so nothing that changes afterwards —
-- a provider preference, a policy, another account at the same provider, a
-- rotation elsewhere — can redirect receipt verification to other material.
-- NULL means UNKNOWN, and unknown is never "any": a receipt for an execution
-- with no recorded account cannot be verified, and is INCONCLUSIVE rather than
-- verified.
ALTER TABLE "remote_executions"
  ADD COLUMN IF NOT EXISTS "providerBindingRef" varchar(64);
