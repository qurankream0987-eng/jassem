-- CONVERSATIONAL SELECTION → CANONICAL PROPOSAL
--
-- A commercial order is a SELECTION SNAPSHOT and a DRAFT, and after this
-- migration it says so structurally: it points at the canonical proposal rather
-- than standing beside it.
--
--   COMMERCIAL_ORDER != AGREEMENT
--   COMMERCIAL_ORDER != COMMITMENT
--   COMMERCIAL_ORDER != CANONICAL_TRANSACTION
--
-- Three fingerprints, because there are three different things that can move
-- and conflating any two of them is how a party's own configuration gets
-- reported as the counterparty changing the deal:
--
--   offeringFingerprint       — the SOURCE offering's published terms
--   configurationFingerprint  — what THIS party stated, within what the
--                               offering permits
--   termsFingerprint          — the existing draft fingerprint, unchanged
--
--   OFFERING_TERMS != PARTY_STATED_CONFIGURATION
--   PARTY_CONFIGURATION != COUNTERPARTY_CHANGED_TERMS
--
ALTER TABLE "commercial_orders"
  ADD COLUMN IF NOT EXISTS "partyConfiguration" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "commercial_orders"
  ADD COLUMN IF NOT EXISTS "offeringFingerprint" varchar(64);

ALTER TABLE "commercial_orders"
  ADD COLUMN IF NOT EXISTS "configurationFingerprint" varchar(64);

-- The canonical proposal this draft became, once a party authorized sending
-- it. Null until then, and it is the draft that points at the truth — never
-- the other way round.
ALTER TABLE "commercial_orders"
  ADD COLUMN IF NOT EXISTS "proposalId" varchar(64);

CREATE INDEX IF NOT EXISTS "commercial_orders_proposal_idx"
  ON "commercial_orders" ("proposalId");
