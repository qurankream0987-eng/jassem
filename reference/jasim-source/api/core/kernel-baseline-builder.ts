/** Deterministic, explicit-file kernel baseline builder. */

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  KernelBaselineManifestSchema,
  KernelBaselineSchema,
  type KernelArtifact,
  type KernelArtifactRole,
  type KernelBaseline,
  type KernelBaselineManifest,
} from "@contracts/core-evolution";

export interface KernelBaselineBuildInput {
  root: string;
  rootLabel: string;
  version: string;
  createdBy: string;
  kernelFiles: string[];
  manifestFiles: string[];
  testFiles: string[];
  generatedAt?: string;
  maxFileBytes?: number;
}

export interface KernelBaselineBuildResult {
  baseline: KernelBaseline;
  manifest: KernelBaselineManifest;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableArtifacts(artifacts: KernelArtifact[]): KernelArtifact[] {
  return [...artifacts].sort((left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role));
}

function groupDigest(artifacts: KernelArtifact[]): string {
  return hash(JSON.stringify(stableArtifacts(artifacts).map(({ path: artifactPath, role, digest, sizeBytes }) => ({
    path: artifactPath,
    role,
    digest,
    sizeBytes,
  }))));
}

export class KernelBaselineBuilder {
  async build(input: KernelBaselineBuildInput): Promise<KernelBaselineBuildResult> {
    if (input.kernelFiles.length === 0) throw new Error("Kernel baseline requires at least one kernel file");
    if (input.testFiles.length === 0) throw new Error("Kernel baseline requires at least one test file");
    const root = await realpath(input.root);
    const maxFileBytes = Math.min(input.maxFileBytes ?? 10 * 1024 * 1024, 50 * 1024 * 1024);
    if (maxFileBytes < 1) throw new Error("Kernel baseline file limit must be positive");
    const declarations: Array<{ file: string; role: KernelArtifactRole }> = [
      ...input.kernelFiles.map((file) => ({ file, role: "kernel" as const })),
      ...input.manifestFiles.map((file) => ({ file, role: "manifest" as const })),
      ...input.testFiles.map((file) => ({ file, role: "test" as const })),
    ];
    const seen = new Set<string>();
    const artifacts: KernelArtifact[] = [];
    for (const declaration of declarations) {
      const artifact = await this.readArtifact(root, declaration.file, declaration.role, maxFileBytes);
      if (seen.has(artifact.path)) throw new Error(`Kernel baseline file is declared more than once: ${artifact.path}`);
      seen.add(artifact.path);
      artifacts.push(artifact);
    }
    const sorted = stableArtifacts(artifacts);
    const kernelDigest = groupDigest(sorted.filter((artifact) => artifact.role !== "test"));
    const testSuiteDigest = groupDigest(sorted.filter((artifact) => artifact.role === "test"));
    const manifestPayload = {
      formatVersion: 1 as const,
      version: input.version,
      rootLabel: input.rootLabel,
      artifacts: sorted,
      kernelDigest,
      testSuiteDigest,
    };
    const manifestDigest = hash(JSON.stringify(manifestPayload));
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const manifest = KernelBaselineManifestSchema.parse({ ...manifestPayload, manifestDigest, generatedAt });
    const baseline = KernelBaselineSchema.parse({
      id: `kernel_${input.version.replaceAll(".", "_")}_${kernelDigest.slice(0, 16)}`,
      version: input.version,
      kernelDigest,
      manifestDigest,
      testSuiteDigest,
      artifactRef: `kernel-baseline:sha256:${manifestDigest}`,
      status: "active",
      metadata: { manifest, fileCount: sorted.length },
      createdBy: input.createdBy,
      createdAt: generatedAt,
    });
    return { baseline, manifest };
  }

  private async readArtifact(root: string, requestedPath: string, role: KernelArtifactRole, maxFileBytes: number): Promise<KernelArtifact> {
    if (!requestedPath || path.isAbsolute(requestedPath)) throw new Error("Kernel baseline paths must be non-empty and relative");
    const joined = path.resolve(root, requestedPath);
    const requestedInfo = await lstat(joined);
    if (requestedInfo.isSymbolicLink()) throw new Error(`Kernel baseline artifact cannot be a symbolic link: ${requestedPath}`);
    const resolved = await realpath(joined);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Kernel baseline path escaped its root: ${requestedPath}`);
    const info = await lstat(resolved);
    if (!info.isFile()) throw new Error(`Kernel baseline artifact must be a regular file: ${requestedPath}`);
    if (info.size > maxFileBytes) throw new Error(`Kernel baseline artifact exceeds its size limit: ${requestedPath}`);
    const content = await readFile(resolved);
    return {
      path: relative.split(path.sep).join("/"),
      role,
      digest: hash(content),
      sizeBytes: content.byteLength,
    };
  }
}
