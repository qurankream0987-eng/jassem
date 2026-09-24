-- CONVERSATIONAL NEEDS
--
-- The canonical, conversation-scoped representation of what somebody currently
-- wants, and of the refinements they have actually established.
--
--   NEED_CONTINUITY != CHAT_HISTORY_AS_TRUTH
--   NEED_CONTINUITY != MODEL_MEMORY
--   NEED_CONTINUITY != LIVING_OBJECT · != WORLD · != RUN · != TRANSACTION
--   NEED_CONTINUITY != USER_PROFILE_MEMORY
--
-- The RUNTIME owns this state. A model may say what changed; it may not say
-- what was already true, and it may not restate the prior goal and have that
-- restatement treated as canonical.
--
-- The columns are the GoalSpec's own fields, because a conversational need IS
-- a goal that outlived its turn — not a second vocabulary for the same thing.
-- There is no field naming a kind of thing, and there must never be one: a
-- meal, a used car, a court interpreter and an idle machine differ in the
-- VALUES of their constraints and in nothing else.
--
--   DOMAIN_NEED_TYPES_ADDED = 0
--
CREATE TABLE IF NOT EXISTS "conversation_needs" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "conversationId" varchar(64) NOT NULL,
  -- The ACTING scope. A person's need is theirs; an organization's is the
  -- organization's, and switching scope does not keep mutating the other one.
  "scopeId" varchar(64) NOT NULL,
  "createdBy" varchar(100) NOT NULL,
  -- What must become true. Prose, because outcomes are not enumerable.
  "outcome" text NOT NULL,
  "constraints" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "preferences" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "assumptions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "unknowns" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ACTIVE · BACKGROUND · RESOLVED · ABANDONED.
  --
  --   TOPIC_SWITCH != NEED_RESOLVED
  --
  -- Turning to something else makes a need BACKGROUND, which is still live and
  -- still resumable. Only an outcome actually reached is RESOLVED.
  "state" varchar(16) NOT NULL DEFAULT 'ACTIVE',
  -- Compare-and-set: two devices refining the same need cannot silently
  -- overwrite one another.
  "revision" integer NOT NULL DEFAULT 1,
  -- When this need was last made current. Resuming moves it; refining does not.
  "lastActivatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

-- Reads are always (conversation, scope) scoped. A need never appears in
-- another conversation because the same person is in both.
CREATE INDEX IF NOT EXISTS "conversation_needs_scope_idx"
  ON "conversation_needs" ("conversationId", "scopeId", "state");

CREATE INDEX IF NOT EXISTS "conversation_needs_current_idx"
  ON "conversation_needs" ("conversationId", "scopeId", "lastActivatedAt");
