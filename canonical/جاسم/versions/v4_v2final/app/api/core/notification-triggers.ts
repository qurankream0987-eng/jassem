/**
 * Notification Triggers - JASIM
 * Auto-generate notifications from system events:
 * - Order status changes
 * - KYC reminders
 * - Payment/escrow events
 * - Churn prevention alerts
 * - Predictive suggestions
 */

import { getNotificationRouter } from "./notifications/router";
import type { DeliveryResult } from "./notifications/types";
import {
  OrderNotificationSchema,
  EscrowEventSchema,
  ChurnPredictionSchema,
  PredictiveSuggestionSchema,
  type OrderNotification,
  type EscrowEvent,
  type ChurnPrediction,
  type PredictiveSuggestion,
} from "./notifications/types";

// Singleton router
function router() {
  return getNotificationRouter();
}

// ============================================
// ORDER STATUS TRIGGERS
// ============================================

/** Order status change notifications with Arabic messages */
export async function onOrderStatusChange(order: OrderNotification): Promise<void> {
  OrderNotificationSchema.parse(order);

  const messages: Record<string, string> = {
    pending: `طلبك #${order.id} قيد الانتظار، سيتم تأكيده قريباً`,
    confirmed: `طلبك #${order.id} مؤكد! ⏰ ${order.estimatedDelivery || "سيتم التوصيل قريباً"}`,
    processing: `طلبك #${order.id} قيد التحضير الآن 👨‍🍳`,
    shipped: `طلبك #${order.id} في الطريق! 🚚 ${order.driverName || "السائق"} يوصلك خلال ${order.eta || "وقت قصير"}`,
    delivered: `تم تسليم طلبك #${order.id}! ✅ كيف كانت تجربتك؟`,
    cancelled: `تم إلغاء طلبك #${order.id}. تواصل معنا إذا كنت بحاجة للمساعدة.`,
    returned: `تم استلام طلب الإرجاع #${order.id}. سنقوم بمراجعته.`,
  };

  const urgencyMap: Record<string, "normal" | "high" | "critical"> = {
    pending: "normal",
    confirmed: "high",
    processing: "normal",
    shipped: "high",
    delivered: "normal",
    cancelled: "high",
    returned: "normal",
  };

  await router().dispatch({
    userId: order.userId,
    type: "order_update",
    urgency: urgencyMap[order.status] || "normal",
    title: "تحديث الطلب",
    body: messages[order.status] || `تحديث على طلبك #${order.id}: ${order.status}`,
    data: {
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
    },
  });
}

// ============================================
// KYC / COMPLIANCE TRIGGERS
// ============================================

/** KYC expiry reminder with escalating urgency */
export async function onKYCExpiry(userId: string, daysLeft: number): Promise<void> {
  const urgency = daysLeft <= 3 ? "critical" : daysLeft <= 7 ? "high" : "normal";

  const messages: Record<string, string> = {
    critical: `⚠️ سجل تجاري CR ينتهي خلال ${daysLeft} أيام فقط! جدد الآن لتجنب تعليق حسابك.`,
    high: `تذكير: سجل تجاري CR ينتهي خلال ${daysLeft} أيام. الرجاء التجديد.`,
    normal: `تذكير: ينتهي سجل تجاري CR خلال ${daysLeft} يوم. جدد مبكراً لتجنب المشاكل.`,
  };

  await router().dispatch({
    userId,
    type: "kyc_reminder",
    urgency,
    title: "تذكير: تجديد السجل التجاري",
    body: messages[urgency],
    data: { daysLeft, urgency },
    actionUrl: `/kyc/renew`,
  });
}

/** KYC fully expired - account suspension warning */
export async function onKYCExpired(userId: string): Promise<void> {
  await router().dispatch({
    userId,
    type: "kyc_expired",
    urgency: "critical",
    title: "تنبيه: السجل التجاري منتهي",
    body: "سجل تجاري CR منتهي! حسابك معرض للتعليق. جدد فوراً لاستعادة الخدمة الكاملة.",
    data: { suspended: true },
    actionUrl: `/kyc/renew`,
  });
}

