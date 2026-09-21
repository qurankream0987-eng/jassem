-- JASIM — THE SECURE PRODUCT ACTION RUNTIME.
--
--   CONVERSATION INITIATES
--   TRUSTED PRODUCT RUNTIME DEFINES
--   TRUSTED SURFACE COLLECTS
--   SERVER VALIDATES
--   POLICY AUTHORIZES
--   RUNTIME MUTATES
--   AUDIT RECORDS
--
-- A person may SAY «غيّر كلمة السر». The conversation carries the intent and
-- nothing else: no password, no token, no recovery secret. The model never
-- becomes the credential handler and never becomes the authority.
--
--   PASSWORD · TOKEN · BIOMETRIC SECRET · PAYMENT CREDENTIAL != LLM CONTEXT
--   AUTHENTICATE != DAG NODE

-- One initiated product action, waiting for a trusted surface to complete it.
--
-- Opaque, server-generated, short-lived and single-use. It names an action the
-- SERVER registered — never a schema a model invented — and it holds no
-- submitted value: a collected secret is used and discarded inside the trusted
-- boundary, and this row records only that something happened.
CREATE TABLE IF NOT EXISTS "product_action_sessions" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  -- WHICH registered action, and at which version. A surface built for v1 may
  -- not submit into v2: the schema it collected under is part of what was
  -- agreed to.
  "actionId" varchar(80) NOT NULL,
  "actionVersion" integer NOT NULL,
  -- The authenticated actor, when there is one. Login and signup have none,
  -- and that is the whole reason this column is nullable rather than the
  -- runtime pretending an anonymous person is somebody.
  "actorId" varchar(100),
  -- The pre-auth caller, so an anonymous login surface still binds to ONE
  -- browser rather than to anybody who guesses an id.
  "anonymousRef" varchar(128),
  "conversationId" varchar(64),
  -- INITIATED · AWAITING_INPUT · AWAITING_CONFIRMATION · EXECUTED · DENIED ·
  -- EXPIRED · CANCELLED · FAILED
  "status" varchar(24) DEFAULT 'INITIATED' NOT NULL,
  -- Whether the person has said yes to the exact consequence they were shown.
  "confirmed" boolean DEFAULT false NOT NULL,
  -- What the person was shown, rendered by the runtime from the registered
  -- schema. Never a sentence a model wrote, and never a submitted value.
  "presentation" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- The non-sensitive part of what was submitted, kept so the act is
  -- auditable. A field the registry marked SENSITIVE never reaches this
  -- column, and a test asserts that with a sentinel.
  "record" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "outcome" varchar(40),
  "expiresAt" timestamp with time zone NOT NULL,
  "completedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "product_action_sessions_actor_idx"
  ON "product_action_sessions" ("actorId", "status");
CREATE INDEX IF NOT EXISTS "product_action_sessions_expiry_idx"
  ON "product_action_sessions" ("expiresAt");

-- Session revocation, which did not exist.
--
-- The session token is a stateless year-long JWT with no id of its own, so the
-- only revocation its design permits is "everything issued for this identity
-- before now". That is a narrower promise than "log out this device", and it
-- is recorded here rather than claimed: logging out by deleting a cookie while
-- a bearer token keeps working is the false success this table exists to end.
CREATE TABLE IF NOT EXISTS "identity_session_revocations" (
  "unionId" varchar(255) PRIMARY KEY NOT NULL,
  "revokedBefore" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "reason" varchar(64) NOT NULL
);
