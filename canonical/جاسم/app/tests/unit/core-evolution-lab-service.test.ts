import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RequiredCorePatchGates,
  type CoreLabEvaluationReport,
  type CoreLabEvaluationRequest,
  type CorePatchGateResult,
  type KernelBaselineManifest,
} from "@contracts/core-evolution";
import { FilesystemCoreLabArtifactResolver } from "../../services/core-evolution-lab/artifact-resolver";
import {
  DockerCoreLabRunner,
  buildDockerRunArguments,
  type DockerCommandExecutor,
} from "../../services/core-evolution-lab/docker-runner";
import {
  CoreEvolutionLabEvaluationService,
  type CoreLabContainerInput,
  type CoreLabContainerRunner,
} from "../../services/core-evolution-lab/evaluation-service";
import { createCoreEvolutionLabHandler } from "../../services/core-evolution-lab/http-app";
import { CoreEvolutionLabJobService } from "../../services/core-evolution-lab/job-service";
import { DurableJobQueue, MemoryDurableJobRepository } from "../../api/core/durable-job-queue";
import { DurableJobWorker } from "../../api/core/durable-job-worker";
import { MemoryImmutableArtifactStore } from "../../api/core/immutable-artifact-store";
import { CORE_EVOLUTION_EVALUATION_JOB_KIND } from "@contracts/core-evolution-job";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function semanticManifestDigest(manifest: Omit<KernelBaselineManifest, "manifestDigest" | "generatedAt">): string {
  return sha(JSON.stringify({
    ...manifest,
    artifacts: [...manifest.artifacts].sort(
      (left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role),
    ),
  }));
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jasim-core-lab-service-"));
  roots.push(root);
  const sourceRoot = path.join(root, "source");
  const baselineRoot = path.join(root, "baseline");
  const kernelDigest = sha("kernel");
  const base = {
    formatVersion: 1 as const,
    version: "1.0.0",
    rootLabel: "jasim",
    artifacts: [
      { path: "api/core/kernel.ts", role: "kernel" as const, digest: sha("kernel-file"), sizeBytes: 12 },
      { path: "tests/kernel.test.ts", role: "test" as const, digest: sha("test-file"), sizeBytes: 11 },
    ],
    kernelDigest,
    testSuiteDigest: sha("tests"),
  };
  const baselineDigest = semanticManifestDigest(base);
  const patchContent = Buffer.from("export const kernel = 2;\n");
  const source = Buffer.from(JSON.stringify({
    formatVersion: 1,
    kind: "core_patch_bundle",
    baseManifestDigest: baselineDigest,
    targetVersion: "1.1.0",
    files: [{
      path: "api/core/kernel.ts",
      role: "kernel",
      operation: "upsert",
      contentBase64: patchContent.toString("base64"),
      digest: sha(patchContent),
    }],
  }));
  const sourceDigest = sha(source);
  const manifest: KernelBaselineManifest = {
    ...base,
    manifestDigest: baselineDigest,
    generatedAt: "2026-08-19T00:00:00.000Z",
  };
  await mkdir(path.join(sourceRoot, sourceDigest.slice(0, 2)), { recursive: true });
  await mkdir(path.join(baselineRoot, baselineDigest.slice(0, 2)), { recursive: true });
  const sourcePath = path.join(sourceRoot, sourceDigest.slice(0, 2), `${sourceDigest}.blob`);
  const baselinePath = path.join(baselineRoot, baselineDigest.slice(0, 2), `${baselineDigest}.json`);
  await writeFile(sourcePath, source);
  await writeFile(baselinePath, JSON.stringify(manifest));
  const request: CoreLabEvaluationRequest = {
    candidateId: "patch-1",
    baselineId: "baseline-1",
    targetVersion: "1.1.0",
    expectedSourceDigest: sourceDigest,
    expectedKernelDigest: kernelDigest,
    sourceArtifactRef: `artifact://sha256/${sourceDigest}`,
    baselineArtifactRef: `kernel-baseline:sha256:${baselineDigest}`,
    declaredScope: ["api/core/kernel.ts"],
    requiredGates: RequiredCorePatchGates,
    replayFixtures: [{
      id: "approval-boundary",
      goalDigest: sha("goal"),
      baseline: {
        status: "completed",
        outcomeDigest: sha("outcome"),
        evidenceDigest: sha("evidence"),
        sideEffectDigest: sha("effects"),
        latencyMs: 100,
        cost: 1,
        safetyIncidents: 0,
        approvalsRequired: 1,
      },
      expectations: {
        allowOutcomeChange: false,
        allowSideEffectChange: false,
        requireEvidence: true,
        maxLatencyRatio: 1.25,
        maxCostRatio: 1.25,
        maxSafetyIncidents: 0,
      },
    }],
    policy: {
      timeoutMs: 60_000,
      maxMemoryMb: 512,
      maxOutputBytes: 1_048_576,
      network: false,
      environment: false,
      productionDatabase: false,
    },
  };
  return { root, sourceRoot, baselineRoot, sourcePath, baselinePath, request };
}

