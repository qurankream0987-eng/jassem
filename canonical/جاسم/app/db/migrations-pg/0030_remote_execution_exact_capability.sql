-- JASIM — THE EXACT VERB, NOT THE SIDE OF THE VOCABULARY
--
--   SAME_EFFECT_SIDE != SAME_AUTHORITY
--   GRANTED_SOME_MUTATION != GRANTED_THIS_MUTATION
--   GRANTED_SOME_READ != GRANTED_THIS_READ
--   AUTHORITY_TO_EXECUTE != AUTHORITY_TO_READ_BACK
--   AUTHORITY_TO_CREATE  != AUTHORITY_TO_CANCEL
--
-- The connection gate introduced one phase ago asked only which SIDE of the
-- capability vocabulary a call was on, so a connection granted only PAY passed
-- a DELETE and one granted only OBSERVE passed a SEARCH. The two older doors in
-- the same runtime always required the exact verb; this records the verbs the
-- remote paths need so they can require it too.
--
-- Invoking, reading a result back and withdrawing the instruction are three
-- operations, and a provider may permit them separately. All three are pinned
-- when the execution is created, from trusted configuration — never re-derived
-- later from discovery metadata, a policy, or a manifest that has since moved.
-- An absent verb is no authority, not a fallback.

ALTER TABLE "remote_executions"
  ADD COLUMN IF NOT EXISTS "authorizedOperations" jsonb;
