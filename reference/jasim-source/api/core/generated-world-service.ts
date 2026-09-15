import { createHash } from "node:crypto";
import { WorldDNASchema, type WorldDNA } from "@contracts/dna";
import type {
  GeneratedWorldSystem,
  GeneratedWorldVersion,
  PersistGeneratedWorldInput,
  PersistGeneratedWorldResult,
  WorldChangeOperation,
} from "@contracts/generated-world";
import type { GeneratedWorldRepository } from "./generated-world-repository";

export class GeneratedWorldService {
  constructor(private readonly repository: GeneratedWorldRepository) {}

  async persistApproved(input: PersistGeneratedWorldInput): Promise<PersistGeneratedWorldResult> {
    const proposed = WorldDNASchema.parse({ ...this.object(input.world), ownerId: String(input.ownerId) });
    if (proposed.continuity === "ephemeral") throw new Error("Ephemeral task worlds are not persisted as generated systems");
    const parentKey = proposed.lineage.parentWorldId;
    const worldKey = parentKey ?? proposed.id;
    let system = await this.repository.findSystem(input.ownerId, worldKey);
    // A draft system can be left behind if storage succeeded but activation was
    // interrupted. It has no committed active world yet and must resume 1.0.0.
    const current = system?.status === "draft" ? undefined : system?.activeWorld;
    const normalized = WorldDNASchema.parse({
      ...proposed,
      id: worldKey,
      ownerId: String(input.ownerId),
      continuity: proposed.continuity === "persistent" ? "persistent" : "evolving",
      lineage: {
        ...proposed.lineage,
        parentWorldId: current ? worldKey : proposed.lineage.parentWorldId,
        parentVersion: current?.version ?? proposed.lineage.parentVersion,
        changeRequest: input.changeRequest ?? proposed.lineage.changeRequest,
      },
      updatedAt: new Date().toISOString(),
      createdAt: current?.createdAt ?? proposed.createdAt ?? new Date().toISOString(),
    });
    const changes = current ? this.diff(current, normalized) : [];
    const version = current ? this.nextVersion(current.version, changes) : "1.0.0";
    const versionedWorld = WorldDNASchema.parse({ ...normalized, version });
    const contentDigest = this.semanticDigest(versionedWorld);

    if (!system) {
      system = await this.repository.createSystem({
        worldKey,
        ownerId: input.ownerId,
        world: versionedWorld,
        version,
        taskId: input.taskId,
        conversationId: input.conversationId,
      });
    } else {
      if (system.status === "archived") throw new Error("Archived worlds must be restored before evolution");
      const requested = input.requestKey ? await this.repository.findVersionByRequestKey(system, input.requestKey) : undefined;
      if (requested) {
        const settled = await this.activateDraft(system, requested);
        if (input.conversationId) await this.repository.attachConversation(input.ownerId, input.conversationId, worldKey);
        return this.result(system, settled, false, true, settled.changes);
      }
      const existing = input.forceVersion ? undefined : await this.repository.findVersionByDigest(system, contentDigest);
      // A retired snapshot is history, not the current state. Returning to it
      // must create a new auditable version instead of pretending nothing changed.
      if (existing && (existing.status === "active" || existing.status === "draft")) {
        const settled = await this.activateDraft(system, existing);
        if (input.conversationId) await this.repository.attachConversation(input.ownerId, input.conversationId, worldKey);
        return this.result(system, settled, false, true, settled.changes);
      }
    }

    const createdVersion = await this.repository.createVersion({
      systemId: system.id,
      version,
      status: "draft",
      world: versionedWorld,
      contentDigest,
      parentVersion: current?.version,
      changeRequest: input.changeRequest ?? proposed.lineage.changeRequest,
      requestKey: input.requestKey,
      changes,
      createdBy: input.ownerId,
    });
    await this.repository.activateVersion(system, createdVersion);
    const activated = { ...createdVersion, status: "active" as const, activatedAt: new Date().toISOString() };
    if (input.conversationId) await this.repository.attachConversation(input.ownerId, input.conversationId, worldKey);
    return this.result(system, activated, !current, false, changes);
  }

  async get(ownerId: number, worldKey: string): Promise<GeneratedWorldSystem | undefined> {
    return this.repository.findSystem(ownerId, worldKey);
  }

  async list(ownerId: number): Promise<GeneratedWorldSystem[]> {
    return this.repository.listSystems(ownerId);
  }

  async history(ownerId: number, worldKey: string): Promise<GeneratedWorldVersion[]> {
    const system = await this.requireSystem(ownerId, worldKey);
    return this.repository.listVersions(system);
  }

  async rollback(ownerId: number, worldKey: string, targetVersion: string, changeRequest: string): Promise<PersistGeneratedWorldResult> {
    const system = await this.requireSystem(ownerId, worldKey);
    const versions = await this.repository.listVersions(system);
    const target = versions.find((item) => item.version === targetVersion);
    if (!target) throw new Error("Target world version not found");
    return this.persistApproved({
      ownerId,
      world: {
        ...target.world,
        version: system.version,
        lineage: { parentWorldId: worldKey, parentVersion: system.version, changeRequest },
      },
      changeRequest,
      requestKey: `rollback:${system.id}:${system.version}:${target.version}`,
      forceVersion: true,
    });
  }

  async archive(ownerId: number, worldKey: string): Promise<void> {
    const system = await this.requireSystem(ownerId, worldKey);
    await this.repository.updateSystem(system.id, { status: "archived", archivedAt: new Date().toISOString() });
  }

