/**
 * Versioned DNA registry for the Generative Runtime.
 *
 * This first adapter is intentionally in-memory. Its state machine and safety
 * boundaries are the stable API; a database adapter can replace storage later.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  GeneCandidateSchema,
  GeneProposalSchema,
  type DNASource,
  type GeneCandidate,
  type GeneEvaluation,
  type GeneProposal,
  type GeneVersion,
  type GenomeSnapshot,
} from "@contracts/generative-dna";

export interface SubmitCandidateInput {
  proposal: GeneProposal;
  source: DNASource;
  warnings?: string[];
}

export interface ExecutionEvidence {
  success: boolean;
  verified: boolean;
  latencyMs: number;
  cost?: number;
  safetyIncident?: boolean;
}

export interface CapabilityExecutionRelease {
  bindingId: string;
  packageDigest: string;
  capabilityId: string;
}

export class DNARegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CANDIDATE_NOT_FOUND"
      | "VERSION_NOT_FOUND"
      | "INVALID_TRANSITION"
      | "EVALUATION_REQUIRED"
      | "EXECUTION_RELEASE_REQUIRED"
      | "CORE_LAB_REQUIRED",
  ) {
    super(message);
    this.name = "DNARegistryError";
  }
}

export class DNAVersionRegistry {
  private readonly candidates = new Map<string, GeneCandidate>();
  private readonly versions = new Map<string, GeneVersion>();
  private readonly candidateByDigest = new Map<string, string>();
  private readonly executionReleases = new Map<string, CapabilityExecutionRelease>();

  submitCandidate(input: SubmitCandidateInput): { candidate: GeneCandidate; duplicate: boolean } {
    const proposal = GeneProposalSchema.parse(input.proposal);
    const duplicateId = this.candidateByDigest.get(input.source.digest);
    if (duplicateId) {
      return { candidate: this.clone(this.requireCandidate(duplicateId)), duplicate: true };
    }

    const now = new Date().toISOString();
    const candidate = GeneCandidateSchema.parse({
      id: `dna-candidate-${randomUUID()}`,
      proposal,
      source: input.source,
      status: "candidate",
      warnings: input.warnings ?? [],
      evaluations: [],
      createdAt: now,
      updatedAt: now,
    });

    this.candidates.set(candidate.id, candidate);
    this.candidateByDigest.set(candidate.source.digest, candidate.id);
    return { candidate: this.clone(candidate), duplicate: false };
  }

  listCandidates(): GeneCandidate[] {
    return [...this.candidates.values()].map((candidate) => this.clone(candidate));
  }

  listVersions(): GeneVersion[] {
    return [...this.versions.values()].map((version) => this.clone(version));
  }

  getVersion(id: string): GeneVersion | undefined {
    const version = this.versions.get(id);
    return version ? this.clone(version) : undefined;
  }

  /** Restore durable state at process startup without replaying transitions. */
  hydrate(candidates: GeneCandidate[], versions: GeneVersion[]): void {
    for (const rawCandidate of candidates) {
      const candidate = GeneCandidateSchema.parse(rawCandidate);
      this.candidates.set(candidate.id, candidate);
      this.candidateByDigest.set(candidate.source.digest, candidate.id);
    }
    for (const version of versions) {
      this.versions.set(version.id, this.clone(version));
    }
  }

  getCandidate(id: string): GeneCandidate | undefined {
    const candidate = this.candidates.get(id);
    return candidate ? this.clone(candidate) : undefined;
  }

  recordEvaluation(candidateId: string, evaluation: GeneEvaluation): GeneCandidate {
    const candidate = this.requireCandidate(candidateId);
    if (["active", "rejected", "retired"].includes(candidate.status)) {
      throw new DNARegistryError("A terminal candidate cannot be evaluated", "INVALID_TRANSITION");
    }

    const updated: GeneCandidate = {
      ...candidate,
      status: "evaluating",
      evaluations: [...candidate.evaluations, evaluation],
      updatedAt: new Date().toISOString(),
    };
    this.candidates.set(candidateId, updated);
    return this.clone(updated);
  }

  reviseCandidate(
    candidateId: string,
    revision: Partial<Pick<GeneProposal, "executorRef" | "inputSchema" | "outputSchema" | "dependencies" | "permissions">>,
  ): GeneCandidate {
    const candidate = this.requireCandidate(candidateId);
    if (!["candidate", "evaluating"].includes(candidate.status)) {
      throw new DNARegistryError(`Cannot revise a ${candidate.status} candidate`, "INVALID_TRANSITION");
    }

    const proposal = GeneProposalSchema.parse({ ...candidate.proposal, ...revision });
    const updated: GeneCandidate = {
      ...candidate,
      proposal,
      status: "candidate",
      evaluations: [],
      warnings: [...candidate.warnings, "Candidate revision invalidated prior evaluations."],
      updatedAt: new Date().toISOString(),
    };
    this.candidates.set(candidateId, updated);
    return this.clone(updated);
  }

  approveCandidate(candidateId: string, approvedBy: string): GeneCandidate {
    const candidate = this.requireCandidate(candidateId);
    const latestEvaluation = candidate.evaluations.at(-1);
    if (!latestEvaluation?.passed) {
      throw new DNARegistryError("A passing evaluation is required before approval", "EVALUATION_REQUIRED");
    }
    if (!['candidate', 'evaluating'].includes(candidate.status)) {
      throw new DNARegistryError(`Cannot approve a ${candidate.status} candidate`, "INVALID_TRANSITION");
    }

    const now = new Date().toISOString();
    const updated: GeneCandidate = {
      ...candidate,
      status: "approved",
      approvedBy,
      approvedAt: now,
      updatedAt: now,
    };
    this.candidates.set(candidateId, updated);
    return this.clone(updated);
  }

  /** Called only by the signed binder after verifying an execution-release signature. */
  authorizeCapabilityRelease(candidateId: string, release: CapabilityExecutionRelease): void {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.proposal.kind !== "capability" || candidate.status !== "approved") {
      throw new DNARegistryError("Only an approved capability can receive an execution release", "INVALID_TRANSITION");
    }
    if (!candidate.proposal.executorRef || candidate.proposal.executorRef !== release.capabilityId) {
      throw new DNARegistryError("Execution release does not match the reviewed executor reference", "EXECUTION_RELEASE_REQUIRED");
    }
    if (!/^binding-[a-f0-9]{24}$/.test(release.bindingId) || !/^[a-f0-9]{64}$/.test(release.packageDigest)) {
      throw new DNARegistryError("Execution release identity is malformed", "EXECUTION_RELEASE_REQUIRED");
    }
    this.executionReleases.set(candidateId, structuredClone(release));
  }

  rejectCandidate(candidateId: string, reason: string): GeneCandidate {
    const candidate = this.requireCandidate(candidateId);
    if (["active", "rejected", "retired"].includes(candidate.status)) {
      throw new DNARegistryError(`Cannot reject a ${candidate.status} candidate`, "INVALID_TRANSITION");
    }
    const updated: GeneCandidate = {
      ...candidate,
      status: "rejected",
      rejectionReason: reason,
      updatedAt: new Date().toISOString(),
    };
    this.candidates.set(candidateId, updated);
    return this.clone(updated);
  }

  activateCandidate(
    candidateId: string,
    activatedBy: string,
    options: { version?: string; canary?: boolean; parentVersionIds?: string[]; executionRelease?: CapabilityExecutionRelease } = {},
  ): GeneVersion {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.proposal.kind === "core_patch") {
      throw new DNARegistryError(
        "Core patches must be released by the isolated Core Evolution Lab",
        "CORE_LAB_REQUIRED",
      );
    }
    if (candidate.status !== "approved") {
      throw new DNARegistryError("Only approved candidates can be activated", "INVALID_TRANSITION");
    }
    if (candidate.proposal.kind === "capability" && !candidate.proposal.executorRef) {
      throw new DNARegistryError(
        "Executable capability genes require a reviewed executor reference",
        "INVALID_TRANSITION",
      );
    }
    const authorizedRelease = candidate.proposal.kind === "capability" ? this.executionReleases.get(candidateId) : undefined;
    if (candidate.proposal.kind === "capability" && (!authorizedRelease || !options.executionRelease ||
      authorizedRelease.bindingId !== options.executionRelease.bindingId ||
      authorizedRelease.packageDigest !== options.executionRelease.packageDigest ||
      authorizedRelease.capabilityId !== options.executionRelease.capabilityId)) {
      throw new DNARegistryError(
        "Executable capability genes require a trusted signed execution release",
        "EXECUTION_RELEASE_REQUIRED",
      );
    }

    const now = new Date().toISOString();
    const geneId = this.stableGeneId(candidate.proposal.kind, candidate.proposal.name);
    const version: GeneVersion = {
      id: `dna-version-${randomUUID()}`,
      geneId,
      version: options.version ?? this.nextVersion(geneId),
      proposal: candidate.proposal.kind === "capability"
        ? GeneProposalSchema.parse({
          ...candidate.proposal,
          specification: { ...candidate.proposal.specification, executionRelease: authorizedRelease },
        })
        : candidate.proposal,
      source: candidate.source,
      status: options.canary === false ? "active" : "canary",
      lineage: {
        parentVersionIds: options.parentVersionIds ?? [],
        candidateId: candidate.id,
      },
      fitness: {
        executions: 0,
        verifiedSuccesses: 0,
        failures: 0,
        averageLatencyMs: 0,
        averageCost: 0,
        safetyIncidents: 0,
        score: 0.5,
      },
      activatedBy,
      activatedAt: now,
    };

    this.versions.set(version.id, version);
    this.executionReleases.delete(candidateId);
    this.candidates.set(candidate.id, {
      ...candidate,
      status: version.status,
      updatedAt: now,
    });
    return this.clone(version);
  }

  promoteCanary(versionId: string): GeneVersion {
    const version = this.requireVersion(versionId);
    if (version.status !== "canary") {
      throw new DNARegistryError("Only canary versions can be promoted", "INVALID_TRANSITION");
    }
    const promoted = { ...version, status: "active" as const };
    this.versions.set(versionId, promoted);

    const candidate = this.requireCandidate(version.lineage.candidateId);
    this.candidates.set(candidate.id, {
      ...candidate,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    return this.clone(promoted);
  }

  recordEvidence(versionId: string, evidence: ExecutionEvidence): GeneVersion {
    const version = this.requireVersion(versionId);
    if (version.status === "retired") {
      throw new DNARegistryError("Retired versions cannot receive evidence", "INVALID_TRANSITION");
    }

    const previous = version.fitness;
    const executions = previous.executions + 1;
    const verifiedSuccesses = previous.verifiedSuccesses + (evidence.success && evidence.verified ? 1 : 0);
    const failures = previous.failures + (evidence.success ? 0 : 1);
    const safetyIncidents = previous.safetyIncidents + (evidence.safetyIncident ? 1 : 0);
    const averageLatencyMs = ((previous.averageLatencyMs * previous.executions) + evidence.latencyMs) / executions;
    const averageCost = ((previous.averageCost * previous.executions) + (evidence.cost ?? 0)) / executions;
    const successRate = verifiedSuccesses / executions;
    const safetyRate = safetyIncidents / executions;
    const failureRate = failures / executions;
    const score = Math.max(0, Math.min(1, successRate - safetyRate * 0.75 - failureRate * 0.25));

    const updated: GeneVersion = {
      ...version,
      fitness: {
        executions,
        verifiedSuccesses,
        failures,
        averageLatencyMs,
        averageCost,
        safetyIncidents,
        score,
      },
    };
    this.versions.set(versionId, updated);
    return this.clone(updated);
  }

  createGenomeSnapshot(): GenomeSnapshot {
    const geneVersionIds = [...this.versions.values()]
      .filter((version) => version.status === "active")
      .map((version) => version.id)
      .sort();
    const digest = createHash("sha256").update(geneVersionIds.join("\n")).digest("hex");
    return {
      id: `genome-${digest.slice(0, 16)}`,
      createdAt: new Date().toISOString(),
      geneVersionIds,
      digest,
    };
  }

  private nextVersion(geneId: string): string {
    const versions = [...this.versions.values()].filter((version) => version.geneId === geneId);
    const nextPatch = versions.reduce((max, item) => {
      const patch = Number(item.version.split(".")[2] ?? 0);
      return Math.max(max, Number.isFinite(patch) ? patch : 0);
    }, -1) + 1;
    return `1.0.${nextPatch}`;
  }

  private stableGeneId(kind: string, name: string): string {
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "");
    return `${kind}:${slug || createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
  }

  private requireCandidate(id: string): GeneCandidate {
    const candidate = this.candidates.get(id);
    if (!candidate) throw new DNARegistryError(`Candidate ${id} was not found`, "CANDIDATE_NOT_FOUND");
    return candidate;
  }

  private requireVersion(id: string): GeneVersion {
    const version = this.versions.get(id);
    if (!version) throw new DNARegistryError(`Version ${id} was not found`, "VERSION_NOT_FOUND");
    return version;
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }
}

