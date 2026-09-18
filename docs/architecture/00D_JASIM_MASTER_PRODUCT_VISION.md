# JASIM — الرؤية الشاملة للمنتج
## JASIM App + JASIM OS + Generated Worlds

> **مصدر هذه الوثيقة: مالك المنتج.** أُودعت هنا لأنها **مرجع فهم**، لا أمر تنفيذ.
> الغرض منها منع اختزال جاسم في أمثلته — السيارات، السائقين، الوظائف، السفر،
> المطاعم — وتثبيت الرؤية العامة التي يجب أن يفهمها كل من يعمل على المشروع.
>
> القرارات المُلزِمة المشتقّة منها في `00E_JASIM_PRODUCT_ARCHITECTURE_DECISIONS.md`.

---

## 1. جاسم في جملة واحدة

نظام **عام** يحوّل ما يريد المستخدم أن يحدث إلى هدف، ثم قدرات، ثم مزوّدين، ثم خطة
وتنفيذ ومراقبة وتحقق، ويولّد الواجهة المناسبة للحظة، من محادثة واحدة.

> **قل لجاسم ما الذي تريد أن يحدث، وليس أي تطبيق تريد استخدامه.**

## 2. ما ليس جاسم

ليس تطبيق سيارات أو وظائف أو سفر أو مطاعم. ليس Marketplace ثابتًا، ولا Workflow
Builder تقليديًا، ولا مجموعة Domain Agents، ولا Dashboard ضخمًا، ولا Chatbot
يكتب نصًا فقط، ولا LLM يملك الصلاحية والتنفيذ، ولا مولّد HTML/React خام.

**«بع لي سيارة» و«وظفني» و«رتب لي رحلة» اختبارات قبول للعمومية — وليست بنية.**

## 3. المبادئ الدستورية

```
ONE JASIM · ONE canonical runtime · ONE operational truth
ONE semantic capability system · ONE policy/security truth
ONE execution truth · ONE verification truth

LLM != Authority
Capability != Provider
Conversation != Operational State
UI != Canonical Truth
Intent != Proposal != Approval != Execution != Receipt != Verification
Authorized != Executed · Executed != Verified
Receipt != Verification · Inconclusive != Failed
```

والقاعدة الأهم:

```
NEW DOMAIN            != NEW CORE ARCHITECTURE
NEW EXAMPLE           != NEW AGENT
NEW BUSINESS          != NEW RUNTIME
NEW PROVIDER          MAY BE NEEDED
NEW GENERIC CAPABILITY MAY BE NEEDED
NEW DOMAIN-SPECIFIC CORE  SHOULD NORMALLY BE 0
```

## 4. البدائيات العامة

عند أي طلب جديد، يُفكَّر أولًا بهذه:

Actor · Resource · Need · Offering · Capacity · Constraint · Preference ·
Policy · Capability · Provider · Goal · Plan · Run · Task · Observation ·
Evidence · Verification · Economics · Permission · World · Living Object ·
ResultSet · Reference

**إذا احتاج مجال جديد إلى `CarAgent` أو `RestaurantAgent` أو `ScaffoldingAgent`،
فهذه علامة ضعف في العمومية — لا حاجة إلى مجال.**

## 5. التحوّل من التطبيق التقليدي

| التقليدي | جاسم |
|---|---|
| Pages · Menus · Categories · Filters · Forms · Buttons · Checkout · Tracking | Intent → Understanding → Goal → Constraints → Capabilities → Providers → Generated Surface → Action → Canonical State → Observation → Verification |

**المستخدم لا يتعلّم التطبيق؛ التطبيق يفهم ما يريده المستخدم.**

---

## 6. ثلاث طبقات منتجية، نواة واحدة

### 6.1 JASIM App
المنتج العام للمستخدم النهائي. لا اختيار مجال مسبقًا.

### 6.2 JASIM OS
منتج B2B. موقع أو تطبيق باسم الشركة، بواجهة محادثية توليدية فوق بياناتها الحقيقية.

