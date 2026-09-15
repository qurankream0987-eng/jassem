CREATE TABLE "capability_provider_catalog" (
	"id" varchar(96) PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"capabilityId" varchar(128),
	"implementationId" varchar(128) NOT NULL,
	"protocol" varchar(32),
	"protocolVersion" varchar(64),
	"trustClass" varchar(32) DEFAULT 'UNTRUSTED_CANDIDATE' NOT NULL,
	"availabilityState" varchar(16) DEFAULT 'UNKNOWN' NOT NULL,
	"availabilityObservedAt" timestamp with time zone,
	"costClass" varchar(16) DEFAULT 'UNKNOWN' NOT NULL,
	"latencyClass" varchar(16) DEFAULT 'UNKNOWN' NOT NULL,
	"ioMetadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"provenance" jsonb NOT NULL,
	"discoveredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"schemaHash" varchar(128),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "capability_provider_catalog_capability_idx" ON "capability_provider_catalog" USING btree ("capabilityId");
