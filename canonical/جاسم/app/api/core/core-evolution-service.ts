/** Phase-one lifecycle service for isolated JASIM kernel changes. */

import { createHash, randomUUID } from "node:crypto";
import {
  CorePatchGateResultSchema,
  KernelBaselineSchema,
  SubmitCorePatchSchema,
  type CorePatchCandidate,
  type CorePatchEvent,
  type CorePatchGateResult,
  type CorePatchStatus,
  type KernelBaseline,
  type SubmitCorePatch,
} from "@contracts/core-evolution";
import type { CoreEvolutionRepository } from "./core-evolution-repository";
import type { DNARepository } from "./dna-repository";

export interface CorePatchSource {
  id: string;
  kind: "core_patch";
  sourceDigest: string;
  artifactRef: string;
  status: string;
}

export interface CorePatchSourceProvider {
  get(id: string): Promise<CorePatchSource | undefined>;
}

export class DNARepositoryCorePatchSourceProvider implements CorePatchSourceProvider {
  constructor(private readonly repository: DNARepository) {}

  async get(id: string): Promise<CorePatchSource | undefined> {
    const candidate = (await this.repository.loadCandidates()).find((item) => item.id === id);
    if (!candidate || candidate.proposal.kind !== "core_patch") return undefined;
    return {
      id: candidate.id,
      kind: "core_patch",
      sourceDigest: candidate.source.digest,
      artifactRef: candidate.source.uri ?? `dna-artifact:sha256:${candidate.source.digest}`,
      status: candidate.status,
    };
  }
}