```
ONE JASIM CORE + Business Data + Business Rules
+ Business Providers/APIs + Brand Configuration + Generated Conversational UI
```

### 6.3 Generated Worlds
عالم تشغيلي **دائم** داخل جاسم، يُنشأ حين توجد استمرارية حقيقية تبرّره.

### الفرق

| البُعد | JASIM App | JASIM OS | Generated World |
|---|---|---|---|
| المستخدم | عام | شركة/عميلها | مستخدم أو شركة داخل جاسم |
| العلامة | جاسم | علامة العميل | جاسم / العالم |
| البيانات | متعددة المصادر | بيانات الشركة | بيانات العالم |
| الاستمرارية | حسب المهمة | غالبًا دائمة | دائمة |
| Runtime | **نفس جاسم** | **نفس جاسم** | **نفس جاسم** |
| Core مجالي | **لا** | **لا** | **لا** |

## 7. JASIM OS — ما يتغيّر وما لا يتغيّر

| تغيّره الشركة | لا تغيّره أبدًا |
|---|---|
| Brand · Catalog · Data · Policies · Pricing · Permissions · Provider Bindings · Workflows · Business Copy | Authority Model · Execution Truth · Verification · Reference Semantics · Planning Semantics · Security Boundaries · Canonical Runtime |

**أمثلة:** مطعم، متجر أزياء، شركة صيانة، مدرسة — كلها نفس المسار:
`Intent → Real Catalog/Service → Constraints → Matching → Generated Choice →
Approval → Payment → Tracking → Verification`. **ولا `RestaurantAgent`.**

JASIM OS **ليس** Website Builder: الهدف تجربة محادثية تشغيلية فوق بيانات وقدرات
حقيقية. قد توجد صفحات، لكنها ليست مركز التجربة.

---

## 8. الواجهة التوليدية

الأسطح: TEXT · STRUCTURED_RESULT · SEARCH_RESULTS · COMPARISON · CHOICE · FORM ·
MAP · TRACKER · STATUS · APPROVAL · TIMELINE · DOCUMENT · LIVING_OBJECT

**القاعدة: Smallest Sufficient Output.** إذا كفى النص فلا فقاعة ثقيلة؛ إذا كفى
CHOICE فلا Dashboard؛ إذا كانت المهمة عابرة فلا World.

**دورة الحياة:** `ENTER · UPDATE · MORPH · EXIT · NO_CHANGE`

مثال: «اعرض لي السائق» → MAP ENTER · موقع جديد → UPDATE · تم التسليم وتُحقِّق منه
→ MORPH إلى STATUS · انتهت الحاجة → EXIT.

**لا تراكم أسطح بلا نهاية.** التاريخ يبقى، وActive Workspace يعرض ما يهم الآن.

**Living Object للمستمر فقط**: مراقبة سعر، تتبّع شحنة، تجديد عقد، مهمة مجدولة.
ليس كل نتيجة كائنًا حيًّا.

## 9. المحادثة كلغة تحكّم

«أي طلب فوق 500 لازم أوافق عليه» = Policy Change.
«محمد يشوف الطلبات لا الأرباح» = Permission Change.
«غيّر سعر الخدمة إلى 25» = Economic/Data Change.

المسار: `Natural Language → Reference Resolution → Mutation Intent → ChangeSet →
Impact → Policy → Approval if needed → Atomic Mutation → Version → Projection`

## 10. المزوّدون

**Human Providers** — سائق، فنّي، مترجم، مفتّش. وقوله «تم» **ليس** تحقّقًا.
**IoT/Devices** — أمر ثم قراءة حالة ثم تحقّق.
**MCP / A2A / Remote Agents / Computer Use** — أذرع تنفيذ، و`Remote Agent != Authority`.
Computer Use يخضع لـSandbox وCredential Boundary وPolicy وApproval وAttempt
وReceipt وVerification.

## 11. الاكتشاف الحقيقي والمراجع

```
Need → Query Generation → Real Providers → Fetch → Normalize → Entity Resolution
→ Offering → Hard Constraints → Ranking → Provenance → Freshness → ResultSet
→ Stable References
```

