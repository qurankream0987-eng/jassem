# خطة بناء باك-إند جاسم الكامل — JASIM Backend Build Plan

## 1. ملخص الدراسة العميقة

بعد دراسة 27+ ملف:
- **التكدس المعتمد:** React 19 + TypeScript + tRPC 11 + Drizzle ORM + Hono + MySQL 8
- **9 طبقات معمارية** — 40+ وكيل — 35+ فقاعة — 18 سوق عربي
- **17 مجالًا** يجب تغطيتها كاملة في الباك-إند

## 2. المجالات الـ 17 المطلوبة

| # | المجال | الحالة | الوصف |
|---|--------|--------|-------|
| 1 | B2C (طلب طعام) | ✅ | Product, Order, Cart, Checkout |
| 2 | B2B (مورد + تفاوض) | ✅ | Suppliers, Cross-Border B2B, Haggle |
| 3 | Smart Connect (POS + API) | ✅ | LAM Engine, API Translator, Webhooks |
| 4 | Gen-SaaS (بناء منصات) | ✅ | Templates, Schemas, Workflows |
| 5 | Gen-Aggregator (سوق) | ✅ | Platforms, Vendors, Commissions |
| 6 | Fleet (توصيل + سائقين) | ✅ | Drivers, Routes, Tracking, SOS |
| 7 | Cross-Border (مرابحة) | ✅ | Murabaha, Currency Exchange, Customs |
| 8 | Zakat (حساب الزكاة) | ✅ | Zakat Calculator, Nisab, Reports |
| 9 | Biometric (بصمة/وجه) | ✅ | Face ID, Touch ID, Liveness Detection |
| 10 | AI Vision (كاميرا) | ✅ | Product Scan, OCR, KYC Verification |
| 11 | Voice (صوت) | ✅ | STT, TTS, Sonic DNA |
| 12 | Escrow (ضمان) | ✅ | Payment Hold, Release, Dispute |
| 13 | Haggle (مفاوضة) | ✅ | AI Negotiation, Price Suggestions |
| 14 | Multi-Bubble (Split + Float + Dock) | ✅ | Window Manager, Snap, Resize |
| 15 | Recruitment (توظيف) | ✅ | CV Generation, Job Matching, Apply |
| 16 | Agent-to-Agent (تفاوض وكلاء) | ✅ | A2A Trading, Agent Marketplace |
| 17 | WidgetCodeBubble (تضمين في مواقع) | ✅ | JS Widget, API Keys, Embeds |

## 3. خطة التنفيذ — 5 مراحل

### المرحلة 1: قاعدة البيانات الكاملة (db, auth, markets)
- 14 جدول أساسي + الجداول الإضافية للـ 17 مجال
- Row Level Security (RLS) per market
- Auth system (JWT + OAuth 2.0 + phone OTP)
- Seed data for 18 markets

### المرحلة 2: Core Intelligence Routers
- Intent Parser, Conversation, Memory Agent
- Haggle Agent, Islamic Validator

### المرحلة 3: Commerce + Services Routers
- B2C: Products, Orders, Cart, Checkout
- B2B: Suppliers, Cross-Border
- Fleet: Drivers, Routes, Tracking
- Escrow: Payments, Disputes
- Zakat Calculator
- Biometric verification

### المرحلة 4: Advanced Routers
- Smart Connect: LAM, API Translator, Webhooks
- Gen-SaaS: Templates, Workflows
- Gen-Aggregator: Platforms, Vendors
- Recruitment: CV, Jobs, Matching
- AI Vision + Voice

### المرحلة 5: Integration + Widget
- Agent-to-Agent trading
- Widget code embed system
- Final integration + testing

## 4. التوزيع على الوكلاء الفرعيين

| الوكيل | المسؤولية | الملفات |
|--------|-----------|---------|
| DB_Builder | قاعدة البيانات + Auth + Seeds | db/schema.ts, db/seed.ts, api/auth/ |
| Core_Builder | Core Intelligence routers | api/routers/intent.ts, chat.ts, memory.ts, haggle.ts, islamic.ts |
| Commerce_Builder | B2C + B2B + Orders + Escrow | api/routers/products.ts, orders.ts, cart.ts, payments.ts, suppliers.ts |
| Services_Builder | Fleet + Zakat + Biometric + Recruitment | api/routers/fleet.ts, zakat.ts, biometric.ts, recruitment.ts |
| Advanced_Builder | Smart Connect + Gen-SaaS + Gen-Aggregator + Widget + A2A | api/routers/smartconnect.ts, gen-saas.ts, gen-aggregator.ts, widget.ts, a2a.ts |

## 5. المواصفات التقنية

- **Node.js 20+**, TypeScript 5.7+
- **tRPC 11.x** — type-safe RPC
- **Hono** — lightweight server framework
- **Drizzle ORM** — type-safe SQL-like ORM
- **MySQL 8** — with Row Level Security per market
- **JWT + OAuth 2.0** — Auth with refresh tokens
- **Zod** — Input validation on every endpoint
- **Rate Limiting** — per user + per market
- **Error Handling** — structured errors with Arabic messages
