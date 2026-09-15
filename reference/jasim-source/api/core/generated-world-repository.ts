import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../queries/connection";
import { conversations, generatedSystems, systemVersions } from "@db/schema";
import {
  GeneratedWorldSystemSchema,
  GeneratedWorldVersionSchema,
  type GeneratedWorldSystem,
  type GeneratedWorldVersion,
  type WorldChangeOperation,
} from "@contracts/generated-world";
import type { WorldDNA } from "@contracts/dna";

export interface NewGeneratedWorldSystem {
  worldKey: string;
  ownerId: number;
  world: WorldDNA;
  version: string;
  taskId?: number;
  conversationId?: number;
}

export interface NewGeneratedWorldVersion {
  systemId: number;
  version: string;
  status: "draft" | "active";
  world: WorldDNA;
  contentDigest: string;
  parentVersion?: string;
  changeRequest?: string;
  requestKey?: string;
  changes: WorldChangeOperation[];
  createdBy: number;
}

export interface GeneratedWorldRepository {
  findSystem(ownerId: number, worldKey: string): Promise<GeneratedWorldSystem | undefined>;
  getSystem(ownerId: number, systemId: number): Promise<GeneratedWorldSystem | undefined>;
  listSystems(ownerId: number): Promise<GeneratedWorldSystem[]>;
  createSystem(input: NewGeneratedWorldSystem): Promise<GeneratedWorldSystem>;
  updateSystem(systemId: number, update: Partial<Pick<GeneratedWorldSystem, "status" | "version" | "activeWorld" | "archivedAt">>): Promise<void>;
  listVersions(system: GeneratedWorldSystem): Promise<GeneratedWorldVersion[]>;
  findVersionByDigest(system: GeneratedWorldSystem, digest: string): Promise<GeneratedWorldVersion | undefined>;
  findVersionByRequestKey(system: GeneratedWorldSystem, requestKey: string): Promise<GeneratedWorldVersion | undefined>;
  createVersion(input: NewGeneratedWorldVersion): Promise<GeneratedWorldVersion>;
  activateVersion(system: GeneratedWorldSystem, version: GeneratedWorldVersion): Promise<void>;
  attachConversation(ownerId: number, conversationId: number, worldKey?: string): Promise<void>;
  conversationWorld(ownerId: number, conversationId: number): Promise<string | undefined>;
}

export class MemoryGeneratedWorldRepository implements GeneratedWorldRepository {
  private readonly systems = new Map<number, GeneratedWorldSystem>();
  private readonly versions = new Map<number, GeneratedWorldVersion>();
  private readonly conversations = new Map<string, string>();
  private systemSequence = 0;
  private versionSequence = 0;

  async findSystem(ownerId: number, worldKey: string): Promise<GeneratedWorldSystem | undefined> {
    return this.clone([...this.systems.values()].find((item) => item.ownerId === ownerId && item.worldKey === worldKey));
  }

  async getSystem(ownerId: number, systemId: number): Promise<GeneratedWorldSystem | undefined> {
    const item = this.systems.get(systemId);
    return item?.ownerId === ownerId ? this.clone(item) : undefined;
  }

