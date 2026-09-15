/**
 * SMS Service - JASIM
 * Twilio integration for critical notifications (order alerts, KYC, SOS)
 */

import {
  NotificationSchema,
  type NotificationPayload,
  type DeliveryResult,
} from "./types";

export class SMSService {
  private twilioSid: string;
  private twilioAuthToken: string;
  private fromNumber: string;
  private client: unknown | null = null;

  constructor() {
    this.twilioSid = process.env.TWILIO_SID || "";
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || "";
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || "";
  }

  /** Check if SMS service is configured */
  isConfigured(): boolean {
    return !!(this.twilioSid && this.twilioAuthToken && this.fromNumber);
  }

  /** Get Twilio client (lazy init) */
  private async getClient(): Promise<unknown | null> {
    if (this.client) return this.client;
    if (!this.isConfigured()) return null;

    try {
      const twilio = await import("twilio");
      this.client = twilio.default(this.twilioSid, this.twilioAuthToken);
      return this.client;
    } catch {
      return null;
    }
  }

  /** Send SMS notification */
  async send(notification: NotificationPayload): Promise<DeliveryResult> {
    // Validate input
    NotificationSchema.parse(notification);

    if (!this.isConfigured()) {
      return {
        channel: "sms",
        status: "failed",
        error: "SMS not configured - set TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER",
      };
    }

    try {
      const phone = await this.getUserPhone(notification.userId);
      if (!phone) {
        return {
          channel: "sms",
          status: "failed",
          error: "User has no phone number",
        };
      }

      const client = await this.getClient();
      if (!client) {
        return {
          channel: "sms",
          status: "failed",
          error: "Failed to initialize Twilio client",
        };
      }

      // Build Arabic-aware message
      const messageBody = `${notification.title}\n${notification.body}`;

      const twilioClient = client as {
        messages: {
          create: (opts: Record<string, string>) => Promise<{ sid: string; status: string }>;
        };
      };

      const message = await twilioClient.messages.create({
        body: messageBody,
        from: this.fromNumber,
        to: this.formatPhone(phone),
      });

      return {
        channel: "sms",
        status: "delivered",
        sid: message.sid,
        providerResponse: `status=${message.status}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "sms",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Send OTP code via SMS */
  async sendOTP(phone: string, code: string): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        channel: "sms",
        status: "failed",
        error: "SMS not configured",
      };
    }

    try {
      const client = await this.getClient();
      if (!client) {
        return {
          channel: "sms",
          status: "failed",
          error: "Failed to initialize Twilio client",
        };
      }

      const twilioClient = client as {
        messages: {
          create: (opts: Record<string, string>) => Promise<{ sid: string; status: string }>;
        };
      };

      const message = await twilioClient.messages.create({
        body: `رمز التحقق الخاص بك في جاسيم: ${code}\nJASIM Verification Code: ${code}`,
        from: this.fromNumber,
        to: this.formatPhone(phone),
      });

      return {
        channel: "sms",
        status: "delivered",
        sid: message.sid,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "sms",
        status: "failed",
        error: msg,
      };
    }
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

  /** Format phone number for Twilio */
  private formatPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("+")) return cleaned;
    if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
    // Default to Kuwait country code
    if (cleaned.startsWith("965")) return `+${cleaned}`;
    return `+965${cleaned}`;
  }
}

// Singleton
let _smsService: SMSService | null = null;
export function getSMSService(): SMSService {
  if (!_smsService) _smsService = new SMSService();
  return _smsService;
}
