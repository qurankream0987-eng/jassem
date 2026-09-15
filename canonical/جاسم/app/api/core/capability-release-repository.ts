/** Durable metadata for signed releases. Source bytes stay in DNAArtifactStore. */

import { eq } from "drizzle-orm";
import { capabilityReleaseBindings } from "@db/schema";
import { db } from "../queries/connection";
import {
  StoredCapabilityReleaseSchema,
  type SignedCapabilityBinding,
  type StoredCapabilityRelease,
} from "@contracts/capability-sandbox";
import type { CapabilityPackageEnvelope } from "@contracts/capability-package";

export interface CapabilityReleaseRepository {
  list(): Promise<StoredCapabilityRelease[]>;
  save(binding: SignedCapabilityBinding, envelope: CapabilityPackageEnvelope): Promise<StoredCapabilityRelease>;
  updateBinding(binding: SignedCapabilityBinding): Promise<void>;
  delete(bindingId: string): Promise<void>;
}

export class MemoryCapabilityReleaseRepository implements CapabilityReleaseRepository {
  private readonly records = new Map<string, StoredCapabilityRelease>();

  async list(): Promise<StoredCapabilityRelease[]> {
    return [...this.records.values()].map((item) => structuredClone(item));
  }

  async save(binding: SignedCapabilityBinding, envelope: CapabilityPackageEnvelope): Promise<StoredCapabilityRelease> {
    const previous = this.records.get(binding.id);
    if (previous && previous.binding.packageDigest !== binding.packageDigest) throw new Error("Immutable release digest changed");
    const now = new Date().toISOString();
    const record = StoredCapabilityReleaseSchema.parse({
      binding,
      envelope: previous?.envelope ?? envelope,
      storedAt: previous?.storedAt ?? now,
      updatedAt: now,
    });
    this.records.set(binding.id, record);
    return structuredClone(record);
  }

  async updateBinding(binding: SignedCapabilityBinding): Promise<void> {
    const previous = this.records.get(binding.id);
    if (!previous) throw new Error("Capability release record not found");
    await this.save(binding, previous.envelope);
  }

  async delete(bindingId: string): Promise<void> { this.records.delete(bindingId); }
}

export class DrizzleCapabilityReleaseRepository implements CapabilityReleaseRepository {
  async list(): Promise<StoredCapabilityRelease[]> {
    const rows = await db.select().from(capabilityReleaseBindings);
    return rows.map((row) => this.toRecord(row));
  }

  async save(binding: SignedCapabilityBinding, envelope: CapabilityPackageEnvelope): Promise<StoredCapabilityRelease> {
    const values = {
      id: binding.id,
      packageId: binding.packageId,
      packageVersion: binding.packageVersion,
      packageDigest: binding.packageDigest,
      capabilityId: binding.capabilityId,
      candidateId: binding.candidateId,
      geneVersionId: binding.geneVersionId,
      status: binding.status,
      sandboxProvider: binding.sandboxProvider,
      signingKeyId: binding.signingKeyId,
      binding,
      envelope,
    };
    const [existing] = await db.select().from(capabilityReleaseBindings)
      .where(eq(capabilityReleaseBindings.id, binding.id)).limit(1);
    if (existing) {
      if (existing.packageDigest !== binding.packageDigest) throw new Error("Immutable release digest changed");
      await this.updateBinding(binding);
    } else {
      try {
        await db.insert(capabilityReleaseBindings).values(values);
      } catch (error) {
        // A concurrent identical insert is safe; a collision on any other
        // unique key remains a hard failure and cannot mutate an existing row.
        const [concurrent] = await db.select().from(capabilityReleaseBindings)
          .where(eq(capabilityReleaseBindings.id, binding.id)).limit(1);
        if (!concurrent || concurrent.packageDigest !== binding.packageDigest) throw error;
        await this.updateBinding(binding);
      }
    }
    const [row] = await db.select().from(capabilityReleaseBindings).where(eq(capabilityReleaseBindings.id, binding.id)).limit(1);
    if (!row || row.packageDigest !== binding.packageDigest) throw new Error("Durable capability release write conflict");
    return this.toRecord(row);
  }

  async updateBinding(binding: SignedCapabilityBinding): Promise<void> {
    await db.update(capabilityReleaseBindings).set({
      geneVersionId: binding.geneVersionId,
      status: binding.status,
      binding,
      updatedAt: new Date(),
    }).where(eq(capabilityReleaseBindings.id, binding.id));
    const [stored] = await db.select().from(capabilityReleaseBindings)
      .where(eq(capabilityReleaseBindings.id, binding.id)).limit(1);
    if (!stored || stored.packageDigest !== binding.packageDigest || stored.status !== binding.status) {
      throw new Error("Durable capability release state was not persisted");
    }
  }

  async delete(bindingId: string): Promise<void> {
    await db.delete(capabilityReleaseBindings).where(eq(capabilityReleaseBindings.id, bindingId));
  }

  private toRecord(row: typeof capabilityReleaseBindings.$inferSelect): StoredCapabilityRelease {
    return StoredCapabilityReleaseSchema.parse({
      binding: row.binding,
      envelope: row.envelope,
      storedAt: row.storedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
