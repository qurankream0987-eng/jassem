/**
 * Email Service - JASIM
 * SendGrid integration for marketing, transactional, and system emails
 */

import {
  NotificationSchema,
  type NotificationPayload,
  type DeliveryResult,
} from "./types";

export class EmailService {
  private apiKey: string;
  private sgMail: unknown | null = null;

  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY || "";
  }

  /** Check if email service is configured */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Get SendGrid client (lazy init) */
  private async getSendGrid(): Promise<unknown | null> {
    if (this.sgMail) return this.sgMail;
    if (!this.apiKey) return null;

    try {
      const sg = await import("@sendgrid/mail");
      sg.default.setApiKey(this.apiKey);
      this.sgMail = sg.default;
      return sg.default;
    } catch {
      return null;
    }
  }

  /** Send email notification */
  async send(notification: NotificationPayload): Promise<DeliveryResult> {
    // Validate input
    NotificationSchema.parse(notification);

    if (!this.isConfigured()) {
      return {
        channel: "email",
        status: "failed",
        error: "Email not configured - set SENDGRID_API_KEY",
      };
    }

    try {
      const user = await this.getUser(notification.userId);
      if (!user?.email) {
        return {
          channel: "email",
          status: "failed",
          error: "User has no email address",
        };
      }

      const sgMail = await this.getSendGrid();
      if (!sgMail) {
        return {
          channel: "email",
          status: "failed",
          error: "Failed to initialize SendGrid",
        };
      }

      const msg = {
        to: user.email!,
        from: process.env.SENDGRID_FROM_EMAIL || "jasim@jasim.ai",
        subject: notification.title,
        text: notification.body,
        html: this.buildHtml(notification, user.name || undefined),
      };

      const sg = sgMail as { send: (msg: Record<string, unknown>) => Promise<unknown> };
      await sg.send(msg);

      return {
        channel: "email",
        status: "delivered",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "email",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Send a transactional email with a specific template */
  async sendTransactional(
    to: string,
    subject: string,
    textContent: string,
    htmlContent?: string
  ): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        channel: "email",
        status: "failed",
        error: "Email not configured",
      };
    }

    try {
      const sgMail = await this.getSendGrid();
      if (!sgMail) {
        return {
          channel: "email",
          status: "failed",
          error: "Failed to initialize SendGrid",
        };
      }

      const msg = {
        to,
        from: process.env.SENDGRID_FROM_EMAIL || "jasim@jasim.ai",
        subject,
        text: textContent,
        html: htmlContent || this.wrapInTemplate(textContent, subject),
      };

      const sg = sgMail as { send: (msg: Record<string, unknown>) => Promise<unknown> };
      await sg.send(msg);

      return {
        channel: "email",
        status: "delivered",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        channel: "email",
        status: "failed",
        error: msg,
      };
    }
  }

  /** Build RTL Arabic HTML email template */
  private buildHtml(notification: NotificationPayload, userName?: string): string {
    const greeting = userName ? `<p>مرحباً ${userName}،</p>` : "<p>مرحباً،</p>";
    const actionButton = notification.actionUrl
      ? `<div style="text-align: center; margin: 24px 0;">
          <a href="${notification.actionUrl}" 
             style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); 
                    color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; 
                    font-weight: 600; font-size: 16px;">
            عرض التفاصيل
          </a>
        </div>`
      : "";

    return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${notification.title}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: right; background: #f8f9fa; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; }
    .body { padding: 32px 24px; color: #374151; font-size: 16px; line-height: 1.7; }
    .body h2 { color: #111827; font-size: 20px; margin-bottom: 16px; }
    .body p { margin: 8px 0; }
    .footer { background: #f3f4f6; padding: 20px 24px; text-align: center; color: #6b7280; font-size: 13px; }
    .footer a { color: #6366f1; text-decoration: none; }
    .divider { height: 1px; background: #e5e7eb; margin: 20px 0; }
    .brand { font-weight: 700; color: #6366f1; font-size: 18px; }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f8f9fa; padding: 20px 0;">
    <tr>
      <td align="center">
        <div class="container">
          <div class="header">
            <h1>JASIM</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">جاسيم - الذكاء الاصطناعي للأعمال</p>
          </div>
          <div class="body">
            ${greeting}
            <h2>${notification.title}</h2>
            <p>${notification.body}</p>
            ${actionButton}
          </div>
          <div class="divider"></div>
          <div class="footer">
            <p class="brand">JASIM جاسيم</p>
            <p>هذا البريد الإلكتروني مرسل من نظام جاسيم الإشعارات</p>
            <p>إذا لم تكن تتوقع هذا الإشعار، يمكنك تجاهله.</p>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /** Wrap plain text in email template */
  private wrapInTemplate(content: string, subject: string): string {
    return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; direction: rtl; text-align: right; background: #f8f9fa; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px 24px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; }
    .body { padding: 32px 24px; color: #374151; font-size: 16px; line-height: 1.7; }
    .footer { background: #f3f4f6; padding: 20px 24px; text-align: center; color: #6b7280; font-size: 13px; }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f8f9fa; padding: 20px 0;">
    <tr><td align="center">
      <div class="container">
        <div class="header"><h1>JASIM</h1></div>
        <div class="body"><p>${content.replace(/\n/g, "</p><p>")}</p></div>
        <div class="footer"><p class="brand">JASIM جاسيم</p></div>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /** Get user from database */
  private async getUser(userId: string): Promise<{ email: string | null; name: string | null } | null> {
    try {
      const { db } = await import("@db/queries/connection");
      const { users } = await import("@db/schema");
      const { eq } = await import("drizzle-orm");

      const uid = Number(userId);
      if (Number.isNaN(uid)) return null;

      const rows = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1);

      return rows[0] || null;
    } catch {
      return null;
    }
  }
}

// Singleton
let _emailService: EmailService | null = null;
export function getEmailService(): EmailService {
  if (!_emailService) _emailService = new EmailService();
  return _emailService;
}
