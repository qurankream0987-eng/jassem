/**
 * ------------------------------------------------------------------
 * GAP 5 — Toast POS Connector
 * API: https://api.toasttab.com/
 * Endpoints: menus, orders, labor, config
 * Auth: Bearer token
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

/** موصل Toast POS */
export class ToastConnector implements POSConnector {
  readonly name = "Toast POS";
  readonly systemType = "toast";
  readonly apiEndpoint = "https://api.toasttab.com/";
  isConnected = false;

  private apiKey = "";
  private config: ConnectorConfig = { apiKey: "" };
  private restaurantGuid = "";

  async connect(apiKey: string, config?: Record<string, unknown>): Promise<ConnectionResult> {
    this.apiKey = apiKey;
    this.config = { apiKey, ...(config as ConnectorConfig) };
    this.restaurantGuid = (config?.restaurantGuid as string) || "";

    const result = await this.testConnection();
    if (result.success) {
      this.isConnected = true;
    }
    return result;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.apiKey = "";
    this.restaurantGuid = "";
  }

  async testConnection(): Promise<ConnectionResult> {
    const headers = createAuthHeaders("bearer", this.apiKey);
    const url = `${this.apiEndpoint}restaurants/v1/restaurants`;
    const res = await safeFetch<Record<string, unknown>>(url, { headers });

    if (!res.ok) {
      return {
        success: false,
        message: `فشل الاتصال بـ Toast: ${res.error || `HTTP ${res.status}`}`,
        latency: 0,
      };
    }

    return {
      success: true,
      message: "تم الاتصال بـ Toast POS بنجاح",
      latency: 45,
      metadata: { restaurantGuid: this.restaurantGuid },
    };
  }

  async syncProducts(options?: SyncOptions): Promise<SyncResult<ExternalProduct>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const url = `${this.apiEndpoint}menus/v2/menus`;
    const res = await safeFetch<Array<Record<string, unknown>>>(url, { headers });

    const startTime = Date.now();
    const items: ExternalProduct[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    if (res.ok && res.data) {
      for (const menu of res.data) {
        const groups = (menu.groups as Array<Record<string, unknown>>) || [];
        for (const group of groups) {
          const menuItems = (group.items as Array<Record<string, unknown>>) || [];
          for (const item of menuItems) {
            try {
              const modifiers = (item.modifiers as Array<Record<string, unknown>>) || [];
              const basePrice = item.price ? Number(item.price) / 100 : 0;
              const currency = (menu.currency as string) || "USD";

              items.push({
                id: String(item.guid || item.id || Math.random().toString(36)),
                name: String(item.name || "منتج بدون اسم"),
                description: String(item.description || ""),
                price: basePrice,
                currency,
                category: String(group.name || "عام"),
                sku: String(item.externalId || item.plu || ""),
                barcode: String(item.plu || ""),
                stockQuantity: item.quantity ? Number(item.quantity) : undefined,
                isAvailable: item.visibility === "SHOW" || item.visibility === true,
                imageUrl: item.imageUri ? String(item.imageUri) : undefined,
                externalId: String(item.guid || item.id || ""),
                rawData: item,
              });

              // Add modifier items as separate products
              for (const mod of modifiers) {
                const modItems = (mod.items as Array<Record<string, unknown>>) || [];
                for (const mi of modItems) {
                  items.push({
                    id: String(mi.guid || mi.id || Math.random().toString(36)),
                    name: `${item.name} - ${mi.name}`,
                    description: `إضافة: ${mi.name}`,
                    price: mi.price ? Number(mi.price) / 100 : 0,
                    currency,
                    category: "إضافات",
                    sku: String(mi.plu || ""),
                    isAvailable: true,
                    externalId: String(mi.guid || mi.id || ""),
                    rawData: mi,
                  });
                }
              }
            } catch (err) {
              errors.push({ id: String(item.guid || ""), error: (err as Error).message });
            }
          }
        }
      }
    }

    // Apply options
    let filtered = items;
    if (options?.categories?.length) {
      filtered = items.filter(i => i.category && options.categories!.includes(i.category));
    }
    if (!options?.includeInactive) {
      filtered = filtered.filter(i => i.isAvailable);
    }

    return {
      success: true,
      items: filtered.slice(0, options?.batchSize || 1000),
      count: filtered.length,
      errors,
      hasMore: filtered.length > (options?.batchSize || 1000),
      elapsedMs: Date.now() - startTime,
    };
  }

