# JASIM — PERMANENT GENERALITY ACCEPTANCE CATALOG

> **These scenarios are TESTS.**
>
> They are not features, not domains, and not instructions to add branches. None
> of them may ever become a `RestaurantAgent`, a `JobsAgent`, a `FactoryAgent`, a
> `DriverAgent` or a `WholesaleMarketplace`.
>
> The catalog answers one question permanently: can **one** JASIM compose general
> primitives and capabilities to handle this, **without a new domain branch**?

The machine-readable source of truth is
`canonical/جاسم/app/tests/generality/catalog.ts`. The scoreboard below is
generated from it and verified by `tests/unit/generality-catalog.test.ts`, so the
document cannot drift from the data.

---

## The governing law

```
JASIM
=
ONE GENERAL INTELLIGENCE
+ GENERAL PRIMITIVES
+ COMPOSABLE CAPABILITIES
+ PROVIDER BOUNDARIES
+ CANONICAL STATE
+ POLICY / AUTHORITY
+ OBSERVATION / VERIFICATION
+ GENERATIVE PRESENTATION
```

```
NEW DOMAIN          != NEW AGENT
NEW EXAMPLE         != NEW BRANCH
NEW BUSINESS        != NEW RUNTIME
NEW MARKET CATEGORY != NEW MARKETPLACE
```

Examples are acceptance tests. Examples are not architecture.

## The eight gates

| gate | the question it answers |
|---|---|
| **REPRESENTABLE** | can the core express this goal with no domain-specific type? |
| **ROUTABLE** | does the semantic router send it to the correct mechanism? |
| **PLANNABLE** | can the needed capabilities and plan be composed? |
| **EXECUTABLE** | can a real capability and a real provider carry it out **today**? |
| **OBSERVABLE** | can JASIM learn what actually happened? |
| **VERIFIABLE** | can the outcome be independently proven? |
| **PRESENTABLE** | can the state be shown through a real generative surface? |
| **PERSISTENT** | if it is ongoing, does its state survive and update? |

They are independent and are never collapsed.

```
REPRESENTABLE = PASS
```

does **not** mean

```
JASIM CAN DO IT TODAY.
```

A scenario that is representable, routable and plannable but whose provider is
not connected is **not** an end-to-end pass. Neither is it a generality failure.

## Status vocabulary

| status | meaning |
|---|---|
| `PASS` | proven in the repository today |
| `NOT_YET_IMPLEMENTED` | a **general** capability is missing — named in the blocker |
| `BLOCKED_BY_PROVIDER` | the generic contract is correct; nothing is plugged into it |
| `BLOCKED_BY_ENVIRONMENT` | contract and provider exist; this environment cannot run it |
| `NOT_APPLICABLE` | the gate has no meaning here — a one-shot read persists nothing |

Gate defaults in the data are **pessimistic**: a gate nobody thought about reads
`NOT_YET_IMPLEMENTED`, never `PASS`. Forgetting must not be the permissive path.

## The failure rule

When a scenario fails, the blocker named is the **general** gap — never the
scenario. "Supplier negotiation does not work" is not a blocker;
`GENERAL_AGREEMENT_RUNTIME` is, and closing it closes salary, rent, shipping,
equipment and every holdout at the same time.

Writing code for a scenario is how a general system becomes a pile of verticals.

## What the ratchets can and cannot prove

| ratchet | proves | does **not** prove |
|---|---|---|
| `DOMAIN_BRANCHES_REQUIRED = 0` | every catalogued scenario is declared to need no domain branch | that the declaration is honest — the holdout suite is what tests that |
| `BLIND_HOLDOUT_REQUIRING_DOMAIN_BRANCH = 0` | 16 unfamiliar domains are represented and routed by existing primitives | that they can be executed — most cannot yet, and say so |
| no domain identifier in the runtime | no exported name in the runtime is an industry noun | that the logic inside is domain-free; the holdouts test that behaviourally |
| holdouts import no production domain module | the holdout suite cannot have shaped production code | that no future code will be written for them |

A ratchet that claimed more than this would be the same false confidence the
catalog exists to prevent.

---

<!-- BEGIN GENERATED: do not edit by hand -->

## Scoreboard

**TOTAL_SCENARIOS = 155** · holdouts = 16

Counted per gate. There is deliberately no single percentage: eight gates
answer eight questions, and one number answering all of them is the exact
claim this catalog exists to prevent.

