CREATE TYPE "public"."agent_logs_status" AS ENUM('started', 'completed', 'failed', 'error');--> statement-breakpoint
CREATE TYPE "public"."bubbles_status" AS ENUM('active', 'inactive', 'dismissed', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."capabilities_riskLevel" AS ENUM('none', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."capability_release_bindings_status" AS ENUM('canary', 'active', 'disabled', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."conversations_status" AS ENUM('active', 'archived', 'closed', 'error');--> statement-breakpoint
CREATE TYPE "public"."core_kernel_baselines_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."core_patch_candidates_risk" AS ENUM('critical');--> statement-breakpoint
CREATE TYPE "public"."core_patch_candidates_status" AS ENUM('submitted', 'evaluating', 'rejected', 'approved_for_build', 'built', 'signed', 'shadow', 'canary', 'active', 'rolled_back', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."core_patch_events_eventType" AS ENUM('submitted', 'gate_recorded', 'transitioned');--> statement-breakpoint
CREATE TYPE "public"."dna_candidates_kind" AS ENUM('knowledge', 'workflow', 'capability', 'policy', 'ui', 'world', 'core_patch');--> statement-breakpoint
CREATE TYPE "public"."dna_candidates_status" AS ENUM('candidate', 'evaluating', 'approved', 'canary', 'active', 'rejected', 'retired');--> statement-breakpoint
CREATE TYPE "public"."dna_versions_kind" AS ENUM('knowledge', 'workflow', 'capability', 'policy', 'ui', 'world');--> statement-breakpoint
CREATE TYPE "public"."dna_versions_status" AS ENUM('canary', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."external_action_ledger_effect" AS ENUM('none', 'read', 'write', 'external_change', 'financial');--> statement-breakpoint
CREATE TYPE "public"."external_action_ledger_status" AS ENUM('prepared', 'executing', 'succeeded', 'failed', 'uncertain', 'reconciling', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."external_webhook_events_status" AS ENUM('received', 'applied', 'unmatched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."generated_systems_continuity" AS ENUM('persistent', 'evolving');--> statement-breakpoint
CREATE TYPE "public"."generated_systems_status" AS ENUM('draft', 'generating', 'active', 'paused', 'deprecated', 'archived');--> statement-breakpoint
CREATE TYPE "public"."generated_systems_visibility" AS ENUM('private', 'public', 'shared');--> statement-breakpoint
CREATE TYPE "public"."identities_type" AS ENUM('user', 'agent', 'system', 'service', 'organization', 'device');--> statement-breakpoint
CREATE TYPE "public"."memory_entries_scope" AS ENUM('global', 'user', 'task', 'conversation', 'entity', 'system');--> statement-breakpoint
CREATE TYPE "public"."messages_role" AS ENUM('user', 'assistant', 'system', 'tool', 'agent');--> statement-breakpoint
CREATE TYPE "public"."policies_scope" AS ENUM('global', 'task', 'capability', 'tool', 'user', 'entity');--> statement-breakpoint
CREATE TYPE "public"."runtime_jobs_status" AS ENUM('queued', 'claimed', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."security_events_result" AS ENUM('allowed', 'denied', 'pending_approval');--> statement-breakpoint
CREATE TYPE "public"."security_events_type" AS ENUM('permission_denied', 'risk_gate_triggered', 'approval_required', 'approval_granted', 'approval_denied', 'policy_violation', 'side_effect_executed', 'authentication_failure', 'suspicious_activity');--> statement-breakpoint
CREATE TYPE "public"."system_versions_status" AS ENUM('draft', 'active', 'retired', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."task_steps_status" AS ENUM('pending', 'running', 'waiting', 'completed', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_steps_type" AS ENUM('action', 'decision', 'approval', 'tool_call', 'agent_call', 'human_input', 'wait', 'compensation', 'error_handler');--> statement-breakpoint
CREATE TYPE "public"."tasks_priority" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."tasks_status" AS ENUM('pending', 'planning', 'running', 'paused', 'waiting_approval', 'waiting_input', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tool_invocations_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."tools_sideEffects" AS ENUM('none', 'read', 'write', 'destructive');--> statement-breakpoint
CREATE TYPE "public"."users_role" AS ENUM('user', 'admin', 'agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."users_status" AS ENUM('active', 'inactive', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "agent_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentId" varchar(100) NOT NULL,
	"taskId" bigint,
	"stepId" bigint,
	"capability" varchar(100),
	"tool" varchar(100),
	"inputs" jsonb,
	"outputs" jsonb,
	"duration" integer,
	"status" "agent_logs_status" DEFAULT 'started' NOT NULL,
	"error" text,
	"tokensUsed" integer DEFAULT 0,
	"cost" double precision DEFAULT 0,
	"model" varchar(100),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"taskId" bigint NOT NULL,
	"stepId" bigint,
	"action" varchar(255) NOT NULL,
	"actor" varchar(255),
	"permission" varchar(100),
	"policy" jsonb,
	"riskLevel" "capabilities_riskLevel" DEFAULT 'low' NOT NULL,
	"required" boolean DEFAULT true,
	"approved" boolean,
	"approvedBy" bigint,
	"approvedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bubbles" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" bigint NOT NULL,
	"taskId" bigint,
	"conversationId" bigint,
	"type" varchar(50) NOT NULL,
	"label" varchar(255) NOT NULL,
	"schema" jsonb,
	"data" jsonb,
	"status" "bubbles_status" DEFAULT 'active' NOT NULL,
	"position" jsonb,
	"mode" varchar(20),
	"semanticDescription" text,
	"activeView" varchar(100) DEFAULT 'default',
	"presentationState" jsonb DEFAULT '{}'::jsonb,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"references" jsonb DEFAULT '[]'::jsonb,
	"worldId" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"version" varchar(20) DEFAULT '1.0.0',
	"inputSchema" jsonb,
	"outputSchema" jsonb,
	"requirements" jsonb,
	"permissions" jsonb,
	"riskLevel" "capabilities_riskLevel" DEFAULT 'low' NOT NULL,
	"sideEffects" jsonb,
	"executionHandler" varchar(255),
	"validationRules" jsonb,
	"metadata" jsonb,
	"isActive" boolean DEFAULT true,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capabilities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "capability_release_bindings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"packageId" varchar(128) NOT NULL,
	"packageVersion" varchar(20) NOT NULL,
	"packageDigest" varchar(64) NOT NULL,
	"capabilityId" varchar(200) NOT NULL,
	"candidateId" varchar(100) NOT NULL,
	"geneVersionId" varchar(100),
	"status" "capability_release_bindings_status" NOT NULL,
	"sandboxProvider" varchar(160) NOT NULL,
	"signingKeyId" varchar(160) NOT NULL,
	"binding" jsonb NOT NULL,
	"envelope" jsonb NOT NULL,
	"storedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" bigint NOT NULL,
	"title" varchar(255),
	"status" "conversations_status" DEFAULT 'active' NOT NULL,
	"context" jsonb,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_kernel_baselines" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"version" varchar(20) NOT NULL,
	"kernelDigest" varchar(64) NOT NULL,
	"manifestDigest" varchar(64) NOT NULL,
	"testSuiteDigest" varchar(64) NOT NULL,
	"artifactRef" varchar(500),
	"status" "core_kernel_baselines_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb NOT NULL,
	"createdBy" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_patch_candidates" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"dnaCandidateId" varchar(100) NOT NULL,
	"baseBaselineId" varchar(100) NOT NULL,
	"targetVersion" varchar(20) NOT NULL,
	"sourceDigest" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"summary" text NOT NULL,
	"risk" "core_patch_candidates_risk" DEFAULT 'critical' NOT NULL,
	"status" "core_patch_candidates_status" DEFAULT 'submitted' NOT NULL,
	"scope" jsonb NOT NULL,
	"declaredEffects" jsonb NOT NULL,
	"testPlan" jsonb NOT NULL,
	"rollbackPlan" jsonb NOT NULL,
	"requiredGates" jsonb NOT NULL,
	"gateResults" jsonb NOT NULL,
	"createdBy" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_patch_events" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"candidateId" varchar(100) NOT NULL,
	"eventType" "core_patch_events_eventType" NOT NULL,
	"previousStatus" varchar(40),
	"nextStatus" varchar(40) NOT NULL,
	"actor" varchar(100) NOT NULL,
	"evidence" jsonb NOT NULL,
	"eventDigest" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dna_candidates" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"sourceDigest" varchar(64) NOT NULL,
	"kind" "dna_candidates_kind" NOT NULL,
	"name" varchar(160) NOT NULL,
	"summary" text NOT NULL,
	"status" "dna_candidates_status" DEFAULT 'candidate' NOT NULL,
	"proposal" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"evaluations" jsonb NOT NULL,
	"approvedBy" varchar(100),
	"approvedAt" timestamp with time zone,
	"rejectionReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dna_execution_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"versionId" varchar(100) NOT NULL,
	"success" boolean NOT NULL,
	"verified" boolean NOT NULL,
	"latencyMs" integer NOT NULL,
	"cost" double precision DEFAULT 0 NOT NULL,
	"safetyIncident" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"recordedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dna_genome_snapshots" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"digest" varchar(64) NOT NULL,
	"geneVersionIds" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dna_versions" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"geneId" varchar(255) NOT NULL,
	"candidateId" varchar(100) NOT NULL,
	"version" varchar(20) NOT NULL,
	"kind" "dna_versions_kind" NOT NULL,
	"status" "dna_versions_status" DEFAULT 'canary' NOT NULL,
	"proposal" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"lineage" jsonb NOT NULL,
	"fitness" jsonb NOT NULL,
	"activatedBy" varchar(100) NOT NULL,
	"activatedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"attributes" jsonb,
	"relationships" jsonb,
	"capabilities" jsonb,
	"identityId" bigint,
	"reputation" jsonb,
	"availability" jsonb,
	"permissions" jsonb,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventType" varchar(100) NOT NULL,
	"filter" jsonb,
	"handler" varchar(255) NOT NULL,
	"active" boolean DEFAULT true,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"source" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" "tasks_priority" DEFAULT 'normal' NOT NULL,
	"processed" boolean DEFAULT false,
	"processedAt" timestamp with time zone,
	"correlationId" varchar(100),
	"ownerId" varchar(255),
	"runId" varchar(64),
	"proposalId" varchar(64),
	"taskRef" varchar(64),
	"message" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"taskId" bigint NOT NULL,
	"stepId" bigint,
	"agentId" varchar(100),
	"capabilityId" bigint,
	"toolId" bigint,
	"inputs" jsonb,
	"outputs" jsonb,
	"duration" integer,
	"status" "tool_invocations_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "external_action_ledger" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"connectorId" varchar(160) NOT NULL,
	"capabilityId" varchar(160) NOT NULL,
	"effect" "external_action_ledger_effect" NOT NULL,
	"taskId" bigint NOT NULL,
	"userId" bigint NOT NULL,
	"planId" varchar(160) NOT NULL,
	"worldId" varchar(160),
	"stepId" varchar(160) NOT NULL,
	"idempotencyKey" varchar(128) NOT NULL,
	"approvalId" varchar(100),
	"inputDigest" varchar(64) NOT NULL,
	"reconciliationData" jsonb NOT NULL,
	"status" "external_action_ledger_status" NOT NULL,
	"providerReference" varchar(255),
	"resultDigest" varchar(64),
	"errorCode" varchar(160),
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextReconcileAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_webhook_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"provider" varchar(100) NOT NULL,
	"connectorId" varchar(160) NOT NULL,
	"eventKey" varchar(255) NOT NULL,
	"eventType" varchar(160) NOT NULL,
	"reference" varchar(255) NOT NULL,
	"payloadDigest" varchar(64) NOT NULL,
	"status" "external_webhook_events_status" NOT NULL,
	"actionId" varchar(64),
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generated_input_secrets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"taskId" bigint NOT NULL,
	"userId" bigint NOT NULL,
	"requestId" varchar(100) NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" varchar(64) NOT NULL,
	"authTag" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_systems" (
	"id" serial PRIMARY KEY NOT NULL,
	"worldKey" varchar(160),
	"name" varchar(255) NOT NULL,
	"description" text,
	"version" varchar(20) DEFAULT '1.0.0',
	"ownerId" bigint NOT NULL,
	"continuity" "generated_systems_continuity",
	"visibility" "generated_systems_visibility" DEFAULT 'private',
	"sourceTaskId" bigint,
	"conversationId" bigint,
	"capabilities" jsonb,
	"schema" jsonb,
	"status" "generated_systems_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb,
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityId" bigint NOT NULL,
	"type" "identities_type" DEFAULT 'user' NOT NULL,
	"credentials" jsonb,
	"verified" boolean DEFAULT false,
	"permissions" jsonb,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"nameAr" varchar(255) NOT NULL,
	"nameEn" varchar(255) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"currencySymbol" varchar(16) NOT NULL,
	"pricingMultiplier" double precision NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" bigint,
	"taskId" bigint,
	"entityId" bigint,
	"scope" "memory_entries_scope" DEFAULT 'global' NOT NULL,
	"category" varchar(50) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb,
	"permissions" jsonb,
	"expiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversationId" bigint NOT NULL,
	"role" "messages_role" NOT NULL,
	"content" text NOT NULL,
	"intent" varchar(100),
	"taskId" bigint,
	"bubbleData" jsonb,
	"outputKind" varchar(50),
	"ownerId" varchar(255),
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"rules" jsonb,
	"scope" "policies_scope" DEFAULT 'global' NOT NULL,
	"priority" integer DEFAULT 0,
	"isActive" boolean DEFAULT true,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "runtime_job_events" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"jobId" varchar(100) NOT NULL,
	"type" varchar(40) NOT NULL,
	"actor" varchar(160) NOT NULL,
	"previousStatus" varchar(40),
	"nextStatus" varchar(40) NOT NULL,
	"detail" jsonb NOT NULL,
	"previousEventDigest" varchar(64),
	"eventDigest" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_jobs" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"kind" varchar(160) NOT NULL,
	"subjectType" varchar(100) NOT NULL,
	"subjectId" varchar(160) NOT NULL,
	"payloadSchemaVersion" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotencyKey" varchar(200) NOT NULL,
	"status" "runtime_jobs_status" NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 3 NOT NULL,
	"timeoutMs" integer DEFAULT 600000 NOT NULL,
	"availableAt" timestamp with time zone NOT NULL,
	"leaseOwner" varchar(160),
	"leaseToken" varchar(160),
	"leaseExpiresAt" timestamp with time zone,
	"cancellationRequestedAt" timestamp with time zone,
	"result" jsonb,
	"errorCode" varchar(160),
	"errorSummary" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"createdBy" varchar(100) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "security_events_type" NOT NULL,
	"userId" varchar(100),
	"capabilityId" varchar(100),
	"toolId" varchar(100),
	"action" varchar(255) NOT NULL,
	"result" "security_events_result" DEFAULT 'allowed' NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"systemId" bigint NOT NULL,
	"version" varchar(20) NOT NULL,
	"status" "system_versions_status" DEFAULT 'draft' NOT NULL,
	"parentVersion" varchar(20),
	"contentDigest" varchar(64),
	"changeRequest" text,
	"requestKey" varchar(128),
	"createdBy" bigint,
	"schema" jsonb,
	"state" jsonb,
	"migration" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"activatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"taskId" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "task_steps_type" DEFAULT 'action' NOT NULL,
	"status" "task_steps_status" DEFAULT 'pending' NOT NULL,
	"dependencies" jsonb,
	"inputs" jsonb,
	"outputs" jsonb,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"error" text,
	"retryCount" integer DEFAULT 0,
	"maxRetries" integer DEFAULT 3,
	"agentId" varchar(100),
	"capabilityId" bigint,
	"toolId" bigint,
	"approvalId" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" bigint NOT NULL,
	"conversationId" bigint,
	"goal" text NOT NULL,
	"intent" varchar(100),
	"context" jsonb,
	"entities" jsonb,
	"constraints" jsonb,
	"collectedData" jsonb,
	"missingData" jsonb,
	"plan" jsonb,
	"status" "tasks_status" DEFAULT 'pending' NOT NULL,
	"priority" "tasks_priority" DEFAULT 'normal' NOT NULL,
	"currentStepId" bigint,
	"capabilities" jsonb,
	"agents" jsonb,
	"tools" jsonb,
	"outputs" jsonb,
	"errors" jsonb,
	"history" jsonb,
	"world" jsonb,
	"actions" jsonb,
	"bubbleId" bigint,
	"worldId" bigint,
	"parentTaskId" bigint,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"toolId" bigint NOT NULL,
	"taskId" bigint,
	"stepId" bigint,
	"inputs" jsonb,
	"outputs" jsonb,
	"status" "tool_invocations_status" DEFAULT 'pending' NOT NULL,
	"duration" integer,
	"error" text,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"inputSchema" jsonb,
	"outputSchema" jsonb,
	"permissions" jsonb,
	"sideEffects" "tools_sideEffects" DEFAULT 'none' NOT NULL,
	"authentication" jsonb,
	"timeout" integer DEFAULT 30000,
	"retryPolicy" jsonb,
	"executor" varchar(255),
	"isActive" boolean DEFAULT true,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"unionId" varchar(255) NOT NULL,
	"name" varchar(255),
	"email" varchar(320),
	"avatar" text,
	"role" "users_role" DEFAULT 'user' NOT NULL,
	"status" "users_status" DEFAULT 'active' NOT NULL,
	"preferences" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_unionId_unique" UNIQUE("unionId")
);
--> statement-breakpoint
CREATE TABLE "action_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taskId" varchar(64) NOT NULL,
	"actionId" varchar(160) NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"response" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_receipts_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "dag_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runId" uuid NOT NULL,
	"ownerId" varchar(255) NOT NULL,
	"upstreamNodeId" uuid NOT NULL,
	"downstreamNodeId" uuid NOT NULL,
	"dependencyType" varchar(40) DEFAULT 'SUCCESS_REQUIRED' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dag_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runId" uuid NOT NULL,
	"ownerId" varchar(255) NOT NULL,
	"nodeKey" varchar(160) NOT NULL,
	"proposalId" uuid,
	"capabilityId" varchar(160),
	"proposalFingerprint" varchar(64),
	"nodeType" varchar(40) DEFAULT 'capability' NOT NULL,
	"status" varchar(40) DEFAULT 'PENDING' NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"maxAttempts" integer DEFAULT 3 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"claimedBy" varchar(160),
	"leaseToken" varchar(160),
	"leaseExpiresAt" timestamp with time zone,
	"fenceVersion" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"failedAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	"lastErrorCode" varchar(120),
	"lastErrorSummary" text,
	"version" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" varchar(255) NOT NULL,
	"conversationId" varchar(64),
	"runId" uuid,
	"bubbleId" varchar(64),
	"worldId" varchar(64),
	"sourceMessageId" varchar(64),
	"intentType" varchar(80) NOT NULL,
	"targetReferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilityId" varchar(160),
	"capabilityVersion" varchar(40),
	"normalizedInputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"riskLevel" varchar(20) NOT NULL,
	"sideEffectType" varchar(40) NOT NULL,
	"policyContext" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policyDecision" varchar(40) NOT NULL,
	"approvalRequired" boolean NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"status" varchar(40) NOT NULL,
	"dependencies" uuid[] DEFAULT '{}' NOT NULL,
	"version" varchar(20) DEFAULT '1' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposalId" uuid NOT NULL,
	"ownerId" varchar(255) NOT NULL,
	"executionFingerprint" varchar(64) NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"decidedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"consumedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" varchar(255) NOT NULL,
	"conversationId" varchar(64),
	"bubbleId" varchar(64),
	"taskId" varchar(64),
	"goal" text NOT NULL,
	"status" varchar(40) NOT NULL,
	"executionGraph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currentState" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requiredCapabilities" text[] DEFAULT '{}' NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"resumeAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dag_dependencies" ADD CONSTRAINT "dag_dependencies_runId_runs_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dag_dependencies" ADD CONSTRAINT "dag_dependencies_upstreamNodeId_dag_nodes_id_fk" FOREIGN KEY ("upstreamNodeId") REFERENCES "public"."dag_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dag_dependencies" ADD CONSTRAINT "dag_dependencies_downstreamNodeId_dag_nodes_id_fk" FOREIGN KEY ("downstreamNodeId") REFERENCES "public"."dag_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dag_nodes" ADD CONSTRAINT "dag_nodes_runId_runs_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dag_nodes" ADD CONSTRAINT "dag_nodes_proposalId_execution_proposals_id_fk" FOREIGN KEY ("proposalId") REFERENCES "public"."execution_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_proposals" ADD CONSTRAINT "execution_proposals_runId_runs_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_approvals" ADD CONSTRAINT "proposal_approvals_proposalId_execution_proposals_id_fk" FOREIGN KEY ("proposalId") REFERENCES "public"."execution_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_logs_agentId_idx" ON "agent_logs" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "agent_logs_taskId_idx" ON "agent_logs" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "agent_logs_stepId_idx" ON "agent_logs" USING btree ("stepId");--> statement-breakpoint
CREATE INDEX "agent_logs_status_idx" ON "agent_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_logs_createdAt_idx" ON "agent_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "approvals_taskId_idx" ON "approvals" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "approvals_stepId_idx" ON "approvals" USING btree ("stepId");--> statement-breakpoint
CREATE INDEX "approvals_approvedBy_idx" ON "approvals" USING btree ("approvedBy");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("approved");--> statement-breakpoint
CREATE INDEX "approvals_expiresAt_idx" ON "approvals" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "bubbles_userId_idx" ON "bubbles" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "bubbles_taskId_idx" ON "bubbles" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "bubbles_conversationId_idx" ON "bubbles" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "bubbles_type_idx" ON "bubbles" USING btree ("type");--> statement-breakpoint
CREATE INDEX "bubbles_status_idx" ON "bubbles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bubbles_worldId_idx" ON "bubbles" USING btree ("worldId");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_name_idx" ON "capabilities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "capabilities_riskLevel_idx" ON "capabilities" USING btree ("riskLevel");--> statement-breakpoint
CREATE INDEX "capabilities_isActive_idx" ON "capabilities" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_release_package_digest_idx" ON "capability_release_bindings" USING btree ("packageDigest");--> statement-breakpoint
CREATE INDEX "capability_release_capability_idx" ON "capability_release_bindings" USING btree ("capabilityId");--> statement-breakpoint
CREATE INDEX "capability_release_status_idx" ON "capability_release_bindings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "capability_release_gene_version_idx" ON "capability_release_bindings" USING btree ("geneVersionId");--> statement-breakpoint
CREATE INDEX "conversations_userId_idx" ON "conversations" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "core_kernel_baselines_version_idx" ON "core_kernel_baselines" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "core_kernel_baselines_digest_idx" ON "core_kernel_baselines" USING btree ("kernelDigest");--> statement-breakpoint
CREATE INDEX "core_kernel_baselines_status_idx" ON "core_kernel_baselines" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "core_patch_candidates_dna_candidate_idx" ON "core_patch_candidates" USING btree ("dnaCandidateId");--> statement-breakpoint
CREATE INDEX "core_patch_candidates_baseline_idx" ON "core_patch_candidates" USING btree ("baseBaselineId");--> statement-breakpoint
CREATE INDEX "core_patch_candidates_status_idx" ON "core_patch_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "core_patch_candidates_source_digest_idx" ON "core_patch_candidates" USING btree ("sourceDigest");--> statement-breakpoint
CREATE INDEX "core_patch_events_candidate_idx" ON "core_patch_events" USING btree ("candidateId");--> statement-breakpoint
CREATE UNIQUE INDEX "core_patch_events_digest_idx" ON "core_patch_events" USING btree ("eventDigest");--> statement-breakpoint
CREATE INDEX "core_patch_events_created_at_idx" ON "core_patch_events" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "dna_candidates_source_digest_idx" ON "dna_candidates" USING btree ("sourceDigest");--> statement-breakpoint
CREATE INDEX "dna_candidates_status_idx" ON "dna_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dna_candidates_kind_idx" ON "dna_candidates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "dna_execution_evidence_version_id_idx" ON "dna_execution_evidence" USING btree ("versionId");--> statement-breakpoint
CREATE INDEX "dna_execution_evidence_recorded_at_idx" ON "dna_execution_evidence" USING btree ("recordedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "dna_genome_snapshots_digest_idx" ON "dna_genome_snapshots" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "dna_versions_gene_id_idx" ON "dna_versions" USING btree ("geneId");--> statement-breakpoint
CREATE INDEX "dna_versions_candidate_id_idx" ON "dna_versions" USING btree ("candidateId");--> statement-breakpoint
CREATE INDEX "dna_versions_status_idx" ON "dna_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "dna_versions_gene_version_idx" ON "dna_versions" USING btree ("geneId","version");--> statement-breakpoint
CREATE INDEX "entities_type_idx" ON "entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "entities_name_idx" ON "entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "entities_identityId_idx" ON "entities" USING btree ("identityId");--> statement-breakpoint
CREATE INDEX "event_subscriptions_eventType_idx" ON "event_subscriptions" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "event_subscriptions_active_idx" ON "event_subscriptions" USING btree ("active");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "events_source_idx" ON "events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "events_processed_idx" ON "events" USING btree ("processed");--> statement-breakpoint
CREATE INDEX "events_priority_idx" ON "events" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "events_correlationId_idx" ON "events" USING btree ("correlationId");--> statement-breakpoint
CREATE INDEX "events_createdAt_idx" ON "events" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "events_ownerId_idx" ON "events" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "events_runId_idx" ON "events" USING btree ("runId","createdAt");--> statement-breakpoint
CREATE INDEX "events_proposalId_idx" ON "events" USING btree ("proposalId","createdAt");--> statement-breakpoint
CREATE INDEX "execution_traces_taskId_idx" ON "execution_traces" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "execution_traces_stepId_idx" ON "execution_traces" USING btree ("stepId");--> statement-breakpoint
CREATE INDEX "execution_traces_agentId_idx" ON "execution_traces" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "execution_traces_capabilityId_idx" ON "execution_traces" USING btree ("capabilityId");--> statement-breakpoint
CREATE INDEX "execution_traces_toolId_idx" ON "execution_traces" USING btree ("toolId");--> statement-breakpoint
CREATE INDEX "execution_traces_timestamp_idx" ON "execution_traces" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "execution_traces_status_idx" ON "execution_traces" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_action_idempotency_idx" ON "external_action_ledger" USING btree ("connectorId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "external_action_status_due_idx" ON "external_action_ledger" USING btree ("status","nextReconcileAt");--> statement-breakpoint
CREATE INDEX "external_action_task_idx" ON "external_action_ledger" USING btree ("taskId");--> statement-breakpoint
CREATE UNIQUE INDEX "external_webhook_provider_event_idx" ON "external_webhook_events" USING btree ("provider","eventKey");--> statement-breakpoint
CREATE INDEX "external_webhook_status_idx" ON "external_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "external_webhook_reference_idx" ON "external_webhook_events" USING btree ("connectorId","reference");--> statement-breakpoint
CREATE INDEX "generated_input_secret_task_user_idx" ON "generated_input_secrets" USING btree ("taskId","userId");--> statement-breakpoint
CREATE INDEX "generated_input_secret_expires_idx" ON "generated_input_secrets" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "generated_systems_ownerId_idx" ON "generated_systems" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "generated_systems_status_idx" ON "generated_systems" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generated_systems_name_idx" ON "generated_systems" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_systems_world_key_idx" ON "generated_systems" USING btree ("ownerId","worldKey");--> statement-breakpoint
CREATE INDEX "generated_systems_conversation_idx" ON "generated_systems" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "identities_entityId_idx" ON "identities" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "identities_type_idx" ON "identities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "identities_verified_idx" ON "identities" USING btree ("verified");--> statement-breakpoint
CREATE INDEX "memory_entries_userId_idx" ON "memory_entries" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "memory_entries_taskId_idx" ON "memory_entries" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "memory_entries_entityId_idx" ON "memory_entries" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "memory_entries_scope_idx" ON "memory_entries" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "memory_entries_category_idx" ON "memory_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "memory_entries_key_idx" ON "memory_entries" USING btree ("key");--> statement-breakpoint
CREATE INDEX "memory_entries_expiresAt_idx" ON "memory_entries" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "messages_conversationId_idx" ON "messages" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "messages_taskId_idx" ON "messages" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "messages_role_idx" ON "messages" USING btree ("role");--> statement-breakpoint
CREATE INDEX "messages_createdAt_idx" ON "messages" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "messages_ownerId_idx" ON "messages" USING btree ("ownerId");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_name_idx" ON "policies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "policies_scope_idx" ON "policies" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "policies_isActive_idx" ON "policies" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "policies_priority_idx" ON "policies" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "runtime_job_events_job_created_idx" ON "runtime_job_events" USING btree ("jobId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_job_events_digest_idx" ON "runtime_job_events" USING btree ("eventDigest");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_jobs_kind_idempotency_idx" ON "runtime_jobs" USING btree ("kind","idempotencyKey");--> statement-breakpoint
CREATE INDEX "runtime_jobs_claim_idx" ON "runtime_jobs" USING btree ("status","availableAt","priority");--> statement-breakpoint
CREATE INDEX "runtime_jobs_lease_idx" ON "runtime_jobs" USING btree ("status","leaseExpiresAt");--> statement-breakpoint
CREATE INDEX "runtime_jobs_subject_idx" ON "runtime_jobs" USING btree ("subjectType","subjectId");--> statement-breakpoint
CREATE INDEX "security_events_type_idx" ON "security_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "security_events_userId_idx" ON "security_events" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "security_events_result_idx" ON "security_events" USING btree ("result");--> statement-breakpoint
CREATE INDEX "security_events_timestamp_idx" ON "security_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "security_events_capabilityId_idx" ON "security_events" USING btree ("capabilityId");--> statement-breakpoint
CREATE INDEX "system_versions_systemId_idx" ON "system_versions" USING btree ("systemId");--> statement-breakpoint
CREATE INDEX "system_versions_version_idx" ON "system_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "system_versions_unique_idx" ON "system_versions" USING btree ("systemId","version");--> statement-breakpoint
CREATE INDEX "system_versions_digest_idx" ON "system_versions" USING btree ("systemId","contentDigest");--> statement-breakpoint
CREATE UNIQUE INDEX "system_versions_request_key_idx" ON "system_versions" USING btree ("systemId","requestKey");--> statement-breakpoint
CREATE INDEX "system_versions_status_idx" ON "system_versions" USING btree ("systemId","status");--> statement-breakpoint
CREATE INDEX "task_steps_taskId_idx" ON "task_steps" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "task_steps_status_idx" ON "task_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_steps_type_idx" ON "task_steps" USING btree ("type");--> statement-breakpoint
CREATE INDEX "task_steps_capabilityId_idx" ON "task_steps" USING btree ("capabilityId");--> statement-breakpoint
CREATE INDEX "task_steps_toolId_idx" ON "task_steps" USING btree ("toolId");--> statement-breakpoint
CREATE INDEX "task_steps_approvalId_idx" ON "task_steps" USING btree ("approvalId");--> statement-breakpoint
CREATE INDEX "tasks_userId_idx" ON "tasks" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "tasks_conversationId_idx" ON "tasks" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_priority_idx" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tasks_parentTaskId_idx" ON "tasks" USING btree ("parentTaskId");--> statement-breakpoint
CREATE INDEX "tasks_currentStepId_idx" ON "tasks" USING btree ("currentStepId");--> statement-breakpoint
CREATE INDEX "tasks_createdAt_idx" ON "tasks" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "tasks_bubbleId_idx" ON "tasks" USING btree ("bubbleId");--> statement-breakpoint
CREATE INDEX "tasks_worldId_idx" ON "tasks" USING btree ("worldId");--> statement-breakpoint
CREATE INDEX "tool_invocations_toolId_idx" ON "tool_invocations" USING btree ("toolId");--> statement-breakpoint
CREATE INDEX "tool_invocations_taskId_idx" ON "tool_invocations" USING btree ("taskId");--> statement-breakpoint
CREATE INDEX "tool_invocations_stepId_idx" ON "tool_invocations" USING btree ("stepId");--> statement-breakpoint
CREATE INDEX "tool_invocations_status_idx" ON "tool_invocations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tool_invocations_createdAt_idx" ON "tool_invocations" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "tools_name_idx" ON "tools" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tools_isActive_idx" ON "tools" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "tools_sideEffects_idx" ON "tools" USING btree ("sideEffects");--> statement-breakpoint
CREATE UNIQUE INDEX "users_unionId_idx" ON "users" USING btree ("unionId");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "dag_dependencies_edge_idx" ON "dag_dependencies" USING btree ("runId","upstreamNodeId","downstreamNodeId");--> statement-breakpoint
CREATE INDEX "dag_dependencies_downstream_idx" ON "dag_dependencies" USING btree ("downstreamNodeId");--> statement-breakpoint
CREATE INDEX "dag_dependencies_owner_idx" ON "dag_dependencies" USING btree ("ownerId");--> statement-breakpoint
CREATE UNIQUE INDEX "dag_nodes_run_key_idx" ON "dag_nodes" USING btree ("runId","nodeKey");--> statement-breakpoint
CREATE INDEX "dag_nodes_owner_idx" ON "dag_nodes" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "dag_nodes_ready_idx" ON "dag_nodes" USING btree ("ownerId","runId","status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "dag_nodes_lease_idx" ON "dag_nodes" USING btree ("status","leaseExpiresAt");--> statement-breakpoint
CREATE INDEX "execution_proposals_owner_idx" ON "execution_proposals" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "execution_proposals_run_idx" ON "execution_proposals" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "execution_proposals_conversation_idx" ON "execution_proposals" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "execution_proposals_fingerprint_idx" ON "execution_proposals" USING btree ("ownerId","fingerprint");--> statement-breakpoint
CREATE INDEX "proposal_approvals_owner_idx" ON "proposal_approvals" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "proposal_approvals_proposal_idx" ON "proposal_approvals" USING btree ("proposalId");--> statement-breakpoint
CREATE INDEX "runs_owner_idx" ON "runs" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "runs_conversation_idx" ON "runs" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "runs_bubble_idx" ON "runs" USING btree ("bubbleId");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_owner_idempotency_idx" ON "runs" USING btree ("ownerId","idempotencyKey");