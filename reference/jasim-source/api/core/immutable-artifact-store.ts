/** Generic immutable, content-addressed artifact storage. No domain folders. */

import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  ImmutableArtifactSchema,
  artifactUri,
  digestFromArtifactUri,
  type ImmutableArtifact,
} from "@contracts/immutable-artifact";

export interface PutImmutableArtifactOptions {
  mediaType?: string;
  createdAt?: string;
}

export interface ReadImmutableArtifactOptions {
  maxBytes?: number;
}

export interface ImmutableArtifactStore {
  put(content: Uint8Array, options?: PutImmutableArtifactOptions): Promise<ImmutableArtifact>;
  get(uri: string, options?: ReadImmutableArtifactOptions): Promise<Buffer>;
  head(uri: string): Promise<{ digest: string; sizeBytes: number } | undefined>;
}

export const contentDigest = (content: Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

function artifact(digest: string, sizeBytes: number, options: PutImmutableArtifactOptions): ImmutableArtifact {
  return ImmutableArtifactSchema.parse({
    uri: artifactUri(digest),
    digest,
    sizeBytes,
    mediaType: options.mediaType ?? "application/octet-stream",
    createdAt: options.createdAt ?? new Date().toISOString(),
  });
}

export class MemoryImmutableArtifactStore implements ImmutableArtifactStore {
  private readonly objects = new Map<string, Buffer>();

  async put(content: Uint8Array, options: PutImmutableArtifactOptions = {}): Promise<ImmutableArtifact> {
    const bytes = Buffer.from(content);
    const digest = contentDigest(bytes);
    const existing = this.objects.get(digest);
    if (existing && contentDigest(existing) !== digest) throw new Error("Immutable artifact digest conflict");
    if (!existing) this.objects.set(digest, Buffer.from(bytes));
    return artifact(digest, bytes.byteLength, options);
  }

  async get(uri: string, options: ReadImmutableArtifactOptions = {}): Promise<Buffer> {
    const digest = digestFromArtifactUri(uri);
    const content = this.objects.get(digest);
    if (!content) throw new Error(`Immutable artifact ${digest} was not found`);
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    if (content.byteLength > maxBytes) throw new Error("Immutable artifact exceeds its read limit");
    if (contentDigest(content) !== digest) throw new Error("Immutable artifact failed digest verification");
    return Buffer.from(content);
  }

  async head(uri: string): Promise<{ digest: string; sizeBytes: number } | undefined> {
    const digest = digestFromArtifactUri(uri);
    const content = this.objects.get(digest);
    return content ? { digest, sizeBytes: content.byteLength } : undefined;
  }
}

export class FilesystemImmutableArtifactStore implements ImmutableArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(content: Uint8Array, options: PutImmutableArtifactOptions = {}): Promise<ImmutableArtifact> {
    const bytes = Buffer.from(content);
    const digest = contentDigest(bytes);
    const { target, directory } = await this.target(digest, true);
    const temporary = path.join(directory, `.${digest}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      const existing = await this.readVerified(target, digest, bytes.byteLength);
      if (!existing.equals(bytes)) throw new Error("Immutable artifact key already contains different bytes");
    } finally {
      await rm(temporary, { force: true });
    }
    return artifact(digest, bytes.byteLength, options);
  }

  async get(uri: string, options: ReadImmutableArtifactOptions = {}): Promise<Buffer> {
    const digest = digestFromArtifactUri(uri);
    const maxBytes = Math.min(options.maxBytes ?? 64 * 1024 * 1024, 256 * 1024 * 1024);
    const { target } = await this.target(digest, false);
    return this.readVerified(target, digest, maxBytes);
  }

  async head(uri: string): Promise<{ digest: string; sizeBytes: number } | undefined> {
    const digest = digestFromArtifactUri(uri);
    try {
      const { target } = await this.target(digest, false);
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) throw new Error("Immutable artifact must be a regular file");
      return { digest, sizeBytes: info.size };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async target(digest: string, create: boolean): Promise<{ target: string; directory: string }> {
    const directory = path.resolve(this.root, "sha256", digest.slice(0, 2));
    if (create) await mkdir(directory, { recursive: true });
    const resolvedRoot = await realpath(this.root);
    const resolvedDirectory = await realpath(directory);
    const relativeDirectory = path.relative(resolvedRoot, resolvedDirectory);
    if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
      throw new Error("Immutable artifact directory escaped its configured root");
    }
    const target = path.resolve(resolvedDirectory, `${digest}.blob`);
    const relativeTarget = path.relative(resolvedRoot, target);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      throw new Error("Immutable artifact path escaped its configured root");
    }
    return { target, directory: resolvedDirectory };
  }

  private async readVerified(target: string, digest: string, maxBytes: number): Promise<Buffer> {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("Immutable artifact must be a regular file");
    if (info.size > maxBytes) throw new Error("Immutable artifact exceeds its read limit");
    const content = await readFile(target);
    if (contentDigest(content) !== digest) throw new Error("Immutable artifact failed digest verification");
    return content;
  }
}
