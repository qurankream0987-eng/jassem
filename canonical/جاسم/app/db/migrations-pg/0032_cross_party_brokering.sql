-- JASIM — ONE PARTY ASKS, THE OTHER ANSWERS, AND JASIM ANSWERS FOR NEITHER
--
--   ANSWER_AUTHORITY_IS_THE_SUBJECT_OWNER
--   SELLER_ANSWER_IS_EVIDENCE_NOT_ATTRIBUTE
--   MODEL_ANSWERS_ON_BEHALF_OF_A_PARTY = 0
--   UNANSWERED != FALSE · UNANSWERED != UNAVAILABLE
--   QUESTION_LEAKS_ASKER_IDENTITY = 0
--
-- A buyer asks about something the offering never declared — the mileage, the
-- delivery window, whether the size is really in stock. Until now there was
-- nowhere for that question to go. `economic-fabric` guards ownership strictly
-- and correctly, so a buyer could read the public projection and nothing more,
-- and the only ways to fill the gap were both wrong: let the model answer
-- (invention), or write the answer into the offering (a claim with no author).
--
-- So the question becomes a first-class record between two parties who are
-- ALREADY authorized to be in contact. The engagement is that authorization —
-- match-backed, participants derived rather than nominated — and this reuses it
-- rather than inventing a second consent path.
--
--   ENGAGEMENT_IS_THE_CONTACT_AUTHORITY
--
-- What comes back is EVIDENCE, classified `SELF_REPORTED`: the owner's own
-- uncorroborated statement about their own thing, which is exactly what it is.
-- It is the strongest evidence that exists for «how many kilometres», and it is
-- still not a fact JASIM asserts. It is never written into the offering's
-- attributes, so nothing downstream can read it as the seller having declared
-- it at publication.
--
-- `subjectRevision` is pinned when the question is asked. An answer describes
-- the thing as it was at that version; a later revision does not silently
-- inherit it.

CREATE TYPE "cross_party_questions_status" AS ENUM ('asked', 'answered', 'declined', 'withdrawn');

CREATE TABLE IF NOT EXISTS "cross_party_questions" (
  "id" varchar(64) PRIMARY KEY,
  -- The authorized cross-owner relationship this question lives in.
  "engagementId" varchar(64) NOT NULL,
  -- WHO asked. Never projected to the answering party.
  "askedByOwnerId" varchar(100) NOT NULL,
  -- WHOSE expression it is about — the only party who may answer.
  "subjectOwnerId" varchar(100) NOT NULL,
  "subjectExpressionId" varchar(64) NOT NULL,
  -- The version the question was asked about. Pinned, never refreshed.
  "subjectRevision" integer NOT NULL,
  "property" varchar(120) NOT NULL,
  "status" "cross_party_questions_status" NOT NULL DEFAULT 'asked',
  -- NULL until the owner speaks — and NULL is not «no».
  "answerValue" jsonb,
  "answeredAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cross_party_questions_engagement_idx"
  ON "cross_party_questions" ("engagementId");

CREATE INDEX IF NOT EXISTS "cross_party_questions_inbox_idx"
  ON "cross_party_questions" ("subjectOwnerId", "status");

-- Asking again is the same question, not a second one. Without this, repeating
-- a question would be a way to pressure the other party.
CREATE UNIQUE INDEX IF NOT EXISTS "cross_party_questions_open_idx"
  ON "cross_party_questions" ("engagementId", "subjectExpressionId", "subjectRevision", "property");
