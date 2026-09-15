/** Resolves only content-addressed artifacts from dedicated, read-only roots. */

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  KernelBaselineManifestSchema,
  CorePatchBundleSchema,
  type CorePatchBundle,
  type CoreLabEvaluationRequest,
  type KernelBaselineManifest,
} from "@contracts/core-evolution";

const SOURCE_REF = /^(?:artifact:\/\/sha256\/|dna-artifact:sha256:)([a-f0-9]{64})$/;
const BASELINE_REF = /^kernel-baseline:sha256:([a-f0-9]{64})$/;

export interface ResolvedCoreLabArtifacts {
  source: { path: string; digest: string; sizeBytes: number; bundle: CorePatchBundle };
  baseline: { path: string; manifest: KernelBaselineManifest; sizeBytes: number };
}

export interface CoreLabArtifactResolver {
  resolve(request: CoreLabEvaluationRequest): Promise<ResolvedCoreLabArtifacts>;
}

export interface FilesystemCoreLabArtifactResolverOptions {
  sourceRoot: string;
  baselineRoot: string;
  maxSourceBytes?: number;
  maxBaselineBytes?: number;
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function manifestDigest(manifest: KernelBaselineManifest): string {
  return sha256(JSON.stringify({
    formatVersion: manifest.formatVersion,
    version: manifest.version,
    rootLabel: manifest.rootLabel,
    artifacts: [...manifest.artifacts].sort(
      (left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role),
    ),
    kernelDigest: manifest.kernelDigest,
    testSuiteDigest: manifest.testSuiteDigest,
  }));
}

export class FilesystemCoreLabArtifactResolver implements CoreLabArtifactResolver {
  private readonly sourceRoot: string;
  private readonly baselineRoot: string;
  private readonly maxSourceBytes: number;
  private readonly maxBaselineBytes: number;

  constructor(options: FilesystemCoreLabArtifactResolverOptions) {
    this.sourceRoot = path.resolve(options.sourceRoot);
    this.baselineRoot = path.resolve(options.baselineRoot);
    this.maxSourceBytes = Math.min(options.maxSourceBytes ?? 64 * 1024 * 1024, 256 * 1024 * 1024);
    this.maxBaselineBytes = Math.min(options.maxBaselineBytes ?? 4 * 1024 * 1024, 16 * 1024 * 1024);
    if (this.maxSourceBytes < 1 || this.maxBaselineBytes < 1) throw new Error("Artifact limits must be positive");
  }

  async resolve(request: CoreLabEvaluationRequest): Promise<ResolvedCoreLabArtifacts> {
    const sourceDigest = this.digestFromRef(request.sourceArtifactRef, SOURCE_REF, "source");
    if (sourceDigest !== request.expectedSourceDigest) throw new Error("Source artifact reference does not match expected digest");
    const baselineDigest = this.digestFromRef(request.baselineArtifactRef, BASELINE_REF, "baseline");
    const sourcePath = await this.safeArtifactPath(this.sourceRoot, sourceDigest, ".blob");
    const baselinePath = await this.safeArtifactPath(this.baselineRoot, baselineDigest, ".json");
    const source = await this.readBounded(sourcePath, this.maxSourceBytes, "Source artifact");
    if (sha256(source) !== sourceDigest) throw new Error("Source artifact content digest does not match its reference");
    let sourceDecoded: unknown;
    try {
      sourceDecoded = JSON.parse(source.toString("utf8"));
    } catch {
      throw new Error("Core patch artifact is not valid JSON");
    }
    const bundle = CorePatchBundleSchema.parse(sourceDecoded);
    for (const file of bundle.files) {
      if (file.operation !== "upsert") continue;
      const decoded = Buffer.from(file.contentBase64, "base64");
      if (sha256(decoded) !== file.digest) throw new Error(`Core patch file digest mismatch: ${file.path}`);
    }
    const baselineBytes = await this.readBounded(baselinePath, this.maxBaselineBytes, "Baseline manifest");
    let decoded: unknown;
    try {
      decoded = JSON.parse(baselineBytes.toString("utf8"));
    } catch {
      throw new Error("Baseline manifest is not valid JSON");
    }
    const manifest = KernelBaselineManifestSchema.parse(decoded);
    if (manifest.manifestDigest !== baselineDigest || manifestDigest(manifest) !== baselineDigest) {
      throw new Error("Baseline manifest digest does not match its reference");
    }
    if (manifest.kernelDigest !== request.expectedKernelDigest) {
      throw new Error("Baseline manifest does not match the expected kernel digest");
    }
    if (bundle.baseManifestDigest !== baselineDigest || bundle.targetVersion !== request.targetVersion) {
      throw new Error("Core patch bundle targets a different baseline or version");
    }
    const declaredScope = new Set(request.declaredScope);
    if (bundle.files.some((file) => !declaredScope.has(file.path))) {
      throw new Error("Core patch bundle contains a file outside its declared scope");
    }
    return {
      source: { path: sourcePath, digest: sourceDigest, sizeBytes: source.byteLength, bundle },
      baseline: { path: baselinePath, manifest, sizeBytes: baselineBytes.byteLength },
    };
  }

  private digestFromRef(ref: string, pattern: RegExp, label: string): string {
    const match = pattern.exec(ref);
    if (!match) throw new Error(`Invalid content-addressed ${label} artifact reference`);
    return match[1];
  }

  private async safeArtifactPath(root: string, digest: string, extension: string): Promise<string> {
    const resolvedRoot = await realpath(root);
    const target = path.resolve(resolvedRoot, digest.slice(0, 2), `${digest}${extension}`);
    const relative = path.relative(resolvedRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Artifact path escaped its configured root");
    const directInfo = await lstat(target);
    if (directInfo.isSymbolicLink()) throw new Error("Artifact cannot be a symbolic link");
    const resolvedTarget = await realpath(target);
    const realRelative = path.relative(resolvedRoot, resolvedTarget);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("Artifact resolved outside its configured root");
    const info = await lstat(resolvedTarget);
    if (!info.isFile()) throw new Error("Artifact must be a regular file");
    return resolvedTarget;
  }

  private async readBounded(target: string, maxBytes: number, label: string): Promise<Buffer> {
    const info = await lstat(target);
    if (info.size > maxBytes) throw new Error(`${label} exceeds its configured size limit`);
    return readFile(target);
  }
}
