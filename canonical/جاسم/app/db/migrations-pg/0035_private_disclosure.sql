-- WHO WAS TOLD WHERE YOU ARE, AND UNDER WHICH AGREEMENT.
--
-- A private field is released to ONE counterparty, by its owner, because an
-- agreement they are both party to exists. It is not a projection change and
-- it is not a publication.
--
--   AGREEMENT_IS_THE_DISCLOSURE_AUTHORITY · DISCLOSED != PUBLISHED
--
-- `withdrawnAt` stops future reads. It never claims the recipient forgot:
--
--   AGREEMENT_ENDS != DISCLOSURE_UNHAPPENS
CREATE TABLE IF NOT EXISTS "private_disclosures" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "agreementId" varchar(64) NOT NULL,
  "engagementId" varchar(64) NOT NULL,
  "subjectKind" varchar(64) NOT NULL,
  "subjectId" varchar(128) NOT NULL,
  "field" varchar(64) NOT NULL,
  "discloserOwnerId" varchar(100) NOT NULL,
  "recipientOwnerId" varchar(100) NOT NULL,
  "disclosedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawnAt" timestamp with time zone
);
--> statement-breakpoint
-- One live release per (agreement, subject, field, recipient). Releasing twice
-- is the same fact, not a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "private_disclosures_unique_idx"
  ON "private_disclosures" ("agreementId", "subjectKind", "subjectId", "field", "recipientOwnerId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "private_disclosures_subject_idx"
  ON "private_disclosures" ("subjectKind", "subjectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "private_disclosures_recipient_idx"
  ON "private_disclosures" ("recipientOwnerId");
