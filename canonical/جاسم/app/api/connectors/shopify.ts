/**
 * ------------------------------------------------------------------
 * GAP 5 — Shopify Connector
 * API: https://{shop}.myshopify.com/admin/api/2024-01/
 * Endpoints: products, orders, customers, inventory
 * Auth: Access Token
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

/** موصل Shopify */
export class ShopifyConnector implements POSConnector {
  readonly name = "Shopify";
  readonly systemType = "shopify";
  readonly apiEndpoint = "https://{shop}.myshopify.com/admin/api/2024-01/";
  isConnected = false;

  private apiKey = "";
  private config: ConnectorConfig = { apiKey: "" };
  private shopDomain = "";

  get resolvedApiEndpoint(): string {
    return this.apiEndpoint.replace("{shop}", this.shopDomain);
  }

  async connect(apiKey: string, config?: Record<string, unknown>): Promise<ConnectionResult> {
    this.apiKey = apiKey;
    this.config = { apiKey, ...(config as ConnectorConfig) };
    this.shopDomain = (config?.shopDomain as string) || "";

    if (!this.shopDomain) {
      return {
        success: false,
        message: "نطاق المتجر (shopDomain) مطلوب للاتصال بـ Shopify",
        latency: 0,
      };
    }

    const result = await this.testConnection();
    if (result.success) {
      this.isConnected = true;
    }
    return result;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.apiKey = "";
    this.shopDomain = "";
  }

  async testConnection(): Promise<ConnectionResult> {
    const headers = createAuthHeaders("api_key", this.apiKey);
    const url = `${this.resolvedApiEndpoint}shop.json`;
    const res = await safeFetch<{ shop?: Record<string, unknown> }>(url, { headers });

    if (!res.ok) {
      return {
        success: false,
        message: `فشل الاتصال بـ Shopify: ${res.error || `HTTP ${res.status}`}`,
        latency: 0,
      };
    }

    return {
      success: true,
      message: `تم الاتصال بـ Shopify: ${res.data?.shop?.name || this.shopDomain}`,
      latency: 62,
      metadata: { shopName: res.data?.shop?.name, domain: this.shopDomain },
    };
  }

  async syncProducts(options?: SyncOptions): Promise<SyncResult<ExternalProduct>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");

