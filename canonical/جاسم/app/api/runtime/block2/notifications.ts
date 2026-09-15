/**
 * Block 2 — NotificationIntent and truthful delivery evidence.
 *
 * Creation records semantic intent only. Delivery is deliberately exposed as
 * an executor seam and refuses to run without an Attempt context. Provider
 * adapters never promote provider acceptance to end-recipient delivery.
 */

import { and, desc, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  notificationIntents,
  type NotificationChannelState,
  type NotificationIntent,
  type NotificationState,
} from "@db/schema";
import {
  emitToUser,
  getWebSocketInstance,
} from "../../core/websocket";
import type { Block2Db } from "./temporal";

export class NotificationError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "INVALID"
    | "BLOCKED_BY_PROVIDER"
    | "PRIVACY_VIOLATION";

  constructor(
    message: string,
    code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID"
      | "BLOCKED_BY_PROVIDER"
      | "PRIVACY_VIOLATION",
  ) {
    super(message);
    this.code = code;
  }
}

type NotificationContent = {
  title: string;
  body: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
};

export type ChannelAdapter = {
  channel: string;
  configured: boolean;
  send(input: {
    recipientId: string;
    content: NotificationContent;
    privacyClass: string;
    /** Stable provider idempotency/reference key for crash-safe redelivery. */
    referenceKey: string;
  }): Promise<{
    outcome: "PROVIDER_ACCEPTED" | "SENT" | "DELIVERED" | "FAILED" | "INCONCLUSIVE";
    providerReference?: string;
    error?: string;
  }>;
};

const CHANNEL_ORDER = ["in_app", "push", "whatsapp", "sms", "email"] as const;
const EXTERNAL_CHANNELS = new Set<string>(["push", "whatsapp", "sms", "email"]);
const TERMINAL_CHANNEL_STATES = new Set<NotificationState>(["DELIVERED", "READ", "FAILED"]);
const ADAPTER_TIMEOUT_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 10_000;

type AdapterResult = Awaited<ReturnType<ChannelAdapter["send"]>>;
type ProviderAdapter = ChannelAdapter & { configurationError?: string };

function dataString(content: NotificationContent, key: string): string | undefined {
  const value = content.data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providerError(channel: string, status: number, body: string): AdapterResult {
  const evidence = body.trim().slice(0, 500);
  return {
    outcome: "FAILED",
    error: `${channel} provider rejected request (HTTP ${status})${
      evidence ? `: ${evidence}` : ""
    }`,
  };
}

function unknownProviderError(error: unknown): AdapterResult {
  return {
    outcome: "INCONCLUSIVE",
    error: error instanceof Error ? error.message : String(error),
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pushAdapter(): ProviderAdapter {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const accessToken = process.env.FIREBASE_ACCESS_TOKEN;
  const baseConfigured = !!(projectId && clientEmail && privateKey);
  const configurationError = !baseConfigured
    ? "push requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY"
    : !accessToken
      ? "push requires FIREBASE_ACCESS_TOKEN because OAuth JWT signing is unavailable here"
      : undefined;

  return {
    channel: "push",
    configured: configurationError === undefined,
    configurationError,
    async send(input) {
      if (configurationError || !projectId || !accessToken) {
        return { outcome: "FAILED", error: configurationError ?? "push is not configured" };
      }
      const deviceToken = dataString(input.content, "deviceToken");
      if (!deviceToken) {
        return { outcome: "FAILED", error: "Push delivery requires content.data.deviceToken" };
      }
      try {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: deviceToken,
                notification: {
                  title: input.content.title,
                  body: input.content.body,
                },
                data: {
                  ...(input.content.actionUrl ? { actionUrl: input.content.actionUrl } : {}),
                },
              },
            }),
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          },
        );
        if (!response.ok) return providerError("push", response.status, await response.text());
        const body = await responseJson(response);
        return {
          outcome: "PROVIDER_ACCEPTED",
          ...(typeof body.name === "string" ? { providerReference: body.name } : {}),
        };
      } catch (error) {
        return unknownProviderError(error);
      }
    },
  };
}

