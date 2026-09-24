-- LIVING OBJECTS
--
-- A durable, authorized HANDLE on a subject a scope is following. It is not the
-- subject, and it never carries the subject's operational truth:
--
--   LIVING_OBJECT != CANONICAL_SUBJECT
--   DUPLICATE_OPERATIONAL_TRUTH = 0
--
-- There is deliberately no status, no title, no progress and no payload column
-- here. Everything a follower is shown is read from the canonical row at
-- projection time, so a living object can never disagree with the thing it
-- points at. What IS stored is follower state — who follows what, since when,
-- why, whether the surface still shows it, and how far this follower has been
-- reconciled.
--
--   SURFACE_EXIT != LIVING_OBJECT_DELETE
--   HIDE != CANCEL · CANCEL != DELETE · RESOLVED != ERASED
--
CREATE TABLE IF NOT EXISTS "living_objects" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  -- The ACTING scope that follows it. An organization's tracked things are the
  -- organization's; a person's own scope does not see them and vice versa.
  "scopeId" varchar(64) NOT NULL,
  "subjectKind" varchar(32) NOT NULL,
  "subjectId" varchar(128) NOT NULL,
  -- FOLLOWING | RESOLVED | RELEASED. None of these touch the subject.
  "followState" varchar(16) NOT NULL DEFAULT 'FOLLOWING',
  -- VISIBLE | HIDDEN. Leaving a surface is a surface fact, nothing more.
  "surfaceState" varchar(16) NOT NULL DEFAULT 'VISIBLE',
  -- Where it came from, so a handle is explainable without re-running a turn.
  "originConversationId" varchar(64),
  "materializedBy" varchar(100) NOT NULL,
  "reason" varchar(32) NOT NULL,
  -- Reconciliation cursor: what this FOLLOWER has already been shown. It is
  -- follower state, not subject state — the subject's own revision is read
  -- from the subject.
  "lastSeenRevision" varchar(120),
  "lastSeenAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

-- One handle per scope per subject. Materialization is idempotent because of
-- this constraint, not because of a check somebody remembered to write.
CREATE UNIQUE INDEX IF NOT EXISTS "living_objects_scope_subject_key"
  ON "living_objects" ("scopeId", "subjectKind", "subjectId");

CREATE INDEX IF NOT EXISTS "living_objects_scope_idx"
  ON "living_objects" ("scopeId", "followState", "surfaceState");

CREATE INDEX IF NOT EXISTS "living_objects_subject_idx"
  ON "living_objects" ("subjectKind", "subjectId");

CREATE INDEX IF NOT EXISTS "living_objects_updated_idx"
  ON "living_objects" ("scopeId", "updatedAt");