| gate | PASS | NOT_YET_IMPLEMENTED | BLOCKED_BY_PROVIDER | BLOCKED_BY_ENVIRONMENT | NOT_APPLICABLE |
|---|---:|---:|---:|---:|---:|
| **REPRESENTABLE** | 155 | 0 | 0 | 0 | 0 |
| **ROUTABLE** | 155 | 0 | 0 | 0 | 0 |
| **PLANNABLE** | 116 | 39 | 0 | 0 | 0 |
| **EXECUTABLE** | 24 | 104 | 25 | 2 | 0 |
| **OBSERVABLE** | 54 | 18 | 18 | 0 | 65 |
| **VERIFIABLE** | 49 | 23 | 18 | 0 | 65 |
| **PRESENTABLE** | 153 | 2 | 0 | 0 | 0 |
| **PERSISTENT** | 121 | 17 | 0 | 0 | 17 |

Scenarios blocked by an absent **provider**: **29**
Scenarios blocked by this **environment**: **2**
Scenarios waiting on a **general capability**: **104**

### General gaps

Each of these closes many scenarios at once. That is what makes it general.

- `BUSINESS_DATA_SOURCE_ADAPTER`
- `BUSINESS_SCOPE_RUNTIME`
- `EXTERNAL_DISCOVERY_PROVIDER`
- `GENERAL_AGREEMENT_RUNTIME`
- `GENERAL_TRANSACTION_FULFILLMENT`
- `LIVING_OBJECT_RUNTIME`
- `LOCATION_OBSERVATION`
- `MONITORING_ENGINE`
- `OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH`
- `PERSISTENT_WORLD_MATERIALIZATION`
- `REALTIME_RUNTIME`
- `SECURE_PRODUCT_ACTION_RUNTIME`
- `SPONSORED_DISCOVERY_RUNTIME`
- `SUBSCRIPTION_RUNTIME`

### Ratchets

- `DOMAIN_BRANCHES_REQUIRED = 0`
- `BLIND_HOLDOUT_SCENARIOS = 16`
- `BLIND_HOLDOUT_REQUIRING_DOMAIN_BRANCH = 0`

## Scenarios

● PASS · ○ general capability missing · P blocked by provider · E blocked by environment · — not applicable

### CONVERSATION_ROUTING · 8

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `route.text` | ما هو الفرق بين العقد والاتفاق؟ | TEXT | ● | ● | ● | E | — | — | ● | — | — |
| `route.direct_read` | أرني عملياتي | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `route.generated_presentation` | اعرض لي هذا كبطاقة | GENERATED_PRESENTATION | ● | ● | ● | E | — | — | ● | — | — |
| `route.product_action` | سجّلني خروج | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `route.plangraph` | رتب لي مؤتمرًا الشهر القادم | GENERAL_PLANGRAPH | ● | ● | ● | P | ● | ● | ● | ● | — |
| `route.monitoring` | راقب السعر وأخبرني إذا نزل | MONITORING | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | MONITORING_ENGINE |
| `route.living_object` | أين وصل طلبي؟ | PERSISTENT_LIVING_OBJECT | ● | ● | ○ | ○ | ○ | ○ | ● | ● | LIVING_OBJECT_RUNTIME |
| `route.persistent_world` | أنشئ نظامًا دائمًا لشركتي | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | PERSISTENT_WORLD_MATERIALIZATION |

### DATA · 12

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `data.read_runs` | أرني عملياتي | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.read_tasks` | أرني مهامي | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.read_conversations` | أرني محادثاتي | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.sort` | رتبها من الأعلى | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.filter` | أرني المعلّقة فقط | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.ordinal_reference` | اعرض الصف الثاني | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.table` | أرني جدولًا | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.chart` | حولها إلى رسم | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.morph_table_chart` | حولها إلى رسم ثم رجّعها جدول | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.missing_resource` | أرني مبيعاتي | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.denied_field` | أرني مفاتيح عملياتي | DIRECT_READ | ● | ● | ● | ● | — | — | ● | — | — |
| `data.business_source` | أرني مبيعات متجري من نظامي المربوط | DIRECT_READ | ● | ● | ● | ○ | — | — | ● | — | BUSINESS_DATA_SOURCE_ADAPTER |

### SECURE_PRODUCT_ACTIONS · 8

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `product.login` | سجّلني دخول | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.logout` | سجّلني خروج | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.signup` | أنشئ لي حسابًا | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.password_change` | غيّر كلمة المرور | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.account_deletion` | احذف حسابي | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.settings` | غيّر اسمي في الحساب | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.privacy` | أوقف مشاركة موقعي | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |
| `product.permissions` | امنع هذا التطبيق من الوصول | TRUSTED_PRODUCT_ACTION | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | SECURE_PRODUCT_ACTION_RUNTIME |

