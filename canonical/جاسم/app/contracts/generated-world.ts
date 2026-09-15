import { z } from "zod";
import { WorldContinuitySchema, WorldDNASchema } from "./dna";

export const GeneratedWorldSystemStatusSchema = z.enum(["draft", "active", "paused", "deprecated", "archived"]);

export const GeneratedWorldSystemSchema = z.object({
  id: z.number().int().positive(),
  worldKey: z.string().min(1),
  ownerId: z.number().int().positive(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  continuity: WorldContinuitySchema.exclude(["ephemeral"]),
  visibility: z.enum(["private", "public", "shared"]),
  status: GeneratedWorldSystemStatusSchema,
  activeWorld: WorldDNASchema,
  sourceTaskId: z.number().int().positive().optional(),
  conversationId: z.number().int().positive().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
});

export type GeneratedWorldSystem = z.infer<typeof GeneratedWorldSystemSchema>;

export const WorldChangeOperationSchema = z.object({
  operation: z.enum(["add", "remove", "replace"]),
  path: z.string(),
  beforeDigest: z.string().optional(),
  afterDigest: z.string().optional(),
});

export type WorldChangeOperation = z.infer<typeof WorldChangeOperationSchema>;

export const GeneratedWorldVersionStatusSchema = z.enum(["draft", "active", "retired", "rolled_back"]);

export const GeneratedWorldVersionSchema = z.object({
  id: z.number().int().positive(),
  systemId: z.number().int().positive(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: GeneratedWorldVersionStatusSchema,
  world: WorldDNASchema,
  contentDigest: z.string().length(64),
  parentVersion: z.string().optional(),
  changeRequest: z.string().optional(),
  requestKey: z.string().optional(),
  changes: z.array(WorldChangeOperationSchema).default([]),
  createdBy: z.number().int().positive(),
  createdAt: z.string().datetime(),
  activatedAt: z.string().datetime().optional(),
});

export type GeneratedWorldVersion = z.infer<typeof GeneratedWorldVersionSchema>;

export interface PersistGeneratedWorldInput {
  world: unknown;
  ownerId: number;
  taskId?: number;
  conversationId?: number;
  changeRequest?: string;
  requestKey?: string;
  forceVersion?: boolean;
}

export interface PersistGeneratedWorldResult {
  worldId: string;
  systemId: number;
  versionId: number;
  version: string;
  status: "active";
  created: boolean;
  unchanged: boolean;
  changes: WorldChangeOperation[];
}
