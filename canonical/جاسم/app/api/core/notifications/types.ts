/**
 * Notification System Types - JASIM
 * Central type definitions for push/whatsapp/sms/email/in-app notifications
 */

import { z } from "zod";

// ============================================
// CHANNEL & URGENCY TYPES
// ============================================
export const NotificationChannelSchema = z.enum(["push", "whatsapp", "sms", "email", "in_app"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationUrgencySchema = z.enum(["normal", "high", "critical"]);
export type NotificationUrgency = z.infer<typeof NotificationUrgencySchema>;

// ============================================
// NOTIFICATION SCHEMA
// ============================================
export const NotificationSchema = z.object({
  userId: z.string(),
  type: z.string(),
  urgency: NotificationUrgencySchema.default("normal"),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
  actionUrl: z.string().optional(),
  bubble: z.record(z.string(), z.unknown()).optional(),
});

export type NotificationPayload = z.infer<typeof NotificationSchema>;

// ============================================
// DELIVERY RESULT
// ============================================
export const DeliveryResultSchema = z.object({
  channel: NotificationChannelSchema,
  status: z.enum(["delivered", "failed", "pending"]),
  delivered: z.number().int().min(0).optional(),
  sid: z.string().optional(),
  error: z.string().optional(),
  providerResponse: z.string().optional(),
});

export type DeliveryResult = z.infer<typeof DeliveryResultSchema>;

// ============================================
// WEBSOCKET EVENT
// ============================================
export const WebSocketEventSchema = z.object({
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime().optional(),
});

export type WebSocketEvent = z.infer<typeof WebSocketEventSchema>;

// ============================================
// USER PREFERENCES
// ============================================
export const UserNotificationPrefsSchema = z.object({
  userId: z.string(),
  inApp: z.boolean().default(true),
  push: z.boolean().default(true),
  whatsapp: z.boolean().default(true),
  sms: z.boolean().default(true),
  email: z.boolean().default(true),
  marketingEmails: z.boolean().default(true),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  language: z.string().default("ar"),
});

export type UserNotificationPrefs = z.infer<typeof UserNotificationPrefsSchema>;

// ============================================
// ORDER TYPE (for triggers)
// ============================================
export const OrderNotificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  status: z.enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]),
  estimatedDelivery: z.string().optional(),
  driverName: z.string().optional(),
  eta: z.string().optional(),
  totalAmount: z.number().optional(),
});

export type OrderNotification = z.infer<typeof OrderNotificationSchema>;

// ============================================
// ESCROW EVENT
// ============================================
export const EscrowEventSchema = z.object({
  orderId: z.string(),
  userId: z.string(),
  merchantId: z.string(),
  status: z.enum(["holding", "released", "disputed", "refunded"]),
  amount: z.number(),
  currency: z.string().default("KWD"),
});

export type EscrowEvent = z.infer<typeof EscrowEventSchema>;

// ============================================
// CHURN PREDICTION
// ============================================
export const ChurnPredictionSchema = z.object({
  userId: z.string(),
  score: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  reasons: z.array(z.string()).optional(),
});

export type ChurnPrediction = z.infer<typeof ChurnPredictionSchema>;

// ============================================
// PREDICTIVE SUGGESTION
// ============================================
export const PredictiveSuggestionSchema = z.object({
  type: z.string(),
  title: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  actionUrl: z.string().optional(),
});

export type PredictiveSuggestion = z.infer<typeof PredictiveSuggestionSchema>;

// ============================================
// DEVICE TOKEN
// ============================================
export const DeviceTokenSchema = z.object({
  userId: z.string(),
  token: z.string().min(1),
  platform: z.enum(["android", "ios", "web"]),
});

export type DeviceTokenPayload = z.infer<typeof DeviceTokenSchema>;