function report(input: CoreLabContainerInput): CoreLabEvaluationReport {
  const gateResults: CorePatchGateResult[] = input.request.requiredGates
    .filter((gate) => gate !== "replay")
    .map((gate) => ({
      gate,
      passed: true,
      evaluator: `container:${gate}`,
      summary: `${gate} passed`,
      evidenceRefs: [`artifact://evidence/${gate}`],
      metrics: {},
      completedAt: "2026-08-19T00:01:00.000Z",
    }));
  return {
    candidateId: input.request.candidateId,
    baselineId: input.request.baselineId,
    sourceDigest: input.request.expectedSourceDigest,
    baselineKernelDigest: input.request.expectedKernelDigest,
    candidateKernelDigest: sha("candidate-kernel"),
    manifestDigest: sha("candidate-manifest"),
    mode: "isolated",
    isolationProvider: input.isolationProvider,
    gateResults,
    replayCases: input.request.replayFixtures.map((fixture) => ({
      ...fixture,
      candidate: { ...fixture.baseline, latencyMs: 105 },
    })),
    buildEvidenceRefs: ["artifact://build/evidence"],
    evaluatedAt: "2026-08-19T00:01:00.000Z",
  };
}

async function serviceFixture(runner?: CoreLabContainerRunner) {
  const files = await fixture();
  const resolver = new FilesystemCoreLabArtifactResolver({
    sourceRoot: files.sourceRoot,
    baselineRoot: files.baselineRoot,
  });
  const selectedRunner = runner ?? { async run(input: CoreLabContainerInput) { return report(input); } };
  return { ...files, service: new CoreEvolutionLabEvaluationService("core-lab:test", resolver, selectedRunner) };
}

describe("Core Evolution Lab artifact boundary", () => {
  it("resolves the existing DNA artifact URI and verifies the semantic baseline digest", async () => {
    const { service, request } = await serviceFixture();
    await expect(service.evaluate(request)).resolves.toMatchObject({
      candidateId: request.candidateId,
      isolationProvider: "core-lab:test",
    });
  });

  it("rejects content changed after it was addressed", async () => {
    const { service, request, sourcePath } = await serviceFixture();
    await writeFile(sourcePath, "tampered");
    await expect(service.evaluate(request)).rejects.toThrow(/content digest/);
  });

  it("rejects a container report with a different candidate identity", async () => {
    const badRunner: CoreLabContainerRunner = {
      async run(input) { return { ...report(input), candidateId: "another-patch" }; },
    };
    const { service, request } = await serviceFixture(badRunner);
    await expect(service.evaluate(request)).rejects.toThrow(/requested candidate/);
  });
});

