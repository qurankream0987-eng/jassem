/** Durable, append-only storage boundary for the Core Evolution Lab. */

import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { coreKernelBaselines, corePatchCandidates, corePatchEvents } from "@db/schema";
import {
  CorePatchCandidateSchema,
  CorePatchEventSchema,
  KernelBaselineSchema,
  type CorePatchCandidate,
  type CorePatchEvent,
  type CorePatchGateResult,
  type CorePatchStatus,
  type KernelBaseline,
} from "@contracts/core-evolution";

export interface CoreEvolutionRepository {
  getBaseline(id: string): Promise<KernelBaseline | undefined>;
  insertBaseline(baseline: KernelBaseline): Promise<void>;
  getCandidate(id: string): Promise<CorePatchCandidate | undefined>;
  insertCandidate(candidate: CorePatchCandidate): Promise<void>;
  updateCandidateState(id: string, status: CorePatchStatus, gateResults: CorePatchGateResult[], updatedAt: string): Promise<void>;
  appendEvent(event: CorePatchEvent): Promise<void>;
  listEvents(candidateId: string): Promise<CorePatchEvent[]>;
}

function immutableConflict(kind: string, id: string): Error {
  return new Error(`${kind} ${id} already exists with different immutable content`);
}

export class MemoryCoreEvolutionRepository implements CoreEvolutionRepository {
  private readonly baselines = new Map<string, KernelBaseline>();
  private readonly candidates = new Map<string, CorePatchCandidate>();
  private readonly events = new Map<string, CorePatchEvent>();

  async getBaseline(id: string): Promise<KernelBaseline | undefined> {
    const value = this.baselines.get(id);
    return value ? structuredClone(value) : undefined;
  }

  async insertBaseline(baseline: KernelBaseline): Promise<void> {
    const parsed = KernelBaselineSchema.parse(baseline);
    const existing = this.baselines.get(parsed.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw immutableConflict("Kernel baseline", parsed.id);
      return;
    }
    this.baselines.set(parsed.id, structuredClone(parsed));
  }

  async getCandidate(id: string): Promise<CorePatchCandidate | undefined> {
    const value = this.candidates.get(id);
    return value ? structuredClone(value) : undefined;
  }

  async insertCandidate(candidate: CorePatchCandidate): Promise<void> {
    const parsed = CorePatchCandidateSchema.parse(candidate);
    const existing = this.candidates.get(parsed.id);
    if (existing) {
      const immutableExisting = { ...existing, status: parsed.status, gateResults: parsed.gateResults, updatedAt: parsed.updatedAt };
      if (JSON.stringify(immutableExisting) !== JSON.stringify(parsed)) throw immutableConflict("Core patch", parsed.id);
      return;
    }
    this.candidates.set(parsed.id, structuredClone(parsed));
  }

  async updateCandidateState(id: string, status: CorePatchStatus, gateResults: CorePatchGateResult[], updatedAt: string): Promise<void> {
    const existing = this.candidates.get(id);
    if (!existing) throw new Error(`Core patch ${id} not found`);
    this.candidates.set(id, CorePatchCandidateSchema.parse({ ...existing, status, gateResults, updatedAt }));
  }

  async appendEvent(event: CorePatchEvent): Promise<void> {
    const parsed = CorePatchEventSchema.parse(event);
    const existing = this.events.get(parsed.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw immutableConflict("Core patch event", parsed.id);
      return;
    }
    this.events.set(parsed.id, structuredClone(parsed));
  }

  async listEvents(candidateId: string): Promise<CorePatchEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.candidateId === candidateId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((event) => structuredClone(event));
  }
}