/** KYC approved notification */
export async function onKYCApproved(userId: string): Promise<void> {
  await router().dispatch({
    userId,
    type: "kyc_approved",
    urgency: "normal",
    title: "تم قبول التحقق ✅",
    body: "تم التحقق من هويتك بنجاح! يمكنك الآن استخدام جميع خدمات جاسيم.",
    data: { verified: true },
  });
}

// ============================================
// PAYMENT / ESCROW TRIGGERS
// ============================================

/** Payment received confirmation */
export async function onPaymentReceived(
  userId: string,
  orderId: string,
  amount: number,
  currency: string
): Promise<void> {
  await router().dispatch({
    userId,
    type: "payment_received",
    urgency: "high",
    title: "تم استلام الدفع ✅",
    body: `تم استلام دفع بقيمة ${amount.toFixed(3)} ${currency} للطلب #${orderId}.`,
    data: { orderId, amount, currency, status: "paid" },
  });
}

/** Payment failed notification */
export async function onPaymentFailed(
  userId: string,
  orderId: string,
  reason: string
): Promise<void> {
  await router().dispatch({
    userId,
    type: "payment_failed",
    urgency: "critical",
    title: "فشل الدفع ❌",
    body: `فشلت عملية الدفع للطلب #${orderId}. السبب: ${reason}. يرجى المحاولة مرة أخرى.`,
    data: { orderId, reason },
    actionUrl: `/orders/${orderId}/payment`,
  });
}

/** Escrow status change notification */
export async function onEscrowEvent(event: EscrowEvent): Promise<void> {
  EscrowEventSchema.parse(event);

  const messages: Record<string, string> = {
    holding: `المبلغ ${event.amount.toFixed(3)} ${event.currency} قيد الاحتجاز لحماية الطلب #${event.orderId}.`,
    released: `تم إطلاق المبلغ ${event.amount.toFixed(3)} ${event.currency} للطلب #${event.orderId}. ✅`,
    disputed: `تم فتح نزاع على المبلغ ${event.amount.toFixed(3)} ${event.currency} للطلب #${event.orderId}. ⚠️`,
    refunded: `تم استرداد المبلغ ${event.amount.toFixed(3)} ${event.currency} للطلب #${event.orderId}.`,
  };

  await router().dispatch({
    userId: event.userId,
    type: "escrow_event",
    urgency: event.status === "disputed" ? "critical" : "high",
    title: "تحديث الضمان المالي",
    body: messages[event.status] || `تحديث على الضمان المالي للطلب #${event.orderId}: ${event.status}`,
    data: { orderId: event.orderId, amount: event.amount, currency: event.currency, status: event.status },
  });
}

// ============================================
// CHURN PREVENTION TRIGGERS
// ============================================

/** Churn risk alert - triggered by churn prediction engine */
export async function onChurnRisk(prediction: ChurnPrediction): Promise<void> {
  ChurnPredictionSchema.parse(prediction);

  const messages: Record<string, string> = {
    low: "نفتقدك! هل تحتاج مساعدة في شيء؟ فريق جاسيم جاهز لمساعدتك.",
    medium: "عرض خاص لك! 🎁 عودة إلى جاسيم واحصل على خصم 20% على طلبك القادم.",
    high: "نريدك معنا! ⚡ عرض حصري: خصم 30% + توصيل مجاني على طلبك القادم. لا تفوت الفرصة!",
  };

  const titles: Record<string, string> = {
    low: "نفتقدك في جاسيم",
    medium: "عرض عودة خاص 🎁",
    high: "عرض حصري مهم ⚡",
  };

  await router().dispatch({
    userId: prediction.userId,
    type: "churn_alert",
    urgency: prediction.riskLevel === "high" ? "high" : "normal",
    title: titles[prediction.riskLevel] || "نفتقدك!",
    body: messages[prediction.riskLevel] || "نريدك معنا في جاسيم! عودة الآن.",
    data: {
      riskLevel: prediction.riskLevel,
      score: prediction.score,
      reasons: prediction.reasons || [],
    },
    actionUrl: `/offers/win-back`,
  });
}

