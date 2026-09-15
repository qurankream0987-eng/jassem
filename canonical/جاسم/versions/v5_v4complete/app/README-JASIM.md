# جاسم (JASIM) V4 الكامل
## AI Commerce Operating System — المتطور الكامل

---

## ما هو جاسم؟

**جاسم = OS Marketplace + Executive Generative AI Agent + Swarm System**

جاسم هو أول نظام تشغيل تجاري قائم على الذكاء الاصطناعي للعالم العربي. يعمل عبر 18 سوق عربي ويدعم 27 وكيل ذكي متخصص يتعاونون كـ "سرب" لحل أي مهمة.

---

## إحصائيات المشروع

| المقياس | القيمة |
|---------|--------|
| **إجمالي أسطر الكود** | **63,108 سطر** |
| **ملفات الباك-إند** | 81 ملف TypeScript |
| **ملفات الفرونت-إند** | 137 ملف (TS + TSX) |
| **ملفات الاختبار** | 14 ملف (315 اختبار) |
| **ملفات الموبايل** | 15 ملف (React Native) |
| **عدد الراوترات** | **26 راوتر** |
| **عدد الجداول** | **54 جدول** |
| **ملفات عقل جاسم** | **33 ملف** في `api/core/` |

---

## المكونات المبنية

### 🧠 عقل جاسم (33 ملف)

| المكون | الوصف |
|--------|-------|
| `intent-parser` | محلل النوايا — 19 نوع |
| `arabic-nlp` | معالج اللغة العربية بالذكاء الاصطناعي |
| `memory-engine` | ذاكرة المستخدم |
| `context-builder` | بناء سياق المحادثة |
| `agent-router` | موجه الوكلاء (27 وكيل) |
| `swarm-orchestrator` | منسق السرب |
| `response-generator` | مولد الردود بالعربية |
| `bubble-generator` | مولد فقاعات GenUI |
| `llm-router` | راوتر الذكاء الاصطناعي (DeepSeek/Gemini/Claude) |
| `token-protocol` | بروتوكول الضغط (60-80% توفير) |
| `integration` | ربط End-to-End |
| `database-query` | راوتر استعلامات DB |
| `lam-orchestrator` | قراءة APIs تلقائياً |
| `escrow` | نظام الضمان الذكي |
| `predictive-engine` | محرك التنبؤ |
| `churn-prevention` | منع تسرب المستخدمين |
| `agent-evolution` | تطور الوكلاء |
| `agent-dna` | 12 جينة للوكلاء |
| `notification-router` | راوتر الإشعارات |
| `push` | Push Notifications (FCM/APNs) |
| `whatsapp` | WhatsApp Business API |
| `sms` | Twilio SMS |
| `email` | SendGrid Email |
| `in-app` | إشعارات داخل التطبيق |
| `websocket` | WebSocket Server |
| `notification-triggers` | محفزات الإشعارات |

### 🛒 الراوترات الـ 26

| الراوتر | المجال |
|---------|--------|
| `jasim` | العقل الرئيسي (chat, voice, vision) |
| `conversation` | المحادثات |
| `swarm` | نظام السرب |
| `notifications` | الإشعارات |
| `agents` | الوكلاء |
| `products` | المنتجات |
| `orders` | الطلبات |
| `cart` | السلة |
| `payments` | المدفوعات + Escrow |
| `merchants` | التجار |
| `suppliers` | الموردون B2B |
| `crossborder` | كروس-بوردر |
| `haggle` | المفاوضة الذكية |
| `islamic` | الامتثال الإسلامي |
| `fleet` | الأسطول |
| `zakat` | الزكاة |
| `biometric` | البيومترك |
| `recruitment` | التوظيف |
| `vision` | AI Vision |
| `voice` | الصوت |
| `smartconnect` | Smart Connect |
| `webhooks` | Webhooks |
| `gensaas` | Gen-SaaS |
| `genaggregator` | Gen-Aggregator |
| `widget` | Widget Embed |
| `a2a` | Agent-to-Agent |

---

## الخطوات اليدوية التي عليك القيام بها

### الخطوة 1: تحميل الكود

```bash
# انسخ المشروع
cd /mnt/agents/output/app
# أو حمله من الرابط أعلاه
```

### الخطوة 2: تثبيت قاعدة البيانات

```bash
# 1. ثبّت MySQL 8
# macOS: brew install mysql
# Ubuntu: sudo apt install mysql-server
# Windows: تحميل MySQL Installer

# 2. أنشئ قاعدة البيانات
mysql -u root -p
create database jasim character set utf8mb4 collate utf8mb4_unicode_ci;
create database jasim_shadow character set utf8mb4 collate utf8mb4_unicode_ci;
exit;

# 3. أنشئ ملف .env في جذر المشروع
cp .env.example .env

# 4. عدّل DATABASE_URL في .env:
DATABASE_URL=mysql://root:password@localhost:3306/jasim

# 5. ارفع الجداول
npm run db:push

# 6. حمّل البيانات الأولية
npm run db:seed
```