describe("Docker isolation command", () => {
  it("uses a digest-pinned image, no network, read-only root and bounded resources", async () => {
    const { request, sourcePath, baselinePath, sourceRoot, baselineRoot } = await fixture();
    const image = `registry.example/jasim-core-lab@sha256:${"a".repeat(64)}`;
    const artifacts = await new FilesystemCoreLabArtifactResolver({ sourceRoot, baselineRoot }).resolve(request);
    const input = {
      request,
      isolationProvider: "core-lab:test",
      artifacts,
    } satisfies CoreLabContainerInput;
    const args = buildDockerRunArguments(input, {
      source: sourcePath,
      baseline: baselinePath,
      request: path.join(path.dirname(sourcePath), "request.json"),
      outputDirectory: path.join(path.dirname(sourcePath), "output"),
    }, "jasim-core-lab-test", { image, containerUser: "65532:65532", cpuLimit: 1, pidsLimit: 128 });
    expect(args).toEqual(expect.arrayContaining([
      "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges:true", "--memory", "512m", "--memory-swap", "512m",
      "--user", "65532:65532", "--log-driver", "none", image,
    ]));
    expect(args).not.toContain("--env");
  });

  it("rejects floating image tags", () => {
    expect(() => new DockerCoreLabRunner({ image: "registry.example/jasim-core-lab:latest", evidenceRoot: "evidence" })).toThrow(/pinned/);
  });

  it("fails closed when Docker cannot start and never uses an in-process fallback", async () => {
    const executor: DockerCommandExecutor = {
      async run() { throw new Error("Docker could not be started"); },
    };
    const { request, sourcePath, baselinePath } = await fixture();
    const resolver = new FilesystemCoreLabArtifactResolver({
      sourceRoot: path.dirname(path.dirname(sourcePath)),
      baselineRoot: path.dirname(path.dirname(baselinePath)),
    });
    const artifacts = await resolver.resolve(request);
    const runner = new DockerCoreLabRunner({
      image: `registry.example/jasim-core-lab@sha256:${"b".repeat(64)}`,
      evidenceRoot: path.join(path.dirname(sourcePath), "evidence"),
      executor,
    });
    await expect(runner.run({ request, artifacts, isolationProvider: "core-lab:test" })).rejects.toThrow(/Docker could not/);
  });

  it("persists and verifies every evidence artifact before accepting a report", async () => {
    const files = await fixture();
    const artifacts = await new FilesystemCoreLabArtifactResolver({
      sourceRoot: files.sourceRoot,
      baselineRoot: files.baselineRoot,
    }).resolve(files.request);
    const input: CoreLabContainerInput = { request: files.request, artifacts, isolationProvider: "core-lab:test" };
    const generated = report(input);
    const evidence = new Map<string, Buffer>();
    for (const gate of generated.gateResults) {
      const content = Buffer.from(`evidence:${gate.gate}`);
      const contentDigest = sha(content);
      evidence.set(contentDigest, content);
      gate.evidenceRefs = [`artifact://sha256/${contentDigest}`];
    }
    const buildContent = Buffer.from("build-evidence");
    const buildDigest = sha(buildContent);
    evidence.set(buildDigest, buildContent);
    generated.buildEvidenceRefs = [`artifact://sha256/${buildDigest}`];
    const executor: DockerCommandExecutor = {
      async run(_command, args) {
        if (args[0] !== "run") return { exitCode: 0, stdout: "", stderr: "" };
        const mount = args.find((arg) => arg.includes("dst=/lab/output"));
        const match = mount && /^type=bind,src=(.*),dst=\/lab\/output$/.exec(mount);
        if (!match) throw new Error("missing output mount");
        const output = match[1];
        await mkdir(path.join(output, "evidence"), { recursive: true });
        await Promise.all([...evidence].map(([contentDigest, content]) =>
          writeFile(path.join(output, "evidence", `${contentDigest}.blob`), content)));
        await writeFile(path.join(output, "report.json"), JSON.stringify(generated));
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    const evidenceRoot = path.join(files.root, "persisted-evidence");
    const runner = new DockerCoreLabRunner({
      image: `sha256:${"c".repeat(64)}`,
      evidenceRoot,
      workRoot: path.join(files.root, "jobs"),
      executor,
    });
    await expect(runner.run(input)).resolves.toMatchObject({ candidateId: "patch-1" });
    await expect(readFile(path.join(evidenceRoot, buildDigest.slice(0, 2), `${buildDigest}.blob`), "utf8"))
      .resolves.toBe("build-evidence");
  });
});

describe("Core Evolution Lab HTTP boundary", () => {
  it("requires authentication and publishes verified reports through an async job", async () => {
    const { service, request } = await serviceFixture();
    const token = "a-secure-lab-token-with-32-chars";
    const artifacts = new MemoryImmutableArtifactStore();
    const queue = new DurableJobQueue({ repository: new MemoryDurableJobRepository() });
    const jobs = new CoreEvolutionLabJobService(queue, artifacts, service);
    const worker = new DurableJobWorker({ id: "test-worker", queue, artifacts, handlers: new Map([[CORE_EVOLUTION_EVALUATION_JOB_KIND, jobs.handler]]) });
    const handler = createCoreEvolutionLabHandler({ service: jobs, token });
    const unauthorized = await handler(new Request("https://lab.example/v1/core-evolution-jobs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify(request),
    }));
    expect(unauthorized.status).toBe(401);
    const accepted = await handler(new Request("https://lab.example/v1/core-evolution-jobs", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": "service-test-001" },
      body: JSON.stringify(request),
    }));
    expect(accepted.status).toBe(202);
    const submission = await accepted.json() as { job: { id: string } };
    expect(await worker.runOnce()).toBe(true);
    const report = await handler(new Request(`https://lab.example/v1/core-evolution-jobs/${submission.job.id}/report`, {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(report.status).toBe(200);
    await expect(report.json()).resolves.toMatchObject({ report: { candidateId: "patch-1", mode: "isolated" } });
  });
});
