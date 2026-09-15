import { createHmac, createHash, timingSafeEqual } from "node:crypto";

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyWebhookToken(received: string | undefined, secret: string): boolean {
  if (!received || !secret) return false;
  return constantTimeTextEqual(received, secret);
}

export function verifyWebhookHmacSha256(rawBody: string, received: string | undefined, secret: string): boolean {
  if (!received || !secret) return false;
  const normalized = received.startsWith("sha256=") ? received.slice(7) : received;
  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return constantTimeTextEqual(normalized.toLowerCase(), expected);
}