### الخطوة 3: إضافة مفاتيح الذكاء الاصطناعي

```bash
# عدّل ملف .env وأضف:
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com

GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxxxxxxxxx

CLAUDE_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxx
```

### الخطوة 4: مفاتيح المصادقة

```bash
JWT_SECRET=your-super-secret-jwt-key-here
REFRESH_SECRET=your-refresh-secret-here

# OAuth (اختياري)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
APPLE_CLIENT_ID=com.jasim.app
```

### الخطوة 5: الإشعارات (اختياري)

```bash
# Firebase (Push Notifications)
FIREBASE_PROJECT_ID=jasim-xxx
FIREBASE_CLIENT_EMAIL=firebase@jasim.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nxxx\n-----END PRIVATE KEY-----\n
# Twilio (SMS)
TWILIO_SID=ACxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+965xxxxxxx

# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=xxxxxxxx
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxx

# SendGrid (Email)
SENDGRID_API_KEY=SG.xxxxxxxxx
```

### الخطوة 6: تشغيل المشروع

```bash
# تثبيت Dependencies
npm install

# تشغيل Development
npm run dev

# أو Build + Start
npm run build
npm start
```

### الخطوة 7: POS Connections (لكل تاجر)

كل تاجر يربط حسابه POS بنفسه:
- Toast POS ← API Key من merchant.toasttab.com
- Square ← OAuth من connect.squareup.com
- Clover ← API Token من api.clover.com
- Shopify ← Access Token من admin.shopify.com

### الخطوة 8: Payment Gateway

```bash
# Tap Payments (للكويت)
TAP_API_KEY=sk_test_xxxxxxxx
TAP_BASE_URL=https://api.tap.company/v2

# Knet (للكويت)
KNET_TRANSPORT_URL=https://kpay.com.kw

# Fawry (لمصر)
FAWRY_MERCHANT_CODE=xxx
FAWRY_SECURITY_KEY=xxx
```

### الخطوة 9: بناء الموبايل

```bash
cd mobile
npm install

# iOS
npx eas build --platform ios

# Android
npx eas build --platform android
```

### الخطوة 10: النشر

```bash
# Replit
npm run build
# ثم انقر على "Deploy" في Replit

# أو VPS
npm run build
npm start
# استخدم PM2: pm2 start dist/api/boot.js --name jasim
```

---

## هيكل المجلدات

```
app/
├── api/                    # الباك-إند الكامل
│   ├── core/               # عقل جاسم (33 ملف)
│   │   ├── notifications/  # نظام الإشعارات
│   │   └── ...
│   ├── routers/            # 26 راوتر
│   ├── auth/               # نظام المصادقة
│   ├── connectors/         # Smart Connect (POS)
│   ├── trpc.ts             # tRPC configuration
│   └── boot.ts             # نقطة الدخول
├── db/
│   ├── schema.ts           # 54 جدول
│   ├── seed.ts             # بيانات أولية
│   └── queries/            # اتصال DB
├── src/                    # الفرونت-إند
│   ├── pages/              # جميع الصفحات
│   ├── components/         # المكونات
│   ├── hooks/              # Hooks
│   ├── lib/                # مكتبات (sonic-dna, dna-breeder)
│   └── App.tsx             # نقطة الدخول
├── tests/                  # الاختبارات (315)
├── mobile/                 # React Native + Expo
├── docs/                   # التوثيق
├── public/                 # الملفات العامة
│   └── widget.js           # Widget embed
└── .github/workflows/      # CI/CD
```

---

## الميزات الكاملة

- ✅ 26 راوتر API
- ✅ 54 جدول قاعدة بيانات
- ✅ عقل جاسم (5 أنماط معمارية)
- ✅ 27 وكيل ذكي
- ✅ نظام سرب متكامل
- ✅ محرك التنبؤ
- ✅ منع تسرب المستخدمين
- ✅ تطور الوكلاء
- ✅ 12 جينة DNA
- ✅ نظام إشعارات كامل (Push/WhatsApp/SMS/Email/In-App)
- ✅ WebSocket Server
- ✅ Smart Connect (Toast/Square/Clover/Shopify)
- ✅ Widget Embed
- ✅ AI Vision (Camera/KYC/OCR)
- ✅ Cross-Border + مرابحة
- ✅ Gen-SaaS (6 قوالب)
- ✅ Gen-Aggregator
- ✅ Dashboards (Merchant/Admin)
- ✅ Sonic DNA (صوت توليدي)
- ✅ DNA Breeding
- ✅ Biometric (Face ID/Touch ID)
- ✅ Escrow Smart Contracts
- ✅ LAM Orchestrator
- ✅ Token Protocol (60-80% توفير)
- ✅ LLM Router (DeepSeek/Gemini/Claude)
- ✅ Arabic NLP
- ✅ 18 سوق عربي
- ✅ 315 اختبار
- ✅ React Native + Expo
- ✅ CI/CD (GitHub Actions)

---

بنيت بحب ❤️ للعالم العربي