function smsAdapter(): ProviderAdapter {
  const sid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const configurationError =
    sid && authToken && from
      ? undefined
      : "sms requires TWILIO_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER";

  return {
    channel: "sms",
    configured: configurationError === undefined,
    configurationError,
    async send(input) {
      if (configurationError || !sid || !authToken || !from) {
        return { outcome: "FAILED", error: configurationError ?? "sms is not configured" };
      }
      const phone = dataString(input.content, "phone");
      if (!phone) {
        return { outcome: "FAILED", error: "SMS delivery requires content.data.phone" };
      }
      try {
        const form = new URLSearchParams({
          To: phone,
          From: from,
          Body: `${input.content.title}\n${input.content.body}`,
        });
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "I-Twilio-Idempotency-Token": input.referenceKey,
            },
            body: form,
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          },
        );
        if (!response.ok) return providerError("sms", response.status, await response.text());
        const body = await responseJson(response);
        return {
          outcome: "PROVIDER_ACCEPTED",
          ...(typeof body.sid === "string" ? { providerReference: body.sid } : {}),
        };
      } catch (error) {
        return unknownProviderError(error);
      }
    },
  };
}

function whatsappAdapter(): ProviderAdapter {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const configurationError =
    phoneNumberId && accessToken
      ? undefined
      : "whatsapp requires WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN";

  return {
    channel: "whatsapp",
    configured: configurationError === undefined,
    configurationError,
    async send(input) {
      if (configurationError || !phoneNumberId || !accessToken) {
        return {
          outcome: "FAILED",
          error: configurationError ?? "whatsapp is not configured",
        };
      }
      const phone = dataString(input.content, "phone");
      if (!phone) {
        return {
          outcome: "FAILED",
          error: "WhatsApp delivery requires content.data.phone",
        };
      }
      try {
        const response = await fetch(
          `https://graph.facebook.com/v19.0/${encodeURIComponent(phoneNumberId)}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: phone,
              type: "text",
              text: { body: `${input.content.title}\n${input.content.body}` },
            }),
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          return providerError("whatsapp", response.status, await response.text());
        }
        const body = await responseJson(response);
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const first = messages[0];
        const providerReference =
          first && typeof first === "object" && typeof (first as Record<string, unknown>).id === "string"
            ? ((first as Record<string, unknown>).id as string)
            : undefined;
        return {
          outcome: "PROVIDER_ACCEPTED",
          ...(providerReference ? { providerReference } : {}),
        };
      } catch (error) {
        return unknownProviderError(error);
      }
    },
  };
}

function emailAdapter(): ProviderAdapter {
  const apiKey = process.env.SENDGRID_API_KEY;
  const configurationError = apiKey ? undefined : "email requires SENDGRID_API_KEY";

  return {
    channel: "email",
    configured: configurationError === undefined,
    configurationError,
    async send(input) {
      if (configurationError || !apiKey) {
        return { outcome: "FAILED", error: configurationError ?? "email is not configured" };
      }
      const email = dataString(input.content, "email");
      if (!email) {
        return { outcome: "FAILED", error: "Email delivery requires content.data.email" };
      }
      try {
        const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            personalizations: [{
              to: [{ email }],
              custom_args: { jasim_intent_id: input.referenceKey },
            }],
            from: { email: process.env.SENDGRID_FROM_EMAIL || "jasim@jasim.ai" },
            subject: input.content.title,
            content: [{ type: "text/plain", value: input.content.body }],
          }),
          signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        if (response.status !== 202) {
          return providerError("email", response.status, await response.text());
        }
        return {
          outcome: "PROVIDER_ACCEPTED",
          ...(response.headers.get("x-message-id")
            ? { providerReference: response.headers.get("x-message-id")! }
            : {}),
        };
      } catch (error) {
        return unknownProviderError(error);
      }
    },
  };
}

function inAppAdapter(): ChannelAdapter {
  return {
    channel: "in_app",
    configured: true,
    async send(input) {
      const socketOpen = getWebSocketInstance()?.isOnline(input.recipientId) === true;
      try {
        await emitToUser(input.recipientId, {
          type: "notification",
          data: {
            title: input.content.title,
            body: input.content.body,
            ...(input.content.actionUrl ? { actionUrl: input.content.actionUrl } : {}),
            ...(input.content.data ? { data: input.content.data } : {}),
          },
        });
        return { outcome: socketOpen ? "DELIVERED" : "SENT" };
      } catch (error) {
        return {
          outcome: "SENT",
          error: `WebSocket emit failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  };
}

export function getConfiguredChannelAdapters(): ChannelAdapter[] {
  return [
    pushAdapter(),
    smsAdapter(),
    whatsappAdapter(),
    emailAdapter(),
    inAppAdapter(),
  ];
}

export type CreateNotificationIntentInput = {
  ownerId: string;
  recipientId: string;
  purpose: string;
  content: NotificationContent;
  privacyClass?: "public" | "standard" | "sensitive";
  urgency?: "normal" | "high" | "critical";
  channels?: string[];
  runId?: string;
  nodeId?: string;
  entityRef?: { kind: string; id: string };
  expiresAt?: Date;
  idempotencyKey: string;
};

function validateCreateInput(input: CreateNotificationIntentInput): void {
  if (
    !input.ownerId.trim() ||
    !input.recipientId.trim() ||
    !input.idempotencyKey.trim() ||
    !input.content.title.trim() ||
    !input.content.body.trim()
  ) {
    throw new NotificationError(
      "ownerId, recipientId, idempotencyKey, title, and body are required",
      "INVALID",
    );
  }
  if (
    input.privacyClass === "sensitive" &&
    input.ownerId !== input.recipientId &&
    !input.purpose.trim()
  ) {
    throw new NotificationError(
      "Sensitive inter-user notifications require a non-empty purpose",
      "PRIVACY_VIOLATION",
    );
  }
  if (!input.purpose.trim()) {
    throw new NotificationError("purpose is required", "INVALID");
  }
  const unknown = (input.channels ?? []).filter(
    (channel) => !CHANNEL_ORDER.includes(channel as (typeof CHANNEL_ORDER)[number]),
  );
  if (unknown.length > 0) {
    throw new NotificationError(`Unknown notification channel: ${unknown[0]}`, "INVALID");
  }
}

function resolveChannels(input: CreateNotificationIntentInput): string[] {
  const privacyClass = input.privacyClass ?? "standard";
  if (privacyClass === "sensitive") return ["in_app"];

  const adapters = getConfiguredChannelAdapters();
  const configured = new Set(
    adapters.filter((adapter) => adapter.configured).map((adapter) => adapter.channel),
  );
  const requested = new Set(input.channels ?? []);
  const resolved = new Set<string>(["in_app"]);

  for (const channel of requested) {
    if (configured.has(channel)) resolved.add(channel);
  }
  if ((input.urgency ?? "normal") === "critical" && configured.has("push")) {
    resolved.add("push");
  }
  return CHANNEL_ORDER.filter((channel) => resolved.has(channel));
}

export async function createNotificationIntent(
  db: Block2Db,
  input: CreateNotificationIntentInput,
): Promise<NotificationIntent> {
  validateCreateInput(input);
  const channels = resolveChannels(input);
  const hasConfiguredRoute =
    channels.includes("in_app") ||
    channels.some((channel) => EXTERNAL_CHANNELS.has(channel));
  const state: NotificationState = hasConfiguredRoute ? "QUEUED" : "BLOCKED_BY_PROVIDER";
  const channelStates: Record<string, NotificationChannelState> = Object.fromEntries(
    channels.map((channel) => [channel, { state: "QUEUED" }]),
  );

  const inserted = await db
    .insert(notificationIntents)
    .values({
      id: `nti_${randomUUID()}`,
      ownerId: input.ownerId,
      recipientId: input.recipientId,
      purpose: input.purpose,
      content: input.content,
      privacyClass: input.privacyClass ?? "standard",
      urgency: input.urgency ?? "normal",
      channels,
      state,
      channelStates,
      runId: input.runId,
      nodeId: input.nodeId,
      entityRef: input.entityRef,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const existing = await db
    .select()
    .from(notificationIntents)
    .where(
      and(
        eq(notificationIntents.ownerId, input.ownerId),
        eq(notificationIntents.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    throw new NotificationError("Could not resolve idempotent notification intent", "INVALID");
  }
  return existing[0];
}

export type DeliverNotificationIntentInput = {
  intentId: string;
  attemptContext: { runId?: string; nodeId?: string; attemptId?: string };
  adapters?: ChannelAdapter[];
};

type AdapterOutcome = Awaited<ReturnType<ChannelAdapter["send"]>>;

async function callAdapter(
  adapter: ChannelAdapter,
  input: Parameters<ChannelAdapter["send"]>[0],
): Promise<AdapterOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AdapterOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ outcome: "INCONCLUSIVE", error: "Adapter timed out" }),
      ADAPTER_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([adapter.send(input), timeout]);
  } catch (error) {
    return {
      // A thrown transport/adapter error does not prove whether the provider
      // accepted the effect before the error surfaced.
      outcome: "INCONCLUSIVE",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function aggregateState(states: NotificationChannelState[]): NotificationState {
  if (states.some((entry) => entry.state === "READ")) return "READ";
  if (states.some((entry) => entry.state === "DELIVERED")) return "DELIVERED";
  if (
    states.some(
      (entry) => entry.state === "SENT" || entry.state === "PROVIDER_ACCEPTED",
    )
  ) {
    return "SENT";
  }
  if (states.length > 0 && states.every((entry) => entry.state === "FAILED")) return "FAILED";
  if (states.some((entry) => entry.state === "INCONCLUSIVE")) return "INCONCLUSIVE";
  if (
    states.length > 0 &&
    states.every((entry) => entry.state === "BLOCKED_BY_PROVIDER")
  ) {
    return "BLOCKED_BY_PROVIDER";
  }
  return "INCONCLUSIVE";
}

export async function deliverNotificationIntent(
  db: Block2Db,
  input: DeliverNotificationIntentInput,
): Promise<NotificationIntent> {
  if (input.attemptContext?.attemptId?.match(/^job:/)) {
    throw new NotificationError(
      "Synthetic job attempt contexts are forbidden for notification delivery",
      "FORBIDDEN",
    );
  }
  if (
    !input.attemptContext ||
    (!input.attemptContext.attemptId &&
      !input.attemptContext.runId &&
      !input.attemptContext.nodeId)
  ) {
    throw new NotificationError(
      "Notification delivery requires a Trusted Executor attempt context",
      "FORBIDDEN",
    );
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(notificationIntents)
      .where(eq(notificationIntents.id, input.intentId))
      .limit(1)
      .for("update");
    const intent = rows[0];
    if (!intent) throw new NotificationError("Notification intent not found", "NOT_FOUND");
    if (intent.privacyClass === "sensitive" && intent.channels.some((c) => c !== "in_app")) {
      throw new NotificationError(
        "Sensitive notification intent contains an external channel",
        "PRIVACY_VIOLATION",
      );
    }

    const adapters = input.adapters ?? getConfiguredChannelAdapters();
    const byChannel = new Map(adapters.map((adapter) => [adapter.channel, adapter]));
    const channelStates: Record<string, NotificationChannelState> = {
      ...intent.channelStates,
    };

    for (const channel of intent.channels) {
      const previous = channelStates[channel];
      if (previous && TERMINAL_CHANNEL_STATES.has(previous.state)) continue;
      const adapter = byChannel.get(channel);
      if (!adapter?.configured) {
        const configurationError = (adapter as ProviderAdapter | undefined)?.configurationError;
        channelStates[channel] = {
          state: "BLOCKED_BY_PROVIDER",
          at: new Date().toISOString(),
          ...(input.attemptContext.attemptId
            ? { attemptId: input.attemptContext.attemptId }
            : {}),
          error: configurationError ?? `No configured adapter for ${channel}`,
        };
        continue;
      }

      const outcome = await callAdapter(adapter, {
        recipientId: intent.recipientId,
        content: intent.content,
        privacyClass: intent.privacyClass,
        referenceKey: intent.id,
      });
      const validOutcomes = new Set<NotificationState>([
        "PROVIDER_ACCEPTED",
        "SENT",
        "DELIVERED",
        "FAILED",
        "INCONCLUSIVE",
      ]);
      const truthfulOutcome: NotificationState = validOutcomes.has(outcome.outcome)
        ? outcome.outcome
        : "INCONCLUSIVE";
      channelStates[channel] = {
        state: truthfulOutcome,
        at: new Date().toISOString(),
        ...(input.attemptContext.attemptId
          ? { attemptId: input.attemptContext.attemptId }
          : {}),
        ...(outcome.providerReference
          ? { providerReference: outcome.providerReference }
          : {}),
        ...(outcome.error
          ? { error: outcome.error }
          : truthfulOutcome === "INCONCLUSIVE"
            ? { error: "Adapter returned an unknown outcome" }
            : {}),
      };
    }

    const state = aggregateState(
      intent.channels.map(
        (channel) => channelStates[channel] ?? { state: "INCONCLUSIVE" },
      ),
    );
    const updated = await tx
      .update(notificationIntents)
      .set({ state, channelStates, updatedAt: new Date() })
      .where(eq(notificationIntents.id, intent.id))
      .returning();
    return updated[0];
  });
}

export async function markNotificationRead(
  db: Block2Db,
  input: { intentId: string; recipientId: string },
): Promise<NotificationIntent> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(notificationIntents)
      .where(eq(notificationIntents.id, input.intentId))
      .limit(1)
      .for("update");
    const intent = rows[0];
    if (!intent) throw new NotificationError("Notification intent not found", "NOT_FOUND");
    if (intent.recipientId !== input.recipientId) {
      throw new NotificationError("Only the recipient may mark a notification read", "FORBIDDEN");
    }
    if (intent.state !== "DELIVERED" && intent.state !== "SENT") return intent;

    const channelStates = {
      ...intent.channelStates,
      in_app: { state: "READ" as const, at: new Date().toISOString() },
    };
    const updated = await tx
      .update(notificationIntents)
      .set({ state: "READ", channelStates, updatedAt: new Date() })
      .where(eq(notificationIntents.id, intent.id))
      .returning();
    return updated[0];
  });
}

export async function listNotificationsForRecipient(
  db: Block2Db,
  input: { recipientId: string; unreadOnly?: boolean; limit?: number },
): Promise<
  Array<{
    id: string;
    content: Pick<NotificationContent, "title" | "body" | "actionUrl">;
    state: NotificationState;
    urgency: "normal" | "high" | "critical";
    createdAt: Date;
  }>
> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const where = input.unreadOnly
    ? and(
        eq(notificationIntents.recipientId, input.recipientId),
        ne(notificationIntents.state, "READ"),
      )
    : eq(notificationIntents.recipientId, input.recipientId);
  const rows = await db
    .select({
      id: notificationIntents.id,
      content: notificationIntents.content,
      state: notificationIntents.state,
      urgency: notificationIntents.urgency,
      createdAt: notificationIntents.createdAt,
    })
    .from(notificationIntents)
    .where(where)
    .orderBy(desc(notificationIntents.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    content: {
      title: row.content.title,
      body: row.content.body,
      ...(row.content.actionUrl ? { actionUrl: row.content.actionUrl } : {}),
    },
    state: row.state,
    urgency: row.urgency,
    createdAt: row.createdAt,
  }));
}