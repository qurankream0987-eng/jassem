-- JASIM — THE GENERAL TRANSACTION AND FULFILLMENT RUNTIME.
--
--   OPPORTUNITY != PROPOSAL != AGREEMENT != COMMITMENT != TRANSACTION
--   TRANSACTION != PAYMENT != FULFILLMENT != VERIFICATION
--
-- One transaction for every exchange there is. No column below names a buyer,
-- a seller, a purchase or a rental: the parties are a list, what each owes is
-- an obligation, and what is being exchanged lives in a term key nothing in
-- the runtime reads.
--
-- There is no `commitments` table created here because there already is one.
-- An obligation IS a commitment — the thing an Agreement produced from a term
-- that declared who owes what — so it is extended rather than duplicated.

CREATE TABLE IF NOT EXISTS "transactions" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  -- The ACTING SCOPE that materialized it. A person or an organization: this
  -- column has always meant the owner of the row, never a human being.
  "scopeId" varchar(100) NOT NULL,
  -- Every party, as a list. `parties[0]` is not a buyer and `parties[1]` is
  -- not a seller — an Actor is a buyer in one transaction and a provider in
  -- the next, and encoding either as a column would end the open market.
  "parties" jsonb NOT NULL,
  -- Exactly one transaction per committed agreement. This unique index IS the
  -- idempotency: a double click, a retry and a replayed turn all lose the race
  -- rather than creating a second one.
  "agreementId" varchar(64) NOT NULL,
  "proposalId" varchar(64),
  "engagementId" varchar(64),
  -- A SNAPSHOT of what was committed. A later edit to an offering, a price, a
  -- policy or a catalogue must not silently change what was agreed.
  "termsSnapshot" jsonb NOT NULL,
  "termsDigest" varchar(64) NOT NULL,
  -- Where this came from: internal exchange, external discovery, a connected
  -- marketplace, a manual proposal. Provenance travels; execution does not
  -- change because of it.
  "origin" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Which authority and which policy version allowed it, so a decision stays
  -- explainable after both have moved on.
  "authorityBasis" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "policyDecision" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- DERIVED from the obligations, never asserted. Nothing may write SETTLED.
  "state" varchar(24) DEFAULT 'OPEN' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_agreement_idx" ON "transactions" ("agreementId");
CREATE INDEX IF NOT EXISTS "transactions_scope_idx" ON "transactions" ("scopeId", "state");

-- The obligation, which already existed as a commitment.
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "transactionId" varchar(64);
-- Who it is owed TO. Declared by the term, or — with exactly two parties —
-- the other one, which is determinate rather than a guess.
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "beneficiaryActorId" varchar(100);
-- WHAT WOULD PROVE IT. An effect kind from the completion policy's own closed
-- set, so the evidence an obligation needs is decided by the same rules every
-- capability's effect is, and no verifier is written per domain.
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "evidenceKind" varchar(24) DEFAULT 'HUMAN_ACTION' NOT NULL;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "subjectKind" varchar(64);
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "subjectId" varchar(128);
-- CLAIMED_COMPLETE != VERIFIED_COMPLETE. Two columns because they are two
-- facts, and collapsing them is how a system comes to believe a delivery
-- happened because somebody said so.
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "verification" varchar(24) DEFAULT 'PENDING' NOT NULL;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "settlement" jsonb;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "paymentIntentId" varchar(64);
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "terms" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;
CREATE INDEX IF NOT EXISTS "commitments_transaction_idx" ON "commitments" ("transactionId");

-- Binding the payment runtime that already exists, rather than building a
-- second one. Nullable, and named for what it references.
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "transactionId" varchar(64);
CREATE INDEX IF NOT EXISTS "payment_intents_txn_idx" ON "payment_intents" ("transactionId");
