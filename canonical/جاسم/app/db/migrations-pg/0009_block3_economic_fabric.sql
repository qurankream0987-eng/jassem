-- JASIM Block 3 — agentic commerce, trusted payment runtime, economic
-- operating system, subscriptions/entitlements. Ten generic tables.
-- Non-destructive; no Block 0/1/1.1/2 state is dropped or altered.
-- Money is always integer minor units (numeric(38,0)) + mandatory currency.

CREATE TABLE "commercial_orders" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"transactionIntentId" varchar(64),
"sellerRef" varchar(128) NOT NULL,
"buyerRef" varchar(128) NOT NULL,
"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
"termsVersion" integer DEFAULT 1 NOT NULL,
"termsFingerprint" varchar(64) NOT NULL,
"status" varchar(24) DEFAULT 'DRAFT' NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"payerRef" varchar(128) NOT NULL,
"payeeRef" varchar(128) NOT NULL,
"amountMinor" numeric(38,0) NOT NULL,
"currency" varchar(8) NOT NULL,
"purpose" varchar(255) NOT NULL,
"transactionIntentId" varchar(64),
"orderId" varchar(64),
"providerConstraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
"paymentMethodRef" varchar(64),
"authorizationRequirement" varchar(32) DEFAULT 'OWNER_APPROVAL' NOT NULL,
"idempotencyKey" varchar(128) NOT NULL,
"risk" varchar(16) DEFAULT 'STANDARD' NOT NULL,
"status" varchar(24) DEFAULT 'CREATED' NOT NULL,
"providerReference" varchar(96),
"expiresAt" timestamp with time zone,
"version" integer DEFAULT 1 NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_method_references" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"provider" varchar(96) NOT NULL,
"methodType" varchar(32) NOT NULL,
"tokenRef" varchar(191) NOT NULL,
"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
"provenance" jsonb NOT NULL,
"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
"expiresAt" timestamp with time zone,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandate_budgets" (
"grantId" varchar(64) PRIMARY KEY NOT NULL,
"currency" varchar(8) NOT NULL,
"budgetMinor" numeric(38,0),
"consumedMinor" numeric(38,0) DEFAULT '0' NOT NULL,
"executionLimit" integer,
"executionsUsed" integer DEFAULT 0 NOT NULL,
"periodKey" varchar(32),
"version" integer DEFAULT 1 NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_ledger_entries" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"kind" varchar(24) NOT NULL,
"party" varchar(128) NOT NULL,
"amountMinor" numeric(38,0) NOT NULL,
"currency" varchar(8) NOT NULL,
"sourceEventType" varchar(96) NOT NULL,
"sourceId" varchar(96) NOT NULL,
"attemptId" varchar(96),
"paymentIntentId" varchar(64),
"feeRuleId" varchar(64),
"feeRuleVersion" integer,
"idempotencyKey" varchar(128) NOT NULL,
"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_rules" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"kind" varchar(24) NOT NULL,
"triggerEventType" varchar(96) NOT NULL,
"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
"version" integer DEFAULT 1 NOT NULL,
"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
"effectiveFrom" timestamp with time zone DEFAULT now() NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"name" varchar(191) NOT NULL,
"priceMinor" numeric(38,0),
"currency" varchar(8),
"cadence" varchar(24) DEFAULT 'MONTHLY' NOT NULL,
"trialPolicy" jsonb DEFAULT '{}'::jsonb NOT NULL,
"entitlementScopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
"usagePolicy" jsonb DEFAULT '{}'::jsonb NOT NULL,
"version" integer DEFAULT 1 NOT NULL,
"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"planId" varchar(64) NOT NULL,
"planVersion" integer NOT NULL,
"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
"periodStart" timestamp with time zone NOT NULL,
"periodEnd" timestamp with time zone NOT NULL,
"cancelAtPeriodEnd" boolean DEFAULT false NOT NULL,
"cancelledAt" timestamp with time zone,
"paymentMethodRef" varchar(64),
"version" integer DEFAULT 1 NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"subjectOwnerId" varchar(100) NOT NULL,
"sourceType" varchar(24) NOT NULL,
"sourceId" varchar(64) NOT NULL,
"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
"quota" jsonb DEFAULT '{}'::jsonb NOT NULL,
"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
"effectiveAt" timestamp with time zone DEFAULT now() NOT NULL,
"expiresAt" timestamp with time zone,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
"id" varchar(64) PRIMARY KEY NOT NULL,
"ownerId" varchar(100) NOT NULL,
"subscriptionId" varchar(64),
"metric" varchar(64) NOT NULL,
"quantity" numeric(30,6) NOT NULL,
"unit" varchar(32) NOT NULL,
"sourceEventKey" varchar(128) NOT NULL,
"periodKey" varchar(32) NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_owner_idempotency_idx" ON "payment_intents" ("ownerId", "idempotencyKey");
--> statement-breakpoint
CREATE INDEX "payment_intents_owner_status_idx" ON "payment_intents" ("ownerId", "status");
--> statement-breakpoint
CREATE INDEX "payment_intents_transaction_idx" ON "payment_intents" ("transactionIntentId");
--> statement-breakpoint
CREATE INDEX "commercial_orders_owner_idx" ON "commercial_orders" ("ownerId", "status");
--> statement-breakpoint
CREATE INDEX "commercial_orders_intent_idx" ON "commercial_orders" ("transactionIntentId");
--> statement-breakpoint
CREATE INDEX "payment_method_refs_owner_idx" ON "payment_method_references" ("ownerId", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_refs_token_idx" ON "payment_method_references" ("provider", "tokenRef");
--> statement-breakpoint
CREATE INDEX "mandate_budgets_period_idx" ON "mandate_budgets" ("grantId", "periodKey");
--> statement-breakpoint
CREATE UNIQUE INDEX "economic_ledger_owner_idempotency_idx" ON "economic_ledger_entries" ("ownerId", "idempotencyKey");
--> statement-breakpoint
CREATE INDEX "economic_ledger_owner_kind_idx" ON "economic_ledger_entries" ("ownerId", "kind");
--> statement-breakpoint
CREATE INDEX "economic_ledger_payment_idx" ON "economic_ledger_entries" ("paymentIntentId");
--> statement-breakpoint
CREATE INDEX "fee_rules_owner_idx" ON "fee_rules" ("ownerId", "status");
--> statement-breakpoint
CREATE INDEX "fee_rules_trigger_idx" ON "fee_rules" ("ownerId", "triggerEventType", "status");
--> statement-breakpoint
CREATE INDEX "plans_owner_idx" ON "plans" ("ownerId", "status");
--> statement-breakpoint
CREATE INDEX "subscriptions_owner_idx" ON "subscriptions" ("ownerId", "status");
--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" ("planId");
--> statement-breakpoint
CREATE INDEX "entitlements_subject_idx" ON "entitlements" ("subjectOwnerId", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_source_scope_idx" ON "entitlements" ("subjectOwnerId", "sourceType", "sourceId");
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_idem_idx" ON "usage_records" ("ownerId", "metric", "sourceEventKey");
--> statement-breakpoint
CREATE INDEX "usage_records_period_idx" ON "usage_records" ("ownerId", "metric", "periodKey");
--> statement-breakpoint
-- Financial checkout binding (§48): a payment-bound external action session.
ALTER TABLE "external_action_sessions" ADD COLUMN "paymentIntentId" varchar(64);
