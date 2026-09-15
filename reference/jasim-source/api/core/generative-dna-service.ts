/** Application service joining assimilation, versioning and durable storage. */

import { randomUUID } from "node:crypto";
import {
  GeneEvaluationSchema,
  type AssimilationArtifact,
  type AssimilationResult,
  type GeneCandidate,
  type GeneEvaluation,
  type GeneKind,
  type GeneProposal,
  type GeneStatus,
  type GeneVersion,
  type GenomeSnapshot,
} from "@contracts/generative-dna";
import { AssimilationEngine } from "./assimilation-engine";
import { MemoryDNAArtifactStore, type DNAArtifactStore } from "./dna-artifact-store";
import type { DNARepository } from "./dna-repository";
import {
  DNAVersionRegistry,
  type CapabilityExecutionRelease,
  type ExecutionEvidence,
} from "./dna-version-registry";

export interface CandidateFilter {
  kind?: GeneKind;
  status?: GeneStatus;
  search?: string;
}

export class GenerativeDNAService {
  private hydration: Promise<void> | undefined;

  constructor(
    private readonly registry: DNAVersionRegistry,
    private readonly assimilation: AssimilationEngine,
    private readonly repository: DNARepository,
    private readonly artifacts: DNAArtifactStore = new MemoryDNAArtifactStore(),
  ) {}

  async initialize(): Promise<void> {
    if (!this.hydration) {
      this.hydration = Promise.all([
        this.repository.loadCandidates(),
        this.repository.loadVersions(),
      ]).then(([candidates, versions]) => {
        this.registry.hydrate(candidates, versions);
      });
    }
    await this.hydration;
  }

  async ingest(artifact: AssimilationArtifact): Promise<AssimilationResult> {
    await this.initialize();
    const stored = await this.artifacts.put(artifact.content, {
      name: artifact.name,
      mediaType: artifact.mediaType,
    });
    const result = this.assimilation.ingest({
      ...artifact,
      uri: stored.uri,
    });
    await this.repository.saveCandidate(result.candidate);
    return result;
  }

  async listCandidates(filter: CandidateFilter = {}): Promise<GeneCandidate[]> {
    await this.initialize();
    const search = filter.search?.trim().toLowerCase();
    return this.registry.listCandidates().filter((candidate) => {
      if (filter.kind && candidate.proposal.kind !== filter.kind) return false;
      if (filter.status && candidate.status !== filter.status) return false;
      if (search) {
        const haystack = `${candidate.proposal.name} ${candidate.proposal.summary} ${candidate.proposal.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  async getCandidate(id: string): Promise<GeneCandidate | undefined> {
    await this.initialize();
    return this.registry.getCandidate(id);
  }

  async getVersion(id: string): Promise<GeneVersion | undefined> {
    await this.initialize();
    return this.registry.getVersion(id);
  }

  async reviseCandidate(
    id: string,
    revision: Partial<Pick<GeneProposal, "executorRef" | "inputSchema" | "outputSchema" | "dependencies" | "permissions">>,
  ): Promise<GeneCandidate> {
    await this.initialize();
    const candidate = this.registry.reviseCandidate(id, revision);
    await this.repository.saveCandidate(candidate);
    return candidate;
  }

  async evaluateCandidate(
    id: string,
    input: Omit<GeneEvaluation, "id" | "evaluatedAt">,
  ): Promise<GeneCandidate> {
    await this.initialize();
    const evaluation = GeneEvaluationSchema.parse({
      ...input,
      id: `dna-evaluation-${randomUUID()}`,
      evaluatedAt: new Date().toISOString(),
    });
    const candidate = this.registry.recordEvaluation(id, evaluation);
    await this.repository.saveCandidate(candidate);
    return candidate;
  }

  async approveCandidate(id: string, actor: string): Promise<GeneCandidate> {
    await this.initialize();
    const candidate = this.registry.approveCandidate(id, actor);
    await this.repository.saveCandidate(candidate);
    return candidate;
  }

  async rejectCandidate(id: string, reason: string): Promise<GeneCandidate> {
    await this.initialize();
    const candidate = this.registry.rejectCandidate(id, reason);
    await this.repository.saveCandidate(candidate);
    return candidate;
  }

  async activateCandidate(
    id: string,
    actor: string,
    options: { version?: string; canary?: boolean; parentVersionIds?: string[]; executionRelease?: CapabilityExecutionRelease } = {},
  ): Promise<GeneVersion> {
    await this.initialize();
    const version = this.registry.activateCandidate(id, actor, options);
    await Promise.all([
      this.repository.saveVersion(version),
      this.saveCurrentCandidate(id),
    ]);
    return version;
  }

  async authorizeCapabilityRelease(candidateId: string, release: CapabilityExecutionRelease): Promise<void> {
    await this.initialize();
    this.registry.authorizeCapabilityRelease(candidateId, release);
  }

  async promoteCanary(versionId: string): Promise<GeneVersion> {
    await this.initialize();
    const version = this.registry.promoteCanary(versionId);
    await Promise.all([
      this.repository.saveVersion(version),
      this.saveCurrentCandidate(version.lineage.candidateId),
    ]);
    return version;
  }

  async recordEvidence(versionId: string, evidence: ExecutionEvidence): Promise<GeneVersion> {
    await this.initialize();
    const version = this.registry.recordEvidence(versionId, evidence);
    await Promise.all([
      this.repository.saveEvidence(versionId, evidence),
      this.repository.saveVersion(version),
    ]);
    return version;
  }

  async createGenomeSnapshot(): Promise<GenomeSnapshot> {
    await this.initialize();
    const snapshot = this.registry.createGenomeSnapshot();
    await this.repository.saveSnapshot(snapshot);
    return snapshot;
  }

  async findActiveGenes(goal: string, kinds?: GeneKind[]): Promise<GeneVersion[]> {
    await this.initialize();
    const terms = new Set(goal.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((term) => term.length >= 3));
    return this.registry.listVersions()
      .filter((version) => version.status === "active")
      .filter((version) => !kinds || kinds.includes(version.proposal.kind))
      .map((version) => {
        const haystack = `${version.proposal.name} ${version.proposal.summary} ${version.proposal.tags.join(" ")}`.toLowerCase();
        const matches = [...terms].filter((term) => haystack.includes(term)).length;
        return { version, score: matches + version.fitness.score };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((match) => match.version);
  }

  private async saveCurrentCandidate(id: string): Promise<void> {
    const candidate = this.registry.getCandidate(id);
    if (candidate) await this.repository.saveCandidate(candidate);
  }
}
