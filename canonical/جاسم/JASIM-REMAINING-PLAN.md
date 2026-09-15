# خطة بناء جاسم الكاملة — ما تبقى وما هو مطلوب
## JASIM Complete Build Plan — Remaining Work

---

## ✅ ما تم بناؤه حتى الآن

### 1. الباك-إند (90% مكتمل)
| المكون | الحالة | التفاصيل |
|--------|--------|----------|
| قاعدة البيانات | ✅ 50+ جدول | كل الجداول مع RLS |
| Auth (JWT+OTP+OAuth) | ✅ | تسجيل، دخول، تحقق |
| 25 راوتر | ✅ | جميع المجالات الـ 17 |
| عقل جاسم (Core) | ✅ | Intent Parser, Memory, Context, Agent Router |
| نظام السرب (Swarm) | ✅ | Swarm Orchestrator, Response Synthesizer, Bubble Generator |

### 2. الفرونت-إند (60% مكتمل)
| المكون | الحالة | التفاصيل |
|--------|--------|----------|
| Space Canvas | ✅ | خلفية فضائية |
| Floating Bubbles | ✅ | 6 فقاعات مع صور |
| Main Chat | ✅ | واجهة محادثة |
| Bottom Nav | ✅ | تنقل سفلي |
| Agent Marketplace | ✅ | 51 وكيل |
| Commerce Pages | ✅ | متاجر، منتجات، طلبات |
| Recruitment | ✅ | CV، وظائف، تطابق |
| Soap Glass Windows | ⚠️ ناقص | Drag/Snap/Resize/Dock |

### 3. ما لم يُبنَ بعد (الفجوات)

---

## 🔴 الفجوة 1: نظام الفقاعات الكامل (Multi-Bubble System)

### المشكلة
النظام الحالي لا يدعم:
- فتح أكثر من فقاعة في نفس الوقت
- تقسيم الشاشة (Split)
- التصوير في Dock
- Magnetic Snap (25% لـ 4 نوافذ)