«قارن الثاني والرابع» **لا يعيد البحث** — مراجع ثابتة من نفس ResultSet.
«اعرض لي السائق» مع أكثر من مرشّح صالح → **CHOICE**، لا تخمين.

## 12. حقيقة التنفيذ

```
PROVIDER_RESPONSE != EFFECT_OCCURRED
RECEIPT           != VERIFICATION
HTTP_200          != VERIFIED
SUCCESS:true      != VERIFIED
```

الحالات الصادقة: PENDING · INCONCLUSIVE · BLOCKED · FAILED · VERIFIED.

**CompletionPolicy** يجيب: ما الدليل الكافي لاعتبار الأثر حدث فعلًا؟
**CompensationPolicy**: أثر وقع ثم فشلت المهمة الأكبر → لا نمحو التاريخ؛ التعويض
**أثر جديد** له محاولة وإيصال وتحقّق.

## 13. الذكاء المستقبلي

**GoalSpec** — Goal · Desired Outcome · Actors · Resources · Hard Constraints ·
Soft Preferences · Budget · Deadline · Risk · Authority.

**PlanGraph** — Goal → Decomposition → Capability Composition → Dependencies →
Provider Requirements → Policy → DAG. **بلا Domain Planner.**

**Level 6** — Goal → Plan → Act → Observe → Verify → Repair → Replan، ضمن
Authority · Policy · Budget · Time · Risk · Termination.

**Level 7** — `Unused Resource + Real Need + Compatible Constraints +
Positive Economics = Opportunity Candidate`. جاسم **يقترح** الفرصة ولا ينفّذها
بلا تفويض. وOpportunity **عامة**: resource · need · compatibility ·
expectedRevenue · expectedCost · constraints · confidence · providerAvailability
· authorityRequirement · status. **لا `TruckOpportunity` ولا `CNCOpportunity`.**

## 14. الإعلان الذكي

Sponsored **Discovery**، لا Banner.

```
SPONSORED       != BEST
ADVERTISER MONEY != ANSWER AUTHORITY
```

فصل بين: Organic Ranking · Sponsored Eligibility/Ranking · Final Presentation.
والخصوصية: لا كشف للمحادثة الخام، أقلّ إشارات لازمة، وسم واضح، تحكّم المستخدم،
ولا تفضيل مدفوع غير معلن.

## 15. التجارة والحقيقة المالية

```
CHECKOUT_CREATED != PAYMENT_AUTHORIZED != CAPTURED != SETTLED != PAYOUT_COMPLETED
```

## 16. الأجهزة والاستمرارية

Web / iOS / Android **إسقاطات لنفس Runtime**. لا حقيقة Mobile مستقلة.
الانتقال بين الأجهزة يحافظ على: نفس المحادثة، نفس ResultSet، نفس المراجع، نفس
Run، نفس الحالة.

**العربية أولًا · RTL أولًا.** الإنجليزية ليست الافتراض.

الهوية البصرية: Dark Navy · Near Black · Cyan · Blue · Controlled Violet ·
Soap Glass · Pop Bubbles — **وبلا** تقدّم وهمي أو نجاح وهمي أو خريطة وهمية أو
تقييمات وهمية أو معاملات وهمية.

## 17. الذاكرة والسياق والقياس

فصل: Conversation History · Working Memory · User Preferences · Operational
State · World State · Canonical Truth. **الذاكرة ليست الحقيقة التشغيلية.**

لا نرسل كل شيء للنموذج: فقط Goal · Relevant Constraints · Stable References ·
Current Run · Necessary State · Authority · Budget.

يُقاس جاسم **كنظام لا كChatbot**. والأهم: **`FALSE_SUCCESS_RATE → 0`**.

## 18. التطوّر الآمن

```
Observed Failure → Generic Gap → Candidate → Isolated Lab → Frozen Evals
→ Security → Canary → Human Approval → Release
```

**ولا Live self-modification. ولا Self-authorized production release.**

---

## 19. GENERALITY GUARDRAIL (رسمي)

