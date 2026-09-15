import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { generatedInputSecrets } from "@db/schema";

export interface SecretInputContext {
  taskId: number;
  userId: number;
  requestId: string;
  expiresAt: string;
}

export interface GeneratedInputSecretVault {
  put(context: SecretInputContext, values: Record<string, unknown>): Promise<string>;
  get(reference: string, context: Omit<SecretInputContext, "expiresAt">): Promise<Record<string, unknown>>;
  remove(reference: string, context: Pick<SecretInputContext, "taskId" | "userId">): Promise<void>;
}

export class MemoryGeneratedInputSecretVault implements GeneratedInputSecretVault {
  private readonly values = new Map<string, { context: SecretInputContext; values: Record<string, unknown> }>();

  async put(context: SecretInputContext, values: Record<string, unknown>): Promise<string> {
    const reference = randomUUID();
    this.values.set(reference, { context: { ...context }, values: structuredClone(values) });
    return reference;
  }

  async get(reference: string, context: Omit<SecretInputContext, "expiresAt">): Promise<Record<string, unknown>> {
    const stored = this.values.get(reference);
    if (!stored || stored.context.taskId !== context.taskId || stored.context.userId !== context.userId ||
      stored.context.requestId !== context.requestId || Date.parse(stored.context.expiresAt) <= Date.now()) {
      throw new Error("Sensitive runtime input is unavailable or expired");
    }
    return structuredClone(stored.values);
  }

  async remove(reference: string, context: Pick<SecretInputContext, "taskId" | "userId">): Promise<void> {
    const stored = this.values.get(reference);
    if (stored?.context.taskId === context.taskId && stored.context.userId === context.userId) this.values.delete(reference);
  }
}

export class DrizzleGeneratedInputSecretVault implements GeneratedInputSecretVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) throw new Error("APP_SECRET must contain at least 16 characters for runtime input encryption");
    this.key = createHash("sha256").update(`jasim-runtime-input:${secret}`).digest();
  }

  async put(context: SecretInputContext, values: Record<string, unknown>): Promise<string> {
    const reference = randomUUID();
    const iv = randomBytes(12);
    const aad = this.aad(reference, context.taskId, context.userId, context.requestId);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    await db.insert(generatedInputSecrets).values({
      id: reference,
      taskId: context.taskId,
      userId: context.userId,
      requestId: context.requestId,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      expiresAt: new Date(context.expiresAt),
    });
    return reference;
  }

  async get(reference: string, context: Omit<SecretInputContext, "expiresAt">): Promise<Record<string, unknown>> {
    const row = await db.query.generatedInputSecrets.findFirst({ where: and(
      eq(generatedInputSecrets.id, reference),
      eq(generatedInputSecrets.taskId, context.taskId),
      eq(generatedInputSecrets.userId, context.userId),
      eq(generatedInputSecrets.requestId, context.requestId),
    ) });
    if (!row || row.expiresAt <= new Date()) throw new Error("Sensitive runtime input is unavailable or expired");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.iv, "base64"));
    decipher.setAAD(Buffer.from(this.aad(reference, context.taskId, context.userId, context.requestId)));
    decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Sensitive runtime input is invalid");
    return parsed as Record<string, unknown>;
  }

  async remove(reference: string, context: Pick<SecretInputContext, "taskId" | "userId">): Promise<void> {
    await db.delete(generatedInputSecrets).where(and(
      eq(generatedInputSecrets.id, reference),
      eq(generatedInputSecrets.taskId, context.taskId),
      eq(generatedInputSecrets.userId, context.userId),
    ));
  }

  private aad(reference: string, taskId: number, userId: number, requestId: string): string {
    return `${reference}:${taskId}:${userId}:${requestId}`;
  }
}