### الحل
بناء `BubbleWindowManager` متكامل:

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   Bubble 1   │ │   Bubble 2   │ │   Bubble 3   │        │
│  │   (Phone)    │ │   (Phone)    │ │   (Phone)    │        │
│  │  25% width   │ │  25% width   │ │  25% width   │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Bubble 4 (ربع الشاشة)                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                     ┌─────┐ │
│                                                     │ Dock│ │
│                                                     └─────┘ │
└─────────────────────────────────────────────────────────────┘
```

**ملفات مطلوبة:**
- `src/components/BubbleWindow.tsx` — نافذة فقاعة
- `src/components/BubbleManager.tsx` — مدير الفقاعات
- `src/components/BubbleDock.tsx` — شريط التصوير
- `src/hooks/useBubbleDrag.ts` — سحب الفقاعات
- `src/hooks/useBubbleSnap.ts` — التقاط المغناطيسي
- `src/hooks/useBubbleResize.ts` — تغيير الحجم

**وقت التنفيذ:** 3-4 أيام

---

## 🔴 الفجوة 2: نظام الـ Widget (التضمين في المواقع)

### المشكلة
لا يوجد نظام widget لإدراج جاسم في مواقع خارجية.

### المطلوب
```html
<!-- أي موقع في العالم يضيف هذا الكود -->
<script src="https://jasim.ai/widget.js?api_key=jsk-xxx"></script>
<div id="jasim-bubble"></div>
```

**ما يجب بناؤه:**
1. **widget.js** — ملف JavaScript قابل للتضمين
   - يُحمل من CDN (Cloudflare R2)
   - يُنشئ فقاعة جاسم في الزاوية السفلية
   - يفتح chat iframe عند النقر
   - يدعم تخصيص الألوان والموقع

2. **Widget API** — نقاط خاصة بالـ widget
   - `widget.generateToken` — توليد API key
   - `widget.track` — تتبع التفاعلات
   - `widget.getConfig` — جلب الإعدادات

3. **Widget Builder Dashboard**
   - اختيار نوع الفقاعة
   - تخصيص الألوان
   - معاينة حية
   - نسخ الكود

**ملفات مطلوبة:**
- `public/widget.js` — ملف الـ widget
- `src/pages/WidgetBuilder.tsx` — بانر البناء
- `api/routers/widget.ts` — API للـ widget

**وقت التنفيذ:** 2-3 أيام

---

## 🔴 الفجوة 3: Smart Connect (ربط الأنظمة)

### المشكلة
لا يوجد رابط فعلي مع أنظمة POS أو APIs.

### المطلوب: ربط جاسم مع:
| النظام | الربط | الاستخدام |
|--------|-------|-----------|
| **Toast POS** | API Key | سحب المنتجات والطلبات |
| **Square** | OAuth 2.0 | مزامنة المخزون والمدفوعات |
| **Clover** | API Token | إدارة الطلبات والتقارير |
| **Shopify** | API Key | استيراد المنتجات |
| **Custom POS** | Webhook | أي نظام مخصص |

**ملفات مطلوبة:**
- `api/connectors/toast.ts` — موصل Toast
- `api/connectors/square.ts` — موصل Square
- `api/connectors/clover.ts` — موصل Clover
- `api/connectors/shopify.ts` — موصل Shopify
- `api/connectors/base.ts` — واجهة موحدة
- `src/pages/ConnectDashboard.tsx` — لوحة الربط

**وقت التنفيذ:** 4-5 أيام

---

## 🔴 الفجوة 4: Gen-SaaS (بناء المنصات)

### المشكلة
لا يوجد باني منصات تفاعلي حقيقي.

### المطلوب
السماح للمستخدم ببناء منصة كاملة من قالب:

```
المستخدم: "افتحلي متجر كيك"
جاسم: [يطلع نموذج من 4 أسئلة]
┌─────────────────────────────────────┐
│  اسم المتجر؟ → "كيكتي"              │
│  نوع الكيك؟ → [تشيز] [شوكلت] [فانيليا] │
│  التوصيل؟ → [نعم] [لا]              │
│  الدفع؟ → [كي نت] [بطاقة] [نقد]    │
└─────────────────────────────────────┘
→ ينشئ DB معزول + واجهة + سير عمل
→ يصير عندها "كيكتي.jasim.ai" خلال 30 ثانية
```

**القوالب المطلوبة:**
| القالب | الاستخدام | المدة |
|--------|-----------|-------|
| restaurant_template | مطاعم وتوصيل | جاهز في 30 ثانية |
| salon_template | صالونات تجميل | جاهز في 30 ثانية |
| clinic_template | عيادات | جاهز في 30 ثانية |
| maintenance_template | صيانة | جاهز في 30 ثانية |
| store_template | متجر إلكتروني | جاهز في 30 ثانية |
| delivery_template | شركة توصيل | جاهز في 30 ثانية |

**ملفات مطلوبة:**
- `src/pages/SaasBuilder.tsx` — بانر البناء
- `src/components/TemplateSelector.tsx` — اختيار القالب
- `src/components/PlatformPreview.tsx` — معاينة المنصة
- `api/core/saas-deployer.ts` — منصق النشر

**وقت التنفيذ:** 5-7 أيام

---

## 🔴 الفجوة 5: Gen-Aggregator (بناء الأسواق)

### المشكلة
لا يوجد باني أسواق تجميعية.

### المطلوب
السماح ببناء سوق تجميعي (مثل "كويت فكس" للصيانة):

```
المستخدم: "ابغى اسوق كويت فكس للصيانة"
جاسم: [ينشئ المنصة تلقائياً]
→ vendor onboarding تلقائي
→ commission rules مبرمجة
→ dispute resolution مدمج
→ analytics dashboard جاهز
```

**ملفات مطلوبة:**
- `src/pages/AggregatorBuilder.tsx`
- `src/components/VendorManager.tsx`
- `src/components/CommissionSettings.tsx`
- `src/components/PlatformAnalytics.tsx`

**وقت التنفيذ:** 4-5 أيام

---

## 🟡 الفجوة 6: DNA Breeding Engine (تكاثر الفقاعات)

### المشكلة
لا يوجد نظام DNA للفقاعات.

### المطلوب
كل فقاعة لها 12 جينة (Gene) تحدد خصائصها:

```typescript
interface BubbleDNA {
  genes: {
    color: string;      // لون الفقاعة
    size: number;       // الحجم
    animation: string;  // نوع الحركة
    sound: string;      // صوت الولادة
    opacity: number;    // الشفافية
    borderWidth: number; // سمك الحدود
    glowIntensity: number; // شدة التوهج
    particleCount: number; // عدد الجسيمات
    floatSpeed: number;   // سرعة الطفو
    interaction: string;  // نوع التفاعل
    theme: string;        // الثيم
    lifespan: number;     // عمر الفقاعة
  }
}
```

**التكاثر (Breeding):**
- دمج فقاعتين → فقاعة هجينة
- تركيب جينات الأب + الأم → DNA جديد
- مثال: Food Bubble + Payment Bubble = "Order Bubble"

**ملفات مطلوبة:**
- `api/core/dna-engine.ts` — محرك DNA
- `api/core/dna-breeder.ts` — منسق التكاثر
- `src/components/DNABrowser.tsx` — مستعرض DNA
- `src/components/DNABreedingLab.tsx` — معمل التكاثر

**وقت التنفيذ:** 3-4 أيام

---

## 🟡 الفجوة 7: Sonic DNA (الصوت التوليدي)

### المشكلة
لا يوجد نظام صوتي.

### المطلوب
صوت توليدي رياضي (Procedural Audio) — لا ملفات صوتية!

```typescript
// كل فقاعة لها "صوت ولادة" و "صوت حياة" و "صوت موت"
interface SonicDNA {
  birth: OscillatorConfig;   // صوت الظهور
  life: LoopConfig;          // صوت الخلفية
  death: BurstConfig;        // صوت الاختفاء
  interact: EffectConfig;    // صوت التفاعل
}

