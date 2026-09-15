import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * Canonical, domain-neutral runtime world. A task can create or work inside a
 * world, but the world is persisted separately so it can outlive that task and
 * evolve without overwriting its history.
 */
export type RuntimeWorldDefinition = {
  id: string;
  schemaVersion: 1;
  version: number;
  name: string;
  description: string;
  continuity: "ephemeral" | "evolving";
  status: "active" | "archived";
  actors: Array<{ id: string; role: string; description?: string }>;
  entities: Array<{
    id: string;
    name: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;
  relationships: Array<{
    id: string;
    fromEntityId: string;
    toEntityId: string;
    type: string;
    attributes: Record<string, unknown>;
  }>;
  collections: Array<{
    id: string;
    name: string;
    entityType: string;
    query?: Record<string, unknown>;
  }>;
  capabilities: string[];
  policies: Array<{ id: string; text: string; enabled: boolean }>;
  permissions: Array<{
    id: string;
    role: string;
    action: string;
    effect: "allow" | "deny";
  }>;
  workflows: Array<{
    id: string;
    kind: string;
    status: string;
    stepIds: string[];
  }>;
  actions: Array<{
    id: string;
    label: string;
    status: string;
    requiresApproval: boolean;
  }>;
  views: Array<{
    id: string;
    type: string;
    title: string;
    config: Record<string, unknown>;
  }>;
  state: Record<string, unknown>;
  transactions: Array<Record<string, unknown>>;
  memory: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
};

export const jasimRuntimeWorlds = pgTable("jasim_runtime_worlds", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  conversationId: text("conversation_id"),
  sourceTaskId: uuid("source_task_id"),
  status: text("status").notNull(),
  version: integer("version").notNull(),
  definition: jsonb("definition").$type<RuntimeWorldDefinition>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const jasimRuntimeWorldVersions = pgTable(
  "jasim_runtime_world_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => jasimRuntimeWorlds.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    changeType: text("change_type").notNull(),
    summary: text("summary").notNull(),
    changeSet: jsonb("change_set").notNull(),
    definition: jsonb("definition").$type<RuntimeWorldDefinition>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("jasim_runtime_world_versions_unique").on(table.worldId, table.version)],
);

export const insertJasimRuntimeWorldSchema = createInsertSchema(
  jasimRuntimeWorlds,
).omit({ createdAt: true, updatedAt: true });

export type InsertJasimRuntimeWorld = z.infer<
  typeof insertJasimRuntimeWorldSchema
>;
export type JasimRuntimeWorld = typeof jasimRuntimeWorlds.$inferSelect;