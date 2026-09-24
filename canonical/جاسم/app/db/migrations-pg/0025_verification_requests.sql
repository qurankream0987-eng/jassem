-- COUNTERPARTY VERIFICATION REQUESTS
--
-- When JASIM needs stronger evidence and no machine can supply it, the person
-- who actually knows may be asked. This is the question — not the answer, not
-- an authorization, and not a proposal.
--
--   QUESTION != PROPOSAL
--   COUNTERPARTY_ASSERTION != SYSTEM_OBSERVATION
--   AVAILABILITY_CONFIRMATION != RESERVATION
--   AVAILABILITY != AUTHORITY
--
-- A request binds to an EXACT fact: this subject, at this revision, this
-- property, this configuration, this quantity, for this purpose. Anything
-- looser would let an answer about one thing verify another.
--
-- The responding scope is DERIVED from the canonical subject and stored, so
-- who may answer is decided before anybody is asked — and re-checked again
-- when they answer.
--
--   MODEL_CAN_CHOOSE_AUTHORITATIVE_COUNTERPARTY = NO
--
CREATE TABLE IF NOT EXISTS "verification_requests" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  -- The exact fact. Every column here narrows what an answer can cover.
  "subjectKind" varchar(64) NOT NULL,
  "subjectId" varchar(128) NOT NULL,
  "subjectRevision" varchar(64),
  "property" varchar(64) NOT NULL,
  "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "quantity" integer,
  -- What the answer would be used for. The same fact needs different strength
  -- for different acts, which is the freshness runtime's own vocabulary.
  "purpose" varchar(24) NOT NULL,
  -- Who wants to know, and who may say. Both are acting scopes.
  "requestingScopeId" varchar(64) NOT NULL,
  "respondingScopeId" varchar(64) NOT NULL,
  -- PENDING · ANSWERED · EXPIRED · CANCELLED.
  --
  --   NO_RESPONSE != YES · NO_RESPONSE != NO
  --
  -- Silence stays PENDING and then EXPIRED. It never becomes an answer.
  "state" varchar(16) NOT NULL DEFAULT 'PENDING',
  -- AFFIRMED · DENIED · CHANGED · UNKNOWN, once somebody answers.
  "assertion" varchar(16),
  -- The delivery, through the notification primitive that already exists.
  -- Presentation, never truth.
  "notificationIntentId" varchar(64),
  -- The evidence the answer became, when it became any.
  "observationId" varchar(64),
  "answeredByPrincipalId" varchar(100),
  "answeredAt" timestamp with time zone,
  -- The deterministic name of this question, from the freshness runtime.
  "requirementKey" varchar(400) NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

-- ONE PENDING QUESTION PER FACT, enforced by the database rather than by a
-- check somebody remembered to write. Five people wanting the same answer is
-- one question, and the seller's attention is spent once.
--
--   DUPLICATE_HUMAN_PINGS = 0
CREATE UNIQUE INDEX IF NOT EXISTS "verification_requests_pending_key"
  ON "verification_requests" ("requirementKey")
  WHERE "state" = 'PENDING';

CREATE INDEX IF NOT EXISTS "verification_requests_responder_idx"
  ON "verification_requests" ("respondingScopeId", "state");

CREATE INDEX IF NOT EXISTS "verification_requests_subject_idx"
  ON "verification_requests" ("subjectKind", "subjectId", "property");
