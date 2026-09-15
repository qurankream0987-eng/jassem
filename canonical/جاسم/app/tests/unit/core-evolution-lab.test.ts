import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RequiredCorePatchGates,
  type CoreLabEvaluationReport,
  type CoreLabEvaluationRequest,
  type CoreLabResourcePolicy,
  type CorePatchGateResult,
  type CoreReplayCase,
  type CoreReplayFixture,
} from "@contracts/core-evolution";
import { CoreEvolutionEvaluator } from "../../api/core/core-evolution-evaluator";
import { RemoteCoreEvolutionLabProvider, type CoreEvolutionLabProvider } from "../../api/core/core-evolution-lab-provider";
import { MemoryCoreEvolutionRepository } from "../../api/core/core-evolution-repository";
import { CoreEvolutionService, type CorePatchSourceProvider } from "../../api/core/core-evolution-service";
import { CoreReplayEvaluator } from "../../api/core/core-replay-evaluator";
import { KernelBaselineBuilder } from "../../api/core/kernel-baseline-builder";
import type { CoreLabJobView } from "@contracts/core-evolution-job";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jasim-kernel-baseline-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "api", "core"), { recursive: true });
  await mkdir(path.join(root, "contracts"), { recursive: true });
  await mkdir(path.join(root, "tests", "unit"), { recursive: true });
  await writeFile(path.join(root, "api", "core", "kernel.ts"), "export const kernel = 1;\n");
  await writeFile(path.join(root, "contracts", "kernel.ts"), "export type Kernel = number;\n");
  await writeFile(path.join(root, "tests", "unit", "kernel.test.ts"), "test('kernel', () => {});\n");
  await writeFile(path.join(root, "package.json"), '{"name":"jasim"}\n');
  return root;
}

const buildInput = (root: string, generatedAt: string) => ({
  root,
  rootLabel: "jasim-test",
  version: "1.0.0",
  createdBy: "test",
  kernelFiles: ["api/core/kernel.ts", "contracts/kernel.ts"],
  manifestFiles: ["package.json"],
  testFiles: ["tests/unit/kernel.test.ts"],
  generatedAt,
});

function observation(overrides: Partial<CoreReplayCase["candidate"]> = {}): CoreReplayCase["candidate"] {
  return {
    status: "completed",
    outcomeDigest: sha("outcome"),
    evidenceDigest: sha("evidence"),
    sideEffectDigest: sha("effects"),
    latencyMs: 100,
    cost: 1,
    safetyIncidents: 0,
    approvalsRequired: 2,
    ...overrides,
  };
}

function replayCase(candidateOverrides: Partial<CoreReplayCase["candidate"]> = {}, expectationOverrides: Partial<CoreReplayCase["expectations"]> = {}): CoreReplayCase {
  return {
    id: "approval-boundary",
    goalDigest: sha("goal"),
    baseline: observation(),
    candidate: observation(candidateOverrides),
    expectations: {
      allowOutcomeChange: false,
      allowSideEffectChange: false,
      requireEvidence: true,
      maxLatencyRatio: 1.25,
      maxCostRatio: 1.25,
      maxSafetyIncidents: 0,
      ...expectationOverrides,
    },
  };
}

function replayFixture(): CoreReplayFixture {
  const { candidate: _candidate, ...fixture } = replayCase();
  return fixture;
}

const policy: CoreLabResourcePolicy = {
  timeoutMs: 60_000,
  maxMemoryMb: 1_024,
  maxOutputBytes: 1_048_576,
  network: false,
  environment: false,
  productionDatabase: false,
};

