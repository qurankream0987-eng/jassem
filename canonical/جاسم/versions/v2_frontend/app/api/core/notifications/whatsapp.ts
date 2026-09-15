/**
 * WhatsApp Business API Service - JASIM
 * Integration with Meta Graph API for WhatsApp messaging
 */

import {
  NotificationSchema,
  type NotificationPayload,
  type DeliveryResult,
} from "./types";

const API_BASE_URL = "https://graph.facebook.com/v18.0";

/** Template mapping for notification types */
const TEMPLATE_MAP: Record<string, string> = {
  order_confirmed: "jasim_order_confirmed",
  order_update: "jasim_order_update",
  delivery_update: "jasim_delivery_update",
  payment_received: "jasim_payment_received",
  payment_failed: "jasim_payment_failed",
  kyc_reminder: "jasim_kyc_reminder",
  kyc_expired: "jasim_kyc_expired",
  churn_alert: "jasim_win_back",
  welcome: "jasim_welcome",
  escrow_released: "jasim_escrow_released",
  escrow_disputed: "jasim_escrow_disputed",
  marketing: "jasim_general",
};

export class WhatsAppService {
  private phoneNumberId: string;
  private accessToken: string;
  private apiUrl: string;

  constructor() {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
    this.apiUrl = `${API_BASE_URL}/${this.phoneNumberId}/messages`;
  }

  /** Check if WhatsApp service is configured */
  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken);
  }

  /** Send WhatsApp notification using templates */
  async send(notification: NotificationPayload): Promise<DeliveryResult> {
    // Validate input
    NotificationSchema.parse(notification);

    if (!this.isConfigured()) {
      return {
        channel: "whatsapp",
        status: "failed",
        error:
          "WhatsApp not configured - set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN",
      };
    }

    try {
      const phone = await this.getUserPhone(notification.userId);
      if (!phone) {
        return {
          channel: "whatsapp",
          status: "failed",
          error: "User has no phone number",
        };
      }

      const templateName = this.selectTemplate(notification);
      const components = this.buildComponents(notification);

      const messageBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: this.formatPhone(phone),
        type: "template",
        template: {
          name: templateName,
          language: { code: "ar" },
          ...(components.length > 0 ? { components } : {}),
        },
      };

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          channel: "whatsapp",
          status: "failed",
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        channel: "whatsapp",
        status: "delivered",
        providerResponse: JSON.stringify(result),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "whatsapp",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Send a free-text WhatsApp message (for supported use cases) */
  async sendTextMessage(toPhone: string, text: string): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        channel: "whatsapp",
        status: "failed",
        error: "WhatsApp not configured",
      };
    }

    try {
      const messageBody = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: this.formatPhone(toPhone),
        type: "text",
        text: { body: text },
      };

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          channel: "whatsapp",
          status: "failed",
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const result = await response.json();
      return {
        channel: "whatsapp",
        status: "delivered",
        providerResponse: JSON.stringify(result),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "whatsapp",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Select appropriate WhatsApp template for notification type */
  private selectTemplate(notification: NotificationPayload): string {
    return TEMPLATE_MAP[notification.type] || "jasim_general";
  }

  /** Build template components for dynamic values */
  private buildComponents(notification: NotificationPayload): Array<Record<string, unknown>> {
    const components: Array<Record<string, unknown>> = [];

    // Body parameters (e.g., order number, status)
    if (notification.body) {
      components.push({
        type: "body",
        parameters: [
          { type: "text", text: notification.title },
          { type: "text", text: notification.body },
        ],
      });
    }

    // Add button with action URL if present
    if (notification.actionUrl) {
      components.push({
        type: "button",
        sub_type: "url",
        index: 0,
        parameters: [{ type: "text", text: notification.actionUrl }],
      });
    }

    return components;
  }

  /** Get user phone from database */
  private async getUserPhone(userId: string): Promise<string | null> {
    try {
      const { db } = await import("@db/queries/connection");
      const { users } = await import("@db/schema");
      const { eq } = await import("drizzle-orm");

      const uid = Number(userId);
      if (Number.isNaN(uid)) return null;

      const rows = await db
        .select({ phone: users.phone })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1);

      return rows[0]?.phone || null;
    } catch {
      return null;
    }
  }

  /** Format phone number for WhatsApp API */
  private formatPhone(phone: string): string {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, "");
    // Ensure it has country code
    if (!cleaned.startsWith("+")) {
      cleaned = cleaned.startsWith("965") ? cleaned : `965${cleaned}`;
    }
    return cleaned;
  }
}

// Singleton
let _whatsappService: WhatsAppService | null = null;
export function getWhatsAppService(): WhatsAppService {
  if (!_whatsappService) _whatsappService = new WhatsAppService();
  return _whatsappService;
}
