-- NEED → TRANSACTION PROVENANCE
--
-- Three edges, on objects that already exist. No new table, because the trace
-- found the rest of the chain already deterministic and immutable:
--
--   transactions.agreementId  → agreements.proposalId (unique)
--   agreements.proposalId     → economic_proposals.engagementId
--
-- What was missing was the head of the chain and the carrier into it.
--
--   PROVENANCE != AUTHORITY · != VERIFICATION · != COMPLETION
--
-- A provenance edge says only THIS CAME FROM THAT. It never says anybody
-- authorized anything, that a counterparty accepted, that payment happened, or
-- that a need was satisfied.
--
-- THE REVISION MATTERS. A need goes on being refined after a search ran, so an
-- edge that recorded only the need's id would let a corrected need silently
-- inherit evidence gathered for what it used to say.
--
--   STALE_RESULTSET_REINTERPRETED_AS_NEW_NEED = 0
--   HISTORICAL_PROVENANCE_MUTATION = 0
--

-- 1. Why this search happened.
ALTER TABLE "discovery_result_sets"
  ADD COLUMN IF NOT EXISTS "needId" varchar(64);
ALTER TABLE "discovery_result_sets"
  ADD COLUMN IF NOT EXISTS "needRevision" integer;

CREATE INDEX IF NOT EXISTS "discovery_result_sets_need_idx"
  ON "discovery_result_sets" ("needId", "needRevision");

-- 2. What was picked, and out of which presented set. The draft records this
--    because the draft is where a selection lives; it stays authoritative for
--    nothing, and nothing in the lineage below reads it.
ALTER TABLE "commercial_orders"
  ADD COLUMN IF NOT EXISTS "resultSetId" varchar(64);
ALTER TABLE "commercial_orders"
  ADD COLUMN IF NOT EXISTS "candidateId" varchar(64);

-- 3. The canonical carrier. An engagement is created at the exact moment a
--    conversational selection becomes a canonical proposal, so it is the one
--    place on the authoritative chain that can honestly say which need this
--    attempt came from — and it never changes afterwards.
ALTER TABLE "economic_engagements"
  ADD COLUMN IF NOT EXISTS "needId" varchar(64);
ALTER TABLE "economic_engagements"
  ADD COLUMN IF NOT EXISTS "needRevision" integer;

CREATE INDEX IF NOT EXISTS "economic_engagements_need_idx"
  ON "economic_engagements" ("needId", "needRevision");