describe("Kernel baseline builder", () => {
  it("produces reproducible digests independent of input order and generation time", async () => {
    const root = await projectFixture();
    const builder = new KernelBaselineBuilder();
    const first = await builder.build(buildInput(root, "2026-08-19T00:00:00.000Z"));
    const secondInput = buildInput(root, "2026-08-19T01:00:00.000Z");
    secondInput.kernelFiles.reverse();
    const second = await builder.build(secondInput);
    expect(second.baseline.kernelDigest).toBe(first.baseline.kernelDigest);
    expect(second.baseline.testSuiteDigest).toBe(first.baseline.testSuiteDigest);
    expect(second.baseline.manifestDigest).toBe(first.baseline.manifestDigest);
    expect(second.manifest.generatedAt).not.toBe(first.manifest.generatedAt);
  });

  it("changes the kernel digest when one kernel artifact changes", async () => {
    const root = await projectFixture();
    const builder = new KernelBaselineBuilder();
    const first = await builder.build(buildInput(root, "2026-08-19T00:00:00.000Z"));
    await writeFile(path.join(root, "api", "core", "kernel.ts"), "export const kernel = 2;\n");
    const second = await builder.build(buildInput(root, "2026-08-19T00:00:00.000Z"));
    expect(second.baseline.kernelDigest).not.toBe(first.baseline.kernelDigest);
    expect(second.baseline.testSuiteDigest).toBe(first.baseline.testSuiteDigest);
  });

  it("rejects paths outside the declared project root", async () => {
    const root = await projectFixture();
    const outside = path.join(path.dirname(root), "outside-kernel.ts");
    await writeFile(outside, "unsafe\n");
    temporaryRoots.push(outside);
    await expect(new KernelBaselineBuilder().build({
      ...buildInput(root, "2026-08-19T00:00:00.000Z"),
      kernelFiles: [path.relative(root, outside)],
    })).rejects.toThrow(/escaped its root/);
  });
});

describe("Core replay evaluator", () => {
  it("passes behavior that preserves outcomes, evidence, approvals and limits", () => {
    const report = new CoreReplayEvaluator().evaluate([replayCase()]);
    expect(report).toMatchObject({ passed: true, passedCases: 1, failedCases: 0 });
  });

  it("fails when a patch removes approval or exceeds cost and safety limits", () => {
    const report = new CoreReplayEvaluator().evaluate([replayCase({ approvalsRequired: 1, cost: 2, safetyIncidents: 1 })]);
    expect(report.passed).toBe(false);
    const failures = report.results[0].checks.filter((check) => !check.passed).map((check) => check.name);
    expect(failures).toEqual(expect.arrayContaining(["approvals", "cost", "safety"]));
  });

  it("allows intentional outcome drift only when the case policy declares it", () => {
    const changed = { outcomeDigest: sha("improved-outcome") };
    expect(new CoreReplayEvaluator().evaluate([replayCase(changed)]).passed).toBe(false);
    expect(new CoreReplayEvaluator().evaluate([replayCase(changed, { allowOutcomeChange: true })]).passed).toBe(true);
  });
});

function evaluationReport(request: CoreLabEvaluationRequest, providerId: string): CoreLabEvaluationReport {
  const gateResults: CorePatchGateResult[] = request.requiredGates
    .filter((gate) => gate !== "replay")
    .map((gate) => ({
      gate,
      passed: true,
      evaluator: `${providerId}:${gate}`,
      summary: `${gate} passed in isolation`,
      evidenceRefs: [`lab://${gate}/1`],
      metrics: {},
      completedAt: "2026-08-19T00:00:00.000Z",
    }));
  return {
    candidateId: request.candidateId,
    baselineId: request.baselineId,
    sourceDigest: request.expectedSourceDigest,
    baselineKernelDigest: request.expectedKernelDigest,
    candidateKernelDigest: sha("candidate-kernel"),
    manifestDigest: sha("candidate-manifest"),
    mode: "isolated",
    isolationProvider: providerId,
    gateResults,
    replayCases: request.replayFixtures.map((fixture) => ({ ...fixture, candidate: observation() })),
    buildEvidenceRefs: ["lab://build/1"],
    evaluatedAt: "2026-08-19T00:00:00.000Z",
  };
}

function coreJob(status: CoreLabJobView["status"], candidateId = "patch-1"): CoreLabJobView {
  return {
    id: "job-1", kind: "core_evolution.evaluate", candidateId, status,
    attempts: status === "queued" ? 0 : 1, maxAttempts: 3, timeoutMs: 600_000,
    cancellationRequested: status === "cancelled", result: null,
    errorCode: null, errorSummary: null,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    completedAt: ["queued", "claimed", "running"].includes(status) ? null : "2026-08-19T00:00:00.000Z",
  };
}

