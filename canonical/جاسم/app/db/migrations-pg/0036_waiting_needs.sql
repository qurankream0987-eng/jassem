-- A NEED THAT KEEPS LOOKING.
--
-- Until now a need was matched only at the moment somebody asked. JASIM could
-- answer «what exists now» and never «tell me when it exists», so every
-- request whose answer had not been published yet simply came back empty and
-- was forgotten.
--
--   A NEED CAN WAIT · ANSWERING_ONLY_WHAT_EXISTS_NOW = 0
--
-- `expiresAt` is NOT NULL on purpose: an unbounded standing scan is a resource
-- nobody authorized.
--
--   WAITING_FOREVER = 0
CREATE TABLE IF NOT EXISTS "waiting_needs" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "needId" varchar(64) NOT NULL,
  "ownerId" varchar(100) NOT NULL,
  "state" varchar(16) NOT NULL DEFAULT 'WAITING',
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "lastSweptAt" timestamp with time zone,
  "lastNotifiedAt" timestamp with time zone,
  "noticesSent" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- One live wait per need. Asking twice is the same wait, not a second scan.
CREATE UNIQUE INDEX IF NOT EXISTS "waiting_needs_need_idx"
  ON "waiting_needs" ("needId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waiting_needs_due_idx"
  ON "waiting_needs" ("state", "expiresAt");