### MULTI_STEP · 4

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `plan.conference` | رتب مؤتمرًا: قاعة، مترجم، دعوات | GENERAL_PLANGRAPH | ● | ● | ● | P | ● | ● | ● | ● | — |
| `plan.output_binding` | احجز القاعة ثم أرسل العنوان للمدعوين | GENERAL_PLANGRAPH | ● | ● | ● | P | ● | ● | ● | ● | — |
| `plan.calendar` | ضعه في تقويمي | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `plan.messaging` | أرسل لهم رسالة | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |

### DISCOVERY · 5

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `discovery.internal` | ابحث داخل جاسم عن مورد | GENERAL_PLANGRAPH | ● | ● | ● | ● | — | — | ● | ● | — |
| `discovery.external` | ابحث في الإنترنت | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | EXTERNAL_DISCOVERY_PROVIDER |
| `discovery.blended` | ابحث لي عن الأفضل | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | EXTERNAL_DISCOVERY_PROVIDER |
| `discovery.hard_constraints` | أقل من 250 دينار فقط | GENERAL_PLANGRAPH | ● | ● | ● | ● | — | — | ● | — | — |
| `discovery.compare` | قارن الأول والثالث | GENERAL_PLANGRAPH | ● | ● | ● | ● | — | — | ● | ● | — |

### OPEN_MARKET · 20

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `market.business_publishes_need` | شركتي تحتاج 300 حبة بأقل من 250 دينار | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.business_publishes_offering` | انشر منتجاتي وأسعاري وكمياتي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.person_publishes_need` | أحتاج من يصلح مكيفي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.person_publishes_offering` | أعرض خدمة تصميم بالساعة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.resource_capacity` | عندي مولد لديه قدرة فائضة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.human_capacity` | عندي ساعتان متاحتان اليوم | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.machine_capacity` | مخرطتي متاحة 6 ساعات | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.factory_grocery` | مصنع لديه تونة ↔ بقالة تحتاج تونة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.restaurant_customer` | مطعم ينشر قائمته ↔ زبون يطلب وجبة بتعديلات | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.company_candidate` | شركة تحتاج موظفًا ↔ شخص لديه وقت ومهارة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.shipment_driver` | شحنة تحتاج نقلًا ↔ شاحنتان فارغتان اليوم | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.warehouse_renter` | شركة تحتاج مستودعًا أسبوعًا ↔ مستودع لديه مساحة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.machine_production` | طلب تصنيع ↔ مخرطة متاحة 6 ساعات | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.translator_requester` | محكمة تحتاج مترجمًا ↔ مترجم لديه ساعتان | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.technician_company` | شركة تحتاج فنيًا ↔ فني متاح | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.farmer_buyer` | مزارع لديه محصول ↔ مشترٍ بالجملة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.pair.hotel_supplier` | فندق يحتاج مورد غسيل ↔ مغسلة لديها طاقة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.actor_is_both` | مصنعي يشتري مواد خام ويبيع منتجات في الوقت نفسه | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `market.internal_must_not_hide_external` | ابحث لي عن الأفضل حتى لو كان خارج جاسم | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | EXTERNAL_DISCOVERY_PROVIDER |
| `market.claim_is_not_availability` | البائع يقول عنده 100 حبة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |

### AGREEMENT · 11

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `agreement.price` | فاوضه على السعر | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.delivery` | فاوضه على موعد التسليم | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.payment_terms` | فاوضه على الدفع بعد 30 يومًا | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.salary` | فاوضه على الراتب | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.rent` | فاوضه على الإيجار | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.shipping` | فاوضه على أجرة الشحن | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.service` | فاوضه على نطاق الخدمة | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.equipment` | فاوضه على أجرة المعدة | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.buyer_private_maximum` | لا تتجاوز 250 دينارًا ولا تخبره بذلك | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | — | — | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.seller_private_minimum` | لا تنزل تحت 180 ولا تكشف الحد | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | — | — | ● | ● | GENERAL_AGREEMENT_RUNTIME |
| `agreement.commitment` | اتفقنا — ثبّت الاتفاق | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_AGREEMENT_RUNTIME |