  async attachConversation(ownerId: number, conversationId: number, worldKey?: string): Promise<void> {
    if (worldKey) await this.requireSystem(ownerId, worldKey);
    await this.repository.attachConversation(ownerId, conversationId, worldKey);
  }

  async conversationWorld(ownerId: number, conversationId: number): Promise<WorldDNA | undefined> {
    const worldKey = await this.repository.conversationWorld(ownerId, conversationId);
    if (!worldKey) return undefined;
    return (await this.repository.findSystem(ownerId, worldKey))?.activeWorld;
  }

  async hasDigest(ownerId: number, worldKey: string, digest: string): Promise<GeneratedWorldVersion | undefined> {
    const system = await this.repository.findSystem(ownerId, worldKey);
    return system ? this.repository.findVersionByDigest(system, digest) : undefined;
  }

  async hasRequestKey(ownerId: number, worldKey: string, requestKey: string): Promise<GeneratedWorldVersion | undefined> {
    const system = await this.repository.findSystem(ownerId, worldKey);
    return system ? this.repository.findVersionByRequestKey(system, requestKey) : undefined;
  }

  worldDigest(world: unknown): string {
    return this.semanticDigest(WorldDNASchema.parse(world));
  }

  private async requireSystem(ownerId: number, worldKey: string): Promise<GeneratedWorldSystem> {
    const system = await this.repository.findSystem(ownerId, worldKey);
    if (!system) throw new Error("Generated world not found");
    return system;
  }

  private async activateDraft(system: GeneratedWorldSystem, version: GeneratedWorldVersion): Promise<GeneratedWorldVersion> {
    if (version.status !== "draft") return version;
    await this.repository.activateVersion(system, version);
    return { ...version, status: "active", activatedAt: new Date().toISOString() };
  }

  private result(
    system: GeneratedWorldSystem,
    version: GeneratedWorldVersion,
    created: boolean,
    unchanged: boolean,
    changes: WorldChangeOperation[],
  ): PersistGeneratedWorldResult {
    return { worldId: system.worldKey, systemId: system.id, versionId: version.id, version: version.version,
      status: "active", created, unchanged, changes };
  }

  private nextVersion(current: string, changes: WorldChangeOperation[]): string {
    const [major, minor, patch] = current.split(".").map(Number);
    const breaking = changes.some((change) => change.operation === "remove" &&
      /^\/(entities|capabilities|workflows|policies)(\/|$)/.test(change.path));
    const additive = changes.some((change) => change.operation === "add" &&
      /^\/(entities|capabilities|workflows|participants|ui)(\/|$)/.test(change.path));
    return breaking ? `${major + 1}.0.0` : additive ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  }

  private diff(before: unknown, after: unknown, path = "", output: WorldChangeOperation[] = []): WorldChangeOperation[] {
    if (output.length >= 500) return output;
    if (this.canonical(before) === this.canonical(after)) return output;
    if (Array.isArray(before) && Array.isArray(after)) {
      const beforeKeys = before.map((item) => this.collectionKey(item));
      const afterKeys = after.map((item) => this.collectionKey(item));
      if (beforeKeys.every(Boolean) && afterKeys.every(Boolean)) {
        const beforeMap = new Map(before.map((item, index) => [beforeKeys[index]!, item]));
        const afterMap = new Map(after.map((item, index) => [afterKeys[index]!, item]));
        for (const key of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
          const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
          this.diff(beforeMap.get(key), afterMap.get(key), `${path}/${escaped}`, output);
        }
        return output;
      }
    }
    if (Array.isArray(before) || Array.isArray(after)) {
      output.push({ operation: before === undefined ? "add" : after === undefined ? "remove" : "replace", path: path || "/",
        beforeDigest: before === undefined ? undefined : this.digest(before), afterDigest: after === undefined ? undefined : this.digest(after) });
      return output;
    }
    if (this.isObject(before) && this.isObject(after)) {
      for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        this.diff(before[key], after[key], `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, output);
      }
      return output;
    }
    output.push({ operation: before === undefined ? "add" : after === undefined ? "remove" : "replace", path: path || "/",
      beforeDigest: before === undefined ? undefined : this.digest(before), afterDigest: after === undefined ? undefined : this.digest(after) });
    return output;
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(this.canonical(value)).digest("hex");
  }

  private semanticDigest(world: WorldDNA): string {
    const { version: _version, createdAt: _createdAt, updatedAt: _updatedAt, lineage: _lineage,
      generatedFrom: _generatedFrom, confidence: _confidence, ...semantic } = world;
    return this.digest(semantic);
  }

  private canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonical(item)).join(",")}]`;
    if (this.isObject(value)) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${this.canonical(item)}`).join(",")}}`;
    return JSON.stringify(value);
  }

  private object(value: unknown): Record<string, unknown> {
    if (!this.isObject(value)) throw new Error("Generated world must be an object");
    return value;
  }

  private collectionKey(value: unknown): string | undefined {
    if (!this.isObject(value)) return undefined;
    if (typeof value.id === "string") return value.id;
    if (typeof value.role === "string") return `role:${value.role}`;
    if (typeof value.capabilityId === "string") {
      return `capability:${value.capabilityId}:${typeof value.targetEntity === "string" ? value.targetEntity : "world"}`;
    }
    return undefined;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
