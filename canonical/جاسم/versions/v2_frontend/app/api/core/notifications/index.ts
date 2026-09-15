/**
 * Notifications System - Barrel Exports
 * Central hub for all notification channels
 */

// ============================================
// TYPES
// ============================================
export {
  NotificationSchema,
  NotificationChannelSchema,
  NotificationUrgencySchema,
  DeliveryResultSchema,
  WebSocketEventSchema,
  UserNotificationPrefsSchema,
  DeviceTokenSchema,
  OrderNotificationSchema,
  EscrowEventSchema,
  ChurnPredictionSchema,
  PredictiveSuggestionSchema,
} from "./types";

export type {
  NotificationPayload,
  NotificationChannel,
  NotificationUrgency,
  DeliveryResult,
  WebSocketEvent,
  UserNotificationPrefs,
  DeviceTokenPayload,
  OrderNotification,
  EscrowEvent,
  ChurnPrediction,
  PredictiveSuggestion,
} from "./types";

// ============================================
// SERVICES
// ============================================
export { PushService, getPushService } from "./push";
export { WhatsAppService, getWhatsAppService } from "./whatsapp";
export { SMSService, getSMSService } from "./sms";
export { EmailService, getEmailService } from "./email";
export { InAppService, getInAppService } from "./in-app";
export { NotificationRouter, getNotificationRouter } from "./router";

// ============================================
// TRIGGERS
// ============================================
export {
  // Order triggers
  onOrderStatusChange,
  // KYC triggers
  onKYCExpiry,
  onKYCExpired,
  onKYCApproved,
  // Payment triggers
  onPaymentReceived,
  onPaymentFailed,
  onEscrowEvent,
  // Churn prevention
  onChurnRisk,
  // Predictive
  onPredictiveSuggestion,
  onDailyDigest,
  // Driver / Fleet
  onDriverAssigned,
  onDriverSOS,
  // Onboarding
  onUserWelcome,
  // Marketing
  sendMarketingBroadcast,
} from "../notification-triggers";
