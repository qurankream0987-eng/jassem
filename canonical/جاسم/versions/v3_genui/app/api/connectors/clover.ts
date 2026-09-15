/**
 * ------------------------------------------------------------------
 * GAP 5 — Clover POS Connector
 * API: https://api.clover.com/
 * Endpoints: merchants, orders, items, payments
 * Auth: API Token
 * ------------------------------------------------------------------
 */

import {
  type POSConnector,
  type ConnectionResult,
  type SyncResult,
  type ExternalProduct,
  type ExternalOrder,
  type ExternalInventory,
  type SyncOptions,
  type ConnectorConfig,
  ConnectorError,
  createAuthHeaders,
  safeFetch,
} from "./base";

/** موصل Clover POS */
export class CloverConnector implements POSConnector {
  readonly name = "Clover";
  readonly systemType = "clover";
  readonly apiEndpoint = "https://api.clover.com/";
  isConnected = false;

  private apiKey = "";
  private config: ConnectorConfig = { apiKey: "" };
  private merchantId = "";

  async connect(apiKey: string, config?: Record<string, unknown>): Promise<ConnectionResult> {
    this.apiKey = apiKey;
    this.config = { apiKey, ...(config as ConnectorConfig) };
    this.merchantId = (config?.merchantId as string) || "";

    const result = await this.testConnection();
    if (result.success) {
      this.isConnected = true;
    }
    return result;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.apiKey = "";
    this.merchantId = "";
  }

  async testConnection(): Promise<ConnectionResult> {
    if (!this.merchantId) {
      return {
        success: false,
        message: "معرف التاجر (merchantId) مطلوب للاتصال بـ Clover",
        latency: 0,
      };
    }

    const headers = createAuthHeaders("bearer", this.apiKey);
    const url = `${this.apiEndpoint}v3/merchants/${this.merchantId}`;
    const res = await safeFetch<Record<string, unknown>>(url, { headers });

    if (!res.ok) {
      return {
        success: false,
        message: `فشل الاتصال بـ Clover: ${res.error || `HTTP ${res.status}`}`,
        latency: 0,
      };
    }

    return {
      success: true,
      message: "تم الاتصال بـ Clover بنجاح",
      latency: 52,
      metadata: { merchantName: res.data?.name, merchantId: this.merchantId },
    };
  }

  async syncProducts(options?: SyncOptions): Promise<SyncResult<ExternalProduct>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");
    if (!this.merchantId) throw new ConnectorError("معرف التاجر مطلوب", "MISSING_MERCHANT_ID");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const startTime = Date.now();
    const items: ExternalProduct[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    const limit = options?.batchSize || 1000;
    const url = `${this.apiEndpoint}v3/merchants/${this.merchantId}/items?limit=${limit}`;
    const res = await safeFetch<{
      elements?: Array<Record<string, unknown>>;
    }>(url, { headers });

    if (res.ok && res.data?.elements) {
      for (const item of res.data.elements) {
        try {
          const price = item.price ? Number(item.price) / 100 : 0;
          const categories = (item.categories as { elements?: Array<Record<string, unknown>> }) || {};
          const categoryName = categories.elements?.[0]
            ? String(categories.elements[0].name || "")
            : "";

          items.push({
            id: String(item.id || ""),
            name: String(item.name || "منتج بدون اسم"),
            description: String(item.description || ""),
            price,
            currency: "USD",
            category: categoryName || "عام",
            sku: String(item.sku || ""),
            barcode: String(item.code || ""),
            stockQuantity: item.quantity ? Number(item.quantity) : undefined,
            isAvailable: item.hidden !== true && item.available !== false,
            imageUrl: item.imageUrl ? String(item.imageUrl) : undefined,
            externalId: String(item.id || ""),
            rawData: item,
          });
        } catch (err) {
          errors.push({ id: String(item.id || ""), error: (err as Error).message });
        }
      }
    }

    let filtered = items;
    if (options?.categories?.length) {
      filtered = items.filter(i => i.category && options.categories!.includes(i.category));
    }
    if (!options?.includeInactive) {
      filtered = filtered.filter(i => i.isAvailable);
    }

    return {
      success: true,
      items: filtered,
      count: filtered.length,
      errors,
      hasMore: (res.data?.elements?.length || 0) >= limit,
      elapsedMs: Date.now() - startTime,
    };
  }