> Examples are acceptance tests, not architecture.
>
> Do **NOT** create domain-specific agents, runtimes, cores, planners, state
> models, or UI architectures for cars, drivers, jobs, travel, retail, health,
> logistics, manufacturing, hospitality, education, restaurants, or any other
> domain.
>
> For every new request, first express it using generic primitives:
> Actor · Resource · Need · Offering · Capacity · Constraint · Policy ·
> Capability · Provider · Goal · Plan · Run · Observation · Verification ·
> Economics
>
> If supporting a new example requires a domain-specific core component, **stop
> and classify the missing generic capability instead.**
>
> `NEW_DOMAIN_SPECIFIC_CORE_FILES = 0`
>
> **Examples must prove generality. They must never define it.**

## 20. اختبار العمومية الحقيقي

أعطِ جاسم شيئًا لم يُذكر: «عندي مختبر وأجهزة فاضية ليلًا وأريد أستفيد منها.»

إذا احتاج `LabAgent` ← **فشل**.
إذا مثّله بـResources · Capabilities · Schedule · Capacity · Demand ·
Constraints · Economics ← **نجاح**.

## 21. ماذا يفعل Claude عند مجال جديد؟

يسأل: ما الهدف؟ من الـActors؟ ما الـResources والـNeeds والـOfferings؟ ما
القيود؟ ما القدرات؟ ما المزوّدات؟ ما السلطة المطلوبة؟ ما دليل التحقق؟ ما أصغر
واجهة كافية؟ هل هناك Generic Gap؟

**ولا يسأل: ما Agent الجديد؟**

## 22. معيار قبول كل تطوير مستقبلي

```
DOES THIS PRESERVE ONE JASIM?
DOES THIS PRESERVE GENERALITY?
DOES THIS KEEP AUTHORITY OUT OF THE MODEL?
DOES THIS KEEP CANONICAL TRUTH SERVER-SIDE?
DOES THIS AVOID DOMAIN-SPECIFIC CORE?
DOES THIS SUPPORT GENERATED UI LIFECYCLE?
DOES THIS PRESERVE VERIFIED EXECUTION TRUTH?
DOES THIS WORK FOR JASIM APP AND JASIM OS?
```

**إذا كانت الإجابة «لا» — توقّف وراجع.**

## 23. ما يجب ألا يحدث أبدًا

كل مجال ← وكيل · مُخرَج نموذج ← تنفيذ موثوق · نجاح مزوّد ← تحقّق · عميل يملك
الحقيقة التشغيلية · React/HTML خام من النموذج · نتائج أو خرائط أو معاملات
مختلَقة · عالم لكل طلب · تراكم دائم للأسطح · نواة متفرّعة لكل شركة · إصدار ذاتي
التفويض.

## 24. الخريطة المستقبلية

```
Real Model Provider → GoalSpec → PlanGraph → Real Discovery → Real Providers
→ JASIM App general execution → JASIM OS business packaging
→ Smart Sponsored Discovery → Commerce/Payments
→ Level 6 bounded autonomy → Level 7 economic opportunities
→ Continuous safe evolution
```

## 25. ما لا يُنفَّذ من هذه الوثيقة الآن

هذه الوثيقة **تثبّت الرؤية**. لا تعني تنفيذ JASIM OS أو الإعلانات أو Level 7 أو
كل المزوّدين الآن. تعني: **لا تبنِ أي مرحلة بطريقة تغلق الطريق أمام هذه الرؤية
أو تختزل جاسم في أمثلته الحالية.**

## 26. البيان النهائي غير القابل للتفاوض

> جاسم ليس مجموعة تطبيقات ذكية.
>
> جاسم نظام **عام** يفهم الهدف، يكوّن القدرات، يختار المزوّدين، يخطط، ينفّذ،
> يراقب، يتحقّق، يتعافى، ويولّد الواجهة المناسبة؛ ويمكن تقديمه للمستخدم مباشرة،
> أو تعبئته كـJASIM OS للشركات، أو إنشاء Worlds دائمة داخله — **دون كسر وحدة
> النواة أو الحقيقة.**

END OF VISION.
