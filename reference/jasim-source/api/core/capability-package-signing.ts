/** Ed25519 attestation and release signatures for capability packages. */

import {
  createHash,
  sign,
  verify,
  type KeyLike,
} from "node:crypto";
import path from "node:path";
import type {
  CapabilityPackageBundle,
  CapabilityPackageEnvelope,
  CapabilityPackageSignature,
} from "@contracts/capability-package";

type SignableKey = KeyLike | string | Buffer;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

export function verifyBundleIntegrity(bundle: CapabilityPackageBundle): void {
  const manifestFiles = new Map(bundle.envelope.manifest.files.map((file) => [file.path, file]));
  const contentFiles = new Map(bundle.contents.map((file) => [file.path, file]));
  if (manifestFiles.size !== bundle.envelope.manifest.files.length || contentFiles.size !== bundle.contents.length) {
    throw new Error("Duplicate package file path");
  }
  if (manifestFiles.size !== bundle.contents.length) throw new Error("Package file count mismatch");
  for (const file of bundle.contents) {
    const normalized = path.posix.normalize(file.path.replace(/\\/g, "/"));
    if (normalized !== file.path || normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized)) {
      throw new Error(`Unsafe package file path ${file.path}`);
    }
    const manifestFile = manifestFiles.get(file.path);
    if (!manifestFile) throw new Error(`File ${file.path} is not declared in the manifest`);
    const digest = createHash("sha256").update(file.content).digest("hex");
    const size = Buffer.byteLength(file.content, "utf8");
    if (digest !== file.digest || digest !== manifestFile.digest) throw new Error(`Digest mismatch for ${file.path}`);
    if (size !== file.size || size !== manifestFile.size) throw new Error(`Size mismatch for ${file.path}`);
  }
  if (!manifestFiles.has(bundle.envelope.manifest.entrypoint)) throw new Error("Package entrypoint is not present in its files");
}

export function capabilityPackageDigest(bundle: CapabilityPackageBundle): string {
  verifyBundleIntegrity(bundle);
  const unsignedEnvelope: CapabilityPackageEnvelope = {
    manifest: bundle.envelope.manifest,
    evaluation: bundle.envelope.evaluation,
  };
  return createHash("sha256").update(canonicalize(unsignedEnvelope)).digest("hex");
}

/** Digest evaluated by a sandbox. It deliberately excludes evaluation and signature. */
export function capabilityPackagePayloadDigest(bundle: CapabilityPackageBundle): string {
  verifyBundleIntegrity(bundle);
  return createHash("sha256").update(canonicalize(bundle.envelope.manifest)).digest("hex");
}

export class CapabilityPackageSigner {
  sign(
    bundle: CapabilityPackageBundle,
    privateKey: SignableKey,
    options: { keyId: string; scope: CapabilityPackageSignature["scope"] },
  ): CapabilityPackageBundle {
    const evaluation = bundle.envelope.evaluation;
    if (!evaluation?.passed) throw new Error("A passing package evaluation is required before signing");
    if (evaluation.packageDigest !== capabilityPackagePayloadDigest(bundle)) {
      throw new Error("Package evaluation does not belong to this immutable payload");
    }
    if (options.scope === "execution_release") {
      if (evaluation.mode !== "isolated" || !evaluation.executionPerformed || !evaluation.eligibleForExecutionRelease) {
        throw new Error("Execution release requires a passing isolated evaluation");
      }
    }

    const digest = capabilityPackageDigest(bundle);
    const signature: CapabilityPackageSignature = {
      algorithm: "Ed25519",
      keyId: options.keyId,
      scope: options.scope,
      signedDigest: digest,
      value: sign(null, Buffer.from(digest, "hex"), privateKey).toString("base64"),
      signedAt: new Date().toISOString(),
    };
    return {
      envelope: { ...bundle.envelope, signature },
      contents: bundle.contents.map((file) => ({ ...file })),
    };
  }

  verify(bundle: CapabilityPackageBundle, publicKey: SignableKey): boolean {
    const signature = bundle.envelope.signature;
    if (!signature || signature.algorithm !== "Ed25519") return false;
    try {
      const digest = capabilityPackageDigest(bundle);
      if (digest !== signature.signedDigest) return false;
      return verify(
        null,
        Buffer.from(digest, "hex"),
        publicKey,
        Buffer.from(signature.value, "base64"),
      );
    } catch {
      return false;
    }
  }
}
