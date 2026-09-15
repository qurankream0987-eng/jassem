import type { Context } from "hono";
import { CredentialReferenceSchema } from "@contracts/external-connector";
import { EnvironmentConnectorCredentialProvider } from "./core/connector-credentials";
import { verifyWebhookHmacSha256, verifyWebhookToken } from "./core/external-webhook-auth";
import { normalizeMoyasarWebhook, normalizeShipdayWebhook } from "./core/external-webhook-runtime";
import { getExternalWebhookRuntime } from "./core/runtime";

const MAX_WEBHOOK_BYTES = 256 * 1024;
const credentials = new EnvironmentConnectorCredentialProvider();

async function rawPayload(c: Context): Promise<string> {
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBHOOK_BYTES) throw Object.assign(new Error("Webhook payload is too large"), { status: 413 });
  return raw;
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Webhook payload is not valid JSON"), { status: 400 });
  }
}

async function secretFrom(reference: string | undefined): Promise<string | undefined> {
  if (!reference) return undefined;
  return credentials.resolve(CredentialReferenceSchema.parse(reference));
}

function responseError(c: Context, error: unknown) {
  const status = Number((error as { status?: unknown } | undefined)?.status);
  const safeStatus = [400, 401, 413, 503].includes(status) ? status : 500;
  const message = safeStatus === 500 ? "Webhook processing failed" : error instanceof Error ? error.message : "Webhook rejected";
  return c.json({ accepted: false, error: message }, safeStatus as 400 | 401 | 413 | 500 | 503);
}

export async function handleShipdayWebhook(c: Context) {
  try {
    const secret = await secretFrom(process.env.JASIM_SHIPDAY_WEBHOOK_TOKEN_REF);
    if (!secret) throw Object.assign(new Error("Shipday webhook is not configured"), { status: 503 });
    if (secret.length > 32) throw Object.assign(new Error("Shipday webhook token exceeds provider limit"), { status: 503 });
    const raw = await rawPayload(c);
    if (!verifyWebhookToken(c.req.header("token"), secret)) {
      throw Object.assign(new Error("Webhook authentication failed"), { status: 401 });
    }
    const notification = normalizeShipdayWebhook(raw, parsePayload(raw));
    const result = await getExternalWebhookRuntime().process(notification);
    return c.json({ accepted: true, ...result }, 200);
  } catch (error) {
    return responseError(c, error);
  }
}

export async function handleMoyasarWebhook(c: Context) {
  try {
    const secret = await secretFrom(process.env.JASIM_MOYASAR_WEBHOOK_SECRET_REF);
    const mode = process.env.JASIM_MOYASAR_WEBHOOK_AUTH_MODE;
    const headerName = process.env.JASIM_MOYASAR_WEBHOOK_HEADER?.toLowerCase();
    if (!secret || !headerName || !["header_token", "hmac_sha256"].includes(mode ?? "")) {
      throw Object.assign(new Error("Moyasar webhook authentication is not explicitly configured"), { status: 503 });
    }
    if (!/^[a-z0-9-]{1,80}$/.test(headerName)) throw Object.assign(new Error("Moyasar webhook header setting is invalid"), { status: 503 });
    const raw = await rawPayload(c);
    const received = c.req.header(headerName);
    const authenticated = mode === "header_token"
      ? verifyWebhookToken(received, secret)
      : verifyWebhookHmacSha256(raw, received, secret);
    if (!authenticated) throw Object.assign(new Error("Webhook authentication failed"), { status: 401 });
    const notification = normalizeMoyasarWebhook(raw, parsePayload(raw));
    const result = await getExternalWebhookRuntime().process(notification);
    return c.json({ accepted: true, ...result }, 200);
  } catch (error) {
    return responseError(c, error);
  }
}