describe("Remote Core Evolution Lab boundary", () => {
  it("rejects a non-HTTPS remote lab", () => {
    expect(() => new RemoteCoreEvolutionLabProvider({ baseUrl: "http://lab.example.com", token: "x".repeat(24) })).toThrow(/HTTPS/);
  });

  it("binds reports to the exact source, baseline, provider and replay suite", async () => {
    const request: CoreLabEvaluationRequest = {
      candidateId: "patch-1",
      baselineId: "baseline-1",
      targetVersion: "1.1.0",
      expectedSourceDigest: sha("source"),
      expectedKernelDigest: sha("kernel"),
      sourceArtifactRef: `dna-artifact:sha256:${sha("source")}`,
      baselineArtifactRef: `kernel-baseline:sha256:${sha("kernel")}`,
      declaredScope: ["api/core/planner.ts"],
      requiredGates: RequiredCorePatchGates,
      replayFixtures: [replayFixture()],
      policy,
    };
    const providerId = "core-lab:test";
    const provider = new RemoteCoreEvolutionLabProvider({
      baseUrl: "https://lab.example.com",
      token: "x".repeat(24),
      providerId,
      fetchImpl: async (input, init) => {
        expect(init?.headers).toMatchObject({ authorization: `Bearer ${"x".repeat(24)}` });
        const path = new URL(input.toString()).pathname;
        if (path.endsWith("/report")) return Response.json({ job: coreJob("succeeded"), report: evaluationReport(request, providerId) });
        return Response.json({ job: coreJob("queued") }, { status: 202 });
      },
    });
    const submitted = await provider.submit(request, "request-key-001", "tester");
    expect(submitted.status).toBe("queued");
    await expect(provider.report(submitted.id, request)).resolves.toMatchObject({ candidateId: "patch-1", mode: "isolated" });
    const mismatched = new RemoteCoreEvolutionLabProvider({
      baseUrl: "https://lab.example.com",
      token: "x".repeat(24),
      providerId,
      fetchImpl: async () => Response.json({ job: coreJob("succeeded"), report: { ...evaluationReport(request, providerId), sourceDigest: sha("other") } }),
    });
    await expect(mismatched.report("job-1", request)).rejects.toThrow(/different source or baseline/);
  });
});

describe("Core evolution evaluation coordinator", () => {
  it("records isolated gates and local replay without auto-approving the patch", async () => {
    const repository = new MemoryCoreEvolutionRepository();
    const sources: CorePatchSourceProvider = {
      async get(id) {
        return id === "dna-core-1" ? {
          id,
          kind: "core_patch",
          sourceDigest: sha("patch"),
          artifactRef: `dna-artifact:sha256:${sha("patch")}`,
          status: "approved",
        } : undefined;
      },
    };
    const service = new CoreEvolutionService(repository, sources);
    await service.registerBaseline({
      id: "baseline-1",
      version: "1.0.0",
      kernelDigest: sha("kernel"),
      manifestDigest: sha("manifest"),
      testSuiteDigest: sha("tests"),
      artifactRef: `kernel-baseline:sha256:${sha("manifest")}`,
      status: "active",
      metadata: {},
      createdBy: "release-admin",
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    const candidate = await service.submit({
      dnaCandidateId: "dna-core-1",
      baseBaselineId: "baseline-1",
      targetVersion: "1.1.0",
      sourceDigest: sha("patch"),
      title: "Planner patch",
      summary: "Preserve approval boundaries.",
      scope: ["api/core/planner.ts"],
      declaredEffects: ["planning"],
      testPlan: ["replay"],
      rollbackPlan: ["restore baseline"],
      createdBy: "developer",
    });
    let submittedRequest: CoreLabEvaluationRequest | undefined;
    const provider: CoreEvolutionLabProvider = {
      id: "core-lab:fake",
      async submit(request) {
        submittedRequest = request;
        return coreJob("succeeded", candidate.id);
      },
      async get() { return coreJob("succeeded", candidate.id); },
      async report(_jobId, request) {
        return evaluationReport(request, this.id);
      },
      async cancel() { return coreJob("cancelled", candidate.id); },
    };
    const evaluator = new CoreEvolutionEvaluator(service, provider);
    const submission = await evaluator.submit(candidate.id, [replayFixture()], "lab", policy);
    expect(submittedRequest?.candidateId).toBe(candidate.id);
    const result = await evaluator.finalize(submission.job.id, candidate.id, [replayFixture()], "lab", policy);
    expect(result.candidate.status).toBe("evaluating");
    expect(result.candidate.gateResults).toHaveLength(RequiredCorePatchGates.length);
    expect(result.candidate.gateResults.find((gate) => gate.gate === "replay")).toMatchObject({ passed: true });
    const approved = await service.approveForBuild(candidate.id, "core-reviewer");
    expect(approved.status).toBe("approved_for_build");
  });
});