// أمثلة:
ProductBubble.birth = "plop" (قطرة ماء)
TrackingBubble.life = "ripple-loop" (تموج مائي)
RatingBubble.birth = "star-chime" (نجمة ذهبية C-E-G-C)
PaymentBubble.interact = "coin-clink" (صوت عملة)
```

**Web Audio API:**
```javascript
const ctx = new AudioContext();
const osc = ctx.createOscillator();
osc.type = 'sine';
osc.frequency.value = 523.25; // C5
osc.connect(ctx.destination);
osc.start();
```

**ملفات مطلوبة:**
- `src/lib/sonic-dna.ts` — محرك الصوت
- `src/components/SonicSettings.tsx` — إعدادات الصوت

**وقت التنفيذ:** 2-3 أيام

---

## 🟡 الفجوة 8: AI Vision Pipeline

### المشكلة
لا يوجد تكامل حقيقي مع كاميرا AI.

### المطلوب
1. **Product Scanner** — تصوير منتف → البحث عنه
2. **KYC Verification** — تصوير هوية → OCR + verification
3. **Receipt Reader** — تصوير فاتورة → استخراج البيانات
4. **Barcode Scanner** — مسح باركود

**التقنية:**
- `getUserMedia()` للكاميرا
- TensorFlow.js للـ Object Detection
- Tesseract.js للـ OCR

**ملفات مطلوبة:**
- `src/components/CameraScanner.tsx` — كاميرا الماسح
- `src/components/KYCVerifier.tsx` — تحقق الهوية
- `src/components/ReceiptReader.tsx` — قارئ الفواتير

**وقت التنفيذ:** 3-4 أيام

---

## 🟡 الفجوة 9: Biometric للمدفوعات

### المشكلة
لا يوجد تكامل حقيقي مع Face ID / Touch ID.

### المطلوب
```
المستخدم يطلب → "ادفع"
جاسم: [يطلع Face ID]
✅ بصمة الوجه → الدفع تلقائي
❌ فشل → رمز PIN
```

**Web Authentication API:**
```javascript
const credential = await navigator.credentials.create({
  publicKey: { challenge, rp, user, pubKeyCredParams }
});
```

**ملفات مطلوبة:**
- `src/components/BiometricPrompt.tsx` — نافذة البيومترك
- `src/hooks/useBiometric.ts` — Hook للبيومترك

**وقت التنفيذ:** 1-2 أيام

---

## 🟡 الفجوة 10: Cross-Border B2B (المرابحة)

### المشكلة
الراوتر موجود لكن لا يوجد تكامل حقيقي مع الجمارك.

### المطلوب
1. **Customs Calculator** — حساب الجمارك تلقائياً
2. **Murabaha Calculator** — حساب المرابحة الإسلامية
3. **Shipping Integration** — ربط مع شركات الشحن
4. **Trade Documents** — توليد الوثائق التجارية

**ملفات مطلوبة:**
- `src/components/CrossBorderCalculator.tsx`
- `src/components/MurabahaDisplay.tsx`
- `src/components/TradeDocumentViewer.tsx`

**وقت التنفيذ:** 2-3 أيام

---

## 🟢 الفجوة 11: لوحات التحكم

### المطلوب
| اللوحة | للمستخدم | المميزات |
|--------|---------|----------|
| **Merchant Dashboard** | التاجر | منتجات، طلبات، إحصائيات، إعدادات |
| **Super Admin** | المشرف | مستخدمين، أسواق، إحصائيات، إعدادات |
| **Agent Dashboard** | الوكيل | مهام، أداء، إعدادات |

**ملفات مطلوبة:**
- `src/pages/dashboard/MerchantDashboard.tsx`
- `src/pages/dashboard/AdminDashboard.tsx`
- `src/pages/dashboard/AgentDashboard.tsx`
- `src/components/dashboard/StatsCards.tsx`
- `src/components/dashboard/Charts.tsx`
- `src/components/dashboard/DataTables.tsx`

**وقت التنفيذ:** 4-5 أيام

---

## 🟢 الفجوة 12: Mobile Apps (iOS/Android)

### المطلوب
تطبيقات جوال أصلية (Native) أو PWA متقدمة.

**الخيارات:**
1. **PWA Advanced** — أسرع، أرخص
   - Service Worker offline
   - Push Notifications
   - Home Screen Install
   - Camera API

2. **React Native + Expo** — أداء أعلى
   - Expo SDK 52
   - Biometric Auth native
   - Push Notifications (APNs + FCM)
   - Camera + AI Vision

**وقت التنفيذ:** PWA: 2-3 أيام | React Native: 7-10 أيام

---

## 🟢 الفجوة 13: الاختبارات

### المطلوب
```
Tests/
├── unit/
│   ├── intent-parser.test.ts (50+ حالة)
│   ├── memory-engine.test.ts
│   ├── agent-router.test.ts
│   ├── haggle.test.ts
│   ├── zakat.test.ts
│   └── ...
├── integration/
│   ├── order-flow.test.ts
│   ├── payment-flow.test.ts
│   ├── cross-border-flow.test.ts
│   └── chat-flow.test.ts
└── e2e/
    ├── user-journey.test.ts
    └── merchant-journey.test.ts
