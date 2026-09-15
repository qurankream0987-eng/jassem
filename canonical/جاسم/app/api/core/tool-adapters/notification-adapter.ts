/**
 * Notification Tool Adapter — Real Notification Dispatch
 *
 * Sends notifications via configured providers:
 * - Email (SendGrid)
 * - SMS
 * - WhatsApp
 * - Push (Firebase)
 * - In-app
 *
 * Uses the existing JASIM NotificationRouter infrastructure.
 */

import { ToolError, ERROR_CODES } from "@contracts/errors";
import type { ExecutionContext, ToolResult } from "../tool-runtime";
import {
  getNotificationRouter,
  type NotificationPayload,
} from "../notifications";

export interface NotificationInputs {
  channel: "email" | "sms" | "whatsapp" | "push" | "in_app" | "broadcast";
  recipient: string; // userId for routed channels, or direct address
  title: string;
  message: string;
  data?: Record<string, unknown>;
  urgency?: "normal" | "high" | "critical";
  actionUrl?: string;
  channels?: Array<"email" | "sms" | "whatsapp" | "push" | "in_app">; // for broadcast
}

/**
 * Execute a real notification dispatch.
 */
export async function executeNotification(
  inputs: NotificationInputs,
  _ctx: ExecutionContext
): Promise<ToolResult> {
  const start = Date.now();
  const sideEffects: string[] = ["external_communication"];

  try {
    if (!inputs.recipient) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "Notification requires a 'recipient' field",
        "notification"
      );
    }

    if (!inputs.message) {
      throw new ToolError(
        ERROR_CODES.VALIDATION_FAILED,
        "Notification requires a 'message' field",
        "notification"
      );
    }

    const urgency = inputs.urgency || "normal";

    // Build notification payload
    const payload: NotificationPayload = {
      userId: inputs.recipient,
      type: "tool_notification",
      urgency,
      title: inputs.title || "Notification",
      body: inputs.message,
      data: inputs.data,
      actionUrl: inputs.actionUrl,
    };

    const router = getNotificationRouter();

    if (inputs.channel === "broadcast") {
      // Dispatch via router to all appropriate channels
      const results = await router.dispatch(payload);

      return {
        success: true,
        output: {
          broadcast: true,
          recipient: inputs.recipient,
          channels: results.map((r) => ({
            channel: r.channel,
            status: r.status,
            error: r.error,
            providerResponse: r.providerResponse,
          })),
        },
        duration: Date.now() - start,
        sideEffects,
      };
    }

    // Single channel dispatch
    const results = await router.dispatch(payload);
    const result = results.find((r) => r.channel === inputs.channel);

    if (!result) {
      return {
        success: false,
        output: null,
        error: `Channel '${inputs.channel}' not available or returned no result`,
        duration: Date.now() - start,
        sideEffects,
      };
    }

    return {
      success: result.status !== "failed",
      output: {
        sent: result.status === "delivered" || result.status === "pending",
        channel: inputs.channel,
        recipient: inputs.recipient,
        status: result.status,
        sid: result.sid,
        error: result.error,
        providerResponse: result.providerResponse,
      },
      duration: Date.now() - start,
      sideEffects,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: null,
      error: msg,
      duration: Date.now() - start,
      sideEffects,
    };
  }
}
