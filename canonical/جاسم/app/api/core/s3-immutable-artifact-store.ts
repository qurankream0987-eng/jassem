/** S3-compatible immutable storage using conditional writes and SHA-256 checksums. */

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { contentDigest, type ImmutableArtifactStore, type PutImmutableArtifactOptions, type ReadImmutableArtifactOptions } from "./immutable-artifact-store";
import { ImmutableArtifactSchema, artifactUri, digestFromArtifactUri, type ImmutableArtifact } from "@contracts/immutable-artifact";

export interface S3ImmutableArtifactStoreOptions {
  bucket: string;
  prefix?: string;
  expectedBucketOwner?: string;
  client?: S3Client;
  clientConfig?: S3ClientConfig;
}

export class S3ImmutableArtifactStore implements ImmutableArtifactStore {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(private readonly options: S3ImmutableArtifactStoreOptions) {
    if (!options.bucket) throw new Error("Immutable artifact S3 bucket is required");
    this.client = options.client ?? new S3Client(options.clientConfig ?? {});
    this.prefix = (options.prefix ?? "jasim-artifacts").replace(/^\/+|\/+$/g, "");
    if (!this.prefix || this.prefix.includes("..")) throw new Error("Invalid immutable artifact S3 prefix");
  }

  async put(content: Uint8Array, options: PutImmutableArtifactOptions = {}): Promise<ImmutableArtifact> {
    const bytes = Buffer.from(content);
    const digest = contentDigest(bytes);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.key(digest),
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: options.mediaType ?? "application/octet-stream",
        ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"),
        IfNoneMatch: "*",
        ExpectedBucketOwner: this.options.expectedBucketOwner,
        Metadata: { sha256: digest, immutable: "true" },
      }));
    } catch (error) {
      const status = error && typeof error === "object" && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
      if (status !== 409 && status !== 412) throw error;
      await this.get(artifactUri(digest), { maxBytes: bytes.byteLength });
    }
    return ImmutableArtifactSchema.parse({
      uri: artifactUri(digest), digest, sizeBytes: bytes.byteLength,
      mediaType: options.mediaType ?? "application/octet-stream",
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
  }

  async get(uri: string, options: ReadImmutableArtifactOptions = {}): Promise<Buffer> {
    const digest = digestFromArtifactUri(uri);
    const maxBytes = Math.min(options.maxBytes ?? 64 * 1024 * 1024, 256 * 1024 * 1024);
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.options.bucket,
      Key: this.key(digest),
      ChecksumMode: "ENABLED",
      ExpectedBucketOwner: this.options.expectedBucketOwner,
    }));
    if ((response.ContentLength ?? 0) > maxBytes) throw new Error("Immutable artifact exceeds its read limit");
    if (!response.Body) throw new Error(`Immutable artifact ${digest} has no body`);
    const content = Buffer.from(await response.Body.transformToByteArray());
    if (content.byteLength > maxBytes) throw new Error("Immutable artifact exceeds its read limit");
    if (contentDigest(content) !== digest) throw new Error("Immutable artifact failed SHA-256 verification after download");
    if (response.ChecksumSHA256 && response.ChecksumSHA256 !== Buffer.from(digest, "hex").toString("base64")) {
      throw new Error("Immutable artifact S3 checksum does not match its content address");
    }
    return content;
  }

  async head(uri: string): Promise<{ digest: string; sizeBytes: number } | undefined> {
    const digest = digestFromArtifactUri(uri);
    try {
      const response = await this.client.send(new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: this.key(digest),
        ChecksumMode: "ENABLED",
        ExpectedBucketOwner: this.options.expectedBucketOwner,
      }));
      return { digest, sizeBytes: response.ContentLength ?? 0 };
    } catch (error) {
      const status = error && typeof error === "object" && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
      if (status === 404) return undefined;
      throw error;
    }
  }

  private key(digest: string): string {
    return `${this.prefix}/sha256/${digest.slice(0, 2)}/${digest}.blob`;
  }
}