```

**وقت التنفيذ:** 4-5 أيام

---

## 🟢 الفجوة 14: النشر والمراقبة

### المطلوب
| المكون | الخدمة | التكلفة |
|--------|--------|---------|
| Hosting | Replit Core | $7/شهر |
| Database | MySQL 8 (Replit) | مضمن |
| Cache | Upstash Redis | $0-10/شهر |
| Search | Meilisearch | $0-20/شهر |
| Storage | Cloudflare R2 | $0-5/شهر |
| AI APIs | DeepSeek + Claude | $150-700/شهر |
| Monitoring | Better Stack + Sentry | $0/شهر |
| CDN | Cloudflare | $0/شهر |
| Domain | jasim.ai | $12/سنة |

**CI/CD Pipeline:**
```yaml
# .github/workflows/deploy.yml
name: Deploy JASIM
on: [push]
jobs:
  test:
    - run: npm test
  build:
    - run: npm run build
  deploy:
    - run: replit deploy
```

**وقت التنفيذ:** 2-3 أيام

---

## 📋 ملخص ما تبقى

| الفجوة | الأولوية | الوقت | الملفات |
|--------|---------|-------|---------|
| 1. Multi-Bubble System | 🔴 عالية | 3-4 أيام | 6 ملفات |
| 2. Widget System | 🔴 عالية | 2-3 أيام | 3 ملفات |
| 3. Smart Connect | 🔴 عالية | 4-5 أيام | 6 ملفات |
| 4. Gen-SaaS | 🔴 عالية | 5-7 أيام | 4 ملفات |
| 5. Gen-Aggregator | 🔴 عالية | 4-5 أيام | 4 ملفات |
| 6. DNA Breeding | 🟡 متوسطة | 3-4 أيام | 4 ملفات |
| 7. Sonic DNA | 🟡 متوسطة | 2-3 أيام | 2 ملفات |
| 8. AI Vision | 🟡 متوسطة | 3-4 أيام | 3 ملفات |
| 9. Biometric | 🟡 متوسطة | 1-2 أيام | 2 ملفات |
| 10. Cross-Border | 🟡 متوسطة | 2-3 أيام | 3 ملفات |
| 11. Dashboards | 🟢 منخفضة | 4-5 أيام | 6 ملفات |
| 12. Mobile Apps | 🟢 منخفضة | 7-10 أيام | 10+ ملفات |
| 13. Testing | 🟢 منخفضة | 4-5 أيام | 15+ ملفات |
| 14. Deployment | 🟢 منخفضة | 2-3 أيام | 3 ملفات |

**المجموع:** 🔴 5 فجوات عالية (18-24 يوم) + 🟡 5 متوسطة (11-16 يوم) + 🟢 4 منخفضة (17-23 يوم)

**لإطلاق MVP كامل:** 6-8 أسابيع
**لإطلاق كامل:** 10-12 أسبوع

---

## 🎯 توصية: خطة الإطلاق السريع (6 أسابيع)

### الأسبوع 1-2: الأساسيات
- Multi-Bubble System ✅
- Widget System ✅
- Sonic DNA ✅
- Biometric ✅

### الأسبوع 3-4: التكامل
- Smart Connect ✅
- Gen-SaaS (3 قوالب) ✅
- AI Vision ✅
- Cross-Border ✅

### الأسبوع 5-6: البوليش
- Dashboards ✅
- Testing ✅
- Deployment ✅
- Documentation ✅

**التكلفة الإجمالية للإطلاق:** $157-742/شهر
**الفريق المطلوب:** 3-4 مطورين
