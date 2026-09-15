import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AssimilationEngine } from "../../api/core/assimilation-engine";
import { CapabilityPackageBuilder } from "../../api/core/capability-package";
import { StaticCapabilityPackageEvaluator } from "../../api/core/capability-package-evaluator";
import { CapabilityPackageSigner, capabilityPackagePayloadDigest } from "../../api/core/capability-package-signing";
import { RemoteCapabilitySandboxProvider, type CapabilitySandboxProvider } from "../../api/core/capability-sandbox-provider";
import { CapabilityReleaseService } from "../../api/core/capability-release-service";
import { CapabilityReleaseHydrator } from "../../api/core/capability-release-hydrator";
import {
  MemoryCapabilityReleaseRepository,
  type CapabilityReleaseRepository,
} from "../../api/core/capability-release-repository";
import { MemoryDNAArtifactStore } from "../../api/core/dna-artifact-store";
import { MemoryDNARepository } from "../../api/core/dna-repository";
import { DNAVersionRegistry } from "../../api/core/dna-version-registry";
import { GenerativeDNAService } from "../../api/core/generative-dna-service";
import { RuntimeConnectorRegistry } from "../../api/core/runtime-connector-registry";
import { SignedCapabilityBinder, StaticCapabilityReleaseKeyStore } from "../../api/core/signed-capability-binder";
import type { CapabilityEvaluation, CapabilityPackageBundle, PackageRuntime } from "@contracts/capability-package";
import type { CapabilityTestCase, SandboxExecutionResult, SandboxResourcePolicy } from "@contracts/capability-sandbox";
import type { ConnectorExecutionContext } from "@contracts/runtime-connector";

class TestSandbox implements CapabilitySandboxProvider {
  readonly id = "test-isolate-v1";
  executions = 0;
  violation = false;

  supports(runtime: PackageRuntime): boolean { return ["javascript", "typescript", "python", "declarative"].includes(runtime); }