    const headers = createAuthHeaders("api_key", this.apiKey);
    const startTime = Date.now();
    const items: ExternalProduct[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    const limit = Math.min(options?.batchSize || 250, 250);
    let url = `${this.resolvedApiEndpoint}products.json?limit=${limit}`;

    if (options?.since) {
      const since = new Date(options.since).toISOString();
      url += `&created_at_min=${encodeURIComponent(since)}`;
    }

    const res = await safeFetch<{
      products?: Array<Record<string, unknown>>;
    }>(url, { headers });

    if (res.ok && res.data?.products) {
      for (const product of res.data.products) {
        try {
          const variants = (product.variants as Array<Record<string, unknown>>) || [];
          const images = (product.images as Array<Record<string, unknown>>) || [];
          const imageUrl = images.length > 0 ? String(images[0].src || "") : undefined;
          const tags = String(product.tags || "").split(",").filter(Boolean);

          for (const variant of variants) {
            const price = Number(variant.price || 0);
            const grams = Number(variant.grams || 0);

            items.push({
              id: String(variant.id || ""),
              name: `${String(product.title || "منتج")} - ${String(variant.title || "قياسي")}`,
              description: String(product.body_html || "").replace(/<[^>]*>/g, ""),
              price,
              currency: "USD",
              category: String((product.product_type as string) || "عام"),
              sku: String(variant.sku || ""),
              barcode: String(variant.barcode || ""),
              stockQuantity: variant.inventory_quantity ? Number(variant.inventory_quantity) : undefined,
              isAvailable: product.status === "active" && variant.inventory_policy !== "deny",
              imageUrl,
              externalId: String(variant.id || ""),
              rawData: { ...product, variant },
            });
          }
        } catch (err) {
          errors.push({ id: String(product.id || ""), error: (err as Error).message });
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
      hasMore: (res.data?.products?.length || 0) >= limit,
      elapsedMs: Date.now() - startTime,
    };
  }

  async syncOrders(options?: SyncOptions): Promise<SyncResult<ExternalOrder>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");

    const headers = createAuthHeaders("api_key", this.apiKey);
    const startTime = Date.now();
    const items: ExternalOrder[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    const limit = Math.min(options?.batchSize || 250, 250);
    let url = `${this.resolvedApiEndpoint}orders.json?status=any&limit=${limit}`;

    if (options?.since) {
      const since = new Date(options.since).toISOString();
      url += `&created_at_min=${encodeURIComponent(since)}`;
    }

    const res = await safeFetch<{
      orders?: Array<Record<string, unknown>>;
    }>(url, { headers });

    if (res.ok && res.data?.orders) {
      for (const order of res.data.orders) {
        try {
          const lineItems = (order.line_items as Array<Record<string, unknown>>) || [];
          const customer = (order.customer as Record<string, unknown>) || {};
          const totalPriceSet = (order.total_price_set as Record<string, unknown>) || {};
          const totalMoney = (totalPriceSet.shop_money as Record<string, unknown>) || {};

          const orderItems = lineItems.map((li) => {
            const liPrice = Number(li.price || 0);
            const qty = Number(li.quantity || 1);
            return {
              productId: String(li.product_id || li.variant_id || ""),
              productName: String(li.name || li.title || "غير معروف"),
              quantity: qty,
              unitPrice: liPrice,
              total: Math.round(qty * liPrice * 100) / 100,
            };
          });

          const subtotal = orderItems.reduce((s, i) => s + i.total, 0);
          const total = Number(totalMoney.amount || order.total_price || subtotal);

          items.push({
            id: String(order.id || ""),
            orderNumber: String(order.order_number || order.name || order.id || ""),
            customerName: `${String(customer.first_name || "")} ${String(customer.last_name || "")}`.trim(),
            customerPhone: String(customer.phone || ""),
            items: orderItems,
            subtotal,
            tax: Number(order.total_tax || 0),
            total,
            currency: String(totalMoney.currency || "USD"),
            status: this.mapOrderStatus(String(order.financial_status || "pending")),
            paymentStatus: order.financial_status === "paid" ? "paid" : "pending",
            createdAt: String(order.created_at || new Date().toISOString()),
            updatedAt: String(order.updated_at || new Date().toISOString()),
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
      hasMore: (res.data?.orders?.length || 0) >= limit,
      elapsedMs: Date.now() - startTime,
    };
  }

  async syncInventory(_options?: SyncOptions): Promise<SyncResult<ExternalInventory>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");

    const headers = createAuthHeaders("api_key", this.apiKey);
    const startTime = Date.now();
    const items: ExternalInventory[] = [];

    // Shopify inventory levels
    const url = `${this.resolvedApiEndpoint}inventory_levels.json?limit=250`;
    const res = await safeFetch<{
      inventory_levels?: Array<Record<string, unknown>>;
    }>(url, { headers });

    if (res.ok && res.data?.inventory_levels) {
      for (const level of res.data.inventory_levels) {
        const inventoryItem = (level.inventory_item as Record<string, unknown>) || {};
        items.push({
          productId: String(inventoryItem.id || level.inventory_item_id || ""),
          productName: String(inventoryItem.sku || ""),
          sku: String(inventoryItem.sku || ""),
          quantity: level.available ? Number(level.available) : 0,
          reservedQuantity: 0,
          availableQuantity: level.available ? Number(level.available) : 0,
          lastUpdated: String(level.updated_at || new Date().toISOString()),
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
    const headers = createAuthHeaders("api_key", this.apiKey);
    const url = `${this.resolvedApiEndpoint}custom_collections.json?limit=250`;
    const res = await safeFetch<{
      custom_collections?: Array<Record<string, unknown>>;
    }>(url, { headers });

    const categories: Array<{ id: string; name: string; parentId?: string }> = [];
    if (res.ok && res.data?.custom_collections) {
      for (const col of res.data.custom_collections) {
        categories.push({
          id: String(col.id || ""),
          name: String(col.title || col.handle || "غير معروف"),
        });
      }
    }
    return categories;
  }

  async updateStock(productId: string, quantity: number): Promise<boolean> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");
    const headers = createAuthHeaders("api_key", this.apiKey);

    // Update via inventory endpoint
    const url = `${this.resolvedApiEndpoint}inventory_levels/set.json`;
    const res = await safeFetch<Record<string, unknown>>(url, {
      headers,
      method: "POST",
      body: JSON.stringify({
        inventory_item_id: Number(productId),
        location_id: 1, // Default location
        available: quantity,
      }),
    });
    return res.ok;
  }

  private mapOrderStatus(status: string): ExternalOrder["status"] {
    const map: Record<string, ExternalOrder["status"]> = {
      pending: "pending",
      authorized: "confirmed",
      partially_paid: "confirmed",
      paid: "delivered",
      partially_refunded: "cancelled",
      refunded: "cancelled",
      voided: "cancelled",
    };
    return map[status] || "pending";
  }
}
