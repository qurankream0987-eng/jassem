import { z } from "zod";
import { WorldContinuitySchema, WorldDNASchema } from "./dna";

export const GeneratedWorldSystemStatusSchema = z.enum(["draft", "active", "paused", "deprecated", "archived"]);

export const GeneratedWorldSystemSchema = z.object({
  id: z.number().int().positive(),
  worldKey: z.string().min(1),
  /**
   * WHO the world belongs to, as the runtime means it.
   *
   * `ownerId` is the principal who created the row and stays what it always
   * was. A scope is not a person: an organization owns a world through the
   * same `scopeId` every other scoped read and write in this runtime uses, and
   * a personal scope's id is simply the principal's own. Both are here because
   * "who made it" and "whose it is" stopped being the same question when a
   * business became a scope.
   */
  scopeId: z.string().min(1),
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
  /** Defaults to the owner's personal scope, which is their own id. */
  scopeId?: string;
  taskId?: number;
  conversationId?: number;
  changeRequest?: string;
  requestKey?: string;
  forceVersion?: boolean;
  /**
   * The version the caller believed was current.
   *
   * Supplied, it is a PRECONDITION: the commit only lands if the world is
   * still on that version, and a caller working from a stale read is told so
   * instead of quietly winning. Omitted, the commit behaves as it always did —
   * which is why every existing caller keeps working, and why a caller that
   * cares about a lost update has to say so.
   */
  expectedVersion?: string;
}

/** A commit refused because somebody else got there first. */
export class WorldVersionConflictError extends Error {
  readonly currentVersion: string;
  readonly expectedVersion: string;
  constructor(expectedVersion: string, currentVersion: string) {
    super(`World moved to ${currentVersion} while this change was built on ${expectedVersion}.`);
    this.name = "WorldVersionConflictError";
    this.expectedVersion = expectedVersion;
    this.currentVersion = currentVersion;
  }
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