### TRANSACTIONS · 8

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `transaction.buy` | اشترِ لي هذا | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |
| `transaction.sell` | بع لي هذا | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |
| `transaction.book` | احجز لي هذه | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |
| `transaction.reserve` | احجز المساحة لأسبوع | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |
| `transaction.cancel` | ألغِ الطلب | GENERAL_PLANGRAPH | ● | ● | ○ | ○ | ● | ● | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |
| `transaction.pay` | ادفع | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `transaction.refund` | أرجع لي المبلغ | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `transaction.fulfillment` | هل وصل الطلب؟ | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | ● | ● | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |

### OBSERVATION_VERIFICATION · 8

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `observation.message_delivery` | هل وصلت الرسالة؟ | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.device_state` | هل اشتغل الجهاز فعلاً؟ | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.human_report` | هل أنجز الفني العمل؟ | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.remote_mutation` | هل تم إنشاء الطلب في نظامهم؟ | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.receipt_is_not_verification` | المزود أعطانا إيصالًا | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.conflict` | المزود يقول تم والقراءة تقول لا | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.missing` | نُفِّذ ولم تصل أي قراءة | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |
| `observation.replay` | المزود أعاد إرسال نفس الإشعار | GENERAL_PLANGRAPH | ● | ● | ● | ● | ● | ● | ● | ● | — |

### MONITORING · 5

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `monitoring.price` | راقب السعر وأخبرني إذا نزل | MONITORING | ● | ● | ○ | ○ | ● | ○ | ● | ● | MONITORING_ENGINE |
| `monitoring.state` | راقب حالة الطلب | MONITORING | ● | ● | ○ | ○ | ● | ○ | ● | ● | MONITORING_ENGINE |
| `monitoring.standing_condition` | إذا نزل تحت 200 اشترِ | MONITORING | ● | ● | ○ | ○ | ● | ○ | ● | ● | MONITORING_ENGINE |
| `monitoring.notify_on_condition` | نبّهني إذا تأخر | MONITORING | ● | ● | ○ | ○ | ● | ○ | ● | ● | MONITORING_ENGINE |
| `monitoring.repeated_observation` | اقرأ الحرارة كل ساعة | MONITORING | ● | ● | ○ | ○ | ● | ○ | ● | ● | MONITORING_ENGINE |

### REALTIME_LIVING_OBJECTS · 6

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `realtime.order_status` | أين وصل طلبي؟ | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | ● | ● | ● | ● | REALTIME_RUNTIME |
| `realtime.delivery_tracker` | أرني السائق على الخريطة | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | P | P | ● | ● | LOCATION_OBSERVATION |
| `realtime.negotiation_session` | أين وصل التفاوض؟ | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | ● | ● | ● | ● | REALTIME_RUNTIME |
| `realtime.application` | أين وصل طلب التوظيف؟ | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | ● | ● | ● | ● | REALTIME_RUNTIME |
| `realtime.booking` | أين وصل الحجز؟ | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | ● | ● | ● | ● | REALTIME_RUNTIME |
| `realtime.price_monitor` | أرني مراقبة السعر | PERSISTENT_LIVING_OBJECT | ● | ● | ● | ○ | ● | ● | ● | ● | REALTIME_RUNTIME |

### WORLDS · 6

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `world.business_world` | أنشئ نظامًا دائمًا لشركتي | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | PERSISTENT_WORLD_MATERIALIZATION |
| `world.warehouse_world` | أنشئ نظام مستودع | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | PERSISTENT_WORLD_MATERIALIZATION |
| `world.operational_world` | أنشئ نظام تشغيل يومي | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | PERSISTENT_WORLD_MATERIALIZATION |
| `world.policy_mutation` | غيّر سياسة الموافقات في نظامي | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | PERSISTENT_WORLD_MATERIALIZATION |
| `world.data_mutation` | أضف حقلاً جديدًا في نظامي | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | PERSISTENT_WORLD_MATERIALIZATION |
| `world.permission_mutation` | اعطِ فريقي صلاحية القراءة فقط | PERSISTENT_WORLD | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | PERSISTENT_WORLD_MATERIALIZATION |

