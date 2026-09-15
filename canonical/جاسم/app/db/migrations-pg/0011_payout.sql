CREATE TABLE IF NOT EXISTS "payouts" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "ownerId" varchar(100) NOT NULL,
  "destinationRef" varchar(191) NOT NULL,
  "amountMinor" numeric(38, 0) NOT NULL,
  "currency" varchar(8) NOT NULL,
  "status" varchar(24) DEFAULT 'REQUESTED' NOT NULL,
  "providerRef" varchar(96),
  "providerReference" varchar(96),
  "idempotencyKey" varchar(191) NOT NULL,
  "approvalRef" varchar(128),
  "version" integer DEFAULT 1 NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_owner_idempotency_idx" ON "payouts" ("ownerId","idempotencyKey");
CREATE INDEX IF NOT EXISTS "payouts_owner_status_idx" ON "payouts" ("ownerId","status");