# JASIM V4 API Documentation
# / توثيق واجهة برمجة التطبيقات

## Overview / نظرة عامة

JASIM V4 exposes **25 tRPC routers** covering all commerce domains. All APIs use tRPC v11 with Zod validation and SuperJSON serialization.

**Base URL:** `https://api.jasim.app/api/trpc`

**Supported Markets / الأسواق المدعومة:**
- 🇰🇼 Kuwait (KW)
- 🇸🇦 Saudi Arabia (SA)
- 🇦🇪 UAE (AE)
- 🇶🇦 Qatar (QA)
- 🇧🇭 Bahrain (BH)
- 🇴🇲 Oman (OM)

---

## Table of Contents

1. [Core Routers (7)](#core-routers)
2. [Commerce Routers (6)](#commerce-routers)
3. [Feature Routers (7)](#feature-routers)
4. [SaaS Routers (5)](#saas-routers)
5. [Common Types](#common-types)

---

## Core Routers

### 1. `agents` - AI Agent System / نظام الوكلاء الذكيين

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `parse` | mutation | `{ text: string, context?: ConversationContext }` | `ParsedIntent` | Parse user intent from text |
| `route` | mutation | `{ intent: ParsedIntent }` | `RoutingResult` | Route intent to appropriate agent |
| `getStatus` | query | - | `AgentStatus[]` | Get all agent statuses |
| `batchParse` | mutation | `{ messages: string[] }` | `ParsedIntent[]` | Batch parse intents |
| `resolveMultiTurn` | mutation | `{ current: string, history: ParsedIntent[] }` | `ParsedIntent` | Multi-turn context resolution |

**Agents Available:** food, fashion, grocery, pharmacy, delivery, b2b_supplier, cross_border, haggle, fleet, recruitment, vision, voice, smart_connect, gen_saas, gen_aggregator, widget, a2a, analytics, financial, mentor

---

### 2. `auth` - Authentication / المصادقة

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `register` | mutation | `{ phone: string, password: string, name: string }` | `{ user, token }` | Register new user |
| `login` | mutation | `{ phone: string, password: string }` | `{ user, token }` | Login user |
| `me` | query | - | `User \| null` | Get current user |
| `logout` | mutation | - | `void` | Logout |

---

### 3. `recruitment` - Jobs & CVs / الوظائف والسير الذاتية

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `searchJobs` | query | `{ keyword, location, category }` | `Job[]` | Search jobs |
| `getJob` | query | `{ id: string }` | `Job` | Get job details |
| `apply` | mutation | `{ jobId, userId, cv }` | `Application` | Apply for job |
| `generateCV` | mutation | `{ userData }` | `{ cvUrl }` | Generate CV |
| `getSalaryInsights` | query | `{ role: string }` | `SalaryData` | Salary analytics |

---

### 4. `merchants` - Merchants / التجار

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `getDashboard` | query | `{ merchantId }` | `DashboardData` | Merchant dashboard |
| `getAnalytics` | query | `{ merchantId, period }` | `AnalyticsData` | Sales analytics |
| `updateProfile` | mutation | `{ merchantId, data }` | `Merchant` | Update merchant profile |
| `getStaff` | query | `{ merchantId }` | `Staff[]` | Get staff list |

---

### 5. `products` - Products / المنتجات

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | query | `{ category?, merchantId? }` | `Product[]` | List products |
| `search` | query | `{ query: string }` | `Product[]` | Search products |
| `getById` | query | `{ id: string }` | `Product` | Get product |
| `create` | mutation | `{ name, price, ... }` | `Product` | Create product |
| `update` | mutation | `{ id, data }` | `Product` | Update product |

---

### 6. `orders` - Orders / الطلبات

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `list` | query | `{ userId?, merchantId?, status? }` | `Order[]` | List orders |
| `getById` | query | `{ id: string }` | `Order` | Get order |
| `create` | mutation | `{ items, address, paymentMethod }` | `Order` | Create order |
| `updateStatus` | mutation | `{ id, status }` | `Order` | Update order status |
| `cancel` | mutation | `{ id }` | `Order` | Cancel order |

**Order Status Flow:**
```
pending → confirmed → processing → shipped → delivered
                    ↘ cancelled
```

---

### 7. `cart` - Shopping Cart / سلة التسوق

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `get` | query | `{ userId }` | `Cart` | Get cart |
| `add` | mutation | `{ userId, productId, qty }` | `Cart` | Add to cart |
| `remove` | mutation | `{ userId, productId }` | `Cart` | Remove from cart |
| `updateQty` | mutation | `{ userId, productId, qty }` | `Cart` | Update quantity |
| `checkout` | mutation | `{ userId, address }` | `Order` | Checkout cart |

---

## Commerce Routers

### 8. `payments` - Payments / الدفع

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `create` | mutation | `{ orderId, amount, method }` | `Payment` | Create payment |
| `authorize` | mutation | `{ paymentId }` | `Payment` | Authorize payment |
| `capture` | mutation | `{ paymentId }` | `Payment` | Capture payment |
| `refund` | mutation | `{ paymentId }` | `Payment` | Refund payment |
| `getMethods` | query | `{ marketCode }` | `PaymentMethod[]` | Available methods |

**Payment Methods:** KNET, Apple Pay, Google Pay, Visa, Mastercard, Cash

---

### 9. `suppliers` - Suppliers & B2B / الموردين

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `getInventory` | query | `{ supplierId }` | `InventoryItem[]` | Get inventory |
| `createPO` | mutation | `{ items, supplierId }` | `PurchaseOrder` | Create purchase order |
| `getQuote` | mutation | `{ items, quantity }` | `Quote` | Request quote |

---

### 10. `crossborder` - Cross-Border / التجارة العابرة

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `calculateCustoms` | mutation | `{ itemValue, shipping, insurance, origin, dest, category }` | `CustomsResult` | Calculate customs & VAT |
| `estimateShipping` | query | `{ weight, origin, dest, speed }` | `ShippingEstimate` | Estimate shipping |
| `getCompliance` | query | `{ productId, dest }` | `ComplianceInfo` | Check compliance |

**VAT Rates:**
| Country | VAT Rate |
|---------|----------|
| 🇰🇼 Kuwait | 0% |
| 🇸🇦 Saudi Arabia | 15% |
| 🇦🇪 UAE | 5% |
| 🇶🇦 Qatar | 0% |
| 🇧🇭 Bahrain | 10% |
| 🇴🇲 Oman | 5% |

---

### 11. `haggle` - Price Negotiation / المساومة

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `negotiate` | mutation | `{ productId, offeredPrice, userTier }` | `HaggleResult` | Price negotiation |
| `counterOffer` | mutation | `{ negotiationId, newPrice }` | `HaggleResult` | Counter offer |
| `accept` | mutation | `{ negotiationId }` | `Order` | Accept deal |

**User Tiers:** new (5%), bronze (10%), silver (15%), gold (20%), platinum (25%)

---

### 12. `islamic` - Islamic Finance / المالية الإسلامية

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `verifyHalal` | query | `{ productIds }` | `HalalResult[]` | Verify halal status |
| `getCertifications` | query | `{ merchantId }` | `Certification[]` | Get certifications |

---

### 13. `fleet` - Fleet Management / إدارة الأسطول

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `trackDriver` | query | `{ driverId }` | `DriverLocation` | Track driver |
| `assignDriver` | mutation | `{ orderId, driverId }` | `Assignment` | Assign driver |
| `getDrivers` | query | `{ merchantId }` | `Driver[]` | List drivers |
| `updateLocation` | mutation | `{ driverId, lat, lng }` | `void` | Update location |

---

## Feature Routers

### 14. `zakat` - Zakat Calculator / حاسبة الزكاة

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `calculate` | mutation | `{ cash, goldGrams, silverGrams, investments, receivables, goldPrice, silverPrice }` | `ZakatResult` | Calculate zakat (2.5%) |
| `getRates` | query | - | `ZakatRates` | Current gold/silver rates |

**Nisab Threshold:** 85g gold (~1,700 KWD at 20 KWD/g)

---

### 15. `biometric` - Biometric Auth / المصادقة البيومترية

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `register` | mutation | `{ userId, biometricData }` | `void` | Register biometric |
| `verify` | mutation | `{ userId, biometricData }` | `{ success, confidence }` | Verify biometric |
| `remove` | mutation | `{ userId }` | `void` | Remove biometric data |

---

### 16. `vision` - AI Vision / الرؤية الذكية

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `scanProduct` | mutation | `{ image }` | `ScanResult` | Scan product image |
| `scanBarcode` | mutation | `{ barcode }` | `Product` | Lookup barcode |
| `ocrReceipt` | mutation | `{ image }` | `ReceiptData` | OCR receipt |

---

### 17. `voice` - Voice AI / الذكاء الصوتي

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `synthesize` | mutation | `{ text, voiceId, language }` | `{ audioUrl }` | Text-to-speech |
| `transcribe` | mutation | `{ audio }` | `{ text, confidence }` | Speech-to-text |
| `cloneVoice` | mutation | `{ samples, quality }` | `{ voiceId }` | Clone voice |

---

### 18. `smartconnect` - POS Integration / الربط الذكي

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `getIntegrations` | query | `{ merchantId }` | `Integration[]` | List integrations |
| `connectPOS` | mutation | `{ merchantId, type, config }` | `Integration` | Connect POS |
| `syncInventory` | mutation | `{ merchantId }` | `{ synced, failed }` | Sync inventory |

**Supported Systems:** Toast, Square, Clover, Shopify, WooCommerce, Magento

---

### 19. `webhooks` - Webhooks

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `register` | mutation | `{ url, events, merchantId }` | `Webhook` | Register webhook |
| `list` | query | `{ merchantId }` | `Webhook[]` | List webhooks |
| `delete` | mutation | `{ webhookId }` | `void` | Delete webhook |

---

## SaaS Routers

### 20. `gensaas` - Gen-SaaS / منشئ المنصات

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `createApp` | mutation | `{ name, template, merchantId }` | `{ appId, url }` | Create app |
| `getStore` | query | `{ merchantId }` | `Store` | Get store |
| `customizeTheme` | mutation | `{ storeId, colors }` | `Store` | Customize theme |
| `deploy` | mutation | `{ appId }` | `{ url }` | Deploy app |

---

### 21. `genaggregator` - Gen-Aggregator / منشئ السوق

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `createMarketplace` | mutation | `{ name, config }` | `{ platformId, url }` | Create marketplace |
| `addVendor` | mutation | `{ platformId, vendorId }` | `void` | Add vendor |
| `setCommission` | mutation | `{ platformId, rate }` | `void` | Set commission rate |

---

### 22. `widget` - Embeddable Widgets / الأدوات المدمجة

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `generateEmbed` | mutation | `{ type, config, merchantId }` | `{ embedCode }` | Generate embed code |
| `list` | query | `{ merchantId }` | `Widget[]` | List widgets |

**Widget Types:** chat, booking, product, lead_form

---

### 23. `a2a` - Agent-to-Agent Trading / تداول الوكلاء

| Procedure | Type | Input | Output | Description |
|-----------|------|-------|--------|-------------|
| `listAgents` | query | - | `AgentListing[]` | List AI agents |
| `purchase` | mutation | `{ agentId, buyerId }` | `Transaction` | Purchase agent |
| `listAgent` | mutation | `{ agentId, sellerId, price }` | `Listing` | List agent for sale |

---

## Common Types

### Pagination
```typescript
interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  total: number;
}
```

### Market Context
```typescript
interface MarketContext {
  code: 'KW' | 'SA' | 'AE' | 'QA' | 'BH' | 'OM';
  currency: string;
  vatRate: number;
  language: 'ar' | 'en';
}
```

### Error Response
```typescript
interface TRPCError {
  code: string;        // UNAUTHORIZED, NOT_FOUND, BAD_REQUEST, etc.
  message: string;     // Human-readable (Arabic + English)
  cause?: unknown;
}
```

---

## Authentication

All API calls require authentication via JWT Bearer token:

```
Authorization: Bearer <jwt_token>
```

Include market context in headers:
```
X-Market-Code: KW
X-Language: ar
```

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| General queries | 100 | 1 minute |
| Auth endpoints | 10 | 1 minute |
| AI parsing | 50 | 1 minute |
| Upload | 10 | 1 minute |

---

*JASIM V4 API - Last Updated: 2024*
*جاسم الإصدار 4 - آخر تحديث: 2024*
