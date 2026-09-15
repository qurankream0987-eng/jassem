/** Local verification of baseline-versus-candidate replay observations. */

import {
  CoreReplayCaseSchema,
  CoreReplayReportSchema,
  type CoreReplayCase,
  type CoreReplayCaseResult,
  type CoreReplayReport,
} from "@contracts/core-evolution";

function ratio(candidate: number, baseline: number): number {
  if (baseline === 0) return candidate === 0 ? 1 : Number.POSITIVE_INFINITY;
  return candidate / baseline;
}

export class CoreReplayEvaluator {
  evaluate(input: CoreReplayCase[]): CoreReplayReport {
    const cases = input.map((item) => CoreReplayCaseSchema.parse(item));
    const results = cases.map((item) => this.evaluateCase(item));
    const passedCases = results.filter((item) => item.passed).length;
    return CoreReplayReportSchema.parse({
      passed: passedCases === results.length && results.length > 0,
      total: results.length,
      passedCases,
      failedCases: results.length - passedCases,
      results,
    });
  }

  private evaluateCase(item: CoreReplayCase): CoreReplayCaseResult {
    const expectedStatus = item.expectations.requiredStatus ?? item.baseline.status;
    const checks = [
      {
        name: "status",
        passed: item.candidate.status === expectedStatus,
        details: `expected=${expectedStatus}; candidate=${item.candidate.status}`,
      },
      {
        name: "outcome",
        passed: item.expectations.allowOutcomeChange || item.candidate.outcomeDigest === item.baseline.outcomeDigest,
        details: item.expectations.allowOutcomeChange ? "outcome drift allowed" : "outcome digest must be preserved",
      },
      {
        name: "side_effects",
        passed: item.expectations.allowSideEffectChange || item.candidate.sideEffectDigest === item.baseline.sideEffectDigest,
        details: item.expectations.allowSideEffectChange ? "side-effect drift allowed" : "side-effect digest must be preserved",
      },
      {
        name: "evidence",
        passed: !item.expectations.requireEvidence || Boolean(item.candidate.evidenceDigest),
        details: item.expectations.requireEvidence ? "candidate must produce evidence" : "evidence optional",
      },
      {
        name: "approvals",
        passed: item.candidate.approvalsRequired >= item.baseline.approvalsRequired,
        details: `baseline=${item.baseline.approvalsRequired}; candidate=${item.candidate.approvalsRequired}`,
      },
      {
        name: "latency",
        passed: ratio(item.candidate.latencyMs, item.baseline.latencyMs) <= item.expectations.maxLatencyRatio,
        details: `ratio=${ratio(item.candidate.latencyMs, item.baseline.latencyMs)}; max=${item.expectations.maxLatencyRatio}`,
      },
      {
        name: "cost",
        passed: ratio(item.candidate.cost, item.baseline.cost) <= item.expectations.maxCostRatio,
        details: `ratio=${ratio(item.candidate.cost, item.baseline.cost)}; max=${item.expectations.maxCostRatio}`,
      },
      {
        name: "safety",
        passed: item.candidate.safetyIncidents <= item.expectations.maxSafetyIncidents,
        details: `incidents=${item.candidate.safetyIncidents}; max=${item.expectations.maxSafetyIncidents}`,
      },
    ];
    return {
      caseId: item.id,
      passed: checks.every((check) => check.passed),
      checks,
    };
  }
}