  async evaluate(bundle: CapabilityPackageBundle, cases: CapabilityTestCase[]): Promise<CapabilityEvaluation> {
    return {
      id: "isolated-evaluation-1",
      packageDigest: capabilityPackagePayloadDigest(bundle),
      mode: "isolated",
      passed: cases.length > 0,
      eligibleForExecutionRelease: cases.length > 0,
      executionPerformed: cases.length > 0,
      isolationProvider: this.id,
      checks: [{ name: "isolated-tests", passed: cases.length > 0 }],
      findings: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  async execute(
    bundle: CapabilityPackageBundle,
    inputs: Record<string, unknown>,
    _context: ConnectorExecutionContext,
    _policy: SandboxResourcePolicy,
  ): Promise<SandboxExecutionResult> {
    this.executions += 1;
    if (this.violation) {
      return {
        packageDigest: capabilityPackagePayloadDigest(bundle),
        status: "policy_violation",
        errorCode: "network_denied",
        errorMessage: "network access denied",
        metrics: { durationMs: 3, peakMemoryMb: 8, outputBytes: 0 },
      };
    }
    const output = { query: inputs.query, routes: [] };
    return {
      packageDigest: capabilityPackagePayloadDigest(bundle),
      status: "success",
      output,
      metrics: { durationMs: 4, peakMemoryMb: 9, outputBytes: Buffer.byteLength(JSON.stringify(output), "utf8") },
    };
  }
}

async function fixture(permissions: string[] = []) {
  const artifacts = new MemoryDNAArtifactStore();
  const dnaRegistry = new DNAVersionRegistry();
  const dnaRepository = new MemoryDNARepository();
  const dna = new GenerativeDNAService(dnaRegistry, new AssimilationEngine(dnaRegistry), dnaRepository, artifacts);
  const ingested = await dna.ingest({
    artifactKind: "source_code",
    name: "route-search.ts",
    mediaType: "text/typescript",
    submittedBy: "developer-1",
    ownerConsent: true,
    content: "export async function routeSearch(input: { query: string }) { return { query: input.query, routes: [] }; }",
  });
  const candidate = await dna.reviseCandidate(ingested.candidate.id, {
    executorRef: "package:route-search",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { query: { type: "string" }, routes: { type: "array", items: { type: "string" } } },
      required: ["query", "routes"],
      additionalProperties: false,
    },
    permissions,
  });
  await dna.evaluateCandidate(candidate.id, {
    evaluator: "review-suite",
    passed: true,
    score: 0.98,
    checks: [{ name: "source-review", passed: true }],
    evidence: ["review-1"],
  });
  await dna.approveCandidate(candidate.id, "admin-1");
  const keys = generateKeyPairSync("ed25519");
  const sandbox = new TestSandbox();
  const connectors = new RuntimeConnectorRegistry();
  const releaseRepository = new MemoryCapabilityReleaseRepository();
  const binder = new SignedCapabilityBinder(
    new StaticCapabilityReleaseKeyStore({ "release-key-1": keys.publicKey }), sandbox, connectors, releaseRepository,
  );
  const releases = new CapabilityReleaseService(
    dna,
    new CapabilityPackageBuilder(artifacts),
    new StaticCapabilityPackageEvaluator(),
    sandbox,
    new CapabilityPackageSigner(),
    binder,
    keys.privateKey,
    "release-key-1",
    releaseRepository,
  );
  return { dna, dnaRepository, artifacts, candidate, sandbox, connectors, binder, releases, releaseRepository, keys };
}

const testCases: CapabilityTestCase[] = [{
  name: "empty routes",
  input: { query: "Riyadh" },
  expectedOutput: { query: "Riyadh", routes: [] },
  expectError: false,
}];
const context: ConnectorExecutionContext = {
  taskId: 1,
  userId: 2,
  planId: "plan-1",
  stepId: "learned-step",
  idempotencyKey: "a".repeat(64),
};

describe("signed learned capability runtime", () => {
  it("refuses an insecure or weakly authenticated remote sandbox configuration", () => {
    expect(() => new RemoteCapabilitySandboxProvider({
      baseUrl: "http://sandbox.example.test",
      token: "a".repeat(32),
    })).toThrow(/HTTPS/);
    expect(() => new RemoteCapabilitySandboxProvider({
      baseUrl: "https://sandbox.example.test",
      token: "short",
    })).toThrow(/too short/);
  });

  it("binds, promotes and executes a pure capability through the isolated provider", async () => {
    const { candidate, releases, connectors, sandbox } = await fixture();
    const released = await releases.release({ candidateId: candidate.id, publisher: "admin-1", testCases });
    expect(released.binding.status).toBe("canary");
    expect(connectors.discover({ capabilityId: "package:route-search" })).toHaveLength(0);

    const promoted = await releases.promote(released.binding.id);
    expect(promoted.version.status).toBe("active");
    const selected = connectors.discover({ capabilityId: "package:route-search" });
    expect(selected).toHaveLength(1);
    const output = await selected[0]!.connector.execute({ query: "Riyadh" }, context);
    expect(output).toEqual({ query: "Riyadh", routes: [] });
    expect(sandbox.executions).toBe(1);
  });

  it("rejects invalid inputs before they cross the kernel boundary", async () => {
    const { candidate, releases, binder, sandbox } = await fixture();
    const released = await releases.release({ candidateId: candidate.id, publisher: "admin-1", testCases, canary: false });
    await expect(binder.invoke(released.binding.id, { unexpected: true }, context)).rejects.toThrow(/required property query/i);
    expect(sandbox.executions).toBe(0);
  });

  it("quarantines a binding after a sandbox policy violation", async () => {
    const { candidate, releases, binder, sandbox, connectors } = await fixture();
    const released = await releases.release({ candidateId: candidate.id, publisher: "admin-1", testCases, canary: false });
    sandbox.violation = true;
    await expect(binder.invoke(released.binding.id, { query: "Riyadh" }, context)).rejects.toThrow(/network access denied/);
    expect(binder.get(released.binding.id)?.status).toBe("quarantined");
    expect(connectors.discover({ capabilityId: "package:route-search" })).toHaveLength(0);
  });

  it("refuses direct network permissions even after isolated tests", async () => {
    const { candidate, releases } = await fixture(["network"]);
    await expect(releases.release({ candidateId: candidate.id, publisher: "admin-1", testCases, canary: false }))
      .rejects.toThrow(/pure compute/i);
  });

  it("restores an active signed capability after a clean runtime restart", async () => {
    const original = await fixture();
    const released = await original.releases.release({
      candidateId: original.candidate.id,
      publisher: "admin-1",
      testCases,
      canary: false,
    });
    const restartedRegistry = new DNAVersionRegistry();
    const restartedDNA = new GenerativeDNAService(
      restartedRegistry,
      new AssimilationEngine(restartedRegistry),
      original.dnaRepository,
      original.artifacts,
    );
    const restartedConnectors = new RuntimeConnectorRegistry();
    const restartedBinder = new SignedCapabilityBinder(
      new StaticCapabilityReleaseKeyStore({ "release-key-1": original.keys.publicKey }),
      original.sandbox,
      restartedConnectors,
      original.releaseRepository,
    );
    const report = await new CapabilityReleaseHydrator(
      original.releaseRepository,
      original.artifacts,
      restartedDNA,
      restartedBinder,
    ).initialize();
    expect(report.restored).toEqual([released.binding.id]);
    const connector = restartedConnectors.discover({ capabilityId: "package:route-search" })[0]?.connector;
    expect(connector).toBeTruthy();
    await expect(connector!.execute({ query: "Jeddah" }, context)).resolves.toEqual({ query: "Jeddah", routes: [] });
    expect((await original.releaseRepository.list())[0]?.binding.executions).toBe(1);
  });

  it("quarantines a durable release whose signed envelope was changed", async () => {
    const original = await fixture();
    const released = await original.releases.release({
      candidateId: original.candidate.id,
      publisher: "admin-1",
      testCases,
      canary: false,
    });
    const [stored] = await original.releaseRepository.list();
    stored!.envelope.signature!.value = `${stored!.envelope.signature!.value.slice(0, -2)}AA`;
    let persistedStatus = "";
    const tamperedRepository: CapabilityReleaseRepository = {
      list: async () => [stored!],
      save: async () => stored!,
      updateBinding: async (binding) => { persistedStatus = binding.status; },
      delete: async () => undefined,
    };
    const binder = new SignedCapabilityBinder(
      new StaticCapabilityReleaseKeyStore({ "release-key-1": original.keys.publicKey }),
      original.sandbox,
      new RuntimeConnectorRegistry(),
    );
    const report = await new CapabilityReleaseHydrator(
      tamperedRepository,
      original.artifacts,
      original.dna,
      binder,
    ).initialize();
    expect(report.quarantined[0]?.bindingId).toBe(released.binding.id);
    expect(persistedStatus).toBe("quarantined");
  });

  it("disables a restored binding when its persisted state disagrees with DNA", async () => {
    const original = await fixture();
    const released = await original.releases.release({ candidateId: original.candidate.id, publisher: "admin-1", testCases });
    await original.releaseRepository.updateBinding({ ...released.binding, status: "active" });
    const binder = new SignedCapabilityBinder(
      new StaticCapabilityReleaseKeyStore({ "release-key-1": original.keys.publicKey }),
      original.sandbox,
      new RuntimeConnectorRegistry(),
    );
    const report = await new CapabilityReleaseHydrator(
      original.releaseRepository,
      original.artifacts,
      original.dna,
      binder,
    ).initialize();
    expect(report.skipped).toContain(released.binding.id);
    expect((await original.releaseRepository.list())[0]?.binding.status).toBe("disabled");
  });

  it("keeps the connector disabled when durable canary promotion cannot be committed", async () => {
    class FailActivePromotionRepository extends MemoryCapabilityReleaseRepository {
      override async updateBinding(binding: Parameters<MemoryCapabilityReleaseRepository["updateBinding"]>[0]): Promise<void> {
        if (binding.status === "active") throw new Error("simulated durable promotion failure");
        await super.updateBinding(binding);
      }
    }

    const base = await fixture();
    const repository = new FailActivePromotionRepository();
    const connectors = new RuntimeConnectorRegistry();
    const binder = new SignedCapabilityBinder(
      new StaticCapabilityReleaseKeyStore({ "release-key-1": base.keys.publicKey }),
      base.sandbox,
      connectors,
      repository,
    );
    const releases = new CapabilityReleaseService(
      base.dna,
      new CapabilityPackageBuilder(base.artifacts),
      new StaticCapabilityPackageEvaluator(),
      base.sandbox,
      new CapabilityPackageSigner(),
      binder,
      base.keys.privateKey,
      "release-key-1",
      repository,
    );
    const released = await releases.release({ candidateId: base.candidate.id, publisher: "admin-1", testCases });
    await expect(releases.promote(released.binding.id)).rejects.toThrow(/promotion failure/);
    expect(binder.get(released.binding.id)?.status).toBe("disabled");
    expect(connectors.discover({ capabilityId: "package:route-search" })).toHaveLength(0);
    expect((await repository.list())[0]?.binding.status).toBe("disabled");
  });
});
