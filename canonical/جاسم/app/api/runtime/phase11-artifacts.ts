import { createHash, randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SIGNED_READ_TTL_MS = 15 * 60 * 1000;
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Replit App Storage authenticates through the local sidecar. Do not rely on
// ambient Google ADC: it is intentionally absent from normal Replit processes.
const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export type GeneratedImageArtifact = {
  artifactId: string;
  objectPath: string;
  sha256: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
  createdAt: string;
  prompt: string;
};

function storageConfig(): { bucketId: string; privatePrefix: string } {
  const defaultBucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID?.trim();
  const privateDir = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!defaultBucketId || !privateDir) {
    throw new Error("App Storage is not configured for generated artifacts.");
  }
  const segments = privateDir.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const includesBucket = segments[0] === defaultBucketId;
  const bucketId = includesBucket ? segments[0]! : defaultBucketId;
  const privatePrefix = (includesBucket ? segments.slice(1) : segments).join("/");
  if (!privatePrefix) throw new Error("App Storage private object path is invalid.");
  return { bucketId, privatePrefix };
}

function contentTypeForImage(value: string | null | undefined): GeneratedImageArtifact["contentType"] {
  if (value === "image/jpeg") return "image/jpeg";
  if (value === "image/webp") return "image/webp";
  return "image/png";
}

function extensionForImage(contentType: GeneratedImageArtifact["contentType"]): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

/**
 * Stores provider-returned image bytes in the app's private bucket. The caller
 * never supplies an object path, so one owner cannot target another owner's data.
 */
export async function persistGeneratedImageArtifact(input: {
  ownerId: string;
  runId?: string;
  nodeId?: string;
  prompt: string;
  bytes: Buffer;
  contentType?: string | null;
}): Promise<GeneratedImageArtifact> {
  if (input.bytes.length === 0 || input.bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Generated image is empty or exceeds the artifact size limit.");
  }

  const { bucketId, privatePrefix } = storageConfig();
  const contentType = contentTypeForImage(input.contentType);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const ownerPartition = createHash("sha256").update(input.ownerId).digest("hex").slice(0, 24);
  const stableKey = `${privatePrefix}/jasim/generated/${ownerPartition}/${sha256}.${extensionForImage(contentType)}`;
  const file = objectStorageClient.bucket(bucketId).file(stableKey);

  const [exists] = await file.exists();
  if (!exists) {
    await file.save(input.bytes, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          artifactKind: "jasim-generated-image",
          ownerPartition,
          sourceRunId: input.runId ?? "",
          sourceNodeId: input.nodeId ?? "",
          artifactId: randomUUID(),
        },
      },
    });
  }

  return {
    artifactId: `img_${sha256.slice(0, 32)}`,
    objectPath: stableKey,
    sha256,
    contentType,
    byteLength: input.bytes.length,
    createdAt: new Date().toISOString(),
    prompt: input.prompt.slice(0, 4_000),
  };
}

/**
 * Resolves a short-lived private read URL after the runtime has already
 * owner-scoped the enclosing receipt. URLs are intentionally never persisted.
 */
export async function createGeneratedArtifactReadUrl(objectPath: string): Promise<string> {
  const { bucketId, privatePrefix } = storageConfig();
  const expectedPrefix = `${privatePrefix}/jasim/generated/`;
  if (!objectPath.startsWith(expectedPrefix) || objectPath.includes("..")) {
    throw new Error("Invalid generated artifact reference.");
  }
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketId,
      object_name: objectPath,
      method: "GET",
      expires_at: new Date(Date.now() + SIGNED_READ_TTL_MS).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("App Storage could not create a read URL.");
  const payload = await response.json() as { signed_url?: string };
  if (!payload.signed_url) throw new Error("App Storage returned no read URL.");
  return payload.signed_url;
}

export async function readGeneratedImageArtifact(objectPath: string): Promise<{
  bytes: Buffer;
  contentType: string;
}> {
  const { bucketId, privatePrefix } = storageConfig();
  const expectedPrefix = `${privatePrefix}/jasim/generated/`;
  if (!objectPath.startsWith(expectedPrefix) || objectPath.includes("..")) {
    throw new Error("Invalid generated artifact reference.");
  }
  const file = objectStorageClient.bucket(bucketId).file(objectPath);
  const [bytes] = await file.download();
  const [metadata] = await file.getMetadata();
  return { bytes, contentType: String(metadata.contentType ?? "image/png") };
}