  async listSystems(ownerId: number): Promise<GeneratedWorldSystem[]> {
    return [...this.systems.values()].filter((item) => item.ownerId === ownerId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((item) => structuredClone(item));
  }

  async createSystem(input: NewGeneratedWorldSystem): Promise<GeneratedWorldSystem> {
    if (await this.findSystem(input.ownerId, input.worldKey)) throw new Error("Generated world already exists");
    const now = new Date().toISOString();
    const system = GeneratedWorldSystemSchema.parse({
      id: ++this.systemSequence,
      worldKey: input.worldKey,
      ownerId: input.ownerId,
      name: input.world.name,
      description: input.world.description,
      version: input.version,
      continuity: input.world.continuity,
      visibility: input.world.visibility,
      status: "draft",
      activeWorld: input.world,
      sourceTaskId: input.taskId,
      conversationId: input.conversationId,
      createdAt: now,
      updatedAt: now,
    });
    this.systems.set(system.id, system);
    return structuredClone(system);
  }

  async updateSystem(systemId: number, update: Partial<Pick<GeneratedWorldSystem, "status" | "version" | "activeWorld" | "archivedAt">>): Promise<void> {
    const existing = this.systems.get(systemId);
    if (!existing) throw new Error("Generated world not found");
    this.systems.set(systemId, GeneratedWorldSystemSchema.parse({ ...existing, ...update, updatedAt: new Date().toISOString() }));
  }

  async listVersions(system: GeneratedWorldSystem): Promise<GeneratedWorldVersion[]> {
    return [...this.versions.values()].filter((item) => item.systemId === system.id)
      .sort((left, right) => right.id - left.id).map((item) => structuredClone(item));
  }

  async findVersionByDigest(system: GeneratedWorldSystem, digest: string): Promise<GeneratedWorldVersion | undefined> {
    return this.clone([...this.versions.values()].find((item) => item.systemId === system.id && item.contentDigest === digest));
  }

  async findVersionByRequestKey(system: GeneratedWorldSystem, requestKey: string): Promise<GeneratedWorldVersion | undefined> {
    return this.clone([...this.versions.values()].find((item) => item.systemId === system.id && item.requestKey === requestKey));
  }

  async createVersion(input: NewGeneratedWorldVersion): Promise<GeneratedWorldVersion> {
    const existing = [...this.versions.values()].find((item) => item.systemId === input.systemId &&
      (item.version === input.version || Boolean(input.requestKey && item.requestKey === input.requestKey)));
    if (existing) return structuredClone(existing);
    const created = GeneratedWorldVersionSchema.parse({
      id: ++this.versionSequence,
      ...input,
      createdAt: new Date().toISOString(),
      activatedAt: input.status === "active" ? new Date().toISOString() : undefined,
    });
    this.versions.set(created.id, created);
    return structuredClone(created);
  }

  async activateVersion(system: GeneratedWorldSystem, version: GeneratedWorldVersion): Promise<void> {
    for (const [id, item] of this.versions) {
      if (item.systemId === system.id && item.status === "active" && item.id !== version.id) {
        this.versions.set(id, { ...item, status: "retired" });
      }
    }
    this.versions.set(version.id, { ...version, status: "active", activatedAt: new Date().toISOString() });
    await this.updateSystem(system.id, { status: "active", version: version.version, activeWorld: version.world });
  }

  async attachConversation(ownerId: number, conversationId: number, worldKey?: string): Promise<void> {
    const key = `${ownerId}:${conversationId}`;
    if (worldKey) this.conversations.set(key, worldKey); else this.conversations.delete(key);
  }

  async conversationWorld(ownerId: number, conversationId: number): Promise<string | undefined> {
    return this.conversations.get(`${ownerId}:${conversationId}`);
  }

  private clone<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : structuredClone(value);
  }
}

export class DrizzleGeneratedWorldRepository implements GeneratedWorldRepository {
  async findSystem(ownerId: number, worldKey: string): Promise<GeneratedWorldSystem | undefined> {
    const row = await db.query.generatedSystems.findFirst({ where: and(
      eq(generatedSystems.ownerId, ownerId), eq(generatedSystems.worldKey, worldKey),
    ) });
    return row ? this.toSystem(row) : undefined;
  }

  async getSystem(ownerId: number, systemId: number): Promise<GeneratedWorldSystem | undefined> {
    const row = await db.query.generatedSystems.findFirst({ where: and(
      eq(generatedSystems.ownerId, ownerId), eq(generatedSystems.id, systemId), isNotNull(generatedSystems.worldKey),
    ) });
    return row ? this.toSystem(row) : undefined;
  }

  async listSystems(ownerId: number): Promise<GeneratedWorldSystem[]> {
    const rows = await db.select().from(generatedSystems).where(and(
      eq(generatedSystems.ownerId, ownerId), isNotNull(generatedSystems.worldKey),
    ))
      .orderBy(desc(generatedSystems.updatedAt));
    return rows.map((row) => this.toSystem(row));
  }

  async createSystem(input: NewGeneratedWorldSystem): Promise<GeneratedWorldSystem> {
    const [inserted] = await db.insert(generatedSystems).values({
      worldKey: input.worldKey,
      name: input.world.name,
      description: input.world.description,
      version: input.version,
      ownerId: input.ownerId,
      continuity: input.world.continuity === "ephemeral" ? undefined : input.world.continuity,
      visibility: input.world.visibility,
      sourceTaskId: input.taskId,
      conversationId: input.conversationId,
      capabilities: input.world.capabilities.map((item) => item.capabilityId),
      schema: input.world,
      status: "draft",
      config: { worldKey: input.worldKey, purpose: input.world.purpose },
    }).$returningId();
    const created = await this.getSystem(input.ownerId, Number(inserted.id));
    if (!created) throw new Error("Generated world insert failed");
    return created;
  }

  async updateSystem(systemId: number, update: Partial<Pick<GeneratedWorldSystem, "status" | "version" | "activeWorld" | "archivedAt">>): Promise<void> {
    await db.update(generatedSystems).set({
      status: update.status,
      version: update.version,
      schema: update.activeWorld,
      capabilities: update.activeWorld?.capabilities.map((item) => item.capabilityId),
      archivedAt: update.archivedAt ? new Date(update.archivedAt) : undefined,
      updatedAt: new Date(),
    }).where(eq(generatedSystems.id, systemId));
  }

  async listVersions(system: GeneratedWorldSystem): Promise<GeneratedWorldVersion[]> {
    const rows = await db.select().from(systemVersions).where(eq(systemVersions.systemId, system.id))
      .orderBy(desc(systemVersions.id));
    return rows.map((row) => this.toVersion(row, system.ownerId));
  }

