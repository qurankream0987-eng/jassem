import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AssimilationEngine } from "../../api/core/assimilation-engine";
import { CapabilityPackageBuilder } from "../../api/core/capability-package";
import { StaticCapabilityPackageEvaluator } from "../../api/core/capability-package-evaluator";
import { CapabilityPackageSigner } from "../../api/core/capability-package-signing";
import { MemoryDNAArtifactStore } from "../../api/core/dna-artifact-store";
import { MemoryDNARepository } from "../../api/core/dna-repository";
import { DNAVersionRegistry } from "../../api/core/dna-version-registry";
import { GenerativeDNAService } from "../../api/core/generative-dna-service";

async function buildSafePackage() {
  const artifacts = new MemoryDNAArtifactStore();
  const registry = new DNAVersionRegistry();
  const service = new GenerativeDNAService(
    registry,
    new AssimilationEngine(registry),
    new MemoryDNARepository(),
    artifacts,
  );
  const ingested = await service.ingest({
    artifactKind: "source_code",
    name: "route-search.ts",
    mediaType: "text/typescript",
    submittedBy: "developer-1",
    ownerConsent: true,
    content: "export async function routeSearch(query: string) { return { query, routes: [] }; }",
  });
  const candidate = await service.reviseCandidate(ingested.candidate.id, {
    executorRef: "package:route-search",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    outputSchema: { type: "object", properties: { routes: { type: "array" } } },
    permissions: [],
  });
  const bundle = await new CapabilityPackageBuilder(artifacts).build(candidate, {
    publisher: "developer-1",
    exportName: "routeSearch",
  });
  return { bundle, candidate, artifacts };
}

describe("JASIM capability package security", () => {
  it("stores assimilated source by content digest", async () => {
    const { candidate, artifacts } = await buildSafePackage();
    expect(candidate.source.uri).toMatch(/^artifact:\/\/sha256\/[a-f0-9]{64}$/);
    const restored = await artifacts.get(candidate.source.uri!);
    expect(restored).toContain("routeSearch");
  });

  it("performs static analysis without granting execution release", async () => {
    const { bundle } = await buildSafePackage();
    const evaluation = await new StaticCapabilityPackageEvaluator().evaluate(bundle);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.executionPerformed).toBe(false);
    expect(evaluation.eligibleForExecutionRelease).toBe(false);
    expect(evaluation.mode).toBe("static");
  });

  it("detects dangerous execution and undeclared permissions", async () => {
    const { bundle } = await buildSafePackage();
    bundle.contents[0].content = "const result = eval(userInput); fetch('https://example.com');";
    // Keep the manifest consistent so the evaluator reaches behavioral checks.
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(bundle.contents[0].content).digest("hex");
    const size = Buffer.byteLength(bundle.contents[0].content, "utf8");
    bundle.contents[0].digest = digest;
    bundle.contents[0].size = size;
    bundle.envelope.manifest.files[0].digest = digest;
    bundle.envelope.manifest.files[0].size = size;
    bundle.envelope.manifest.sourceDigest = digest;

    const evaluation = await new StaticCapabilityPackageEvaluator().evaluate(bundle);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.findings.some((finding) => finding.id.startsWith("dynamic-eval"))).toBe(true);
    expect(evaluation.findings.some((finding) => finding.id.startsWith("permission:network"))).toBe(true);
  });

  it("signs source attestations with Ed25519 and detects tampering", async () => {
    const { bundle } = await buildSafePackage();
    bundle.envelope.evaluation = await new StaticCapabilityPackageEvaluator().evaluate(bundle);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = new CapabilityPackageSigner();
    const signed = signer.sign(bundle, privateKey, {
      keyId: "test-key-1",
      scope: "source_attestation",
    });

    expect(signer.verify(signed, publicKey)).toBe(true);
    signed.contents[0].content += "\n// tampered";
    expect(signer.verify(signed, publicKey)).toBe(false);
  });

  it("refuses an execution-release signature after static analysis only", async () => {
    const { bundle } = await buildSafePackage();
    bundle.envelope.evaluation = await new StaticCapabilityPackageEvaluator().evaluate(bundle);
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => new CapabilityPackageSigner().sign(bundle, privateKey, {
      keyId: "test-key-1",
      scope: "execution_release",
    })).toThrow(/isolated evaluation/);
  });

  it("rejects package entrypoints that escape the package", async () => {
    const { candidate, artifacts } = await buildSafePackage();
    await expect(new CapabilityPackageBuilder(artifacts).build(candidate, {
      publisher: "developer-1",
      entrypoint: "../outside.ts",
    })).rejects.toThrow(/inside the package/);
  });

  it("rejects duplicate or escaping file paths even when their bytes match", async () => {
    const { bundle } = await buildSafePackage();
    bundle.envelope.evaluation = await new StaticCapabilityPackageEvaluator().evaluate(bundle);
    bundle.envelope.manifest.files.push({ ...bundle.envelope.manifest.files[0] });
    bundle.contents.push({ ...bundle.contents[0] });
    expect(() => new CapabilityPackageSigner().sign(bundle, generateKeyPairSync("ed25519").privateKey, {
      keyId: "test-key-1",
      scope: "source_attestation",
    })).toThrow(/duplicate package file path/i);
  });
});
