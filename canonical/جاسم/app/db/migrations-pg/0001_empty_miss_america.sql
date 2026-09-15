CREATE TABLE "runtime_tasks" (
"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"userId" bigint NOT NULL,
"conversationId" bigint,
"worldId" bigint,
"bubbleId" bigint,
"goal" text NOT NULL,
"status" varchar(40) NOT NULL,
"world" jsonb NOT NULL,
"actions" jsonb NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "runtime_tasks_user_idx" ON "runtime_tasks" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "runtime_tasks_conversation_idx" ON "runtime_tasks" USING btree ("conversationId");--> statement-breakpoint
CREATE INDEX "runtime_tasks_bubble_idx" ON "runtime_tasks" USING btree ("bubbleId");--> statement-breakpoint
CREATE INDEX "runtime_tasks_world_idx" ON "runtime_tasks" USING btree ("worldId");
