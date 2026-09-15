/**
 * File Tool Adapter — Real File Read/Write
 *
 * Reads and writes files from configured storage:
 * - Local filesystem (configured via FILE_STORAGE_PATH)
 * - S3-compatible storage (configured via S3_BUCKET, AWS credentials)
 *
 * Supports text, JSON, and binary content detection.
 */

import { readFile, writeFile, mkdir, access, constants } from "fs/promises";
import { dirname, basename, join, resolve } from "path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";

export interface FileReadInputs {
  path: string;
  encoding?: "utf8" | "base64" | "binary";
}

export interface FileWriteInputs {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  contentType?: string;
}

// Storage configuration
const STORAGE_TYPE = process.env.FILE_STORAGE_TYPE || "local";
const LOCAL_STORAGE_PATH = process.env.FILE_STORAGE_PATH || "/mnt/agents/output/app/storage";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT; // For MinIO, etc.
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || "";
const S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials:
        S3_ACCESS_KEY && S3_SECRET_KEY
          ? { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY }
          : undefined,
      forcePathStyle: !!S3_ENDPOINT, // Required for MinIO
    });
  }
  return s3Client;
}

/**
 * Read a file from configured storage.
 */
export async function executeFileRead(
  inputs: FileReadInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();

  try {
    const filePath = validateAndResolvePath(inputs.path);
    const encoding = inputs.encoding || detectEncoding(filePath);

    let content: string;
    let metadata: Record<string, unknown>;

    if (STORAGE_TYPE === "s3" && S3_BUCKET) {
      const { body, meta } = await readFromS3(filePath);
      content = body;
      metadata = meta;
    } else {
      const { body, meta } = await readFromLocal(filePath, encoding);
      content = body;
      metadata = meta;
    }

    // Detect if content is JSON
    let parsed: unknown = null;
    const contentType = String(metadata.contentType || "");
    if (encoding === "utf8" && contentType.includes("json")) {
      try {
        parsed = JSON.parse(content);
      } catch {
        // Not valid JSON, leave as string
      }
    }

    return {
      success: true,
      output: {
        content: parsed ?? content,
        path: filePath,
        filename: basename(filePath),
        size: content.length,
        encoding,
        contentType: metadata.contentType || "text/plain",
        lastModified: metadata.lastModified,
      },
      duration: Date.now() - start,
      sideEffects: [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects: [],
    };
  }
}

/**
 * Write a file to configured storage.
 */
export async function executeFileWrite(
  inputs: FileWriteInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();

  try {
    const filePath = validateAndResolvePath(inputs.path);
    const encoding = inputs.encoding || "utf8";
    const contentType = inputs.contentType || detectContentType(filePath);

    if (STORAGE_TYPE === "s3" && S3_BUCKET) {
      await writeToS3(filePath, inputs.content, contentType, encoding);
    } else {
      await writeToLocal(filePath, inputs.content, encoding);
    }

    return {
      success: true,
      output: {
        written: true,
        path: filePath,
        filename: basename(filePath),
        size: inputs.content.length,
        encoding,
        contentType,
      },
      duration: Date.now() - start,
      sideEffects: ["data_modification"],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local Storage
// ─────────────────────────────────────────────────────────────────────────────

async function readFromLocal(
  filePath: string,
  encoding: string
): Promise<{ body: string; meta: Record<string, unknown> }> {
  const fullPath = resolve(LOCAL_STORAGE_PATH, filePath);

  // Security check: ensure path is within storage
  if (!fullPath.startsWith(resolve(LOCAL_STORAGE_PATH))) {
    throw new ToolError(
      ERROR_CODES.TOOL_UNAUTHORIZED,
      `Access denied: ${filePath} is outside storage directory`,
      "file_read"
    );
  }

  const stats = await readFile(fullPath);
  const buf = Buffer.from(stats);

  let body: string;
  if (encoding === "base64") {
    body = buf.toString("base64");
  } else if (encoding === "binary") {
    body = buf.toString("hex");
  } else {
    body = buf.toString("utf8");
  }

  return {
    body,
    meta: {
      contentType: detectContentType(filePath),
      lastModified: new Date().toISOString(),
    },
  };
}

async function writeToLocal(
  filePath: string,
  content: string,
  encoding: string
): Promise<void> {
  const fullPath = resolve(LOCAL_STORAGE_PATH, filePath);

  // Security check
  if (!fullPath.startsWith(resolve(LOCAL_STORAGE_PATH))) {
    throw new ToolError(
      ERROR_CODES.TOOL_UNAUTHORIZED,
      `Access denied: ${filePath} is outside storage directory`,
      "file_write"
    );
  }

  await mkdir(dirname(fullPath), { recursive: true });

  const buf =
    encoding === "base64"
      ? Buffer.from(content, "base64")
      : Buffer.from(content, "utf8");

  await writeFile(fullPath, buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 Storage
// ─────────────────────────────────────────────────────────────────────────────

async function readFromS3(
  key: string
): Promise<{ body: string; meta: Record<string, unknown> }> {
  const client = getS3Client();

  const getCmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  const response = await client.send(getCmd);

  const stream = response.Body;
  if (!stream) {
    throw new Error("Empty response body from S3");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);

  return {
    body: buf.toString("utf8"),
    meta: {
      contentType: response.ContentType || "application/octet-stream",
      lastModified: response.LastModified?.toISOString(),
      size: response.ContentLength,
    },
  };
}

async function writeToS3(
  key: string,
  content: string,
  contentType: string,
  encoding: string
): Promise<void> {
  const client = getS3Client();
  const buf =
    encoding === "base64"
      ? Buffer.from(content, "base64")
      : Buffer.from(content, "utf8");

  const putCmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buf,
    ContentType: contentType,
  });

  await client.send(putCmd);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function validateAndResolvePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== "string") {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "File tool requires a 'path' string",
      "file_read"
    );
  }

  // Prevent path traversal
  const cleaned = inputPath.replace(/\.\./g, "").replace(/^\//, "");
  if (!cleaned) {
    throw new ToolError(
      ERROR_CODES.VALIDATION_FAILED,
      "Invalid file path",
      "file_read"
    );
  }

  return cleaned;
}

function detectEncoding(filePath: string): "utf8" | "base64" | "binary" {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const binaryExts = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "zip", "mp4", "mp3"];
  if (binaryExts.includes(ext)) return "base64";
  return "utf8";
}

function detectContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    json: "application/json",
    js: "application/javascript",
    ts: "application/typescript",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    zip: "application/zip",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
  };
  return map[ext] || "application/octet-stream";
}
