-- Phase 2: Execution Attempt Ledger (immutable per-attempt records)
CREATE TABLE "execution_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ownerId" varchar(64) NOT NULL,
  "runId" uuid NOT NULL,
  "nodeId" uuid NOT NULL,
  "nodeKey" varchar(255) NOT NULL,
  "proposalId" uuid,
  "capabilityId" varchar(160) NOT NULL,
  "capabilityVersion" varchar(40),
  "provider" varchar(160),
  "fingerprint" varchar(255) NOT NULL,
  "idempotencyKey" varchar(512) NOT NULL,
  "attemptNumber" integer NOT NULL,
  "leaseToken" varchar(255),
  "fenceVersion" integer NOT NULL DEFAULT 1,
  "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "finishedAt" timestamp with time zone,
  "executionStatus" varchar(40) NOT NULL DEFAULT 'RUNNING',
  "providerReference" varchar(512),
  "normalizedResult" jsonb,
  "normalizedError" jsonb,
  "verificationStatus" varchar(40) NOT NULL DEFAULT 'PENDING',
  "verificationDetail" jsonb,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_idempotencyKey_unique" UNIQUE("idempotencyKey");
--> statement-breakpoint
CREATE INDEX "exec_attempts_run_idx" ON "execution_attempts" USING btree ("runId");
--> statement-breakpoint
CREATE INDEX "exec_attempts_node_idx" ON "execution_attempts" USING btree ("nodeId");
--> statement-breakpoint
CREATE INDEX "exec_attempts_owner_idx" ON "execution_attempts" USING btree ("ownerId");
--> statement-breakpoint
CREATE INDEX "exec_attempts_status_idx" ON "execution_attempts" USING btree ("executionStatus");
--> statement-breakpoint
CREATE INDEX "exec_attempts_idempotency_idx" ON "execution_attempts" USING btree ("idempotencyKey");

-- Phase 5: Conversation Summaries (durable LLM-generated summaries for long contexts)
--> statement-breakpoint
CREATE TABLE "conversation_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversationId" bigint NOT NULL,
  "ownerId" bigint NOT NULL,
  "upToMessageId" bigint NOT NULL,
  "messageCount" integer NOT NULL,
  "summaryText" text NOT NULL,
  "structuredSummary" jsonb NOT NULL,
  "generatedBy" varchar(120),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conv_summaries_conv_idx" ON "conversation_summaries" USING btree ("conversationId");
--> statement-breakpoint
CREATE INDEX "conv_summaries_owner_idx" ON "conversation_summaries" USING btree ("ownerId");
