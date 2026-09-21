-- JASIM — THE AUTHORITY ADMINISTRATION PATH.
--
-- A person must be able to perform an AUTHORITY ACT by speaking — create an
-- organization, grant a verb, set a policy, bind a provider, delegate a
-- negotiating limit, agree. And a plan may never perform one on their behalf.
--
--   APPROVAL != CLICK
--   MODEL PROPOSES != RUNTIME PERFORMS
--
-- So the row below is not "a pending action". It is a STATEMENT the runtime
-- wrote from canonical state, a DIGEST of that statement, and nothing else.
-- Approving cites the digest; if the statement would read differently now, the
-- approval is void. An approval that could outlive the words it was given for
-- is the exact theatre this table exists to prevent.
CREATE TABLE IF NOT EXISTS "authority_requests" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  -- WHICH registered act. Never free text, never a model's sentence.
  "actType" varchar(80) NOT NULL,
  -- The PERSON who must decide. Not the scope: a scope cannot read.
  "principalId" varchar(100) NOT NULL,
  -- On whose authority the act would happen.
  "scopeId" varchar(100) NOT NULL,
  -- The validated parameters, exactly as they will be performed.
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- What the person is shown, rendered by the runtime from the act's DECLARED
  -- fields. Every parameter appears here by construction, so no number can be
  -- left out of what they read.
  "statement" jsonb NOT NULL,
  -- sha256 of the canonical statement. The approval binds to THIS.
  "statementDigest" varchar(64) NOT NULL,
  "state" varchar(24) DEFAULT 'PENDING' NOT NULL,
  -- Why it ended, when it ended badly: STATEMENT_CHANGED, EXPIRED, REJECTED.
  "resolution" varchar(40),
  -- What performing it produced. Recorded so the act is auditable, never so it
  -- can be replayed.
  "result" jsonb,
  "conversationId" varchar(64),
  "expiresAt" timestamp with time zone NOT NULL,
  "decidedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "authority_requests_principal_idx"
  ON "authority_requests" ("principalId", "state");
CREATE INDEX IF NOT EXISTS "authority_requests_scope_idx"
  ON "authority_requests" ("scopeId");