// ============================================
// PREDICTIVE SUGGESTION TRIGGERS
// ============================================

/** Predictive suggestion notification */
export async function onPredictiveSuggestion(
  userId: string,
  suggestion: PredictiveSuggestion
): Promise<void> {
  PredictiveSuggestionSchema.parse(suggestion);

  await router().dispatch({
    userId,
    type: "predictive_suggestion",
    urgency: "normal",
    title: suggestion.title,
    body: suggestion.description,
    data: {
      type: suggestion.type,
      confidence: suggestion.confidence,
    },
    actionUrl: suggestion.actionUrl,
  });
}

/** Daily digest of predictive suggestions */
export async function onDailyDigest(userId: string, suggestions: PredictiveSuggestion[]): Promise<void> {
  if (suggestions.length === 0) return;

  const items = suggestions
    .slice(0, 3)
    .map((s) => `• ${s.title}`)
    .join("\n");

  await router().dispatch({
    userId,
    type: "daily_digest",
    urgency: "normal",
    title: "ملخص يومي - توصيات جاسيم",
    body: `إليك أهم التوصيات لهذا اليوم:\n${items}\n\nاضغط لعرض التفاصيل.`,
    data: { count: suggestions.length },
    actionUrl: `/digest`,
  });
}

// ============================================
// DRIVER / FLEET TRIGGERS
// ============================================

/** Driver assigned to order */
export async function onDriverAssigned(
  userId: string,
  orderId: string,
  driverName: string,
  eta: string
): Promise<void> {
  await router().dispatch({
    userId,
    type: "driver_assigned",
    urgency: "high",
    title: "تم تعيين سائق 🚚",
    body: `السائق ${driverName} في طريقه إليك! التوصيل المتوقع خلال ${eta}.`,
    data: { orderId, driverName, eta },
  });
}

/** SOS alert from driver */
export async function onDriverSOS(
  merchantId: string,
  driverName: string,
  alertType: string,
  location?: { lat: number; lng: number }
): Promise<void> {
  const typeNames: Record<string, string> = {
    accident: "حادث",
    theft: "سرقة",
    harassment: "تحرش",
    mechanical: "عطل ميكانيكي",
    medical: "حالة طبية",
    other: "أخرى",
  };

  await router().dispatch({
    userId: merchantId,
    type: "sos_alert",
    urgency: "critical",
    title: "🚨 تنبيه طوارئ من السائق",
    body: `السائق ${driverName} أرسل تنبيه ${typeNames[alertType] || alertType}! يرجى التواصل فوراً.`,
    data: { driverName, alertType, location },
    actionUrl: location ? `https://maps.google.com/?q=${location.lat},${location.lng}` : undefined,
  });
}

// ============================================
// WELCOME / ONBOARDING TRIGGERS
// ============================================

/** Send welcome notification to new users */
export async function onUserWelcome(userId: string, name?: string): Promise<void> {
  const greeting = name ? `أهلاً ${name}!` : "أهلاً بك في جاسيم!";

  await router().dispatch({
    userId,
    type: "welcome",
    urgency: "normal",
    title: "أهلاً بك في جاسيم! 🎉",
    body: `${greeting} نحن سعداء بانضمامك. ابدأ رحلتك مع جاسيم واكتشف كيف يمكننا مساعدة عملك في النمو.`,
    data: { onboarding: true },
    actionUrl: `/getting-started`,
  });
}

/** Marketing broadcast (bulk) */
export async function sendMarketingBroadcast(
  userIds: string[],
  title: string,
  body: string,
  actionUrl?: string
): Promise<Array<{ userId: string; results: DeliveryResult[] }>> {
  const out: Array<{ userId: string; results: DeliveryResult[] }> = [];

  for (const userId of userIds) {
    const result = await router().dispatch({
      userId,
      type: "marketing",
      urgency: "normal",
      title,
      body,
      actionUrl,
    });
    out.push({ userId, results: result });
  }

  return out;
}
