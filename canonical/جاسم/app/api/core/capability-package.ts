/** Build immutable capability packages from reviewed DNA candidates. */

import { createHash } from "node:crypto";
import path from "node:path";
import {
  CapabilityPackageManifestSchema,
  type CapabilityPackageBundle,
  type PackageRuntime,
} from "@contracts/capability-package";
import type { GeneCandidate } from "@contracts/generative-dna";
import type { DNAArtifactStore } from "./dna-artifact-store";

export interface CapabilityPackageBuildOptions {
  packageId?: string;
  version?: string;
  runtime?: PackageRuntime;
  entrypoint?: string;
  exportName?: string;
  publisher: string;
}

export class CapabilityPackageBuilder {
  constructor(private readonly artifacts: DNAArtifactStore) {}

  async build(candidate: GeneCandidate, options: CapabilityPackageBuildOptions): Promise<CapabilityPackageBundle> {
    if (candidate.proposal.kind !== "capability") {
      throw new Error("Only capability DNA candidates can become executable packages");
    }
    if (["rejected", "retired", "active"].includes(candidate.status)) {
      throw new Error(`Cannot build a package from a ${candidate.status} candidate`);
    }
    if (!candidate.source.uri?.startsWith("artifact://sha256/")) {
      throw new Error("Capability candidate has no content-addressed source artifact");
    }

    const content = await this.artifacts.get(candidate.source.uri);
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== candidate.source.digest) {
      throw new Error("Source artifact digest does not match the DNA candidate");
    }

    const runtime = options.runtime ?? this.inferRuntime(candidate.source.name);
    const entrypoint = this.safeEntrypoint(options.entrypoint ?? this.defaultEntrypoint(candidate.source.name, runtime));
    const mediaType = candidate.source.mediaType ?? this.mediaType(runtime);
    const packageId = options.packageId ?? this.packageId(candidate.proposal.name);
    const file = {
      path: entrypoint,
      digest,
      size: Buffer.byteLength(content, "utf8"),
      mediaType,
    };

    const manifest = CapabilityPackageManifestSchema.parse({
      schemaVersion: "1",
      packageId,
      version: options.version ?? "0.1.0",
      capabilityName: candidate.proposal.name,
      candidateId: candidate.id,
      runtime,
      entrypoint,
      exportName: options.exportName,
      inputSchema: candidate.proposal.inputSchema ?? {},
      outputSchema: candidate.proposal.outputSchema ?? {},
      permissions: candidate.proposal.permissions,
      dependencies: candidate.proposal.dependencies,
      files: [file],
      sourceDigest: candidate.source.digest,
      publisher: options.publisher,
      license: candidate.source.license,
      provenance: {
        sourceName: candidate.source.name,
        sourceUri: candidate.source.uri,
        ownerConsent: candidate.source.ownerConsent,
      },
      createdAt: new Date().toISOString(),
    });

    return {
      envelope: { manifest },
      contents: [{ ...file, content }],
    };
  }

  private inferRuntime(name: string): PackageRuntime {
    const extension = path.extname(name).toLowerCase();
    if ([".ts", ".tsx"].includes(extension)) return "typescript";
    if ([".js", ".mjs", ".cjs"].includes(extension)) return "javascript";
    if (extension === ".py") return "python";
    if ([".json", ".yaml", ".yml"].includes(extension)) return "declarative";
    return "declarative";
  }

  private defaultEntrypoint(name: string, runtime: PackageRuntime): string {
    const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "-");
    if (base) return base;
    const extensions: Record<PackageRuntime, string> = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      http: "json",
      declarative: "json",
    };
    return `main.${extensions[runtime]}`;
  }

  private safeEntrypoint(entrypoint: string): string {
    const normalized = path.posix.normalize(entrypoint.replace(/\\/g, "/"));
    if (normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
      throw new Error("Package entrypoint must stay inside the package");
    }
    return normalized;
  }

  private packageId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
    return `jasim.${slug || "capability"}.${suffix}`.slice(0, 128);
  }

  private mediaType(runtime: PackageRuntime): string {
    if (runtime === "typescript") return "text/typescript";
    if (runtime === "javascript") return "text/javascript";
    if (runtime === "python") return "text/x-python";
    return "application/json";
  }
}

