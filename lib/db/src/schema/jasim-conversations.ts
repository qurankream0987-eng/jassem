import { createInsertSchema } from "drizzle-zod";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { jasimRuntimeWorlds } from "./jasim-worlds";

export const jasimConversationStatus = pgEnum("jasim_conversation_status", [
  "active",
  "archived",
]);

export const jasimMessageRole = pgEnum("jasim_message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

export const jasimBubbleMode = pgEnum("jasim_bubble_mode", [
  "ephemeral",
  "interactive",
  "persistent",
]);

export const jasimBubbleStatus = pgEnum("jasim_bubble_status", [
  "active",
  "archived",
]);

export const jasimRuntimeConversations = pgTable(
  "jasim_runtime_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title"),
    status: jasimConversationStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("jasim_runtime_conversations_owner_idx").on(table.ownerId)],
);

export const jasimRuntimeMessages = pgTable(
  "jasim_runtime_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => jasimRuntimeConversations.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    role: jasimMessageRole("role").notNull(),
    content: text("content").notNull(),
    outputKind: text("output_kind"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("jasim_runtime_messages_conversation_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    index("jasim_runtime_messages_owner_idx").on(table.ownerId),
  ],
);

export const jasimRuntimeBubbles = pgTable(
  "jasim_runtime_bubbles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: text("owner_id").notNull(),
    conversationId: uuid("conversation_id").references(
      () => jasimRuntimeConversations.id,
      { onDelete: "set null" },
    ),
    runtimeWorldId: uuid("runtime_world_id").references(
      () => jasimRuntimeWorlds.id,
      { onDelete: "set null" },
    ),
    mode: jasimBubbleMode("mode").notNull(),
    status: jasimBubbleStatus("status").notNull().default("active"),
    title: text("title").notNull(),
    semanticDescription: text("semantic_description").notNull(),
    activeView: text("active_view").notNull().default("default"),
    presentationState: jsonb("presentation_state")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    permissions: jsonb("permissions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    references: jsonb("references")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("jasim_runtime_bubbles_owner_idx").on(table.ownerId),
    index("jasim_runtime_bubbles_conversation_idx").on(table.conversationId),
    index("jasim_runtime_bubbles_world_idx").on(table.runtimeWorldId),
  ],
);

export const insertJasimRuntimeConversationSchema = createInsertSchema(
  jasimRuntimeConversations,
).omit({ id: true, createdAt: true, updatedAt: true });

export const insertJasimRuntimeMessageSchema = createInsertSchema(
  jasimRuntimeMessages,
).omit({ id: true, createdAt: true });

export const insertJasimRuntimeBubbleSchema = createInsertSchema(
  jasimRuntimeBubbles,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertJasimRuntimeConversation = z.infer<
  typeof insertJasimRuntimeConversationSchema
>;
export type InsertJasimRuntimeMessage = z.infer<
  typeof insertJasimRuntimeMessageSchema
>;
export type InsertJasimRuntimeBubble = z.infer<
  typeof insertJasimRuntimeBubbleSchema
>;
export type JasimRuntimeConversation = typeof jasimRuntimeConversations.$inferSelect;
export type JasimRuntimeMessage = typeof jasimRuntimeMessages.$inferSelect;
export type JasimRuntimeBubble = typeof jasimRuntimeBubbles.$inferSelect;