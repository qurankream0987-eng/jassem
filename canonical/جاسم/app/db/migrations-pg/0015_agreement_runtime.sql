-- JASIM — THE GENERAL AGREEMENT RUNTIME.
--
-- One negotiation mechanism. A salary, a rent, a shipping fee and six hours of
-- laboratory time are the same three tables and differ only in the strings that
-- travel through them.
--
--   Intent != Proposal != Approval != Agreement != Transaction != Fulfillment
--
-- There is no negotiation TYPE column and no subject column. What is being
-- negotiated lives in a term's key, which nothing in the runtime interprets.

-- A party's BOUNDED AUTHORITY inside one engagement.
--
-- «لا تتجاوز 250 دينارًا ولا تخبره بذلك» is two different facts: a limit JASIM
-- may act within, and a secret. This table holds both, owner-scoped, and the
-- counterparty projection is built from named fields so a bound cannot reach it
-- by being added here later.
--
-- Append-only and versioned, like a policy: authority that could be edited in
-- place would let an agreement be re-explained after the fact.
CREATE TABLE IF NOT EXISTS "negotiation_envelopes" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "engagementId" varchar(64) NOT NULL,
  -- The SCOPE this authority belongs to: a person or an organization.
  "ownerId" varchar(100) NOT NULL,
  -- Per term: direction, target, reserve, concession step. The reserve is the
  -- limit. The target is what they would like, and TARGET != AUTHORITY.
  "bounds" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Whether JASIM may counter at all without asking, and whether it may accept
  -- something already inside the reserve. Both default to FALSE: an undeclared
  -- authority is no authority.
  "mayConcede" boolean DEFAULT false NOT NULL,
  "mayAcceptWithinReserve" boolean DEFAULT false NOT NULL,
  "version" integer NOT NULL,
  "state" varchar(16) DEFAULT 'active' NOT NULL,
  -- WHO delegated it. A scope cannot delegate to itself; a person did.
  "setByPrincipalId" varchar(100) NOT NULL,
  "supersedesId" varchar(64),
  "expiresAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "negotiation_envelopes_scope_idx"
  ON "negotiation_envelopes" ("engagementId", "ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "negotiation_envelopes_version_idx"
  ON "negotiation_envelopes" ("engagementId", "ownerId", "version");

-- The agreement itself.
--
-- AGREEMENT != TRANSACTION. Nothing here moves money, books anything or tells
-- anyone. It records that two parties agreed to an exact proposal version, and
-- under WHOSE authority the acceptance happened.
CREATE TABLE IF NOT EXISTS "agreements" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "engagementId" varchar(64) NOT NULL,
  -- Exactly one agreement per accepted proposal version.
  "proposalId" varchar(64) NOT NULL,
  "participants" jsonb NOT NULL,
  -- The terms as they stood at acceptance. A snapshot, never a reference: a
  -- later edit to the proposal must not change what was agreed.
  "terms" jsonb NOT NULL,
  -- OWNER_DIRECT, or the envelope id and version that permitted it. An
  -- agreement that could not say whose authority it rested on would make the
  -- envelope decorative.
  "authorityBasis" jsonb NOT NULL,
  "acceptedByOwnerId" varchar(100) NOT NULL,
  "status" varchar(16) DEFAULT 'agreed' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agreements_proposal_idx" ON "agreements" ("proposalId");
CREATE INDEX IF NOT EXISTS "agreements_engagement_idx" ON "agreements" ("engagementId");

-- What each party owes, as the term sheet DECLARED it.
--
-- Never inferred. A runtime that guessed who owes what from a field name would
-- have acquired a domain in the one place it matters most.
CREATE TABLE IF NOT EXISTS "commitments" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "agreementId" varchar(64) NOT NULL,
  "ownerId" varchar(100) NOT NULL,
  "termKey" varchar(160) NOT NULL,
  "dueAt" timestamp with time zone,
  -- OPEN until something OBSERVES otherwise. A commitment is not fulfillment,
  -- and this column is never advanced by the party who owes it saying so.
  "state" varchar(16) DEFAULT 'open' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "commitments_agreement_idx" ON "commitments" ("agreementId");
CREATE INDEX IF NOT EXISTS "commitments_owner_idx" ON "commitments" ("ownerId");
