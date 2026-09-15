/**
 * ------------------------------------------------------------------
 * GAP 5 — Smart Connect: Base POS/API Connector Interface
 * ------------------------------------------------------------------
 */

/** نتيجة الاتصال بنظام نقاط البيع */
export interface ConnectionResult {
  success: boolean;
  message: string;
  latency?: number;
  metadata?: Record<string, unknown>;
}

/** منتج من نظام نقاط البيع الخارجي */
export interface ExternalProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  category?: string;
  sku?: string;
  barcode?: string;
  stockQuantity?: number;
  isAvailable: boolean;
  imageUrl?: string;
  externalId: string;
  rawData?: Record<string, unknown>;
}

/** طلب من نظام نقاط البيع الخارجي */
export interface ExternalOrder {
  id: string;
  orderNumber: string;
  customerName?: string;
  customerPhone?: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  createdAt: string;
  updatedAt: string;
  externalId: string;
}

/** مخزون من نظام نقاط البيع الخارجي */
export interface ExternalInventory {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderPoint?: number;
  location?: string;
  lastUpdated: string;
}

/** إعدادات المزامنة */
export interface SyncOptions {
  batchSize?: number;
  since?: Date;
  categories?: string[];
  includeInactive?: boolean;
}

/** نتيجة المزامنة */
export interface SyncResult<T> {
  success: boolean;
  items: T[];
  count: number;
  errors: Array<{ id: string; error: string }>;
  hasMore: boolean;
  nextCursor?: string;
  elapsedMs: number;
}

/** واجهة موصل نقاط البيع الأساسية */
export interface POSConnector {
  /** اسم النظام */
  readonly name: string;
  /** معرف النظام */
  readonly systemType: string;
  /** نقطة النهاية للـ API */
  readonly apiEndpoint: string;
  /** هل النظام متصل حالياً */
  isConnected: boolean;

  /** الاتصال بالنظام */
  connect(apiKey: string, config?: Record<string, unknown>): Promise<ConnectionResult>;

  /** فصل الاتصال */
  disconnect(): Promise<void>;

  /** اختبار الاتصال */
  testConnection(): Promise<ConnectionResult>;

  /** مزامنة المنتجات */
  syncProducts(options?: SyncOptions): Promise<SyncResult<ExternalProduct>>;

  /** مزامنة الطلبات */
  syncOrders(options?: SyncOptions): Promise<SyncResult<ExternalOrder>>;

  /** مزامنة المخزون */
  syncInventory(options?: SyncOptions): Promise<SyncResult<ExternalInventory>>;

  /** الحصول على معلومات المنيو/الفئات */
  fetchCategories?(): Promise<Array<{ id: string; name: string; parentId?: string }>>;

  /** تحديث المخزون */
  updateStock?(productId: string, quantity: number): Promise<boolean>;
}

/** خيارات إنشاء الموصل */
export interface ConnectorConfig {
  apiKey: string;
  apiSecret?: string;
  apiEndpoint?: string;
  merchantId?: string;
  locationId?: string;
  shopDomain?: string;
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
}

/** خطأ موصل نقاط البيع */
export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** دالة مساعدة لإنشاء رأس الطلب مع المصادقة */
export function createAuthHeaders(
  authType: "bearer" | "api_key" | "square" | "basic",
  token: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extraHeaders,
  };

  switch (authType) {
    case "bearer":
      headers.Authorization = `Bearer ${token}`;
      break;
    case "api_key":
      headers["X-API-Token"] = token;
      break;
    case "square":
      headers["Square-Version"] = "2024-01-01";
      headers.Authorization = `Bearer ${token}`;
      break;
    case "basic": {
      const encoded = typeof Buffer !== "undefined"
        ? Buffer.from(token).toString("base64")
        : btoa(token);
      headers.Authorization = `Basic ${encoded}`;
      break;
    }
  }

  return headers;
}

/** دالة مساعدة للتنفيذ الآمن للطلبات */
export async function safeFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, status: res.status, error: body };
    }
    const data = await res.json() as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}