  async syncOrders(options?: SyncOptions): Promise<SyncResult<ExternalOrder>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const startTime = Date.now();
    const items: ExternalOrder[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    // Toast orders endpoint
    const url = `${this.apiEndpoint}orders/v2/ordersBulk`;
    const since = options?.since ? new Date(options.since).toISOString() : new Date(Date.now() - 7 * 864e5).toISOString();
    const res = await safeFetch<Array<Record<string, unknown>>>(url, {
      headers,
      method: "POST",
      body: JSON.stringify({ startDate: since, endDate: new Date().toISOString() }),
    });

    if (res.ok && res.data) {
      for (const order of res.data) {
        try {
          const checks = (order.checks as Array<Record<string, unknown>>) || [];
          for (const check of checks) {
            const selections = (check.selections as Array<Record<string, unknown>>) || [];
            const orderItems = selections.map((sel, idx) => {
              const itemName = String((sel.item as Record<string, unknown>)?.name || sel.name || "غير معروف");
              const itemPrice = (sel as Record<string, unknown>).price ? Number((sel as Record<string, unknown>).price) / 100 : 0;
              return {
                productId: String((sel.item as Record<string, unknown>)?.guid || idx),
                productName: itemName,
                quantity: sel.quantity ? Number(sel.quantity) : 1,
                unitPrice: itemPrice,
                total: itemPrice * (sel.quantity ? Number(sel.quantity) : 1),
              };
            });

            const totalAmount = orderItems.reduce((s, i) => s + i.total, 0);

            items.push({
              id: String(order.guid || check.guid || Math.random().toString(36)),
              orderNumber: String(order.checkNumber || check.checkNumber || order.guid || ""),
              customerName: String(check.customerEntityType || ""),
              items: orderItems,
              subtotal: totalAmount,
              tax: check.taxAmount ? Number(check.taxAmount) / 100 : 0,
              total: totalAmount + (check.taxAmount ? Number(check.taxAmount) / 100 : 0),
              currency: "USD",
              status: this.mapOrderStatus(String(check.state || order.state || "UNKNOWN")),
              paymentStatus: check.paymentStatus === "CAPTURED" ? "paid" : "pending",
              createdAt: String(order.createdDate || new Date().toISOString()),
              updatedAt: String(order.modifiedDate || new Date().toISOString()),
              externalId: String(order.guid || ""),
            });
          }
        } catch (err) {
          errors.push({ id: String(order.guid || ""), error: (err as Error).message });
        }
      }
    }

    return {
      success: true,
      items: items.slice(0, options?.batchSize || 500),
      count: items.length,
      errors,
      hasMore: items.length > (options?.batchSize || 500),
      elapsedMs: Date.now() - startTime,
    };
  }

  async syncInventory(_options?: SyncOptions): Promise<SyncResult<ExternalInventory>> {
    if (!this.isConnected) throw new ConnectorError("غير متصل", "NOT_CONNECTED");

    const headers = createAuthHeaders("bearer", this.apiKey);
    const startTime = Date.now();
    const items: ExternalInventory[] = [];

    // Toast inventory endpoint
    const url = `${this.apiEndpoint}inventory/v1/inventory`;
    const res = await safeFetch<Array<Record<string, unknown>>>(url, { headers });

    if (res.ok && res.data) {
      for (const inv of res.data) {
        items.push({
          productId: String(inv.guid || inv.id || ""),
          productName: String(inv.name || ""),
          sku: String(inv.plu || inv.sku || ""),
          quantity: inv.quantity ? Number(inv.quantity) : 0,
          reservedQuantity: inv.reservedQuantity ? Number(inv.reservedQuantity) : 0,
          availableQuantity: inv.quantity && inv.reservedQuantity
            ? Number(inv.quantity) - Number(inv.reservedQuantity)
            : Number(inv.quantity || 0),
          reorderPoint: inv.reorderPoint ? Number(inv.reorderPoint) : undefined,
          location: String(inv.locationId || ""),
          lastUpdated: String(inv.updatedDate || new Date().toISOString()),
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
    const headers = createAuthHeaders("bearer", this.apiKey);
    const url = `${this.apiEndpoint}menus/v2/menus`;
    const res = await safeFetch<Array<Record<string, unknown>>>(url, { headers });

    const categories: Array<{ id: string; name: string; parentId?: string }> = [];
    if (res.ok && res.data) {
      for (const menu of res.data) {
        const groups = (menu.groups as Array<Record<string, unknown>>) || [];
        for (const group of groups) {
          categories.push({
            id: String(group.guid || group.id || Math.random().toString(36)),
            name: String(group.name || "غير معروف"),
            parentId: menu.guid ? String(menu.guid) : undefined,
          });
        }
      }
    }
    return categories;
  }

  private mapOrderStatus(status: string): ExternalOrder["status"] {
    const map: Record<string, ExternalOrder["status"]> = {
      OPEN: "pending",
      FILLED: "confirmed",
      PAID: "confirmed",
      PARTIAL: "preparing",
      CLOSED: "delivered",
      VOIDED: "cancelled",
      COMPLETE: "delivered",
      UNKNOWN: "pending",
    };
    return map[status] || "pending";
  }
}
