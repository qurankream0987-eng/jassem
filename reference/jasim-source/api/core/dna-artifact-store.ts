/** Content-addressed storage for assimilated source artifacts. */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredDNAArtifact {
  digest: string;
  uri: string;
  size: number;
  mediaType?: string;
  name: string;
}

export interface DNAArtifactStore {
  put(content: string, metadata: { name: string; mediaType?: string }): Promise<StoredDNAArtifact>;
  get(uri: string): Promise<string>;
}

function artifactDigest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function digestFromUri(uri: string): string {
  const match = uri.match(/^artifact:\/\/sha256\/([a-f0-9]{64})$/);
  if (!match) throw new Error("Invalid DNA artifact URI");
  return match[1];
}

export class MemoryDNAArtifactStore implements DNAArtifactStore {
  private readonly blobs = new Map<string, string>();

  async put(content: string, metadata: { name: string; mediaType?: string }): Promise<StoredDNAArtifact> {
    const digest = artifactDigest(content);
    this.blobs.set(digest, content);
    return {
      digest,
      uri: `artifact://sha256/${digest}`,
      size: Buffer.byteLength(content, "utf8"),
      mediaType: metadata.mediaType,
      name: metadata.name,
    };
  }

  async get(uri: string): Promise<string> {
    const digest = digestFromUri(uri);
    const content = this.blobs.get(digest);
    if (content === undefined) throw new Error(`DNA artifact ${digest} was not found`);
    return content;
  }
}

export class FilesystemDNAArtifactStore implements DNAArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(content: string, metadata: { name: string; mediaType?: string }): Promise<StoredDNAArtifact> {
    const digest = artifactDigest(content);
    const target = this.pathForDigest(digest);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
    return {
      digest,
      uri: `artifact://sha256/${digest}`,
      size: Buffer.byteLength(content, "utf8"),
      mediaType: metadata.mediaType,
      name: metadata.name,
    };
  }

  async get(uri: string): Promise<string> {
    return readFile(this.pathForDigest(digestFromUri(uri)), "utf8");
  }

  private pathForDigest(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid artifact digest");
    const target = path.resolve(this.root, digest.slice(0, 2), `${digest}.blob`);
    const relative = path.relative(this.root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Artifact path escaped the configured store");
    }
    return target;
  }
}