function parseBaseline(row: typeof coreKernelBaselines.$inferSelect): KernelBaseline {
  return KernelBaselineSchema.parse({
    id: row.id,
    version: row.version,
    kernelDigest: row.kernelDigest,
    manifestDigest: row.manifestDigest,
    testSuiteDigest: row.testSuiteDigest,
    artifactRef: row.artifactRef ?? undefined,
    status: row.status,
    metadata: row.metadata,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

function parseCandidate(row: typeof corePatchCandidates.$inferSelect): CorePatchCandidate {
  return CorePatchCandidateSchema.parse({
    id: row.id,
    dnaCandidateId: row.dnaCandidateId,
    baseBaselineId: row.baseBaselineId,
    targetVersion: row.targetVersion,
    sourceDigest: row.sourceDigest,
    title: row.title,
    summary: row.summary,
    risk: row.risk,
    status: row.status,
    scope: row.scope,
    declaredEffects: row.declaredEffects,
    testPlan: row.testPlan,
    rollbackPlan: row.rollbackPlan,
    requiredGates: row.requiredGates,
    gateResults: row.gateResults,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function parseEvent(row: typeof corePatchEvents.$inferSelect): CorePatchEvent {
  return CorePatchEventSchema.parse({
    id: row.id,
    candidateId: row.candidateId,
    eventType: row.eventType,
    previousStatus: row.previousStatus ?? undefined,
    nextStatus: row.nextStatus,
    actor: row.actor,
    evidence: row.evidence,
    eventDigest: row.eventDigest,
    createdAt: row.createdAt.toISOString(),
  });
}

export class DrizzleCoreEvolutionRepository implements CoreEvolutionRepository {
  async getBaseline(id: string): Promise<KernelBaseline | undefined> {
    const rows = await db.select().from(coreKernelBaselines).where(eq(coreKernelBaselines.id, id)).limit(1);
    return rows[0] ? parseBaseline(rows[0]) : undefined;
  }

  async insertBaseline(baseline: KernelBaseline): Promise<void> {
    const parsed = KernelBaselineSchema.parse(baseline);
    const existing = await this.getBaseline(parsed.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(parsed)) throw immutableConflict("Kernel baseline", parsed.id);
      return;
    }
    await db.insert(coreKernelBaselines).values({
      id: parsed.id,
      version: parsed.version,
      kernelDigest: parsed.kernelDigest,
      manifestDigest: parsed.manifestDigest,
      testSuiteDigest: parsed.testSuiteDigest,
      artifactRef: parsed.artifactRef ?? null,
      status: parsed.status,
      metadata: parsed.metadata,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
    });
  }

  async getCandidate(id: string): Promise<CorePatchCandidate | undefined> {
    const rows = await db.select().from(corePatchCandidates).where(eq(corePatchCandidates.id, id)).limit(1);
    return rows[0] ? parseCandidate(rows[0]) : undefined;
  }

  async insertCandidate(candidate: CorePatchCandidate): Promise<void> {
    const parsed = CorePatchCandidateSchema.parse(candidate);
    if (await this.getCandidate(parsed.id)) throw immutableConflict("Core patch", parsed.id);
    await db.insert(corePatchCandidates).values({
      id: parsed.id,
      dnaCandidateId: parsed.dnaCandidateId,
      baseBaselineId: parsed.baseBaselineId,
      targetVersion: parsed.targetVersion,
      sourceDigest: parsed.sourceDigest,
      title: parsed.title,
      summary: parsed.summary,
      risk: parsed.risk,
      status: parsed.status,
      scope: parsed.scope,
      declaredEffects: parsed.declaredEffects,
      testPlan: parsed.testPlan,
      rollbackPlan: parsed.rollbackPlan,
      requiredGates: parsed.requiredGates,
      gateResults: parsed.gateResults,
      createdBy: parsed.createdBy,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    });
  }

  async updateCandidateState(id: string, status: CorePatchStatus, gateResults: CorePatchGateResult[], updatedAt: string): Promise<void> {
    if (!await this.getCandidate(id)) throw new Error(`Core patch ${id} not found`);
    await db.update(corePatchCandidates)
      .set({ status, gateResults, updatedAt: new Date(updatedAt) })
      .where(eq(corePatchCandidates.id, id));
  }

  async appendEvent(event: CorePatchEvent): Promise<void> {
    const parsed = CorePatchEventSchema.parse(event);
    await db.insert(corePatchEvents).values({
      id: parsed.id,
      candidateId: parsed.candidateId,
      eventType: parsed.eventType,
      previousStatus: parsed.previousStatus ?? null,
      nextStatus: parsed.nextStatus,
      actor: parsed.actor,
      evidence: parsed.evidence,
      eventDigest: parsed.eventDigest,
      createdAt: new Date(parsed.createdAt),
    });
  }

  async listEvents(candidateId: string): Promise<CorePatchEvent[]> {
    const rows = await db.select().from(corePatchEvents).where(eq(corePatchEvents.candidateId, candidateId));
    return rows.map(parseEvent).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}
