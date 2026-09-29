-- ENDING AN AGREEMENT IS AN ACT THE TWO PARTIES TAKE.
--
-- `agreements` was APPEND-ONLY: one insert in `commitAgreement`, status set to
-- 'agreed' at birth and never written again anywhere in the runtime. An
-- agreement literally could not end. The note on the `agreement-commit`
-- capability said what was missing, in as many words —
--
--   «An agreement is a fact between two parties. Releasing one is a separate
--    act they both take, not a deletion.»
--
-- — and that act did not exist. `cancelTransaction` is not it: one actor, a
-- reason, and a refusal once anything is verified.
--
--   RELEASING_IS_NOT_UNDOING · WHAT_WAS_VERIFIED_STAYS_VERIFIED
--
-- So this is a PROPOSAL and a RESPONSE, the same shape as the agreement it
-- ends: one party offers, the other accepts, and neither can do both sides.
--
--   AMBIGUOUS_YES_TAKES_THE_CHEAPEST_MEANING = 0
--
-- `discharges` is the load-bearing column. «نتفارق» can mean «nobody owes
-- anybody» or «stop future work, pay me for what is done», and those are
-- materially different agreements to reach. So a proposal NAMES the open
-- obligations it discharges, and the acceptance is acceptance of exactly that
-- list. An obligation nobody named survives the release untouched.
CREATE TABLE IF NOT EXISTS "agreement_releases" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "agreementId" varchar(64) NOT NULL,
  -- Who offered it, and on whose authority. An envelope may agree; it may not
  -- undo.  AN_ENVELOPE_AGREES_IT_DOES_NOT_UNDO
  "proposedByOwnerId" varchar(100) NOT NULL,
  "proposedByPrincipalId" varchar(100) NOT NULL,
  "reason" text NOT NULL,
  -- The obligation ids this release would end, exactly as proposed. Never
  -- widened on acceptance.
  "discharges" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "state" varchar(16) NOT NULL DEFAULT 'PROPOSED',
  "respondedByOwnerId" varchar(100),
  "respondedByPrincipalId" varchar(100),
  "respondedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- At most ONE open offer per agreement. Two live offers would let a party
-- accept the cheaper one while the other still looked open.
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_releases_open_idx"
  ON "agreement_releases" ("agreementId")
  WHERE "state" = 'PROPOSED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_releases_agreement_idx"
  ON "agreement_releases" ("agreementId", "state");