### PHYSICAL_EXTERNAL · 16

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `provider.iot_device` | شغّل المكيف على 22 درجة | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.robot` | حرّك الذراع إلى الموضع الثاني | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.industrial_machine` | شغّل المخرطة على البرنامج الثاني | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.vehicle` | افتح باب السيارة | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.maps` | أرني الطريق إلى المستودع | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | — |
| `provider.calendar` | احجز لي الموعد | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.messaging` | أرسل له رسالة واتساب | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.email` | أرسل له بريدًا | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.storage` | احفظ هذا الملف | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.files` | افتح لي الملف الثاني | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | — |
| `provider.images` | أنشئ لي صورة | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | — |
| `provider.video` | لخّص لي هذا الفيديو | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | — |
| `provider.audio` | فرّغ لي هذا التسجيل | GENERAL_PLANGRAPH | ● | ● | ● | P | — | — | ● | ● | — |
| `provider.mcp` | استخدم أداة MCP المربوطة | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.a2a` | كلّم الوكيل الآخر | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |
| `provider.human_provider` | ابعث مندوبًا يشتري لي | GENERAL_PLANGRAPH | ● | ● | ● | P | P | P | ● | ● | — |

### BUSINESS · 11

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `business.scope` | أنشئ حساب شركتي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.team` | أضف موظفًا إلى فريقي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.permissions` | اعطه صلاحية العروض فقط | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.offerings` | انشر عروضي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.needs` | انشر احتياجاتي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.resources` | سجّل معداتي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.capacity` | سجّل طاقتي المتاحة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.policies` | ضع سياسة: لا تبيع بأقل من التكلفة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.provider_bindings` | اربط نظام المخزون عندي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.analytics` | أرني أداء المبيعات | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `business.world_association` | اربط نظام شركتي بهذا الحساب | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |

### MONETIZATION · 5

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `monetization.user_subscription` | اشترك لي في الخطة الشهرية | GENERAL_PLANGRAPH | ● | ● | ● | ○ | P | P | ● | ● | SUBSCRIPTION_RUNTIME |
| `monetization.business_subscription` | اشترك لشركتي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | P | P | ● | ● | SUBSCRIPTION_RUNTIME |
| `monetization.commission` | خذ عمولتك من الصفقة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | P | P | ● | ● | GENERAL_TRANSACTION_FULFILLMENT |
| `monetization.sponsored` | روّج لعرضي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | SPONSORED_DISCOVERY_RUNTIME |
| `monetization.sponsored_never_wins` | لماذا هذا العرض أولًا؟ | DIRECT_READ | ● | ● | ● | ○ | — | — | ● | — | SPONSORED_DISCOVERY_RUNTIME |

### JASIM_OS · 6

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `jasimos.same_core` | شغّل جاسم لمطعمي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `jasimos.business_data` | اجعله يرى بيانات مطعمي فقط | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `jasimos.branding` | اجعل اسمه وشعاره لمطعمي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `jasimos.policies` | طبّق سياسات مطعمي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `jasimos.permissions` | حدد ما يراه الموظفون | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |
| `jasimos.providers` | اربط مزوداتي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | — | — | ● | ● | BUSINESS_SCOPE_RUNTIME |

### HOLDOUT · 16

| id | goal | route | REPR | ROUT | PLAN | EXEC | OBSE | VERI | PRES | PERS | blocker |
|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `holdout.laboratory_instrument_time` | جهاز مختبر متاح 6 ساعات والجامعة تريد 10 | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.temporary_generator` | مولد احتياطي ليومين بشرط استجابة خلال 15 دقيقة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.cold_storage` | غرفة تبريد فارغة 3 أيام | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.apiary_pollination` | منحل يحتاج تلقيح بستان | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.industrial_valve_service` | صيانة صمام صناعي قبل الخميس | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.desalination_maintenance` | صيانة وحدة تحلية | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.court_interpretation` | مترجم محكمة لجلسة الثلاثاء | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.community_lending` | إعارة معدة من مكتبة الحي | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.specialized_fabrication` | طاقة تصنيع دقيقة متاحة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.event_equipment` | معدات فعالية لليلة واحدة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.scientific_calibration` | معايرة جهاز قياس | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.temporary_workspace` | مساحة عمل لأسبوعين | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.agricultural_service` | رش محصول قبل المطر | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.energy_storage` | سعة تخزين طاقة فائضة | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.falconry_competition` | تجهيز مسابقة صقور | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |
| `holdout.mosque_library` | فهرسة مكتبة مسجد | GENERAL_PLANGRAPH | ● | ● | ● | ○ | ● | ● | ● | ● | OPPORTUNITY_EXCHANGE_CONVERSATIONAL_PATH |

<!-- END GENERATED -->

---

## What this catalog does **not** do

It does not build anything. A scenario moves to `PASS` when the general
subsystem behind it is built and proven — never because someone implemented the
scenario. If the catalog's score ever improves without a general capability
landing, something has gone wrong.

See `docs/master/JASIM_GENERALITY_MAXIMUM_SPEC.md` for the governing generality
law, including the **JASIM OPEN MARKET LAW**.
