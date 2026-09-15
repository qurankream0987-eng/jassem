/** Durable storage adapters for Generative DNA. */

import { eq } from "drizzle-orm";
import { db } from "@db/queries/connection";
import {
  dnaCandidates,
  dnaExecutionEvidence,
  dnaGenomeSnapshots,
  dnaVersions,
} from "@db/schema";
import {
  GeneCandidateSchema,
  GeneVersionSchema,
  type GeneCandidate,
  type GeneVersion,
  type GenomeSnapshot,
} from "@contracts/generative-dna";
import type { ExecutionEvidence } from "./dna-version-registry";

export interface DNARepository {
  loadCandidates(): Promise<GeneCandidate[]>;
  loadVersions(): Promise<GeneVersion[]>;
  saveCandidate(candidate: GeneCandidate): Promise<void>;
  saveVersion(version: GeneVersion): Promise<void>;
  saveSnapshot(snapshot: GenomeSnapshot): Promise<void>;
  saveEvidence(versionId: string, evidence: ExecutionEvidence): Promise<void>;
}

export class MemoryDNARepository implements DNARepository {
  private readonly candidates = new Map<string, GeneCandidate>();
  private readonly versions = new Map<string, GeneVersion>();
  readonly snapshots: GenomeSnapshot[] = [];
  readonly evidence: Array<{ versionId: string; evidence: ExecutionEvidence }> = [];

  async loadCandidates(): Promise<GeneCandidate[]> {
    return [...this.candidates.values()].map((item) => structuredClone(item));
  }

  async loadVersions(): Promise<GeneVersion[]> {
    return [...this.versions.values()].map((item) => structuredClone(item));
  }

  async saveCandidate(candidate: GeneCandidate): Promise<void> {
    this.candidates.set(candidate.id, structuredClone(candidate));
  }

  async saveVersion(version: GeneVersion): Promise<void> {
    this.versions.set(version.id, structuredClone(version));
  }

  async saveSnapshot(snapshot: GenomeSnapshot): Promise<void> {
    const existing = this.snapshots.findIndex((item) => item.id === snapshot.id);
    if (existing >= 0) this.snapshots[existing] = structuredClone(snapshot);
    else this.snapshots.push(structuredClone(snapshot));
  }

  async saveEvidence(versionId: string, evidence: ExecutionEvidence): Promise<void> {
    this.evidence.push({ versionId, evidence: structuredClone(evidence) });
  }
}

export class DrizzleDNARepository implements DNARepository {
  async loadCandidates(): Promise<GeneCandidate[]> {
    const rows = await db.select().from(dnaCandidates);
    return rows.map((row) => GeneCandidateSchema.parse({
      id: row.id,
      proposal: row.proposal,
      source: row.source,
      status: row.status,
      warnings: row.warnings,
      evaluations: row.evaluations,
      approvedBy: row.approvedBy ?? undefined,
      approvedAt: row.approvedAt?.toISOString(),
      rejectionReason: row.rejectionReason ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async loadVersions(): Promise<GeneVersion[]> {
    const rows = await db.select().from(dnaVersions);
    return rows.map((row) => GeneVersionSchema.parse({
      id: row.id,
      geneId: row.geneId,
      version: row.version,
      proposal: row.proposal,
      source: row.source,
      status: row.status,
      lineage: row.lineage,
      fitness: row.fitness,
      activatedBy: row.activatedBy,
      activatedAt: row.activatedAt.toISOString(),
    }));
  }

  async saveCandidate(candidate: GeneCandidate): Promise<void> {
    const values = {
      id: candidate.id,
      sourceDigest: candidate.source.digest,
      kind: candidate.proposal.kind,
      name: candidate.proposal.name,
      summary: candidate.proposal.summary,
      status: candidate.status,
      proposal: candidate.proposal,
      source: candidate.source,
      warnings: candidate.warnings,
      evaluations: candidate.evaluations,
      approvedBy: candidate.approvedBy ?? null,
      approvedAt: candidate.approvedAt ? new Date(candidate.approvedAt) : null,
      rejectionReason: candidate.rejectionReason ?? null,
      createdAt: new Date(candidate.createdAt),
      updatedAt: new Date(candidate.updatedAt),
    };
    await db.insert(dnaCandidates).values(values).onDuplicateKeyUpdate({
      set: {
        status: values.status,
        proposal: values.proposal,
        warnings: values.warnings,
        evaluations: values.evaluations,
        approvedBy: values.approvedBy,
        approvedAt: values.approvedAt,
        rejectionReason: values.rejectionReason,
        updatedAt: values.updatedAt,
      },
    });
  }

  async saveVersion(version: GeneVersion): Promise<void> {
    if (version.proposal.kind === "core_patch") {
      throw new Error("Core patches cannot be stored as runtime DNA versions");
    }
    const values = {
      id: version.id,
      geneId: version.geneId,
      candidateId: version.lineage.candidateId,
      version: version.version,
      kind: version.proposal.kind,
      status: version.status,
      proposal: version.proposal,
      source: version.source,
      lineage: version.lineage,
      fitness: version.fitness,
      activatedBy: version.activatedBy,
      activatedAt: new Date(version.activatedAt),
      updatedAt: new Date(),
    };
    await db.insert(dnaVersions).values(values).onDuplicateKeyUpdate({
      set: {
        status: values.status,
        fitness: values.fitness,
        updatedAt: values.updatedAt,
      },
    });
  }

  async saveSnapshot(snapshot: GenomeSnapshot): Promise<void> {
    await db.insert(dnaGenomeSnapshots).values({
      id: snapshot.id,
      digest: snapshot.digest,
      geneVersionIds: snapshot.geneVersionIds,
      createdAt: new Date(snapshot.createdAt),
    }).onDuplicateKeyUpdate({ set: { geneVersionIds: snapshot.geneVersionIds } });
  }

  async saveEvidence(versionId: string, evidence: ExecutionEvidence): Promise<void> {
    await db.insert(dnaExecutionEvidence).values({
      versionId,
      success: evidence.success,
      verified: evidence.verified,
      latencyMs: evidence.latencyMs,
      cost: evidence.cost ?? 0,
      safetyIncident: evidence.safetyIncident ?? false,
    });
  }

  async findCandidateByDigest(digest: string): Promise<GeneCandidate | undefined> {
    const rows = await db.select().from(dnaCandidates).where(eq(dnaCandidates.sourceDigest, digest)).limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return GeneCandidateSchema.parse({
      id: row.id,
      proposal: row.proposal,
      source: row.source,
      status: row.status,
      warnings: row.warnings,
      evaluations: row.evaluations,
      approvedBy: row.approvedBy ?? undefined,
      approvedAt: row.approvedAt?.toISOString(),
      rejectionReason: row.rejectionReason ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}