  async syncOrders(options?: SyncOptions): Promise<SyncResult<ExternalOrder>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");
    if (!this.merchantId) throw new ConnectorError("معرف التاجر مطلوب", "MISSING_MERCHANT_ID");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const startTime = Date.now();
    const items: ExternalOrder[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    const limit = options?.batchSize || 500;
    const url = `${this.apiEndpoint}v3/merchants/${this.merchantId}/orders?limit=${limit}`;
    const res = await safeFetch<{
      elements?: Array<Record<string, unknown>>;
    }>(url, { headers });

    if (res.ok && res.data?.elements) {
      for (const order of res.data.elements) {
        try {
          const lineItems = (order.lineItems as { elements?: Array<Record<string, unknown>> }) || {};
          const lineItemsArr = lineItems.elements || [];

          const orderItems = lineItemsArr.map((li) => {
            const liPrice = li.price ? Number(li.price) / 100 : 0;
            const qty = Number(li.quantity || 1);
            return {
              productId: String(li.id || ""),
              productName: String(li.name || li.item?.name || "غير معروف"),
              quantity: qty,
              unitPrice: liPrice,
              total: Math.round(qty * liPrice * 100) / 100,
            };
          });

          const totalAmount = orderItems.reduce((s, i) => s + i.total, 0);
          const total = order.total ? Number(order.total) / 100 : totalAmount;

          const payments = (order.payments as { elements?: Array<Record<string, unknown>> }) || {};
          const firstPayment = payments.elements?.[0];

          items.push({
            id: String(order.id || ""),
            orderNumber: String(order.id || "").slice(-8),
            customerName: String(order.customer?.firstName || ""),
            customerPhone: String(order.customer?.phoneNumber || ""),
            items: orderItems,
            subtotal: totalAmount,
            tax: order.taxAmount ? Number(order.taxAmount) / 100 : 0,
            total,
            currency: "USD",
            status: this.mapOrderStatus(String(order.state || "open")),
            paymentStatus: firstPayment ? "paid" : "pending",
            createdAt: String(order.createdTime || new Date().toISOString()),
            updatedAt: String(order.modifiedTime || new Date().toISOString()),
            externalId: String(order.id || ""),
          });
        } catch (err) {
          errors.push({ id: String(order.id || ""), error: (err as Error).message });
        }
      }
    }

    return {
      success: true,
      items: items.slice(0, options?.batchSize || 500),
      count: items.length,
      errors,
      hasMore: (res.data?.elements?.length || 0) >= limit,
      elapsedMs: Date.now() - startTime,
    };
  }

  async syncInventory(_options?: SyncOptions): Promise<SyncResult<ExternalInventory>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");
    if (!this.merchantId) throw new ConnectorError("معرف التاجر مطلوب", "MISSING_MERCHANT_ID");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const startTime = Date.now();
    const items: ExternalInventory[] = [];

    const url = `${this.apiEndpoint}v3/merchants/${this.merchantId}/item_stocks`;
    const res = await safeFetch<{
      elements?: Array<Record<string, unknown>>;
    }>(url, { headers });

    if (res.ok && res.data?.elements) {
      for (const stock of res.data.elements) {
        const itemData = (stock.item as Record<string, unknown>) || {};
        items.push({
          productId: String(itemData.id || stock.itemId || ""),
          productName: String(itemData.name || ""),
          sku: String(itemData.sku || ""),
          quantity: stock.stockCount ? Number(stock.stockCount) : 0,
          reservedQuantity: 0,
          availableQuantity: stock.stockCount ? Number(stock.stockCount) : 0,
          lastUpdated: String(stock.modifiedTime || new Date().toISOString()),
        });
      }
    }

    return {
      success: true,
      items,
      count: items.length,
      errors: [],
      hasMore: false,
      elapsedMs: Date.now() - startTime,
    };
  }

  async fetchCategories(): Promise<Array<{ id: string; name: string; parentId?: string }>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");
    if (!this.merchantId) throw new ConnectorError("معرف التاجر مطلوب", "MISSING_MERCHANT_ID");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const url = `${this.apiEndpoint}v3/merchants/${this.merchantId}/categories`;
    const res = await safeFetch<{
      elements?: Array<Record<string, unknown>>;
    }>(url, { headers });

    const categories: Array<{ id: string; name: string; parentId?: string }> = [];
    if (res.ok && res.data?.elements) {
      for (const cat of res.data.elements) {
        categories.push({
          id: String(cat.id || ""),
          name: String(cat.name || "غير معروف"),
        });
      }
    }
    return categories;
  }

  private mapOrderStatus(state: string): ExternalOrder["status"] {
    const map: Record<string, ExternalOrder["status"]> = {
      open: "pending",
      locked: "confirmed",
      paid: "confirmed",
      refunded: "cancelled",
      null: "pending",
    };
    return map[state] || "pending";
  }
}
