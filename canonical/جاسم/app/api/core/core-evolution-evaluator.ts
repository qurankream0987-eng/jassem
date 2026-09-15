/** Submits, observes and finalizes remote isolated evaluation without long HTTP waits. */
import { createHash } from "node:crypto";
import type { CoreLabJobView } from "@contracts/core-evolution-job";
import {
  CoreLabResourcePolicySchema,
  type CoreLabEvaluationReport,
  type CoreLabEvaluationRequest,
  type CoreLabResourcePolicy,
  type CorePatchCandidate,
  type CoreReplayFixture,
} from "@contracts/core-evolution";
import type { CoreEvolutionService } from "./core-evolution-service";
import type { CoreEvolutionLabProvider } from "./core-evolution-lab-provider";
import { CoreReplayEvaluator } from "./core-replay-evaluator";

export interface CoreEvolutionEvaluationResult { candidate: CorePatchCandidate; report: CoreLabEvaluationReport; job: CoreLabJobView }

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export class CoreEvolutionEvaluator {
  constructor(private readonly service: CoreEvolutionService, private readonly provider: CoreEvolutionLabProvider, private readonly replay = new CoreReplayEvaluator()) {}

  async submit(candidateId: string, replayFixtures: CoreReplayFixture[], actor: string, policyInput: CoreLabResourcePolicy): Promise<{ candidate: CorePatchCandidate; job: CoreLabJobView }> {
    const { candidate, request } = await this.prepare(candidateId, replayFixtures, actor, policyInput);
    const requestDigest = createHash("sha256").update(canonical(request)).digest("hex");
    const job = await this.provider.submit(request, `core-evaluation:${requestDigest}`, actor);
    return { candidate, job };
  }

  async status(jobId: string): Promise<CoreLabJobView> { return this.provider.get(jobId); }
  async cancel(jobId: string, actor: string): Promise<CoreLabJobView> { return this.provider.cancel(jobId, actor); }

  async finalize(jobId: string, candidateId: string, replayFixtures: CoreReplayFixture[], actor: string, policyInput: CoreLabResourcePolicy): Promise<CoreEvolutionEvaluationResult> {
    const { candidate: prepared, request } = await this.prepare(candidateId, replayFixtures, actor, policyInput);
    const job = await this.provider.get(jobId);
    if (job.candidateId !== prepared.id) throw new Error("Core Lab job belongs to another candidate");
    if (job.status !== "succeeded") throw new Error(`Core Lab job is not ready (${job.status})`);
    const report = await this.provider.report(jobId, request);
    const replay = this.replay.evaluate(report.replayCases);
    let candidate = prepared;
    const recorded = new Set(candidate.gateResults.map((gate) => gate.gate));
    for (const gate of report.gateResults.filter((item) => item.gate !== "replay")) {
      if (!recorded.has(gate.gate)) candidate = await this.service.recordGate(candidate.id, gate, actor);
    }
    if (!recorded.has("replay")) {
      candidate = await this.service.recordGate(candidate.id, {
        gate: "replay",
        passed: replay.passed,
        evaluator: `local-replay-verifier:${this.provider.id}`,
        summary: `${replay.passedCases}/${replay.total} replay cases passed`,
        evidenceRefs: report.buildEvidenceRefs,
        metrics: { total: replay.total, passed: replay.passedCases, failed: replay.failedCases },
        completedAt: new Date().toISOString(),
      }, actor);
    }
    return { candidate, report, job };
  }

  private async prepare(candidateId: string, replayFixtures: CoreReplayFixture[], actor: string, policyInput: CoreLabResourcePolicy): Promise<{ candidate: CorePatchCandidate; request: CoreLabEvaluationRequest }> {
    let candidate = await this.service.getCandidate(candidateId);
    if (!candidate) throw new Error(`Core patch ${candidateId} not found`);
    const baseline = await this.service.getBaseline(candidate.baseBaselineId);
    if (!baseline) throw new Error(`Kernel baseline ${candidate.baseBaselineId} not found`);
    if (candidate.status === "submitted") candidate = await this.service.beginEvaluation(candidate.id, actor);
    if (candidate.status !== "evaluating") throw new Error(`Core patch ${candidate.id} is not eligible for evaluation`);
    const source = await this.service.getApprovedSource(candidate.dnaCandidateId, candidate.sourceDigest);
    if (!baseline.artifactRef) throw new Error(`Kernel baseline ${baseline.id} has no immutable artifact reference`);
    return { candidate, request: {
      candidateId: candidate.id,
      baselineId: baseline.id,
      targetVersion: candidate.targetVersion,
      expectedSourceDigest: candidate.sourceDigest,
      expectedKernelDigest: baseline.kernelDigest,
      sourceArtifactRef: source.artifactRef,
      baselineArtifactRef: baseline.artifactRef,
      declaredScope: candidate.scope,
      requiredGates: candidate.requiredGates,
      replayFixtures,
      policy: CoreLabResourcePolicySchema.parse(policyInput),
    } };
  }
}

