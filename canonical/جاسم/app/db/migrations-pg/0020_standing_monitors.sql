-- JASIM — THE GENERAL MONITORING ENGINE
--
--   CONDITION_MATCHED != USER_NOTIFIED
--   UNKNOWN != ABSENT · UNKNOWN != FALSE
--   LEVEL != EDGE
--
-- No new scheduler: evaluation runs inside the Block 2 sweep, which is itself
-- a durable job that re-enqueues its own next tick. No new observation system:
-- what a monitor reads is a canonical `observations` row or an authorized
-- query. No new event ledger: `events` is the ordered cursor. No new
-- notification truth: a match makes a `notification_intents` row and delivers
-- nothing.
--
-- What did not exist is somewhere to keep WHAT is watched, WHAT counts as a
-- match, and what the LAST evaluation concluded.

CREATE TABLE IF NOT EXISTS "standing_monitors" (
  "id" varchar(64) PRIMARY KEY,
  "scopeId" varchar(64) NOT NULL,
  "createdBy" varchar(100) NOT NULL,
  "conversationId" varchar(64),
  "label" varchar(200) NOT NULL,
  "subjectKind" varchar(64) NOT NULL,
  "subjectId" varchar(64) NOT NULL,
  "observationType" varchar(64) NOT NULL,
  "sourceClass" varchar(24) NOT NULL,
  "condition" jsonb NOT NULL,
  "evaluationMode" varchar(8) NOT NULL DEFAULT 'EDGE',
  "repeatPolicy" varchar(12) NOT NULL DEFAULT 'ONE_SHOT',
  "freshnessRequirement" varchar(8) NOT NULL DEFAULT 'CURRENT',
  "windowMs" integer,
  "pollMs" integer NOT NULL DEFAULT 60000,
  "actionKind" varchar(16) NOT NULL DEFAULT 'NOTIFY',
  "actionChannels" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "state" varchar(16) NOT NULL DEFAULT 'ACTIVE',
  "lastEvaluationAt" timestamptz,
  "lastResult" varchar(8),
  "lastFreshness" varchar(8),
  "lastObservationRef" varchar(64),
  "lastFacts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "lastMatchedAt" timestamptz,
  "triggerCount" integer NOT NULL DEFAULT 0,
  "cursor" bigint NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "standing_monitors_scope_idx"
  ON "standing_monitors" ("scopeId", "state");
CREATE INDEX IF NOT EXISTS "standing_monitors_subject_idx"
  ON "standing_monitors" ("subjectKind", "subjectId", "observationType", "state");
CREATE INDEX IF NOT EXISTS "standing_monitors_due_idx"
  ON "standing_monitors" ("state", "lastEvaluationAt");

CREATE TABLE IF NOT EXISTS "monitor_evaluations" (
  "id" varchar(64) PRIMARY KEY,
  -- The ordered cursor a later realtime transport resumes from. A uuid sorts
  -- by nothing, and "resume from where I was" needs an ordering the database
  -- assigns rather than one a caller hopes for.
  "cursor" bigserial NOT NULL,
  "monitorId" varchar(64) NOT NULL,
  "scopeId" varchar(64) NOT NULL,
  "evaluatedAt" timestamptz NOT NULL DEFAULT now(),
  "sourceClass" varchar(24) NOT NULL,
  "result" varchar(8) NOT NULL,
  "freshness" varchar(8) NOT NULL,
  "transition" varchar(8) NOT NULL DEFAULT 'NONE',
  "triggered" boolean NOT NULL DEFAULT false,
  "observationRef" varchar(64),
  "notificationIntentId" varchar(64),
  "evaluationKey" varchar(200) NOT NULL
);

-- The replay guard. The same observation reaching the same monitor twice
-- collides here rather than triggering twice.
CREATE UNIQUE INDEX IF NOT EXISTS "monitor_evaluations_key_idx"
  ON "monitor_evaluations" ("monitorId", "evaluationKey");
CREATE INDEX IF NOT EXISTS "monitor_evaluations_monitor_idx"
  ON "monitor_evaluations" ("monitorId", "cursor");
CREATE INDEX IF NOT EXISTS "monitor_evaluations_scope_idx"
  ON "monitor_evaluations" ("scopeId", "evaluatedAt");
