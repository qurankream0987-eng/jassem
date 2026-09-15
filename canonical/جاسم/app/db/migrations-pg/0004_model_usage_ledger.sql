-- Phase 12: immutable model routing, usage, and cost evidence.
CREATE TABLE "jasim_model_usage_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ownerId" varchar(255),
  "conversationId" varchar(64),
  "runId" uuid,
  "nodeId" uuid,
  "attemptId" uuid,
  "purpose" varchar(80) NOT NULL,
  "tier" varchar(8) NOT NULL,
  "provider" varchar(80) NOT NULL,
  "modelId" varchar(160) NOT NULL,
  "inputTokens" integer,
  "cachedInputTokens" integer,
  "outputTokens" integer,
  "reasoningTokens" integer,
  "totalTokens" integer,
  "latencyMs" integer NOT NULL,
  "providerRequestId" varchar(255),
  "estimatedCost" double precision,
  "actualProviderCost" double precision,
  "fallbackUsed" boolean NOT NULL DEFAULT false,
  "fallbackFrom" varchar(255),
  "escalatedFrom" varchar(8),
  "escalationReason" varchar(120),
  "success" boolean NOT NULL,
  "errorCategory" varchar(120),
  "promptVersion" varchar(80) NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "model_usage_owner_idx" ON "jasim_model_usage_ledger" USING btree ("ownerId");
--> statement-breakpoint
CREATE INDEX "model_usage_conversation_idx" ON "jasim_model_usage_ledger" USING btree ("conversationId");
--> statement-breakpoint
CREATE INDEX "model_usage_run_idx" ON "jasim_model_usage_ledger" USING btree ("runId");
--> statement-breakpoint
CREATE INDEX "model_usage_created_idx" ON "jasim_model_usage_ledger" USING btree ("createdAt");