  async findVersionByDigest(system: GeneratedWorldSystem, digest: string): Promise<GeneratedWorldVersion | undefined> {
    const [row] = await db.select().from(systemVersions).where(and(
      eq(systemVersions.systemId, system.id), eq(systemVersions.contentDigest, digest),
    )).orderBy(desc(systemVersions.id)).limit(1);
    return row ? this.toVersion(row, system.ownerId) : undefined;
  }

  async findVersionByRequestKey(system: GeneratedWorldSystem, requestKey: string): Promise<GeneratedWorldVersion | undefined> {
    const row = await db.query.systemVersions.findFirst({ where: and(
      eq(systemVersions.systemId, system.id), eq(systemVersions.requestKey, requestKey),
    ) });
    return row ? this.toVersion(row, system.ownerId) : undefined;
  }

  async createVersion(input: NewGeneratedWorldVersion): Promise<GeneratedWorldVersion> {
    const [inserted] = await db.insert(systemVersions).values({
      systemId: input.systemId,
      version: input.version,
      status: input.status,
      parentVersion: input.parentVersion,
      contentDigest: input.contentDigest,
      changeRequest: input.changeRequest,
      requestKey: input.requestKey,
      createdBy: input.createdBy,
      schema: input.world,
      state: {},
      migration: { fromVersion: input.parentVersion ?? "0.0.0", changes: input.changes, rollback: [] },
      activatedAt: input.status === "active" ? new Date() : undefined,
    }).$returningId();
    const system = await db.query.generatedSystems.findFirst({ where: eq(generatedSystems.id, input.systemId) });
    const row = await db.query.systemVersions.findFirst({ where: eq(systemVersions.id, Number(inserted.id)) });
    if (!system || !row) throw new Error("Generated world version insert failed");
    return this.toVersion(row, system.ownerId);
  }

  async activateVersion(system: GeneratedWorldSystem, version: GeneratedWorldVersion): Promise<void> {
    await db.update(systemVersions).set({ status: "retired" }).where(and(
      eq(systemVersions.systemId, system.id), eq(systemVersions.status, "active"),
    ));
    await db.update(systemVersions).set({ status: "active", activatedAt: new Date() })
      .where(and(eq(systemVersions.systemId, system.id), eq(systemVersions.id, version.id)));
    await this.updateSystem(system.id, { status: "active", version: version.version, activeWorld: version.world });
  }

  async attachConversation(ownerId: number, conversationId: number, worldKey?: string): Promise<void> {
    const conversation = await db.query.conversations.findFirst({ where: and(
      eq(conversations.id, conversationId), eq(conversations.userId, ownerId),
    ) });
    if (!conversation) throw new Error("Conversation not found");
    const context = conversation.context as Record<string, unknown> | null;
    const next = { ...(context ?? {}) };
    if (worldKey) next.activeWorldId = worldKey; else delete next.activeWorldId;
    await db.update(conversations).set({ context: next }).where(eq(conversations.id, conversationId));
  }

  async conversationWorld(ownerId: number, conversationId: number): Promise<string | undefined> {
    const conversation = await db.query.conversations.findFirst({ where: and(
      eq(conversations.id, conversationId), eq(conversations.userId, ownerId),
    ) });
    const context = conversation?.context as Record<string, unknown> | null;
    return typeof context?.activeWorldId === "string" ? context.activeWorldId : undefined;
  }

  private toSystem(row: typeof generatedSystems.$inferSelect): GeneratedWorldSystem {
    const world = row.schema as WorldDNA;
    return GeneratedWorldSystemSchema.parse({
      id: row.id,
      worldKey: row.worldKey ?? String((row.config as Record<string, unknown> | null)?.worldKey ?? `legacy_world_${row.id}`),
      ownerId: row.ownerId,
      name: row.name,
      description: row.description ?? undefined,
      version: row.version ?? world?.version ?? "1.0.0",
      continuity: row.continuity ?? (world?.continuity === "persistent" ? "persistent" : "evolving"),
      visibility: row.visibility ?? world?.visibility ?? "private",
      status: row.status === "generating" ? "draft" : row.status,
      activeWorld: world,
      sourceTaskId: row.sourceTaskId ?? undefined,
      conversationId: row.conversationId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString(),
    });
  }

  private toVersion(row: typeof systemVersions.$inferSelect, ownerId: number): GeneratedWorldVersion {
    const migration = row.migration as { changes?: WorldChangeOperation[] } | null;
    return GeneratedWorldVersionSchema.parse({
      id: row.id,
      systemId: row.systemId,
      version: row.version,
      status: row.status,
      world: row.schema,
      contentDigest: row.contentDigest,
      parentVersion: row.parentVersion ?? undefined,
      changeRequest: row.changeRequest ?? undefined,
      requestKey: row.requestKey ?? undefined,
      changes: migration?.changes ?? [],
      createdBy: row.createdBy ?? ownerId,
      createdAt: row.createdAt.toISOString(),
      activatedAt: row.activatedAt?.toISOString(),
    });
  }
}
