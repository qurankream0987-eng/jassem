/** Strict server-side coordinator for one isolated core-patch evaluation. */

import {
  CoreLabEvaluationReportSchema,
  CoreLabEvaluationRequestSchema,
  type CoreLabEvaluationReport,
  type CoreLabEvaluationRequest,
  type CoreReplayFixture,
} from "@contracts/core-evolution";
import type { CoreLabArtifactResolver, ResolvedCoreLabArtifacts } from "./artifact-resolver";

export interface CoreLabContainerInput {
  request: CoreLabEvaluationRequest;
  artifacts: ResolvedCoreLabArtifacts;
  isolationProvider: string;
}

export interface CoreLabContainerRunner {
  run(input: CoreLabContainerInput, signal?: AbortSignal): Promise<unknown>;
}

function stableFixtures(fixtures: CoreReplayFixture[]): string {
  return JSON.stringify([...fixtures].sort((left, right) => left.id.localeCompare(right.id)));
}

export class CoreEvolutionLabEvaluationService {
  constructor(
    private readonly isolationProvider: string,
    private readonly artifacts: CoreLabArtifactResolver,
    private readonly runner: CoreLabContainerRunner,
  ) {
    if (!isolationProvider || isolationProvider.length > 200) throw new Error("Invalid Core Lab provider id");
  }

  async evaluate(input: unknown, signal?: AbortSignal): Promise<CoreLabEvaluationReport> {
    const request = CoreLabEvaluationRequestSchema.parse(input);
    const artifacts = await this.artifacts.resolve(request);
    const report = CoreLabEvaluationReportSchema.parse(await this.runner.run({
      request,
      artifacts,
      isolationProvider: this.isolationProvider,
    }, signal));
    this.verifyReport(request, report);
    return report;
  }

  private verifyReport(request: CoreLabEvaluationRequest, report: CoreLabEvaluationReport): void {
    if (report.mode !== "isolated" || report.isolationProvider !== this.isolationProvider) {
      throw new Error("Container report has the wrong isolation identity");
    }
    if (report.candidateId !== request.candidateId || report.baselineId !== request.baselineId) {
      throw new Error("Container report does not match the requested candidate and baseline");
    }
    if (report.sourceDigest !== request.expectedSourceDigest || report.baselineKernelDigest !== request.expectedKernelDigest) {
      throw new Error("Container report evaluated different source or baseline content");
    }
    const expectedGates = request.requiredGates.filter((gate) => gate !== "replay").sort();
    const reportedGates = report.gateResults.map((result) => result.gate).sort();
    if (new Set(reportedGates).size !== reportedGates.length || JSON.stringify(reportedGates) !== JSON.stringify(expectedGates)) {
      throw new Error("Container report does not contain exactly the requested non-replay gates");
    }
    const fixtures = report.replayCases.map(({ candidate: _candidate, ...fixture }) => fixture);
    if (stableFixtures(fixtures) !== stableFixtures(request.replayFixtures)) {
      throw new Error("Container report replay suite differs from the submitted fixtures");
    }
  }
}