const transitions: Record<CorePatchStatus, CorePatchStatus[]> = {
  submitted: ["evaluating", "rejected", "quarantined"],
  evaluating: ["rejected", "approved_for_build", "quarantined"],
  rejected: [],
  approved_for_build: ["built", "rejected", "quarantined"],
  built: ["signed", "rejected", "quarantined"],
  signed: ["shadow", "rejected", "quarantined"],
  shadow: ["canary", "rolled_back", "quarantined"],
  canary: ["active", "rolled_back", "quarantined"],
  active: ["rolled_back", "quarantined"],
  rolled_back: [],
  quarantined: [],
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export class CoreEvolutionError extends Error {
  constructor(message: string, readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "GATES_INCOMPLETE" | "BASELINE_MISSING" | "SOURCE_INVALID") {
    super(message);
    this.name = "CoreEvolutionError";
  }
}

export class CoreEvolutionService {
  constructor(
    private readonly repository: CoreEvolutionRepository,
    private readonly sources: CorePatchSourceProvider,
  ) {}

  async registerBaseline(input: KernelBaseline): Promise<KernelBaseline> {
    const baseline = KernelBaselineSchema.parse(input);
    await this.repository.insertBaseline(baseline);
    return baseline;
  }

  async getBaseline(id: string): Promise<KernelBaseline | undefined> {
    return this.repository.getBaseline(id);
  }

  async getCandidate(id: string): Promise<CorePatchCandidate | undefined> {
    return this.repository.getCandidate(id);
  }

  async listEvents(candidateId: string): Promise<CorePatchEvent[]> {
    return this.repository.listEvents(candidateId);
  }

  async getApprovedSource(id: string, sourceDigest: string): Promise<CorePatchSource> {
    return this.assertApprovedSource(id, sourceDigest);
  }

  async submit(input: SubmitCorePatch): Promise<CorePatchCandidate> {
    const parsed = SubmitCorePatchSchema.parse(input);
    if (!await this.repository.getBaseline(parsed.baseBaselineId)) {
      throw new CoreEvolutionError(`Kernel baseline ${parsed.baseBaselineId} not found`, "BASELINE_MISSING");
    }
    await this.assertApprovedSource(parsed.dnaCandidateId, parsed.sourceDigest);
    const candidateId = `core_patch_${digest(parsed).slice(0, 24)}`;
    const existing = await this.repository.getCandidate(candidateId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const candidate: CorePatchCandidate = {
      ...parsed,
      id: candidateId,
      risk: "critical",
      status: "submitted",
      gateResults: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.insertCandidate(candidate);
    await this.repository.appendEvent(this.event(candidate, "submitted", parsed.createdBy, undefined, { sourceDigest: parsed.sourceDigest }));
    return candidate;
  }

  async beginEvaluation(candidateId: string, actor: string): Promise<CorePatchCandidate> {
    return this.transition(candidateId, "evaluating", actor, {});
  }

  async recordGate(candidateId: string, result: CorePatchGateResult, actor: string): Promise<CorePatchCandidate> {
    const parsed = CorePatchGateResultSchema.parse(result);
    const candidate = await this.requireCandidate(candidateId);
    if (candidate.status !== "evaluating") {
      throw new CoreEvolutionError("Gate results can only be recorded while evaluating", "INVALID_TRANSITION");
    }
    const gateResults = [...candidate.gateResults.filter((item) => item.gate !== parsed.gate), parsed];
    const updatedAt = new Date().toISOString();
    await this.repository.updateCandidateState(candidate.id, candidate.status, gateResults, updatedAt);
    const updated = { ...candidate, gateResults, updatedAt };
    await this.repository.appendEvent(this.event(updated, "gate_recorded", actor, candidate.status, {
      gate: parsed.gate,
      passed: parsed.passed,
      evidenceRefs: parsed.evidenceRefs,
    }));
    return updated;
  }

  async approveForBuild(candidateId: string, actor: string): Promise<CorePatchCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    await this.assertApprovedSource(candidate.dnaCandidateId, candidate.sourceDigest);
    const results = new Map(candidate.gateResults.map((result) => [result.gate, result]));
    const missing = candidate.requiredGates.filter((gate) => !results.get(gate)?.passed);
    if (missing.length > 0) {
      throw new CoreEvolutionError(`Required gates have not passed: ${missing.join(", ")}`, "GATES_INCOMPLETE");
    }
    return this.transition(candidateId, "approved_for_build", actor, { requiredGates: candidate.requiredGates });
  }

  async reject(candidateId: string, actor: string, reason: string): Promise<CorePatchCandidate> {
    return this.transition(candidateId, "rejected", actor, { reason });
  }

  private async transition(candidateId: string, nextStatus: CorePatchStatus, actor: string, evidence: Record<string, unknown>): Promise<CorePatchCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    if (!transitions[candidate.status].includes(nextStatus)) {
      throw new CoreEvolutionError(`Cannot transition core patch from ${candidate.status} to ${nextStatus}`, "INVALID_TRANSITION");
    }
    const updatedAt = new Date().toISOString();
    await this.repository.updateCandidateState(candidate.id, nextStatus, candidate.gateResults, updatedAt);
    const updated = { ...candidate, status: nextStatus, updatedAt };
    await this.repository.appendEvent(this.event(updated, "transitioned", actor, candidate.status, evidence));
    return updated;
  }

  private async requireCandidate(id: string): Promise<CorePatchCandidate> {
    const candidate = await this.repository.getCandidate(id);
    if (!candidate) throw new CoreEvolutionError(`Core patch ${id} not found`, "NOT_FOUND");
    return candidate;
  }

  private async assertApprovedSource(id: string, sourceDigest: string): Promise<CorePatchSource> {
    const source = await this.sources.get(id);
    if (!source || source.kind !== "core_patch" || source.status !== "approved") {
      throw new CoreEvolutionError("Core patch source must be an approved core_patch DNA candidate", "SOURCE_INVALID");
    }
    if (source.sourceDigest !== sourceDigest) {
      throw new CoreEvolutionError("Core patch source digest does not match the approved DNA candidate", "SOURCE_INVALID");
    }
    return source;
  }

  private event(
    candidate: CorePatchCandidate,
    eventType: CorePatchEvent["eventType"],
    actor: string,
    previousStatus: CorePatchStatus | undefined,
    evidence: Record<string, unknown>,
  ): CorePatchEvent {
    const createdAt = new Date().toISOString();
    const id = `core_event_${randomUUID()}`;
    const body = { id, candidateId: candidate.id, eventType, previousStatus, nextStatus: candidate.status, actor, evidence, createdAt };
    return {
      ...body,
      eventDigest: digest(body),
    };
  }
}
